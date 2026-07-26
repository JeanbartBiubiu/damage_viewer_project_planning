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

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_caitlyn E 90 Caliber Net / 90口径绳网 — Phase-A v3 Wasm exact verification slice
// (FROZEN_PLAN_REV: caitlyn-e-90-caliber-net-primary-hit-phase-a-v3).
//
// Frozen boundary:
//
//	rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold;
//	magic_280_plus_0_80_ap; no_cast_timing_direction_range_width_line_geometry_
//	multitarget_first_enemy_collision_projectile_suppression_spell_shield_recoil_
//	dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_caitlyn|E|90口径绳网
//	task wasm-generic-caitlyn-90-caliber-net-primary-hit
//	Request Template:Data Caitlyn/E → resolved Template:Data Caitlyn/90 Caliber Net
//	wikiPageId 1306916 / rev 4007584 / timestamp 2026-04-12T06:47:56Z
//	canonical rawByteSize 2095 / SHA256
//	  9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2
//	数据参考/lol-wiki-current-champions/normalized/generic/caitlyn-e.json
//	pages/raw siblings: pages/caitlyn-e.json, raw/caitlyn-e.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql
//	Local raw materialization caveat: 2094 bytes / SHA256
//	  3a5eba6df38ec34046440743d55de61490dc7b5a2488b8fc671851474d080073.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_caitlyn_e_90_caliber_net_primary_hit
//     (standalone; not P/Q/W/R/basic/Headshot synthesis)
//   - ability ability_hero_caitlyn_e_90_caliber_net_primary_hit with ability_key
//     caliber_net_primary_hit: active; mana 75; cooldown 8000 ms
//   - Exactly one immediate direct-target magic damage op:
//     280 + 0.80*source.attr.ap.resolved
//     (AP is direct resolved read; binary add(const 280, mul(0.80, read …)))
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: magic 20221 + add policy 20170; 20230 forbidden
//   - No Caitlyn state/modifier/listener/repeat/control/projectile/slow/
//     recoil/dash/mark; no explicit event op — successful cast relies on
//     runtime automatic ability_started. Fixture may supply entity/attribute/
//     resource values (external-existing-data/check-only) but must not claim
//     the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast-end timing, direction/range/width/line geometry/multitarget/
//   first-enemy acquisition/collision, projectile/suppression/interception/
//   spell shield, recoil/dash/terrain/buffering, slow/control/tenacity,
//   Headshot/mark, ranks 1–4, siblings/basic/loadout/crit/on-hit/phantom,
//   live/publish/E2E/full fidelity.
//
// Ordered tags: ability_cost_cooldown, active_magic_damage, ap_ratio,
// immediate_impact_scaffold.

