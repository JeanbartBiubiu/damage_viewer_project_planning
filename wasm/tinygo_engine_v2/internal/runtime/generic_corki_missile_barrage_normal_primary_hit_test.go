package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_corki R Missile Barrage / 火箭轰击 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: corki-r-missile-barrage-normal-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank3_normal_missile_selected_primary_champion_first_enemy_hit; immediate_impact_scaffold;
//	physical_250_plus_0_85_bonus_ad; mana35_plus_one_missile_barrage_ammo_atomic_gate_and_spend;
//	initial_ammo_two_max_four; cooldown2000ms; no_direction_projectile_travel_collision_
//	explosion_aoe_multitarget_big_one_third_shot_cycle_double_damage_range_radius_periodic_
//	stock_recharge_respawn_refill_basic_attack_on_hit_recharge_reduction_crit_scaling_
//	malignance_eclipse_interaction_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_corki|R|火箭轰击
//	task wasm-generic-corki-missile-barrage-normal-primary-hit
//	Request Template:Data Corki/R → resolved Template:Data Corki/Missile Barrage
//	wikiPageId 1306946 / rev 4042863 / timestamp 2026-07-14T19:35:26Z
//	canonical rawByteSize 3065 / SHA256
//	  1c2da7a1ea6bd4904c498eeb823e75dbf0f1e354cf5fe22f72dee2bb09ac4845
//	数据参考/lol-wiki-current-champions/normalized/generic/corki-r.json
//	  authoritative normalized bytes 3265 / SHA256
//	  dcaa1352eba2fa1d6c2acfc1aba9320bccb200b5b9d00dba559373e0981adbe0
//	pages/raw siblings: pages/corki-r.json (bytes 691 / SHA256
//	  694cda4c4d4ee4e9606ac1ca82a7085f89b7898884b23653bf718e86bfcd5bc7),
//	  raw/corki-r.wikitext
//	Local raw materialization caveat: 3063 bytes / SHA256
//	  3764aafcecd5ef76f619472e443869c2ef43fd5b062894f6e111172f9a5cf91a.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction. This Wasm slice does not depend on
//	Backend seed file creation or hash.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_corki_r_missile_barrage_normal_primary_hit
//     (standalone; not P/Q/W/E/basic synthesis)
//   - ability ability_hero_corki_r_missile_barrage_normal_primary_hit with ability_key
//     missile_barrage_normal_primary_hit: active; castOrigin champion; mana Cost only
//     const35; cooldown const2000 ms; castCondition exact
//     gte(read source.resource.missile_barrage_ammo.current, const1)
//   - Combatant resources: mana + missile_barrage_ammo current2/max4 (fixture)
//   - Exactly two ordered operations:
//     step0 resource_change source/missile_barrage_ammo amount -1 policy add
//     step1 physical damage target opponent
//       250 + 0.85*(ad.resolved-ad.base) (binary tree; each AD path once)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listeners/state/ticks/repeat/control/projectile/geometry/AOE/multitarget/
//     explicit events — successful cast relies on runtime automatic ability_started.
//     Fixture may set castOrigin champion and AD/mana/ammo/HP/armor values; no
//     asserted damage behavior may depend on Web projecting castOrigin.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   direction / projectile travel / collision / explosion; AOE / multitarget;
//   Big One / third-shot cycle / double damage / range / radius; periodic stock /
//   recharge / respawn refill; basic-attack on-hit recharge reduction / crit
//   scaling; Malignance/Eclipse interaction; other ranks; full fidelity.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, bonus_ad_ratio,
// immediate_impact_scaffold.

