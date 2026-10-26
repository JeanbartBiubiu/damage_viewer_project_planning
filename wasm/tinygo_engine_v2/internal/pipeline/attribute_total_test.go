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
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 50}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: .7}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: .5}}},
	}}
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
