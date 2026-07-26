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

// hero_tristana W Rocket Jump / 火箭跳跃 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: tristana-w-rocket-jump-primary-landing-hit-phase-a-v2).
//
// Frozen boundary:
//
//	rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold;
//	magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_
//	movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_
//	takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_tristana|W|火箭跳跃
//	task wasm-generic-tristana-rocket-jump-primary-landing-hit
//	Request Template:Data Tristana/W → resolved Template:Data Tristana/Rocket Jump
//	wikiPageId 1308523 / rev 4007758 / timestamp 2026-04-12T14:13:05Z
//	canonical rawByteSize 2444 / SHA256
//	  cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec
//	数据参考/lol-wiki-current-champions/normalized/generic/tristana-w.json
//	pages/raw siblings: pages/tristana-w.json, raw/tristana-w.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql
//	Local raw materialization caveat: 2443 bytes / SHA256
//	  7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9.
//	Serialization caveat only; assert sidecar/pages canonical identity + caveat;
//	do not claim local-raw equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_tristana_w_rocket_jump_primary_landing_hit
//     (standalone; not P/Q/E/basic/Explosive Charge/R synthesis)
//   - ability ability_hero_tristana_w_rocket_jump_primary_landing_hit with ability_key
//     rocket_jump_primary_landing_hit: active; mana 50; cooldown 14000 ms
//   - Exactly one immediate selected-primary-champion magic damage op:
//     add(add(const 210, mul(const 1.00, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base))), mul(const 0.50,
//         read source.attr.ap.resolved))
//     (every arithmetic node binary; each read path exactly once)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: magic 20221 + add policy 20170; 20230 forbidden
//   - No Tristana W state/modifier/listener/matcher/repeat/control/channel/
//     projectile/geometry/movement/slow/secondary; no explicit event op —
//     successful cast relies on runtime automatic ability_started.
//     W Types empty (must not contain ability/tristana_rapid_fire).
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   dash/cast time 0.25/air time/landing delay; movement/destination/range/
//   speed/terrain/collision/geometry; landing AOE/radius 350/spellaoe/secondary;
//   slow 40% 2s/knockdown/grounded/spellshield; takedown/clone/Explosive Charge
//   reset; casting during dash; ranks 1–4; P/Q/E/basic/Explosive Charge/R/
//   loadout/crit/on-hit/live/full fidelity.
//   Exactly one selected-target magic landing hit, not full W.
//
// Ordered tags: ability_cost_cooldown, active_magic_damage, bonus_ad_ratio,
// ap_ratio, immediate_impact_scaffold.

