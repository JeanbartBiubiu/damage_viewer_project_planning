package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_kayle Q Radiant Blast / 耀焰冲击 (generic ABI, rank-5 primary-target Phase-A).
//
// League Wiki Template:Data Kayle/Radiant Blast
//   revision 4005105
//   SHA256 ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c
//   (normalized/generic/kayle-q.json + raw/kayle-q.wikitext)
//
// Rank-5 Phase-A contract:
//   - Magic damage 180 + 0.60*(ad.resolved-ad.base) + 0.50*ap.resolved
//   - 15% armor and MR reduction for 4000ms; applied AFTER damage
//   - provider-target kayle_q_sundered (default0/max1/4000ms refresh_on_write)
//   - 100 mana; 8000ms cooldown
//
// Explicit Phase-A exclusions (non-goals): slow, portal launch delay, attack-windup
// cast time, projectile travel/collision, cross expansion/secondary targets,
// ranks 1–4, death persistence, live migration/publish/E2E/full fidelity.
//
// Test-only physical/magic probe abilities prove post-shred mitigation; they are
// fixture-only and must not appear in production seed/docs as production ops.

const (
	kayleRadiantBlastProviderRef = "provider_hero_kayle_radiant_blast"
	kayleRadiantBlastStableID    = "hero_kayle_q_radiant_blast"
	kayleRadiantBlastArmorModKey = "kayle_q_sundered_armor"
	kayleRadiantBlastMRModKey    = "kayle_q_sundered_magic_resist"
	kayleRadiantBlastBonusADMod  = "fixture_kayle_q_bonus_ad"
	kayleRadiantBlastStateKey    = "kayle_q_sundered"
	kayleRadiantBlastAbilityKey  = "radiant_blast"
	kayleRadiantBlastPhysProbe   = "kayle_q_physical_probe"
	kayleRadiantBlastMagicProbe  = "kayle_q_magic_probe"
	kayleRadiantBlastDamageOpRef = "op:kayle_q_radiant_blast"
	kayleRadiantBlastPhysOpRef   = "op:kayle_q_physical_probe"
	kayleRadiantBlastMagicOpRef  = "op:kayle_q_magic_probe"

	kayleRadiantBlastBaseDamage = 180.0
	kayleRadiantBlastBonusADRatio = 0.60
	kayleRadiantBlastAPRatio      = 0.50
	kayleRadiantBlastShredPct     = 0.15
	kayleRadiantBlastShredDurMs   = 4000.0
	kayleRadiantBlastManaCost     = 100.0
	kayleRadiantBlastCDMs         = 8000.0

	kayleRadiantBlastADBase     = 100.0
	kayleRadiantBlastADResolved = 140.0
	kayleRadiantBlastFixtureAP  = 100.0
	kayleRadiantBlastFixtureMana = 250.0

	kayleRadiantBlastTargetArmor = 100.0
	kayleRadiantBlastTargetMR    = 100.0
	kayleRadiantBlastTargetHP    = 100000.0
	kayleRadiantBlastProbeRaw    = 100.0

	// 180 + 0.60*(140-100) + 0.50*100 = 180 + 24 + 50 = 254
	kayleRadiantBlastExpectedRaw = 254.0
	kayleRadiantBlastExpectedMit = 127.0 // 254 * 100/(100+100) pre-shred MR
	kayleRadiantBlastShredResist = 85.0  // 100 * (1 - 0.15)
	kayleRadiantBlastManaAfter1  = 150.0 // 250 - 100
	kayleRadiantBlastManaAfter2  = 50.0  // 250 - 100 - 100
)

func kayleRadiantBlastTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func kayleRadiantBlastStateSchema() map[string]interface{} {
	return map[string]interface{}{
		kayleRadiantBlastStateKey: kayleRadiantBlastTimedSlot(0, 1, kayleRadiantBlastShredDurMs),
	}
}

func kayleRadiantBlastResistModifier(modKey, target string) model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: modKey,
		Kind:        "attribute",
		Target:      target,
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(-kayleRadiantBlastShredPct),
				{Op: "read", Path: "provider.target_state." + kayleRadiantBlastStateKey},
			},
		},
	}
}

