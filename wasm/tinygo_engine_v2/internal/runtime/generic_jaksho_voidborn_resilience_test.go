package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// item_6665 Jak'Sho — Voidborn Resilience / 虚空天生 (generic ABI, controlled partial).
//
// Target-owned 5-second activation:
//   - Provider provider_item_6665_jaksho_voidborn_resilience mounts on target only.
//   - Lifecycle TickIntervalMs=5000; tick ability StartDelayMs=5000.
//   - Tick state_change sets provider.state.full_stack 0→1 (later ticks stay 1).
//   - Owner-self adds: armor/MR += 0.30 * target.attr.bonus_*.resolved * full_stack.
//   - Explicit bonus_armor / bonus_magic_resist inputs (Web assembler target-loadout
//     supplies totals + derived bonus buckets); never 1.3× total resist.
//
// Non-goals: automatic combat-state detection / end-of-combat expiry,
// Backend hp=350 in resist math, live migrate/publish, source-owned mount.

const (
	jakshoProviderRef   = "provider_item_6665_jaksho_voidborn_resilience"
	jakshoStableID      = "item_6665"
	jakshoFullStackKey  = "full_stack"
	jakshoArmorModKey   = "item_6665_voidborn_bonus_armor"
	jakshoMRModKey      = "item_6665_voidborn_bonus_magic_resist"
	jakshoTickAbility   = "voidborn_tick"
	jakshoProbeAbility  = "jaksho_probe"
	jakshoTickInterval  = int64(5000)
	jakshoResistRatio   = 0.30
	jakshoFixtureHP     = 100000.0 // Backend seed static hp=350 is data-only; not used here.
	jakshoProbeRaw      = 100.0
)

func jakshoFullStackSchema() map[string]interface{} {
	return map[string]interface{}{
		jakshoFullStackKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(1),
			"durationMs":   float64(0), // untimed capped; combat-window expiry is out of this partial
		},
	}
}

func jakshoResistBonusExpr(bonusAttrPath string) model.GenericFormulaExpr {
	// Nested binary mul: generic formula compile only lowers the first two args of mul.
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					gfConst(jakshoResistRatio),
					{Op: "read", Path: bonusAttrPath},
				},
			},
			{Op: "read", Path: "provider.state." + jakshoFullStackKey},
		},
	}
}

func jakshoArmorModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: jakshoArmorModKey,
		Kind:        "attribute",
		Target:      "armor",
		ValuePolicy: "add",
		Value:       jakshoResistBonusExpr("target.attr.bonus_armor.resolved"),
	}
}

func jakshoMRModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: jakshoMRModKey,
		Kind:        "attribute",
		Target:      "magic_resist",
		ValuePolicy: "add",
		Value:       jakshoResistBonusExpr("target.attr.bonus_magic_resist.resolved"),
	}
}

func jakshoTickOnActivate() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: jakshoTickAbility,
		Kind:       "tick",
		Types:      []string{"ability/tick"},
		TickSpec: &model.TickSpec{
			IntervalMs:   jakshoTickInterval,
			StartDelayMs: jakshoTickInterval,
			OnTick: []model.OperationDefinition{
				{
					Operation:   "state_change",
					Target:      "self",
					Ref:         jakshoFullStackKey,
					Types:       []string{"state_scope/provider"},
					ValuePolicy: "override",
					Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				},
			},
		},
	}
}

func jakshoProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: jakshoProviderRef,
		Kind:        "item",
		StableID:    jakshoStableID,
		Lifecycle: &model.ProviderLifecycle{
			TickIntervalMs: jakshoTickInterval,
			MaxStacks:      1,
			RefreshPolicy:  "replace",
		},
		InitialStateSchema: jakshoFullStackSchema(),
		Modifiers:          []model.ModifierDefinition{jakshoArmorModifier(), jakshoMRModifier()},
		Abilities:          []model.AbilityDefinition{jakshoTickOnActivate()},
	}
}

func ensureJakshoTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/tick", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: "damage/true", Domain: "damage"},
		{Key: "state_scope/provider", Domain: "state_scope"},
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

func mountJakshoOnTarget(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, jakshoProviderDef())
	mount := model.CombatantProviderMount{ProviderRef: jakshoProviderRef, DefinitionRef: jakshoProviderRef}
	snap := model.CombatantProviderSnapshot{
		ProviderRef: jakshoProviderRef, DefinitionRef: jakshoProviderRef,
		Stacks: 1, State: map[string]interface{}{},
	}
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key == model.SelectorTarget {
			compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, mount)
		}
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorTarget {
			runReq.InitialSnapshot.Combatants[i].Providers = append(
				runReq.InitialSnapshot.Combatants[i].Providers, snap,
			)
		}
	}
}

