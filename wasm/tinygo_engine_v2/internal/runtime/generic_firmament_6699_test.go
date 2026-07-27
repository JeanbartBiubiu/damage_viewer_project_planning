package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// item_6699 Voltaic Cyclosword / 电震涡流剑 — Firmament / 苍穹 (ranged precharged ABI).
//
// Numeric authority (League Wiki item manifest only; no DDragon):
//   - revid 4030984
//   - SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
//
// Ranged branch only (explicit non-goals: natural charge rates, Galvanize, melee 15/9%,
// non-champion cap, Web UI):
//   - energized_charge pre-seeded to 100 (no automatic charge gain)
//   - next real primary-target basic_attack_hit:
//       1) arm firmament_lethality_active=1 for 4000ms (refresh_on_write)
//          → attribute modifier adds flat 12 to canonical armor_pen_flat
//       2) bonus physical damage 0.07 * event.target.attr.hp.current
//          (post-triggering-AA emit snapshot; never event.entry_target)
//       3) consume energized_charge → 0
//   - Item base fixture armor_pen_flat=10; same-hit Firmament damage evidences
//     penetrationFlat=22 (10+12) after same-sequence attribute re-resolution
//   - copyable_on_hit=false; Guinsoo phantom neither damages nor re-arms/consumes
//
// Path: CompileGeneric → RunGeneric only.

const (
	firmamentProviderRef = "item:6699_firmament"
	firmamentStableID    = "item_6699"
	firmamentListenerKey = "listener_item_6699_firmament"
	firmamentDamageOpRef = "op:firmament_damage"
	firmamentAAOpRef     = "op:firmament_aa"
	firmamentProbeOpRef  = "op:firmament_probe_phys"
	firmamentProbeKey    = "firmament_probe_phys"
	firmamentReseedKey   = "firmament_reseed_charge"
	firmamentHitEvent    = spellbladeHitEvent
	firmamentChampionRef = spellbladeChampionRef
	firmamentHitAbility  = spellbladeHitAbilityKey

	firmamentChargeKey    = "energized_charge"
	firmamentLethalityKey = "firmament_lethality_active"

	firmamentChargeMax     = 100.0
	firmamentLethalityMax  = 1.0
	firmamentDurationMs    = 4000.0
	firmamentLethalityFlat = 12.0
	firmamentBasePenFlat   = 10.0
	firmamentHPRatio       = 0.07
	firmamentAADamage      = 100.0
	firmamentProbeRaw      = 100.0
	firmamentTargetArmor   = 100.0
	firmamentTargetHP      = 10000.0
	firmamentTol           = 1e-6
)

func firmamentReadyCond() *model.GenericFormulaExpr {
	threshold := firmamentChargeMax
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + firmamentChargeKey},
			{Op: "const", Value: &threshold},
		},
	}
}

func firmamentStateSchema() map[string]interface{} {
	return map[string]interface{}{
		firmamentChargeKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(firmamentChargeMax),
			"durationMs":   float64(0),
		},
		firmamentLethalityKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(firmamentLethalityMax),
			"durationMs":    float64(firmamentDurationMs),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func firmamentPenModifierValue() model.GenericFormulaExpr {
	flat := firmamentLethalityFlat
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &flat},
			{Op: "read", Path: "provider.state." + firmamentLethalityKey},
		},
	}
}

func firmamentModifiers() []model.ModifierDefinition {
	return []model.ModifierDefinition{{
		ModifierKey: "item_6699_firmament_armor_pen_flat",
		Kind:        "attribute",
		Target:      "armor_pen_flat",
		ValuePolicy: "add",
		Value:       firmamentPenModifierValue(),
	}}
}

func firmamentBonusAmount() *model.GenericFormulaExpr {
	ratio := firmamentHPRatio
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &ratio},
			{Op: "read", Path: "event.target.attr.hp.current"},
		},
	}
}

func firmamentHitListener() model.ListenerDefinition {
	zero := 0.0
	one := 1.0
	ready := firmamentReadyCond()
	// Order: arm lethality → damage (observes re-resolved pen) → consume charge.
	return model.ListenerDefinition{
		ListenerKey:  firmamentListenerKey,
		EventMatcher: model.TypeMatcher{All: []string{firmamentHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         firmamentLethalityKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   ready,
			},
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           firmamentDamageOpRef,
				CopyableOnHit: false,
				Condition:     ready,
				Amount:        firmamentBonusAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         firmamentChargeKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   ready,
			},
		},
	}
}

func firmamentEnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "damage/physical", Domain: "damage"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		}
	}
}

func firmamentAAOps() []model.OperationDefinition {
	aa := firmamentAADamage
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        firmamentAAOpRef,
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: firmamentHitEvent,
			Ref:       firmamentHitEvent,
		},
	}
}

func firmamentAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := firmamentAADamage
	one := 1.0
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        firmamentAAOpRef,
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         guinsooStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: firmamentHitEvent,
			Ref:       firmamentHitEvent,
		},
	}
}

func firmamentMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	full := firmamentChargeMax
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        firmamentProviderRef,
		Kind:               "item",
		StableID:           firmamentStableID,
		InitialStateSchema: firmamentStateSchema(),
		Modifiers:          firmamentModifiers(),
		Listeners:          []model.ListenerDefinition{firmamentHitListener()},
		Abilities: []model.AbilityDefinition{{
			AbilityKey: firmamentReseedKey,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{{
				Operation:   "state_change",
				Target:      "source",
				Ref:         firmamentChargeKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &full},
			}},
		}},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: firmamentProviderRef, DefinitionRef: firmamentProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: firmamentProviderRef, DefinitionRef: firmamentProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func firmamentSeedCharge(runReq *model.RunRequest, charge float64) {
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		bag, _ := runReq.InitialSnapshot.Combatants[i].ProviderState[firmamentProviderRef].(map[string]interface{})
		if bag == nil {
			bag = map[string]interface{}{}
		}
		state, _ := bag["state"].(map[string]interface{})
		if state == nil {
			state = map[string]interface{}{}
		}
		state[firmamentChargeKey] = charge
		bag["state"] = state
		runReq.InitialSnapshot.Combatants[i].ProviderState[firmamentProviderRef] = bag
	}
}

func firmamentStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, firmamentProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("firmament state bag missing: %+v", bag)
	}
	v, _ := state[key].(float64)
	return v
}

func firmamentAARef() string {
	return "source.provider[" + firmamentChampionRef + "].ability[" + firmamentHitAbility + "]"
}

func firmamentProbeAbilityRef() string {
	return "source.provider[" + firmamentChampionRef + "].ability[" + firmamentProbeKey + "]"
}

func firmamentReseedAbilityRef() string {
	return "source.provider[" + firmamentProviderRef + "].ability[" + firmamentReseedKey + "]"
}

func firmamentAttachProbe(compileReq *model.CompileRequest) {
	raw := firmamentProbeRaw
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities,
		model.AbilityDefinition{
			AbilityKey: firmamentProbeKey,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Ref:        firmamentProbeOpRef,
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &raw},
			}},
		},
	)
}

func firmamentRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func firmamentLoadFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	firmamentEnsureTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: firmamentHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: firmamentAAOps(),
	}}
	firmamentMountProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_flat", model.AttributeSlotDef{
		Base: firmamentBasePenFlat, Current: firmamentBasePenFlat, Max: firmamentBasePenFlat, Resolved: firmamentBasePenFlat,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: firmamentTargetArmor, Current: firmamentTargetArmor, Max: firmamentTargetArmor, Resolved: firmamentTargetArmor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: firmamentTargetHP, Current: firmamentTargetHP, Max: firmamentTargetHP, Resolved: firmamentTargetHP,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func firmamentSetDriverHits(runReq *model.RunRequest, hits int, prefix string) {
	ref := firmamentAARef()
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   prefix + "_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
}

func firmamentExpectedAAMitigated() float64 {
	// Base pen 10 only (lethality not yet armed on the triggering AA).
	eff := firmamentTargetArmor - firmamentBasePenFlat
	return expectedMitigatedPhysical(firmamentAADamage, eff)
}

func firmamentExpectedRemainingHPAfterAA() float64 {
	return firmamentTargetHP - firmamentExpectedAAMitigated()
}

func firmamentExpectedBonusRaw() float64 {
	return firmamentHPRatio * firmamentExpectedRemainingHPAfterAA()
}

