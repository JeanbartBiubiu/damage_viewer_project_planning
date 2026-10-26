package execution

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestGroupedDamageResultOverflowNeverBlamesInactiveTail(t *testing.T) {
	c, r := groupedFrameInput()
	a, z := groupedDamageDefinition("a", 1.2), groupedDamageDefinition("z", 1)
	a.Value = authoringRead("source.attr.multiplier.current")
	z.Condition = authoringAmount(authoringConst(0))
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{a, z}
	s := frameCommitState(t, c, r)
	f, ability, _ := frameCommitFrame(s)
	setGroupedFrameAttribute(f, "multiplier", 1e308)
	_, err := groupedFrameAmount(f, ability, 2)
	if err == nil || !strings.Contains(err.Ref, "modifier[a]") || strings.Contains(err.Ref, "modifier[z]") || !strings.Contains(err.Path, "modifiers[0].value") || len(f.consumedFirstPerCast) != 0 {
		t.Fatal(err, f.consumedFirstPerCast)
	}
}

func TestGroupedAttributeProductOverflowRetainsActualSourceAndFormula(t *testing.T) {
	c, r := groupedFrameInput()
	for key, value := range map[string]float64{"power": 1, "big": 1e308, "small": 2} {
		c.Combatants[0].Attributes[key] = authoringSlot(value)
		r.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(value)
	}
	for index, key := range []string{"big", "small"} {
		group := []string{"gain_one", "gain_two"}[index]
		c.SharedProviders[0].Modifiers = append(c.SharedProviders[0].Modifiers, model.ModifierDefinition{ModifierKey: key, Kind: "attribute", Target: "self.attr.power", Stage: "total", ValuePolicy: "multiply", Value: authoringRead("source.attr." + key + ".current"), MultiplierGroupKey: &group})
	}
	_, err := newGenericRunState(authoringCompile(t, c), r)
	if err == nil || !strings.Contains(err.Ref, "modifier[small]") || !strings.Contains(err.Path, "modifiers[1].value") || err.Details["providerOwner"] != "source" || err.Details["attributeKey"] != "power" {
		t.Fatal(err)
	}
}

func TestGroupedAttributeRestoreExcludesExactExpiryInOrdinaryAndDerivedViews(t *testing.T) {
	for _, derived := range []bool{false, true} {
		for _, badExpiredValue := range []bool{false, true} {
			c, r := groupedFrameInput()
			c.Combatants[0].Attributes["power"] = authoringSlot(100)
			r.InitialSnapshot.Combatants[0].Attributes["power"] = authoringSlot(100)
			value := authoringConst(1.2)
			if badExpiredValue {
				value = authoringRead("source.attr.multiplier.current")
				c.Combatants[0].Attributes["multiplier"] = authoringSlot(.8)
				r.InitialSnapshot.Combatants[0].Attributes["multiplier"] = authoringSlot(.8)
			}
			group := "finite_gain"
			c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "finite_gain", StableID: "finite_gain", Kind: "status", Lifecycle: &model.ProviderLifecycle{DurationMs: authoringAmount(authoringConst(1000)), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget}, Modifiers: []model.ModifierDefinition{{ModifierKey: "power_gain", Kind: "attribute", Target: "self.attr.power", Stage: "total", ValuePolicy: "multiply", Value: value, MultiplierGroupKey: &group}}})
			if derived {
				c.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{CombatantKey: "source", AttributeKey: "power", ValuePolicy: "set", ValueType: "DECIMAL", Value: authoringConst(100)}}
			}
			r.InitialSnapshot.TimeMs = 1000
			expiry := int64(1000)
			r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "finite#one", DefinitionRef: "finite_gain", Source: "source", Owner: "source", Stacks: 1, ExpireAt: &expiry})
			r.DriverPlan = model.DriverPlan{}
			s, err := newGenericRunState(authoringCompile(t, c), r)
			if err != nil || math.Abs(s.combatants["source"].attributesView().At("power").Resolved-100) > 1e-12 {
				t.Fatal(derived, badExpiredValue, s, err)
			}
			if err = s.runLoop(); err != nil {
				t.Fatal(err)
			}
			done := s.buildDoneResult(false)
			for _, actor := range done.FinalSnapshot.Combatants {
				if actor.Key == "source" && actor.Attributes["power"].Resolved != 100 {
					t.Fatal(derived, badExpiredValue, actor.Attributes["power"])
				}
			}
		}
	}
}
