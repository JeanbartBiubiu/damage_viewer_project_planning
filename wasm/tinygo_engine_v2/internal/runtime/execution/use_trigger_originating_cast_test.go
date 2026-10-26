package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

func replaceAcceptedControlForTest(s *Engine, accepted bool, mount, bindingKey string) {
	original := s.actions.CurrentAction()
	view := original.Plan()
	plan := model.SkillActionPlan{InstructionKey: view.InstructionKey(), FirstAtMs: view.FirstAtMs(), SortOrder: view.SortOrder(), Source: view.Source(), Target: view.Target(), SkillKey: view.SkillKey(), BindingKey: view.BindingKey(), Action: view.Action(), AbilityRef: view.AbilityRef(), ParentInstructionKey: view.ParentInstructionKey()}
	for index := 0; index < view.HitCount(); index++ {
		plan.HitBindings = append(plan.HitBindings, view.HitAt(index))
	}
	binding := original.Binding()
	if mount != "" {
		binding.ProviderRef = mount
	}
	if bindingKey != "" {
		plan.BindingKey = bindingKey
	}
	replacement := actionpkg.NewSkillAction(actionpkg.SkillActionSeed{AutomaticRule: original.AutomaticRule(), Plan: plan, Binding: binding, ControlAbilityIndex: original.ControlAbilityIndex(), ParentIndex: original.ParentIndex(), UseRef: original.UseRef()})
	s.actions.BindActionUse(replacement.UseRef(), replacement)
	s.actions.SetCurrentAction(replacement)
	if accepted {
		s.actions.Accept(replacement, original.AcceptedUseRef(), false)
	}
	use := s.skillUses[original.UseRef()]
	seed := use.identity.Seed()
	seed.ActionRef = replacement.Reference()
	use.identity = s.actions.NewUse(seed)
}