const (
	caitlynCNCandidateKey  = "hero_skill|hero_caitlyn|E|90口径绳网"
	caitlynCNTaskKey       = "wasm-generic-caitlyn-90-caliber-net-primary-hit"
	caitlynCNPlanRev       = "caitlyn-e-90-caliber-net-primary-hit-phase-a-v3"
	caitlynCNRequestTitle  = "Template:Data Caitlyn/E"
	caitlynCNResolvedTitle = "Template:Data Caitlyn/90 Caliber Net"
	caitlynCNWikiPageID    = 1306916
	caitlynCNRevisionID    = 4007584
	caitlynCNTimestamp     = "2026-04-12T06:47:56Z"
	caitlynCNRawBytes      = 2095
	caitlynCNLocalRawBytes = 2094
	caitlynCNContentSHA    = "9357e7b28b05f738cd8049a2d10a115e4033a54123c0e71f55d1262a92884db2"
	caitlynCNLocalRawSHA   = "3a5eba6df38ec34046440743d55de61490dc7b5a2488b8fc671851474d080073"
	caitlynCNBoundary      = "rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; " +
		"magic_280_plus_0_80_ap; " +
		"no_cast_timing_direction_range_width_line_geometry_multitarget_" +
		"first_enemy_collision_projectile_suppression_spell_shield_recoil_" +
		"dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_" +
		"full_fidelity"

	caitlynCNProviderRef = "provider_hero_caitlyn_e_90_caliber_net_primary_hit"
	caitlynCNStableID    = "hero_caitlyn_e_90_caliber_net_primary_hit"
	caitlynCNAbilityID   = "ability_hero_caitlyn_e_90_caliber_net_primary_hit"
	caitlynCNAbilityKey  = "caliber_net_primary_hit"
	caitlynCNDamageOpRef = "op:caitlyn_90_caliber_net_primary_hit_damage"

	caitlynCNSeedBlobSHA  = "863642ABA9C249673980047CFD16036C83E82DAEE4E03A0DBAF82113E6E88DE8"
	caitlynCNJUnitBlobSHA = "0D04AF7A37EFF0F467D148A545A5DD46690FEF8F8D730DC3D55D8FB69A02E184"

	caitlynCNBaseDamage = 280.0
	caitlynCNAPRatio    = 0.80
	caitlynCNManaCost   = 75.0
	caitlynCNCDMs       = 8000.0

	caitlynCNFixtureAPDefault = 100.0
	caitlynCNFixtureManaCD    = 225.0
	caitlynCNFixtureManaShort = 74.0
	caitlynCNTargetMR         = 100.0
	caitlynCNTargetHP         = 1000.0

	caitlynCNExpectedRawDefault = 360.0 // 280 + 0.80*100
	caitlynCNExpectedMitDefault = 180.0 // MR100
	caitlynCNManaAfter2         = 75.0  // 225 - 75 - 75
	caitlynCNHPAfter2           = 640.0 // 1000 - 180 - 180

	caitlynCNSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":280},` +
		`{"op":"mul","args":[{"op":"const","value":0.80},` +
		`{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	caitlynCNTol = 1e-9
)

func caitlynCNOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func caitlynCNExpectedRawFromAP(resolvedAP float64) float64 {
	return caitlynCNBaseDamage + caitlynCNAPRatio*resolvedAP
}

func caitlynCNDamageAmount() *model.GenericFormulaExpr {
	base := caitlynCNBaseDamage
	apRatio := caitlynCNAPRatio
	// Binary add only: const 280 + mul(0.80, source.attr.ap.resolved).
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

func caitlynCNAbility() model.AbilityDefinition {
	cost := caitlynCNManaCost
	cd := caitlynCNCDMs
	return model.AbilityDefinition{
		AbilityKey: caitlynCNAbilityKey,
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
				Ref:           caitlynCNDamageOpRef,
				Amount:        caitlynCNDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func caitlynCNProviderDef() model.ProviderDefinition {
	// Production/seed E provider has zero modifiers/listeners/state.
	return model.ProviderDefinition{
		ProviderKey: caitlynCNProviderRef,
		Kind:        "champion",
		StableID:    caitlynCNStableID,
		Abilities:   []model.AbilityDefinition{caitlynCNAbility()},
	}
}

func caitlynCNAbilityRef() string {
	return "source.provider[" + caitlynCNProviderRef + "].ability[" + caitlynCNAbilityKey + "]"
}

type caitlynCNFixtureOpts struct {
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
}

func configureCaitlynCNProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	p := caitlynCNProviderDef()
	compileReq.SharedProviders = []model.ProviderDefinition{p}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: caitlynCNProviderRef, DefinitionRef: caitlynCNProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: caitlynCNProviderRef, DefinitionRef: caitlynCNProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureCaitlynCNTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
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

func loadCaitlynCNFixture(t *testing.T, opts caitlynCNFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAP/mr explicitly (AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = caitlynCNFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = caitlynCNTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureCaitlynCNTypes(&compileReq)
	configureCaitlynCNProvider(&compileReq, &runReq)

	// Fixture-only AP/mana values (external-existing-data/check-only); do not claim
	// seed materializes hero/ap/mana identity or panel rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, caitlynCNFixtureManaCD),
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

func runCaitlynCN(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runCaitlynCNFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func caitlynCNSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func caitlynCNSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func caitlynCNDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := caitlynCNAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != caitlynCNDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func caitlynCNAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func caitlynCNFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == caitlynCNProviderRef {
			return p
		}
	}
	return nil
}

func assertCaitlynCNProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := caitlynCNFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_caitlyn_e_90_caliber_net_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != caitlynCNProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, caitlynCNProviderRef)
	}
	if p.StableID != caitlynCNStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, caitlynCNStableID)
	}
	banned := []string{
		"provider_hero_caitlyn_p_", "provider_hero_caitlyn_q_", "provider_hero_caitlyn_w_",
		"provider_hero_caitlyn_r_", "provider_hero_caitlyn_basic_",
		"ability_hero_caitlyn_p_", "ability_hero_caitlyn_q_", "ability_hero_caitlyn_w_",
		"ability_hero_caitlyn_r_", "ability_hero_caitlyn_basic_",
		"headshot", "Headshot",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("caliber net primary-hit must not reuse sibling/basic/headshot refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production E has no modifiers)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), caitlynCNAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != caitlynCNAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, caitlynCNAbilityKey, caitlynCNAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("caliber_net_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-caitlynCNManaCost) > caitlynCNTol {
		t.Fatalf("cost=%+v want mana const 75", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-caitlynCNCDMs) > caitlynCNTol {
		t.Fatalf("cooldown=%+v want const 8000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("caliber net damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("caliber net damage must not be copyable on hit")
	}
	if op.Ref != caitlynCNDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, caitlynCNDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 280, mul(0.80, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-caitlynCNBaseDamage) > caitlynCNTol {
		t.Fatalf("base const=%+v want 280", op.Amount.Args[0])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-caitlynCNAPRatio) > caitlynCNTol {
		t.Fatalf("AP ratio=%+v want 0.80", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "mark" ||
			bannedOp.Operation == "recoil" || bannedOp.Operation == "dash" ||
			bannedOp.Operation == "cast_delay" {
			t.Fatalf("caliber net must not include excluded op: %+v", bannedOp)
		}
	}
}

func findCaitlynCNAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := caitlynCNAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func caitlynCNRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func caitlynCNLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(caitlynCNRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql"))
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

func caitlynCNSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func caitlynCNSHA256HexUpper(b []byte) string {
	return strings.ToUpper(caitlynCNSHA256Hex(b))
}

func caitlynCNAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > caitlynCNTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > caitlynCNTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != caitlynCNDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), caitlynCNDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != caitlynCNAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), caitlynCNAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != caitlynCNProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), caitlynCNProviderRef)
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

// TestCaitlyn90CaliberNetSourceSeedProviderFormulaShape locks wiki/sidecar/pages/
// local-raw caveat, seed/README/JUnit identities and source blob hashes,
// external-existing-data wording, and E provider/AP formula shape.
func TestCaitlyn90CaliberNetSourceSeedProviderFormulaShape(t *testing.T) {
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
	sidecarRaw, err := os.ReadFile(caitlynCNRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "caitlyn-e.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != caitlynCNCandidateKey || doc.RequestTitle != caitlynCNRequestTitle ||
		doc.ResolvedTitle != caitlynCNResolvedTitle || doc.WikiPageID != caitlynCNWikiPageID ||
		doc.RevisionID != caitlynCNRevisionID || doc.RevisionTimestamp != caitlynCNTimestamp ||
		doc.ContentSHA256 != caitlynCNContentSHA || doc.RawByteSize != caitlynCNRawBytes ||
		doc.SkillKey != "E" || doc.ZhDisplayName != "90口径绳网" || doc.OwnerID != "hero_caitlyn" {
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
	if doc.Fields.Cost != "75\n" || doc.Fields.Costtype != "mana\n" ||
		doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|16 to 8}}\n" {
		t.Fatalf("cooldown=%q want {{ap|16 to 8}} (rank-5 → 8s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|80 to 280}}") ||
		!strings.Contains(doc.Fields.Leveling, "80% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") ||
		!strings.Contains(doc.Fields.Description, "first enemy") ||
		!strings.Contains(doc.Fields.Description, "slow") ||
		!strings.Contains(doc.Fields.Description, "recoil") {
		t.Fatal("wiki prose must retain excluded first-enemy/slow/recoil surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "recoil") ||
		!strings.Contains(doc.Fields.Description2, "dash") {
		t.Fatal("wiki prose must retain excluded recoil/dash surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing Effect at cast time end (excluded): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "terrain") ||
		!strings.Contains(doc.Fields.Notes, "suppression") ||
		!strings.Contains(doc.Fields.Notes, "buffer") {
		t.Fatalf("notes missing terrain/suppression/buffer (excluded): %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(caitlynCNRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "caitlyn-e.json"))
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
		pages.SkillKey != "E" || pages.ZhDisplayName != "90口径绳网" || pages.OwnerID != "hero_caitlyn" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(caitlynCNRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "caitlyn-e.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != caitlynCNLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), caitlynCNLocalRawBytes)
	}
	localSHA := caitlynCNSHA256Hex(rawBytes)
	if localSHA != caitlynCNLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, caitlynCNLocalRawSHA)
	}
	if localSHA == caitlynCNContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == caitlynCNRawBytes {
		t.Fatal("local raw byte length must differ from canonical 2095 (materialization caveat)")
	}
	if caitlynCNPlanRev != "caitlyn-e-90-caliber-net-primary-hit-phase-a-v3" || caitlynCNBoundary !=
		"rank5_primary_champion_first_enemy_single_magic_hit; immediate_impact_scaffold; "+
			"magic_280_plus_0_80_ap; "+
			"no_cast_timing_direction_range_width_line_geometry_multitarget_"+
			"first_enemy_collision_projectile_suppression_spell_shield_recoil_"+
			"dash_terrain_buffered_actions_slow_headshot_mark_other_ranks_or_"+
			"full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := caitlynCNRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := caitlynCNSHA256HexUpper(seedBytes); got != caitlynCNSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, caitlynCNSeedBlobSHA)
	}
	junitPath := caitlynCNRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := caitlynCNSHA256HexUpper(junitBytes); got != caitlynCNJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, caitlynCNJUnitBlobSHA)
	}
	_ = caitlynCNRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := caitlynCNLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(caitlynCNRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		caitlynCNCandidateKey, caitlynCNTaskKey, caitlynCNPlanRev,
		caitlynCNRequestTitle, caitlynCNResolvedTitle,
		"1306916", "4007584", caitlynCNTimestamp, "2095", "2094",
		caitlynCNContentSHA, caitlynCNLocalRawSHA,
		caitlynCNBoundary, caitlynCNProviderRef, caitlynCNAbilityID, caitlynCNAbilityKey,
		"caliber_net_primary_hit_damage", "e_mana_cost", "e_cooldown_ms",
		`{"op":"const","value":75}`, `{"op":"const","value":8000}`,
		caitlynCNSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/caitlyn-e.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"source.attr.ap.resolved",
		"ability_started",
		"20221", "20170",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range caitlynCNOrderedTags() {
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
	for _, tag := range caitlynCNOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if regexp.MustCompile(`(?i)Batch-B\s+prerequisite`).MatchString(seed) {
		t.Fatal("seed must not use Batch-B prerequisite wording")
	}
	if strings.Contains(seed, "caitlyn-e-90-caliber-net-primary-hit-phase-a-v2") {
		t.Fatal("seed must not retain Phase-A v2 frozen plan label")
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.ability_definitions",
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.entity_provider_mounts",
		"phase_hero_caitlyn_e_90_caliber_net_primary_hit_impact",
		"sequence_hero_caitlyn_e_90_caliber_net_primary_hit_impact",
		"step_hero_caitlyn_e_90_caliber_net_primary_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_caitlyn_e_90_caliber_net_primary_hit'\s*,\s*` +
		`'provider_hero_caitlyn_e_90_caliber_net_primary_hit'\s*,\s*` +
		`'caliber_net_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("E must be active ability with stable key caliber_net_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_caitlyn_e_90_caliber_net_primary_hit_damage'\s*,\s*` +
		`'caliber_net_primary_hit_damage'\s*,\s*20221\s*,\s*20170\s*,\s*false`).MatchString(seed) {
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
	if regexp.MustCompile(`(?is)'provider_hero_caitlyn_[pqwr]_|'ability_hero_caitlyn_[pqwr]_|` +
		`'provider_hero_caitlyn_basic_|'ability_hero_caitlyn_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/Q/W/R/basic graph rows")
	}
	for _, banned := range []string{"slow", "recoil", "dash", "headshot", "mark", "projectile"} {
		pat := regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.\S*` + banned)
		if pat.MatchString(sqlNoComments) {
			t.Fatalf("must not write excluded surface matching %q", banned)
		}
	}

	for _, want := range []string{
		caitlynCNCandidateKey, caitlynCNTaskKey, caitlynCNPlanRev,
		"lol_generic_caitlyn_90_caliber_net_primary_hit_seed.sql",
		"LolGenericCaitlyn90CaliberNetPrimaryHitSeedSqlTest",
		"external existing-data",
		"magic_280_plus_0_80_ap",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Caitlyn identity/panel/resource")
	}
	if strings.Contains(readme, "op:caitlyn_90_caliber_net_primary_hit_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}

	compileReq, _ := loadCaitlynCNFixture(t, caitlynCNFixtureOpts{
		resolvedAP: caitlynCNFixtureAPDefault, mr: caitlynCNTargetMR, mana: caitlynCNFixtureManaCD,
	})
	assertCaitlynCNProviderShape(t, compileReq, 1)
	rawX := caitlynCNExpectedRawFromAP(caitlynCNFixtureAPDefault)
	if math.Abs(rawX-caitlynCNExpectedRawDefault) > caitlynCNTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, caitlynCNExpectedRawDefault)
	}
	mitX := expectedMitigatedMagic(rawX, caitlynCNTargetMR)
	if math.Abs(mitX-caitlynCNExpectedMitDefault) > caitlynCNTol {
		t.Fatalf("default mit=%v want %v", mitX, caitlynCNExpectedMitDefault)
	}
}