const (
	corkiMBCandidateKey    = "hero_skill|hero_corki|R|火箭轰击"
	corkiMBTaskKey         = "wasm-generic-corki-missile-barrage-normal-primary-hit"
	corkiMBPlanRev         = "corki-r-missile-barrage-normal-primary-hit-phase-a-v1"
	corkiMBRequestTitle    = "Template:Data Corki/R"
	corkiMBResolvedTitle   = "Template:Data Corki/Missile Barrage"
	corkiMBWikiPageID      = 1306946
	corkiMBRevisionID      = 4042863
	corkiMBTimestamp       = "2026-07-14T19:35:26Z"
	corkiMBRawBytes        = 3065
	corkiMBLocalRawBytes   = 3063
	corkiMBNormalizedBytes = 3265
	corkiMBPagesBytes      = 691
	corkiMBContentSHA      = "1c2da7a1ea6bd4904c498eeb823e75dbf0f1e354cf5fe22f72dee2bb09ac4845"
	corkiMBLocalRawSHA     = "3764aafcecd5ef76f619472e443869c2ef43fd5b062894f6e111172f9a5cf91a"
	corkiMBNormalizedSHA   = "dcaa1352eba2fa1d6c2acfc1aba9320bccb200b5b9d00dba559373e0981adbe0"
	corkiMBPagesSHA        = "694cda4c4d4ee4e9606ac1ca82a7085f89b7898884b23653bf718e86bfcd5bc7"
	corkiMBBoundary        = "rank3_normal_missile_selected_primary_champion_first_enemy_hit; immediate_impact_scaffold; " +
		"physical_250_plus_0_85_bonus_ad; mana35_plus_one_missile_barrage_ammo_atomic_gate_and_spend; " +
		"initial_ammo_two_max_four; cooldown2000ms; " +
		"no_direction_projectile_travel_collision_explosion_aoe_multitarget_big_one_third_shot_cycle_" +
		"double_damage_range_radius_periodic_stock_recharge_respawn_refill_basic_attack_on_hit_" +
		"recharge_reduction_crit_scaling_malignance_eclipse_interaction_other_ranks_or_full_fidelity"

	corkiMBProviderRef = "provider_hero_corki_r_missile_barrage_normal_primary_hit"
	corkiMBStableID    = "hero_corki_r_missile_barrage_normal_primary_hit"
	corkiMBAbilityID   = "ability_hero_corki_r_missile_barrage_normal_primary_hit"
	corkiMBAbilityKey  = "missile_barrage_normal_primary_hit"
	corkiMBAmmoResKey  = "missile_barrage_ammo"
	corkiMBAmmoOpRef   = "op:corki_missile_barrage_normal_primary_hit_ammo"
	corkiMBDamageOpRef = "op:corki_missile_barrage_normal_primary_hit_damage"
	corkiMBBonusADMod  = "fixture_corki_missile_barrage_normal_primary_hit_bonus_ad"

	corkiMBBaseDamage   = 250.0
	corkiMBBonusADRatio = 0.85
	corkiMBManaCost     = 35.0
	corkiMBCDMs         = 2000.0

	corkiMBADBaseDefault     = 60.0
	corkiMBADResolvedDefault = 160.0 // bonusAD=100 → raw335
	corkiMBFixtureManaCD     = 105.0
	corkiMBFixtureManaShort  = 34.0
	corkiMBFixtureAmmoInit   = 2.0
	corkiMBFixtureAmmoMax    = 4.0
	corkiMBTargetArmor       = 100.0
	corkiMBTargetHP          = 1000.0

	corkiMBExpectedRawDefault = 335.0 // 250 + 0.85*100
	corkiMBExpectedMitDefault = 167.5 // armor100
	corkiMBManaAfter2         = 35.0  // 105 - 35 - 35
	corkiMBHPAfter2           = 665.0 // 1000 - 167.5 - 167.5
	corkiMBAmmoAfter2         = 0.0

	corkiMBTol = 1e-9
)

func corkiMBOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func corkiMBExpectedRawFromStats(resolvedAD, baseAD float64) float64 {
	return corkiMBBaseDamage + corkiMBBonusADRatio*(resolvedAD-baseAD)
}

func corkiMBDamageAmount() *model.GenericFormulaExpr {
	base := corkiMBBaseDamage
	adRatio := corkiMBBonusADRatio
	// Binary add: base + bonusAD; bonus AD = sub(ad.resolved, ad.base); each read once.
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &adRatio},
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

func corkiMBCastCondition() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "source.resource." + corkiMBAmmoResKey + ".current"},
			{Op: "const", Value: &one},
		},
	}
}

func corkiMBAmmoSpendAmount() *model.GenericFormulaExpr {
	negOne := -1.0
	return &model.GenericFormulaExpr{Op: "const", Value: &negOne}
}

func corkiMBCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += corkiMBCountPathReads(&expr.Args[i], path)
	}
	return n
}

func corkiMBAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
	t.Helper()
	if expr == nil {
		return
	}
	switch expr.Op {
	case "add", "sub", "mul", "div", "lt", "lte", "gt", "gte":
		if len(expr.Args) != 2 {
			t.Fatalf("op=%q arity=%d want binary 2", expr.Op, len(expr.Args))
		}
	}
	for i := range expr.Args {
		corkiMBAssertBinaryArity(t, &expr.Args[i])
	}
}

