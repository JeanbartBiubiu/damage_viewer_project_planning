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

// hero_quinn Q Blinding Assault / 炫目攻势 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: quinn-q-blinding-assault-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_champion_single_hit; immediate_impact_scaffold;
//	physical_205_plus_1_00_bonus_ad_plus_0_50_ap;
//	no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_quinn|Q|炫目攻势
//	task wasm-generic-quinn-blinding-assault-primary-hit
//	Request Template:Data Quinn/Q → resolved Template:Data Quinn/Blinding Assault
//	wikiPageId 1308954 / rev 4024766 / timestamp 2026-06-03T00:49:42Z
//	canonical rawByteSize 1742 / SHA256
//	  abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d
//	数据参考/lol-wiki-current-champions/normalized/generic/quinn-q.json
//	pages/raw siblings: pages/quinn-q.json, raw/quinn-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_quinn_blinding_assault_primary_hit_seed.sql
//	Local raw materialization caveat (same length, different SHA): 1742 bytes /
//	  SHA256 be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd.
//	Assert both identities/caveat; do not claim equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_quinn_q_blinding_assault_primary_hit
//     (not Heightened Senses / basic-attack reuse)
//   - ability ability_hero_quinn_q_blinding_assault_primary_hit with ability_key
//     blinding_assault_primary_hit: active; mana 70; cooldown 9000 ms
//   - Exactly one immediate direct-target physical damage op:
//     add(add(205, mul(1.00, sub(ad.resolved, ad.base))), mul(0.50, ap.resolved))
//     (never three-argument add)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No provider states / listeners / explicit emit_event / repeat / control
//     (fixture-only flat AD modifier is harness-only for bonus-AD resolved)
//
// Accepted note NB-ZERO-EMITTED-EVENTS-SCOPE: do not assert global emitted-event
// count is zero if runtime synthesizes event/ability_started. Assert no explicit
// Q emit_event op and specifically zero event/basic_attack_hit; W must remain
// unarmed.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, ap_ratio,
// bonus_ad_ratio, immediate_impact_scaffold.

