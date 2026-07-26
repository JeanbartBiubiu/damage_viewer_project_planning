package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func c1Float(v float64) *float64 { return &v }

func ensureC1CatalogTypes(req *model.CompileRequest, keys ...model.TypeCatalogEntry) {
	seen := map[string]struct{}{}
	for _, t := range req.TypeCatalog.Types {
		seen[t.Key] = struct{}{}
	}
	for _, t := range keys {
		if _, ok := seen[t.Key]; ok {
			continue
		}
		req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		seen[t.Key] = struct{}{}
	}
}

func c1Run(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("RunGeneric err=%+v", err)
	}
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}
	return done
}

func emittedEventsByRef(done model.DoneResult, ref string) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == ref {
			out = append(out, item)
		}
	}
	return out
}

func TestC1AbilityStartedCarriesUltimateAndMixedMatcher(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/ability_started", Domain: "event"},
		model.TypeCatalogEntry{Key: "ability/ultimate", Domain: "ability"},
		model.TypeCatalogEntry{Key: "event/c1_ult_probe", Domain: "event"},
	)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: "ultimate",
		Kind:       "active",
		Types:      []string{"ability/ultimate"},
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: c1Float(10)},
			Ref:        "op:ult",
		}},
	}}
	compileReq.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey:  "ult_started",
		EventMatcher: model.TypeMatcher{All: []string{"event/ability_started", "ability/ultimate"}},
		Operations: []model.OperationDefinition{{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/c1_ult_probe",
			Ref:       "event/c1_ult_probe",
		}},
	}}
	runReq.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey:   "ult",
		AbilityRef: "source.provider[champion:source_demo].ability[ultimate]",
		Source:     model.SelectorSource,
		Target:     model.SelectorTarget,
		FirstAtMs:  0,
	}}
	runReq.StopPolicy.DurationMs = 100
	done := c1Run(t, compileReq, runReq)
	if len(emittedEventsByRef(done, "event/ability_started")) != 1 {
		t.Fatalf("ability_started count=%d", len(emittedEventsByRef(done, "event/ability_started")))
	}
	if len(emittedEventsByRef(done, "event/c1_ult_probe")) != 1 {
		t.Fatalf("mixed matcher probe count=%d want 1", len(emittedEventsByRef(done, "event/c1_ult_probe")))
	}
}

func TestC1DamageInstanceEmitsStableOrderIncludingZero(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"},
		model.TypeCatalogEntry{Key: "damage_trait/ability", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage_trait/proc", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage/true", Domain: "damage"},
	)
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = "spell"
	compileReq.SharedProviders[0].Abilities[0].Types = []string{"ability/spell"}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: c1Float(25)},
			Types:      []string{"damage_trait/ability"},
			Ref:        "op:a",
		},
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: c1Float(0)},
			Types:      []string{"damage_trait/proc"},
			Ref:        "op:zero",
		},
	}
	runReq.DriverPlan.Entries[0].AbilityRef = "source.provider[champion:source_demo].ability[spell]"
	runReq.StopPolicy.DurationMs = 100
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	done := c1Run(t, compileReq, runReq)
	evs := emittedEventsByRef(done, eventTypeDamageInstance)
	if len(evs) != 2 {
		t.Fatalf("damage_instance count=%d want 2", len(evs))
	}
	if evs[0].Data["operationRef"] != "op:a" || evs[1].Data["operationRef"] != "op:zero" {
		t.Fatalf("order=%v/%v", evs[0].Data["operationRef"], evs[1].Data["operationRef"])
	}
	traits0, _ := evs[0].Data["traits"].([]string)
	if len(traits0) != 1 || traits0[0] != "damage_trait/ability" {
		// JSON round-trip may yield []interface{}
		raw, ok := evs[0].Data["traits"].([]interface{})
		if !ok || len(raw) != 1 || raw[0] != "damage_trait/ability" {
			t.Fatalf("traits0=%v", evs[0].Data["traits"])
		}
	}
	dmg, ok := evs[1].Data["damage"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing damage snapshot: %+v", evs[1].Data)
	}
	if math.Abs(evidenceDataFloat(dmg, "mitigatedAmount")) > 1e-9 {
		t.Fatalf("zero mitigated=%v", dmg["mitigatedAmount"])
	}
	if math.Abs(evidenceDataFloat(dmg, "forcedCritWeight")) > 1e-9 {
		t.Fatalf("forcedCritWeight=%v", dmg["forcedCritWeight"])
	}
}

