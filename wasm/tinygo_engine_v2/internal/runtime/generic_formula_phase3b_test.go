package runtime

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func phase3BSkillInput() (model.CompileRequest, model.RunRequest) {
	c, r := phase3HeatInput()
	c.SharedProviders[0].SkillKey = "probe"
	c.SharedProviders[0].Abilities[0].SkillKey = "probe"
	c.Formulas = []model.NamedFormula{formuladefinition.FromExpr("first/grade1", "probe", authoringBinary("mul", authoringRead("ability.param.basis"), authoringConst(1.2)), map[string]float64{"basis": 100})}
	c.Formulas[0].Parameters[0].ValueMode = "SKILL_LEVEL"
	c.SharedProviders[0].Abilities[0].Operations[0].Amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: c.Formulas[0].Key})
	return c, r
}

func TestPhase3BSameSkillTwoInstancesGradesAndReverseSource(t *testing.T) {
	c, r := phase3BSkillInput()
	c.Formulas = append(c.Formulas, formuladefinition.FromExpr("second/grade2", "probe", authoringBinary("mul", authoringRead("ability.param.basis"), authoringConst(1.2)), map[string]float64{"basis": 200}))
	c.Formulas[1].Parameters[0].ValueMode = "SKILL_LEVEL"
	second := c.SharedProviders[0]
	second.ProviderKey = "second"
	second.Abilities = append([]model.AbilityDefinition(nil), second.Abilities...)
	second.Abilities[0].Operations = append([]model.OperationDefinition(nil), second.Abilities[0].Operations...)
	second.Abilities[0].Operations[0].Amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: c.Formulas[1].Key})
	c.SharedProviders = append(c.SharedProviders, second)
	c.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "second", DefinitionRef: "second"}}
	c.Combatants[0].Attributes["hp"] = authoringSlot(1000)
	c.Combatants[0].Attributes["armor"] = authoringSlot(50)
	r.InitialSnapshot.Combatants[0].Attributes = cloneAttributeMap(c.Combatants[0].Attributes)
	r.InitialSnapshot.Combatants[0].Shields = []model.CombatantShieldSnapshot{{ShieldRef: "s", Source: "source", Owner: "source", Remaining: 30}}
	r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "second", DefinitionRef: "second", Source: "target", Owner: "target", Stacks: 1}}
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "reverse", AbilityRef: "target.provider[second].ability[heat_hit]", Source: "target", Target: "source", FirstAtMs: 25})
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	if !reflect.DeepEqual(compiled.Result.Metadata.ApprovedStaticValues, map[string]float64{"first/grade1": 120, "second/grade2": 240}) {
		t.Fatal(compiled.Result.Metadata)
	}
	// 请求目录后来变化不能改写已注册程序。
	*c.Formulas[0].Parameters[0].Value = 999
	done, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.TargetFinalHp != 950 || done.Summary.SourceFinalHp != 870 || done.Summary.SourceDamageDealt != 80 || done.Summary.TargetDamageDealt != 160 {
		t.Fatal(done.Summary)
	}
}

func TestPhase3BCurrentFrameSeesPrecedingWriteAndReadOnlyPlan(t *testing.T) {
	c, r := phase3BSkillInput()
	c.Formulas = []model.NamedFormula{formuladefinition.FromExpr("read_current", "probe", authoringRead("source.attr.armor.resolved"), nil)}
	ability := &c.SharedProviders[0].Abilities[0]
	ability.Operations = []model.OperationDefinition{{Operation: "attribute_change", Target: "source", AttributeKey: "armor", ValuePolicy: "add", Amount: authoringAmount(authoringConst(120))}, {Operation: "damage", Target: "target", DamageType: "heat", Amount: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "read_current"})}}
	done := authoringRun(t, c, r)
	if done.Summary.TargetFinalHp != 950 || done.FinalSnapshot.Combatants[0].Attributes["armor"].Resolved != 120 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	// 合法0保持存在，重复运行不改写共同定义与参数目录。
	compiled := compile.CompileGeneric(c)
	before := *compiled.Session.Formulas.CloneForRun()
	r.InitialSnapshot.Combatants[0].Attributes["armor"] = authoringSlot(0)
	_, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, *compiled.Session.Formulas.CloneForRun()) {
		t.Fatal("run mutated common definition or binding")
	}
}

