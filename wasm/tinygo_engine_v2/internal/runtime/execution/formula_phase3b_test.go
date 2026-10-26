package execution

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
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
	done, err := runForTest(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if got := effectiveSlow(t, done); got.Strength != .2 || done.FinalSnapshot.Combatants[0].Attributes["armor"].Resolved != 80 {
		t.Fatal(got, done.FinalSnapshot)
	}
	r.InitialSnapshot = cloneSnapshot(done.FinalSnapshot)
	r.DriverPlan.Entries = nil
	r.StopPolicy.DurationMs = 100
	resumed, err := runForTest(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if got := effectiveSlow(t, resumed); got.Strength != .2 {
		t.Fatal("common value changed on snapshot restore", got)
	}
}