func configureJakshoProbeAbility(compileReq *model.CompileRequest, damageType string) {
	raw := jakshoProbeRaw
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: jakshoProbeAbility,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: damageType,
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &raw},
					Ref:        "op:jaksho_probe",
				},
			},
		},
	}
}

func jakshoProbeRef() string {
	return "source.provider[champion:source_demo].ability[" + jakshoProbeAbility + "]"
}

type jakshoResistInput struct {
	armor              float64
	magicResist        float64
	bonusArmor         float64
	bonusMagicResist   float64
}

func setJakshoTargetResists(compileReq *model.CompileRequest, runReq *model.RunRequest, in jakshoResistInput) {
	setCombatantAttr(compileReq, runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: jakshoFixtureHP, Current: jakshoFixtureHP, Max: jakshoFixtureHP, Resolved: jakshoFixtureHP,
	})
	setCombatantAttr(compileReq, runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: in.armor, Current: in.armor, Max: in.armor, Resolved: in.armor,
	})
	setCombatantAttr(compileReq, runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: in.magicResist, Current: in.magicResist, Max: in.magicResist, Resolved: in.magicResist,
	})
	setCombatantAttr(compileReq, runReq, model.SelectorTarget, "bonus_armor", model.AttributeSlotDef{
		Base: in.bonusArmor, Current: in.bonusArmor, Max: in.bonusArmor, Resolved: in.bonusArmor,
	})
	setCombatantAttr(compileReq, runReq, model.SelectorTarget, "bonus_magic_resist", model.AttributeSlotDef{
		Base: in.bonusMagicResist, Current: in.bonusMagicResist, Max: in.bonusMagicResist, Resolved: in.bonusMagicResist,
	})
}

func loadJakshoFixture(t *testing.T, in jakshoResistInput, durationMs int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureJakshoTypes(&compileReq)
	mountJakshoOnTarget(&compileReq, &runReq)
	setJakshoTargetResists(&compileReq, &runReq, in)
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = durationMs
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runJaksho(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if len(result.Result.Warnings) != 0 {
		t.Fatalf("compile warnings=%+v want none", result.Result.Warnings)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if !done.OK {
		t.Fatal("done.ok=false")
	}
	return done
}

func jakshoWantActivated(in jakshoResistInput) (armor, mr float64) {
	return in.armor + jakshoResistRatio*in.bonusArmor,
		in.magicResist + jakshoResistRatio*in.bonusMagicResist
}

func jakshoTargetFullStack(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		raw, ok := c.ProviderState[jakshoProviderRef]
		if !ok {
			return 0
		}
		bag, ok := raw.(map[string]interface{})
		if !ok {
			t.Fatalf("target providerState shape: %+v", raw)
		}
		state, _ := bag["state"].(map[string]interface{})
		if state == nil {
			return 0
		}
		v, _ := state[jakshoFullStackKey].(float64)
		return v
	}
	t.Fatal("target combatant missing")
	return 0
}

func assertSourceLacksJaksho(t *testing.T, done model.DoneResult) {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		for _, p := range c.Providers {
			if p.ProviderRef == jakshoProviderRef || p.DefinitionRef == jakshoProviderRef {
				t.Fatalf("source must not mount Jak'Sho provider: %+v", c.Providers)
			}
		}
		if raw, ok := c.ProviderState[jakshoProviderRef]; ok {
			t.Fatalf("source must not own Jak'Sho providerState: %+v", raw)
		}
		return
	}
	t.Fatal("source combatant missing")
}

func assertJakshoResists(t *testing.T, snap model.Snapshot, wantArmor, wantMR float64) {
	t.Helper()
	gotArmor := combatantAttrResolved(t, snap, model.SelectorTarget, "armor")
	gotMR := combatantAttrResolved(t, snap, model.SelectorTarget, "magic_resist")
	if math.Abs(gotArmor-wantArmor) > 1e-9 {
		t.Fatalf("armor.resolved=%v want %v", gotArmor, wantArmor)
	}
	if math.Abs(gotMR-wantMR) > 1e-9 {
		t.Fatalf("magic_resist.resolved=%v want %v", gotMR, wantMR)
	}
}

func findJakshoProviderTickAt(done model.DoneResult, timeMs int64) bool {
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindProviderTick {
			continue
		}
		if item.TimeMs != timeMs {
			continue
		}
		if item.Ref == jakshoProviderRef {
			return true
		}
		if ref, _ := item.Data["providerRef"].(string); ref == jakshoProviderRef {
			return true
		}
	}
	return false
}

