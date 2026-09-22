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

// hero_jhin Q Dancing Grenade / 曼舞手雷 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: jhin-q-dancing-grenade-primary-first-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold;
//	physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_
//	projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_
//	unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_
//	bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_jhin|Q|曼舞手雷
//	task wasm-generic-jhin-dancing-grenade-primary-first-hit
//	Request Template:Data Jhin/Q → resolved Template:Data Jhin/Dancing Grenade
//	wikiPageId 1307579 / rev 4007611 / timestamp 2026-04-12T07:23:12Z
//	canonical rawByteSize 1913 / SHA256
//	  522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1
//	数据参考/lol-wiki-current-champions/normalized/generic/jhin-q.json
//	  authoritative normalized bytes 2388 / SHA256
//	  6f5c6dcc9771140136705f8e6554cb999f7ec5a1272515d5cbd03b910bdd20b1
//	pages/raw siblings: pages/jhin-q.json (bytes 682 / SHA256
//	  642d7c88a064cd3107a4cf9f51a75be2ca91bb2e904afd6cfa8cf3ead92b7897),
//	  raw/jhin-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql
//	Local raw materialization caveat: 1911 bytes / SHA256
//	  17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_jhin_q_dancing_grenade_primary_first_hit
//     (standalone; not P/W/E/R/basic synthesis; preserve existing W without
//     requiring/mutating/synthesizing/copying W; Q seed contains no W rows)
//   - ability ability_hero_jhin_q_dancing_grenade_primary_first_hit with ability_key
//     dancing_grenade_primary_first_hit: active; mana 60; cooldown 5000 ms
//   - Exactly one immediate selected-primary-champion physical damage op:
//     add(add(const 144, mul(const 0.74, read source.attr.ad.resolved)),
//         mul(const 0.60, read source.attr.ap.resolved))
//     (AD is total AD; never subtract base AD; never call it bonus AD; AD and AP
//     resolved each read exactly once; no crit read)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: physical 20220 + add policy 20170; 20230 forbidden
//   - No Jhin Q state/modifier/listener/matcher/repeat/control/projectile/
//     bounce/secondary/death-amp; no explicit event op — successful cast relies
//     on runtime automatic ability_started. Fixture may supply entity/attribute/
//     resource values (external-existing-data/check-only) and may attach a
//     fixture-only flat AD modifier so ad.resolved can differ from ad.base;
//     must not claim the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast time / unit-targeted cancel conditions; projectile travel / first-target
//   acquisition; bounce to up to three additional targets / nearest-unhit
//   priority; target-death +35% later-bounce amplification / maximum final bounce;
//   spellshield bounce-persistence; ranks 1–4; siblings/basic/loadout/crit/
//   on-hit/phantom; live/E2E/full fidelity.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, ap_ratio,
// immediate_impact_scaffold (explicitly no total_ad_ratio or salvage tag; total AD
// remains exact in formula/boundary/reason only).