// TestCaitlyn90CaliberNetFormulaMitigationTable: AP0/100 × MR0/100 raw/mitigated table.
func TestCaitlyn90CaliberNetFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAP, mr         float64
		wantRaw, wantMitigated float64
	}{
		{"AP0_MR0", 0, 0, 280, 280},
		{"AP0_MR100", 0, 100, 280, 140},
		{"AP100_MR0", 100, 0, 360, 360},
		{"AP100_MR100", 100, 100, 360, 180},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := caitlynCNExpectedRawFromAP(tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > caitlynCNTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > caitlynCNTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadCaitlynCNFixture(t, caitlynCNFixtureOpts{
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: caitlynCNFixtureManaCD,
			})
			assertCaitlynCNProviderShape(t, compileReq, 1)
			ref := caitlynCNAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runCaitlynCN(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := caitlynCNDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("E damage evidence=%d want 1", len(dmg))
			}
			caitlynCNAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > caitlynCNTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(caitlynCNAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(caitlynCNAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestCaitlyn90CaliberNetCooldownMana225AbilityStarted: mana225/HP1000/AP100/MR100 at
// t0/t7999/t8000 → success/skip/success; final mana75/HP640; two E damage items
// and two automatic E ability_started events; readyAtMs=8000.
func TestCaitlyn90CaliberNetCooldownMana225AbilityStarted(t *testing.T) {
	compileReq, runReq := loadCaitlynCNFixture(t, caitlynCNFixtureOpts{
		resolvedAP: caitlynCNFixtureAPDefault, mr: caitlynCNTargetMR,
		mana: caitlynCNFixtureManaCD, hp: caitlynCNTargetHP,
	})
	assertCaitlynCNProviderShape(t, compileReq, 1)
	ref := caitlynCNAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
	}
	runReq.StopPolicy.DurationMs = 8100
	done := runCaitlynCN(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if caitlynCNSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findCaitlynCNAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt7999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 7999 {
			t.Fatalf("cooldown skip TimeMs=%d want 7999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 8000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 8000", item.Data["readyAtMs"])
		}
		skipAt7999 = true
	}
	if !skipAt7999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=7999 with readyAtMs=8000")
	}

	items := caitlynCNDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("E damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 8000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		caitlynCNAssertDamage(t, item, caitlynCNExpectedRawDefault, caitlynCNExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * caitlynCNExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-caitlynCNHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, caitlynCNHPAfter2)
	}
	gotMana := caitlynCNSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-caitlynCNManaAfter2) > caitlynCNTol {
		t.Fatalf("mana=%v want %v", gotMana, caitlynCNManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := caitlynCNAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic E; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 8000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-caitlynCNFixtureAPDefault) > caitlynCNTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), caitlynCNFixtureAPDefault)
	}
}

