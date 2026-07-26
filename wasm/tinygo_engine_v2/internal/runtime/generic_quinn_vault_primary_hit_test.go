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

// hero_quinn E Vault / 旋翔掠杀 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: quinn-e-vault-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_champion_single_hit; immediate_impact_scaffold;
//	physical_140_plus_0_20_bonus_ad;
//	no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_quinn|E|旋翔掠杀
//	task wasm-generic-quinn-vault-primary-hit
//	Request Template:Data Quinn/E → resolved Template:Data Quinn/Vault
//	wikiPageId 1308957 / rev 4024768 / timestamp 2026-06-03T00:51:11Z
//	canonical rawByteSize 2649 / SHA256
//	  9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714
//	数据参考/lol-wiki-current-champions/normalized/generic/quinn-e.json
//	pages/raw siblings: pages/quinn-e.json, raw/quinn-e.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_quinn_vault_primary_hit_seed.sql
//	Local raw materialization caveat (same length, different SHA): 2649 bytes /
//	  SHA256 317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b.
//	Assert both identities/caveat; do not claim equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_quinn_e_vault_primary_hit
//     (not Heightened Senses / Blinding Assault / basic-attack reuse)
//   - ability ability_hero_quinn_e_vault_primary_hit with ability_key
//     vault_primary_hit: active; mana 50; cooldown 8000 ms
//   - Exactly one immediate direct-target physical damage op:
//     add(140, mul(0.20, sub(ad.resolved, ad.base)))
//     (binary add; never three-argument add)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No provider states / listeners / explicit emit_event / repeat / control
//     (fixture-only flat AD modifier is harness-only for bonus-AD resolved)
//
// Accepted note NB-ZERO-EMITTED-EVENTS-SCOPE: do not assert global emitted-event
// count is zero if runtime synthesizes event/ability_started. Assert no explicit
// E emit_event op and specifically zero event/basic_attack_hit; W must remain
// unarmed.
//
// Accepted note NB-MANA-RESOURCE-SEED-ORDER: Backend registration is
// W → Q(resource) → E; E seed check-only for mana resource rows.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, bonus_ad_ratio,
// immediate_impact_scaffold.

const (
	quinnVaultCandidateKey  = "hero_skill|hero_quinn|E|旋翔掠杀"
	quinnVaultTaskKey       = "wasm-generic-quinn-vault-primary-hit"
	quinnVaultPlanRev       = "quinn-e-vault-phase-a-v1"
	quinnVaultRequestTitle  = "Template:Data Quinn/E"
	quinnVaultResolvedTitle = "Template:Data Quinn/Vault"
	quinnVaultWikiPageID    = 1308957
	quinnVaultRevisionID    = 4024768
	quinnVaultTimestamp     = "2026-06-03T00:51:11Z"
	quinnVaultRawBytes      = 2649
	quinnVaultLocalRawBytes = 2649
	quinnVaultContentSHA    = "9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714"
	quinnVaultLocalRawSHA   = "317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b"
	quinnVaultBoundary      = "rank5_primary_champion_single_hit; immediate_impact_scaffold; " +
		"physical_140_plus_0_20_bonus_ad; " +
		"no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_" +
		"basic_attack_reset_auto_attack_or_other_ranks"

	quinnVaultProviderRef = "provider_hero_quinn_e_vault_primary_hit"
	quinnVaultStableID    = "hero_quinn_e_vault_primary_hit"
	quinnVaultAbilityID   = "ability_hero_quinn_e_vault_primary_hit"
	quinnVaultAbilityKey  = "vault_primary_hit"
	quinnVaultDamageOpRef = "op:quinn_vault_primary_hit_damage"
	quinnVaultBonusADMod  = "fixture_quinn_vault_primary_hit_bonus_ad"

	quinnVaultBasicAttackProviderAlias = "provider_hero_quinn_basic_attack"
	quinnVaultHSProviderAlias          = "provider_hero_quinn_heightened_senses"
	quinnVaultQProviderAlias           = "provider_hero_quinn_q_blinding_assault_primary_hit"

	quinnVaultBaseDamage   = 140.0
	quinnVaultBonusADRatio = 0.20
	quinnVaultManaCost     = 50.0
	quinnVaultCDMs         = 8000.0

	quinnVaultADBase            = 59.0
	quinnVaultADResolvedDefault = 139.0 // fixture flat +80
	quinnVaultFixtureManaCD     = 150.0
	quinnVaultFixtureManaShort  = 49.0
	quinnVaultTargetArmor       = 100.0
	quinnVaultTargetHP          = 100000.0
	quinnVaultExpectedRawDefault = 156.0 // 140 + 0.20*80
	quinnVaultExpectedMitDefault = 78.0
	quinnVaultManaAfter2         = 50.0 // 150 - 50 - 50

	quinnVaultSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":140},` +
		`{"op":"mul","args":[{"op":"const","value":0.20},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},` +
		`{"op":"read","path":"source.attr.ad.base"}]}]}]}`

	quinnVaultTol = 1e-9
)

func quinnVaultOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func quinnVaultExpectedRawFromStats(resolvedAD, baseAD float64) float64 {
	return quinnVaultBaseDamage + quinnVaultBonusADRatio*(resolvedAD-baseAD)
}

func quinnVaultDamageAmount() *model.GenericFormulaExpr {
	base := quinnVaultBaseDamage
	adRatio := quinnVaultBonusADRatio
	return &model.GenericFormulaExpr{
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
	}
}

func quinnVaultAbility() model.AbilityDefinition {
	cost := quinnVaultManaCost
	cd := quinnVaultCDMs
	return model.AbilityDefinition{
		AbilityKey: quinnVaultAbilityKey,
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
				DamageType:    "damage/physical",
				Ref:           quinnVaultDamageOpRef,
				Amount:        quinnVaultDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func quinnVaultProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: quinnVaultProviderRef,
		Kind:        "champion",
		StableID:    quinnVaultStableID,
		Abilities:   []model.AbilityDefinition{quinnVaultAbility()},
	}
	// Fixture-only flat AD so ad.base stays 59 while ad.resolved can rise.
	// Production/seed E provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: quinnVaultBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func quinnVaultAbilityRef() string {
	return "source.provider[" + quinnVaultProviderRef + "].ability[" + quinnVaultAbilityKey + "]"
}

func quinnVaultHSProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        quinnHSProviderRef,
		Kind:               "champion",
		StableID:           quinnHSStableID,
		InitialStateSchema: quinnHSStateSchema(),
		Modifiers:          []model.ModifierDefinition{quinnHSASModifier()},
		Listeners:          []model.ListenerDefinition{quinnHSArmListener()},
		Abilities: []model.AbilityDefinition{
			quinnHSHitAbility(),
			quinnHSProbeAbility(),
		},
	}
}

type quinnVaultFixtureOpts struct {
	resolvedAD float64
	mana       float64
	withHS     bool
	withQ      bool
	vulnerable float64
}

func configureQuinnVaultProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts quinnVaultFixtureOpts) {
	bonusAD := opts.resolvedAD - quinnVaultADBase
	e := quinnVaultProviderDef(bonusAD)

	shared := []model.ProviderDefinition{e}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: quinnVaultProviderRef, DefinitionRef: quinnVaultProviderRef},
	}
	snapProviders := []model.CombatantProviderSnapshot{
		{ProviderRef: quinnVaultProviderRef, DefinitionRef: quinnVaultProviderRef, Stacks: 1, State: map[string]interface{}{}},
	}

	if opts.withQ {
		// Q mounted for coexistence; bonus-AD fixture stays on E only.
		shared = append(shared, quinnBAProviderDef(0))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: quinnBAProviderRef, DefinitionRef: quinnBAProviderRef,
		})
		snapProviders = append(snapProviders, model.CombatantProviderSnapshot{
			ProviderRef: quinnBAProviderRef, DefinitionRef: quinnBAProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	if opts.withHS {
		shared = append(shared, quinnVaultHSProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: quinnHSProviderRef, DefinitionRef: quinnHSProviderRef,
		})
		snapProviders = append(snapProviders, model.CombatantProviderSnapshot{
			ProviderRef: quinnHSProviderRef, DefinitionRef: quinnHSProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}

	compileReq.SharedProviders = shared
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snapProviders
	}
	if opts.withHS && opts.vulnerable != 0 {
		seedQuinnHarrierVulnerable(runReq, model.SelectorTarget, opts.vulnerable)
	}
}

func ensureQuinnVaultTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/physical", Domain: "damage"},
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

func loadQuinnVaultFixture(t *testing.T, opts quinnVaultFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.resolvedAD == 0 {
		opts.resolvedAD = quinnVaultADResolvedDefault
	}
	if opts.mana == 0 {
		opts.mana = quinnVaultFixtureManaCD
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureQuinnVaultTypes(&compileReq)
	if opts.withHS {
		ensureQuinnHSTypes(&compileReq)
	}
	if opts.withQ {
		ensureQuinnBATypes(&compileReq)
	}
	configureQuinnVaultProviders(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: quinnVaultADBase, Current: quinnVaultADBase,
		Max: quinnVaultADBase, Resolved: quinnVaultADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, quinnVaultFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: quinnVaultTargetHP, Current: quinnVaultTargetHP,
		Max: quinnVaultTargetHP, Resolved: quinnVaultTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: quinnVaultTargetArmor, Current: quinnVaultTargetArmor,
		Max: quinnVaultTargetArmor, Resolved: quinnVaultTargetArmor,
	})
	if opts.withHS {
		setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
			Base: quinnHSBaseAS, Current: quinnHSBaseAS, Max: quinnHSBaseAS, Resolved: quinnHSBaseAS,
		})
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runQuinnVault(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

type quinnVaultRunBundle struct {
	done      model.DoneResult
	sessionID string
	rulesHash string
}

func runQuinnVaultFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) quinnVaultRunBundle {
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
		SessionID:         compiled.SessionID,
		ExpectedRulesHash: compiled.RulesHash,
	}
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
		t.Fatalf("ReleaseSessionFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	released := lastGenericReleaseDone(session.OutboxBytes())
	if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
		t.Fatalf("release=%+v want ok released session %q", released, compiled.SessionID)
	}
	session.ClearOutbox()
	rerun := runReq
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, rerun)); code != -1 {
		t.Fatalf("RunFrame after release code=%d want -1", code)
	}
	if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
		t.Fatalf("after release want session_not_found")
	}
	return quinnVaultRunBundle{done: done, sessionID: compiled.SessionID, rulesHash: compiled.RulesHash}
}

func quinnVaultSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func quinnVaultSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func quinnVaultSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func quinnVaultDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != quinnVaultDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func quinnVaultFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == quinnVaultProviderRef {
			return p
		}
	}
	return nil
}

func assertQuinnVaultProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := quinnVaultFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_quinn_e_vault_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != quinnVaultProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, quinnVaultProviderRef)
	}
	if p.StableID != quinnVaultStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, quinnVaultStableID)
	}
	if p.ProviderKey == quinnVaultBasicAttackProviderAlias || p.StableID == quinnVaultBasicAttackProviderAlias ||
		p.ProviderKey == quinnVaultHSProviderAlias || p.StableID == quinnVaultHSProviderAlias ||
		p.ProviderKey == quinnVaultQProviderAlias || p.StableID == quinnVaultQProviderAlias ||
		p.ProviderKey == quinnHSProviderRef || p.StableID == quinnHSStableID ||
		p.ProviderKey == quinnBAProviderRef || p.StableID == quinnBAStableID {
		t.Fatal("vault primary-hit must not reuse basic / Heightened Senses / Blinding Assault provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != quinnVaultBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], quinnVaultBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), quinnVaultAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != quinnVaultAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, quinnVaultAbilityKey, quinnVaultAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("vault must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-quinnVaultManaCost) > quinnVaultTol {
		t.Fatalf("cost=%+v want mana const 50", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-quinnVaultCDMs) > quinnVaultTol {
		t.Fatalf("cooldown=%+v want const 8000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("vault damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("vault damage must not be copyable on hit")
	}
	if op.Ref != quinnVaultDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, quinnVaultDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const140, mul(0.20, sub(ad)))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-quinnVaultBaseDamage) > quinnVaultTol {
		t.Fatalf("base const=%+v want 140", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-quinnVaultBonusADRatio) > quinnVaultTol {
		t.Fatalf("bonus-AD ratio=%+v want 0.20", adMul.Args[0])
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want sub(ad.resolved, ad.base)", sub)
	}
	if adMul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	for _, banned := range a.Operations {
		if banned.Operation == "emit_event" || banned.Operation == "slow" ||
			banned.Operation == "stun" || banned.Operation == "knockback" ||
			banned.Operation == "dash" || banned.Operation == "projectile" ||
			banned.Operation == "multi_target" || banned.Operation == "state_change" ||
			banned.Operation == "repeat" || banned.Operation == "control" {
			t.Fatalf("vault must not include emit/control/geometry/state/repeat op: %+v", banned)
		}
	}
}

func findQuinnVaultAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := quinnVaultAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func quinnVaultWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "quinn-e.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnVaultWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "quinn-e.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnVaultWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "quinn-e.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnVaultSeedPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"db", "game_manage", "seeds", "lol_generic_quinn_vault_primary_hit_seed.sql")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("backend seed missing at %s: %v (fail closed; assert after Backend materialization)", path, err)
	}
	return path
}

func quinnVaultJUnitPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"server", "data_manage", "src", "test", "java", "xyz", "game", "datamanage", "db",
		"LolGenericQuinnVaultPrimaryHitSeedSqlTest.java")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("JUnit contract missing at %s: %v", path, err)
	}
	return path
}

func quinnVaultREADMEPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "server", "data_manage", "README.md")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("README missing at %s: %v", path, err)
	}
	return path
}

type quinnVaultWikiSidecar struct {
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
		Cooldown      string `json:"cooldown"`
		Cost         string `json:"cost"`
		Costtype     string `json:"costtype"`
		Damagetype   string `json:"damagetype"`
		Notes        string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

type quinnVaultWikiPages struct {
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

func quinnVaultLoadWikiSidecar(t *testing.T) quinnVaultWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(quinnVaultWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc quinnVaultWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

func quinnVaultLoadWikiPages(t *testing.T) quinnVaultWikiPages {
	t.Helper()
	raw, err := os.ReadFile(quinnVaultWikiPagesPath(t))
	if err != nil {
		t.Fatalf("read wiki pages: %v", err)
	}
	var doc quinnVaultWikiPages
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki pages: %v", err)
	}
	return doc
}

func quinnVaultLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(quinnVaultSeedPath(t))
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

func quinnVaultSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func quinnVaultAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > quinnVaultTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > quinnVaultTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
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
		t.Fatalf("must not carry crit evidence fields: %+v", item.Data)
	}
}

// TestGenericQuinnVaultWikiSidecarIdentityAndBoundary locks sidecar/pages
// canonical identity plus local-raw materialization caveat (same length, different SHA).
func TestGenericQuinnVaultWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := quinnVaultLoadWikiSidecar(t)
	if doc.CandidateKey != quinnVaultCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, quinnVaultCandidateKey)
	}
	if doc.RequestTitle != quinnVaultRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, quinnVaultRequestTitle)
	}
	if doc.ResolvedTitle != quinnVaultResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, quinnVaultResolvedTitle)
	}
	if doc.WikiPageID != quinnVaultWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, quinnVaultWikiPageID)
	}
	if doc.RevisionID != quinnVaultRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, quinnVaultRevisionID)
	}
	if doc.RevisionTimestamp != quinnVaultTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, quinnVaultTimestamp)
	}
	if doc.ContentSHA256 != quinnVaultContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, quinnVaultContentSHA)
	}
	if doc.RawByteSize != quinnVaultRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, quinnVaultRawBytes)
	}
	if doc.SkillKey != "E" || doc.ZhDisplayName != "旋翔掠杀" || doc.OwnerID != "hero_quinn" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want E/旋翔掠杀/hero_quinn",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{"description", "leveling", "description2", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "50\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "50\n")
	}
	if doc.Fields.Cooldown != "{{ap|12 to 8}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|12 to 8}}\n")
	}
	if doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("fields.damagetype=%q want Physical", doc.Fields.Damagetype)
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("fields.costtype=%q want Mana", doc.Fields.Costtype)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|40 to 140}}") {
		t.Fatalf("leveling missing rank formula {{ap|40 to 140}}: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "20% '''bonus''' AD") {
		t.Fatalf("leveling missing 20%% bonus AD: %q", doc.Fields.Leveling)
	}
	// Excluded full-fidelity surfaces remain present in wiki prose.
	if !strings.Contains(doc.Fields.Description, "dashes") ||
		!strings.Contains(doc.Fields.Description, "Harrier") ||
		!strings.Contains(doc.Fields.Description, "knocking them back") ||
		!strings.Contains(doc.Fields.Description, "slow") {
		t.Fatalf("description missing dash/Harrier/knockback/slow (excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description2, "basic attack reset") {
		t.Fatalf("description2 missing basic attack reset (excluded): %q", doc.Fields.Description2)
	}

	pages := quinnVaultLoadWikiPages(t)
	if pages.CandidateKey != quinnVaultCandidateKey ||
		pages.RequestTitle != quinnVaultRequestTitle ||
		pages.ResolvedTitle != quinnVaultResolvedTitle ||
		pages.PageID != quinnVaultWikiPageID ||
		pages.RevisionID != quinnVaultRevisionID ||
		pages.RevisionTimestamp != quinnVaultTimestamp ||
		pages.ContentSHA256 != quinnVaultContentSHA ||
		pages.RawByteSize != quinnVaultRawBytes ||
		pages.SkillKey != "E" || pages.ZhDisplayName != "旋翔掠杀" || pages.OwnerID != "hero_quinn" {
		t.Fatalf("pages identity must agree with sidecar canonical fields; got %+v", pages)
	}

	raw, err := os.ReadFile(quinnVaultWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) != quinnVaultLocalRawBytes {
		t.Fatalf("local raw len=%d want %d (known materialization)", len(raw), quinnVaultLocalRawBytes)
	}
	localSHA := quinnVaultSHA256Hex(raw)
	if localSHA != quinnVaultLocalRawSHA {
		t.Fatalf("local raw sha=%q want known materialization %q", localSHA, quinnVaultLocalRawSHA)
	}
	if localSHA == quinnVaultContentSHA {
		t.Fatal("local raw hash must not equal canonical contentSha256 (materialization caveat; not source contradiction)")
	}
	if quinnVaultBoundary != "rank5_primary_champion_single_hit; immediate_impact_scaffold; "+
		"physical_140_plus_0_20_bonus_ad; "+
		"no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_"+
		"basic_attack_reset_auto_attack_or_other_ranks" {
		t.Fatal("frozen boundary constant drifted")
	}
	if quinnVaultPlanRev != "quinn-e-vault-phase-a-v1" {
		t.Fatal("frozen plan-rev constant drifted")
	}
}

