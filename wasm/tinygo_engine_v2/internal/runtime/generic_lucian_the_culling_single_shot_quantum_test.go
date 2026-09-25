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

// hero_lucian R The Culling / 圣枪洗礼 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: lucian-r-the-culling-single-shot-quantum-phase-a-v2).
//
// Frozen boundary:
//
//	rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold;
//	physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_
//	scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_
//	multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_
//	other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_lucian|R|圣枪洗礼
//	task wasm-generic-lucian-the-culling-single-shot-quantum
//	Request Template:Data Lucian/R → resolved Template:Data Lucian/The Culling
//	wikiPageId 1308182 / rev 4007670 / timestamp 2026-04-12T10:40:21Z
//	canonical rawByteSize 4477 / SHA256
//	  7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7
//	数据参考/lol-wiki-current-champions/normalized/generic/lucian-r.json
//	pages/raw siblings: pages/lucian-r.json, raw/lucian-r.wikitext
//	已删除历史种子： db/game_manage/seeds/lol_generic_lucian_the_culling_single_shot_quantum_seed.sql
//	Local raw materialization caveat: also 4477 bytes / SHA256
//	  b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d.
//	Same-size caveat; assert sidecar/pages canonical identity + caveat; do not claim
//	local-raw equivalence or source contradiction.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_lucian_r_the_culling_single_shot_quantum
//     (standalone; not P/Q/W/E/basic synthesis; does not require Lucian Q/W publication)
//   - ability ability_hero_lucian_r_the_culling_single_shot_quantum with ability_key
//     the_culling_single_shot_quantum: active; mana 100; cooldown 90000 ms
//   - Exactly one immediate direct-target champion physical damage op (shot quantum):
//     add(add(const 45, mul(const 0.25, read source.attr.ad.resolved)),
//         mul(const 0.15, read source.attr.ap.resolved))
//     (AD is total AD; never subtract base AD; never call it bonus AD; AD and AP
//     resolved each read exactly once; no crit read)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: physical 20220 + add policy 20170; 20230 forbidden
//   - No Lucian R state/modifier/listener/matcher/repeat/control/channel/
//     projectile/geometry/multishot/crit/sibling; no explicit event op —
//     successful cast relies on runtime automatic ability_started.
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   3-second channel / channel state; 0.75-second / manual / automatic recast;
//   22 base or crit-scaled additional shots; total channel damage; cadence /
//   fire-rate; direction / range / width; missile offsets / alternating guns /
//   travel / collision / first-enemy geometry / multitarget; minion double;
//   movement / ghosted / facing; spell shield; interrupts / E usability /
//   Q-W lockout / Thresh / Tahm; ranks 1–2; other Lucian behaviors; full fidelity.
//   This is one damage quantum, not one total R hit or the total ultimate.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, ap_ratio,
// immediate_impact_scaffold (explicitly no total_ad_ratio governed tag; total AD
// remains exact in formula/boundary/reason only).

