package runtime

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
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
		r.InitialSnapshot.Combatants = append(r.InitialSnapshot.Combatants, model.CombatantSnapshot{Key: actor.Key, Attributes: cloneAttributeMap(actor.Attributes), Resources: map[string]model.ResourceSlotDef{}})
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
		done, err := RunGeneric(compiled.Session, r)
		if err != nil || math.Abs(done.Summary.SourceDamageDealt-scenario.want) > 1e-9 {
			t.Fatal(scenario, done.Summary, err)
		}
		again, err := RunGeneric(compiled.Session, r)
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
	_, err := RunGeneric(compiled.Session, r)
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
	done, err := RunGeneric(compiled.Session, r)
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
		done, err := RunGeneric(compiled.Session, r)
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
	if _, err := RunGeneric(compiled.Session, r); err != nil {
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
		done, issue := RunGeneric(authoringCompile(t, c), r)
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
			if _, issue := RunGeneric(compiled.Session, r); issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed {
				t.Fatal("invalid planned attribute admitted", invalid, issue)
			}
		}
	}
}

func TestCalculationAttributeBaseOverflowRejectsBeforeClampAndFrameCommit(t *testing.T) {
	for _, maximum := range []float64{0, 1e308} {
		c, r := calculationRuleInput()
		slot := model.AttributeSlotDef{Base: 1e308, Current: 1e308, Max: maximum, Resolved: 1e308}
		c.Combatants[0].Attributes["force"] = slot
		r.InitialSnapshot.Combatants[0].Attributes["force"] = slot
		c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
			{Operation: "shield", Target: "target", ShieldRef: "uncommitted_guard", Amount: authoringAmount(authoringConst(50))},
			{Operation: "attribute_change", Target: "source", AttributeKey: "force", ValuePolicy: "add", Amount: authoringAmount(authoringConst(1e308))},
		}
		state, issue := newGenericRunState(authoringCompile(t, c), r)
		if issue != nil {
			t.Fatal(issue)
		}
		issue = state.runLoop()
		if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != "combatants.source.attributes.force.base" {
			t.Fatal("nonfinite attribute accepted or silently clamped", maximum, issue)
		}
		if state.combatants["source"].attributes.At("force").Base != 1e308 || len(state.combatants["target"].shields) != 0 {
			t.Fatal("attribute overflow committed partial frame")
		}
		if _, issue := json.Marshal(state.evidence); issue != nil {
			t.Fatal(issue)
		}
	}
}

func TestCalculationCriticalAmountOverflowRejectsBeforeCommitAndSessionRecovers(t *testing.T) {
	for _, evidenceLimit := range []int{0, 1000} {
		c, r := calculationRuleInput()
		op := c.SharedProviders[0].Abilities[0].Operations[0]
		op.CritMultiplierMin = calculationNumber(1e308)
		c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
			{Operation: "shield", Target: "target", ShieldRef: "uncommitted_guard", Amount: authoringAmount(authoringConst(50))}, op,
		}
		c.Combatants[0].Attributes["hit_probability"] = authoringSlot(1)
		r.InitialSnapshot.Combatants[0].Attributes["hit_probability"] = authoringSlot(1)
		compiled := authoringCompile(t, c)
		state, issue := newGenericRunState(compiled, r)
		if issue != nil {
			t.Fatal(issue)
		}
		state.budget.MaxEvidenceItems = evidenceLimit
		issue = state.runLoop()
		if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != "sharedProviders[0].abilities[0].operations[1].critMultiplier" {
			t.Fatal("critical amount overflow accepted", issue)
		}
		if state.combatants["target"].attributes.At("hp").Current != 1000 || len(state.combatants["target"].shields) != 0 || state.sourceDamageDealt != 0 || len(state.damageHistory) != 0 {
			t.Fatal("critical overflow committed frame", evidenceLimit)
		}
		if _, err := json.Marshal(state.evidence); err != nil {
			t.Fatal("nonfinite evidence escaped", err)
		}
		for repeat := 0; repeat < 2; repeat++ {
			if _, issue := RunGeneric(compiled, r); issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed {
				t.Fatal("repeated overflow did not fail", issue)
			}
		}
		// 使用同一已编译会话，明确概率0时大下限没有有效分支贡献。
		r.InitialSnapshot.Combatants[0].Attributes["hit_probability"] = authoringSlot(0)
		for repeat := 0; repeat < 2; repeat++ {
			done, issue := RunGeneric(compiled, r)
			if issue != nil || done.Summary.SourceDamageDealt != 100 || done.Summary.TargetFinalHp != 950 {
				t.Fatal("session did not recover after critical overflow", done.Summary, issue)
			}
			if _, err := json.Marshal(done); err != nil {
				t.Fatal("recovered result not serializable", err)
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

func TestCalculationRenamedSpeedKeepsWaitingProgressAndUniqueNode(t *testing.T) {
	c, r := renamedCalculationSpeedInput()
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := state.heap.Pop(); !exists {
		t.Fatal("missing first attack")
	}
	if err := state.handleBasicAttack(); err != nil {
		t.Fatal(err)
	}
	state.nowMs = 400
	frame := state.newExecutionFrame("source", "target", "renamed-speed")
	staged := frame.stageFor("source")
	slot := staged.attributes.At("tempo")
	slot.Base, slot.Resolved = 2, 2
	staged.attributes = staged.attributes.With("tempo", slot)
	frame.commit()
	if frame.fatal || state.basicAttack.wait.ready != 700 || state.basicAttack.wait.remaining != .6 || state.heap.Len() != 1 {
		t.Fatal(frame.fatalErr, state.basicAttack.wait, state.heap.Len())
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if state.attackRecords[1].StartAtMs != 700 {
		t.Fatal(state.attackRecords)
	}
}

func TestCalculationFirstSpeedInvalidFrameDoesNotCommitAttributesOrClock(t *testing.T) {
	for _, invalid := range []float64{0, -1, 11} {
		c, r := renamedCalculationSpeedInput()
		state, err := newGenericRunState(authoringCompile(t, c), r)
		if err != nil {
			t.Fatal(err)
		}
		if state.basicAttack.wait != nil {
			t.Fatal("unexpected prior wait")
		}
		count := state.heap.Len()
		frame := state.newExecutionFrame("source", "target", "invalid-initial-speed")
		staged := frame.stageFor("source")
		slot := staged.attributes.At("tempo")
		slot.Base, slot.Resolved = invalid, invalid
		staged.attributes = staged.attributes.With("tempo", slot)
		hp := staged.attributes.At("hp")
		hp.Current -= 10
		staged.attributes = staged.attributes.With("hp", hp)
		frame.commit()
		if !frame.fatal || state.combatants["source"].attributes.At("tempo").Resolved != 1 || state.combatants["source"].attributes.At("hp").Current != c.Combatants[0].Attributes["hp"].Current || state.heap.Len() != count || state.basicAttack.wait != nil {
			t.Fatal(invalid, frame.fatalErr, state.combatants["source"].attributes, state.heap.Len())
		}
	}
}
