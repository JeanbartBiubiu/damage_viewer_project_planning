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

// hero_senna R Dawning Shadow / 暗影燎原 — Phase-A v3 Wasm exact verification slice
// (FROZEN_PLAN_REV: senna-r-dawning-shadow-primary-hit-phase-a-v3).
//
// Frozen boundary:
//
//	rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold;
//	physical_550_plus_1_15_bonus_ad_plus_0_70_ap; no_cast_time_effect_at_cast_time_start_
//	queue_time_global_direction_broad_or_narrow_wave_geometry_width_projectile_travel_
//	speed_destruction_aoe_multitarget_enemy_reveal_self_reveal_allied_or_self_shield_
//	mist_scaling_mist_wraith_hits_path_sight_spellshield_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_senna|R|暗影燎原
//	task wasm-generic-senna-dawning-shadow-primary-hit
//	Request Template:Data Senna/R → resolved Template:Data Senna/Dawning Shadow
//	wikiPageId 1409580 / rev 4008033 / timestamp 2026-04-13T04:08:13Z
//	canonical rawByteSize 2356 / SHA256
//	  4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36
//	数据参考/lol-wiki-current-champions/normalized/generic/senna-r.json
//	  bytes 2597 / SHA256
//	  79ced482a8489f211cacba8cedd4fe0f02a87f0360c5bf95d824c1d735f66307
//	pages/raw siblings: pages/senna-r.json (bytes 689 / SHA256
//	  9b7fcb0a8e28dbbe38b6e890966421a6857772c2029315225e59bd041f9e704e),
//	  raw/senna-r.wikitext
//	已删除历史种子： db/game_manage/seeds/lol_generic_senna_dawning_shadow_primary_hit_seed.sql
//	Local raw materialization caveat: 2353 bytes / SHA256
//	  1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc.
//	Serialization caveat only; assert sidecar/pages canonical identity + caveat;
//	do not claim local-raw equivalence or source contradiction.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_senna_r_dawning_shadow_primary_hit
//     (standalone; not P/Q/W/E/basic synthesis; preserve existing W without
//     requiring/copying/mutating W rows)
//   - ability ability_hero_senna_r_dawning_shadow_primary_hit with ability_key
//     dawning_shadow_primary_hit: active; mana 100; cooldown 100000 ms
//   - Exactly one immediate selected-primary-enemy-champion physical damage op:
//     add(add(const 550, mul(const 1.15, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base))), mul(const 0.70,
//         read source.attr.ap.resolved))
//     (every arithmetic node binary; each read path exactly once)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: physical 20220 + add policy 20170; 20230 forbidden
//   - No Senna R state/modifier/listener/matcher/repeat/control/projectile/
//     shield/sight/reveal/Mist/Wraith; no explicit event op —
//     successful cast relies on runtime automatic ability_started.
//     R Types empty (no ability-specific game-local R type).
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//     Standalone R seed contains no sibling synthesis.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast time/Effect at cast time start/queue time/global/direction/
//   broad or narrow wave geometry/width; projectile travel/speed/
//   destruction AOE/multitarget; enemy reveal/self reveal/
//   allied or self shield; Mist scaling/Mist Wraith hits/path sight/
//   spellshield; ranks 1–2; P/Q/W/E/basic/loadout/crit/on-hit;
//   live/publish/E2E/full fidelity.
//   Exactly one selected-primary-enemy-champion physical hit, not full R.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, bonus_ad_ratio,
// ap_ratio, immediate_impact_scaffold.

