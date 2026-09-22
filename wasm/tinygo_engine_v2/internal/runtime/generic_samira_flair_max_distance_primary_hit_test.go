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

// hero_samira Q Flair / 交火 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: samira-q-flair-max-distance-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_max_distance_ranged_shot_selected_primary_physical_hit; immediate_impact_scaffold;
//	physical_20_plus_1_10_total_ad; mana30_cooldown2000ms; exactly_one_immediate_damage_quantum;
//	no_distance_range_direction_projectile_collision_melee_slash_wild_rush_e_explosives_crit_
//	expected_crit_rng_150_percent_lifesteal_style_multitarget_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_samira|Q|交火
//	task wasm-generic-samira-flair-max-distance-primary-hit
//	Request Template:Data Samira/Q → resolved Template:Data Samira/Flair
//	wikiPageId 1459315 / rev 4008027 / timestamp 2026-04-13T03:58:01Z
//	canonical rawByteSize 3596 / SHA256
//	  7f65786ccae8186903166195be9151294adef3539fe97f067de4273e162cd203
//	数据参考/lol-wiki-current-champions/normalized/generic/samira-q.json
//	  bytes 3596 / SHA256
//	  9077cd57cd3f2713d4725a2b3264b987163feb57d97c892669bc35bbde8ecc0d
//	pages/raw siblings: pages/samira-q.json (bytes 666 / SHA256
//	  c572e9baffa2c4ec196fe5a410c3ca89ddfc717e63be43be6428626ef7e93976),
//	  raw/samira-q.wikitext
//	Backend seed (cross-worktree absolute path; committed Backend c89841a):
//	  C:/project/damage_backend_dev/db/game_manage/seeds/
//	  lol_generic_samira_flair_max_distance_primary_hit_seed.sql
//	Local raw materialization caveat: 3596 bytes / SHA256
//	  fe7ba68ec41b06ea2592a9f0b751d5970b0d42914886c926b3d90509efca5f8d.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction (同 size 不等于等价).
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_samira_q_flair_max_distance_primary_hit
//     (standalone; not P/W/E/R/basic synthesis)
//   - ability ability_hero_samira_q_flair_max_distance_primary_hit with ability_key
//     flair_max_distance_primary_hit: active; mana 30; cooldown 2000 ms
//   - Exactly one immediate direct-target physical damage op:
//     20 + 1.10*source.attr.ad.resolved
//     (AD is total AD; never subtract base AD; never call it bonus AD)
//   - Maximum-distance only selects the assumed ranged branch; formula has no
//     distance multiplier/input.
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No Samira state/modifier/listener/repeat/control/projectile/geometry/
//     melee/Wild Rush/style; no explicit event op — successful cast relies on
//     runtime automatic ability_started. Fixture-only AD modifier may set
//     resolved total AD and is clearly test-only.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   distance/range/direction/projectile/travel/collision/interception/
//   first-enemy search/geometry; melee slash/cone; Wild Rush/E explosives;
//   W/R concurrency; passive/style; animation/cast time; crit/expected crit/
//   RNG/150%/IE; lifesteal/healing; multi-target; aggro; on-hit/proc; other
//   ranks; full fidelity.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage,
// immediate_impact_scaffold (explicitly no total_ad_ratio governed tag).
//
// Hero-named `_test.go` is regression/governance evidence only; production
// runtime remains generic (no if hero_samira production behavior).

