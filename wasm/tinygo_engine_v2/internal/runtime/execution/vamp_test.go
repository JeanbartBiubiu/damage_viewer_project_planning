package execution

import (
	json "encoding/json"
	math "math"
	os "os"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
)

func vampFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, e := os.ReadFile(runtimeFixturePath("generic_vamp_damage.json"))
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if e := json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	return f.CompileRequest, f.RunRequest
}

func vampValue(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func vampNear(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("%s=%v want %v", label, got, want)
	}
}

func vampEvents(done model.DoneResult) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, e := range done.Evidence.Items {
		if e.Kind == model.EvidenceKindVamp {
			out = append(out, e)
		}
	}
	return out
}

func vampAmount(t *testing.T, data map[string]interface{}, key string, want float64) {
	t.Helper()
	got, ok := data[key].(float64)
	if !ok {
		t.Fatalf("%s is %T", key, data[key])
	}
	vampNear(t, key, got, want)
}

func vampSetHP(r *model.RunRequest, actor int, value, max float64) {
	r.InitialSnapshot.Combatants[actor].Attributes["hp"] = model.AttributeSlotDef{Base: max, Current: value, Max: max, Resolved: value}
}

func vampOpenScenario(c *model.CompileRequest, r *model.RunRequest) {
	c.SharedProviders[0].Modifiers = nil
	c.Rules.VampRules = c.Rules.VampRules[:1] // only omnivamp
	vampSetHP(r, 0, 10, 1000)
	vampSetHP(r, 1, 1000, 1000)
	r.InitialSnapshot.Combatants[1].Shields = nil
	for _, attrs := range []map[string]model.AttributeSlotDef{c.Combatants[0].Attributes, r.InitialSnapshot.Combatants[0].Attributes} {
		slot := attrs["omnivamp_percent"]
		slot.Max = 1
		attrs["omnivamp_percent"] = slot
	}
}

func TestVampPhantomUsesOriginalQualificationAndCurrentRatio(t *testing.T) {
	c, r := vampFixture(t)
	vampOpenScenario(&c, &r)
	c.SharedProviders[0].Abilities[0].Types = []string{"ability/summoner"}
	op := &c.SharedProviders[0].Abilities[0].Operations[0]
	op.Types = []string{"damage_trait/delivery_skill", "damage_trait/origin_reflected"}
	op.VampOverrides = []model.VampOverrideDefinition{{VampType: model.VampOmnivamp, Mode: model.VampOverride, BasisOutputKind: model.VampPostDefense, Efficiency: vampValue(.5)}}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("compile: %+v", compiled.Result.Errors)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	dmg := copyableDamageFrozen{rawAmount: 100, damageType: "damage/physical", sourceKey: "source", targetKey: "target", originRef: r.DriverPlan.Entries[0].AbilityRef, providerRef: "champion", operationRef: "sample_hit", ability: compiled.Session.Abilities[0], operation: compiled.Session.Operations[0], eventSourceKey: "source", eventTargetKey: "target", entrySourceAttrs: s.combatants["source"].attributesView(), entryTargetAttrs: s.combatants["target"].attributesView(), castInstanceID: 7}
	collector := &eventCopyableCollector{}
	if err := s.applyPhantomCopyableDamage(collector, dmg, "sample_copy"); err != nil {
		t.Fatal(err)
	}
	source := s.combatants["source"]
	ratio := source.attributesView().At("omnivamp_percent")
	ratio.Base, ratio.Resolved = .4, .4

	source.setAttributes(source.attributesView().With("omnivamp_percent", ratio))
	s.combatants["source"] = source
	if err := s.applyPhantomCopyableDamage(collector, dmg, "sample_copy"); err != nil {
		t.Fatal(err)
	}
	events := vampEvents(s.buildDoneResult(false))
	if len(events) != 2 {
		t.Fatalf("events=%d", len(events))
	}
	vampAmount(t, events[0].Data, "actualHealing", 5)
	vampAmount(t, events[1].Data, "actualHealing", 10)
	for _, e := range events {
		if e.Data["phantom"] != true || e.Data["castInstanceId"] != float64(7) {
			t.Fatalf("lost provenance: %v", e.Data)
		}
	}
}
