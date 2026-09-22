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

// hero_caitlyn Q Piltover Peacemaker / 和平使者 — Phase-A v1 Wasm exact verification
// slice (FROZEN_PLAN_REV: caitlyn-q-piltover-peacemaker-first-enemy-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold;
//	physical_210_plus_2_05_total_ad; no_cast_timing_attack_timer_reset_direction_
//	range_width_line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_
//	full_damage_projectile_spell_shield_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_caitlyn|Q|和平使者
//	task wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit
//	Request Template:Data Caitlyn/Q → resolved Template:Data Caitlyn/Piltover Peacemaker
//	wikiPageId 1306911 / rev 4007583 / timestamp 2026-04-12T06:47:12Z
//	canonical rawByteSize 1841 / SHA256
//	  6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf
//	数据参考/lol-wiki-current-champions/normalized/generic/caitlyn-q.json
//	pages/raw siblings: pages/caitlyn-q.json, raw/caitlyn-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql
//	Local raw materialization caveat: 1838 bytes / SHA256
//	  93da300971429a629f11a721c3993784db6a99d3559b1286eae9500176560b9a.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit
//     (standalone; not P/W/E/R/basic synthesis; isolated from existing Caitlyn E)
//   - ability ability_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit with ability_key
//     piltover_peacemaker_first_enemy_hit: active; mana 75; cooldown 6000 ms
//   - Exactly one immediate direct-target physical damage op:
//     210 + 2.05*source.attr.ad.resolved
//     (AD is total AD; never subtract base AD; never call it bonus AD)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No Caitlyn Q state/modifier/listener/matcher/repeat/control/projectile/
//     collision/trap/reveal/attack-reset; no explicit event op — successful
//     cast relies on runtime automatic ability_started. Fixture-only AD
//     modifier may set resolved total AD and is clearly test-only. Fixture may
//     supply entity/attribute/resource values but must not claim the seed
//     materializes them (external existing-data / check-only).
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast timing / Effect at cast time start / attack timer reset,
//   direction/range/width/line geometry/multitarget/post-first-enemy 60%,
//   trap/Yordle Snap Trap/reveal, projectile/full-damage projectile/spell
//   shield, ranks 1–4, siblings/basic/loadout/crit/on-hit, live/E2E/full
//   fidelity.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage,
// immediate_impact_scaffold (no total-AD ordered tag).

