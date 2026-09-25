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

// hero_jinx E Flame Chompers! / 嚼火者手雷！ — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: jinx-e-flame-chompers-primary-explosion-hit-phase-a-v1).
//
// Governance identity: this hero-named _test.go is test/governance only. It is
// excluded from production Wasm builds and does not imply a hero-specific
// production branch, switch, registry, public ABI, or runtime implementation.
//
// Frozen boundary:
//
//	rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold;
//	magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_jinx|E|嚼火者手雷！
//	task wasm-generic-jinx-flame-chompers-primary-explosion-hit
//	Request Template:Data Jinx/E → resolved Template:Data Jinx/Flame Chompers!
//	wikiPageId 1307600 / rev 3993368 / timestamp 2026-02-21T15:35:19Z
//	canonical rawByteSize 1786 / SHA256
//	  64562ed4adb34c932810970fd9b9c016b46329d6f956541d334c60d2bc9d83ee
//	数据参考/lol-wiki-current-champions/normalized/generic/jinx-e.json
//	  bytes2228 / SHA256 de7922f66deb96c8652dd1a0509105b49cdcf22278d1fd591bc366060987183a
//	pages/raw siblings: pages/jinx-e.json (bytes694 /
//	  SHA256 f2822e5708dd024c582575a9298c12b6e6cd66b37e3365ea8749e8e1d49b360d),
//	  raw/jinx-e.wikitext
//	已删除历史种子： db/game_manage/seeds/lol_generic_jinx_flame_chompers_primary_explosion_hit_seed.sql
//	  bytes27322 / SHA256 686ff89b4f29b1697e478d2f1b676d80a9bd3288e460bea4f57e0a3b7583ee6f
//	Backend JUnit: LolGenericJinxFlameChompersPrimaryExplosionHitSeedSqlTest.java
//	  bytes46529 / SHA256 519c3e5ce2844d41bdc348441056352fb893633ca084bb261f63bffd0300d35a
//	Local raw materialization caveat: 1784 bytes / SHA256
//	  aabb099fd172522682e40f0826e4971797c3a047787ef3c5af902bc4b673a551.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//	README entry semantics only — do not lock aggregate README bytes/SHA as a
//	continuing test invariant (historical integration identity
//	bc71abfed04e04299a78bc8f17ae17ad619e779cb014d65bf8ed3912eb86b7be).
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_jinx_e_flame_chompers_primary_explosion_hit
//     (standalone; not P/Q/W/R/basic synthesis; does not depend on / mutate Jinx W)
//   - ability ability_hero_jinx_e_flame_chompers_primary_explosion_hit with ability_key
//     flame_chompers_primary_explosion_hit: active; mana 90; cooldown 10000 ms
//   - Exactly one immediate direct-target magic damage op:
//     add(const 290, mul(const 1.00, read source.attr.ap.resolved))
//     (AP is direct resolved read exactly once; binary add only)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: magic 20221 + add policy 20170; 20230 forbidden
//   - No Jinx E state/modifier/listener/repeat/control/projectile/vision;
//     no explicit event op — successful cast relies on runtime automatic
//     ability_started. Fixture may supply entity/attribute/resource values
//     (external-existing-data/check-only) but must not claim the seed
//     materializes them. Changing unrelated AD must not alter E damage.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   three-Chomper layout/count/identity; location/direction/range/geometry/
//   radius/area/multitarget; landing/arming/lifetime delays; contact/collision/
//   acquisition/one-per-champion; knockdown/root/CC; Wind Wall/Braum/
//   spell-shield exception/vision; ranks 1–4; P/Q/W/R/basic/loadout/bootstrap;
//   live/E2E/full E/full-game fidelity. Exactly one selected-primary champion
//   magic explosion-hit quantum, not one total in-game E hit.
//
// Ordered tags: ability_cost_cooldown, active_magic_damage, ap_ratio,
// immediate_impact_scaffold.

