package runtime

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// Each real INITIAL/RECAST starts a distinct use. Two native on-cast
// listeners sharing one group must commit exactly one count for each shot.
func TestFiniteRecastOnCastOncePerUseUsesNativeCastIdentities(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		name := "manual"
		if automatic {
			name = "automatic"
		}
		t.Run(name, func(t *testing.T) {
			c, r := finiteRecastInput(2, 1000, 1000, 2000)
			recastCounters(&c, &r, false)
			for i := 1; i <= 2; i++ {
				c.SharedProviders[0].Listeners[i].EventMatcher.All[0] = eventTypeAbilityStarted
			}
			if automatic {
				finiteRecastAutomatic(&r, c.Rules.SkillActionBindings[0])
			}
			d := timedShieldMustRun(t, c, r)
			if d.Summary.SourceDamageDealt != 300 || recastCounter(t, d, "casts") != 3 || recastCounter(t, d, "once") != 3 {
				t.Fatalf("three actual shots must each start and consume one shared quota: summary=%+v casts=%v once=%v", d.Summary, recastCounter(t, d, "casts"), recastCounter(t, d, "once"))
			}
			if len(d.FinalSnapshot.UseTriggerLedger) != 3 {
				t.Fatalf("one committed quota per actual use, got %+v", d.FinalSnapshot.UseTriggerLedger)
			}
			uses := map[string]bool{}
			for _, row := range d.FinalSnapshot.UseTriggerLedger {
				if row.UseSource != "source" || row.UseSkillKey != c.Rules.SkillActionBindings[0].SkillKey || uses[row.UseKey] {
					t.Fatalf("quota must retain distinct actual source/skill/use: %+v", row)
				}
				uses[row.UseKey] = true
			}
			starts := 0
			ids := map[uint64]bool{}
			for _, item := range d.Evidence.Items {
				if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == eventTypeAbilityStarted {
					id := recastCastID(t, item.Data["castInstanceId"])
					use, ok := item.Data["useRef"].(string)
					if id == 0 || ids[id] || !ok || !uses[use] {
						t.Fatalf("native start must carry its accepted use and fresh cast: %+v", item)
					}
					ids[id] = true
					starts++
				}
			}
			if starts != 3 {
				t.Fatalf("actual starts=%d want 3", starts)
			}
		})
	}
}

func TestOnCastOncePerUseRejectsExternalUseAndSyntheticEmit(t *testing.T) {
	for _, synthetic := range []bool{false, true} {
		name := "external_process_use"
		if synthetic {
			name = "synthetic_emit_event"
		}
		t.Run(name, func(t *testing.T) {
			c, r := singleSkillInput(false)
			recastCounters(&c, &r, false)
			for i := 1; i <= 2; i++ {
				c.SharedProviders[0].Listeners[i].EventMatcher.All[0] = eventTypeAbilityStarted
			}
			binding := c.Rules.SkillActionBindings[0]
			r.DriverPlan.SkillActions = nil
			r.SkillUses = []model.SkillUseFact{{UseKey: "skill:external", Source: "source", SkillKey: binding.SkillKey, HistoryState: model.SkillHitHistoryComplete}}
			ref := binding.Controls[0].AbilityRef
			if synthetic {
				c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{
					AbilityKey: "synthetic", Kind: "active", SkillKey: binding.SkillKey, Types: []string{"ability/spell"},
					Operations: []model.OperationDefinition{{Operation: "emit_event", EventType: eventTypeAbilityStarted, Ref: eventTypeAbilityStarted, Target: "target"}},
				})
				ref = "source.provider[caster].ability[synthetic]"
			} else {
				r.ProcessCommandFacts = []model.ProcessCommandFact{{DriverEntryKey: "external", UseRef: "skill:external"}}
			}
			r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "external", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0}}
			err := p6MustFailRun(t, c, r)
			if !strings.Contains(err.Path, "oncePerUse") || !strings.Contains(err.Message, "use") {
				t.Fatalf("must reject the unauthorized originating-use event, got %+v", err)
			}
		})
	}
}

