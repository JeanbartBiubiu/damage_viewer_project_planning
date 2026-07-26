package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_missfortune R Bullet Time / 弹幕时间 — Phase-A v3 Wasm exact verification slice
// (FROZEN_PLAN_REV: miss-fortune-r-bullet-time-max-channel-expected-phase-a-v3).
//
// Frozen boundary:
//
//	rank3_max_full_channel_selected_primary_champion_expected_total_physical_damage; immediate_aggregated_channel_total_scaffold; eighteen_waves; per_wave_40_plus_0_60_total_ad_plus_0_25_ap; base_wave_crit_multiplier_1_30; expected_factor_one_plus_0_30_times_formula_clamped_crit_chance; mana100_cooldown100000ms; exactly_one_aggregated_damage_quantum; phase_a_excludes_wiki_ie_crit_ratio_30; no_channel_timing_tick_schedule_interruption_cancel_direction_cone_six_projectiles_per_wave_collision_geometry_multitarget_wave_by_wave_snapshot_dynamic_stats_sight_reveal_spellshield_rng_on_crit_basic_attack_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_missfortune|R|弹幕时间
//	task wasm-generic-miss-fortune-bullet-time-max-channel-expected
//	Request Template:Data Miss Fortune/R → resolved Template:Data Miss Fortune/Bullet Time
//	wikiPageId 1308257 / rev 3987215 / timestamp 2026-01-25T03:47:11Z
//	canonical rawByteSize 3021 / SHA256
//	  354cac88f79defa26369f485743f697bf61b50a814b008a8aa6c308b7e394d8a
//	数据参考/lol-wiki-current-champions/normalized/generic/missfortune-r.json
//	  bytes 3550 / SHA256
//	  b275bcc7fb13855cf3fb5a7a8ca0cddce4964ed5713dc521eceb573e69b78c49
//	pages/raw siblings: pages/missfortune-r.json (bytes 743 / SHA256
//	  43bb41feafeaa7a8416bd91b81f51f4be73d3bf30ff78ccb2190fc317f3084d6),
//	  raw/missfortune-r.wikitext
//	Local raw materialization caveat: 3021 bytes / SHA256
//	  19ba845fd99a0da526b34e55c833f9902c0ce9feb55ad486a1d18c12b55a1049.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction (同 size 不等于等价).
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_missfortune_r_bullet_time_max_channel_expected
//     (standalone; not P/Q/W/E/basic synthesis)
//   - ability ability_hero_missfortune_r_bullet_time_max_channel_expected with ability_key
//     bullet_time_max_channel_expected: active; mana 100; cooldown 100000 ms
//   - Exactly one immediate aggregated max-full-channel expected physical damage op:
//     mul(const 18, mul(add(add(const 40, mul(const 0.60, read source.attr.ad.resolved)),
//         mul(const 0.25, read source.attr.ap.resolved)),
//         add(const 1.00, mul(const 0.30, min(const 1.00, max(const 0.00,
//         read source.attr.crit_chance.resolved))))))
//     (every arithmetic/min/max node binary; ad/ap/crit_chance each read exactly once;
//     total AD = ad.resolved — never subtract ad.base / never call it bonus AD;
//     formula-local crit_chance clamp; base130 expected factor 1+0.30*clamp(p);
//     Phase-A explicitly excludes Wiki IE crit ratio 30 — not a claim Wiki omits IE;
//     do not read crit_damage; noncritical / noncopyable; deterministic amount
//     scaling — not random crit pipeline / CritEligible settleExpectedCrit)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No R state/modifier/listener/matcher/repeat/control/event/tickSpec/
//     channel timing / projectile / geometry; no explicit event op —
//     successful cast relies on runtime automatic ability_started.
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//     Always define and populate crit_chance in compile and run snapshots.
//     Fixtures may define/change crit_damage as Phase-A IE-ratio exclusion
//     invariance counterproof only.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   channel timing / tick schedule / interruption / cancel; direction / cone /
//   six projectiles per wave / collision / geometry; multitarget / wave-by-wave
//   snapshot / dynamic stats; sight / reveal / spellshield; RNG-on-crit /
//   basic attack; Wiki IE crit ratio 30; ranks 1–2; P/Q/W/E/basic/loadout/on-hit;
//   identity/panel/resource bootstrap; live/Admin/E2E/full fidelity.
//   One aggregated max-full-channel expected quantum, not full R.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, ap_ratio,
// crit_scaling, immediate_aggregated_channel_total_scaffold
// (explicitly no total_ad_ratio governed tag; total AD remains exact in
// formula/boundary/reason only).
//
// Hero-named `_test.go` is regression/governance evidence only; production runtime
// remains generic (no if hero_missfortune production behavior).

