package compile_test

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	compiler "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	runner "tinygo_engine_v2/internal/runtime"
)

func healingProtocolNumber(value float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(value)}
}

func healingProtocolInput(t *testing.T, damage float64, miss, shield bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input := compiler.HealingHitRequestForTest()
	input.SharedProviders[0].Kind = "character"
	var fixture struct{ RunRequest model.RunRequest }
	raw, err := os.ReadFile("../testkit/fixtures/formula_phase4_explicit_basic_damage.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	run := fixture.RunRequest
	input.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = healingProtocolNumber(damage)
	hp := input.Combatants[1].Attributes["hp"]
	hp.Current = 500
	input.Combatants[1].Attributes["hp"] = hp
	run.InitialSnapshot.Combatants[1].Attributes["hp"] = hp
	for i, at := range []int64{100, 1000, 4500} {
		key := "synthetic:healer:" + []string{"before", "during", "after"}[i]
		input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{ProviderKey: key, StableID: key, Kind: "champion", Abilities: []model.AbilityDefinition{{AbilityKey: "heal", Kind: "tick", TickSpec: &model.TickSpec{IntervalMs: 10000, StartDelayMs: at, OnTick: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: healingProtocolNumber(100)}}}}}})
		input.Combatants[1].Providers = append(input.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: key, DefinitionRef: key})
		run.InitialSnapshot.Combatants[1].Providers = append(run.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: key, DefinitionRef: key, Source: "target", Owner: "target", Stacks: 1, State: map[string]interface{}{}})
	}
	if shield {
		input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{
			ProviderKey: "synthetic:spell_shield", StableID: "synthetic:spell_shield", Kind: "status", Types: []string{model.ProviderTypeSpellShield},
			Lifecycle: &model.ProviderLifecycle{DurationMs: healingProtocolNumber(5000), MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace},
			Listeners: []model.ListenerDefinition{{ListenerKey: "consume", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSpellShieldBlocked}}, Operations: []model.OperationDefinition{{Operation: "expire_provider", Target: "self", ProviderRefFromEvent: true}}}},
		})
		input.Combatants[1].Providers = append(input.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "synthetic:spell_shield", DefinitionRef: "synthetic:spell_shield"})
		run.InitialSnapshot.Combatants[1].Providers = append(run.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "synthetic:spell_shield", DefinitionRef: "synthetic:spell_shield", Source: "target", Owner: "target", Stacks: 1, State: map[string]interface{}{}})
	}
	binding := input.Rules.SkillActionBindings[0]
	preset := "TARGET_HIT"
	if miss {
		preset = "MISS"
	}
	run.DriverPlan.Entries = []model.DriverEntry{}
	run.DriverPlan.SkillActions = []model.SkillActionPlan{{InstructionKey: "cast_once", FirstAtMs: 0, Source: "source", Target: "target", SkillKey: binding.SkillKey, BindingKey: binding.BindingKey, Action: "INITIAL", AbilityRef: binding.Controls[0].AbilityRef, HitBindings: []model.SkillActionHitPreset{{HitBindingKey: "landing", Preset: preset}}}}
	run.StopPolicy.DurationMs = 4501
	run.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	return input, run
}

func runHealingProtocolTwice(t *testing.T, input model.CompileRequest, run model.RunRequest) model.DoneResult {
	t.Helper()
	compiled := compiler.CompileGeneric(input)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	first, err := runner.RunGeneric(compiled.Session, run)
	if err != nil {
		t.Fatal(err)
	}
	second, err := runner.RunGeneric(compiled.Session, run)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatalf("replay mismatch: %v", err)
	}
	return first
}

// These are native Generic protocol tests, not proof of a management-page
// initialization authoring path for the target's spell shield.
func TestFiniteHealingHitExistingRuntimeProtocol(t *testing.T) {
	for _, tc := range []struct {
		name            string
		damage          float64
		miss, shield    bool
		during, finalHP float64
		packets, blocks int
	}{
		{"hit", 100, false, false, 60, 660, 1, 0},
		{"zero_damage_still_applies", 0, false, false, 60, 760, 1, 0},
		{"miss", 100, true, false, 100, 800, 0, 0},
		{"initial_real_spell_shield", 100, false, true, 100, 800, 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input, run := healingProtocolInput(t, tc.damage, tc.miss, tc.shield)
			done := runHealingProtocolTwice(t, input, run)
			if len(done.HealingRecords) != 3 || len(done.DamageRecords) != tc.packets || done.FinalSnapshot.Combatants[1].Attributes["hp"].Current != tc.finalHP {
				t.Fatalf("heals=%+v damage=%+v hp=%v", done.HealingRecords, done.DamageRecords, done.FinalSnapshot.Combatants[1].Attributes["hp"].Current)
			}
			for i, wanted := range []float64{100, tc.during, 100} {
				heal := done.HealingRecords[i]
				if heal.TimeMs != []int64{100, 1000, 4500}[i] || heal.RawAmount != 100 || heal.HealingAfterModifiers != wanted || heal.ActualHealing != wanted || heal.Target != "target" || heal.Source != "target" {
					t.Fatalf("healing[%d]=%+v wanted=%v", i, heal, wanted)
				}
			}
			blocks := 0
			for _, item := range done.Evidence.Items {
				if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == model.EventTypeSpellShieldBlocked {
					blocks++
				}
			}
			if blocks != tc.blocks || done.Summary.SkillUses.StartedCount != 1 || done.Summary.SkillUses.ReleasedCount != 1 || done.Summary.SkillUses.CompletedCount != 1 {
				t.Fatalf("blocks=%d uses=%+v", blocks, done.Summary.SkillUses)
			}
			for _, provider := range done.FinalSnapshot.Combatants[1].Providers {
				if provider.DefinitionRef == "synthetic:wound" || provider.DefinitionRef == "synthetic:spell_shield" {
					t.Fatalf("effect or consumed shield unexpectedly survived: %+v", provider)
				}
			}
		})
	}
}

func TestFiniteHealingHitRefreshExistingDeadline(t *testing.T) {
	input, run := healingProtocolInput(t, 0, false, false)
	second := run.DriverPlan.SkillActions[0]
	second.InstructionKey, second.FirstAtMs = "refresh", 1000
	run.DriverPlan.SkillActions = append(run.DriverPlan.SkillActions, second)
	for i, at := range []int64{2000, 4500, 5500} {
		input.SharedProviders[2+i].Abilities[0].TickSpec.StartDelayMs = at
	}
	run.StopPolicy.DurationMs = 5501
	done := runHealingProtocolTwice(t, input, run)
	if len(done.HealingRecords) != 3 {
		t.Fatal(done.HealingRecords)
	}
	for i, wanted := range []float64{60, 60, 100} {
		if done.HealingRecords[i].ActualHealing != wanted {
			t.Fatalf("healing[%d]=%+v", i, done.HealingRecords[i])
		}
	}
	if done.FinalSnapshot.Combatants[1].Attributes["hp"].Current != 720 {
		t.Fatal(done.FinalSnapshot.Combatants[1])
	}
}
