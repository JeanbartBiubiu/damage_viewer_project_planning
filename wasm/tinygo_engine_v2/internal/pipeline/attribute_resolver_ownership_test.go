package pipeline

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
	"tinygo_engine_v2/internal/attribute"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func independentPipelineAttributes(t attribute.Table) attribute.Table {
	return attribute.FromMap(t.ToMap(), t.Layout())
}

func TestAttributeResolverReturnedSnapshotIsIndependent(t *testing.T) {
	for _, modified := range []bool{false, true} {
		t.Run(fmt.Sprintf("modified=%t", modified), func(t *testing.T) {
			var resolver AttributeResolver
			registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}},
			}}
			if modified {
				resolver.MountCompiledModifier("item", planbundle.CompiledModifier{
					ModifierKey: "bonus", Target: "attack", ValuePolicy: "add", HasValue: true,
				})
			}
			attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
				"attack": {Base: 100, Current: 90, Max: 120, Resolved: 100},
				"hp":     {Base: 1000, Current: 900, Max: 1000, Resolved: 777},
			})
			before := independentPipelineAttributes(attrs)
			out, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{SourceAttrs: attrs}, registry)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(attrs, before) {
				t.Fatalf("input changed: got %+v want %+v", attrs, before)
			}
			wantAttack := before.At("attack")
			if modified {
				wantAttack.Resolved = 110
			}
			wantHP := before.At("hp")
			wantHP.Resolved = wantHP.Base
			if out.At("attack") != wantAttack || out.At("hp") != wantHP {
				t.Fatalf("unexpected resolved snapshot: %+v", out)
			}
			out = out.With("attack", model.AttributeSlotDef{Base: -1})
			if attrs.At("attack") != before.At("attack") {
				t.Fatal("output write changed input snapshot")
			}
			attrs = attrs.With("hp", model.AttributeSlotDef{Base: -2})
			if out.At("hp") != wantHP {
				t.Fatal("input write changed returned snapshot")
			}
		})
	}
}

func TestAttributeResolverPreservesOldFormulaReads(t *testing.T) {
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}},
		{Instr: []formula.GenericInstr{
			{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "a_unmodified.resolved"},
			{Op: formula.GenericOpRead, ReadKind: formula.ReadTargetAttr, ReadKey: "b_first.resolved"},
			{Op: formula.GenericOpAdd},
		}},
	}}
	var resolver AttributeResolver
	resolver.MountCompiledModifier("item", planbundle.CompiledModifier{
		ModifierKey: "dependent", Target: "c_dependent", ValuePolicy: "add", ValueProgram: 1, HasValue: true,
	})
	resolver.MountCompiledModifier("item", planbundle.CompiledModifier{
		ModifierKey: "multiply", Target: "b_first", ValuePolicy: "multiply", ValueProgram: 0, HasValue: true,
	})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
		"a_unmodified": {Base: 10, Current: 11, Max: 12, Resolved: 100},
		"b_first":      {Base: 2, Current: 5, Max: 9, Resolved: 3},
		"c_dependent":  {Base: 0, Current: 7, Max: 8, Resolved: 1},
	})
	before := independentPipelineAttributes(attrs)
	ctx := formula.GenericEvalContext{SourceAttrs: attrs, TargetAttrs: attrs, StrictReads: true}
	out, err := resolver.ResolveAttributes(attrs, ctx, registry)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(attrs, before) || out.At("a_unmodified").Resolved != 10 || out.At("b_first").Resolved != 4 || out.At("c_dependent").Resolved != 103 {
		t.Fatalf("formula must read the same old view: input=%+v output=%+v", attrs, out)
	}
}

func TestAttributeResolverFailureLeavesInputUnchanged(t *testing.T) {
	for _, failure := range []string{"invalid_program", "non_finite_value", "non_finite_total"} {
		t.Run(failure, func(t *testing.T) {
			registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}},
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: math.Inf(1)}}},
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: math.MaxFloat64}}},
			}}
			brokenProgram := formula.GenericProgramID(99)
			brokenPolicy := "add"
			brokenBase := 1.0
			if failure == "non_finite_value" {
				brokenProgram = 1
			} else if failure == "non_finite_total" {
				brokenProgram = 2
				brokenPolicy = "multiply"
				brokenBase = 2
			}
			var resolver AttributeResolver
			// 故意逆序挂载两项失败，错误仍按属性键指向 c_failure。
			resolver.MountCompiledModifier("item", planbundle.CompiledModifier{
				ModifierKey: "later", Target: "d_failure", ValueProgram: 99, HasValue: true,
			})
			resolver.MountCompiledModifier("item", planbundle.CompiledModifier{
				ModifierKey: "broken", Target: "c_failure", ValueProgram: brokenProgram, ValuePolicy: brokenPolicy, HasValue: true,
			})
			resolver.MountCompiledModifier("item", planbundle.CompiledModifier{
				ModifierKey: "valid", Target: "b_valid", ValueProgram: 0, HasValue: true,
			})
			attrs := attribute.FromMap(map[string]model.AttributeSlotDef{
				"a_unmodified": {Base: 10, Current: 11, Max: 12, Resolved: 20},
				"b_valid":      {Base: 2, Current: 3, Max: 4, Resolved: 5},
				"c_failure":    {Base: brokenBase, Current: 6, Max: 7, Resolved: 8},
				"d_failure":    {Base: 9, Current: 10, Max: 11, Resolved: 12},
			})
			before := independentPipelineAttributes(attrs)
			ctx := formula.GenericEvalContext{SourceAttrs: attrs, TargetAttrs: attrs}
			out, err := resolver.ResolveAttributes(attrs, ctx, registry)
			if out.Len() != 0 || err == nil || !strings.HasPrefix(err.Error(), "attribute c_failure modifier broken: ") {
				t.Fatalf("unexpected first error: output=%v error=%v", out, err)
			}
			if !reflect.DeepEqual(attrs, before) {
				t.Fatalf("failed resolve changed attributes: got %+v want %+v", attrs, before)
			}
		})
	}
}