const (
	samiraFlairCandidateKey    = "hero_skill|hero_samira|Q|交火"
	samiraFlairTaskKey         = "wasm-generic-samira-flair-max-distance-primary-hit"
	samiraFlairPlanRev         = "samira-q-flair-max-distance-primary-hit-phase-a-v1"
	samiraFlairRequestTitle    = "Template:Data Samira/Q"
	samiraFlairResolvedTitle   = "Template:Data Samira/Flair"
	samiraFlairWikiPageID      = 1459315
	samiraFlairRevisionID      = 4008027
	samiraFlairTimestamp       = "2026-04-13T03:58:01Z"
	samiraFlairRawBytes        = 3596
	samiraFlairLocalRawBytes   = 3596
	samiraFlairNormalizedBytes = 3596
	samiraFlairPagesBytes      = 666
	samiraFlairContentSHA      = "7f65786ccae8186903166195be9151294adef3539fe97f067de4273e162cd203"
	samiraFlairLocalRawSHA     = "fe7ba68ec41b06ea2592a9f0b751d5970b0d42914886c926b3d90509efca5f8d"
	samiraFlairNormalizedSHA   = "9077cd57cd3f2713d4725a2b3264b987163feb57d97c892669bc35bbde8ecc0d"
	samiraFlairPagesSHA        = "c572e9baffa2c4ec196fe5a410c3ca89ddfc717e63be43be6428626ef7e93976"
	samiraFlairBoundary        = "rank5_max_distance_ranged_shot_selected_primary_physical_hit; immediate_impact_scaffold; " +
		"physical_20_plus_1_10_total_ad; mana30_cooldown2000ms; exactly_one_immediate_damage_quantum; " +
		"no_distance_range_direction_projectile_collision_melee_slash_wild_rush_e_explosives_crit_" +
		"expected_crit_rng_150_percent_lifesteal_style_multitarget_other_ranks_or_full_fidelity"

	// Cross-worktree Backend evidence root (committed Backend slice c89841a).
	samiraFlairBackendRoot = "C:/project/damage_backend_dev"

	samiraFlairProviderRef = "provider_hero_samira_q_flair_max_distance_primary_hit"
	samiraFlairStableID    = "hero_samira_q_flair_max_distance_primary_hit"
	samiraFlairAbilityID   = "ability_hero_samira_q_flair_max_distance_primary_hit"
	samiraFlairAbilityKey  = "flair_max_distance_primary_hit"
	samiraFlairDamageOpRef = "op:samira_flair_max_distance_primary_hit_damage"
	samiraFlairTotalADMod  = "fixture_samira_flair_max_distance_primary_hit_total_ad"

	samiraFlairBaseDamage = 20.0
	samiraFlairADRatio    = 1.10
	samiraFlairManaCost   = 30.0
	samiraFlairCDMs       = 2000.0

	// Fixture base stays independent; flat modifier raises ad.resolved to total AD.
	samiraFlairADBaseDefault     = 60.0
	samiraFlairADResolvedDefault = 100.0
	samiraFlairFixtureManaCD     = 300.0
	samiraFlairFixtureManaShort  = 29.0
	samiraFlairTargetArmor       = 100.0
	samiraFlairTargetHP          = 1000.0

	samiraFlairExpectedRawDefault = 130.0 // 20 + 1.10*100
	samiraFlairExpectedMitDefault = 65.0  // armor100
	samiraFlairManaAfter1         = 270.0 // 300 - 30
	samiraFlairManaAfter2         = 240.0 // 300 - 30 - 30
	samiraFlairHPAfter1           = 935.0 // 1000 - 65
	samiraFlairHPAfter2           = 870.0 // 1000 - 65 - 65

	samiraFlairSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":20},` +
		`{"op":"mul","args":[{"op":"const","value":1.10},` +
		`{"op":"read","path":"source.attr.ad.resolved"}]}]}`

	samiraFlairTol = 1e-9
)

func samiraFlairOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"immediate_impact_scaffold",
	}
}

func samiraFlairExpectedRawFromTotalAD(resolvedAD float64) float64 {
	return samiraFlairBaseDamage + samiraFlairADRatio*resolvedAD
}