const (
	mfBTCandidateKey    = "hero_skill|hero_missfortune|R|弹幕时间"
	mfBTTaskKey         = "wasm-generic-miss-fortune-bullet-time-max-channel-expected"
	mfBTPlanRev         = "miss-fortune-r-bullet-time-max-channel-expected-phase-a-v3"
	mfBTRequestTitle    = "Template:Data Miss Fortune/R"
	mfBTResolvedTitle   = "Template:Data Miss Fortune/Bullet Time"
	mfBTWikiPageID      = 1308257
	mfBTRevisionID      = 3987215
	mfBTTimestamp       = "2026-01-25T03:47:11Z"
	mfBTRawBytes        = 3021
	mfBTLocalRawBytes   = 3021
	mfBTNormalizedBytes = 3550
	mfBTPagesBytes      = 743
	mfBTContentSHA      = "354cac88f79defa26369f485743f697bf61b50a814b008a8aa6c308b7e394d8a"
	mfBTLocalRawSHA     = "19ba845fd99a0da526b34e55c833f9902c0ce9feb55ad486a1d18c12b55a1049"
	mfBTNormalizedSHA   = "b275bcc7fb13855cf3fb5a7a8ca0cddce4964ed5713dc521eceb573e69b78c49"
	mfBTPagesSHA        = "43bb41feafeaa7a8416bd91b81f51f4be73d3bf30ff78ccb2190fc317f3084d6"
	mfBTBoundary        = "rank3_max_full_channel_selected_primary_champion_expected_total_physical_damage; immediate_aggregated_channel_total_scaffold; eighteen_waves; per_wave_40_plus_0_60_total_ad_plus_0_25_ap; base_wave_crit_multiplier_1_30; expected_factor_one_plus_0_30_times_formula_clamped_crit_chance; mana100_cooldown100000ms; exactly_one_aggregated_damage_quantum; phase_a_excludes_wiki_ie_crit_ratio_30; no_channel_timing_tick_schedule_interruption_cancel_direction_cone_six_projectiles_per_wave_collision_geometry_multitarget_wave_by_wave_snapshot_dynamic_stats_sight_reveal_spellshield_rng_on_crit_basic_attack_other_ranks_or_full_fidelity"

	mfBTProviderRef = "provider_hero_missfortune_r_bullet_time_max_channel_expected"
	mfBTStableID    = "hero_missfortune_r_bullet_time_max_channel_expected"
	mfBTAbilityID   = "ability_hero_missfortune_r_bullet_time_max_channel_expected"
	mfBTAbilityKey  = "bullet_time_max_channel_expected"
	mfBTDamageOpRef = "op:miss_fortune_bullet_time_max_channel_expected_damage"
	mfBTTotalADMod  = "fixture_miss_fortune_bullet_time_max_channel_expected_total_ad"

	mfBTWaveCount  = 18.0
	mfBTBaseDamage = 40.0
	mfBTADRatio    = 0.60
	mfBTAPRatio    = 0.25
	mfBTCritScale  = 0.30
	mfBTManaCost   = 100.0
	mfBTCDMs       = 100000.0

	mfBTADBaseDefault      = 100.0
	mfBTADResolvedDefault  = 100.0
	mfBTFixtureAPDefault   = 0.0
	mfBTFixtureCritDefault = 0.0
	mfBTFixtureManaCD      = 300.0
	mfBTFixtureManaShort   = 99.0
	mfBTTargetArmorDefault = 0.0
	mfBTTargetHP           = 10000.0

	mfBTExpectedRawCrit0     = 1800.0
	mfBTExpectedRawCrit05    = 2070.0
	mfBTExpectedRawCrit1     = 2340.0
	mfBTExpectedMitArmor100  = 1035.0
	mfBTExpectedNoncritAP100 = 2250.0
	mfBTExpectedRawAP100P05  = 2587.5
	mfBTManaAfter2           = 100.0  // 300 - 100 - 100
	mfBTHPAfter2             = 5860.0 // 10000 - 2070 - 2070

	mfBTTol = 1e-9
)

func mfBTOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"ap_ratio",
		"crit_scaling",
		"immediate_aggregated_channel_total_scaffold",
	}
}

func mfBTClamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func mfBTExpectedRawFromStats(resolvedAD, resolvedAP, critChance float64) float64 {
	perWave := mfBTBaseDamage + mfBTADRatio*resolvedAD + mfBTAPRatio*resolvedAP
	return mfBTWaveCount * perWave * (1.0 + mfBTCritScale*mfBTClamp01(critChance))
}