func TestC1DamageInstanceSkippedOnConditionFailure(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
	)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation:  "damage",
		Target:     "target",
		DamageType: "damage/physical",
		Amount:     &model.GenericFormulaExpr{Op: "const", Value: c1Float(40)},
		Condition:  &model.GenericFormulaExpr{Op: "const", Value: c1Float(0)},
		Ref:        "op:skipped",
	}}
	runReq.StopPolicy.DurationMs = 100
	done := c1Run(t, compileReq, runReq)
	if len(emittedEventsByRef(done, eventTypeDamageInstance)) != 0 {
		t.Fatalf("skipped damage must not emit damage_instance")
	}
}

func TestC1EventDamageSnapshotReadableFromListener(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/c1_snap_probe", Domain: "event"},
	)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation:  "damage",
		Target:     "target",
		DamageType: "damage/physical",
		Amount:     &model.GenericFormulaExpr{Op: "const", Value: c1Float(55)},
		Ref:        "op:snap",
	}}
	compileReq.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey:  "read_snap",
		EventMatcher: model.TypeMatcher{Any: []string{"event/damage_instance"}},
		Operations: []model.OperationDefinition{{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/c1_snap_probe",
			Ref:       "event/c1_snap_probe",
			Condition: &model.GenericFormulaExpr{
				Op: "eq",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "event.damage.mitigatedAmount"},
					{Op: "const", Value: c1Float(55)},
				},
			},
		}},
	}}
	runReq.StopPolicy.DurationMs = 100
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	done := c1Run(t, compileReq, runReq)
	if len(emittedEventsByRef(done, "event/c1_snap_probe")) != 1 {
		t.Fatalf("event.damage read probe count=%d", len(emittedEventsByRef(done, "event/c1_snap_probe")))
	}
}

func TestC1ListenerChildDamageKeepsTraitsAndRespectsBudget(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"},
		model.TypeCatalogEntry{Key: "damage_trait/ability", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"},
	)
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = "spell"
	compileReq.SharedProviders[0].Abilities[0].Types = []string{"ability/spell"}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation:  "damage",
		Target:     "target",
		DamageType: "damage/physical",
		Amount:     &model.GenericFormulaExpr{Op: "const", Value: c1Float(10)},
		Types:      []string{"damage_trait/ability"},
		Ref:        "op:root",
	}}
	compileReq.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey:  "child_on_instance",
		EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "damage_trait/ability"}},
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/magic",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: c1Float(3)},
			Types:      []string{"damage_trait/on_hit"},
			Ref:        "op:child",
		}},
	}}
	runReq.DriverPlan.Entries[0].AbilityRef = "source.provider[champion:source_demo].ability[spell]"
	runReq.StopPolicy.DurationMs = 100
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	done := c1Run(t, compileReq, runReq)
	evs := emittedEventsByRef(done, eventTypeDamageInstance)
	if len(evs) != 2 {
		t.Fatalf("damage_instance count=%d want 2 (root+child)", len(evs))
	}
	child := evs[1]
	if child.Data["operationRef"] != "op:child" {
		t.Fatalf("child ref=%v", child.Data["operationRef"])
	}
	if !c1TraitsContain(child.Data["traits"], "damage_trait/on_hit") {
		t.Fatalf("child traits=%v", child.Data["traits"])
	}

	// Recursive damage_instance listener must respect MaxChainDepth.
	compileReq.Rules.Listeners = append(compileReq.Rules.Listeners, model.ListenerDefinition{
		ListenerKey:  "recurse",
		EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "damage_trait/on_hit"}},
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/magic",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: c1Float(1)},
			Types:      []string{"damage_trait/on_hit"},
			Ref:        "op:recurse",
		}},
	})
	runReq.SafetyBudget = &model.RunSafetyBudget{MaxChainDepth: 1}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, runErr := RunGeneric(result.Session, runReq)
	if runErr == nil {
		t.Fatal("expected chain depth budget failure")
	}
	if runErr.Code != model.GenericErrRuntimeInvariantFailed {
		t.Fatalf("code=%q", runErr.Code)
	}
}

