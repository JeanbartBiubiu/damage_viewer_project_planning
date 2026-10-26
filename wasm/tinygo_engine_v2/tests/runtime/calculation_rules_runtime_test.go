// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func calculationRuleInput() (model.CompileRequest, model.RunRequest) {
	c := model.CompileRequest{SchemaVersion: "generic-p0", SchemaHash: "calculation-rules", RulesHash: "calculation-rules",
		TypeCatalog:     model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "heat", Domain: "damage"}, {Key: "combatant/champion", Domain: "combatant"}}},
		SharedProviders: []model.ProviderDefinition{{ProviderKey: "probe", StableID: "probe", SkillKey: "probe", Kind: "generic", Abilities: []model.AbilityDefinition{{AbilityKey: "hit", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "heat", Amount: authoringAmount(authoringConst(100)), CritEligible: true, CritChance: authoringAmount(authoringRead("source.attr.hit_probability.resolved")), CritMultiplier: authoringAmount(authoringConst(2)), Ref: "explicit_hit"}}}}}},
		Rules:           model.RulesContainer{DamageTypeFormulas: []model.DamageTypeFormulaDefinition{{DamageType: "heat", Formula: formuladefinition.Definition(nil, []any{formuladefinition.Stage("factor", formuladefinition.Const(1))}, "factor")}}}}
	for _, key := range []string{"hp", "pulse", "force", "hit_probability"} {
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
	}
	for i, side := range []string{"source", "target"} {
		actor := model.CombatantDefinition{Key: side, Types: []string{"combatant/champion"}, Attributes: map[string]model.AttributeSlotDef{"hp": authoringSlot(1000), "pulse": authoringSlot(float64(i + 1)), "force": authoringSlot(10), "hit_probability": authoringSlot(.25)}, Resources: map[string]model.ResourceSlotDef{}}
		if i == 0 {
			actor.Providers = []model.CombatantProviderMount{{ProviderRef: "probe", DefinitionRef: "probe"}}
		}
		c.Combatants = append(c.Combatants, actor)
	}
	r := model.RunRequest{SessionID: "calculation", ExpectedRulesHash: c.RulesHash, InitialSnapshot: model.Snapshot{TimeMs: 0}, DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "hit", AbilityRef: "source.provider[probe].ability[hit]", Source: "source", Target: "target", FirstAtMs: 0}}}, StopPolicy: model.StopPolicy{DurationMs: 1, StopWhenNoEvents: model.BoolPtr(true), StopOnTargetDeath: model.BoolPtr(true)}}
	for _, actor := range c.Combatants {
		r.InitialSnapshot.Combatants = append(r.InitialSnapshot.Combatants, model.CombatantSnapshot{Key: actor.Key, Attributes: copyAttributeInput(actor.Attributes), Resources: map[string]model.ResourceSlotDef{}})
	}
	r.InitialSnapshot.Combatants[0].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "probe", DefinitionRef: "probe", Source: "source", Owner: "source", Stacks: 1}}
	return c, r
}

func TestCalculationCriticalExplicitBindingAndDeclaredMinimum(t *testing.T) {
	for _, scenario := range []struct {
		chance, multiplier float64
		minimum            *float64
		want               float64
	}{{.25, 2, nil, 125}, {0, 2, nil, 100}, {1, .5, nil, 50}, {1, .5, calculationNumber(0), 50}, {1, .5, calculationNumber(1), 100}, {1, .5, calculationNumber(2.5), 250}} {
		c, r := calculationRuleInput()
		op := &c.SharedProviders[0].Abilities[0].Operations[0]
		op.CritMultiplier = authoringAmount(authoringConst(scenario.multiplier))
		op.CritMultiplierMin = scenario.minimum
		c.Combatants[0].Attributes["hit_probability"] = authoringSlot(scenario.chance)
		r.InitialSnapshot.Combatants[0].Attributes["hit_probability"] = authoringSlot(scenario.chance)
		compiled := compilebundle.CompileGeneric(c)
		if !compiled.OK {
			t.Fatal(compiled.Result.Errors)
		}
		done, err := runtimeengine.RunGeneric(compiled.Session, r)
		if err != nil || math.Abs(done.Summary.SourceDamageDealt-scenario.want) > 1e-9 {
			t.Fatal(scenario, done.Summary, err)
		}
		again, err := runtimeengine.RunGeneric(compiled.Session, r)
		if err != nil || again.Summary.SourceDamageDealt != done.Summary.SourceDamageDealt {
			t.Fatal("repeat", err)
		}
	}
}