func probeMitigated(done model.DoneResult) (raw, mitigated float64, ok bool) {
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != "op:jaksho_probe" {
			continue
		}
		return evidenceDataFloat(item.Data, "rawAmount"), evidenceDataFloat(item.Data, "mitigatedAmount"), true
	}
	return 0, 0, false
}

// TestJakshoVoidbornResilienceTargetLoadoutContract: synthetic runtime input matches
// Web assembler target-loadout compile contract (hero base 30/30 + item_6665 45/45 →
// totals 75/75, derived bonus 45/45); t=5000 adds 13.5 → 88.5/88.5; later tick idempotent.
func TestJakshoVoidbornResilienceTargetLoadoutContract(t *testing.T) {
	in := jakshoResistInput{armor: 75, magicResist: 75, bonusArmor: 45, bonusMagicResist: 45}
	wantArmor, wantMR := jakshoWantActivated(in)
	if math.Abs(wantArmor-88.5) > 1e-9 || math.Abs(wantMR-88.5) > 1e-9 {
		t.Fatalf("contract math drift: wantArmor=%v wantMR=%v", wantArmor, wantMR)
	}

	cPre, rPre := loadJakshoFixture(t, in, 4999)
	donePre := runJaksho(t, cPre, rPre)
	assertSourceLacksJaksho(t, donePre)
	assertJakshoResists(t, donePre.FinalSnapshot, in.armor, in.magicResist)
	if got := jakshoTargetFullStack(t, donePre.FinalSnapshot); got != 0 {
		t.Fatalf("pre-activation full_stack=%v want 0", got)
	}

	c5000, r5000 := loadJakshoFixture(t, in, 5000)
	done5000 := runJaksho(t, c5000, r5000)
	assertSourceLacksJaksho(t, done5000)
	assertJakshoResists(t, done5000.FinalSnapshot, wantArmor, wantMR)
	if got := jakshoTargetFullStack(t, done5000.FinalSnapshot); got != 1 {
		t.Fatalf("t=5000 full_stack=%v want 1", got)
	}

	c10000, r10000 := loadJakshoFixture(t, in, 10000)
	done10000 := runJaksho(t, c10000, r10000)
	assertSourceLacksJaksho(t, done10000)
	assertJakshoResists(t, done10000.FinalSnapshot, wantArmor, wantMR)
	if got := jakshoTargetFullStack(t, done10000.FinalSnapshot); got != 1 {
		t.Fatalf("t=10000 full_stack=%v want 1 (idempotent)", got)
	}
}

// TestJakshoVoidbornResilienceActivationTimeline: t=4999 still base; t=5000 activates
// +30% of synthetic bonus resists; t=10000 does not double-apply.
func TestJakshoVoidbornResilienceActivationTimeline(t *testing.T) {
	in := jakshoResistInput{armor: 145, magicResist: 75, bonusArmor: 45, bonusMagicResist: 45}
	wantArmor, wantMR := jakshoWantActivated(in)

	c4999, r4999 := loadJakshoFixture(t, in, 4999)
	done4999 := runJaksho(t, c4999, r4999)
	assertSourceLacksJaksho(t, done4999)
	assertJakshoResists(t, done4999.FinalSnapshot, in.armor, in.magicResist)
	if got := jakshoTargetFullStack(t, done4999.FinalSnapshot); got != 0 {
		t.Fatalf("t=4999 full_stack=%v want 0", got)
	}
	if findJakshoProviderTickAt(done4999, 5000) {
		t.Fatal("t=4999 run must not contain t=5000 provider tick")
	}

	c5000, r5000 := loadJakshoFixture(t, in, 5000)
	done5000 := runJaksho(t, c5000, r5000)
	assertSourceLacksJaksho(t, done5000)
	assertJakshoResists(t, done5000.FinalSnapshot, wantArmor, wantMR)
	if got := jakshoTargetFullStack(t, done5000.FinalSnapshot); got != 1 {
		t.Fatalf("t=5000 full_stack=%v want 1", got)
	}
	if !findJakshoProviderTickAt(done5000, 5000) {
		t.Fatal("evidence must contain t=5000 provider tick")
	}
	if math.Abs(wantArmor-158.5) > 1e-9 || math.Abs(wantMR-88.5) > 1e-9 {
		t.Fatalf("fixture math drift: wantArmor=%v wantMR=%v", wantArmor, wantMR)
	}

	c10000, r10000 := loadJakshoFixture(t, in, 10000)
	done10000 := runJaksho(t, c10000, r10000)
	assertSourceLacksJaksho(t, done10000)
	assertJakshoResists(t, done10000.FinalSnapshot, wantArmor, wantMR)
	if got := jakshoTargetFullStack(t, done10000.FinalSnapshot); got != 1 {
		t.Fatalf("t=10000 full_stack=%v want 1 (override, not add)", got)
	}
	if !findJakshoProviderTickAt(done10000, 5000) || !findJakshoProviderTickAt(done10000, 10000) {
		t.Fatal("t=10000 run must evidence ticks at 5000 and 10000")
	}
}

