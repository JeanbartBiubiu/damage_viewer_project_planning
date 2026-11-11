package formula

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
	"unsafe"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestAttributeLayoutBoundZeroAndDifferentCatalogFallback(t *testing.T) {
	original := GenericProgram{Key: "zero_slot", Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: ReadSourceAttr, ReadKey: "alpha.current"}}}
	var registry programStore
	if _, err := registry.register(original); err != nil {
		t.Fatal(err)
	}
	layout := attribute.NewLayout([]string{"alpha", "zeta"})
	registry.bindAttributeLayout(layout)
	read := registry.programs[0].Instr[0]
	if !read.AttrIndexBound || read.AttrIndex != 0 || read.AttrKey != "alpha" || read.AttrField != "current" {
		t.Fatalf("slot zero was not bound explicitly: %+v", read)
	}
	if original.Instr[0].AttrIndexBound {
		t.Fatal("binding mutated the previously shared bytecode")
	}
	for _, attrs := range []attribute.Table{
		attribute.FromMap(map[string]model.AttributeSlotDef{"alpha": {Current: 7}}, layout),
		attribute.FromMap(map[string]model.AttributeSlotDef{"aaa": {Current: 100}, "alpha": {Current: 7}}),
	} {
		got, err := registry.evaluate(0, GenericEvalContext{SourceAttrs: attrs, StrictReads: true})
		if err != nil || got != 7 {
			t.Fatalf("catalog identity guard returned wrong slot: %v %v", got, err)
		}
	}
	if _, err := registry.register(original); err != nil {
		t.Fatalf("binding changed the logical registration identity: %v", err)
	}
	missing := attribute.FromMap(map[string]model.AttributeSlotDef{"zeta": {Current: 9}}, layout)
	if _, err := registry.evaluate(0, GenericEvalContext{SourceAttrs: missing, StrictReads: true}); err == nil || err.Error() != "missing attribute: alpha" {
		t.Fatalf("catalog slot was mistaken for a present attribute: %v", err)
	}
}

func TestAttributeLayoutExtraSlotAndRunRegistrationIsolation(t *testing.T) {
	var registry programStore
	if _, err := registry.register(GenericProgram{Key: "extra", Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: ReadTargetAttr, ReadKey: "bonus.current"}}}); err != nil {
		t.Fatal(err)
	}
	registry.bindAttributeLayout(attribute.NewLayout([]string{"alpha"}))
	if registry.programs[0].Instr[0].AttrIndexBound {
		t.Fatal("runtime-only slot must retain a key lookup")
	}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"alpha": {}, "bonus": {Current: 13}}, registry.attributeLayout)
	if got, err := registry.evaluate(0, GenericEvalContext{TargetAttrs: attrs, StrictReads: true}); err != nil || got != 13 {
		t.Fatal(got, err)
	}
	run := registry.isolatedStoreForTest()
	if _, err := run.register(GenericProgram{Key: "driver", Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: ReadSourceAttr, ReadKey: "alpha.base"}}}); err != nil {
		t.Fatal(err)
	}
	if !run.programs[1].Instr[0].AttrIndexBound || run.programs[1].Instr[0].AttrIndex != 0 || len(registry.programs) != 1 {
		t.Fatal("driver registration failed to bind or changed the compiled registry")
	}
	run.bindAttributeLayout(attribute.NewLayout([]string{"aaa", "alpha", "bonus"}))
	if run.programs[1].Instr[0].AttrIndex != 1 || registry.programs[0].Instr[0].AttrIndexBound {
		t.Fatal("run rebind wrote shared compiled instructions")
	}
}

func TestAttributeLayoutAllEventViewsAndStrictZero(t *testing.T) {
	for _, kind := range []GenericReadKind{ReadSourceAttr, ReadTargetAttr, ReadEventEntrySourceAttr, ReadEventEntryTargetAttr, ReadEventSourceAttr, ReadEventTargetAttr} {
		var registry programStore
		if _, err := registry.register(GenericProgram{Key: "zero", Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: kind, ReadKey: "zero.resolved"}}}); err != nil {
			t.Fatal(err)
		}
		layout := attribute.NewLayout([]string{"zero"})
		registry.bindAttributeLayout(layout)
		attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"zero": {Resolved: math.Copysign(0, -1), Current: 9}}, layout)
		ctx := GenericEvalContext{SourceAttrs: attrs, TargetAttrs: attrs, EventEntrySourceAttrs: attrs, EventEntryTargetAttrs: attrs, EventSourceAttrs: attrs, EventTargetAttrs: attrs, HasEventContext: true}
		value, err := registry.evaluate(0, ctx)
		if err != nil || value != 9 {
			t.Fatalf("legacy zero fallback changed for read kind %d: %v %v", kind, value, err)
		}
		ctx.StrictReads = true
		value, err = registry.evaluate(0, ctx)
		if err != nil || value != 0 || !math.Signbit(value) {
			t.Fatalf("strict negative zero changed for read kind %d: %v %v", kind, value, err)
		}
		if kind != ReadSourceAttr && kind != ReadTargetAttr {
			ctx.HasEventContext = false
			if _, err := registry.evaluate(0, ctx); err == nil || err.Error() != "event.* requires event context" {
				t.Fatalf("bound event read bypassed its context check: %v", err)
			}
		}
	}
}