func TestPhase3BUnusedDeclarationIfLazinessMissingZeroAndSameSessionRetry(t *testing.T) {
	c, r := phase3BSkillInput()
	definition := formuladefinition.FromExpr("branch", "probe", model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringRead("source.attr.armor.resolved"), authoringRead("ability.param.runtime"), authoringConst(120)}}, nil)
	c.Formulas = []model.NamedFormula{definition}
	c.SharedProviders[0].Abilities[0].Operations[0].Amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "branch"})
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	if _, exists := compiled.Result.Metadata.ApprovedStaticValues["branch"]; exists {
		t.Fatal("dynamic reachable if branch was treated as static")
	}
	if len(compiled.Session.Formulas.ReadDependencies(compiled.Session.Formulas.Index["branch"])) != 2 {
		t.Fatal("if did not union all branch reads")
	}
	done, err := RunGeneric(compiled.Session, r)
	if err != nil || done.Summary.TargetFinalHp != 950 {
		t.Fatal(done.Summary, err)
	}
	r.InitialSnapshot.Combatants[0].Attributes["armor"] = authoringSlot(1)
	_, err = RunGeneric(compiled.Session, r)
	if err == nil || err.Code != "FORMULA_MISSING_INPUT" || !strings.HasSuffix(err.Path, "/args/1/inputKey") || err.Details["formulaKey"] != "branch" {
		t.Fatal(err)
	}
	r.InitialSnapshot.Combatants[0].Attributes["armor"] = authoringSlot(0)
	done, err = RunGeneric(compiled.Session, r)
	if err != nil || done.Summary.TargetFinalHp != 950 {
		t.Fatal(done.Summary, err)
	}
	// 未read的声明要授权，但不增加静态依赖与供值。
	def := c.Formulas[0].Expression.(map[string]any)
	def["stages"] = []any{phase3Stage("output", phase3Const("120")), phase3Stage("unused", phase3Binary("div", phase3Read("input1"), phase3Const("0")))}
	def["outputStageKey"] = "output"
	compiled = compile.CompileGeneric(c)
	if !compiled.OK || compiled.Result.Metadata.ApprovedStaticValues["branch"] != 120 {
		t.Fatal(compiled.Result.Errors, compiled.Result.Metadata)
	}
	if len(compiled.Session.Formulas.ReadDependencies(compiled.Session.Formulas.Index["branch"])) != 0 {
		t.Fatal("unused declarations became mandatory")
	}
}

func TestPhase3BResourceGateKeepsCommonErrorAndNativeFrameRetryRelease(t *testing.T) {
	c, r := phase3BSkillInput()
	c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 200, Max: 200}
	r.InitialSnapshot.Combatants[0].Resources["mana"] = c.Combatants[0].Resources["mana"]
	c.Formulas = append(c.Formulas, formuladefinition.FromExpr("gate", "probe", authoringBinary("div", authoringConst(60), authoringRead("source.attr.armor.resolved")), nil))
	c.SharedProviders[0].Abilities[0].Cost = &model.AbilityCost{ResourceKey: "mana", Amount: model.GenericFormulaExpr{Op: "ref", Ref: "gate"}}
	session := NewSession()
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, c)); code != 0 {
		t.Fatal(code, lastGenericError(session.OutboxBytes()))
	}
	compiled := lastGenericCompileResult(session.OutboxBytes())
	r.SessionID, r.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, r)); code == 0 {
		t.Fatal("division by zero swallowed as resource insufficient")
	}
	err := lastGenericError(session.OutboxBytes())
	if err.Code != "FORMULA_DIVISION_BY_ZERO" || !strings.HasSuffix(err.Path, "/expression") || err.Ref != r.DriverPlan.Entries[0].AbilityRef || err.Details["formulaKey"] != "gate" {
		t.Fatal(err)
	}
	r.InitialSnapshot.Combatants[0].Attributes["armor"] = authoringSlot(1)
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, r)); code != 0 {
		t.Fatal(code, lastGenericError(session.OutboxBytes()))
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if done.Summary.TargetFinalHp != 950 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 140 {
		t.Fatal(done)
	}
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, model.ReleaseSessionRequest{SessionID: r.SessionID, ExpectedRulesHash: r.ExpectedRulesHash})); code != 0 {
		t.Fatal(code)
	}
}