const (
	sennaDSCandidateKey    = "hero_skill|hero_senna|R|暗影燎原"
	sennaDSTaskKey         = "wasm-generic-senna-dawning-shadow-primary-hit"
	sennaDSPlanRev         = "senna-r-dawning-shadow-primary-hit-phase-a-v3"
	sennaDSRequestTitle    = "Template:Data Senna/R"
	sennaDSResolvedTitle   = "Template:Data Senna/Dawning Shadow"
	sennaDSWikiPageID      = 1409580
	sennaDSRevisionID      = 4008033
	sennaDSTimestamp       = "2026-04-13T04:08:13Z"
	sennaDSRawBytes        = 2356
	sennaDSLocalRawBytes   = 2353
	sennaDSNormalizedBytes = 2597
	sennaDSPagesBytes      = 689
	sennaDSContentSHA      = "4de188cce3d04f172d37f07db4e7c8e240388c5346f56838c82a3e6205c9de36"
	sennaDSLocalRawSHA     = "1b448ff48b9fe906a13056f2f510e38ff96fcad410462972a93dbd3bb93195dc"
	sennaDSNormalizedSHA   = "79ced482a8489f211cacba8cedd4fe0f02a87f0360c5bf95d824c1d735f66307"
	sennaDSPagesSHA        = "9b7fcb0a8e28dbbe38b6e890966421a6857772c2029315225e59bd041f9e704e"
	sennaDSBoundary        = "rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; " +
		"physical_550_plus_1_15_bonus_ad_plus_0_70_ap; " +
		"no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_" +
		"geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_" +
		"reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_" +
		"other_ranks_or_full_fidelity"

	sennaDSProviderRef = "provider_hero_senna_r_dawning_shadow_primary_hit"
	sennaDSStableID    = "hero_senna_r_dawning_shadow_primary_hit"
	sennaDSAbilityID   = "ability_hero_senna_r_dawning_shadow_primary_hit"
	sennaDSAbilityKey  = "dawning_shadow_primary_hit"
	sennaDSDamageOpRef = "op:senna_dawning_shadow_primary_hit_damage"
	sennaDSBonusADMod  = "fixture_senna_dawning_shadow_primary_hit_bonus_ad"

	sennaDSBaseDamage   = 550.0
	sennaDSBonusADRatio = 1.15
	sennaDSAPRatio      = 0.70
	sennaDSManaCost     = 100.0
	sennaDSCDMs         = 100000.0

	sennaDSADBaseDefault      = 60.0
	sennaDSADResolvedDefault  = 140.0
	sennaDSFixtureAPDefault   = 100.0
	sennaDSFixtureManaCD      = 300.0
	sennaDSFixtureManaShort   = 99.0
	sennaDSTargetArmorDefault = 100.0
	sennaDSTargetHP           = 1000.0

	// Default fixture: bonusAD=80, AP=100 → raw 712; armor100 → mitigated 356.
	sennaDSExpectedRawDefault = 712.0
	sennaDSExpectedMitDefault = 356.0
	sennaDSManaAfter2         = 100.0 // 300 - 100 - 100
	sennaDSHPAfter2           = 288.0 // 1000 - 356 - 356

	sennaDSTol = 1e-9
)

func sennaDSOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func sennaDSExpectedRawFromStats(resolvedAD, baseAD, resolvedAP float64) float64 {
	return sennaDSBaseDamage +
		sennaDSBonusADRatio*(resolvedAD-baseAD) +
		sennaDSAPRatio*resolvedAP
}

func sennaDSDamageAmount() *model.GenericFormulaExpr {
	base := sennaDSBaseDamage
	adRatio := sennaDSBonusADRatio
	apRatio := sennaDSAPRatio
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

func sennaDSCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += sennaDSCountPathReads(&expr.Args[i], path)
	}
	return n
}

func sennaDSAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		sennaDSAssertBinaryArity(t, &expr.Args[i])
	}
}

