package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_kogmaw Q Caustic Spittle / 腐蚀唾液 (generic ABI, rank-5).
//
// League Wiki Template:Data Kog'Maw/Caustic Spittle
//   revision 3960434
//   SHA256 f651035612e1deeda77df641f5a0e21226ec74aeb4633e0f211780efc3f39a7d
//   (normalized/generic/kogmaw-q.json + raw/kogmaw-q.wikitext)
//
// Rank-5 contract:
//   - Passive: permanent +25% attack_speed (percent_add 0.25)
//   - Active: 260 + 0.90*AP magic damage; 32% armor and MR reduction for 4000ms;
//     7000ms cooldown; 40 mana; Effect at cast time start → damage then shred
//
// Explicit non-goals: projectile travel / target selection, ranks 1–4,
// multi-target / web, live publish.

const (
	kogmawCausticSpittleProviderRef = "provider_hero_kogmaw_caustic_spittle"
	kogmawCausticSpittleStableID    = "hero_kogmaw_q_caustic_spittle"
	kogmawCausticSpittleModKey      = "kogmaw_q_caustic_spittle_attack_speed"
	kogmawCausticSpittleArmorModKey = "kogmaw_q_resist_reduction_armor"
	kogmawCausticSpittleMRModKey    = "kogmaw_q_resist_reduction_magic_resist"
	kogmawCausticSpittleStateKey    = "kogmaw_q_resist_reduction"
	kogmawCausticSpittleAbilityKey  = "caustic_spittle"
	kogmawCausticSpittleProbeKey    = "kogmaw_q_physical_probe"
	kogmawCausticSpittleDamageOpRef = "op:kogmaw_q_caustic_spittle"
	kogmawCausticSpittleProbeOpRef  = "op:kogmaw_q_physical_probe"

	kogmawCausticSpittleASBonus    = 0.25
	kogmawCausticSpittleASBase     = 0.72
	kogmawCausticSpittleASResolved = 0.90 // 0.72 * (1 + 0.25)

	kogmawCausticSpittleBaseDamage  = 260.0
	kogmawCausticSpittleAPRatio     = 0.90
	kogmawCausticSpittleShredPct    = 0.32
	kogmawCausticSpittleShredDurMs  = 4000.0
	kogmawCausticSpittleManaCost    = 40.0
	kogmawCausticSpittleCDMs        = 7000.0
	kogmawCausticSpittleFixtureAP   = 100.0
	kogmawCausticSpittleFixtureMana = 100.0
	kogmawCausticSpittleTargetArmor = 100.0
	kogmawCausticSpittleTargetMR    = 100.0
	kogmawCausticSpittleTargetHP    = 100000.0
	kogmawCausticSpittleProbeRaw    = 100.0

	kogmawCausticSpittleExpectedRaw = 350.0 // 260 + 0.90*100
	kogmawCausticSpittleExpectedMit = 175.0 // 350 * 100/(100+100) pre-shred MR
	kogmawCausticSpittleShredArmor  = 68.0  // 100 * (1 - 0.32)
	kogmawCausticSpittleManaAfter1  = 60.0  // 100 - 40
	kogmawCausticSpittleManaAfter2  = 20.0  // 100 - 40 - 40
)

func kogmawCausticSpittleTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func kogmawCausticSpittleStateSchema() map[string]interface{} {
	return map[string]interface{}{
		kogmawCausticSpittleStateKey: kogmawCausticSpittleTimedSlot(0, 1, kogmawCausticSpittleShredDurMs),
	}
}

func kogmawCausticSpittleASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: kogmawCausticSpittleModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value:       gfConst(kogmawCausticSpittleASBonus),
	}
}

func kogmawCausticSpittleResistModifier(modKey, target string) model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: modKey,
		Kind:        "attribute",
		Target:      target,
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(-kogmawCausticSpittleShredPct),
				{Op: "read", Path: "provider.target_state." + kogmawCausticSpittleStateKey},
			},
		},
	}
}

func kogmawCausticSpittleDamageAmount() *model.GenericFormulaExpr {
	base := kogmawCausticSpittleBaseDamage
	ratio := kogmawCausticSpittleAPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{Op: "read", Path: "source.attr.ap.resolved"},
				},
			},
		},
	}
}