func firmamentExpectedBonusMitigated() float64 {
	eff := firmamentTargetArmor - (firmamentBasePenFlat + firmamentLethalityFlat) // 78
	return expectedMitigatedPhysical(firmamentExpectedBonusRaw(), eff)
}

func firmamentDamageData(t *testing.T, done model.DoneResult) map[string]interface{} {
	t.Helper()
	item := firstDamageEvidenceByOpRef(done, firmamentDamageOpRef)
	if item == nil {
		t.Fatal("missing firmament damage evidence")
	}
	return item.Data
}

// TestGenericFirmament6699SchemaCompiled: charge untimed max100; lethality max1/4000/refresh_on_write.
func TestGenericFirmament6699SchemaCompiled(t *testing.T) {
	compileReq, _ := firmamentLoadFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	var found *compile.CompiledProvider
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey == firmamentProviderRef {
			found = p
			break
		}
	}
	if found == nil {
		t.Fatal("missing firmament provider")
	}
	charge := found.StateFields[firmamentChargeKey]
	if charge.DurationMs != 0 || !charge.HasCap || charge.MaxValue != firmamentChargeMax {
		t.Fatalf("energized_charge field=%+v want untimed max100", charge)
	}
	leth := found.StateFields[firmamentLethalityKey]
	if !leth.HasCap || leth.MaxValue != firmamentLethalityMax || leth.DurationMs != firmamentDurationMs ||
		leth.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("firmament_lethality_active field=%+v want max1/4000/refresh_on_write", leth)
	}
}

