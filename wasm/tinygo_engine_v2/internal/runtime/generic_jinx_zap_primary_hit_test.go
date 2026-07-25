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

// hero_jinx W Zap! / 震荡电磁波！ — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: jinx-w-zap-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_champion_single_physical_hit; immediate_impact_scaffold;
//	physical_210_plus_1_40_total_ad; no_cast_timing_direction_range_width_projectile_travel_collision_first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_jinx|W|震荡电磁波！
//	task wasm-generic-jinx-zap-primary-hit
//	Request Template:Data Jinx/W → resolved Template:Data Jinx/Zap!
//	wikiPageId 1307598 / rev 3907092 / timestamp 2025-06-06T17:47:18Z
//	canonical rawByteSize 1321 / SHA256
//	  8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f
//	数据参考/lol-wiki-current-champions/normalized/generic/jinx-w.json
//	pages/raw siblings: pages/jinx-w.json, raw/jinx-w.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_jinx_zap_primary_hit_seed.sql
//	Local raw materialization caveat: 1319 bytes / SHA256
//	  c373cc258c5c8c612930a32c5e851bd4b68dbbcb3c0d7f71ce1d25020ba12624.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_jinx_w_zap_primary_hit (standalone;
//     not P/Q/E/R/basic synthesis)
//   - ability ability_hero_jinx_w_zap_primary_hit with ability_key
//     zap_primary_hit: active; mana 60; cooldown 4000 ms
//   - Exactly one immediate direct-target physical damage op:
//     210 + 1.40*source.attr.ad.resolved
//     (AD is total AD; never subtract base AD; never call it bonus AD)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No Jinx state/modifier/listener/repeat/control/projectile/sight/reveal/
//     slow; no explicit event op — successful cast relies on runtime automatic
//     ability_started. Fixture-only AD modifier may set resolved total AD and
//     is clearly test-only.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast/effect timing, direction/range/width/geometry, projectile/travel/
//   collision/interception/spellshield/first-enemy acquisition, sight/reveal,
//   slow/control/tenacity, ranks 1–4, siblings/basic/loadout/crit/on-hit,
//   live/E2E/full fidelity.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage,
// immediate_impact_scaffold.

const (
	jinxZapCandidateKey  = "hero_skill|hero_jinx|W|震荡电磁波！"
	jinxZapTaskKey       = "wasm-generic-jinx-zap-primary-hit"
	jinxZapPlanRev       = "jinx-w-zap-primary-hit-phase-a-v1"
	jinxZapRequestTitle  = "Template:Data Jinx/W"
	jinxZapResolvedTitle = "Template:Data Jinx/Zap!"
	jinxZapWikiPageID    = 1307598
	jinxZapRevisionID    = 3907092
	jinxZapTimestamp     = "2025-06-06T17:47:18Z"
	jinxZapRawBytes      = 1321
	jinxZapLocalRawBytes = 1319
	jinxZapContentSHA    = "8aa6ac3943076256fe6afea15f1dd6eebf892656be45784e2522abb6243f4d1f"
	jinxZapLocalRawSHA   = "c373cc258c5c8c612930a32c5e851bd4b68dbbcb3c0d7f71ce1d25020ba12624"
	jinxZapBoundary      = "rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; " +
		"physical_210_plus_1_40_total_ad; " +
		"no_cast_timing_direction_range_width_projectile_travel_collision_" +
		"first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity"

	jinxZapProviderRef = "provider_hero_jinx_w_zap_primary_hit"
	jinxZapStableID    = "hero_jinx_w_zap_primary_hit"
	jinxZapAbilityID   = "ability_hero_jinx_w_zap_primary_hit"
	jinxZapAbilityKey  = "zap_primary_hit"
	jinxZapDamageOpRef = "op:jinx_zap_primary_hit_damage"
	jinxZapTotalADMod  = "fixture_jinx_zap_primary_hit_total_ad"

	jinxZapBaseDamage = 210.0
	jinxZapADRatio    = 1.40
	jinxZapManaCost   = 60.0
	jinxZapCDMs       = 4000.0

	// Fixture base stays independent; flat modifier raises ad.resolved to total AD.
	jinxZapADBase            = 59.0
	jinxZapADResolvedDefault = 110.0
	jinxZapFixtureManaCD     = 180.0
	jinxZapFixtureManaShort  = 59.0
	jinxZapTargetArmor       = 100.0
	jinxZapTargetHP          = 1000.0

	jinxZapExpectedRawDefault = 364.0 // 210 + 1.40*110
	jinxZapExpectedMitDefault = 182.0 // armor100
	jinxZapManaAfter2         = 60.0  // 180 - 60 - 60
	jinxZapHPAfter2           = 636.0 // 1000 - 182 - 182

	jinxZapSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":210},` +
		`{"op":"mul","args":[{"op":"const","value":1.40},` +
		`{"op":"read","path":"source.attr.ad.resolved"}]}]}`

	jinxZapTol = 1e-9
)

func jinxZapOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"immediate_impact_scaffold",
	}
}

func jinxZapExpectedRawFromTotalAD(resolvedAD float64) float64 {
	return jinxZapBaseDamage + jinxZapADRatio*resolvedAD
}

func jinxZapDamageAmount() *model.GenericFormulaExpr {
	base := jinxZapBaseDamage
	adRatio := jinxZapADRatio
	// Binary add only: const 210 + mul(1.40, source.attr.ad.resolved).
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

func jinxZapAbility() model.AbilityDefinition {
	cost := jinxZapManaCost
	cd := jinxZapCDMs
	return model.AbilityDefinition{
		AbilityKey: jinxZapAbilityKey,
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
				Ref:           jinxZapDamageOpRef,
				Amount:        jinxZapDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func jinxZapProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: jinxZapProviderRef,
		Kind:        "champion",
		StableID:    jinxZapStableID,
		Abilities:   []model.AbilityDefinition{jinxZapAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed W provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: jinxZapTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func jinxZapAbilityRef() string {
	return "source.provider[" + jinxZapProviderRef + "].ability[" + jinxZapAbilityKey + "]"
}

type jinxZapFixtureOpts struct {
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func configureJinxZapProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts jinxZapFixtureOpts) {
	flat := opts.resolvedAD - jinxZapADBase
	p := jinxZapProviderDef(flat)
	compileReq.SharedProviders = []model.ProviderDefinition{p}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: jinxZapProviderRef, DefinitionRef: jinxZapProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: jinxZapProviderRef, DefinitionRef: jinxZapProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureJinxZapTypes(req *model.CompileRequest) {
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

func loadJinxZapFixture(t *testing.T, opts jinxZapFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.resolvedAD == 0 {
		opts.resolvedAD = jinxZapADResolvedDefault
	}
	if opts.mana == 0 {
		opts.mana = jinxZapFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = jinxZapTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureJinxZapTypes(&compileReq)
	configureJinxZapProvider(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: jinxZapADBase, Current: jinxZapADBase,
		Max: jinxZapADBase, Resolved: jinxZapADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, jinxZapFixtureManaCD),
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

func runJinxZap(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runJinxZapFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func jinxZapSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func jinxZapSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func jinxZapSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func jinxZapDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := jinxZapAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != jinxZapDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func jinxZapAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func jinxZapFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == jinxZapProviderRef {
			return p
		}
	}
	return nil
}

func assertJinxZapProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := jinxZapFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_jinx_w_zap_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != jinxZapProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, jinxZapProviderRef)
	}
	if p.StableID != jinxZapStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, jinxZapStableID)
	}
	banned := []string{
		"provider_hero_jinx_p_", "provider_hero_jinx_q_", "provider_hero_jinx_e_",
		"provider_hero_jinx_r_", "provider_hero_jinx_basic_",
		"ability_hero_jinx_p_", "ability_hero_jinx_q_", "ability_hero_jinx_e_",
		"ability_hero_jinx_r_", "ability_hero_jinx_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("zap primary-hit must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != jinxZapTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], jinxZapTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), jinxZapAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != jinxZapAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, jinxZapAbilityKey, jinxZapAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("zap_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-jinxZapManaCost) > jinxZapTol {
		t.Fatalf("cost=%+v want mana const 60", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-jinxZapCDMs) > jinxZapTol {
		t.Fatalf("cooldown=%+v want const 4000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("zap damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("zap damage must not be copyable on hit")
	}
	if op.Ref != jinxZapDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, jinxZapDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 210, mul(1.40, ad.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-jinxZapBaseDamage) > jinxZapTol {
		t.Fatalf("base const=%+v want 210", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-jinxZapADRatio) > jinxZapTol {
		t.Fatalf("AD ratio=%+v want 1.40", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	if adMul.Args[1].Op == "sub" || (len(adMul.Args) > 1 && adMul.Args[1].Op == "sub") {
		t.Fatal("total-AD formula must not subtract ad.base")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "projectile" ||
			bannedOp.Operation == "multi_target" || bannedOp.Operation == "state_change" ||
			bannedOp.Operation == "repeat" || bannedOp.Operation == "control" ||
			bannedOp.Operation == "reveal" || bannedOp.Operation == "sight" ||
			bannedOp.Operation == "cast_delay" {
			t.Fatalf("zap must not include excluded op: %+v", bannedOp)
		}
	}
}

func findJinxZapAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := jinxZapAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func jinxZapRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func jinxZapLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(jinxZapRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_jinx_zap_primary_hit_seed.sql"))
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

func jinxZapSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func jinxZapAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > jinxZapTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > jinxZapTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != jinxZapDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), jinxZapDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != jinxZapAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), jinxZapAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != jinxZapProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), jinxZapProviderRef)
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

// TestJinxZapSourceSeedProviderFormulaShape locks wiki/sidecar/pages/local-raw
// caveat, seed/README/JUnit identities, external-existing-data wording, and W
// provider/total-AD formula shape.
func TestJinxZapSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(jinxZapRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "jinx-w.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != jinxZapCandidateKey || doc.RequestTitle != jinxZapRequestTitle ||
		doc.ResolvedTitle != jinxZapResolvedTitle || doc.WikiPageID != jinxZapWikiPageID ||
		doc.RevisionID != jinxZapRevisionID || doc.RevisionTimestamp != jinxZapTimestamp ||
		doc.ContentSHA256 != jinxZapContentSHA || doc.RawByteSize != jinxZapRawBytes ||
		doc.SkillKey != "W" || doc.ZhDisplayName != "震荡电磁波！" || doc.OwnerID != "hero_jinx" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{"description", "leveling", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|40 to 60}}\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|8|7|6|5|4}}\n" {
		t.Fatalf("cooldown=%q want rank table ending in 4s", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|10 to 210}}") ||
		!strings.Contains(doc.Fields.Leveling, "140% AD") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "first enemy") ||
		!strings.Contains(doc.Fields.Description, "reveals") ||
		!strings.Contains(doc.Fields.Description, "slows") {
		t.Fatal("wiki prose must retain excluded first-enemy/reveal/slow surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time start") {
		t.Fatalf("notes missing Effect at cast time start (excluded): %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(jinxZapRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "jinx-w.json"))
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
		pages.SkillKey != "W" || pages.ZhDisplayName != "震荡电磁波！" || pages.OwnerID != "hero_jinx" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(jinxZapRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "jinx-w.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != jinxZapLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), jinxZapLocalRawBytes)
	}
	localSHA := jinxZapSHA256Hex(rawBytes)
	if localSHA != jinxZapLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, jinxZapLocalRawSHA)
	}
	if localSHA == jinxZapContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == jinxZapRawBytes {
		t.Fatal("local raw byte length must differ from canonical 1321 (materialization caveat)")
	}
	if jinxZapPlanRev != "jinx-w-zap-primary-hit-phase-a-v1" || jinxZapBoundary !=
		"rank5_primary_champion_single_physical_hit; immediate_impact_scaffold; "+
			"physical_210_plus_1_40_total_ad; "+
			"no_cast_timing_direction_range_width_projectile_travel_collision_"+
			"first_enemy_acquisition_sight_reveal_slow_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seed, sqlNoComments := jinxZapLoadSeedSQL(t)
	_ = jinxZapRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericJinxZapPrimaryHitSeedSqlTest.java")
	readmeBytes, err := os.ReadFile(jinxZapRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		jinxZapCandidateKey, jinxZapTaskKey, jinxZapPlanRev,
		jinxZapRequestTitle, jinxZapResolvedTitle,
		"1307598", "3907092", jinxZapTimestamp, "1321", "1319",
		jinxZapContentSHA, jinxZapLocalRawSHA,
		jinxZapBoundary, jinxZapProviderRef, jinxZapAbilityID, jinxZapAbilityKey,
		"zap_damage", "w_mana_cost", "w_cooldown_ms",
		`{"op":"const","value":60}`, `{"op":"const","value":4000}`,
		jinxZapSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/jinx-w.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"total AD", "source.attr.ad.resolved",
		"ability_started",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range jinxZapOrderedTags() {
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
	for _, tag := range jinxZapOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
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
		"phase_hero_jinx_w_zap_primary_hit_impact",
		"sequence_hero_jinx_w_zap_primary_hit_impact",
		"step_hero_jinx_w_zap_primary_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_jinx_w_zap_primary_hit'\s*,\s*` +
		`'provider_hero_jinx_w_zap_primary_hit'\s*,\s*` +
		`'zap_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("W must be active ability with stable key zap_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_jinx_w_zap_primary_hit_damage'\s*,\s*` +
		`'zap_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be physical 20220 add policy copyable_on_hit=false")
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
	if regexp.MustCompile(`(?is)'provider_hero_jinx_[pqer]_|'ability_hero_jinx_[pqer]_|` +
		`'provider_hero_jinx_basic_|'ability_hero_jinx_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/Q/E/R/basic graph rows")
	}

	for _, want := range []string{
		jinxZapCandidateKey, jinxZapTaskKey, jinxZapPlanRev,
		"lol_generic_jinx_zap_primary_hit_seed.sql",
		"LolGenericJinxZapPrimaryHitSeedSqlTest",
		"external existing-data",
		"physical_210_plus_1_40_total_ad",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Jinx identity/panel/resource")
	}
	if strings.Contains(readme, "fixture_jinx_zap_primary_hit_total_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production W behavior")
	}

	compileReq, _ := loadJinxZapFixture(t, jinxZapFixtureOpts{
		resolvedAD: jinxZapADResolvedDefault, armor: jinxZapTargetArmor, mana: jinxZapFixtureManaCD,
	})
	assertJinxZapProviderShape(t, compileReq, 1, true)
	rawX := jinxZapExpectedRawFromTotalAD(jinxZapADResolvedDefault)
	if math.Abs(rawX-jinxZapExpectedRawDefault) > jinxZapTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, jinxZapExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, jinxZapTargetArmor)
	if math.Abs(mitX-jinxZapExpectedMitDefault) > jinxZapTol {
		t.Fatalf("default mit=%v want %v", mitX, jinxZapExpectedMitDefault)
	}
	bonusOnly := jinxZapExpectedRawFromTotalAD(jinxZapADResolvedDefault - jinxZapADBase)
	if math.Abs(bonusOnly-jinxZapExpectedRawDefault) < jinxZapTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	baseOnly := jinxZapExpectedRawFromTotalAD(jinxZapADBase)
	if math.Abs(baseOnly-jinxZapExpectedRawDefault) < jinxZapTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestJinxZapFormulaMitigationTable: totalAD60/110 × armor0/100 raw/mitigated table.
func TestJinxZapFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, armor      float64
		wantRaw, wantMitigated float64
	}{
		{"totalAD60_armor0", 60, 0, 294, 294},
		{"totalAD60_armor100", 60, 100, 294, 147},
		{"totalAD110_armor0", 110, 0, 364, 364},
		{"totalAD110_armor100", 110, 100, 364, 182},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := jinxZapExpectedRawFromTotalAD(tc.resolvedAD)
			if math.Abs(rawX-tc.wantRaw) > jinxZapTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > jinxZapTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadJinxZapFixture(t, jinxZapFixtureOpts{
				resolvedAD: tc.resolvedAD, armor: tc.armor, mana: jinxZapFixtureManaCD,
			})
			assertJinxZapProviderShape(t, compileReq, 1, tc.resolvedAD != jinxZapADBase)
			ref := jinxZapAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runJinxZap(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := jinxZapDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("W damage evidence=%d want 1", len(dmg))
			}
			jinxZapAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > jinxZapTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(jinxZapSourceAttrBase(t, done.FinalSnapshot, "ad")-jinxZapADBase) > jinxZapTol {
				t.Fatalf("ad.base=%v want %v", jinxZapSourceAttrBase(t, done.FinalSnapshot, "ad"), jinxZapADBase)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(jinxZapAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(jinxZapAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestJinxZapCooldownMana180AbilityStarted: mana180/HP1000/AD110/armor100 at
// t0/t3999/t4000 → success/skip/success; final mana60/HP636; two W damage items
// and two automatic W ability_started events.
func TestJinxZapCooldownMana180AbilityStarted(t *testing.T) {
	compileReq, runReq := loadJinxZapFixture(t, jinxZapFixtureOpts{
		resolvedAD: jinxZapADResolvedDefault, armor: jinxZapTargetArmor,
		mana: jinxZapFixtureManaCD, hp: jinxZapTargetHP,
	})
	assertJinxZapProviderShape(t, compileReq, 1, true)
	ref := jinxZapAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 3999},
		{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4000},
	}
	runReq.StopPolicy.DurationMs = 4100
	done := runJinxZap(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if jinxZapSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findJinxZapAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt3999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 3999 {
			t.Fatalf("cooldown skip TimeMs=%d want 3999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 4000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 4000", item.Data["readyAtMs"])
		}
		skipAt3999 = true
	}
	if !skipAt3999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=3999 with readyAtMs=4000")
	}

	items := jinxZapDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("W damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 4000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		jinxZapAssertDamage(t, item, jinxZapExpectedRawDefault, jinxZapExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * jinxZapExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-jinxZapHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, jinxZapHPAfter2)
	}
	gotMana := jinxZapSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-jinxZapManaAfter2) > jinxZapTol {
		t.Fatalf("mana=%v want %v", gotMana, jinxZapManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := jinxZapAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic W; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 4000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-jinxZapADResolvedDefault) > jinxZapTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), jinxZapADResolvedDefault)
	}
	if math.Abs(jinxZapSourceAttrBase(t, done.FinalSnapshot, "ad")-jinxZapADBase) > jinxZapTol {
		t.Fatalf("ad.base=%v want %v", jinxZapSourceAttrBase(t, done.FinalSnapshot, "ad"), jinxZapADBase)
	}
}

