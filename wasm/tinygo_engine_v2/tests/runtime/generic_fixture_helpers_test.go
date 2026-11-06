package runtime_test

import (
	"math"
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestEvidenceNumbersRejectMissingAndInvalidValues(t *testing.T) {
	if got := evidenceDataFloat(map[string]interface{}{"amount": float64(0)}, "amount"); got != 0 {
		t.Fatalf("explicit zero = %v", got)
	}
	for _, tc := range []struct {
		name string
		data map[string]interface{}
	}{
		{"missing", nil}, {"null", map[string]interface{}{"amount": nil}},
		{"text", map[string]interface{}{"amount": "0"}},
		{"nan", map[string]interface{}{"amount": math.NaN()}},
		{"infinite", map[string]interface{}{"amount": math.Inf(1)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("invalid numeric evidence silently became a usable value")
				}
			}()
			evidenceDataFloat(tc.data, "amount")
		})
	}
}

func TestCombatantFinalHPKeepsExplicitZero(t *testing.T) {
	snapshot := model.Snapshot{Combatants: []model.CombatantSnapshot{{Key: "target", Attributes: map[string]model.AttributeSlotDef{"hp": {Current: 0, Resolved: 900}}}}}
	if hp := combatantFinalHP(t, snapshot, "target"); hp != 0 {
		t.Fatalf("dead combatant current HP = %v, want 0", hp)
	}
}

func TestDamageModifierEvidenceRejectsMalformedItems(t *testing.T) {
	if len(damageEvidenceModifiers(nil)) != 0 || len(damageEvidenceModifiers(map[string]interface{}{"modifiers": []interface{}{}})) != 0 {
		t.Fatal("optional empty modifiers must remain empty")
	}
	for _, value := range []interface{}{true, []interface{}{nil}, []interface{}{"bad"}, []map[string]interface{}{nil}} {
		t.Run("invalid modifier", func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("invalid modifier was silently removed")
				}
			}()
			damageEvidenceModifiers(map[string]interface{}{"modifiers": value})
		})
	}
}

func TestNativeHitFactsKeepCompleteMountedIdentity(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		providers := []model.ProviderDefinition{
			{ProviderKey: "definition_a", Abilities: []model.AbilityDefinition{nativeHitAbility("hit", "skill_a", nil)}},
			{ProviderKey: "definition_b", Abilities: []model.AbilityDefinition{nativeHitAbility("hit", "skill_b", nil)}},
		}
		if reverse {
			providers[0], providers[1] = providers[1], providers[0]
		}
		input := model.CompileRequest{SharedProviders: providers, Combatants: []model.CombatantDefinition{
			{Key: "source", Providers: []model.CombatantProviderMount{{ProviderRef: "slot", DefinitionRef: "definition_a"}, {ProviderRef: "other", DefinitionRef: "definition_b"}}},
			{Key: "target", Providers: []model.CombatantProviderMount{{ProviderRef: "slot", DefinitionRef: "definition_b"}}},
		}}
		request := model.RunRequest{DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{
			{EntryKey: "a", AbilityRef: "source.provider[slot].ability[hit]", Source: "source", Target: "target"},
			{EntryKey: "b", AbilityRef: "target.provider[slot].ability[hit]", Source: "target", Target: "source"},
			{EntryKey: "c", AbilityRef: "source.provider[other].ability[hit]", Source: "source", Target: "target"},
		}}}
		bindFactsForBasicAttackResolves(&input, &request)
		if len(request.SkillHitFacts) != 3 || len(request.SkillUses) != 3 {
			t.Fatalf("unexpected fact count: %+v / %+v", request.SkillHitFacts, request.SkillUses)
		}
		for index, want := range []struct{ skill, source string }{{"skill_a", "source"}, {"skill_b", "target"}, {"skill_b", "source"}} {
			got := request.SkillUses[index]
			if got.SkillKey != want.skill || got.Source != want.source || request.SkillHitFacts[index].UseRef == nil || *request.SkillHitFacts[index].UseRef != got.UseKey {
				t.Fatalf("reverse=%v use %d lost mounted identity: %+v", reverse, index, request)
			}
		}
	}
}
