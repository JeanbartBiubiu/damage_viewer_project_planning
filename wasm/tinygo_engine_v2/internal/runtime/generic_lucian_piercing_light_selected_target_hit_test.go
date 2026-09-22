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

// hero_lucian Q Piercing Light / 透体圣光 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: lucian-q-piercing-light-selected-target-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold;
//	physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_
//	range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_
//	lockout_initial_target_death_early_end_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_lucian|Q|透体圣光
//	task wasm-generic-lucian-piercing-light-selected-target-hit
//	Request Template:Data Lucian/Q → resolved Template:Data Lucian/Piercing Light
//	wikiPageId 1308176 / rev 3982579 / timestamp 2026-01-09T09:22:29Z
//	canonical rawByteSize 1608 / SHA256
//	  d7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981
//	数据参考/lol-wiki-current-champions/normalized/generic/lucian-q.json
//	pages/raw siblings: pages/lucian-q.json, raw/lucian-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_lucian_piercing_light_selected_target_hit_seed.sql
//	Local raw materialization caveat: also 1608 bytes / SHA256
//	  cd65b80f0580f0e4833028791bba2331a321366307b8c35f7fc28fe06c1f06c1.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_lucian_q_piercing_light_selected_target_hit
//     (standalone; not P/W/E/R/basic synthesis)
//   - ability ability_hero_lucian_q_piercing_light_selected_target_hit with ability_key
//     piercing_light_selected_target_hit: active; mana 80; cooldown 5000 ms
//   - Exactly one immediate direct-target physical damage op:
//     add(const 220, mul(const 1.00, sub(read ad.resolved, read ad.base)))
//     (AD is bonus AD; formula must read both base and resolved)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No Lucian Q state/modifier/listener/matcher/repeat/control/projectile/AOE/
//     geometry/buffer/lockout/death/sibling; no explicit event op — successful
//     cast relies on runtime automatic ability_started. Fixture-only AD
//     modifier may raise ad.resolved above ad.base and is clearly test-only.
//     Fixture may supply entity/attribute/resource values but must not claim
//     the seed materializes them (external existing-data / check-only).
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast timing / target lead or dodge; direction / target range / range /
//   width / line geometry; multitarget / AOE / spell shield; buffered W or R /
//   E lockout; initial target death early end; ranks 1–4; siblings/basic/
//   loadout/crit/on-hit; live/E2E/full fidelity.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, bonus_ad_ratio,
// immediate_impact_scaffold.