func sennaDSAbility() model.AbilityDefinition {
	cost := sennaDSManaCost
	cd := sennaDSCDMs
	return model.AbilityDefinition{
		AbilityKey: sennaDSAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical damage; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           sennaDSDamageOpRef,
				Amount:        sennaDSDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func sennaDSProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: sennaDSProviderRef,
		Kind:        "champion",
		StableID:    sennaDSStableID,
		Abilities:   []model.AbilityDefinition{sennaDSAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed R provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: sennaDSBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func sennaDSAbilityRef() string {
	return "source.provider[" + sennaDSProviderRef + "].ability[" + sennaDSAbilityKey + "]"
}

type sennaDSFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	armor      float64
	mana       float64
	hp         float64
	withW      bool
}

func configureSennaDSProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts sennaDSFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{sennaDSProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: sennaDSProviderRef, DefinitionRef: sennaDSProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: sennaDSProviderRef, DefinitionRef: sennaDSProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if opts.withW {
		// Same-package existing W helpers (read-only use); do not modify W test file.
		// Mount W with zero fixture AD mod so only R's bonus-AD flat raises resolved.
		providers = append(providers, sennaLEProviderDef(0))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: sennaLEProviderRef, DefinitionRef: sennaLEProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: sennaLEProviderRef, DefinitionRef: sennaLEProviderRef,
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

func ensureSennaDSTypes(req *model.CompileRequest) {
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

func loadSennaDSFixture(t *testing.T, opts sennaDSFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/armor explicitly
	// (AD0 / AP0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = sennaDSFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = sennaDSTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureSennaDSTypes(&compileReq)
	configureSennaDSProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_senna / ad / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, sennaDSFixtureManaCD),
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

func runSennaDS(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runSennaDSFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func sennaDSSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func sennaDSSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func sennaDSDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := sennaDSAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != sennaDSDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func sennaDSAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only R mounted, filter by
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

func sennaDSFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == sennaDSProviderRef {
			return p
		}
	}
	return nil
}

func assertSennaDSProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := sennaDSFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_senna_r_dawning_shadow_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != sennaDSProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, sennaDSProviderRef)
	}
	if p.StableID != sennaDSStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, sennaDSStableID)
	}
	banned := []string{
		"provider_hero_senna_p_", "provider_hero_senna_q_", "provider_hero_senna_w_",
		"provider_hero_senna_e_", "provider_hero_senna_basic_",
		"ability_hero_senna_p_", "ability_hero_senna_q_", "ability_hero_senna_w_",
		"ability_hero_senna_e_", "ability_hero_senna_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("dawning_shadow primary-hit must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != sennaDSBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], sennaDSBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production R has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), sennaDSAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != sennaDSAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, sennaDSAbilityKey, sennaDSAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("R Types=%v want empty (no ability-specific game-local R type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("dawning_shadow_primary_hit must not be tagged ability/basic_attack")
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
		math.Abs(*a.Cost.Amount.Value-sennaDSManaCost) > sennaDSTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-sennaDSCDMs) > sennaDSTol {
		t.Fatalf("cooldown=%+v want const 100000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary-enemy physical hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("dawning shadow damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("dawning shadow damage must not be copyable on hit")
	}
	if op.Ref != sennaDSDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, sennaDSDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(add(base, bonusAD), AP)", op.Amount)
	}
	sennaDSAssertBinaryArity(t, op.Amount)
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const550, mul(1.15, sub(ad.resolved, ad.base)))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-sennaDSBaseDamage) > sennaDSTol {
		t.Fatalf("base const=%+v want 550", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-sennaDSBonusADRatio) > sennaDSTol {
		t.Fatalf("bonus AD ratio=%+v want 1.15", adMul.Args[0])
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
		math.Abs(*apMul.Args[0].Value-sennaDSAPRatio) > sennaDSTol {
		t.Fatalf("AP ratio=%+v want 0.70", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if sennaDSCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", sennaDSCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if sennaDSCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", sennaDSCountPathReads(op.Amount, "source.attr.ad.base"))
	}
	if sennaDSCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", sennaDSCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if sennaDSCountPathReads(op.Amount, "source.attr.ap.base") != 0 {
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
			bannedOp.Operation == "shield" || bannedOp.Operation == "queue" {
			t.Fatalf("dawning shadow must not include excluded op: %+v", bannedOp)
		}
	}
}

func findSennaDSAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := sennaDSAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func sennaDSRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func sennaDSSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func sennaDSSHA256HexUpper(b []byte) string {
	return strings.ToUpper(sennaDSSHA256Hex(b))
}

func sennaDSAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > sennaDSTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > sennaDSTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != sennaDSDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), sennaDSDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != sennaDSAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), sennaDSAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != sennaDSProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), sennaDSProviderRef)
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

// TestSennaDawningShadowPrimaryHitWikiSourceAndConstructedFixtureFormulaShape 核对历史 Wiki 来源与当前通用运行构造样例的数值、身份和边界；不代表现行管理数据。
func TestSennaDawningShadowPrimaryHitWikiSourceAndConstructedFixtureFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Description2, Leveling2, Description3, Leveling3 string
			Cooldown, Cost, Costtype, Damagetype, Notes                   string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(sennaDSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "senna-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != sennaDSNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), sennaDSNormalizedBytes)
	}
	if got := sennaDSSHA256Hex(sidecarRaw); got != sennaDSNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, sennaDSNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != sennaDSCandidateKey || doc.RequestTitle != sennaDSRequestTitle ||
		doc.ResolvedTitle != sennaDSResolvedTitle || doc.WikiPageID != sennaDSWikiPageID ||
		doc.RevisionID != sennaDSRevisionID || doc.RevisionTimestamp != sennaDSTimestamp ||
		doc.ContentSHA256 != sennaDSContentSHA || doc.RawByteSize != sennaDSRawBytes ||
		doc.SkillKey != "R" || doc.ZhDisplayName != "暗影燎原" || doc.OwnerID != "hero_senna" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "description2", "leveling2", "description3", "leveling3",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|100}}\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|140 to 100}}\n" {
		t.Fatalf("cooldown=%q want {{ap|140 to 100}} (rank-3 = 100s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling2, "{{ap|250 to 550}}") ||
		!strings.Contains(doc.Fields.Leveling2, "115% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling2, "70% AP") ||
		!strings.Contains(doc.Fields.Leveling2, "Physical Damage") {
		t.Fatalf("leveling2=%q want rank3 physical 550 +115%% bonus AD +70%% AP", doc.Fields.Leveling2)
	}
	if !strings.Contains(doc.Fields.Description2, "{{as|physical damage}}") {
		t.Fatal("wiki prose must retain physical damage wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description2, "reveals") ||
		!strings.Contains(doc.Fields.Description2, "Mist Wraiths") {
		t.Fatal("wiki description2 must retain excluded reveal / Mist Wraith surfaces")
	}
	if !strings.Contains(doc.Fields.Description3, "shield") ||
		!strings.Contains(doc.Fields.Description3, "sight") {
		t.Fatal("wiki description3 must retain excluded shield / path sight surfaces")
	}
	if !strings.Contains(doc.Fields.Leveling3, "Shield Strength") ||
		!strings.Contains(doc.Fields.Leveling3, "Mist") {
		t.Fatal("wiki leveling3 must retain excluded shield / Mist scaling surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time start") ||
		!strings.Contains(doc.Fields.Notes, "reveals herself") ||
		!strings.Contains(doc.Fields.Notes, "projectile") {
		t.Fatalf("notes missing excluded cast-time/self-reveal/projectile surfaces: %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Description, "broad wave") ||
		!strings.Contains(doc.Fields.Description, "narrow wave") {
		t.Fatal("wiki description must retain excluded broad/narrow wave geometry surfaces")
	}

	pagesRaw, err := os.ReadFile(sennaDSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "senna-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != sennaDSPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), sennaDSPagesBytes)
	}
	if got := sennaDSSHA256Hex(pagesRaw); got != sennaDSPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, sennaDSPagesSHA)
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
		pages.SkillKey != "R" || pages.ZhDisplayName != "暗影燎原" || pages.OwnerID != "hero_senna" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(sennaDSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "senna-r.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != sennaDSLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), sennaDSLocalRawBytes)
	}
	if sennaDSLocalRawBytes == sennaDSRawBytes {
		t.Fatal("local raw and canonical sizes must differ (serialization caveat; not equivalence)")
	}
	localSHA := sennaDSSHA256Hex(rawBytes)
	if localSHA != sennaDSLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, sennaDSLocalRawSHA)
	}
	if localSHA == sennaDSContentSHA {
		t.Fatal("local raw hash must differ from canonical (serialization caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|250 to 550}}",
		"115% '''bonus''' AD",
		"70% AP",
		"|cost         = {{ap|100}}",
		"|cooldown     = {{ap|140 to 100}}",
		"|damagetype   = physical",
		"{{as|physical damage}}",
		"reveals",
		"Mist Wraiths",
		"shield",
		"sight",
		"Effect at cast time start",
		"reveals herself",
		"|cast time    =",
		"|queue time   =",
		"|target range = Global",
		"|targeting    = Direction",
		"|width        =",
		"|speed        =",
		"|spellshield  = true",
		"|projectile   = true",
		"|spelleffects = aoe",
		"broad wave",
		"narrow wave",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if sennaDSPlanRev != "senna-r-dawning-shadow-primary-hit-phase-a-v3" || sennaDSBoundary !=
		"rank3_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; "+
			"physical_550_plus_1_15_bonus_ad_plus_0_70_ap; "+
			"no_cast_time_effect_at_cast_time_start_queue_time_global_direction_broad_or_narrow_wave_"+
			"geometry_width_projectile_travel_speed_destruction_aoe_multitarget_enemy_reveal_self_"+
			"reveal_allied_or_self_shield_mist_scaling_mist_wraith_hits_path_sight_spellshield_"+
			"other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	// 退役种子、后端旧检查与旧说明字节已归入历史证据；此处核对通用构造样例。

	compileReq, _ := loadSennaDSFixture(t, sennaDSFixtureOpts{
		baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
		resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault, mana: sennaDSFixtureManaCD,
	})
	assertSennaDSProviderShape(t, compileReq, 1, true)
	rawX := sennaDSExpectedRawFromStats(
		sennaDSADResolvedDefault, sennaDSADBaseDefault, sennaDSFixtureAPDefault)
	if math.Abs(rawX-sennaDSExpectedRawDefault) > sennaDSTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, sennaDSExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, sennaDSTargetArmorDefault)
	if math.Abs(mitX-sennaDSExpectedMitDefault) > sennaDSTol {
		t.Fatalf("default mit=%v want %v", mitX, sennaDSExpectedMitDefault)
	}
	totalAsIf := sennaDSBaseDamage +
		sennaDSBonusADRatio*sennaDSADResolvedDefault +
		sennaDSAPRatio*sennaDSFixtureAPDefault
	if math.Abs(totalAsIf-sennaDSExpectedRawDefault) < sennaDSTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestSennaDawningShadowPrimaryHitFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/AP/armor raw/final table; one isolated successful R cast per row.
func TestSennaDawningShadowPrimaryHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		baseAD, resolvedAD     float64
		resolvedAP, armor      float64
		wantRaw, wantMitigated float64
	}{
		{"base60_resolved60_AP0_armor0", 60, 60, 0, 0, 550, 550},
		{"base60_resolved160_AP0_armor0", 60, 160, 0, 0, 665, 665},
		{"base60_resolved60_AP100_armor0", 60, 60, 100, 0, 620, 620},
		{"base60_resolved160_AP100_armor0", 60, 160, 100, 0, 735, 735},
		{"base60_resolved140_AP100_armor100", 60, 140, 100, 100, 712, 356},
		{"base60_resolved220_AP100_armor100", 60, 220, 100, 100, 804, 402},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := sennaDSExpectedRawFromStats(tc.resolvedAD, tc.baseAD, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > sennaDSTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > sennaDSTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadSennaDSFixture(t, sennaDSFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: tc.resolvedAP, armor: tc.armor, mana: sennaDSFixtureManaCD,
			})
			assertSennaDSProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := sennaDSAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSennaDS(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := sennaDSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage evidence=%d want 1", len(dmg))
			}
			sennaDSAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > sennaDSTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > sennaDSTol {
				t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)",
					sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > sennaDSTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(sennaDSAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(sennaDSAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestSennaDawningShadowPrimaryHitBonusADCounterproof: baseAD0/resolvedAD100/AP0
// versus baseAD60/resolvedAD160/AP0 at armor0 must both raw/final 665 — equal bonus AD.
func TestSennaDawningShadowPrimaryHitBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100_AP0", 0, 100},
		{"baseAD60_resolvedAD160_AP0", 60, 160},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadSennaDSFixture(t, sennaDSFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: 0, armor: 0, mana: sennaDSFixtureManaCD,
			})
			assertSennaDSProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: sennaDSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSennaDS(t, compileReq, runReq)
			dmg := sennaDSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage=%d want 1", len(dmg))
			}
			sennaDSAssertDamage(t, dmg[0], 665, 665)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > sennaDSTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > sennaDSTol {
				t.Fatalf("ad.base=%v want %v", sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-0) > sennaDSTol {
				t.Fatalf("ap.resolved=%v want 0", sourceAttrResolved(t, done.FinalSnapshot, "ap"))
			}
		})
	}
	totalAsIf := sennaDSBaseDamage + sennaDSBonusADRatio*160
	bonus := sennaDSExpectedRawFromStats(160, 60, 0)
	if math.Abs(totalAsIf-bonus) < sennaDSTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestSennaDawningShadowPrimaryHitCooldownMana300AbilityStarted: mana300/
// base60/resolved140/AP100/HP1000/armor100 at t0/t99999/t100000 →
// success/cooldown skip/success; final mana100/HP288; exactly two R damage
// items and two automatic R ability_started events.
func TestSennaDawningShadowPrimaryHitCooldownMana300AbilityStarted(t *testing.T) {
	compileReq, runReq := loadSennaDSFixture(t, sennaDSFixtureOpts{
		baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
		resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault,
		mana: sennaDSFixtureManaCD, hp: sennaDSTargetHP,
	})
	assertSennaDSProviderShape(t, compileReq, 1, true)
	ref := sennaDSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 99999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100000},
	}
	runReq.StopPolicy.DurationMs = 100100
	done := runSennaDS(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if sennaDSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findSennaDSAbilityStat(t, done)
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

	items := sennaDSDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("R damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 100000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		sennaDSAssertDamage(t, item, sennaDSExpectedRawDefault, sennaDSExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * sennaDSExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-sennaDSHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, sennaDSHPAfter2)
	}
	gotMana := sennaDSSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-sennaDSManaAfter2) > sennaDSTol {
		t.Fatalf("mana=%v want %v", gotMana, sennaDSManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := sennaDSAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic R; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 100000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-sennaDSADResolvedDefault) > sennaDSTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), sennaDSADResolvedDefault)
	}
	if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-sennaDSADBaseDefault) > sennaDSTol {
		t.Fatalf("ad.base=%v want %v",
			sourceAttrBase(t, done.FinalSnapshot, "ad"), sennaDSADBaseDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-sennaDSFixtureAPDefault) > sennaDSTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), sennaDSFixtureAPDefault)
	}
}