func mfBTDamageAmount() *model.GenericFormulaExpr {
	waves := mfBTWaveCount
	base := mfBTBaseDamage
	adRatio := mfBTADRatio
	apRatio := mfBTAPRatio
	critScale := mfBTCritScale
	one := 1.0
	zero := 0.0
	// Nested binary AST; ad/ap/crit_chance each exactly once; no crit_damage read.
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &waves},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{
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
					},
					{
						Op: "add",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &one},
							{
								Op: "mul",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &critScale},
									{
										Op: "min",
										Args: []model.GenericFormulaExpr{
											{Op: "const", Value: &one},
											{
												Op: "max",
												Args: []model.GenericFormulaExpr{
													{Op: "const", Value: &zero},
													{Op: "read", Path: "source.attr.crit_chance.resolved"},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

func mfBTCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += mfBTCountPathReads(&expr.Args[i], path)
	}
	return n
}

func mfBTAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
	t.Helper()
	if expr == nil {
		return
	}
	switch expr.Op {
	case "add", "sub", "mul", "div", "lt", "lte", "gt", "gte", "min", "max":
		if len(expr.Args) != 2 {
			t.Fatalf("op=%q arity=%d want binary 2", expr.Op, len(expr.Args))
		}
	}
	for i := range expr.Args {
		mfBTAssertBinaryArity(t, &expr.Args[i])
	}
}

func mfBTAbility() model.AbilityDefinition {
	cost := mfBTManaCost
	cd := mfBTCDMs
	return model.AbilityDefinition{
		AbilityKey: mfBTAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one aggregated physical damage quantum; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           mfBTDamageOpRef,
				Amount:        mfBTDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func mfBTProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: mfBTProviderRef,
		Kind:        "champion",
		StableID:    mfBTStableID,
		Abilities:   []model.AbilityDefinition{mfBTAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed R provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: mfBTTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func mfBTAbilityRef() string {
	return "source.provider[" + mfBTProviderRef + "].ability[" + mfBTAbilityKey + "]"
}

type mfBTFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	critChance float64
	critDamage float64
	armor      float64
	mana       float64
	hp         float64
}

func configureMFBTProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts mfBTFixtureOpts) {
	flat := opts.resolvedAD - opts.baseAD
	shared := []model.ProviderDefinition{mfBTProviderDef(flat)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: mfBTProviderRef, DefinitionRef: mfBTProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: mfBTProviderRef, DefinitionRef: mfBTProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
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

func ensureMFBTTypes(req *model.CompileRequest) {
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

func loadMFBTFixture(t *testing.T, opts mfBTFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/critChance/armor explicitly
	// (AD0 / AP0 / crit0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = mfBTFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = mfBTTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureMFBTTypes(&compileReq)
	configureMFBTProviders(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/crit_chance/mana/HP/armor values (external-existing-data/
	// check-only); do not claim seed materializes hero_missfortune / ad / ap /
	// crit_chance / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	// Always define and populate crit_chance in compile and run snapshots.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: opts.critChance, Current: opts.critChance,
		Max: opts.critChance, Resolved: opts.critChance,
	})
	// crit_damage may be defined/changed as Phase-A IE-ratio exclusion counterproof;
	// formula must not read it.
	if opts.critDamage != 0 {
		setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_damage", model.AttributeSlotDef{
			Base: opts.critDamage, Current: opts.critDamage,
			Max: opts.critDamage, Resolved: opts.critDamage,
		})
	}
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, mfBTFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 200000
	return compileReq, runReq
}

func runMFBT(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runMFBTFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func mfBTSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func mfBTSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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
	t.Fatal("source combatant missing")
	return 0
}

func mfBTSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func mfBTDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := mfBTAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != mfBTDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func mfBTAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func mfBTFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == mfBTProviderRef {
			return p
		}
	}
	return nil
}

func mfBTAssertNoForbiddenOneCastEvidence(t *testing.T, done model.DoneResult) {
	t.Helper()
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	for _, item := range done.Evidence.Items {
		switch item.Kind {
		case model.EvidenceKindProviderTick:
			t.Fatalf("must not emit provider_tick: %+v", item)
		case model.EvidenceKindEmittedEvent:
			ref := item.Ref
			if strings.Contains(ref, "on_crit") || strings.Contains(ref, "rng") ||
				strings.Contains(ref, "slow") || strings.Contains(ref, "control") ||
				strings.Contains(ref, "basic_attack") {
				t.Fatalf("forbidden event evidence: %+v", item)
			}
		}
		if item.Kind == model.EvidenceKindDamage {
			mfBTAssertNoExpectedCritFields(t, item)
		}
	}
}

func mfBTAssertNoExpectedCritFields(t *testing.T, item model.EvidenceItem) {
	t.Helper()
	for _, key := range []string{
		"eligible", "forcedCritMultiplier", "naturalCritMultiplier",
		"critChance", "appliedCrit", "critPart", "expectedCrit",
	} {
		if _, ok := item.Data[key]; ok {
			t.Fatalf("must not carry expected-crit / double-settlement field %q: %+v", key, item.Data)
		}
	}
}

func assertMFBTProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	if len(compileReq.Combatants[0].Providers) != 1 ||
		compileReq.Combatants[0].Providers[0].ProviderRef != mfBTProviderRef {
		t.Fatalf("source mounts=%+v want exactly one %s", compileReq.Combatants[0].Providers, mfBTProviderRef)
	}
	p := mfBTFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_missfortune_r_bullet_time_max_channel_expected missing from SharedProviders")
	}
	if p.ProviderKey != mfBTProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, mfBTProviderRef)
	}
	if p.StableID != mfBTStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, mfBTStableID)
	}
	banned := []string{
		"provider_hero_missfortune_p_", "provider_hero_missfortune_q_", "provider_hero_missfortune_w_",
		"provider_hero_missfortune_e_", "provider_hero_missfortune_basic_",
		"ability_hero_missfortune_p_", "ability_hero_missfortune_q_", "ability_hero_missfortune_w_",
		"ability_hero_missfortune_e_", "ability_hero_missfortune_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("bullet-time max-channel must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no channel / wave / tick state)", len(p.InitialStateSchema))
	}
	if expectTotalADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only total-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != mfBTTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], mfBTTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production R has no modifiers when flat=0)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), mfBTAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != mfBTAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, mfBTAbilityKey, mfBTAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("R Types=%v want empty (no ability-specific game-local R type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("bullet_time_max_channel_expected must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("R must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("R must not carry tickSpec")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("R must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-mfBTManaCost) > mfBTTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-mfBTCDMs) > mfBTTol {
		t.Fatalf("cooldown=%+v want const 100000 (immediate aggregate scaffold)", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one aggregated expected physical quantum)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("bullet time damage must not be crit-eligible (Phase-A formula-local expected scaling only)")
	}
	if op.CopyableOnHit {
		t.Fatal("bullet time damage must not be copyable on hit")
	}
	if op.Ref != mfBTDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, mfBTDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "mul" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want mul(const18, mul(wave, critFactor))", op.Amount)
	}
	mfBTAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-mfBTWaveCount) > mfBTTol {
		t.Fatalf("wave const=%+v want 18", op.Amount.Args[0])
	}
	innerMul := op.Amount.Args[1]
	if innerMul.Op != "mul" || len(innerMul.Args) != 2 {
		t.Fatalf("inner mul=%+v want mul(waveSum, critFactor)", innerMul)
	}
	sum := innerMul.Args[0]
	if sum.Op != "add" || len(sum.Args) != 2 {
		t.Fatalf("wave sum=%+v want add(add(base,AD),AP)", sum)
	}
	inner := sum.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("base+AD=%+v want add(const40, mul(0.60, ad.resolved))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-mfBTBaseDamage) > mfBTTol {
		t.Fatalf("base const=%+v want 40", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD mul=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-mfBTADRatio) > mfBTTol {
		t.Fatalf("AD ratio=%+v want 0.60", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	apMul := sum.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-mfBTAPRatio) > mfBTTol {
		t.Fatalf("AP ratio=%+v want 0.25", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	critScale := innerMul.Args[1]
	if critScale.Op != "add" || len(critScale.Args) != 2 {
		t.Fatalf("crit scale=%+v want add(1.00, mul(0.30, min(1,max(0,crit))))", critScale)
	}
	if critScale.Args[0].Op != "const" || critScale.Args[0].Value == nil ||
		math.Abs(*critScale.Args[0].Value-1.0) > mfBTTol {
		t.Fatalf("crit one const=%+v want 1.00", critScale.Args[0])
	}
	critMul := critScale.Args[1]
	if critMul.Op != "mul" || len(critMul.Args) != 2 {
		t.Fatalf("crit mul=%+v want mul(0.30, min(...))", critMul)
	}
	if critMul.Args[0].Op != "const" || critMul.Args[0].Value == nil ||
		math.Abs(*critMul.Args[0].Value-mfBTCritScale) > mfBTTol {
		t.Fatalf("crit scale ratio=%+v want 0.30", critMul.Args[0])
	}
	minNode := critMul.Args[1]
	if minNode.Op != "min" || len(minNode.Args) != 2 {
		t.Fatalf("crit min=%+v want min(1.00, max(...))", minNode)
	}
	if minNode.Args[0].Op != "const" || minNode.Args[0].Value == nil ||
		math.Abs(*minNode.Args[0].Value-1.0) > mfBTTol {
		t.Fatalf("crit min const=%+v want 1.00", minNode.Args[0])
	}
	maxNode := minNode.Args[1]
	if maxNode.Op != "max" || len(maxNode.Args) != 2 {
		t.Fatalf("crit max=%+v want max(0.00, read crit_chance)", maxNode)
	}
	if maxNode.Args[0].Op != "const" || maxNode.Args[0].Value == nil ||
		math.Abs(*maxNode.Args[0].Value-0.0) > mfBTTol {
		t.Fatalf("crit max const=%+v want 0.00", maxNode.Args[0])
	}
	if maxNode.Args[1].Op != "read" || maxNode.Args[1].Path != "source.attr.crit_chance.resolved" {
		t.Fatalf("crit read=%+v want source.attr.crit_chance.resolved", maxNode.Args[1])
	}
	if mfBTCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", mfBTCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if mfBTCountPathReads(op.Amount, "source.attr.ad.base") != 0 {
		t.Fatal("total-AD formula must not read/subtract source.attr.ad.base")
	}
	if mfBTCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", mfBTCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if mfBTCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 1 {
		t.Fatalf("crit_chance reads=%d want exactly 1", mfBTCountPathReads(op.Amount, "source.attr.crit_chance.resolved"))
	}
	if mfBTCountPathReads(op.Amount, "source.attr.crit_damage.resolved") != 0 {
		t.Fatal("formula must not read crit_damage (Phase-A IE-ratio exclusion; not Wiki IE absence)")
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
			bannedOp.DamageType == "damage/magic" {
			t.Fatalf("bullet time must not include excluded op: %+v", bannedOp)
		}
	}
}

func findMFBTAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := mfBTAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func mfBTRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func mfBTSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func mfBTAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > mfBTTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > mfBTTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != mfBTDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), mfBTDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != mfBTAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), mfBTAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != mfBTProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), mfBTProviderRef)
	}
	if evidenceDataBool(item.Data, "phantom") {
		t.Fatal("damage must not be phantom")
	}
	if evidenceDataString(item.Data, "phase") != "original" {
		t.Fatalf("phase=%q want original", evidenceDataString(item.Data, "phase"))
	}
	mfBTAssertNoExpectedCritFields(t, item)
	if evidenceDataBool(item.Data, "copyableOnHit") || evidenceDataBool(item.Data, "copyable") {
		t.Fatalf("damage must not be copyable: %+v", item.Data)
	}
}