const (
	lucianTCCandidateKey  = "hero_skill|hero_lucian|R|圣枪洗礼"
	lucianTCTaskKey       = "wasm-generic-lucian-the-culling-single-shot-quantum"
	lucianTCPlanRev       = "lucian-r-the-culling-single-shot-quantum-phase-a-v2"
	lucianTCRequestTitle  = "Template:Data Lucian/R"
	lucianTCResolvedTitle = "Template:Data Lucian/The Culling"
	lucianTCWikiPageID    = 1308182
	lucianTCRevisionID    = 4007670
	lucianTCTimestamp     = "2026-04-12T10:40:21Z"
	lucianTCRawBytes      = 4477
	lucianTCLocalRawBytes = 4477
	lucianTCContentSHA    = "7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7"
	lucianTCLocalRawSHA   = "b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d"
	lucianTCBoundary      = "rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; " +
		"physical_45_plus_0_25_total_ad_plus_0_15_ap; " +
		"no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_" +
		"missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_" +
		"ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity"

	lucianTCProviderRef = "provider_hero_lucian_r_the_culling_single_shot_quantum"
	lucianTCStableID    = "hero_lucian_r_the_culling_single_shot_quantum"
	lucianTCAbilityID   = "ability_hero_lucian_r_the_culling_single_shot_quantum"
	lucianTCAbilityKey  = "the_culling_single_shot_quantum"
	lucianTCDamageOpRef = "op:lucian_the_culling_single_shot_quantum_damage"
	lucianTCTotalADMod  = "fixture_lucian_the_culling_single_shot_quantum_total_ad"

	lucianTCBaseDamage = 45.0
	lucianTCADRatio    = 0.25
	lucianTCAPRatio    = 0.15
	lucianTCManaCost   = 100.0
	lucianTCCDMs       = 90000.0

	lucianTCADBaseDefault      = 60.0
	lucianTCADResolvedDefault  = 160.0
	lucianTCFixtureAPDefault   = 100.0
	lucianTCFixtureManaCD      = 300.0
	lucianTCFixtureManaShort   = 99.0
	lucianTCTargetArmorDefault = 100.0
	lucianTCTargetHP           = 1000.0

	lucianTCExpectedRawDefault = 100.0 // 45 + 0.25*160 + 0.15*100
	lucianTCExpectedMitDefault = 50.0  // armor100
	lucianTCManaAfter2         = 100.0 // 300 - 100 - 100
	lucianTCHPAfter2           = 900.0 // 1000 - 50 - 50

	lucianTCTol = 1e-9
)

func lucianTCOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func lucianTCExpectedRawFromStats(resolvedAD, resolvedAP float64) float64 {
	return lucianTCBaseDamage + lucianTCADRatio*resolvedAD + lucianTCAPRatio*resolvedAP
}

func lucianTCDamageAmount() *model.GenericFormulaExpr {
	base := lucianTCBaseDamage
	adRatio := lucianTCADRatio
	apRatio := lucianTCAPRatio
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

func lucianTCCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += lucianTCCountPathReads(&expr.Args[i], path)
	}
	return n
}