func TestAttributeLayoutPreservesLegacySuffixAndStrictErrors(t *testing.T) {
	for _, key := range []string{"alpha", "alpha.current", "alpha.base", "alpha.max", "alpha.resolved", "alpha.other", "missing.current", "missing.other"} {
		for _, strict := range []bool{false, true} {
			var registry programStore
			if _, err := registry.register(GenericProgram{Key: key, Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: ReadSourceAttr, ReadKey: key}}}); err != nil {
				t.Fatal(err)
			}
			layout := attribute.NewLayout([]string{"alpha", "alpha.other", "missing.other"})
			attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"alpha": {Base: 2, Current: 3, Max: 5, Resolved: 0}, "alpha.other": {Resolved: 11}, "missing.other": {Resolved: 99}}, layout)
			ctx := GenericEvalContext{SourceAttrs: attrs, StrictReads: strict}
			before, beforeErr := registry.evaluate(0, ctx)
			registry.bindAttributeLayout(layout)
			after, afterErr := registry.evaluate(0, ctx)
			if math.Float64bits(before) != math.Float64bits(after) || (beforeErr == nil) != (afterErr == nil) || (beforeErr != nil && beforeErr.Error() != afterErr.Error()) {
				t.Fatalf("key=%s strict=%t before=%v/%v after=%v/%v", key, strict, before, beforeErr, after, afterErr)
			}
		}
	}
}

func TestAttributeLayoutNamedBindingActorContextPresenceAndRebind(t *testing.T) {
	definition := formuladefinition.FromExpr("actors", "skill", model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{{Op: "read", Path: "source.attr.value.current"}, {Op: "read", Path: "target.attr.value.current"}}}, nil)
	var registry programStore
	compileDeclaredNamedFormulas([]model.NamedFormula{definition}, []string{"value"}, &registry, func(c model.GenericErrCode, p, m, r string) { t.Fatal(c, p, m) })
	before := registry.programs[0]
	oldBinding := before.NamedBinding
	oldBytes := registry.memoryBytes
	layout := attribute.NewLayout([]string{"value"})
	registry.bindAttributeLayout(layout)
	bound := registry.programs[0].NamedBinding
	if bound == oldBinding || oldBinding.attributeInputs[0].bound || !bound.attributeInputs[0].bound || bound.attributeInputs[0].index != 0 {
		t.Fatal("named input binding changed a shared descriptor or lost slot zero")
	}
	if oldBytes != registry.memoryBytes {
		t.Fatal("directory binding introduced unaccounted retained formula memory")
	}
	if _, err := registry.register(before); err != nil {
		t.Fatalf("named binding changed logical registration identity: %v", err)
	}
	slot := func(current float64) attribute.Table {
		return attribute.FromMap(map[string]model.AttributeSlotDef{"value": {Current: current}}, layout)
	}
	ctx := GenericEvalContext{SourceAttrs: slot(1), TargetAttrs: slot(2), AuthoredSourceAttrs: slot(3), AuthoredTargetAttrs: slot(4), HasAuthoredActorContext: true}
	if got, err := registry.evaluate(0, ctx); err != nil || got != 7 {
		t.Fatal("authored actor direction changed", got, err)
	}
	run := registry.isolatedStoreForTest()
	run.bindAttributeLayout(attribute.NewLayout([]string{"aaa", "value"}))
	if registry.programs[0].NamedBinding.attributeInputs[0].index != 0 || run.programs[0].NamedBinding.attributeInputs[0].index != 1 || &run.programs[0].NamedBinding.dependencies[0] == &registry.programs[0].NamedBinding.dependencies[0] {
		t.Fatal("run rebind mutated named input or dependency descriptors")
	}
	if got, err := run.evaluate(0, ctx); err != nil || got != 7 {
		t.Fatal("named binding did not guard a different table directory", got, err)
	}
	var partial model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"base":1,"resolved":2}`), &partial); err != nil {
		t.Fatal(err)
	}
	ctx.AuthoredTargetAttrs = ctx.AuthoredTargetAttrs.With("value", partial)
	_, boundErr := registry.evaluate(0, ctx)
	_, unboundErr := (programStore{programs: []GenericProgram{before}}).evaluate(0, ctx)
	if boundErr == nil || unboundErr == nil || boundErr.Error() != unboundErr.Error() {
		t.Fatal("missing authored current field changed", boundErr, unboundErr)
	}
	reads, supported := registry.attributeCacheDependencies(0)
	if !supported || len(reads) != 4 || !reads[0].AttrIndexBound || reads[0].AttrField != "presence" {
		t.Fatalf("cache dependencies lost their immutable binding: %+v supported=%t", reads, supported)
	}
	if !reflect.DeepEqual(oldBinding.dependencies, before.NamedBinding.dependencies) {
		t.Fatal("old named binding dependencies changed")
	}
}

func TestAttributeLayoutInstructionBindingStorageIsBudgeted(t *testing.T) {
	program := GenericProgram{Key: "index", Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: ReadSourceAttr, ReadKey: "hp.current"}}}
	want := uint64(unsafe.Sizeof(GenericProgram{})) + uint64(unsafe.Sizeof(GenericInstr{})) + uint64(len(program.Key)+len(program.Instr[0].ReadKey))
	before, err := genericProgramMemoryBytes(program)
	bound := bindProgramAttributes(program, attribute.NewLayout([]string{"hp"}))
	after, boundErr := genericProgramMemoryBytes(bound)
	if err != nil || boundErr != nil || before != want || after != want {
		t.Fatalf("bound instruction storage escaped budget: before=%d after=%d want=%d errors=%v/%v", before, after, want, err, boundErr)
	}
}