// TestMissFortuneBulletTimeMaxChannelExpectedWikiIdentityAndCompileShape locks wiki/
// sidecar/pages/local-raw caveat, frozen boundary/ordered tags, and R provider/
// nested totalAD+AP+base130 expected formula shape (no Backend seed hash dependency).
func TestMissFortuneBulletTimeMaxChannelExpectedWikiIdentityAndCompileShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Description2         string
			Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(mfBTRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "missfortune-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != mfBTNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), mfBTNormalizedBytes)
	}
	if got := mfBTSHA256Hex(sidecarRaw); got != mfBTNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, mfBTNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != mfBTCandidateKey || doc.RequestTitle != mfBTRequestTitle ||
		doc.ResolvedTitle != mfBTResolvedTitle || doc.WikiPageID != mfBTWikiPageID ||
		doc.RevisionID != mfBTRevisionID || doc.RevisionTimestamp != mfBTTimestamp ||
		doc.ContentSHA256 != mfBTContentSHA || doc.RawByteSize != mfBTRawBytes ||
		doc.SkillKey != "R" || doc.ZhDisplayName != "弹幕时间" || doc.OwnerID != "hero_missfortune" {
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
	if doc.Fields.Cost != "100\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|120 to 100}}\n" {
		t.Fatalf("cooldown=%q want {{ap|120 to 100}} (rank-3 = 100s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|20 to 40}}") ||
		!strings.Contains(doc.Fields.Leveling, "60% AD") ||
		!strings.Contains(doc.Fields.Leveling, "25% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Total Waves") ||
		!strings.Contains(doc.Fields.Leveling, "{{ap|14 to 18}}") ||
		!strings.Contains(doc.Fields.Leveling, "Maximum Total Physical Damage") {
		t.Fatalf("leveling=%q want rank3 wave 40 +60%% AD +25%% AP / 18 waves / max-total noncrit", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "channel") {
		t.Fatal("wiki prose must retain physical damage / channel wording")
	}
	if !strings.Contains(doc.Fields.Description2, "{{critical damage|130|30}}") &&
		!strings.Contains(doc.Fields.Description2, "critical damage|130|30") {
		t.Fatal("wiki description2 must retain {{critical damage|130|30}} (base130 + IE ratio)")
	}
	if !strings.Contains(doc.Fields.Notes, "Spell shield") && !strings.Contains(doc.Fields.Notes, "spellshield") &&
		!strings.Contains(doc.Fields.Notes, "sight") && !strings.Contains(doc.Fields.Notes, "reveals") {
		t.Fatalf("notes missing excluded sight/reveal/spellshield surfaces: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(mfBTRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "missfortune-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != mfBTPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), mfBTPagesBytes)
	}
	if got := mfBTSHA256Hex(pagesRaw); got != mfBTPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, mfBTPagesSHA)
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
		pages.SkillKey != "R" || pages.ZhDisplayName != "弹幕时间" || pages.OwnerID != "hero_missfortune" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(mfBTRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "missfortune-r.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != mfBTLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), mfBTLocalRawBytes)
	}
	localSHA := mfBTSHA256Hex(rawBytes)
	if localSHA != mfBTLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, mfBTLocalRawSHA)
	}
	if localSHA == mfBTContentSHA {
		t.Fatal("local raw hash must differ from canonical (same-size materialization caveat; not equivalence/contradiction)")
	}
	if mfBTLocalRawBytes != mfBTRawBytes {
		t.Fatal("Miss Fortune R local raw and canonical sizes differ; constants drifted")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|20 to 40}}",
		"60% AD",
		"25% AP",
		"{{ap|14 to 18}}",
		"Maximum Total Physical Damage",
		"|cost         = 100",
		"|cooldown     = {{ap|120 to 100}}",
		"|damagetype   = Physical",
		"{{critical damage|130|30}}",
		"channel",
		"physical damage",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if mfBTPlanRev != "miss-fortune-r-bullet-time-max-channel-expected-phase-a-v3" || mfBTBoundary !=
		"rank3_max_full_channel_selected_primary_champion_expected_total_physical_damage; immediate_aggregated_channel_total_scaffold; eighteen_waves; per_wave_40_plus_0_60_total_ad_plus_0_25_ap; base_wave_crit_multiplier_1_30; expected_factor_one_plus_0_30_times_formula_clamped_crit_chance; mana100_cooldown100000ms; exactly_one_aggregated_damage_quantum; phase_a_excludes_wiki_ie_crit_ratio_30; no_channel_timing_tick_schedule_interruption_cancel_direction_cone_six_projectiles_per_wave_collision_geometry_multitarget_wave_by_wave_snapshot_dynamic_stats_sight_reveal_spellshield_rng_on_crit_basic_attack_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}
	if mfBTTaskKey != "wasm-generic-miss-fortune-bullet-time-max-channel-expected" {
		t.Fatal("task key drifted")
	}
	tags := mfBTOrderedTags()
	wantTags := []string{
		"ability_cost_cooldown", "active_physical_damage", "ap_ratio", "crit_scaling",
		"immediate_aggregated_channel_total_scaffold",
	}
	if len(tags) != len(wantTags) {
		t.Fatalf("ordered tags=%v want %v", tags, wantTags)
	}
	for i := range wantTags {
		if tags[i] != wantTags[i] {
			t.Fatalf("ordered tags[%d]=%q want %q", i, tags[i], wantTags[i])
		}
	}
	for _, banned := range tags {
		if banned == "total_ad_ratio" {
			t.Fatal("governed tags must not include total_ad_ratio")
		}
	}

	compileReq, _ := loadMFBTFixture(t, mfBTFixtureOpts{
		baseAD: mfBTADBaseDefault, resolvedAD: mfBTADResolvedDefault,
		resolvedAP: mfBTFixtureAPDefault, critChance: mfBTFixtureCritDefault,
		armor: mfBTTargetArmorDefault, mana: mfBTFixtureManaCD,
	})
	assertMFBTProviderShape(t, compileReq, 1, false)
	rawX := mfBTExpectedRawFromStats(mfBTADResolvedDefault, mfBTFixtureAPDefault, mfBTFixtureCritDefault)
	if math.Abs(rawX-mfBTExpectedRawCrit0) > mfBTTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, mfBTExpectedRawCrit0)
	}
	noncritAP100 := mfBTWaveCount * (mfBTBaseDamage + mfBTADRatio*mfBTADResolvedDefault + mfBTAPRatio*100)
	if math.Abs(noncritAP100-mfBTExpectedNoncritAP100) > mfBTTol {
		t.Fatalf("AP100 noncrit=%v want %v", noncritAP100, mfBTExpectedNoncritAP100)
	}
}

