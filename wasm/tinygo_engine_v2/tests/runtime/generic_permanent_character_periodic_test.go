// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func permanentCharacterPeriodInput(ownerIndex int, background bool, hp float64, duration int64) (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(1, hp, 10, 0, 0, duration)
	periodicOpponentDefenseInputs(&input, &request)
	owner := input.Combatants[ownerIndex].Key
	definition := periodicEquipmentDefinition(5, 500, 500)
	definition.ProviderKey = owner + "_aura_definition"
	definition.StableID = owner + "_aura"
	definition.Kind = "character"
	definition.SkillKey = "test_periodic"
	input.SharedProviders = append(input.SharedProviders, definition)
	input.Combatants[ownerIndex].Providers = append(input.Combatants[ownerIndex].Providers,
		model.CombatantProviderMount{ProviderRef: owner + "_aura", DefinitionRef: definition.ProviderKey})
	request.InitialSnapshot.Combatants[ownerIndex].Providers = append(request.InitialSnapshot.Combatants[ownerIndex].Providers,
		model.CombatantProviderSnapshot{ProviderRef: owner + "_aura", DefinitionRef: definition.ProviderKey, Source: owner, Owner: owner, Stacks: 1})
	if !background {
		request.DriverPlan.BasicAttack = nil
		stopWhenNoEvents := false
		request.StopPolicy.StopWhenNoEvents = &stopWhenNoEvents
	}
	return input, request
}

func TestPermanentCharacterPeriodRejectsHiddenBehaviorAndRestoration(t *testing.T) {
	cases := []struct {
		name string
		edit func(*model.CompileRequest, *model.RunRequest)
	}{
		{"self damage", func(c *model.CompileRequest, _ *model.RunRequest) {
			c.SharedProviders[1].Abilities[0].TickSpec.OnTick[0].Target = "self"
		}},
		{"second damage", func(c *model.CompileRequest, _ *model.RunRequest) {
			tick := c.SharedProviders[1].Abilities[0].TickSpec
			tick.OnTick = append(tick.OnTick, tick.OnTick[0])
		}},
		{"different first delay", func(c *model.CompileRequest, _ *model.RunRequest) {
			c.SharedProviders[1].Abilities[0].TickSpec.StartDelayMs = 250
		}},
		{"conditional damage", func(c *model.CompileRequest, _ *model.RunRequest) {
			c.SharedProviders[1].Abilities[0].TickSpec.OnTick[0].Condition = authoringAmount(authoringConst(1))
		}},
		{"copyable on hit", func(c *model.CompileRequest, _ *model.RunRequest) {
			c.SharedProviders[1].Abilities[0].TickSpec.OnTick[0].CopyableOnHit = true
		}},
		{"second tick", func(c *model.CompileRequest, _ *model.RunRequest) {
			a := c.SharedProviders[1].Abilities[0]
			a.AbilityKey = "second_tick"
			c.SharedProviders[1].Abilities = append(c.SharedProviders[1].Abilities, a)
		}},
		{"wrong owner", func(_ *model.CompileRequest, r *model.RunRequest) {
			r.InitialSnapshot.Combatants[0].Providers[1].Owner = "target"
		}},
		{"restored time", func(_ *model.CompileRequest, r *model.RunRequest) {
			zero := int64(0)
			r.InitialSnapshot.Combatants[0].Providers[1].AppliedAtMs = &zero
		}},
		{"external use", func(_ *model.CompileRequest, r *model.RunRequest) {
			r.SkillUses = []model.SkillUseFact{{UseKey: "fake", Source: "source", SkillKey: "test_periodic"}}
		}},
		{"manual tick", func(_ *model.CompileRequest, r *model.RunRequest) {
			r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "fake_tick", AbilityRef: "source.provider[source_aura].ability[periodic]", Source: "source", Target: "target", FirstAtMs: 0}}
		}},
		{"manual self alias", func(_ *model.CompileRequest, r *model.RunRequest) {
			r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "fake_tick", AbilityRef: "self.provider[source_aura].ability[periodic]", Source: "source", Target: "target", FirstAtMs: 0}}
		}},
		{"manual opponent alias", func(_ *model.CompileRequest, r *model.RunRequest) {
			r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "fake_tick", AbilityRef: "opponent.provider[source_aura].ability[periodic]", Source: "target", Target: "source", FirstAtMs: 0}}
		}},
		{"ordinary cooldown operation alias", func(c *model.CompileRequest, _ *model.RunRequest) {
			m := &c.SharedProviders[0].Processes[0].MomentOperations[0]
			m.Operations = append(m.Operations, model.OperationDefinition{Operation: "cooldown_change", Target: "self",
				AbilityRef: "self.provider[source_aura].ability[periodic]", ValuePolicy: "reduce", Amount: authoringAmount(authoringConst(750))})
		}},
		{"dynamic application", func(c *model.CompileRequest, _ *model.RunRequest) {
			m := &c.SharedProviders[0].Processes[0].MomentOperations[0]
			m.Operations = append(m.Operations, model.OperationDefinition{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "source_aura_definition"})
		}},
		{"external listener", func(c *model.CompileRequest, _ *model.RunRequest) {
			c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: "enter_tick",
				EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackStart, "event/source_owner"}},
				AbilityRef:   "source.provider[source_aura].ability[periodic]"})
		}},
		{"external listener self alias", func(c *model.CompileRequest, _ *model.RunRequest) {
			c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: "enter_tick",
				EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackStart, "event/source_owner"}},
				AbilityRef:   "self.provider[source_aura].ability[periodic]"})
		}},
		{"death policy disabled", func(_ *model.CompileRequest, r *model.RunRequest) {
			v := false
			r.StopPolicy.StopOnTargetDeath = &v
		}},
	}
	for _, scenario := range cases {
		t.Run(scenario.name, func(t *testing.T) {
			input, request := permanentCharacterPeriodInput(0, false, 1000, 1100)
			scenario.edit(&input, &request)
			result := compile.CompileGeneric(input)
			if !result.OK {
				t.Fatalf("counterexample must reach the runtime gate: %+v", result.Result.Errors)
			}
			request.ExpectedRulesHash = result.Session.RulesHash
			if done, err := runtimeengine.RunGeneric(result.Session, request); err == nil {
				t.Fatal("unadmitted character period ran", done.Summary)
			}
		})
	}
}

