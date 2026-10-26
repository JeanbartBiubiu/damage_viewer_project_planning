package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func ensureDamageTrueType(req *model.CompileRequest) {
	formuladefinition.SetDamageFormula(req, "damage/true", formuladefinition.ConstantDefense("1"))

	for _, t := range req.TypeCatalog.Types {
		if t.Key == "damage/true" {
			return
		}
	}
	req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: "damage/true", Domain: "damage"})
}

func sourceProviderState(t *testing.T, snap model.Snapshot, providerRef string) map[string]interface{} {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[providerRef].(map[string]interface{})
		if !ok {
			t.Fatalf("providerState[%s] missing: %+v", providerRef, c.ProviderState)
		}
		return bag
	}
	t.Fatalf("source combatant missing")
	return nil
}