func TestCalculationCriticalMissingPairAndCorruptedProgramRejected(t *testing.T) {
	for _, field := range []string{"chance", "multiplier", "both"} {
		c, _ := calculationRuleInput()
		op := &c.SharedProviders[0].Abilities[0].Operations[0]
		if field != "multiplier" {
			op.CritChance = nil
		}
		if field != "chance" {
			op.CritMultiplier = nil
		}
		compiled := compilebundle.CompileGeneric(c)
		if compiled.OK {
			t.Fatal(field, "missing pair accepted")
		}
		found := false
		for _, issue := range compiled.Result.Errors {
			found = found || issue.Code == model.GenericErrMissingRequiredField
		}
		if !found {
			t.Fatal(compiled.Result.Errors)
		}
	}
	c, r := calculationRuleInput()
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	compiled.Session.Operations[0].CritChanceProgram = 0
	_, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err == nil || err.Code != model.GenericErrRuntimeInvariantFailed {
		t.Fatal("foreign program accepted", err)
	}
}

func TestCalculationGameFormulaUsesRealOwnerAndArbitraryOutput(t *testing.T) {
	c, r := calculationRuleInput()
	c.Formulas = []model.NamedFormula{{Scope: "game", Key: "pulse_to_force", Parameters: []model.FormulaParameter{}, Expression: formuladefinition.Definition([]any{map[string]any{"key": "pulse", "binding": map[string]any{"kind": "attribute", "object": "source", "attributeKey": "pulse", "valueKind": "TOTAL", "view": "current_frame"}}}, []any{formuladefinition.Stage("out", map[string]any{"op": "mul", "args": []any{map[string]any{"op": "read", "inputKey": "pulse"}, formuladefinition.Const(2)}})}, "out")}}
	for _, side := range []string{"source", "target"} {
		c.Rules.AttributeDerivations = append(c.Rules.AttributeDerivations, model.AttributeDerivationDefinition{CombatantKey: side, AttributeKey: "force", ValuePolicy: "set", ValueType: "DECIMAL", Value: model.GenericFormulaExpr{Op: "ref", Ref: "pulse_to_force"}})
	}
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	done, err := runtimeengine.RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if done.FinalSnapshot.Combatants[0].Attributes["force"].Resolved != 2 || done.FinalSnapshot.Combatants[1].Attributes["force"].Resolved != 4 {
		t.Fatal(done.FinalSnapshot)
	}
	c.Formulas[0].SkillKey = "forged"
	if compilebundle.CompileGeneric(c).OK {
		t.Fatal("game with skill accepted")
	}
}

func TestCalculationGenericOutputZeroNegativeIntegerAndLazyBranch(t *testing.T) {
	for _, scenario := range []struct {
		value    float64
		kind     string
		rejected bool
	}{{0, "DECIMAL", false}, {-3, "DECIMAL", false}, {3, "INTEGER", false}, {.5, "INTEGER", true}, {9007199254740992, "INTEGER", true}} {
		c, r := calculationRuleInput()
		c.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{CombatantKey: "source", AttributeKey: "force", ValuePolicy: "set", ValueType: scenario.kind, Value: authoringConst(scenario.value)}}
		compiled := compilebundle.CompileGeneric(c)
		if !compiled.OK {
			t.Fatal(compiled.Result.Errors)
		}
		done, err := runtimeengine.RunGeneric(compiled.Session, r)
		if scenario.rejected {
			if err == nil {
				t.Fatal("integer output accepted", scenario)
			}
			continue
		}
		if err != nil || done.FinalSnapshot.Combatants[0].Attributes["force"].Resolved != scenario.value {
			t.Fatal(scenario, err)
		}
	}
	c, r := calculationRuleInput()
	c.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{CombatantKey: "source", AttributeKey: "force", ValuePolicy: "set", ValueType: "DECIMAL", Value: model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(0), authoringBinary("div", authoringConst(1), authoringConst(0))}}}}
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	if _, err := runtimeengine.RunGeneric(compiled.Session, r); err != nil {
		t.Fatal("inactive branch evaluated", err)
	}
	c.Rules.AttributeDerivations[0].Value = authoringRead("source.attr.force.resolved")
	compiled = compilebundle.CompileGeneric(c)
	if compiled.OK {
		t.Fatal("self total allowed")
	}
	if !strings.Contains(compiled.Result.Errors[0].Message, "frozen base") {
		t.Fatal(compiled.Result.Errors)
	}
}

func calculationNumber(value float64) *float64 { return &value }

