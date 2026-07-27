package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func c3Const(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func TestC3SourcePenetrationPhysicalAndEvidence(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation:  "damage",
		Target:     "target",
		Amount:     c3Const(100),
		DamageType: "damage/physical",
		Ref:        "op:c3_phys",
	}}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_percent", model.AttributeSlotDef{
		Base: 0.4, Current: 0.4, Max: 1, Resolved: 0.4,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "lethality", model.AttributeSlotDef{
		Base: 10, Current: 10, Max: 10, Resolved: 10,
	})
	done := runCritFixture(t, compileReq, runReq)
	// effective = 100*(1-0.4)-10 = 50; mitigated = 100*100/150
	wantMit := 100.0 * 100 / 150
	if math.Abs(done.Summary.SourceDamageDealt-wantMit) > 1e-9 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, wantMit)
	}
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "resistanceBeforePenetration")-100) > 1e-12 {
		t.Fatalf("resistanceBeforePenetration=%v", evidenceDataFloat(data, "resistanceBeforePenetration"))
	}
	if math.Abs(evidenceDataFloat(data, "penetrationPercent")-0.4) > 1e-12 {
		t.Fatalf("penetrationPercent=%v", evidenceDataFloat(data, "penetrationPercent"))
	}
	if math.Abs(evidenceDataFloat(data, "penetrationFlat")-10) > 1e-12 {
		t.Fatalf("penetrationFlat=%v", evidenceDataFloat(data, "penetrationFlat"))
	}
	if math.Abs(evidenceDataFloat(data, "effectiveResistance")-50) > 1e-12 {
		t.Fatalf("effectiveResistance=%v", evidenceDataFloat(data, "effectiveResistance"))
	}
	if math.Abs(evidenceDataFloat(data, "resistanceFactor")-(wantMit/100)) > 1e-12 {
		t.Fatalf("resistanceFactor=%v", evidenceDataFloat(data, "resistanceFactor"))
	}
}

func TestC3SourcePenetrationMagicAndTrueEvidenceZeros(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageMagicType(&compileReq)
	ensureDamageTrueType(&compileReq)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "damage", Target: "target", Amount: c3Const(100), DamageType: "damage/magic", Ref: "op:c3_magic"},
		{Operation: "damage", Target: "target", Amount: c3Const(50), DamageType: "damage/true", Ref: "op:c3_true"},
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_pen_pct", model.AttributeSlotDef{
		Base: 0.5, Current: 0.5, Max: 1, Resolved: 0.5,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_pen", model.AttributeSlotDef{
		Base: 20, Current: 20, Max: 20, Resolved: 20,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 10000, Current: 10000, Max: 10000, Resolved: 10000,
	})
	done := runCritFixture(t, compileReq, runReq)
	wantMagic := 100.0 * 100 / (100 + 30) // eff=30
	wantTotal := wantMagic + 50
	if math.Abs(done.Summary.SourceDamageDealt-wantTotal) > 1e-9 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, wantTotal)
	}
	var trueEv map[string]interface{}
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") == "op:c3_true" {
			trueEv = item.Data
			break
		}
	}
	if trueEv == nil {
		t.Fatal("missing true damage evidence")
	}
	if math.Abs(evidenceDataFloat(trueEv, "resistanceFactor")-1) > 1e-12 {
		t.Fatalf("true resistanceFactor=%v", evidenceDataFloat(trueEv, "resistanceFactor"))
	}
	if math.Abs(evidenceDataFloat(trueEv, "penetrationPercent")) > 1e-12 ||
		math.Abs(evidenceDataFloat(trueEv, "penetrationFlat")) > 1e-12 ||
		math.Abs(evidenceDataFloat(trueEv, "effectiveResistance")) > 1e-12 {
		t.Fatalf("true pen fields must be zero: %+v", trueEv)
	}
}

func TestC3TargetMapPenetrationNoOp(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{
		Operation: "damage", Target: "target", Amount: c3Const(100), DamageType: "damage/physical",
	}}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor_pen_pct", model.AttributeSlotDef{
		Base: 1, Current: 1, Max: 1, Resolved: 1,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor_pen_flat", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	done := runCritFixture(t, compileReq, runReq)
	if math.Abs(done.Summary.SourceDamageDealt-50) > 1e-9 {
		t.Fatalf("target-map pen must no-op: dealt=%v want 50", done.Summary.SourceDamageDealt)
	}
}