func kayleRadiantBlastDamageAmount() *model.GenericFormulaExpr {
	base := kayleRadiantBlastBaseDamage
	bonusRatio := kayleRadiantBlastBonusADRatio
	apRatio := kayleRadiantBlastAPRatio
	// Nested binary add: base + bonusAD + AP (generic add is binary-only).
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &base},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &bonusRatio},
							{
								Op: "sub",
								Args: []model.GenericFormulaExpr{
									{Op: "read", Path: "source.attr.ad.resolved"},
									{Op: "read", Path: "source.attr.ad.base"},
								},
							},
						},
					},
				},
			},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &apRatio},
					{Op: "read", Path: "source.attr.ap.resolved"},
				},
			},
		},
	}
}

func kayleRadiantBlastQAbility() model.AbilityDefinition {
	cost := kayleRadiantBlastManaCost
	cd := kayleRadiantBlastCDMs
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: kayleRadiantBlastAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Wiki notes: resistance reduction applied after damage → damage then state.
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/magic",
				Ref:        kayleRadiantBlastDamageOpRef,
				Amount:     kayleRadiantBlastDamageAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         kayleRadiantBlastStateKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

// Test-only probes — not production operations.
func kayleRadiantBlastPhysProbeAbility() model.AbilityDefinition {
	raw := kayleRadiantBlastProbeRaw
	return model.AbilityDefinition{
		AbilityKey: kayleRadiantBlastPhysProbe,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &raw},
				Ref:        kayleRadiantBlastPhysOpRef,
			},
		},
	}
}

func kayleRadiantBlastMagicProbeAbility() model.AbilityDefinition {
	raw := kayleRadiantBlastProbeRaw
	return model.AbilityDefinition{
		AbilityKey: kayleRadiantBlastMagicProbe,
		Kind:       "active",
		Types:      []string{},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/magic",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &raw},
				Ref:        kayleRadiantBlastMagicOpRef,
			},
		},
	}
}

func kayleRadiantBlastProviderDef() model.ProviderDefinition {
	bonusAD := kayleRadiantBlastADResolved - kayleRadiantBlastADBase
	return model.ProviderDefinition{
		ProviderKey:        kayleRadiantBlastProviderRef,
		Kind:               "passive",
		StableID:           kayleRadiantBlastStableID,
		InitialStateSchema: kayleRadiantBlastStateSchema(),
		Modifiers: []model.ModifierDefinition{
			// Fixture-only flat AD so ad.base stays 100 while ad.resolved becomes 140.
			{
				ModifierKey: kayleRadiantBlastBonusADMod,
				Kind:        "attribute",
				Target:      "ad",
				ValuePolicy: "add",
				Value:       gfConst(bonusAD),
			},
			kayleRadiantBlastResistModifier(kayleRadiantBlastArmorModKey, "opponent.attr.armor"),
			kayleRadiantBlastResistModifier(kayleRadiantBlastMRModKey, "opponent.attr.magic_resist"),
		},
		Abilities: []model.AbilityDefinition{
			kayleRadiantBlastQAbility(),
			kayleRadiantBlastPhysProbeAbility(),
			kayleRadiantBlastMagicProbeAbility(),
		},
	}
}

func ensureKayleRadiantBlastTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
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

func mountKayleRadiantBlastProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, kayleRadiantBlastProviderDef())
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: kayleRadiantBlastProviderRef, DefinitionRef: kayleRadiantBlastProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: kayleRadiantBlastProviderRef, DefinitionRef: kayleRadiantBlastProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func kayleRadiantBlastQRef() string {
	return "source.provider[" + kayleRadiantBlastProviderRef + "].ability[" + kayleRadiantBlastAbilityKey + "]"
}

func kayleRadiantBlastPhysProbeRef() string {
	return "source.provider[" + kayleRadiantBlastProviderRef + "].ability[" + kayleRadiantBlastPhysProbe + "]"
}

func kayleRadiantBlastMagicProbeRef() string {
	return "source.provider[" + kayleRadiantBlastProviderRef + "].ability[" + kayleRadiantBlastMagicProbe + "]"
}