func c1TraitsContain(raw interface{}, want string) bool {
	switch v := raw.(type) {
	case []string:
		for _, t := range v {
			if t == want {
				return true
			}
		}
	case []interface{}:
		for _, t := range v {
			if s, ok := t.(string); ok && s == want {
				return true
			}
		}
	}
	return false
}

func TestC1AllDamageAndBasicDamageChannelUnion(t *testing.T) {
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"},
		model.TypeCatalogEntry{Key: "damage/true", Domain: "damage"},
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
	)
	// Dual-channel same identity: one provider with two modifier defs sharing ModifierKey.
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:dual_sub",
		Kind:        "item",
		StableID:    "dual_sub",
		Modifiers: []model.ModifierDefinition{
			{
				ModifierKey: "shared_sub",
				Kind:        "pipeline",
				Command:     "damage",
				Channel:     "all_damage",
				Stage:       "outgoing_pre_mitigation",
				Bucket:      "all_instances",
				Priority:    0,
				ValuePolicy: "subtract",
				Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(10)},
			},
			{
				ModifierKey: "shared_sub",
				Kind:        "pipeline",
				Command:     "damage",
				Channel:     "basic_damage",
				Stage:       "outgoing_pre_mitigation",
				Bucket:      "all_instances",
				Priority:    0,
				ValuePolicy: "subtract",
				Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(10)},
			},
		},
	})
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != model.SelectorSource {
			continue
		}
		compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, model.CombatantProviderMount{
			ProviderRef: "item:dual_sub", DefinitionRef: "item:dual_sub",
		})
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: "item:dual_sub", DefinitionRef: "item:dual_sub",
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-90) > 1e-9 {
		t.Fatalf("basic raw=%v want 90 (deduped subtract once)", evidenceDataFloat(data, "rawAmount"))
	}
	mods := damageEvidenceModifiers(data)
	if len(mods) != 1 {
		t.Fatalf("modifier applications=%d want 1, mods=%v", len(mods), mods)
	}

	// Non-basic spell: all_damage applies, basic_damage does not.
	compileReq2, runReq2 := loadPipelineDamageFixture(t, 100, 0)
	ensureC1CatalogTypes(&compileReq2,
		model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"},
	)
	mountPipelineProvider(&compileReq2, &runReq2, model.SelectorSource, "item:all_only", "all_only", model.ModifierDefinition{
		ModifierKey: "all_only",
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(2)},
	})
	mountPipelineProvider(&compileReq2, &runReq2, model.SelectorSource, "item:basic_only", "basic_only", model.ModifierDefinition{
		ModifierKey: "basic_only",
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "basic_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(3)},
	})
	compileReq2.SharedProviders[0].Abilities[0].AbilityKey = "spell"
	compileReq2.SharedProviders[0].Abilities[0].Types = []string{"ability/spell"}
	runReq2.DriverPlan.Entries[0].AbilityRef = "source.provider[champion:source_demo].ability[spell]"
	done2 := runPipelineFixture(t, compileReq2, runReq2)
	data2 := firstOriginalDamage(t, done2)
	if math.Abs(evidenceDataFloat(data2, "rawAmount")-200) > 1e-9 {
		t.Fatalf("spell raw=%v want 200 (all_damage only)", evidenceDataFloat(data2, "rawAmount"))
	}
}

func TestC1DamageTraitAndTypePredicates(t *testing.T) {
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage/true", Domain: "damage"},
	)
	compileReq.SharedProviders[0].Abilities[0].Operations[0].Types = []string{"damage_trait/on_hit"}
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:trait_gate", "trait_gate", model.ModifierDefinition{
		ModifierKey: "trait_gate",
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(2)},
		Condition: &model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				{Op: "read", Path: "damage.trait.on_hit"},
				{Op: "read", Path: "damage.type.physical"},
			},
		},
	})
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-200) > 1e-9 {
		t.Fatalf("raw=%v want 200", evidenceDataFloat(data, "rawAmount"))
	}

	compileReq2, runReq2 := loadPipelineDamageFixture(t, 100, 0)
	ensureC1CatalogTypes(&compileReq2,
		model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage/true", Domain: "damage"},
	)
	compileReq2.SharedProviders[0].Abilities[0].Operations[0].DamageType = "damage/true"
	compileReq2.SharedProviders[0].Abilities[0].Operations[0].Types = []string{"damage_trait/on_hit"}
	mountPipelineProvider(&compileReq2, &runReq2, model.SelectorSource, "item:trait_gate", "trait_gate", model.ModifierDefinition{
		ModifierKey: "trait_gate",
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(2)},
		Condition: &model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				{Op: "read", Path: "damage.trait.on_hit"},
				{Op: "read", Path: "damage.type.physical"},
			},
		},
	})
	done2 := runPipelineFixture(t, compileReq2, runReq2)
	data2 := firstOriginalDamage(t, done2)
	if math.Abs(evidenceDataFloat(data2, "rawAmount")-100) > 1e-9 {
		t.Fatalf("true damage should skip physical predicate, raw=%v", evidenceDataFloat(data2, "rawAmount"))
	}
}