func samiraFlairDamageAmount() *model.GenericFormulaExpr {
	base := samiraFlairBaseDamage
	adRatio := samiraFlairADRatio
	// Binary add only: const 20 + mul(1.10, source.attr.ad.resolved).
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

func samiraFlairAbility() model.AbilityDefinition {
	cost := samiraFlairManaCost
	cd := samiraFlairCDMs
	return model.AbilityDefinition{
		AbilityKey: samiraFlairAbilityKey,
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
				Ref:           samiraFlairDamageOpRef,
				Amount:        samiraFlairDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func samiraFlairProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: samiraFlairProviderRef,
		Kind:        "champion",
		StableID:    samiraFlairStableID,
		Abilities:   []model.AbilityDefinition{samiraFlairAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed Q provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: samiraFlairTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func samiraFlairAbilityRef() string {
	return "source.provider[" + samiraFlairProviderRef + "].ability[" + samiraFlairAbilityKey + "]"
}

type samiraFlairFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func configureSamiraFlairProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts samiraFlairFixtureOpts) {
	flat := opts.resolvedAD - opts.baseAD
	p := samiraFlairProviderDef(flat)
	compileReq.SharedProviders = []model.ProviderDefinition{p}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: samiraFlairProviderRef, DefinitionRef: samiraFlairProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: samiraFlairProviderRef, DefinitionRef: samiraFlairProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureSamiraFlairTypes(req *model.CompileRequest) {
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

func loadSamiraFlairFixture(t *testing.T, opts samiraFlairFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/armor explicitly (AD0 / armor0 are valid).
	if opts.mana == 0 {
		opts.mana = samiraFlairFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = samiraFlairTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureSamiraFlairTypes(&compileReq)
	configureSamiraFlairProvider(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, samiraFlairFixtureManaCD),
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

func runSamiraFlair(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runSamiraFlairFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func samiraFlairSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func samiraFlairSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func samiraFlairDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := samiraFlairAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != samiraFlairDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func samiraFlairAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func samiraFlairFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == samiraFlairProviderRef {
			return p
		}
	}
	return nil
}

func assertSamiraFlairProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := samiraFlairFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_samira_q_flair_max_distance_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != samiraFlairProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, samiraFlairProviderRef)
	}
	if p.StableID != samiraFlairStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, samiraFlairStableID)
	}
	banned := []string{
		"provider_hero_samira_p_", "provider_hero_samira_w_", "provider_hero_samira_e_",
		"provider_hero_samira_r_", "provider_hero_samira_basic_",
		"ability_hero_samira_p_", "ability_hero_samira_w_", "ability_hero_samira_e_",
		"ability_hero_samira_r_", "ability_hero_samira_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("flair max-distance primary-hit must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != samiraFlairTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], samiraFlairTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), samiraFlairAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != samiraFlairAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, samiraFlairAbilityKey, samiraFlairAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("flair_max_distance_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-samiraFlairManaCost) > samiraFlairTol {
		t.Fatalf("cost=%+v want mana const 30", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-samiraFlairCDMs) > samiraFlairTol {
		t.Fatalf("cooldown=%+v want const 2000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("flair damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("flair damage must not be copyable on hit")
	}
	if op.Ref != samiraFlairDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, samiraFlairDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 20, mul(1.10, ad.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-samiraFlairBaseDamage) > samiraFlairTol {
		t.Fatalf("base const=%+v want 20", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-samiraFlairADRatio) > samiraFlairTol {
		t.Fatalf("AD ratio=%+v want 1.10", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "projectile" ||
			bannedOp.Operation == "multi_target" || bannedOp.Operation == "state_change" ||
			bannedOp.Operation == "repeat" || bannedOp.Operation == "control" ||
			bannedOp.Operation == "reveal" || bannedOp.Operation == "sight" ||
			bannedOp.Operation == "cast_delay" {
			t.Fatalf("flair must not include excluded op: %+v", bannedOp)
		}
	}
}

func findSamiraFlairAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := samiraFlairAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func samiraFlairWasmRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing wasm path %s: %v (fail closed)", path, err)
	}
	return path
}

// samiraFlairBackendPath reads committed Backend evidence by absolute cross-worktree path.
func samiraFlairBackendPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{filepath.FromSlash(samiraFlairBackendRoot)}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing backend path %s: %v (fail closed)", path, err)
	}
	return path
}

func samiraFlairLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(samiraFlairBackendPath(t,
		"db", "game_manage", "seeds", "lol_generic_samira_flair_max_distance_primary_hit_seed.sql"))
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

func samiraFlairSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func samiraFlairAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > samiraFlairTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > samiraFlairTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != samiraFlairDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), samiraFlairDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != samiraFlairAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), samiraFlairAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != samiraFlairProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), samiraFlairProviderRef)
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

