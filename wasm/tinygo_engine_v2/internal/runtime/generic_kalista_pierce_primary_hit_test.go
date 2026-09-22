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

// hero_kalista Q Pierce / 穿刺 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: kalista-q-pierce-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold;
//	physical_270_plus_1_05_total_ad; no_cast_timing_martial_poise_dash_cancel_direction_
//	range_width_line_geometry_multitarget_first_enemy_collision_projectile_interception_
//	spell_shield_kill_continuation_rend_stack_transfer_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_kalista|Q|穿刺
//	task wasm-generic-kalista-pierce-primary-hit
//	Request Template:Data Kalista/Q → resolved Template:Data Kalista/Pierce
//	wikiPageId 1307666 / rev 3997075 / timestamp 2026-03-06T15:53:18Z
//	canonical rawByteSize 1625 / SHA256
//	  90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67
//	数据参考/lol-wiki-current-champions/normalized/generic/kalista-q.json
//	pages/raw siblings: pages/kalista-q.json, raw/kalista-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_kalista_pierce_primary_hit_seed.sql
//	Local raw materialization caveat: 1623 bytes / SHA256
//	  0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_kalista_q_pierce_primary_hit
//     (standalone; not P/W/E/R/basic synthesis)
//   - ability ability_hero_kalista_q_pierce_primary_hit with ability_key
//     pierce_primary_hit: active; mana 80; cooldown 9000 ms
//   - Exactly one immediate direct-target physical damage op:
//     270 + 1.05*source.attr.ad.resolved
//     (AD is total AD; never subtract base AD; never call it bonus AD)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No Kalista state/modifier/listener/repeat/control/projectile/collision/
//     spell-shield/kill/Rend/movement/dash; no explicit event op — successful
//     cast relies on runtime automatic ability_started. Fixture-only AD
//     modifier may set resolved total AD and is clearly test-only. Fixture may
//     supply entity/attribute/resource values but must not claim the seed
//     materializes them (external existing-data / check-only).
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast timing / Effect at cast time end, Martial Poise / dash cancel,
//   direction/range/width/line geometry/multitarget/first-enemy collision,
//   projectile/interception/spell shield, kill continuation / Rend stack
//   transfer, ranks 1–4, siblings/basic/loadout/crit/on-hit, live/E2E/full
//   fidelity.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage,
// immediate_impact_scaffold (no total-AD ordered tag).

const (
	kalistaPierceCandidateKey  = "hero_skill|hero_kalista|Q|穿刺"
	kalistaPierceTaskKey       = "wasm-generic-kalista-pierce-primary-hit"
	kalistaPiercePlanRev       = "kalista-q-pierce-primary-hit-phase-a-v1"
	kalistaPierceRequestTitle  = "Template:Data Kalista/Q"
	kalistaPierceResolvedTitle = "Template:Data Kalista/Pierce"
	kalistaPierceWikiPageID    = 1307666
	kalistaPierceRevisionID    = 3997075
	kalistaPierceTimestamp     = "2026-03-06T15:53:18Z"
	kalistaPierceRawBytes      = 1625
	kalistaPierceLocalRawBytes = 1623
	kalistaPierceContentSHA    = "90c490d921da436134c318249fa7d0038ceaa97dfb76e5bdaa0b330a43676a67"
	kalistaPierceLocalRawSHA   = "0b8dd9cf9b40aae52fb6180ecabae7e459970f2f7c4d05711463df25fdbd1c94"
	kalistaPierceBoundary      = "rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; " +
		"physical_270_plus_1_05_total_ad; " +
		"no_cast_timing_martial_poise_dash_cancel_direction_range_width_" +
		"line_geometry_multitarget_first_enemy_collision_projectile_" +
		"interception_spell_shield_kill_continuation_rend_stack_transfer_" +
		"other_ranks_or_full_fidelity"

	kalistaPierceProviderRef = "provider_hero_kalista_q_pierce_primary_hit"
	kalistaPierceStableID    = "hero_kalista_q_pierce_primary_hit"
	kalistaPierceAbilityID   = "ability_hero_kalista_q_pierce_primary_hit"
	kalistaPierceAbilityKey  = "pierce_primary_hit"
	kalistaPierceDamageOpRef = "op:kalista_pierce_primary_hit_damage"
	kalistaPierceTotalADMod  = "fixture_kalista_pierce_primary_hit_total_ad"

	kalistaPierceSeedBlobSHA  = "6F273A57008327959C004A5043C046C08CA6D0E12216E33AF17DCE8EB3799AF4"
	kalistaPierceJUnitBlobSHA = "2F42B6AC5EE3272325B2B91F724C7D3A27A534A0DE369F55386122FEF469C885"

	kalistaPierceBaseDamage = 270.0
	kalistaPierceADRatio    = 1.05
	kalistaPierceManaCost   = 80.0
	kalistaPierceCDMs       = 9000.0

	// Fixture base stays independent; flat modifier raises ad.resolved to total AD.
	kalistaPierceADBase            = 59.0
	kalistaPierceADResolvedDefault = 100.0
	kalistaPierceFixtureManaCD     = 240.0
	kalistaPierceFixtureManaShort  = 79.0
	kalistaPierceTargetArmor       = 100.0
	kalistaPierceTargetHP          = 1000.0

	kalistaPierceExpectedRawDefault = 375.0 // 270 + 1.05*100
	kalistaPierceExpectedMitDefault = 187.5 // armor100
	kalistaPierceManaAfter2         = 80.0  // 240 - 80 - 80
	kalistaPierceHPAfter2           = 625.0 // 1000 - 187.5 - 187.5

	kalistaPierceSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":270},` +
		`{"op":"mul","args":[{"op":"const","value":1.05},` +
		`{"op":"read","path":"source.attr.ad.resolved"}]}]}`

	kalistaPierceTol = 1e-9
)

func kalistaPierceOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"immediate_impact_scaffold",
	}
}

func kalistaPierceExpectedRawFromTotalAD(resolvedAD float64) float64 {
	return kalistaPierceBaseDamage + kalistaPierceADRatio*resolvedAD
}

func kalistaPierceDamageAmount() *model.GenericFormulaExpr {
	base := kalistaPierceBaseDamage
	adRatio := kalistaPierceADRatio
	// Binary add only: const 270 + mul(1.05, source.attr.ad.resolved).
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

func kalistaPierceAbility() model.AbilityDefinition {
	cost := kalistaPierceManaCost
	cd := kalistaPierceCDMs
	return model.AbilityDefinition{
		AbilityKey: kalistaPierceAbilityKey,
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
				Ref:           kalistaPierceDamageOpRef,
				Amount:        kalistaPierceDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func kalistaPierceProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: kalistaPierceProviderRef,
		Kind:        "champion",
		StableID:    kalistaPierceStableID,
		Abilities:   []model.AbilityDefinition{kalistaPierceAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed Q provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: kalistaPierceTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func kalistaPierceAbilityRef() string {
	return "source.provider[" + kalistaPierceProviderRef + "].ability[" + kalistaPierceAbilityKey + "]"
}

type kalistaPierceFixtureOpts struct {
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func kalistaPierceFixtureADBase(resolvedAD float64) float64 {
	// Negative flat modifiers do not drive ad.resolved to 0 under current
	// attribute resolution; totalAD0 is assembled with fixture base=0 instead.
	// Positive total-AD cases keep an independent non-zero base (Jinx/Jhin pattern).
	if resolvedAD == 0 {
		return 0
	}
	return kalistaPierceADBase
}

func configureKalistaPierceProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts kalistaPierceFixtureOpts) {
	flat := opts.resolvedAD - kalistaPierceFixtureADBase(opts.resolvedAD)
	p := kalistaPierceProviderDef(flat)
	compileReq.SharedProviders = []model.ProviderDefinition{p}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: kalistaPierceProviderRef, DefinitionRef: kalistaPierceProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: kalistaPierceProviderRef, DefinitionRef: kalistaPierceProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureKalistaPierceTypes(req *model.CompileRequest) {
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

func loadKalistaPierceFixture(t *testing.T, opts kalistaPierceFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAD/armor explicitly (totalAD0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = kalistaPierceFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = kalistaPierceTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureKalistaPierceTypes(&compileReq)
	configureKalistaPierceProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_kalista / ad / mana identity or panel/resource rows.
	adBase := kalistaPierceFixtureADBase(opts.resolvedAD)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: adBase, Current: adBase,
		Max: adBase, Resolved: adBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, kalistaPierceFixtureManaCD),
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

func runKalistaPierce(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runKalistaPierceFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func kalistaPierceSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func kalistaPierceSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func kalistaPierceSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func kalistaPierceDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := kalistaPierceAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != kalistaPierceDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func kalistaPierceAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func kalistaPierceFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == kalistaPierceProviderRef {
			return p
		}
	}
	return nil
}

func assertKalistaPierceProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := kalistaPierceFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_kalista_q_pierce_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != kalistaPierceProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, kalistaPierceProviderRef)
	}
	if p.StableID != kalistaPierceStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, kalistaPierceStableID)
	}
	banned := []string{
		"provider_hero_kalista_p_", "provider_hero_kalista_w_", "provider_hero_kalista_e_",
		"provider_hero_kalista_r_", "provider_hero_kalista_basic_",
		"ability_hero_kalista_p_", "ability_hero_kalista_w_", "ability_hero_kalista_e_",
		"ability_hero_kalista_r_", "ability_hero_kalista_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("pierce primary-hit must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != kalistaPierceTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], kalistaPierceTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), kalistaPierceAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != kalistaPierceAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, kalistaPierceAbilityKey, kalistaPierceAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("pierce_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-kalistaPierceManaCost) > kalistaPierceTol {
		t.Fatalf("cost=%+v want mana const 80", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-kalistaPierceCDMs) > kalistaPierceTol {
		t.Fatalf("cooldown=%+v want const 9000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("pierce damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("pierce damage must not be copyable on hit")
	}
	if op.Ref != kalistaPierceDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, kalistaPierceDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 270, mul(1.05, ad.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-kalistaPierceBaseDamage) > kalistaPierceTol {
		t.Fatalf("base const=%+v want 270", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-kalistaPierceADRatio) > kalistaPierceTol {
		t.Fatalf("AD ratio=%+v want 1.05", adMul.Args[0])
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
			bannedOp.Operation == "control" || bannedOp.Operation == "dash" ||
			bannedOp.Operation == "movement" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" {
			t.Fatalf("pierce must not include excluded op: %+v", bannedOp)
		}
	}
}

func findKalistaPierceAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := kalistaPierceAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func kalistaPierceRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func kalistaPierceLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(kalistaPierceRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_kalista_pierce_primary_hit_seed.sql"))
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

func kalistaPierceSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func kalistaPierceSHA256HexUpper(b []byte) string {
	return strings.ToUpper(kalistaPierceSHA256Hex(b))
}

func kalistaPierceAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > kalistaPierceTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > kalistaPierceTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != kalistaPierceDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), kalistaPierceDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != kalistaPierceAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), kalistaPierceAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != kalistaPierceProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), kalistaPierceProviderRef)
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