const (
	lucianPLCandidateKey  = "hero_skill|hero_lucian|Q|透体圣光"
	lucianPLTaskKey       = "wasm-generic-lucian-piercing-light-selected-target-hit"
	lucianPLPlanRev       = "lucian-q-piercing-light-selected-target-hit-phase-a-v1"
	lucianPLRequestTitle  = "Template:Data Lucian/Q"
	lucianPLResolvedTitle = "Template:Data Lucian/Piercing Light"
	lucianPLWikiPageID    = 1308176
	lucianPLRevisionID    = 3982579
	lucianPLTimestamp     = "2026-01-09T09:22:29Z"
	lucianPLRawBytes      = 1608
	lucianPLLocalRawBytes = 1608
	lucianPLContentSHA    = "d7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981"
	lucianPLLocalRawSHA   = "cd65b80f0580f0e4833028791bba2331a321366307b8c35f7fc28fe06c1f06c1"
	lucianPLBoundary      = "rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; " +
		"physical_220_plus_1_00_bonus_ad; " +
		"no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_" +
		"line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_" +
		"initial_target_death_early_end_other_ranks_or_full_fidelity"

	lucianPLProviderRef = "provider_hero_lucian_q_piercing_light_selected_target_hit"
	lucianPLStableID    = "hero_lucian_q_piercing_light_selected_target_hit"
	lucianPLAbilityID   = "ability_hero_lucian_q_piercing_light_selected_target_hit"
	lucianPLAbilityKey  = "piercing_light_selected_target_hit"
	lucianPLDamageOpRef = "op:lucian_piercing_light_selected_target_hit_damage"
	lucianPLBonusADMod  = "fixture_lucian_piercing_light_selected_target_hit_bonus_ad"

	lucianPLSeedBlobSHA  = "7CA13108A29471A72BF81E7ACD69DD24ADBC4B06C32C9583F2554F8CD2B48717"
	lucianPLJUnitBlobSHA = "B4B2D2091CC6DABF5EB746DCE5857BC85CCCC60F84E564C8FE9CDFCA9A46E78B"

	lucianPLBaseDamage   = 220.0
	lucianPLBonusADRatio = 1.00
	lucianPLManaCost     = 80.0
	lucianPLCDMs         = 5000.0

	// Fixture base stays 60; flat bonus-AD modifier raises ad.resolved.
	lucianPLADBase            = 60.0
	lucianPLADResolvedDefault = 160.0
	lucianPLFixtureManaCD     = 240.0
	lucianPLFixtureManaShort  = 79.0
	lucianPLTargetArmor       = 100.0
	lucianPLTargetHP          = 1000.0

	lucianPLExpectedRawDefault = 320.0 // 220 + 1.00*(160-60)
	lucianPLExpectedMitDefault = 160.0 // armor100
	lucianPLManaAfter2         = 80.0  // 240 - 80 - 80
	lucianPLHPAfter2           = 680.0 // 1000 - 160 - 160

	lucianPLSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":220},` +
		`{"op":"mul","args":[{"op":"const","value":1.00},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},` +
		`{"op":"read","path":"source.attr.ad.base"}]}]}]}`

	lucianPLTol = 1e-9
)

func lucianPLOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func lucianPLExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return lucianPLBaseDamage + lucianPLBonusADRatio*(resolvedAD-baseAD)
}

