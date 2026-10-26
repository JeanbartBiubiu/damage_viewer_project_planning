// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	asheEnchantedCrystalArrowPrimaryHitPlanRev = "ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1"

	asheEnchantedCrystalArrowPrimaryHitProviderRef  = "provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit"
	asheEnchantedCrystalArrowPrimaryHitStableID     = "hero_ashe_r_enchanted_crystal_arrow_primary_hit"
	asheEnchantedCrystalArrowPrimaryHitAbilityID    = "ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit"
	asheEnchantedCrystalArrowPrimaryHitAbilityKey   = "enchanted_crystal_arrow"
	asheEnchantedCrystalArrowPrimaryHitDamageOpRef  = "op:ashe_enchanted_crystal_arrow_primary_hit_damage"
	asheEnchantedCrystalArrowPrimaryHitFixtureAPMod = "fixture_ashe_enchanted_crystal_arrow_primary_hit_ap"

	asheEnchantedCrystalArrowPrimaryHitBaseDamage = 600.0
	asheEnchantedCrystalArrowPrimaryHitAPRatio    = 1.20
	asheEnchantedCrystalArrowPrimaryHitManaCost   = 100.0
	asheEnchantedCrystalArrowPrimaryHitCDMs       = 60000.0

	// Source level-1 baseline (matches Ashe Q/W seed bytes + AP0). AP200 is
	// fixture-only via modifier; production base AP stays 0.
	asheEnchantedCrystalArrowPrimaryHitHPBase      = 610.0
	asheEnchantedCrystalArrowPrimaryHitMana        = 280.0
	asheEnchantedCrystalArrowPrimaryHitADBase      = 59.0
	asheEnchantedCrystalArrowPrimaryHitAPBase      = 0.0
	asheEnchantedCrystalArrowPrimaryHitAPResolved  = 200.0
	asheEnchantedCrystalArrowPrimaryHitAttackSpeed = 0.658
	asheEnchantedCrystalArrowPrimaryHitArmor       = 26.0
	asheEnchantedCrystalArrowPrimaryHitMR          = 30.0
	asheEnchantedCrystalArrowPrimaryHitHPRegen     = 3.5
	asheEnchantedCrystalArrowPrimaryHitManaRegen   = 7.0
	asheEnchantedCrystalArrowPrimaryHitTargetMR    = 100.0
	asheEnchantedCrystalArrowPrimaryHitTargetHP    = 1000.0

	// Independent cross-check: AP=200 → raw 840; MR 100 → mitigated 420.
	asheEnchantedCrystalArrowPrimaryHitExpectedRaw       = 840.0
	asheEnchantedCrystalArrowPrimaryHitExpectedMitigated = 420.0
	asheEnchantedCrystalArrowPrimaryHitManaAfter2        = 80.0  // 280 - 100 - 100
	asheEnchantedCrystalArrowPrimaryHitHPAfter2          = 160.0 // 1000 - 420 - 420

	asheEnchantedCrystalArrowPrimaryHitTol = 1e-9
)

func asheEnchantedCrystalArrowPrimaryHitExpectedRawFromAP(resolvedAP float64) float64 {
	return asheEnchantedCrystalArrowPrimaryHitBaseDamage +
		asheEnchantedCrystalArrowPrimaryHitAPRatio*resolvedAP
}

func asheEnchantedCrystalArrowPrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := asheEnchantedCrystalArrowPrimaryHitBaseDamage
	ratio := asheEnchantedCrystalArrowPrimaryHitAPRatio
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

func asheEnchantedCrystalArrowPrimaryHitAbility() model.AbilityDefinition {
	cost := asheEnchantedCrystalArrowPrimaryHitManaCost
	cd := asheEnchantedCrystalArrowPrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: asheEnchantedCrystalArrowPrimaryHitAbilityKey,
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
				DamageType:    "damage/magic", // runtime type 20221; not physical 20220
				Ref:           asheEnchantedCrystalArrowPrimaryHitDamageOpRef,
				Amount:        asheEnchantedCrystalArrowPrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func asheEnchantedCrystalArrowPrimaryHitProviderDef() model.ProviderDefinition {
	flatAP := asheEnchantedCrystalArrowPrimaryHitAPResolved - asheEnchantedCrystalArrowPrimaryHitAPBase
	return model.ProviderDefinition{
		ProviderKey: asheEnchantedCrystalArrowPrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    asheEnchantedCrystalArrowPrimaryHitStableID,
		// Fixture-only flat AP so ap.base stays 0 while ap.resolved becomes 200
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: asheEnchantedCrystalArrowPrimaryHitFixtureAPMod,
			Kind:        "attribute",
			Target:      "ap",
			ValuePolicy: "add",
			Value:       gfConst(flatAP),
		}},
		Abilities: []model.AbilityDefinition{asheEnchantedCrystalArrowPrimaryHitAbility()},
	}
}