func corkiMBAbility() model.AbilityDefinition {
	cost := corkiMBManaCost
	cd := corkiMBCDMs
	return model.AbilityDefinition{
		AbilityKey: corkiMBAbilityKey,
		Kind:       "active",
		Types:      []string{},
		CastOrigin: model.CastOriginChampion,
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		CastCondition: corkiMBCastCondition(),
		// Exactly two ordered ops: Ammo spend then selected-primary physical hit.
		// No explicit event op — successful cast relies on automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:   "resource_change",
				Target:      "source",
				ResourceKey: corkiMBAmmoResKey,
				ValuePolicy: "add",
				Amount:      corkiMBAmmoSpendAmount(),
				Ref:         corkiMBAmmoOpRef,
			},
			{
				Operation:     "damage",
				Target:        "opponent",
				DamageType:    "damage/physical",
				Ref:           corkiMBDamageOpRef,
				Amount:        corkiMBDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func corkiMBProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: corkiMBProviderRef,
		Kind:        "champion",
		StableID:    corkiMBStableID,
		Abilities:   []model.AbilityDefinition{corkiMBAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed R provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: corkiMBBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func corkiMBAbilityRef() string {
	return "source.provider[" + corkiMBProviderRef + "].ability[" + corkiMBAbilityKey + "]"
}

type corkiMBFixtureOpts struct {
	baseAD      float64
	resolvedAD  float64
	armor       float64
	mana        float64
	hp          float64
	ammoCurrent float64
	ammoMax     float64
	// When true, ammoCurrent=0 is intentional (Ammo gate counterproof).
	ammoExplicit bool
}

func configureCorkiMBProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts corkiMBFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{corkiMBProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: corkiMBProviderRef, DefinitionRef: corkiMBProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: corkiMBProviderRef, DefinitionRef: corkiMBProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	compileReq.SharedProviders = providers
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snaps
	}
}

func ensureCorkiMBTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/physical", Domain: "damage"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "event/ability_started", Domain: "event"},
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

func loadCorkiMBFixture(t *testing.T, opts corkiMBFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/armor explicitly (AD0 / armor0 are valid).
	if opts.mana == 0 {
		opts.mana = corkiMBFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = corkiMBTargetHP
	}
	if opts.ammoMax == 0 {
		opts.ammoMax = corkiMBFixtureAmmoMax
	}
	if !opts.ammoExplicit && opts.ammoCurrent == 0 {
		opts.ammoCurrent = corkiMBFixtureAmmoInit
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureCorkiMBTypes(&compileReq)
	configureCorkiMBProvider(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, corkiMBFixtureManaCD),
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, corkiMBAmmoResKey, model.ResourceSlotDef{
		Current: opts.ammoCurrent, Max: opts.ammoMax,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runCorkiMB(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runCorkiMBFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	session := NewSession()
	session.ClearOutbox()
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, compileReq)); code != 0 {
		t.Fatalf("CompileFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	compiled := lastGenericCompileResult(session.OutboxBytes())
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatalf("compile failed: %+v", compiled)
	}
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	session.ClearOutbox()
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, runReq)); code != 0 {
		t.Fatalf("RunFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}
	session.ClearOutbox()
	releaseReq := model.ReleaseSessionRequest{
		SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash,
	}
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
		t.Fatalf("ReleaseSessionFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	released := lastGenericReleaseDone(session.OutboxBytes())
	if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
		t.Fatalf("release=%+v want ok released session %q", released, compiled.SessionID)
	}
	session.ClearOutbox()
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, runReq)); code != -1 {
		t.Fatalf("RunFrame after release code=%d want -1", code)
	}
	if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
		t.Fatal("after release want session_not_found")
	}
	return done
}

func corkiMBSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func corkiMBSourceAmmo(t *testing.T, snap model.Snapshot) (current, max float64) {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Resources[corkiMBAmmoResKey]
		if !ok {
			t.Fatal("source missile_barrage_ammo missing")
		}
		return slot.Current, slot.Max
	}
	t.Fatal("source missing")
	return 0, 0
}

func corkiMBSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes[attr]
		if !ok {
			t.Fatalf("source missing attr %s", attr)
		}
		return slot.Base
	}
	t.Fatal("source missing")
	return 0
}

func corkiMBSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func corkiMBDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := corkiMBAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != corkiMBDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func corkiMBAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func corkiMBFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == corkiMBProviderRef {
			return p
		}
	}
	return nil
}

func assertCorkiMBProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := corkiMBFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_corki_r_missile_barrage_normal_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != corkiMBProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, corkiMBProviderRef)
	}
	if p.StableID != corkiMBStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, corkiMBStableID)
	}
	banned := []string{
		"provider_hero_corki_p_", "provider_hero_corki_q_", "provider_hero_corki_w_",
		"provider_hero_corki_e_", "provider_hero_corki_basic_",
		"ability_hero_corki_p_", "ability_hero_corki_q_", "ability_hero_corki_w_",
		"ability_hero_corki_e_", "ability_hero_corki_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("missile barrage normal-primary-hit must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != corkiMBBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], corkiMBBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 when bonusAD=0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), corkiMBAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != corkiMBAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, corkiMBAbilityKey, corkiMBAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if a.CastOrigin != model.CastOriginChampion {
		t.Fatalf("castOrigin=%q want champion (fixture-only; no Web projection dependency)", a.CastOrigin)
	}
	if len(a.Types) != 0 {
		t.Fatalf("R Types=%v want empty (no ability-specific type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("missile_barrage_normal_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-corkiMBManaCost) > corkiMBTol {
		t.Fatalf("cost=%+v want mana const 35 only", a.Cost)
	}
	if a.Cost.AllowPartial {
		t.Fatal("mana cost must not allowPartial")
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-corkiMBCDMs) > corkiMBTol {
		t.Fatalf("cooldown=%+v want const 2000", a.Cooldown)
	}
	if a.CastCondition == nil || a.CastCondition.Op != "gte" || len(a.CastCondition.Args) != 2 {
		t.Fatalf("castCondition=%+v want gte(ammo.current, const1)", a.CastCondition)
	}
	if a.CastCondition.Args[0].Op != "read" ||
		a.CastCondition.Args[0].Path != "source.resource."+corkiMBAmmoResKey+".current" {
		t.Fatalf("castCondition read=%+v want source.resource.missile_barrage_ammo.current",
			a.CastCondition.Args[0])
	}
	if a.CastCondition.Args[1].Op != "const" || a.CastCondition.Args[1].Value == nil ||
		math.Abs(*a.CastCondition.Args[1].Value-1) > corkiMBTol {
		t.Fatalf("castCondition const=%+v want 1", a.CastCondition.Args[1])
	}
	if a.TickSpec != nil || a.ListenerSpec != nil || len(a.StateSchema) != 0 {
		t.Fatalf("must not carry tick/listener/state schema: tick=%v listener=%v state=%d",
			a.TickSpec != nil, a.ListenerSpec != nil, len(a.StateSchema))
	}
	if len(a.Operations) != 2 {
		t.Fatalf("operations=%d want exactly 2 (ammo spend then physical hit)", len(a.Operations))
	}
	ammoOp := a.Operations[0]
	if ammoOp.Operation != "resource_change" || ammoOp.Target != "source" ||
		ammoOp.ResourceKey != corkiMBAmmoResKey || ammoOp.ValuePolicy != "add" {
		t.Fatalf("step0=%+v want resource_change source/%s policy add", ammoOp, corkiMBAmmoResKey)
	}
	if ammoOp.Amount == nil || ammoOp.Amount.Op != "const" || ammoOp.Amount.Value == nil ||
		math.Abs(*ammoOp.Amount.Value-(-1)) > corkiMBTol {
		t.Fatalf("step0 amount=%+v want const -1", ammoOp.Amount)
	}
	if ammoOp.Ref != corkiMBAmmoOpRef {
		t.Fatalf("ammo op ref=%q want %q", ammoOp.Ref, corkiMBAmmoOpRef)
	}
	op := a.Operations[1]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "opponent" {
		t.Fatalf("step1 shape=%+v want physical damage to opponent", op)
	}
	if op.CritEligible {
		t.Fatal("missile barrage damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("missile barrage damage must not be copyable on hit")
	}
	if op.Ref != corkiMBDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, corkiMBDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const250, mul(0.85, sub(ad.resolved, ad.base)))", op.Amount)
	}
	corkiMBAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-corkiMBBaseDamage) > corkiMBTol {
		t.Fatalf("base const=%+v want 250", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-corkiMBBonusADRatio) > corkiMBTol {
		t.Fatalf("bonus AD ratio=%+v want 0.85", adMul.Args[0])
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 {
		t.Fatalf("bonus-AD sub=%+v want sub(resolved, base)", sub)
	}
	if sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD resolved read=%+v want source.attr.ad.resolved", sub.Args[0])
	}
	if sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("AD base read=%+v want source.attr.ad.base", sub.Args[1])
	}
	if corkiMBCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", corkiMBCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if corkiMBCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", corkiMBCountPathReads(op.Amount, "source.attr.ad.base"))
	}
	if corkiMBCountPathReads(op.Amount, "source.attr.ap.resolved") != 0 {
		t.Fatal("formula must not invent AP reads")
	}
	if corkiMBCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 0 ||
		corkiMBCountPathReads(op.Amount, "source.attr.crit_damage.resolved") != 0 {
		t.Fatal("primary-hit formula must not read crit attrs")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "knockback" || bannedOp.Operation == "reveal" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "channel" ||
			bannedOp.Operation == "matcher" || bannedOp.Operation == "sight" ||
			bannedOp.Operation == "dash" || bannedOp.Operation == "movement" ||
			bannedOp.Operation == "secondary" || bannedOp.Operation == "travel" ||
			bannedOp.Operation == "explosion" || bannedOp.Operation == "acquisition" {
			t.Fatalf("missile barrage must not include excluded op: %+v", bannedOp)
		}
	}
}

func findCorkiMBAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := corkiMBAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func corkiMBRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func corkiMBSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func corkiMBAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > corkiMBTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > corkiMBTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != corkiMBDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), corkiMBDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != corkiMBAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), corkiMBAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != corkiMBProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), corkiMBProviderRef)
	}
	if evidenceDataBool(item.Data, "phantom") {
		t.Fatal("damage must not be phantom")
	}
	if evidenceDataString(item.Data, "phase") != "original" {
		t.Fatalf("phase=%q want original", evidenceDataString(item.Data, "phase"))
	}
	if _, ok := item.Data["eligible"]; ok {
		t.Fatalf("must not carry crit evidence fields: %+v", item.Data)
	}
	if evidenceDataBool(item.Data, "copyableOnHit") || evidenceDataBool(item.Data, "copyable") {
		t.Fatalf("damage must not be copyable: %+v", item.Data)
	}
}