func TestPhase3BChargeAndActualCostUseCommittedOwnProcessScope(t *testing.T) {
	for _, failure := range []bool{false, true} {
		c, r := phase3BSkillInput()
		c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 200, Max: 200}
		r.InitialSnapshot.Combatants[0].Resources["mana"] = c.Combatants[0].Resources["mana"]
		charge := formuladefinition.FromExpr("charge", "probe", authoringRead("use.charge_duration_ms"), nil)
		cost := formuladefinition.FromExpr("actual", "probe", authoringRead("process.actual_cost.mana"), nil)
		c.Formulas = []model.NamedFormula{charge, cost, formuladefinition.Constant("cost", "probe", 60)}
		process := model.ProcessDefinition{ProcessKey: "p", SkillKey: "probe", Steps: []model.ProcessStepDefinition{{StepKey: "charge", StepType: "CHARGE", MinimumChargeMs: authoringAmount(authoringConst(100)), MaximumChargeMs: authoringAmount(authoringConst(500)), ReleaseAtMaximum: model.BoolPtr(false)}}, Costs: []model.ProcessCostDefinition{{ResourceKey: "mana", Amount: model.GenericFormulaExpr{Op: "ref", Ref: "cost"}}}, MomentOperations: []model.ProcessMomentOperations{{Moment: processMoment("STEP_EXECUTION", "charge", ""), Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "charge"}), DamageType: "heat"}}}, {Moment: processMoment("PROCESS_COMPLETE", "", ""), Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "actual"})}}}, {Moment: processMoment("PROCESS_FAILURE", "", ""), Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "actual"})}}}}}
		c.SharedProviders[0].Processes = []model.ProcessDefinition{process}
		c.SharedProviders[0].Abilities = []model.AbilityDefinition{{AbilityKey: "start", SkillKey: "probe", Kind: "active", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "p", Action: "INITIAL"}}, {AbilityKey: "release", SkillKey: "probe", Kind: "active", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "p", Action: "CHARGE_RELEASE", StepKey: "charge"}}, {AbilityKey: "cancel", SkillKey: "probe", Kind: "active", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "p", Action: "CANCEL", FailureReason: "ACTIVE_CANCELLED"}}}
		action := "release"
		if failure {
			action = "cancel"
		}
		r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "start", AbilityRef: "source.provider[formula_heat].ability[start]", Source: "source", Target: "target"}, {EntryKey: action, AbilityRef: "source.provider[formula_heat].ability[" + action + "]", Source: "source", Target: "target", FirstAtMs: 300}}
		r.ProcessCommandFacts = []model.ProcessCommandFact{{DriverEntryKey: "start", UseRef: "u"}, {DriverEntryKey: action, UseRef: "u"}}
		r.SkillUses = []model.SkillUseFact{{UseKey: "u", Source: "source", SkillKey: "probe", HistoryState: model.SkillHitHistoryComplete}}
		r.StopPolicy.DurationMs = 600
		done := authoringRun(t, c, r)
		if done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 200 || done.FinalSnapshot.ProcessInstances[0].ActualCosts["mana"] != 60 {
			t.Fatal(done.FinalSnapshot)
		}
		want := float64(830)
		if failure {
			want = 1000
		}
		if done.Summary.TargetFinalHp != want {
			t.Fatal(failure, done.Summary)
		}
	}
}

func TestPhase3BNativeInputRoundTripRetainsCommonDecimalAndStrictSlots(t *testing.T) {
	c, _ := phase3BSkillInput()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var copy model.CompileRequest
	if err = json.Unmarshal(raw, &copy); err != nil {
		t.Fatal(err)
	}
	if !compile.CompileGeneric(copy).OK {
		t.Fatal("common transport roundtrip failed")
	}
	var registry formula.GenericRegistry
	def := formuladefinition.FromExpr("zero", "probe", authoringRead("ability.param.zero"), map[string]float64{"zero": 0})
	formula.CompileDeclaredNamedFormulas([]model.NamedFormula{def}, nil, &registry, func(code model.GenericErrCode, path, message, ref string) { t.Fatal(code, path) })
	value, issue := registry.Eval(0, formula.GenericEvalContext{})
	if issue != nil || value != 0 || math.Signbit(value) {
		t.Fatal(value, issue)
	}
}

func TestPhase3BNoAbilityPermanentSourceUsesItsPrivateSelectedCatalog(t *testing.T) {
	c, r := sourceInitializationInput()
	r.DriverPlan.BasicAttack.AttackSpeedInputMax = 5
	c.Combatants[0].Attributes["attack_speed_ratio"] = authoringSlot(.5)
	c.Combatants[0].Attributes["bonus_attack_speed_percent"] = authoringSlot(0)
	r.InitialSnapshot.Combatants[0].Attributes["attack_speed_ratio"] = authoringSlot(.5)
	r.InitialSnapshot.Combatants[0].Attributes["bonus_attack_speed_percent"] = authoringSlot(0)
	c.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
	c.Formulas = append(c.Formulas, formuladefinition.FromExpr("permanent/grade", "permanent_skill", authoringBinary("add", authoringRead("ability.param.selected"), authoringConst(.05)), map[string]float64{"selected": .1}))
	addPermanentSkillSource(&c, &r, 0, "permanent", "character", model.ModifierDefinition{ModifierKey: "bonus", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "ref", Ref: "permanent/grade"}})
	for i := range c.SharedProviders {
		if c.SharedProviders[i].ProviderKey == "permanent" || c.SharedProviders[i].ProviderKey == "permanent_effect" {
			c.SharedProviders[i].SkillKey = "permanent_skill"
		}
	}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	if math.Abs(compiled.Result.Metadata.ApprovedStaticValues["permanent/grade"]-.15) > 1e-12 {
		t.Fatal(compiled.Result.Metadata)
	}
	done, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(done.FinalSnapshot.Combatants[0].Attributes["bonus_attack_speed_percent"].Resolved-.15) > 1e-12 {
		t.Fatal(done.FinalSnapshot)
	}
}