// TestGenericFirmament6699PrechargeProcArmPenAndConsume: charge100→proc once; event.target 7% HP;
// arm-before-damage yields penetrationFlat=22; raw+mitigated cross-check; charge→0; second AA no retrigger.
func TestGenericFirmament6699PrechargeProcArmPenAndConsume(t *testing.T) {
	compileReq, runReq := firmamentLoadFixture(t)
	firmamentSeedCharge(&runReq, firmamentChargeMax)
	firmamentSetDriverHits(&runReq, 2, "firm")
	done := firmamentRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, firmamentDamageOpRef, false); n != 1 {
		t.Fatalf("firmament proc count=%d want 1", n)
	}
	wantRaw := firmamentExpectedBonusRaw()
	wantMit := firmamentExpectedBonusMitigated()
	if math.Abs(wantRaw-0.07*firmamentTargetHP) < 1 {
		t.Fatalf("expected remaining-HP raw must differ from entry HP*0.07: raw=%v entry=%v",
			wantRaw, 0.07*firmamentTargetHP)
	}
	if got := sumDamageRawByOpRef(done, firmamentDamageOpRef); math.Abs(got-wantRaw) > firmamentTol {
		t.Fatalf("firmament raw=%v want %v (7%% of post-AA event.target hp)", got, wantRaw)
	}
	if got := sumDamageMitigatedByOpRef(done, firmamentDamageOpRef); math.Abs(got-wantMit) > firmamentTol {
		t.Fatalf("firmament mitigated=%v want %v", got, wantMit)
	}
	data := firmamentDamageData(t, done)
	if math.Abs(evidenceDataFloat(data, "penetrationFlat")-22) > firmamentTol {
		t.Fatalf("penetrationFlat=%v want 22 (base10+temp12; same-sequence re-resolve)",
			evidenceDataFloat(data, "penetrationFlat"))
	}
	if math.Abs(evidenceDataFloat(data, "effectiveResistance")-78) > firmamentTol {
		t.Fatalf("effectiveResistance=%v want 78", evidenceDataFloat(data, "effectiveResistance"))
	}
	if got := firmamentStateValue(t, done, firmamentChargeKey); math.Abs(got) > firmamentTol {
		t.Fatalf("energized_charge after consume=%v want 0", got)
	}
	if got := firmamentStateValue(t, done, firmamentLethalityKey); math.Abs(got-1) > firmamentTol {
		t.Fatalf("firmament_lethality_active=%v want 1 (still within 4000ms)", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_flat"); math.Abs(got-22) > firmamentTol {
		t.Fatalf("armor_pen_flat.resolved=%v want 22", got)
	}
	// Second AA still sees armed +12 (window live); no second Firmament proc.
	aa2Mit := expectedMitigatedPhysical(firmamentAADamage, firmamentTargetArmor-(firmamentBasePenFlat+firmamentLethalityFlat))
	wantDealt := firmamentExpectedAAMitigated() + aa2Mit + wantMit
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > firmamentTol {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestGenericFirmament6699NonReadyNoTrigger: charge below threshold → no Firmament damage/arm/consume.
func TestGenericFirmament6699NonReadyNoTrigger(t *testing.T) {
	compileReq, runReq := firmamentLoadFixture(t)
	firmamentSeedCharge(&runReq, 99)
	firmamentSetDriverHits(&runReq, 1, "nr")
	done := firmamentRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, firmamentDamageOpRef, false); n != 0 {
		t.Fatalf("firmament proc count=%d want 0", n)
	}
	if got := firmamentStateValue(t, done, firmamentChargeKey); math.Abs(got-99) > firmamentTol {
		t.Fatalf("energized_charge=%v want 99 (unchanged)", got)
	}
	if got := firmamentStateValue(t, done, firmamentLethalityKey); math.Abs(got) > firmamentTol {
		t.Fatalf("firmament_lethality_active=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_flat"); math.Abs(got-firmamentBasePenFlat) > firmamentTol {
		t.Fatalf("armor_pen_flat=%v want %v", got, firmamentBasePenFlat)
	}
}

// TestGenericFirmament6699Exact4000msExpiry: armed at t=0; live @3999; expired @4000.
func TestGenericFirmament6699Exact4000msExpiry(t *testing.T) {
	compileReq, runReq := firmamentLoadFixture(t)
	firmamentAttachProbe(&compileReq)
	firmamentSeedCharge(&runReq, firmamentChargeMax)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: firmamentAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "live", AbilityRef: firmamentProbeAbilityRef(), Source: "source", Target: "target", FirstAtMs: 3999},
		{EntryKey: "dead", AbilityRef: firmamentProbeAbilityRef(), Source: "source", Target: "target", FirstAtMs: 4000},
	}
	runReq.StopPolicy.DurationMs = 4100
	done := firmamentRun(t, compileReq, runReq)

	probes := make([]map[string]interface{}, 0, 2)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != firmamentProbeOpRef {
			continue
		}
		if phantom, _ := item.Data["phantom"].(bool); phantom {
			continue
		}
		probes = append(probes, item.Data)
	}
	if len(probes) != 2 {
		t.Fatalf("probe count=%d want 2", len(probes))
	}
	if math.Abs(evidenceDataFloat(probes[0], "penetrationFlat")-22) > firmamentTol {
		t.Fatalf("probe@3999 penetrationFlat=%v want 22", evidenceDataFloat(probes[0], "penetrationFlat"))
	}
	if math.Abs(evidenceDataFloat(probes[0], "effectiveResistance")-78) > firmamentTol {
		t.Fatalf("probe@3999 effectiveResistance=%v want 78", evidenceDataFloat(probes[0], "effectiveResistance"))
	}
	wantLiveMit := expectedMitigatedPhysical(firmamentProbeRaw, 78)
	if math.Abs(evidenceDataFloat(probes[0], "mitigatedAmount")-wantLiveMit) > firmamentTol {
		t.Fatalf("probe@3999 mitigated=%v want %v", evidenceDataFloat(probes[0], "mitigatedAmount"), wantLiveMit)
	}
	if math.Abs(evidenceDataFloat(probes[1], "penetrationFlat")-firmamentBasePenFlat) > firmamentTol {
		t.Fatalf("probe@4000 penetrationFlat=%v want %v (exact expiry)",
			evidenceDataFloat(probes[1], "penetrationFlat"), firmamentBasePenFlat)
	}
	wantDeadMit := expectedMitigatedPhysical(firmamentProbeRaw, firmamentTargetArmor-firmamentBasePenFlat)
	if math.Abs(evidenceDataFloat(probes[1], "mitigatedAmount")-wantDeadMit) > firmamentTol {
		t.Fatalf("probe@4000 mitigated=%v want %v", evidenceDataFloat(probes[1], "mitigatedAmount"), wantDeadMit)
	}
	if got := firmamentStateValue(t, done, firmamentLethalityKey); math.Abs(got) > firmamentTol {
		t.Fatalf("firmament_lethality_active after expiry=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "armor_pen_flat"); math.Abs(got-firmamentBasePenFlat) > firmamentTol {
		t.Fatalf("armor_pen_flat after expiry=%v want %v", got, firmamentBasePenFlat)
	}
}