const (
	caitlynPPCandidateKey  = "hero_skill|hero_caitlyn|Q|和平使者"
	caitlynPPTaskKey       = "wasm-generic-caitlyn-piltover-peacemaker-first-enemy-hit"
	caitlynPPPlanRev       = "caitlyn-q-piltover-peacemaker-first-enemy-hit-phase-a-v1"
	caitlynPPRequestTitle  = "Template:Data Caitlyn/Q"
	caitlynPPResolvedTitle = "Template:Data Caitlyn/Piltover Peacemaker"
	caitlynPPWikiPageID    = 1306911
	caitlynPPRevisionID    = 4007583
	caitlynPPTimestamp     = "2026-04-12T06:47:12Z"
	caitlynPPRawBytes      = 1841
	caitlynPPLocalRawBytes = 1838
	caitlynPPContentSHA    = "6c40deba7b6e60ab9c06bc014a214a8be4319c4ddf22c550237b659f19307caf"
	caitlynPPLocalRawSHA   = "93da300971429a629f11a721c3993784db6a99d3559b1286eae9500176560b9a"
	caitlynPPBoundary      = "rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; " +
		"physical_210_plus_2_05_total_ad; " +
		"no_cast_timing_attack_timer_reset_direction_range_width_" +
		"line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_" +
		"full_damage_projectile_spell_shield_other_ranks_or_full_fidelity"

	caitlynPPProviderRef = "provider_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit"
	caitlynPPStableID    = "hero_caitlyn_q_piltover_peacemaker_first_enemy_hit"
	caitlynPPAbilityID   = "ability_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit"
	caitlynPPAbilityKey  = "piltover_peacemaker_first_enemy_hit"
	caitlynPPDamageOpRef = "op:caitlyn_piltover_peacemaker_first_enemy_hit_damage"
	caitlynPPTotalADMod  = "fixture_caitlyn_piltover_peacemaker_first_enemy_hit_total_ad"

	caitlynPPSeedBlobSHA  = "F4D3F06FBBB0307373E417F81FEC609DFCA282B2CAD6C0EC70499ADCC83A9DBA"
	caitlynPPJUnitBlobSHA = "009B90AF78318DF938AA38E2235A5C9E7040F78B9FBFE9FE807E32443CCCED5C"

	caitlynPPBaseDamage = 210.0
	caitlynPPADRatio    = 2.05
	caitlynPPManaCost   = 75.0
	caitlynPPCDMs       = 6000.0

	// Fixture base stays independent; flat modifier raises ad.resolved to total AD.
	caitlynPPADBase            = 59.0
	caitlynPPADResolvedDefault = 100.0
	caitlynPPFixtureManaCD     = 225.0
	caitlynPPFixtureManaShort  = 74.0
	caitlynPPTargetArmor       = 100.0
	caitlynPPTargetHP          = 1000.0

	caitlynPPExpectedRawDefault = 415.0 // 210 + 2.05*100
	caitlynPPExpectedMitDefault = 207.5 // armor100
	caitlynPPManaAfter2         = 75.0  // 225 - 75 - 75
	caitlynPPHPAfter2           = 585.0 // 1000 - 207.5 - 207.5

	caitlynPPSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":210},` +
		`{"op":"mul","args":[{"op":"const","value":2.05},` +
		`{"op":"read","path":"source.attr.ad.resolved"}]}]}`

	caitlynPPTol = 1e-9
)

func caitlynPPOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"immediate_impact_scaffold",
	}
}

func caitlynPPExpectedRawFromTotalAD(resolvedAD float64) float64 {
	return caitlynPPBaseDamage + caitlynPPADRatio*resolvedAD
}

func caitlynPPDamageAmount() *model.GenericFormulaExpr {
	base := caitlynPPBaseDamage
	adRatio := caitlynPPADRatio
	// Binary add only: const 210 + mul(2.05, source.attr.ad.resolved).
	// Total AD direct resolved read — never subtract ad.base.
	return &model.GenericFormulaExpr{
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
	}
}