// TestGenericQuinnVaultBackendSeedAndREADMEIdentity locks Backend seed /
// JUnit / README contract after that separate run has materialized it.
func TestGenericQuinnVaultBackendSeedAndREADMEIdentity(t *testing.T) {
	seed, sqlNoComments := quinnVaultLoadSeedSQL(t)
	_ = quinnVaultJUnitPath(t)
	readmeBytes, err := os.ReadFile(quinnVaultREADMEPath(t))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)
	junitBytes, err := os.ReadFile(quinnVaultJUnitPath(t))
	if err != nil {
		t.Fatal(err)
	}
	junit := string(junitBytes)

	for _, want := range []string{
		quinnVaultCandidateKey,
		quinnVaultTaskKey,
		quinnVaultPlanRev,
		quinnVaultRequestTitle,
		quinnVaultResolvedTitle,
		"1308957",
		"4024768",
		quinnVaultTimestamp,
		quinnVaultContentSHA,
		quinnVaultLocalRawSHA,
		"2649",
		quinnVaultBoundary,
		quinnVaultProviderRef,
		quinnVaultAbilityID,
		quinnVaultAbilityKey,
		"vault_damage",
		"e_mana_cost",
		"e_cooldown_ms",
		`{"op":"const","value":50}`,
		`{"op":"const","value":8000}`,
		quinnVaultSeedDamageJSON,
		"NB-ZERO-EMITTED-EVENTS-SCOPE",
		"NB-MANA-RESOURCE-SEED-ORDER",
		"local raw materialization caveat",
		"normalized/generic/quinn-e.json",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	if !strings.Contains(seed, "W → Q(resource) → E") &&
		!strings.Contains(seed, "W -> Q(resource) -> E") {
		t.Fatal("seed must document W -> Q(resource) -> E order")
	}
	for _, tag := range quinnVaultOrderedTags() {
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
	for _, tag := range quinnVaultOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.ability_definitions",
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.entity_provider_mounts",
		"phase_hero_quinn_e_vault_primary_hit_impact",
		"sequence_hero_quinn_e_vault_primary_hit_impact",
		"step_hero_quinn_e_vault_primary_hit_damage",
	} {
		if !strings.Contains(sqlNoComments, needle) {
			t.Fatalf("executable seed missing %q", needle)
		}
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.provider_definitions") != 1 {
		t.Fatal("seed must define exactly one provider")
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.ability_phases") != 1 {
		t.Fatal("seed must define exactly one ability phase")
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.damage_effect_details") != 1 {
		t.Fatal("seed must define exactly one damage_effect_details")
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.entity_provider_mounts") != 1 {
		t.Fatal("seed must mount exactly one E provider")
	}

	if !regexp.MustCompile(`(?s)'ability_hero_quinn_e_vault_primary_hit'\s*,\s*` +
		`'provider_hero_quinn_e_vault_primary_hit'\s*,\s*` +
		`'vault_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("E must be active ability with stable key vault_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_quinn_e_vault_primary_hit_damage'\s*,\s*` +
		`'vault_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be physical 20220 add policy copyable_on_hit=false")
	}
	if !strings.Contains(sqlNoComments, quinnVaultSeedDamageJSON) {
		t.Fatal("seed formula must use binary add(const140, mul(0.20, sub(ad)))")
	}
	if strings.Contains(sqlNoComments, `"op":"add","args":[{"op":"const","value":140},{"op":"mul"`) &&
		strings.Contains(sqlNoComments, `"op":"add","args":[{"op":"add"`) {
		t.Fatal("E seed must not use nested three-term add; formula is binary add only")
	}

	for _, preserved := range []string{
		quinnVaultBasicAttackProviderAlias,
		quinnVaultHSProviderAlias,
		"lol_generic_quinn_heightened_senses_seed.sql",
		"lol_generic_quinn_blinding_assault_primary_hit_seed.sql",
	} {
		if !strings.Contains(seed, preserved) {
			t.Fatalf("seed must document coexistence / prerequisite for %q", preserved)
		}
	}
	if regexp.MustCompile(`(?is)'provider_hero_quinn_basic_attack'`).MatchString(sqlNoComments) &&
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_definitions[\s\S]*'provider_hero_quinn_basic_attack'`).MatchString(sqlNoComments) {
		t.Fatal("must not write/replace basic-attack provider identity rows")
	}
	if regexp.MustCompile(`(?is)'provider_hero_quinn_heightened_senses'`).MatchString(sqlNoComments) &&
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_definitions[\s\S]*'provider_hero_quinn_heightened_senses'`).MatchString(sqlNoComments) {
		t.Fatal("must not write/replace Heightened Senses provider identity rows")
	}
	if regexp.MustCompile(`(?is)'provider_hero_quinn_q_blinding_assault_primary_hit'`).MatchString(sqlNoComments) &&
		regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_definitions[\s\S]*'provider_hero_quinn_q_blinding_assault_primary_hit'`).MatchString(sqlNoComments) {
		t.Fatal("must not write/replace Blinding Assault provider identity rows")
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
	if regexp.MustCompile(`(?i)emit_event|basic_attack_hit`).MatchString(sqlNoComments) {
		t.Fatal("executable seed must not model emit_event / basic_attack_hit")
	}

	for _, want := range []string{
		quinnVaultCandidateKey,
		quinnVaultTaskKey,
		quinnVaultPlanRev,
		"lol_generic_quinn_vault_primary_hit_seed.sql",
		"LolGenericQuinnVaultPrimaryHitSeedSqlTest",
		"lol_generic_quinn_heightened_senses_seed.sql",
		"lol_generic_quinn_blinding_assault_primary_hit_seed.sql",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "physical_140_plus_0_20_bonus_ad") &&
		!strings.Contains(readme, quinnVaultBoundary) {
		t.Fatal("README must include frozen boundary")
	}
	if !strings.Contains(readme, "W → Q(resource) → E") &&
		!strings.Contains(readme, "W -> Q(resource) -> E") {
		t.Fatal("README must document W -> Q(resource) -> E order")
	}
	wIdx := strings.Index(readme, "lol_generic_quinn_heightened_senses_seed.sql")
	qIdx := strings.Index(readme, "lol_generic_quinn_blinding_assault_primary_hit_seed.sql")
	eIdx := strings.Index(readme, "lol_generic_quinn_vault_primary_hit_seed.sql")
	if !(wIdx >= 0 && qIdx > wIdx && eIdx > qIdx) {
		t.Fatal("README registration order must be W -> Q(resource) -> E")
	}
	for _, want := range []string{
		quinnVaultCandidateKey,
		quinnVaultTaskKey,
		quinnVaultPlanRev,
		"NB-MANA-RESOURCE-SEED-ORDER",
		"LolGenericQuinnVaultPrimaryHitSeedSqlTest",
		`\"op\":\"add\"`,
		`\"value\":140`,
		`\"value\":0.20`,
		`source.attr.ad.resolved`,
		`source.attr.ad.base`,
	} {
		if !strings.Contains(junit, want) {
			t.Fatalf("JUnit missing %q", want)
		}
	}
}

// TestGenericQuinnVaultCompileShapeImmediateScaffold asserts independent E
// provider cardinality, binary formula, cost/CD, zero states/listeners/emit.
func TestGenericQuinnVaultCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadQuinnVaultFixture(t, quinnVaultFixtureOpts{
		resolvedAD: quinnVaultADResolvedDefault, mana: quinnVaultFixtureManaCD,
	})
	assertQuinnVaultProviderShape(t, compileReq, 1, true)
	if quinnVaultAbilityKey == quinnHSHitAbilityKey || quinnVaultAbilityKey == quinnHSProbeKey ||
		quinnVaultAbilityKey == quinnBAAbilityKey || quinnVaultAbilityKey == "basic_attack" {
		t.Fatal("vault must not reuse W / Q / basic ability keys")
	}
	if quinnVaultAbilityID != "ability_hero_quinn_e_vault_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if quinnVaultStableID != "hero_quinn_e_vault_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
}

// TestGenericQuinnVaultFormulaBranchTable: base/resolved AD59→140 mit70;
// resolved139→156 mit78; armor100; exactly one successful E damage each.
func TestGenericQuinnVaultFormulaBranchTable(t *testing.T) {
	cases := []struct {
		name             string
		resolvedAD       float64
		wantRaw, wantMit float64
	}{
		{"ad59", 59, 140, 70},
		{"ad139", 139, 156, 78},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := quinnVaultExpectedRawFromStats(tc.resolvedAD, quinnVaultADBase)
			if math.Abs(rawX-tc.wantRaw) > quinnVaultTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, quinnVaultTargetArmor)
			if math.Abs(mitX-tc.wantMit) > quinnVaultTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMit)
			}

			compileReq, runReq := loadQuinnVaultFixture(t, quinnVaultFixtureOpts{
				resolvedAD: tc.resolvedAD, mana: quinnVaultFixtureManaCD,
			})
			assertQuinnVaultProviderShape(t, compileReq, 1, tc.resolvedAD != quinnVaultADBase)
			ref := quinnVaultAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runQuinnVault(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := quinnVaultDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("E damage evidence=%d want 1", len(dmg))
			}
			quinnVaultAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMit)
			if evidenceDataString(dmg[0].Data, "providerRef") != quinnVaultProviderRef {
				t.Fatalf("providerRef=%q", evidenceDataString(dmg[0].Data, "providerRef"))
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > quinnVaultTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(quinnVaultSourceAttrBase(t, done.FinalSnapshot, "ad")-quinnVaultADBase) > quinnVaultTol {
				t.Fatalf("ad.base=%v want %v", quinnVaultSourceAttrBase(t, done.FinalSnapshot, "ad"), quinnVaultADBase)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
		})
	}
}