func loadKayleRadiantBlastFixture(t *testing.T, mount bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	if mount {
		ensureKayleRadiantBlastTypes(&compileReq)
		mountKayleRadiantBlastProvider(&compileReq, &runReq)
	}

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: kayleRadiantBlastADBase, Current: kayleRadiantBlastADBase,
		Max: kayleRadiantBlastADBase, Resolved: kayleRadiantBlastADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: kayleRadiantBlastFixtureAP, Current: kayleRadiantBlastFixtureAP,
		Max: kayleRadiantBlastFixtureAP, Resolved: kayleRadiantBlastFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: kayleRadiantBlastFixtureMana, Max: kayleRadiantBlastFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: kayleRadiantBlastTargetHP, Current: kayleRadiantBlastTargetHP,
		Max: kayleRadiantBlastTargetHP, Resolved: kayleRadiantBlastTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: kayleRadiantBlastTargetArmor, Current: kayleRadiantBlastTargetArmor,
		Max: kayleRadiantBlastTargetArmor, Resolved: kayleRadiantBlastTargetArmor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: kayleRadiantBlastTargetMR, Current: kayleRadiantBlastTargetMR,
		Max: kayleRadiantBlastTargetMR, Resolved: kayleRadiantBlastTargetMR,
	})

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runKayleRadiantBlast(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func assertKayleRadiantBlastProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var found *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == kayleRadiantBlastProviderRef {
			found = p
			break
		}
	}
	if found == nil {
		t.Fatal("provider_hero_kayle_radiant_blast missing from SharedProviders")
	}

	schema, ok := found.InitialStateSchema[kayleRadiantBlastStateKey].(map[string]interface{})
	if !ok {
		t.Fatalf("initialStateSchema missing %s: %+v", kayleRadiantBlastStateKey, found.InitialStateSchema)
	}
	if schema["refreshPolicy"] != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%v want %v", schema["refreshPolicy"], model.ProviderStateRefreshOnWrite)
	}
	if math.Abs(schema["defaultValue"].(float64)) > 1e-12 || math.Abs(schema["maxValue"].(float64)-1) > 1e-12 {
		t.Fatalf("state default/max=%v/%v want 0/1", schema["defaultValue"], schema["maxValue"])
	}
	if math.Abs(schema["durationMs"].(float64)-kayleRadiantBlastShredDurMs) > 1e-12 {
		t.Fatalf("durationMs=%v want %v", schema["durationMs"], kayleRadiantBlastShredDurMs)
	}

	if len(found.Modifiers) != 3 {
		t.Fatalf("modifiers=%d want 3 (fixture bonus AD + armor + MR)", len(found.Modifiers))
	}
	armorMod := found.Modifiers[1]
	mrMod := found.Modifiers[2]
	if armorMod.Target != "opponent.attr.armor" || armorMod.ValuePolicy != "percent_add" {
		t.Fatalf("armor modifier=%+v want opponent.attr.armor percent_add", armorMod)
	}
	if mrMod.Target != "opponent.attr.magic_resist" || mrMod.ValuePolicy != "percent_add" {
		t.Fatalf("MR modifier=%+v want opponent.attr.magic_resist percent_add", mrMod)
	}
	for _, mod := range []model.ModifierDefinition{armorMod, mrMod} {
		if mod.Value.Op != "mul" || len(mod.Value.Args) != 2 {
			t.Fatalf("resist modifier value=%+v want mul(-0.15, target_state)", mod.Value)
		}
		if mod.Value.Args[0].Op != "const" || mod.Value.Args[0].Value == nil ||
			math.Abs(*mod.Value.Args[0].Value-(-kayleRadiantBlastShredPct)) > 1e-12 {
			t.Fatalf("resist shred const=%+v want -0.15", mod.Value.Args[0])
		}
		if mod.Value.Args[1].Op != "read" ||
			mod.Value.Args[1].Path != "provider.target_state."+kayleRadiantBlastStateKey {
			t.Fatalf("resist read path=%+v", mod.Value.Args[1])
		}
	}

	var q *model.AbilityDefinition
	for i := range found.Abilities {
		if found.Abilities[i].AbilityKey == kayleRadiantBlastAbilityKey {
			q = &found.Abilities[i]
			break
		}
	}
	if q == nil {
		t.Fatal("active Q ability radiant_blast missing")
	}
	if q.Kind != "active" {
		t.Fatalf("Q kind=%q want active", q.Kind)
	}
	if q.Cost == nil || q.Cost.ResourceKey != "mana" ||
		q.Cost.Amount.Op != "const" || q.Cost.Amount.Value == nil ||
		math.Abs(*q.Cost.Amount.Value-kayleRadiantBlastManaCost) > 1e-12 {
		t.Fatalf("Q cost=%+v want mana const 100", q.Cost)
	}
	if q.Cooldown == nil || q.Cooldown.DurationMs.Op != "const" || q.Cooldown.DurationMs.Value == nil ||
		math.Abs(*q.Cooldown.DurationMs.Value-kayleRadiantBlastCDMs) > 1e-12 {
		t.Fatalf("Q cooldown=%+v want const 8000", q.Cooldown)
	}
	if len(q.Operations) != 2 {
		t.Fatalf("Q operations=%d want 2 (damage then state_change)", len(q.Operations))
	}
	if q.Operations[0].Operation != "damage" || q.Operations[0].DamageType != "damage/magic" {
		t.Fatalf("op[0]=%+v want damage/magic first (shred after damage)", q.Operations[0])
	}
	if q.Operations[1].Operation != "state_change" ||
		q.Operations[1].ValuePolicy != "override" ||
		len(q.Operations[1].Types) != 1 ||
		q.Operations[1].Types[0] != "state_scope/provider_target" {
		t.Fatalf("op[1]=%+v want state_change source/provider_target override", q.Operations[1])
	}
	for _, op := range q.Operations {
		if op.Operation == "slow" || op.Operation == "projectile" || op.Operation == "multi_target" {
			t.Fatalf("Q must not include slow/projectile/multi_target op: %+v", op)
		}
	}
}