const (
	jhinDGCandidateKey    = "hero_skill|hero_jhin|Q|曼舞手雷"
	jhinDGTaskKey         = "wasm-generic-jhin-dancing-grenade-primary-first-hit"
	jhinDGPlanRev         = "jhin-q-dancing-grenade-primary-first-hit-phase-a-v1"
	jhinDGRequestTitle    = "Template:Data Jhin/Q"
	jhinDGResolvedTitle   = "Template:Data Jhin/Dancing Grenade"
	jhinDGWikiPageID      = 1307579
	jhinDGRevisionID      = 4007611
	jhinDGTimestamp       = "2026-04-12T07:23:12Z"
	jhinDGRawBytes        = 1913
	jhinDGLocalRawBytes   = 1911
	jhinDGNormalizedBytes = 2388
	jhinDGPagesBytes      = 682
	jhinDGContentSHA      = "522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1"
	jhinDGLocalRawSHA     = "17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb"
	jhinDGNormalizedSHA   = "6f5c6dcc9771140136705f8e6554cb999f7ec5a1272515d5cbd03b910bdd20b1"
	jhinDGPagesSHA        = "642d7c88a064cd3107a4cf9f51a75be2ca91bb2e904afd6cfa8cf3ead92b7897"
	jhinDGBoundary        = "rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; " +
		"physical_144_plus_0_74_total_ad_plus_0_60_ap; " +
		"no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_" +
		"bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_" +
		"damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_" +
		"other_ranks_or_full_fidelity"

	jhinDGProviderRef = "provider_hero_jhin_q_dancing_grenade_primary_first_hit"
	jhinDGStableID    = "hero_jhin_q_dancing_grenade_primary_first_hit"
	jhinDGAbilityID   = "ability_hero_jhin_q_dancing_grenade_primary_first_hit"
	jhinDGAbilityKey  = "dancing_grenade_primary_first_hit"
	jhinDGDamageOpRef = "op:jhin_dancing_grenade_primary_first_hit_damage"
	jhinDGTotalADMod  = "fixture_jhin_dancing_grenade_primary_first_hit_total_ad"

	jhinDGSeedBlobSHA  = "414DA9285D861111CD7F0753768D4082366F7515EF3F67CC81CD5EC0C373DB11"
	jhinDGJUnitBlobSHA = "B2C7A800AAD33DB993F2E07958E537E26BC5F09D6848D70A2FF21CC6EE7F38CA"

	jhinDGBaseDamage = 144.0
	jhinDGADRatio    = 0.74
	jhinDGAPRatio    = 0.60
	jhinDGManaCost   = 60.0
	jhinDGCDMs       = 5000.0

	jhinDGADBaseDefault      = 60.0
	jhinDGADResolvedDefault  = 100.0
	jhinDGFixtureAPDefault   = 100.0
	jhinDGFixtureManaCD      = 180.0
	jhinDGFixtureManaShort   = 59.0
	jhinDGTargetArmorDefault = 100.0
	jhinDGTargetHP           = 1000.0

	jhinDGExpectedRawDefault = 278.0 // 144 + 0.74*100 + 0.60*100
	jhinDGExpectedMitDefault = 139.0 // armor100
	jhinDGManaAfter2         = 60.0  // 180 - 60 - 60
	jhinDGHPAfter2           = 722.0 // 1000 - 139 - 139

	jhinDGSeedDamageJSON = `{"op":"add","args":[{"op":"add","args":[{"op":"const","value":144},` +
		`{"op":"mul","args":[{"op":"const","value":0.74},` +
		`{"op":"read","path":"source.attr.ad.resolved"}]}]},` +
		`{"op":"mul","args":[{"op":"const","value":0.60},` +
		`{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	jhinDGTol = 1e-9
)

func jhinDGOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func jhinDGExpectedRawFromStats(resolvedAD, resolvedAP float64) float64 {
	return jhinDGBaseDamage + jhinDGADRatio*resolvedAD + jhinDGAPRatio*resolvedAP
}

func jhinDGDamageAmount() *model.GenericFormulaExpr {
	base := jhinDGBaseDamage
	adRatio := jhinDGADRatio
	apRatio := jhinDGAPRatio
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

func jhinDGCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += jhinDGCountPathReads(&expr.Args[i], path)
	}
	return n
}

func jhinDGAbility() model.AbilityDefinition {
	cost := jhinDGManaCost
	cd := jhinDGCDMs
	return model.AbilityDefinition{
		AbilityKey: jhinDGAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical first-grenade hit; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           jhinDGDamageOpRef,
				Amount:        jhinDGDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func jhinDGProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: jhinDGProviderRef,
		Kind:        "champion",
		StableID:    jhinDGStableID,
		Abilities:   []model.AbilityDefinition{jhinDGAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed Q provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: jhinDGTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func jhinDGAbilityRef() string {
	return "source.provider[" + jhinDGProviderRef + "].ability[" + jhinDGAbilityKey + "]"
}

type jhinDGFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	armor      float64
	mana       float64
	hp         float64
	withW      bool
}

func configureJhinDGProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts jhinDGFixtureOpts) {
	flat := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{jhinDGProviderDef(flat)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: jhinDGProviderRef, DefinitionRef: jhinDGProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: jhinDGProviderRef, DefinitionRef: jhinDGProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if opts.withW {
		// Same-package existing W helpers (read-only use); do not modify W test file.
		// Mount W with zero fixture AD mod so only Q's total-AD flat raises resolved.
		providers = append(providers, jhinDFProviderDef(0))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: jhinDFProviderRef, DefinitionRef: jhinDFProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: jhinDFProviderRef, DefinitionRef: jhinDFProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
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

func ensureJhinDGTypes(req *model.CompileRequest) {
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

func loadJhinDGFixture(t *testing.T, opts jhinDGFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/armor explicitly
	// (AD0 / AP0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = jhinDGFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = jhinDGTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureJhinDGTypes(&compileReq)
	configureJhinDGProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_jhin / ad / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, jhinDGFixtureManaCD),
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

func runJhinDG(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runJhinDGFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func jhinDGSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func jhinDGSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func jhinDGSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func jhinDGDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := jhinDGAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != jhinDGDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func jhinDGAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func jhinDGFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == jhinDGProviderRef {
			return p
		}
	}
	return nil
}

func assertJhinDGProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := jhinDGFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_jhin_q_dancing_grenade_primary_first_hit missing from SharedProviders")
	}
	if p.ProviderKey != jhinDGProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, jhinDGProviderRef)
	}
	if p.StableID != jhinDGStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, jhinDGStableID)
	}
	banned := []string{
		"provider_hero_jhin_p_", "provider_hero_jhin_w_", "provider_hero_jhin_e_",
		"provider_hero_jhin_r_", "provider_hero_jhin_basic_",
		"ability_hero_jhin_p_", "ability_hero_jhin_w_", "ability_hero_jhin_e_",
		"ability_hero_jhin_r_", "ability_hero_jhin_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("dancing grenade primary-first-hit must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != jhinDGTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], jhinDGTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production Q has no modifiers when flat=0)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), jhinDGAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != jhinDGAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, jhinDGAbilityKey, jhinDGAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("dancing_grenade_primary_first_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-jhinDGManaCost) > jhinDGTol {
		t.Fatalf("cost=%+v want mana const 60", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-jhinDGCDMs) > jhinDGTol {
		t.Fatalf("cooldown=%+v want const 5000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one physical first-grenade hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("dancing grenade primary-first-hit damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("dancing grenade primary-first-hit damage must not be copyable on hit")
	}
	if op.Ref != jhinDGDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, jhinDGDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(add(const144, mul(0.74, ad.resolved)), mul(0.60, ap.resolved))", op.Amount)
	}
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const, mul(adRatio, ad.resolved))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-jhinDGBaseDamage) > jhinDGTol {
		t.Fatalf("base const=%+v want 144", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-jhinDGADRatio) > jhinDGTol {
		t.Fatalf("AD ratio=%+v want 0.74", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-jhinDGAPRatio) > jhinDGTol {
		t.Fatalf("AP ratio=%+v want 0.60", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if jhinDGCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", jhinDGCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if jhinDGCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", jhinDGCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if jhinDGCountPathReads(op.Amount, "source.attr.ad.base") != 0 {
		t.Fatal("total-AD formula must not read/subtract source.attr.ad.base")
	}
	if jhinDGCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 0 ||
		jhinDGCountPathReads(op.Amount, "source.attr.crit_damage.resolved") != 0 {
		t.Fatal("first-grenade formula must not read crit attrs")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "bounce" ||
			bannedOp.Operation == "secondary" || bannedOp.Operation == "death_amp" {
			t.Fatalf("dancing grenade primary-first-hit must not include excluded op: %+v", bannedOp)
		}
	}
}

func findJhinDGAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := jhinDGAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func jhinDGRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func jhinDGLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(jhinDGRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql"))
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

func jhinDGSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func jhinDGSHA256HexUpper(b []byte) string {
	return strings.ToUpper(jhinDGSHA256Hex(b))
}

func jhinDGAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > jhinDGTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > jhinDGTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != jhinDGDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), jhinDGDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != jhinDGAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), jhinDGAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != jhinDGProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), jhinDGProviderRef)
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
}

// TestJhinDancingGrenadePrimaryFirstHitSourceSeedProviderFormulaShape locks wiki/sidecar/
// pages/local-raw caveat, seed/README/JUnit identities and source blob hashes,
// external-existing-data check-only prerequisites / non-materialization,
// ordered tags (no total_ad_ratio / salvage), type-policy evidence, and Q provider/
// nested total-AD+AP formula shape (AD once, AP once, never ad.base/crit).
func TestJhinDancingGrenadePrimaryFirstHitSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Description2, Leveling, Leveling2 string
			Cooldown, Cost, Costtype, Damagetype, Notes    string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(jhinDGRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "jhin-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != jhinDGNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), jhinDGNormalizedBytes)
	}
	if got := jhinDGSHA256Hex(sidecarRaw); got != jhinDGNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, jhinDGNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != jhinDGCandidateKey || doc.RequestTitle != jhinDGRequestTitle ||
		doc.ResolvedTitle != jhinDGResolvedTitle || doc.WikiPageID != jhinDGWikiPageID ||
		doc.RevisionID != jhinDGRevisionID || doc.RevisionTimestamp != jhinDGTimestamp ||
		doc.ContentSHA256 != jhinDGContentSHA || doc.RawByteSize != jhinDGRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "曼舞手雷" || doc.OwnerID != "hero_jhin" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "leveling2",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|40 to 60}}\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|7 to 5}}\n" {
		t.Fatalf("cooldown=%q want {{ap|7 to 5}} (rank-5 = 5s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|44 to 144}}") ||
		!strings.Contains(doc.Fields.Leveling, "{{ap|44 to 74}}% AD") ||
		!strings.Contains(doc.Fields.Leveling, "60% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "bounce") ||
		!strings.Contains(doc.Fields.Description, "prioritizing") {
		t.Fatal("wiki prose must retain physical damage / bounce / nearest-unhit priority wording")
	}
	if !strings.Contains(doc.Fields.Description2, "35%") ||
		!strings.Contains(doc.Fields.Description2, "dies") {
		t.Fatal("wiki prose must retain excluded target-death +35% later-bounce surfaces")
	}
	if !strings.Contains(doc.Fields.Leveling2, "Maximum Final Bounce") ||
		!strings.Contains(doc.Fields.Leveling2, "Bonus Damage per Target Death") {
		t.Fatal("wiki leveling2 must retain excluded max-bounce / death-amp surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "Spell shield") ||
		!strings.Contains(doc.Fields.Notes, "Unit-targeted cancel conditions") {
		t.Fatalf("notes missing excluded spellshield/cancel surfaces: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(jhinDGRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "jhin-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != jhinDGPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), jhinDGPagesBytes)
	}
	if got := jhinDGSHA256Hex(pagesRaw); got != jhinDGPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, jhinDGPagesSHA)
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "曼舞手雷" || pages.OwnerID != "hero_jhin" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(jhinDGRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "jhin-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != jhinDGLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), jhinDGLocalRawBytes)
	}
	localSHA := jhinDGSHA256Hex(rawBytes)
	if localSHA != jhinDGLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, jhinDGLocalRawSHA)
	}
	if localSHA == jhinDGContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == jhinDGRawBytes {
		t.Fatal("local raw byte length must differ from canonical 1913 (materialization caveat)")
	}
	if jhinDGPlanRev != "jhin-q-dancing-grenade-primary-first-hit-phase-a-v1" || jhinDGBoundary !=
		"rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; "+
			"physical_144_plus_0_74_total_ad_plus_0_60_ap; "+
			"no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_"+
			"bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_"+
			"damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_"+
			"other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := jhinDGRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := jhinDGSHA256HexUpper(seedBytes); got != jhinDGSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, jhinDGSeedBlobSHA)
	}
	junitPath := jhinDGRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := jhinDGSHA256HexUpper(junitBytes); got != jhinDGJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, jhinDGJUnitBlobSHA)
	}
	_ = jhinDGRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := jhinDGLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(jhinDGRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		jhinDGCandidateKey, jhinDGTaskKey, jhinDGPlanRev,
		jhinDGRequestTitle, jhinDGResolvedTitle,
		"1307579", "4007611", jhinDGTimestamp, "1913", "1911", "2388", "682",
		jhinDGContentSHA, jhinDGLocalRawSHA, jhinDGNormalizedSHA, jhinDGPagesSHA,
		jhinDGBoundary, jhinDGProviderRef, jhinDGAbilityID, jhinDGAbilityKey,
		"dancing_grenade_primary_first_hit_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":60}`, `{"op":"const","value":5000}`,
		jhinDGSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/jhin-q.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"total AD", "source.attr.ad.resolved", "source.attr.ap.resolved",
		"ability_started",
		"20220", "20170",
		"Q seed contains no W rows",
		"preserve existing W",
		"missing game_entities hero_jhin",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_jhin/ad",
		"missing entity_attribute_values hero_jhin/ap",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_jhin/mana",
		"missing reserved_type",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range jhinDGOrderedTags() {
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
	for _, tag := range jhinDGOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	// Forbid declaring total_ad_ratio as a numbered/ordered governed tag; the
	// explicit "不含/禁止 total_ad_ratio" caveat in the same section is required.
	if regexp.MustCompile(`(?m)^\s*(?:--\s*)?(?:[-*]?\s*)?\d+\.\s*` + "`?" + `total_ad_ratio` + "`?" + `\b`).MatchString(seed) {
		t.Fatal("must not add a total_ad_ratio governed ordered tag")
	}
	if !strings.Contains(ordSection, "total_ad_ratio") ||
		!(strings.Contains(ordSection, "显式不包含") || strings.Contains(ordSection, "禁止")) {
		t.Fatal("seed must explicitly document absence of total_ad_ratio governed tag")
	}
	if regexp.MustCompile(`(?i)salvage`).MatchString(ordSection) &&
		regexp.MustCompile(`(?m)^\s*(?:--\s*)?(?:[-*]?\s*)?\d+\.\s*`+"`?"+`\S*salvage\S*`+"`?"+`\b`).MatchString(ordSection) {
		t.Fatal("must not add a salvage governed ordered tag")
	}
	if !strings.Contains(ordSection, "salvage") {
		t.Fatal("seed ordered-tags section must explicitly exclude salvage tags")
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
		"phase_hero_jhin_q_dancing_grenade_primary_first_hit_impact",
		"sequence_hero_jhin_q_dancing_grenade_primary_first_hit_impact",
		"step_hero_jhin_q_dancing_grenade_primary_first_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_jhin_q_dancing_grenade_primary_first_hit'\s*,\s*` +
		`'provider_hero_jhin_q_dancing_grenade_primary_first_hit'\s*,\s*` +
		`'dancing_grenade_primary_first_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key dancing_grenade_primary_first_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_jhin_q_dancing_grenade_primary_first_hit_damage'\s*,\s*` +
		`'dancing_grenade_primary_first_hit_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be physical 20220 add policy copyable_on_hit=false")
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
	if regexp.MustCompile(`(?is)'provider_hero_jhin_[pwer]_|'ability_hero_jhin_[pwer]_|` +
		`'provider_hero_jhin_basic_|'ability_hero_jhin_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/W/E/R/basic graph rows")
	}
	for _, banned := range []string{
		"deadly_flourish", "provider_hero_jhin_w_", "ability_hero_jhin_w_",
		"bounce", "nearest_unhit", "death_amp", "spellshield", "projectile",
	} {
		if strings.Contains(sqlNoComments, banned) {
			t.Fatalf("standalone Q seed must not contain W/excluded graph token %q", banned)
		}
	}

	for _, want := range []string{
		jhinDGCandidateKey, jhinDGTaskKey, jhinDGPlanRev,
		"lol_generic_jhin_dancing_grenade_primary_first_hit_seed.sql",
		"LolGenericJhinDancingGrenadePrimaryFirstHitSeedSqlTest",
		"external existing-data",
		"physical_144_plus_0_74_total_ad_plus_0_60_ap",
		"total_ad_ratio",
		"Q seed 不含任何 W rows",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "不含") && !strings.Contains(readme, "禁止") &&
		!strings.Contains(readme, "不得") {
		t.Fatal("README must document governed-tag exclusion framing for total_ad_ratio")
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Jhin identity/panel/resource")
	}
	if strings.Contains(readme, "op:jhin_dancing_grenade_primary_first_hit_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}
	if strings.Contains(readme, "fixture_jhin_dancing_grenade_primary_first_hit_total_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production Q behavior")
	}

	compileReq, _ := loadJhinDGFixture(t, jhinDGFixtureOpts{
		baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
		resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
		mana: jhinDGFixtureManaCD,
	})
	assertJhinDGProviderShape(t, compileReq, 1, true)
	rawX := jhinDGExpectedRawFromStats(jhinDGADResolvedDefault, jhinDGFixtureAPDefault)
	if math.Abs(rawX-jhinDGExpectedRawDefault) > jhinDGTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, jhinDGExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, jhinDGTargetArmorDefault)
	if math.Abs(mitX-jhinDGExpectedMitDefault) > jhinDGTol {
		t.Fatalf("default mit=%v want %v", mitX, jhinDGExpectedMitDefault)
	}
}