// TestCorkiMissileBarrageNormalPrimaryHitWikiIdentityAndCompileShape locks wiki/
// sidecar/pages/local-raw caveat, frozen boundary/ordered tags, and R provider/
// two-resource / two-op compile shape (no Backend seed hash dependency).
func TestCorkiMissileBarrageNormalPrimaryHitWikiIdentityAndCompileShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Description2, Leveling2, Description3, Description4, Leveling4 string
			Cooldown, Cost, Costtype, Damagetype, Notes                                 string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(corkiMBRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "corki-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != corkiMBNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), corkiMBNormalizedBytes)
	}
	if got := corkiMBSHA256Hex(sidecarRaw); got != corkiMBNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, corkiMBNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != corkiMBCandidateKey || doc.RequestTitle != corkiMBRequestTitle ||
		doc.ResolvedTitle != corkiMBResolvedTitle || doc.WikiPageID != corkiMBWikiPageID ||
		doc.RevisionID != corkiMBRevisionID || doc.RevisionTimestamp != corkiMBTimestamp ||
		doc.ContentSHA256 != corkiMBContentSHA || doc.RawByteSize != corkiMBRawBytes ||
		doc.SkillKey != "R" || doc.ZhDisplayName != "火箭轰击" || doc.OwnerID != "hero_corki" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "description2", "leveling2", "description3", "description4", "leveling4",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "35\n" || doc.Fields.Costtype != "mana + 1 Ammo\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "2\n" {
		t.Fatalf("cooldown=%q want 2 (rank CD = 2s → 2000ms)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling2, "{{ap|90 to 250}}") ||
		!strings.Contains(doc.Fields.Leveling2, "85% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling2, "Physical Damage") {
		t.Fatalf("leveling2=%q want rank3 physical 250 +85%% bonus AD", doc.Fields.Leveling2)
	}
	if !strings.Contains(doc.Fields.Description2, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description2, "first enemy hit") {
		t.Fatal("wiki description2 must retain physical damage / first-enemy-hit wording")
	}
	if !strings.Contains(doc.Fields.Description3, "maximum of 4") ||
		!strings.Contains(doc.Fields.Description3, "gains 2 charges") {
		t.Fatal("wiki description3 must retain initial2/max4 stock wording")
	}
	if !strings.Contains(doc.Fields.Description4, "Big One") ||
		!strings.Contains(doc.Fields.Description4, "Every third missile") {
		t.Fatal("wiki description4 must retain excluded Big One / third-shot framing")
	}
	if !strings.Contains(doc.Fields.Description, "on-hit") ||
		!strings.Contains(doc.Fields.Description, "recharge") {
		t.Fatal("wiki passive description must retain excluded on-hit recharge wording")
	}
	if !strings.Contains(doc.Fields.Notes, "Malignance") ||
		!strings.Contains(doc.Fields.Notes, "Eclipse") {
		t.Fatalf("notes missing excluded Malignance/Eclipse surface: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(corkiMBRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "corki-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != corkiMBPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), corkiMBPagesBytes)
	}
	if got := corkiMBSHA256Hex(pagesRaw); got != corkiMBPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, corkiMBPagesSHA)
	}
	var pages struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		PageID, RevisionID, RawByteSize                          int
	}
	if err := json.Unmarshal(pagesRaw, &pages); err != nil {
		t.Fatal(err)
	}
	if pages.CandidateKey != doc.CandidateKey || pages.RequestTitle != doc.RequestTitle ||
		pages.ResolvedTitle != doc.ResolvedTitle || pages.ContentSHA256 != doc.ContentSHA256 ||
		pages.PageID != doc.WikiPageID || pages.RevisionID != doc.RevisionID ||
		pages.RevisionTimestamp != doc.RevisionTimestamp || pages.RawByteSize != doc.RawByteSize ||
		pages.SkillKey != "R" || pages.ZhDisplayName != "火箭轰击" || pages.OwnerID != "hero_corki" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(corkiMBRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "corki-r.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != corkiMBLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), corkiMBLocalRawBytes)
	}
	localSHA := corkiMBSHA256Hex(rawBytes)
	if localSHA != corkiMBLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, corkiMBLocalRawSHA)
	}
	if localSHA == corkiMBContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == corkiMBRawBytes {
		t.Fatal("local raw byte length must differ from canonical 3065 (materialization caveat)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|90 to 250}}",
		"85% '''bonus''' AD",
		"|cost         = 35",
		"|cooldown     = 2",
		"|costtype     = mana + 1 Ammo",
		"|damagetype   = Physical",
		"{{as|physical damage}}",
		"first enemy hit",
		"maximum of 4",
		"gains 2 charges",
		"Big One",
		"Every third missile",
		"Malignance",
		"Eclipse",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if corkiMBPlanRev != "corki-r-missile-barrage-normal-primary-hit-phase-a-v1" || corkiMBBoundary !=
		"rank3_normal_missile_selected_primary_champion_first_enemy_hit; immediate_impact_scaffold; "+
			"physical_250_plus_0_85_bonus_ad; mana35_plus_one_missile_barrage_ammo_atomic_gate_and_spend; "+
			"initial_ammo_two_max_four; cooldown2000ms; "+
			"no_direction_projectile_travel_collision_explosion_aoe_multitarget_big_one_third_shot_cycle_"+
			"double_damage_range_radius_periodic_stock_recharge_respawn_refill_basic_attack_on_hit_"+
			"recharge_reduction_crit_scaling_malignance_eclipse_interaction_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}
	if corkiMBTaskKey != "wasm-generic-corki-missile-barrage-normal-primary-hit" {
		t.Fatal("task key drifted")
	}
	tags := corkiMBOrderedTags()
	wantTags := []string{
		"ability_cost_cooldown", "active_physical_damage", "bonus_ad_ratio", "immediate_impact_scaffold",
	}
	if len(tags) != len(wantTags) {
		t.Fatalf("ordered tags=%v want %v", tags, wantTags)
	}
	for i := range wantTags {
		if tags[i] != wantTags[i] {
			t.Fatalf("ordered tags[%d]=%q want %q", i, tags[i], wantTags[i])
		}
	}

	compileReq, _ := loadCorkiMBFixture(t, corkiMBFixtureOpts{
		baseAD: corkiMBADBaseDefault, resolvedAD: corkiMBADResolvedDefault,
		armor: corkiMBTargetArmor, mana: corkiMBFixtureManaCD,
	})
	assertCorkiMBProviderShape(t, compileReq, 1, true)
	rawX := corkiMBExpectedRawFromStats(corkiMBADResolvedDefault, corkiMBADBaseDefault)
	if math.Abs(rawX-corkiMBExpectedRawDefault) > corkiMBTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, corkiMBExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, corkiMBTargetArmor)
	if math.Abs(mitX-corkiMBExpectedMitDefault) > corkiMBTol {
		t.Fatalf("default mit=%v want %v", mitX, corkiMBExpectedMitDefault)
	}
	totalAsIf := corkiMBBaseDamage + corkiMBBonusADRatio*corkiMBADResolvedDefault
	if math.Abs(totalAsIf-corkiMBExpectedRawDefault) < corkiMBTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestCorkiMissileBarrageNormalPrimaryHitCooldownManaAmmoAbilityStarted: mana105/
// Ammo2/base60/resolved160/HP1000/armor100 at t0/t1999/t2000/t4000 →
// success/cooldown skip/success/Ammo condition skip; final mana35/Ammo0/HP665;
// exactly two damage settlements and two synthesized ability_started; first readyAt2000.
func TestCorkiMissileBarrageNormalPrimaryHitCooldownManaAmmoAbilityStarted(t *testing.T) {
	compileReq, runReq := loadCorkiMBFixture(t, corkiMBFixtureOpts{
		baseAD: corkiMBADBaseDefault, resolvedAD: corkiMBADResolvedDefault,
		armor: corkiMBTargetArmor, mana: corkiMBFixtureManaCD, hp: corkiMBTargetHP,
	})
	assertCorkiMBProviderShape(t, compileReq, 1, true)
	ref := corkiMBAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 2000},
		{EntryKey: "r_ammo", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4000},
	}
	runReq.StopPolicy.DurationMs = 4100
	done := runCorkiMB(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 4 {
		t.Fatalf("abilityAttemptCount=%d want 4", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 2 {
		t.Fatalf("attemptSkippedCount=%d want 2", done.Summary.AttemptSkippedCount)
	}
	if corkiMBSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	if corkiMBSkipReasonCount(done, model.AttemptSkipConditionFalse) != 1 {
		t.Fatal("expected exactly one condition_false (Ammo) skip")
	}
	stat := findCorkiMBAbilityStat(t, done)
	if stat.AttemptCount != 4 || stat.CastCount != 2 || stat.SkipCount != 2 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 4/2/2",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt1999 bool
	var ammoSkipAt4000 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		switch item.Data["skipReason"] {
		case string(model.AttemptSkipCooldownNotReady):
			if item.TimeMs != 1999 {
				t.Fatalf("cooldown skip TimeMs=%d want 1999", item.TimeMs)
			}
			if numericAsInt64(item.Data["readyAtMs"]) != 2000 {
				t.Fatalf("cooldown skip readyAtMs=%v want 2000", item.Data["readyAtMs"])
			}
			skipAt1999 = true
		case string(model.AttemptSkipConditionFalse):
			if item.TimeMs != 4000 {
				t.Fatalf("Ammo condition skip TimeMs=%d want 4000", item.TimeMs)
			}
			ammoSkipAt4000 = true
		}
	}
	if !skipAt1999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=1999 with readyAtMs=2000")
	}
	if !ammoSkipAt4000 {
		t.Fatal("missing condition_false skip evidence at t=4000")
	}

	items := corkiMBDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("R damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 2000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		corkiMBAssertDamage(t, item, corkiMBExpectedRawDefault, corkiMBExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * corkiMBExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-corkiMBHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, corkiMBHPAfter2)
	}
	gotMana := corkiMBSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-corkiMBManaAfter2) > corkiMBTol {
		t.Fatalf("mana=%v want %v", gotMana, corkiMBManaAfter2)
	}
	ammoCur, ammoMax := corkiMBSourceAmmo(t, done.FinalSnapshot)
	if math.Abs(ammoCur-corkiMBAmmoAfter2) > corkiMBTol || math.Abs(ammoMax-corkiMBFixtureAmmoMax) > corkiMBTol {
		t.Fatalf("ammo current/max=%v/%v want %v/%v", ammoCur, ammoMax, corkiMBAmmoAfter2, corkiMBFixtureAmmoMax)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := corkiMBAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic R; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 2000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-corkiMBADResolvedDefault) > corkiMBTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), corkiMBADResolvedDefault)
	}
	if math.Abs(corkiMBSourceAttrBase(t, done.FinalSnapshot, "ad")-corkiMBADBaseDefault) > corkiMBTol {
		t.Fatalf("ad.base=%v want %v",
			corkiMBSourceAttrBase(t, done.FinalSnapshot, "ad"), corkiMBADBaseDefault)
	}
}