func asheEnchantedCrystalArrowPrimaryHitAbilityRef() string {
	return "source.provider[" + asheEnchantedCrystalArrowPrimaryHitProviderRef +
		"].ability[" + asheEnchantedCrystalArrowPrimaryHitAbilityKey + "]"
}

func configureAsheEnchantedCrystalArrowPrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{asheEnchantedCrystalArrowPrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: asheEnchantedCrystalArrowPrimaryHitProviderRef, DefinitionRef: asheEnchantedCrystalArrowPrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: asheEnchantedCrystalArrowPrimaryHitProviderRef, DefinitionRef: asheEnchantedCrystalArrowPrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureAsheEnchantedCrystalArrowPrimaryHitTypes(req *model.CompileRequest) {
	formuladefinition.DeclareAttributes(req, "magic_resist")
	formuladefinition.SetDamageFormula(req, "damage/magic", formuladefinition.ResistanceDefense("magic_resist"))

	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
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

func loadAsheEnchantedCrystalArrowPrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureAsheEnchantedCrystalArrowPrimaryHitTypes(&compileReq)
	configureAsheEnchantedCrystalArrowPrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitHPBase, Current: asheEnchantedCrystalArrowPrimaryHitHPBase,
		Max: asheEnchantedCrystalArrowPrimaryHitHPBase, Resolved: asheEnchantedCrystalArrowPrimaryHitHPBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitADBase, Current: asheEnchantedCrystalArrowPrimaryHitADBase,
		Max: asheEnchantedCrystalArrowPrimaryHitADBase, Resolved: asheEnchantedCrystalArrowPrimaryHitADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitAPBase, Current: asheEnchantedCrystalArrowPrimaryHitAPBase,
		Max: asheEnchantedCrystalArrowPrimaryHitAPBase, Resolved: asheEnchantedCrystalArrowPrimaryHitAPBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitAttackSpeed, Current: asheEnchantedCrystalArrowPrimaryHitAttackSpeed,
		Max: asheEnchantedCrystalArrowPrimaryHitAttackSpeed, Resolved: asheEnchantedCrystalArrowPrimaryHitAttackSpeed,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitArmor, Current: asheEnchantedCrystalArrowPrimaryHitArmor,
		Max: asheEnchantedCrystalArrowPrimaryHitArmor, Resolved: asheEnchantedCrystalArrowPrimaryHitArmor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_resist", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitMR, Current: asheEnchantedCrystalArrowPrimaryHitMR,
		Max: asheEnchantedCrystalArrowPrimaryHitMR, Resolved: asheEnchantedCrystalArrowPrimaryHitMR,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp_regen", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitHPRegen, Current: asheEnchantedCrystalArrowPrimaryHitHPRegen,
		Max: asheEnchantedCrystalArrowPrimaryHitHPRegen, Resolved: asheEnchantedCrystalArrowPrimaryHitHPRegen,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "mana_regen", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitManaRegen, Current: asheEnchantedCrystalArrowPrimaryHitManaRegen,
		Max: asheEnchantedCrystalArrowPrimaryHitManaRegen, Resolved: asheEnchantedCrystalArrowPrimaryHitManaRegen,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: asheEnchantedCrystalArrowPrimaryHitMana, Max: asheEnchantedCrystalArrowPrimaryHitMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitTargetHP, Current: asheEnchantedCrystalArrowPrimaryHitTargetHP,
		Max: asheEnchantedCrystalArrowPrimaryHitTargetHP, Resolved: asheEnchantedCrystalArrowPrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: asheEnchantedCrystalArrowPrimaryHitTargetMR, Current: asheEnchantedCrystalArrowPrimaryHitTargetMR,
		Max: asheEnchantedCrystalArrowPrimaryHitTargetMR, Resolved: asheEnchantedCrystalArrowPrimaryHitTargetMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runAsheEnchantedCrystalArrowPrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func asheEnchantedCrystalArrowPrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func asheEnchantedCrystalArrowPrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func asheEnchantedCrystalArrowPrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != asheEnchantedCrystalArrowPrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func asheEnchantedCrystalArrowPrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == asheEnchantedCrystalArrowPrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertAsheEnchantedCrystalArrowPrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := asheEnchantedCrystalArrowPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != asheEnchantedCrystalArrowPrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, asheEnchantedCrystalArrowPrimaryHitProviderRef)
	}
	if p.StableID != asheEnchantedCrystalArrowPrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, asheEnchantedCrystalArrowPrimaryHitStableID)
	}
	if p.ProviderKey == asheProviderRef || p.StableID == asheStableID ||
		p.ProviderKey == asheVolleyProviderRef || p.StableID == asheVolleyStableID ||
		p.ProviderKey == "provider_hero_ashe_rangers_focus" ||
		p.ProviderKey == "provider_hero_ashe_w_volley" ||
		p.ProviderKey == "hero:ashe" || p.ProviderKey == "hero:ashe_volley" {
		t.Fatal("enchanted_crystal_arrow primary-hit must not reuse Rangers Focus / Volley / basic provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / Q Focus-Flurry / W coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no Frost/stun/Focus/Flurry state)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1 (fixture-only AP flat; no equipment/Q/W)", len(p.Modifiers))
	}
	if p.Modifiers[0].ModifierKey != asheEnchantedCrystalArrowPrimaryHitFixtureAPMod ||
		p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ap" ||
		p.Modifiers[0].ValuePolicy != "add" {
		t.Fatalf("modifier=%+v want fixture-only flat AP add %q",
			p.Modifiers[0], asheEnchantedCrystalArrowPrimaryHitFixtureAPMod)
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil (no projectile/AOE/field lifecycle)", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), asheEnchantedCrystalArrowPrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != asheEnchantedCrystalArrowPrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, asheEnchantedCrystalArrowPrimaryHitAbilityKey, asheEnchantedCrystalArrowPrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("enchanted_crystal_arrow must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("enchanted_crystal_arrow must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("enchanted_crystal_arrow must not carry tickSpec (no AOE/Frost ticks)")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("enchanted_crystal_arrow must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-asheEnchantedCrystalArrowPrimaryHitManaCost) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-asheEnchantedCrystalArrowPrimaryHitCDMs) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 60000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no cast/projectile/AOE/Frost)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target (runtime 20221)", op)
	}
	if op.DamageType == "damage/physical" {
		t.Fatal("enchanted_crystal_arrow must not use physical damage (20220)")
	}
	if op.CritEligible {
		t.Fatal("enchanted_crystal_arrow damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("enchanted_crystal_arrow damage must not be copyable on hit")
	}
	if op.Ref != asheEnchantedCrystalArrowPrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, asheEnchantedCrystalArrowPrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-asheEnchantedCrystalArrowPrimaryHitBaseDamage) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("base const=%+v want 600", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-asheEnchantedCrystalArrowPrimaryHitAPRatio) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("AP ratio=%+v want 1.20", mul.Args[0])
	}
	if mul.Args[1].Op != "read" || mul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved (must not bake fixture AP)", mul.Args[1])
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "stun" ||
			banned.Operation == "projectile" || banned.Operation == "multi_target" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" ||
			banned.Operation == "field" || banned.Operation == "nearsight" ||
			banned.DamageType == "damage/physical" {
			t.Fatalf("enchanted_crystal_arrow must not include cast/projectile/geometry/stun/AOE/Frost/sight/physical op: %+v", banned)
		}
	}
}

func findAsheEnchantedCrystalArrowPrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := asheEnchantedCrystalArrowPrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

// TestAsheEnchantedCrystalArrowPrimaryHitRank3DamageFormulaCrossCheck: independent numeric
// cross-check 600 + 1.20*200 = 840; MR 100 → mitigated 420.
func TestAsheEnchantedCrystalArrowPrimaryHitRank3DamageFormulaCrossCheck(t *testing.T) {
	raw := asheEnchantedCrystalArrowPrimaryHitExpectedRawFromAP(asheEnchantedCrystalArrowPrimaryHitAPResolved)
	if math.Abs(raw-asheEnchantedCrystalArrowPrimaryHitExpectedRaw) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, asheEnchantedCrystalArrowPrimaryHitExpectedRaw)
	}
	zeroAP := asheEnchantedCrystalArrowPrimaryHitExpectedRawFromAP(asheEnchantedCrystalArrowPrimaryHitAPBase)
	if math.Abs(zeroAP-asheEnchantedCrystalArrowPrimaryHitExpectedRaw) < asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatal("zero-AP raw must differ from AP200 raw (formula must read ap.resolved)")
	}
	mit := expectedMitigatedMagic(raw, asheEnchantedCrystalArrowPrimaryHitTargetMR)
	if math.Abs(mit-asheEnchantedCrystalArrowPrimaryHitExpectedMitigated) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, asheEnchantedCrystalArrowPrimaryHitExpectedMitigated)
	}
}

// TestAsheEnchantedCrystalArrowPrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent R provider: one magic damage op, cost/CD, fixture AP modifier with base AP0,
// no listener/state/Q/W/P/basic graph.
func TestAsheEnchantedCrystalArrowPrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadAsheEnchantedCrystalArrowPrimaryHitFixture(t)
	assertAsheEnchantedCrystalArrowPrimaryHitProviderShape(t, compileReq)
	if asheEnchantedCrystalArrowPrimaryHitProviderRef == asheProviderRef ||
		asheEnchantedCrystalArrowPrimaryHitProviderRef == asheVolleyProviderRef ||
		asheEnchantedCrystalArrowPrimaryHitProviderRef == "provider_hero_ashe_rangers_focus" ||
		asheEnchantedCrystalArrowPrimaryHitProviderRef == "provider_hero_ashe_w_volley" ||
		asheEnchantedCrystalArrowPrimaryHitStableID == asheStableID ||
		asheEnchantedCrystalArrowPrimaryHitStableID == asheVolleyStableID {
		t.Fatal("enchanted_crystal_arrow primary-hit must not reuse Rangers Focus / Volley provider refs")
	}
	if asheEnchantedCrystalArrowPrimaryHitAbilityKey == asheQKey ||
		asheEnchantedCrystalArrowPrimaryHitAbilityKey == asheVolleyAbilityKey ||
		asheEnchantedCrystalArrowPrimaryHitAbilityKey == asheAAKey ||
		asheEnchantedCrystalArrowPrimaryHitAbilityKey == "basic_attack" ||
		asheEnchantedCrystalArrowPrimaryHitAbilityKey == "rangers_focus" ||
		asheEnchantedCrystalArrowPrimaryHitAbilityKey == "volley" {
		t.Fatal("enchanted_crystal_arrow must not reuse Q / W / basic-attack ability keys")
	}
	if asheEnchantedCrystalArrowPrimaryHitDamageOpRef == asheArrowOpRef ||
		asheEnchantedCrystalArrowPrimaryHitDamageOpRef == asheNormalAAOpRef ||
		asheEnchantedCrystalArrowPrimaryHitDamageOpRef == asheVolleyDamageOpRef ||
		strings.Contains(asheEnchantedCrystalArrowPrimaryHitDamageOpRef, "rangers_focus") ||
		strings.Contains(asheEnchantedCrystalArrowPrimaryHitDamageOpRef, "volley") ||
		strings.Contains(asheEnchantedCrystalArrowPrimaryHitDamageOpRef, "flurry") {
		t.Fatal("enchanted_crystal_arrow primary-hit must not reuse Q / W / Flurry / basic operation refs")
	}
	if asheEnchantedCrystalArrowPrimaryHitAbilityID != "ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if asheEnchantedCrystalArrowPrimaryHitStableID != "hero_ashe_r_enchanted_crystal_arrow_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
	if asheEnchantedCrystalArrowPrimaryHitProviderRef != "provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit" {
		t.Fatal("provider ref constant drifted")
	}
	if asheEnchantedCrystalArrowPrimaryHitPlanRev != "ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1" {
		t.Fatal("plan-rev fixture metadata drifted")
	}
}

// TestAsheEnchantedCrystalArrowPrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-3 single-target immediate magic damage scaffold: cost 100,
// CD 60000ms exact boundary, AP200 via fixture modifier (base AP0 preserved),
// one magic hit per successful cast (no AA/crit/phantom/cast-delay/projectile/
// stun/AOE/Frost/sight/Q/W). Runtime damage type is magic (20221), not physical (20220).
func TestAsheEnchantedCrystalArrowPrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadAsheEnchantedCrystalArrowPrimaryHitFixture(t)
	assertAsheEnchantedCrystalArrowPrimaryHitProviderShape(t, compileReq)

	ref := asheEnchantedCrystalArrowPrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 59999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 60000},
	}
	runReq.StopPolicy.DurationMs = 60100

	done := runAsheEnchantedCrystalArrowPrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if asheEnchantedCrystalArrowPrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findAsheEnchantedCrystalArrowPrimaryHitAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt59999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 59999 {
			t.Fatalf("cooldown skip TimeMs=%d want 59999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 60000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 60000", item.Data["readyAtMs"])
		}
		skipAt59999 = true
	}
	if !skipAt59999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=59999 with readyAtMs=60000")
	}

	items := asheEnchantedCrystalArrowPrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("enchanted_crystal_arrow damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 60000}
	wantMit := expectedMitigatedMagic(asheEnchantedCrystalArrowPrimaryHitExpectedRaw, asheEnchantedCrystalArrowPrimaryHitTargetMR)
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
		if evidenceDataString(item.Data, "damageType") != "damage/magic" {
			t.Fatalf("damage[%d] type=%q want damage/magic (runtime 20221)", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataString(item.Data, "damageType") == "damage/physical" {
			t.Fatalf("damage[%d] must not be physical (20220)", i)
		}
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q want %q", i, evidenceDataString(item.Data, "abilityRef"), ref)
		}
		if evidenceDataString(item.Data, "providerRef") != asheEnchantedCrystalArrowPrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), asheEnchantedCrystalArrowPrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != asheEnchantedCrystalArrowPrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), asheEnchantedCrystalArrowPrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		rawAmt := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(rawAmt-asheEnchantedCrystalArrowPrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, rawAmt, asheEnchantedCrystalArrowPrimaryHitExpectedRaw)
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
	if math.Abs(done.Summary.TargetFinalHp-asheEnchantedCrystalArrowPrimaryHitHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, asheEnchantedCrystalArrowPrimaryHitHPAfter2)
	}
	wantHP := asheEnchantedCrystalArrowPrimaryHitTargetHP - wantDealt
	if math.Abs(wantHP-asheEnchantedCrystalArrowPrimaryHitHPAfter2) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("HP cross-check=%v want %v", wantHP, asheEnchantedCrystalArrowPrimaryHitHPAfter2)
	}

	gotMana := asheEnchantedCrystalArrowPrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-asheEnchantedCrystalArrowPrimaryHitManaAfter2) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 200; skipped attempt costs 0)",
			gotMana, asheEnchantedCrystalArrowPrimaryHitManaAfter2)
	}
	if math.Abs((asheEnchantedCrystalArrowPrimaryHitMana-gotMana)-200) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("mana spent=%v want 200", asheEnchantedCrystalArrowPrimaryHitMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/AOE/Frost/Q/W hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack / Focus-Flurry channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ap"); math.Abs(got-asheEnchantedCrystalArrowPrimaryHitAPResolved) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("ap.resolved=%v want %v", got, asheEnchantedCrystalArrowPrimaryHitAPResolved)
	}
	if got := sourceAttrBase(t, done.FinalSnapshot, "ap"); math.Abs(got-asheEnchantedCrystalArrowPrimaryHitAPBase) > asheEnchantedCrystalArrowPrimaryHitTol {
		t.Fatalf("ap.base=%v want %v (fixture AP must leave base independent)", got, asheEnchantedCrystalArrowPrimaryHitAPBase)
	}

	// Exclusions / no hidden behavior: Phase-A fixture only — not a claim about live game.
	p := asheEnchantedCrystalArrowPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider missing after run")
	}
	if len(p.Listeners) != 0 || len(p.InitialStateSchema) != 0 || p.Lifecycle != nil {
		t.Fatal("fixture must not grow listener/state/lifecycle after compile (Phase-A exclusions)")
	}
	a := p.Abilities[0]
	if a.TickSpec != nil || a.ListenerSpec != nil || a.CastCondition != nil || len(a.StateSchema) != 0 {
		t.Fatal("fixture ability must not carry cast/projectile/Frost/AOE/listener/state surfaces")
	}
	for _, op := range a.Operations {
		if op.Operation != "damage" || op.DamageType != "damage/magic" {
			t.Fatalf("fixture must remain single magic damage op only: %+v", op)
		}
	}
}