// TestGenericQuinnVaultCooldownScheduleMana150: t0/t7999/t8000 from mana150;
// successes at 0/8000; exact cooldown_not_ready at 7999; final mana50; two damage
// evidences; final HP reflects two mitigated 78 hits.
func TestGenericQuinnVaultCooldownScheduleMana150(t *testing.T) {
	compileReq, runReq := loadQuinnVaultFixture(t, quinnVaultFixtureOpts{
		resolvedAD: quinnVaultADResolvedDefault, mana: quinnVaultFixtureManaCD,
	})
	assertQuinnVaultProviderShape(t, compileReq, 1, true)
	ref := quinnVaultAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
	}
	runReq.StopPolicy.DurationMs = 8100
	done := runQuinnVault(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if quinnVaultSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findQuinnVaultAbilityStat(t, done)
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

	items := quinnVaultDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("E damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 8000}
	wantMit := quinnVaultExpectedMitDefault
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		quinnVaultAssertDamage(t, item, quinnVaultExpectedRawDefault, wantMit)
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q", i, evidenceDataString(item.Data, "abilityRef"))
		}
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * wantMit
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	wantHP := quinnVaultTargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}
	gotMana := quinnVaultSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-quinnVaultManaAfter2) > quinnVaultTol {
		t.Fatalf("mana=%v want %v", gotMana, quinnVaultManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
}

// TestGenericQuinnVaultResourceInsufficientMana49: mana49 at t0 →
// resource_insufficient; mana/HP unchanged; zero E damage.
func TestGenericQuinnVaultResourceInsufficientMana49(t *testing.T) {
	compileReq, runReq := loadQuinnVaultFixture(t, quinnVaultFixtureOpts{
		resolvedAD: quinnVaultADResolvedDefault, mana: quinnVaultFixtureManaShort,
	})
	ref := quinnVaultAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnVault(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if quinnVaultSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(quinnVaultSourceMana(t, done.FinalSnapshot)-quinnVaultFixtureManaShort) > quinnVaultTol {
		t.Fatalf("mana changed: got %v want %v",
			quinnVaultSourceMana(t, done.FinalSnapshot), quinnVaultFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-quinnVaultTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, quinnVaultTargetHP)
	}
	if len(quinnVaultDamageEvidence(done)) != 0 {
		t.Fatal("want zero E damage evidence")
	}
	if len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero damage evidence total")
	}
}

// TestGenericQuinnVaultCoexistenceWithHeightenedSensesAndBlindingAssault: E beside
// current Quinn W Heightened Senses/basic listener and Q Blinding Assault; E must
// produce no basic_attack_hit, must not set heightened_senses_active, must not
// change source attack speed, and must leave Q/W ability definitions unaffected.
// Runtime synthetic ability_started is allowed (NB-ZERO-EMITTED-EVENTS-SCOPE).
func TestGenericQuinnVaultCoexistenceWithHeightenedSensesAndBlindingAssault(t *testing.T) {
	compileReq, runReq := loadQuinnVaultFixture(t, quinnVaultFixtureOpts{
		resolvedAD: quinnVaultADResolvedDefault, mana: quinnVaultFixtureManaCD,
		withHS: true, withQ: true, vulnerable: 1,
	})
	assertQuinnVaultProviderShape(t, compileReq, 3, true)

	var hs, q *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		switch compileReq.SharedProviders[i].ProviderKey {
		case quinnHSProviderRef:
			hs = &compileReq.SharedProviders[i]
		case quinnBAProviderRef:
			q = &compileReq.SharedProviders[i]
		}
	}
	if hs == nil || len(hs.Listeners) == 0 {
		t.Fatal("Heightened Senses provider/listener must be mounted for coexistence")
	}
	if q == nil || len(q.Abilities) != 1 || q.Abilities[0].AbilityKey != quinnBAAbilityKey {
		t.Fatal("Blinding Assault provider/ability must be mounted unchanged for coexistence")
	}
	if len(q.Listeners) != 0 || len(q.InitialStateSchema) != 0 {
		t.Fatal("Q definition must remain zero-listener / zero-state beside E")
	}
	if hs.Abilities[0].AbilityKey != quinnHSHitAbilityKey {
		t.Fatalf("W basic ability key drifted: %q", hs.Abilities[0].AbilityKey)
	}

	ref := quinnVaultAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnVault(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(quinnVaultDamageEvidence(done)) != 1 {
		t.Fatalf("E damage=%d want 1", len(quinnVaultDamageEvidence(done)))
	}
	// NB-ZERO-EMITTED-EVENTS-SCOPE: do not assert global emitted-event count == 0.
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("E cast must not produce event/basic_attack_hit")
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); math.Abs(got) > quinnVaultTol {
		t.Fatalf("heightened_senses_active=%v want 0 (W must remain unarmed)", got)
	}
	as := quinnHSSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(as.Resolved-quinnHSBaseAS) > quinnVaultTol || math.Abs(as.Base-quinnHSBaseAS) > quinnVaultTol {
		t.Fatalf("attack_speed base/resolved=%v/%v want unchanged %v", as.Base, as.Resolved, quinnHSBaseAS)
	}
	if len(quinnBADamageEvidence(done)) != 0 {
		t.Fatal("E cast must not produce Q Blinding Assault damage evidence")
	}
}

