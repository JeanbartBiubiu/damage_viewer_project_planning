package compile_test

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit"
)

func vampCompileFixture(t *testing.T) model.CompileRequest {
	t.Helper()
	f, err := testkit.LoadGenericFixture("generic_vamp_damage.json")
	if err != nil {
		t.Fatal(err)
	}
	return f.CompileRequest
}

func vampConst(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}
func vampOverride() model.VampOverrideDefinition {
	return model.VampOverrideDefinition{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampActualHPLoss, Efficiency: vampConst(1)}
}

func TestVampCompileRejectsUnresolvedAndMalformedConfiguration(t *testing.T) {
	tests := []struct {
		name, path string
		mutate     func(*model.CompileRequest)
	}{
		{"unresolved", "vampQualification", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations[0].VampQualification = model.VampUnresolved
		}},
		{"missing qualification", "vampQualification", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].Operations[0].VampQualification = "" }},
		{"unknown qualification", "vampQualification", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations[0].VampQualification = "MAYBE"
		}},
		{"missing game rules", "vampQualification", func(r *model.CompileRequest) { r.Rules.VampRules = nil }},
		{"missing default efficiency", "defaultEfficiency", func(r *model.CompileRequest) { r.Rules.VampRules[0].DefaultEfficiency = nil }},
		{"negative default efficiency", "defaultEfficiency", func(r *model.CompileRequest) { v := -1.0; r.Rules.VampRules[0].DefaultEfficiency = &v }},
		{"infinite default efficiency", "defaultEfficiency", func(r *model.CompileRequest) { v := math.Inf(1); r.Rules.VampRules[0].DefaultEfficiency = &v }},
		{"duplicate game type", "vampType", func(r *model.CompileRequest) { r.Rules.VampRules = append(r.Rules.VampRules, r.Rules.VampRules[0]) }},
		{"unknown game type", "vampType", func(r *model.CompileRequest) { r.Rules.VampRules[0].VampType = "MAGIC" }},
		{"unknown attribute", "sourceAttributeKey", func(r *model.CompileRequest) { r.Rules.VampRules[0].SourceAttributeKey = "absent" }},
		{"wrong target domain", "targetMatcher", func(r *model.CompileRequest) {
			r.Rules.VampRules[0].TargetMatcher = model.TypeMatcher{All: []string{"ability/common"}}
		}},
		{"wrong ability domain", "abilityMatcher", func(r *model.CompileRequest) {
			r.Rules.VampRules[0].AbilityMatcher = model.TypeMatcher{All: []string{"combatant/champion"}}
		}},
		{"wrong damage domain", "damageMatcher", func(r *model.CompileRequest) {
			r.Rules.VampRules[0].DamageMatcher = model.TypeMatcher{All: []string{"damage/physical"}}
		}},
		{"empty matcher", "targetMatcher", func(r *model.CompileRequest) { r.Rules.VampRules[0].TargetMatcher = model.TypeMatcher{} }},
		{"unknown matcher type", "targetMatcher", func(r *model.CompileRequest) {
			r.Rules.VampRules[0].TargetMatcher = model.TypeMatcher{All: []string{"combatant/absent"}}
		}},
		{"missing combatant classification", "combatants[0].types", func(r *model.CompileRequest) { r.Combatants[0].Types = nil }},
		{"missing ability classification", "abilities[0].types", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].Types = nil }},
		{"missing damage classification", "operations[0].types", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].Operations[0].Types = nil }},
		{"ambiguous damage classification", "operations[0].types", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations[0].Types = append(r.SharedProviders[0].Abilities[0].Operations[0].Types, "damage_trait/delivery_skill")
		}},
		{"disabled basis", "vampOverrides[0]", func(r *model.CompileRequest) {
			v := vampOverride()
			v.Mode = model.VampDisabled
			v.Efficiency = nil
			r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{v}
		}},
		{"disabled efficiency", "vampOverrides[0]", func(r *model.CompileRequest) {
			v := vampOverride()
			v.Mode = model.VampDisabled
			v.BasisOutputKind = ""
			r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{v}
		}},
		{"override missing basis", "basisOutputKind", func(r *model.CompileRequest) {
			v := vampOverride()
			v.BasisOutputKind = ""
			r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{v}
		}},
		{"override missing efficiency", "efficiency", func(r *model.CompileRequest) {
			v := vampOverride()
			v.Efficiency = nil
			r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{v}
		}},
		{"override missing rule", "vampOverrides[0].vampType", func(r *model.CompileRequest) {
			v := vampOverride()
			v.VampType = model.VampPhysical
			r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{v}
		}},
		{"duplicate override", "vampOverrides[1].vampType", func(r *model.CompileRequest) {
			v := vampOverride()
			r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{v, v}
		}},
		{"negative constant efficiency", "efficiency", func(r *model.CompileRequest) {
			v := vampOverride()
			v.Efficiency = vampConst(-1)
			r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{v}
		}},
		{"missing efficiency parameter", "efficiency", func(r *model.CompileRequest) {
			v := vampOverride()
			v.Efficiency = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.absent"}
			r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{v}
		}},
		{"heal fields on damage modifier", "modifiers[0]", func(r *model.CompileRequest) { r.SharedProviders[0].Modifiers[0].Command = "damage" }},
		{"heal missing direction", "healDirection", func(r *model.CompileRequest) { r.SharedProviders[0].Modifiers[0].HealDirection = "" }},
		{"heal missing group", "healGroupKey", func(r *model.CompileRequest) { r.SharedProviders[0].Modifiers[0].HealGroupKey = "" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := vampCompileFixture(t)
			tc.mutate(&r)
			result := compile.CompileGeneric(r)
			if result.OK {
				t.Fatal("malformed request compiled")
			}
			for _, e := range result.Result.Errors {
				if strings.Contains(e.Path, tc.path) {
					return
				}
			}
			t.Fatalf("missing path %q: %+v", tc.path, result.Result.Errors)
		})
	}
}

func TestVampCompilePreservesExplicitZeroAndFixedOrdering(t *testing.T) {
	r := vampCompileFixture(t)
	z := 0.0
	r.Rules.VampRules[0].DefaultEfficiency = &z
	r.SharedProviders[0].Abilities[0].Operations[0].VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampActualHPLoss, Efficiency: vampConst(0)}}
	result := compile.CompileGeneric(r)
	if !result.OK {
		t.Fatalf("zero rejected: %+v", result.Result.Errors)
	}
	if result.Session.VampRules[0].VampType != model.VampLifeSteal || result.Session.VampRules[1].DefaultEfficiency != 0 {
		t.Fatalf("wrong order/zero: %+v", result.Session.VampRules)
	}
}

func TestVampCompileBaselineStillHasNoImplicitRules(t *testing.T) {
	f, err := testkit.LoadGenericFixture("generic_p0_basic_damage.json")
	if err != nil {
		t.Fatal(err)
	}
	r := compile.CompileGeneric(f.CompileRequest)
	if !r.OK || len(r.Session.VampRules) != 0 {
		t.Fatalf("baseline changed: %+v", r.Result)
	}
}