func kayleRadiantBlastSourceMana(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Resources["mana"]
		if !ok {
			t.Fatal("source mana missing")
		}
		return slot.Current
	}
	t.Fatal("source missing")
	return 0
}

func kayleRadiantBlastTargetState(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[kayleRadiantBlastProviderRef].(map[string]interface{})
		if !ok {
			return 0
		}
		ts, ok := bag["targetState"].(map[string]interface{})
		if !ok {
			return 0
		}
		values, ok := ts["values"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := values[kayleRadiantBlastStateKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func kayleRadiantBlastSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func kayleRadiantBlastDamageByOpRef(done model.DoneResult, opRef string) (raw, mitigated float64, n int) {
	for _, item := range damageEvidenceItems(done) {
		if item.Ref != opRef && evidenceDataString(item.Data, "operationRef") != opRef {
			continue
		}
		n++
		raw += evidenceDataFloat(item.Data, "rawAmount")
		mitigated += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	return raw, mitigated, n
}

// TestKayleRadiantBlastRank5RawCrossCheck: independent numeric cross-check
// AD base100 / resolved140 / AP100 → raw Q = 254.
func TestKayleRadiantBlastRank5RawCrossCheck(t *testing.T) {
	bonusAD := kayleRadiantBlastADResolved - kayleRadiantBlastADBase
	want := kayleRadiantBlastBaseDamage +
		kayleRadiantBlastBonusADRatio*bonusAD +
		kayleRadiantBlastAPRatio*kayleRadiantBlastFixtureAP
	if math.Abs(want-kayleRadiantBlastExpectedRaw) > 1e-12 {
		t.Fatalf("formula=%v want %v", want, kayleRadiantBlastExpectedRaw)
	}
	if math.Abs(want-254.0) > 1e-12 {
		t.Fatalf("raw Q=%v want 254", want)
	}
}

// TestKayleRadiantBlastCompileRunProviderShape: CompileGeneric → RunGeneric;
// provider/state/modifiers/ability shape is exact; Q ops are damage then state
// with no slow/projectile/multi-target.
func TestKayleRadiantBlastCompileRunProviderShape(t *testing.T) {
	compileReq, runReq := loadKayleRadiantBlastFixture(t, true)
	assertKayleRadiantBlastProviderShape(t, compileReq)
	done := runKayleRadiantBlast(t, compileReq, runReq)

	gotAD := sourceAttrResolved(t, done.FinalSnapshot, "ad")
	if math.Abs(gotAD-kayleRadiantBlastADResolved) > 1e-9 {
		t.Fatalf("ad.resolved=%v want %v (base %v + fixture bonus)",
			gotAD, kayleRadiantBlastADResolved, kayleRadiantBlastADBase)
	}
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("sourceDamageDealt=%v want 0 (no Q cast in shape-only fixture)", done.Summary.SourceDamageDealt)
	}
}

// TestKayleRadiantBlastRank5ActiveHitShredCostCD: focused CompileGeneric+RunGeneric
// proof for Wiki rank-5 Phase-A — pre-shred Q magic, physical+magic probes under
// 15% shred, exact 4000ms resistance restore, mana −100, CD 8000ms gate.
func TestKayleRadiantBlastRank5ActiveHitShredCostCD(t *testing.T) {
	compileReq, runReq := loadKayleRadiantBlastFixture(t, true)
	assertKayleRadiantBlastProviderShape(t, compileReq)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q1", AbilityRef: kayleRadiantBlastQRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_phys_shred", AbilityRef: kayleRadiantBlastPhysProbeRef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "probe_magic_shred", AbilityRef: kayleRadiantBlastMagicProbeRef(), Source: "source", Target: "target", FirstAtMs: 200},
		{EntryKey: "q_early", AbilityRef: kayleRadiantBlastQRef(), Source: "source", Target: "target", FirstAtMs: 500},
		{EntryKey: "probe_phys_expire", AbilityRef: kayleRadiantBlastPhysProbeRef(), Source: "source", Target: "target", FirstAtMs: 4000},
		{EntryKey: "probe_magic_expire", AbilityRef: kayleRadiantBlastMagicProbeRef(), Source: "source", Target: "target", FirstAtMs: 4000},
		{EntryKey: "q2", AbilityRef: kayleRadiantBlastQRef(), Source: "source", Target: "target", FirstAtMs: 8000},
	}
	runReq.StopPolicy.DurationMs = 8100
	done := runKayleRadiantBlast(t, compileReq, runReq)

	qRaw, qMit, qN := kayleRadiantBlastDamageByOpRef(done, kayleRadiantBlastDamageOpRef)
	if qN != 2 {
		t.Fatalf("Q magic damages=%d want 2 (t=0 and t=8000)", qN)
	}
	if math.Abs(qRaw-2*kayleRadiantBlastExpectedRaw) > 1e-9 {
		t.Fatalf("Q raw sum=%v want %v", qRaw, 2*kayleRadiantBlastExpectedRaw)
	}
	if math.Abs(qMit-2*kayleRadiantBlastExpectedMit) > 1e-9 {
		t.Fatalf("Q mitigated sum=%v want %v (pre-shred MR)", qMit, 2*kayleRadiantBlastExpectedMit)
	}

	wantProbeShredPhys := expectedMitigatedPhysical(kayleRadiantBlastProbeRaw, kayleRadiantBlastShredResist)
	wantProbeFullPhys := expectedMitigatedPhysical(kayleRadiantBlastProbeRaw, kayleRadiantBlastTargetArmor)
	wantProbeShredMagic := expectedMitigatedMagic(kayleRadiantBlastProbeRaw, kayleRadiantBlastShredResist)
	wantProbeFullMagic := expectedMitigatedMagic(kayleRadiantBlastProbeRaw, kayleRadiantBlastTargetMR)

	physProbes := make([]model.EvidenceItem, 0, 2)
	magicProbes := make([]model.EvidenceItem, 0, 2)
	for _, item := range damageEvidenceItems(done) {
		opRef := evidenceDataString(item.Data, "operationRef")
		if opRef == "" {
			opRef = item.Ref
		}
		switch opRef {
		case kayleRadiantBlastPhysOpRef:
			physProbes = append(physProbes, item)
		case kayleRadiantBlastMagicOpRef:
			magicProbes = append(magicProbes, item)
		}
	}
	if len(physProbes) != 2 {
		t.Fatalf("physical probes=%d want 2", len(physProbes))
	}
	if len(magicProbes) != 2 {
		t.Fatalf("magic probes=%d want 2", len(magicProbes))
	}
	if math.Abs(evidenceDataFloat(physProbes[0].Data, "mitigatedAmount")-wantProbeShredPhys) > 1e-6 {
		t.Fatalf("phys probe@100 mitigated=%v want %v (15%% armor shred → 85)",
			evidenceDataFloat(physProbes[0].Data, "mitigatedAmount"), wantProbeShredPhys)
	}
	if math.Abs(evidenceDataFloat(magicProbes[0].Data, "mitigatedAmount")-wantProbeShredMagic) > 1e-6 {
		t.Fatalf("magic probe@200 mitigated=%v want %v (15%% MR shred → 85)",
			evidenceDataFloat(magicProbes[0].Data, "mitigatedAmount"), wantProbeShredMagic)
	}
	if math.Abs(evidenceDataFloat(physProbes[1].Data, "mitigatedAmount")-wantProbeFullPhys) > 1e-6 {
		t.Fatalf("phys probe@4000 mitigated=%v want %v (armor restored exactly at 4000ms)",
			evidenceDataFloat(physProbes[1].Data, "mitigatedAmount"), wantProbeFullPhys)
	}
	if math.Abs(evidenceDataFloat(magicProbes[1].Data, "mitigatedAmount")-wantProbeFullMagic) > 1e-6 {
		t.Fatalf("magic probe@4000 mitigated=%v want %v (MR restored exactly at 4000ms)",
			evidenceDataFloat(magicProbes[1].Data, "mitigatedAmount"), wantProbeFullMagic)
	}

	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	mr := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "magic_resist")
	// After q2 at 8000, shred is re-armed; final snapshot still within 4000ms of q2.
	if math.Abs(armor-kayleRadiantBlastShredResist) > 1e-9 {
		t.Fatalf("final armor=%v want %v (shred re-armed by q2)", armor, kayleRadiantBlastShredResist)
	}
	if math.Abs(mr-kayleRadiantBlastShredResist) > 1e-9 {
		t.Fatalf("final MR=%v want %v (shred re-armed by q2)", mr, kayleRadiantBlastShredResist)
	}
	if got := kayleRadiantBlastTargetState(t, done.FinalSnapshot); got != 1 {
		t.Fatalf("kayle_q_sundered=%v want 1 after q2", got)
	}

	if kayleRadiantBlastSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for early Q during 8000ms CD")
	}
	if done.Summary.AbilityCastCount != 6 {
		// 2 Q + 2 phys probes + 2 magic probes; early Q skipped
		t.Fatalf("abilityCastCount=%d want 6 (2 Q + 4 probes; early Q skipped)", done.Summary.AbilityCastCount)
	}
	if got := kayleRadiantBlastSourceMana(t, done.FinalSnapshot); math.Abs(got-kayleRadiantBlastManaAfter2) > 1e-9 {
		t.Fatalf("mana=%v want %v (two successful Q casts; early skipped)", got, kayleRadiantBlastManaAfter2)
	}
}

