package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_azir Q Conquering Sands / 狂沙猛攻 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1).
//
// Governance identity: this hero-named `_test.go` is regression/governance evidence
// only. It is excluded from production Wasm builds and must construct the existing
// canonical generic ABI. Production runtime remains generic (no if hero_azir /
// production hero switch).
//
// Frozen boundary:
//
//	rank5_assume_one_existing_sand_soldier_selected_primary_single_magic_hit; immediate_impact_scaffold;
//	magic_140_plus_0_55_ap; mana110_listed_cooldown6000ms_scaffold;
//	no_soldier_entity_spawn_count_formation_command_path_target_location_dash_collision_geometry_multitarget_slow_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_azir|Q|狂沙猛攻
//	task wasm-generic-azir-conquering-sands-one-soldier-selected-primary-hit
//	Request Template:Data Azir/Q → resolved Template:Data Azir/Conquering Sands
//	wikiPageId 1306850 / rev 4024967 / timestamp 2026-06-04T07:26:59Z
//	canonical rawByteSize 2512 / SHA256
//	  168e2568c6795859e68831eb23b59b62d249aceb07cf3740403b1616516b51f2
//	数据参考/lol-wiki-current-champions/normalized/generic/azir-q.json
//	  authoritative normalized bytes 3119 / SHA256
//	  9e2cfc28ced422699bbb40722ba46d82167c79f34bbd696f2fc4080e52120fb7
//	pages/raw siblings: pages/azir-q.json (bytes 684 / SHA256
//	  a15a3c54079cd8a75584c9725bb792441103ff27cafa31fa136d076791fa71f4),
//	  raw/azir-q.wikitext
//	Backend seed (cross-worktree absolute path; Backend owning commit
//	  dd214a3501601098f73267900aa6a199626d5b31):
//	  C:/project/damage_backend_dev/db/game_manage/seeds/
//	  lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql
//	  bytes 29560 / SHA256
//	  9263b65f6432ca39f5c095934513fe5358a5bf159664904f7d59d86c05eae149
//	JUnit bytes 50880 / SHA256
//	  9409b991ea37f69d63c10f7811ee6e33f941fd9ce6eff554fb08d8f6d126e4fb
//	Local raw materialization caveat: 2510 bytes / SHA256
//	  6885ead987cae40fa37992d170337007629e3f12ebfc494eb3a1f54b5fb110e4.
//	Assert sidecar/pages canonical identity + local/canonical caveat; do not claim
//	local-raw equivalence or source contradiction (同 size 不等于等价).
//	Seed is non-self-contained/check-only (no live execution); this test bundle is
//	self-contained test data, not a live materializer.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_azir_q_conquering_sands_one_soldier_primary_hit
//     (standalone; not P/W/E/R/basic/soldier provider synthesis)
//   - ability ability_hero_azir_q_conquering_sands_one_soldier_primary_hit with
//     ability_key conquering_sands_one_soldier_primary_hit: active; mana 110;
//     listed cooldown scaffold 6000 ms
//   - Exactly one null-duration impact / on-enter sequence and one non-crit /
//     non-copyable magic damage operation:
//     add(const140, mul(const0.55, read source.attr.ap.resolved))
//     (AP read path exactly once; no AD/crit/crit_damage reads)
//   - CritEligible=false, CopyableOnHit=false; Types empty (no ability/basic_attack;
//     no Q-specific type)
//   - Runtime types: magic 20221 + add policy 20170; no executable 20230;
//     no explicit event operation — successful cast relies on runtime automatic
//     ability_started
//   - "One existing Sand Soldier" is only a caller/scenario assumption + exclusion.
//     This test bundle must not create/model/enforce a soldier entity/state/gate
//     or claim the runtime supports it.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   ranks 1–4; soldier entity/spawn/despawn/count/formation/placement/attack state;
//   cast-precondition enforcement; command/path/dash/travel/collision/Wind Wall/
//   Rebuttal; target location/range/geometry/pass-through/arrival/multiple enemies;
//   slow/duration/refresh; P/W/E/R/basic/items/loadout; live/Admin/E2E/Web/asset/
//   full-game/full-Q fidelity. One assume-one-existing-soldier selected-primary
//   single magic hit, not full Q.
//
// Ordered governed tags (exactly; do not substitute immediate_impact_scaffold
// as a governed tag — that phrase remains boundary-only; raw meta_or_non_target_dps
// is legacy provenance only and must not enter governed tags):
//   ability_cost_cooldown, active_magic_damage, ap_ratio,
//   one_existing_soldier_selected_primary_hit_scaffold

