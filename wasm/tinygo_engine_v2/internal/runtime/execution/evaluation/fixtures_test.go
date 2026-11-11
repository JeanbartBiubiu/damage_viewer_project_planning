package evaluation

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// attributeFixture 只组合本场求值缓存与显式只读输入，不建立战斗执行器或循环。
type attributeFixture struct {
	cache    State
	formulas formula.Library
	compiled planbundle.CompiledSession
}

func authoringSlot(v float64) model.AttributeSlotDef {
	return model.AttributeSlotDef{Base: v, Current: v, Max: v, Resolved: v}
}
func authoringRead(path string) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "read", Path: path}
}
func independentAttributeTable(t attribute.Table) attribute.Table {
	return attribute.FromMap(t.ToMap(), t.Layout())
}