const (
	jinxFCCandidateKey    = "hero_skill|hero_jinx|E|嚼火者手雷！"
	jinxFCTaskKey         = "wasm-generic-jinx-flame-chompers-primary-explosion-hit"
	jinxFCPlanRev         = "jinx-e-flame-chompers-primary-explosion-hit-phase-a-v1"
	jinxFCRequestTitle    = "Template:Data Jinx/E"
	jinxFCResolvedTitle   = "Template:Data Jinx/Flame Chompers!"
	jinxFCWikiPageID      = 1307600
	jinxFCRevisionID      = 3993368
	jinxFCTimestamp       = "2026-02-21T15:35:19Z"
	jinxFCRawBytes        = 1786
	jinxFCLocalRawBytes   = 1784
	jinxFCNormalizedBytes = 2228
	jinxFCPagesBytes      = 694
	jinxFCContentSHA      = "64562ed4adb34c932810970fd9b9c016b46329d6f956541d334c60d2bc9d83ee"
	jinxFCLocalRawSHA     = "aabb099fd172522682e40f0826e4971797c3a047787ef3c5af902bc4b673a551"
	jinxFCNormalizedSHA   = "de7922f66deb96c8652dd1a0509105b49cdcf22278d1fd591bc366060987183a"
	jinxFCPagesSHA        = "f2822e5708dd024c582575a9298c12b6e6cd66b37e3365ea8749e8e1d49b360d"
	jinxFCBoundary        = "rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; " +
		"magic_290_plus_1_00_ap; " +
		"no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_" +
		"location_direction_range_geometry_area_multitarget_contact_acquisition_" +
		"knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_" +
		"exception_vision_other_ranks_or_full_fidelity"

	jinxFCProviderRef = "provider_hero_jinx_e_flame_chompers_primary_explosion_hit"
	jinxFCStableID    = "hero_jinx_e_flame_chompers_primary_explosion_hit"
	jinxFCAbilityID   = "ability_hero_jinx_e_flame_chompers_primary_explosion_hit"
	jinxFCAbilityKey  = "flame_chompers_primary_explosion_hit"
	jinxFCDamageOpRef = "op:jinx_flame_chompers_primary_explosion_hit_damage"

	jinxFCBaseDamage = 290.0
	jinxFCAPRatio    = 1.00
	jinxFCManaCost   = 90.0
	jinxFCCDMs       = 10000.0

	jinxFCFixtureAPDefault = 100.0
	jinxFCFixtureManaCD    = 270.0
	jinxFCFixtureManaShort = 89.0
	jinxFCTargetMR         = 100.0
	jinxFCTargetHP         = 1000.0
	jinxFCFixtureADProbe   = 200.0 // unrelated AD must not alter E damage

	jinxFCExpectedRawAP0     = 290.0 // 290 + 1.00*0
	jinxFCExpectedMitAP0     = 145.0 // MR100
	jinxFCExpectedRawDefault = 390.0 // 290 + 1.00*100
	jinxFCExpectedMitDefault = 195.0 // MR100
	jinxFCManaAfter2         = 90.0  // 270 - 90 - 90
	jinxFCHPAfter2           = 610.0 // 1000 - 195 - 195

	jinxFCTol = 1e-9
)

func jinxFCOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func jinxFCExpectedRawFromAP(resolvedAP float64) float64 {
	return jinxFCBaseDamage + jinxFCAPRatio*resolvedAP
}

func jinxFCDamageAmount() *model.GenericFormulaExpr {
	base := jinxFCBaseDamage
	apRatio := jinxFCAPRatio
	// Binary add only: const 290 + mul(1.00, source.attr.ap.resolved).
	// AP is read exactly once.
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
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

func jinxFCCountAPReads(expr *model.GenericFormulaExpr) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == "source.attr.ap.resolved" {
		n++
	}
	for i := range expr.Args {
		n += jinxFCCountAPReads(&expr.Args[i])
	}
	return n
}