// TestJhinDancingGrenadePrimaryFirstHitFormulaMitigationTable: frozen deterministic
// AD/AP/armor raw/final table; proves nested total-AD+AP formula.
func TestJhinDancingGrenadePrimaryFirstHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, resolvedAP float64
		armor                  float64
		wantRaw, wantMitigated float64
	}{
		{"AD0_AP0_armor0", 0, 0, 0, 144, 144},
		{"AD100_AP0_armor0", 100, 0, 0, 218, 218},
		{"AD0_AP100_armor0", 0, 100, 0, 204, 204},
		{"AD100_AP100_armor0", 100, 100, 0, 278, 278},
		{"AD100_AP100_armor100", 100, 100, 100, 278, 139},
		{"AD200_AP100_armor100", 200, 100, 100, 352, 176},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := jhinDGExpectedRawFromStats(tc.resolvedAD, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > jhinDGTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > jhinDGTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			baseAD := jhinDGADBaseDefault
			if tc.resolvedAD == 0 {
				baseAD = 0
			}
			compileReq, runReq := loadJhinDGFixture(t, jhinDGFixtureOpts{
				baseAD: baseAD, resolvedAD: tc.resolvedAD, resolvedAP: tc.resolvedAP,
				armor: tc.armor, mana: jhinDGFixtureManaCD,
			})
			assertJhinDGProviderShape(t, compileReq, 1, tc.resolvedAD != baseAD)
			ref := jhinDGAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runJhinDG(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := jhinDGDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			jhinDGAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > jhinDGTol {
				t.Fatalf("ad.resolved=%v want %v (total AD)", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(jhinDGSourceAttrBase(t, done.FinalSnapshot, "ad")-baseAD) > jhinDGTol {
				t.Fatalf("ad.base=%v want %v (total-AD formula must leave base independent)",
					jhinDGSourceAttrBase(t, done.FinalSnapshot, "ad"), baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > jhinDGTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(jhinDGAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(jhinDGAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestJhinDancingGrenadePrimaryFirstHitTotalADCounterproof: baseAD0 versus baseAD60
// with resolvedAD100/AP0/armor0 must both raw/final 218 — formula reads only
// source.attr.ad.resolved, never source.attr.ad.base.
func TestJhinDancingGrenadePrimaryFirstHitTotalADCounterproof(t *testing.T) {
	cases := []struct {
		name   string
		baseAD float64
	}{
		{"baseAD0_resolvedAD100", 0},
		{"baseAD60_resolvedAD100", 60},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadJhinDGFixture(t, jhinDGFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: jhinDGADResolvedDefault,
				resolvedAP: 0, armor: 0, mana: jhinDGFixtureManaCD,
			})
			assertJhinDGProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: jhinDGAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runJhinDG(t, compileReq, runReq)
			dmg := jhinDGDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			jhinDGAssertDamage(t, dmg[0], 218, 218)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-jhinDGADResolvedDefault) > jhinDGTol {
				t.Fatalf("ad.resolved=%v want 100", sourceAttrResolved(t, done.FinalSnapshot, "ad"))
			}
			if math.Abs(jhinDGSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > jhinDGTol {
				t.Fatalf("ad.base=%v want %v", jhinDGSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	bonusAsIf := jhinDGExpectedRawFromStats(jhinDGADResolvedDefault-jhinDGADBaseDefault, 0)
	baseAlone := jhinDGExpectedRawFromStats(jhinDGADBaseDefault, 0)
	total := jhinDGExpectedRawFromStats(jhinDGADResolvedDefault, 0)
	if math.Abs(bonusAsIf-total) < jhinDGTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	if math.Abs(baseAlone-total) < jhinDGTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestJhinDancingGrenadePrimaryFirstHitCooldownMana180AbilityStarted: mana180/
// baseAD60/resolvedAD100/AP100/HP1000/armor100 at t0/t4999/t5000 →
// success/cooldown skip/success; final mana60/HP722; two Q damage items
// and two automatic Q ability_started events.
func TestJhinDancingGrenadePrimaryFirstHitCooldownMana180AbilityStarted(t *testing.T) {
	compileReq, runReq := loadJhinDGFixture(t, jhinDGFixtureOpts{
		baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
		resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
		mana: jhinDGFixtureManaCD, hp: jhinDGTargetHP,
	})
	assertJhinDGProviderShape(t, compileReq, 1, true)
	ref := jhinDGAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100
	done := runJhinDG(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if jhinDGSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findJhinDGAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt4999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 4999 {
			t.Fatalf("cooldown skip TimeMs=%d want 4999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 5000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 5000", item.Data["readyAtMs"])
		}
		skipAt4999 = true
	}
	if !skipAt4999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=4999 with readyAtMs=5000")
	}

	items := jhinDGDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 5000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		jhinDGAssertDamage(t, item, jhinDGExpectedRawDefault, jhinDGExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * jhinDGExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-jhinDGHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, jhinDGHPAfter2)
	}
	gotMana := jhinDGSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-jhinDGManaAfter2) > jhinDGTol {
		t.Fatalf("mana=%v want %v", gotMana, jhinDGManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := jhinDGAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 5000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-jhinDGADResolvedDefault) > jhinDGTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), jhinDGADResolvedDefault)
	}
	if math.Abs(jhinDGSourceAttrBase(t, done.FinalSnapshot, "ad")-jhinDGADBaseDefault) > jhinDGTol {
		t.Fatalf("ad.base=%v want %v",
			jhinDGSourceAttrBase(t, done.FinalSnapshot, "ad"), jhinDGADBaseDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-jhinDGFixtureAPDefault) > jhinDGTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), jhinDGFixtureAPDefault)
	}
}

// TestJhinDancingGrenadePrimaryFirstHitResourceInsufficientMana59: mana59 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/event evidence.
func TestJhinDancingGrenadePrimaryFirstHitResourceInsufficientMana59(t *testing.T) {
	compileReq, runReq := loadJhinDGFixture(t, jhinDGFixtureOpts{
		baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
		resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
		mana: jhinDGFixtureManaShort, hp: jhinDGTargetHP,
	})
	ref := jhinDGAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJhinDG(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if jhinDGSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(jhinDGSourceMana(t, done.FinalSnapshot)-jhinDGFixtureManaShort) > jhinDGTol {
		t.Fatalf("mana changed: got %v want %v",
			jhinDGSourceMana(t, done.FinalSnapshot), jhinDGFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-jhinDGTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, jhinDGTargetHP)
	}
	if len(jhinDGDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(jhinDGAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestJhinDancingGrenadePrimaryFirstHitStandaloneNoSiblingSynthesis: standalone Q
// provider does not synthesize P/W/E/R/basic or overwrite unrelated definitions.
func TestJhinDancingGrenadePrimaryFirstHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadJhinDGFixture(t, jhinDGFixtureOpts{
		baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
		resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
		mana: jhinDGFixtureManaCD,
	})
	assertJhinDGProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_jhin_dancing_grenade_unrelated_sentinel"
	sentinelStable := "fixture_jhin_dancing_grenade_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != jhinDGProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != jhinDGProviderRef {
			t.Fatalf("source snapshots=%+v want only Q", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_jhin_[pwer]_|ability_hero_jhin_[pwer]_|` +
		`provider_hero_jhin_basic_|ability_hero_jhin_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == jhinDGProviderRef || p.StableID == jhinDGStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != jhinDGProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}
	for _, p := range compileReq.SharedProviders {
		if p.ProviderKey == jhinDFProviderRef || p.StableID == jhinDFStableID {
			t.Fatal("Q-only fixture must not synthesize Deadly Flourish W provider")
		}
	}

	ref := jhinDGAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJhinDG(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(jhinDGDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(jhinDGDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(jhinDFDamageEvidence(done)) != 0 {
		t.Fatal("Q-only must not produce W damage evidence")
	}
	if len(jhinDGAbilityStartedEvidence(done)) != 1 {
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
				if ps.ProviderRef == jhinDGProviderRef || ps.DefinitionRef == jhinDGProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestJhinDancingGrenadePrimaryFirstHitQWIsolationCoexistence: test-only composition
// of independent Q + existing W graphs. Q cast alone produces Q damage and no W
// damage; W cast alone produces W damage and no Q damage. Provider/ability/op refs
// remain distinct; Q seed contains no copied W rows (asserted in source-shape test).
func TestJhinDancingGrenadePrimaryFirstHitQWIsolationCoexistence(t *testing.T) {
	t.Run("q_only_no_w_synthesis", func(t *testing.T) {
		compileReq, runReq := loadJhinDGFixture(t, jhinDGFixtureOpts{
			baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
			resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
			mana: jhinDGFixtureManaCD,
		})
		assertJhinDGProviderShape(t, compileReq, 1, true)
		for _, p := range compileReq.SharedProviders {
			if p.ProviderKey == jhinDFProviderRef || p.StableID == jhinDFStableID {
				t.Fatal("Q-only must not synthesize W provider")
			}
			for _, a := range p.Abilities {
				if a.AbilityKey == jhinDFAbilityKey {
					t.Fatalf("Q-only must not synthesize W ability key %q", a.AbilityKey)
				}
			}
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: jhinDGAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJhinDG(t, compileReq, runReq)
		if len(jhinDFDamageEvidence(done)) != 0 {
			t.Fatal("Q-only must not produce W damage")
		}
		if len(done.Summary.AbilityStats) != 1 ||
			done.Summary.AbilityStats[0].AbilityRef != jhinDGAbilityRef() {
			t.Fatalf("AbilityStats=%+v want only Q", done.Summary.AbilityStats)
		}
	})

	t.Run("combined_qw_distinct_q_cast_no_w_damage", func(t *testing.T) {
		compileReq, runReq := loadJhinDGFixture(t, jhinDGFixtureOpts{
			baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
			resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
			mana: jhinDGFixtureManaCD, withW: true,
		})
		assertJhinDGProviderShape(t, compileReq, 2, true)
		assertJhinDFProviderShape(t, compileReq, 2, false)

		if jhinDGProviderRef == jhinDFProviderRef ||
			jhinDGStableID == jhinDFStableID ||
			jhinDGAbilityID == jhinDFAbilityID ||
			jhinDGAbilityKey == jhinDFAbilityKey ||
			jhinDGAbilityRef() == jhinDFAbilityRef() ||
			jhinDGDamageOpRef == jhinDFDamageOpRef {
			t.Fatal("Q/W provider/ability/op refs must remain distinct")
		}
		foundQ, foundW := false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == jhinDGProviderRef {
				foundQ = true
			}
			if m.ProviderRef == jhinDFProviderRef {
				foundW = true
			}
		}
		if !foundQ || !foundW {
			t.Fatalf("combined mounts=%+v want Q+W", compileReq.Combatants[0].Providers)
		}

		qRef := jhinDGAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: qRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJhinDG(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(jhinDGDamageEvidence(done)) != 1 {
			t.Fatalf("Q damage=%d want 1", len(jhinDGDamageEvidence(done)))
		}
		jhinDGAssertDamage(t, jhinDGDamageEvidence(done)[0],
			jhinDGExpectedRawDefault, jhinDGExpectedMitDefault)
		if len(jhinDFDamageEvidence(done)) != 0 {
			t.Fatal("Q cast must not produce W damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture Q cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (Q only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == jhinDFAbilityRef() {
				t.Fatalf("Q cast must not produce W AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != qRef {
			t.Fatalf("AbilityStats=%+v want only Q", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == jhinDFAbilityRef() {
				t.Fatalf("Q cast must not produce W abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == jhinDFDamageOpRef {
				t.Fatalf("Q cast must not produce W operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == jhinDFProviderRef {
				t.Fatalf("Q cast must not produce W providerRef evidence: %+v", item)
			}
		}
	})

	t.Run("combined_qw_w_cast_no_q_damage", func(t *testing.T) {
		compileReq, runReq := loadJhinDGFixture(t, jhinDGFixtureOpts{
			baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
			resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
			mana: jhinDGFixtureManaCD, withW: true,
		})
		assertJhinDGProviderShape(t, compileReq, 2, true)
		assertJhinDFProviderShape(t, compileReq, 2, false)

		wRef := jhinDFAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: wRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJhinDG(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(jhinDFDamageEvidence(done)) != 1 {
			t.Fatalf("W damage=%d want 1", len(jhinDFDamageEvidence(done)))
		}
		// W formula: 210 + 0.50*totalAD(100) = 260; armor100 → 130.
		jhinDFAssertDamage(t, jhinDFDamageEvidence(done)[0], 260, 130)
		if len(jhinDGDamageEvidence(done)) != 0 {
			t.Fatal("W cast must not produce Q damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture W cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (W only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == jhinDGAbilityRef() {
				t.Fatalf("W cast must not produce Q AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != wRef {
			t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == jhinDGAbilityRef() {
				t.Fatalf("W cast must not produce Q abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == jhinDGDamageOpRef {
				t.Fatalf("W cast must not produce Q operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == jhinDGProviderRef {
				t.Fatalf("W cast must not produce Q providerRef evidence: %+v", item)
			}
		}
	})
}

// TestJhinDancingGrenadePrimaryFirstHitDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// wrong/missing/released session behavior.
func TestJhinDancingGrenadePrimaryFirstHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadJhinDGFixture(t, jhinDGFixtureOpts{
				baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
				resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
				mana: jhinDGFixtureManaCD,
			})
			ref := jhinDGAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
			}
			r.StopPolicy.DurationMs = 5100
			done := runJhinDG(t, c, r)
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
		c, r := loadJhinDGFixture(t, jhinDGFixtureOpts{
			baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
			resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
			mana: jhinDGFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: jhinDGAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runJhinDGFrames(t, c, r)
		if len(jhinDGDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(jhinDGDamageEvidence(done)))
		}
		jhinDGAssertDamage(t, jhinDGDamageEvidence(done)[0], jhinDGExpectedRawDefault, jhinDGExpectedMitDefault)
		if len(jhinDGAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadJhinDGFixture(t, jhinDGFixtureOpts{
			baseAD: jhinDGADBaseDefault, resolvedAD: jhinDGADResolvedDefault,
			resolvedAP: jhinDGFixtureAPDefault, armor: jhinDGTargetArmorDefault,
			mana: jhinDGFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: jhinDGAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
