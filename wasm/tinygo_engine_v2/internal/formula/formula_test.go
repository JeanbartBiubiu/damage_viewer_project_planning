// 本文件验证公式 bytecode 的属性、资源和基础算术读取能力。
package formula

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

type testAttrs []float64

func (attrs testAttrs) ReadAttr(index uint16, kind model.AttributeReadKind) (float64, bool) {
	if int(index) >= len(attrs) {
		return 0, false
	}
	return attrs[index], true
}

type testResources []model.ResourceValueV2

func (resources testResources) ReadResource(index uint16) (float64, float64, bool) {
	if int(index) >= len(resources) {
		return 0, 0, false
	}
	return resources[index].Current, resources[index].Max, true
}

func TestFormulaBytecode(t *testing.T) {
	reg, problems := CompileRegistry([]model.FormulaDefinition{
		{ID: "ad", Op: "attr", Attr: "attack_damage"},
		{ID: "two", Op: "const", Value: 2},
		{ID: "double_ad", Op: "mul", Left: "ad", Right: "two"},
	}, map[string]uint16{"attack_damage": 0}, nil)
	if len(problems) != 0 {
		t.Fatalf("compile problems: %v", problems)
	}
	id, ok := reg.Lookup("double_ad")
	if !ok {
		t.Fatal("formula missing")
	}
	got, err := reg.Eval(id, EvalContext{SourceAttrs: testAttrs{70}})
	if err != nil {
		t.Fatal(err)
	}
	if got != 140 {
		t.Fatalf("got %.2f, want 140", got)
	}
}

func TestFormulaReadsResource(t *testing.T) {
	reg, problems := CompileRegistry([]model.FormulaDefinition{
		{ID: "mana_now", Op: "resource", Resource: "mana"},
	}, nil, map[string]uint16{"mana": 0})
	if len(problems) != 0 {
		t.Fatalf("compile problems: %v", problems)
	}
	id, ok := reg.Lookup("mana_now")
	if !ok {
		t.Fatal("formula missing")
	}
	got, err := reg.Eval(id, EvalContext{Resources: testResources{{Current: 35, Max: 100}}})
	if err != nil {
		t.Fatal(err)
	}
	if got != 35 {
		t.Fatalf("got %.2f, want 35", got)
	}
}
