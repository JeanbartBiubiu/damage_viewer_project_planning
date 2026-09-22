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

// hero_ezreal E Arcane Shift / 奥术跃迁 — Phase-A v3 Wasm exact verification slice
// (FROZEN_PLAN_REV: ezreal-e-arcane-shift-primary-hit-phase-a-v3).

const (
	ezrealArcaneShiftCandidateKey  = "hero_skill|hero_ezreal|E|奥术跃迁"
	ezrealArcaneShiftTaskKey       = "wasm-generic-ezreal-arcane-shift-primary-hit"
	ezrealArcaneShiftPlanRev       = "ezreal-e-arcane-shift-primary-hit-phase-a-v3"
	ezrealArcaneShiftRequestTitle  = "Template:Data Ezreal/E"
	ezrealArcaneShiftResolvedTitle = "Template:Data Ezreal/Arcane Shift"
	ezrealArcaneShiftWikiPageID    = 1307111
	ezrealArcaneShiftRevisionID    = 3989862
	ezrealArcaneShiftTimestamp     = "2026-02-03T23:19:20Z"
	ezrealArcaneShiftRawBytes      = 1661
	ezrealArcaneShiftLocalRawBytes = 1661
	ezrealArcaneShiftContentSHA    = "7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347"
	ezrealArcaneShiftLocalRawSHA   = "f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792"
	ezrealArcaneShiftBoundary      = "rank5_primary_champion_single_hit; immediate_impact_scaffold; " +
		"magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; " +
		"no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks"

	ezrealArcaneShiftProviderRef = "provider_hero_ezreal_e_arcane_shift_primary_hit"
	ezrealArcaneShiftStableID    = "hero_ezreal_e_arcane_shift_primary_hit"
	ezrealArcaneShiftAbilityID   = "ability_hero_ezreal_e_arcane_shift_primary_hit"
	ezrealArcaneShiftAbilityKey  = "arcane_shift_primary_hit"
	ezrealArcaneShiftDamageOpRef = "op:ezreal_arcane_shift_primary_hit_damage"
	ezrealArcaneShiftBonusADMod  = "fixture_ezreal_arcane_shift_primary_hit_bonus_ad"

	ezrealArcaneShiftBaseDamage   = 280.0
	ezrealArcaneShiftBonusADRatio = 0.60
	ezrealArcaneShiftAPRatio      = 0.75
	ezrealArcaneShiftManaCost     = 70.0
	ezrealArcaneShiftCDMs         = 14000.0

	ezrealArcaneShiftADBase            = 60.0
	ezrealArcaneShiftADResolvedDefault = 110.0
	ezrealArcaneShiftFixtureAP         = 200.0
	ezrealArcaneShiftFixtureManaCD     = 210.0
	ezrealArcaneShiftFixtureManaShort  = 69.0
	ezrealArcaneShiftTargetMR          = 100.0
	ezrealArcaneShiftTargetHP          = 1000.0
	ezrealArcaneShiftExpectedRaw       = 460.0
	ezrealArcaneShiftExpectedMitigated = 230.0
	ezrealArcaneShiftManaAfter2        = 70.0  // 210 - 70 - 70
	ezrealArcaneShiftHPAfter2          = 540.0 // 1000 - 230 - 230
	ezrealArcaneShiftTol               = 1e-9

	ezrealArcaneShiftSeedDamageJSON = `{"op":"add","args":[{"op":"add","args":[{"op":"const","value":280},` +
		`{"op":"mul","args":[{"op":"const","value":0.60},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},` +
		`{"op":"mul","args":[{"op":"const","value":0.75},{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	ezrealArcaneShiftRSFProviderAlias = "provider_hero_ezreal_rising_spell_force"
)

func ezrealArcaneShiftOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"bonus_ad_ratio",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func ezrealArcaneShiftExpectedRawFromStats(resolvedAD, baseAD, resolvedAP float64) float64 {
	return ezrealArcaneShiftBaseDamage +
		ezrealArcaneShiftBonusADRatio*(resolvedAD-baseAD) +
		ezrealArcaneShiftAPRatio*resolvedAP
}

func ezrealArcaneShiftDamageAmount() *model.GenericFormulaExpr {
	base := ezrealArcaneShiftBaseDamage
	adRatio := ezrealArcaneShiftBonusADRatio
	apRatio := ezrealArcaneShiftAPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &base},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &adRatio},
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
			},
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

func ezrealArcaneShiftAbility() model.AbilityDefinition {
	cost := ezrealArcaneShiftManaCost
	cd := ezrealArcaneShiftCDMs
	return model.AbilityDefinition{
		AbilityKey: ezrealArcaneShiftAbilityKey,
		Kind:       "active",
		Types:      []string{},
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
				DamageType:    "damage/magic",
				Ref:           ezrealArcaneShiftDamageOpRef,
				Amount:        ezrealArcaneShiftDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func ezrealArcaneShiftProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: ezrealArcaneShiftProviderRef,
		Kind:        "champion",
		StableID:    ezrealArcaneShiftStableID,
		Abilities:   []model.AbilityDefinition{ezrealArcaneShiftAbility()},
	}
	// Fixture-only flat AD; production/seed E provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: ezrealArcaneShiftBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func ezrealArcaneShiftAbilityRef() string {
	return "source.provider[" + ezrealArcaneShiftProviderRef + "].ability[" + ezrealArcaneShiftAbilityKey + "]"
}

type ezrealArcaneShiftFixtureOpts struct {
	resolvedAD float64
	resolvedAP float64
	mana       float64
	withRSF    bool
}

func ezrealArcaneShiftRSFProviderDef() model.ProviderDefinition {
	// Fine-grained same-package helpers only — never overwrite via configureEzrealRSFProvider.
	return model.ProviderDefinition{
		ProviderKey:        ezrealRSFProviderRef,
		Kind:               "champion",
		StableID:           ezrealRSFStableID,
		InitialStateSchema: ezrealRSFStateSchema(),
		Modifiers:          []model.ModifierDefinition{ezrealRSFASModifier()},
		Listeners:          []model.ListenerDefinition{ezrealRSFStackListener()},
	}
}

func configureEzrealArcaneShiftProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts ezrealArcaneShiftFixtureOpts) {
	bonusAD := opts.resolvedAD - ezrealArcaneShiftADBase
	e := ezrealArcaneShiftProviderDef(bonusAD)
	shared := []model.ProviderDefinition{e}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: ezrealArcaneShiftProviderRef, DefinitionRef: ezrealArcaneShiftProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{ProviderRef: ezrealArcaneShiftProviderRef, DefinitionRef: ezrealArcaneShiftProviderRef, Stacks: 1, State: map[string]interface{}{}},
	}
	if opts.withRSF {
		shared = append(shared, ezrealArcaneShiftRSFProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: ezrealRSFProviderRef, DefinitionRef: ezrealRSFProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: ezrealRSFProviderRef, DefinitionRef: ezrealRSFProviderRef,
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

func ensureEzrealArcaneShiftTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{{Key: "damage/magic", Domain: "damage"}}
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

func loadEzrealArcaneShiftFixture(t *testing.T, opts ezrealArcaneShiftFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAD/resolvedAP explicitly (AD60/AP0 are valid branches).
	if opts.mana == 0 {
		opts.mana = ezrealArcaneShiftFixtureManaCD
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureEzrealArcaneShiftTypes(&compileReq)
	if opts.withRSF {
		ensureEzrealRSFTypes(&compileReq)
	}
	configureEzrealArcaneShiftProviders(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: ezrealArcaneShiftADBase, Current: ezrealArcaneShiftADBase,
		Max: ezrealArcaneShiftADBase, Resolved: ezrealArcaneShiftADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, ezrealArcaneShiftFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: ezrealArcaneShiftTargetHP, Current: ezrealArcaneShiftTargetHP,
		Max: ezrealArcaneShiftTargetHP, Resolved: ezrealArcaneShiftTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: ezrealArcaneShiftTargetMR, Current: ezrealArcaneShiftTargetMR,
		Max: ezrealArcaneShiftTargetMR, Resolved: ezrealArcaneShiftTargetMR,
	})
	if opts.withRSF {
		setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
			Base: ezrealRSFBaseAS, Current: ezrealRSFBaseAS, Max: ezrealRSFBaseAS, Resolved: ezrealRSFBaseAS,
		})
	}
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runEzrealArcaneShift(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runEzrealArcaneShiftFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func ezrealArcaneShiftSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func ezrealArcaneShiftSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped && item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func ezrealArcaneShiftDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") == ezrealArcaneShiftDamageOpRef {
			out = append(out, item)
		}
	}
	return out
}

func ezrealArcaneShiftAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > ezrealArcaneShiftTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > ezrealArcaneShiftTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
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
}

func assertEzrealArcaneShiftProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	var p *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == ezrealArcaneShiftProviderRef {
			p = &compileReq.SharedProviders[i]
			break
		}
	}
	if p == nil {
		t.Fatal("E provider missing")
	}
	if p.StableID != ezrealArcaneShiftStableID {
		t.Fatalf("stableId=%q", p.StableID)
	}
	if p.ProviderKey == ezrealArcaneShiftRSFProviderAlias || p.ProviderKey == ezrealRSFProviderRef ||
		p.StableID == ezrealRSFStableID {
		t.Fatal("E must not reuse Rising Spell Force provider refs")
	}
	if len(p.Listeners) != 0 || len(p.InitialStateSchema) != 0 {
		t.Fatalf("E listeners/state=%d/%d want 0/0", len(p.Listeners), len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 || p.Modifiers[0].ModifierKey != ezrealArcaneShiftBonusADMod {
			t.Fatalf("want fixture-only bonus-AD mod, got %+v", p.Modifiers)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1", len(p.Abilities))
	}
	a := p.Abilities[0]
	if a.AbilityKey != ezrealArcaneShiftAbilityKey || a.Kind != "active" {
		t.Fatalf("ability=%+v", a)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("E must not be basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-ezrealArcaneShiftManaCost) > ezrealArcaneShiftTol {
		t.Fatalf("cost=%+v want mana 70", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-ezrealArcaneShiftCDMs) > ezrealArcaneShiftTol {
		t.Fatalf("cooldown=%+v want 14000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("ops=%d want 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" ||
		op.CritEligible || op.CopyableOnHit || op.Ref != ezrealArcaneShiftDamageOpRef {
		t.Fatalf("op=%+v", op)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("amount=%+v want nested binary add", op.Amount)
	}
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-ezrealArcaneShiftBaseDamage) > ezrealArcaneShiftTol {
		t.Fatalf("base const=%+v want 280", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-ezrealArcaneShiftBonusADRatio) > ezrealArcaneShiftTol {
		t.Fatalf("bonusAD mul=%+v", adMul)
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || sub.Args[0].Path != "source.attr.ad.resolved" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonusAD sub=%+v", sub)
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-ezrealArcaneShiftAPRatio) > ezrealArcaneShiftTol ||
		apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP mul=%+v", apMul)
	}
	for _, banned := range a.Operations {
		if banned.Operation == "emit_event" || banned.Operation == "projectile" ||
			banned.Operation == "dash" || banned.Operation == "blink" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" {
			t.Fatalf("forbidden op: %+v", banned)
		}
	}
}

func ezrealArcaneShiftRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing %s: %v", path, err)
	}
	return path
}

func ezrealArcaneShiftSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func ezrealArcaneShiftLoadSeed(t *testing.T) (full, noComments string) {
	t.Helper()
	raw, err := os.ReadFile(ezrealArcaneShiftRepoPath(t, "db", "game_manage", "seeds",
		"lol_generic_ezreal_arcane_shift_primary_hit_seed.sql"))
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

// TestEzrealArcaneShiftSourceSeedProviderFormulaShape locks wiki/sidecar/pages/
// local-raw caveat, seed/README/JUnit identifiers, and E provider/formula shape.
func TestEzrealArcaneShiftSourceSeedProviderFormulaShape(t *testing.T) {
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
	sidecarRaw, err := os.ReadFile(ezrealArcaneShiftRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "ezreal-e.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != ezrealArcaneShiftCandidateKey || doc.RequestTitle != ezrealArcaneShiftRequestTitle ||
		doc.ResolvedTitle != ezrealArcaneShiftResolvedTitle || doc.WikiPageID != ezrealArcaneShiftWikiPageID ||
		doc.RevisionID != ezrealArcaneShiftRevisionID || doc.RevisionTimestamp != ezrealArcaneShiftTimestamp ||
		doc.ContentSHA256 != ezrealArcaneShiftContentSHA || doc.RawByteSize != ezrealArcaneShiftRawBytes ||
		doc.SkillKey != "E" || doc.ZhDisplayName != "奥术跃迁" || doc.OwnerID != "hero_ezreal" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{"description", "leveling", "description2", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "70\n" || doc.Fields.Costtype != "Mana\n" || doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|80 to 280}}") ||
		!strings.Contains(doc.Fields.Leveling, "60% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling, "75% AP") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "blinks") ||
		!strings.Contains(doc.Fields.Description, "homing") ||
		!strings.Contains(doc.Fields.Description2, "Essence Flux") {
		t.Fatal("wiki prose must retain excluded blink/homing/Essence Flux surfaces")
	}
	pagesRaw, err := os.ReadFile(ezrealArcaneShiftRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "ezreal-e.json"))
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
	rawBytes, err := os.ReadFile(ezrealArcaneShiftRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "ezreal-e.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != ezrealArcaneShiftLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), ezrealArcaneShiftLocalRawBytes)
	}
	localSHA := ezrealArcaneShiftSHA256Hex(rawBytes)
	if localSHA != ezrealArcaneShiftLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, ezrealArcaneShiftLocalRawSHA)
	}
	if localSHA == ezrealArcaneShiftContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}
	if ezrealArcaneShiftPlanRev != "ezreal-e-arcane-shift-primary-hit-phase-a-v3" ||
		ezrealArcaneShiftBoundary != "rank5_primary_champion_single_hit; immediate_impact_scaffold; "+
			"magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; "+
			"no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seed, sqlNoComments := ezrealArcaneShiftLoadSeed(t)
	_ = ezrealArcaneShiftRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest.java")
	readmeBytes, err := os.ReadFile(ezrealArcaneShiftRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)
	for _, want := range []string{
		ezrealArcaneShiftCandidateKey, ezrealArcaneShiftTaskKey, ezrealArcaneShiftPlanRev,
		ezrealArcaneShiftRequestTitle, ezrealArcaneShiftResolvedTitle,
		"1307111", "3989862", ezrealArcaneShiftTimestamp,
		ezrealArcaneShiftContentSHA, ezrealArcaneShiftLocalRawSHA, "1661",
		ezrealArcaneShiftBoundary, ezrealArcaneShiftProviderRef, ezrealArcaneShiftAbilityID,
		ezrealArcaneShiftAbilityKey, "arcane_shift_damage", "e_mana_cost", "e_cooldown_ms",
		`{"op":"const","value":70}`, `{"op":"const","value":14000}`,
		ezrealArcaneShiftSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/ezreal-e.json", "Rising Spell Force",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range ezrealArcaneShiftOrderedTags() {
		if !strings.Contains(seed, tag) {
			t.Fatalf("seed missing tag %q", tag)
		}
	}
	if regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.modifier_definitions\b`).MatchString(sqlNoComments) ||
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_modifiers\b`).MatchString(sqlNoComments) {
		t.Fatal("seed must not insert E production modifier rows")
	}
	if !strings.Contains(readme, ezrealArcaneShiftProviderRef) ||
		!strings.Contains(readme, "14000") || !strings.Contains(readme, "0.60") {
		t.Fatal("README missing E identity/formula/cost-CD contract")
	}
	if strings.Contains(readme, "fixture_ezreal_arcane_shift_primary_hit_bonus_ad") {
		t.Fatal("README must not claim fixture-only AD modifier as production E behavior")
	}

	compileReq, _ := loadEzrealArcaneShiftFixture(t, ezrealArcaneShiftFixtureOpts{
		resolvedAD: ezrealArcaneShiftADResolvedDefault,
		resolvedAP: ezrealArcaneShiftFixtureAP,
		mana:       ezrealArcaneShiftFixtureManaCD,
	})
	assertEzrealArcaneShiftProviderShape(t, compileReq, 1, true)
	rawX := ezrealArcaneShiftExpectedRawFromStats(
		ezrealArcaneShiftADResolvedDefault, ezrealArcaneShiftADBase, ezrealArcaneShiftFixtureAP)
	if math.Abs(rawX-ezrealArcaneShiftExpectedRaw) > ezrealArcaneShiftTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, ezrealArcaneShiftExpectedRaw)
	}
	mitX := expectedMitigatedMagic(rawX, ezrealArcaneShiftTargetMR)
	if math.Abs(mitX-ezrealArcaneShiftExpectedMitigated) > ezrealArcaneShiftTol {
		t.Fatalf("default mit=%v want %v", mitX, ezrealArcaneShiftExpectedMitigated)
	}
}

// TestEzrealArcaneShiftFormulaBranchTable: AD×AP four-case raw/mitigated table.
func TestEzrealArcaneShiftFormulaBranchTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, resolvedAP float64
		wantRaw, wantMit       float64
	}{
		{"ad60_ap0", 60, 0, 280, 140},
		{"ad110_ap0", 110, 0, 310, 155},
		{"ad60_ap200", 60, 200, 430, 215},
		{"ad110_ap200", 110, 200, 460, 230},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := ezrealArcaneShiftExpectedRawFromStats(tc.resolvedAD, ezrealArcaneShiftADBase, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > ezrealArcaneShiftTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			if math.Abs(expectedMitigatedMagic(tc.wantRaw, ezrealArcaneShiftTargetMR)-tc.wantMit) > ezrealArcaneShiftTol {
				t.Fatalf("cross-check mit want %v", tc.wantMit)
			}
			compileReq, runReq := loadEzrealArcaneShiftFixture(t, ezrealArcaneShiftFixtureOpts{
				resolvedAD: tc.resolvedAD, resolvedAP: tc.resolvedAP, mana: ezrealArcaneShiftFixtureManaCD,
			})
			assertEzrealArcaneShiftProviderShape(t, compileReq, 1, tc.resolvedAD != ezrealArcaneShiftADBase)
			ref := ezrealArcaneShiftAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runEzrealArcaneShift(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d", done.Summary.AbilityCastCount)
			}
			dmg := ezrealArcaneShiftDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("damage=%d", len(dmg))
			}
			ezrealArcaneShiftAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMit)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > ezrealArcaneShiftTol {
				t.Fatalf("ad.resolved=%v", sourceAttrResolved(t, done.FinalSnapshot, "ad"))
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > ezrealArcaneShiftTol {
				t.Fatalf("ap.resolved=%v", sourceAttrResolved(t, done.FinalSnapshot, "ap"))
			}
		})
	}
}

// TestEzrealArcaneShiftCooldownAndResourceGateTable: CD schedule + resource gate.
func TestEzrealArcaneShiftCooldownAndResourceGateTable(t *testing.T) {
	t.Run("cooldown_mana210", func(t *testing.T) {
		compileReq, runReq := loadEzrealArcaneShiftFixture(t, ezrealArcaneShiftFixtureOpts{
			resolvedAD: ezrealArcaneShiftADResolvedDefault,
			resolvedAP: ezrealArcaneShiftFixtureAP,
			mana:       ezrealArcaneShiftFixtureManaCD,
		})
		assertEzrealArcaneShiftProviderShape(t, compileReq, 1, true)
		ref := ezrealArcaneShiftAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 13999},
			{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 14000},
		}
		runReq.StopPolicy.DurationMs = 14100
		done := runEzrealArcaneShift(t, compileReq, runReq)
		if done.Summary.AbilityAttemptCount != 3 || done.Summary.AbilityCastCount != 2 ||
			done.Summary.AttemptSkippedCount != 1 {
			t.Fatalf("attempt/cast/skip=%d/%d/%d want 3/2/1",
				done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount, done.Summary.AttemptSkippedCount)
		}
		if ezrealArcaneShiftSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
			t.Fatal("want one cooldown_not_ready")
		}
		var skipOK bool
		for _, item := range done.Evidence.Items {
			if item.Kind != model.EvidenceKindAttemptSkipped ||
				item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
				continue
			}
			if item.TimeMs != 13999 || numericAsInt64(item.Data["readyAtMs"]) != 14000 {
				t.Fatalf("skip TimeMs/readyAt=%d/%v", item.TimeMs, item.Data["readyAtMs"])
			}
			skipOK = true
		}
		if !skipOK {
			t.Fatal("missing cooldown skip at 13999 readyAt 14000")
		}
		items := ezrealArcaneShiftDamageEvidence(done)
		if len(items) != 2 {
			t.Fatalf("E damage=%d want 2", len(items))
		}
		for i, at := range []int64{0, 14000} {
			if items[i].TimeMs != at {
				t.Fatalf("damage[%d] t=%d want %d", i, items[i].TimeMs, at)
			}
			ezrealArcaneShiftAssertDamage(t, items[i], ezrealArcaneShiftExpectedRaw, ezrealArcaneShiftExpectedMitigated)
		}
		if math.Abs(ezrealArcaneShiftSourceMana(t, done.FinalSnapshot)-ezrealArcaneShiftManaAfter2) > ezrealArcaneShiftTol {
			t.Fatalf("mana=%v want %v", ezrealArcaneShiftSourceMana(t, done.FinalSnapshot), ezrealArcaneShiftManaAfter2)
		}
		if math.Abs(done.Summary.TargetFinalHp-ezrealArcaneShiftHPAfter2) > 1e-6 {
			t.Fatalf("hp=%v want %v", done.Summary.TargetFinalHp, ezrealArcaneShiftHPAfter2)
		}
		if len(damageEvidenceItems(done)) != 2 {
			t.Fatal("skipped attempt must produce no damage")
		}
		if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
			t.Fatal("no basic_attack_hit")
		}
	})

	t.Run("resource_mana69", func(t *testing.T) {
		compileReq, runReq := loadEzrealArcaneShiftFixture(t, ezrealArcaneShiftFixtureOpts{
			resolvedAD: ezrealArcaneShiftADResolvedDefault,
			resolvedAP: ezrealArcaneShiftFixtureAP,
			mana:       ezrealArcaneShiftFixtureManaShort,
		})
		ref := ezrealArcaneShiftAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runEzrealArcaneShift(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 0 || done.Summary.AbilityAttemptCount != 1 {
			t.Fatalf("cast/attempt=%d/%d", done.Summary.AbilityCastCount, done.Summary.AbilityAttemptCount)
		}
		if ezrealArcaneShiftSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
			t.Fatal("want resource_insufficient")
		}
		if math.Abs(ezrealArcaneShiftSourceMana(t, done.FinalSnapshot)-ezrealArcaneShiftFixtureManaShort) > ezrealArcaneShiftTol {
			t.Fatal("mana must be unchanged")
		}
		if math.Abs(done.Summary.TargetFinalHp-ezrealArcaneShiftTargetHP) > 1e-6 {
			t.Fatal("HP must be unchanged")
		}
		if len(ezrealArcaneShiftDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
			t.Fatal("want zero damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 0 {
			t.Fatal("resource skip must not synthesize ability_started")
		}
	})
}

// TestEzrealArcaneShiftRSFCoexistenceAndDeterministicRelease: P coexistence + frame release.
func TestEzrealArcaneShiftRSFCoexistenceAndDeterministicRelease(t *testing.T) {
	t.Run("rsf_coexistence", func(t *testing.T) {
		compileReq, runReq := loadEzrealArcaneShiftFixture(t, ezrealArcaneShiftFixtureOpts{
			resolvedAD: ezrealArcaneShiftADResolvedDefault,
			resolvedAP: ezrealArcaneShiftFixtureAP,
			mana:       ezrealArcaneShiftFixtureManaCD,
			withRSF:    true,
		})
		assertEzrealArcaneShiftProviderShape(t, compileReq, 2, true)
		var rsf *model.ProviderDefinition
		for i := range compileReq.SharedProviders {
			if compileReq.SharedProviders[i].ProviderKey == ezrealRSFProviderRef {
				rsf = &compileReq.SharedProviders[i]
			}
		}
		if rsf == nil || len(rsf.Listeners) != 1 || len(rsf.InitialStateSchema) == 0 || len(rsf.Modifiers) != 1 {
			t.Fatalf("RSF provider incomplete: %+v", rsf)
		}
		if len(compileReq.Combatants[0].Providers) != 2 {
			t.Fatal("both E and P mounts required")
		}
		ref := ezrealArcaneShiftAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "e_cd", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100},
		}
		runReq.StopPolicy.DurationMs = 200
		done := runEzrealArcaneShift(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if ezrealArcaneShiftSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
			t.Fatal("want cooldown skip at t100")
		}
		if len(ezrealArcaneShiftDamageEvidence(done)) != 1 {
			t.Fatal("exactly one E damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 at successful cast only",
				countEmittedEvents(done, "event/ability_started"))
		}
		for _, item := range done.Evidence.Items {
			if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == "event/ability_started" && item.TimeMs != 0 {
				t.Fatalf("ability_started at t=%d want 0", item.TimeMs)
			}
		}
		if stacks := ezrealRSFStacks(t, done); math.Abs(stacks-1) > ezrealArcaneShiftTol {
			t.Fatalf("P stacks=%v want 1", stacks)
		}
		as := ezrealRSFSourceASSlot(t, done.FinalSnapshot)
		wantAS := ezrealRSFWantAS(1)
		if math.Abs(as.Base-ezrealRSFBaseAS) > ezrealArcaneShiftTol ||
			math.Abs(as.Resolved-wantAS) > ezrealArcaneShiftTol {
			t.Fatalf("AS base/resolved=%v/%v want %v/%v", as.Base, as.Resolved, ezrealRSFBaseAS, wantAS)
		}
		if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
			t.Fatal("no basic_attack_hit")
		}
	})

	t.Run("determinism_and_release", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadEzrealArcaneShiftFixture(t, ezrealArcaneShiftFixtureOpts{
				resolvedAD: ezrealArcaneShiftADResolvedDefault,
				resolvedAP: ezrealArcaneShiftFixtureAP,
				mana:       ezrealArcaneShiftFixtureManaCD,
			})
			ref := ezrealArcaneShiftAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 13999},
				{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 14000},
			}
			r.StopPolicy.DurationMs = 14100
			done := runEzrealArcaneShift(t, c, r)
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
		c, r := loadEzrealArcaneShiftFixture(t, ezrealArcaneShiftFixtureOpts{
			resolvedAD: ezrealArcaneShiftADResolvedDefault,
			resolvedAP: ezrealArcaneShiftFixtureAP,
			mana:       ezrealArcaneShiftFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: ezrealArcaneShiftAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runEzrealArcaneShiftFrames(t, c, r)
		if len(ezrealArcaneShiftDamageEvidence(done)) != 1 {
			t.Fatal("frame-path want one E damage")
		}
	})
}
