package runtime

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestPipelineDamageModifierUsesActualParticipants(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		for _, conditional := range []bool{false, true} {
			name := "forward"
			if reverse {
				name = "reverse"
			}
			if conditional {
				name += "_condition_and_value"
			} else {
				name += "_value"
			}
			t.Run(name, func(t *testing.T) {
				compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
				compileReq.SharedProviders[0].Abilities[0].Operations[0].Target = model.SelectorSource
				owner, other := model.SelectorSource, model.SelectorTarget
				if reverse {
					owner, other = other, owner
					compileReq.Combatants[1].Providers = append(compileReq.Combatants[1].Providers, compileReq.Combatants[0].Providers...)
					runReq.InitialSnapshot.Combatants[1].Providers = append(runReq.InitialSnapshot.Combatants[1].Providers, runReq.InitialSnapshot.Combatants[0].Providers...)
					runReq.DriverPlan.Entries[0].Source = owner
					runReq.DriverPlan.Entries[0].Target = other
				}
				setCombatantAttr(&compileReq, &runReq, owner, "hp", model.AttributeSlotDef{Base: 1000, Max: 1000, Resolved: 1000, Current: 399})
				setCombatantAttr(&compileReq, &runReq, other, "hp", model.AttributeSlotDef{Base: 1000, Max: 1000, Resolved: 1000, Current: 800})
				mod := magnificationModifier(1)
				mod.ValuePolicy = "override"
				mod.Value = model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"}
				if conditional {
					mod.Condition = &model.GenericFormulaExpr{Op: "lt", Args: []model.GenericFormulaExpr{
						{Op: "read", Path: "target.attr.hp.current"}, {Op: "const", Value: pipeFloat(400)},
					}}
				}
				mountPipelineProvider(&compileReq, &runReq, owner, pipeMagProviderRef, "actual_target", mod)
				done := runPipelineFixture(t, compileReq, runReq)
				data := firstOriginalDamage(t, done)
				if got := evidenceDataFloat(data, "rawAmount"); math.Abs(got-399) > 1e-9 {
					t.Fatalf("actual receiver hp must drive condition/value: raw=%v want 399; frame target hp=800", got)
				}
			})
		}
	}
}

func TestPipelineDamageSelfGate(t *testing.T) {
	for _, target := range []string{model.SelectorSource, model.SelectorTarget} {
		t.Run(target, func(t *testing.T) {
			compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
			compileReq.SharedProviders[0].Abilities[0].Operations[0].Target = target
			mod := magnificationModifier(1.08)
			mod.Condition = &model.GenericFormulaExpr{Op: "eq", Args: []model.GenericFormulaExpr{
				{Op: "read", Path: model.FormulaPathDamageSelf}, {Op: "const", Value: pipeFloat(0)},
			}}
			mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, pipeMagProviderRef, "self_gate", mod)
			done := runPipelineFixture(t, compileReq, runReq)
			want := float64(108)
			if target == model.SelectorSource {
				want = 100
			}
			if got := evidenceDataFloat(firstOriginalDamage(t, done), "rawAmount"); math.Abs(got-want) > 1e-9 {
				t.Fatalf("target=%s got=%v want=%v", target, got, want)
			}
		})
	}
}

func healthGateModifier(comparator string, threshold float64) model.ModifierDefinition {
	mod := magnificationModifier(1.08)
	mod.Condition = &model.GenericFormulaExpr{Op: "min", Args: []model.GenericFormulaExpr{
		{Op: "eq", Args: []model.GenericFormulaExpr{{Op: "read", Path: model.FormulaPathDamageSelf}, {Op: "const", Value: pipeFloat(0)}}},
		{Op: comparator, Args: []model.GenericFormulaExpr{
			{Op: "div", Args: []model.GenericFormulaExpr{{Op: "read", Path: "target.attr.hp.current"}, {Op: "read", Path: "target.attr.hp.max"}}},
			{Op: "const", Value: pipeFloat(threshold)},
		}},
	}}
	return mod
}

func TestPipelineHealthGateStrictBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, comparator    string
		threshold, hp, want float64
	}{
		{"low_399", "lt", .4, 399, 108}, {"low_400", "lt", .4, 400, 100}, {"low_401", "lt", .4, 401, 100},
		{"high_601", "gt", .6, 601, 108}, {"high_600", "gt", .6, 600, 100}, {"high_599", "gt", .6, 599, 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, r := loadPipelineDamageFixture(t, 100, 0)
			setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{Base: 1000, Max: 1000, Resolved: 1000, Current: tc.hp})
			mountPipelineProvider(&c, &r, model.SelectorSource, pipeMagProviderRef, "health_gate", healthGateModifier(tc.comparator, tc.threshold))
			done := runPipelineFixture(t, c, r)
			if got := evidenceDataFloat(firstOriginalDamage(t, done), "rawAmount"); math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("raw=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestPipelineHealthGateResamplesAfterRestore(t *testing.T) {
	for _, tc := range []struct {
		comparator                   string
		threshold, hp, first, second float64
	}{
		{"lt", .4, 401, 100, 108}, {"gt", .6, 601, 108, 100},
	} {
		t.Run(tc.comparator, func(t *testing.T) {
			c, r := loadPipelineDamageFixture(t, 100, 0)
			setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{Base: 1000, Max: 1000, Resolved: 1000, Current: tc.hp})
			mountPipelineProvider(&c, &r, model.SelectorSource, pipeMagProviderRef, "health_restore", healthGateModifier(tc.comparator, tc.threshold))
			compiled := compileMigrated(&c, &r)
			if !compiled.OK {
				t.Fatalf("compile: %+v", compiled.Result.Errors)
			}
			first, err := RunGeneric(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			if got := evidenceDataFloat(firstOriginalDamage(t, first), "rawAmount"); math.Abs(got-tc.first) > 1e-9 {
				t.Fatalf("first=%v want=%v", got, tc.first)
			}
			r.InitialSnapshot = first.FinalSnapshot
			r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "after_restore", AbilityRef: r.DriverPlan.Entries[0].AbilityRef,
				Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 200}}
			r.StopPolicy.DurationMs = 200
			second, err := RunGeneric(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			if got := evidenceDataFloat(firstOriginalDamage(t, second), "rawAmount"); math.Abs(got-tc.second) > 1e-9 {
				t.Fatalf("restored=%v want=%v", got, tc.second)
			}
			if got := second.Summary.TargetFinalHp; math.Abs(got-(tc.hp-tc.first-tc.second)) > 1e-9 {
				t.Fatalf("restored hp=%v", got)
			}
		})
	}
}

func TestPipelineDamageModifierRejectsMissingRead(t *testing.T) {
	for _, condition := range []bool{false, true} {
		name := "value"
		if condition {
			name = "condition"
		}
		t.Run(name, func(t *testing.T) {
			c, r := loadPipelineDamageFixture(t, 100, 0)
			mod := magnificationModifier(1.08)
			missing := model.GenericFormulaExpr{Op: "read", Path: "target.attr.missing_gate.current"}
			if condition {
				mod.Condition = &model.GenericFormulaExpr{Op: "lt", Args: []model.GenericFormulaExpr{missing, {Op: "const", Value: pipeFloat(.4)}}}
			} else {
				mod.Value = missing
			}
			mountPipelineProvider(&c, &r, model.SelectorSource, pipeMagProviderRef, "missing_read", mod)
			compiled := compileMigrated(&c, &r)
			if !compiled.OK {
				t.Fatalf("compile: %+v", compiled.Result.Errors)
			}
			_, err := RunGeneric(compiled.Session, r)
			if err == nil || !strings.Contains(err.Message, "missing_gate") {
				t.Fatalf("missing read must be explicit, not zero: %+v", err)
			}
		})
	}
}