func kogmawCausticSpittleQAbility() model.AbilityDefinition {
	cost := kogmawCausticSpittleManaCost
	cd := kogmawCausticSpittleCDMs
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: kogmawCausticSpittleAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Wiki: Effect at cast time start → damage first, then shred state.
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/magic",
				Ref:        kogmawCausticSpittleDamageOpRef,
				Amount:     kogmawCausticSpittleDamageAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         kogmawCausticSpittleStateKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func kogmawCausticSpittleProbeAbility() model.AbilityDefinition {
	raw := kogmawCausticSpittleProbeRaw
	return model.AbilityDefinition{
		AbilityKey: kogmawCausticSpittleProbeKey,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &raw},
				Ref:        kogmawCausticSpittleProbeOpRef,
			},
		},
	}
}

func kogmawCausticSpittleProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        kogmawCausticSpittleProviderRef,
		Kind:               "passive",
		StableID:           kogmawCausticSpittleStableID,
		InitialStateSchema: kogmawCausticSpittleStateSchema(),
		Modifiers: []model.ModifierDefinition{
			kogmawCausticSpittleASModifier(),
			kogmawCausticSpittleResistModifier(kogmawCausticSpittleArmorModKey, "opponent.attr.armor"),
			kogmawCausticSpittleResistModifier(kogmawCausticSpittleMRModKey, "opponent.attr.magic_resist"),
		},
		Abilities: []model.AbilityDefinition{
			kogmawCausticSpittleQAbility(),
			kogmawCausticSpittleProbeAbility(),
		},
	}
}

func ensureKogmawCausticSpittleTypes(req *model.CompileRequest) {
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

func mountKogmawCausticSpittleProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, kogmawCausticSpittleProviderDef())
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: kogmawCausticSpittleProviderRef, DefinitionRef: kogmawCausticSpittleProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: kogmawCausticSpittleProviderRef, DefinitionRef: kogmawCausticSpittleProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func kogmawCausticSpittleQRef() string {
	return "source.provider[" + kogmawCausticSpittleProviderRef + "].ability[" + kogmawCausticSpittleAbilityKey + "]"
}

func kogmawCausticSpittleProbeRef() string {
	return "source.provider[" + kogmawCausticSpittleProviderRef + "].ability[" + kogmawCausticSpittleProbeKey + "]"
}

