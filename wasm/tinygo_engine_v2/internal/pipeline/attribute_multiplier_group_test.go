package pipeline

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestAttributeAmplificationGroupsAndIndependentHandCalculation(t *testing.T) {
	for _, grouped := range []bool{false, true} {
		registry := complementTestRegistry(20, .1, 1.2, 1.3, 1.1)
		var resolver AttributeResolver
		for index, row := range []struct {
			key, policy, stage string
			group              uint16
		}{{"flat", "add", "", 0}, {"base_percent", "percent_add", "", 0}, {"a", "multiply", "total", 0}, {"b", "multiply", "total", 0}, {"c", "multiply", "total", 1}} {
			resolver.MountCompiledModifierOwned("source", row.key, planbundle.CompiledModifier{ModifierKey: row.key, Kind: "attribute", Target: "power", Bucket: "unchanged", Stage: row.stage, ValuePolicy: row.policy, HasValue: true, ValueProgram: formula.GenericProgramID(index), HasMultiplierGroup: grouped && index >= 2, MultiplierGroupID: row.group})
		}
		out, err := resolver.ResolveAttributes(attribute.FromMap(map[string]model.AttributeSlotDef{"power": {Base: 100}}), formula.GenericEvalContext{}, registry)
		want := 223.08
		if grouped {
			want = 214.5
		}
		if err != nil || math.Abs(out.At("power").Resolved-want) > 1e-10 {
			t.Fatal(grouped, out.At("power"), err)
		}
	}
}

func TestAttributeAmplificationPrecedesComplementAndKeepsScopes(t *testing.T) {
	registry := complementTestRegistry(1.1, 1.2, .3, .1)
	var resolver AttributeResolver
	for index := 0; index < 4; index++ {
		policy := "multiply"
		if index >= 2 {
			policy = "complement_multiply"
		}
		mod := complementTestModifier(string(rune('a'+index)), "ratio", "unchanged", policy, index)
		mod.HasMultiplierGroup = index < 2
		resolver.MountCompiledModifierOwned("source", string(rune('a'+index)), mod)
	}
	out, err := resolver.ResolveAttributes(complementTestAttrs("ratio", .2), formula.GenericEvalContext{}, registry)
	if err != nil || math.Abs(out.At("ratio").Resolved-.5338) > 1e-12 {
		t.Fatal(out.At("ratio"), err)
	}
	// 同组编号出现在另一属性时，不能把两个属性的增幅相加。
	mod := complementTestModifier("other", "other", "unchanged", "multiply", 0)
	mod.HasMultiplierGroup = true
	resolver.MountCompiledModifierOwned("source", "other", mod)
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"ratio": {Base: .2}, "other": {Base: 100}})
	out, err = resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
	if err != nil || math.Abs(out.At("ratio").Resolved-.5338) > 1e-12 || math.Abs(out.At("other").Resolved-110) > 1e-12 {
		t.Fatal(out, err)
	}
}

func TestAttributeGroupedMemberExactExpiryAndCloneIsolation(t *testing.T) {
	registry := complementTestRegistry(1.2, 1.3)
	var resolver AttributeResolver
	for index, ref := range []string{"finite", "permanent"} {
		mod := complementTestModifier(ref, "power", "unchanged", "multiply", index)
		mod.HasMultiplierGroup = true
		resolver.MountCompiledModifierOwned("source", ref, mod)
	}
	before := resolver.Clone()
	for _, at := range []int64{999, 1000} {
		ctx := func(owner, ref string) ProviderFormulaContext {
			return ProviderFormulaContext{SkipExpiredAttributeModifier: ref == "finite" && at >= 1000}
		}
		out, err := resolver.ResolveAttributesWithProviderContext(complementTestAttrs("power", 100), formula.GenericEvalContext{}, registry, ctx)
		want := 150.0
		if at == 1000 {
			want = 130
		}
		if err != nil || math.Abs(out.At("power").Resolved-want) > 1e-12 {
			t.Fatal(at, out.At("power"), err)
		}
	}
	resolver.UnmountProviderOwned("source", "finite")
	out, err := before.ResolveAttributes(complementTestAttrs("power", 100), formula.GenericEvalContext{}, registry)
	if err != nil || out.At("power").Resolved != 150 {
		t.Fatal("new index changed frozen mount plan", out, err)
	}
}