func lucianTCAbility() model.AbilityDefinition {
	cost := lucianTCManaCost
	cd := lucianTCCDMs
	return model.AbilityDefinition{
		AbilityKey: lucianTCAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical shot quantum; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           lucianTCDamageOpRef,
				Amount:        lucianTCDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func lucianTCProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: lucianTCProviderRef,
		Kind:        "champion",
		StableID:    lucianTCStableID,
		Abilities:   []model.AbilityDefinition{lucianTCAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed R provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: lucianTCTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func lucianTCAbilityRef() string {
	return "source.provider[" + lucianTCProviderRef + "].ability[" + lucianTCAbilityKey + "]"
}

type lucianTCFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	armor      float64
	mana       float64
	hp         float64
	withQ      bool
	withW      bool
}

func configureLucianTCProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts lucianTCFixtureOpts) {
	flat := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{lucianTCProviderDef(flat)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: lucianTCProviderRef, DefinitionRef: lucianTCProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: lucianTCProviderRef, DefinitionRef: lucianTCProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if opts.withQ {
		// Same-package Q helpers (read-only use); do not modify Q test file.
		providers = append(providers, lucianPLProviderDef(0))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: lucianPLProviderRef, DefinitionRef: lucianPLProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: lucianPLProviderRef, DefinitionRef: lucianPLProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	if opts.withW {
		// Same-package W helpers (read-only use); do not modify W test file.
		providers = append(providers, lucianABProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: lucianABProviderRef, DefinitionRef: lucianABProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: lucianABProviderRef, DefinitionRef: lucianABProviderRef,
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

func ensureLucianTCTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/physical", Domain: "damage"},
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

func loadLucianTCFixture(t *testing.T, opts lucianTCFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/armor explicitly
	// (AD0 / AP0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = lucianTCFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = lucianTCTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureLucianTCTypes(&compileReq)
	configureLucianTCProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_lucian / ad / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, lucianTCFixtureManaCD),
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

func runLucianTC(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runLucianTCFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func lucianTCSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func lucianTCSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func lucianTCSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func lucianTCDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := lucianTCAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != lucianTCDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func lucianTCAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func lucianTCFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == lucianTCProviderRef {
			return p
		}
	}
	return nil
}

func assertLucianTCProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := lucianTCFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_lucian_r_the_culling_single_shot_quantum missing from SharedProviders")
	}
	if p.ProviderKey != lucianTCProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, lucianTCProviderRef)
	}
	if p.StableID != lucianTCStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, lucianTCStableID)
	}
	banned := []string{
		"provider_hero_lucian_p_", "provider_hero_lucian_q_", "provider_hero_lucian_w_",
		"provider_hero_lucian_e_", "provider_hero_lucian_basic_",
		"ability_hero_lucian_p_", "ability_hero_lucian_q_", "ability_hero_lucian_w_",
		"ability_hero_lucian_e_", "ability_hero_lucian_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("the_culling single-shot quantum must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != lucianTCTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], lucianTCTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production R has no modifiers when flat=0)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), lucianTCAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != lucianTCAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, lucianTCAbilityKey, lucianTCAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("the_culling_single_shot_quantum must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-lucianTCManaCost) > lucianTCTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-lucianTCCDMs) > lucianTCTol {
		t.Fatalf("cooldown=%+v want const 90000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one physical shot quantum)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("the culling shot-quantum damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("the culling shot-quantum damage must not be copyable on hit")
	}
	if op.Ref != lucianTCDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, lucianTCDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(add(const45, mul(0.25, ad.resolved)), mul(0.15, ap.resolved))", op.Amount)
	}
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const, mul(adRatio, ad.resolved))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-lucianTCBaseDamage) > lucianTCTol {
		t.Fatalf("base const=%+v want 45", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-lucianTCADRatio) > lucianTCTol {
		t.Fatalf("AD ratio=%+v want 0.25", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-lucianTCAPRatio) > lucianTCTol {
		t.Fatalf("AP ratio=%+v want 0.15", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if lucianTCCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", lucianTCCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if lucianTCCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", lucianTCCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if lucianTCCountPathReads(op.Amount, "source.attr.ad.base") != 0 {
		t.Fatal("total-AD formula must not read/subtract source.attr.ad.base")
	}
	if lucianTCCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 0 ||
		lucianTCCountPathReads(op.Amount, "source.attr.crit_damage.resolved") != 0 {
		t.Fatal("shot-quantum formula must not read crit attrs")
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
			bannedOp.Operation == "multishot" || bannedOp.Operation == "crit" {
			t.Fatalf("the culling shot quantum must not include excluded op: %+v", bannedOp)
		}
	}
}

func findLucianTCAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := lucianTCAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func lucianTCRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func lucianTCSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func lucianTCSHA256HexUpper(b []byte) string {
	return strings.ToUpper(lucianTCSHA256Hex(b))
}

func lucianTCAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > lucianTCTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > lucianTCTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != lucianTCDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), lucianTCDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != lucianTCAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), lucianTCAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != lucianTCProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), lucianTCProviderRef)
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