// TestSamiraFlairSourceSeedProviderFormulaShape locks wiki/sidecar/pages/local-raw
// caveat, Backend seed/README/JUnit identities (absolute cross-worktree path),
// external-existing-data wording, and Q provider/total-AD formula shape.
func TestSamiraFlairSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Description2, Description3, Description4 string
			Cooldown, Cost, Costtype, Damagetype, Notes                       string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(samiraFlairWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "samira-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != samiraFlairNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), samiraFlairNormalizedBytes)
	}
	if got := samiraFlairSHA256Hex(sidecarRaw); got != samiraFlairNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, samiraFlairNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != samiraFlairCandidateKey || doc.RequestTitle != samiraFlairRequestTitle ||
		doc.ResolvedTitle != samiraFlairResolvedTitle || doc.WikiPageID != samiraFlairWikiPageID ||
		doc.RevisionID != samiraFlairRevisionID || doc.RevisionTimestamp != samiraFlairTimestamp ||
		doc.ContentSHA256 != samiraFlairContentSHA || doc.RawByteSize != samiraFlairRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "交火" || doc.OwnerID != "hero_samira" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "description3", "description4",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "30\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|6 to 2}}\n" {
		t.Fatalf("cooldown=%q want rank table ending in 2s", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|0 to 20}}") ||
		!strings.Contains(doc.Fields.Leveling, "110") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "fires a shot") {
		t.Fatal("wiki prose must retain ranged-shot selected-primary surface")
	}
	if !strings.Contains(doc.Fields.Description2, "slash") ||
		!strings.Contains(doc.Fields.Description3, "Wild Rush") ||
		!strings.Contains(doc.Fields.Description4, "critically strike") ||
		!strings.Contains(doc.Fields.Description4, "life steal") {
		t.Fatal("wiki prose must retain excluded melee/Wild Rush/crit/lifesteal surfaces")
	}

	pagesRaw, err := os.ReadFile(samiraFlairWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "samira-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != samiraFlairPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), samiraFlairPagesBytes)
	}
	if got := samiraFlairSHA256Hex(pagesRaw); got != samiraFlairPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, samiraFlairPagesSHA)
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "交火" || pages.OwnerID != "hero_samira" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(samiraFlairWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "samira-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != samiraFlairLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), samiraFlairLocalRawBytes)
	}
	localSHA := samiraFlairSHA256Hex(rawBytes)
	if localSHA != samiraFlairLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, samiraFlairLocalRawSHA)
	}
	if localSHA == samiraFlairContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if len(rawBytes) == samiraFlairRawBytes && localSHA != samiraFlairContentSHA {
		// Same size is not equivalence — materialization/serialization caveat only.
	}

	if samiraFlairPlanRev != "samira-q-flair-max-distance-primary-hit-phase-a-v1" ||
		samiraFlairBoundary !=
			"rank5_max_distance_ranged_shot_selected_primary_physical_hit; immediate_impact_scaffold; "+
				"physical_20_plus_1_10_total_ad; mana30_cooldown2000ms; exactly_one_immediate_damage_quantum; "+
				"no_distance_range_direction_projectile_collision_melee_slash_wild_rush_e_explosives_crit_"+
				"expected_crit_rng_150_percent_lifesteal_style_multitarget_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seed, sqlNoComments := samiraFlairLoadSeedSQL(t)
	_ = samiraFlairBackendPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericSamiraFlairMaxDistancePrimaryHitSeedSqlTest.java")
	readmeBytes, err := os.ReadFile(samiraFlairBackendPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		samiraFlairCandidateKey, samiraFlairTaskKey, samiraFlairPlanRev,
		samiraFlairRequestTitle, samiraFlairResolvedTitle,
		"1459315", "4008027", samiraFlairTimestamp, "3596", "666",
		samiraFlairContentSHA, samiraFlairNormalizedSHA, samiraFlairPagesSHA, samiraFlairLocalRawSHA,
		samiraFlairBoundary, samiraFlairProviderRef, samiraFlairAbilityID, samiraFlairAbilityKey,
		"flair_max_distance_primary_hit_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":30}`, `{"op":"const","value":2000}`,
		samiraFlairSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/samira-q.json",
		"external existing-data", "check-only",
		"不物化",
		"total AD", "source.attr.ad.resolved",
		"ability_started",
		"Maximum-distance", "no distance multiplier",
		"crit_eligible=false", "copyable_on_hit=false",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range samiraFlairOrderedTags() {
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
	for _, tag := range samiraFlairOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if !strings.Contains(ordSection, "不包含 total_ad_ratio") &&
		!strings.Contains(ordSection, "显式不包含 total_ad_ratio") &&
		!strings.Contains(ordSection, "禁止该 governed tag") {
		t.Fatal("ordered tags section must explicitly exclude governed tag total_ad_ratio")
	}
	if regexp.MustCompile(`(?is)\d+\.\s*total_ad_ratio`).MatchString(ordSection) {
		t.Fatal("ordered tags numbered list must not include governed tag total_ad_ratio")
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
		"INSERT INTO public.ability_costs",
		"INSERT INTO public.ability_cooldowns",
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.ability_phase_effect_sequences",
		"INSERT INTO public.entity_provider_mounts",
		"phase_hero_samira_q_flair_max_distance_primary_hit_impact",
		"sequence_hero_samira_q_flair_max_distance_primary_hit_impact",
		"step_hero_samira_q_flair_max_distance_primary_hit_damage",
		"cost_hero_samira_q_flair_max_distance_primary_hit_mana",
		"cooldown_hero_samira_q_flair_max_distance_primary_hit",
		"missing game_entities hero_samira",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_samira/ad",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_samira/mana",
	} {
		if !strings.Contains(sqlNoComments, needle) && !strings.Contains(seed, needle) {
			t.Fatalf("seed missing %q", needle)
		}
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.provider_definitions") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_definitions") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_phases") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.damage_effect_details") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.entity_provider_mounts") != 1 {
		t.Fatal("seed must define exactly one provider/ability/phase/detail/mount")
	}
	if !regexp.MustCompile(`(?s)'ability_hero_samira_q_flair_max_distance_primary_hit'\s*,\s*` +
		`'provider_hero_samira_q_flair_max_distance_primary_hit'\s*,\s*` +
		`'flair_max_distance_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key flair_max_distance_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_samira_q_flair_max_distance_primary_hit_damage'\s*,\s*` +
		`'flair_max_distance_primary_hit_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be physical 20220 add policy copyable_on_hit=false")
	}
	if !regexp.MustCompile(`(?s)'cost_hero_samira_q_flair_max_distance_primary_hit_mana'\s*,\s*` +
		`'ability_hero_samira_q_flair_max_distance_primary_hit'\s*,\s*` +
		`NULL\s*,\s*'mana'\s*,\s*'q_mana_cost'\s*,\s*false`).MatchString(seed) {
		t.Fatal("Q mana cost must be ability-level 30 via ability_costs")
	}
	if !regexp.MustCompile(`(?s)'cooldown_hero_samira_q_flair_max_distance_primary_hit'\s*,\s*` +
		`'ability_hero_samira_q_flair_max_distance_primary_hit'\s*,\s*` +
		`'q_cooldown_ms'\s*,\s*NULL`).MatchString(seed) {
		t.Fatal("Q cooldown must be 2000ms via ability_cooldowns")
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
	if regexp.MustCompile(`(?is)'provider_hero_samira_[pwer]_|'ability_hero_samira_[pwer]_|` +
		`'provider_hero_samira_basic_|'ability_hero_samira_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/W/E/R/basic graph rows")
	}
	if regexp.MustCompile(`(?is)\b62\d{3}\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL must not introduce game-local ability-specific 62xxx types")
	}
	if regexp.MustCompile(`(?is)\b20230\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL must not use provider_action/apply 20230")
	}

	for _, want := range []string{
		samiraFlairCandidateKey, samiraFlairTaskKey, samiraFlairPlanRev,
		"lol_generic_samira_flair_max_distance_primary_hit_seed.sql",
		"LolGenericSamiraFlairMaxDistancePrimaryHitSeedSqlTest",
		"external existing-data",
		"physical_20_plus_1_10_total_ad",
		"1459315", "4008027", samiraFlairContentSHA,
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Samira identity/panel/resource")
	}
	if strings.Contains(readme, "fixture_samira_flair_max_distance_primary_hit_total_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production Q behavior")
	}

	compileReq, _ := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
		baseAD: samiraFlairADBaseDefault, resolvedAD: samiraFlairADResolvedDefault,
		armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaCD,
	})
	assertSamiraFlairProviderShape(t, compileReq, 1, true)
	rawX := samiraFlairExpectedRawFromTotalAD(samiraFlairADResolvedDefault)
	if math.Abs(rawX-samiraFlairExpectedRawDefault) > samiraFlairTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, samiraFlairExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, samiraFlairTargetArmor)
	if math.Abs(mitX-samiraFlairExpectedMitDefault) > samiraFlairTol {
		t.Fatalf("default mit=%v want %v", mitX, samiraFlairExpectedMitDefault)
	}
	bonusOnly := samiraFlairExpectedRawFromTotalAD(samiraFlairADResolvedDefault - samiraFlairADBaseDefault)
	if math.Abs(bonusOnly-samiraFlairExpectedRawDefault) < samiraFlairTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	baseOnly := samiraFlairExpectedRawFromTotalAD(samiraFlairADBaseDefault)
	if math.Abs(baseOnly-samiraFlairExpectedRawDefault) < samiraFlairTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestSamiraFlairPrimaryHitFirstCast: AD100/mana300/armor100/HP1000 → one raw130
// physical quantum, post-mitigation65, HP935, mana270, automatic ability_started.
func TestSamiraFlairPrimaryHitFirstCast(t *testing.T) {
	compileReq, runReq := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
		baseAD: samiraFlairADBaseDefault, resolvedAD: samiraFlairADResolvedDefault,
		armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaCD, hp: samiraFlairTargetHP,
	})
	assertSamiraFlairProviderShape(t, compileReq, 1, true)
	ref := samiraFlairAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSamiraFlair(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	dmg := samiraFlairDamageEvidence(done)
	if len(dmg) != 1 {
		t.Fatalf("Q damage evidence=%d want 1", len(dmg))
	}
	samiraFlairAssertDamage(t, dmg[0], samiraFlairExpectedRawDefault, samiraFlairExpectedMitDefault)
	if math.Abs(done.Summary.TargetFinalHp-samiraFlairHPAfter1) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, samiraFlairHPAfter1)
	}
	if math.Abs(samiraFlairSourceMana(t, done.FinalSnapshot)-samiraFlairManaAfter1) > samiraFlairTol {
		t.Fatalf("mana=%v want %v", samiraFlairSourceMana(t, done.FinalSnapshot), samiraFlairManaAfter1)
	}
	if len(samiraFlairAbilityStartedEvidence(done)) != 1 {
		t.Fatalf("ability_started=%d want 1", len(samiraFlairAbilityStartedEvidence(done)))
	}
	if n := len(damageEvidenceItems(done)); n != 1 {
		t.Fatalf("total damage evidence=%d want 1", n)
	}
}

// TestSamiraFlairCooldownMana300AbilityStarted: mana300/HP1000/AD100/armor100 at
// t0/t1999/t2000 → success/skip/success; readyAt2000; final mana240/HP870; two Q
// damage items and two automatic Q ability_started events.
func TestSamiraFlairCooldownMana300AbilityStarted(t *testing.T) {
	compileReq, runReq := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
		baseAD: samiraFlairADBaseDefault, resolvedAD: samiraFlairADResolvedDefault,
		armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaCD, hp: samiraFlairTargetHP,
	})
	assertSamiraFlairProviderShape(t, compileReq, 1, true)
	ref := samiraFlairAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 2000},
	}
	runReq.StopPolicy.DurationMs = 2100
	done := runSamiraFlair(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if samiraFlairSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findSamiraFlairAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt1999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 1999 {
			t.Fatalf("cooldown skip TimeMs=%d want 1999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 2000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 2000", item.Data["readyAtMs"])
		}
		skipAt1999 = true
	}
	if !skipAt1999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=1999 with readyAtMs=2000")
	}

	items := samiraFlairDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 2000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		samiraFlairAssertDamage(t, item, samiraFlairExpectedRawDefault, samiraFlairExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * samiraFlairExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-samiraFlairHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, samiraFlairHPAfter2)
	}
	gotMana := samiraFlairSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-samiraFlairManaAfter2) > samiraFlairTol {
		t.Fatalf("mana=%v want %v", gotMana, samiraFlairManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := samiraFlairAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 2000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-samiraFlairADResolvedDefault) > samiraFlairTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), samiraFlairADResolvedDefault)
	}
	if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-samiraFlairADBaseDefault) > samiraFlairTol {
		t.Fatalf("ad.base=%v want %v", sourceAttrBase(t, done.FinalSnapshot, "ad"), samiraFlairADBaseDefault)
	}
}

// TestSamiraFlairResourceInsufficientMana29: mana29 at t0 → resource_insufficient;
// mana/HP unchanged; zero Q damage/event/cooldown start.
func TestSamiraFlairResourceInsufficientMana29(t *testing.T) {
	compileReq, runReq := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
		baseAD: samiraFlairADBaseDefault, resolvedAD: samiraFlairADResolvedDefault,
		armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaShort, hp: samiraFlairTargetHP,
	})
	ref := samiraFlairAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSamiraFlair(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if samiraFlairSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(samiraFlairSourceMana(t, done.FinalSnapshot)-samiraFlairFixtureManaShort) > samiraFlairTol {
		t.Fatalf("mana changed: got %v want %v",
			samiraFlairSourceMana(t, done.FinalSnapshot), samiraFlairFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-samiraFlairTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, samiraFlairTargetHP)
	}
	if len(samiraFlairDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(samiraFlairAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
	if samiraFlairSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 0 {
		t.Fatal("resource skip must not start cooldown")
	}
}

// TestSamiraFlairTotalADCounterproof: base0/resolved100 and base60/resolved100 at
// armor100 both raw/final 130/65 — formula reads total AD only.
func TestSamiraFlairTotalADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"base0_resolved100", 0, 100},
		{"base60_resolved100", 60, 100},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaCD,
			})
			assertSamiraFlairProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: samiraFlairAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSamiraFlair(t, compileReq, runReq)
			dmg := samiraFlairDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			samiraFlairAssertDamage(t, dmg[0], samiraFlairExpectedRawDefault, samiraFlairExpectedMitDefault)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > samiraFlairTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > samiraFlairTol {
				t.Fatalf("ad.base=%v want %v", sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
}

// TestSamiraFlairStandaloneNoSiblingSynthesis: standalone Q provider does not
// synthesize P/W/E/R/basic or overwrite unrelated definitions/mounts/snapshots.
func TestSamiraFlairStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
		baseAD: samiraFlairADBaseDefault, resolvedAD: samiraFlairADResolvedDefault,
		armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaCD,
	})
	assertSamiraFlairProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_samira_flair_unrelated_sentinel"
	sentinelStable := "fixture_samira_flair_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != samiraFlairProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != samiraFlairProviderRef {
			t.Fatalf("source snapshots=%+v want only Q", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_samira_[pwer]_|ability_hero_samira_[pwer]_|` +
		`provider_hero_samira_basic_|ability_hero_samira_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != samiraFlairProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := samiraFlairAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSamiraFlair(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(samiraFlairDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(samiraFlairDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(samiraFlairAbilityStartedEvidence(done)) != 1 {
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
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestSamiraFlairDeterminismAndLifecycle: repeated compile/run evidence stability plus
// CompileFrame→RunFrame→ReleaseSessionFrame and wrong/missing/released session behavior.
func TestSamiraFlairDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
				baseAD: samiraFlairADBaseDefault, resolvedAD: samiraFlairADResolvedDefault,
				armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaCD,
			})
			ref := samiraFlairAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 2000},
			}
			r.StopPolicy.DurationMs = 2100
			done := runSamiraFlair(t, c, r)
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
		c, r := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
			baseAD: samiraFlairADBaseDefault, resolvedAD: samiraFlairADResolvedDefault,
			armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: samiraFlairAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runSamiraFlairFrames(t, c, r)
		if len(samiraFlairDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(samiraFlairDamageEvidence(done)))
		}
		samiraFlairAssertDamage(t, samiraFlairDamageEvidence(done)[0], samiraFlairExpectedRawDefault, samiraFlairExpectedMitDefault)
		if len(samiraFlairAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadSamiraFlairFixture(t, samiraFlairFixtureOpts{
			baseAD: samiraFlairADBaseDefault, resolvedAD: samiraFlairADResolvedDefault,
			armor: samiraFlairTargetArmor, mana: samiraFlairFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: samiraFlairAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
