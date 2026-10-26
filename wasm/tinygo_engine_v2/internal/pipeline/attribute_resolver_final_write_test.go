package pipeline

import (
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestAttributeFinalWriteUnchangedResolvedDoesNotCopyPages(t *testing.T) {
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}},
	}}
	var resolver AttributeResolver
	resolver.MountCompiledModifierOwned("source", "item", planbundle.CompiledModifier{
		ModifierKey: "bonus", Kind: "attribute", Target: "attack", HasValue: true,
		ValuePolicy: "add", ValueProgram: 0,
	})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"attack": {Base: 100, Resolved: 110}, "hp": {Base: 1000, Current: 900, Resolved: 1000},
	})
	ctx := formula.GenericEvalContext{SourceAttrs: attrs, TargetAttrs: attrs}
	calls := 0
	provider := func(owner, ref string) ProviderFormulaContext {
		calls++
		return ProviderFormulaContext{HasProviderContext: true}
	}
	if allocations := testing.AllocsPerRun(100, func() {
		result, err := resolver.ResolveAttributesWithProviderContext(attrs, ctx, registry, provider)
		if err != nil || !result.Same(attrs) {
			t.Fatal("unchanged final values changed the published table", result, err)
		}
	}); allocations != 0 {
		t.Fatalf("unchanged final values allocated %v objects", allocations)
	}
	if calls != 101 {
		t.Fatalf("unchanged values skipped real modifier evaluation: calls=%d", calls)
	}
}

func TestAttributeFinalWriteKeepsNoValueResetAndSignedZero(t *testing.T) {
	var resolver AttributeResolver
	resolver.MountCompiledModifier("item", planbundle.CompiledModifier{
		ModifierKey: "empty", Kind: "attribute", Target: "declared", HasValue: false,
	})
	negative := math.Copysign(0, -1)
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"declared": {Base: negative, Resolved: 7}, "unmounted": {Base: 0, Resolved: negative},
	})
	result, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, formula.GenericRegistry{})
	if err != nil || math.Float64bits(result.At("declared").Resolved) != math.Float64bits(negative) || math.Float64bits(result.At("unmounted").Resolved) != 0 {
		t.Fatal("reset or signed zero changed", result.ToMap(), err)
	}
	if attrs.At("declared").Resolved != 7 || math.Float64bits(attrs.At("unmounted").Resolved) != math.Float64bits(negative) {
		t.Fatal("reset changed the input")
	}
}

func TestAttributeFinalWriteKeepsModifierOrderAndOriginalReads(t *testing.T) {
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "b.resolved"}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadTargetAttr, ReadKey: "a.resolved"}}},
	}}
	var resolver AttributeResolver
	for _, key := range []string{"b", "a"} {
		program := formula.GenericProgramID(0)
		if key == "b" {
			program = 1
		}
		resolver.MountCompiledModifierOwned("source", key, planbundle.CompiledModifier{
			ModifierKey: key, Kind: "attribute", Target: key, HasValue: true,
			ValuePolicy: "add", ValueProgram: program,
		})
	}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"a": {Base: 10, Resolved: 100}, "b": {Base: 20, Resolved: 200}})
	var order []string
	result, err := resolver.ResolveAttributesWithProviderContext(attrs,
		formula.GenericEvalContext{SourceAttrs: attrs, TargetAttrs: attrs, StrictReads: true}, registry,
		func(owner, ref string) ProviderFormulaContext {
			order = append(order, ref)
			return ProviderFormulaContext{}
		})
	if err != nil || result.At("a").Resolved != 210 || result.At("b").Resolved != 120 || !reflect.DeepEqual(order, []string{"a", "b"}) {
		t.Fatal("formula input or sorted callback order changed", result.ToMap(), order, err)
	}
}