func caitlynPPAbility() model.AbilityDefinition {
	cost := caitlynPPManaCost
	cd := caitlynPPCDMs
	return model.AbilityDefinition{
		AbilityKey: caitlynPPAbilityKey,
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
				Ref:           caitlynPPDamageOpRef,
				Amount:        caitlynPPDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func caitlynPPProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: caitlynPPProviderRef,
		Kind:        "champion",
		StableID:    caitlynPPStableID,
		Abilities:   []model.AbilityDefinition{caitlynPPAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed Q provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: caitlynPPTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func caitlynPPAbilityRef() string {
	return "source.provider[" + caitlynPPProviderRef + "].ability[" + caitlynPPAbilityKey + "]"
}

type caitlynPPFixtureOpts struct {
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func caitlynPPFixtureADBase(resolvedAD float64) float64 {
	// Negative flat modifiers do not drive ad.resolved to 0 under current
	// attribute resolution; totalAD0 is assembled with fixture base=0 instead.
	// Positive total-AD cases keep an independent non-zero base (Jinx/Jhin/Kalista pattern).
	if resolvedAD == 0 {
		return 0
	}
	return caitlynPPADBase
}

func configureCaitlynPPProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts caitlynPPFixtureOpts) {
	flat := opts.resolvedAD - caitlynPPFixtureADBase(opts.resolvedAD)
	p := caitlynPPProviderDef(flat)
	compileReq.SharedProviders = []model.ProviderDefinition{p}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: caitlynPPProviderRef, DefinitionRef: caitlynPPProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: caitlynPPProviderRef, DefinitionRef: caitlynPPProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureCaitlynPPTypes(req *model.CompileRequest) {
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

func loadCaitlynPPFixture(t *testing.T, opts caitlynPPFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAD/armor explicitly (totalAD0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = caitlynPPFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = caitlynPPTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureCaitlynPPTypes(&compileReq)
	configureCaitlynPPProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_caitlyn / ad / mana identity or panel/resource rows.
	adBase := caitlynPPFixtureADBase(opts.resolvedAD)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: adBase, Current: adBase,
		Max: adBase, Resolved: adBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, caitlynPPFixtureManaCD),
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

func runCaitlynPP(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runCaitlynPPFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func caitlynPPSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func caitlynPPSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func caitlynPPSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func caitlynPPDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := caitlynPPAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != caitlynPPDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func caitlynPPAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func caitlynPPFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == caitlynPPProviderRef {
			return p
		}
	}
	return nil
}

func assertCaitlynPPProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := caitlynPPFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit missing from SharedProviders")
	}
	if p.ProviderKey != caitlynPPProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, caitlynPPProviderRef)
	}
	if p.StableID != caitlynPPStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, caitlynPPStableID)
	}
	banned := []string{
		"provider_hero_caitlyn_p_", "provider_hero_caitlyn_w_", "provider_hero_caitlyn_e_",
		"provider_hero_caitlyn_r_", "provider_hero_caitlyn_basic_",
		"ability_hero_caitlyn_p_", "ability_hero_caitlyn_w_", "ability_hero_caitlyn_e_",
		"ability_hero_caitlyn_r_", "ability_hero_caitlyn_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("piltover peacemaker first-enemy-hit must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != caitlynPPTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], caitlynPPTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), caitlynPPAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != caitlynPPAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, caitlynPPAbilityKey, caitlynPPAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("piltover_peacemaker_first_enemy_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-caitlynPPManaCost) > caitlynPPTol {
		t.Fatalf("cost=%+v want mana const 75", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-caitlynPPCDMs) > caitlynPPTol {
		t.Fatalf("cooldown=%+v want const 6000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("piltover peacemaker damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("piltover peacemaker damage must not be copyable on hit")
	}
	if op.Ref != caitlynPPDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, caitlynPPDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 210, mul(2.05, ad.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-caitlynPPBaseDamage) > caitlynPPTol {
		t.Fatalf("base const=%+v want 210", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-caitlynPPADRatio) > caitlynPPTol {
		t.Fatalf("AD ratio=%+v want 2.05", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	if adMul.Args[1].Op == "sub" || (len(adMul.Args) > 1 && adMul.Args[1].Op == "sub") {
		t.Fatal("total-AD formula must not subtract ad.base")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "trap" ||
			bannedOp.Operation == "reveal" || bannedOp.Operation == "attack_reset" ||
			bannedOp.Operation == "cast_delay" || bannedOp.Operation == "spell_shield" ||
			bannedOp.Operation == "collision" {
			t.Fatalf("piltover peacemaker must not include excluded op: %+v", bannedOp)
		}
	}
}

func findCaitlynPPAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := caitlynPPAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func caitlynPPRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func caitlynPPLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(caitlynPPRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql"))
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

func caitlynPPSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func caitlynPPSHA256HexUpper(b []byte) string {
	return strings.ToUpper(caitlynPPSHA256Hex(b))
}

func caitlynPPAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > caitlynPPTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > caitlynPPTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != caitlynPPDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), caitlynPPDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != caitlynPPAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), caitlynPPAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != caitlynPPProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), caitlynPPProviderRef)
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

// TestCaitlynPiltoverPeacemakerFirstEnemyHitSourceSeedProviderFormulaShape locks
// wiki/sidecar/pages/local-raw caveat, seed/README/JUnit identities and source
// blob hashes, external-existing-data check-only prerequisites /
// non-materialization, and Q provider/total-AD formula shape.
func TestCaitlynPiltoverPeacemakerFirstEnemyHitSourceSeedProviderFormulaShape(t *testing.T) {
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
	sidecarRaw, err := os.ReadFile(caitlynPPRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "caitlyn-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != caitlynPPCandidateKey || doc.RequestTitle != caitlynPPRequestTitle ||
		doc.ResolvedTitle != caitlynPPResolvedTitle || doc.WikiPageID != caitlynPPWikiPageID ||
		doc.RevisionID != caitlynPPRevisionID || doc.RevisionTimestamp != caitlynPPTimestamp ||
		doc.ContentSHA256 != caitlynPPContentSHA || doc.RawByteSize != caitlynPPRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "和平使者" || doc.OwnerID != "hero_caitlyn" {
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
	if doc.Fields.Cost != "{{ap|55 to 75}}\n" || doc.Fields.Costtype != "mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|10 to 6}}\n" {
		t.Fatalf("cooldown=%q want rank table ending in 6s", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|50 to 210}}") ||
		!strings.Contains(doc.Fields.Leveling, "205") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "first enemy") ||
		!strings.Contains(doc.Fields.Description, "60%") {
		t.Fatal("wiki prose must retain excluded first-enemy / post-first 60% surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "Yordle Snap Trap") ||
		!strings.Contains(doc.Fields.Description2, "full damage") {
		t.Fatal("wiki prose must retain excluded trap / full-damage surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time start") {
		t.Fatalf("notes missing Effect at cast time start (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "attack timer") {
		t.Fatalf("notes missing attack timer reset (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "spell shield") {
		t.Fatalf("notes missing spell shield (excluded): %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(caitlynPPRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "caitlyn-q.json"))
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "和平使者" || pages.OwnerID != "hero_caitlyn" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(caitlynPPRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "caitlyn-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != caitlynPPLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), caitlynPPLocalRawBytes)
	}
	localSHA := caitlynPPSHA256Hex(rawBytes)
	if localSHA != caitlynPPLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, caitlynPPLocalRawSHA)
	}
	if localSHA == caitlynPPContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == caitlynPPRawBytes {
		t.Fatal("local raw byte length must differ from canonical 1841 (materialization caveat)")
	}
	if caitlynPPPlanRev != "caitlyn-q-piltover-peacemaker-first-enemy-hit-phase-a-v1" || caitlynPPBoundary !=
		"rank5_primary_champion_first_enemy_full_physical_hit; immediate_impact_scaffold; "+
			"physical_210_plus_2_05_total_ad; "+
			"no_cast_timing_attack_timer_reset_direction_range_width_"+
			"line_geometry_multitarget_post_first_enemy_60_percent_trap_reveal_"+
			"full_damage_projectile_spell_shield_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := caitlynPPRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := caitlynPPSHA256HexUpper(seedBytes); got != caitlynPPSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, caitlynPPSeedBlobSHA)
	}
	junitPath := caitlynPPRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := caitlynPPSHA256HexUpper(junitBytes); got != caitlynPPJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, caitlynPPJUnitBlobSHA)
	}
	_ = caitlynPPRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := caitlynPPLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(caitlynPPRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		caitlynPPCandidateKey, caitlynPPTaskKey, caitlynPPPlanRev,
		caitlynPPRequestTitle, caitlynPPResolvedTitle,
		"1306911", "4007583", caitlynPPTimestamp, "1841", "1838",
		caitlynPPContentSHA, caitlynPPLocalRawSHA,
		caitlynPPBoundary, caitlynPPProviderRef, caitlynPPAbilityID, caitlynPPAbilityKey,
		"piltover_peacemaker_first_enemy_hit_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":75}`, `{"op":"const","value":6000}`,
		caitlynPPSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/caitlyn-q.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"total AD", "source.attr.ad.resolved",
		"ability_started",
		"missing game_entities hero_caitlyn",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_caitlyn/ad",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_caitlyn/mana",
		"missing reserved_type",
		"provider_hero_caitlyn_e_90_caliber_net_primary_hit",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range caitlynPPOrderedTags() {
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
	for _, tag := range caitlynPPOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if regexp.MustCompile(`(?im)^\s*[-*]?\s*4\.\s*total[_\s-]?ad\b|(?i)ordered tags[\s\S]{0,400}total[_\s-]?ad`).MatchString(seed) {
		t.Fatal("must not add a total-AD ordered tag")
	}
	if regexp.MustCompile(`(?i)Batch-B\s+prerequisite`).MatchString(seed) {
		t.Fatal("seed must not use Batch-B prerequisite wording")
	}
	if strings.Contains(sqlNoComments, "source.attr.ad.base") {
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
		"phase_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit_impact",
		"sequence_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit_impact",
		"step_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit'\s*,\s*` +
		`'provider_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit'\s*,\s*` +
		`'piltover_peacemaker_first_enemy_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key piltover_peacemaker_first_enemy_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_caitlyn_q_piltover_peacemaker_first_enemy_hit_damage'\s*,\s*` +
		`'piltover_peacemaker_first_enemy_hit_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
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
	if regexp.MustCompile(`(?is)'provider_hero_caitlyn_[pwer]_|'ability_hero_caitlyn_[pwer]_|` +
		`'provider_hero_caitlyn_basic_|'ability_hero_caitlyn_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/W/E/R/basic graph rows")
	}
	for _, banned := range []string{"trap", "reveal", "projectile", "collision", "spell_shield", "attack_reset"} {
		pat := regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.\S*` + banned)
		if pat.MatchString(sqlNoComments) {
			t.Fatalf("must not write excluded surface matching %q", banned)
		}
	}

	for _, want := range []string{
		caitlynPPCandidateKey, caitlynPPTaskKey, caitlynPPPlanRev,
		"lol_generic_caitlyn_piltover_peacemaker_first_enemy_hit_seed.sql",
		"LolGenericCaitlynPiltoverPeacemakerFirstEnemyHitSeedSqlTest",
		"external existing-data",
		"physical_210_plus_2_05_total_ad",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Caitlyn identity/panel/resource")
	}
	if strings.Contains(readme, "fixture_caitlyn_piltover_peacemaker_first_enemy_hit_total_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production Q behavior")
	}

	compileReq, _ := loadCaitlynPPFixture(t, caitlynPPFixtureOpts{
		resolvedAD: caitlynPPADResolvedDefault, armor: caitlynPPTargetArmor, mana: caitlynPPFixtureManaCD,
	})
	assertCaitlynPPProviderShape(t, compileReq, 1, true)
	rawX := caitlynPPExpectedRawFromTotalAD(caitlynPPADResolvedDefault)
	if math.Abs(rawX-caitlynPPExpectedRawDefault) > caitlynPPTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, caitlynPPExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, caitlynPPTargetArmor)
	if math.Abs(mitX-caitlynPPExpectedMitDefault) > caitlynPPTol {
		t.Fatalf("default mit=%v want %v", mitX, caitlynPPExpectedMitDefault)
	}
	bonusOnly := caitlynPPExpectedRawFromTotalAD(caitlynPPADResolvedDefault - caitlynPPADBase)
	if math.Abs(bonusOnly-caitlynPPExpectedRawDefault) < caitlynPPTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	baseOnly := caitlynPPExpectedRawFromTotalAD(caitlynPPADBase)
	if math.Abs(baseOnly-caitlynPPExpectedRawDefault) < caitlynPPTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestCaitlynPiltoverPeacemakerFirstEnemyHitFormulaMitigationTable: totalAD0/100/200 ×
// armor0/100 raw/mitigated table from the frozen deterministic fixtures.
func TestCaitlynPiltoverPeacemakerFirstEnemyHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, armor      float64
		wantRaw, wantMitigated float64
	}{
		{"totalAD0_armor0", 0, 0, 210, 210},
		{"totalAD0_armor100", 0, 100, 210, 105},
		{"totalAD100_armor0", 100, 0, 415, 415},
		{"totalAD100_armor100", 100, 100, 415, 207.5},
		{"totalAD200_armor100", 200, 100, 620, 310},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := caitlynPPExpectedRawFromTotalAD(tc.resolvedAD)
			if math.Abs(rawX-tc.wantRaw) > caitlynPPTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > caitlynPPTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadCaitlynPPFixture(t, caitlynPPFixtureOpts{
				resolvedAD: tc.resolvedAD, armor: tc.armor, mana: caitlynPPFixtureManaCD,
			})
			wantBase := caitlynPPFixtureADBase(tc.resolvedAD)
			assertCaitlynPPProviderShape(t, compileReq, 1, tc.resolvedAD != wantBase)
			ref := caitlynPPAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runCaitlynPP(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := caitlynPPDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			caitlynPPAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > caitlynPPTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(caitlynPPSourceAttrBase(t, done.FinalSnapshot, "ad")-wantBase) > caitlynPPTol {
				t.Fatalf("ad.base=%v want %v", caitlynPPSourceAttrBase(t, done.FinalSnapshot, "ad"), wantBase)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(caitlynPPAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(caitlynPPAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestCaitlynPiltoverPeacemakerFirstEnemyHitCooldownMana225AbilityStarted: mana225/
// HP1000/AD100/armor100 at t0/t5999/t6000 → success/skip/success; final mana75/
// HP585; two Q damage items and two automatic Q ability_started events.
func TestCaitlynPiltoverPeacemakerFirstEnemyHitCooldownMana225AbilityStarted(t *testing.T) {
	compileReq, runReq := loadCaitlynPPFixture(t, caitlynPPFixtureOpts{
		resolvedAD: caitlynPPADResolvedDefault, armor: caitlynPPTargetArmor,
		mana: caitlynPPFixtureManaCD, hp: caitlynPPTargetHP,
	})
	assertCaitlynPPProviderShape(t, compileReq, 1, true)
	ref := caitlynPPAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6000},
	}
	runReq.StopPolicy.DurationMs = 6100
	done := runCaitlynPP(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if caitlynPPSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findCaitlynPPAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt5999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 5999 {
			t.Fatalf("cooldown skip TimeMs=%d want 5999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 6000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 6000", item.Data["readyAtMs"])
		}
		skipAt5999 = true
	}
	if !skipAt5999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=5999 with readyAtMs=6000")
	}

	items := caitlynPPDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 6000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		caitlynPPAssertDamage(t, item, caitlynPPExpectedRawDefault, caitlynPPExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * caitlynPPExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-caitlynPPHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, caitlynPPHPAfter2)
	}
	gotMana := caitlynPPSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-caitlynPPManaAfter2) > caitlynPPTol {
		t.Fatalf("mana=%v want %v", gotMana, caitlynPPManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := caitlynPPAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 6000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-caitlynPPADResolvedDefault) > caitlynPPTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), caitlynPPADResolvedDefault)
	}
	if math.Abs(caitlynPPSourceAttrBase(t, done.FinalSnapshot, "ad")-caitlynPPADBase) > caitlynPPTol {
		t.Fatalf("ad.base=%v want %v", caitlynPPSourceAttrBase(t, done.FinalSnapshot, "ad"), caitlynPPADBase)
	}
}

// TestCaitlynPiltoverPeacemakerFirstEnemyHitResourceInsufficientMana74: mana74 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/event.
func TestCaitlynPiltoverPeacemakerFirstEnemyHitResourceInsufficientMana74(t *testing.T) {
	compileReq, runReq := loadCaitlynPPFixture(t, caitlynPPFixtureOpts{
		resolvedAD: caitlynPPADResolvedDefault, armor: caitlynPPTargetArmor,
		mana: caitlynPPFixtureManaShort, hp: caitlynPPTargetHP,
	})
	ref := caitlynPPAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCaitlynPP(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if caitlynPPSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(caitlynPPSourceMana(t, done.FinalSnapshot)-caitlynPPFixtureManaShort) > caitlynPPTol {
		t.Fatalf("mana changed: got %v want %v",
			caitlynPPSourceMana(t, done.FinalSnapshot), caitlynPPFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-caitlynPPTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, caitlynPPTargetHP)
	}
	if len(caitlynPPDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(caitlynPPAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestCaitlynPiltoverPeacemakerFirstEnemyHitStandaloneNoSiblingSynthesis: standalone Q
// provider does not synthesize P/W/E/R/basic/trap/reveal/projectile or overwrite
// unrelated definitions; isolated from existing Caitlyn E.
func TestCaitlynPiltoverPeacemakerFirstEnemyHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadCaitlynPPFixture(t, caitlynPPFixtureOpts{
		resolvedAD: caitlynPPADResolvedDefault, armor: caitlynPPTargetArmor, mana: caitlynPPFixtureManaCD,
	})
	assertCaitlynPPProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_caitlyn_piltover_peacemaker_unrelated_sentinel"
	sentinelStable := "fixture_caitlyn_piltover_peacemaker_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != caitlynPPProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != caitlynPPProviderRef {
			t.Fatalf("source snapshots=%+v want only Q", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_caitlyn_[pwer]_|ability_hero_caitlyn_[pwer]_|` +
		`provider_hero_caitlyn_basic_|ability_hero_caitlyn_basic_|` +
		`(?i)trap|reveal|projectile|attack[_-]?reset`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == caitlynPPProviderRef || p.StableID == caitlynPPStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic/excluded provider: %+v", p)
		}
		if p.ProviderKey != caitlynPPProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := caitlynPPAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCaitlynPP(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(caitlynPPDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(caitlynPPDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(caitlynPPAbilityStartedEvidence(done)) != 1 {
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
				if ps.ProviderRef == caitlynPPProviderRef || ps.DefinitionRef == caitlynPPProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic/excluded: %+v", ps)
			}
		}
	}
}

// TestCaitlynPiltoverPeacemakerFirstEnemyHitDeterminismAndLifecycle: repeated
// compile/run evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame
// and wrong/missing/released session behavior.
func TestCaitlynPiltoverPeacemakerFirstEnemyHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadCaitlynPPFixture(t, caitlynPPFixtureOpts{
				resolvedAD: caitlynPPADResolvedDefault, armor: caitlynPPTargetArmor, mana: caitlynPPFixtureManaCD,
			})
			ref := caitlynPPAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6000},
			}
			r.StopPolicy.DurationMs = 6100
			done := runCaitlynPP(t, c, r)
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
		c, r := loadCaitlynPPFixture(t, caitlynPPFixtureOpts{
			resolvedAD: caitlynPPADResolvedDefault, armor: caitlynPPTargetArmor, mana: caitlynPPFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: caitlynPPAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runCaitlynPPFrames(t, c, r)
		if len(caitlynPPDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(caitlynPPDamageEvidence(done)))
		}
		caitlynPPAssertDamage(t, caitlynPPDamageEvidence(done)[0], caitlynPPExpectedRawDefault, caitlynPPExpectedMitDefault)
		if len(caitlynPPAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadCaitlynPPFixture(t, caitlynPPFixtureOpts{
			resolvedAD: caitlynPPADResolvedDefault, armor: caitlynPPTargetArmor, mana: caitlynPPFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: caitlynPPAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