func TestC3PhantomUsesFrozenSourcePenetrationAndOmitsPostResistFields(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureGuinsooKTypes(&compileReq)

	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = guinsooHitAbility
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     c3Const(10),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         guinsooStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      c3Const(1),
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: guinsooKHitEvent,
			Ref:       guinsooKHitEvent,
		},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "c3_copyable",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Amount:        c3Const(100),
				CopyableOnHit: true,
				CritEligible:  true,
				Ref:           "op:c3_copy",
			}},
		},
		guinsooKRepeatListener("c3_phantom"),
	}
	setSourceCritAttrs(&compileReq, &runReq, 0, 2.3)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_pct", model.AttributeSlotDef{
		Base: 1, Current: 1, Max: 1, Resolved: 1,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	abilityRef := "source.provider[" + guinsooProviderRef + "].ability[" + guinsooHitAbility + "]"
	entries := make([]model.DriverEntry, 0, 4)
	for i := 0; i < 4; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "c3_hit_" + itoaRuntime(i),
			AbilityRef: abilityRef,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = 500
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000

	done := runCritFixture(t, compileReq, runReq)
	var orig, phant map[string]interface{}
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != "op:c3_copy" {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			phant = item.Data
		} else {
			orig = item.Data
		}
	}
	if orig == nil || phant == nil {
		t.Fatalf("need original+phantom copyable evidence; orig=%v phant=%v", orig != nil, phant != nil)
	}
	// Full percent pen → effective 0 → mitigated 100; crit chance 0 keeps raw 100.
	if math.Abs(evidenceDataFloat(orig, "mitigatedAmount")-100) > 1e-9 {
		t.Fatalf("original mitigated=%v want 100", evidenceDataFloat(orig, "mitigatedAmount"))
	}
	if math.Abs(evidenceDataFloat(phant, "mitigatedAmount")-100) > 1e-9 {
		t.Fatalf("phantom mitigated=%v want 100 (frozen source pen)", evidenceDataFloat(phant, "mitigatedAmount"))
	}
	if math.Abs(evidenceDataFloat(phant, "rawAmount")-100) > 1e-9 {
		t.Fatalf("phantom raw must stay frozen (no second crit): %v", evidenceDataFloat(phant, "rawAmount"))
	}
	if _, ok := phant["resistanceFactor"]; ok {
		t.Fatalf("phantom must omit post-resistance fields: %+v", phant)
	}
	if _, ok := phant["penetrationPercent"]; ok {
		t.Fatalf("phantom must omit penetrationPercent")
	}
	if math.Abs(evidenceDataFloat(orig, "penetrationPercent")-1) > 1e-12 {
		t.Fatalf("original penetrationPercent=%v", evidenceDataFloat(orig, "penetrationPercent"))
	}
}

func TestC3HPMutationPreservesCurrentMaxAndReResolvesProbe(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	// Always-on modifier: probe.resolved = target.attr.hp.current (via add on base 0).
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c3_probe",
		Kind:        "item",
		StableID:    "c3_probe",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "c3_hp_probe",
			Kind:        "attribute",
			Target:      "source.attr.probe",
			ValuePolicy: "add",
			Value:       model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"},
		}},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: "item:c3_probe", DefinitionRef: "item:c3_probe",
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: "item:c3_probe", DefinitionRef: "item:c3_probe", Stacks: 1, State: map[string]interface{}{},
		})
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "probe", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 1000, Max: 1000, Resolved: 1000,
	})
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "damage", Target: "target", Amount: c3Const(250), DamageType: "damage/true", Ref: "op:c3_hit"},
		{Operation: "damage", Target: "target", Amount: &model.GenericFormulaExpr{Op: "read", Path: "source.attr.probe.resolved"}, DamageType: "damage/true", Ref: "op:c3_probe_dmg"},
		{Operation: "damage", Target: "target", Amount: &model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.resolved"}, DamageType: "damage/true", Ref: "op:c3_hp_resolved"},
	}
	done := runCritFixture(t, compileReq, runReq)
	// After first hit HP=750 → probe re-resolves to 750 → second deals 750 → HP=0.
	// Third would read hp.resolved(=current=0) and deal 0.
	var byRef = map[string]float64{}
	for _, item := range damageEvidenceItems(done) {
		ref := evidenceDataString(item.Data, "operationRef")
		byRef[ref] = evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	if math.Abs(byRef["op:c3_hit"]-250) > 1e-9 {
		t.Fatalf("hit=%v want 250", byRef["op:c3_hit"])
	}
	if math.Abs(byRef["op:c3_probe_dmg"]-750) > 1e-9 {
		t.Fatalf("probe dmg=%v want 750 (re-resolved after HP mutation)", byRef["op:c3_probe_dmg"])
	}
	if math.Abs(byRef["op:c3_hp_resolved"]) > 1e-9 {
		t.Fatalf("hp.resolved read=%v want 0 (Current preserved, Resolved forced to Current)", byRef["op:c3_hp_resolved"])
	}
	if done.Summary.TargetFinalHp != 0 {
		t.Fatalf("finalHp=%v want 0", done.Summary.TargetFinalHp)
	}
}

