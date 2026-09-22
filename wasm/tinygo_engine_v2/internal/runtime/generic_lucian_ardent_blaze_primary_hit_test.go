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

// hero_lucian W Ardent Blaze / 热诚烈弹 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: lucian-w-ardent-blaze-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_champion_single_magic_hit; immediate_impact_scaffold;
//	magic_215_plus_0_90_ap; no_cast_timing_effect_at_cast_time_end_direction_range_
//	missile_collision_cross_explosion_geometry_multitarget_aoe_sight_mark_movement_
//	speed_allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_shield_
//	exception_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_lucian|W|热诚烈弹
//	task wasm-generic-lucian-ardent-blaze-primary-hit
//	Request Template:Data Lucian/W → resolved Template:Data Lucian/Ardent Blaze
//	wikiPageId 1308178 / rev 3594941 / timestamp 2023-09-12T19:08:23Z
//	canonical rawByteSize 2542 / SHA256
//	  b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5
//	数据参考/lol-wiki-current-champions/normalized/generic/lucian-w.json
//	pages/raw siblings: pages/lucian-w.json, raw/lucian-w.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_lucian_ardent_blaze_primary_hit_seed.sql
//	Local raw materialization caveat: also 2542 bytes / SHA256
//	  a57b0e49765ab5a9bdd30ad295d24e406a90015b083c8a0e817855c6bc152236.
//	Same-size caveat; assert sidecar/pages canonical identity + caveat; do not claim
//	local-raw equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_lucian_w_ardent_blaze_primary_hit
//     (standalone; not P/Q/E/R/basic synthesis; does not require Lucian Q publication)
//   - ability ability_hero_lucian_w_ardent_blaze_primary_hit with ability_key
//     ardent_blaze_primary_hit: active; mana 60; cooldown 10000 ms
//   - Exactly one immediate direct-target magic damage op:
//     add(const 215, mul(const 0.90, read source.attr.ap.resolved))
//     (AP is direct resolved read exactly once; binary add only)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: magic 20221 + add policy 20170; 20230 forbidden
//   - No Lucian W state/modifier/listener/matcher/repeat/control/projectile/
//     geometry/AOE/sight/mark/movement-speed/Vigilance/sibling; no explicit
//     event op — successful cast relies on runtime automatic ability_started.
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) but must not claim the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast timing / Effect at cast time end; direction / range / acquisition;
//   missile / travel / collision; cross explosion geometry / AOE / multitarget;
//   sight; six-second mark; movement-speed; allied trigger / Vigilance;
//   dodge / block / blind / persistent-damage; spell-shield mark exception;
//   ranks 1–4; siblings/basic/loadout/crit/on-hit; live/E2E/full fidelity.
//
// Ordered tags: ability_cost_cooldown, active_magic_damage, ap_ratio,
// immediate_impact_scaffold.

