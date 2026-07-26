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

// hero_xayah R Featherstorm / 暴风羽刃 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: xayah-r-featherstorm-primary-hit-phase-a-v2).
//
// Semantic framing (mandatory): this test models one selected application of the
// leveling-labeled amount as one bounded primary-champion physical damage
// quantum. It does not claim the Wiki proves the full R is once-only, or that
// complete Featherstorm has one total hit. It does not model five damage
// operations or same-target feather cardinality.

const (
	xayahFSCandidateKey  = "hero_skill|hero_xayah|R|暴风羽刃"
	xayahFSTaskKey       = "wasm-generic-xayah-featherstorm-primary-hit"
	xayahFSPlanRev       = "xayah-r-featherstorm-primary-hit-phase-a-v2"
	xayahFSRequestTitle  = "Template:Data Xayah/R"
	xayahFSResolvedTitle = "Template:Data Xayah/Featherstorm"
	xayahFSWikiPageID    = 1324544
	xayahFSRevisionID    = 4008617
	xayahFSTimestamp     = "2026-04-15T00:26:44Z"
	xayahFSRawBytes      = 1761
	xayahFSLocalRawBytes = 1761
	xayahFSContentSHA    = "cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077"
	xayahFSLocalRawSHA   = "debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1"
	xayahFSBoundary      = "rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; " +
		"quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; " +
		"no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; " +
		"no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_" +
		"direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity"

	xayahFSProviderRef = "provider_hero_xayah_r_featherstorm_primary_hit"
	xayahFSStableID    = "hero_xayah_r_featherstorm_primary_hit"
	xayahFSAbilityID   = "ability_hero_xayah_r_featherstorm_primary_hit"
	xayahFSAbilityKey  = "featherstorm_primary_hit"
	xayahFSDamageOpRef = "op:xayah_featherstorm_primary_hit_damage"
	xayahFSBonusADMod  = "fixture_xayah_featherstorm_primary_hit_bonus_ad"

	xayahFSBaseDamage   = 400.0
	xayahFSBonusADRatio = 1.00
	xayahFSManaCost     = 100.0
	xayahFSCDMs         = 100000.0

	xayahFSADBase            = 60.0
	xayahFSADResolvedDefault = 110.0
	xayahFSFixtureManaCD     = 300.0
	xayahFSFixtureManaShort  = 99.0
	xayahFSTargetArmor       = 100.0
	xayahFSTargetHP          = 1000.0
	xayahFSBaselineAS        = 0.658
	xayahFSManaAfter2        = 100.0 // 300 - 100 - 100
	xayahFSHPAfter2          = 550.0 // 1000 - 225 - 225
	xayahFSTol               = 1e-9

	xayahFSSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":400},` +
		`{"op":"mul","args":[{"op":"const","value":1.00},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}`
)

func xayahFSOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func xayahFSExpectedRawFromStats(resolvedAD, baseAD float64) float64 {
	return xayahFSBaseDamage + xayahFSBonusADRatio*(resolvedAD-baseAD)
}

func xayahFSDamageAmount() *model.GenericFormulaExpr {
	base := xayahFSBaseDamage
	ratio := xayahFSBonusADRatio
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

func xayahFSAbility() model.AbilityDefinition {
	cost := xayahFSManaCost
	cd := xayahFSCDMs
	return model.AbilityDefinition{
		AbilityKey: xayahFSAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical damage quantum; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           xayahFSDamageOpRef,
				Amount:        xayahFSDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func xayahFSProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: xayahFSProviderRef,
		Kind:        "champion",
		StableID:    xayahFSStableID,
		Abilities:   []model.AbilityDefinition{xayahFSAbility()},
	}
	// Fixture-only flat AD; production/seed R provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: xayahFSBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

// Fine-grained same-package W helpers only — never overwrite via configureXayahDPProvider.
func xayahFSWProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        xayahDPProviderRef,
		Kind:               "champion",
		StableID:           xayahDPStableID,
		InitialStateSchema: xayahDPStateSchema(),
		Modifiers: []model.ModifierDefinition{
			xayahDPASModifier(),
			xayahDPBasicDamageModifier(),
		},
		Listeners: []model.ListenerDefinition{xayahDPCastArmListener()},
		Abilities: []model.AbilityDefinition{xayahDPWAbility()},
	}
}