// TestMissFortuneBulletTimeMaxChannelExpectedFormulaMitigationTable: compact AD/AP/
// armor/crit raw/final table; one isolated successful R cast per row with one-cast evidence.
func TestMissFortuneBulletTimeMaxChannelExpectedFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name       string
		resolvedAP float64
		critChance float64
		armor      float64
		wantRaw    float64
		wantMit    float64
	}{
		{"AD100_AP0_armor0_p0", 0, 0, 0, mfBTExpectedRawCrit0, mfBTExpectedRawCrit0},
		{"AD100_AP0_armor0_p0.5", 0, 0.5, 0, mfBTExpectedRawCrit05, mfBTExpectedRawCrit05},
		{"AD100_AP0_armor0_p1", 0, 1.0, 0, mfBTExpectedRawCrit1, mfBTExpectedRawCrit1},
		{"AD100_AP0_armor100_p0.5", 0, 0.5, 100, mfBTExpectedRawCrit05, mfBTExpectedMitArmor100},
		{"AD100_AP100_armor0_p0.5", 100, 0.5, 0, mfBTExpectedRawAP100P05, mfBTExpectedRawAP100P05},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := mfBTExpectedRawFromStats(mfBTADResolvedDefault, tc.resolvedAP, tc.critChance)
			if math.Abs(rawX-tc.wantRaw) > mfBTTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMit) > mfBTTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMit)
			}
			if tc.resolvedAP == 100 && tc.critChance == 0.5 {
				noncrit := mfBTWaveCount * (mfBTBaseDamage + mfBTADRatio*mfBTADResolvedDefault + mfBTAPRatio*100)
				if math.Abs(noncrit-mfBTExpectedNoncritAP100) > mfBTTol {
					t.Fatalf("AP100 noncrit=%v want %v", noncrit, mfBTExpectedNoncritAP100)
				}
			}
			compileReq, runReq := loadMFBTFixture(t, mfBTFixtureOpts{
				baseAD: mfBTADBaseDefault, resolvedAD: mfBTADResolvedDefault,
				resolvedAP: tc.resolvedAP, critChance: tc.critChance,
				armor: tc.armor, mana: mfBTFixtureManaCD, hp: mfBTTargetHP,
			})
			assertMFBTProviderShape(t, compileReq, 1, false)
			ref := mfBTAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runMFBT(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := mfBTDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage evidence=%d want 1", len(dmg))
			}
			mfBTAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMit)
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(mfBTAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(mfBTAbilityStartedEvidence(done)))
			}
			mfBTAssertNoForbiddenOneCastEvidence(t, done)
			p := mfBTFindProvider(compileReq)
			if p == nil || p.Abilities[0].Operations[0].CritEligible {
				t.Fatal("operation CritEligible must stay false")
			}
		})
	}
}

