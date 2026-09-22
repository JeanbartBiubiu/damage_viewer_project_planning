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

	"tinygo_engine_v2/internal/model"
)

// hero_ezreal Q Mystic Shot / 秘术射击 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: ezreal-q-mystic-shot-primary-hit-phase-a-v2).
//
// Frozen boundary:
//
//	rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold;
//	physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit;
//	no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_
//	cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_
//	other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_ezreal|Q|秘术射击
//	task wasm-generic-ezreal-mystic-shot-primary-hit
//	Request Template:Data Ezreal/Q → resolved Template:Data Ezreal/Mystic Shot
//	wikiPageId 1307107 / rev 4013233 / timestamp 2026-04-28T21:19:30Z
//	canonical rawByteSize 2054 / SHA256
//	  be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533
//	数据参考/lol-wiki-current-champions/normalized/generic/ezreal-q.json
//	  bytes 2527 / SHA256
//	  b7e8639d6fd82df4c66c4f883078b54274b4a1708fdca6bf2703d70a0518ab47
//	pages/raw siblings: pages/ezreal-q.json (bytes 692 / SHA256
//	  f5f133eef00f3dd4cdc95c0513d3371851b71d890a61b9e8de93716ccd107060),
//	  raw/ezreal-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_ezreal_mystic_shot_primary_hit_seed.sql
//	  bytes 29100 / SHA256
//	  13e78f715b0320a79c9a57c02bfa64fa72dd05aff0de2e8b2d5f4eb74b265574
//	JUnit: LolGenericEzrealMysticShotPrimaryHitSeedSqlTest.java
//	  bytes 58894 / SHA256
//	  17025b1541d9775c5133f38f82bd8e0d87d36a126112349197dfc4cbf550dc3e
//	Local raw materialization caveat: 2052 bytes / SHA256
//	  d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_ezreal_q_mystic_shot_primary_hit
//     (standalone; not P/W/E/R/basic synthesis; preserve Rising Spell Force /
//     Arcane Shift / Trueshot Barrage without requiring/mutating/synthesizing/
//     copying them; Q seed contains no W rows)
//   - ability ability_hero_ezreal_q_mystic_shot_primary_hit with ability_key
//     mystic_shot_primary_hit: active; mana 40; cooldown 4500 ms
//   - Exactly one immediate selected-primary-enemy-champion physical damage op:
//     add(add(const 120, mul(const 1.30, read source.attr.ad.resolved)),
//         mul(const 0.40, read source.attr.ap.resolved))
//     (AD is total AD; never subtract base AD; never call it bonus AD; AD and AP
//     resolved each read exactly once; no crit read)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: physical 20220 + add policy 20170; 20230 forbidden
//   - No Q state/modifier/listener/matcher/repeat/control/event/projectile/
//     on-hit/on-attack/cooldown-adjust/dual-tag/lifesteal/vamp/AOE; no explicit
//     event op — successful cast relies on runtime automatic ability_started.
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   direction / range / projectile travel / collision / first-enemy acquisition;
//   on-hit / on-attack / 1.5s cooldown reduction / basic+spell dual-tag /
//   lifesteal / vamp / spellshield / buffering; ranks 1–4; full Q; live/E2E.
//   Do not claim them implemented or approximated.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, ap_ratio,
// immediate_impact_scaffold (explicitly no total_ad_ratio,
// cooldown_or_haste_without_rotation, or salvage tag; total AD remains exact
// in formula/boundary/reason only).

