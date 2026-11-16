package pipeline

import (
	"math"
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func TestAttributeTotalMultipliersAfterFlatIndependentOfBucket(t *testing.T) {
	registry := fixtureFormulaLibrary([]formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 50}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: .7}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: .5}}},
	})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"armor": {Base: 100}})
	var resolver AttributeResolver
	for i, row := range []struct{ ref, policy, stage, bucket string }{{"flat", "add", "", "zzz"}, {"ratio", "multiply", "total", "aaa"}, {"other", "multiply", "total", "bbb"}} {
		resolver.MountCompiledModifierOwned("target", row.ref, plan.CompiledModifier{ModifierKey: row.ref, Kind: "attribute", Target: "armor", ValuePolicy: row.policy, Stage: row.stage, Bucket: row.bucket, HasValue: true, ValueProgram: formula.GenericProgramID(i)})
		out, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
		if err != nil || math.Abs(out.At("armor").Resolved-[]float64{150, 105, 52.5}[i]) > 1e-9 {
			t.Fatal(i, out, err)
		}
	}
	resolver.UnmountProviderOwned("target", "ratio")
	out, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
	if err != nil || out.At("armor").Resolved != 75 {
		t.Fatal(out, err)
	}
	resolver.UnmountProviderOwned("target", "other")
	out, err = resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
	if err != nil || out.At("armor").Resolved != 150 {
		t.Fatal(out, err)
	}
}

func TestFinalAttributeLimitRunsAfterTotalsWithoutSettingLowerValues(t *testing.T) {
	registry := fixtureFormulaLibrary([]formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 3.33}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 3}}},
	})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": {Base: 2}})
	for _, limitKey := range []string{"aaa", "zzz"} {
		var resolver AttributeResolver
		limit := plan.CompiledModifier{ModifierKey: limitKey, Kind: "attribute", Target: "speed", Stage: "final", ValuePolicy: "min", HasValue: true, ValueProgram: 1}
		resolver.MountCompiledModifierOwned("source", "cap", limit)
		out, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
		if err != nil || out.At("speed").Resolved != 2 {
			t.Fatal("upper limit was treated as SET", out, err)
		}
		resolver.MountCompiledModifierOwned("source", "total", plan.CompiledModifier{ModifierKey: "middle", Kind: "attribute", Target: "speed", Stage: "total", Bucket: "total", ValuePolicy: "multiply", HasValue: true, ValueProgram: 0})
		out, err = resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
		if err != nil || out.At("speed").Resolved != 3.33 {
			t.Fatal("total multiplication bypassed the final limit", out, err)
		}
		limit.ModifierKey, limit.ValueProgram = "other_limit", 2
		resolver.MountCompiledModifierOwned("source", "other_cap", limit)
		out, err = resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
		if err != nil || out.At("speed").Resolved != 3 {
			t.Fatal("multiple final upper limits did not take the minimum", out, err)
		}
		resolver.UnmountProviderOwned("source", "cap")
		resolver.UnmountProviderOwned("source", "other_cap")
		out, err = resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
		if err != nil || out.At("speed").Resolved != 4 {
			t.Fatal("unmount did not restore the original uncapped baseline", out, err)
		}
	}
}