// TestCaitlyn90CaliberNetResourceInsufficientMana74: mana74 at t0 → resource_insufficient;
// mana/HP unchanged; zero E damage/event.
func TestCaitlyn90CaliberNetResourceInsufficientMana74(t *testing.T) {
	compileReq, runReq := loadCaitlynCNFixture(t, caitlynCNFixtureOpts{
		resolvedAP: caitlynCNFixtureAPDefault, mr: caitlynCNTargetMR,
		mana: caitlynCNFixtureManaShort, hp: caitlynCNTargetHP,
	})
	ref := caitlynCNAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCaitlynCN(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if caitlynCNSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(caitlynCNSourceMana(t, done.FinalSnapshot)-caitlynCNFixtureManaShort) > caitlynCNTol {
		t.Fatalf("mana changed: got %v want %v",
			caitlynCNSourceMana(t, done.FinalSnapshot), caitlynCNFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-caitlynCNTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, caitlynCNTargetHP)
	}
	if len(caitlynCNDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero E damage evidence")
	}
	if len(caitlynCNAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestCaitlyn90CaliberNetStandaloneNoSiblingSynthesis: standalone E provider does not
// synthesize P/Q/W/R/basic/Headshot/recoil/dash/slow/projectile or overwrite unrelated defs.
func TestCaitlyn90CaliberNetStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadCaitlynCNFixture(t, caitlynCNFixtureOpts{
		resolvedAP: caitlynCNFixtureAPDefault, mr: caitlynCNTargetMR, mana: caitlynCNFixtureManaCD,
	})
	assertCaitlynCNProviderShape(t, compileReq, 1)

	sentinelKey := "fixture_caitlyn_90_caliber_net_unrelated_sentinel"
	sentinelStable := "fixture_caitlyn_90_caliber_net_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != caitlynCNProviderRef {
		t.Fatalf("source mounts=%+v want only E", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != caitlynCNProviderRef {
			t.Fatalf("source snapshots=%+v want only E", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_caitlyn_[pqwr]_|ability_hero_caitlyn_[pqwr]_|` +
		`provider_hero_caitlyn_basic_|ability_hero_caitlyn_basic_|` +
		`(?i)headshot|recoil|dash|slow|projectile`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == caitlynCNProviderRef || p.StableID == caitlynCNStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic/excluded provider: %+v", p)
		}
		if p.ProviderKey != caitlynCNProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("E must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := caitlynCNAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCaitlynCN(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(caitlynCNDamageEvidence(done)) != 1 {
		t.Fatalf("E damage=%d want 1", len(caitlynCNDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone E must not synthesize extra damage")
	}
	if len(caitlynCNAbilityStartedEvidence(done)) != 1 {
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
				if ps.ProviderRef == caitlynCNProviderRef || ps.DefinitionRef == caitlynCNProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic/excluded: %+v", ps)
			}
		}
	}
}

// TestCaitlyn90CaliberNetDeterminismAndLifecycle: repeated compile/run evidence stability plus
// CompileFrame→RunFrame→ReleaseSessionFrame and wrong/missing/released session behavior.
func TestCaitlyn90CaliberNetDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadCaitlynCNFixture(t, caitlynCNFixtureOpts{
				resolvedAP: caitlynCNFixtureAPDefault, mr: caitlynCNTargetMR, mana: caitlynCNFixtureManaCD,
			})
			ref := caitlynCNAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
				{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
			}
			r.StopPolicy.DurationMs = 8100
			done := runCaitlynCN(t, c, r)
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
		c, r := loadCaitlynCNFixture(t, caitlynCNFixtureOpts{
			resolvedAP: caitlynCNFixtureAPDefault, mr: caitlynCNTargetMR, mana: caitlynCNFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: caitlynCNAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runCaitlynCNFrames(t, c, r)
		if len(caitlynCNDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path E damage=%d want 1", len(caitlynCNDamageEvidence(done)))
		}
		caitlynCNAssertDamage(t, caitlynCNDamageEvidence(done)[0], caitlynCNExpectedRawDefault, caitlynCNExpectedMitDefault)
		if len(caitlynCNAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadCaitlynCNFixture(t, caitlynCNFixtureOpts{
			resolvedAP: caitlynCNFixtureAPDefault, mr: caitlynCNTargetMR, mana: caitlynCNFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: caitlynCNAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
