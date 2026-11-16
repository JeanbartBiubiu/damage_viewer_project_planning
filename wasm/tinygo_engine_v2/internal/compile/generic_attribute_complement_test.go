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

func TestCompileFinalAttributeLimitRequiresPlainFiniteStaticMin(t *testing.T) {
	limit := func() model.ModifierDefinition {
		return model.ModifierDefinition{ModifierKey: "limit", Kind: "attribute", Target: "self.attr.attack_speed", Stage: "final", ValuePolicy: "min", Value: statusConst(3.33)}
	}
	for _, value := range []float64{0, 3.33} {
		r := minimalValidCompileRequest()
		mod := limit()
		mod.Value = statusConst(value)
		r.SharedProviders[0].Modifiers = []model.ModifierDefinition{mod}
		if got := CompileGeneric(r); !got.OK || got.Session.Providers[0].Modifiers[0].Stage != "final" {
			t.Fatal("valid final limit or explicit zero rejected", value, got.Result.Errors)
		}
	}
	for _, test := range []struct {
		name   string
		change func(*model.ModifierDefinition)
	}{
		{"resource_max", func(m *model.ModifierDefinition) { m.Kind = "resource_max" }},
		{"pipeline", func(m *model.ModifierDefinition) { m.Kind = "pipeline" }},
		{"set_like_policy", func(m *model.ModifierDefinition) { m.ValuePolicy = "max" }},
		{"complement", func(m *model.ModifierDefinition) { m.ValuePolicy = "complement_multiply" }},
		{"missing_value", func(m *model.ModifierDefinition) { m.Value = model.GenericFormulaExpr{} }},
		{"dynamic_value", func(m *model.ModifierDefinition) {
			m.Value = model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage"}
		}},
		{"nonfinite_value", func(m *model.ModifierDefinition) { m.Value = statusConst(math.Inf(1)) }},
		{"condition", func(m *model.ModifierDefinition) { value := statusConst(1); m.Condition = &value }},
		{"group", func(m *model.ModifierDefinition) { key := "group"; m.MultiplierGroupKey = &key }},
		{"bucket", func(m *model.ModifierDefinition) { m.Bucket = "ordinary" }},
		{"snapshot", func(m *model.ModifierDefinition) { m.ValueReadMode = "APPLICATION_SNAPSHOT" }},
		{"empty_target", func(m *model.ModifierDefinition) { m.Target = "self.attr." }},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := minimalValidCompileRequest()
			mod := limit()
			test.change(&mod)
			r.SharedProviders[0].Modifiers = []model.ModifierDefinition{mod}
			if got := CompileGeneric(r); got.OK {
				t.Fatal("invalid final limit was accepted", test.name)
			}
		})
	}
	r := minimalValidCompileRequest()
	duration := statusConst(1000)
	r.SharedProviders = append(r.SharedProviders, model.ProviderDefinition{ProviderKey: "finite_limit", Kind: "status", StableID: "finite_limit", Lifecycle: &model.ProviderLifecycle{DurationMs: &duration, MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace, InstanceScope: model.InstanceScopeSourceTarget}, Modifiers: []model.ModifierDefinition{limit()}})
	if got := CompileGeneric(r); !got.OK || !got.Session.HasFiniteModifierExpiry || !got.Session.Providers[1].NeedsModifierExpiry || !got.Session.Providers[1].AtomicDynamic {
		t.Fatal("finite final limit did not reuse modifier expiry and atomic actual instance", got.Result.Errors)
	}
}