func loadKogmawCausticSpittleFixture(t *testing.T, mount bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	if mount {
		ensureKogmawCausticSpittleTypes(&compileReq)
		mountKogmawCausticSpittleProvider(&compileReq, &runReq)
	}

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: kogmawCausticSpittleASBase, Current: kogmawCausticSpittleASBase,
		Max: kogmawCausticSpittleASBase, Resolved: kogmawCausticSpittleASBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: kogmawCausticSpittleFixtureAP, Current: kogmawCausticSpittleFixtureAP,
		Max: kogmawCausticSpittleFixtureAP, Resolved: kogmawCausticSpittleFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: kogmawCausticSpittleFixtureMana, Max: kogmawCausticSpittleFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: kogmawCausticSpittleTargetHP, Current: kogmawCausticSpittleTargetHP,
		Max: kogmawCausticSpittleTargetHP, Resolved: kogmawCausticSpittleTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: kogmawCausticSpittleTargetArmor, Current: kogmawCausticSpittleTargetArmor,
		Max: kogmawCausticSpittleTargetArmor, Resolved: kogmawCausticSpittleTargetArmor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: kogmawCausticSpittleTargetMR, Current: kogmawCausticSpittleTargetMR,
		Max: kogmawCausticSpittleTargetMR, Resolved: kogmawCausticSpittleTargetMR,
	})

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runKogmawCausticSpittle(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func assertKogmawCausticSpittleProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var found *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == kogmawCausticSpittleProviderRef {
			found = p
			break
		}
	}
	if found == nil {
		t.Fatal("provider_hero_kogmaw_caustic_spittle missing from SharedProviders")
	}

	schema, ok := found.InitialStateSchema[kogmawCausticSpittleStateKey].(map[string]interface{})
	if !ok {
		t.Fatalf("initialStateSchema missing %s: %+v", kogmawCausticSpittleStateKey, found.InitialStateSchema)
	}
	if schema["refreshPolicy"] != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%v want %v", schema["refreshPolicy"], model.ProviderStateRefreshOnWrite)
	}
	if math.Abs(schema["defaultValue"].(float64)) > 1e-12 || math.Abs(schema["maxValue"].(float64)-1) > 1e-12 {
		t.Fatalf("state default/max=%v/%v want 0/1", schema["defaultValue"], schema["maxValue"])
	}
	if math.Abs(schema["durationMs"].(float64)-kogmawCausticSpittleShredDurMs) > 1e-12 {
		t.Fatalf("durationMs=%v want %v", schema["durationMs"], kogmawCausticSpittleShredDurMs)
	}

	if len(found.Modifiers) != 3 {
		t.Fatalf("modifiers=%d want 3 (AS + armor + MR)", len(found.Modifiers))
	}
	asMod := found.Modifiers[0]
	if asMod.Kind != "attribute" || asMod.Target != "attack_speed" || asMod.ValuePolicy != "percent_add" {
		t.Fatalf("AS modifier shape=%+v want attribute/attack_speed/percent_add", asMod)
	}
	if asMod.Value.Op != "const" || asMod.Value.Value == nil || math.Abs(*asMod.Value.Value-kogmawCausticSpittleASBonus) > 1e-12 {
		t.Fatalf("AS modifier value=%+v want const 0.25", asMod.Value)
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
			t.Fatalf("resist modifier value=%+v want mul(-0.32, target_state)", mod.Value)
		}
		if mod.Value.Args[0].Op != "const" || mod.Value.Args[0].Value == nil ||
			math.Abs(*mod.Value.Args[0].Value-(-kogmawCausticSpittleShredPct)) > 1e-12 {
			t.Fatalf("resist shred const=%+v want -0.32", mod.Value.Args[0])
		}
		if mod.Value.Args[1].Op != "read" ||
			mod.Value.Args[1].Path != "provider.target_state."+kogmawCausticSpittleStateKey {
			t.Fatalf("resist read path=%+v", mod.Value.Args[1])
		}
	}

	var q *model.AbilityDefinition
	for i := range found.Abilities {
		if found.Abilities[i].AbilityKey == kogmawCausticSpittleAbilityKey {
			q = &found.Abilities[i]
			break
		}
	}
	if q == nil {
		t.Fatal("active Q ability caustic_spittle missing")
	}
	if q.Kind != "active" {
		t.Fatalf("Q kind=%q want active", q.Kind)
	}
	if q.Cost == nil || q.Cost.ResourceKey != "mana" ||
		q.Cost.Amount.Op != "const" || q.Cost.Amount.Value == nil ||
		math.Abs(*q.Cost.Amount.Value-kogmawCausticSpittleManaCost) > 1e-12 {
		t.Fatalf("Q cost=%+v want mana const 40", q.Cost)
	}
	if q.Cooldown == nil || q.Cooldown.DurationMs.Op != "const" || q.Cooldown.DurationMs.Value == nil ||
		math.Abs(*q.Cooldown.DurationMs.Value-kogmawCausticSpittleCDMs) > 1e-12 {
		t.Fatalf("Q cooldown=%+v want const 7000", q.Cooldown)
	}
	if len(q.Operations) != 2 {
		t.Fatalf("Q operations=%d want 2 (damage then state_change)", len(q.Operations))
	}
	if q.Operations[0].Operation != "damage" || q.Operations[0].DamageType != "damage/magic" {
		t.Fatalf("op[0]=%+v want damage/magic first (cast-time-start)", q.Operations[0])
	}
	if q.Operations[1].Operation != "state_change" ||
		q.Operations[1].ValuePolicy != "override" ||
		len(q.Operations[1].Types) != 1 ||
		q.Operations[1].Types[0] != "state_scope/provider_target" {
		t.Fatalf("op[1]=%+v want state_change source/provider_target override", q.Operations[1])
	}
}

func kogmawCausticSpittleSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func kogmawCausticSpittleTargetState(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[kogmawCausticSpittleProviderRef].(map[string]interface{})
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
		v, _ := values[kogmawCausticSpittleStateKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func kogmawCausticSpittleSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func kogmawCausticSpittleDamageByOpRef(done model.DoneResult, opRef string) (raw, mitigated float64, n int) {
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

// TestKogmawCausticSpittleRank5ASCrossCheck: independent numeric cross-check
// base AS 0.72 * (1 + 0.25) = 0.90.
func TestKogmawCausticSpittleRank5ASCrossCheck(t *testing.T) {
	want := kogmawCausticSpittleASBase * (1 + kogmawCausticSpittleASBonus)
	if math.Abs(want-kogmawCausticSpittleASResolved) > 1e-12 {
		t.Fatalf("formula=%v want %v", want, kogmawCausticSpittleASResolved)
	}
	if math.Abs(want-0.90) > 1e-12 {
		t.Fatalf("resolved AS=%v want 0.90", want)
	}
}

// TestKogmawCausticSpittleRank5PermanentAS: mount provider → resolved AS 0.90;
// provider shape includes retained AS + active Q shred contract.
func TestKogmawCausticSpittleRank5PermanentAS(t *testing.T) {
	compileReq, runReq := loadKogmawCausticSpittleFixture(t, true)
	assertKogmawCausticSpittleProviderShape(t, compileReq)
	done := runKogmawCausticSpittle(t, compileReq, runReq)

	got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")
	if math.Abs(got-kogmawCausticSpittleASResolved) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v (base %v +25%% percent_add)",
			got, kogmawCausticSpittleASResolved, kogmawCausticSpittleASBase)
	}
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("sourceDamageDealt=%v want 0 (no Q cast in AS-only fixture)", done.Summary.SourceDamageDealt)
	}
}

// TestKogmawCausticSpittleWithoutMountKeepsBaseAS: no provider → AS stays 0.72.
func TestKogmawCausticSpittleWithoutMountKeepsBaseAS(t *testing.T) {
	compileReq, runReq := loadKogmawCausticSpittleFixture(t, false)
	done := runKogmawCausticSpittle(t, compileReq, runReq)

	got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")
	if math.Abs(got-kogmawCausticSpittleASBase) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v (unmounted)", got, kogmawCausticSpittleASBase)
	}
}