func jinxFCAbility() model.AbilityDefinition {
	cost := jinxFCManaCost
	cd := jinxFCCDMs
	return model.AbilityDefinition{
		AbilityKey: jinxFCAbilityKey,
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
				Ref:           jinxFCDamageOpRef,
				Amount:        jinxFCDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func jinxFCProviderDef() model.ProviderDefinition {
	// Production/seed E provider has zero modifiers/listeners/state.
	return model.ProviderDefinition{
		ProviderKey: jinxFCProviderRef,
		Kind:        "champion",
		StableID:    jinxFCStableID,
		Abilities:   []model.AbilityDefinition{jinxFCAbility()},
	}
}

func jinxFCAbilityRef() string {
	return "source.provider[" + jinxFCProviderRef + "].ability[" + jinxFCAbilityKey + "]"
}

type jinxFCFixtureOpts struct {
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
	resolvedAD float64 // unrelated AD probe; zero means leave fixture default/unset
	withW      bool
}

func configureJinxFCProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, withW bool) {
	providers := []model.ProviderDefinition{jinxFCProviderDef()}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: jinxFCProviderRef, DefinitionRef: jinxFCProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: jinxFCProviderRef, DefinitionRef: jinxFCProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if withW {
		// Same-package W helpers (read-only use); do not modify W test file.
		flat := jinxZapADResolvedDefault - jinxZapADBase
		providers = append(providers, jinxZapProviderDef(flat))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: jinxZapProviderRef, DefinitionRef: jinxZapProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: jinxZapProviderRef, DefinitionRef: jinxZapProviderRef,
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

func ensureJinxFCTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
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

func loadJinxFCFixture(t *testing.T, opts jinxFCFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAP/mr explicitly (AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = jinxFCFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = jinxFCTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureJinxFCTypes(&compileReq)
	configureJinxFCProvider(&compileReq, &runReq, opts.withW)

	// Fixture-only AP/mana/HP/MR values (external-existing-data/check-only); do not
	// claim seed materializes hero_jinx / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, jinxFCFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
	})
	// Always set AD so AD0 isolation probes are explicit. With W mounted, match
	// loadJinxZapFixture: ad.base stays jinxZapADBase while fixture-only flat
	// modifier raises ad.resolved to jinxZapADResolvedDefault.
	adBase := opts.resolvedAD
	if opts.withW {
		adBase = jinxZapADBase
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: adBase, Current: adBase, Max: adBase, Resolved: adBase,
	})
	if opts.withW {
		setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
			Base: jinxZapTargetArmor, Current: jinxZapTargetArmor,
			Max: jinxZapTargetArmor, Resolved: jinxZapTargetArmor,
		})
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runJinxFC(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runJinxFCFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func jinxFCSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func jinxFCSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func jinxFCDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := jinxFCAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != jinxFCDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func jinxFCAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only E mounted, filter by
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

func jinxFCFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == jinxFCProviderRef {
			return p
		}
	}
	return nil
}

func assertJinxFCProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := jinxFCFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_jinx_e_flame_chompers_primary_explosion_hit missing from SharedProviders")
	}
	if p.ProviderKey != jinxFCProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, jinxFCProviderRef)
	}
	if p.StableID != jinxFCStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, jinxFCStableID)
	}
	banned := []string{
		"provider_hero_jinx_p_", "provider_hero_jinx_q_", "provider_hero_jinx_w_",
		"provider_hero_jinx_r_", "provider_hero_jinx_basic_",
		"ability_hero_jinx_p_", "ability_hero_jinx_q_", "ability_hero_jinx_w_",
		"ability_hero_jinx_r_", "ability_hero_jinx_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("flame_chompers primary-explosion-hit must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), jinxFCAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != jinxFCAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, jinxFCAbilityKey, jinxFCAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("flame_chompers_primary_explosion_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-jinxFCManaCost) > jinxFCTol {
		t.Fatalf("cost=%+v want mana const 90", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-jinxFCCDMs) > jinxFCTol {
		t.Fatalf("cooldown=%+v want const 10000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("flame chompers damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("flame chompers damage must not be copyable on hit")
	}
	if op.Ref != jinxFCDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, jinxFCDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 290, mul(1.00, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-jinxFCBaseDamage) > jinxFCTol {
		t.Fatalf("base const=%+v want 290", op.Amount.Args[0])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-jinxFCAPRatio) > jinxFCTol {
		t.Fatalf("AP ratio=%+v want 1.00", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if jinxFCCountAPReads(op.Amount) != 1 {
		t.Fatalf("AP reads=%d want exactly 1", jinxFCCountAPReads(op.Amount))
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "knockdown" || bannedOp.Operation == "projectile" ||
			bannedOp.Operation == "multi_target" || bannedOp.Operation == "state_change" ||
			bannedOp.Operation == "repeat" || bannedOp.Operation == "control" ||
			bannedOp.Operation == "reveal" || bannedOp.Operation == "sight" ||
			bannedOp.Operation == "vision" || bannedOp.Operation == "cast_delay" {
			t.Fatalf("flame chompers must not include excluded op: %+v", bannedOp)
		}
	}
}

func findJinxFCAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := jinxFCAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func jinxFCRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func jinxFCSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func jinxFCSHA256HexUpper(b []byte) string {
	return strings.ToUpper(jinxFCSHA256Hex(b))
}

func jinxFCAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > jinxFCTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > jinxFCTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != jinxFCDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), jinxFCDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != jinxFCAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), jinxFCAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != jinxFCProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), jinxFCProviderRef)
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