func TestPhase3BApplicationAttributeSnapshotRemainsFrozenAfterPriorWritesAndRestore(t *testing.T) {
	c, r := phase3BSkillInput()
	c.Formulas = []model.NamedFormula{formuladefinition.FromExpr("strength", "probe", authoringBinary("div", authoringRead("source.attr.armor.resolved"), authoringConst(100)), nil)}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "slow", SkillKey: "probe", Kind: "status", StableID: "slow", Lifecycle: &model.ProviderLifecycle{DurationMs: authoringAmount(authoringConst(500)), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: "source_target"}, StatusContributions: []model.StatusContributionDefinition{{ResultRef: "slow_result", StatusKey: "slow", StatusKind: model.StatusKindMovementSlow, Strength: model.GenericFormulaExpr{Op: "ref", Ref: "strength"}}}})
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "attribute_change", Target: "source", AttributeKey: "armor", ValuePolicy: "add", Amount: authoringAmount(authoringConst(20))}, {Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "slow"}, {Operation: "attribute_change", Target: "source", AttributeKey: "armor", ValuePolicy: "add", Amount: authoringAmount(authoringConst(60))}}
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	done, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if got := effectiveSlow(t, done); got.Strength != .2 || done.FinalSnapshot.Combatants[0].Attributes["armor"].Resolved != 80 {
		t.Fatal(got, done.FinalSnapshot)
	}
	r.InitialSnapshot = cloneSnapshot(done.FinalSnapshot)
	r.DriverPlan.Entries = nil
	r.StopPolicy.DurationMs = 100
	resumed, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if got := effectiveSlow(t, resumed); got.Strength != .2 {
		t.Fatal("common value changed on snapshot restore", got)
	}
}

func TestPhase3BCopiedDamageRetainsOriginalCommonAmountAcrossLaterAttributeWrite(t *testing.T) {
	c, r := authoringInput()
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "copy_power", Domain: "attribute"})
	c.Combatants[0].Attributes["copy_power"] = model.AttributeSlotDef{Base: 40, Current: 40, Resolved: 40, Max: 1000}
	r.InitialSnapshot.Combatants[0].Attributes["copy_power"] = c.Combatants[0].Attributes["copy_power"]
	c.Formulas = append(c.Formulas, formuladefinition.FromExpr("copy_value", "test_attack", authoringRead("source.attr.copy_power.resolved"), nil))
	c.SharedProviders[0].InitialStateSchema = map[string]any{"copy_count": float64(1)}
	c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: "copy_common", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}}, Operations: []model.OperationDefinition{
		{Operation: "damage", Target: "target", DamageType: "damage/physics", Amount: authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "copy_value"}), CopyableOnHit: true},
		{Operation: "attribute_change", Target: "source", AttributeKey: "copy_power", ValuePolicy: "add", Amount: authoringAmount(authoringConst(20))},
		{Operation: "repeat", RepeatScope: model.RepeatScopeCopyableOnHit, RepeatCount: 1, RepeatTag: "copy_common", RepeatDelayMs: 50, TriggerStateKey: "copy_count", Threshold: 1},
	}})
	done := authoringRun(t, c, r)
	if done.FinalSnapshot.Combatants[0].Attributes["copy_power"].Resolved != 60 {
		t.Fatal(done.FinalSnapshot)
	}
	copyCount := 0
	for _, e := range done.Evidence.Items {
		if e.Kind == "damage" && e.Data["phantom"] == true {
			copyCount++
			if evidenceDataFloat(e.Data, "rawAmount") != 40 || e.TimeMs != 75 {
				t.Fatal("copy re-evaluated common amount at later attribute view", e)
			}
		}
	}
	if copyCount != 1 {
		t.Fatal("expected one delayed copy", done.Evidence.Items)
	}
}
