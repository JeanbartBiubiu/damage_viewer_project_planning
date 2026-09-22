package runtime

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func woundModifier(key string, ratio float64, category, group string) model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey:              key,
		Kind:                     "pipeline",
		Command:                  "heal",
		HealDirection:            model.HealReceived,
		HealCategory:             category,
		HealGroupKey:             group,
		HealGroupCalculationMode: model.HealGroupRatioMax,
		ValuePolicy:              "add_percent",
		Value:                    statusConst(ratio),
	}
}

func woundProvider(key string, ratio, duration float64, category, group string) model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: key,
		Kind:        "status",
		StableID:    key,
		Lifecycle:   sourceTargetLifecycle(duration),
		Modifiers:   []model.ModifierDefinition{woundModifier(key+"-mod", ratio, category, group)},
	}
}

func healAmount(v float64) *model.GenericFormulaExpr {
	e := statusConst(v)
	return &e
}

func TestHealRatioMaxTwoFortyPercentRemainForty(t *testing.T) {
	c, r := loadBasicFixture(t)
	c.SharedProviders = append(c.SharedProviders,
		woundProvider("status:wound_a", -0.4, 3000, model.HealAny, "grievous"),
		woundProvider("status:wound_b", -0.4, 3000, model.HealAny, "grievous"),
	)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		statusAbility("apply", nil, applyOp("status:wound_a"), applyOp("status:wound_b")),
		statusAbility("heal", nil, model.OperationDefinition{Operation: "heal", Target: model.SelectorTarget, Amount: healAmount(100)}),
	}
	r.InitialSnapshot.Combatants[1].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "heal", AbilityRef: "source.provider[champion:source_demo].ability[heal]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 10},
	}
	r.StopPolicy.DurationMs = 100
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	done := c1Run(t, c, r)
	vampNear(t, "healed hp", done.Summary.TargetFinalHp, 160)
	heals := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindHeal {
			heals++
			vampAmount(t, item.Data, "healingAfterModifiers", 60)
			vampAmount(t, item.Data, "actualHealing", 60)
		}
	}
	if heals == 0 {
		t.Fatal("missing heal evidence")
	}
}

func TestHealRatioMaxStrongerExpiresThenWeakerRecovers(t *testing.T) {
	c, r := loadBasicFixture(t)
	c.SharedProviders = append(c.SharedProviders,
		woundProvider("status:wound40", -0.4, 3000, model.HealAny, "grievous"),
		woundProvider("status:wound60", -0.6, 1000, model.HealAny, "grievous"),
	)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		statusAbility("apply", nil, applyOp("status:wound40"), applyOp("status:wound60")),
		statusAbility("heal", nil, model.OperationDefinition{Operation: "heal", Target: model.SelectorTarget, Amount: healAmount(100)}),
	}
	r.InitialSnapshot.Combatants[1].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "heal_strong", AbilityRef: "source.provider[champion:source_demo].ability[heal]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
		{EntryKey: "heal_recover", AbilityRef: "source.provider[champion:source_demo].ability[heal]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1100},
	}
	r.StopPolicy.DurationMs = 1200
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	done := c1Run(t, c, r)
	var amounts []float64
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindHeal {
			amounts = append(amounts, item.Data["actualHealing"].(float64))
		}
	}
	if len(amounts) != 2 {
		t.Fatalf("heals=%v", amounts)
	}
	vampNear(t, "during 60%", amounts[0], 40)
	vampNear(t, "after 60% ends", amounts[1], 60)
}

func TestHealRatioMaxDirectAndVampShareAndCategoryFilter(t *testing.T) {
	c, r := loadBasicFixture(t)
	c.SharedProviders = append(c.SharedProviders,
		woundProvider("status:wound_vamp", -0.4, 3000, model.HealVamp, "grievous"),
		woundProvider("status:wound_any", -0.4, 3000, model.HealAny, "grievous_any"),
	)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		statusAbility("apply_vamp", nil, model.OperationDefinition{Operation: "apply_provider", Target: model.SelectorTarget, ProviderDefinitionRef: "status:wound_vamp"}),
		statusAbility("apply_any", nil, model.OperationDefinition{Operation: "apply_provider", Target: model.SelectorTarget, ProviderDefinitionRef: "status:wound_any"}),
		statusAbility("heal", nil, model.OperationDefinition{Operation: "heal", Target: model.SelectorTarget, Amount: healAmount(100)}),
	}
	r.InitialSnapshot.Combatants[1].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply_vamp]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "heal", AbilityRef: "source.provider[champion:source_demo].ability[heal]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 10},
	}
	r.StopPolicy.DurationMs = 50
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	done := c1Run(t, c, r)
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindHeal {
			vampAmount(t, item.Data, "actualHealing", 100)
		}
	}

	r.DriverPlan.Entries[0].AbilityRef = "source.provider[champion:source_demo].ability[apply_any]"
	done = c1Run(t, c, r)
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindHeal {
			vampAmount(t, item.Data, "actualHealing", 60)
			return
		}
	}
	t.Fatal("missing filtered heal")
}