// TestSennaDawningShadowPrimaryHitResourceInsufficientMana99: mana99 at t0 →
// resource_insufficient; mana/HP unchanged; zero R damage/start evidence.
func TestSennaDawningShadowPrimaryHitResourceInsufficientMana99(t *testing.T) {
	compileReq, runReq := loadSennaDSFixture(t, sennaDSFixtureOpts{
		baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
		resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault,
		mana: sennaDSFixtureManaShort, hp: sennaDSTargetHP,
	})
	ref := sennaDSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSennaDS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if sennaDSSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(sennaDSSourceMana(t, done.FinalSnapshot)-sennaDSFixtureManaShort) > sennaDSTol {
		t.Fatalf("mana changed: got %v want %v",
			sennaDSSourceMana(t, done.FinalSnapshot), sennaDSFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-sennaDSTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, sennaDSTargetHP)
	}
	if len(sennaDSDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero R damage evidence")
	}
	if len(sennaDSAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestSennaDawningShadowPrimaryHitStandaloneNoSiblingSynthesis: standalone R
// provider does not synthesize P/Q/W/E/basic or overwrite unrelated definitions.
func TestSennaDawningShadowPrimaryHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadSennaDSFixture(t, sennaDSFixtureOpts{
		baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
		resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault, mana: sennaDSFixtureManaCD,
	})
	assertSennaDSProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_senna_dawning_shadow_unrelated_sentinel"
	sentinelStable := "fixture_senna_dawning_shadow_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != sennaDSProviderRef {
		t.Fatalf("source mounts=%+v want only R", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != sennaDSProviderRef {
			t.Fatalf("source snapshots=%+v want only R", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_senna_[pqwe]_|ability_hero_senna_[pqwe]_|` +
		`provider_hero_senna_basic_|ability_hero_senna_basic_|last_embrace`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == sennaDSProviderRef || p.StableID == sennaDSStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic/W provider: %+v", p)
		}
		if p.ProviderKey != sennaDSProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) ||
				strings.Contains(a.AbilityKey, "last_embrace") {
				t.Fatalf("R must not reuse sibling/basic/W ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := sennaDSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSennaDS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(sennaDSDamageEvidence(done)) != 1 {
		t.Fatalf("R damage=%d want 1", len(sennaDSDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone R must not synthesize extra damage")
	}
	if len(sennaDSAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic R ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
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
				if ps.ProviderRef == sennaDSProviderRef || ps.DefinitionRef == sennaDSProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic/W: %+v", ps)
			}
		}
	}
}

// TestSennaDawningShadowPrimaryHitRWIsolationCoexistence: test-only composition
// of independent R + existing W graphs. R cast alone produces R damage and no W
// damage; W cast alone produces W damage and no R damage. Provider/ability/op refs
// remain distinct; R seed contains no copied W rows (asserted in source-shape test).
func TestSennaDawningShadowPrimaryHitRWIsolationCoexistence(t *testing.T) {
	t.Run("r_only_no_w_synthesis", func(t *testing.T) {
		compileReq, runReq := loadSennaDSFixture(t, sennaDSFixtureOpts{
			baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
			resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault,
			mana: sennaDSFixtureManaCD,
		})
		assertSennaDSProviderShape(t, compileReq, 1, true)
		for _, p := range compileReq.SharedProviders {
			if p.ProviderKey == sennaLEProviderRef || p.StableID == sennaLEStableID {
				t.Fatal("R-only must not synthesize W provider")
			}
			for _, a := range p.Abilities {
				if a.AbilityKey == sennaLEAbilityKey {
					t.Fatalf("R-only must not synthesize W ability key %q", a.AbilityKey)
				}
			}
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: sennaDSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runSennaDS(t, compileReq, runReq)
		if len(sennaLEDamageEvidence(done)) != 0 {
			t.Fatal("R-only must not produce W damage")
		}
		if len(done.Summary.AbilityStats) != 1 ||
			done.Summary.AbilityStats[0].AbilityRef != sennaDSAbilityRef() {
			t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
		}
	})

	t.Run("combined_rw_distinct_r_cast_no_w_damage", func(t *testing.T) {
		compileReq, runReq := loadSennaDSFixture(t, sennaDSFixtureOpts{
			baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
			resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault,
			mana: sennaDSFixtureManaCD, withW: true,
		})
		assertSennaDSProviderShape(t, compileReq, 2, true)
		assertSennaLEProviderShape(t, compileReq, 2, false)

		if sennaDSProviderRef == sennaLEProviderRef ||
			sennaDSStableID == sennaLEStableID ||
			sennaDSAbilityID == sennaLEAbilityID ||
			sennaDSAbilityKey == sennaLEAbilityKey ||
			sennaDSAbilityRef() == sennaLEAbilityRef() ||
			sennaDSDamageOpRef == sennaLEDamageOpRef {
			t.Fatal("R/W provider/ability/op refs must remain distinct")
		}
		foundR, foundW := false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == sennaDSProviderRef {
				foundR = true
			}
			if m.ProviderRef == sennaLEProviderRef {
				foundW = true
			}
		}
		if !foundR || !foundW {
			t.Fatalf("combined mounts=%+v want R+W", compileReq.Combatants[0].Providers)
		}

		rRef := sennaDSAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runSennaDS(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(sennaDSDamageEvidence(done)) != 1 {
			t.Fatalf("R damage=%d want 1", len(sennaDSDamageEvidence(done)))
		}
		sennaDSAssertDamage(t, sennaDSDamageEvidence(done)[0],
			sennaDSExpectedRawDefault, sennaDSExpectedMitDefault)
		if len(sennaLEDamageEvidence(done)) != 0 {
			t.Fatal("R cast must not produce W damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture R cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (R only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == sennaLEAbilityRef() {
				t.Fatalf("R cast must not produce W AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != rRef {
			t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == sennaLEAbilityRef() {
				t.Fatalf("R cast must not produce W abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == sennaLEDamageOpRef {
				t.Fatalf("R cast must not produce W operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == sennaLEProviderRef {
				t.Fatalf("R cast must not produce W providerRef evidence: %+v", item)
			}
		}
	})

	t.Run("combined_rw_w_cast_no_r_damage", func(t *testing.T) {
		compileReq, runReq := loadSennaDSFixture(t, sennaDSFixtureOpts{
			baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
			resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault,
			mana: sennaDSFixtureManaCD, withW: true,
		})
		assertSennaDSProviderShape(t, compileReq, 2, true)
		assertSennaLEProviderShape(t, compileReq, 2, false)

		wRef := sennaLEAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: wRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runSennaDS(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(sennaLEDamageEvidence(done)) != 1 {
			t.Fatalf("W damage=%d want 1", len(sennaLEDamageEvidence(done)))
		}
		// W formula: 230 + 0.90*bonusAD(80) = 302; armor100 → 151.
		sennaLEAssertDamage(t, sennaLEDamageEvidence(done)[0], 302, 151)
		if len(sennaDSDamageEvidence(done)) != 0 {
			t.Fatal("W cast must not produce R damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture W cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (W only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == sennaDSAbilityRef() {
				t.Fatalf("W cast must not produce R AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != wRef {
			t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == sennaDSAbilityRef() {
				t.Fatalf("W cast must not produce R abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == sennaDSDamageOpRef {
				t.Fatalf("W cast must not produce R operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == sennaDSProviderRef {
				t.Fatalf("W cast must not produce R providerRef evidence: %+v", item)
			}
		}
	})
}

// TestSennaDawningShadowPrimaryHitDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// wrong/missing/released session behavior (post-release session_not_found).
func TestSennaDawningShadowPrimaryHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadSennaDSFixture(t, sennaDSFixtureOpts{
				baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
				resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault, mana: sennaDSFixtureManaCD,
			})
			ref := sennaDSAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 99999},
				{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100000},
			}
			r.StopPolicy.DurationMs = 100100
			done := runSennaDS(t, c, r)
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
		c, r := loadSennaDSFixture(t, sennaDSFixtureOpts{
			baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
			resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault, mana: sennaDSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: sennaDSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runSennaDSFrames(t, c, r)
		if len(sennaDSDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path R damage=%d want 1", len(sennaDSDamageEvidence(done)))
		}
		sennaDSAssertDamage(t, sennaDSDamageEvidence(done)[0],
			sennaDSExpectedRawDefault, sennaDSExpectedMitDefault)
		if len(sennaDSAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadSennaDSFixture(t, sennaDSFixtureOpts{
			baseAD: sennaDSADBaseDefault, resolvedAD: sennaDSADResolvedDefault,
			resolvedAP: sennaDSFixtureAPDefault, armor: sennaDSTargetArmorDefault, mana: sennaDSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: sennaDSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
