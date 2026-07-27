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

// hero_varus R Chain of Corruption / 腐败锁链 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: varus-r-chain-of-corruption-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank3_primary_champion_single_hit; immediate_impact_scaffold;
//	magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_varus|R|腐败锁链
//	task wasm-generic-varus-chain-of-corruption-primary-hit
//	Request Template:Data Varus/R → resolved Template:Data Varus/Chain of Corruption
//	wikiPageId 1309977 / rev 4008213 / timestamp 2026-04-14T05:44:24Z
//	sidecar rawByteSize 5223 / SHA256 62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed
//	数据参考/lol-wiki-current-champions/normalized/generic/varus-r.json
//	pages/raw siblings: pages/varus-r.json, raw/varus-r.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_varus_chain_of_corruption_primary_hit_seed.sql
//	Local raw is a non-canonical materialization: 5222 bytes / SHA256
//	aa50685e07a4a974baa7f4a3bf43689f930dd20ac144fa03b72886daf8242207.
//	Trimming terminal LF yields 5221 / a5b638836ce4976afc3e79852655826b82ecb357f2c54d36a0c885202129b585.
//	Sidecar/pages own canonical identity — assert local existence/size/SHA/required
//	substrings only; do not assert equivalence or treat local raw as a source
//	contradiction.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_varus_r_chain_of_corruption_primary_hit
//     (not Blighted Quiver / Hail of Arrows / basic reuse)
//   - ability ability_hero_varus_r_chain_of_corruption_primary_hit with ability_key
//     chain_of_corruption: active; mana 100; cooldown 60000 ms
//   - Exactly one immediate direct-target magic damage op (null-duration
//     impact / on_enter scaffold in production seed; Wasm models one op):
//     350 + 1.00*source.attr.ap.resolved
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / state / cast-delay / projectile / travel / collision /
//     geometry / direction / root / reveal / Blight stack/schedule / tendril /
//     seek / spread / multitarget / repeat / phantom / equipment / loadout /
//     on-hit / P/Q/W/E/basic behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Unspecified cast delay and Wiki Effect-at-cast-time-end, projectile /
//   travel / speed / collision / global geometry / direction / facing /
//   interception / spellshield / untargetable, root / reveal / tenacity /
//   cleanse / CC immunity, Blight creation and 0.65/1.2/1.75 schedule /
//   rank-0 / W coupling / detonation / state, tendril ground anchor /
//   0.25 seeking / range / area / secondary / repeat / spread / multitarget,
//   ranks 1–2 / P/Q/W/E / basic / loadout / full fidelity are excluded —
//   not modeled or denied as live-game absences. Do not invent these
//   surfaces in the Phase-A fixture.

const (
	varusChainOfCorruptionPrimaryHitCandidateKey  = "hero_skill|hero_varus|R|腐败锁链"
	varusChainOfCorruptionPrimaryHitTaskKey       = "wasm-generic-varus-chain-of-corruption-primary-hit"
	varusChainOfCorruptionPrimaryHitRequestTitle  = "Template:Data Varus/R"
	varusChainOfCorruptionPrimaryHitResolvedTitle = "Template:Data Varus/Chain of Corruption"
	varusChainOfCorruptionPrimaryHitWikiPageID    = 1309977
	varusChainOfCorruptionPrimaryHitRevisionID    = 4008213
	varusChainOfCorruptionPrimaryHitTimestamp     = "2026-04-14T05:44:24Z"
	varusChainOfCorruptionPrimaryHitRawBytes      = 5223
	varusChainOfCorruptionPrimaryHitLocalRawBytes = 5222
	varusChainOfCorruptionPrimaryHitTrimRawBytes  = 5221
	varusChainOfCorruptionPrimaryHitContentSHA    = "62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed"
	varusChainOfCorruptionPrimaryHitLocalRawSHA   = "aa50685e07a4a974baa7f4a3bf43689f930dd20ac144fa03b72886daf8242207"
	varusChainOfCorruptionPrimaryHitTrimRawSHA    = "a5b638836ce4976afc3e79852655826b82ecb357f2c54d36a0c885202129b585"
	varusChainOfCorruptionPrimaryHitPlanRev       = "varus-r-chain-of-corruption-primary-hit-phase-a-v1"
	varusChainOfCorruptionPrimaryHitBoundary      = "rank3_primary_champion_single_hit; immediate_impact_scaffold; " +
		"magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget"

	varusChainOfCorruptionPrimaryHitProviderRef = "provider_hero_varus_r_chain_of_corruption_primary_hit"
	varusChainOfCorruptionPrimaryHitStableID    = "hero_varus_r_chain_of_corruption_primary_hit"
	varusChainOfCorruptionPrimaryHitAbilityID   = "ability_hero_varus_r_chain_of_corruption_primary_hit"
	varusChainOfCorruptionPrimaryHitAbilityKey  = "chain_of_corruption"
	varusChainOfCorruptionPrimaryHitDamageOpRef = "op:varus_chain_of_corruption_primary_hit_damage"

	// Must not collide with / reuse Varus E / W / basic providers.
	varusBasicAttackProviderRefAlias = "provider_hero_varus_basic_attack"

	varusChainOfCorruptionPrimaryHitBaseDamage = 350.0
	varusChainOfCorruptionPrimaryHitAPRatio    = 1.00
	varusChainOfCorruptionPrimaryHitManaCost   = 100.0
	varusChainOfCorruptionPrimaryHitCDMs       = 60000.0

	// Fixture: AP200; mana300; target MR100; HP1000.
	varusChainOfCorruptionPrimaryHitFixtureAP   = 200.0
	varusChainOfCorruptionPrimaryHitFixtureMana = 300.0
	varusChainOfCorruptionPrimaryHitTargetMR    = 100.0
	varusChainOfCorruptionPrimaryHitTargetHP    = 1000.0

	// Independent cross-check: AP=200 → raw 550; MR 100 → mitigated 275.
	varusChainOfCorruptionPrimaryHitExpectedRaw       = 550.0
	varusChainOfCorruptionPrimaryHitExpectedMitigated = 275.0
	varusChainOfCorruptionPrimaryHitManaAfter2        = 100.0 // 300 - 100 - 100
	varusChainOfCorruptionPrimaryHitHPAfter2          = 450.0 // 1000 - 275 - 275

	varusChainOfCorruptionPrimaryHitTol = 1e-9

	// Backend seed binary add — Wasm fixture uses identical tree semantics.
	varusChainOfCorruptionPrimaryHitSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":350},` +
		`{"op":"mul","args":[{"op":"const","value":1.00},{"op":"read","path":"source.attr.ap.resolved"}]}]}`
)