const (
	lucianABCandidateKey  = "hero_skill|hero_lucian|W|热诚烈弹"
	lucianABTaskKey       = "wasm-generic-lucian-ardent-blaze-primary-hit"
	lucianABPlanRev       = "lucian-w-ardent-blaze-primary-hit-phase-a-v1"
	lucianABRequestTitle  = "Template:Data Lucian/W"
	lucianABResolvedTitle = "Template:Data Lucian/Ardent Blaze"
	lucianABWikiPageID    = 1308178
	lucianABRevisionID    = 3594941
	lucianABTimestamp     = "2023-09-12T19:08:23Z"
	lucianABRawBytes      = 2542
	lucianABLocalRawBytes = 2542
	lucianABContentSHA    = "b1ea7bc7a2e48be9ab97acfa1fc5addb80b8dd236dc97bd3d57c5e90951418c5"
	lucianABLocalRawSHA   = "a57b0e49765ab5a9bdd30ad295d24e406a90015b083c8a0e817855c6bc152236"
	lucianABBoundary      = "rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; " +
		"magic_215_plus_0_90_ap; " +
		"no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_" +
		"cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_" +
		"allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_" +
		"shield_exception_other_ranks_or_full_fidelity"

	lucianABProviderRef = "provider_hero_lucian_w_ardent_blaze_primary_hit"
	lucianABStableID    = "hero_lucian_w_ardent_blaze_primary_hit"
	lucianABAbilityID   = "ability_hero_lucian_w_ardent_blaze_primary_hit"
	lucianABAbilityKey  = "ardent_blaze_primary_hit"
	lucianABDamageOpRef = "op:lucian_ardent_blaze_primary_hit_damage"

	lucianABSeedBlobSHA  = "E9F8F30AB7055300C038FC1AE25460E430A943FB9D2CB4C19F0BA5B489573942"
	lucianABJUnitBlobSHA = "8F5CA7AB895F75D42B1583E18D3745EA25E566BC7E545780FE01375CD0E95466"

	lucianABBaseDamage = 215.0
	lucianABAPRatio    = 0.90
	lucianABManaCost   = 60.0
	lucianABCDMs       = 10000.0

	lucianABFixtureAPDefault = 100.0
	lucianABFixtureManaCD    = 180.0
	lucianABFixtureManaShort = 59.0
	lucianABTargetMR         = 100.0
	lucianABTargetHP         = 1000.0

	lucianABExpectedRawDefault = 305.0 // 215 + 0.90*100
	lucianABExpectedMitDefault = 152.5 // MR100
	lucianABManaAfter2         = 60.0  // 180 - 60 - 60
	lucianABHPAfter2           = 695.0 // 1000 - 152.5 - 152.5

	lucianABSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":215},` +
		`{"op":"mul","args":[{"op":"const","value":0.90},` +
		`{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	lucianABTol = 1e-9
)

func lucianABOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func lucianABExpectedRawFromAP(resolvedAP float64) float64 {
	return lucianABBaseDamage + lucianABAPRatio*resolvedAP
}

func lucianABDamageAmount() *model.GenericFormulaExpr {
	base := lucianABBaseDamage
	apRatio := lucianABAPRatio
	// Binary add only: const 215 + mul(0.90, source.attr.ap.resolved).
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

func lucianABCountAPReads(expr *model.GenericFormulaExpr) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == "source.attr.ap.resolved" {
		n++
	}
	for i := range expr.Args {
		n += lucianABCountAPReads(&expr.Args[i])
	}
	return n
}

func lucianABAbility() model.AbilityDefinition {
	cost := lucianABManaCost
	cd := lucianABCDMs
	return model.AbilityDefinition{
		AbilityKey: lucianABAbilityKey,
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
				Ref:           lucianABDamageOpRef,
				Amount:        lucianABDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func lucianABProviderDef() model.ProviderDefinition {
	// Production/seed W provider has zero modifiers/listeners/state.
	return model.ProviderDefinition{
		ProviderKey: lucianABProviderRef,
		Kind:        "champion",
		StableID:    lucianABStableID,
		Abilities:   []model.AbilityDefinition{lucianABAbility()},
	}
}

func lucianABAbilityRef() string {
	return "source.provider[" + lucianABProviderRef + "].ability[" + lucianABAbilityKey + "]"
}

type lucianABFixtureOpts struct {
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
	withQ      bool
}

func configureLucianABProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, withQ bool) {
	providers := []model.ProviderDefinition{lucianABProviderDef()}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: lucianABProviderRef, DefinitionRef: lucianABProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: lucianABProviderRef, DefinitionRef: lucianABProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if withQ {
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
	compileReq.SharedProviders = providers
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snaps
	}
}

func ensureLucianABTypes(req *model.CompileRequest) {
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

func loadLucianABFixture(t *testing.T, opts lucianABFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAP/mr explicitly (AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = lucianABFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = lucianABTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureLucianABTypes(&compileReq)
	configureLucianABProvider(&compileReq, &runReq, opts.withQ)

	// Fixture-only AP/mana/HP/MR values (external-existing-data/check-only); do not
	// claim seed materializes hero_lucian / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, lucianABFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
	})
	if opts.withQ {
		// Read-only Q coexistence fixture attrs; not claimed as W seed materialization.
		setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
			Base: lucianPLADBase, Current: lucianPLADBase,
			Max: lucianPLADBase, Resolved: lucianPLADBase,
		})
		setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
			Base: lucianPLTargetArmor, Current: lucianPLTargetArmor,
			Max: lucianPLTargetArmor, Resolved: lucianPLTargetArmor,
		})
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runLucianAB(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runLucianABFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func lucianABSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func lucianABSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func lucianABDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := lucianABAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != lucianABDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func lucianABAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func lucianABFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == lucianABProviderRef {
			return p
		}
	}
	return nil
}

func assertLucianABProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := lucianABFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_lucian_w_ardent_blaze_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != lucianABProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, lucianABProviderRef)
	}
	if p.StableID != lucianABStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, lucianABStableID)
	}
	banned := []string{
		"provider_hero_lucian_p_", "provider_hero_lucian_q_", "provider_hero_lucian_e_",
		"provider_hero_lucian_r_", "provider_hero_lucian_basic_",
		"ability_hero_lucian_p_", "ability_hero_lucian_q_", "ability_hero_lucian_e_",
		"ability_hero_lucian_r_", "ability_hero_lucian_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("ardent_blaze primary-hit must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production W has no modifiers)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), lucianABAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != lucianABAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, lucianABAbilityKey, lucianABAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("ardent_blaze_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-lucianABManaCost) > lucianABTol {
		t.Fatalf("cost=%+v want mana const 60", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-lucianABCDMs) > lucianABTol {
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
		t.Fatal("ardent blaze damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("ardent blaze damage must not be copyable on hit")
	}
	if op.Ref != lucianABDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, lucianABDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 215, mul(0.90, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-lucianABBaseDamage) > lucianABTol {
		t.Fatalf("base const=%+v want 215", op.Amount.Args[0])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-lucianABAPRatio) > lucianABTol {
		t.Fatalf("AP ratio=%+v want 0.90", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if lucianABCountAPReads(op.Amount) != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", lucianABCountAPReads(op.Amount))
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "mark" ||
			bannedOp.Operation == "sight" || bannedOp.Operation == "movement_speed" {
			t.Fatalf("ardent blaze must not include excluded op: %+v", bannedOp)
		}
	}
}

func findLucianABAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := lucianABAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func lucianABRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func lucianABLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(lucianABRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_lucian_ardent_blaze_primary_hit_seed.sql"))
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

func lucianABSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func lucianABSHA256HexUpper(b []byte) string {
	return strings.ToUpper(lucianABSHA256Hex(b))
}

func lucianABAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > lucianABTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > lucianABTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != lucianABDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), lucianABDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != lucianABAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), lucianABAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != lucianABProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), lucianABProviderRef)
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

// TestLucianArdentBlazePrimaryHitSourceSeedProviderFormulaShape locks wiki/sidecar/
// pages/local-raw same-size caveat, seed/README/JUnit identities and source blob
// hashes, external-existing-data check-only prerequisites / non-materialization,
// ordered tags, type-policy evidence, and W provider/AP formula shape (AP once).
func TestLucianArdentBlazePrimaryHitSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Description2, Description3, Leveling, Leveling3 string
			Cooldown, Cost, Costtype, Damagetype, Notes                  string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(lucianABRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "lucian-w.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != lucianABCandidateKey || doc.RequestTitle != lucianABRequestTitle ||
		doc.ResolvedTitle != lucianABResolvedTitle || doc.WikiPageID != lucianABWikiPageID ||
		doc.RevisionID != lucianABRevisionID || doc.RevisionTimestamp != lucianABTimestamp ||
		doc.ContentSHA256 != lucianABContentSHA || doc.RawByteSize != lucianABRawBytes ||
		doc.SkillKey != "W" || doc.ZhDisplayName != "热诚烈弹" || doc.OwnerID != "hero_lucian" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "description3", "leveling3",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "60\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|14 to 10}}\n" {
		t.Fatalf("cooldown=%q want {{ap|14 to 10}} (rank-5 = 10s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|75 to 215}}") ||
		!strings.Contains(doc.Fields.Leveling, "90% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") {
		t.Fatal("wiki prose must retain magic damage wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description, "missile") ||
		!strings.Contains(doc.Fields.Description, "cross") ||
		!strings.Contains(doc.Fields.Description, "sight") {
		t.Fatal("wiki prose must retain excluded missile/cross/sight surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "marked") {
		t.Fatal("wiki prose must retain excluded six-second mark surface")
	}
	if !strings.Contains(doc.Fields.Description3, "movement speed") ||
		!strings.Contains(doc.Fields.Description3, "Vigilance") {
		t.Fatal("wiki prose must retain excluded movement-speed/Vigilance surfaces")
	}
	if !strings.Contains(doc.Fields.Leveling3, "Bonus Movement Speed") {
		t.Fatal("wiki prose must retain excluded bonus movement-speed leveling")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing Effect at cast time end (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "dodge") ||
		!strings.Contains(doc.Fields.Notes, "block") ||
		!strings.Contains(doc.Fields.Notes, "blind") {
		t.Fatalf("notes missing dodge/block/blind (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "persistent damage") &&
		!strings.Contains(doc.Fields.Notes, "DoTs") {
		t.Fatalf("notes missing persistent-damage/DoT (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "Spell shield") &&
		!strings.Contains(doc.Fields.Notes, "spell shield") {
		t.Fatalf("notes missing spell-shield mark exception (excluded): %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(lucianABRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "lucian-w.json"))
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
		pages.SkillKey != "W" || pages.ZhDisplayName != "热诚烈弹" || pages.OwnerID != "hero_lucian" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(lucianABRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "lucian-w.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != lucianABLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), lucianABLocalRawBytes)
	}
	if lucianABLocalRawBytes != lucianABRawBytes {
		t.Fatal("local raw and canonical sizes must both be 2542 (same-size caveat)")
	}
	localSHA := lucianABSHA256Hex(rawBytes)
	if localSHA != lucianABLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, lucianABLocalRawSHA)
	}
	if localSHA == lucianABContentSHA {
		t.Fatal("local raw hash must differ from canonical (same-size caveat; not equivalence/contradiction)")
	}
	if lucianABPlanRev != "lucian-w-ardent-blaze-primary-hit-phase-a-v1" || lucianABBoundary !=
		"rank5_primary_champion_single_magic_hit; immediate_impact_scaffold; "+
			"magic_215_plus_0_90_ap; "+
			"no_cast_timing_effect_at_cast_time_end_direction_range_missile_collision_"+
			"cross_explosion_geometry_multitarget_aoe_sight_mark_movement_speed_"+
			"allied_trigger_vigilance_dodge_block_blind_persistent_damage_spell_"+
			"shield_exception_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := lucianABRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_lucian_ardent_blaze_primary_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := lucianABSHA256HexUpper(seedBytes); got != lucianABSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, lucianABSeedBlobSHA)
	}
	junitPath := lucianABRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericLucianArdentBlazePrimaryHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := lucianABSHA256HexUpper(junitBytes); got != lucianABJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, lucianABJUnitBlobSHA)
	}
	_ = lucianABRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := lucianABLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(lucianABRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		lucianABCandidateKey, lucianABTaskKey, lucianABPlanRev,
		lucianABRequestTitle, lucianABResolvedTitle,
		"1308178", "3594941", lucianABTimestamp, "2542",
		lucianABContentSHA, lucianABLocalRawSHA,
		lucianABBoundary, lucianABProviderRef, lucianABAbilityID, lucianABAbilityKey,
		"ardent_blaze_primary_hit_damage", "w_mana_cost", "w_cooldown_ms",
		`{"op":"const","value":60}`, `{"op":"const","value":10000}`,
		lucianABSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/lucian-w.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"source.attr.ap.resolved",
		"ability_started",
		"20221", "20170",
		"Piercing Light",
		"不要求 Lucian Q publication",
		"missing game_entities hero_lucian",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_lucian/ap",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_lucian/mana",
		"missing reserved_type",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range lucianABOrderedTags() {
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
	for _, tag := range lucianABOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if regexp.MustCompile(`(?i)Batch-B\s+prerequisite`).MatchString(seed) {
		t.Fatal("seed must not use Batch-B prerequisite wording")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ap.resolved"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ap.resolved exactly once")
	}
	if strings.Contains(sqlNoComments, `"path":"source.attr.ap.base"`) {
		t.Fatal("executable SQL must not invent ap.base reads")
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.ability_definitions",
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.entity_provider_mounts",
		"phase_hero_lucian_w_ardent_blaze_primary_hit_impact",
		"sequence_hero_lucian_w_ardent_blaze_primary_hit_impact",
		"step_hero_lucian_w_ardent_blaze_primary_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_lucian_w_ardent_blaze_primary_hit'\s*,\s*` +
		`'provider_hero_lucian_w_ardent_blaze_primary_hit'\s*,\s*` +
		`'ardent_blaze_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("W must be active ability with stable key ardent_blaze_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_lucian_w_ardent_blaze_primary_hit_damage'\s*,\s*` +
		`'ardent_blaze_primary_hit_damage'\s*,\s*20221\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be magic 20221 add policy copyable_on_hit=false")
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
	if regexp.MustCompile(`(?is)'provider_hero_lucian_[pqer]_|'ability_hero_lucian_[pqer]_|` +
		`'provider_hero_lucian_basic_|'ability_hero_lucian_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/Q/E/R/basic graph rows")
	}

	for _, want := range []string{
		lucianABCandidateKey, lucianABTaskKey, lucianABPlanRev,
		"lol_generic_lucian_ardent_blaze_primary_hit_seed.sql",
		"LolGenericLucianArdentBlazePrimaryHitSeedSqlTest",
		"external existing-data",
		"magic_215_plus_0_90_ap",
		"Piercing Light",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Lucian identity/panel/resource")
	}
	if strings.Contains(readme, "op:lucian_ardent_blaze_primary_hit_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}

	compileReq, _ := loadLucianABFixture(t, lucianABFixtureOpts{
		resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR, mana: lucianABFixtureManaCD,
	})
	assertLucianABProviderShape(t, compileReq, 1)
	rawX := lucianABExpectedRawFromAP(lucianABFixtureAPDefault)
	if math.Abs(rawX-lucianABExpectedRawDefault) > lucianABTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, lucianABExpectedRawDefault)
	}
	mitX := expectedMitigatedMagic(rawX, lucianABTargetMR)
	if math.Abs(mitX-lucianABExpectedMitDefault) > lucianABTol {
		t.Fatalf("default mit=%v want %v", mitX, lucianABExpectedMitDefault)
	}
}