// TestJinxFlameChompersPrimaryExplosionHitWikiSourceAndConstructedFixtureFormulaShape 核对历史 Wiki 来源与当前通用运行构造样例的数值、身份和边界；不代表现行管理数据。
func TestJinxFlameChompersPrimaryExplosionHitWikiSourceAndConstructedFixtureFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Description2, Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(jinxFCRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "jinx-e.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != jinxFCNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), jinxFCNormalizedBytes)
	}
	if got := jinxFCSHA256Hex(sidecarRaw); got != jinxFCNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, jinxFCNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != jinxFCCandidateKey || doc.RequestTitle != jinxFCRequestTitle ||
		doc.ResolvedTitle != jinxFCResolvedTitle || doc.WikiPageID != jinxFCWikiPageID ||
		doc.RevisionID != jinxFCRevisionID || doc.RevisionTimestamp != jinxFCTimestamp ||
		doc.ContentSHA256 != jinxFCContentSHA || doc.RawByteSize != jinxFCRawBytes ||
		doc.SkillKey != "E" || doc.ZhDisplayName != "嚼火者手雷！" || doc.OwnerID != "hero_jinx" {
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
	if doc.Fields.Cost != "90\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|24 to 10}}\n" {
		t.Fatalf("cooldown=%q want rank table ending in 10s", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|90 to 290}}") ||
		!strings.Contains(doc.Fields.Leveling, "100% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") ||
		!strings.Contains(doc.Fields.Description, "3") ||
		!strings.Contains(doc.Fields.Description, "Chompers") ||
		!strings.Contains(doc.Fields.Description, "0.4") ||
		!strings.Contains(doc.Fields.Description, "0.5") ||
		!strings.Contains(doc.Fields.Description, "5 seconds") {
		t.Fatal("wiki prose must retain excluded three-Chomper / landing / arming / lifetime surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "knocking them down") ||
		!strings.Contains(doc.Fields.Description2, "rooting") ||
		!strings.Contains(doc.Fields.Description2, "only one") {
		t.Fatal("wiki description2 must retain excluded knockdown/root/one-per-champion surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "Wind Wall") ||
		!strings.Contains(doc.Fields.Notes, "Braum") ||
		!strings.Contains(doc.Fields.Notes, "Spell shield") ||
		!strings.Contains(doc.Fields.Notes, "vision") {
		t.Fatalf("notes missing Wind Wall/Braum/spell-shield/vision (excluded): %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(jinxFCRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "jinx-e.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != jinxFCPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), jinxFCPagesBytes)
	}
	if got := jinxFCSHA256Hex(pagesRaw); got != jinxFCPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, jinxFCPagesSHA)
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
		pages.SkillKey != "E" || pages.ZhDisplayName != "嚼火者手雷！" || pages.OwnerID != "hero_jinx" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(jinxFCRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "jinx-e.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != jinxFCLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), jinxFCLocalRawBytes)
	}
	localSHA := jinxFCSHA256Hex(rawBytes)
	if localSHA != jinxFCLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, jinxFCLocalRawSHA)
	}
	if localSHA == jinxFCContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == jinxFCRawBytes {
		t.Fatal("local raw byte length must differ from canonical 1786 (materialization caveat)")
	}
	if jinxFCPlanRev != "jinx-e-flame-chompers-primary-explosion-hit-phase-a-v1" || jinxFCBoundary !=
		"rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; "+
			"magic_290_plus_1_00_ap; "+
			"no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_"+
			"location_direction_range_geometry_area_multitarget_contact_acquisition_"+
			"knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_"+
			"exception_vision_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	// 退役种子、后端旧检查与旧说明字节已归入历史证据；此处核对通用构造样例。

	compileReq, _ := loadJinxFCFixture(t, jinxFCFixtureOpts{
		resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
	})
	assertJinxFCProviderShape(t, compileReq, 1)
	rawX := jinxFCExpectedRawFromAP(jinxFCFixtureAPDefault)
	if math.Abs(rawX-jinxFCExpectedRawDefault) > jinxFCTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, jinxFCExpectedRawDefault)
	}
	mitX := expectedMitigatedMagic(rawX, jinxFCTargetMR)
	if math.Abs(mitX-jinxFCExpectedMitDefault) > jinxFCTol {
		t.Fatalf("default mit=%v want %v", mitX, jinxFCExpectedMitDefault)
	}
	raw0 := jinxFCExpectedRawFromAP(0)
	if math.Abs(raw0-jinxFCExpectedRawAP0) > jinxFCTol {
		t.Fatalf("AP0 raw=%v want %v", raw0, jinxFCExpectedRawAP0)
	}
	mit0 := expectedMitigatedMagic(raw0, jinxFCTargetMR)
	if math.Abs(mit0-jinxFCExpectedMitAP0) > jinxFCTol {
		t.Fatalf("AP0 mit=%v want %v", mit0, jinxFCExpectedMitAP0)
	}
}