// TestKalistaPiercePrimaryHitSourceSeedProviderFormulaShape locks wiki/sidecar/pages/
// local-raw caveat, seed/README/JUnit identities and source blob hashes,
// external-existing-data check-only prerequisites / non-materialization, and Q
// provider/total-AD formula shape.
func TestKalistaPiercePrimaryHitSourceSeedProviderFormulaShape(t *testing.T) {
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
	sidecarRaw, err := os.ReadFile(kalistaPierceRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "kalista-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != kalistaPierceCandidateKey || doc.RequestTitle != kalistaPierceRequestTitle ||
		doc.ResolvedTitle != kalistaPierceResolvedTitle || doc.WikiPageID != kalistaPierceWikiPageID ||
		doc.RevisionID != kalistaPierceRevisionID || doc.RevisionTimestamp != kalistaPierceTimestamp ||
		doc.ContentSHA256 != kalistaPierceContentSHA || doc.RawByteSize != kalistaPierceRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "穿刺" || doc.OwnerID != "hero_kalista" {
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
	if doc.Fields.Cost != "{{ap|60 to 80}}\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "9\n" {
		t.Fatalf("cooldown=%q want 9s (rank-5 / fixed)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|10 to 270}}") ||
		!strings.Contains(doc.Fields.Leveling, "105% AD") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "first enemy") {
		t.Fatal("wiki prose must retain excluded first-enemy physical hit surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "Rend") ||
		!strings.Contains(doc.Fields.Description2, "kills") {
		t.Fatal("wiki prose must retain excluded kill continuation / Rend transfer surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing Effect at cast time end (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "Martial Poise") {
		t.Fatalf("notes missing Martial Poise (excluded): %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(kalistaPierceRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "kalista-q.json"))
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "穿刺" || pages.OwnerID != "hero_kalista" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(kalistaPierceRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "kalista-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != kalistaPierceLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), kalistaPierceLocalRawBytes)
	}
	localSHA := kalistaPierceSHA256Hex(rawBytes)
	if localSHA != kalistaPierceLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, kalistaPierceLocalRawSHA)
	}
	if localSHA == kalistaPierceContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == kalistaPierceRawBytes {
		t.Fatal("local raw byte length must differ from canonical 1625 (materialization caveat)")
	}
	if kalistaPiercePlanRev != "kalista-q-pierce-primary-hit-phase-a-v1" || kalistaPierceBoundary !=
		"rank5_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; "+
			"physical_270_plus_1_05_total_ad; "+
			"no_cast_timing_martial_poise_dash_cancel_direction_range_width_"+
			"line_geometry_multitarget_first_enemy_collision_projectile_"+
			"interception_spell_shield_kill_continuation_rend_stack_transfer_"+
			"other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := kalistaPierceRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_kalista_pierce_primary_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := kalistaPierceSHA256HexUpper(seedBytes); got != kalistaPierceSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, kalistaPierceSeedBlobSHA)
	}
	junitPath := kalistaPierceRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericKalistaPiercePrimaryHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := kalistaPierceSHA256HexUpper(junitBytes); got != kalistaPierceJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, kalistaPierceJUnitBlobSHA)
	}
	_ = kalistaPierceRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := kalistaPierceLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(kalistaPierceRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		kalistaPierceCandidateKey, kalistaPierceTaskKey, kalistaPiercePlanRev,
		kalistaPierceRequestTitle, kalistaPierceResolvedTitle,
		"1307666", "3997075", kalistaPierceTimestamp, "1625", "1623",
		kalistaPierceContentSHA, kalistaPierceLocalRawSHA,
		kalistaPierceBoundary, kalistaPierceProviderRef, kalistaPierceAbilityID, kalistaPierceAbilityKey,
		"pierce_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":80}`, `{"op":"const","value":9000}`,
		kalistaPierceSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/kalista-q.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"total AD", "source.attr.ad.resolved",
		"ability_started",
		"missing game_entities hero_kalista",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_kalista/ad",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_kalista/mana",
		"missing reserved_type",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range kalistaPierceOrderedTags() {
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
	for _, tag := range kalistaPierceOrderedTags() {
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
		"phase_hero_kalista_q_pierce_primary_hit_impact",
		"sequence_hero_kalista_q_pierce_primary_hit_impact",
		"step_hero_kalista_q_pierce_primary_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_kalista_q_pierce_primary_hit'\s*,\s*` +
		`'provider_hero_kalista_q_pierce_primary_hit'\s*,\s*` +
		`'pierce_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key pierce_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_kalista_q_pierce_primary_hit_damage'\s*,\s*` +
		`'pierce_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
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
	if regexp.MustCompile(`(?is)'provider_hero_kalista_[pwer]_|'ability_hero_kalista_[pwer]_|` +
		`'provider_hero_kalista_basic_|'ability_hero_kalista_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/W/E/R/basic graph rows")
	}
	for _, banned := range []string{"rend", "dash", "projectile", "collision", "spell_shield", "martial"} {
		pat := regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.\S*` + banned)
		if pat.MatchString(sqlNoComments) {
			t.Fatalf("must not write excluded surface matching %q", banned)
		}
	}

	for _, want := range []string{
		kalistaPierceCandidateKey, kalistaPierceTaskKey, kalistaPiercePlanRev,
		"lol_generic_kalista_pierce_primary_hit_seed.sql",
		"LolGenericKalistaPiercePrimaryHitSeedSqlTest",
		"external existing-data",
		"physical_270_plus_1_05_total_ad",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Kalista identity/panel/resource")
	}
	if strings.Contains(readme, "fixture_kalista_pierce_primary_hit_total_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production Q behavior")
	}

	compileReq, _ := loadKalistaPierceFixture(t, kalistaPierceFixtureOpts{
		resolvedAD: kalistaPierceADResolvedDefault, armor: kalistaPierceTargetArmor, mana: kalistaPierceFixtureManaCD,
	})
	assertKalistaPierceProviderShape(t, compileReq, 1, true)
	rawX := kalistaPierceExpectedRawFromTotalAD(kalistaPierceADResolvedDefault)
	if math.Abs(rawX-kalistaPierceExpectedRawDefault) > kalistaPierceTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, kalistaPierceExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, kalistaPierceTargetArmor)
	if math.Abs(mitX-kalistaPierceExpectedMitDefault) > kalistaPierceTol {
		t.Fatalf("default mit=%v want %v", mitX, kalistaPierceExpectedMitDefault)
	}
	bonusOnly := kalistaPierceExpectedRawFromTotalAD(kalistaPierceADResolvedDefault - kalistaPierceADBase)
	if math.Abs(bonusOnly-kalistaPierceExpectedRawDefault) < kalistaPierceTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	baseOnly := kalistaPierceExpectedRawFromTotalAD(kalistaPierceADBase)
	if math.Abs(baseOnly-kalistaPierceExpectedRawDefault) < kalistaPierceTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestKalistaPiercePrimaryHitFormulaMitigationTable: totalAD0/100/200 × armor0/100
// raw/mitigated table from the frozen deterministic fixtures.
func TestKalistaPiercePrimaryHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, armor      float64
		wantRaw, wantMitigated float64
	}{
		{"totalAD0_armor0", 0, 0, 270, 270},
		{"totalAD0_armor100", 0, 100, 270, 135},
		{"totalAD100_armor0", 100, 0, 375, 375},
		{"totalAD100_armor100", 100, 100, 375, 187.5},
		{"totalAD200_armor100", 200, 100, 480, 240},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := kalistaPierceExpectedRawFromTotalAD(tc.resolvedAD)
			if math.Abs(rawX-tc.wantRaw) > kalistaPierceTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > kalistaPierceTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadKalistaPierceFixture(t, kalistaPierceFixtureOpts{
				resolvedAD: tc.resolvedAD, armor: tc.armor, mana: kalistaPierceFixtureManaCD,
			})
			wantBase := kalistaPierceFixtureADBase(tc.resolvedAD)
			assertKalistaPierceProviderShape(t, compileReq, 1, tc.resolvedAD != wantBase)
			ref := kalistaPierceAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runKalistaPierce(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := kalistaPierceDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			kalistaPierceAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > kalistaPierceTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(kalistaPierceSourceAttrBase(t, done.FinalSnapshot, "ad")-wantBase) > kalistaPierceTol {
				t.Fatalf("ad.base=%v want %v", kalistaPierceSourceAttrBase(t, done.FinalSnapshot, "ad"), wantBase)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(kalistaPierceAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(kalistaPierceAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestKalistaPiercePrimaryHitCooldownMana240AbilityStarted: mana240/HP1000/AD100/armor100
// at t0/t8999/t9000 → success/skip/success; final mana80/HP625; two Q damage items
// and two automatic Q ability_started events.
func TestKalistaPiercePrimaryHitCooldownMana240AbilityStarted(t *testing.T) {
	compileReq, runReq := loadKalistaPierceFixture(t, kalistaPierceFixtureOpts{
		resolvedAD: kalistaPierceADResolvedDefault, armor: kalistaPierceTargetArmor,
		mana: kalistaPierceFixtureManaCD, hp: kalistaPierceTargetHP,
	})
	assertKalistaPierceProviderShape(t, compileReq, 1, true)
	ref := kalistaPierceAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9000},
	}
	runReq.StopPolicy.DurationMs = 9100
	done := runKalistaPierce(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if kalistaPierceSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findKalistaPierceAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt8999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 8999 {
			t.Fatalf("cooldown skip TimeMs=%d want 8999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 9000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 9000", item.Data["readyAtMs"])
		}
		skipAt8999 = true
	}
	if !skipAt8999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=8999 with readyAtMs=9000")
	}

	items := kalistaPierceDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 9000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		kalistaPierceAssertDamage(t, item, kalistaPierceExpectedRawDefault, kalistaPierceExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * kalistaPierceExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-kalistaPierceHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, kalistaPierceHPAfter2)
	}
	gotMana := kalistaPierceSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-kalistaPierceManaAfter2) > kalistaPierceTol {
		t.Fatalf("mana=%v want %v", gotMana, kalistaPierceManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := kalistaPierceAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 9000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-kalistaPierceADResolvedDefault) > kalistaPierceTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), kalistaPierceADResolvedDefault)
	}
	if math.Abs(kalistaPierceSourceAttrBase(t, done.FinalSnapshot, "ad")-kalistaPierceADBase) > kalistaPierceTol {
		t.Fatalf("ad.base=%v want %v", kalistaPierceSourceAttrBase(t, done.FinalSnapshot, "ad"), kalistaPierceADBase)
	}
}

// TestKalistaPiercePrimaryHitResourceInsufficientMana79: mana79 at t0 → resource_insufficient;
// mana/HP unchanged; zero Q damage/event.
func TestKalistaPiercePrimaryHitResourceInsufficientMana79(t *testing.T) {
	compileReq, runReq := loadKalistaPierceFixture(t, kalistaPierceFixtureOpts{
		resolvedAD: kalistaPierceADResolvedDefault, armor: kalistaPierceTargetArmor,
		mana: kalistaPierceFixtureManaShort, hp: kalistaPierceTargetHP,
	})
	ref := kalistaPierceAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runKalistaPierce(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if kalistaPierceSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(kalistaPierceSourceMana(t, done.FinalSnapshot)-kalistaPierceFixtureManaShort) > kalistaPierceTol {
		t.Fatalf("mana changed: got %v want %v",
			kalistaPierceSourceMana(t, done.FinalSnapshot), kalistaPierceFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-kalistaPierceTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, kalistaPierceTargetHP)
	}
	if len(kalistaPierceDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(kalistaPierceAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestKalistaPiercePrimaryHitStandaloneNoSiblingSynthesis: standalone Q provider does not
// synthesize P/W/E/R/basic/Rend/dash/projectile or overwrite unrelated definitions.
func TestKalistaPiercePrimaryHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadKalistaPierceFixture(t, kalistaPierceFixtureOpts{
		resolvedAD: kalistaPierceADResolvedDefault, armor: kalistaPierceTargetArmor, mana: kalistaPierceFixtureManaCD,
	})
	assertKalistaPierceProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_kalista_pierce_unrelated_sentinel"
	sentinelStable := "fixture_kalista_pierce_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != kalistaPierceProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != kalistaPierceProviderRef {
			t.Fatalf("source snapshots=%+v want only Q", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_kalista_[pwer]_|ability_hero_kalista_[pwer]_|` +
		`provider_hero_kalista_basic_|ability_hero_kalista_basic_|` +
		`(?i)rend|dash|projectile|martial`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == kalistaPierceProviderRef || p.StableID == kalistaPierceStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic/excluded provider: %+v", p)
		}
		if p.ProviderKey != kalistaPierceProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := kalistaPierceAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runKalistaPierce(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(kalistaPierceDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(kalistaPierceDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(kalistaPierceAbilityStartedEvidence(done)) != 1 {
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
				if ps.ProviderRef == kalistaPierceProviderRef || ps.DefinitionRef == kalistaPierceProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic/excluded: %+v", ps)
			}
		}
	}
}

// TestKalistaPiercePrimaryHitDeterminismAndLifecycle: repeated compile/run evidence
// stability plus CompileFrame→RunFrame→ReleaseSessionFrame and wrong/missing/released
// session behavior.
func TestKalistaPiercePrimaryHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadKalistaPierceFixture(t, kalistaPierceFixtureOpts{
				resolvedAD: kalistaPierceADResolvedDefault, armor: kalistaPierceTargetArmor, mana: kalistaPierceFixtureManaCD,
			})
			ref := kalistaPierceAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9000},
			}
			r.StopPolicy.DurationMs = 9100
			done := runKalistaPierce(t, c, r)
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
		c, r := loadKalistaPierceFixture(t, kalistaPierceFixtureOpts{
			resolvedAD: kalistaPierceADResolvedDefault, armor: kalistaPierceTargetArmor, mana: kalistaPierceFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: kalistaPierceAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runKalistaPierceFrames(t, c, r)
		if len(kalistaPierceDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(kalistaPierceDamageEvidence(done)))
		}
		kalistaPierceAssertDamage(t, kalistaPierceDamageEvidence(done)[0], kalistaPierceExpectedRawDefault, kalistaPierceExpectedMitDefault)
		if len(kalistaPierceAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadKalistaPierceFixture(t, kalistaPierceFixtureOpts{
			resolvedAD: kalistaPierceADResolvedDefault, armor: kalistaPierceTargetArmor, mana: kalistaPierceFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: kalistaPierceAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