const (
	quinnBACandidateKey  = "hero_skill|hero_quinn|Q|炫目攻势"
	quinnBATaskKey       = "wasm-generic-quinn-blinding-assault-primary-hit"
	quinnBAPlanRev       = "quinn-q-blinding-assault-phase-a-v1"
	quinnBARequestTitle  = "Template:Data Quinn/Q"
	quinnBAResolvedTitle = "Template:Data Quinn/Blinding Assault"
	quinnBAWikiPageID    = 1308954
	quinnBARevisionID    = 4024766
	quinnBATimestamp     = "2026-06-03T00:49:42Z"
	quinnBARawBytes      = 1742
	quinnBALocalRawBytes = 1742
	quinnBAContentSHA    = "abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d"
	quinnBALocalRawSHA   = "be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd"
	quinnBABoundary      = "rank5_primary_champion_single_hit; immediate_impact_scaffold; " +
		"physical_205_plus_1_00_bonus_ad_plus_0_50_ap; " +
		"no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_" +
		"harrier_mark_nearsight_disarm_or_other_ranks"

	quinnBAProviderRef = "provider_hero_quinn_q_blinding_assault_primary_hit"
	quinnBAStableID    = "hero_quinn_q_blinding_assault_primary_hit"
	quinnBAAbilityID   = "ability_hero_quinn_q_blinding_assault_primary_hit"
	quinnBAAbilityKey  = "blinding_assault_primary_hit"
	quinnBADamageOpRef = "op:quinn_blinding_assault_primary_hit_damage"
	quinnBABonusADMod  = "fixture_quinn_blinding_assault_primary_hit_bonus_ad"

	quinnBABasicAttackProviderAlias = "provider_hero_quinn_basic_attack"
	quinnBAHSProviderAlias          = "provider_hero_quinn_heightened_senses"

	quinnBABaseDamage   = 205.0
	quinnBABonusADRatio = 1.00
	quinnBAAPRatio      = 0.50
	quinnBAManaCost     = 70.0
	quinnBACDMs         = 9000.0

	quinnBAADBase             = 59.0
	quinnBAADResolvedDefault  = 139.0 // fixture flat +80
	quinnBAAPDefault          = 100.0
	quinnBAFixtureManaCD      = 210.0
	quinnBAFixtureManaShort   = 69.0
	quinnBATargetArmor        = 100.0
	quinnBATargetHP           = 100000.0
	quinnBAExpectedRawDefault = 335.0 // 205 + 80 + 50
	quinnBAExpectedMitDefault = 167.5
	quinnBAManaAfter2         = 70.0 // 210 - 70 - 70

	quinnBASeedDamageJSON = `{"op":"add","args":[{"op":"add","args":[{"op":"const","value":205},` +
		`{"op":"mul","args":[{"op":"const","value":1.00},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},` +
		`{"op":"read","path":"source.attr.ad.base"}]}]}]},` +
		`{"op":"mul","args":[{"op":"const","value":0.50},` +
		`{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	quinnBATol = 1e-9
)

func quinnBAOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"ap_ratio",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func quinnBAExpectedRawFromStats(resolvedAD, baseAD, resolvedAP float64) float64 {
	return quinnBABaseDamage +
		quinnBABonusADRatio*(resolvedAD-baseAD) +
		quinnBAAPRatio*resolvedAP
}

func quinnBADamageAmount() *model.GenericFormulaExpr {
	base := quinnBABaseDamage
	adRatio := quinnBABonusADRatio
	apRatio := quinnBAAPRatio
	// Nested binary add only — never three-argument add.
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

func quinnBAAbility() model.AbilityDefinition {
	cost := quinnBAManaCost
	cd := quinnBACDMs
	return model.AbilityDefinition{
		AbilityKey: quinnBAAbilityKey,
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
				Ref:           quinnBADamageOpRef,
				Amount:        quinnBADamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func quinnBAProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: quinnBAProviderRef,
		Kind:        "champion",
		StableID:    quinnBAStableID,
		Abilities:   []model.AbilityDefinition{quinnBAAbility()},
	}
	// Fixture-only flat AD so ad.base stays 59 while ad.resolved can rise.
	// Production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: quinnBABonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func quinnBAAbilityRef() string {
	return "source.provider[" + quinnBAProviderRef + "].ability[" + quinnBAAbilityKey + "]"
}

func quinnBAHSProviderDef() model.ProviderDefinition {
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

type quinnBAFixtureOpts struct {
	resolvedAD float64
	ap         float64
	mana       float64
	withHS     bool
	vulnerable float64
}

func configureQuinnBAProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts quinnBAFixtureOpts) {
	bonusAD := opts.resolvedAD - quinnBAADBase
	q := quinnBAProviderDef(bonusAD)
	if opts.withHS {
		compileReq.SharedProviders = []model.ProviderDefinition{q, quinnBAHSProviderDef()}
		compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
			{ProviderRef: quinnBAProviderRef, DefinitionRef: quinnBAProviderRef},
			{ProviderRef: quinnHSProviderRef, DefinitionRef: quinnHSProviderRef},
		}
		snapProviders := []model.CombatantProviderSnapshot{
			{ProviderRef: quinnBAProviderRef, DefinitionRef: quinnBAProviderRef, Stacks: 1, State: map[string]interface{}{}},
			{ProviderRef: quinnHSProviderRef, DefinitionRef: quinnHSProviderRef, Stacks: 1, State: map[string]interface{}{}},
		}
		for i := range runReq.InitialSnapshot.Combatants {
			if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
				continue
			}
			runReq.InitialSnapshot.Combatants[i].Providers = snapProviders
		}
		if opts.vulnerable != 0 {
			seedQuinnHarrierVulnerable(runReq, model.SelectorTarget, opts.vulnerable)
		}
		return
	}
	compileReq.SharedProviders = []model.ProviderDefinition{q}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: quinnBAProviderRef, DefinitionRef: quinnBAProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: quinnBAProviderRef, DefinitionRef: quinnBAProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureQuinnBATypes(req *model.CompileRequest) {
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

func loadQuinnBAFixture(t *testing.T, opts quinnBAFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.resolvedAD == 0 {
		opts.resolvedAD = quinnBAADResolvedDefault
	}
	if opts.mana == 0 {
		opts.mana = quinnBAFixtureManaCD
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureQuinnBATypes(&compileReq)
	if opts.withHS {
		ensureQuinnHSTypes(&compileReq)
	}
	configureQuinnBAProviders(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: quinnBAADBase, Current: quinnBAADBase,
		Max: quinnBAADBase, Resolved: quinnBAADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.ap, Current: opts.ap, Max: opts.ap, Resolved: opts.ap,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, quinnBAFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: quinnBATargetHP, Current: quinnBATargetHP,
		Max: quinnBATargetHP, Resolved: quinnBATargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: quinnBATargetArmor, Current: quinnBATargetArmor,
		Max: quinnBATargetArmor, Resolved: quinnBATargetArmor,
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

func runQuinnBA(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

type quinnBARunBundle struct {
	done      model.DoneResult
	sessionID string
	rulesHash string
}

func runQuinnBAFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) quinnBARunBundle {
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
	return quinnBARunBundle{done: done, sessionID: compiled.SessionID, rulesHash: compiled.RulesHash}
}

func quinnBASourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func quinnBASourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func quinnBASkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func quinnBADamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != quinnBADamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func quinnBAFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == quinnBAProviderRef {
			return p
		}
	}
	return nil
}

func assertQuinnBAProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := quinnBAFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_quinn_q_blinding_assault_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != quinnBAProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, quinnBAProviderRef)
	}
	if p.StableID != quinnBAStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, quinnBAStableID)
	}
	if p.ProviderKey == quinnBABasicAttackProviderAlias || p.StableID == quinnBABasicAttackProviderAlias ||
		p.ProviderKey == quinnBAHSProviderAlias || p.StableID == quinnBAHSProviderAlias ||
		p.ProviderKey == quinnHSProviderRef || p.StableID == quinnHSStableID {
		t.Fatal("blinding_assault primary-hit must not reuse basic / Heightened Senses provider refs")
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
		if p.Modifiers[0].ModifierKey != quinnBABonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], quinnBABonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), quinnBAAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != quinnBAAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, quinnBAAbilityKey, quinnBAAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("blinding_assault must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-quinnBAManaCost) > quinnBATol {
		t.Fatalf("cost=%+v want mana const 70", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-quinnBACDMs) > quinnBATol {
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
		t.Fatal("blinding_assault damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("blinding_assault damage must not be copyable on hit")
	}
	if op.Ref != quinnBADamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, quinnBADamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested binary add(base+bonusAD, AP)", op.Amount)
	}
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const, mul(1.00, sub(ad.resolved, ad.base)))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-quinnBABaseDamage) > quinnBATol {
		t.Fatalf("base const=%+v want 205", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-quinnBABonusADRatio) > quinnBATol {
		t.Fatalf("bonus-AD ratio=%+v want 1.00", adMul.Args[0])
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
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-quinnBAAPRatio) > quinnBATol {
		t.Fatalf("AP ratio=%+v want 0.50", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	for _, banned := range a.Operations {
		if banned.Operation == "emit_event" || banned.Operation == "slow" ||
			banned.Operation == "stun" || banned.Operation == "nearsight" ||
			banned.Operation == "disarm" || banned.Operation == "projectile" ||
			banned.Operation == "multi_target" || banned.Operation == "state_change" ||
			banned.Operation == "repeat" || banned.Operation == "control" {
			t.Fatalf("blinding_assault must not include emit/control/geometry/state/repeat op: %+v", banned)
		}
	}
}

func findQuinnBAAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := quinnBAAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func quinnBAWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "quinn-q.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnBAWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "quinn-q.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnBAWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "quinn-q.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnBASeedPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"db", "game_manage", "seeds", "lol_generic_quinn_blinding_assault_primary_hit_seed.sql")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("backend seed missing at %s: %v (fail closed; assert after Backend materialization)", path, err)
	}
	return path
}

func quinnBAREADMEPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "server", "data_manage", "README.md")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("README missing at %s: %v", path, err)
	}
	return path
}

type quinnBAWikiSidecar struct {
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
		Cooldown     string `json:"cooldown"`
		Cost         string `json:"cost"`
		Costtype     string `json:"costtype"`
		Damagetype   string `json:"damagetype"`
		Notes        string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

type quinnBAWikiPages struct {
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

func quinnBALoadWikiSidecar(t *testing.T) quinnBAWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(quinnBAWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc quinnBAWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

func quinnBALoadWikiPages(t *testing.T) quinnBAWikiPages {
	t.Helper()
	raw, err := os.ReadFile(quinnBAWikiPagesPath(t))
	if err != nil {
		t.Fatalf("read wiki pages: %v", err)
	}
	var doc quinnBAWikiPages
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki pages: %v", err)
	}
	return doc
}

func quinnBALoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(quinnBASeedPath(t))
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

func quinnBASHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func quinnBAAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > quinnBATol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > quinnBATol {
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

// TestGenericQuinnBlindingAssaultWikiSidecarIdentityAndBoundary locks sidecar/pages
// canonical identity plus local-raw materialization caveat (same length, different SHA).
func TestGenericQuinnBlindingAssaultWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := quinnBALoadWikiSidecar(t)
	if doc.CandidateKey != quinnBACandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, quinnBACandidateKey)
	}
	if doc.RequestTitle != quinnBARequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, quinnBARequestTitle)
	}
	if doc.ResolvedTitle != quinnBAResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, quinnBAResolvedTitle)
	}
	if doc.WikiPageID != quinnBAWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, quinnBAWikiPageID)
	}
	if doc.RevisionID != quinnBARevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, quinnBARevisionID)
	}
	if doc.RevisionTimestamp != quinnBATimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, quinnBATimestamp)
	}
	if doc.ContentSHA256 != quinnBAContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, quinnBAContentSHA)
	}
	if doc.RawByteSize != quinnBARawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, quinnBARawBytes)
	}
	if doc.SkillKey != "Q" || doc.ZhDisplayName != "炫目攻势" || doc.OwnerID != "hero_quinn" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want Q/炫目攻势/hero_quinn",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{"description", "leveling", "description2", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "{{ap|50 to 70}}\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "{{ap|50 to 70}}\n")
	}
	if doc.Fields.Cooldown != "{{ap|11 to 9}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|11 to 9}}\n")
	}
	if doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("fields.damagetype=%q want Physical", doc.Fields.Damagetype)
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("fields.costtype=%q want Mana", doc.Fields.Costtype)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|65 to 205}}") {
		t.Fatalf("leveling missing rank formula {{ap|65 to 205}}: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|80 to 100}}% '''bonus''' AD") {
		t.Fatalf("leveling missing bonus AD ratio: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "50% AP") {
		t.Fatalf("leveling missing 50%% AP: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "Valor") {
		t.Fatalf("description missing Valor wording (excluded from scaffold): %q", doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description2, "nearsight") || !strings.Contains(doc.Fields.Description2, "disarm") {
		t.Fatalf("description2 missing nearsight/disarm (excluded): %q", doc.Fields.Description2)
	}

	pages := quinnBALoadWikiPages(t)
	if pages.CandidateKey != quinnBACandidateKey ||
		pages.RequestTitle != quinnBARequestTitle ||
		pages.ResolvedTitle != quinnBAResolvedTitle ||
		pages.PageID != quinnBAWikiPageID ||
		pages.RevisionID != quinnBARevisionID ||
		pages.RevisionTimestamp != quinnBATimestamp ||
		pages.ContentSHA256 != quinnBAContentSHA ||
		pages.RawByteSize != quinnBARawBytes ||
		pages.SkillKey != "Q" || pages.ZhDisplayName != "炫目攻势" || pages.OwnerID != "hero_quinn" {
		t.Fatalf("pages identity must agree with sidecar canonical fields; got %+v", pages)
	}

	raw, err := os.ReadFile(quinnBAWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) != quinnBALocalRawBytes {
		t.Fatalf("local raw len=%d want %d (known materialization)", len(raw), quinnBALocalRawBytes)
	}
	localSHA := quinnBASHA256Hex(raw)
	if localSHA != quinnBALocalRawSHA {
		t.Fatalf("local raw sha=%q want known materialization %q", localSHA, quinnBALocalRawSHA)
	}
	if localSHA == quinnBAContentSHA {
		t.Fatal("local raw hash must not equal canonical contentSha256 (materialization caveat; not source contradiction)")
	}
	if quinnBABoundary != "rank5_primary_champion_single_hit; immediate_impact_scaffold; "+
		"physical_205_plus_1_00_bonus_ad_plus_0_50_ap; "+
		"no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_"+
		"harrier_mark_nearsight_disarm_or_other_ranks" {
		t.Fatal("frozen boundary constant drifted")
	}
	if quinnBAPlanRev != "quinn-q-blinding-assault-phase-a-v1" {
		t.Fatal("frozen plan-rev constant drifted")
	}
}

// TestGenericQuinnBlindingAssaultBackendSeedAndREADMEIdentity locks Backend seed /
// README contract after that separate run has materialized it.
func TestGenericQuinnBlindingAssaultBackendSeedAndREADMEIdentity(t *testing.T) {
	seed, sqlNoComments := quinnBALoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(quinnBAREADMEPath(t))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		quinnBACandidateKey,
		quinnBATaskKey,
		quinnBAPlanRev,
		quinnBARequestTitle,
		quinnBAResolvedTitle,
		"1308954",
		"4024766",
		quinnBATimestamp,
		quinnBAContentSHA,
		quinnBALocalRawSHA,
		"1742",
		quinnBABoundary,
		quinnBAProviderRef,
		quinnBAAbilityID,
		quinnBAAbilityKey,
		"blinding_assault_damage",
		"q_mana_cost",
		"q_cooldown_ms",
		`{"op":"const","value":70}`,
		`{"op":"const","value":9000}`,
		quinnBASeedDamageJSON,
		"NB-ZERO-EMITTED-EVENTS-SCOPE",
		"local raw materialization caveat",
		"normalized/generic/quinn-q.json",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range quinnBAOrderedTags() {
		if !strings.Contains(seed, tag) {
			t.Fatalf("seed missing ordered tag %q", tag)
		}
	}
	// Order is asserted inside the dedicated "Ordered tags" block (boundary also
	// embeds immediate_impact_scaffold earlier).
	ordIdx := strings.Index(seed, "Ordered tags")
	if ordIdx < 0 {
		t.Fatal("seed missing Ordered tags section")
	}
	ordSection := seed[ordIdx:]
	if end := strings.Index(ordSection, "契约要点"); end > 0 {
		ordSection = ordSection[:end]
	}
	prev := -1
	for _, tag := range quinnBAOrderedTags() {
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
		"phase_hero_quinn_q_blinding_assault_primary_hit_impact",
		"sequence_hero_quinn_q_blinding_assault_primary_hit_impact",
		"step_hero_quinn_q_blinding_assault_primary_hit_damage",
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
		t.Fatal("seed must mount exactly one Q provider")
	}

	if !regexp.MustCompile(`(?s)'ability_hero_quinn_q_blinding_assault_primary_hit'\s*,\s*` +
		`'provider_hero_quinn_q_blinding_assault_primary_hit'\s*,\s*` +
		`'blinding_assault_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key blinding_assault_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_quinn_q_blinding_assault_primary_hit_damage'\s*,\s*` +
		`'blinding_assault_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be physical 20220 add policy copyable_on_hit=false")
	}
	if !strings.Contains(sqlNoComments, `"op":"add","args":[{"op":"add"`) {
		t.Fatal("seed formula must use nested binary add (not three-arg add)")
	}
	if strings.Contains(sqlNoComments, `"op":"add","args":[{"op":"const","value":205},{"op":"mul"`) &&
		!strings.Contains(sqlNoComments, `"op":"add","args":[{"op":"add"`) {
		t.Fatal("seed must not use legacy three-argument add for damage")
	}

	for _, preserved := range []string{
		quinnBABasicAttackProviderAlias,
		quinnBAHSProviderAlias,
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
		quinnBACandidateKey,
		quinnBATaskKey,
		quinnBAPlanRev,
		"lol_generic_quinn_blinding_assault_primary_hit_seed.sql",
		"LolGenericQuinnBlindingAssaultPrimaryHitSeedSqlTest",
		"lol_generic_quinn_heightened_senses_seed.sql",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "physical_205_plus_1_00_bonus_ad_plus_0_50_ap") &&
		!strings.Contains(readme, quinnBABoundary) {
		t.Fatal("README must include frozen boundary")
	}
}

