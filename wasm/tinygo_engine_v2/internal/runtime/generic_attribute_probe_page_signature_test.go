package runtime

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestAttributeProbePageSignaturesMatchFreshReads(t *testing.T) {
	layout := attribute.NewLayout([]string{"dep", "f0", "f1", "f2", "f3", "f4", "f5", "f6", "hp", "zz_unused"})
	source := attribute.FromMap(map[string]model.AttributeSlotDef{"dep": {Base: 2, Current: 3, Max: 4, Resolved: 0}, "hp": authoringSlot(100), "zz_unused": authoringSlot(1)}, layout)
	target := attribute.FromMap(map[string]model.AttributeSlotDef{"dep": authoringSlot(8), "hp": authoringSlot(200)}, layout)
	dep, hp := source.Index("dep"), source.Index("hp")
	reads := []attributeMemoRead{}
	for _, field := range []string{"base", "current", "max", "resolved", "presence"} {
		reads = append(reads, attributeMemoRead{kind: formula.ReadSourceAttr, key: "dep", field: memoReadField(field), attributeIndex: dep, attributeIndexBound: true})
	}
	reads = append(reads,
		attributeMemoRead{kind: formula.ReadTargetAttr, key: "dep", field: memoFieldResolved, attributeIndex: dep, attributeIndexBound: true},
		attributeMemoRead{kind: formula.ReadTargetAttr, key: "dep", field: memoFieldCurrent, attributeIndex: dep, attributeIndexBound: true, authoredTarget: true},
		attributeMemoRead{kind: formula.ReadSourceAttr, key: "hp", field: memoFieldCurrent, attributeIndex: hp, attributeIndexBound: true},
		attributeMemoRead{kind: formula.ReadProviderState, key: "count", providerIndex: 0},
	)
	memo := attributeMemo{cacheable: true, reads: reads, stamps: make([]attributeMemoStamp, len(reads)), scratch: make([]attributeMemoStamp, len(reads)), providers: []attributeMemoProvider{{"source", "buff"}}, providerValues: make([]attributeMemoProviderValues, 1)}
	ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: source, TargetAttrs: target}
	state := map[string]float64{"count": 2}
	calls := 0
	provider := func(_, _ string) pipeline.ProviderFormulaContext {
		calls++
		return pipeline.ProviderFormulaContext{HasProviderContext: true, ProviderState: state}
	}
	memo.probe(attribute.Table{}, &ctx, provider)
	memo.remember(attribute.Table{}, attribute.Table{}, true)
	reference := memo
	reference.scratch = append([]attributeMemoStamp(nil), memo.scratch...)
	reference.stamps = append([]attributeMemoStamp(nil), memo.stamps...)
	reference.providerValues = make([]attributeMemoProviderValues, 1)
	steps := []struct {
		name string
		edit func()
	}{
		{"unchanged", func() {}},
		{"unread_page", func() { ctx.SourceAttrs = ctx.SourceAttrs.With("zz_unused", authoringSlot(9)) }},
		{"unread_page_again", func() {}},
		{"hp_current", func() {
			slot := ctx.SourceAttrs.At("hp")
			slot.Current--
			ctx.SourceAttrs = ctx.SourceAttrs.With("hp", slot)
		}},
		{"provider_changed", func() { state["count"]++ }},
		{"repeat_failed_probe", func() {}},
		{"negative_zero", func() {
			slot := ctx.SourceAttrs.At("dep")
			slot.Resolved = math.Copysign(0, -1)
			ctx.SourceAttrs = ctx.SourceAttrs.With("dep", slot)
		}},
		{"non_strict", func() { ctx.StrictReads = false }},
		{"non_strict_again", func() {}},
		{"fallback_current", func() {
			slot := ctx.SourceAttrs.At("dep")
			slot.Current++
			ctx.SourceAttrs = ctx.SourceAttrs.With("dep", slot)
		}},
		{"target_changed", func() { ctx.TargetAttrs = ctx.TargetAttrs.With("dep", authoringSlot(10)) }},
		{"missing_field", func() {
			var slot model.AttributeSlotDef
			if err := json.Unmarshal([]byte(`{"current":0}`), &slot); err != nil {
				t.Fatal(err)
			}
			ctx.SourceAttrs = ctx.SourceAttrs.With("dep", slot)
		}},
		{"missing_field_again", func() {}},
		{"missing_slot", func() { ctx.SourceAttrs = ctx.SourceAttrs.Without("dep") }},
		{"missing_slot_again", func() {}},
		{"new_layout", func() {
			raw := ctx.SourceAttrs.ToMap()
			for index := 0; index < attribute.PageSize+1; index++ {
				raw[fmt.Sprintf("aaa_%02d", index)] = authoringSlot(99)
			}
			raw["dep"] = authoringSlot(12)
			ctx.SourceAttrs = attribute.FromMap(raw)
		}},
		{"wrong_bound_index_changed_dep", func() { ctx.SourceAttrs = ctx.SourceAttrs.With("dep", authoringSlot(14)) }},
	}
	for _, step := range steps {
		t.Run(step.name, func(t *testing.T) {
			step.edit()
			calls = 0
			got := memo.probe(attribute.Table{}, &ctx, provider)
			if calls != 1 {
				t.Fatalf("cached probe made %d provider calls", calls)
			}
			reference.probeValid = false
			want := reference.probe(attribute.Table{}, &ctx, provider)
			if calls != 2 || got != want || !reflect.DeepEqual(memo.scratch, reference.scratch) || !reflect.DeepEqual(memo.stamps, reference.stamps) {
				t.Fatalf("cached=%v fresh=%v scratch=%+v freshScratch=%+v", got, want, memo.scratch, reference.scratch)
			}
		})
	}
}

func TestAttributeProbeSameFailedPageDoesNotPublishSuccess(t *testing.T) {
	layout := attribute.NewLayout([]string{"dep", "speed"})
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "dep.current"}}}}}
	registry.BindAttributeLayout(layout)
	state := genericRunState{formulas: registry}
	var resolver pipeline.AttributeResolver
	resolver.MountCompiledModifierOwned("source", "buff", planbundle.CompiledModifier{Kind: "attribute", Target: "speed", HasValue: true, ValuePolicy: "add"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)}, layout)
	good := attribute.FromMap(map[string]model.AttributeSlotDef{"dep": authoringSlot(2)}, layout)
	ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: good}
	if _, err := state.resolveOrdinaryAttributes("source", attrs, resolver, ctx, nil); err != nil {
		t.Fatal(err)
	}
	ctx.SourceAttrs = good.Without("dep")
	for round := 0; round < 3; round++ {
		if _, err := state.resolveOrdinaryAttributes("source", attrs, resolver, ctx, nil); err == nil {
			t.Fatalf("failed dependency page became a successful cache at round %d", round)
		}
	}
	ctx.SourceAttrs = good
	if out, err := state.resolveOrdinaryAttributes("source", attrs, resolver, ctx, nil); err != nil || out.At("speed").Resolved != 102 {
		t.Fatal("recovery changed successful values", out, err)
	}
}