func TestAttributeResolverCloneMountAndUnmountIsolation(t *testing.T) {
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}},
	}}
	mod := planbundle.CompiledModifier{ModifierKey: "add", Target: "attack", ValuePolicy: "add", HasValue: true}
	var resolver AttributeResolver
	resolver.MountCompiledModifierOwned("source", "same", mod)
	resolver.MountCompiledModifierOwned("target", "same", mod)
	clone := resolver.Clone()
	if !resolver.SameMounts(clone) {
		t.Fatal("clone lost the current mount identity")
	}
	clone.UnmountProviderOwned("source", "same")
	if resolver.SameMounts(clone) {
		t.Fatal("unmount did not replace the clone mount identity")
	}
	clone.MountCompiledModifierOwned("clone", "multiply", planbundle.CompiledModifier{
		ModifierKey: "multiply", Target: "attack", ValuePolicy: "multiply", ValueProgram: 1, HasValue: true,
	})
	assertValue := func(r AttributeResolver, want float64) {
		t.Helper()
		attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"attack": {Base: 100, Current: 101, Resolved: 100}})
		out, err := r.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
		if err != nil {
			t.Fatal(err)
		}
		if out.At("attack").Resolved != want {
			t.Fatalf("resolved=%v want %v", out.At("attack").Resolved, want)
		}
	}
	assertValue(resolver, 120)
	assertValue(clone, 220)
	resolver.UnmountProviderOwned("target", "same")
	resolver.MountCompiledModifierOwned("source", "new", mod)
	assertValue(resolver, 120)
	assertValue(clone, 220)
	clone.UnmountProviderOwned("target", "same")
	assertValue(clone, 200)
	assertValue(resolver, 120)
}

func TestAttributeResolverMountIdentityIgnoresNoOpChanges(t *testing.T) {
	var resolver AttributeResolver
	empty := resolver.Clone()
	resolver.MountCompiledModifier("item", planbundle.CompiledModifier{Kind: "damage", Target: "attack"})
	resolver.MountCompiledModifier("item", planbundle.CompiledModifier{HasCondition: true, Target: "attack"})
	resolver.MountCompiledModifier("item", planbundle.CompiledModifier{})
	if !resolver.SameMounts(empty) {
		t.Fatal("rejected modifiers replaced an empty mount plan")
	}
	resolver.MountCompiledModifier("item", planbundle.CompiledModifier{Target: "attack", HasValue: true})
	before := resolver.Clone()
	resolver.UnmountProvider("missing")
	resolver.UnmountProviderOwned("other-owner", "item")
	if !resolver.SameMounts(before) {
		t.Fatal("unrelated unmount invalidated the current mount plan")
	}
	resolver.UnmountProvider("item")
	if !resolver.SameMounts(empty) || len(resolver.MountedModifiers()) != 0 {
		t.Fatal("empty mount plans must compare equal after the last unmount")
	}
	if len(before.MountedModifiers()) != 1 {
		t.Fatal("the saved mount plan changed after unmount")
	}
}

func TestAttributeResolverExactTiesKeepMountOrderAcrossClone(t *testing.T) {
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}},
	}}
	add := planbundle.CompiledModifier{ModifierKey: "same", Target: "attack", ValuePolicy: "add", HasValue: true}
	multiply := add
	multiply.ValuePolicy = "multiply"
	multiply.ValueProgram = 1
	var resolver AttributeResolver
	resolver.MountCompiledModifierOwned("owner", "provider", add)
	resolver.MountCompiledModifierOwned("owner", "provider", multiply)
	clone := resolver.Clone()
	clone.MountCompiledModifierOwned("owner", "provider", add)
	for _, test := range []struct {
		resolver AttributeResolver
		want     float64
	}{{resolver, 220}, {clone, 230}} {
		attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"attack": {Base: 100}})
		out, err := test.resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
		if err != nil {
			t.Fatal(err)
		}
		if out.At("attack").Resolved != test.want {
			t.Fatalf("equal sort keys reordered mounts: resolved=%v want %v", out.At("attack").Resolved, test.want)
		}
	}
}

func TestAttributeResolverDerivedInitialValueAndSlotFields(t *testing.T) {
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 0.1}}},
	}}
	var resolver AttributeResolver
	resolver.MountCompiledModifier("item", planbundle.CompiledModifier{
		ModifierKey: "percent", Target: "attack", ValuePolicy: "percent_add", HasValue: true,
	})
	slot := model.AttributeSlotDef{Base: 10, Current: 20, Max: 30, Resolved: 40}
	resolved, err := resolver.ResolveDerivedAttribute("attack", slot, 100, attribute.Table{}, formula.GenericEvalContext{}, registry, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := slot
	want.Resolved = 110
	if resolved != want {
		t.Fatalf("derived base or slot fields changed: got %+v want %+v", resolved, want)
	}
}