// TestKayleRadiantBlastFirstQThenShredResistances: after first Q, armor/MR resolve to 85
// while Q itself used pre-shred MR.
func TestKayleRadiantBlastFirstQThenShredResistances(t *testing.T) {
	compileReq, runReq := loadKayleRadiantBlastFixture(t, true)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q1", AbilityRef: kayleRadiantBlastQRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runKayleRadiantBlast(t, compileReq, runReq)

	qRaw, qMit, qN := kayleRadiantBlastDamageByOpRef(done, kayleRadiantBlastDamageOpRef)
	if qN != 1 {
		t.Fatalf("Q damages=%d want 1", qN)
	}
	if math.Abs(qRaw-kayleRadiantBlastExpectedRaw) > 1e-9 {
		t.Fatalf("Q raw=%v want %v", qRaw, kayleRadiantBlastExpectedRaw)
	}
	if math.Abs(qMit-kayleRadiantBlastExpectedMit) > 1e-9 {
		t.Fatalf("Q mitigated=%v want %v (pre-shred MR 100)", qMit, kayleRadiantBlastExpectedMit)
	}

	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	mr := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "magic_resist")
	if math.Abs(armor-kayleRadiantBlastShredResist) > 1e-9 {
		t.Fatalf("armor after Q=%v want %v", armor, kayleRadiantBlastShredResist)
	}
	if math.Abs(mr-kayleRadiantBlastShredResist) > 1e-9 {
		t.Fatalf("MR after Q=%v want %v", mr, kayleRadiantBlastShredResist)
	}
	if got := kayleRadiantBlastTargetState(t, done.FinalSnapshot); got != 1 {
		t.Fatalf("kayle_q_sundered=%v want 1", got)
	}
	if got := kayleRadiantBlastSourceMana(t, done.FinalSnapshot); math.Abs(got-kayleRadiantBlastManaAfter1) > 1e-9 {
		t.Fatalf("mana=%v want %v", got, kayleRadiantBlastManaAfter1)
	}
}