const (
	ezrealMSCandidateKey    = "hero_skill|hero_ezreal|Q|秘术射击"
	ezrealMSTaskKey         = "wasm-generic-ezreal-mystic-shot-primary-hit"
	ezrealMSPlanRev         = "ezreal-q-mystic-shot-primary-hit-phase-a-v2"
	ezrealMSRequestTitle    = "Template:Data Ezreal/Q"
	ezrealMSResolvedTitle   = "Template:Data Ezreal/Mystic Shot"
	ezrealMSWikiPageID      = 1307107
	ezrealMSRevisionID      = 4013233
	ezrealMSTimestamp       = "2026-04-28T21:19:30Z"
	ezrealMSRawBytes        = 2054
	ezrealMSLocalRawBytes   = 2052
	ezrealMSNormalizedBytes = 2527
	ezrealMSPagesBytes      = 692
	ezrealMSSeedBytes       = 29100
	ezrealMSJUnitBytes      = 58894
	ezrealMSContentSHA      = "be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533"
	ezrealMSLocalRawSHA     = "d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd"
	ezrealMSNormalizedSHA   = "b7e8639d6fd82df4c66c4f883078b54274b4a1708fdca6bf2703d70a0518ab47"
	ezrealMSPagesSHA        = "f5f133eef00f3dd4cdc95c0513d3371851b71d890a61b9e8de93716ccd107060"
	ezrealMSBoundary        = "rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; " +
		"physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; " +
		"no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_" +
		"cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_" +
		"other_ranks_or_full_fidelity"

	ezrealMSProviderRef = "provider_hero_ezreal_q_mystic_shot_primary_hit"
	ezrealMSStableID    = "hero_ezreal_q_mystic_shot_primary_hit"
	ezrealMSAbilityID   = "ability_hero_ezreal_q_mystic_shot_primary_hit"
	ezrealMSAbilityKey  = "mystic_shot_primary_hit"
	ezrealMSDamageOpRef = "op:ezreal_mystic_shot_primary_hit_damage"
	ezrealMSTotalADMod  = "fixture_ezreal_mystic_shot_primary_hit_total_ad"

	ezrealMSSeedBlobSHA  = "13E78F715B0320A79C9A57C02BFA64FA72DD05AFF0DE2E8B2D5F4EB74B265574"
	ezrealMSJUnitBlobSHA = "17025B1541D9775C5133F38F82BD8E0D87D36A126112349197DFC4CBF550DC3E"

	ezrealMSBaseDamage = 120.0
	ezrealMSADRatio    = 1.30
	ezrealMSAPRatio    = 0.40
	ezrealMSManaCost   = 40.0
	ezrealMSCDMs       = 4500.0

	ezrealMSADBaseDefault      = 60.0
	ezrealMSADResolvedDefault  = 160.0
	ezrealMSFixtureAPDefault   = 100.0
	ezrealMSFixtureManaCD      = 120.0
	ezrealMSFixtureManaShort   = 39.0
	ezrealMSTargetArmorDefault = 100.0
	ezrealMSTargetHP           = 1000.0

	// Default CD schedule: 120 + 1.30*160 + 0.40*100 = 368; armor100 → 184.
	ezrealMSExpectedRawDefault = 368.0
	ezrealMSExpectedMitDefault = 184.0
	ezrealMSManaAfter2         = 40.0  // 120 - 40 - 40
	ezrealMSHPAfter2           = 632.0 // 1000 - 184 - 184

	ezrealMSSeedDamageJSON = `{"op":"add","args":[{"op":"add","args":[{"op":"const","value":120},` +
		`{"op":"mul","args":[{"op":"const","value":1.30},` +
		`{"op":"read","path":"source.attr.ad.resolved"}]}]},` +
		`{"op":"mul","args":[{"op":"const","value":0.40},` +
		`{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	ezrealMSRSFProviderAlias = "provider_hero_ezreal_rising_spell_force"

	ezrealMSTol = 1e-9
)

func ezrealMSOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func ezrealMSExpectedRawFromStats(resolvedAD, resolvedAP float64) float64 {
	return ezrealMSBaseDamage + ezrealMSADRatio*resolvedAD + ezrealMSAPRatio*resolvedAP
}

func ezrealMSDamageAmount() *model.GenericFormulaExpr {
	base := ezrealMSBaseDamage
	adRatio := ezrealMSADRatio
	apRatio := ezrealMSAPRatio
	// Nested binary add: base + totalAD + AP (generic add is binary-only).
	// Total AD = source.attr.ad.resolved — never subtract ad.base; no crit read.
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
							{Op: "read", Path: "source.attr.ad.resolved"},
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

func ezrealMSCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += ezrealMSCountPathReads(&expr.Args[i], path)
	}
	return n
}

func ezrealMSAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		ezrealMSAssertBinaryArity(t, &expr.Args[i])
	}
}

func ezrealMSAbility() model.AbilityDefinition {
	cost := ezrealMSManaCost
	cd := ezrealMSCDMs
	return model.AbilityDefinition{
		AbilityKey: ezrealMSAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical hit; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           ezrealMSDamageOpRef,
				Amount:        ezrealMSDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func ezrealMSProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: ezrealMSProviderRef,
		Kind:        "champion",
		StableID:    ezrealMSStableID,
		Abilities:   []model.AbilityDefinition{ezrealMSAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed Q provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: ezrealMSTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func ezrealMSAbilityRef() string {
	return "source.provider[" + ezrealMSProviderRef + "].ability[" + ezrealMSAbilityKey + "]"
}

type ezrealMSFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	armor      float64
	mana       float64
	hp         float64
	withRSF    bool
}

func ezrealMSRSFProviderDef() model.ProviderDefinition {
	// Fine-grained same-package helpers only — never overwrite via configureEzrealRSFProvider.
	return model.ProviderDefinition{
		ProviderKey:        ezrealRSFProviderRef,
		Kind:               "champion",
		StableID:           ezrealRSFStableID,
		InitialStateSchema: ezrealRSFStateSchema(),
		Modifiers:          []model.ModifierDefinition{ezrealRSFASModifier()},
		Listeners:          []model.ListenerDefinition{ezrealRSFStackListener()},
	}
}

func configureEzrealMSProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts ezrealMSFixtureOpts) {
	flat := opts.resolvedAD - opts.baseAD
	shared := []model.ProviderDefinition{ezrealMSProviderDef(flat)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: ezrealMSProviderRef, DefinitionRef: ezrealMSProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{ProviderRef: ezrealMSProviderRef, DefinitionRef: ezrealMSProviderRef, Stacks: 1, State: map[string]interface{}{}},
	}
	if opts.withRSF {
		shared = append(shared, ezrealMSRSFProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: ezrealRSFProviderRef, DefinitionRef: ezrealRSFProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: ezrealRSFProviderRef, DefinitionRef: ezrealRSFProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	compileReq.SharedProviders = shared
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snaps
	}
}

func ensureEzrealMSTypes(req *model.CompileRequest) {
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

func loadEzrealMSFixture(t *testing.T, opts ezrealMSFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/armor explicitly
	// (AD0 / AP0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = ezrealMSFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = ezrealMSTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureEzrealMSTypes(&compileReq)
	if opts.withRSF {
		ensureEzrealRSFTypes(&compileReq)
	}
	configureEzrealMSProviders(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_ezreal / ad / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, ezrealMSFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})
	if opts.withRSF {
		setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
			Base: ezrealRSFBaseAS, Current: ezrealRSFBaseAS, Max: ezrealRSFBaseAS, Resolved: ezrealRSFBaseAS,
		})
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runEzrealMS(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runEzrealMSFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func ezrealMSSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func ezrealMSSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func ezrealMSSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func ezrealMSDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := ezrealMSAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != ezrealMSDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func ezrealMSAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func ezrealMSFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == ezrealMSProviderRef {
			return p
		}
	}
	return nil
}

func assertEzrealMSProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := ezrealMSFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_ezreal_q_mystic_shot_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != ezrealMSProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, ezrealMSProviderRef)
	}
	if p.StableID != ezrealMSStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, ezrealMSStableID)
	}
	if p.ProviderKey == ezrealMSRSFProviderAlias || p.ProviderKey == ezrealRSFProviderRef ||
		p.StableID == ezrealRSFStableID {
		t.Fatal("Q must not reuse Rising Spell Force provider refs")
	}
	banned := []string{
		"provider_hero_ezreal_p_", "provider_hero_ezreal_w_", "provider_hero_ezreal_e_",
		"provider_hero_ezreal_r_", "provider_hero_ezreal_basic_",
		"ability_hero_ezreal_p_", "ability_hero_ezreal_w_", "ability_hero_ezreal_e_",
		"ability_hero_ezreal_r_", "ability_hero_ezreal_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("mystic shot primary-hit must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if expectTotalADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only total-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != ezrealMSTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], ezrealMSTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production Q has no modifiers when flat=0)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), ezrealMSAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != ezrealMSAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, ezrealMSAbilityKey, ezrealMSAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("Q Types=%v want empty (no ability-specific game-local Q type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("mystic_shot_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("Q must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("Q must not carry tickSpec")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("Q must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-ezrealMSManaCost) > ezrealMSTol {
		t.Fatalf("cost=%+v want mana const 40", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-ezrealMSCDMs) > ezrealMSTol {
		t.Fatalf("cooldown=%+v want const 4500", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary physical hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("mystic shot damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("mystic shot damage must not be copyable on hit")
	}
	if op.Ref != ezrealMSDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, ezrealMSDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(add(const120, mul(1.30, ad.resolved)), mul(0.40, ap.resolved))", op.Amount)
	}
	ezrealMSAssertBinaryArity(t, op.Amount)
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const, mul(adRatio, ad.resolved))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-ezrealMSBaseDamage) > ezrealMSTol {
		t.Fatalf("base const=%+v want 120", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-ezrealMSADRatio) > ezrealMSTol {
		t.Fatalf("AD ratio=%+v want 1.30", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	if adMul.Args[1].Op == "sub" {
		t.Fatal("total-AD branch must not subtract ad.base")
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-ezrealMSAPRatio) > ezrealMSTol {
		t.Fatalf("AP ratio=%+v want 0.40", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if ezrealMSCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", ezrealMSCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if ezrealMSCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", ezrealMSCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if ezrealMSCountPathReads(op.Amount, "source.attr.ad.base") != 0 {
		t.Fatal("total-AD formula must not read/subtract source.attr.ad.base")
	}
	if ezrealMSCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 0 ||
		ezrealMSCountPathReads(op.Amount, "source.attr.crit_damage.resolved") != 0 {
		t.Fatal("mystic shot formula must not read crit attrs")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "channel" ||
			bannedOp.Operation == "matcher" || bannedOp.Operation == "on_hit" ||
			bannedOp.Operation == "on_attack" || bannedOp.Operation == "cooldown_adjust" ||
			bannedOp.Operation == "lifesteal" || bannedOp.Operation == "vamp" ||
			bannedOp.Operation == "buffer" {
			t.Fatalf("mystic shot must not include excluded op: %+v", bannedOp)
		}
	}
}

func findEzrealMSAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := ezrealMSAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func ezrealMSRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func ezrealMSLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(ezrealMSRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_ezreal_mystic_shot_primary_hit_seed.sql"))
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

func ezrealMSSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func ezrealMSSHA256HexUpper(b []byte) string {
	return strings.ToUpper(ezrealMSSHA256Hex(b))
}

func ezrealMSAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > ezrealMSTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > ezrealMSTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != ezrealMSDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), ezrealMSDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != ezrealMSAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), ezrealMSAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != ezrealMSProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), ezrealMSProviderRef)
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

// TestEzrealMysticShotPrimaryHitSourceSeedProviderFormulaShape locks wiki/sidecar/
// pages/local-raw caveat, seed/README/JUnit identities and source blob hashes,
// external-existing-data check-only prerequisites / non-materialization,
// ordered tags (no total_ad_ratio / cooldown_or_haste_without_rotation / salvage),
// type-policy evidence, and Q provider/nested total-AD+AP formula shape.
func TestEzrealMysticShotPrimaryHitSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Description2, Leveling         string
			Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(ezrealMSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "ezreal-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != ezrealMSNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), ezrealMSNormalizedBytes)
	}
	if got := ezrealMSSHA256Hex(sidecarRaw); got != ezrealMSNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, ezrealMSNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != ezrealMSCandidateKey || doc.RequestTitle != ezrealMSRequestTitle ||
		doc.ResolvedTitle != ezrealMSResolvedTitle || doc.WikiPageID != ezrealMSWikiPageID ||
		doc.RevisionID != ezrealMSRevisionID || doc.RevisionTimestamp != ezrealMSTimestamp ||
		doc.ContentSHA256 != ezrealMSContentSHA || doc.RawByteSize != ezrealMSRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "秘术射击" || doc.OwnerID != "hero_ezreal" {
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
	if doc.Fields.Cost != "{{ap|28 to 40}}\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|5.5 to 4.5}}\n" {
		t.Fatalf("cooldown=%q want {{ap|5.5 to 4.5}} (rank-5 = 4.5s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|20 to 120}}") ||
		!strings.Contains(doc.Fields.Leveling, "130% AD") ||
		!strings.Contains(doc.Fields.Leveling, "40% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q want rank5 physical 120 +130%% AD +40%% AP", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "first enemy hit") ||
		!strings.Contains(doc.Fields.Description, "on-hit") ||
		!strings.Contains(doc.Fields.Description, "on-attack") {
		t.Fatal("wiki prose must retain physical / first-enemy / on-hit / on-attack wording")
	}
	if !strings.Contains(doc.Fields.Description2, "1.5") ||
		!strings.Contains(doc.Fields.Description2, "cooldowns") {
		t.Fatal("wiki description2 must retain excluded 1.5s cooldown-reduction surface")
	}
	if !strings.Contains(doc.Fields.Notes, "basic damage") ||
		!strings.Contains(doc.Fields.Notes, "spell damage") ||
		!strings.Contains(doc.Fields.Notes, "life steal") ||
		!strings.Contains(doc.Fields.Notes, "omnivamp") ||
		!strings.Contains(doc.Fields.Notes, "physical vamp") ||
		!strings.Contains(doc.Fields.Notes, "spell shield") ||
		!strings.Contains(doc.Fields.Notes, "buffered") {
		t.Fatalf("notes missing excluded dual-tag/vamp/spellshield/buffering surfaces: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(ezrealMSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "ezreal-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != ezrealMSPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), ezrealMSPagesBytes)
	}
	if got := ezrealMSSHA256Hex(pagesRaw); got != ezrealMSPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, ezrealMSPagesSHA)
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "秘术射击" || pages.OwnerID != "hero_ezreal" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(ezrealMSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "ezreal-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != ezrealMSLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), ezrealMSLocalRawBytes)
	}
	if ezrealMSLocalRawBytes == ezrealMSRawBytes {
		t.Fatal("local raw and canonical sizes must differ (serialization caveat; not equivalence)")
	}
	localSHA := ezrealMSSHA256Hex(rawBytes)
	if localSHA != ezrealMSLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, ezrealMSLocalRawSHA)
	}
	if localSHA == ezrealMSContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|20 to 120}}",
		"130% AD",
		"40% AP",
		"|cost         = {{ap|28 to 40}}",
		"|cooldown     = {{ap|5.5 to 4.5}}",
		"|damagetype   = Physical",
		"{{as|physical damage}}",
		"first enemy hit",
		"on-hit",
		"on-attack",
		"1.5",
		"life steal",
		"omnivamp",
		"physical vamp",
		"spell shield",
		"buffered",
		"|target range =",
		"|speed        =",
		"|width        =",
		"|projectile   = True",
		"|onhiteffects = True",
		"|spellshield  = special",
		"|spelleffects = special",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if ezrealMSPlanRev != "ezreal-q-mystic-shot-primary-hit-phase-a-v2" || ezrealMSBoundary !=
		"rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; "+
			"physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; "+
			"no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_"+
			"cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_"+
			"other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := ezrealMSRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_ezreal_mystic_shot_primary_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(seedBytes) != ezrealMSSeedBytes {
		t.Fatalf("seed len=%d want %d", len(seedBytes), ezrealMSSeedBytes)
	}
	if got := ezrealMSSHA256HexUpper(seedBytes); got != ezrealMSSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, ezrealMSSeedBlobSHA)
	}
	junitPath := ezrealMSRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericEzrealMysticShotPrimaryHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(junitBytes) != ezrealMSJUnitBytes {
		t.Fatalf("junit len=%d want %d", len(junitBytes), ezrealMSJUnitBytes)
	}
	if got := ezrealMSSHA256HexUpper(junitBytes); got != ezrealMSJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, ezrealMSJUnitBlobSHA)
	}
	readmePath := ezrealMSRepoPath(t, "server", "data_manage", "README.md")
	readmeBytes, err := os.ReadFile(readmePath)
	if err != nil {
		t.Fatal(err)
	}

	seed, sqlNoComments := ezrealMSLoadSeedSQL(t)
	readme := string(readmeBytes)

	for _, want := range []string{
		ezrealMSCandidateKey, ezrealMSTaskKey, ezrealMSPlanRev,
		ezrealMSRequestTitle, ezrealMSResolvedTitle,
		"1307107", "4013233", ezrealMSTimestamp, "2054", "2052", "2527", "692",
		ezrealMSContentSHA, ezrealMSLocalRawSHA, ezrealMSNormalizedSHA, ezrealMSPagesSHA,
		ezrealMSBoundary, ezrealMSProviderRef, ezrealMSAbilityID, ezrealMSAbilityKey,
		"mystic_shot_primary_hit_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":40}`, `{"op":"const","value":4500}`,
		ezrealMSSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/ezreal-q.json", "pages/ezreal-q.json",
		"external existing-data", "check-only",
		"不物化", "materializer",
		"total AD", "source.attr.ad.resolved", "source.attr.ap.resolved",
		"ability_started",
		"20220", "20170",
		"Rising Spell Force",
		"preserve P/E/R",
		"Q seed contains no W rows",
		"missing game_entities hero_ezreal",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_ezreal/ad",
		"missing entity_attribute_values hero_ezreal/ap",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_ezreal/mana",
		"missing reserved_type",
		"120", "1.30", "0.40",
		"嵌套二元",
		"provider_hero_ezreal_rising_spell_force",
		"provider_hero_ezreal_e_arcane_shift_primary_hit",
		"provider_hero_ezreal_r_trueshot_barrage_primary_hit",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range ezrealMSOrderedTags() {
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
	for _, tag := range ezrealMSOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if regexp.MustCompile(`(?m)^\s*(?:--\s*)?(?:[-*]?\s*)?\d+\.\s*` + "`?" + `total_ad_ratio` + "`?" + `\b`).MatchString(seed) {
		t.Fatal("must not add a total_ad_ratio governed ordered tag")
	}
	if !strings.Contains(ordSection, "total_ad_ratio") ||
		!(strings.Contains(ordSection, "显式不包含") || strings.Contains(ordSection, "禁止")) {
		t.Fatal("seed must explicitly document absence of total_ad_ratio governed tag")
	}
	if !strings.Contains(ordSection, "cooldown_or_haste_without_rotation") {
		t.Fatal("seed ordered-tags section must explicitly exclude cooldown_or_haste_without_rotation")
	}
	if regexp.MustCompile(`(?m)^\s*(?:--\s*)?(?:[-*]?\s*)?\d+\.\s*` + "`?" + `cooldown_or_haste_without_rotation` + "`?" + `\b`).MatchString(seed) {
		t.Fatal("must not add cooldown_or_haste_without_rotation as a governed ordered tag")
	}
	if !strings.Contains(ordSection, "salvage") {
		t.Fatal("seed ordered-tags section must explicitly exclude salvage tags")
	}
	if regexp.MustCompile(`(?m)^\s*(?:--\s*)?(?:[-*]?\s*)?\d+\.\s*` + "`?" + `\S*salvage\S*` + "`?" + `\b`).MatchString(ordSection) {
		t.Fatal("must not add a salvage governed ordered tag")
	}
	if regexp.MustCompile(`(?i)Batch-B\s+prerequisite`).MatchString(seed) {
		t.Fatal("seed must not use Batch-B prerequisite wording")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ad.resolved"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ad.resolved exactly once")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ap.resolved"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ap.resolved exactly once")
	}
	if strings.Contains(sqlNoComments, `"path":"source.attr.ad.base"`) {
		t.Fatal("executable SQL must not read ad.base (total AD, not bonus AD)")
	}
	if regexp.MustCompile(`(?i)bonus\s*AD|bonus_ad`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL must not claim bonus AD")
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.ability_definitions",
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.entity_provider_mounts",
		"phase_hero_ezreal_q_mystic_shot_primary_hit_impact",
		"sequence_hero_ezreal_q_mystic_shot_primary_hit_impact",
		"step_hero_ezreal_q_mystic_shot_primary_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_ezreal_q_mystic_shot_primary_hit'\s*,\s*` +
		`'provider_hero_ezreal_q_mystic_shot_primary_hit'\s*,\s*` +
		`'mystic_shot_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key mystic_shot_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_ezreal_q_mystic_shot_primary_hit_damage'\s*,\s*` +
		`'mystic_shot_primary_hit_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be physical 20220 add policy copyable_on_hit=false")
	}
	if regexp.MustCompile(`(?is)\b20230\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL/graph must not use provider_action/apply 20230")
	}
	if regexp.MustCompile(`(?is)\b62\d{3}\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL must not invent Q ability-specific 62xxx types")
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
	for _, banned := range []string{
		"provider_hero_ezreal_w_", "ability_hero_ezreal_w_",
		"essence_flux",
		"provider_hero_ezreal_e_arcane_shift",
		"ability_hero_ezreal_e_arcane_shift",
		"provider_hero_ezreal_r_trueshot",
		"ability_hero_ezreal_r_trueshot",
		"provider_hero_ezreal_rising_spell_force",
		"rising_spell_force",
	} {
		if strings.Contains(sqlNoComments, banned) {
			t.Fatalf("standalone Q executable seed must not contain sibling/P/E/R/W graph token %q", banned)
		}
	}

	for _, want := range []string{
		ezrealMSCandidateKey, ezrealMSTaskKey, ezrealMSPlanRev,
		"lol_generic_ezreal_mystic_shot_primary_hit_seed.sql",
		"LolGenericEzrealMysticShotPrimaryHitSeedSqlTest",
		"external existing-data",
		"physical_120_plus_1_30_total_ad_plus_0_40_ap",
		"total_ad_ratio",
		"cooldown_or_haste_without_rotation",
		"preserve_rising_spell_force_one_stack_on_successful_hit",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "不含") && !strings.Contains(readme, "禁止") &&
		!strings.Contains(readme, "不得") {
		t.Fatal("README must document governed-tag exclusion framing")
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") {
		t.Fatal("README must document no repository materializer for Ezreal identity/panel/resource")
	}
	if strings.Contains(readme, "op:ezreal_mystic_shot_primary_hit_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}
	if strings.Contains(readme, "fixture_ezreal_mystic_shot_primary_hit_total_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production Q behavior")
	}

	compileReq, _ := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
		baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
		resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
		mana: ezrealMSFixtureManaCD,
	})
	assertEzrealMSProviderShape(t, compileReq, 1, true)
	rawX := ezrealMSExpectedRawFromStats(ezrealMSADResolvedDefault, ezrealMSFixtureAPDefault)
	if math.Abs(rawX-ezrealMSExpectedRawDefault) > ezrealMSTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, ezrealMSExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, ezrealMSTargetArmorDefault)
	if math.Abs(mitX-ezrealMSExpectedMitDefault) > ezrealMSTol {
		t.Fatalf("default mit=%v want %v", mitX, ezrealMSExpectedMitDefault)
	}
	bonusAsIf := ezrealMSExpectedRawFromStats(ezrealMSADResolvedDefault-ezrealMSADBaseDefault, ezrealMSFixtureAPDefault)
	if math.Abs(bonusAsIf-ezrealMSExpectedRawDefault) < ezrealMSTol {
		t.Fatal("bonus-AD substitution raw must differ from total-AD raw")
	}
}

// TestEzrealMysticShotPrimaryHitFormulaMitigationTable: frozen AD×AP vs armor100
// raw/final table; proves nested total-AD+AP formula.
func TestEzrealMysticShotPrimaryHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, resolvedAP float64
		wantRaw, wantMitigated float64
	}{
		{"resolvedAD60_AP0_armor100", 60, 0, 198, 99},
		{"resolvedAD160_AP0_armor100", 160, 0, 328, 164},
		{"resolvedAD60_AP100_armor100", 60, 100, 238, 119},
		{"resolvedAD160_AP100_armor100", 160, 100, 368, 184},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := ezrealMSExpectedRawFromStats(tc.resolvedAD, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > ezrealMSTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, ezrealMSTargetArmorDefault)
			if math.Abs(mitX-tc.wantMitigated) > ezrealMSTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			baseAD := ezrealMSADBaseDefault
			if tc.resolvedAD == 0 {
				baseAD = 0
			}
			compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
				baseAD: baseAD, resolvedAD: tc.resolvedAD, resolvedAP: tc.resolvedAP,
				armor: ezrealMSTargetArmorDefault, mana: ezrealMSFixtureManaCD,
			})
			assertEzrealMSProviderShape(t, compileReq, 1, tc.resolvedAD != baseAD)
			ref := ezrealMSAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runEzrealMS(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := ezrealMSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			ezrealMSAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > ezrealMSTol {
				t.Fatalf("ad.resolved=%v want %v (total AD)", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad")-baseAD) > ezrealMSTol {
				t.Fatalf("ad.base=%v want %v (total-AD formula must leave base independent)",
					ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad"), baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > ezrealMSTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(ezrealMSAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(ezrealMSAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestEzrealMysticShotPrimaryHitTotalADCounterproof: baseAD0 versus baseAD60 with
// resolvedAD160/AP0/armor100 must both raw328/final164 — formula reads only
// source.attr.ad.resolved, never source.attr.ad.base.
func TestEzrealMysticShotPrimaryHitTotalADCounterproof(t *testing.T) {
	cases := []struct {
		name   string
		baseAD float64
	}{
		{"baseAD0_resolvedAD160_AP0", 0},
		{"baseAD60_resolvedAD160_AP0", 60},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: ezrealMSADResolvedDefault,
				resolvedAP: 0, armor: ezrealMSTargetArmorDefault, mana: ezrealMSFixtureManaCD,
			})
			assertEzrealMSProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ezrealMSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runEzrealMS(t, compileReq, runReq)
			dmg := ezrealMSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			ezrealMSAssertDamage(t, dmg[0], 328, 164)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-ezrealMSADResolvedDefault) > ezrealMSTol {
				t.Fatalf("ad.resolved=%v want 160", sourceAttrResolved(t, done.FinalSnapshot, "ad"))
			}
			if math.Abs(ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > ezrealMSTol {
				t.Fatalf("ad.base=%v want %v", ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	bonusAsIf := ezrealMSExpectedRawFromStats(ezrealMSADResolvedDefault-ezrealMSADBaseDefault, 0)
	baseAlone := ezrealMSExpectedRawFromStats(ezrealMSADBaseDefault, 0)
	total := ezrealMSExpectedRawFromStats(ezrealMSADResolvedDefault, 0)
	if math.Abs(bonusAsIf-total) < ezrealMSTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	if math.Abs(baseAlone-total) < ezrealMSTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestEzrealMysticShotPrimaryHitCooldownMana120AbilityStarted: mana120/baseAD60/
// resolvedAD160/AP100/armor100/HP1000 at t0/t4499/t4500 → success/skip/success;
// final mana40/HP632; exactly two Q physical damage items and two automatic Q
// ability_started events.
func TestEzrealMysticShotPrimaryHitCooldownMana120AbilityStarted(t *testing.T) {
	compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
		baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
		resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
		mana: ezrealMSFixtureManaCD, hp: ezrealMSTargetHP,
	})
	assertEzrealMSProviderShape(t, compileReq, 1, true)
	ref := ezrealMSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4499},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4500},
	}
	runReq.StopPolicy.DurationMs = 4600
	done := runEzrealMS(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if ezrealMSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findEzrealMSAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt4499 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 4499 {
			t.Fatalf("cooldown skip TimeMs=%d want 4499", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 4500 {
			t.Fatalf("cooldown skip readyAtMs=%v want 4500", item.Data["readyAtMs"])
		}
		skipAt4499 = true
	}
	if !skipAt4499 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=4499 with readyAtMs=4500")
	}

	items := ezrealMSDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 4500}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		ezrealMSAssertDamage(t, item, ezrealMSExpectedRawDefault, ezrealMSExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * ezrealMSExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-ezrealMSHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, ezrealMSHPAfter2)
	}
	gotMana := ezrealMSSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-ezrealMSManaAfter2) > ezrealMSTol {
		t.Fatalf("mana=%v want %v", gotMana, ezrealMSManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := ezrealMSAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 4500}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-ezrealMSADResolvedDefault) > ezrealMSTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), ezrealMSADResolvedDefault)
	}
	if math.Abs(ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad")-ezrealMSADBaseDefault) > ezrealMSTol {
		t.Fatalf("ad.base=%v want %v",
			ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad"), ezrealMSADBaseDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-ezrealMSFixtureAPDefault) > ezrealMSTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), ezrealMSFixtureAPDefault)
	}
}

// TestEzrealMysticShotPrimaryHitResourceInsufficientMana39: mana39 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/event evidence.
func TestEzrealMysticShotPrimaryHitResourceInsufficientMana39(t *testing.T) {
	compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
		baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
		resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
		mana: ezrealMSFixtureManaShort, hp: ezrealMSTargetHP,
	})
	ref := ezrealMSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runEzrealMS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if ezrealMSSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(ezrealMSSourceMana(t, done.FinalSnapshot)-ezrealMSFixtureManaShort) > ezrealMSTol {
		t.Fatalf("mana changed: got %v want %v",
			ezrealMSSourceMana(t, done.FinalSnapshot), ezrealMSFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-ezrealMSTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, ezrealMSTargetHP)
	}
	if len(ezrealMSDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(ezrealMSAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestEzrealMysticShotPrimaryHitRSFCoexistenceAndDeterministicRelease: P coexistence
// via fine-grained same-package helpers (never configureEzrealRSFProvider) plus
// deterministic CompileGeneric/RunGeneric and frame release evidence.
func TestEzrealMysticShotPrimaryHitRSFCoexistenceAndDeterministicRelease(t *testing.T) {
	t.Run("rsf_coexistence", func(t *testing.T) {
		compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
			baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
			resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
			mana: ezrealMSFixtureManaCD, withRSF: true,
		})
		assertEzrealMSProviderShape(t, compileReq, 2, true)
		var rsf *model.ProviderDefinition
		var q *model.ProviderDefinition
		for i := range compileReq.SharedProviders {
			switch compileReq.SharedProviders[i].ProviderKey {
			case ezrealRSFProviderRef:
				rsf = &compileReq.SharedProviders[i]
			case ezrealMSProviderRef:
				q = &compileReq.SharedProviders[i]
			}
		}
		if q == nil || rsf == nil {
			t.Fatal("both Q and Rising Spell Force provider definitions required")
		}
		if len(rsf.Listeners) != 1 || len(rsf.InitialStateSchema) == 0 || len(rsf.Modifiers) != 1 {
			t.Fatalf("RSF provider incomplete: %+v", rsf)
		}
		if len(q.Listeners) != 0 || len(q.InitialStateSchema) != 0 {
			t.Fatal("Q must not rewrite P state/listener/modifier onto Q provider")
		}
		foundQMount, foundPMount := false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == ezrealMSProviderRef {
				foundQMount = true
			}
			if m.ProviderRef == ezrealRSFProviderRef {
				foundPMount = true
			}
		}
		if !foundQMount || !foundPMount {
			t.Fatalf("both Q and P mounts required: %+v", compileReq.Combatants[0].Providers)
		}
		ref := ezrealMSAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "q_cd", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100},
		}
		runReq.StopPolicy.DurationMs = 200
		done := runEzrealMS(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if ezrealMSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
			t.Fatal("want cooldown skip at t100")
		}
		if len(ezrealMSDamageEvidence(done)) != 1 {
			t.Fatal("exactly one Q damage")
		}
		ezrealMSAssertDamage(t, ezrealMSDamageEvidence(done)[0],
			ezrealMSExpectedRawDefault, ezrealMSExpectedMitDefault)
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 at successful cast only",
				countEmittedEvents(done, "event/ability_started"))
		}
		for _, item := range done.Evidence.Items {
			if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == "event/ability_started" && item.TimeMs != 0 {
				t.Fatalf("ability_started at t=%d want 0", item.TimeMs)
			}
		}
		if stacks := ezrealRSFStacks(t, done); math.Abs(stacks-1) > ezrealMSTol {
			t.Fatalf("P stacks=%v want 1 (provider-scoped)", stacks)
		}
		as := ezrealRSFSourceASSlot(t, done.FinalSnapshot)
		wantAS := ezrealRSFWantAS(1)
		if math.Abs(as.Base-ezrealRSFBaseAS) > ezrealMSTol ||
			math.Abs(as.Resolved-wantAS) > ezrealMSTol {
			t.Fatalf("AS base/resolved=%v/%v want %v/%v (1.0→1.1)", as.Base, as.Resolved, ezrealRSFBaseAS, wantAS)
		}
		if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
			t.Fatal("no basic_attack_hit")
		}
		// Definitions/mounts remain present after composition (no overwrite).
		if len(compileReq.SharedProviders) != 2 {
			t.Fatalf("SharedProviders after run setup=%d want 2", len(compileReq.SharedProviders))
		}
		if len(compileReq.Combatants[0].Providers) != 2 {
			t.Fatalf("mounts after run setup=%d want 2", len(compileReq.Combatants[0].Providers))
		}
	})

	t.Run("determinism_and_release", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
				baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
				resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
				mana: ezrealMSFixtureManaCD,
			})
			ref := ezrealMSAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4499},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4500},
			}
			r.StopPolicy.DurationMs = 4600
			done := runEzrealMS(t, c, r)
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
		c, r := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
			baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
			resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
			mana: ezrealMSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ezrealMSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runEzrealMSFrames(t, c, r)
		if len(ezrealMSDamageEvidence(done)) != 1 {
			t.Fatal("frame-path want one Q damage")
		}
		ezrealMSAssertDamage(t, ezrealMSDamageEvidence(done)[0],
			ezrealMSExpectedRawDefault, ezrealMSExpectedMitDefault)
		if len(ezrealMSAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
			baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
			resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
			mana: ezrealMSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ezrealMSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