// TestLucianTheCullingSingleShotQuantumWikiSourceAndConstructedFixtureFormulaShape 核对历史 Wiki 来源与当前通用运行构造样例的数值、身份和边界；不代表现行管理数据。
func TestLucianTheCullingSingleShotQuantumWikiSourceAndConstructedFixtureFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Description2, Description3, Leveling string
			Cooldown, Cost, Costtype, Damagetype, Notes       string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(lucianTCRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "lucian-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != lucianTCCandidateKey || doc.RequestTitle != lucianTCRequestTitle ||
		doc.ResolvedTitle != lucianTCResolvedTitle || doc.WikiPageID != lucianTCWikiPageID ||
		doc.RevisionID != lucianTCRevisionID || doc.RevisionTimestamp != lucianTCTimestamp ||
		doc.ContentSHA256 != lucianTCContentSHA || doc.RawByteSize != lucianTCRawBytes ||
		doc.SkillKey != "R" || doc.ZhDisplayName != "圣枪洗礼" || doc.OwnerID != "hero_lucian" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "description3",
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
	if doc.Fields.Cooldown != "{{ap|110 to 90}}\n" {
		t.Fatalf("cooldown=%q want {{ap|110 to 90}} (rank-3 = 90s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "Physical Damage Per Shot") ||
		!strings.Contains(doc.Fields.Leveling, "{{#var:r_d1}}") ||
		!strings.Contains(doc.Fields.Leveling, "{{#var:r_d3}}") ||
		!strings.Contains(doc.Fields.Leveling, "{{#var:r_ad}}% AD") ||
		!strings.Contains(doc.Fields.Leveling, "{{#var:r_ap}}% AP") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") {
		t.Fatal("wiki prose must retain physical damage wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description, "channels") ||
		!strings.Contains(doc.Fields.Description, "3 seconds") ||
		!strings.Contains(doc.Fields.Description, "22") ||
		!strings.Contains(doc.Fields.Description, "crit") ||
		!strings.Contains(doc.Fields.Description, "0.75") {
		t.Fatal("wiki prose must retain excluded channel/22+crit/recast surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "ghosted") {
		t.Fatal("wiki prose must retain excluded ghosted movement surface")
	}
	if !strings.Contains(doc.Fields.Description3, "Recast") {
		t.Fatal("wiki prose must retain excluded Recast surface")
	}
	if !strings.Contains(doc.Fields.Notes, "offset") ||
		!strings.Contains(doc.Fields.Notes, "alternating") ||
		!strings.Contains(doc.Fields.Notes, "Spell shield") ||
		!strings.Contains(doc.Fields.Notes, "channel") {
		t.Fatalf("notes missing excluded offset/alternating/spell-shield/channel surfaces: %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "Piercing Light") ||
		!strings.Contains(doc.Fields.Notes, "Ardent Blaze") {
		t.Fatal("notes must retain Q-W lockout exclusion framing")
	}

	pagesRaw, err := os.ReadFile(lucianTCRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "lucian-r.json"))
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
		pages.SkillKey != "R" || pages.ZhDisplayName != "圣枪洗礼" || pages.OwnerID != "hero_lucian" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(lucianTCRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "lucian-r.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != lucianTCLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), lucianTCLocalRawBytes)
	}
	if lucianTCLocalRawBytes != lucianTCRawBytes {
		t.Fatal("local raw and canonical sizes must both be 4477 (same-size caveat)")
	}
	localSHA := lucianTCSHA256Hex(rawBytes)
	if localSHA != lucianTCLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, lucianTCLocalRawSHA)
	}
	if localSHA == lucianTCContentSHA {
		t.Fatal("local raw hash must differ from canonical (same-size caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{#vardefine:r_d1|15}}",
		"{{#vardefine:r_d3|45}}",
		"{{#vardefine:r_ad|25}}",
		"{{#vardefine:r_ap|15}}",
		"|cost         = 100",
		"|cooldown     = {{ap|110 to 90}}",
		"|damagetype   = Physical",
		"|projectile   = True",
		"channels",
		"22",
		"crit",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if lucianTCPlanRev != "lucian-r-the-culling-single-shot-quantum-phase-a-v2" || lucianTCBoundary !=
		"rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; "+
			"physical_45_plus_0_25_total_ad_plus_0_15_ap; "+
			"no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_"+
			"missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_"+
			"ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	// 退役种子、后端旧检查与旧说明字节已归入历史证据；此处核对通用构造样例。

	compileReq, _ := loadLucianTCFixture(t, lucianTCFixtureOpts{
		baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
		resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
		mana: lucianTCFixtureManaCD,
	})
	assertLucianTCProviderShape(t, compileReq, 1, true)
	rawX := lucianTCExpectedRawFromStats(lucianTCADResolvedDefault, lucianTCFixtureAPDefault)
	if math.Abs(rawX-lucianTCExpectedRawDefault) > lucianTCTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, lucianTCExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, lucianTCTargetArmorDefault)
	if math.Abs(mitX-lucianTCExpectedMitDefault) > lucianTCTol {
		t.Fatalf("default mit=%v want %v", mitX, lucianTCExpectedMitDefault)
	}
}

// TestLucianTheCullingSingleShotQuantumFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/AP/armor raw/final table; proves nested total-AD+AP formula.
func TestLucianTheCullingSingleShotQuantumFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                           string
		baseAD, resolvedAD, resolvedAP float64
		armor                          float64
		wantRaw, wantMitigated         float64
	}{
		{"baseAD0_resolvedAD0_AP0_armor0", 0, 0, 0, 0, 45, 45},
		{"baseAD60_resolvedAD60_AP0_armor0", 60, 60, 0, 0, 60, 60},
		{"baseAD60_resolvedAD160_AP0_armor0", 60, 160, 0, 0, 85, 85},
		{"baseAD60_resolvedAD160_AP100_armor0", 60, 160, 100, 0, 100, 100},
		{"baseAD60_resolvedAD160_AP100_armor100", 60, 160, 100, 100, 100, 50},
		{"baseAD60_resolvedAD260_AP200_armor100", 60, 260, 200, 100, 140, 70},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := lucianTCExpectedRawFromStats(tc.resolvedAD, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > lucianTCTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > lucianTCTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadLucianTCFixture(t, lucianTCFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD, resolvedAP: tc.resolvedAP,
				armor: tc.armor, mana: lucianTCFixtureManaCD,
			})
			assertLucianTCProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := lucianTCAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runLucianTC(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := lucianTCDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R shot-quantum damage evidence=%d want 1", len(dmg))
			}
			lucianTCAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > lucianTCTol {
				t.Fatalf("ad.resolved=%v want %v (total AD)", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(lucianTCSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > lucianTCTol {
				t.Fatalf("ad.base=%v want %v (total-AD formula must leave base independent)",
					lucianTCSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > lucianTCTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(lucianTCAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(lucianTCAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestLucianTheCullingSingleShotQuantumTotalADCounterproof: baseAD0 versus baseAD60
// with resolvedAD160/AP100/armor0 must both raw/final 100 — formula reads only
// source.attr.ad.resolved, never source.attr.ad.base.
func TestLucianTheCullingSingleShotQuantumTotalADCounterproof(t *testing.T) {
	cases := []struct {
		name   string
		baseAD float64
	}{
		{"baseAD0_resolvedAD160", 0},
		{"baseAD60_resolvedAD160", 60},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadLucianTCFixture(t, lucianTCFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: lucianTCADResolvedDefault,
				resolvedAP: lucianTCFixtureAPDefault, armor: 0, mana: lucianTCFixtureManaCD,
			})
			assertLucianTCProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: lucianTCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runLucianTC(t, compileReq, runReq)
			dmg := lucianTCDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage=%d want 1", len(dmg))
			}
			lucianTCAssertDamage(t, dmg[0], 100, 100)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-lucianTCADResolvedDefault) > lucianTCTol {
				t.Fatalf("ad.resolved=%v want 160", sourceAttrResolved(t, done.FinalSnapshot, "ad"))
			}
			if math.Abs(lucianTCSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > lucianTCTol {
				t.Fatalf("ad.base=%v want %v", lucianTCSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	bonusAsIf := lucianTCExpectedRawFromStats(lucianTCADResolvedDefault-lucianTCADBaseDefault, lucianTCFixtureAPDefault)
	baseAlone := lucianTCExpectedRawFromStats(lucianTCADBaseDefault, lucianTCFixtureAPDefault)
	total := lucianTCExpectedRawFromStats(lucianTCADResolvedDefault, lucianTCFixtureAPDefault)
	if math.Abs(bonusAsIf-total) < lucianTCTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	if math.Abs(baseAlone-total) < lucianTCTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestLucianTheCullingSingleShotQuantumCooldownMana300AbilityStarted: mana300/
// baseAD60/resolvedAD160/AP100/HP1000/armor100 at t0/t89999/t90000 →
// success/cooldown skip/success; final mana100/HP900; two R shot-quantum damage
// items and two automatic R ability_started events.
func TestLucianTheCullingSingleShotQuantumCooldownMana300AbilityStarted(t *testing.T) {
	compileReq, runReq := loadLucianTCFixture(t, lucianTCFixtureOpts{
		baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
		resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
		mana: lucianTCFixtureManaCD, hp: lucianTCTargetHP,
	})
	assertLucianTCProviderShape(t, compileReq, 1, true)
	ref := lucianTCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 89999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 90000},
	}
	runReq.StopPolicy.DurationMs = 90100
	done := runLucianTC(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if lucianTCSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findLucianTCAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt89999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 89999 {
			t.Fatalf("cooldown skip TimeMs=%d want 89999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 90000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 90000", item.Data["readyAtMs"])
		}
		skipAt89999 = true
	}
	if !skipAt89999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=89999 with readyAtMs=90000")
	}

	items := lucianTCDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("R shot-quantum damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 90000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		lucianTCAssertDamage(t, item, lucianTCExpectedRawDefault, lucianTCExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * lucianTCExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-lucianTCHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, lucianTCHPAfter2)
	}
	gotMana := lucianTCSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-lucianTCManaAfter2) > lucianTCTol {
		t.Fatalf("mana=%v want %v", gotMana, lucianTCManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := lucianTCAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic R; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 90000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-lucianTCADResolvedDefault) > lucianTCTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), lucianTCADResolvedDefault)
	}
	if math.Abs(lucianTCSourceAttrBase(t, done.FinalSnapshot, "ad")-lucianTCADBaseDefault) > lucianTCTol {
		t.Fatalf("ad.base=%v want %v",
			lucianTCSourceAttrBase(t, done.FinalSnapshot, "ad"), lucianTCADBaseDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-lucianTCFixtureAPDefault) > lucianTCTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), lucianTCFixtureAPDefault)
	}
}

// TestLucianTheCullingSingleShotQuantumResourceInsufficientMana99: mana99 at t0 →
// resource_insufficient; mana/HP unchanged; zero R damage/event evidence.
func TestLucianTheCullingSingleShotQuantumResourceInsufficientMana99(t *testing.T) {
	compileReq, runReq := loadLucianTCFixture(t, lucianTCFixtureOpts{
		baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
		resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
		mana: lucianTCFixtureManaShort, hp: lucianTCTargetHP,
	})
	ref := lucianTCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runLucianTC(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if lucianTCSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(lucianTCSourceMana(t, done.FinalSnapshot)-lucianTCFixtureManaShort) > lucianTCTol {
		t.Fatalf("mana changed: got %v want %v",
			lucianTCSourceMana(t, done.FinalSnapshot), lucianTCFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-lucianTCTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, lucianTCTargetHP)
	}
	if len(lucianTCDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero R damage evidence")
	}
	if len(lucianTCAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestLucianTheCullingSingleShotQuantumStandaloneNoSiblingSynthesis: standalone R
// provider does not synthesize P/Q/W/E/basic or overwrite unrelated definitions.
func TestLucianTheCullingSingleShotQuantumStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadLucianTCFixture(t, lucianTCFixtureOpts{
		baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
		resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
		mana: lucianTCFixtureManaCD,
	})
	assertLucianTCProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_lucian_the_culling_unrelated_sentinel"
	sentinelStable := "fixture_lucian_the_culling_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != lucianTCProviderRef {
		t.Fatalf("source mounts=%+v want only R", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != lucianTCProviderRef {
			t.Fatalf("source snapshots=%+v want only R", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_lucian_[pqwe]_|ability_hero_lucian_[pqwe]_|` +
		`provider_hero_lucian_basic_|ability_hero_lucian_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == lucianTCProviderRef || p.StableID == lucianTCStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != lucianTCProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("R must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}
	for _, p := range compileReq.SharedProviders {
		if p.ProviderKey == lucianPLProviderRef || p.StableID == lucianPLStableID {
			t.Fatal("R-only fixture must not synthesize Piercing Light Q provider")
		}
		if p.ProviderKey == lucianABProviderRef || p.StableID == lucianABStableID {
			t.Fatal("R-only fixture must not synthesize Ardent Blaze W provider")
		}
	}

	ref := lucianTCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runLucianTC(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(lucianTCDamageEvidence(done)) != 1 {
		t.Fatalf("R damage=%d want 1", len(lucianTCDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone R must not synthesize extra damage")
	}
	if len(lucianPLDamageEvidence(done)) != 0 {
		t.Fatal("R-only must not produce Q damage evidence")
	}
	if len(lucianABDamageEvidence(done)) != 0 {
		t.Fatal("R-only must not produce W damage evidence")
	}
	if len(lucianTCAbilityStartedEvidence(done)) != 1 {
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
				if ps.ProviderRef == lucianTCProviderRef || ps.DefinitionRef == lucianTCProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestLucianTheCullingSingleShotQuantumQWIsolationCoexistence: R-only does not
// synthesize Q/W; combined Q+W+R keeps distinct provider/ability refs; R casts
// produce no Q/W damage/start/stats evidence. Uses same-package Q/W helpers
// read-only; Q and W test files unmodified.
func TestLucianTheCullingSingleShotQuantumQWIsolationCoexistence(t *testing.T) {
	t.Run("r_only_no_qw_synthesis", func(t *testing.T) {
		compileReq, runReq := loadLucianTCFixture(t, lucianTCFixtureOpts{
			baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
			resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
			mana: lucianTCFixtureManaCD,
		})
		assertLucianTCProviderShape(t, compileReq, 1, true)
		for _, p := range compileReq.SharedProviders {
			if p.ProviderKey == lucianPLProviderRef || p.StableID == lucianPLStableID {
				t.Fatal("R-only must not synthesize Q provider")
			}
			if p.ProviderKey == lucianABProviderRef || p.StableID == lucianABStableID {
				t.Fatal("R-only must not synthesize W provider")
			}
			for _, a := range p.Abilities {
				if a.AbilityKey == lucianPLAbilityKey || a.AbilityKey == lucianABAbilityKey {
					t.Fatalf("R-only must not synthesize Q/W ability key %q", a.AbilityKey)
				}
			}
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: lucianTCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runLucianTC(t, compileReq, runReq)
		if len(lucianPLDamageEvidence(done)) != 0 {
			t.Fatal("R-only must not produce Q damage")
		}
		if len(lucianABDamageEvidence(done)) != 0 {
			t.Fatal("R-only must not produce W damage")
		}
		if len(done.Summary.AbilityStats) != 1 ||
			done.Summary.AbilityStats[0].AbilityRef != lucianTCAbilityRef() {
			t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
		}
	})

	t.Run("combined_qwr_distinct_r_cast_no_qw_evidence", func(t *testing.T) {
		compileReq, runReq := loadLucianTCFixture(t, lucianTCFixtureOpts{
			baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
			resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
			mana: lucianTCFixtureManaCD, withQ: true, withW: true,
		})
		assertLucianTCProviderShape(t, compileReq, 3, true)
		assertLucianPLProviderShape(t, compileReq, 3, false)
		assertLucianABProviderShape(t, compileReq, 3)

		if lucianTCProviderRef == lucianPLProviderRef || lucianTCProviderRef == lucianABProviderRef ||
			lucianTCStableID == lucianPLStableID || lucianTCStableID == lucianABStableID ||
			lucianTCAbilityID == lucianPLAbilityID || lucianTCAbilityID == lucianABAbilityID ||
			lucianTCAbilityKey == lucianPLAbilityKey || lucianTCAbilityKey == lucianABAbilityKey ||
			lucianTCAbilityRef() == lucianPLAbilityRef() || lucianTCAbilityRef() == lucianABAbilityRef() ||
			lucianTCDamageOpRef == lucianPLDamageOpRef || lucianTCDamageOpRef == lucianABDamageOpRef {
			t.Fatal("Q/W/R provider/ability/op refs must remain distinct")
		}
		foundQ, foundW, foundR := false, false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == lucianPLProviderRef {
				foundQ = true
			}
			if m.ProviderRef == lucianABProviderRef {
				foundW = true
			}
			if m.ProviderRef == lucianTCProviderRef {
				foundR = true
			}
		}
		if !foundQ || !foundW || !foundR {
			t.Fatalf("combined mounts=%+v want Q+W+R", compileReq.Combatants[0].Providers)
		}

		rRef := lucianTCAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runLucianTC(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(lucianTCDamageEvidence(done)) != 1 {
			t.Fatalf("R damage=%d want 1", len(lucianTCDamageEvidence(done)))
		}
		lucianTCAssertDamage(t, lucianTCDamageEvidence(done)[0],
			lucianTCExpectedRawDefault, lucianTCExpectedMitDefault)
		if len(lucianPLDamageEvidence(done)) != 0 {
			t.Fatal("R cast must not produce Q damage evidence")
		}
		if len(lucianABDamageEvidence(done)) != 0 {
			t.Fatal("R cast must not produce W damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture R cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (R only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == lucianPLAbilityRef() || st.AbilityRef == lucianABAbilityRef() {
				t.Fatalf("R cast must not produce Q/W AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != rRef {
			t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == lucianPLAbilityRef() ||
				evidenceDataString(item.Data, "abilityRef") == lucianABAbilityRef() {
				t.Fatalf("R cast must not produce Q/W abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == lucianPLDamageOpRef ||
				evidenceDataString(item.Data, "operationRef") == lucianABDamageOpRef {
				t.Fatalf("R cast must not produce Q/W operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == lucianPLProviderRef ||
				evidenceDataString(item.Data, "providerRef") == lucianABProviderRef {
				t.Fatalf("R cast must not produce Q/W providerRef evidence: %+v", item)
			}
		}
	})
}

// TestLucianTheCullingSingleShotQuantumDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// wrong/missing/released session behavior.
func TestLucianTheCullingSingleShotQuantumDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadLucianTCFixture(t, lucianTCFixtureOpts{
				baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
				resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
				mana: lucianTCFixtureManaCD,
			})
			ref := lucianTCAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 89999},
				{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 90000},
			}
			r.StopPolicy.DurationMs = 90100
			done := runLucianTC(t, c, r)
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
		c, r := loadLucianTCFixture(t, lucianTCFixtureOpts{
			baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
			resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
			mana: lucianTCFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: lucianTCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runLucianTCFrames(t, c, r)
		if len(lucianTCDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path R damage=%d want 1", len(lucianTCDamageEvidence(done)))
		}
		lucianTCAssertDamage(t, lucianTCDamageEvidence(done)[0], lucianTCExpectedRawDefault, lucianTCExpectedMitDefault)
		if len(lucianTCAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadLucianTCFixture(t, lucianTCFixtureOpts{
			baseAD: lucianTCADBaseDefault, resolvedAD: lucianTCADResolvedDefault,
			resolvedAP: lucianTCFixtureAPDefault, armor: lucianTCTargetArmorDefault,
			mana: lucianTCFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: lucianTCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