// TestGenericQuinnBlindingAssaultCompileShapeImmediateScaffold asserts independent Q
// provider cardinality, nested binary formula, cost/CD, zero states/listeners/emit.
func TestGenericQuinnBlindingAssaultCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadQuinnBAFixture(t, quinnBAFixtureOpts{
		resolvedAD: quinnBAADResolvedDefault, ap: quinnBAAPDefault, mana: quinnBAFixtureManaCD,
	})
	assertQuinnBAProviderShape(t, compileReq, 1, true)
	if quinnBAAbilityKey == quinnHSHitAbilityKey || quinnBAAbilityKey == quinnHSProbeKey ||
		quinnBAAbilityKey == "basic_attack" {
		t.Fatal("blinding_assault must not reuse W / basic ability keys")
	}
	if quinnBAAbilityID != "ability_hero_quinn_q_blinding_assault_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if quinnBAStableID != "hero_quinn_q_blinding_assault_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
}

// TestGenericQuinnBlindingAssaultFormulaBranchTable: base/resolved AD59+AP0→205;
// resolved139/AP0→285; resolved59/AP100→255; resolved139/AP100→335; armor100
// mitigated 102.5/142.5/127.5/167.5; exactly one successful Q damage each.
func TestGenericQuinnBlindingAssaultFormulaBranchTable(t *testing.T) {
	cases := []struct {
		name             string
		resolvedAD, ap   float64
		wantRaw, wantMit float64
	}{
		{"ad59_ap0", 59, 0, 205, 102.5},
		{"ad139_ap0", 139, 0, 285, 142.5},
		{"ad59_ap100", 59, 100, 255, 127.5},
		{"ad139_ap100", 139, 100, 335, 167.5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := quinnBAExpectedRawFromStats(tc.resolvedAD, quinnBAADBase, tc.ap)
			if math.Abs(rawX-tc.wantRaw) > quinnBATol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, quinnBATargetArmor)
			if math.Abs(mitX-tc.wantMit) > quinnBATol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMit)
			}

			compileReq, runReq := loadQuinnBAFixture(t, quinnBAFixtureOpts{
				resolvedAD: tc.resolvedAD, ap: tc.ap, mana: quinnBAFixtureManaCD,
			})
			assertQuinnBAProviderShape(t, compileReq, 1, tc.resolvedAD != quinnBAADBase)
			ref := quinnBAAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runQuinnBA(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := quinnBADamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			quinnBAAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMit)
			if evidenceDataString(dmg[0].Data, "providerRef") != quinnBAProviderRef {
				t.Fatalf("providerRef=%q", evidenceDataString(dmg[0].Data, "providerRef"))
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > quinnBATol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(quinnBASourceAttrBase(t, done.FinalSnapshot, "ad")-quinnBAADBase) > quinnBATol {
				t.Fatalf("ad.base=%v want %v", quinnBASourceAttrBase(t, done.FinalSnapshot, "ad"), quinnBAADBase)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
		})
	}
}