// TestCorkiMissileBarrageNormalPrimaryHitBaselineAD60: base/resolved AD60 → raw250/mitigated125.
func TestCorkiMissileBarrageNormalPrimaryHitBaselineAD60(t *testing.T) {
	compileReq, runReq := loadCorkiMBFixture(t, corkiMBFixtureOpts{
		baseAD: 60, resolvedAD: 60, armor: corkiMBTargetArmor, mana: corkiMBFixtureManaCD,
	})
	assertCorkiMBProviderShape(t, compileReq, 1, false)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: corkiMBAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCorkiMB(t, compileReq, runReq)
	dmg := corkiMBDamageEvidence(done)
	if len(dmg) != 1 {
		t.Fatalf("R damage=%d want 1", len(dmg))
	}
	corkiMBAssertDamage(t, dmg[0], 250, 125)
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-60) > corkiMBTol {
		t.Fatalf("ad.resolved=%v want 60", sourceAttrResolved(t, done.FinalSnapshot, "ad"))
	}
	if math.Abs(corkiMBSourceAttrBase(t, done.FinalSnapshot, "ad")-60) > corkiMBTol {
		t.Fatalf("ad.base=%v want 60", corkiMBSourceAttrBase(t, done.FinalSnapshot, "ad"))
	}
}