const (
	tristanaRJCandidateKey  = "hero_skill|hero_tristana|W|火箭跳跃"
	tristanaRJTaskKey       = "wasm-generic-tristana-rocket-jump-primary-landing-hit"
	tristanaRJPlanRev       = "tristana-w-rocket-jump-primary-landing-hit-phase-a-v2"
	tristanaRJRequestTitle  = "Template:Data Tristana/W"
	tristanaRJResolvedTitle = "Template:Data Tristana/Rocket Jump"
	tristanaRJWikiPageID    = 1308523
	tristanaRJRevisionID    = 4007758
	tristanaRJTimestamp     = "2026-04-12T14:13:05Z"
	tristanaRJRawBytes      = 2444
	tristanaRJLocalRawBytes = 2443
	tristanaRJContentSHA    = "cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec"
	tristanaRJLocalRawSHA   = "7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9"
	tristanaRJBoundary      = "rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; " +
		"magic_210_plus_1_00_bonus_ad_plus_0_50_ap; " +
		"no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_" +
		"collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_" +
		"charge_reset_cast_during_dash_other_ranks_or_full_fidelity"

	tristanaRJProviderRef = "provider_hero_tristana_w_rocket_jump_primary_landing_hit"
	tristanaRJStableID    = "hero_tristana_w_rocket_jump_primary_landing_hit"
	tristanaRJAbilityID   = "ability_hero_tristana_w_rocket_jump_primary_landing_hit"
	tristanaRJAbilityKey  = "rocket_jump_primary_landing_hit"
	tristanaRJDamageOpRef = "op:tristana_rocket_jump_primary_landing_hit_damage"
	tristanaRJBonusADMod  = "fixture_tristana_rocket_jump_primary_landing_hit_bonus_ad"

	tristanaRJSeedBlobSHA  = "6F11143C6774D3713FB00BB50D1C81816CA5913DA966B30E5082888D63EF8643"
	tristanaRJJUnitBlobSHA = "706A8EAC3D0490A2C42EEE2F411D967B4B19B43A5B67834A611B8F43A5F2104D"

	tristanaRJBaseDamage   = 210.0
	tristanaRJBonusADRatio = 1.00
	tristanaRJAPRatio      = 0.50
	tristanaRJManaCost     = 50.0
	tristanaRJCDMs         = 14000.0

	tristanaRJADBaseDefault     = 60.0
	tristanaRJADResolvedDefault = 160.0
	tristanaRJFixtureAPDefault  = 100.0
	tristanaRJFixtureManaCD     = 150.0
	tristanaRJFixtureManaShort  = 49.0
	tristanaRJTargetMR          = 100.0
	tristanaRJTargetHP          = 1000.0

	// Default fixture: bonusAD=100, AP=100 → raw 360; MR100 → mitigated 180.
	tristanaRJExpectedRawDefault = 360.0
	tristanaRJExpectedMitDefault = 180.0
	tristanaRJManaAfter2         = 50.0  // 150 - 50 - 50
	tristanaRJHPAfter2           = 640.0 // 1000 - 180 - 180

	tristanaRJSeedDamageJSON = `{"op":"add","args":[{"op":"add","args":[{"op":"const","value":210},` +
		`{"op":"mul","args":[{"op":"const","value":1.00},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},` +
		`{"op":"mul","args":[{"op":"const","value":0.50},{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	tristanaRJTol = 1e-9
)

func tristanaRJOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"bonus_ad_ratio",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func tristanaRJExpectedRawFromStats(resolvedAD, baseAD, resolvedAP float64) float64 {
	return tristanaRJBaseDamage +
		tristanaRJBonusADRatio*(resolvedAD-baseAD) +
		tristanaRJAPRatio*resolvedAP
}

func tristanaRJDamageAmount() *model.GenericFormulaExpr {
	base := tristanaRJBaseDamage
	adRatio := tristanaRJBonusADRatio
	apRatio := tristanaRJAPRatio
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

func tristanaRJCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += tristanaRJCountPathReads(&expr.Args[i], path)
	}
	return n
}

func tristanaRJAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		tristanaRJAssertBinaryArity(t, &expr.Args[i])
	}
}

func tristanaRJAbility() model.AbilityDefinition {
	cost := tristanaRJManaCost
	cd := tristanaRJCDMs
	return model.AbilityDefinition{
		AbilityKey: tristanaRJAbilityKey,
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
				Ref:           tristanaRJDamageOpRef,
				Amount:        tristanaRJDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func tristanaRJProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: tristanaRJProviderRef,
		Kind:        "champion",
		StableID:    tristanaRJStableID,
		Abilities:   []model.AbilityDefinition{tristanaRJAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed W provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: tristanaRJBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func tristanaRJAbilityRef() string {
	return "source.provider[" + tristanaRJProviderRef + "].ability[" + tristanaRJAbilityKey + "]"
}

type tristanaRJFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
}

func configureTristanaRJProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts tristanaRJFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{tristanaRJProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: tristanaRJProviderRef, DefinitionRef: tristanaRJProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: tristanaRJProviderRef, DefinitionRef: tristanaRJProviderRef,
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

func ensureTristanaRJTypes(req *model.CompileRequest) {
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

func loadTristanaRJFixture(t *testing.T, opts tristanaRJFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/mr explicitly
	// (AD0 / AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = tristanaRJFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = tristanaRJTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureTristanaRJTypes(&compileReq)
	configureTristanaRJProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/mana/HP/MR values (external-existing-data/check-only); do not
	// claim seed materializes hero_tristana / ad / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, tristanaRJFixtureManaCD),
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

// loadTristanaRJQWFixture mounts independent Rapid Fire Q beside W (same-package
// helpers; no sibling synthesis of R/P/E/basic/Explosive Charge).
func loadTristanaRJQWFixture(t *testing.T, mana float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	opts := tristanaRJFixtureOpts{
		baseAD: tristanaRJADBaseDefault, resolvedAD: tristanaRJADResolvedDefault,
		resolvedAP: tristanaRJFixtureAPDefault, mr: tristanaRJTargetMR,
		mana: mana, hp: tristanaRJTargetHP,
	}
	compileReq, runReq := loadTristanaRJFixture(t, opts)
	ensureTristanaRFTypes(&compileReq)
	qProv := tristanaRFProviderDef()
	compileReq.SharedProviders = append(compileReq.SharedProviders, qProv)
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers,
		model.CombatantProviderMount{ProviderRef: tristanaRFProviderRef, DefinitionRef: tristanaRFProviderRef})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: tristanaRFProviderRef, DefinitionRef: tristanaRFProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: tristanaRFBaseAS, Current: tristanaRFBaseAS, Max: tristanaRFBaseAS, Resolved: tristanaRFBaseAS,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: mana, Max: math.Max(mana, tristanaRJFixtureManaCD),
	})
	return compileReq, runReq
}

func runTristanaRJ(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runTristanaRJFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func tristanaRJSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func tristanaRJSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func tristanaRJSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func tristanaRJDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := tristanaRJAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != tristanaRJDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func tristanaRJAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only W mounted, filter by
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

func tristanaRJFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == tristanaRJProviderRef {
			return p
		}
	}
	return nil
}

func assertTristanaRJProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := tristanaRJFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_tristana_w_rocket_jump_primary_landing_hit missing from SharedProviders")
	}
	if p.ProviderKey != tristanaRJProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, tristanaRJProviderRef)
	}
	if p.StableID != tristanaRJStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, tristanaRJStableID)
	}
	banned := []string{
		"provider_hero_tristana_p_", "provider_hero_tristana_q_", "provider_hero_tristana_e_",
		"provider_hero_tristana_r_", "provider_hero_tristana_basic_",
		"ability_hero_tristana_p_", "ability_hero_tristana_q_", "ability_hero_tristana_e_",
		"ability_hero_tristana_r_", "ability_hero_tristana_basic_",
		"explosive_charge",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("rocket_jump primary landing-hit must not reuse sibling/basic/Explosive Charge refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != tristanaRJBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], tristanaRJBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production W has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), tristanaRJAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != tristanaRJAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, tristanaRJAbilityKey, tristanaRJAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("W Types=%v want empty (no ability-specific type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("rocket_jump_primary_landing_hit must not be tagged ability/basic_attack")
		}
		if typ == tristanaRFAbilityType {
			t.Fatal("W must not carry ability/tristana_rapid_fire")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-tristanaRJManaCost) > tristanaRJTol {
		t.Fatalf("cost=%+v want mana const 50", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-tristanaRJCDMs) > tristanaRJTol {
		t.Fatalf("cooldown=%+v want const 14000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary magic landing hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("rocket jump damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("rocket jump damage must not be copyable on hit")
	}
	if op.Ref != tristanaRJDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, tristanaRJDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(add(base, bonusAD), AP)", op.Amount)
	}
	tristanaRJAssertBinaryArity(t, op.Amount)
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const210, mul(1.00, sub(ad.resolved, ad.base)))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-tristanaRJBaseDamage) > tristanaRJTol {
		t.Fatalf("base const=%+v want 210", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-tristanaRJBonusADRatio) > tristanaRJTol {
		t.Fatalf("bonus AD ratio=%+v want 1.00", adMul.Args[0])
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
		math.Abs(*apMul.Args[0].Value-tristanaRJAPRatio) > tristanaRJTol {
		t.Fatalf("AP ratio=%+v want 0.50", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if tristanaRJCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", tristanaRJCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if tristanaRJCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", tristanaRJCountPathReads(op.Amount, "source.attr.ad.base"))
	}
	if tristanaRJCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", tristanaRJCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if tristanaRJCountPathReads(op.Amount, "source.attr.ap.base") != 0 {
		t.Fatal("formula must not invent ap.base reads")
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
			bannedOp.Operation == "dash" || bannedOp.Operation == "movement" {
			t.Fatalf("rocket jump must not include excluded op: %+v", bannedOp)
		}
	}
}

func findTristanaRJAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := tristanaRJAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func tristanaRJRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func tristanaRJLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(tristanaRJRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql"))
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

func tristanaRJSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func tristanaRJSHA256HexUpper(b []byte) string {
	return strings.ToUpper(tristanaRJSHA256Hex(b))
}

func tristanaRJAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > tristanaRJTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > tristanaRJTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != tristanaRJDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), tristanaRJDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != tristanaRJAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), tristanaRJAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != tristanaRJProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), tristanaRJProviderRef)
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

// TestTristanaRocketJumpPrimaryLandingHitSourceSeedProviderFormulaShape locks wiki/sidecar/
// pages/local-raw serialization caveat, seed/README/JUnit identities and source blob
// hashes, external-existing-data check-only prerequisites / non-materialization,
// ordered tags, type-policy evidence, and W provider/nested bonusAD+AP formula shape.
func TestTristanaRocketJumpPrimaryLandingHitSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Cooldown, Cost, Costtype, Damagetype, Notes string
			Description2, Description3                                         string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(tristanaRJRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "tristana-w.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != tristanaRJCandidateKey || doc.RequestTitle != tristanaRJRequestTitle ||
		doc.ResolvedTitle != tristanaRJResolvedTitle || doc.WikiPageID != tristanaRJWikiPageID ||
		doc.RevisionID != tristanaRJRevisionID || doc.RevisionTimestamp != tristanaRJTimestamp ||
		doc.ContentSHA256 != tristanaRJContentSHA || doc.RawByteSize != tristanaRJRawBytes ||
		doc.SkillKey != "W" || doc.ZhDisplayName != "火箭跳跃" || doc.OwnerID != "hero_tristana" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "cooldown", "cost", "costtype", "damagetype", "notes",
		"description2", "description3",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|30 to 50}}\n" || doc.Fields.Costtype != "mana\n" ||
		doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|22 to 14}}\n" {
		t.Fatalf("cooldown=%q want {{ap|22 to 14}} (rank-5 = 14s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|70 to 210}}") ||
		!strings.Contains(doc.Fields.Leveling, "100% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling, "50% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling=%q want rank5 magic 210 +100%% bonus AD +50%% AP", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") ||
		!strings.Contains(doc.Fields.Description, "{{tip|dash|jumps}}") {
		t.Fatal("wiki prose must retain magic damage / dash jump wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description, "{{tip|slows}}") ||
		!strings.Contains(doc.Fields.Description, "40%") {
		t.Fatal("wiki prose must retain excluded slow surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "takedown") ||
		!strings.Contains(doc.Fields.Description2, "Explosive Charge") ||
		!strings.Contains(doc.Fields.Description2, "reset") {
		t.Fatal("wiki description2 must retain excluded takedown/Explosive Charge reset surfaces")
	}
	if !strings.Contains(doc.Fields.Description3, "during the dash") {
		t.Fatal("wiki description3 must retain excluded cast-during-dash surface")
	}
	if !strings.Contains(doc.Fields.Notes, "dash speed") ||
		!strings.Contains(doc.Fields.Notes, "Explosive Charge") ||
		!strings.Contains(doc.Fields.Notes, "clone") {
		t.Fatalf("notes missing excluded dash-speed/Explosive Charge/clone surfaces: %q",
			doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(tristanaRJRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "tristana-w.json"))
	if err != nil {
		t.Fatal(err)
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
		pages.SkillKey != "W" || pages.ZhDisplayName != "火箭跳跃" || pages.OwnerID != "hero_tristana" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(tristanaRJRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "tristana-w.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != tristanaRJLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), tristanaRJLocalRawBytes)
	}
	if tristanaRJLocalRawBytes == tristanaRJRawBytes {
		t.Fatal("local raw and canonical sizes must differ (serialization caveat; not equivalence)")
	}
	localSHA := tristanaRJSHA256Hex(rawBytes)
	if localSHA != tristanaRJLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, tristanaRJLocalRawSHA)
	}
	if localSHA == tristanaRJContentSHA {
		t.Fatal("local raw hash must differ from canonical (serialization caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|70 to 210}}",
		"100% '''bonus''' AD",
		"50% AP",
		"|cost         = {{ap|30 to 50}}",
		"|cooldown     = {{ap|22 to 14}}",
		"|damagetype   = Magic",
		"{{tip|dash|jumps}}",
		"{{tip|slows}}",
		"40%",
		"Explosive Charge",
		"during the dash",
		"dash speed",
		"clone",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if tristanaRJPlanRev != "tristana-w-rocket-jump-primary-landing-hit-phase-a-v2" || tristanaRJBoundary !=
		"rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; "+
			"magic_210_plus_1_00_bonus_ad_plus_0_50_ap; "+
			"no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_"+
			"collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_"+
			"charge_reset_cast_during_dash_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := tristanaRJRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := tristanaRJSHA256HexUpper(seedBytes); got != tristanaRJSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, tristanaRJSeedBlobSHA)
	}
	junitPath := tristanaRJRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := tristanaRJSHA256HexUpper(junitBytes); got != tristanaRJJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, tristanaRJJUnitBlobSHA)
	}
	_ = tristanaRJRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := tristanaRJLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(tristanaRJRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		tristanaRJCandidateKey, tristanaRJTaskKey, tristanaRJPlanRev,
		tristanaRJRequestTitle, tristanaRJResolvedTitle,
		"1308523", "4007758", tristanaRJTimestamp, "2444", "2443",
		tristanaRJContentSHA, tristanaRJLocalRawSHA,
		tristanaRJBoundary, tristanaRJProviderRef, tristanaRJAbilityID, tristanaRJAbilityKey,
		"rocket_jump_primary_landing_hit_damage", "w_mana_cost", "w_cooldown_ms",
		`{"op":"const","value":50}`, `{"op":"const","value":14000}`,
		tristanaRJSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/tristana-w.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"bonus AD", "source.attr.ad.resolved", "source.attr.ad.base",
		"source.attr.ap.resolved",
		"ability_started",
		"20221", "20170",
		"Explosive Charge",
		"不要求 P/Q/E/basic/Explosive Charge/R",
		"ability/tristana_rapid_fire",
		"missing game_entities hero_tristana",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_tristana/ad",
		"missing entity_attribute_values hero_tristana/ap",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_tristana/mana",
		"missing reserved_type",
		"210", "1.00", "0.50",
		"嵌套二元",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range tristanaRJOrderedTags() {
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
	for _, tag := range tristanaRJOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
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
		"phase_hero_tristana_w_rocket_jump_primary_landing_hit_impact",
		"sequence_hero_tristana_w_rocket_jump_primary_landing_hit_impact",
		"step_hero_tristana_w_rocket_jump_primary_landing_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_tristana_w_rocket_jump_primary_landing_hit'\s*,\s*` +
		`'provider_hero_tristana_w_rocket_jump_primary_landing_hit'\s*,\s*` +
		`'rocket_jump_primary_landing_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("W must be active ability with stable key rocket_jump_primary_landing_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_tristana_w_rocket_jump_primary_landing_hit_damage'\s*,\s*` +
		`'rocket_jump_primary_landing_hit_damage'\s*,\s*20221\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be magic 20221 add policy copyable_on_hit=false")
	}
	if regexp.MustCompile(`(?is)\b20230\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL/graph must not use provider_action/apply 20230")
	}
	if regexp.MustCompile(`(?is)\b62013\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL must not project Q ability type 62013 onto W")
	}
	if strings.Contains(sqlNoComments, "ability/tristana_rapid_fire") {
		t.Fatal("executable SQL must not attach ability/tristana_rapid_fire to W")
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
	if regexp.MustCompile(`(?is)'provider_hero_tristana_[pqer]_|'ability_hero_tristana_[pqer]_|` +
		`'provider_hero_tristana_basic_|'ability_hero_tristana_basic_|explosive_charge`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/Q/E/R/basic/Explosive Charge graph rows")
	}

	for _, want := range []string{
		tristanaRJCandidateKey, tristanaRJTaskKey, tristanaRJPlanRev,
		"lol_generic_tristana_rocket_jump_primary_landing_hit_seed.sql",
		"LolGenericTristanaRocketJumpPrimaryLandingHitSeedSqlTest",
		"external existing-data",
		"magic_210_plus_1_00_bonus_ad_plus_0_50_ap",
		"bonus_ad_ratio", "ap_ratio",
		"Explosive Charge",
		"ability/tristana_rapid_fire",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Tristana identity/panel/resource")
	}
	if strings.Contains(readme, "op:tristana_rocket_jump_primary_landing_hit_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}

	compileReq, _ := loadTristanaRJFixture(t, tristanaRJFixtureOpts{
		baseAD: tristanaRJADBaseDefault, resolvedAD: tristanaRJADResolvedDefault,
		resolvedAP: tristanaRJFixtureAPDefault, mr: tristanaRJTargetMR, mana: tristanaRJFixtureManaCD,
	})
	assertTristanaRJProviderShape(t, compileReq, 1, true)
	rawX := tristanaRJExpectedRawFromStats(
		tristanaRJADResolvedDefault, tristanaRJADBaseDefault, tristanaRJFixtureAPDefault)
	if math.Abs(rawX-tristanaRJExpectedRawDefault) > tristanaRJTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, tristanaRJExpectedRawDefault)
	}
	mitX := expectedMitigatedMagic(rawX, tristanaRJTargetMR)
	if math.Abs(mitX-tristanaRJExpectedMitDefault) > tristanaRJTol {
		t.Fatalf("default mit=%v want %v", mitX, tristanaRJExpectedMitDefault)
	}
	totalAsIf := tristanaRJBaseDamage +
		tristanaRJBonusADRatio*tristanaRJADResolvedDefault +
		tristanaRJAPRatio*tristanaRJFixtureAPDefault
	if math.Abs(totalAsIf-tristanaRJExpectedRawDefault) < tristanaRJTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestTristanaRocketJumpPrimaryLandingHitFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/AP/MR raw/final table; one isolated successful W cast per row.
func TestTristanaRocketJumpPrimaryLandingHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		baseAD, resolvedAD     float64
		resolvedAP, mr         float64
		wantRaw, wantMitigated float64
	}{
		{"base0_resolved0_AP0_MR0", 0, 0, 0, 0, 210, 210},
		{"base60_resolved60_AP0_MR0", 60, 60, 0, 0, 210, 210},
		{"base60_resolved160_AP0_MR0", 60, 160, 0, 0, 310, 310},
		{"base60_resolved160_AP100_MR0", 60, 160, 100, 0, 360, 360},
		{"base60_resolved160_AP100_MR100", 60, 160, 100, 100, 360, 180},
		{"base60_resolved260_AP200_MR100", 60, 260, 200, 100, 510, 255},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := tristanaRJExpectedRawFromStats(tc.resolvedAD, tc.baseAD, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > tristanaRJTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > tristanaRJTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadTristanaRJFixture(t, tristanaRJFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: tristanaRJFixtureManaCD,
			})
			assertTristanaRJProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := tristanaRJAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runTristanaRJ(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := tristanaRJDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("W damage evidence=%d want 1", len(dmg))
			}
			tristanaRJAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > tristanaRJTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(tristanaRJSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > tristanaRJTol {
				t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)",
					tristanaRJSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > tristanaRJTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(tristanaRJAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(tristanaRJAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestTristanaRocketJumpPrimaryLandingHitBonusADCounterproof: baseAD0/resolvedAD100/AP100
// versus baseAD60/resolvedAD160/AP100 at MR0 must both raw/final 360 — equal bonus AD.
func TestTristanaRocketJumpPrimaryLandingHitBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100_AP100", 0, 100},
		{"baseAD60_resolvedAD160_AP100", 60, 160},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadTristanaRJFixture(t, tristanaRJFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: tristanaRJFixtureAPDefault, mr: 0, mana: tristanaRJFixtureManaCD,
			})
			assertTristanaRJProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: tristanaRJAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runTristanaRJ(t, compileReq, runReq)
			dmg := tristanaRJDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("W damage=%d want 1", len(dmg))
			}
			tristanaRJAssertDamage(t, dmg[0], 360, 360)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > tristanaRJTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(tristanaRJSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > tristanaRJTol {
				t.Fatalf("ad.base=%v want %v", tristanaRJSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tristanaRJFixtureAPDefault) > tristanaRJTol {
				t.Fatalf("ap.resolved=%v want %v",
					sourceAttrResolved(t, done.FinalSnapshot, "ap"), tristanaRJFixtureAPDefault)
			}
		})
	}
	totalAsIf := tristanaRJBaseDamage +
		tristanaRJBonusADRatio*160 +
		tristanaRJAPRatio*tristanaRJFixtureAPDefault
	bonus := tristanaRJExpectedRawFromStats(160, 60, tristanaRJFixtureAPDefault)
	if math.Abs(totalAsIf-bonus) < tristanaRJTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestTristanaRocketJumpPrimaryLandingHitCooldownMana150AbilityStarted: mana150/
// base60/resolved160/AP100/HP1000/MR100 at t0/t13999/t14000 →
// success/cooldown skip/success; final mana50/HP640; exactly two W damage
// items and two automatic W ability_started events.
func TestTristanaRocketJumpPrimaryLandingHitCooldownMana150AbilityStarted(t *testing.T) {
	compileReq, runReq := loadTristanaRJFixture(t, tristanaRJFixtureOpts{
		baseAD: tristanaRJADBaseDefault, resolvedAD: tristanaRJADResolvedDefault,
		resolvedAP: tristanaRJFixtureAPDefault, mr: tristanaRJTargetMR,
		mana: tristanaRJFixtureManaCD, hp: tristanaRJTargetHP,
	})
	assertTristanaRJProviderShape(t, compileReq, 1, true)
	ref := tristanaRJAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 13999},
		{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 14000},
	}
	runReq.StopPolicy.DurationMs = 14100
	done := runTristanaRJ(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if tristanaRJSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findTristanaRJAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt13999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 13999 {
			t.Fatalf("cooldown skip TimeMs=%d want 13999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 14000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 14000", item.Data["readyAtMs"])
		}
		skipAt13999 = true
	}
	if !skipAt13999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=13999 with readyAtMs=14000")
	}

	items := tristanaRJDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("W damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 14000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		tristanaRJAssertDamage(t, item, tristanaRJExpectedRawDefault, tristanaRJExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * tristanaRJExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-tristanaRJHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, tristanaRJHPAfter2)
	}
	gotMana := tristanaRJSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-tristanaRJManaAfter2) > tristanaRJTol {
		t.Fatalf("mana=%v want %v", gotMana, tristanaRJManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := tristanaRJAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic W; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 14000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tristanaRJADResolvedDefault) > tristanaRJTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), tristanaRJADResolvedDefault)
	}
	if math.Abs(tristanaRJSourceAttrBase(t, done.FinalSnapshot, "ad")-tristanaRJADBaseDefault) > tristanaRJTol {
		t.Fatalf("ad.base=%v want %v",
			tristanaRJSourceAttrBase(t, done.FinalSnapshot, "ad"), tristanaRJADBaseDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tristanaRJFixtureAPDefault) > tristanaRJTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), tristanaRJFixtureAPDefault)
	}
}

// TestTristanaRocketJumpPrimaryLandingHitResourceInsufficientMana49: mana49 at t0 →
// resource_insufficient; mana/HP unchanged; zero W damage/start evidence.
func TestTristanaRocketJumpPrimaryLandingHitResourceInsufficientMana49(t *testing.T) {
	compileReq, runReq := loadTristanaRJFixture(t, tristanaRJFixtureOpts{
		baseAD: tristanaRJADBaseDefault, resolvedAD: tristanaRJADResolvedDefault,
		resolvedAP: tristanaRJFixtureAPDefault, mr: tristanaRJTargetMR,
		mana: tristanaRJFixtureManaShort, hp: tristanaRJTargetHP,
	})
	ref := tristanaRJAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runTristanaRJ(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if tristanaRJSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(tristanaRJSourceMana(t, done.FinalSnapshot)-tristanaRJFixtureManaShort) > tristanaRJTol {
		t.Fatalf("mana changed: got %v want %v",
			tristanaRJSourceMana(t, done.FinalSnapshot), tristanaRJFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-tristanaRJTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, tristanaRJTargetHP)
	}
	if len(tristanaRJDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero W damage evidence")
	}
	if len(tristanaRJAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestTristanaRocketJumpPrimaryLandingHitQWCoexistenceAbilityTypeIsolation: mount
// independent W and existing Rapid Fire Q. W cast alone leaves Q state0/AS0.60 while
// producing exactly one W magic landing hit/start; Q cast arms Q/AS1.32 and produces
// no W damage. Assert W Types exclude ability/tristana_rapid_fire, provider refs/
// stable IDs distinct, and no R or other sibling synthesis.
func TestTristanaRocketJumpPrimaryLandingHitQWCoexistenceAbilityTypeIsolation(t *testing.T) {
	compileReq, _ := loadTristanaRJQWFixture(t, 300)
	assertTristanaRJProviderShape(t, compileReq, 2, true)
	assertTristanaRFProviderShape(t, compileReq, 2)

	wRef := tristanaRJAbilityRef()
	qRef := tristanaRFAbilityRef()
	if wRef == qRef {
		t.Fatal("W and Q ability refs must be distinct")
	}
	pW := tristanaRJFindProvider(compileReq)
	pQ := tristanaRFFindProvider(compileReq)
	if pW == nil || pQ == nil {
		t.Fatal("combined fixture must mount both W and Q providers")
	}
	if pW.ProviderKey == pQ.ProviderKey || pW.StableID == pQ.StableID {
		t.Fatal("W/Q provider keys/stable IDs must not collide")
	}
	qAb := tristanaRFFindAbility(pQ, tristanaRFAbilityKey)
	if qAb == nil || len(qAb.Types) != 1 || qAb.Types[0] != tristanaRFAbilityType {
		t.Fatalf("Q ability type isolation missing: %+v", qAb)
	}
	if len(pW.Abilities[0].Types) != 0 {
		t.Fatalf("W Types must be empty; got %+v", pW.Abilities[0].Types)
	}
	for _, typ := range pW.Abilities[0].Types {
		if typ == tristanaRFAbilityType {
			t.Fatal("W must not carry ability/tristana_rapid_fire")
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_tristana_[per]_|ability_hero_tristana_[per]_|` +
		`provider_hero_tristana_basic_|ability_hero_tristana_basic_|explosive_charge`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			t.Fatalf("must not synthesize R/P/E/basic/Explosive Charge provider: %+v", p)
		}
		if p.ProviderKey == tristanaBSProviderRef || p.StableID == tristanaBSStableID {
			t.Fatal("combined Q+W fixture must not synthesize Buster Shot R")
		}
	}

	t.Run("w_cast_alone_does_not_arm_q", func(t *testing.T) {
		c, r := loadTristanaRJQWFixture(t, 300)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: wRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runTristanaRJ(t, c, r)

		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 0 {
			t.Fatalf("rapid_fire_active after W-only=%v want 0 (ability-type isolation)", got)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-tristanaRFBaseAS) > tristanaRJTol {
			t.Fatalf("attack_speed after W-only=%v want baseline %v", got, tristanaRFBaseAS)
		}
		dmg := tristanaRJDamageEvidence(done)
		if len(dmg) != 1 {
			t.Fatalf("W damage evidence=%d want 1", len(dmg))
		}
		tristanaRJAssertDamage(t, dmg[0], tristanaRJExpectedRawDefault, tristanaRJExpectedMitDefault)
		if countEmittedEvents(done, tristanaRFCastEvent) != 1 {
			t.Fatalf("ability_started=%d want 1 (W only)", countEmittedEvents(done, tristanaRFCastEvent))
		}
		wStat := findTristanaRFAbilityStat(t, done, wRef)
		if wStat.CastCount != 1 {
			t.Fatalf("W castCount=%d want 1", wStat.CastCount)
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == qRef && st.CastCount != 0 {
				t.Fatalf("Q must not cast during W-only schedule: %+v", st)
			}
		}
	})

	t.Run("q_cast_arms_q_no_w_damage", func(t *testing.T) {
		c, r := loadTristanaRJQWFixture(t, 300)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: qRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runTristanaRJ(t, c, r)

		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 1 {
			t.Fatalf("rapid_fire_active after Q=%v want 1", got)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-tristanaRFResolvedAS) > tristanaRJTol {
			t.Fatalf("attack_speed after Q=%v want %v", got, tristanaRFResolvedAS)
		}
		if len(tristanaRJDamageEvidence(done)) != 0 {
			t.Fatal("Q cast must not produce W damage")
		}
		if n := len(damageEvidenceItems(done)); n != 0 {
			t.Fatalf("total damage evidence=%d want 0 (Q has no damage; W not cast)", n)
		}
		if countEmittedEvents(done, tristanaRFCastEvent) != 1 {
			t.Fatalf("ability_started=%d want 1 (Q only)", countEmittedEvents(done, tristanaRFCastEvent))
		}
		qStat := findTristanaRFAbilityStat(t, done, qRef)
		if qStat.CastCount != 1 {
			t.Fatalf("Q castCount=%d want 1", qStat.CastCount)
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == wRef && st.CastCount != 0 {
				t.Fatalf("W must not cast during Q-only schedule: %+v", st)
			}
		}
	})
}