func plannedCalculationAttributeInput(selector, key, policy, actionTarget string) (model.CompileRequest, model.RunRequest) {
	c, r := singleSkillInput(actionTarget == "source")
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "force", Domain: "attribute"})
	for index := range c.Combatants {
		c.Combatants[index].Attributes["force"] = model.AttributeSlotDef{Base: 10, Resolved: 10}
	}
	if actionTarget == "source" {
		c.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"},
			Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: selector, AttributeKey: key, ValuePolicy: policy, Amount: authoringAmount(authoringConst(2))}}}}
		return c, r
	}
	semanticTarget := model.SkillHitTargetSOURCE
	if selector == "target" {
		semanticTarget = model.SkillHitTargetTARGET
	}
	if selector == "self" {
		semanticTarget = model.SkillHitTargetSELF
	}
	hit := c.SharedProviders[0].Abilities[1].Operations[0].SkillHit
	hit.Candidates = append(hit.Candidates, model.SkillHitCandidate{CandidateKey: "ordinary_change", EffectOccurrenceKey: "ordinary_change", EffectKey: "ordinary_change", ResultKey: "ordinary_change",
		Semantic:   model.SkillHitSemantic{ResultType: model.SkillHitResultAttributeChange, Target: semanticTarget, Moment: model.SkillHitMomentInstant},
		Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: selector, AttributeKey: key, ValuePolicy: policy, Amount: authoringAmount(authoringConst(2))}}})
	r.DriverPlan.SkillActions[0].Target = actionTarget
	return c, r
}

func TestCalculationPlannedAttributeRecipientAndClosedAdmission(t *testing.T) {
	for _, scenario := range []struct {
		selector, target       string
		wantSource, wantTarget float64
	}{{"source", "target", 12, 10}, {"self", "target", 12, 10}, {"target", "target", 10, 12}, {"target", "source", 12, 10}} {
		c, r := plannedCalculationAttributeInput(scenario.selector, "force", "add", scenario.target)
		if scenario.target == "source" {
			// 实际行动目标为自身；对手没有这个槽也不应误拒绝。
			delete(c.Combatants[1].Attributes, "force")
		}
		done, issue := runtimeengine.RunGeneric(authoringCompile(t, c), r)
		if issue != nil || done.FinalSnapshot.Combatants[0].Attributes["force"].Resolved != scenario.wantSource {
			t.Fatal("wrong actual action recipient", scenario, issue)
		}
		if scenario.target != "source" && done.FinalSnapshot.Combatants[1].Attributes["force"].Resolved != scenario.wantTarget {
			t.Fatal("wrong target recipient", scenario, done.FinalSnapshot)
		}
	}
	for _, invalid := range []string{"hp", "missing_slot", "empty_policy", "unknown_policy", "multiply_policy"} {
		c, r := plannedCalculationAttributeInput("source", "force", "add", "target")
		op := &c.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[1].Operations[0]
		switch invalid {
		case "hp":
			op.AttributeKey = "hp"
		case "missing_slot":
			delete(c.Combatants[0].Attributes, "force")
		case "empty_policy":
			op.ValuePolicy = ""
		case "unknown_policy":
			op.ValuePolicy = "unknown"
		case "multiply_policy":
			op.ValuePolicy = "multiply"
		}
		compiled := compilebundle.CompileGeneric(c)
		if compiled.OK {
			if _, issue := runtimeengine.RunGeneric(compiled.Session, r); issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed {
				t.Fatal("invalid planned attribute admitted", invalid, issue)
			}
		}
	}
}

func renamedCalculationSpeedInput() (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, 10000, 0, 0, 0, 4000)
	r.DriverPlan.BasicAttack.AttackSpeedAttributeKey = "tempo"
	r.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
	for index := range c.Combatants {
		if value, exists := c.Combatants[index].Attributes["attack_speed"]; exists {
			c.Combatants[index].Attributes["tempo"] = value
			delete(c.Combatants[index].Attributes, "attack_speed")
			r.InitialSnapshot.Combatants[index].Attributes["tempo"] = value
			delete(r.InitialSnapshot.Combatants[index].Attributes, "attack_speed")
		}
	}
	for index := range c.TypeCatalog.Types {
		if c.TypeCatalog.Types[index].Key == "attack_speed" && c.TypeCatalog.Types[index].Domain == "attribute" {
			c.TypeCatalog.Types[index].Key = "tempo"
		}
	}
	for _, named := range c.Formulas {
		definition := named.Expression.(map[string]any)
		for _, raw := range definition["inputs"].([]any) {
			binding := raw.(map[string]any)["binding"].(map[string]any)
			if binding["attributeKey"] == "attack_speed" {
				binding["attributeKey"] = "tempo"
			}
		}
	}
	return c, r
}