func lucianPLDamageAmount() *model.GenericFormulaExpr {
	base := lucianPLBaseDamage
	ratio := lucianPLBonusADRatio
	// Binary add only: const 220 + mul(1.00, sub(ad.resolved, ad.base)).
	// Bonus AD — formula must read both base and resolved.
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
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

func lucianPLAbility() model.AbilityDefinition {
	cost := lucianPLManaCost
	cd := lucianPLCDMs
	return model.AbilityDefinition{
		AbilityKey: lucianPLAbilityKey,
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
				Ref:           lucianPLDamageOpRef,
				Amount:        lucianPLDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func lucianPLProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: lucianPLProviderRef,
		Kind:        "champion",
		StableID:    lucianPLStableID,
		Abilities:   []model.AbilityDefinition{lucianPLAbility()},
	}
	// Fixture-only flat AD so ad.base stays 60 while ad.resolved can rise.
	// Production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: lucianPLBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func lucianPLAbilityRef() string {
	return "source.provider[" + lucianPLProviderRef + "].ability[" + lucianPLAbilityKey + "]"
}

type lucianPLFixtureOpts struct {
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func configureLucianPLProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts lucianPLFixtureOpts) {
	bonusAD := opts.resolvedAD - lucianPLADBase
	p := lucianPLProviderDef(bonusAD)
	compileReq.SharedProviders = []model.ProviderDefinition{p}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: lucianPLProviderRef, DefinitionRef: lucianPLProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: lucianPLProviderRef, DefinitionRef: lucianPLProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureLucianPLTypes(req *model.CompileRequest) {
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

func loadLucianPLFixture(t *testing.T, opts lucianPLFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAD/armor explicitly (armor0 is a valid branch).
	if opts.mana == 0 {
		opts.mana = lucianPLFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = lucianPLTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureLucianPLTypes(&compileReq)
	configureLucianPLProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_lucian / ad / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: lucianPLADBase, Current: lucianPLADBase,
		Max: lucianPLADBase, Resolved: lucianPLADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, lucianPLFixtureManaCD),
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

func runLucianPL(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runLucianPLFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func lucianPLSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func lucianPLSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func lucianPLSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func lucianPLDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := lucianPLAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != lucianPLDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func lucianPLAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func lucianPLFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == lucianPLProviderRef {
			return p
		}
	}
	return nil
}

func assertLucianPLProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := lucianPLFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_lucian_q_piercing_light_selected_target_hit missing from SharedProviders")
	}
	if p.ProviderKey != lucianPLProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, lucianPLProviderRef)
	}
	if p.StableID != lucianPLStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, lucianPLStableID)
	}
	banned := []string{
		"provider_hero_lucian_p_", "provider_hero_lucian_w_", "provider_hero_lucian_e_",
		"provider_hero_lucian_r_", "provider_hero_lucian_basic_",
		"ability_hero_lucian_p_", "ability_hero_lucian_w_", "ability_hero_lucian_e_",
		"ability_hero_lucian_r_", "ability_hero_lucian_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("piercing_light selected-target-hit must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != lucianPLBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], lucianPLBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), lucianPLAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != lucianPLAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, lucianPLAbilityKey, lucianPLAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("piercing_light_selected_target_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-lucianPLManaCost) > lucianPLTol {
		t.Fatalf("cost=%+v want mana const 80", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-lucianPLCDMs) > lucianPLTol {
		t.Fatalf("cooldown=%+v want const 5000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("piercing_light damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("piercing_light damage must not be copyable on hit")
	}
	if op.Ref != lucianPLDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, lucianPLDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 220, mul(1.00, sub(ad.resolved, ad.base)))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-lucianPLBaseDamage) > lucianPLTol {
		t.Fatalf("base const=%+v want 220", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-lucianPLBonusADRatio) > lucianPLTol {
		t.Fatalf("bonus-AD ratio=%+v want 1.00", adMul.Args[0])
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want sub(ad.resolved, ad.base) — both base and resolved", sub)
	}
	if adMul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	if adMul.Args[1].Op == "read" && adMul.Args[1].Path == "source.attr.ad.resolved" {
		t.Fatal("must not use total-AD direct resolved read; bonus AD requires sub(resolved, base)")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "buffer" ||
			bannedOp.Operation == "lockout" {
			t.Fatalf("piercing_light must not include excluded op: %+v", bannedOp)
		}
	}
}

func findLucianPLAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := lucianPLAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func lucianPLRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func lucianPLLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(lucianPLRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_lucian_piercing_light_selected_target_hit_seed.sql"))
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

func lucianPLSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func lucianPLSHA256HexUpper(b []byte) string {
	return strings.ToUpper(lucianPLSHA256Hex(b))
}

func lucianPLAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > lucianPLTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > lucianPLTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != lucianPLDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), lucianPLDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != lucianPLAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), lucianPLAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != lucianPLProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), lucianPLProviderRef)
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