func TestC1SubtractEvidenceAndOrdering(t *testing.T) {
	compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:late", "late", model.ModifierDefinition{
		ModifierKey: "late_mul",
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    20,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(2)},
	})
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:early", "early", model.ModifierDefinition{
		ModifierKey: "early_sub",
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    5,
		ValuePolicy: "subtract",
		Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(30)},
	})
	compileReq.SharedProviders[0].Abilities[0].Operations[0].Types = []string{}
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "damage_trait/item", Domain: "damage_trait"},
	)
	compileReq.SharedProviders[0].Abilities[0].Operations[0].Types = []string{"damage_trait/item"}
	done := runPipelineFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	// (100-30)*2 = 140
	if math.Abs(evidenceDataFloat(data, "rawAmount")-140) > 1e-9 {
		t.Fatalf("raw=%v want 140", evidenceDataFloat(data, "rawAmount"))
	}
	mods := damageEvidenceModifiers(data)
	if len(mods) != 2 {
		t.Fatalf("mods=%v", mods)
	}
	if mods[0]["modifierKey"] != "early_sub" || mods[1]["modifierKey"] != "late_mul" {
		t.Fatalf("order=%v/%v", mods[0]["modifierKey"], mods[1]["modifierKey"])
	}
	if math.Abs(evidenceDataFloat(mods[0], "value")-30) > 1e-9 || math.Abs(evidenceDataFloat(mods[0], "after")-70) > 1e-9 {
		t.Fatalf("subtract evidence=%v", mods[0])
	}
}

func TestC1DamageDealtAndBasicChannelRegression(t *testing.T) {
	// Aggregate damage_dealt still emits for basic physical >0; damage_instance coexists.
	compileReq, runReq := loadBasicFixture(t)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_dealt", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/damage_dealt/physical", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
	)
	runReq.StopPolicy.DurationMs = 100
	done := c1Run(t, compileReq, runReq)
	if len(emittedEventsByRef(done, eventTypeDamageDealt)) != 1 {
		t.Fatalf("damage_dealt count=%d", len(emittedEventsByRef(done, eventTypeDamageDealt)))
	}
	if len(emittedEventsByRef(done, eventTypeDamageInstance)) != 1 {
		t.Fatalf("damage_instance count=%d", len(emittedEventsByRef(done, eventTypeDamageInstance)))
	}
	// Non-basic still skips basic_damage-only magnification (regression).
	compileReq2, runReq2 := loadPipelineDamageFixture(t, 100, 0)
	mountPipelineProvider(&compileReq2, &runReq2, model.SelectorSource, pipeMagProviderRef, "magnification", magnificationModifier(1.10))
	compileReq2.SharedProviders[0].Abilities[0].AbilityKey = pipeNonBasicAbility
	compileReq2.SharedProviders[0].Abilities[0].Types = []string{}
	runReq2.DriverPlan.Entries[0].AbilityRef = "source.provider[champion:source_demo].ability[" + pipeNonBasicAbility + "]"
	done2 := runPipelineFixture(t, compileReq2, runReq2)
	data := firstOriginalDamage(t, done2)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-100) > 1e-9 {
		t.Fatalf("non-basic basic_damage skip raw=%v", evidenceDataFloat(data, "rawAmount"))
	}
}