// TestLucianArdentBlazePrimaryHitFormulaMitigationTable: AP0/100/200 × MR0/100
// raw/mitigated table from the frozen deterministic fixtures; proves AP formula.
func TestLucianArdentBlazePrimaryHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAP, mr         float64
		wantRaw, wantMitigated float64
	}{
		{"AP0_MR0", 0, 0, 215, 215},
		{"AP0_MR100", 0, 100, 215, 107.5},
		{"AP100_MR0", 100, 0, 305, 305},
		{"AP100_MR100", 100, 100, 305, 152.5},
		{"AP200_MR100", 200, 100, 395, 197.5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := lucianABExpectedRawFromAP(tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > lucianABTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > lucianABTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadLucianABFixture(t, lucianABFixtureOpts{
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: lucianABFixtureManaCD,
			})
			assertLucianABProviderShape(t, compileReq, 1)
			ref := lucianABAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runLucianAB(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := lucianABDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("W damage evidence=%d want 1", len(dmg))
			}
			lucianABAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > lucianABTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(lucianABAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(lucianABAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestLucianArdentBlazePrimaryHitCooldownMana180AbilityStarted: mana180/AP100/
// HP1000/MR100 at t0/t9999/t10000 → success/skip/success; final mana60/HP695;
// two W damage items and two automatic W ability_started events.
func TestLucianArdentBlazePrimaryHitCooldownMana180AbilityStarted(t *testing.T) {
	compileReq, runReq := loadLucianABFixture(t, lucianABFixtureOpts{
		resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR,
		mana: lucianABFixtureManaCD, hp: lucianABTargetHP,
	})
	assertLucianABProviderShape(t, compileReq, 1)
	ref := lucianABAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9999},
		{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10000},
	}
	runReq.StopPolicy.DurationMs = 10100
	done := runLucianAB(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if lucianABSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findLucianABAbilityStat(t, done)
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

	items := lucianABDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("W damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 10000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		lucianABAssertDamage(t, item, lucianABExpectedRawDefault, lucianABExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * lucianABExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-lucianABHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, lucianABHPAfter2)
	}
	gotMana := lucianABSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-lucianABManaAfter2) > lucianABTol {
		t.Fatalf("mana=%v want %v", gotMana, lucianABManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := lucianABAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic W; no explicit event op)", len(started))
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
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-lucianABFixtureAPDefault) > lucianABTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), lucianABFixtureAPDefault)
	}
}