// TestGenericQuinnBlindingAssaultCooldownScheduleMana210: t0/t8999/t9000 from mana210;
// successes at 0/9000; exact cooldown_not_ready at 8999; final mana70; two damage
// evidences; final HP reflects two mitigated 167.5 hits.
func TestGenericQuinnBlindingAssaultCooldownScheduleMana210(t *testing.T) {
	compileReq, runReq := loadQuinnBAFixture(t, quinnBAFixtureOpts{
		resolvedAD: quinnBAADResolvedDefault, ap: quinnBAAPDefault, mana: quinnBAFixtureManaCD,
	})
	assertQuinnBAProviderShape(t, compileReq, 1, true)
	ref := quinnBAAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9000},
	}
	runReq.StopPolicy.DurationMs = 9100
	done := runQuinnBA(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if quinnBASkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findQuinnBAAbilityStat(t, done)
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

	items := quinnBADamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 9000}
	wantMit := quinnBAExpectedMitDefault
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		quinnBAAssertDamage(t, item, quinnBAExpectedRawDefault, wantMit)
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
	wantHP := quinnBATargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}
	gotMana := quinnBASourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-quinnBAManaAfter2) > quinnBATol {
		t.Fatalf("mana=%v want %v", gotMana, quinnBAManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
}

// TestGenericQuinnBlindingAssaultResourceInsufficientMana69: mana69 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage.
func TestGenericQuinnBlindingAssaultResourceInsufficientMana69(t *testing.T) {
	compileReq, runReq := loadQuinnBAFixture(t, quinnBAFixtureOpts{
		resolvedAD: quinnBAADResolvedDefault, ap: quinnBAAPDefault, mana: quinnBAFixtureManaShort,
	})
	ref := quinnBAAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnBA(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if quinnBASkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(quinnBASourceMana(t, done.FinalSnapshot)-quinnBAFixtureManaShort) > quinnBATol {
		t.Fatalf("mana changed: got %v want %v",
			quinnBASourceMana(t, done.FinalSnapshot), quinnBAFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-quinnBATargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, quinnBATargetHP)
	}
	if len(quinnBADamageEvidence(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero damage evidence total")
	}
}

// TestGenericQuinnBlindingAssaultCoexistenceWithHeightenedSenses: Q beside current
// Quinn W Heightened Senses/basic listener; Q must produce no basic_attack_hit,
// must not set heightened_senses_active, and must not change source attack speed.
// Does not modify the W test or production code (composition only).
func TestGenericQuinnBlindingAssaultCoexistenceWithHeightenedSenses(t *testing.T) {
	compileReq, runReq := loadQuinnBAFixture(t, quinnBAFixtureOpts{
		resolvedAD: quinnBAADResolvedDefault, ap: quinnBAAPDefault, mana: quinnBAFixtureManaCD,
		withHS: true, vulnerable: 1,
	})
	assertQuinnBAProviderShape(t, compileReq, 2, true)
	// W provider must remain present and armed for basic_attack_hit only.
	var hs *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == quinnHSProviderRef {
			hs = &compileReq.SharedProviders[i]
		}
	}
	if hs == nil || len(hs.Listeners) == 0 {
		t.Fatal("Heightened Senses provider/listener must be mounted for coexistence")
	}

	ref := quinnBAAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnBA(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(quinnBADamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(quinnBADamageEvidence(done)))
	}
	// NB-ZERO-EMITTED-EVENTS-SCOPE: do not assert global emitted-event count == 0.
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("Q cast must not produce event/basic_attack_hit")
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); math.Abs(got) > quinnBATol {
		t.Fatalf("heightened_senses_active=%v want 0 (W must remain unarmed)", got)
	}
	as := quinnHSSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(as.Resolved-quinnHSBaseAS) > quinnBATol || math.Abs(as.Base-quinnHSBaseAS) > quinnBATol {
		t.Fatalf("attack_speed base/resolved=%v/%v want unchanged %v", as.Base, as.Resolved, quinnHSBaseAS)
	}
}

// TestGenericQuinnBlindingAssaultDeterminismAndRelease: repeat CompileGeneric/RunGeneric
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame.
func TestGenericQuinnBlindingAssaultDeterminismAndRelease(t *testing.T) {
	runOnce := func() (string, string, string) {
		c, r := loadQuinnBAFixture(t, quinnBAFixtureOpts{
			resolvedAD: quinnBAADResolvedDefault, ap: quinnBAAPDefault, mana: quinnBAFixtureManaCD,
		})
		ref := quinnBAAbilityRef()
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8999},
			{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9000},
		}
		r.StopPolicy.DurationMs = 9100
		done := runQuinnBA(t, c, r)
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

	c, r := loadQuinnBAFixture(t, quinnBAFixtureOpts{
		resolvedAD: quinnBAADResolvedDefault, ap: quinnBAAPDefault, mana: quinnBAFixtureManaCD,
	})
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: quinnBAAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	r.StopPolicy.DurationMs = 50
	bundle := runQuinnBAFrames(t, c, r)
	if len(quinnBADamageEvidence(bundle.done)) != 1 {
		t.Fatalf("frame-path Q damage=%d want 1", len(quinnBADamageEvidence(bundle.done)))
	}
	if countEmittedEvents(bundle.done, "event/basic_attack_hit") != 0 {
		t.Fatal("frame-path must not emit basic_attack_hit")
	}
}