func TestC1DamageInstanceNaturalBranchProjectsOutgoing(t *testing.T) {
	const (
		base       = 100.0
		chance     = 0.25
		multiplier = 2.3
		outgoing   = 2.0
	)
	compileReq, runReq := loadPipelineDamageFixture(t, base, 0)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
	)
	compileReq.SharedProviders[0].Abilities[0].Operations[0].CritEligible = true
	compileReq.SharedProviders[0].Abilities[0].Operations[0].Ref = "op:c1_crit_out"
	setSourceCritAttrs(&compileReq, &runReq, chance, multiplier)
	mountPipelineProvider(&compileReq, &runReq, model.SelectorSource, "item:c1_out_mul", "c1_out_mul", model.ModifierDefinition{
		ModifierKey: "c1_out_mul",
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "all_damage",
		Stage:       "outgoing_pre_mitigation",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(outgoing)},
	})

	done := runPipelineFixture(t, compileReq, runReq)
	evs := emittedEventsByRef(done, eventTypeDamageInstance)
	if len(evs) != 1 {
		t.Fatalf("damage_instance count=%d want 1", len(evs))
	}
	dmg, ok := evs[0].Data["damage"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing damage snapshot: %+v", evs[0].Data)
	}

	_, _, normalPre, critPre, adjusted := wantExpectedCrit(base, chance, multiplier)
	outgoingFactor := outgoing // proportional multiply; merged pre-outgoing = adjusted * outgoing
	wantPreMitigation := adjusted * outgoingFactor
	wantNormal := normalPre * outgoingFactor
	wantCrit := critPre * outgoingFactor
	wantNatural := base * multiplier * outgoingFactor

	if math.Abs(evidenceDataFloat(dmg, "baseRawAmount")-base) > 1e-9 {
		t.Fatalf("baseRawAmount=%v want %v", evidenceDataFloat(dmg, "baseRawAmount"), base)
	}
	if math.Abs(evidenceDataFloat(dmg, "preMitigationAmount")-wantPreMitigation) > 1e-9 {
		t.Fatalf("preMitigationAmount=%v want %v", evidenceDataFloat(dmg, "preMitigationAmount"), wantPreMitigation)
	}
	if math.Abs(evidenceDataFloat(dmg, "forcedCritWeight")) > 1e-9 {
		t.Fatalf("forcedCritWeight=%v want 0", evidenceDataFloat(dmg, "forcedCritWeight"))
	}
	if math.Abs(evidenceDataFloat(dmg, "forcedCritMultiplier")-multiplier) > 1e-9 {
		t.Fatalf("forcedCritMultiplier=%v want %v (M_forced starts at crit_damage)", evidenceDataFloat(dmg, "forcedCritMultiplier"), multiplier)
	}
	if math.Abs(evidenceDataFloat(dmg, "originalCritChance")-chance) > 1e-9 {
		t.Fatalf("originalCritChance=%v want p=%v", evidenceDataFloat(dmg, "originalCritChance"), chance)
	}
	if math.Abs(evidenceDataFloat(dmg, "effectiveCritChance")-chance) > 1e-9 {
		t.Fatalf("effectiveCritChance=%v want q=%v", evidenceDataFloat(dmg, "effectiveCritChance"), chance)
	}
	if math.Abs(evidenceDataFloat(dmg, "naturalCritWeight")-chance) > 1e-9 {
		t.Fatalf("naturalCritWeight=%v want %v", evidenceDataFloat(dmg, "naturalCritWeight"), chance)
	}
	if math.Abs(evidenceDataFloat(dmg, "naturalCritMultiplier")-multiplier) > 1e-9 {
		t.Fatalf("naturalCritMultiplier=%v want %v", evidenceDataFloat(dmg, "naturalCritMultiplier"), multiplier)
	}
	if math.Abs(evidenceDataFloat(dmg, "normalPart")-wantNormal) > 1e-9 {
		t.Fatalf("normalPart=%v want %v", evidenceDataFloat(dmg, "normalPart"), wantNormal)
	}
	if math.Abs(evidenceDataFloat(dmg, "critPart")-wantCrit) > 1e-9 {
		t.Fatalf("critPart=%v want %v", evidenceDataFloat(dmg, "critPart"), wantCrit)
	}
	gotParts := evidenceDataFloat(dmg, "normalPart") + evidenceDataFloat(dmg, "critPart")
	if math.Abs(gotParts-evidenceDataFloat(dmg, "preMitigationAmount")) > 1e-9 {
		t.Fatalf("normalPart+critPart=%v want preMitigationAmount=%v", gotParts, evidenceDataFloat(dmg, "preMitigationAmount"))
	}
	if math.Abs(evidenceDataFloat(dmg, "naturalBranchRawAmount")-wantNatural) > 1e-9 {
		t.Fatalf("naturalBranchRawAmount=%v want %v (base*multiplier*outgoingFactor)", evidenceDataFloat(dmg, "naturalBranchRawAmount"), wantNatural)
	}
	// Unweighted natural branch must not equal the expected merged pre-outgoing amount.
	if math.Abs(evidenceDataFloat(dmg, "naturalBranchRawAmount")-wantPreMitigation) < 1e-9 {
		t.Fatalf("naturalBranchRawAmount must not equal merged preMitigationAmount %v", wantPreMitigation)
	}
}