// Fine-grained same-package Q helpers only — never overwrite Q definitions.
func xayahFSQProviderDef(bonusAD float64) model.ProviderDefinition {
	return xayahDDProviderDef(bonusAD)
}

func xayahFSAbilityRef() string {
	return "source.provider[" + xayahFSProviderRef + "].ability[" + xayahFSAbilityKey + "]"
}

type xayahFSFixtureOpts struct {
	resolvedAD float64
	armor      float64
	mana       float64
	withW      bool
	withQ      bool
	wAS        bool // use W fixture AS base (0.60) instead of R baseline 0.658
}

func configureXayahFSProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts xayahFSFixtureOpts) {
	bonusAD := opts.resolvedAD - xayahFSADBase
	r := xayahFSProviderDef(bonusAD)
	shared := []model.ProviderDefinition{r}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: xayahFSProviderRef, DefinitionRef: xayahFSProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{ProviderRef: xayahFSProviderRef, DefinitionRef: xayahFSProviderRef, Stacks: 1, State: map[string]interface{}{}},
	}
	if opts.withQ {
		// Only R carries the fixture-only bonus-AD mod when co-mounted; stacking
		// two flat AD mods would double-count resolved AD for both formulas.
		shared = append(shared, xayahFSQProviderDef(0))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: xayahDDProviderRef, DefinitionRef: xayahDDProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: xayahDDProviderRef, DefinitionRef: xayahDDProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	if opts.withW {
		shared = append(shared, xayahFSWProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: xayahDPProviderRef, DefinitionRef: xayahDPProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: xayahDPProviderRef, DefinitionRef: xayahDPProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	compileReq.SharedProviders = shared
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snaps
	}
}

func ensureXayahFSTypes(req *model.CompileRequest, withW bool) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/physical", Domain: "damage"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "event/ability_started", Domain: "event"},
	}
	if withW {
		need = append(need,
			model.TypeCatalogEntry{Key: xayahDPAbilityType, Domain: "ability"},
			model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
			model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"},
			model.TypeCatalogEntry{Key: "damage_trait/on_hit", Domain: "damage_trait"},
			model.TypeCatalogEntry{Key: "damage_trait/proc", Domain: "damage_trait"},
		)
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

func loadXayahFSFixture(t *testing.T, opts xayahFSFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.mana == 0 {
		opts.mana = xayahFSFixtureManaCD
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureXayahFSTypes(&compileReq, opts.withW)
	configureXayahFSProviders(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: xayahFSADBase, Current: xayahFSADBase,
		Max: xayahFSADBase, Resolved: xayahFSADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, xayahFSFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: xayahFSTargetHP, Current: xayahFSTargetHP,
		Max: xayahFSTargetHP, Resolved: xayahFSTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})
	asBase := xayahFSBaselineAS
	if opts.wAS {
		asBase = xayahDPBaseAS
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: asBase, Current: asBase, Max: asBase, Resolved: asBase,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runXayahFS(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runXayahFSFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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
	releaseReq := model.ReleaseSessionRequest{SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash}
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
		t.Fatalf("ReleaseSessionFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	released := lastGenericReleaseDone(session.OutboxBytes())
	if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
		t.Fatalf("release=%+v", released)
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

func xayahFSSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func xayahFSSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped && item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func xayahFSDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") == xayahFSDamageOpRef {
			out = append(out, item)
		}
	}
	return out
}

func xayahFSAbilityStartedCount(done model.DoneResult) int {
	return countEmittedEvents(done, "event/ability_started")
}

func xayahFSAssertOneQuantum(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	if evidenceDataString(item.Data, "operationRef") != xayahFSDamageOpRef {
		t.Fatalf("op=%q want %q", evidenceDataString(item.Data, "operationRef"), xayahFSDamageOpRef)
	}
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > xayahFSTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > xayahFSTol {
		t.Fatalf("mit=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataBool(item.Data, "phantom") {
		t.Fatal("damage must not be phantom")
	}
	if evidenceDataString(item.Data, "phase") != "original" {
		t.Fatalf("phase=%q want original", evidenceDataString(item.Data, "phase"))
	}
	if _, ok := item.Data["eligible"]; ok {
		t.Fatalf("must not carry crit evidence: %+v", item.Data)
	}
	if ref := evidenceDataString(item.Data, "abilityRef"); ref != "" && ref != xayahFSAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", ref, xayahFSAbilityRef())
	}
}

func assertXayahFSProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	var p *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == xayahFSProviderRef {
			p = &compileReq.SharedProviders[i]
			break
		}
	}
	if p == nil {
		t.Fatal("R provider missing")
	}
	if p.StableID != xayahFSStableID {
		t.Fatalf("stableId=%q", p.StableID)
	}
	if p.ProviderKey == xayahDPProviderRef || p.StableID == xayahDPStableID ||
		p.ProviderKey == xayahDDProviderRef || p.StableID == xayahDDStableID {
		t.Fatal("R must not reuse Deadly Plumage or Double Daggers provider refs")
	}
	if len(p.Listeners) != 0 || len(p.InitialStateSchema) != 0 {
		t.Fatalf("R listeners/state=%d/%d want 0/0", len(p.Listeners), len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 || p.Modifiers[0].ModifierKey != xayahFSBonusADMod {
			t.Fatalf("want fixture-only bonus-AD mod, got %+v", p.Modifiers)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (production R seed has no R modifiers)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1", len(p.Abilities))
	}
	a := p.Abilities[0]
	if a.AbilityKey != xayahFSAbilityKey || a.Kind != "active" {
		t.Fatalf("ability=%+v", a)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" || typ == xayahDPAbilityType {
			t.Fatalf("R must not carry type %q", typ)
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-xayahFSManaCost) > xayahFSTol {
		t.Fatalf("cost=%+v want mana 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-xayahFSCDMs) > xayahFSTol {
		t.Fatalf("cooldown=%+v want 100000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("ops=%d want 1 (one physical damage quantum; not five)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" ||
		op.CritEligible || op.CopyableOnHit || op.Ref != xayahFSDamageOpRef {
		t.Fatalf("op=%+v want physical target %s noncrit/noncopyable", op, xayahFSDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("amount=%+v want nested binary add", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-xayahFSBaseDamage) > xayahFSTol {
		t.Fatalf("base const=%+v want 400", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-xayahFSBonusADRatio) > xayahFSTol {
		t.Fatalf("bonusAD mul=%+v", adMul)
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || sub.Args[0].Path != "source.attr.ad.resolved" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonusAD sub=%+v", sub)
	}
	for _, banned := range a.Operations {
		if banned.Operation == "emit_event" || banned.Operation == "projectile" ||
			banned.Operation == "dash" || banned.Operation == "blink" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" {
			t.Fatalf("forbidden op: %+v", banned)
		}
	}
}

func xayahFSRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing %s: %v", path, err)
	}
	return path
}

func xayahFSSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func xayahFSLoadSeed(t *testing.T) (full, noComments string) {
	t.Helper()
	raw, err := os.ReadFile(xayahFSRepoPath(t, "db", "game_manage", "seeds",
		"lol_generic_xayah_featherstorm_primary_hit_seed.sql"))
	if err != nil {
		t.Fatal(err)
	}
	full = string(raw)
	var b strings.Builder
	for _, line := range strings.Split(full, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return full, b.String()
}

// TestXayahFeatherstormSourceSeedProviderFormulaShape locks wiki/sidecar/pages/
// local-raw caveat, seed/README identifiers, and R provider/formula shape.
func TestXayahFeatherstormSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Description2, Description3 string
			Cooldown, Cost, Costtype, Damagetype, Notes       string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(xayahFSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "xayah-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != xayahFSCandidateKey || doc.RequestTitle != xayahFSRequestTitle ||
		doc.ResolvedTitle != xayahFSResolvedTitle || doc.WikiPageID != xayahFSWikiPageID ||
		doc.RevisionID != xayahFSRevisionID || doc.RevisionTimestamp != xayahFSTimestamp ||
		doc.ContentSHA256 != xayahFSContentSHA || doc.RawByteSize != xayahFSRawBytes ||
		doc.SkillKey != "R" || doc.ZhDisplayName != "暴风羽刃" || doc.OwnerID != "hero_xayah" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{"description", "leveling", "description2", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "100\n" || doc.Fields.Costtype != "Mana\n" || doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|200 to 400}}") ||
		!strings.Contains(doc.Fields.Leveling, "100% '''bonus''' AD") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "ghosted") ||
		!strings.Contains(doc.Fields.Description, "untargetable") ||
		!strings.Contains(doc.Fields.Description, "5") ||
		!strings.Contains(doc.Fields.Description, "cone") ||
		!strings.Contains(doc.Fields.Description2, "unable to basic attack") {
		t.Fatal("wiki prose must retain excluded leap/ghosted/untargetable/five-feather/cone/lockout surfaces")
	}
	pagesRaw, err := os.ReadFile(xayahFSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "xayah-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pages struct {
		CandidateKey, ContentSHA256 string
		PageID, RevisionID          int
	}
	if err := json.Unmarshal(pagesRaw, &pages); err != nil {
		t.Fatal(err)
	}
	if pages.CandidateKey != doc.CandidateKey || pages.ContentSHA256 != doc.ContentSHA256 ||
		pages.PageID != doc.WikiPageID || pages.RevisionID != doc.RevisionID {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}
	rawBytes, err := os.ReadFile(xayahFSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "xayah-r.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != xayahFSLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), xayahFSLocalRawBytes)
	}
	localSHA := xayahFSSHA256Hex(rawBytes)
	if localSHA != xayahFSLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, xayahFSLocalRawSHA)
	}
	if localSHA == xayahFSContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if xayahFSPlanRev != "xayah-r-featherstorm-primary-hit-phase-a-v2" ||
		xayahFSBoundary != "rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; "+
			"quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; "+
			"no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; "+
			"no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_"+
			"direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seed, sqlNoComments := xayahFSLoadSeed(t)
	_ = xayahFSRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericXayahFeatherstormPrimaryHitSeedSqlTest.java")
	readmeBytes, err := os.ReadFile(xayahFSRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)
	for _, want := range []string{
		xayahFSCandidateKey, xayahFSTaskKey, xayahFSPlanRev,
		xayahFSRequestTitle, xayahFSResolvedTitle,
		"1324544", "4008617", xayahFSTimestamp,
		xayahFSContentSHA, xayahFSLocalRawSHA, "1761",
		xayahFSBoundary, xayahFSProviderRef, xayahFSAbilityID,
		xayahFSAbilityKey, "featherstorm_primary_hit_damage", "r_mana_cost", "r_cooldown_ms",
		`{"op":"const","value":100}`, `{"op":"const","value":100000}`,
		xayahFSSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/xayah-r.json", "ability/xayah_deadly_plumage",
		"preserve_deadly_plumage", "damage quantum",
		"no_claim_of_whole_r_single_total_hit",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range xayahFSOrderedTags() {
		if !strings.Contains(seed, tag) {
			t.Fatalf("seed missing tag %q", tag)
		}
	}
	if regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.modifier_definitions\b`).MatchString(sqlNoComments) ||
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_modifiers\b`).MatchString(sqlNoComments) {
		t.Fatal("seed must not insert R production modifier rows")
	}
	if regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_listeners\b`).MatchString(sqlNoComments) ||
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.listener_match_types\b`).MatchString(sqlNoComments) ||
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_state_schemas\b`).MatchString(sqlNoComments) {
		t.Fatal("seed must not insert R listeners/matchers/state")
	}
	if !strings.Contains(readme, xayahFSProviderRef) ||
		!strings.Contains(readme, "100000") || !strings.Contains(readme, "1.00") {
		t.Fatal("README missing R identity/formula/cost-CD contract")
	}
	if strings.Contains(readme, xayahFSBonusADMod) {
		t.Fatal("README must not claim fixture-only AD modifier as production R behavior")
	}
	if !strings.Contains(readme, "damage quantum") ||
		!strings.Contains(readme, "不证明完整 Featherstorm") {
		t.Fatal("README must retain quantum framing / no whole-R once-only claim")
	}

	compileReq, _ := loadXayahFSFixture(t, xayahFSFixtureOpts{
		resolvedAD: xayahFSADResolvedDefault,
		armor:      xayahFSTargetArmor,
		mana:       xayahFSFixtureManaCD,
		withW:      true,
	})
	assertXayahFSProviderShape(t, compileReq, 2, true)
	assertXayahDPListenerAbilityTypeIsolation(t, model.CompileRequest{
		TypeCatalog:     compileReq.TypeCatalog,
		SharedProviders: []model.ProviderDefinition{xayahFSWProviderDef()},
	})
	rawX := xayahFSExpectedRawFromStats(xayahFSADResolvedDefault, xayahFSADBase)
	if math.Abs(rawX-450) > xayahFSTol {
		t.Fatalf("default raw cross-check=%v want 450", rawX)
	}
	mitX := expectedMitigatedPhysical(rawX, xayahFSTargetArmor)
	if math.Abs(mitX-225) > xayahFSTol {
		t.Fatalf("default mit=%v want 225", mitX)
	}
}

// TestXayahFeatherstormFormulaBranchTable: AD×armor four-case one-quantum table.
func TestXayahFeatherstormFormulaBranchTable(t *testing.T) {
	cases := []struct {
		name             string
		resolvedAD       float64
		armor            float64
		wantRaw, wantMit float64
	}{
		{"ad60_armor0", 60, 0, 400, 400},
		{"ad60_armor100", 60, 100, 400, 200},
		{"ad110_armor0", 110, 0, 450, 450},
		{"ad110_armor100", 110, 100, 450, 225},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := xayahFSExpectedRawFromStats(tc.resolvedAD, xayahFSADBase)
			if math.Abs(rawX-tc.wantRaw) > xayahFSTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			if math.Abs(expectedMitigatedPhysical(tc.wantRaw, tc.armor)-tc.wantMit) > xayahFSTol {
				t.Fatalf("cross-check mit want %v", tc.wantMit)
			}
			compileReq, runReq := loadXayahFSFixture(t, xayahFSFixtureOpts{
				resolvedAD: tc.resolvedAD, armor: tc.armor, mana: xayahFSFixtureManaCD, withW: true,
			})
			assertXayahFSProviderShape(t, compileReq, 2, tc.resolvedAD != xayahFSADBase)
			ref := xayahFSAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runXayahFS(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d", done.Summary.AbilityCastCount)
			}
			dmg := xayahFSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage-quantum items=%d want 1", len(dmg))
			}
			xayahFSAssertOneQuantum(t, dmg[0], tc.wantRaw, tc.wantMit)
			if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
				t.Fatalf("W active=%v want 0 after R cast (ability-type isolation)", got)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")-xayahFSBaselineAS) > xayahFSTol {
				t.Fatalf("AS=%v want baseline %v", sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"), xayahFSBaselineAS)
			}
			if xayahFSAbilityStartedCount(done) != 1 {
				t.Fatalf("ability_started=%d want 1 (automatic; no explicit event op)", xayahFSAbilityStartedCount(done))
			}
		})
	}
}

// TestXayahFeatherstormCooldownResourceAndWIsolation: CD/resource gates + W non-arm.
func TestXayahFeatherstormCooldownResourceAndWIsolation(t *testing.T) {
	t.Run("cooldown_mana300", func(t *testing.T) {
		compileReq, runReq := loadXayahFSFixture(t, xayahFSFixtureOpts{
			resolvedAD: xayahFSADResolvedDefault,
			armor:      xayahFSTargetArmor,
			mana:       xayahFSFixtureManaCD,
			withW:      true,
		})
		assertXayahFSProviderShape(t, compileReq, 2, true)
		ref := xayahFSAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 99999},
			{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100000},
		}
		runReq.StopPolicy.DurationMs = 100100
		done := runXayahFS(t, compileReq, runReq)
		if done.Summary.AbilityAttemptCount != 3 || done.Summary.AbilityCastCount != 2 ||
			done.Summary.AttemptSkippedCount != 1 {
			t.Fatalf("attempt/cast/skip=%d/%d/%d want 3/2/1",
				done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount, done.Summary.AttemptSkippedCount)
		}
		if xayahFSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
			t.Fatal("want one cooldown_not_ready")
		}
		var skipOK bool
		for _, item := range done.Evidence.Items {
			if item.Kind != model.EvidenceKindAttemptSkipped ||
				item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
				continue
			}
			if item.TimeMs != 99999 || numericAsInt64(item.Data["readyAtMs"]) != 100000 {
				t.Fatalf("skip TimeMs/readyAt=%d/%v", item.TimeMs, item.Data["readyAtMs"])
			}
			skipOK = true
		}
		if !skipOK {
			t.Fatal("missing cooldown skip at 99999 readyAt 100000")
		}
		items := xayahFSDamageEvidence(done)
		if len(items) != 2 {
			t.Fatalf("R damage-quantum items=%d want 2", len(items))
		}
		xayahFSAssertOneQuantum(t, items[0], 450, 225)
		xayahFSAssertOneQuantum(t, items[1], 450, 225)
		if math.Abs(xayahFSSourceMana(t, done.FinalSnapshot)-xayahFSManaAfter2) > xayahFSTol {
			t.Fatalf("mana=%v want %v", xayahFSSourceMana(t, done.FinalSnapshot), xayahFSManaAfter2)
		}
		if math.Abs(done.Summary.TargetFinalHp-xayahFSHPAfter2) > 1e-6 {
			t.Fatalf("hp=%v want %v", done.Summary.TargetFinalHp, xayahFSHPAfter2)
		}
		if xayahFSAbilityStartedCount(done) != 2 {
			t.Fatalf("ability_started=%d want 2 (automatic R only)", xayahFSAbilityStartedCount(done))
		}
		if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
			t.Fatalf("W active=%v want 0 (no W arm / no Q/R cross-effects)", got)
		}
		if len(xayahDDDamageEvidence(done)) != 0 {
			t.Fatal("R-only cast must produce no Q damage (no Q/R cross-effects)")
		}
		if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")-xayahFSBaselineAS) > xayahFSTol {
			t.Fatalf("AS=%v want baseline", sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"))
		}
	})

	t.Run("resource_mana99", func(t *testing.T) {
		compileReq, runReq := loadXayahFSFixture(t, xayahFSFixtureOpts{
			resolvedAD: xayahFSADResolvedDefault,
			armor:      xayahFSTargetArmor,
			mana:       xayahFSFixtureManaShort,
			withW:      true,
		})
		ref := xayahFSAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runXayahFS(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 0 || done.Summary.AbilityAttemptCount != 1 {
			t.Fatalf("cast/attempt=%d/%d", done.Summary.AbilityCastCount, done.Summary.AbilityAttemptCount)
		}
		if xayahFSSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
			t.Fatal("want resource_insufficient")
		}
		if math.Abs(xayahFSSourceMana(t, done.FinalSnapshot)-xayahFSFixtureManaShort) > xayahFSTol {
			t.Fatal("mana must be unchanged")
		}
		if math.Abs(done.Summary.TargetFinalHp-xayahFSTargetHP) > 1e-6 {
			t.Fatal("HP must be unchanged")
		}
		if len(xayahFSDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
			t.Fatal("want zero damage")
		}
		if xayahFSAbilityStartedCount(done) != 0 {
			t.Fatal("resource skip must not synthesize ability_started")
		}
		if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
			t.Fatalf("W active=%v want 0", got)
		}
		if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "attack_speed")-xayahFSBaselineAS) > xayahFSTol {
			t.Fatal("baseline AS must be unchanged")
		}
	})
}

// TestXayahFeatherstormWQRIsolation: combined W/Q/R fixture isolation.
// Bounded fixture only — do not infer absent real-game behavior.
func TestXayahFeatherstormWQRIsolation(t *testing.T) {
	compileReq, runReq := loadXayahFSFixture(t, xayahFSFixtureOpts{
		resolvedAD: xayahFSADResolvedDefault,
		armor:      xayahFSTargetArmor,
		mana:       xayahFSFixtureManaCD,
		withW:      true,
		withQ:      true,
		wAS:        true,
	})
	assertXayahFSProviderShape(t, compileReq, 3, true)
	// Q co-mount uses zero Q-local AD mods; resolved AD comes from R fixture-only mod.
	assertXayahDDProviderShape(t, compileReq, 3, false)
	var w *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == xayahDPProviderRef {
			w = &compileReq.SharedProviders[i]
		}
	}
	if w == nil || len(w.Listeners) != 1 || len(w.InitialStateSchema) == 0 || len(w.Modifiers) != 2 {
		t.Fatalf("W provider incomplete: %+v", w)
	}
	if len(compileReq.Combatants[0].Providers) != 3 {
		t.Fatal("R, Q, and W mounts required")
	}
	assertXayahDPListenerAbilityTypeIsolation(t, model.CompileRequest{
		TypeCatalog:     compileReq.TypeCatalog,
		SharedProviders: []model.ProviderDefinition{*w},
	})

	snapshotKeys := func() []string {
		keys := make([]string, 0, len(compileReq.SharedProviders))
		for _, p := range compileReq.SharedProviders {
			keys = append(keys, p.ProviderKey+"|"+p.StableID)
		}
		return keys
	}
	beforeKeys := strings.Join(snapshotKeys(), ",")
	beforeMounts := len(compileReq.Combatants[0].Providers)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: xayahFSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q0", AbilityRef: xayahDDAbilityRef(), Source: "source", Target: "target", FirstAtMs: 10},
		{EntryKey: "w0", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 20},
	}
	runReq.StopPolicy.DurationMs = 100
	done := runXayahFS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 3 {
		t.Fatalf("castCount=%d want 3 (R+Q+W)", done.Summary.AbilityCastCount)
	}
	rDmg := xayahFSDamageEvidence(done)
	if len(rDmg) != 1 {
		t.Fatalf("R damage-quantum items=%d want 1", len(rDmg))
	}
	xayahFSAssertOneQuantum(t, rDmg[0], 450, 225)
	qDmg := xayahDDDamageEvidence(done)
	if len(qDmg) != 2 {
		t.Fatalf("Q damage items=%d want 2", len(qDmg))
	}
	xayahDDAssertOrderedPair(t, qDmg, 130, 65)
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
		t.Fatalf("W active=%v want 1 after W self-cast", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > xayahFSTol ||
		math.Abs(slot.Resolved-xayahDPResolvedAS) > xayahFSTol {
		t.Fatalf("AS base/resolved=%v/%v want %v/%v", slot.Base, slot.Resolved, xayahDPBaseAS, xayahDPResolvedAS)
	}
	if xayahFSAbilityStartedCount(done) != 3 {
		t.Fatalf("ability_started=%d want 3 (R+Q+W automatic)", xayahFSAbilityStartedCount(done))
	}

	// Provider definition/mount/snapshot must not be overwritten by composition.
	assertXayahFSProviderShape(t, compileReq, 3, true)
	assertXayahDDProviderShape(t, compileReq, 3, false)
	afterKeys := strings.Join(snapshotKeys(), ",")
	if beforeKeys != afterKeys || beforeMounts != len(compileReq.Combatants[0].Providers) {
		t.Fatalf("provider keys/mounts mutated: before=%s mounts=%d after=%s mounts=%d",
			beforeKeys, beforeMounts, afterKeys, len(compileReq.Combatants[0].Providers))
	}

	// R/Q alone must not arm W — separate fresh runs.
	t.Run("r_does_not_arm_w", func(t *testing.T) {
		c, r := loadXayahFSFixture(t, xayahFSFixtureOpts{
			resolvedAD: xayahFSADResolvedDefault, armor: xayahFSTargetArmor,
			mana: xayahFSFixtureManaCD, withW: true, withQ: true,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: xayahFSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		d := runXayahFS(t, c, r)
		if got := xayahDPStateValue(t, d, xayahDPActiveKey); got != 0 {
			t.Fatalf("W active=%v want 0 after R", got)
		}
		if len(xayahFSDamageEvidence(d)) != 1 {
			t.Fatal("R must still deal one quantum")
		}
	})
	t.Run("q_does_not_arm_w", func(t *testing.T) {
		c, r := loadXayahFSFixture(t, xayahFSFixtureOpts{
			resolvedAD: xayahFSADResolvedDefault, armor: xayahFSTargetArmor,
			mana: xayahFSFixtureManaCD, withW: true, withQ: true,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: xayahDDAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		d := runXayahFS(t, c, r)
		if got := xayahDPStateValue(t, d, xayahDPActiveKey); got != 0 {
			t.Fatalf("W active=%v want 0 after Q", got)
		}
		if len(xayahDDDamageEvidence(d)) != 2 {
			t.Fatal("Q must still deal two hits")
		}
		if len(xayahFSDamageEvidence(d)) != 0 {
			t.Fatal("Q cast must not produce R damage")
		}
	})
}

// TestXayahFeatherstormDeterminismAndLifecycle: repeated compile/run + frame lifecycle.
func TestXayahFeatherstormDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadXayahFSFixture(t, xayahFSFixtureOpts{
				resolvedAD: xayahFSADResolvedDefault,
				armor:      xayahFSTargetArmor,
				mana:       xayahFSFixtureManaCD,
				withW:      true,
			})
			ref := xayahFSAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 99999},
				{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100000},
			}
			r.StopPolicy.DurationMs = 100100
			done := runXayahFS(t, c, r)
			sum, _ := json.Marshal(done.Summary)
			ev, _ := json.Marshal(done.Evidence)
			snap, _ := json.Marshal(done.FinalSnapshot)
			return string(sum), string(ev), string(snap)
		}
		s1, e1, f1 := runOnce()
		s2, e2, f2 := runOnce()
		if s1 != s2 || e1 != e2 || f1 != f2 {
			t.Fatal("summary/evidence/finalSnapshot unstable")
		}
	})

	t.Run("frame_release", func(t *testing.T) {
		c, r := loadXayahFSFixture(t, xayahFSFixtureOpts{
			resolvedAD: xayahFSADResolvedDefault,
			armor:      xayahFSTargetArmor,
			mana:       xayahFSFixtureManaCD,
			withW:      true,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: xayahFSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runXayahFSFrames(t, c, r)
		items := xayahFSDamageEvidence(done)
		if len(items) != 1 {
			t.Fatalf("frame-path R damage=%d want 1", len(items))
		}
		xayahFSAssertOneQuantum(t, items[0], 450, 225)
		if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
			t.Fatalf("W active=%v want 0 after R frame path", got)
		}
	})

	t.Run("wrong_missing_session", func(t *testing.T) {
		c, r := loadXayahFSFixture(t, xayahFSFixtureOpts{
			resolvedAD: xayahFSADResolvedDefault,
			armor:      xayahFSTargetArmor,
			mana:       xayahFSFixtureManaCD,
			withW:      true,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: xayahFSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
		// Release succeeds exactly once: re-release / re-run after release → session_not_found.
		session.ClearOutbox()
		if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != -1 {
			t.Fatalf("second ReleaseSessionFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("second release want session_not_found")
		}
	})
}