// TestJinxFlameChompersPrimaryExplosionHitFormulaMitigationAndADIsolation:
// AP0/100 × MR100 raw/mitigated; unrelated AD change must not alter E damage.
func TestJinxFlameChompersPrimaryExplosionHitFormulaMitigationAndADIsolation(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAP, mr, ad     float64
		wantRaw, wantMitigated float64
	}{
		{"AP0_MR100_AD0", 0, 100, 0, 290, 145},
		{"AP0_MR100_AD200", 0, 100, 200, 290, 145},
		{"AP100_MR100_AD0", 100, 100, 0, 390, 195},
		{"AP100_MR100_AD200", 100, 100, 200, 390, 195},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := jinxFCExpectedRawFromAP(tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > jinxFCTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > jinxFCTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: jinxFCFixtureManaCD,
				resolvedAD: tc.ad,
			})
			assertJinxFCProviderShape(t, compileReq, 1)
			ref := jinxFCAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runJinxFC(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := jinxFCDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("E damage evidence=%d want 1", len(dmg))
			}
			jinxFCAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > jinxFCTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.ad) > jinxFCTol {
				t.Fatalf("ad.resolved=%v want unrelated probe %v",
					sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.ad)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(jinxFCAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(jinxFCAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestJinxFlameChompersPrimaryExplosionHitCooldownMana270AbilityStarted: mana270/
// AP100/HP1000/MR100 at t0/t9999/t10000 → success/skip/success; final mana90/HP610;
// two E damage items and two automatic E ability_started events.
func TestJinxFlameChompersPrimaryExplosionHitCooldownMana270AbilityStarted(t *testing.T) {
	compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
		resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR,
		mana: jinxFCFixtureManaCD, hp: jinxFCTargetHP,
		resolvedAD: jinxFCFixtureADProbe,
	})
	assertJinxFCProviderShape(t, compileReq, 1)
	ref := jinxFCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10000},
	}
	runReq.StopPolicy.DurationMs = 10100
	done := runJinxFC(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if jinxFCSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findJinxFCAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt9999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 9999 {
			t.Fatalf("cooldown skip TimeMs=%d want 9999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 10000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 10000", item.Data["readyAtMs"])
		}
		skipAt9999 = true
	}
	if !skipAt9999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=9999 with readyAtMs=10000")
	}

	items := jinxFCDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("E damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 10000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		jinxFCAssertDamage(t, item, jinxFCExpectedRawDefault, jinxFCExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * jinxFCExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-jinxFCHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, jinxFCHPAfter2)
	}
	gotMana := jinxFCSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-jinxFCManaAfter2) > jinxFCTol {
		t.Fatalf("mana=%v want %v", gotMana, jinxFCManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := jinxFCAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic E; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 10000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-jinxFCFixtureAPDefault) > jinxFCTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), jinxFCFixtureAPDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-jinxFCFixtureADProbe) > jinxFCTol {
		t.Fatalf("ad.resolved=%v want unrelated probe %v (must not affect E damage)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), jinxFCFixtureADProbe)
	}
}