func TestHealRatioMaxAppliesToVamp(t *testing.T) {
	c, r := vampFixture(t)
	for i := range c.SharedProviders[0].Modifiers {
		c.SharedProviders[0].Modifiers[i].HealGroupKey = "other_" + c.SharedProviders[0].Modifiers[i].ModifierKey
	}
	c.SharedProviders = append(c.SharedProviders, woundProvider("status:wound", -0.4, 3000, model.HealAny, "grievous"))
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, statusAbility("apply_wound", nil, model.OperationDefinition{
		Operation: "apply_provider", Target: model.SelectorSource, ProviderDefinitionRef: "status:wound",
	}))
	r.DriverPlan.Entries = append([]model.DriverEntry{{
		EntryKey: "wound", AbilityRef: "source.provider[champion].ability[apply_wound]",
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, r.DriverPlan.Entries...)
	for i := range r.DriverPlan.Entries {
		if r.DriverPlan.Entries[i].EntryKey != "wound" && r.DriverPlan.Entries[i].FirstAtMs < 10 {
			r.DriverPlan.Entries[i].FirstAtMs = 10
		}
	}
	r.StopPolicy.DurationMs = 50
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	done := c1Run(t, c, r)
	found := false
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindVamp {
			continue
		}
		found = true
		after, _ := item.Data["healingAfterModifiers"].(float64)
		if after >= 10.8-1e-9 {
			t.Fatalf("vamp healing should be reduced by grievous, got %v", after)
		}
	}
	if !found {
		t.Fatal("missing vamp evidence")
	}
}

func TestHealRatioMaxCoexistsWithAddPercentGroups(t *testing.T) {
	c, r := loadBasicFixture(t)
	c.SharedProviders = append(c.SharedProviders, woundProvider("status:wound", -0.4, 3000, model.HealAny, "grievous"))
	c.Rules.Modifiers = []model.ModifierDefinition{{
		ModifierKey: "amp", Kind: "pipeline", Command: "heal", HealDirection: model.HealDone,
		HealCategory: model.HealDirect, HealGroupKey: "amp", ValuePolicy: "add_percent", Value: statusConst(0.5),
	}}
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		statusAbility("apply", nil, applyOp("status:wound")),
		statusAbility("heal", nil, model.OperationDefinition{Operation: "heal", Target: model.SelectorTarget, Amount: healAmount(100)}),
	}
	r.InitialSnapshot.Combatants[1].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "heal", AbilityRef: "source.provider[champion:source_demo].ability[heal]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 10},
	}
	r.StopPolicy.DurationMs = 50
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	done := c1Run(t, c, r)
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindHeal {
			vampAmount(t, item.Data, "healingAfterModifiers", 90)
			return
		}
	}
	t.Fatal("missing heal evidence")
}

func TestHealRatioMaxRuntimeIllegalValue(t *testing.T) {
	c, r := loadBasicFixture(t)
	c.SharedProviders = append(c.SharedProviders, woundProvider("status:wound", 0.2, 3000, model.HealAny, "grievous"))
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		statusAbility("apply", nil, applyOp("status:wound")),
		statusAbility("heal", nil, model.OperationDefinition{Operation: "heal", Target: model.SelectorTarget, Amount: healAmount(100)}),
	}
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "apply", AbilityRef: "source.provider[champion:source_demo].ability[apply]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "heal", AbilityRef: "source.provider[champion:source_demo].ability[heal]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 10},
	}
	r.StopPolicy.DurationMs = 50
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("%+v", compiled.Result.Errors)
	}
	_, err := RunGeneric(compiled.Session, r)
	if err == nil || !strings.Contains(err.Message, "ratio_max") {
		t.Fatalf("expected runtime ratio_max error, got %+v", err)
	}
}