// TestJinxZapResourceInsufficientMana59: mana59 at t0 → resource_insufficient;
// mana/HP unchanged; zero W damage/event.
func TestJinxZapResourceInsufficientMana59(t *testing.T) {
	compileReq, runReq := loadJinxZapFixture(t, jinxZapFixtureOpts{
		resolvedAD: jinxZapADResolvedDefault, armor: jinxZapTargetArmor,
		mana: jinxZapFixtureManaShort, hp: jinxZapTargetHP,
	})
	ref := jinxZapAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJinxZap(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if jinxZapSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(jinxZapSourceMana(t, done.FinalSnapshot)-jinxZapFixtureManaShort) > jinxZapTol {
		t.Fatalf("mana changed: got %v want %v",
			jinxZapSourceMana(t, done.FinalSnapshot), jinxZapFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-jinxZapTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, jinxZapTargetHP)
	}
	if len(jinxZapDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero W damage evidence")
	}
	if len(jinxZapAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestJinxZapStandaloneNoSiblingSynthesis: standalone W provider does not
// synthesize P/Q/E/R/basic or overwrite unrelated definitions/mounts/snapshots.
func TestJinxZapStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadJinxZapFixture(t, jinxZapFixtureOpts{
		resolvedAD: jinxZapADResolvedDefault, armor: jinxZapTargetArmor, mana: jinxZapFixtureManaCD,
	})
	assertJinxZapProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_jinx_zap_unrelated_sentinel"
	sentinelStable := "fixture_jinx_zap_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != jinxZapProviderRef {
		t.Fatalf("source mounts=%+v want only W", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != jinxZapProviderRef {
			t.Fatalf("source snapshots=%+v want only W", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_jinx_[pqer]_|ability_hero_jinx_[pqer]_|` +
		`provider_hero_jinx_basic_|ability_hero_jinx_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != jinxZapProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("W must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := jinxZapAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJinxZap(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(jinxZapDamageEvidence(done)) != 1 {
		t.Fatalf("W damage=%d want 1", len(jinxZapDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone W must not synthesize extra damage")
	}
	if len(jinxZapAbilityStartedEvidence(done)) != 1 {
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
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestJinxZapDeterminismAndLifecycle: repeated compile/run evidence stability plus
// CompileFrame→RunFrame→ReleaseSessionFrame and wrong/missing/released session behavior.
func TestJinxZapDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadJinxZapFixture(t, jinxZapFixtureOpts{
				resolvedAD: jinxZapADResolvedDefault, armor: jinxZapTargetArmor, mana: jinxZapFixtureManaCD,
			})
			ref := jinxZapAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 3999},
				{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4000},
			}
			r.StopPolicy.DurationMs = 4100
			done := runJinxZap(t, c, r)
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
		c, r := loadJinxZapFixture(t, jinxZapFixtureOpts{
			resolvedAD: jinxZapADResolvedDefault, armor: jinxZapTargetArmor, mana: jinxZapFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: jinxZapAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runJinxZapFrames(t, c, r)
		if len(jinxZapDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path W damage=%d want 1", len(jinxZapDamageEvidence(done)))
		}
		jinxZapAssertDamage(t, jinxZapDamageEvidence(done)[0], jinxZapExpectedRawDefault, jinxZapExpectedMitDefault)
		if len(jinxZapAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadJinxZapFixture(t, jinxZapFixtureOpts{
			resolvedAD: jinxZapADResolvedDefault, armor: jinxZapTargetArmor, mana: jinxZapFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: jinxZapAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