// TestGenericQuinnVaultDeterminismAndRelease: repeat CompileGeneric/RunGeneric
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame; zero
// excluded graph behavior (no basic_attack_hit / no Q damage / single E hit).
func TestGenericQuinnVaultDeterminismAndRelease(t *testing.T) {
	runOnce := func() (string, string, string) {
		c, r := loadQuinnVaultFixture(t, quinnVaultFixtureOpts{
			resolvedAD: quinnVaultADResolvedDefault, mana: quinnVaultFixtureManaCD,
		})
		ref := quinnVaultAbilityRef()
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
			{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
		}
		r.StopPolicy.DurationMs = 8100
		done := runQuinnVault(t, c, r)
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

	c, r := loadQuinnVaultFixture(t, quinnVaultFixtureOpts{
		resolvedAD: quinnVaultADResolvedDefault, mana: quinnVaultFixtureManaCD,
	})
	assertQuinnVaultProviderShape(t, c, 1, true)
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: quinnVaultAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	r.StopPolicy.DurationMs = 50
	bundle := runQuinnVaultFrames(t, c, r)
	if len(quinnVaultDamageEvidence(bundle.done)) != 1 {
		t.Fatalf("frame-path E damage=%d want 1", len(quinnVaultDamageEvidence(bundle.done)))
	}
	if countEmittedEvents(bundle.done, "event/basic_attack_hit") != 0 {
		t.Fatal("frame-path must not emit basic_attack_hit")
	}
	if len(damageEvidenceItems(bundle.done)) != 1 {
		t.Fatal("frame-path must not produce excluded extra damage graph behavior")
	}
}