// TestCorkiMissileBarrageNormalPrimaryHitBonusADEquivalence: AD0/100 and 60/160 both raw335.
func TestCorkiMissileBarrageNormalPrimaryHitBonusADEquivalence(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100", 0, 100},
		{"baseAD60_resolvedAD160", 60, 160},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadCorkiMBFixture(t, corkiMBFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: 0, mana: corkiMBFixtureManaCD,
			})
			assertCorkiMBProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: corkiMBAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runCorkiMB(t, compileReq, runReq)
			dmg := corkiMBDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage=%d want 1", len(dmg))
			}
			corkiMBAssertDamage(t, dmg[0], 335, 335)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > corkiMBTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(corkiMBSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > corkiMBTol {
				t.Fatalf("ad.base=%v want %v", corkiMBSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	totalAsIf := corkiMBBaseDamage + corkiMBBonusADRatio*160
	bonus := corkiMBExpectedRawFromStats(160, 60)
	if math.Abs(totalAsIf-bonus) < corkiMBTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestCorkiMissileBarrageNormalPrimaryHitMana34Ammo1ResourceInsufficient: mana34+Ammo1
// blocks with resource_insufficient; no mana/Ammo/HP/event mutation.
func TestCorkiMissileBarrageNormalPrimaryHitMana34Ammo1ResourceInsufficient(t *testing.T) {
	compileReq, runReq := loadCorkiMBFixture(t, corkiMBFixtureOpts{
		baseAD: corkiMBADBaseDefault, resolvedAD: corkiMBADResolvedDefault,
		armor: corkiMBTargetArmor, mana: corkiMBFixtureManaShort, hp: corkiMBTargetHP,
		ammoCurrent: 1, ammoMax: corkiMBFixtureAmmoMax, ammoExplicit: true,
	})
	ref := corkiMBAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCorkiMB(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if corkiMBSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(corkiMBSourceMana(t, done.FinalSnapshot)-corkiMBFixtureManaShort) > corkiMBTol {
		t.Fatalf("mana changed: got %v want %v",
			corkiMBSourceMana(t, done.FinalSnapshot), corkiMBFixtureManaShort)
	}
	ammoCur, _ := corkiMBSourceAmmo(t, done.FinalSnapshot)
	if math.Abs(ammoCur-1) > corkiMBTol {
		t.Fatalf("ammo changed: got %v want 1", ammoCur)
	}
	if math.Abs(done.Summary.TargetFinalHp-corkiMBTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, corkiMBTargetHP)
	}
	if len(corkiMBDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero R damage evidence")
	}
	if len(corkiMBAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestCorkiMissileBarrageNormalPrimaryHitMana35Ammo0ConditionFalse: mana35+Ammo0
// blocks by cast condition; no mana/Ammo/HP/event mutation (atomic staged gate).
func TestCorkiMissileBarrageNormalPrimaryHitMana35Ammo0ConditionFalse(t *testing.T) {
	compileReq, runReq := loadCorkiMBFixture(t, corkiMBFixtureOpts{
		baseAD: corkiMBADBaseDefault, resolvedAD: corkiMBADResolvedDefault,
		armor: corkiMBTargetArmor, mana: corkiMBManaCost, hp: corkiMBTargetHP,
		ammoCurrent: 0, ammoMax: corkiMBFixtureAmmoMax, ammoExplicit: true,
	})
	ref := corkiMBAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCorkiMB(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if corkiMBSkipReasonCount(done, model.AttemptSkipConditionFalse) != 1 {
		t.Fatal("want exactly one condition_false (Ammo gate)")
	}
	if corkiMBSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 0 {
		t.Fatal("Ammo0 with exact mana35 must not classify as resource_insufficient")
	}
	if math.Abs(corkiMBSourceMana(t, done.FinalSnapshot)-corkiMBManaCost) > corkiMBTol {
		t.Fatalf("mana changed: got %v want %v",
			corkiMBSourceMana(t, done.FinalSnapshot), corkiMBManaCost)
	}
	ammoCur, _ := corkiMBSourceAmmo(t, done.FinalSnapshot)
	if math.Abs(ammoCur-0) > corkiMBTol {
		t.Fatalf("ammo changed: got %v want 0", ammoCur)
	}
	if math.Abs(done.Summary.TargetFinalHp-corkiMBTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, corkiMBTargetHP)
	}
	if len(corkiMBDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero R damage evidence")
	}
	if len(corkiMBAbilityStartedEvidence(done)) != 0 {
		t.Fatal("cast-condition skip must not synthesize ability_started")
	}
}

// TestCorkiMissileBarrageNormalPrimaryHitDeterminismAndLifecycle: repeated
// CompileGeneric/RunGeneric evidence stability plus compile/session/run/release
// frame path (no Backend file creation or hash dependency).
func TestCorkiMissileBarrageNormalPrimaryHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadCorkiMBFixture(t, corkiMBFixtureOpts{
				baseAD: corkiMBADBaseDefault, resolvedAD: corkiMBADResolvedDefault,
				armor: corkiMBTargetArmor, mana: corkiMBFixtureManaCD,
			})
			ref := corkiMBAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1999},
				{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 2000},
				{EntryKey: "r_ammo", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4000},
			}
			r.StopPolicy.DurationMs = 4100
			done := runCorkiMB(t, c, r)
			sum, err := json.Marshal(done.Summary)
			if err != nil {
				t.Fatal(err)
			}
			ev, err := json.Marshal(done.Evidence)
			if err != nil {
				t.Fatal(err)
			}
			snap, err := json.Marshal(done.FinalSnapshot)
			if err != nil {
				t.Fatal(err)
			}
			return string(sum), string(ev), string(snap)
		}
		s1, e1, f1 := runOnce()
		s2, e2, f2 := runOnce()
		if s1 != s2 || e1 != e2 || f1 != f2 {
			t.Fatal("summary/evidence/finalSnapshot unstable across runs")
		}
	})

	t.Run("frame_release", func(t *testing.T) {
		c, r := loadCorkiMBFixture(t, corkiMBFixtureOpts{
			baseAD: corkiMBADBaseDefault, resolvedAD: corkiMBADResolvedDefault,
			armor: corkiMBTargetArmor, mana: corkiMBFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: corkiMBAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runCorkiMBFrames(t, c, r)
		if len(corkiMBDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path R damage=%d want 1", len(corkiMBDamageEvidence(done)))
		}
		corkiMBAssertDamage(t, corkiMBDamageEvidence(done)[0],
			corkiMBExpectedRawDefault, corkiMBExpectedMitDefault)
		if len(corkiMBAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
		ammoCur, _ := corkiMBSourceAmmo(t, done.FinalSnapshot)
		if math.Abs(ammoCur-1) > corkiMBTol {
			t.Fatalf("frame-path ammo=%v want 1 after one cast", ammoCur)
		}
	})
}