// TestMissFortuneBulletTimeMaxChannelExpectedCritChanceClamp: formula-local clamp.
func TestMissFortuneBulletTimeMaxChannelExpectedCritChanceClamp(t *testing.T) {
	cases := []struct {
		name       string
		critChance float64
		wantRaw    float64
	}{
		{"p_neg0.5_clamps0", -0.5, mfBTExpectedRawCrit0},
		{"p_1.5_clamps1", 1.5, mfBTExpectedRawCrit1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadMFBTFixture(t, mfBTFixtureOpts{
				baseAD: mfBTADBaseDefault, resolvedAD: mfBTADResolvedDefault,
				resolvedAP: 0, critChance: tc.critChance,
				armor: 0, mana: mfBTFixtureManaCD, hp: mfBTTargetHP,
			})
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: mfBTAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runMFBT(t, compileReq, runReq)
			dmg := mfBTDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage=%d want 1", len(dmg))
			}
			mfBTAssertDamage(t, dmg[0], tc.wantRaw, tc.wantRaw)
			mfBTAssertNoForbiddenOneCastEvidence(t, done)
		})
	}
}

// TestMissFortuneBulletTimeMaxChannelExpectedCritDamageInvariancePhaseAIEExclusion:
// global crit_damage 1.3/2.0/2.3 must not change raw; CritEligible stays false; no
// expected-crit evidence / double settlement. This is Phase-A IE-ratio exclusion —
// not a claim that Wiki omits Infinity Edge.
func TestMissFortuneBulletTimeMaxChannelExpectedCritDamageInvariancePhaseAIEExclusion(t *testing.T) {
	for _, critDamage := range []float64{1.3, 2.0, 2.3} {
		t.Run(fmt.Sprintf("crit_damage_%.1f", critDamage), func(t *testing.T) {
			compileReq, runReq := loadMFBTFixture(t, mfBTFixtureOpts{
				baseAD: mfBTADBaseDefault, resolvedAD: mfBTADResolvedDefault,
				resolvedAP: 0, critChance: 0.5, critDamage: critDamage,
				armor: 0, mana: mfBTFixtureManaCD, hp: mfBTTargetHP,
			})
			assertMFBTProviderShape(t, compileReq, 1, false)
			p := mfBTFindProvider(compileReq)
			if p.Abilities[0].Operations[0].CritEligible {
				t.Fatal("CritEligible must stay false under crit_damage counterproof")
			}
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: mfBTAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runMFBT(t, compileReq, runReq)
			dmg := mfBTDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage=%d want 1", len(dmg))
			}
			mfBTAssertDamage(t, dmg[0], mfBTExpectedRawCrit05, mfBTExpectedRawCrit05)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "crit_damage")-critDamage) > mfBTTol {
				t.Fatalf("crit_damage.resolved=%v want %v (counterproof attr must stick)",
					sourceAttrResolved(t, done.FinalSnapshot, "crit_damage"), critDamage)
			}
			mfBTAssertNoForbiddenOneCastEvidence(t, done)
		})
	}
}

