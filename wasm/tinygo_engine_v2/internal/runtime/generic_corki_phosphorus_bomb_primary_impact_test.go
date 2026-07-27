package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_corki Q Phosphorus Bomb / 磷光炸弹 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: corki-q-phosphorus-bomb-primary-impact-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold;
//	magic_240_plus_1_25_bonus_ad_plus_1_00_ap; no_cast_time_location_targeting_range_
//	radius_geometry_projectile_travel_minimum_travel_time_explosion_aoe_multitarget_
//	surrounding_or_travel_sight_impact_area_sight_enemy_champion_reveal_six_second_
//	duration_spellshield_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_corki|Q|磷光炸弹
//	task wasm-generic-corki-phosphorus-bomb-primary-impact
//	Request Template:Data Corki/Q → resolved Template:Data Corki/Phosphorus Bomb
//	wikiPageId 1306953 / rev 4007588 / timestamp 2026-04-12T06:50:59Z
//	canonical rawByteSize 1531 / SHA256
//	  e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365
//	数据参考/lol-wiki-current-champions/normalized/generic/corki-q.json
//	  authoritative normalized bytes 2148 / SHA256
//	  3c4584b2e8442e7ff2ae1d2d4c4d8dff4613efa98bf7ba4cd3ab44ef05c8572d
//	pages/raw siblings: pages/corki-q.json (bytes 691 / SHA256
//	  bff7e3533e2bba561c03e91da5d7c07ffc095e07a0669b321cc7fd480d18f42a),
//	  raw/corki-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql
//	Local raw materialization caveat: 1529 bytes / SHA256
//	  c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_corki_q_phosphorus_bomb_primary_impact
//     (standalone; not P/W/E/R/basic synthesis)
//   - ability ability_hero_corki_q_phosphorus_bomb_primary_impact with ability_key
//     phosphorus_bomb_primary_impact: active; mana 80; cooldown 7000 ms
//   - Exactly one immediate selected-primary-champion magic damage op:
//     add(add(const 240, mul(const 1.25, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base))), mul(const 1.00,
//         read source.attr.ap.resolved))
//     (bonus AD via explicit sub; every arithmetic node binary; each read path
//     exactly once)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: magic 20221 + add policy 20170; 20230 forbidden
//   - No Corki Q state/modifier/listener/matcher/repeat/control/projectile/
//     AOE/sight/reveal/duration/secondary; no explicit event op — successful
//     cast relies on runtime automatic ability_started. Fixture may supply
//     entity/attribute/resource values (external-existing-data/check-only)
//     and may attach a fixture-only flat AD modifier so ad.resolved can differ
//     from ad.base; must not claim the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast time / location targeting / range / radius / geometry; projectile
//   travel / minimum travel time / explosion; AOE / multitarget / surrounding;
//   travel/impact-area sight; enemy-champion reveal / six-second duration;
//   spellshield; collision / acquisition; ranks 1–4; P/W/E/R/basic/siblings/
//   loadout/crit/on-hit; live/E2E/full fidelity.
//
// Ordered tags: ability_cost_cooldown, active_magic_damage, bonus_ad_ratio,
// ap_ratio, immediate_impact_scaffold (explicitly no salvage or
// meta_or_non_target_dps tag).