// TestTristanaRocketJumpPrimaryLandingHitDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// post-release session_not_found.
func TestTristanaRocketJumpPrimaryLandingHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadTristanaRJFixture(t, tristanaRJFixtureOpts{
				baseAD: tristanaRJADBaseDefault, resolvedAD: tristanaRJADResolvedDefault,
				resolvedAP: tristanaRJFixtureAPDefault, mr: tristanaRJTargetMR, mana: tristanaRJFixtureManaCD,
			})
			ref := tristanaRJAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 13999},
				{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 14000},
			}
			r.StopPolicy.DurationMs = 14100
			done := runTristanaRJ(t, c, r)
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
		c, r := loadTristanaRJFixture(t, tristanaRJFixtureOpts{
			baseAD: tristanaRJADBaseDefault, resolvedAD: tristanaRJADResolvedDefault,
			resolvedAP: tristanaRJFixtureAPDefault, mr: tristanaRJTargetMR, mana: tristanaRJFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: tristanaRJAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runTristanaRJFrames(t, c, r)
		if len(tristanaRJDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path W damage=%d want 1", len(tristanaRJDamageEvidence(done)))
		}
		tristanaRJAssertDamage(t, tristanaRJDamageEvidence(done)[0],
			tristanaRJExpectedRawDefault, tristanaRJExpectedMitDefault)
		if len(tristanaRJAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadTristanaRJFixture(t, tristanaRJFixtureOpts{
			baseAD: tristanaRJADBaseDefault, resolvedAD: tristanaRJADResolvedDefault,
			resolvedAP: tristanaRJFixtureAPDefault, mr: tristanaRJTargetMR, mana: tristanaRJFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: tristanaRJAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