const (
	azirCSCandidateKey    = "hero_skill|hero_azir|Q|狂沙猛攻"
	azirCSTaskKey         = "wasm-generic-azir-conquering-sands-one-soldier-selected-primary-hit"
	azirCSPlanRev         = "azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1"
	azirCSRequestTitle    = "Template:Data Azir/Q"
	azirCSResolvedTitle   = "Template:Data Azir/Conquering Sands"
	azirCSWikiPageID      = 1306850
	azirCSRevisionID      = 4024967
	azirCSTimestamp       = "2026-06-04T07:26:59Z"
	azirCSRawBytes        = 2512
	azirCSLocalRawBytes   = 2510
	azirCSNormalizedBytes = 3119
	azirCSPagesBytes      = 684
	azirCSContentSHA      = "168e2568c6795859e68831eb23b59b62d249aceb07cf3740403b1616516b51f2"
	azirCSLocalRawSHA     = "6885ead987cae40fa37992d170337007629e3f12ebfc494eb3a1f54b5fb110e4"
	azirCSNormalizedSHA   = "9e2cfc28ced422699bbb40722ba46d82167c79f34bbd696f2fc4080e52120fb7"
	azirCSPagesSHA        = "a15a3c54079cd8a75584c9725bb792441103ff27cafa31fa136d076791fa71f4"
	azirCSBoundary        = "rank5_assume_one_existing_sand_soldier_selected_primary_single_magic_hit; immediate_impact_scaffold; " +
		"magic_140_plus_0_55_ap; mana110_listed_cooldown6000ms_scaffold; " +
		"no_soldier_entity_spawn_count_formation_command_path_target_location_dash_collision_geometry_multitarget_slow_or_full_fidelity"

	// Cross-worktree Backend evidence root (owning commit dd214a3501601098f73267900aa6a199626d5b31).
	azirCSBackendRoot   = "C:/project/damage_backend_dev"
	azirCSBackendOwning = "dd214a3501601098f73267900aa6a199626d5b31"
	azirCSSeedBytes     = 29560
	azirCSSeedBlobSHA   = "9263b65f6432ca39f5c095934513fe5358a5bf159664904f7d59d86c05eae149"
	azirCSJUnitBytes    = 50880
	azirCSJUnitBlobSHA  = "9409b991ea37f69d63c10f7811ee6e33f941fd9ce6eff554fb08d8f6d126e4fb"

	azirCSProviderRef = "provider_hero_azir_q_conquering_sands_one_soldier_primary_hit"
	azirCSStableID    = "hero_azir_q_conquering_sands_one_soldier_primary_hit"
	azirCSAbilityID   = "ability_hero_azir_q_conquering_sands_one_soldier_primary_hit"
	azirCSAbilityKey  = "conquering_sands_one_soldier_primary_hit"
	azirCSDamageOpRef = "op:azir_conquering_sands_one_soldier_primary_hit_damage"

	azirCSBaseDamage = 140.0
	azirCSAPRatio    = 0.55
	azirCSManaCost   = 110.0
	azirCSCDMs       = 6000.0

	azirCSFixtureAPDefault = 100.0
	azirCSFixtureManaCD    = 330.0
	azirCSFixtureManaShort = 109.0
	azirCSTargetMR         = 100.0
	azirCSTargetHP         = 1000.0
	azirCSFixtureADProbe   = 200.0
	azirCSFixtureCritProbe = 0.5
	azirCSFixtureCritDmg   = 2.3

	azirCSExpectedRawAP0   = 140.0 // 140 + 0.55*0
	azirCSExpectedMitAP0   = 140.0 // MR0
	azirCSExpectedRawAP100 = 195.0 // 140 + 0.55*100
	azirCSExpectedMitAP100 = 97.5  // MR100
	azirCSManaAfter2       = 110.0 // 330 - 110 - 110
	azirCSHPAfter2         = 805.0 // 1000 - 97.5 - 97.5

	azirCSSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":140},` +
		`{"op":"mul","args":[{"op":"const","value":0.55},` +
		`{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	azirCSTol = 1e-9
)

func azirCSOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"ap_ratio",
		"one_existing_soldier_selected_primary_hit_scaffold",
	}
}

func azirCSExpectedRawFromAP(resolvedAP float64) float64 {
	return azirCSBaseDamage + azirCSAPRatio*resolvedAP
}

func azirCSDamageAmount() *model.GenericFormulaExpr {
	base := azirCSBaseDamage
	apRatio := azirCSAPRatio
	// Nested binary AST: add(const140, mul(const0.55, read source.attr.ap.resolved)).
	// AP is read exactly once; no AD/crit/crit_damage reads.
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

func azirCSCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += azirCSCountPathReads(&expr.Args[i], path)
	}
	return n
}

func azirCSAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		azirCSAssertBinaryArity(t, &expr.Args[i])
	}
}

func azirCSAbility() model.AbilityDefinition {
	cost := azirCSManaCost
	cd := azirCSCDMs
	return model.AbilityDefinition{
		AbilityKey: azirCSAbilityKey,
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
				Ref:           azirCSDamageOpRef,
				Amount:        azirCSDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func azirCSProviderDef() model.ProviderDefinition {
	// Production/seed Q provider has zero modifiers/listeners/state/soldier rows.
	return model.ProviderDefinition{
		ProviderKey: azirCSProviderRef,
		Kind:        "champion",
		StableID:    azirCSStableID,
		Abilities:   []model.AbilityDefinition{azirCSAbility()},
	}
}

func azirCSAbilityRef() string {
	return "source.provider[" + azirCSProviderRef + "].ability[" + azirCSAbilityKey + "]"
}

type azirCSFixtureOpts struct {
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
	resolvedAD float64
	critChance float64
	critDamage float64
}

func configureAzirCSProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{azirCSProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: azirCSProviderRef, DefinitionRef: azirCSProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: azirCSProviderRef, DefinitionRef: azirCSProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureAzirCSTypes(req *model.CompileRequest) {
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

func loadAzirCSFixture(t *testing.T, opts azirCSFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAP/mr explicitly (AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = azirCSFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = azirCSTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureAzirCSTypes(&compileReq)
	configureAzirCSProvider(&compileReq, &runReq)

	// Fixture-only AP/AD/crit/mana/HP/MR values (external-existing-data/check-only);
	// do not claim seed materializes hero_azir identity, soldier entity, or panel rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.resolvedAD, Current: opts.resolvedAD,
		Max: opts.resolvedAD, Resolved: opts.resolvedAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: opts.critChance, Current: opts.critChance,
		Max: opts.critChance, Resolved: opts.critChance,
	})
	if opts.critDamage != 0 {
		setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_damage", model.AttributeSlotDef{
			Base: opts.critDamage, Current: opts.critDamage,
			Max: opts.critDamage, Resolved: opts.critDamage,
		})
	}
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, azirCSFixtureManaCD),
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

func runAzirCS(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runAzirCSFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func azirCSSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func azirCSSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func azirCSDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := azirCSAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != azirCSDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func azirCSAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func azirCSFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == azirCSProviderRef {
			return p
		}
	}
	return nil
}

func assertAzirCSProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := azirCSFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_azir_q_conquering_sands_one_soldier_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != azirCSProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, azirCSProviderRef)
	}
	if p.StableID != azirCSStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, azirCSStableID)
	}
	banned := []string{
		"provider_hero_azir_p_", "provider_hero_azir_w_", "provider_hero_azir_e_",
		"provider_hero_azir_r_", "provider_hero_azir_basic_", "provider_hero_azir_soldier",
		"ability_hero_azir_p_", "ability_hero_azir_w_", "ability_hero_azir_e_",
		"ability_hero_azir_r_", "ability_hero_azir_basic_", "sand_soldier",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("conquering_sands primary-hit must not reuse sibling/basic/soldier refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no soldier/state gate)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production Q has no modifiers)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), azirCSAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != azirCSAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, azirCSAbilityKey, azirCSAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("Q Types=%v want empty (no ability-specific game-local Q type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("conquering_sands_one_soldier_primary_hit must not be tagged ability/basic_attack")
		}
		if strings.Contains(typ, "azir") || strings.Contains(typ, "conquering") ||
			strings.Contains(typ, "soldier") || strings.HasPrefix(typ, "62") {
			t.Fatalf("Q must not carry Q-specific type %q", typ)
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("Q must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("Q must not carry tickSpec")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("Q must not carry castCondition (one-soldier assumption is not a modeled gate)")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-azirCSManaCost) > azirCSTol {
		t.Fatalf("cost=%+v want mana const 110", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-azirCSCDMs) > azirCSTol {
		t.Fatalf("cooldown=%+v want const 6000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("conquering sands damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("conquering sands damage must not be copyable on hit")
	}
	if op.Ref != azirCSDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, azirCSDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const140, mul(0.55, ap.resolved))", op.Amount)
	}
	azirCSAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-azirCSBaseDamage) > azirCSTol {
		t.Fatalf("base const=%+v want 140", op.Amount.Args[0])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-azirCSAPRatio) > azirCSTol {
		t.Fatalf("AP ratio=%+v want 0.55", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if azirCSCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", azirCSCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	for _, banned := range []string{
		"source.attr.ad.resolved", "source.attr.ad.base",
		"source.attr.crit_chance.resolved", "source.attr.crit_damage.resolved",
		"source.attr.ap.base",
	} {
		if azirCSCountPathReads(op.Amount, banned) != 0 {
			t.Fatalf("formula must not read forbidden path %q", banned)
		}
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "dash" ||
			bannedOp.Operation == "movement" || bannedOp.Operation == "matcher" {
			t.Fatalf("conquering sands must not include excluded op: %+v", bannedOp)
		}
	}
}

func findAzirCSAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := azirCSAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func azirCSWasmRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing wasm path %s: %v (fail closed)", path, err)
	}
	return path
}

func azirCSBackendPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{filepath.FromSlash(azirCSBackendRoot)}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing backend path %s: %v (fail closed)", path, err)
	}
	return path
}

func azirCSLoadSeedSQL(t *testing.T) (full string, noLineComments string, raw []byte) {
	t.Helper()
	raw, err := os.ReadFile(azirCSBackendPath(t,
		"db", "game_manage", "seeds", "lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql"))
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
	return full, b.String(), raw
}

func azirCSSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func azirCSAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > azirCSTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > azirCSTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != azirCSDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), azirCSDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != azirCSAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), azirCSAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != azirCSProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), azirCSProviderRef)
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

// TestAzirConqueringSandsOneSoldierPrimaryHitWikiSeedShape locks wiki/sidecar/
// pages/local-raw caveat, Backend seed/README/JUnit identities and blob hashes,
// exact IDs/cardinality, formula binary shape/path-once, cost/CD/flags/types,
// ordered governed tags, and one-soldier assumption non-gate framing.
func TestAzirConqueringSandsOneSoldierPrimaryHitWikiSeedShape(t *testing.T) {
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
	sidecarRaw, err := os.ReadFile(azirCSWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "azir-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != azirCSNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), azirCSNormalizedBytes)
	}
	if got := azirCSSHA256Hex(sidecarRaw); got != azirCSNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, azirCSNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != azirCSCandidateKey || doc.RequestTitle != azirCSRequestTitle ||
		doc.ResolvedTitle != azirCSResolvedTitle || doc.WikiPageID != azirCSWikiPageID ||
		doc.RevisionID != azirCSRevisionID || doc.RevisionTimestamp != azirCSTimestamp ||
		doc.ContentSHA256 != azirCSContentSHA || doc.RawByteSize != azirCSRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "狂沙猛攻" || doc.OwnerID != "hero_azir" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "description2", "description3", "leveling",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|70 to 110}}\n" || doc.Fields.Costtype != "mana\n" ||
		doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|14 to 6}}\n" {
		t.Fatalf("cooldown=%q want {{ap|14 to 6}} (rank-5 = 6s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|60 to 140}}") ||
		!strings.Contains(doc.Fields.Leveling, "{{ap|35 to 55}}% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") {
		t.Fatal("wiki prose must retain magic damage wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description, "Sand Soldiers") ||
		!strings.Contains(doc.Fields.Description, "dash") ||
		!strings.Contains(doc.Fields.Description, "target location") ||
		!strings.Contains(doc.Fields.Description, "slowing") {
		t.Fatal("wiki prose must retain excluded soldier/dash/location/slow surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "subsequent soldiers") {
		t.Fatal("wiki prose must retain subsequent-soldiers exclusion surface")
	}
	if !strings.Contains(doc.Fields.Description3, "Sand Soldier") ||
		!strings.Contains(doc.Fields.Description3, "required to cast") {
		t.Fatal("wiki prose must retain soldier-required cast note (assumption only; not modeled gate)")
	}
	if !strings.Contains(doc.Fields.Notes, "Wind Wall") ||
		!strings.Contains(doc.Fields.Notes, "Rebuttal") ||
		!strings.Contains(doc.Fields.Notes, "formation") {
		t.Fatalf("notes missing Wind Wall/Rebuttal/formation (excluded): %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(azirCSWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "azir-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != azirCSPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), azirCSPagesBytes)
	}
	if got := azirCSSHA256Hex(pagesRaw); got != azirCSPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, azirCSPagesSHA)
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "狂沙猛攻" || pages.OwnerID != "hero_azir" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(azirCSWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "azir-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != azirCSLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), azirCSLocalRawBytes)
	}
	localSHA := azirCSSHA256Hex(rawBytes)
	if localSHA != azirCSLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, azirCSLocalRawSHA)
	}
	if localSHA == azirCSContentSHA {
		t.Fatal("local raw hash must differ from canonical (local/canonical caveat; not equivalence/contradiction)")
	}
	if azirCSLocalRawBytes == azirCSRawBytes {
		t.Fatal("local raw size must differ from canonical (2510 vs 2512 materialization caveat)")
	}

	if azirCSPlanRev != "azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1" ||
		azirCSBoundary !=
			"rank5_assume_one_existing_sand_soldier_selected_primary_single_magic_hit; immediate_impact_scaffold; "+
				"magic_140_plus_0_55_ap; mana110_listed_cooldown6000ms_scaffold; "+
				"no_soldier_entity_spawn_count_formation_command_path_target_location_dash_collision_geometry_multitarget_slow_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}
	if azirCSTaskKey != "wasm-generic-azir-conquering-sands-one-soldier-selected-primary-hit" {
		t.Fatal("task key drifted")
	}
	if azirCSBackendOwning != "dd214a3501601098f73267900aa6a199626d5b31" {
		t.Fatal("Backend owning commit drifted")
	}
	tags := azirCSOrderedTags()
	if len(tags) != 4 ||
		tags[0] != "ability_cost_cooldown" ||
		tags[1] != "active_magic_damage" ||
		tags[2] != "ap_ratio" ||
		tags[3] != "one_existing_soldier_selected_primary_hit_scaffold" {
		t.Fatalf("ordered governed tags drifted: %+v", tags)
	}
	for _, tag := range tags {
		if tag == "immediate_impact_scaffold" || tag == "meta_or_non_target_dps" {
			t.Fatalf("must not put %q into governed tags", tag)
		}
	}

	seed, sqlNoComments, seedRaw := azirCSLoadSeedSQL(t)
	if len(seedRaw) != azirCSSeedBytes {
		t.Fatalf("seed bytes=%d want %d", len(seedRaw), azirCSSeedBytes)
	}
	if got := azirCSSHA256Hex(seedRaw); got != azirCSSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, azirCSSeedBlobSHA)
	}
	junitPath := azirCSBackendPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericAzirConqueringSandsOneSoldierPrimaryHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(junitBytes) != azirCSJUnitBytes {
		t.Fatalf("junit bytes=%d want %d", len(junitBytes), azirCSJUnitBytes)
	}
	if got := azirCSSHA256Hex(junitBytes); got != azirCSJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, azirCSJUnitBlobSHA)
	}
	readmeBytes, err := os.ReadFile(azirCSBackendPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		azirCSCandidateKey, azirCSTaskKey, azirCSPlanRev,
		azirCSRequestTitle, azirCSResolvedTitle,
		"1306850", "4024967", azirCSTimestamp, "2512", "3119", "684", "2510",
		azirCSContentSHA, azirCSNormalizedSHA, azirCSPagesSHA, azirCSLocalRawSHA,
		azirCSBoundary, azirCSProviderRef, azirCSAbilityID, azirCSAbilityKey,
		"conquering_sands_one_soldier_primary_hit_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":110}`, `{"op":"const","value":6000}`,
		azirCSSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/azir-q.json",
		"external existing-data", "check-only",
		"不物化", "非自包含",
		"source.attr.ap.resolved",
		"ability_started",
		"20221", "20170",
		"crit_eligible=false", "copyable_on_hit=false",
		"caller/scenario assumption",
		"one_existing_soldier_selected_primary_hit_scaffold",
		"meta_or_non_target_dps",
		"missing game_entities hero_azir",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_azir/ap",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_azir/mana",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range azirCSOrderedTags() {
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
	for _, tag := range azirCSOrderedTags() {
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
	for _, banned := range []string{
		`"path":"source.attr.ap.base"`,
		`"path":"source.attr.ad.resolved"`,
		`"path":"source.attr.ad.base"`,
		`"path":"source.attr.crit_chance.resolved"`,
		`"path":"source.attr.crit_damage.resolved"`,
	} {
		if strings.Contains(sqlNoComments, banned) {
			t.Fatalf("executable SQL must not invent forbidden read %s", banned)
		}
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.ability_definitions",
		"INSERT INTO public.ability_costs",
		"INSERT INTO public.ability_cooldowns",
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.ability_phase_effect_sequences",
		"INSERT INTO public.entity_provider_mounts",
		"phase_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact",
		"sequence_hero_azir_q_conquering_sands_one_soldier_primary_hit_impact",
		"step_hero_azir_q_conquering_sands_one_soldier_primary_hit_damage",
		"cost_hero_azir_q_conquering_sands_one_soldier_primary_hit_mana",
		"cooldown_hero_azir_q_conquering_sands_one_soldier_primary_hit",
	} {
		if !strings.Contains(sqlNoComments, needle) {
			t.Fatalf("executable seed missing %q", needle)
		}
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.provider_definitions") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_definitions") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_costs") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_cooldowns") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_phases") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.effect_sequences") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.effect_steps") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.damage_effect_details") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_phase_effect_sequences") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.entity_provider_mounts") != 1 {
		t.Fatal("seed must define exactly one provider/ability/cost/cooldown/phase/sequence/step/detail/link/mount")
	}
	if !regexp.MustCompile(`(?s)'ability_hero_azir_q_conquering_sands_one_soldier_primary_hit'\s*,\s*` +
		`'provider_hero_azir_q_conquering_sands_one_soldier_primary_hit'\s*,\s*` +
		`'conquering_sands_one_soldier_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key conquering_sands_one_soldier_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_azir_q_conquering_sands_one_soldier_primary_hit_damage'\s*,\s*` +
		`'conquering_sands_one_soldier_primary_hit_damage'\s*,\s*20221\s*,\s*20170\s*,\s*false`).MatchString(seed) {
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
	if regexp.MustCompile(`(?is)'provider_hero_azir_[pwer]_|'ability_hero_azir_[pwer]_|` +
		`'provider_hero_azir_basic_|'ability_hero_azir_basic_|` +
		`'provider_hero_azir_soldier|'ability_hero_azir_soldier|'sand_soldier`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/W/E/R/basic/soldier graph rows")
	}
	if regexp.MustCompile(`(?is)\b62\d{3}\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL must not introduce game-local ability-specific 62xxx types")
	}

	for _, want := range []string{
		azirCSCandidateKey, azirCSTaskKey, azirCSPlanRev,
		"lol_generic_azir_conquering_sands_one_soldier_primary_hit_seed.sql",
		"LolGenericAzirConqueringSandsOneSoldierPrimaryHitSeedSqlTest",
		"external existing-data",
		"magic_140_plus_0_55_ap",
		"1306850", "4024967", azirCSContentSHA,
		"caller/scenario assumption",
		"非自包含",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") {
		t.Fatal("README must document no repository materializer for Azir identity/panel/resource")
	}
	if strings.Contains(readme, "op:azir_conquering_sands_one_soldier_primary_hit_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}

	compileReq, _ := loadAzirCSFixture(t, azirCSFixtureOpts{
		resolvedAP: azirCSFixtureAPDefault, mr: azirCSTargetMR, mana: azirCSFixtureManaCD,
	})
	assertAzirCSProviderShape(t, compileReq, 1)
	rawX := azirCSExpectedRawFromAP(azirCSFixtureAPDefault)
	if math.Abs(rawX-azirCSExpectedRawAP100) > azirCSTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, azirCSExpectedRawAP100)
	}
	mitX := expectedMitigatedMagic(rawX, azirCSTargetMR)
	if math.Abs(mitX-azirCSExpectedMitAP100) > azirCSTol {
		t.Fatalf("default mit=%v want %v", mitX, azirCSExpectedMitAP100)
	}
	raw0 := azirCSExpectedRawFromAP(0)
	if math.Abs(raw0-azirCSExpectedRawAP0) > azirCSTol {
		t.Fatalf("AP0 raw=%v want %v", raw0, azirCSExpectedRawAP0)
	}
}

// TestAzirConqueringSandsOneSoldierPrimaryHitFormulaMitigationAndStatIsolation:
// AP0/MR0 => raw/final140; AP100/MR100 => raw195/final97.5; unrelated
// AD/crit_chance/crit_damage variation leaves Q unchanged and formula has no such reads.
func TestAzirConqueringSandsOneSoldierPrimaryHitFormulaMitigationAndStatIsolation(t *testing.T) {
	cases := []struct {
		name                         string
		resolvedAP, mr, ad, crit, cd float64
		wantRaw, wantMitigated       float64
	}{
		{"AP0_MR0", 0, 0, 0, 0, 0, 140, 140},
		{"AP0_MR0_AD200_crit0.5_cd2.3", 0, 0, 200, 0.5, 2.3, 140, 140},
		{"AP100_MR100", 100, 100, 0, 0, 0, 195, 97.5},
		{"AP100_MR100_AD200_crit0.5_cd2.3", 100, 100, 200, 0.5, 2.3, 195, 97.5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := azirCSExpectedRawFromAP(tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > azirCSTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > azirCSTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadAzirCSFixture(t, azirCSFixtureOpts{
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: azirCSFixtureManaCD,
				resolvedAD: tc.ad, critChance: tc.crit, critDamage: tc.cd,
			})
			assertAzirCSProviderShape(t, compileReq, 1)
			ref := azirCSAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runAzirCS(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := azirCSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			azirCSAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > azirCSTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.ad) > azirCSTol {
				t.Fatalf("ad.resolved=%v want unrelated probe %v",
					sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.ad)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "crit_chance")-tc.crit) > azirCSTol {
				t.Fatalf("crit_chance.resolved=%v want unrelated probe %v",
					sourceAttrResolved(t, done.FinalSnapshot, "crit_chance"), tc.crit)
			}
			if tc.cd != 0 {
				if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "crit_damage")-tc.cd) > azirCSTol {
					t.Fatalf("crit_damage.resolved=%v want unrelated probe %v",
						sourceAttrResolved(t, done.FinalSnapshot, "crit_damage"), tc.cd)
				}
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(azirCSAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(azirCSAbilityStartedEvidence(done)))
			}
			p := azirCSFindProvider(compileReq)
			if p == nil || p.Abilities[0].Operations[0].CritEligible {
				t.Fatal("operation CritEligible must stay false")
			}
			if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
				t.Fatal("must not emit basic_attack_hit")
			}
		})
	}
}

// TestAzirConqueringSandsOneSoldierPrimaryHitCooldownMana330AbilityStarted:
// AP100/mana330/HP1000/MR100 at t0/t5999/t6000 → success/skip/success; exactly
// two Q magic damage items and two automatic Q ability_started; final mana110/HP805;
// ready at 6000.
func TestAzirConqueringSandsOneSoldierPrimaryHitCooldownMana330AbilityStarted(t *testing.T) {
	compileReq, runReq := loadAzirCSFixture(t, azirCSFixtureOpts{
		resolvedAP: azirCSFixtureAPDefault, mr: azirCSTargetMR,
		mana: azirCSFixtureManaCD, hp: azirCSTargetHP,
		resolvedAD: azirCSFixtureADProbe,
	})
	assertAzirCSProviderShape(t, compileReq, 1)
	ref := azirCSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6000},
	}
	runReq.StopPolicy.DurationMs = 6100
	done := runAzirCS(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if azirCSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findAzirCSAbilityStat(t, done)
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

	items := azirCSDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 6000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		azirCSAssertDamage(t, item, azirCSExpectedRawAP100, azirCSExpectedMitAP100)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * azirCSExpectedMitAP100
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-azirCSHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, azirCSHPAfter2)
	}
	gotMana := azirCSSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-azirCSManaAfter2) > azirCSTol {
		t.Fatalf("mana=%v want %v", gotMana, azirCSManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := azirCSAbilityStartedEvidence(done)
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
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-azirCSFixtureAPDefault) > azirCSTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), azirCSFixtureAPDefault)
	}
}

// TestAzirConqueringSandsOneSoldierPrimaryHitResourceInsufficientMana109: mana109
// at t0 → resource_insufficient; mana/HP unchanged; no Q damage/start.
func TestAzirConqueringSandsOneSoldierPrimaryHitResourceInsufficientMana109(t *testing.T) {
	compileReq, runReq := loadAzirCSFixture(t, azirCSFixtureOpts{
		resolvedAP: azirCSFixtureAPDefault, mr: azirCSTargetMR,
		mana: azirCSFixtureManaShort, hp: azirCSTargetHP,
	})
	ref := azirCSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runAzirCS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if azirCSSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(azirCSSourceMana(t, done.FinalSnapshot)-azirCSFixtureManaShort) > azirCSTol {
		t.Fatalf("mana changed: got %v want %v",
			azirCSSourceMana(t, done.FinalSnapshot), azirCSFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-azirCSTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, azirCSTargetHP)
	}
	if len(azirCSDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(azirCSAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
	if azirCSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 0 {
		t.Fatal("resource skip must not start cooldown")
	}
}

// TestAzirConqueringSandsOneSoldierPrimaryHitStandaloneNoSiblingSynthesis: standalone
// Q provider does not synthesize P/W/E/R/basic/soldier or overwrite unrelated definitions.
func TestAzirConqueringSandsOneSoldierPrimaryHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadAzirCSFixture(t, azirCSFixtureOpts{
		resolvedAP: azirCSFixtureAPDefault, mr: azirCSTargetMR, mana: azirCSFixtureManaCD,
	})
	assertAzirCSProviderShape(t, compileReq, 1)

	sentinelKey := "fixture_azir_conquering_sands_unrelated_sentinel"
	sentinelStable := "fixture_azir_conquering_sands_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != azirCSProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}

	siblingPat := regexp.MustCompile(`provider_hero_azir_[pwer]_|ability_hero_azir_[pwer]_|` +
		`provider_hero_azir_basic_|ability_hero_azir_basic_|sand_soldier|soldier_provider`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == azirCSProviderRef || p.StableID == azirCSStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic/soldier provider: %+v", p)
		}
		if p.ProviderKey != azirCSProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := azirCSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runAzirCS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(azirCSDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(azirCSDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(azirCSAbilityStartedEvidence(done)) != 1 {
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
				if ps.ProviderRef == azirCSProviderRef || ps.DefinitionRef == azirCSProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic/soldier: %+v", ps)
			}
		}
	}
}

// TestAzirConqueringSandsOneSoldierPrimaryHitDeterminismAndLifecycle: repeated
// compile/run evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame
// and wrong/missing/released session behavior (no dangling session).
func TestAzirConqueringSandsOneSoldierPrimaryHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadAzirCSFixture(t, azirCSFixtureOpts{
				resolvedAP: azirCSFixtureAPDefault, mr: azirCSTargetMR, mana: azirCSFixtureManaCD,
			})
			ref := azirCSAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6000},
			}
			r.StopPolicy.DurationMs = 6100
			done := runAzirCS(t, c, r)
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
		c, r := loadAzirCSFixture(t, azirCSFixtureOpts{
			resolvedAP: azirCSFixtureAPDefault, mr: azirCSTargetMR, mana: azirCSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: azirCSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runAzirCSFrames(t, c, r)
		if len(azirCSDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(azirCSDamageEvidence(done)))
		}
		azirCSAssertDamage(t, azirCSDamageEvidence(done)[0], azirCSExpectedRawAP100, azirCSExpectedMitAP100)
		if len(azirCSAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadAzirCSFixture(t, azirCSFixtureOpts{
			resolvedAP: azirCSFixtureAPDefault, mr: azirCSTargetMR, mana: azirCSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: azirCSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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

// TestAzirConqueringSandsOneSoldierPrimaryHitGovernanceExclusionsAndNonclaims:
// prove hero-named `_test.go` status, one-soldier assumption is not a modeled gate,
// allowed write surface, no production hero switch, and full-Q/soldier/geometry/
// slow/live fidelity is not claimed.
func TestAzirConqueringSandsOneSoldierPrimaryHitGovernanceExclusionsAndNonclaims(t *testing.T) {
	allowedTestRel := filepath.ToSlash(filepath.Join(
		"wasm", "tinygo_engine_v2", "internal", "runtime",
		"generic_azir_conquering_sands_one_soldier_primary_hit_test.go",
	))

	cmd := exec.Command("git", "status", "--porcelain", "--",
		"wasm/tinygo_engine_v2/internal/runtime",
		"wasm/tinygo_engine_v2/internal/model",
		"wasm/tinygo_engine_v2/internal/compile",
		"wasm/tinygo_engine_v2/internal/abi",
		"wasm/tinygo_engine_v2/cmd",
	)
	cmd.Dir = filepath.Join("..", "..", "..", "..")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git status failed: %v (%s)", err, string(out))
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		path := line
		if len(line) >= 3 {
			path = strings.TrimSpace(line[2:])
		}
		if idx := strings.Index(path, " -> "); idx >= 0 {
			path = path[idx+4:]
		}
		path = filepath.ToSlash(path)
		if path == allowedTestRel {
			continue
		}
		if strings.HasSuffix(path, "_test.go") {
			t.Fatalf("unexpected dirty test path %q (only %q may change)", path, allowedTestRel)
		}
		t.Fatalf("production/non-allowed path dirty: %q (only %q may change)", path, allowedTestRel)
	}

	err = filepath.Walk(filepath.Join(".."), func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, _ := filepath.Rel(filepath.Join(".."), path)
		rel = filepath.ToSlash(rel)
		if !(strings.HasPrefix(rel, "runtime/") || strings.HasPrefix(rel, "model/") ||
			strings.HasPrefix(rel, "compile/") || strings.HasPrefix(rel, "formula/") ||
			strings.HasPrefix(rel, "abi/")) {
			return nil
		}
		b, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		body := string(b)
		for _, frag := range []string{
			`case "hero_azir"`,
			`case "azir"`,
			`if hero_azir`,
			`conquering_sands_one_soldier_primary_hit`,
			`provider_hero_azir_q_conquering_sands_one_soldier_primary_hit`,
		} {
			if strings.Contains(body, frag) {
				t.Fatalf("production source %s contains hero-switch/Q-graph fragment %q", rel, frag)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	self := "generic_azir_conquering_sands_one_soldier_primary_hit_test.go"
	info, err := os.Stat(self)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(info.Name(), "_test.go") {
		t.Fatal("evidence file must remain *_test.go")
	}
	raw, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) == "" {
		t.Fatal("empty sha")
	}
	body := string(raw)
	if !strings.Contains(body, "FROZEN_PLAN_REV: azir-q-conquering-sands-one-soldier-selected-primary-hit-phase-a-v1") {
		t.Fatal("evidence file missing frozen plan marker")
	}
	if !strings.Contains(body, azirCSTaskKey) {
		t.Fatal("evidence file missing task key")
	}
	if !strings.Contains(body, "hero-named `_test.go` is regression/governance evidence") {
		t.Fatal("evidence file must declare hero-named _test.go governance status")
	}
	if !strings.Contains(body, "excluded from production Wasm builds") {
		t.Fatal("evidence file must declare exclusion from production build")
	}
	if !strings.Contains(body, "Production runtime remains generic") {
		t.Fatal("evidence file must declare production runtime remains generic")
	}
	for _, claim := range []string{
		"caller/scenario assumption",
		"must not create/model/enforce a soldier entity/state/gate",
		"one_existing_soldier_selected_primary_hit_scaffold",
		"do not substitute immediate_impact_scaffold as a governed tag",
		"meta_or_non_target_dps",
		"legacy provenance",
		"no explicit event op",
		"self-contained test data, not a live materializer",
		"no live execution",
		"local/canonical caveat",
	} {
		if !strings.Contains(body, claim) {
			t.Fatalf("evidence file missing exclusion/nonclaim framing %q", claim)
		}
	}
	if !strings.Contains(body, "Explicit exclusions") {
		t.Fatal("evidence file missing Explicit exclusions section")
	}
	if !strings.Contains(body, "One assume-one-existing-soldier selected-primary") {
		t.Fatal("evidence must keep bounded quantum nonclaim")
	}
	if !strings.Contains(body, "full-Q fidelity") && !strings.Contains(body, "full-Q") {
		t.Fatal("evidence must deny full-Q fidelity claim")
	}
	if strings.Count(body, "immediate_impact_scaffold") < 1 {
		t.Fatal("boundary may retain immediate_impact_scaffold phrasing")
	}
}