// TestKogmawCausticSpittleRank5ActiveHitShredCostCD: focused CompileGeneric+RunGeneric
// proof for Wiki rank-5 active — pre-shred Q magic, physical probe under 32% armor
// shred, exact 4000ms resistance restore, mana −40, CD 7000ms gate, passive AS retained.
func TestKogmawCausticSpittleRank5ActiveHitShredCostCD(t *testing.T) {
	compileReq, runReq := loadKogmawCausticSpittleFixture(t, true)
	assertKogmawCausticSpittleProviderShape(t, compileReq)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q1", AbilityRef: kogmawCausticSpittleQRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_shred", AbilityRef: kogmawCausticSpittleProbeRef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "q_early", AbilityRef: kogmawCausticSpittleQRef(), Source: "source", Target: "target", FirstAtMs: 500},
		{EntryKey: "probe_expire", AbilityRef: kogmawCausticSpittleProbeRef(), Source: "source", Target: "target", FirstAtMs: 4000},
		{EntryKey: "q2", AbilityRef: kogmawCausticSpittleQRef(), Source: "source", Target: "target", FirstAtMs: 7000},
	}
	runReq.StopPolicy.DurationMs = 7100
	done := runKogmawCausticSpittle(t, compileReq, runReq)

	qRaw, qMit, qN := kogmawCausticSpittleDamageByOpRef(done, kogmawCausticSpittleDamageOpRef)
	if qN != 2 {
		t.Fatalf("Q magic damages=%d want 2 (t=0 and t=7000)", qN)
	}
	// First Q uses pre-shred MR (damage-before-state); second Q also pre-shred vs restored MR.
	if math.Abs(qRaw-2*kogmawCausticSpittleExpectedRaw) > 1e-9 {
		t.Fatalf("Q raw sum=%v want %v", qRaw, 2*kogmawCausticSpittleExpectedRaw)
	}
	if math.Abs(qMit-2*kogmawCausticSpittleExpectedMit) > 1e-9 {
		t.Fatalf("Q mitigated sum=%v want %v (pre-shred MR)", qMit, 2*kogmawCausticSpittleExpectedMit)
	}

	probeRaw, probeMit, probeN := kogmawCausticSpittleDamageByOpRef(done, kogmawCausticSpittleProbeOpRef)
	if probeN != 2 {
		t.Fatalf("physical probes=%d want 2", probeN)
	}
	wantProbeShred := expectedMitigatedPhysical(kogmawCausticSpittleProbeRaw, kogmawCausticSpittleShredArmor)
	wantProbeFull := expectedMitigatedPhysical(kogmawCausticSpittleProbeRaw, kogmawCausticSpittleTargetArmor)
	if math.Abs(probeRaw-2*kogmawCausticSpittleProbeRaw) > 1e-9 {
		t.Fatalf("probe raw sum=%v want %v", probeRaw, 2*kogmawCausticSpittleProbeRaw)
	}
	if math.Abs(probeMit-(wantProbeShred+wantProbeFull)) > 1e-6 {
		t.Fatalf("probe mitigated sum=%v want shred(%v)+full(%v)=%v",
			probeMit, wantProbeShred, wantProbeFull, wantProbeShred+wantProbeFull)
	}

	// Inspect individual probe evidences in time order.
	probes := make([]model.EvidenceItem, 0, 2)
	for _, item := range damageEvidenceItems(done) {
		if item.Ref == kogmawCausticSpittleProbeOpRef ||
			evidenceDataString(item.Data, "operationRef") == kogmawCausticSpittleProbeOpRef {
			probes = append(probes, item)
		}
	}
	if len(probes) != 2 {
		t.Fatalf("probe evidence items=%d want 2", len(probes))
	}
	if math.Abs(evidenceDataFloat(probes[0].Data, "mitigatedAmount")-wantProbeShred) > 1e-6 {
		t.Fatalf("probe@100 mitigated=%v want %v (32%% armor shred)",
			evidenceDataFloat(probes[0].Data, "mitigatedAmount"), wantProbeShred)
	}
	if math.Abs(evidenceDataFloat(probes[1].Data, "mitigatedAmount")-wantProbeFull) > 1e-6 {
		t.Fatalf("probe@4000 mitigated=%v want %v (resistances restored exactly at 4000ms)",
			evidenceDataFloat(probes[1].Data, "mitigatedAmount"), wantProbeFull)
	}

	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	mr := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "magic_resist")
	// After q2 at 7000, shred is re-armed; final snapshot still within 4000ms of q2.
	if math.Abs(armor-kogmawCausticSpittleShredArmor) > 1e-9 {
		t.Fatalf("final armor=%v want %v (shred re-armed by q2)", armor, kogmawCausticSpittleShredArmor)
	}
	if math.Abs(mr-kogmawCausticSpittleShredArmor) > 1e-9 {
		t.Fatalf("final MR=%v want %v (shred re-armed by q2)", mr, kogmawCausticSpittleShredArmor)
	}
	if got := kogmawCausticSpittleTargetState(t, done.FinalSnapshot); got != 1 {
		t.Fatalf("kogmaw_q_resist_reduction=%v want 1 after q2", got)
	}

	if kogmawCausticSpittleSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for early Q during 7000ms CD")
	}
	if done.Summary.AbilityCastCount != 4 {
		// 2 Q + 2 probes; early Q skipped
		t.Fatalf("abilityCastCount=%d want 4 (2 Q + 2 probes; early Q skipped)", done.Summary.AbilityCastCount)
	}
	if got := kogmawCausticSpittleSourceMana(t, done.FinalSnapshot); math.Abs(got-kogmawCausticSpittleManaAfter2) > 1e-9 {
		t.Fatalf("mana=%v want %v (two successful Q casts; early skipped)", got, kogmawCausticSpittleManaAfter2)
	}

	gotAS := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")
	if math.Abs(gotAS-kogmawCausticSpittleASResolved) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v (passive AS retained)", gotAS, kogmawCausticSpittleASResolved)
	}
}
