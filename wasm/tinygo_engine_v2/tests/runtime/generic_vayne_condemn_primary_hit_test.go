// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	vayneCondemnPrimaryHitProviderRef = "provider_hero_vayne_e_condemn_primary_hit"
	vayneCondemnPrimaryHitStableID    = "hero_vayne_e_condemn_primary_hit"
	vayneCondemnPrimaryHitAbilityID   = "ability_hero_vayne_e_condemn_primary_hit"
	vayneCondemnPrimaryHitAbilityKey  = "condemn"
	vayneCondemnPrimaryHitDamageOpRef = "op:vayne_condemn_primary_hit_damage"
	vayneCondemnPrimaryHitBonusADMod  = "fixture_vayne_condemn_primary_hit_bonus_ad"

	// Must not collide with existing Vayne Silver Bolts / Tumble / AA fixtures.
	vayneSilverBoltsProviderKey = "hero:vayne_silver_bolts"
	vayneSilverBoltsDefRef      = "provider_hero_vayne_silver_bolts"

	vayneCondemnPrimaryHitBaseDamage = 190.0
	vayneCondemnPrimaryHitBonusRatio = 0.50
	vayneCondemnPrimaryHitManaCost   = 90.0
	vayneCondemnPrimaryHitCDMs       = 12000.0

	vayneCondemnPrimaryHitADBase      = 60.0
	vayneCondemnPrimaryHitADResolved  = 140.0
	vayneCondemnPrimaryHitTargetArmor = 100.0
	vayneCondemnPrimaryHitTargetHP    = 100000.0
	vayneCondemnPrimaryHitFixtureMana = 232.0

	// Independent cross-check: bonusAD=80 → raw 230; armor 100 → mitigated 115.
	vayneCondemnPrimaryHitExpectedRaw       = 230.0
	vayneCondemnPrimaryHitExpectedMitigated = 115.0
	vayneCondemnPrimaryHitManaAfter2        = 52.0 // 232 - 90 - 90

	vayneCondemnPrimaryHitTol = 1e-9
)

func vayneCondemnPrimaryHitExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return vayneCondemnPrimaryHitBaseDamage + vayneCondemnPrimaryHitBonusRatio*(resolvedAD-baseAD)
}

func vayneCondemnPrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := vayneCondemnPrimaryHitBaseDamage
	ratio := vayneCondemnPrimaryHitBonusRatio
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

func vayneCondemnPrimaryHitAbility() model.AbilityDefinition {
	cost := vayneCondemnPrimaryHitManaCost
	cd := vayneCondemnPrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: vayneCondemnPrimaryHitAbilityKey,
		Kind:       "active",
		// Not a basic attack; CritEligible left false on the damage op.
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
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           vayneCondemnPrimaryHitDamageOpRef,
				Amount:        vayneCondemnPrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func vayneCondemnPrimaryHitProviderDef() model.ProviderDefinition {
	bonusAD := vayneCondemnPrimaryHitADResolved - vayneCondemnPrimaryHitADBase
	return model.ProviderDefinition{
		ProviderKey: vayneCondemnPrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    vayneCondemnPrimaryHitStableID,
		// Fixture-only flat AD so ad.base stays 60 while ad.resolved becomes 140
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: vayneCondemnPrimaryHitBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}},
		Abilities: []model.AbilityDefinition{vayneCondemnPrimaryHitAbility()},
	}
}

func vayneCondemnPrimaryHitAbilityRef() string {
	return "source.provider[" + vayneCondemnPrimaryHitProviderRef + "].ability[" + vayneCondemnPrimaryHitAbilityKey + "]"
}

func configureVayneCondemnPrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{vayneCondemnPrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: vayneCondemnPrimaryHitProviderRef, DefinitionRef: vayneCondemnPrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: vayneCondemnPrimaryHitProviderRef, DefinitionRef: vayneCondemnPrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureVayneCondemnPrimaryHitTypes(req *model.CompileRequest) {
	formuladefinition.DeclareAttributes(req, "armor")
	formuladefinition.SetDamageFormula(req, "damage/physical", formuladefinition.ResistanceDefense("armor"))

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

func loadVayneCondemnPrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureVayneCondemnPrimaryHitTypes(&compileReq)
	configureVayneCondemnPrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: vayneCondemnPrimaryHitADBase, Current: vayneCondemnPrimaryHitADBase,
		Max: vayneCondemnPrimaryHitADBase, Resolved: vayneCondemnPrimaryHitADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: vayneCondemnPrimaryHitFixtureMana, Max: vayneCondemnPrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: vayneCondemnPrimaryHitTargetHP, Current: vayneCondemnPrimaryHitTargetHP,
		Max: vayneCondemnPrimaryHitTargetHP, Resolved: vayneCondemnPrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: vayneCondemnPrimaryHitTargetArmor, Current: vayneCondemnPrimaryHitTargetArmor,
		Max: vayneCondemnPrimaryHitTargetArmor, Resolved: vayneCondemnPrimaryHitTargetArmor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runVayneCondemnPrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := runtimeengine.RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func vayneCondemnPrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func vayneCondemnPrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func vayneCondemnPrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != vayneCondemnPrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func vayneCondemnPrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == vayneCondemnPrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertVayneCondemnPrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := vayneCondemnPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_vayne_e_condemn_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != vayneCondemnPrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, vayneCondemnPrimaryHitProviderRef)
	}
	if p.StableID != vayneCondemnPrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, vayneCondemnPrimaryHitStableID)
	}
	if p.ProviderKey == vayneSilverBoltsProviderKey || p.ProviderKey == vayneSilverBoltsDefRef ||
		p.StableID == vayneSilverBoltsProviderKey || p.StableID == vayneSilverBoltsDefRef ||
		p.ProviderKey == gcohVayneProviderRef {
		t.Fatal("condemn primary-hit must not reuse Vayne Silver Bolts provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / Silver Bolts coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no knockback/stun/state)", len(p.InitialStateSchema))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), vayneCondemnPrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != vayneCondemnPrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, vayneCondemnPrimaryHitAbilityKey, vayneCondemnPrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("condemn must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-vayneCondemnPrimaryHitManaCost) > vayneCondemnPrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 90", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-vayneCondemnPrimaryHitCDMs) > vayneCondemnPrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 12000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no CC/geometry/wall bonus)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("condemn damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("condemn damage must not be copyable on hit")
	}
	if op.Ref != vayneCondemnPrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, vayneCondemnPrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, sub(ad.resolved, ad.base)))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-vayneCondemnPrimaryHitBaseDamage) > vayneCondemnPrimaryHitTol {
		t.Fatalf("base const=%+v want 190", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-vayneCondemnPrimaryHitBonusRatio) > vayneCondemnPrimaryHitTol {
		t.Fatalf("bonus ratio=%+v want 0.50", mul.Args[0])
	}
	sub := mul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want source.attr.ad.resolved - source.attr.ad.base", sub)
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "stun" ||
			banned.Operation == "knockback" || banned.Operation == "displacement" ||
			banned.Operation == "projectile" || banned.Operation == "multi_target" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" {
			t.Fatalf("condemn must not include CC/displacement/geometry/state/repeat op: %+v", banned)
		}
	}
}

func findVayneCondemnPrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := vayneCondemnPrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

// TestVayneCondemnPrimaryHitRank5DamageFormulaCrossCheck: independent numeric
// cross-check 190 + 0.50*(140-60) = 230; armor 100 → mitigated 115.
func TestVayneCondemnPrimaryHitRank5DamageFormulaCrossCheck(t *testing.T) {
	bonus := vayneCondemnPrimaryHitADResolved - vayneCondemnPrimaryHitADBase
	if math.Abs(bonus-80) > vayneCondemnPrimaryHitTol {
		t.Fatalf("bonusAD=%v want 80", bonus)
	}
	raw := vayneCondemnPrimaryHitExpectedRawFromAD(vayneCondemnPrimaryHitADResolved, vayneCondemnPrimaryHitADBase)
	if math.Abs(raw-vayneCondemnPrimaryHitExpectedRaw) > vayneCondemnPrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, vayneCondemnPrimaryHitExpectedRaw)
	}
	mit := expectedMitigatedPhysical(raw, vayneCondemnPrimaryHitTargetArmor)
	if math.Abs(mit-vayneCondemnPrimaryHitExpectedMitigated) > vayneCondemnPrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, vayneCondemnPrimaryHitExpectedMitigated)
	}
}

// TestVayneCondemnPrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent E provider: one physical damage op, cost/CD, no listener/state/CC.
func TestVayneCondemnPrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadVayneCondemnPrimaryHitFixture(t)
	assertVayneCondemnPrimaryHitProviderShape(t, compileReq)
	if vayneCondemnPrimaryHitProviderRef == vayneSilverBoltsProviderKey ||
		vayneCondemnPrimaryHitProviderRef == vayneSilverBoltsDefRef ||
		vayneCondemnPrimaryHitProviderRef == gcohVayneProviderRef {
		t.Fatal("condemn primary-hit must not reuse Vayne Silver Bolts provider refs")
	}
	if vayneCondemnPrimaryHitAbilityKey == spellbladeTumbleKey ||
		vayneCondemnPrimaryHitAbilityKey == spellbladeHitAbilityKey ||
		vayneCondemnPrimaryHitAbilityKey == "basic_attack" ||
		vayneCondemnPrimaryHitAbilityKey == "silver_bolts" {
		t.Fatal("condemn must not reuse Silver Bolts / Tumble / basic-attack ability keys")
	}
	if vayneCondemnPrimaryHitDamageOpRef == gcohVayneOpRef {
		t.Fatal("condemn primary-hit must not reuse Silver Bolts operation refs")
	}
	if vayneCondemnPrimaryHitAbilityID != "ability_hero_vayne_e_condemn_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
}

// TestVayneCondemnPrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target immediate physical damage scaffold: cost 90,
// CD 12000ms exact boundary, one physical hit per successful cast (no AA/crit/phantom/CC).
func TestVayneCondemnPrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadVayneCondemnPrimaryHitFixture(t)
	assertVayneCondemnPrimaryHitProviderShape(t, compileReq)

	ref := vayneCondemnPrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 12000},
	}
	runReq.StopPolicy.DurationMs = 12100

	done := runVayneCondemnPrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if vayneCondemnPrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findVayneCondemnPrimaryHitAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt11999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 11999 {
			t.Fatalf("cooldown skip TimeMs=%d want 11999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 12000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 12000", item.Data["readyAtMs"])
		}
		skipAt11999 = true
	}
	if !skipAt11999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=11999 with readyAtMs=12000")
	}

	items := vayneCondemnPrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("condemn damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 12000}
	wantMit := expectedMitigatedPhysical(vayneCondemnPrimaryHitExpectedRaw, vayneCondemnPrimaryHitTargetArmor)
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
		if evidenceDataString(item.Data, "providerRef") != vayneCondemnPrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), vayneCondemnPrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != vayneCondemnPrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), vayneCondemnPrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-vayneCondemnPrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, vayneCondemnPrimaryHitExpectedRaw)
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
	wantHP := vayneCondemnPrimaryHitTargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}

	gotMana := vayneCondemnPrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-vayneCondemnPrimaryHitManaAfter2) > vayneCondemnPrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 180; skipped attempt costs 0)", gotMana, vayneCondemnPrimaryHitManaAfter2)
	}
	if math.Abs((vayneCondemnPrimaryHitFixtureMana-gotMana)-180) > vayneCondemnPrimaryHitTol {
		t.Fatalf("mana spent=%v want 180", vayneCondemnPrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/CC/Silver Bolts hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-vayneCondemnPrimaryHitADResolved) > vayneCondemnPrimaryHitTol {
		t.Fatalf("ad.resolved=%v want %v", got, vayneCondemnPrimaryHitADResolved)
	}
}