func TestPermanentCharacterPeriodWrongSkillRejectedAtCompile(t *testing.T) {
	input, _ := permanentCharacterPeriodInput(0, false, 1000, 1100)
	input.SharedProviders[1].SkillKey = "other_skill"
	if result := compile.CompileGeneric(input); result.OK {
		t.Fatal("periodic ability escaped the existing provider/skill closure")
	}
}

func TestPermanentCharacterPeriodFirstDefinitionDoesNotCaptureUnrelatedCooldownReference(t *testing.T) {
	input, request := permanentCharacterPeriodInput(0, false, 1000, 1100)
	moment := &input.SharedProviders[0].Processes[0].MomentOperations[0]
	moment.Operations = append(moment.Operations, model.OperationDefinition{Operation: "cooldown_change", Target: "self",
		AbilityRef: authoringRef("initial"), ValuePolicy: "reduce", Amount: authoringAmount(authoringConst(750))})
	input.SharedProviders[0], input.SharedProviders[1] = input.SharedProviders[1], input.SharedProviders[0]
	done := authoringRun(t, input, request)
	if len(done.DamageRecords) != 2 || done.Summary.SourceDamageDealt != 10 || done.Summary.TargetFinalHp != 990 {
		t.Fatal(done.Summary, done.DamageRecords)
	}
}

func TestPermanentCharacterPeriodPreservesExistingNonDamageOwnerClock(t *testing.T) {
	input, request := permanentCharacterPeriodInput(1, false, 1000, 1300)
	tick := input.SharedProviders[1].Abilities[0].TickSpec
	tick.StartDelayMs, tick.IntervalMs = 1000, 100000
	tick.OnTick = []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "protocol_owner_effect", Ref: "protocol.owner_clock"}}
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: "protocol_owner_effect", Kind: "character", StableID: "protocol_owner_effect"})
	done := authoringRun(t, input, request)
	if len(done.DamageRecords) != 0 || done.FinalSnapshot.TimeMs != 1300 {
		t.Fatal(done.Summary, done.DamageRecords)
	}
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key != "target" {
			continue
		}
		for _, provider := range actor.Providers {
			if provider.DefinitionRef == "protocol_owner_effect" && provider.Owner == "target" && provider.Source == "target" {
				return
			}
		}
	}
	t.Fatal("the existing non-damage clock lost its actual owner target")
}

func TestPermanentCharacterPeriodWithoutAttackStopsAfterRealDeath(t *testing.T) {
	input, request := permanentCharacterPeriodInput(0, false, 4, 2000)
	done := authoringRun(t, input, request)
	if done.Summary.StopReason != model.StopReasonTargetDead || done.FinalSnapshot.TimeMs != 500 || len(done.DamageRecords) != 1 || done.Summary.TargetFinalHp != 0 {
		t.Fatal(done.Summary, done.DamageRecords, done.FinalSnapshot.TimeMs)
	}
}