func TestC3AttributeChangeReResolvePreservesUnrelatedCurrentMax(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:    "attribute_change",
			Target:       "source",
			AttributeKey: "attack_damage",
			ValuePolicy:  "set",
			Amount:       c3Const(250),
		},
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Amount:     &model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.resolved"},
			Ref:        "op:c3_ad",
		},
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_damage", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 1000, Resolved: 100,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 5000, Current: 5000, Max: 5000, Resolved: 5000,
	})
	// Unrelated attr must keep Current/Max through re-resolve.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ability_haste", model.AttributeSlotDef{
		Base: 10, Current: 33, Max: 99, Resolved: 10,
	})
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-250) > 1e-9 {
		t.Fatalf("ad resolved after attribute_change=%v want 250", evidenceDataFloat(data, "mitigatedAmount"))
	}
	var haste model.AttributeSlotDef
	found := false
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes["ability_haste"]
		if !ok {
			t.Fatal("FinalSnapshot missing ability_haste")
		}
		haste = slot
		found = true
		break
	}
	if !found {
		t.Fatal("FinalSnapshot missing source combatant")
	}
	if math.Abs(haste.Current-33) > 1e-12 || math.Abs(haste.Max-99) > 1e-12 {
		t.Fatalf("unrelated ability_haste Current/Max mutated: Current=%v Max=%v want Current=33 Max=99", haste.Current, haste.Max)
	}
}

func TestC3HealMutationReResolvesDependentFormula(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c3_heal_probe",
		Kind:        "item",
		StableID:    "c3_heal_probe",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "c3_heal_hp_probe",
			Kind:        "attribute",
			Target:      "source.attr.probe",
			ValuePolicy: "add",
			Value:       model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"},
		}},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: "item:c3_heal_probe", DefinitionRef: "item:c3_heal_probe",
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: "item:c3_heal_probe", DefinitionRef: "item:c3_heal_probe", Stacks: 1, State: map[string]interface{}{},
		})
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "probe", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 1000, Max: 1000, Resolved: 1000,
	})
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{Operation: "damage", Target: "target", Amount: c3Const(400), DamageType: "damage/true", Ref: "op:c3_pre_heal"},
		{Operation: "heal", Target: "target", Amount: c3Const(150), Ref: "op:c3_heal"},
		{Operation: "damage", Target: "target", Amount: &model.GenericFormulaExpr{Op: "read", Path: "source.attr.probe.resolved"}, DamageType: "damage/true", Ref: "op:c3_post_heal_probe"},
	}
	done := runCritFixture(t, compileReq, runReq)
	// damage 400 → HP=600; heal 150 → HP=750; probe re-resolves to 750 → third deals 750 → HP=0.
	var byRef = map[string]float64{}
	for _, item := range damageEvidenceItems(done) {
		ref := evidenceDataString(item.Data, "operationRef")
		byRef[ref] = evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	if math.Abs(byRef["op:c3_pre_heal"]-400) > 1e-9 {
		t.Fatalf("pre-heal dmg=%v want 400", byRef["op:c3_pre_heal"])
	}
	if math.Abs(byRef["op:c3_post_heal_probe"]-750) > 1e-9 {
		t.Fatalf("post-heal probe dmg=%v want 750 (re-resolved after heal)", byRef["op:c3_post_heal_probe"])
	}
	if done.Summary.TargetFinalHp != 0 {
		t.Fatalf("finalHp=%v want 0", done.Summary.TargetFinalHp)
	}
}