const (
	corkiPBCandidateKey    = "hero_skill|hero_corki|Q|磷光炸弹"
	corkiPBTaskKey         = "wasm-generic-corki-phosphorus-bomb-primary-impact"
	corkiPBPlanRev         = "corki-q-phosphorus-bomb-primary-impact-phase-a-v1"
	corkiPBRequestTitle    = "Template:Data Corki/Q"
	corkiPBResolvedTitle   = "Template:Data Corki/Phosphorus Bomb"
	corkiPBWikiPageID      = 1306953
	corkiPBRevisionID      = 4007588
	corkiPBTimestamp       = "2026-04-12T06:50:59Z"
	corkiPBRawBytes        = 1531
	corkiPBLocalRawBytes   = 1529
	corkiPBNormalizedBytes = 2148
	corkiPBPagesBytes      = 691
	corkiPBContentSHA      = "e71a474ef6b4df1df4808b397c8bd0f42ce284234f3eb7603fab09cabd760365"
	corkiPBLocalRawSHA     = "c39556a0d90226462e8a939ebe58888ec91325a9ca4d10be23e43dd77d948ba6"
	corkiPBNormalizedSHA   = "3c4584b2e8442e7ff2ae1d2d4c4d8dff4613efa98bf7ba4cd3ab44ef05c8572d"
	corkiPBPagesSHA        = "bff7e3533e2bba561c03e91da5d7c07ffc095e07a0669b321cc7fd480d18f42a"
	corkiPBBoundary        = "rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; " +
		"magic_240_plus_1_25_bonus_ad_plus_1_00_ap; " +
		"no_cast_time_location_targeting_range_radius_geometry_projectile_travel_" +
		"minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_" +
		"impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_" +
		"other_ranks_or_full_fidelity"

	corkiPBProviderRef = "provider_hero_corki_q_phosphorus_bomb_primary_impact"
	corkiPBStableID    = "hero_corki_q_phosphorus_bomb_primary_impact"
	corkiPBAbilityID   = "ability_hero_corki_q_phosphorus_bomb_primary_impact"
	corkiPBAbilityKey  = "phosphorus_bomb_primary_impact"
	corkiPBDamageOpRef = "op:corki_phosphorus_bomb_primary_impact_damage"
	corkiPBBonusADMod  = "fixture_corki_phosphorus_bomb_primary_impact_bonus_ad"

	corkiPBSeedBlobSHA  = "FA1AC4873824073C354B80FD5DC6C18055C82C23AE336C4A214259DBA00ECDD3"
	corkiPBJUnitBlobSHA = "16F0170EB37A0E9545EED9ECE169A30D81C90CDA1E4B92245986EE9404CD5752"

	corkiPBBaseDamage   = 240.0
	corkiPBBonusADRatio = 1.25
	corkiPBAPRatio      = 1.00
	corkiPBManaCost     = 80.0
	corkiPBCDMs         = 7000.0

	corkiPBADBaseDefault    = 60.0
	corkiPBADResolvedCD     = 156.0 // CD/mana fixture: bonusAD=96 → raw460
	corkiPBFixtureAPDefault = 100.0
	corkiPBFixtureManaCD    = 240.0
	corkiPBFixtureManaShort = 79.0
	corkiPBTargetMR         = 100.0
	corkiPBTargetHP         = 1000.0

	// CD fixture: bonusAD=96, AP=100 → raw 460; MR100 → mitigated 230.
	corkiPBExpectedRawDefault = 460.0
	corkiPBExpectedMitDefault = 230.0
	corkiPBManaAfter2         = 80.0  // 240 - 80 - 80
	corkiPBHPAfter2           = 540.0 // 1000 - 230 - 230

	corkiPBSeedDamageJSON = `{"op":"add","args":[{"op":"add","args":[{"op":"const","value":240},` +
		`{"op":"mul","args":[{"op":"const","value":1.25},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},` +
		`{"op":"mul","args":[{"op":"const","value":1.00},{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	corkiPBTol = 1e-9
)

func corkiPBOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"bonus_ad_ratio",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func corkiPBExpectedRawFromStats(resolvedAD, baseAD, resolvedAP float64) float64 {
	return corkiPBBaseDamage +
		corkiPBBonusADRatio*(resolvedAD-baseAD) +
		corkiPBAPRatio*resolvedAP
}

func corkiPBDamageAmount() *model.GenericFormulaExpr {
	base := corkiPBBaseDamage
	adRatio := corkiPBBonusADRatio
	apRatio := corkiPBAPRatio
	// Nested binary add: base + bonusAD + AP (generic add is binary-only).
	// Bonus AD = sub(ad.resolved, ad.base); each read path exactly once.
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

func corkiPBCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += corkiPBCountPathReads(&expr.Args[i], path)
	}
	return n
}

func corkiPBAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		corkiPBAssertBinaryArity(t, &expr.Args[i])
	}
}

func corkiPBAbility() model.AbilityDefinition {
	cost := corkiPBManaCost
	cd := corkiPBCDMs
	return model.AbilityDefinition{
		AbilityKey: corkiPBAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target magic damage; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           corkiPBDamageOpRef,
				Amount:        corkiPBDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func corkiPBProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: corkiPBProviderRef,
		Kind:        "champion",
		StableID:    corkiPBStableID,
		Abilities:   []model.AbilityDefinition{corkiPBAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: corkiPBBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func corkiPBAbilityRef() string {
	return "source.provider[" + corkiPBProviderRef + "].ability[" + corkiPBAbilityKey + "]"
}

type corkiPBFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
}

func configureCorkiPBProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts corkiPBFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{corkiPBProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: corkiPBProviderRef, DefinitionRef: corkiPBProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: corkiPBProviderRef, DefinitionRef: corkiPBProviderRef,
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

func ensureCorkiPBTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
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

func loadCorkiPBFixture(t *testing.T, opts corkiPBFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/mr explicitly
	// (AD0 / AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = corkiPBFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = corkiPBTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureCorkiPBTypes(&compileReq)
	configureCorkiPBProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/mana/HP/MR values (external-existing-data/check-only); do not
	// claim seed materializes hero_corki / ad / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, corkiPBFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runCorkiPB(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runCorkiPBFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func corkiPBSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func corkiPBSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func corkiPBSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func corkiPBDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := corkiPBAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != corkiPBDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func corkiPBAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only Q mounted, filter by
	// event ref and successful-cast times. Damage evidence still filters by op/ability.
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func corkiPBFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == corkiPBProviderRef {
			return p
		}
	}
	return nil
}

func assertCorkiPBProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := corkiPBFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_corki_q_phosphorus_bomb_primary_impact missing from SharedProviders")
	}
	if p.ProviderKey != corkiPBProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, corkiPBProviderRef)
	}
	if p.StableID != corkiPBStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, corkiPBStableID)
	}
	banned := []string{
		"provider_hero_corki_p_", "provider_hero_corki_w_", "provider_hero_corki_e_",
		"provider_hero_corki_r_", "provider_hero_corki_basic_",
		"ability_hero_corki_p_", "ability_hero_corki_w_", "ability_hero_corki_e_",
		"ability_hero_corki_r_", "ability_hero_corki_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("phosphorus bomb primary-impact must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != corkiPBBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], corkiPBBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production Q has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), corkiPBAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != corkiPBAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, corkiPBAbilityKey, corkiPBAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("Q Types=%v want empty (no ability-specific type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("phosphorus_bomb_primary_impact must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-corkiPBManaCost) > corkiPBTol {
		t.Fatalf("cost=%+v want mana const 80", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-corkiPBCDMs) > corkiPBTol {
		t.Fatalf("cooldown=%+v want const 7000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary magic impact hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("phosphorus bomb damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("phosphorus bomb damage must not be copyable on hit")
	}
	if op.Ref != corkiPBDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, corkiPBDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(add(base, bonusAD), AP)", op.Amount)
	}
	corkiPBAssertBinaryArity(t, op.Amount)
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const240, mul(1.25, sub(ad.resolved, ad.base)))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-corkiPBBaseDamage) > corkiPBTol {
		t.Fatalf("base const=%+v want 240", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-corkiPBBonusADRatio) > corkiPBTol {
		t.Fatalf("bonus AD ratio=%+v want 1.25", adMul.Args[0])
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
	if adMul.Args[1].Op == "read" && adMul.Args[1].Path == "source.attr.ad.resolved" {
		t.Fatal("bonus-AD branch must not read total ad.resolved alone (must sub base)")
	}
	if adMul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-corkiPBAPRatio) > corkiPBTol {
		t.Fatalf("AP ratio=%+v want 1.00", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if corkiPBCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", corkiPBCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if corkiPBCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", corkiPBCountPathReads(op.Amount, "source.attr.ad.base"))
	}
	if corkiPBCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", corkiPBCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if corkiPBCountPathReads(op.Amount, "source.attr.ap.base") != 0 {
		t.Fatal("formula must not invent ap.base reads")
	}
	if corkiPBCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 0 ||
		corkiPBCountPathReads(op.Amount, "source.attr.crit_damage.resolved") != 0 {
		t.Fatal("primary-impact formula must not read crit attrs")
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
			t.Fatalf("phosphorus bomb must not include excluded op: %+v", bannedOp)
		}
	}
}

func findCorkiPBAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := corkiPBAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func corkiPBRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func corkiPBLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(corkiPBRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql"))
	if err != nil {
		t.Fatal(err)
	}
	full = string(raw)
	var b strings.Builder
	for _, line := range strings.Split(full, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return full, b.String()
}

func corkiPBSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func corkiPBSHA256HexUpper(b []byte) string {
	return strings.ToUpper(corkiPBSHA256Hex(b))
}

func corkiPBAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > corkiPBTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > corkiPBTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != corkiPBDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), corkiPBDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != corkiPBAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), corkiPBAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != corkiPBProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), corkiPBProviderRef)
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

// TestCorkiPhosphorusBombPrimaryImpactSourceSeedProviderFormulaShape locks wiki/sidecar/
// pages/local-raw caveat, seed/README/JUnit identities and source blob hashes,
// external-existing-data check-only prerequisites / non-materialization,
// ordered tags (no salvage / meta_or_non_target_dps), type-policy evidence, and Q
// provider/nested bonusAD+AP formula shape.
func TestCorkiPhosphorusBombPrimaryImpactSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Description2, Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(corkiPBRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "corki-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != corkiPBNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), corkiPBNormalizedBytes)
	}
	if got := corkiPBSHA256Hex(sidecarRaw); got != corkiPBNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, corkiPBNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != corkiPBCandidateKey || doc.RequestTitle != corkiPBRequestTitle ||
		doc.ResolvedTitle != corkiPBResolvedTitle || doc.WikiPageID != corkiPBWikiPageID ||
		doc.RevisionID != corkiPBRevisionID || doc.RevisionTimestamp != corkiPBTimestamp ||
		doc.ContentSHA256 != corkiPBContentSHA || doc.RawByteSize != corkiPBRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "磷光炸弹" || doc.OwnerID != "hero_corki" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "description2",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|60 to 80}}\n" || doc.Fields.Costtype != "mana\n" ||
		doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|9 to 7}}\n" {
		t.Fatalf("cooldown=%q want {{ap|9 to 7}} (rank-5 = 7s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|60 to 240}}") ||
		!strings.Contains(doc.Fields.Leveling, "125% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling, "100% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling=%q want rank5 magic 240 +125%% bonus AD +100%% AP", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") ||
		!strings.Contains(doc.Fields.Description, "explodes") ||
		!strings.Contains(doc.Fields.Description, "{{tip|sight}}") {
		t.Fatal("wiki prose must retain magic damage / explosion / travel-sight wording")
	}
	if !strings.Contains(doc.Fields.Description2, "6 seconds") ||
		!strings.Contains(doc.Fields.Description2, "reveals") ||
		!strings.Contains(doc.Fields.Description2, "{{tip|sight}}") {
		t.Fatal("wiki description2 must retain excluded six-second sight/reveal surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "minimum travel time") {
		t.Fatalf("notes missing excluded minimum travel time surface: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(corkiPBRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "corki-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != corkiPBPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), corkiPBPagesBytes)
	}
	if got := corkiPBSHA256Hex(pagesRaw); got != corkiPBPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, corkiPBPagesSHA)
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "磷光炸弹" || pages.OwnerID != "hero_corki" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(corkiPBRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "corki-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != corkiPBLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), corkiPBLocalRawBytes)
	}
	localSHA := corkiPBSHA256Hex(rawBytes)
	if localSHA != corkiPBLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, corkiPBLocalRawSHA)
	}
	if localSHA == corkiPBContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == corkiPBRawBytes {
		t.Fatal("local raw byte length must differ from canonical 1531 (materialization caveat)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|60 to 240}}",
		"125% '''bonus''' AD",
		"100% AP",
		"|cost         = {{ap|60 to 80}}",
		"|cooldown     = {{ap|9 to 7}}",
		"|damagetype   = Magic",
		"{{as|magic damage}}",
		"explodes",
		"{{tip|sight}}",
		"reveals",
		"6 seconds",
		"minimum travel time",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if corkiPBPlanRev != "corki-q-phosphorus-bomb-primary-impact-phase-a-v1" || corkiPBBoundary !=
		"rank5_selected_primary_champion_single_magic_impact_hit; immediate_impact_scaffold; "+
			"magic_240_plus_1_25_bonus_ad_plus_1_00_ap; "+
			"no_cast_time_location_targeting_range_radius_geometry_projectile_travel_"+
			"minimum_travel_time_explosion_aoe_multitarget_surrounding_or_travel_sight_"+
			"impact_area_sight_enemy_champion_reveal_six_second_duration_spellshield_"+
			"other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := corkiPBRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := corkiPBSHA256HexUpper(seedBytes); got != corkiPBSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, corkiPBSeedBlobSHA)
	}
	junitPath := corkiPBRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := corkiPBSHA256HexUpper(junitBytes); got != corkiPBJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, corkiPBJUnitBlobSHA)
	}
	_ = corkiPBRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := corkiPBLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(corkiPBRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		corkiPBCandidateKey, corkiPBTaskKey, corkiPBPlanRev,
		corkiPBRequestTitle, corkiPBResolvedTitle,
		"1306953", "4007588", corkiPBTimestamp, "1531", "1529", "2148", "691",
		corkiPBContentSHA, corkiPBLocalRawSHA, corkiPBNormalizedSHA, corkiPBPagesSHA,
		corkiPBBoundary, corkiPBProviderRef, corkiPBAbilityID, corkiPBAbilityKey,
		"phosphorus_bomb_primary_impact_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":80}`, `{"op":"const","value":7000}`,
		corkiPBSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/corki-q.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"bonus AD", "source.attr.ad.resolved", "source.attr.ad.base",
		"source.attr.ap.resolved",
		"ability_started",
		"20221", "20170",
		"missing game_entities hero_corki",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_corki/ad",
		"missing entity_attribute_values hero_corki/ap",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_corki/mana",
		"missing reserved_type",
		"240", "1.25", "1.00",
		"嵌套二元",
		"meta_or_non_target_dps",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range corkiPBOrderedTags() {
		if !strings.Contains(seed, tag) {
			t.Fatalf("seed missing ordered tag %q", tag)
		}
	}
	ordIdx := strings.Index(seed, "Ordered tags")
	if ordIdx < 0 {
		t.Fatal("seed missing Ordered tags section")
	}
	ordSection := seed[ordIdx:]
	if end := strings.Index(ordSection, "契约要点"); end > 0 {
		ordSection = ordSection[:end]
	}
	prev := -1
	for _, tag := range corkiPBOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if regexp.MustCompile(`(?m)^\s*(?:--\s*)?(?:[-*]?\s*)?\d+\.\s*`+"`?"+`salvage`+"`?"+`\b`).MatchString(ordSection) ||
		regexp.MustCompile(`(?m)^\s*(?:--\s*)?(?:[-*]?\s*)?\d+\.\s*`+"`?"+`\S*salvage\S*`+"`?"+`\b`).MatchString(ordSection) {
		t.Fatal("must not add a salvage governed ordered tag")
	}
	if !strings.Contains(ordSection, "salvage") {
		t.Fatal("seed ordered-tags section must explicitly exclude salvage tags")
	}
	if regexp.MustCompile(`(?m)^\s*(?:--\s*)?(?:[-*]?\s*)?\d+\.\s*` + "`?" + `meta_or_non_target_dps` + "`?" + `\b`).MatchString(ordSection) {
		t.Fatal("must not add a meta_or_non_target_dps governed ordered tag")
	}
	if !strings.Contains(ordSection, "meta_or_non_target_dps") {
		t.Fatal("seed ordered-tags section must explicitly exclude meta_or_non_target_dps")
	}
	if regexp.MustCompile(`(?i)Batch-B\s+prerequisite`).MatchString(seed) {
		t.Fatal("seed must not use Batch-B prerequisite wording")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ad.resolved"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ad.resolved exactly once")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ad.base"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ad.base exactly once")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ap.resolved"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ap.resolved exactly once")
	}
	if strings.Contains(sqlNoComments, `"path":"source.attr.ap.base"`) {
		t.Fatal("executable SQL must not invent ap.base reads")
	}
	if !strings.Contains(sqlNoComments, `"op":"sub"`) {
		t.Fatal("executable SQL must use sub(resolved, base) for bonus AD")
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.ability_definitions",
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.entity_provider_mounts",
		"phase_hero_corki_q_phosphorus_bomb_primary_impact_impact",
		"sequence_hero_corki_q_phosphorus_bomb_primary_impact_impact",
		"step_hero_corki_q_phosphorus_bomb_primary_impact_damage",
	} {
		if !strings.Contains(sqlNoComments, needle) {
			t.Fatalf("executable seed missing %q", needle)
		}
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.provider_definitions") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_definitions") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_phases") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.damage_effect_details") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.entity_provider_mounts") != 1 {
		t.Fatal("seed must define exactly one provider/ability/phase/detail/mount")
	}
	if !regexp.MustCompile(`(?s)'ability_hero_corki_q_phosphorus_bomb_primary_impact'\s*,\s*` +
		`'provider_hero_corki_q_phosphorus_bomb_primary_impact'\s*,\s*` +
		`'phosphorus_bomb_primary_impact'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key phosphorus_bomb_primary_impact")
	}
	if !regexp.MustCompile(`(?s)'step_hero_corki_q_phosphorus_bomb_primary_impact_damage'\s*,\s*` +
		`'phosphorus_bomb_primary_impact_damage'\s*,\s*20221\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be magic 20221 add policy copyable_on_hit=false")
	}
	if regexp.MustCompile(`(?is)\b20230\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL/graph must not use provider_action/apply 20230")
	}

	forbiddenSurfaces := []string{
		"provider_listeners", "provider_state_fields", "state_effect_details",
		"event_effect_details", "modifier_effect_details", "modifier_definitions",
		"provider_modifiers", "repeat_effect_details", "control_effect_details",
		"projectile_effect_details", "aoe_effect_details",
	}
	for _, table := range forbiddenSurfaces {
		pat := regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.` + table + `\b`)
		if pat.MatchString(sqlNoComments) {
			t.Fatalf("must not write public.%s", table)
		}
	}
	for _, table := range []string{
		"attribute_definitions", "resource_definitions", "game_entities",
		"entity_attribute_values", "entity_resource_values",
	} {
		pat := regexp.MustCompile(`(?is)(?:INSERT\s+INTO|UPDATE|MERGE\s+INTO|DELETE\s+FROM)\s+public\.` + table + `\b`)
		if pat.MatchString(sqlNoComments) {
			t.Fatalf("must not write public.%s (external existing-data / check-only)", table)
		}
	}
	if regexp.MustCompile(`(?is)'provider_hero_corki_[pwer]_|'ability_hero_corki_[pwer]_|` +
		`'provider_hero_corki_basic_|'ability_hero_corki_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/W/E/R/basic graph rows")
	}
	for _, banned := range []string{
		"projectile", "spellshield", "reveal", "aoe", "multitarget",
	} {
		if strings.Contains(sqlNoComments, banned) {
			t.Fatalf("standalone Q seed must not contain excluded graph token %q", banned)
		}
	}

	for _, want := range []string{
		corkiPBCandidateKey, corkiPBTaskKey, corkiPBPlanRev,
		"lol_generic_corki_phosphorus_bomb_primary_impact_seed.sql",
		"LolGenericCorkiPhosphorusBombPrimaryImpactSeedSqlTest",
		"external existing-data",
		"magic_240_plus_1_25_bonus_ad_plus_1_00_ap",
		"bonus_ad_ratio", "ap_ratio",
		"meta_or_non_target_dps",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "salvage") {
		t.Fatal("README must document salvage tag exclusion")
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Corki identity/panel/resource")
	}
	if strings.Contains(readme, "op:corki_phosphorus_bomb_primary_impact_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}
	if strings.Contains(readme, "fixture_corki_phosphorus_bomb_primary_impact_bonus_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production Q behavior")
	}

	compileReq, _ := loadCorkiPBFixture(t, corkiPBFixtureOpts{
		baseAD: corkiPBADBaseDefault, resolvedAD: corkiPBADResolvedCD,
		resolvedAP: corkiPBFixtureAPDefault, mr: corkiPBTargetMR, mana: corkiPBFixtureManaCD,
	})
	assertCorkiPBProviderShape(t, compileReq, 1, true)
	rawX := corkiPBExpectedRawFromStats(
		corkiPBADResolvedCD, corkiPBADBaseDefault, corkiPBFixtureAPDefault)
	if math.Abs(rawX-corkiPBExpectedRawDefault) > corkiPBTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, corkiPBExpectedRawDefault)
	}
	mitX := expectedMitigatedMagic(rawX, corkiPBTargetMR)
	if math.Abs(mitX-corkiPBExpectedMitDefault) > corkiPBTol {
		t.Fatalf("default mit=%v want %v", mitX, corkiPBExpectedMitDefault)
	}
	totalAsIf := corkiPBBaseDamage +
		corkiPBBonusADRatio*corkiPBADResolvedCD +
		corkiPBAPRatio*corkiPBFixtureAPDefault
	if math.Abs(totalAsIf-corkiPBExpectedRawDefault) < corkiPBTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestCorkiPhosphorusBombPrimaryImpactFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/AP/MR raw/final table; one isolated successful Q cast per row.
func TestCorkiPhosphorusBombPrimaryImpactFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		baseAD, resolvedAD     float64
		resolvedAP, mr         float64
		wantRaw, wantMitigated float64
	}{
		{"base60_resolved60_AP0_MR0", 60, 60, 0, 0, 240, 240},
		{"base60_resolved160_AP0_MR0", 60, 160, 0, 0, 365, 365},
		{"base60_resolved60_AP100_MR0", 60, 60, 100, 0, 340, 340},
		{"base60_resolved160_AP100_MR0", 60, 160, 100, 0, 465, 465},
		{"base60_resolved156_AP100_MR100", 60, 156, 100, 100, 460, 230},
		{"base60_resolved220_AP100_MR100", 60, 220, 100, 100, 540, 270},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := corkiPBExpectedRawFromStats(tc.resolvedAD, tc.baseAD, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > corkiPBTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > corkiPBTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadCorkiPBFixture(t, corkiPBFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: corkiPBFixtureManaCD,
			})
			assertCorkiPBProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := corkiPBAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runCorkiPB(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := corkiPBDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			corkiPBAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > corkiPBTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(corkiPBSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > corkiPBTol {
				t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)",
					corkiPBSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > corkiPBTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(corkiPBAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(corkiPBAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestCorkiPhosphorusBombPrimaryImpactBonusADCounterproof: baseAD0/resolvedAD100
// versus baseAD60/resolvedAD160 at AP0/MR0 must both raw/final 365 — equal bonus AD.
func TestCorkiPhosphorusBombPrimaryImpactBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100", 0, 100},
		{"baseAD60_resolvedAD160", 60, 160},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadCorkiPBFixture(t, corkiPBFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: 0, mr: 0, mana: corkiPBFixtureManaCD,
			})
			assertCorkiPBProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: corkiPBAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runCorkiPB(t, compileReq, runReq)
			dmg := corkiPBDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			corkiPBAssertDamage(t, dmg[0], 365, 365)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > corkiPBTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(corkiPBSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > corkiPBTol {
				t.Fatalf("ad.base=%v want %v", corkiPBSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-0) > corkiPBTol {
				t.Fatalf("ap.resolved=%v want 0", sourceAttrResolved(t, done.FinalSnapshot, "ap"))
			}
		})
	}
	totalAsIf := corkiPBBaseDamage + corkiPBBonusADRatio*160
	bonus := corkiPBExpectedRawFromStats(160, 60, 0)
	if math.Abs(totalAsIf-bonus) < corkiPBTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestCorkiPhosphorusBombPrimaryImpactCooldownMana240AbilityStarted: mana240/
// base60/resolved156/AP100/HP1000/MR100 at t0/t6999/t7000 →
// success/cooldown skip/success; final mana80/HP540; exactly two Q damage
// items and two automatic Q ability_started events.
func TestCorkiPhosphorusBombPrimaryImpactCooldownMana240AbilityStarted(t *testing.T) {
	compileReq, runReq := loadCorkiPBFixture(t, corkiPBFixtureOpts{
		baseAD: corkiPBADBaseDefault, resolvedAD: corkiPBADResolvedCD,
		resolvedAP: corkiPBFixtureAPDefault, mr: corkiPBTargetMR,
		mana: corkiPBFixtureManaCD, hp: corkiPBTargetHP,
	})
	assertCorkiPBProviderShape(t, compileReq, 1, true)
	ref := corkiPBAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7000},
	}
	runReq.StopPolicy.DurationMs = 7100
	done := runCorkiPB(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if corkiPBSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findCorkiPBAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt6999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 6999 {
			t.Fatalf("cooldown skip TimeMs=%d want 6999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 7000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 7000", item.Data["readyAtMs"])
		}
		skipAt6999 = true
	}
	if !skipAt6999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=6999 with readyAtMs=7000")
	}

	items := corkiPBDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 7000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		corkiPBAssertDamage(t, item, corkiPBExpectedRawDefault, corkiPBExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * corkiPBExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-corkiPBHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, corkiPBHPAfter2)
	}
	gotMana := corkiPBSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-corkiPBManaAfter2) > corkiPBTol {
		t.Fatalf("mana=%v want %v", gotMana, corkiPBManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := corkiPBAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 7000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-corkiPBADResolvedCD) > corkiPBTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), corkiPBADResolvedCD)
	}
	if math.Abs(corkiPBSourceAttrBase(t, done.FinalSnapshot, "ad")-corkiPBADBaseDefault) > corkiPBTol {
		t.Fatalf("ad.base=%v want %v",
			corkiPBSourceAttrBase(t, done.FinalSnapshot, "ad"), corkiPBADBaseDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-corkiPBFixtureAPDefault) > corkiPBTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), corkiPBFixtureAPDefault)
	}
}

// TestCorkiPhosphorusBombPrimaryImpactResourceInsufficientMana79: mana79 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/start evidence.
func TestCorkiPhosphorusBombPrimaryImpactResourceInsufficientMana79(t *testing.T) {
	compileReq, runReq := loadCorkiPBFixture(t, corkiPBFixtureOpts{
		baseAD: corkiPBADBaseDefault, resolvedAD: corkiPBADResolvedCD,
		resolvedAP: corkiPBFixtureAPDefault, mr: corkiPBTargetMR,
		mana: corkiPBFixtureManaShort, hp: corkiPBTargetHP,
	})
	ref := corkiPBAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCorkiPB(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if corkiPBSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(corkiPBSourceMana(t, done.FinalSnapshot)-corkiPBFixtureManaShort) > corkiPBTol {
		t.Fatalf("mana changed: got %v want %v",
			corkiPBSourceMana(t, done.FinalSnapshot), corkiPBFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-corkiPBTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, corkiPBTargetHP)
	}
	if len(corkiPBDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(corkiPBAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestCorkiPhosphorusBombPrimaryImpactStandaloneNoSiblingSynthesis: standalone Q
// provider does not synthesize P/W/E/R/basic or overwrite unrelated definitions.
func TestCorkiPhosphorusBombPrimaryImpactStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadCorkiPBFixture(t, corkiPBFixtureOpts{
		baseAD: corkiPBADBaseDefault, resolvedAD: corkiPBADResolvedCD,
		resolvedAP: corkiPBFixtureAPDefault, mr: corkiPBTargetMR,
		mana: corkiPBFixtureManaCD,
	})
	assertCorkiPBProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_corki_phosphorus_bomb_unrelated_sentinel"
	sentinelStable := "fixture_corki_phosphorus_bomb_unrelated_stable"
	sentinel := model.ProviderDefinition{
		ProviderKey: sentinelKey,
		Kind:        "champion",
		StableID:    sentinelStable,
		Abilities: []model.AbilityDefinition{{
			AbilityKey: "sentinel_noop",
			Kind:       "active",
			Operations: nil,
		}},
	}
	before, err := json.Marshal(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	compileReq.SharedProviders = append(compileReq.SharedProviders, sentinel)

	if len(compileReq.Combatants[0].Providers) != 1 ||
		compileReq.Combatants[0].Providers[0].ProviderRef != corkiPBProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != corkiPBProviderRef {
			t.Fatalf("source snapshots=%+v want only Q", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_corki_[pwer]_|ability_hero_corki_[pwer]_|` +
		`provider_hero_corki_basic_|ability_hero_corki_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == corkiPBProviderRef || p.StableID == corkiPBStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != corkiPBProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := corkiPBAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCorkiPB(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(corkiPBDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(corkiPBDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(corkiPBAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic Q ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only Q", done.Summary.AbilityStats)
	}

	var found *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == sentinelKey {
			found = &compileReq.SharedProviders[i]
		}
	}
	if found == nil {
		t.Fatal("unrelated sentinel provider definition was dropped")
	}
	after, err := json.Marshal(*found)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("unrelated sentinel definition overwritten:\nbefore=%s\nafter=%s", before, after)
	}
	for _, mount := range compileReq.Combatants[0].Providers {
		if mount.ProviderRef == sentinelKey {
			t.Fatal("sentinel must remain unmounted")
		}
	}
	for _, snapC := range done.FinalSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		for _, ps := range snapC.Providers {
			if ps.ProviderRef == sentinelKey {
				t.Fatal("sentinel must not appear in final provider snapshots")
			}
			if siblingPat.MatchString(ps.ProviderRef) || siblingPat.MatchString(ps.DefinitionRef) {
				if ps.ProviderRef == corkiPBProviderRef || ps.DefinitionRef == corkiPBProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestCorkiPhosphorusBombPrimaryImpactDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// wrong/missing/released session behavior.
func TestCorkiPhosphorusBombPrimaryImpactDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadCorkiPBFixture(t, corkiPBFixtureOpts{
				baseAD: corkiPBADBaseDefault, resolvedAD: corkiPBADResolvedCD,
				resolvedAP: corkiPBFixtureAPDefault, mr: corkiPBTargetMR,
				mana: corkiPBFixtureManaCD,
			})
			ref := corkiPBAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7000},
			}
			r.StopPolicy.DurationMs = 7100
			done := runCorkiPB(t, c, r)
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
		c, r := loadCorkiPBFixture(t, corkiPBFixtureOpts{
			baseAD: corkiPBADBaseDefault, resolvedAD: corkiPBADResolvedCD,
			resolvedAP: corkiPBFixtureAPDefault, mr: corkiPBTargetMR,
			mana: corkiPBFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: corkiPBAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runCorkiPBFrames(t, c, r)
		if len(corkiPBDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(corkiPBDamageEvidence(done)))
		}
		corkiPBAssertDamage(t, corkiPBDamageEvidence(done)[0],
			corkiPBExpectedRawDefault, corkiPBExpectedMitDefault)
		if len(corkiPBAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadCorkiPBFixture(t, corkiPBFixtureOpts{
			baseAD: corkiPBADBaseDefault, resolvedAD: corkiPBADResolvedCD,
			resolvedAP: corkiPBFixtureAPDefault, mr: corkiPBTargetMR,
			mana: corkiPBFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: corkiPBAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50

		session := NewSession()
		session.ClearOutbox()
		if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, c)); code != 0 {
			t.Fatalf("CompileFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
		}
		compiled := lastGenericCompileResult(session.OutboxBytes())
		if !compiled.OK || compiled.SessionID == "" {
			t.Fatalf("compile failed: %+v", compiled)
		}

		session.ClearOutbox()
		wrongHash := r
		wrongHash.SessionID = compiled.SessionID
		wrongHash.ExpectedRulesHash = "rules.wrong-hash"
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, wrongHash)); code != -1 {
			t.Fatalf("wrong hash RunFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrHashMismatch {
			t.Fatal("want hash_mismatch for wrong ExpectedRulesHash")
		}

		session.ClearOutbox()
		missing := r
		missing.SessionID = "missing-session"
		missing.ExpectedRulesHash = compiled.RulesHash
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, missing)); code != -1 {
			t.Fatalf("missing session RunFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("want session_not_found for missing session")
		}

		session.ClearOutbox()
		releaseReq := model.ReleaseSessionRequest{
			SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash,
		}
		if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
			t.Fatalf("ReleaseSessionFrame code=%d", code)
		}
		released := lastGenericReleaseDone(session.OutboxBytes())
		if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
			t.Fatalf("release=%+v", released)
		}

		session.ClearOutbox()
		if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != -1 {
			t.Fatalf("second ReleaseSessionFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("second release want session_not_found")
		}

		session.ClearOutbox()
		rerun := r
		rerun.SessionID = compiled.SessionID
		rerun.ExpectedRulesHash = compiled.RulesHash
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, rerun)); code != -1 {
			t.Fatalf("RunFrame after release code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("released session re-run want session_not_found")
		}
	})
}