func TestC1PhantomReplayDoesNotEmitDamageInstance(t *testing.T) {
	// Reuse Guinsoo copyable-on-hit + repeat/phantom fixture; prove phantom damage evidence
	// exists without an extra event/damage_instance emission or listener probe.
	compileReq, runReq := loadGuinsooKFixture(t, []model.ListenerDefinition{
		guinsooKCopyableListener("c1_copyable", guinsooKCopyableAmt, true),
		guinsooKRepeatListener("c1_phantom"),
	}, nil, 4)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/c1_instance_probe", Domain: "event"},
	)
	compileReq.SharedProviders[0].Listeners[0].Operations[0].Ref = "op:c1_copyable"
	compileReq.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey:  "c1_instance_probe",
		EventMatcher: model.TypeMatcher{Any: []string{"event/damage_instance"}},
		Operations: []model.OperationDefinition{{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/c1_instance_probe",
			Ref:       "event/c1_instance_probe",
		}},
	}}

	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatalf("RunGeneric err=%+v", err)
	}
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}

	instanceEvs := emittedEventsByRef(done, eventTypeDamageInstance)
	// 4 AA + 4 original copyable on-hit; phantom must not add a 9th.
	if len(instanceEvs) != 8 {
		t.Fatalf("damage_instance count=%d want 8 (4 AA + 4 original copyable)", len(instanceEvs))
	}
	probes := emittedEventsByRef(done, "event/c1_instance_probe")
	if len(probes) != 8 {
		t.Fatalf("damage_instance probe count=%d want 8 (no phantom probe)", len(probes))
	}

	var origCopyable, phantomCopyable int
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != "op:c1_copyable" {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			phantomCopyable++
		} else {
			origCopyable++
		}
	}
	if origCopyable != 4 {
		t.Fatalf("original copyable damage evidence=%d want 4", origCopyable)
	}
	if phantomCopyable != 1 {
		t.Fatalf("phantom copyable damage evidence=%d want 1", phantomCopyable)
	}
}

func TestC1DamageInstanceSkippedOnNonFiniteFormulaFailure(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureC1CatalogTypes(&compileReq,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/c1_fail_probe", Domain: "event"},
	)
	one, zero := 1.0, 0.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation:  "damage",
		Target:     "target",
		DamageType: "damage/physical",
		Amount: &model.GenericFormulaExpr{
			Op: "div",
			Args: []model.GenericFormulaExpr{
				{Op: "const", Value: &one},
				{Op: "const", Value: &zero},
			},
		},
		Ref: "op:c1_nonfinite",
	}}
	compileReq.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey:  "c1_fail_probe",
		EventMatcher: model.TypeMatcher{Any: []string{"event/damage_instance"}},
		Operations: []model.OperationDefinition{{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/c1_fail_probe",
			Ref:       "event/c1_fail_probe",
		}},
	}}
	runReq.StopPolicy.DurationMs = 100

	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, runErr := RunGeneric(result.Session, runReq)
	if runErr == nil {
		t.Fatalf("expected formula/runtime error, got ok done stop=%q", done.Summary.StopReason)
	}
	if runErr.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want %q", runErr.Code, model.GenericErrFormulaTypeError)
	}
	if len(emittedEventsByRef(done, eventTypeDamageInstance)) != 0 {
		t.Fatalf("non-finite failure must not emit damage_instance evidence")
	}
	if len(emittedEventsByRef(done, "event/c1_fail_probe")) != 0 {
		t.Fatalf("non-finite failure must not trigger damage_instance listener probe")
	}
}

