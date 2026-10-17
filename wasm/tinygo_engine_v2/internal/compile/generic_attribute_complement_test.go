package compile

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCompileAttributeComplementUsesExplicitTotalStage(t *testing.T) {
	for _, key := range []string{"configured_ratio", "unrelated_fraction"} {
		r := minimalValidCompileRequest()
		r.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "remaining", Kind: "attribute", Target: "self.attr." + key, Stage: "total", ValuePolicy: "complement_multiply", Value: statusConst(.1)}}
		got := CompileGeneric(r)
		if !got.OK || got.Session.Providers[0].Modifiers[0].ValuePolicy != "complement_multiply" {
			t.Fatal(got.Result.Errors)
		}
	}
}

func TestCompileAttributeComplementRejectsInvalidStaticRatios(t *testing.T) {
	for _, value := range []float64{-.1, 1.1, math.NaN(), math.Inf(1)} {
		r := minimalValidCompileRequest()
		r.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "remaining", Kind: "attribute", Target: "self.attr.configured_ratio", Stage: "total", ValuePolicy: "complement_multiply", Value: statusConst(value)}}
		got := CompileGeneric(r)
		if got.OK || !hasErrorPath(got.Result.Errors, ".value") {
			t.Fatal("invalid complement compiled", value, got.Result.Errors)
		}
	}
}

func TestCompileAttributeComplementRejectsOtherKindsStagesAndOperations(t *testing.T) {
	for _, tc := range []struct{ kind, stage string }{{"attribute", ""}, {"attribute", "base"}, {"pipeline", "total"}, {"", "total"}} {
		r := minimalValidCompileRequest()
		r.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "remaining", Kind: tc.kind, Target: "self.attr.configured_ratio", Stage: tc.stage, ValuePolicy: "complement_multiply", Value: statusConst(.1)}}
		got := CompileGeneric(r)
		if got.OK || !hasErrorPath(got.Result.Errors, ".valuePolicy") {
			t.Fatal(tc, got.Result.Errors)
		}
	}
	r := minimalValidCompileRequest()
	r.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "attribute_change", Target: "self", AttributeKey: "attack_damage", Amount: timedShieldExpr(.1), ValuePolicy: "complement_multiply"}}
	got := CompileGeneric(r)
	if got.OK || !hasErrorPath(got.Result.Errors, ".valuePolicy") {
		t.Fatal(got.Result.Errors)
	}
}
