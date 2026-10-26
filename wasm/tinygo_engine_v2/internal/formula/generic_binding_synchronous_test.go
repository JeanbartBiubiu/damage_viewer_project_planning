package formula

import (
	"fmt"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestNamedBindingSynchronousSmallAndLargeInputs(t *testing.T) {
	for _, count := range []int{1, 8, 9, 64} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			var inputs []any
			var keys []string
			attrs := map[string]model.AttributeSlotDef{}
			var reads []any
			for i := 0; i < count; i++ {
				key := fmt.Sprintf("value%d", i)
				keys = append(keys, key)
				attrs[key] = model.AttributeSlotDef{Base: float64(i + 1), Resolved: float64(i + 1)}
				inputs = append(inputs, map[string]any{"key": key, "binding": map[string]any{"kind": "attribute", "object": "source", "attributeKey": key, "valueKind": "TOTAL", "view": "current_frame"}})
				read := map[string]any{"op": "read", "inputKey": key}
				reads = append(reads, read)
			}
			var sum func([]any) any
			sum = func(items []any) any {
				if len(items) == 1 {
					return items[0]
				}
				middle := len(items) / 2
				return map[string]any{"op": "add", "args": []any{sum(items[:middle]), sum(items[middle:])}}
			}
			expr := sum(reads)
			def := model.NamedFormula{Scope: "skill", Key: "sum", SkillKey: "hit", Parameters: []model.FormulaParameter{}, Expression: formuladefinition.Definition(inputs, []any{formuladefinition.Stage("out", expr)}, "out")}
			var registry GenericRegistry
			CompileDeclaredNamedFormulas([]model.NamedFormula{def}, keys, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p, m) })
			ctx := GenericEvalContext{SourceAttrs: attribute.FromMap(attrs)}
			want := float64(count * (count + 1) / 2)
			allocations := testing.AllocsPerRun(30, func() {
				got, err := registry.Eval(0, ctx)
				if err != nil || got != want {
					t.Fatal(got, err, want)
				}
			})
			if count <= 8 && allocations != 0 {
				t.Fatalf("small binding allocated %v", allocations)
			}
			ctx.SourceAttrs = ctx.SourceAttrs.With("value0", model.AttributeSlotDef{Base: 100, Resolved: 100})
			got, err := registry.Eval(0, ctx)
			if err != nil || got != want+99 {
				t.Fatal("stale borrowed inputs", got, err)
			}
		})
	}
}
