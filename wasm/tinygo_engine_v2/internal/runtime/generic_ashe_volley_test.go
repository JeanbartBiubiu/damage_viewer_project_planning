package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_ashe W Volley / 万箭齐发 (generic ABI, rank-5 single-target damage branch).
//
// League Wiki Template:Data Ashe/Volley (revision 4007430,
// SHA256 7e12c2b27533ff696411e2eff05d7f5b5c9e3b1ad45f09e017df2a764abb5e28;
// reviewed-contracts.json#ashe-w):
//   - physical damage 200 + 100% bonus AD
//   - mana cost 55; cooldown 4000 ms
//   - rank-5 fires 11 arrows, but a target struck by multiple arrows takes
//     damage only from the first → model one damage op (no per-arrow loop)
//
// Explicit non-goals: Frost Shot slow/status, projectile travel, cone/collision,
// multi-target, other ranks, Q/E/R.

const (
	asheVolleyProviderRef = "hero:ashe_volley"
	asheVolleyStableID    = "hero_ashe_volley"
	asheVolleyAbilityKey  = "volley"
	asheVolleyDamageOpRef = "op:ashe_volley_damage"
	asheVolleyBonusADMod  = "fixture_ashe_volley_bonus_ad"

	asheVolleyBaseDamage = 200.0
	asheVolleyBonusRatio = 1.0
	asheVolleyManaCost   = 55.0
	asheVolleyCDMs       = 4000.0

	asheVolleyADBase     = 60.0
	asheVolleyADResolved = 100.0
	asheVolleyTargetArmor = 100.0
	asheVolleyTargetHP    = 100000.0
	asheVolleyFixtureMana = 200.0

	asheVolleyExpectedRaw       = 240.0 // 200 + 1.0*(100-60)
	asheVolleyExpectedMitigated = 120.0 // 240 * 100/(100+100)
)

func asheVolleyExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return asheVolleyBaseDamage + asheVolleyBonusRatio*(resolvedAD-baseAD)
}

func asheVolleyDamageAmount() *model.GenericFormulaExpr {
	base := asheVolleyBaseDamage
	ratio := asheVolleyBonusRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
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
	}
}

func asheVolleyAbility() model.AbilityDefinition {
	cost := asheVolleyManaCost
	cd := asheVolleyCDMs
	return model.AbilityDefinition{
		AbilityKey: asheVolleyAbilityKey,
		Kind:       "active",
		// Not a basic attack; CritEligible left false (zero value).
		Types: []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		Operations: []model.OperationDefinition{
			{
				Operation:    "damage",
				Target:       "target",
				DamageType:   "damage/physical",
				Ref:          asheVolleyDamageOpRef,
				Amount:       asheVolleyDamageAmount(),
				CritEligible: false,
			},
		},
	}
}

func asheVolleyProviderDef() model.ProviderDefinition {
	bonusAD := asheVolleyADResolved - asheVolleyADBase
	return model.ProviderDefinition{
		ProviderKey: asheVolleyProviderRef,
		Kind:        "champion",
		StableID:    asheVolleyStableID,
		// Fixture-only flat AD so ad.base stays 60 while ad.resolved becomes 100
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: asheVolleyBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}},
		Abilities: []model.AbilityDefinition{asheVolleyAbility()},
	}
}

func asheVolleyAbilityRef() string {
	return "source.provider[" + asheVolleyProviderRef + "].ability[" + asheVolleyAbilityKey + "]"
}

func configureAsheVolleyProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{asheVolleyProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: asheVolleyProviderRef, DefinitionRef: asheVolleyProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: asheVolleyProviderRef, DefinitionRef: asheVolleyProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureAsheVolleyTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
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

func loadAsheVolleyFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureAsheVolleyTypes(&compileReq)
	configureAsheVolleyProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: asheVolleyADBase, Current: asheVolleyADBase, Max: asheVolleyADBase, Resolved: asheVolleyADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: asheVolleyFixtureMana, Max: asheVolleyFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: asheVolleyTargetHP, Current: asheVolleyTargetHP, Max: asheVolleyTargetHP, Resolved: asheVolleyTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: asheVolleyTargetArmor, Current: asheVolleyTargetArmor, Max: asheVolleyTargetArmor, Resolved: asheVolleyTargetArmor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runAsheVolley(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func asheVolleySourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func asheVolleySkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func asheVolleyDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != asheVolleyDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func assertAsheVolleyProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := compileReq.SharedProviders[0]
	if p.ProviderKey != asheVolleyProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, asheVolleyProviderRef)
	}
	if p.StableID != asheVolleyStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, asheVolleyStableID)
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1", len(p.Abilities))
	}
	a := p.Abilities[0]
	if a.AbilityKey != asheVolleyAbilityKey {
		t.Fatalf("abilityKey=%q want %q", a.AbilityKey, asheVolleyAbilityKey)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("volley must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" {
		t.Fatalf("cost=%+v want mana", a.Cost)
	}
	if a.Cooldown == nil {
		t.Fatal("cooldown missing")
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (first-arrow-only; no per-arrow loop)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("volley damage must not be crit-eligible")
	}
	if op.Ref != asheVolleyDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, asheVolleyDamageOpRef)
	}
}

func findAsheVolleyAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := asheVolleyAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

// TestGenericAsheVolleyRank5DamageFormulaCrossCheck: independent numeric
// cross-check 200 + 1.0*(100-60) = 240; armor 100 → mitigated 120.
func TestGenericAsheVolleyRank5DamageFormulaCrossCheck(t *testing.T) {
	raw := asheVolleyExpectedRawFromAD(asheVolleyADResolved, asheVolleyADBase)
	if math.Abs(raw-asheVolleyExpectedRaw) > 1e-12 {
		t.Fatalf("raw=%v want %v", raw, asheVolleyExpectedRaw)
	}
	mit := expectedMitigatedPhysical(raw, asheVolleyTargetArmor)
	if math.Abs(mit-asheVolleyExpectedMitigated) > 1e-12 {
		t.Fatalf("mitigated=%v want %v", mit, asheVolleyExpectedMitigated)
	}
}

// TestGenericAsheVolleyCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target damage branch: cost 55, CD 4000ms exact boundary,
// one physical hit per cast (no arrow loop / AA / crit / phantom).
func TestGenericAsheVolleyCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadAsheVolleyFixture(t)
	assertAsheVolleyProviderShape(t, compileReq)

	ref := asheVolleyAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 3999},
		{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4000},
	}
	runReq.StopPolicy.DurationMs = 4100

	done := runAsheVolley(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if asheVolleySkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findAsheVolleyAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt3999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 3999 {
			t.Fatalf("cooldown skip TimeMs=%d want 3999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 4000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 4000", item.Data["readyAtMs"])
		}
		skipAt3999 = true
	}
	if !skipAt3999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=3999 with readyAtMs=4000")
	}

	items := asheVolleyDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("volley damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 4000}
	wantMit := expectedMitigatedPhysical(asheVolleyExpectedRaw, asheVolleyTargetArmor)
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		if evidenceDataBool(item.Data, "phantom") {
			t.Fatalf("damage[%d] must not be phantom: %+v", i, item.Data)
		}
		if evidenceDataString(item.Data, "phase") != "original" {
			t.Fatalf("damage[%d] phase=%q want original", i, evidenceDataString(item.Data, "phase"))
		}
		if evidenceDataString(item.Data, "damageType") != "damage/physical" {
			t.Fatalf("damage[%d] type=%q", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q want %q", i, evidenceDataString(item.Data, "abilityRef"), ref)
		}
		if evidenceDataString(item.Data, "providerRef") != asheVolleyProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), asheVolleyProviderRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-asheVolleyExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, asheVolleyExpectedRaw)
		}
		if math.Abs(mit-wantMit) > 1e-9 {
			t.Fatalf("damage[%d] mitigatedAmount=%v want %v", i, mit, wantMit)
		}
		mitSum += mit
	}

	wantDealt := 2 * wantMit
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	wantHP := asheVolleyTargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}

	gotMana := asheVolleySourceMana(t, done.FinalSnapshot)
	wantMana := asheVolleyFixtureMana - 2*asheVolleyManaCost
	if math.Abs(gotMana-wantMana) > 1e-9 {
		t.Fatalf("mana=%v want %v (spent exactly 110; skipped attempt costs 0)", gotMana, wantMana)
	}
	if math.Abs((asheVolleyFixtureMana-gotMana)-110) > 1e-9 {
		t.Fatalf("mana spent=%v want 110", asheVolleyFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra arrow/AA/phantom hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-asheVolleyADResolved) > 1e-9 {
		t.Fatalf("ad.resolved=%v want %v", got, asheVolleyADResolved)
	}
}