// TestMissFortuneBulletTimeMaxChannelExpectedTotalADIndependence: base0/resolved100 and
// base60/resolved100 at AP0/crit0/armor0 both raw/final 1800 (total AD, not bonus AD).
func TestMissFortuneBulletTimeMaxChannelExpectedTotalADIndependence(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"base0_resolved100", 0, 100},
		{"base60_resolved100", 60, 100},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadMFBTFixture(t, mfBTFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: 0, critChance: 0,
				armor: 0, mana: mfBTFixtureManaCD, hp: mfBTTargetHP,
			})
			assertMFBTProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: mfBTAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runMFBT(t, compileReq, runReq)
			dmg := mfBTDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage=%d want 1", len(dmg))
			}
			mfBTAssertDamage(t, dmg[0], mfBTExpectedRawCrit0, mfBTExpectedRawCrit0)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > mfBTTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(mfBTSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > mfBTTol {
				t.Fatalf("ad.base=%v want %v", mfBTSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
}

// TestMissFortuneBulletTimeMaxChannelExpectedCooldownMana300AbilityStarted: mana300/
// AD100/AP0/crit0.5/HP10000/armor0 at t0/t99999/t100000 →
// success/cooldown skip/success; two damages; two ability_started; mana100/HP5860.
func TestMissFortuneBulletTimeMaxChannelExpectedCooldownMana300AbilityStarted(t *testing.T) {
	compileReq, runReq := loadMFBTFixture(t, mfBTFixtureOpts{
		baseAD: mfBTADBaseDefault, resolvedAD: mfBTADResolvedDefault,
		resolvedAP: 0, critChance: 0.5,
		armor: 0, mana: mfBTFixtureManaCD, hp: mfBTTargetHP,
	})
	assertMFBTProviderShape(t, compileReq, 1, false)
	ref := mfBTAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 99999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100000},
	}
	runReq.StopPolicy.DurationMs = 100100
	done := runMFBT(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if mfBTSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findMFBTAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt99999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 99999 {
			t.Fatalf("cooldown skip TimeMs=%d want 99999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 100000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 100000", item.Data["readyAtMs"])
		}
		skipAt99999 = true
	}
	if !skipAt99999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=99999 with readyAtMs=100000")
	}

	items := mfBTDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("R damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 100000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		mfBTAssertDamage(t, item, mfBTExpectedRawCrit05, mfBTExpectedRawCrit05)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * mfBTExpectedRawCrit05
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-mfBTHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, mfBTHPAfter2)
	}
	gotMana := mfBTSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-mfBTManaAfter2) > mfBTTol {
		t.Fatalf("mana=%v want %v", gotMana, mfBTManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}
	started := mfBTAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2", len(started))
	}
	wantStarted := []int64{0, 100000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	mfBTAssertNoForbiddenOneCastEvidence(t, done)
}

