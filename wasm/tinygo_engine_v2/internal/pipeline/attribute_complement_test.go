package pipeline

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func complementTestRegistry(values ...float64) formula.GenericRegistry {
	registry := formula.GenericRegistry{}
	for _, value := range values {
		registry.Programs = append(registry.Programs, formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: value}}})
	}
	return registry
}

func complementTestAttrs(key string, base float64) attribute.Table {
	return attribute.FromMap(map[string]model.AttributeSlotDef{key: {Base: base, Current: base, Resolved: base}})
}

func complementTestModifier(key, target, bucket, policy string, index int) planbundle.CompiledModifier {
	return planbundle.CompiledModifier{ModifierKey: key, Kind: "attribute", Target: "self.attr." + target, Bucket: bucket, Stage: "total", ValuePolicy: policy, HasValue: true, ValueProgram: formula.GenericProgramID(index)}
}

func TestAttributeComplementIsGenericAndCompoundsRemainingRatio(t *testing.T) {
	for _, key := range []string{"configured_reduction", "unrelated_ratio"} {
		t.Run(key, func(t *testing.T) {
			for _, tc := range []struct {
				base  float64
				count int
				want  float64
			}{{.4, 1, .46}, {.4, 2, .514}, {0, 1, .1}, {1, 2, 1}} {
				registry := complementTestRegistry(.1)
				var resolver AttributeResolver
				for i := 0; i < tc.count; i++ {
					resolver.MountCompiledModifierOwned("source", string(rune('a'+i)), complementTestModifier(string(rune('a'+i)), key, "configured", "complement_multiply", 0))
				}
				attrs := complementTestAttrs(key, tc.base)
				for repeat := 0; repeat < 3; repeat++ {
					result, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
					if err != nil || math.Abs(result.At(key).Resolved-tc.want) > 1e-12 {
						t.Fatal(result.At(key), err, tc)
					}
					attrs = result
				}
			}
		})
	}
}

func TestAttributeComplementStageDoesNotDependOnBucketSorting(t *testing.T) {
	registry := complementTestRegistry(.1, .5, .1)
	for _, key := range []string{"configured_ratio", "other_ratio"} {
		for _, complementBucket := range []string{"aaa", "zzz"} {
			var resolver AttributeResolver
			resolver.MountCompiledModifierOwned("source", "bonus", complementTestModifier("add", key, "middle_1", "add", 0))
			resolver.MountCompiledModifierOwned("source", "scale", complementTestModifier("multiply", key, "middle_2", "multiply", 1))
			resolver.MountCompiledModifierOwned("source", "remaining", complementTestModifier("remaining", key, complementBucket, "complement_multiply", 2))
			attrs := complementTestAttrs(key, .4)
			result, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
			// Old modifiers remain in their original order: (.4+.1)*.5=.25; final complement=.325.
			if err != nil || math.Abs(result.At(key).Resolved-.325) > 1e-12 {
				t.Fatal(key, complementBucket, result.At(key), err)
			}
			resolver.UnmountProviderOwned("source", "remaining")
			legacy, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
			if err != nil || legacy.At(key).Resolved != .25 {
				t.Fatal("old modifier ordering changed", legacy.At(key), err)
			}
		}
	}
}

func TestAttributeComplementRejectsInvalidRatioAndOrdinaryInput(t *testing.T) {
	for _, ratio := range []float64{-.1, 1.1, math.NaN(), math.Inf(1)} {
		registry := complementTestRegistry(ratio)
		var resolver AttributeResolver
		resolver.MountCompiledModifierOwned("source", "invalid", complementTestModifier("invalid", "configured", "z", "complement_multiply", 0))
		if _, err := resolver.ResolveAttributes(complementTestAttrs("configured", .4), formula.GenericEvalContext{}, registry); err == nil {
			t.Fatal("invalid ratio accepted", ratio)
		}
	}
	for _, base := range []float64{-.1, 1.1, math.NaN(), math.Inf(1)} {
		registry := complementTestRegistry(.1)
		var resolver AttributeResolver
		resolver.MountCompiledModifierOwned("source", "invalid", complementTestModifier("invalid", "configured", "z", "complement_multiply", 0))
		if _, err := resolver.ResolveAttributes(complementTestAttrs("configured", base), formula.GenericEvalContext{}, registry); err == nil {
			t.Fatal("invalid ordinary input accepted", base)
		}
	}
}

func TestAttributeComplementMountedSetsAreImmutable(t *testing.T) {
	registry := complementTestRegistry(.1)
	var resolver AttributeResolver
	resolver.MountCompiledModifierOwned("source", "first", complementTestModifier("first", "configured", "total", "complement_multiply", 0))
	frozen := resolver.Clone()
	resolver.MountCompiledModifierOwned("source", "second", complementTestModifier("second", "configured", "total", "complement_multiply", 0))
	attrs := complementTestAttrs("configured", .4)
	old, err := frozen.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
	if err != nil || math.Abs(old.At("configured").Resolved-.46) > 1e-12 {
		t.Fatal(old, err)
	}
	current, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
	if err != nil || math.Abs(current.At("configured").Resolved-.514) > 1e-12 {
		t.Fatal(current, err)
	}
	resolver.UnmountProviderOwned("source", "first")
	current, err = resolver.ResolveAttributes(attrs, formula.GenericEvalContext{}, registry)
	if err != nil || math.Abs(current.At("configured").Resolved-.46) > 1e-12 {
		t.Fatal(current, err)
	}
}