// TestLucianArdentBlazePrimaryHitResourceInsufficientMana59: mana59 at t0 →
// resource_insufficient; mana/HP unchanged; zero W damage/event evidence.
func TestLucianArdentBlazePrimaryHitResourceInsufficientMana59(t *testing.T) {
	compileReq, runReq := loadLucianABFixture(t, lucianABFixtureOpts{
		resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR,
		mana: lucianABFixtureManaShort, hp: lucianABTargetHP,
	})
	ref := lucianABAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runLucianAB(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if lucianABSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(lucianABSourceMana(t, done.FinalSnapshot)-lucianABFixtureManaShort) > lucianABTol {
		t.Fatalf("mana changed: got %v want %v",
			lucianABSourceMana(t, done.FinalSnapshot), lucianABFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-lucianABTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, lucianABTargetHP)
	}
	if len(lucianABDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero W damage evidence")
	}
	if len(lucianABAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestLucianArdentBlazePrimaryHitStandaloneNoSiblingSynthesis: standalone W
// provider does not synthesize P/Q/E/R/basic or overwrite unrelated definitions.
func TestLucianArdentBlazePrimaryHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadLucianABFixture(t, lucianABFixtureOpts{
		resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR, mana: lucianABFixtureManaCD,
	})
	assertLucianABProviderShape(t, compileReq, 1)

	sentinelKey := "fixture_lucian_ardent_blaze_unrelated_sentinel"
	sentinelStable := "fixture_lucian_ardent_blaze_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != lucianABProviderRef {
		t.Fatalf("source mounts=%+v want only W", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != lucianABProviderRef {
			t.Fatalf("source snapshots=%+v want only W", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_lucian_[pqer]_|ability_hero_lucian_[pqer]_|` +
		`provider_hero_lucian_basic_|ability_hero_lucian_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == lucianABProviderRef || p.StableID == lucianABStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != lucianABProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("W must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}
	// W-only must not synthesize Lucian Q.
	for _, p := range compileReq.SharedProviders {
		if p.ProviderKey == lucianPLProviderRef || p.StableID == lucianPLStableID {
			t.Fatal("W-only fixture must not synthesize Piercing Light Q provider")
		}
	}

	ref := lucianABAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runLucianAB(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(lucianABDamageEvidence(done)) != 1 {
		t.Fatalf("W damage=%d want 1", len(lucianABDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone W must not synthesize extra damage")
	}
	if len(lucianPLDamageEvidence(done)) != 0 {
		t.Fatal("W-only must not produce Q damage evidence")
	}
	if len(lucianABAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic W ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
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
				if ps.ProviderRef == lucianABProviderRef || ps.DefinitionRef == lucianABProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestLucianArdentBlazePrimaryHitQIsolationCoexistence: W-only does not synthesize
// Q; combined Q+W keeps distinct provider/ability refs; W casts produce no Q
// damage/start evidence. Uses same-package Q helpers read-only; Q test file
// unmodified.
func TestLucianArdentBlazePrimaryHitQIsolationCoexistence(t *testing.T) {
	t.Run("w_only_no_q_synthesis", func(t *testing.T) {
		compileReq, runReq := loadLucianABFixture(t, lucianABFixtureOpts{
			resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR, mana: lucianABFixtureManaCD,
		})
		assertLucianABProviderShape(t, compileReq, 1)
		for _, p := range compileReq.SharedProviders {
			if p.ProviderKey == lucianPLProviderRef || p.StableID == lucianPLStableID {
				t.Fatal("W-only must not synthesize Q provider")
			}
			for _, a := range p.Abilities {
				if a.AbilityKey == lucianPLAbilityKey {
					t.Fatal("W-only must not synthesize Q ability key")
				}
			}
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: lucianABAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runLucianAB(t, compileReq, runReq)
		if len(lucianPLDamageEvidence(done)) != 0 {
			t.Fatal("W-only must not produce Q damage")
		}
		if len(done.Summary.AbilityStats) != 1 ||
			done.Summary.AbilityStats[0].AbilityRef != lucianABAbilityRef() {
			t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
		}
	})

	t.Run("combined_qw_distinct_w_cast_no_q_evidence", func(t *testing.T) {
		compileReq, runReq := loadLucianABFixture(t, lucianABFixtureOpts{
			resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR,
			mana: lucianABFixtureManaCD, withQ: true,
		})
		assertLucianABProviderShape(t, compileReq, 2)
		assertLucianPLProviderShape(t, compileReq, 2, false)

		if lucianABProviderRef == lucianPLProviderRef ||
			lucianABStableID == lucianPLStableID ||
			lucianABAbilityID == lucianPLAbilityID ||
			lucianABAbilityKey == lucianPLAbilityKey ||
			lucianABAbilityRef() == lucianPLAbilityRef() ||
			lucianABDamageOpRef == lucianPLDamageOpRef {
			t.Fatal("Q and W provider/ability/op refs must remain distinct")
		}
		foundQ, foundW := false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == lucianPLProviderRef {
				foundQ = true
			}
			if m.ProviderRef == lucianABProviderRef {
				foundW = true
			}
		}
		if !foundQ || !foundW {
			t.Fatalf("combined mounts=%+v want both Q and W", compileReq.Combatants[0].Providers)
		}

		wRef := lucianABAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: wRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runLucianAB(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(lucianABDamageEvidence(done)) != 1 {
			t.Fatalf("W damage=%d want 1", len(lucianABDamageEvidence(done)))
		}
		lucianABAssertDamage(t, lucianABDamageEvidence(done)[0],
			lucianABExpectedRawDefault, lucianABExpectedMitDefault)
		if len(lucianPLDamageEvidence(done)) != 0 {
			t.Fatal("W cast must not produce Q damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture W cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (W only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == lucianPLAbilityRef() {
				t.Fatalf("W cast must not produce Q AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != wRef {
			t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == lucianPLAbilityRef() {
				t.Fatalf("W cast must not produce Q abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == lucianPLDamageOpRef {
				t.Fatalf("W cast must not produce Q operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == lucianPLProviderRef {
				t.Fatalf("W cast must not produce Q providerRef evidence: %+v", item)
			}
		}
	})
}

// TestLucianArdentBlazePrimaryHitDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// wrong/missing/released session behavior.
func TestLucianArdentBlazePrimaryHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadLucianABFixture(t, lucianABFixtureOpts{
				resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR, mana: lucianABFixtureManaCD,
			})
			ref := lucianABAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9999},
				{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10000},
			}
			r.StopPolicy.DurationMs = 10100
			done := runLucianAB(t, c, r)
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
		c, r := loadLucianABFixture(t, lucianABFixtureOpts{
			resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR, mana: lucianABFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: lucianABAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runLucianABFrames(t, c, r)
		if len(lucianABDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path W damage=%d want 1", len(lucianABDamageEvidence(done)))
		}
		lucianABAssertDamage(t, lucianABDamageEvidence(done)[0], lucianABExpectedRawDefault, lucianABExpectedMitDefault)
		if len(lucianABAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadLucianABFixture(t, lucianABFixtureOpts{
			resolvedAP: lucianABFixtureAPDefault, mr: lucianABTargetMR, mana: lucianABFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: lucianABAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