// TestJakshoVoidbornResilienceMixedAndZeroBonus: mixed bonuses activate correctly;
// zero bonus leaves totals unchanged (never 1.3× total resist).
func TestJakshoVoidbornResilienceMixedAndZeroBonus(t *testing.T) {
	mixed := jakshoResistInput{armor: 200, magicResist: 110, bonusArmor: 100, bonusMagicResist: 80}
	wantArmor, wantMR := jakshoWantActivated(mixed)
	cMixed, rMixed := loadJakshoFixture(t, mixed, 5000)
	doneMixed := runJaksho(t, cMixed, rMixed)
	assertJakshoResists(t, doneMixed.FinalSnapshot, wantArmor, wantMR)
	if math.Abs(wantArmor-230) > 1e-9 || math.Abs(wantMR-134) > 1e-9 {
		t.Fatalf("mixed want 230/134 got %v/%v", wantArmor, wantMR)
	}
	assertSourceLacksJaksho(t, doneMixed)

	zero := jakshoResistInput{armor: 145, magicResist: 75, bonusArmor: 0, bonusMagicResist: 0}
	cZero, rZero := loadJakshoFixture(t, zero, 5000)
	doneZero := runJaksho(t, cZero, rZero)
	assertJakshoResists(t, doneZero.FinalSnapshot, zero.armor, zero.magicResist)
	if got := jakshoTargetFullStack(t, doneZero.FinalSnapshot); got != 1 {
		t.Fatalf("zero-bonus full_stack=%v want 1 (state still arms)", got)
	}
	assertSourceLacksJaksho(t, doneZero)
}

// TestJakshoVoidbornResilienceSameTimeTickBeforeDamage: at t=5000 provider tick
// precedes ability attempt; physical/magic use enhanced resists; true is unchanged.
func TestJakshoVoidbornResilienceSameTimeTickBeforeDamage(t *testing.T) {
	in := jakshoResistInput{armor: 145, magicResist: 75, bonusArmor: 45, bonusMagicResist: 45}
	wantArmor, wantMR := jakshoWantActivated(in)

	cases := []struct {
		name       string
		damageType string
		wantMit    float64
	}{
		{"physical", "damage/physical", expectedMitigatedPhysical(jakshoProbeRaw, wantArmor)},
		{"magic", "damage/magic", expectedMitigatedMagic(jakshoProbeRaw, wantMR)},
		{"true", "damage/true", jakshoProbeRaw},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadJakshoFixture(t, in, 5000)
			configureJakshoProbeAbility(&compileReq, tc.damageType)
			runReq.DriverPlan.Entries = []model.DriverEntry{{
				EntryKey:   "jaksho_probe_5000",
				AbilityRef: jakshoProbeRef(),
				Source:     model.SelectorSource,
				Target:     model.SelectorTarget,
				FirstAtMs:  5000,
			}}
			done := runJaksho(t, compileReq, runReq)
			assertSourceLacksJaksho(t, done)
			assertJakshoResists(t, done.FinalSnapshot, wantArmor, wantMR)
			if !findJakshoProviderTickAt(done, 5000) {
				t.Fatal("missing t=5000 provider tick evidence")
			}
			raw, mitigated, ok := probeMitigated(done)
			if !ok {
				t.Fatal("missing probe damage evidence")
			}
			if math.Abs(raw-jakshoProbeRaw) > 1e-9 {
				t.Fatalf("raw=%v want %v", raw, jakshoProbeRaw)
			}
			if math.Abs(mitigated-tc.wantMit) > 1e-9 {
				t.Fatalf("mitigated=%v want %v (pre-activation would differ)", mitigated, tc.wantMit)
			}
			// Prove ordering: same-time damage must not have used pre-activation resists.
			if tc.damageType == "damage/physical" {
				pre := expectedMitigatedPhysical(jakshoProbeRaw, in.armor)
				if math.Abs(mitigated-pre) < 1e-9 {
					t.Fatalf("physical mitigated equals pre-activation %v; tick must precede damage", pre)
				}
			}
			if tc.damageType == "damage/magic" {
				pre := expectedMitigatedMagic(jakshoProbeRaw, in.magicResist)
				if math.Abs(mitigated-pre) < 1e-9 {
					t.Fatalf("magic mitigated equals pre-activation %v; tick must precede damage", pre)
				}
			}
		})
	}
}
