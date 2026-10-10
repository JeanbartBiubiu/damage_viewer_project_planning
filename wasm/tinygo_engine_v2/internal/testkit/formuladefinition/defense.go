package formuladefinition

import "tinygo_engine_v2/internal/model"

// ConstantDefense 是测试作者明确给出的完整共同定义，合法0保持0。
func ConstantDefense(value string) map[string]any {
	return map[string]any{"inputs": []any{}, "stages": []any{map[string]any{"key": "factor", "name": "明确倍率", "expression": defenseConst(value)}}, "outputStageKey": "factor"}
}

// ResistanceDefense 由作者明确选择属性，不根据伤害类型推断。
func ResistanceDefense(attributeKey string) map[string]any {
	return PenetrationDefense(attributeKey, "", "")
}

// PenetrationDefense 构造本场景的完整作者公式。空穿透键表示作者明确常量0。
// 属性原键由调用者提供；不读取样例、不查伤害类型、不补缺失属性值。
func PenetrationDefense(resistanceKey, percentKey, flatKey string) map[string]any {
	inputs := []any{defenseInput("resistance", "target", resistanceKey)}
	percent, flat := any(defenseConst("0")), any(defenseConst("0"))
	if percentKey != "" {
		inputs = append(inputs, defenseInput("percent", "source", percentKey))
		percent = map[string]any{"op": "clamp", "args": []any{defenseRead("percent"), defenseConst("0"), defenseConst("1")}}
	}
	if flatKey != "" {
		inputs = append(inputs, defenseInput("flat", "source", flatKey))
		flat = defenseBinary("max", defenseRead("flat"), defenseConst("0"))
	}
	effective := map[string]any{"op": "if", "args": []any{
		defenseBinary("gt", defenseRead("resistance"), defenseConst("0")),
		defenseBinary("max", defenseConst("0"), defenseBinary("sub", defenseBinary("mul", defenseRead("resistance"), defenseBinary("sub", defenseConst("1"), percent)), flat)),
		defenseRead("resistance"),
	}}
	factor := map[string]any{"op": "if", "args": []any{
		defenseBinary("gte", defenseRef("effective"), defenseConst("0")),
		defenseBinary("div", defenseConst("100"), defenseBinary("add", defenseConst("100"), defenseRef("effective"))),
		defenseBinary("sub", defenseConst("2"), defenseBinary("div", defenseConst("100"), defenseBinary("sub", defenseConst("100"), defenseRef("effective")))),
	}}
	return map[string]any{"inputs": inputs, "stages": []any{
		map[string]any{"key": "effective", "name": "作者有效属性", "expression": effective},
		map[string]any{"key": "factor", "name": "作者防御倍率", "expression": factor},
	}, "outputStageKey": "factor"}
}

// SetDamageFormula 只设置调用者明确传入的原键与定义；不扫描操作补默认值。
func SetDamageFormula(req *model.CompileRequest, key string, definition map[string]any) {
	for i := range req.Rules.DamageTypeFormulas {
		if req.Rules.DamageTypeFormulas[i].DamageType == key {
			req.Rules.DamageTypeFormulas[i].Formula = definition
			return
		}
	}
	req.Rules.DamageTypeFormulas = append(req.Rules.DamageTypeFormulas, model.DamageTypeFormulaDefinition{DamageType: key, Formula: definition})
}

func DeclareAttributes(req *model.CompileRequest, keys ...string) {
	for _, key := range keys {
		found := false
		for _, entry := range req.TypeCatalog.Types {
			if entry.Domain == "attribute" && entry.Key == key {
				found = true
				break
			}
		}
		if !found {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
		}
	}
}

func defenseConst(value string) map[string]any { return map[string]any{"op": "const", "value": value} }
func defenseRead(key string) map[string]any    { return map[string]any{"op": "read", "inputKey": key} }
func defenseRef(key string) map[string]any     { return map[string]any{"op": "ref", "stageKey": key} }
func defenseBinary(op string, a, b any) map[string]any {
	return map[string]any{"op": op, "args": []any{a, b}}
}
func defenseInput(key, object, attribute string) map[string]any {
	return map[string]any{"key": key, "binding": map[string]any{"kind": "attribute", "object": object, "attributeKey": attribute, "valueKind": "TOTAL", "view": "current_frame"}}
}