// TestMissFortuneBulletTimeMaxChannelExpectedResourceInsufficientMana99: mana99 at t0 →
// resource_insufficient; mana/HP unchanged; zero R damage/start evidence.
func TestMissFortuneBulletTimeMaxChannelExpectedResourceInsufficientMana99(t *testing.T) {
	compileReq, runReq := loadMFBTFixture(t, mfBTFixtureOpts{
		baseAD: mfBTADBaseDefault, resolvedAD: mfBTADResolvedDefault,
		resolvedAP: 0, critChance: 0.5,
		armor: 0, mana: mfBTFixtureManaShort, hp: mfBTTargetHP,
	})
	ref := mfBTAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runMFBT(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if mfBTSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(mfBTSourceMana(t, done.FinalSnapshot)-mfBTFixtureManaShort) > mfBTTol {
		t.Fatalf("mana changed: got %v want %v",
			mfBTSourceMana(t, done.FinalSnapshot), mfBTFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-mfBTTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, mfBTTargetHP)
	}
	if len(mfBTDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero R damage evidence")
	}
	if len(mfBTAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestMissFortuneBulletTimeMaxChannelExpectedDeterminismAndLifecycle: repeated
// compile/run stability plus CompileFrame→RunFrame→ReleaseSessionFrame.
func TestMissFortuneBulletTimeMaxChannelExpectedDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadMFBTFixture(t, mfBTFixtureOpts{
				baseAD: mfBTADBaseDefault, resolvedAD: mfBTADResolvedDefault,
				resolvedAP: 0, critChance: 0.5,
				armor: 0, mana: mfBTFixtureManaCD, hp: mfBTTargetHP,
			})
			ref := mfBTAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 99999},
				{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100000},
			}
			r.StopPolicy.DurationMs = 100100
			done := runMFBT(t, c, r)
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
		c, r := loadMFBTFixture(t, mfBTFixtureOpts{
			baseAD: mfBTADBaseDefault, resolvedAD: mfBTADResolvedDefault,
			resolvedAP: 0, critChance: mfBTFixtureCritDefault,
			armor: 0, mana: mfBTFixtureManaCD, hp: mfBTTargetHP,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: mfBTAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runMFBTFrames(t, c, r)
		if len(mfBTDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path R damage=%d want 1", len(mfBTDamageEvidence(done)))
		}
		mfBTAssertDamage(t, mfBTDamageEvidence(done)[0], mfBTExpectedRawCrit0, mfBTExpectedRawCrit0)
		if len(mfBTAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})
}