// These mutations start with a genuinely accepted native process and isolate
// individual provenance mismatches. Rejecting one must not reserve any quota.
func TestOnCastOncePerUseRejectsMismatchedAcceptedContext(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*Engine, *emittedEvent)
	}{
		{"no_current_control", func(s *Engine, _ *emittedEvent) { s.actions.SetCurrentAction(nil) }},
		{"unaccepted_control", func(s *Engine, _ *emittedEvent) { replaceAcceptedControlForTest(s, false, "", "") }},
		{"external_use", func(s *Engine, ev *emittedEvent) {
			u := *s.skillUses[ev.useKey]
			seed := u.identity.Seed()
			seed.ProcessRef.Present, seed.ActionRef.Present = false, false
			u.identity = s.actions.NewUse(seed)
			s.skillUses[ev.useKey] = &u
		}},
		{"different_control_object", func(s *Engine, _ *emittedEvent) {
			copy := *s.actions.CurrentAction()
			s.actions.SetCurrentAction(&copy)
		}},
		{"missing_root_binding", func(s *Engine, ev *emittedEvent) {
			s.actions.ForgetActionUse(s.processForUse(s.skillUses[ev.useKey]).UseKey())
		}},
		{"wrong_source", func(_ *Engine, ev *emittedEvent) { ev.sourceKey = "target" }},
		{"wrong_target", func(_ *Engine, ev *emittedEvent) { ev.targetKey = "source" }},
		{"wrong_skill", func(_ *Engine, ev *emittedEvent) { ev.useSkillKey = "other_skill" }},
		{"wrong_use_source", func(_ *Engine, ev *emittedEvent) { ev.useSource = "target" }},
		{"wrong_cast", func(_ *Engine, ev *emittedEvent) { ev.castInstanceID++ }},
		{"missing_cast", func(_ *Engine, ev *emittedEvent) { ev.castInstanceID, ev.snapshot.castInstanceID = 0, 0 }},
		{"wrong_frozen_cast", func(_ *Engine, ev *emittedEvent) { ev.snapshot.castInstanceID++ }},
		{"wrong_frozen_use", func(_ *Engine, ev *emittedEvent) { ev.snapshot.useKey = "other_use" }},
		{"wrong_frozen_source", func(_ *Engine, ev *emittedEvent) { ev.snapshot.useSource = "target" }},
		{"wrong_frozen_skill", func(_ *Engine, ev *emittedEvent) { ev.snapshot.useSkillKey = "other_skill" }},
		{"wrong_process_owner", func(s *Engine, ev *emittedEvent) {
			original := s.processForUse(s.skillUses[ev.useKey])
			row := original.Snapshot()
			row.Owner = "target"
			wrong := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: row, Definition: original.Definition(), Ability: original.Ability(), AbilityRef: original.AbilityRef(), StepIndex: original.StepIndex()})
			s.actions.AddProcess(wrong)
			seed := s.skillUses[ev.useKey].identity.Seed()
			seed.ProcessRef = wrong.Reference()
			s.skillUses[ev.useKey].identity = s.actions.NewUse(seed)
		}},
		{"wrong_mount", func(s *Engine, _ *emittedEvent) { replaceAcceptedControlForTest(s, true, "other_mount", "") }},
		{"wrong_plan_binding", func(s *Engine, _ *emittedEvent) { replaceAcceptedControlForTest(s, true, "", "other_binding") }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			c, r := finiteRecastInput(2, 1000)
			recastCounters(&c, &r, false)
			s := frameCommitState(t, c, r)
			if err := s.handleSkillAction(0); err != nil {
				t.Fatal(err)
			}
			p := s.actions.ProcessAt(0)
			s.actions.SetCurrentAction(s.actions.Action(s.skillUses[p.UseKey()].identity.ActionReference()))
			var f Frame
			s.initProcessFrame(&f, p)
			ev := emittedEvent{eventType: eventTypeAbilityStarted, ref: eventTypeAbilityStarted, sourceKey: p.Owner(), targetKey: p.Target(),
				hasUse: true, useKey: p.UseKey(), useSource: p.Owner(), useSkillKey: p.SkillKey(), castInstanceID: p.CastID(), castOrigin: f.castOrigin,
				snapshot: f.captureEmitSnapshot(eventTypeAbilityStarted, p.Owner(), p.Target())}
			attachUseToSnapshot(&ev)
			listener := s.compiled.Listeners[1]
			before := len(s.useTriggerLedger)
			test.mutate(s, &ev)
			reserved, skipped, err := s.reserveOncePerUse(listener, ev)
			if err == nil || reserved || skipped || len(s.useTriggerLedger) != before || s.useTriggerReserving != 0 {
				t.Fatalf("invalid native provenance changed the quota: reserved=%v skipped=%v err=%+v ledger=%d/%d pending=%d", reserved, skipped, err, len(s.useTriggerLedger), before, s.useTriggerReserving)
			}
		})
	}
}

func TestOnCastOncePerUseCommitSurvivesListenerDeath(t *testing.T) {
	for _, target := range []string{"source", "target"} {
		t.Run(target, func(t *testing.T) {
			c, r := finiteRecastInput(2, 1000, 1000, 2000)
			recastCounters(&c, &r, false)
			for i := 1; i <= 2; i++ {
				c.SharedProviders[0].Listeners[i].EventMatcher.All[0] = eventTypeAbilityStarted
			}
			c.SharedProviders[0].Listeners[1].Operations = append(c.SharedProviders[0].Listeners[1].Operations,
				model.OperationDefinition{Operation: "damage", Target: target, Amount: timedShieldExpr(1000), DamageType: "damage/physical", Ref: "on_cast_lethal"})
			s := frameCommitState(t, c, r)
			if err := s.handleSkillAction(0); err != nil {
				t.Fatal(err)
			}
			d := s.buildDoneResult(false)
			if s.combatantHp(target) != 0 || recastCounter(t, d, "once") != 1 || len(d.FinalSnapshot.UseTriggerLedger) != 1 || s.useTriggerReserving != 0 {
				t.Fatalf("committed on-cast effect must retain its quota after death: hp=%v once=%v ledger=%+v pending=%d", s.combatantHp(target), recastCounter(t, d, "once"), d.FinalSnapshot.UseTriggerLedger, s.useTriggerReserving)
			}
		})
	}
}