// TestGenericFirmament6699ExplicitReseedRefresh: re-seed charge mid-run refreshes the 4000ms window.
func TestGenericFirmament6699ExplicitReseedRefresh(t *testing.T) {
	compileReq, runReq := firmamentLoadFixture(t)
	firmamentAttachProbe(&compileReq)
	firmamentSeedCharge(&runReq, firmamentChargeMax)
	// AA@0 arms expireAt=4000; reseed@1000; AA@2000 refresh→expireAt=6000; live@5999 dead@6000.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa1", AbilityRef: firmamentAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "reseed", AbilityRef: firmamentReseedAbilityRef(), Source: "source", Target: "target", FirstAtMs: 1000},
		{EntryKey: "aa2", AbilityRef: firmamentAARef(), Source: "source", Target: "target", FirstAtMs: 2000},
		{EntryKey: "live", AbilityRef: firmamentProbeAbilityRef(), Source: "source", Target: "target", FirstAtMs: 5999},
		{EntryKey: "dead", AbilityRef: firmamentProbeAbilityRef(), Source: "source", Target: "target", FirstAtMs: 6000},
	}
	runReq.StopPolicy.DurationMs = 6100
	done := firmamentRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, firmamentDamageOpRef, false); n != 2 {
		t.Fatalf("firmament proc count=%d want 2 (initial + re-seed)", n)
	}
	if got := firmamentStateValue(t, done, firmamentChargeKey); math.Abs(got) > firmamentTol {
		t.Fatalf("energized_charge=%v want 0 after second consume", got)
	}
	probes := make([]map[string]interface{}, 0, 2)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != firmamentProbeOpRef {
			continue
		}
		if phantom, _ := item.Data["phantom"].(bool); phantom {
			continue
		}
		probes = append(probes, item.Data)
	}
	if len(probes) != 2 {
		t.Fatalf("probe count=%d want 2", len(probes))
	}
	if math.Abs(evidenceDataFloat(probes[0], "penetrationFlat")-22) > firmamentTol {
		t.Fatalf("probe@5999 penetrationFlat=%v want 22 (refreshed window)",
			evidenceDataFloat(probes[0], "penetrationFlat"))
	}
	if math.Abs(evidenceDataFloat(probes[1], "penetrationFlat")-firmamentBasePenFlat) > firmamentTol {
		t.Fatalf("probe@6000 penetrationFlat=%v want %v",
			evidenceDataFloat(probes[1], "penetrationFlat"), firmamentBasePenFlat)
	}
}

// TestGenericFirmament6699PhantomDoesNotExtraConsume: Guinsoo phantom → zero Firmament damage / no second consume.
func TestGenericFirmament6699PhantomDoesNotExtraConsume(t *testing.T) {
	compileReq, runReq := firmamentLoadFixture(t)
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].Operations = firmamentAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{firmamentHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Amount:        &model.GenericFormulaExpr{Op: "const", Value: &copyableAmt},
				CopyableOnHit: true,
				Ref:           "op:guinsoo_copyable",
			}},
		},
		{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{firmamentHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			firmamentChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
			firmamentProviderRef: map[string]interface{}{
				"state": map[string]interface{}{firmamentChargeKey: float64(firmamentChargeMax)},
			},
		}
	}
	firmamentSetDriverHits(&runReq, 1, "ph")
	done := firmamentRun(t, compileReq, runReq)

	if n := countDamageByOpRef(done, firmamentDamageOpRef, false); n != 1 {
		t.Fatalf("original firmament proc=%d want 1", n)
	}
	if n := countPhantomDamageByOpRef(done, firmamentDamageOpRef); n != 0 {
		t.Fatalf("phantom firmament damage=%d want 0", n)
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1 (fixture must fire phantom)", n)
	}
	if got := firmamentStateValue(t, done, firmamentChargeKey); math.Abs(got) > firmamentTol {
		t.Fatalf("charge=%v want 0 (phantom must not re-consume)", got)
	}
}