func TestC3PhantomHPMutationReResolvesProbeInFinalSnapshot(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureGuinsooKTypes(&compileReq)
	ensureDamageTrueType(&compileReq)

	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c3_phantom_probe",
		Kind:        "item",
		StableID:    "c3_phantom_probe",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "c3_phantom_hp_probe",
			Kind:        "attribute",
			Target:      "source.attr.probe",
			ValuePolicy: "add",
			Value:       model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"},
		}},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: "item:c3_phantom_probe", DefinitionRef: "item:c3_phantom_probe",
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: "item:c3_phantom_probe", DefinitionRef: "item:c3_phantom_probe", Stacks: 1, State: map[string]interface{}{},
		})
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "probe", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})

	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = guinsooHitAbility
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Amount:     c3Const(10),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         guinsooStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      c3Const(1),
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: guinsooKHitEvent,
			Ref:       guinsooKHitEvent,
		},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "c3_copyable_probe",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/true",
				Amount:        c3Const(100),
				CopyableOnHit: true,
				Ref:           "op:c3_copy_probe",
			}},
		},
		guinsooKRepeatListener("c3_phantom_probe_repeat"),
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	abilityRef := "source.provider[" + guinsooProviderRef + "].ability[" + guinsooHitAbility + "]"
	entries := make([]model.DriverEntry, 0, 4)
	for i := 0; i < 4; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "c3_probe_hit_" + itoaRuntime(i),
			AbilityRef: abilityRef,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = 500
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000

	done := runCritFixture(t, compileReq, runReq)
	var phantomAmt float64
	phantomSeen := false
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != "op:c3_copy_probe" {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			phantomSeen = true
			phantomAmt = evidenceDataFloat(item.Data, "mitigatedAmount")
		}
	}
	if !phantomSeen {
		t.Fatal("expected phantom copyable damage")
	}
	if math.Abs(phantomAmt-100) > 1e-9 {
		t.Fatalf("phantom mitigated=%v want 100", phantomAmt)
	}

	finalHP := combatantFinalHP(t, done.FinalSnapshot, model.SelectorTarget)
	probeResolved := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorSource, "probe")
	// Must track post-phantom HP. syncHPResolved-only leaves probe at pre-phantom current.
	if math.Abs(probeResolved-finalHP) > 1e-9 {
		t.Fatalf("probe.resolved=%v want finalHP=%v (phantom must re-resolve HP-dependent attrs)", probeResolved, finalHP)
	}
	// 4*(10+100) real + 100 phantom = 540 → final HP 100000-540.
	wantHP := 100000.0 - 540
	if math.Abs(finalHP-wantHP) > 1e-9 {
		t.Fatalf("finalHP=%v want %v", finalHP, wantHP)
	}
}

func TestC3ResourceChangeTriggersReResolve(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: "item:c3_mana_ad",
		Kind:        "item",
		StableID:    "c3_mana_ad",
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: "c3_mana_to_ad",
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value: model.GenericFormulaExpr{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: floatPtr(0.01)},
					{Op: "read", Path: "source.resource.mana.current"},
				},
			},
		}},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: "item:c3_mana_ad", DefinitionRef: "item:c3_mana_ad",
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: "item:c3_mana_ad", DefinitionRef: "item:c3_mana_ad", Stacks: 1, State: map[string]interface{}{},
		})
		if runReq.InitialSnapshot.Combatants[i].Resources == nil {
			runReq.InitialSnapshot.Combatants[i].Resources = map[string]model.ResourceSlotDef{}
		}
		runReq.InitialSnapshot.Combatants[i].Resources["mana"] = model.ResourceSlotDef{Current: 0, Max: 2000}
	}
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != model.SelectorSource {
			continue
		}
		if compileReq.Combatants[i].Resources == nil {
			compileReq.Combatants[i].Resources = map[string]model.ResourceSlotDef{}
		}
		compileReq.Combatants[i].Resources["mana"] = model.ResourceSlotDef{Current: 0, Max: 2000}
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 10000, Current: 10000, Max: 10000, Resolved: 10000,
	})
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "resource_change",
			Target:      "source",
			ResourceKey: "mana",
			Amount:      c3Const(1000),
		},
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Amount:     &model.GenericFormulaExpr{Op: "read", Path: "source.attr.ad.resolved"},
			Ref:        "op:c3_ad_after_mana",
		},
	}
	done := runCritFixture(t, compileReq, runReq)
	data := firstOriginalDamage(t, done)
	// ad = 100 + 0.01*1000 = 110 after resource_change re-resolve
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-110) > 1e-9 {
		t.Fatalf("ad after resource_change=%v want 110", evidenceDataFloat(data, "mitigatedAmount"))
	}
}