// TestLucianPiercingLightSelectedTargetHitSourceSeedProviderFormulaShape locks
// wiki/sidecar/pages/local-raw caveat, seed/README/JUnit identities and source
// blob hashes, external-existing-data check-only prerequisites /
// non-materialization, ordered tags, and Q provider/bonus-AD formula shape.
func TestLucianPiercingLightSelectedTargetHitSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling                       string
			Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(lucianPLRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "lucian-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != lucianPLCandidateKey || doc.RequestTitle != lucianPLRequestTitle ||
		doc.ResolvedTitle != lucianPLResolvedTitle || doc.WikiPageID != lucianPLWikiPageID ||
		doc.RevisionID != lucianPLRevisionID || doc.RevisionTimestamp != lucianPLTimestamp ||
		doc.ContentSHA256 != lucianPLContentSHA || doc.RawByteSize != lucianPLRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "透体圣光" || doc.OwnerID != "hero_lucian" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|48 to 80}}\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|9 to 5}}\n" {
		t.Fatalf("cooldown=%q want {{ap|9 to 5}} (rank-5 = 5s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|80 to 220}}") ||
		!strings.Contains(doc.Fields.Leveling, "100% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") {
		t.Fatal("wiki prose must retain physical damage wording")
	}
	if !strings.Contains(doc.Fields.Notes, "lead the target") {
		t.Fatalf("notes missing target lead (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "buffer") ||
		(!strings.Contains(doc.Fields.Notes, "{{ai|W|Lucian}}") && !strings.Contains(doc.Fields.Notes, "W")) {
		t.Fatalf("notes missing buffered W/R surface (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "locked out") {
		t.Fatalf("notes missing E lockout (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "initial target dies") {
		t.Fatalf("notes missing initial target death early end (excluded): %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(lucianPLRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "lucian-q.json"))
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "透体圣光" || pages.OwnerID != "hero_lucian" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(lucianPLRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "lucian-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != lucianPLLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), lucianPLLocalRawBytes)
	}
	localSHA := lucianPLSHA256Hex(rawBytes)
	if localSHA != lucianPLLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, lucianPLLocalRawSHA)
	}
	if localSHA == lucianPLContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if lucianPLPlanRev != "lucian-q-piercing-light-selected-target-hit-phase-a-v1" || lucianPLBoundary !=
		"rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; "+
			"physical_220_plus_1_00_bonus_ad; "+
			"no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_"+
			"line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_"+
			"initial_target_death_early_end_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := lucianPLRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_lucian_piercing_light_selected_target_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := lucianPLSHA256HexUpper(seedBytes); got != lucianPLSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, lucianPLSeedBlobSHA)
	}
	junitPath := lucianPLRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := lucianPLSHA256HexUpper(junitBytes); got != lucianPLJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, lucianPLJUnitBlobSHA)
	}
	_ = lucianPLRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := lucianPLLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(lucianPLRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		lucianPLCandidateKey, lucianPLTaskKey, lucianPLPlanRev,
		lucianPLRequestTitle, lucianPLResolvedTitle,
		"1308176", "3982579", lucianPLTimestamp, "1608",
		lucianPLContentSHA, lucianPLLocalRawSHA,
		lucianPLBoundary, lucianPLProviderRef, lucianPLAbilityID, lucianPLAbilityKey,
		"piercing_light_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":80}`, `{"op":"const","value":5000}`,
		lucianPLSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/lucian-q.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"bonus AD", "source.attr.ad.resolved", "source.attr.ad.base",
		"ability_started",
		"missing game_entities hero_lucian",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_lucian/ad",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_lucian/mana",
		"missing reserved_type",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range lucianPLOrderedTags() {
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
	for _, tag := range lucianPLOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if regexp.MustCompile(`(?i)Batch-B\s+prerequisite`).MatchString(seed) {
		t.Fatal("seed must not use Batch-B prerequisite wording")
	}
	if !strings.Contains(sqlNoComments, `"path":"source.attr.ad.resolved"`) ||
		!strings.Contains(sqlNoComments, `"path":"source.attr.ad.base"`) {
		t.Fatal("executable SQL must read both ad.resolved and ad.base (bonus AD)")
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
		"phase_hero_lucian_q_piercing_light_selected_target_hit_impact",
		"sequence_hero_lucian_q_piercing_light_selected_target_hit_impact",
		"step_hero_lucian_q_piercing_light_selected_target_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_lucian_q_piercing_light_selected_target_hit'\s*,\s*` +
		`'provider_hero_lucian_q_piercing_light_selected_target_hit'\s*,\s*` +
		`'piercing_light_selected_target_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key piercing_light_selected_target_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_lucian_q_piercing_light_selected_target_hit_damage'\s*,\s*` +
		`'piercing_light_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
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
	if regexp.MustCompile(`(?is)'provider_hero_lucian_[pwer]_|'ability_hero_lucian_[pwer]_|` +
		`'provider_hero_lucian_basic_|'ability_hero_lucian_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/W/E/R/basic graph rows")
	}

	for _, want := range []string{
		lucianPLCandidateKey, lucianPLTaskKey, lucianPLPlanRev,
		"lol_generic_lucian_piercing_light_selected_target_hit_seed.sql",
		"LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest",
		"external existing-data",
		"physical_220_plus_1_00_bonus_ad",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Lucian identity/panel/resource")
	}
	if strings.Contains(readme, "fixture_lucian_piercing_light_selected_target_hit_bonus_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production Q behavior")
	}

	compileReq, _ := loadLucianPLFixture(t, lucianPLFixtureOpts{
		resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
	})
	assertLucianPLProviderShape(t, compileReq, 1, true)
	rawX := lucianPLExpectedRawFromAD(lucianPLADResolvedDefault, lucianPLADBase)
	if math.Abs(rawX-lucianPLExpectedRawDefault) > lucianPLTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, lucianPLExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, lucianPLTargetArmor)
	if math.Abs(mitX-lucianPLExpectedMitDefault) > lucianPLTol {
		t.Fatalf("default mit=%v want %v", mitX, lucianPLExpectedMitDefault)
	}
	// Prove bonus-AD vs total-AD: total-AD would be 220+160=380, not 320.
	totalADRaw := lucianPLBaseDamage + lucianPLBonusADRatio*lucianPLADResolvedDefault
	if math.Abs(totalADRaw-lucianPLExpectedRawDefault) < lucianPLTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
	if math.Abs(totalADRaw-380) > lucianPLTol {
		t.Fatalf("total-AD cross-check=%v want 380", totalADRaw)
	}
}

