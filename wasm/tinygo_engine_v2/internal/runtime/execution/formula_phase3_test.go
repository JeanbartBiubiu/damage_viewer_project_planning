package execution

import (
	model "tinygo_engine_v2/internal/model"
)

func phase3Const(value string) map[string]any { return map[string]any{"op": "const", "value": value} }

func phase3Read(key string) map[string]any { return map[string]any{"op": "read", "inputKey": key} }

func phase3Ref(key string) map[string]any { return map[string]any{"op": "ref", "stageKey": key} }

func phase3Binary(op string, a, b any) map[string]any {
	return map[string]any{"op": op, "args": []any{a, b}}
}

func phase3Stage(key string, expr any) map[string]any {
	return map[string]any{"key": key, "name": "共同结果", "expression": expr}
}

func phase3Input(key, object, attribute, valueKind string) map[string]any {
	return map[string]any{"key": key, "binding": map[string]any{"kind": "attribute", "object": object, "attributeKey": attribute, "valueKind": valueKind, "view": "current_frame"}}
}

func phase3Definition(inputs, stages []any, output string) map[string]any {
	if inputs == nil {
		inputs = []any{}
	}
	return map[string]any{"inputs": inputs, "stages": stages, "outputStageKey": output}
}

func phase3HeatDefinition(stages int) map[string]any {
	inputs := []any{phase3Input("defense", "target", "armor", "TOTAL")}
	if stages == 1 {
		return phase3Definition(inputs, []any{phase3Stage("factor", phase3Binary("div", phase3Const("100"), phase3Binary("add", phase3Const("100"), phase3Read("defense"))))}, "factor")
	}
	if stages == 2 {
		return phase3Definition(inputs, []any{phase3Stage("denominator", phase3Binary("add", phase3Const("100"), phase3Read("defense"))), phase3Stage("factor", phase3Binary("div", phase3Const("100"), phase3Ref("denominator")))}, "factor")
	}
	return phase3Definition(inputs, []any{
		phase3Stage("factor", phase3Ref("ratio")), phase3Stage("unused", phase3Binary("div", phase3Const("1"), phase3Const("0"))),
		phase3Stage("resistance", phase3Read("defense")), phase3Stage("denominator", phase3Binary("add", phase3Ref("resistance"), phase3Ref("hundred"))),
		phase3Stage("hundred", phase3Const("100")), phase3Stage("ratio", phase3Binary("div", phase3Ref("hundred"), phase3Ref("denominator"))),
	}, "factor")
}

// 独立输入：无通用基准样例读取或复制，也不代表真实管理数据。
func phase3HeatInput() (model.CompileRequest, model.RunRequest) {
	c := model.CompileRequest{SchemaVersion: model.GenericSchemaVersion, SchemaHash: "phase3-heat-schema", RulesHash: "phase3-heat-rules",
		TypeCatalog: model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "heat", Domain: "damage"}, {Key: "armor", Domain: "attribute"}}},
		Combatants: []model.CombatantDefinition{
			{Key: "source", Attributes: map[string]model.AttributeSlotDef{"armor": authoringSlot(0)}, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{{ProviderRef: "formula_heat", DefinitionRef: "formula_heat"}}},
			{Key: "target", Attributes: map[string]model.AttributeSlotDef{"hp": authoringSlot(1000), "armor": authoringSlot(50)}, Resources: map[string]model.ResourceSlotDef{}},
		},
		SharedProviders: []model.ProviderDefinition{{ProviderKey: "formula_heat", Kind: "champion", StableID: "formula_heat", Abilities: []model.AbilityDefinition{{AbilityKey: "heat_hit", Kind: "active", Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: authoringAmount(authoringConst(120)), DamageType: "heat"}}}}}},
	}
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "heat", Formula: phase3HeatDefinition(2)}}
	r := model.RunRequest{SessionID: "phase3-test", ExpectedRulesHash: c.RulesHash, InitialSnapshot: model.Snapshot{SchemaHash: c.SchemaHash, RulesHash: c.RulesHash, Combatants: []model.CombatantSnapshot{
		{Key: "source", Attributes: cloneAttributeMap(c.Combatants[0].Attributes), Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderSnapshot{{ProviderRef: "formula_heat", DefinitionRef: "formula_heat", Source: "source", Owner: "source", Stacks: 1}}},
		{Key: "target", Attributes: cloneAttributeMap(c.Combatants[1].Attributes), Resources: map[string]model.ResourceSlotDef{}, Shields: []model.CombatantShieldSnapshot{{ShieldRef: "heat_shield", Source: "target", Owner: "target", Remaining: 30}}},
	}}, DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "heat_once", AbilityRef: "source.provider[formula_heat].ability[heat_hit]", Source: "source", Target: "target"}}}, StopPolicy: model.StopPolicy{DurationMs: 100}, Sampling: model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 1000, MaxSeriesPoints: 8}}
	return c, r
}