// TestC1GuardiansHornUndaunted proves Wiki item 2051 Guardian's Horn / Undaunted
// under the current 1v1 champion-source numeric boundary (flat 15 ordinary /
// 3.75 DoT at incoming_post_mitigation). It does not implement non-champion
// source filtering.
func TestC1GuardiansHornUndaunted(t *testing.T) {
	cases := []struct {
		name          string
		withDotTrait  bool
		wantMitigated float64
		wantModKey    string
		wantModValue  float64
	}{
		{
			name:          "no_dot_trait",
			withDotTrait:  false,
			wantMitigated: 85,
			wantModKey:    "undaunted_ordinary",
			wantModValue:  15,
		},
		{
			name:          "dot_trait",
			withDotTrait:  true,
			wantMitigated: 96.25,
			wantModKey:    "undaunted_dot",
			wantModValue:  3.75,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadPipelineDamageFixture(t, 100, 0)
			ensureC1CatalogTypes(&compileReq,
				model.TypeCatalogEntry{Key: "damage_trait/dot", Domain: "damage_trait"},
			)
			if tc.withDotTrait {
				compileReq.SharedProviders[0].Abilities[0].Operations[0].Types = []string{"damage_trait/dot"}
			}
			const providerRef = "item:guardians_horn_undaunted"
			compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
				ProviderKey: providerRef,
				Kind:        "item",
				StableID:    "guardians_horn_undaunted",
				Modifiers: []model.ModifierDefinition{
					{
						ModifierKey: "undaunted_ordinary",
						Kind:        "pipeline",
						Command:     "damage",
						Channel:     "all_damage",
						Stage:       "incoming_post_mitigation",
						Bucket:      "all_instances",
						Priority:    0,
						ValuePolicy: "subtract",
						Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(15)},
						Condition: &model.GenericFormulaExpr{
							Op: "eq",
							Args: []model.GenericFormulaExpr{
								{Op: "read", Path: "damage.trait.dot"},
								{Op: "const", Value: c1Float(0)},
							},
						},
					},
					{
						ModifierKey: "undaunted_dot",
						Kind:        "pipeline",
						Command:     "damage",
						Channel:     "all_damage",
						Stage:       "incoming_post_mitigation",
						Bucket:      "all_instances",
						Priority:    0,
						ValuePolicy: "subtract",
						Value:       model.GenericFormulaExpr{Op: "const", Value: c1Float(3.75)},
						Condition: &model.GenericFormulaExpr{
							Op: "eq",
							Args: []model.GenericFormulaExpr{
								{Op: "read", Path: "damage.trait.dot"},
								{Op: "const", Value: c1Float(1)},
							},
						},
					},
				},
			})
			for i := range compileReq.Combatants {
				if compileReq.Combatants[i].Key != model.SelectorTarget {
					continue
				}
				compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, model.CombatantProviderMount{
					ProviderRef: providerRef, DefinitionRef: providerRef,
				})
			}
			for i := range runReq.InitialSnapshot.Combatants {
				if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
					continue
				}
				runReq.InitialSnapshot.Combatants[i].Providers = append(
					runReq.InitialSnapshot.Combatants[i].Providers,
					model.CombatantProviderSnapshot{
						ProviderRef: providerRef, DefinitionRef: providerRef,
						Stacks: 1, State: map[string]interface{}{},
					},
				)
			}

			done := runPipelineFixture(t, compileReq, runReq)
			data := firstOriginalDamage(t, done)
			if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-tc.wantMitigated) > 1e-9 {
				t.Fatalf("mitigatedAmount=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), tc.wantMitigated)
			}
			postMods := modifiersByStage(data, "incoming_post_mitigation")
			if len(postMods) != 1 {
				t.Fatalf("incoming_post_mitigation mods=%d want 1 (no double subtract), mods=%v", len(postMods), postMods)
			}
			if postMods[0]["modifierKey"] != tc.wantModKey {
				t.Fatalf("modifierKey=%v want %q", postMods[0]["modifierKey"], tc.wantModKey)
			}
			if math.Abs(evidenceDataFloat(postMods[0], "value")-tc.wantModValue) > 1e-9 {
				t.Fatalf("modifier value=%v want %v", evidenceDataFloat(postMods[0], "value"), tc.wantModValue)
			}
		})
	}
}