func varusChainOfCorruptionPrimaryHitExpectedRawFromAP(resolvedAP float64) float64 {
	return varusChainOfCorruptionPrimaryHitBaseDamage +
		varusChainOfCorruptionPrimaryHitAPRatio*resolvedAP
}

func varusChainOfCorruptionPrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := varusChainOfCorruptionPrimaryHitBaseDamage
	ratio := varusChainOfCorruptionPrimaryHitAPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{Op: "read", Path: "source.attr.ap.resolved"},
				},
			},
		},
	}
}

func varusChainOfCorruptionPrimaryHitAbility() model.AbilityDefinition {
	cost := varusChainOfCorruptionPrimaryHitManaCost
	cd := varusChainOfCorruptionPrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: varusChainOfCorruptionPrimaryHitAbilityKey,
		Kind:       "active",
		// Not a basic attack; CritEligible left false on the damage op.
		Types: []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic", // runtime type 20221; not physical 20220
				Ref:           varusChainOfCorruptionPrimaryHitDamageOpRef,
				Amount:        varusChainOfCorruptionPrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func varusChainOfCorruptionPrimaryHitProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: varusChainOfCorruptionPrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    varusChainOfCorruptionPrimaryHitStableID,
		Abilities:   []model.AbilityDefinition{varusChainOfCorruptionPrimaryHitAbility()},
	}
}

func varusChainOfCorruptionPrimaryHitAbilityRef() string {
	return "source.provider[" + varusChainOfCorruptionPrimaryHitProviderRef +
		"].ability[" + varusChainOfCorruptionPrimaryHitAbilityKey + "]"
}

func configureVarusChainOfCorruptionPrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{varusChainOfCorruptionPrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: varusChainOfCorruptionPrimaryHitProviderRef, DefinitionRef: varusChainOfCorruptionPrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: varusChainOfCorruptionPrimaryHitProviderRef, DefinitionRef: varusChainOfCorruptionPrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureVarusChainOfCorruptionPrimaryHitTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
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

func loadVarusChainOfCorruptionPrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureVarusChainOfCorruptionPrimaryHitTypes(&compileReq)
	configureVarusChainOfCorruptionPrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: varusChainOfCorruptionPrimaryHitFixtureAP, Current: varusChainOfCorruptionPrimaryHitFixtureAP,
		Max: varusChainOfCorruptionPrimaryHitFixtureAP, Resolved: varusChainOfCorruptionPrimaryHitFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: varusChainOfCorruptionPrimaryHitFixtureMana, Max: varusChainOfCorruptionPrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: varusChainOfCorruptionPrimaryHitTargetHP, Current: varusChainOfCorruptionPrimaryHitTargetHP,
		Max: varusChainOfCorruptionPrimaryHitTargetHP, Resolved: varusChainOfCorruptionPrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: varusChainOfCorruptionPrimaryHitTargetMR, Current: varusChainOfCorruptionPrimaryHitTargetMR,
		Max: varusChainOfCorruptionPrimaryHitTargetMR, Resolved: varusChainOfCorruptionPrimaryHitTargetMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runVarusChainOfCorruptionPrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func varusChainOfCorruptionPrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func varusChainOfCorruptionPrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func varusChainOfCorruptionPrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != varusChainOfCorruptionPrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func varusChainOfCorruptionPrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == varusChainOfCorruptionPrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertVarusChainOfCorruptionPrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := varusChainOfCorruptionPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_varus_r_chain_of_corruption_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != varusChainOfCorruptionPrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, varusChainOfCorruptionPrimaryHitProviderRef)
	}
	if p.StableID != varusChainOfCorruptionPrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, varusChainOfCorruptionPrimaryHitStableID)
	}
	if p.ProviderKey == varusBQProviderRef || p.StableID == varusBQStableID ||
		p.ProviderKey == varusBQStableID || p.StableID == varusBQProviderRef ||
		p.ProviderKey == varusHailOfArrowsPrimaryHitProviderRef ||
		p.StableID == varusHailOfArrowsPrimaryHitStableID ||
		p.ProviderKey == varusBasicAttackProviderRefAlias {
		t.Fatal("chain_of_corruption primary-hit must not reuse Varus E / W / basic provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / Blighted Quiver / on-hit coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no root/reveal/Blight/tendril state)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (no equipment/loadout/W/E/basic modifiers)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil (no projectile/tendril/AOE lifecycle)", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), varusChainOfCorruptionPrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != varusChainOfCorruptionPrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, varusChainOfCorruptionPrimaryHitAbilityKey, varusChainOfCorruptionPrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("chain_of_corruption must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("chain_of_corruption must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("chain_of_corruption must not carry tickSpec (no Blight/tendril ticks)")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("chain_of_corruption must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-varusChainOfCorruptionPrimaryHitManaCost) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-varusChainOfCorruptionPrimaryHitCDMs) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 60000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no cast/projectile/root/blight/tendril)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target (runtime 20221)", op)
	}
	if op.DamageType == "damage/physical" {
		t.Fatal("chain_of_corruption must not use physical damage (20220)")
	}
	if op.CritEligible {
		t.Fatal("chain_of_corruption damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("chain_of_corruption damage must not be copyable on hit")
	}
	if op.Ref != varusChainOfCorruptionPrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, varusChainOfCorruptionPrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-varusChainOfCorruptionPrimaryHitBaseDamage) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("base const=%+v want 350", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-varusChainOfCorruptionPrimaryHitAPRatio) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("AP ratio=%+v want 1.00", mul.Args[0])
	}
	if mul.Args[1].Op != "read" || mul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved (must not bake fixture AP)", mul.Args[1])
	}
	if mul.Args[1].Op == "const" {
		t.Fatal("AP branch must not bake fixture AP constants into the formula")
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "stun" ||
			banned.Operation == "root" || banned.Operation == "reveal" ||
			banned.Operation == "projectile" || banned.Operation == "multi_target" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" ||
			banned.Operation == "field" || banned.Operation == "cast_delay" ||
			banned.DamageType == "damage/physical" {
			t.Fatalf("chain_of_corruption must not include cast/projectile/root/reveal/blight/tendril/physical op: %+v", banned)
		}
	}
}

func findVarusChainOfCorruptionPrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := varusChainOfCorruptionPrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func varusChainOfCorruptionPrimaryHitWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "varus-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func varusChainOfCorruptionPrimaryHitWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "varus-r.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func varusChainOfCorruptionPrimaryHitWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "varus-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func varusChainOfCorruptionPrimaryHitSeedPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"db", "game_manage", "seeds", "lol_generic_varus_chain_of_corruption_primary_hit_seed.sql")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("backend seed missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type varusChainOfCorruptionPrimaryHitWikiSidecar struct {
	CandidateKey      string `json:"candidateKey"`
	RequestTitle      string `json:"requestTitle"`
	ResolvedTitle     string `json:"resolvedTitle"`
	WikiPageID        int    `json:"wikiPageId"`
	RevisionID        int    `json:"revisionId"`
	RevisionTimestamp string `json:"revisionTimestamp"`
	ContentSHA256     string `json:"contentSha256"`
	RawByteSize       int    `json:"rawByteSize"`
	SkillKey          string `json:"skillKey"`
	ZhDisplayName     string `json:"zhDisplayName"`
	OwnerID           string `json:"ownerId"`
	Fields            struct {
		Description  string `json:"description"`
		Leveling     string `json:"leveling"`
		Description2 string `json:"description2"`
		Description3 string `json:"description3"`
		Cooldown     string `json:"cooldown"`
		Cost         string `json:"cost"`
		Costtype     string `json:"costtype"`
		Damagetype   string `json:"damagetype"`
		Notes        string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

type varusChainOfCorruptionPrimaryHitWikiPages struct {
	CandidateKey      string `json:"candidateKey"`
	RequestTitle      string `json:"requestTitle"`
	ResolvedTitle     string `json:"resolvedTitle"`
	PageID            int    `json:"pageId"`
	RevisionID        int    `json:"revisionId"`
	RevisionTimestamp string `json:"revisionTimestamp"`
	ContentSHA256     string `json:"contentSha256"`
	RawByteSize       int    `json:"rawByteSize"`
	SkillKey          string `json:"skillKey"`
	ZhDisplayName     string `json:"zhDisplayName"`
	OwnerID           string `json:"ownerId"`
}

func varusChainOfCorruptionPrimaryHitLoadWikiSidecar(t *testing.T) varusChainOfCorruptionPrimaryHitWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(varusChainOfCorruptionPrimaryHitWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc varusChainOfCorruptionPrimaryHitWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

func varusChainOfCorruptionPrimaryHitLoadWikiPages(t *testing.T) varusChainOfCorruptionPrimaryHitWikiPages {
	t.Helper()
	raw, err := os.ReadFile(varusChainOfCorruptionPrimaryHitWikiPagesPath(t))
	if err != nil {
		t.Fatalf("read wiki pages: %v", err)
	}
	var doc varusChainOfCorruptionPrimaryHitWikiPages
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki pages: %v", err)
	}
	return doc
}

func varusChainOfCorruptionPrimaryHitLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(varusChainOfCorruptionPrimaryHitSeedPath(t))
	if err != nil {
		t.Fatalf("read backend seed: %v", err)
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

func varusChainOfCorruptionPrimaryHitSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func varusChainOfCorruptionPrimaryHitCountOccurrences(haystack, needle string) int {
	if needle == "" {
		return 0
	}
	return strings.Count(haystack, needle)
}

// TestVarusChainOfCorruptionPrimaryHitWikiSidecarIdentityAndBoundary locks repository
// sidecar/pages/raw/seed identity plus the frozen Phase-A completed-boundary /
// plan-rev constants. Positively asserts rank-3 champion magic/formula/cost/CD,
// cast-time/Effect wording, root/reveal, Blight schedule, and tendril seeking/
// spread as source evidence; compile/runtime prove those branches are absent
// from the immediate scaffold (not modeled). Local raw is asserted for known
// materialization identity only — not as canonical equivalence.
func TestVarusChainOfCorruptionPrimaryHitWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := varusChainOfCorruptionPrimaryHitLoadWikiSidecar(t)
	if doc.CandidateKey != varusChainOfCorruptionPrimaryHitCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, varusChainOfCorruptionPrimaryHitCandidateKey)
	}
	if doc.RequestTitle != varusChainOfCorruptionPrimaryHitRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, varusChainOfCorruptionPrimaryHitRequestTitle)
	}
	if doc.ResolvedTitle != varusChainOfCorruptionPrimaryHitResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, varusChainOfCorruptionPrimaryHitResolvedTitle)
	}
	if doc.WikiPageID != varusChainOfCorruptionPrimaryHitWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, varusChainOfCorruptionPrimaryHitWikiPageID)
	}
	if doc.RevisionID != varusChainOfCorruptionPrimaryHitRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, varusChainOfCorruptionPrimaryHitRevisionID)
	}
	if doc.RevisionTimestamp != varusChainOfCorruptionPrimaryHitTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, varusChainOfCorruptionPrimaryHitTimestamp)
	}
	if doc.ContentSHA256 != varusChainOfCorruptionPrimaryHitContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, varusChainOfCorruptionPrimaryHitContentSHA)
	}
	if doc.RawByteSize != varusChainOfCorruptionPrimaryHitRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, varusChainOfCorruptionPrimaryHitRawBytes)
	}
	if doc.SkillKey != "R" || doc.ZhDisplayName != "腐败锁链" || doc.OwnerID != "hero_varus" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want R/腐败锁链/hero_varus",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "description3",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "100\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "100\n")
	}
	if doc.Fields.Cooldown != "{{ap|100 to 60}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|100 to 60}}\n")
	}
	if doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("fields.damagetype=%q want Magic", doc.Fields.Damagetype)
	}
	if doc.Fields.Costtype != "mana\n" {
		t.Fatalf("fields.costtype=%q want mana", doc.Fields.Costtype)
	}
	if doc.Fields.Description == "" {
		t.Fatal("description empty (fail closed; expect magic / root / reveal / Blight wording)")
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") {
		t.Fatalf("description missing magic damage wording: %q", doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "{{tip|root|rooting}}") {
		t.Fatalf("description missing root wording (source evidence; excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "{{tip|standard sight|revealed}}") {
		t.Fatalf("description missing reveal wording (source evidence; excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "{{ai|Blighted Quiver|Varus|Blight}}") {
		t.Fatalf("description missing Blight wording (source evidence; excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "target direction") {
		t.Fatalf("description missing target-direction wording (excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if doc.Fields.Leveling == "" {
		t.Fatal("leveling empty (fail closed; expect Magic Damage rank formula)")
	}
	if !strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling missing Magic Damage label: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|150 to 350}}") {
		t.Fatalf("leveling missing rank formula {{ap|150 to 350}}: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "100% AP") {
		t.Fatalf("leveling missing 100%% AP ratio: %q", doc.Fields.Leveling)
	}
	if doc.Fields.Description2 == "" {
		t.Fatal("description2 empty (fail closed; expect tendril seek/spread)")
	}
	if !strings.Contains(doc.Fields.Description2, "tendril roots into the ground") {
		t.Fatalf("description2 missing tendril ground-anchor wording (excluded from scaffold): %q",
			doc.Fields.Description2)
	}
	if !strings.Contains(doc.Fields.Description2, "seeking out nearby enemy") {
		t.Fatalf("description2 missing tendril seeking wording (excluded from scaffold): %q",
			doc.Fields.Description2)
	}
	if !strings.Contains(doc.Fields.Description2, "spread repeatedly") {
		t.Fatalf("description2 missing spread/multitarget wording (excluded from scaffold): %q",
			doc.Fields.Description2)
	}
	if doc.Fields.Notes == "" {
		t.Fatal("notes empty (fail closed; expect Effect at cast time end / Blight schedule / tendril seek)")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing Effect at cast time end (excluded from immediate scaffold): %q",
			doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "{{fd|0.65}}") {
		t.Fatalf("notes missing Blight 0.65 schedule (excluded from scaffold): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "{{fd|1.2}}") {
		t.Fatalf("notes missing Blight 1.2 schedule (excluded from scaffold): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "{{fd|1.75}}") {
		t.Fatalf("notes missing Blight 1.75 schedule (excluded from scaffold): %q", doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "{{rutngt|0.25}}") {
		t.Fatalf("notes missing tendril 0.25 seeking interval (excluded from scaffold): %q",
			doc.Fields.Notes)
	}

	pages := varusChainOfCorruptionPrimaryHitLoadWikiPages(t)
	if pages.CandidateKey != varusChainOfCorruptionPrimaryHitCandidateKey ||
		pages.RequestTitle != varusChainOfCorruptionPrimaryHitRequestTitle ||
		pages.ResolvedTitle != varusChainOfCorruptionPrimaryHitResolvedTitle ||
		pages.PageID != varusChainOfCorruptionPrimaryHitWikiPageID ||
		pages.RevisionID != varusChainOfCorruptionPrimaryHitRevisionID ||
		pages.RevisionTimestamp != varusChainOfCorruptionPrimaryHitTimestamp ||
		pages.ContentSHA256 != varusChainOfCorruptionPrimaryHitContentSHA ||
		pages.RawByteSize != varusChainOfCorruptionPrimaryHitRawBytes ||
		pages.SkillKey != "R" || pages.ZhDisplayName != "腐败锁链" || pages.OwnerID != "hero_varus" {
		t.Fatalf("pages identity must agree with sidecar canonical fields; got %+v", pages)
	}

	raw, err := os.ReadFile(varusChainOfCorruptionPrimaryHitWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) != varusChainOfCorruptionPrimaryHitLocalRawBytes {
		t.Fatalf("local raw len=%d want %d (known non-canonical materialization)",
			len(raw), varusChainOfCorruptionPrimaryHitLocalRawBytes)
	}
	localSHA := varusChainOfCorruptionPrimaryHitSHA256Hex(raw)
	if localSHA != varusChainOfCorruptionPrimaryHitLocalRawSHA {
		t.Fatalf("local raw sha=%q want known materialization %q",
			localSHA, varusChainOfCorruptionPrimaryHitLocalRawSHA)
	}
	if localSHA == varusChainOfCorruptionPrimaryHitContentSHA {
		t.Fatal("local raw hash must not equal canonical contentSha256 (non-canonical materialization)")
	}
	if raw[len(raw)-1] != '\n' {
		t.Fatal("local raw must end with terminal LF for known trim materialization")
	}
	trimmed := raw[:len(raw)-1]
	if len(trimmed) != varusChainOfCorruptionPrimaryHitTrimRawBytes {
		t.Fatalf("trimmed local raw len=%d want known %d",
			len(trimmed), varusChainOfCorruptionPrimaryHitTrimRawBytes)
	}
	trimSHA := varusChainOfCorruptionPrimaryHitSHA256Hex(trimmed)
	if trimSHA != varusChainOfCorruptionPrimaryHitTrimRawSHA {
		t.Fatalf("trimmed local raw sha=%q want known materialization %q",
			trimSHA, varusChainOfCorruptionPrimaryHitTrimRawSHA)
	}
	if trimSHA == varusChainOfCorruptionPrimaryHitContentSHA {
		t.Fatal("trimming terminal LF must not be treated as reproducing canonical (sidecar/pages own identity)")
	}
	rawText := string(raw)
	for _, want := range []string{
		"|cast time    = {{fd|0.2419}}",
		"{{Effect at cast time end}}",
		"{{ap|150 to 350}}",
		"100% AP",
		"|cost         = 100",
		"{{ap|100 to 60}}",
		"{{as|magic damage}}",
		"{{tip|root|rooting}}",
		"{{tip|standard sight|revealed}}",
		"{{ai|Blighted Quiver|Varus|Blight}}",
		"{{fd|0.65}}",
		"{{fd|1.2}}",
		"{{fd|1.75}}",
		"{{rutngt|0.25}}",
		"tendril roots into the ground",
		"spread repeatedly",
		"|projectile   = True",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing required substring %q", want)
		}
	}

	seed, _ := varusChainOfCorruptionPrimaryHitLoadSeedSQL(t)
	for _, want := range []string{
		varusChainOfCorruptionPrimaryHitCandidateKey,
		varusChainOfCorruptionPrimaryHitTaskKey,
		varusChainOfCorruptionPrimaryHitPlanRev,
		varusChainOfCorruptionPrimaryHitRequestTitle,
		varusChainOfCorruptionPrimaryHitResolvedTitle,
		"1309977",
		"4008213",
		varusChainOfCorruptionPrimaryHitTimestamp,
		varusChainOfCorruptionPrimaryHitContentSHA,
		varusChainOfCorruptionPrimaryHitLocalRawSHA,
		varusChainOfCorruptionPrimaryHitTrimRawSHA,
		varusChainOfCorruptionPrimaryHitBoundary,
		"normalized/generic/varus-r.json",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing identity/boundary evidence %q", want)
		}
	}

	if varusChainOfCorruptionPrimaryHitPlanRev != "varus-r-chain-of-corruption-primary-hit-phase-a-v1" {
		t.Fatal("frozen plan-rev constant drifted")
	}
	if varusChainOfCorruptionPrimaryHitBoundary != "rank3_primary_champion_single_hit; immediate_impact_scaffold; "+
		"magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget" {
		t.Fatal("frozen boundary constant drifted")
	}
}

// TestVarusChainOfCorruptionPrimaryHitSeedGraphShape locks Backend seed check-only
// prerequisites (game/reserved/hero_varus/AP), self-contained mana ensure 320/320,
// forbidden identity/panel writes, exact independent R graph shape, non-mutation of
// Varus E/W/basic, and 350 + 1.00*AP formula semantics.
func TestVarusChainOfCorruptionPrimaryHitSeedGraphShape(t *testing.T) {
	sql, sqlNoComments := varusChainOfCorruptionPrimaryHitLoadSeedSQL(t)

	for _, want := range []string{
		"missing reserved_type",
		"missing game_entities hero_varus",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_varus/ap",
		"check-only",
		"Batch-B prerequisite",
		"ensure mana",
		"INSERT INTO public.types",
		"INSERT INTO public.resource_definitions",
		"INSERT INTO public.entity_resource_values",
		"provider_hero_varus_r_chain_of_corruption_primary_hit",
		"ability_hero_varus_r_chain_of_corruption_primary_hit",
		"chain_of_corruption",
		"r_mana_cost",
		"r_cooldown_ms",
		"chain_of_corruption_damage",
		"phase_hero_varus_r_chain_of_corruption_primary_hit_impact",
		"sequence_hero_varus_r_chain_of_corruption_primary_hit_impact",
		"step_hero_varus_r_chain_of_corruption_primary_hit_damage",
		"cost_hero_varus_r_chain_of_corruption_primary_hit_mana",
		"cooldown_hero_varus_r_chain_of_corruption_primary_hit",
		`{"op":"const","value":100}`,
		`{"op":"const","value":60000}`,
		varusChainOfCorruptionPrimaryHitSeedDamageJSON,
		"320",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("seed missing required graph/check-only fragment %q", want)
		}
	}

	for _, typeID := range []string{"20111", "20120", "20130", "20142", "20150", "20170", "20221", "20260"} {
		if !strings.Contains(sql, typeID) {
			t.Fatalf("seed missing required reserved type %s", typeID)
		}
	}
	if regexp.MustCompile(`(?i)\b20220\b`).MatchString(sqlNoComments) {
		t.Fatal("executable seed must not use physical damage type 20220")
	}

	// Identity/panel rows are check-only; mana resource is self-contained ensure.
	forbiddenWriteTables := []string{
		"attribute_definitions",
		"game_entities",
		"entity_attribute_values",
		"games",
	}
	for _, table := range forbiddenWriteTables {
		pat := regexp.MustCompile(`(?is)(?:INSERT\s+INTO|UPDATE|MERGE\s+INTO|DELETE\s+FROM)\s+public\.` + table + `\b`)
		if pat.MatchString(sqlNoComments) {
			t.Fatalf("seed must not INSERT/UPDATE/MERGE/DELETE public.%s", table)
		}
	}
	if !regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.resource_definitions\b`).MatchString(sqlNoComments) {
		t.Fatal("seed must ensure resource_definitions mana (self-contained 320/320 projection)")
	}
	if !regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.entity_resource_values\b`).MatchString(sqlNoComments) {
		t.Fatal("seed must ensure entity_resource_values hero_varus/mana 320/320")
	}
	if !regexp.MustCompile(`(?s)'hero_varus'\s*,\s*'mana'\s*,\s*320\s*,\s*320`).MatchString(sqlNoComments) {
		t.Fatal("seed must ensure hero_varus mana resource values 320/320")
	}

	if varusChainOfCorruptionPrimaryHitCountOccurrences(sqlNoComments, "INSERT INTO public.provider_definitions") != 1 {
		t.Fatal("seed must define exactly one provider (R Chain of Corruption primary-hit only)")
	}
	if varusChainOfCorruptionPrimaryHitCountOccurrences(sqlNoComments, "INSERT INTO public.entity_provider_mounts") != 1 {
		t.Fatal("seed must mount exactly one dedicated Chain of Corruption primary-hit provider")
	}
	if varusChainOfCorruptionPrimaryHitCountOccurrences(sqlNoComments, "INSERT INTO public.ability_phases") != 1 {
		t.Fatal("seed must define exactly one ability phase (null-duration impact)")
	}
	if varusChainOfCorruptionPrimaryHitCountOccurrences(sqlNoComments, "INSERT INTO public.damage_effect_details") != 1 {
		t.Fatal("seed must have exactly one damage_effect_details insert block")
	}

	if !regexp.MustCompile(`(?s)'ability_hero_varus_r_chain_of_corruption_primary_hit'\s*,\s*` +
		`'provider_hero_varus_r_chain_of_corruption_primary_hit'\s*,\s*` +
		`'chain_of_corruption'\s*,\s*20130`).MatchString(sql) {
		t.Fatal("R must be active ability with stable key chain_of_corruption")
	}
	if !regexp.MustCompile(`(?s)'phase_hero_varus_r_chain_of_corruption_primary_hit_impact'\s*,\s*` +
		`'ability_hero_varus_r_chain_of_corruption_primary_hit'\s*,\s*` +
		`0\s*,\s*20142\s*,\s*NULL\s*,\s*false`).MatchString(sql) {
		t.Fatal("impact phase must be order 0 / type 20142 / null duration")
	}
	if !regexp.MustCompile(`(?s)'phase_hero_varus_r_chain_of_corruption_primary_hit_impact'\s*,\s*` +
		`20260\s*,\s*` +
		`'sequence_hero_varus_r_chain_of_corruption_primary_hit_impact'`).MatchString(sql) {
		t.Fatal("impact phase must bind on_enter 20260 sequence")
	}
	if !regexp.MustCompile(`(?s)'step_hero_varus_r_chain_of_corruption_primary_hit_damage'\s*,\s*` +
		`'sequence_hero_varus_r_chain_of_corruption_primary_hit_impact'\s*,\s*` +
		`0\s*,\s*20150\s*,\s*20111\s*,\s*NULL`).MatchString(sql) {
		t.Fatal("Chain of Corruption damage must be sole step order 0 to opponent")
	}
	if !regexp.MustCompile(`(?s)'step_hero_varus_r_chain_of_corruption_primary_hit_damage'\s*,\s*` +
		`'chain_of_corruption_damage'\s*,\s*20221\s*,\s*20170\s*,\s*false`).MatchString(sql) {
		t.Fatal("Chain of Corruption damage must be magic 20221 add policy copyable_on_hit=false")
	}
	if !regexp.MustCompile(`(?s)'hero_varus'\s*,\s*` +
		`'provider_hero_varus_r_chain_of_corruption_primary_hit'`).MatchString(sql) {
		t.Fatal("must mount Chain of Corruption primary-hit provider to hero_varus")
	}

	if !strings.Contains(sql, "provider_hero_varus_e_hail_of_arrows_primary_hit") {
		t.Fatal("seed must document coexistence / non-mutation of Varus E Hail of Arrows provider")
	}
	if !strings.Contains(sql, "provider_hero_varus_w_blighted_quiver_phase_a") {
		t.Fatal("seed must document coexistence / non-mutation of Varus W Blighted Quiver provider")
	}
	if !strings.Contains(sql, "provider_hero_varus_basic_attack") {
		t.Fatal("seed must document coexistence / non-mutation of Varus basic-attack provider")
	}
	if regexp.MustCompile(`(?is)'provider_hero_varus_e_hail_of_arrows_primary_hit'|` +
		`'provider_hero_varus_w_blighted_quiver_phase_a'|` +
		`'provider_hero_varus_basic_attack'`).MatchString(sqlNoComments) {
		t.Fatal("must not write / replace Varus E / W / basic provider identity rows")
	}
	if regexp.MustCompile(`(?is)'ability_hero_varus_e_|'phase_hero_varus_e_|'step_hero_varus_e_|` +
		`'ability_hero_varus_w_|'phase_hero_varus_w_|'step_hero_varus_w_|` +
		`'ability_hero_varus_basic_|'phase_hero_varus_basic_|'step_hero_varus_basic_`).MatchString(sqlNoComments) {
		t.Fatal("must not create/mutate Varus E / W / basic graph rows")
	}

	forbiddenSurfaces := []string{
		"provider_listeners",
		"provider_state_fields",
		"state_effect_details",
		"event_effect_details",
		"modifier_effect_details",
		"modifier_definitions",
		"provider_modifiers",
		"repeat_effect_details",
		"control_effect_details",
		"projectile_effect_details",
		"aoe_effect_details",
	}
	for _, table := range forbiddenSurfaces {
		pat := regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.` + table + `\b`)
		if pat.MatchString(sqlNoComments) {
			t.Fatalf("must not write public.%s", table)
		}
	}
	if regexp.MustCompile(`(?i)cast.?duration|cast.?delay|cast.?time|` +
		`phase_hero_varus_r_chain_of_corruption_primary_hit_cast|` +
		`projectile|missile|travel|collision|geometry|direction|` +
		`multi.?target|spell.?shield|untargetable|` +
		`\broot\b|\breveal\b|tenacity|cleanse|cc.?immun|` +
		`blight|tendril|seek|spread|` +
		`basic_attack_hit|emit_event|equipment|loadout|runes|` +
		`aoe|area.?of.?effect|\brepeat\b`).MatchString(sqlNoComments) {
		t.Fatal("must not model excluded cast-delay/projectile/root/reveal/blight/tendril/spread surfaces")
	}

	if !strings.Contains(sql, `"op":"add","args":[{"op":"const","value":350},{"op":"mul"`) {
		t.Fatal("seed formula must use Backend add starting with const 350 + mul")
	}
	if !strings.Contains(sql, `"path":"source.attr.ap.resolved"`) {
		t.Fatal("seed formula must read source.attr.ap.resolved")
	}
	if !strings.Contains(sql, `"value":1.00`) {
		t.Fatal("seed formula must encode 1.00 AP ratio")
	}
	if strings.Contains(sqlNoComments, `"path":"source.attr.ad.resolved"`) ||
		strings.Contains(sqlNoComments, `"path":"source.attr.ad.base"`) {
		t.Fatal("seed formula must not read AD paths (AP-only primary-hit)")
	}

	for _, want := range []string{
		"cast delay", "Effect at cast time end", "projectile", "root", "reveal",
		"Blight", "0.65", "tendril", "0.25", "spread", "multitarget",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("seed comments must document exclusion evidence containing %q", want)
		}
	}
}

// TestVarusChainOfCorruptionPrimaryHitRank3DamageFormulaCrossCheck: independent numeric
// cross-check 350 + 1.00*200 = 550; MR 100 → mitigated 275.
func TestVarusChainOfCorruptionPrimaryHitRank3DamageFormulaCrossCheck(t *testing.T) {
	raw := varusChainOfCorruptionPrimaryHitExpectedRawFromAP(varusChainOfCorruptionPrimaryHitFixtureAP)
	if math.Abs(raw-varusChainOfCorruptionPrimaryHitExpectedRaw) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, varusChainOfCorruptionPrimaryHitExpectedRaw)
	}
	zeroAP := varusChainOfCorruptionPrimaryHitExpectedRawFromAP(0)
	if math.Abs(zeroAP-varusChainOfCorruptionPrimaryHitExpectedRaw) < varusChainOfCorruptionPrimaryHitTol {
		t.Fatal("zero-AP raw must differ from AP200 raw (formula must read ap.resolved)")
	}
	if math.Abs(zeroAP-varusChainOfCorruptionPrimaryHitBaseDamage) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("zero-AP raw=%v want base 350", zeroAP)
	}
	mit := expectedMitigatedMagic(raw, varusChainOfCorruptionPrimaryHitTargetMR)
	if math.Abs(mit-varusChainOfCorruptionPrimaryHitExpectedMitigated) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, varusChainOfCorruptionPrimaryHitExpectedMitigated)
	}
}

// TestVarusChainOfCorruptionPrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent R provider: one magic damage op, cost/CD, AP200 fixture with no listener/state/
// E/W/basic/projectile/root/reveal/Blight/tendril graph.
func TestVarusChainOfCorruptionPrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadVarusChainOfCorruptionPrimaryHitFixture(t)
	assertVarusChainOfCorruptionPrimaryHitProviderShape(t, compileReq)
	if varusChainOfCorruptionPrimaryHitProviderRef == varusBQProviderRef ||
		varusChainOfCorruptionPrimaryHitProviderRef == varusHailOfArrowsPrimaryHitProviderRef ||
		varusChainOfCorruptionPrimaryHitProviderRef == varusBasicAttackProviderRefAlias ||
		varusChainOfCorruptionPrimaryHitStableID == varusBQStableID ||
		varusChainOfCorruptionPrimaryHitStableID == varusHailOfArrowsPrimaryHitStableID {
		t.Fatal("chain_of_corruption primary-hit must not reuse Varus E / W / basic provider refs")
	}
	if varusChainOfCorruptionPrimaryHitAbilityKey == varusHailOfArrowsPrimaryHitAbilityKey ||
		varusChainOfCorruptionPrimaryHitAbilityKey == varusBQActiveAbilityKey ||
		varusChainOfCorruptionPrimaryHitAbilityKey == "basic_attack" ||
		varusChainOfCorruptionPrimaryHitAbilityKey == "blighted_quiver" ||
		varusChainOfCorruptionPrimaryHitAbilityKey == "hail_of_arrows" {
		t.Fatal("chain_of_corruption must not reuse E / W / basic-attack ability keys")
	}
	if varusChainOfCorruptionPrimaryHitDamageOpRef == varusHailOfArrowsPrimaryHitDamageOpRef ||
		strings.Contains(varusChainOfCorruptionPrimaryHitDamageOpRef, "blighted_quiver") ||
		strings.Contains(varusChainOfCorruptionPrimaryHitDamageOpRef, "hail_of_arrows") ||
		strings.Contains(varusChainOfCorruptionPrimaryHitDamageOpRef, "basic_attack") {
		t.Fatal("chain_of_corruption primary-hit must not reuse E / W / basic operation refs")
	}
	if varusChainOfCorruptionPrimaryHitAbilityID != "ability_hero_varus_r_chain_of_corruption_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if varusChainOfCorruptionPrimaryHitStableID != "hero_varus_r_chain_of_corruption_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
	if varusChainOfCorruptionPrimaryHitProviderRef != "provider_hero_varus_r_chain_of_corruption_primary_hit" {
		t.Fatal("provider ref constant drifted")
	}
	if varusChainOfCorruptionPrimaryHitPlanRev != "varus-r-chain-of-corruption-primary-hit-phase-a-v1" {
		t.Fatal("plan-rev fixture metadata drifted")
	}

	blob, err := json.Marshal(compileReq.SharedProviders)
	if err != nil {
		t.Fatalf("marshal SharedProviders: %v", err)
	}
	compiled := string(blob)
	for _, banned := range []string{
		"blighted_quiver", "hail_of_arrows", "basic_attack",
		"projectile", "multi_target", "cast_delay",
		"tendril", "blight_stack",
	} {
		if strings.Contains(compiled, banned) {
			t.Fatalf("compiled fixture must not contain excluded branch %q", banned)
		}
	}
}

// TestVarusChainOfCorruptionPrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-3 primary-champion immediate magic damage scaffold: cost 100,
// CD 60000ms exact boundary, AP200 / mana300 / target MR100 / HP1000, one magic hit
// per successful cast (no AA/crit/phantom/cast-delay/projectile/root/reveal/Blight/
// tendril/spread/E/W/P/Q/basic). Runtime damage type is magic (20221), not physical (20220).
//
// Explicit exclusions (not modeled or denied as live-game absences): unspecified cast
// delay / Effect-at-cast-time-end / projectile / travel / collision / geometry /
// direction / root / reveal / Blight 0.65/1.2/1.75 schedule / tendril 0.25 seeking /
// spread / multitarget / ranks 1–2 / P/Q/W/E / basic / loadout / full fidelity.
func TestVarusChainOfCorruptionPrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadVarusChainOfCorruptionPrimaryHitFixture(t)
	assertVarusChainOfCorruptionPrimaryHitProviderShape(t, compileReq)

	ref := varusChainOfCorruptionPrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 59999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 60000},
	}
	runReq.StopPolicy.DurationMs = 60100

	done := runVarusChainOfCorruptionPrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if varusChainOfCorruptionPrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findVarusChainOfCorruptionPrimaryHitAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt59999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 59999 {
			t.Fatalf("cooldown skip TimeMs=%d want 59999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 60000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 60000", item.Data["readyAtMs"])
		}
		skipAt59999 = true
	}
	if !skipAt59999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=59999 with readyAtMs=60000")
	}

	items := varusChainOfCorruptionPrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("chain_of_corruption damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 60000}
	wantMit := expectedMitigatedMagic(varusChainOfCorruptionPrimaryHitExpectedRaw, varusChainOfCorruptionPrimaryHitTargetMR)
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		if evidenceDataBool(item.Data, "phantom") {
			t.Fatalf("damage[%d] must not be phantom: %+v", i, item.Data)
		}
		if evidenceDataString(item.Data, "phase") != "original" {
			t.Fatalf("damage[%d] phase=%q want original", i, evidenceDataString(item.Data, "phase"))
		}
		if evidenceDataString(item.Data, "damageType") != "damage/magic" {
			t.Fatalf("damage[%d] type=%q want damage/magic (runtime 20221)", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataString(item.Data, "damageType") == "damage/physical" {
			t.Fatalf("damage[%d] must not be physical (20220)", i)
		}
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q want %q", i, evidenceDataString(item.Data, "abilityRef"), ref)
		}
		if evidenceDataString(item.Data, "providerRef") != varusChainOfCorruptionPrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), varusChainOfCorruptionPrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != varusChainOfCorruptionPrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), varusChainOfCorruptionPrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		rawAmt := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(rawAmt-varusChainOfCorruptionPrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, rawAmt, varusChainOfCorruptionPrimaryHitExpectedRaw)
		}
		if math.Abs(mit-wantMit) > 1e-9 {
			t.Fatalf("damage[%d] mitigatedAmount=%v want %v", i, mit, wantMit)
		}
		mitSum += mit
	}

	wantDealt := 2 * wantMit
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-varusChainOfCorruptionPrimaryHitHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, varusChainOfCorruptionPrimaryHitHPAfter2)
	}
	wantHP := varusChainOfCorruptionPrimaryHitTargetHP - wantDealt
	if math.Abs(wantHP-varusChainOfCorruptionPrimaryHitHPAfter2) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("HP cross-check=%v want %v", wantHP, varusChainOfCorruptionPrimaryHitHPAfter2)
	}

	gotMana := varusChainOfCorruptionPrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-varusChainOfCorruptionPrimaryHitManaAfter2) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 200; skipped attempt costs 0)",
			gotMana, varusChainOfCorruptionPrimaryHitManaAfter2)
	}
	if math.Abs((varusChainOfCorruptionPrimaryHitFixtureMana-gotMana)-200) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("mana spent=%v want 200", varusChainOfCorruptionPrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/root/blight/tendril/E/W hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ap"); math.Abs(got-varusChainOfCorruptionPrimaryHitFixtureAP) > varusChainOfCorruptionPrimaryHitTol {
		t.Fatalf("ap.resolved=%v want %v", got, varusChainOfCorruptionPrimaryHitFixtureAP)
	}

	// Cooldown skip must not mutate mana beyond the two successful costs, nor add
	// damage / listener / state / control evidence beyond the two R magic ops.
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindListenerSkipped ||
			item.Kind == model.EvidenceKindProviderTick ||
			item.Kind == model.EvidenceKindEmittedEvent {
			t.Fatalf("cooldown path must not emit listener/state/control-like evidence: %+v", item)
		}
		if item.Kind == model.EvidenceKindDamage && item.TimeMs == 59999 {
			t.Fatal("cooldown skip at t=59999 must not deal damage")
		}
	}
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[varusChainOfCorruptionPrimaryHitProviderRef]
		if !ok {
			continue
		}
		state, _ := bag.(map[string]interface{})
		if len(state) != 0 {
			t.Fatalf("provider state must remain empty after cooldown skip (no root/reveal/Blight/tendril): %+v", state)
		}
	}

	// Exclusions / no hidden behavior: Phase-A fixture only — not a claim about live game.
	p := varusChainOfCorruptionPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider missing after run")
	}
	if len(p.Listeners) != 0 || len(p.InitialStateSchema) != 0 || p.Lifecycle != nil {
		t.Fatal("fixture must not grow listener/state/lifecycle after compile (Phase-A exclusions)")
	}
	a := p.Abilities[0]
	if a.TickSpec != nil || a.ListenerSpec != nil || a.CastCondition != nil || len(a.StateSchema) != 0 {
		t.Fatal("fixture ability must not carry cast/projectile/root/reveal/Blight/tendril/listener/state surfaces")
	}
	for _, op := range a.Operations {
		if op.Operation != "damage" || op.DamageType != "damage/magic" {
			t.Fatalf("fixture must remain single magic damage op only: %+v", op)
		}
	}
	outBlob, err := json.Marshal(done.Summary)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	out := string(outBlob)
	for _, banned := range []string{
		"blighted_quiver", "hail_of_arrows", "basic_attack",
		"projectile", "multi_target", "tendril",
	} {
		if strings.Contains(out, banned) {
			t.Fatalf("runtime summary must not contain excluded branch %q", banned)
		}
	}
}