// TestJinxFlameChompersPrimaryExplosionHitResourceInsufficientMana89: mana89 at
// t0 → resource_insufficient; mana/HP unchanged; zero E damage/event.
func TestJinxFlameChompersPrimaryExplosionHitResourceInsufficientMana89(t *testing.T) {
	compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
		resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR,
		mana: jinxFCFixtureManaShort, hp: jinxFCTargetHP,
	})
	ref := jinxFCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJinxFC(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if jinxFCSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(jinxFCSourceMana(t, done.FinalSnapshot)-jinxFCFixtureManaShort) > jinxFCTol {
		t.Fatalf("mana changed: got %v want %v",
			jinxFCSourceMana(t, done.FinalSnapshot), jinxFCFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-jinxFCTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, jinxFCTargetHP)
	}
	if len(jinxFCDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero E damage evidence")
	}
	if len(jinxFCAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestJinxFlameChompersPrimaryExplosionHitStandaloneNoSiblingSynthesis: standalone
// E provider does not synthesize P/Q/W/R/basic or overwrite unrelated
// definitions/mounts/snapshots.
func TestJinxFlameChompersPrimaryExplosionHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
		resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
	})
	assertJinxFCProviderShape(t, compileReq, 1)

	sentinelKey := "fixture_jinx_fc_unrelated_sentinel"
	sentinelStable := "fixture_jinx_fc_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != jinxFCProviderRef {
		t.Fatalf("source mounts=%+v want only E", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != jinxFCProviderRef {
			t.Fatalf("source snapshots=%+v want only E", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_jinx_[pqwr]_|ability_hero_jinx_[pqwr]_|` +
		`provider_hero_jinx_basic_|ability_hero_jinx_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != jinxFCProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("E must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := jinxFCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJinxFC(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(jinxFCDamageEvidence(done)) != 1 {
		t.Fatalf("E damage=%d want 1", len(jinxFCDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone E must not synthesize extra damage")
	}
	if len(jinxFCAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic E ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only E", done.Summary.AbilityStats)
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
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestJinxFlameChompersPrimaryExplosionHitEWIsolationCoexistence: test-only
// composition of independent E + existing W graphs (same-package W helpers,
// unmodified). Both providers mount; E cast causes only E damage/event and does
// not mutate/trigger W; W cast causes only W damage/event and does not
// mutate/trigger E.
func TestJinxFlameChompersPrimaryExplosionHitEWIsolationCoexistence(t *testing.T) {
	t.Run("e_only_no_w_synthesis", func(t *testing.T) {
		compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
		})
		assertJinxFCProviderShape(t, compileReq, 1)
		for _, p := range compileReq.SharedProviders {
			if p.ProviderKey == jinxZapProviderRef || p.StableID == jinxZapStableID {
				t.Fatal("E-only must not synthesize W provider")
			}
			for _, a := range p.Abilities {
				if a.AbilityKey == jinxZapAbilityKey {
					t.Fatal("E-only must not synthesize W ability key")
				}
			}
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: jinxFCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJinxFC(t, compileReq, runReq)
		if len(jinxZapDamageEvidence(done)) != 0 {
			t.Fatal("E-only must not produce W damage")
		}
		if len(done.Summary.AbilityStats) != 1 ||
			done.Summary.AbilityStats[0].AbilityRef != jinxFCAbilityRef() {
			t.Fatalf("AbilityStats=%+v want only E", done.Summary.AbilityStats)
		}
	})

	t.Run("combined_ew_e_cast_no_w_evidence", func(t *testing.T) {
		compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR,
			mana: jinxFCFixtureManaCD, withW: true,
		})
		assertJinxFCProviderShape(t, compileReq, 2)
		assertJinxZapProviderShape(t, compileReq, 2, true)

		if jinxFCProviderRef == jinxZapProviderRef ||
			jinxFCStableID == jinxZapStableID ||
			jinxFCAbilityID == jinxZapAbilityID ||
			jinxFCAbilityKey == jinxZapAbilityKey ||
			jinxFCAbilityRef() == jinxZapAbilityRef() ||
			jinxFCDamageOpRef == jinxZapDamageOpRef {
			t.Fatal("E and W provider/ability/op refs must remain distinct")
		}
		foundE, foundW := false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == jinxFCProviderRef {
				foundE = true
			}
			if m.ProviderRef == jinxZapProviderRef {
				foundW = true
			}
		}
		if !foundE || !foundW {
			t.Fatalf("combined mounts=%+v want both E and W", compileReq.Combatants[0].Providers)
		}

		eRef := jinxFCAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: eRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJinxFC(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(jinxFCDamageEvidence(done)) != 1 {
			t.Fatalf("E damage=%d want 1", len(jinxFCDamageEvidence(done)))
		}
		jinxFCAssertDamage(t, jinxFCDamageEvidence(done)[0],
			jinxFCExpectedRawDefault, jinxFCExpectedMitDefault)
		if len(jinxZapDamageEvidence(done)) != 0 {
			t.Fatal("E cast must not produce W damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture E cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (E only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == jinxZapAbilityRef() {
				t.Fatalf("E cast must not produce W AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != eRef {
			t.Fatalf("AbilityStats=%+v want only E", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == jinxZapAbilityRef() {
				t.Fatalf("E cast must not produce W abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == jinxZapDamageOpRef {
				t.Fatalf("E cast must not produce W operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == jinxZapProviderRef {
				t.Fatalf("E cast must not produce W providerRef evidence: %+v", item)
			}
		}
	})

	t.Run("combined_ew_w_cast_no_e_evidence", func(t *testing.T) {
		compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR,
			mana: jinxFCFixtureManaCD, withW: true,
		})
		assertJinxFCProviderShape(t, compileReq, 2)
		assertJinxZapProviderShape(t, compileReq, 2, true)

		wRef := jinxZapAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: wRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJinxFC(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(jinxZapDamageEvidence(done)) != 1 {
			t.Fatalf("W damage=%d want 1", len(jinxZapDamageEvidence(done)))
		}
		jinxZapAssertDamage(t, jinxZapDamageEvidence(done)[0],
			jinxZapExpectedRawDefault, jinxZapExpectedMitDefault)
		if len(jinxFCDamageEvidence(done)) != 0 {
			t.Fatal("W cast must not produce E damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture W cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (W only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == jinxFCAbilityRef() {
				t.Fatalf("W cast must not produce E AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != wRef {
			t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == jinxFCAbilityRef() {
				t.Fatalf("W cast must not produce E abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == jinxFCDamageOpRef {
				t.Fatalf("W cast must not produce E operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == jinxFCProviderRef {
				t.Fatalf("W cast must not produce E providerRef evidence: %+v", item)
			}
		}
	})
}

// TestJinxFlameChompersPrimaryExplosionHitDeterminismAndLifecycle: repeated
// compile/run evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame
// and wrong/missing/released session behavior.
func TestJinxFlameChompersPrimaryExplosionHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadJinxFCFixture(t, jinxFCFixtureOpts{
				resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
			})
			ref := jinxFCAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9999},
				{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10000},
			}
			r.StopPolicy.DurationMs = 10100
			done := runJinxFC(t, c, r)
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
		c, r := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: jinxFCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runJinxFCFrames(t, c, r)
		if len(jinxFCDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path E damage=%d want 1", len(jinxFCDamageEvidence(done)))
		}
		jinxFCAssertDamage(t, jinxFCDamageEvidence(done)[0], jinxFCExpectedRawDefault, jinxFCExpectedMitDefault)
		if len(jinxFCAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: jinxFCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