// These mutations start with a genuinely accepted native process and isolate
// individual provenance mismatches. Rejecting one must not reserve any quota.
func TestOnCastOncePerUseRejectsMismatchedAcceptedContext(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*genericRunState, *emittedEvent)
	}{
		{"no_current_control", func(s *genericRunState, _ *emittedEvent) { s.skillAction = nil }},
		{"unaccepted_control", func(s *genericRunState, _ *emittedEvent) { s.skillAction.accepted = false }},
		{"external_use", func(s *genericRunState, ev *emittedEvent) {
			u := *s.skillUses[ev.useKey]
			u.plannedProcess, u.plannedAction = nil, nil
			s.skillUses[ev.useKey] = &u
		}},
		{"different_control_object", func(s *genericRunState, _ *emittedEvent) { copy := *s.skillAction; s.skillAction = &copy }},
		{"missing_root_binding", func(s *genericRunState, ev *emittedEvent) {
			delete(s.skillActionByUse, s.skillUses[ev.useKey].plannedProcess.UseKey)
		}},
		{"wrong_source", func(_ *genericRunState, ev *emittedEvent) { ev.sourceKey = "target" }},
		{"wrong_target", func(_ *genericRunState, ev *emittedEvent) { ev.targetKey = "source" }},
		{"wrong_skill", func(_ *genericRunState, ev *emittedEvent) { ev.useSkillKey = "other_skill" }},
		{"wrong_use_source", func(_ *genericRunState, ev *emittedEvent) { ev.useSource = "target" }},
		{"wrong_cast", func(_ *genericRunState, ev *emittedEvent) { ev.castInstanceID++ }},
		{"missing_cast", func(_ *genericRunState, ev *emittedEvent) { ev.castInstanceID, ev.snapshot.castInstanceID = 0, 0 }},
		{"wrong_frozen_cast", func(_ *genericRunState, ev *emittedEvent) { ev.snapshot.castInstanceID++ }},
		{"wrong_frozen_use", func(_ *genericRunState, ev *emittedEvent) { ev.snapshot.useKey = "other_use" }},
		{"wrong_frozen_source", func(_ *genericRunState, ev *emittedEvent) { ev.snapshot.useSource = "target" }},
		{"wrong_frozen_skill", func(_ *genericRunState, ev *emittedEvent) { ev.snapshot.useSkillKey = "other_skill" }},
		{"wrong_process_owner", func(s *genericRunState, ev *emittedEvent) { s.skillUses[ev.useKey].plannedProcess.Owner = "target" }},
		{"wrong_mount", func(s *genericRunState, _ *emittedEvent) { s.skillAction.binding.ProviderRef = "other_mount" }},
		{"wrong_plan_binding", func(s *genericRunState, _ *emittedEvent) { s.skillAction.plan.BindingKey = "other_binding" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			c, r := finiteRecastInput(2, 1000)
			recastCounters(&c, &r, false)
			s := frameCommitState(t, c, r)
			if err := s.handleSkillAction(0); err != nil {
				t.Fatal(err)
			}
			p := s.processInstances[0]
			s.skillAction = s.skillUses[p.UseKey].plannedAction
			var f executionFrame
			s.initProcessFrame(&f, p)
			ev := emittedEvent{eventType: eventTypeAbilityStarted, ref: eventTypeAbilityStarted, sourceKey: p.Owner, targetKey: p.Target,
				hasUse: true, useKey: p.UseKey, useSource: p.Owner, useSkillKey: p.SkillKey, castInstanceID: p.castID, castOrigin: f.castOrigin,
				snapshot: f.captureEmitSnapshot(eventTypeAbilityStarted, p.Owner, p.Target)}
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

func TestOnCastOncePerUseRejectedControlsDoNotConsumeQuota(t *testing.T) {
	c, r := finiteRecastInput(2, 1000, 999, 1000, 1999, 2000, 2500)
	recastCounters(&c, &r, false)
	for i := 1; i <= 2; i++ {
		c.SharedProviders[0].Listeners[i].EventMatcher.All[0] = eventTypeAbilityStarted
	}
	d := timedShieldMustRun(t, c, r)
	if d.Summary.SkillActions.AcceptedCount != 3 || d.Summary.SkillActions.RejectedCount != 3 ||
		recastCounter(t, d, "casts") != 3 || recastCounter(t, d, "once") != 3 || len(d.FinalSnapshot.UseTriggerLedger) != 3 {
		t.Fatalf("early/exhausted controls must not start or consume a quota: %+v ledger=%+v", d.Summary, d.FinalSnapshot.UseTriggerLedger)
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
			d := s.buildDoneResult()
			if s.combatantHp(target) != 0 || recastCounter(t, d, "once") != 1 || len(d.FinalSnapshot.UseTriggerLedger) != 1 || s.useTriggerReserving != 0 {
				t.Fatalf("committed on-cast effect must retain its quota after death: hp=%v once=%v ledger=%+v pending=%d", s.combatantHp(target), recastCounter(t, d, "once"), d.FinalSnapshot.UseTriggerLedger, s.useTriggerReserving)
			}
		})
	}
}