// TestLucianPiercingLightSelectedTargetHitFormulaMitigationTable: base60 ×
// resolved60/160/260 × armor0/100 raw/mitigated table from the frozen
// deterministic fixtures; proves formula reads both ad.base and ad.resolved.
func TestLucianPiercingLightSelectedTargetHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, armor      float64
		wantRaw, wantMitigated float64
	}{
		{"base60_resolved60_armor0", 60, 0, 220, 220},
		{"base60_resolved60_armor100", 60, 100, 220, 110},
		{"base60_resolved160_armor0", 160, 0, 320, 320},
		{"base60_resolved160_armor100", 160, 100, 320, 160},
		{"base60_resolved260_armor100", 260, 100, 420, 210},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := lucianPLExpectedRawFromAD(tc.resolvedAD, lucianPLADBase)
			if math.Abs(rawX-tc.wantRaw) > lucianPLTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > lucianPLTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadLucianPLFixture(t, lucianPLFixtureOpts{
				resolvedAD: tc.resolvedAD, armor: tc.armor, mana: lucianPLFixtureManaCD,
			})
			assertLucianPLProviderShape(t, compileReq, 1, tc.resolvedAD != lucianPLADBase)
			ref := lucianPLAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runLucianPL(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := lucianPLDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			lucianPLAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > lucianPLTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(lucianPLSourceAttrBase(t, done.FinalSnapshot, "ad")-lucianPLADBase) > lucianPLTol {
				t.Fatalf("ad.base=%v want %v (formula must read base)", lucianPLSourceAttrBase(t, done.FinalSnapshot, "ad"), lucianPLADBase)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(lucianPLAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(lucianPLAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestLucianPiercingLightSelectedTargetHitCooldownMana240AbilityStarted: mana240/
// base60/resolved160/HP1000/armor100 at t0/t4999/t5000 → success/skip/success;
// final mana80/HP680; two Q damage items and two automatic Q ability_started events.
func TestLucianPiercingLightSelectedTargetHitCooldownMana240AbilityStarted(t *testing.T) {
	compileReq, runReq := loadLucianPLFixture(t, lucianPLFixtureOpts{
		resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor,
		mana: lucianPLFixtureManaCD, hp: lucianPLTargetHP,
	})
	assertLucianPLProviderShape(t, compileReq, 1, true)
	ref := lucianPLAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100
	done := runLucianPL(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if lucianPLSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findLucianPLAbilityStat(t, done)
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

	items := lucianPLDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 5000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		lucianPLAssertDamage(t, item, lucianPLExpectedRawDefault, lucianPLExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * lucianPLExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-lucianPLHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, lucianPLHPAfter2)
	}
	gotMana := lucianPLSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-lucianPLManaAfter2) > lucianPLTol {
		t.Fatalf("mana=%v want %v", gotMana, lucianPLManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := lucianPLAbilityStartedEvidence(done)
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
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-lucianPLADResolvedDefault) > lucianPLTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), lucianPLADResolvedDefault)
	}
	if math.Abs(lucianPLSourceAttrBase(t, done.FinalSnapshot, "ad")-lucianPLADBase) > lucianPLTol {
		t.Fatalf("ad.base=%v want %v", lucianPLSourceAttrBase(t, done.FinalSnapshot, "ad"), lucianPLADBase)
	}
}

// TestLucianPiercingLightSelectedTargetHitResourceInsufficientMana79: mana79 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/event evidence.
func TestLucianPiercingLightSelectedTargetHitResourceInsufficientMana79(t *testing.T) {
	compileReq, runReq := loadLucianPLFixture(t, lucianPLFixtureOpts{
		resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor,
		mana: lucianPLFixtureManaShort, hp: lucianPLTargetHP,
	})
	ref := lucianPLAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runLucianPL(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if lucianPLSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(lucianPLSourceMana(t, done.FinalSnapshot)-lucianPLFixtureManaShort) > lucianPLTol {
		t.Fatalf("mana changed: got %v want %v",
			lucianPLSourceMana(t, done.FinalSnapshot), lucianPLFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-lucianPLTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, lucianPLTargetHP)
	}
	if len(lucianPLDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(lucianPLAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestLucianPiercingLightSelectedTargetHitStandaloneNoSiblingSynthesis: standalone Q
// provider does not synthesize P/W/E/R/basic or overwrite unrelated definitions.
func TestLucianPiercingLightSelectedTargetHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadLucianPLFixture(t, lucianPLFixtureOpts{
		resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
	})
	assertLucianPLProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_lucian_piercing_light_unrelated_sentinel"
	sentinelStable := "fixture_lucian_piercing_light_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != lucianPLProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != lucianPLProviderRef {
			t.Fatalf("source snapshots=%+v want only Q", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_lucian_[pwer]_|ability_hero_lucian_[pwer]_|` +
		`provider_hero_lucian_basic_|ability_hero_lucian_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == lucianPLProviderRef || p.StableID == lucianPLStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != lucianPLProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := lucianPLAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runLucianPL(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(lucianPLDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(lucianPLDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(lucianPLAbilityStartedEvidence(done)) != 1 {
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
				if ps.ProviderRef == lucianPLProviderRef || ps.DefinitionRef == lucianPLProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestLucianPiercingLightSelectedTargetHitDeterminismAndLifecycle: repeated
// compile/run evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame
// and wrong/missing/released session behavior.
func TestLucianPiercingLightSelectedTargetHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadLucianPLFixture(t, lucianPLFixtureOpts{
				resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
			})
			ref := lucianPLAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
			}
			r.StopPolicy.DurationMs = 5100
			done := runLucianPL(t, c, r)
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
		c, r := loadLucianPLFixture(t, lucianPLFixtureOpts{
			resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: lucianPLAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runLucianPLFrames(t, c, r)
		if len(lucianPLDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(lucianPLDamageEvidence(done)))
		}
		lucianPLAssertDamage(t, lucianPLDamageEvidence(done)[0], lucianPLExpectedRawDefault, lucianPLExpectedMitDefault)
		if len(lucianPLAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadLucianPLFixture(t, lucianPLFixtureOpts{
			resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: lucianPLAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
