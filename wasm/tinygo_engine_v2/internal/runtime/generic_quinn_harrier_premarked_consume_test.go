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

// hero_quinn P Harrier / 侵扰 — Phase-A v2 Wasm exact pre-marked consume slice
// (FROZEN_PLAN_REV: quinn-p-harrier-premarked-consume-phase-a-v2).
//
// Frozen boundary:
//
//	level18_preexisting_harrier_target_single_basic_attack_consume;
//	bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm;
//	no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_quinn|P|侵扰
//	task wasm-generic-quinn-harrier-premarked-consume
//	Request Template:Data Quinn/I → resolved Template:Data Quinn/Harrier
//	wikiPageId 1308953 / rev 4024765 / timestamp 2026-06-03T00:49:03Z
//	canonical rawByteSize 2390 / SHA256
//	  740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c
//	数据参考/lol-wiki-current-champions/normalized/generic/quinn-p.json
//	pages/raw siblings: pages/quinn-p.json, raw/quinn-p.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_quinn_p_harrier_premarked_consume_seed.sql
//	Local raw materialization caveat (same length, different SHA): 2390 bytes /
//	  SHA256 08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731.
//	Assert both identities/caveat; do not claim equivalence or source contradiction.
//
// Phase-A contract (extends existing Quinn W / basic helpers; same provider/state schema):
//   - Reuse provider hero:quinn / hero_quinn with harrier_vulnerable +
//     heightened_senses_active; append one P listener
//     listener_hero_quinn_p_harrier_premarked_consume
//   - Match owner basic_attack_hit + source_owner; MaxTriggersPerEvent=1
//   - Condition provider.target_state.harrier_vulnerable >= 1 on every step
//   - Ordered ops:
//     1) source/provider state_change override heightened_senses_active=1
//     2) target physical add(120,mul(0.40,sub(ad.resolved,ad.base)));
//        nested binary; CritEligible=false; CopyableOnHit=false; stable P ref
//     3) Target "source", Types ["state_scope/provider_target"], override
//        harrier_vulnerable=0 (never Target target/opponent; Backend 20110+20252)
//   - Existing W listener may also arm; P step1 makes W-before-P and P-before-W
//     equivalent for active=1. Do not assert W AS magnitude (Backend seed 0.40 vs
//     current Wiki Wasm W test 0.80 is pre-existing / out of P scope).
//
// Ordered tags: on_hit, formula_on_hit, bonus_ad_ratio, copyable_on_hit_false,
// provider_target_state_consume.

const (
	quinnHarrierCandidateKey  = "hero_skill|hero_quinn|P|侵扰"
	quinnHarrierTaskKey       = "wasm-generic-quinn-harrier-premarked-consume"
	quinnHarrierPlanRev       = "quinn-p-harrier-premarked-consume-phase-a-v2"
	quinnHarrierRequestTitle  = "Template:Data Quinn/I"
	quinnHarrierResolvedTitle = "Template:Data Quinn/Harrier"
	quinnHarrierWikiPageID    = 1308953
	quinnHarrierRevisionID    = 4024765
	quinnHarrierTimestamp     = "2026-06-03T00:49:03Z"
	quinnHarrierRawBytes      = 2390
	quinnHarrierLocalRawBytes = 2390
	quinnHarrierContentSHA    = "740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c"
	quinnHarrierLocalRawSHA   = "08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731"
	quinnHarrierBoundary      = "level18_preexisting_harrier_target_single_basic_attack_consume; " +
		"bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; " +
		"no_mark_generation_ability_application_duration_reveal_valor_targeting_" +
		"monster_bonus_r_disable_parry_or_other_levels"
	quinnHarrierExclusions = "mark production from Q/E/Skystrike/Valor; 4s mark duration/reveal/overwrite; " +
		"1s cooldown; targeting/visibility/AI; monster75; R disable; parry/negation; " +
		"levels1-17; multiple targets; loadout/crit/Runaan/Guinsoo/phantom replication; " +
		"live/publish/E2E/full fidelity"

	quinnHarrierListenerKey = "listener_hero_quinn_p_harrier_premarked_consume"
	quinnHarrierDamageOpRef = "op:quinn_p_harrier_premarked_consume_bonus"
	quinnHarrierBonusADMod  = "fixture_quinn_harrier_p_bonus_ad"
	quinnHarrierAAOpRef     = "op:aa"

	quinnHarrierBackendProviderAlias = "provider_hero_quinn_heightened_senses"
	quinnHarrierBasicAttackAlias     = "provider_hero_quinn_basic_attack"

	quinnHarrierBaseDamage   = 120.0
	quinnHarrierBonusADRatio = 0.40

	quinnHarrierADBase            = 59.0
	quinnHarrierADResolvedDefault = 139.0 // fixture flat +80
	quinnHarrierTargetArmor       = 100.0
	quinnHarrierTargetHP          = 100000.0
	quinnHarrierExpectedRaw152    = 152.0 // 120 + 0.40*80
	quinnHarrierExpectedMit76     = 76.0
	quinnHarrierExpectedRaw120    = 120.0
	quinnHarrierExpectedMit60     = 60.0

	quinnHarrierSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":120},` +
		`{"op":"mul","args":[{"op":"const","value":0.40},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},` +
		`{"op":"read","path":"source.attr.ad.base"}]}]}]}`

	quinnHarrierTol = 1e-9
)

func quinnHarrierOrderedTags() []string {
	return []string{
		"on_hit",
		"formula_on_hit",
		"bonus_ad_ratio",
		"copyable_on_hit_false",
		"provider_target_state_consume",
	}
}

func quinnHarrierExpectedRawFromStats(resolvedAD, baseAD float64) float64 {
	return quinnHarrierBaseDamage + quinnHarrierBonusADRatio*(resolvedAD-baseAD)
}

func quinnHarrierBonusDamageAmount() *model.GenericFormulaExpr {
	base := quinnHarrierBaseDamage
	adRatio := quinnHarrierBonusADRatio
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

func quinnHarrierPConsumeListener() model.ListenerDefinition {
	one := 1.0
	zero := 0.0
	cond := quinnHSVulnerableCond()
	return model.ListenerDefinition{
		ListenerKey:         quinnHarrierListenerKey,
		MaxTriggersPerEvent: 1,
		EventMatcher:        model.TypeMatcher{All: []string{quinnHSHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         quinnHSActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   cond,
			},
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           quinnHarrierDamageOpRef,
				Amount:        quinnHarrierBonusDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
				Condition:     cond,
			},
			{
				// Backend projects selector/self 20110 + provider_target 20252.
				// Runtime stores provider_target under the frame combat target key.
				Operation:   "state_change",
				Target:      "source",
				Ref:         quinnHSVulnerableKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   cond,
			},
		},
	}
}

type quinnHarrierFixtureOpts struct {
	resolvedAD    float64
	vulnerable    float64
	vulnerableOn  string // default target; isolation uses source
	listenerOrder string // "wp" (default) or "pw"
}

func configureQuinnHarrierProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts quinnHarrierFixtureOpts) {
	bonusAD := opts.resolvedAD - quinnHarrierADBase
	wListener := quinnHSArmListener()
	pListener := quinnHarrierPConsumeListener()
	listeners := []model.ListenerDefinition{wListener, pListener}
	if opts.listenerOrder == "pw" {
		listeners = []model.ListenerDefinition{pListener, wListener}
	}

	mods := []model.ModifierDefinition{quinnHSASModifier()}
	if bonusAD != 0 {
		mods = append(mods, model.ModifierDefinition{
			ModifierKey: quinnHarrierBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		})
	}

	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        quinnHSProviderRef,
		Kind:               "champion",
		StableID:           quinnHSStableID,
		InitialStateSchema: quinnHSStateSchema(),
		Modifiers:          mods,
		Listeners:          listeners,
		Abilities: []model.AbilityDefinition{
			quinnHSHitAbility(),
			quinnHSProbeAbility(),
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: quinnHSProviderRef, DefinitionRef: quinnHSProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: quinnHSProviderRef, DefinitionRef: quinnHSProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func loadQuinnHarrierFixture(t *testing.T, opts quinnHarrierFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.resolvedAD == 0 {
		opts.resolvedAD = quinnHarrierADResolvedDefault
	}
	if opts.vulnerableOn == "" {
		opts.vulnerableOn = model.SelectorTarget
	}
	if opts.listenerOrder == "" {
		opts.listenerOrder = "wp"
	}

	compileReq, runReq := loadBasicFixture(t)
	ensureQuinnHSTypes(&compileReq)
	configureQuinnHarrierProviders(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: quinnHarrierADBase, Current: quinnHarrierADBase,
		Max: quinnHarrierADBase, Resolved: quinnHarrierADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: quinnHSBaseAS, Current: quinnHSBaseAS, Max: quinnHSBaseAS, Resolved: quinnHSBaseAS,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: quinnHarrierTargetHP, Current: quinnHarrierTargetHP,
		Max: quinnHarrierTargetHP, Resolved: quinnHarrierTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: quinnHarrierTargetHP, Current: quinnHarrierTargetHP,
		Max: quinnHarrierTargetHP, Resolved: quinnHarrierTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: quinnHarrierTargetArmor, Current: quinnHarrierTargetArmor,
		Max: quinnHarrierTargetArmor, Resolved: quinnHarrierTargetArmor,
	})

	if opts.vulnerable != 0 {
		seedQuinnHarrierVulnerable(&runReq, opts.vulnerableOn, opts.vulnerable)
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runQuinnHarrier(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

type quinnHarrierRunBundle struct {
	done      model.DoneResult
	sessionID string
	rulesHash string
}

func runQuinnHarrierFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) quinnHarrierRunBundle {
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
	return quinnHarrierRunBundle{done: done, sessionID: compiled.SessionID, rulesHash: compiled.RulesHash}
}

func quinnHarrierDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != quinnHarrierDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func quinnHarrierAADamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != quinnHarrierAAOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func quinnHarrierAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > quinnHarrierTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > quinnHarrierTol {
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

func quinnHarrierFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == quinnHSProviderRef {
			return p
		}
	}
	return nil
}

func quinnHarrierFindPListener(p *model.ProviderDefinition) *model.ListenerDefinition {
	if p == nil {
		return nil
	}
	for i := range p.Listeners {
		if p.Listeners[i].ListenerKey == quinnHarrierListenerKey {
			return &p.Listeners[i]
		}
	}
	return nil
}

func assertQuinnHarrierCompileShape(t *testing.T, compileReq model.CompileRequest, expectBonusADMod bool, order string) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1 (extend W provider; no new provider)", len(compileReq.SharedProviders))
	}
	p := quinnHarrierFindProvider(compileReq)
	if p == nil {
		t.Fatal("W/P shared provider hero:quinn missing")
	}
	if p.ProviderKey != quinnHSProviderRef || p.StableID != quinnHSStableID {
		t.Fatalf("provider=%q/%q want %q/%q", p.ProviderKey, p.StableID, quinnHSProviderRef, quinnHSStableID)
	}
	if p.ProviderKey == quinnHarrierBackendProviderAlias || p.StableID == quinnHarrierBackendProviderAlias {
		t.Fatal("Wasm fixture uses hero:quinn; must not invent a second P provider identity")
	}
	if len(p.Listeners) != 2 {
		t.Fatalf("listeners=%d want 2 (W arm + P consume)", len(p.Listeners))
	}
	if order == "pw" {
		if p.Listeners[0].ListenerKey != quinnHarrierListenerKey ||
			p.Listeners[1].ListenerKey != quinnHSListenerArm {
			t.Fatalf("listener order=%q/%q want P-before-W", p.Listeners[0].ListenerKey, p.Listeners[1].ListenerKey)
		}
	} else if p.Listeners[0].ListenerKey != quinnHSListenerArm ||
		p.Listeners[1].ListenerKey != quinnHarrierListenerKey {
		t.Fatalf("listener order=%q/%q want W-before-P", p.Listeners[0].ListenerKey, p.Listeners[1].ListenerKey)
	}

	wantMods := 1
	if expectBonusADMod {
		wantMods = 2
	}
	if len(p.Modifiers) != wantMods {
		t.Fatalf("modifiers=%d want %d", len(p.Modifiers), wantMods)
	}
	if p.Modifiers[0].ModifierKey != quinnHSASModKey {
		t.Fatalf("first modifier=%q want W AS %q (do not mutate W-row ownership)", p.Modifiers[0].ModifierKey, quinnHSASModKey)
	}

	l := quinnHarrierFindPListener(p)
	if l == nil {
		t.Fatal("P listener missing")
	}
	if l.MaxTriggersPerEvent != 1 {
		t.Fatalf("maxTriggersPerEvent=%d want 1", l.MaxTriggersPerEvent)
	}
	if len(l.EventMatcher.All) != 2 ||
		l.EventMatcher.All[0] != quinnHSHitEvent ||
		l.EventMatcher.All[1] != "event/source_owner" {
		t.Fatalf("eventMatcher=%+v want basic_attack_hit+source_owner", l.EventMatcher)
	}
	if len(l.Operations) != 3 {
		t.Fatalf("P ops=%d want 3", len(l.Operations))
	}

	arm := l.Operations[0]
	if arm.Operation != "state_change" || arm.Target != "source" || arm.Ref != quinnHSActiveKey ||
		len(arm.Types) != 1 || arm.Types[0] != "state_scope/provider" || arm.ValuePolicy != "override" {
		t.Fatalf("step0 arm=%+v", arm)
	}
	dmg := l.Operations[1]
	if dmg.Operation != "damage" || dmg.Target != "target" || dmg.DamageType != "damage/physical" ||
		dmg.Ref != quinnHarrierDamageOpRef || dmg.CritEligible || dmg.CopyableOnHit {
		t.Fatalf("step1 damage=%+v", dmg)
	}
	if dmg.Amount == nil || dmg.Amount.Op != "add" || len(dmg.Amount.Args) != 2 ||
		dmg.Amount.Args[0].Op != "const" || dmg.Amount.Args[1].Op != "mul" ||
		len(dmg.Amount.Args[1].Args) != 2 || dmg.Amount.Args[1].Args[1].Op != "sub" {
		t.Fatalf("step1 amount must be nested binary add(const,mul(const,sub(...))): %+v", dmg.Amount)
	}
	clear := l.Operations[2]
	if clear.Operation != "state_change" || clear.Target != "source" || clear.Ref != quinnHSVulnerableKey ||
		len(clear.Types) != 1 || clear.Types[0] != "state_scope/provider_target" ||
		clear.ValuePolicy != "override" {
		t.Fatalf("step2 clear=%+v want Target source + provider_target (20110+20252 projection)", clear)
	}
	if clear.Target == "target" || clear.Target == "opponent" {
		t.Fatal("mark clear must never Target target/opponent")
	}
	for i, op := range l.Operations {
		if op.Condition == nil || op.Condition.Op != "gte" {
			t.Fatalf("op[%d] condition missing gte mark gate", i)
		}
	}
}

func quinnHarrierWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "quinn-p.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnHarrierWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "quinn-p.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnHarrierWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "quinn-p.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func quinnHarrierSeedPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"db", "game_manage", "seeds", "lol_generic_quinn_p_harrier_premarked_consume_seed.sql")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("backend seed missing at %s: %v", path, err)
	}
	return path
}

func quinnHarrierJUnitPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"server", "data_manage", "src", "test", "java", "xyz", "game", "datamanage", "db",
		"LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest.java")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("JUnit contract missing at %s: %v", path, err)
	}
	return path
}

func quinnHarrierREADMEPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "server", "data_manage", "README.md")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("README missing at %s: %v", path, err)
	}
	return path
}

type quinnHarrierWikiSidecar struct {
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
		Description2 string `json:"description2"`
		Description3 string `json:"description3"`
		Description4 string `json:"description4"`
		Damagetype   string `json:"damagetype"`
		Notes        string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

type quinnHarrierWikiPages struct {
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

func quinnHarrierLoadWikiSidecar(t *testing.T) quinnHarrierWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(quinnHarrierWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc quinnHarrierWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

func quinnHarrierLoadWikiPages(t *testing.T) quinnHarrierWikiPages {
	t.Helper()
	raw, err := os.ReadFile(quinnHarrierWikiPagesPath(t))
	if err != nil {
		t.Fatalf("read wiki pages: %v", err)
	}
	var doc quinnHarrierWikiPages
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki pages: %v", err)
	}
	return doc
}

func quinnHarrierLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(quinnHarrierSeedPath(t))
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

func quinnHarrierSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func quinnHarrierEvidenceFingerprint(done model.DoneResult) string {
	raw, err := json.Marshal(done.Evidence.Items)
	if err != nil {
		return ""
	}
	return quinnHarrierSHA256Hex(raw)
}

// TestGenericQuinnHarrierWikiAndBackendIdentityContract locks sidecar/pages/local
// identities plus integrated Backend seed/JUnit/README exact contract.
func TestGenericQuinnHarrierWikiAndBackendIdentityContract(t *testing.T) {
	doc := quinnHarrierLoadWikiSidecar(t)
	if doc.CandidateKey != quinnHarrierCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, quinnHarrierCandidateKey)
	}
	if doc.RequestTitle != quinnHarrierRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, quinnHarrierRequestTitle)
	}
	if doc.ResolvedTitle != quinnHarrierResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, quinnHarrierResolvedTitle)
	}
	if doc.WikiPageID != quinnHarrierWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, quinnHarrierWikiPageID)
	}
	if doc.RevisionID != quinnHarrierRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, quinnHarrierRevisionID)
	}
	if doc.RevisionTimestamp != quinnHarrierTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, quinnHarrierTimestamp)
	}
	if doc.ContentSHA256 != quinnHarrierContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, quinnHarrierContentSHA)
	}
	if doc.RawByteSize != quinnHarrierRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, quinnHarrierRawBytes)
	}
	if doc.SkillKey != "P" || doc.ZhDisplayName != "侵扰" || doc.OwnerID != "hero_quinn" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want P/侵扰/hero_quinn",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{"description", "description2", "description3", "description4", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("fields.damagetype=%q want Physical", doc.Fields.Damagetype)
	}
	if !strings.Contains(doc.Fields.Description2, "40% '''bonus''' AD") &&
		!strings.Contains(doc.Fields.Description2, "40% bonus AD") {
		t.Fatalf("description2 missing 40%% bonus AD: %q", doc.Fields.Description2)
	}
	if !strings.Contains(doc.Fields.Description2, "basic attacks") &&
		!strings.Contains(doc.Fields.Description2, "on-hit") {
		t.Fatalf("description2 missing basic-attack on-hit consume prose: %q", doc.Fields.Description2)
	}

	pages := quinnHarrierLoadWikiPages(t)
	if pages.CandidateKey != quinnHarrierCandidateKey ||
		pages.RequestTitle != quinnHarrierRequestTitle ||
		pages.ResolvedTitle != quinnHarrierResolvedTitle ||
		pages.PageID != quinnHarrierWikiPageID ||
		pages.RevisionID != quinnHarrierRevisionID ||
		pages.RevisionTimestamp != quinnHarrierTimestamp ||
		pages.ContentSHA256 != quinnHarrierContentSHA ||
		pages.RawByteSize != quinnHarrierRawBytes ||
		pages.SkillKey != "P" || pages.ZhDisplayName != "侵扰" || pages.OwnerID != "hero_quinn" {
		t.Fatalf("pages identity must agree with sidecar canonical fields; got %+v", pages)
	}

	raw, err := os.ReadFile(quinnHarrierWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) != quinnHarrierLocalRawBytes {
		t.Fatalf("local raw len=%d want %d (known materialization)", len(raw), quinnHarrierLocalRawBytes)
	}
	localSHA := quinnHarrierSHA256Hex(raw)
	if localSHA != quinnHarrierLocalRawSHA {
		t.Fatalf("local raw sha=%q want known materialization %q", localSHA, quinnHarrierLocalRawSHA)
	}
	if localSHA == quinnHarrierContentSHA {
		t.Fatal("local raw hash must not equal canonical contentSha256 (materialization caveat; not source contradiction)")
	}
	if quinnHarrierBoundary != "level18_preexisting_harrier_target_single_basic_attack_consume; "+
		"bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; "+
		"no_mark_generation_ability_application_duration_reveal_valor_targeting_"+
		"monster_bonus_r_disable_parry_or_other_levels" {
		t.Fatal("frozen boundary constant drifted")
	}
	if quinnHarrierPlanRev != "quinn-p-harrier-premarked-consume-phase-a-v2" {
		t.Fatal("frozen plan-rev constant drifted")
	}

	seed, sqlNoComments := quinnHarrierLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(quinnHarrierREADMEPath(t))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)
	junitBytes, err := os.ReadFile(quinnHarrierJUnitPath(t))
	if err != nil {
		t.Fatal(err)
	}
	junit := string(junitBytes)

	for _, want := range []string{
		quinnHarrierCandidateKey,
		quinnHarrierTaskKey,
		quinnHarrierPlanRev,
		quinnHarrierRequestTitle,
		quinnHarrierResolvedTitle,
		"1308953",
		"4024765",
		quinnHarrierTimestamp,
		quinnHarrierContentSHA,
		quinnHarrierLocalRawSHA,
		"2390",
		quinnHarrierBoundary,
		quinnHarrierBackendProviderAlias,
		quinnHarrierBasicAttackAlias,
		quinnHarrierListenerKey,
		"harrier_p_level18_bonus_damage",
		"harrier_p_mark_clear",
		"heightened_senses_arm_condition",
		"local raw materialization caveat",
		"normalized/generic/quinn-p.json",
		"20110",
		"20252",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	if !strings.Contains(seed, "W → P") && !strings.Contains(seed, "W -> P") {
		t.Fatal("seed must document W -> P order")
	}
	if !strings.Contains(seed, "Q / E") && !strings.Contains(seed, "Q/E") &&
		!strings.Contains(seed, "Q·E") && !strings.Contains(seed, "Q · E") {
		t.Fatal("seed must document Q/E are not prerequisites")
	}
	for _, tag := range quinnHarrierOrderedTags() {
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
	for _, tag := range quinnHarrierOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}

	if !strings.Contains(sqlNoComments, quinnHarrierSeedDamageJSON) {
		t.Fatal("seed formula must use nested binary add(120,mul(0.40,sub(ad)))")
	}
	if !regexp.MustCompile(`(?s)'step_hero_quinn_p_harrier_premarked_consume_mark_clear'\s*,\s*` +
		`'sequence_hero_quinn_p_harrier_premarked_consume'\s*,\s*` +
		`2\s*,\s*20160\s*,\s*20110`).MatchString(sqlNoComments) {
		t.Fatal("mark clear step must use selector/self 20110")
	}
	if !regexp.MustCompile(`(?s)'step_hero_quinn_p_harrier_premarked_consume_mark_clear'\s*,\s*` +
		`20252\s*,\s*'harrier_vulnerable'`).MatchString(sqlNoComments) {
		t.Fatal("mark clear detail must use provider_target 20252")
	}
	if regexp.MustCompile(`(?s)'step_hero_quinn_p_harrier_premarked_consume_mark_clear'[\s\S]{0,120}20111`).MatchString(sqlNoComments) {
		t.Fatal("forbid consume encoding with opponent 20111")
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_formulas",
		"INSERT INTO public.provider_listeners",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.state_effect_details",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.listener_match_types",
		"INSERT INTO public.listener_effect_sequences",
	} {
		if !strings.Contains(sqlNoComments, needle) {
			t.Fatalf("executable seed missing %q", needle)
		}
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.provider_listeners") != 1 {
		t.Fatal("seed must define exactly one P listener insert")
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.effect_sequences") != 1 {
		t.Fatal("seed must define exactly one P sequence insert")
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.damage_effect_details") != 1 {
		t.Fatal("seed must define exactly one damage_effect_details")
	}

	forbiddenWrites := []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.entity_provider_mounts",
		"INSERT INTO public.game_entities",
		"INSERT INTO public.entity_attribute_values",
		"INSERT INTO public.provider_state_fields",
		"INSERT INTO public.provider_modifiers",
		"INSERT INTO public.ability_definitions",
	}
	for _, needle := range forbiddenWrites {
		if strings.Contains(sqlNoComments, needle) {
			t.Fatalf("must not write/mutate %q (no new provider / W-row mutation)", needle)
		}
	}
	if regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_formulas[\s\S]{0,500}'heightened_senses_arm_condition'`).MatchString(sqlNoComments) {
		t.Fatal("must not upsert W heightened_senses_arm_condition")
	}
	if regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.provider_listeners[\s\S]{0,220}'listener_hero_quinn_heightened_senses_basic_attack_hit'`).MatchString(sqlNoComments) {
		t.Fatal("must not upsert W basic-attack listener")
	}

	for _, want := range []string{
		quinnHarrierCandidateKey,
		quinnHarrierTaskKey,
		quinnHarrierPlanRev,
		"lol_generic_quinn_p_harrier_premarked_consume_seed.sql",
		"LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest",
		"lol_generic_quinn_heightened_senses_seed.sql",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, quinnHarrierBoundary) &&
		!strings.Contains(readme, "bonus_physical_120_plus_0_40_bonus_ad") {
		t.Fatal("README must include frozen boundary")
	}
	if !strings.Contains(readme, "W → P → Q(resource) → E") &&
		!strings.Contains(readme, "W -> P -> Q(resource) -> E") {
		t.Fatal("README must document W -> P -> Q(resource) -> E order")
	}
	wIdx := strings.Index(readme, "### LoL generic Quinn Heightened Senses seed")
	pIdx := strings.Index(readme, "### LoL generic Quinn P Harrier pre-marked consume seed")
	qIdx := strings.Index(readme, "### LoL generic Quinn Blinding Assault primary-hit seed")
	eIdx := strings.Index(readme, "### LoL generic Quinn Vault primary-hit seed")
	if !(wIdx >= 0 && pIdx > wIdx && qIdx > pIdx && eIdx > qIdx) {
		t.Fatal("README registration order must be W -> P -> Q(resource) -> E")
	}
	pSectionEnd := qIdx
	if pSectionEnd < 0 {
		pSectionEnd = len(readme)
	}
	pSection := readme[pIdx:pSectionEnd]
	if !strings.Contains(pSection, "P 仅需 W") &&
		!regexp.MustCompile(`(?i)P.*needs W only|仅需\s*W|只依赖 W`).MatchString(pSection) {
		t.Fatal("README must state P needs W only (Q/E independent)")
	}

	for _, want := range []string{
		quinnHarrierCandidateKey,
		quinnHarrierTaskKey,
		quinnHarrierPlanRev,
		"LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest",
		`\"value\":120`,
		`\"value\":0.40`,
		`source.attr.ad.resolved`,
		`source.attr.ad.base`,
		"20110",
		"20252",
	} {
		if !strings.Contains(junit, want) {
			t.Fatalf("JUnit missing %q", want)
		}
	}
}

// TestGenericQuinnHarrierPremarkBonusADRaw152: premark1, baseAD59/resolved139,
// armor100 → exactly one P bonus raw152/mitigated76; separate base AA; mark0; active1.
func TestGenericQuinnHarrierPremarkBonusADRaw152(t *testing.T) {
	compileReq, runReq := loadQuinnHarrierFixture(t, quinnHarrierFixtureOpts{
		resolvedAD: quinnHarrierADResolvedDefault,
		vulnerable: 1,
	})
	assertQuinnHarrierCompileShape(t, compileReq, true, "wp")

	wantRaw := quinnHarrierExpectedRawFromStats(quinnHarrierADResolvedDefault, quinnHarrierADBase)
	if math.Abs(wantRaw-quinnHarrierExpectedRaw152) > quinnHarrierTol {
		t.Fatalf("formula raw=%v want %v", wantRaw, quinnHarrierExpectedRaw152)
	}
	wantMit := expectedMitigatedPhysical(wantRaw, quinnHarrierTargetArmor)
	if math.Abs(wantMit-quinnHarrierExpectedMit76) > quinnHarrierTol {
		t.Fatalf("formula mit=%v want %v", wantMit, quinnHarrierExpectedMit76)
	}

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnHarrier(t, compileReq, runReq)

	if countEmittedEvents(done, quinnHSHitEvent) != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, quinnHSHitEvent))
	}
	pDmg := quinnHarrierDamageEvidence(done)
	if len(pDmg) != 1 {
		t.Fatalf("P bonus evidence=%d want 1", len(pDmg))
	}
	quinnHarrierAssertDamage(t, pDmg[0], quinnHarrierExpectedRaw152, quinnHarrierExpectedMit76)
	aa := quinnHarrierAADamageEvidence(done)
	if len(aa) != 1 {
		t.Fatalf("base AA evidence=%d want 1 (separate from P bonus)", len(aa))
	}
	quinnHarrierAssertDamage(t, aa[0], quinnHSAADamage, expectedMitigatedPhysical(quinnHSAADamage, quinnHarrierTargetArmor))

	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 1 {
		t.Fatalf("heightened_senses_active=%v want 1", got)
	}
	tgt, vuln := quinnHSTargetStateValue(t, done)
	if tgt != model.SelectorTarget {
		t.Fatalf("targetState.target=%q want %q", tgt, model.SelectorTarget)
	}
	if vuln != 0 {
		t.Fatalf("harrier_vulnerable=%v want 0 after consume", vuln)
	}
}

// TestGenericQuinnHarrierBaselineRaw120: base/resolved AD59 → P raw120/mitigated60.
func TestGenericQuinnHarrierBaselineRaw120(t *testing.T) {
	compileReq, runReq := loadQuinnHarrierFixture(t, quinnHarrierFixtureOpts{
		resolvedAD: quinnHarrierADBase,
		vulnerable: 1,
	})
	assertQuinnHarrierCompileShape(t, compileReq, false, "wp")

	wantRaw := quinnHarrierExpectedRawFromStats(quinnHarrierADBase, quinnHarrierADBase)
	if math.Abs(wantRaw-quinnHarrierExpectedRaw120) > quinnHarrierTol {
		t.Fatalf("formula raw=%v want %v", wantRaw, quinnHarrierExpectedRaw120)
	}
	wantMit := expectedMitigatedPhysical(wantRaw, quinnHarrierTargetArmor)
	if math.Abs(wantMit-quinnHarrierExpectedMit60) > quinnHarrierTol {
		t.Fatalf("formula mit=%v want %v", wantMit, quinnHarrierExpectedMit60)
	}

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnHarrier(t, compileReq, runReq)

	pDmg := quinnHarrierDamageEvidence(done)
	if len(pDmg) != 1 {
		t.Fatalf("P bonus evidence=%d want 1", len(pDmg))
	}
	quinnHarrierAssertDamage(t, pDmg[0], quinnHarrierExpectedRaw120, quinnHarrierExpectedMit60)
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 1 {
		t.Fatalf("heightened_senses_active=%v want 1", got)
	}
	_, vuln := quinnHSTargetStateValue(t, done)
	if vuln != 0 {
		t.Fatalf("harrier_vulnerable=%v want 0", vuln)
	}
}

// TestGenericQuinnHarrierNoPremarkNoBonus: no premark → zero P bonus, mark0, W active0.
func TestGenericQuinnHarrierNoPremarkNoBonus(t *testing.T) {
	compileReq, runReq := loadQuinnHarrierFixture(t, quinnHarrierFixtureOpts{
		resolvedAD: quinnHarrierADResolvedDefault,
		vulnerable: 0,
	})
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnHarrier(t, compileReq, runReq)

	if countEmittedEvents(done, quinnHSHitEvent) != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, quinnHSHitEvent))
	}
	if len(quinnHarrierDamageEvidence(done)) != 0 {
		t.Fatalf("P bonus=%d want 0 without premark", len(quinnHarrierDamageEvidence(done)))
	}
	if len(quinnHarrierAADamageEvidence(done)) != 1 {
		t.Fatalf("base AA=%d want 1", len(quinnHarrierAADamageEvidence(done)))
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 0 {
		t.Fatalf("heightened_senses_active=%v want 0", got)
	}
	// No premark seed → no provider targetState bag; treat absent mark as 0.
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		if bag, ok := c.ProviderState[quinnHSProviderRef].(map[string]interface{}); ok {
			if ts, ok := bag["targetState"].(map[string]interface{}); ok {
				if values, ok := ts["values"].(map[string]interface{}); ok {
					if vuln, _ := values[quinnHSVulnerableKey].(float64); vuln != 0 {
						t.Fatalf("harrier_vulnerable=%v want 0", vuln)
					}
				}
			}
		}
	}
}

// TestGenericQuinnHarrierSecondAttackNoReconsume: t0/t3000 with one initial mark →
// two base AAs but exactly one P bonus; mark remains0; second hit does not re-arm W
// (final active0 after original 2000ms expiry).
func TestGenericQuinnHarrierSecondAttackNoReconsume(t *testing.T) {
	compileReq, runReq := loadQuinnHarrierFixture(t, quinnHarrierFixtureOpts{
		resolvedAD: quinnHarrierADResolvedDefault,
		vulnerable: 1,
	})
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa1", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa2", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 3000},
	}
	runReq.StopPolicy.DurationMs = 3100
	done := runQuinnHarrier(t, compileReq, runReq)

	if countEmittedEvents(done, quinnHSHitEvent) != 2 {
		t.Fatalf("basic_attack_hit=%d want 2", countEmittedEvents(done, quinnHSHitEvent))
	}
	if len(quinnHarrierAADamageEvidence(done)) != 2 {
		t.Fatalf("base AA=%d want 2", len(quinnHarrierAADamageEvidence(done)))
	}
	pDmg := quinnHarrierDamageEvidence(done)
	if len(pDmg) != 1 {
		t.Fatalf("P bonus=%d want exactly 1 (no re-consume)", len(pDmg))
	}
	quinnHarrierAssertDamage(t, pDmg[0], quinnHarrierExpectedRaw152, quinnHarrierExpectedMit76)
	_, vuln := quinnHSTargetStateValue(t, done)
	if vuln != 0 {
		t.Fatalf("harrier_vulnerable=%v want 0", vuln)
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 0 {
		t.Fatalf("heightened_senses_active=%v want 0 (2000ms expired; second hit must not re-arm)", got)
	}
}

// TestGenericQuinnHarrierListenerOrderTable: W-before-P and P-before-W both yield
// identical P raw/mitigated, exactly one bonus, mark0, active1 after one hit.
func TestGenericQuinnHarrierListenerOrderTable(t *testing.T) {
	cases := []struct {
		name  string
		order string
	}{
		{name: "W_before_P", order: "wp"},
		{name: "P_before_W", order: "pw"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadQuinnHarrierFixture(t, quinnHarrierFixtureOpts{
				resolvedAD:    quinnHarrierADResolvedDefault,
				vulnerable:    1,
				listenerOrder: tc.order,
			})
			assertQuinnHarrierCompileShape(t, compileReq, true, tc.order)

			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runQuinnHarrier(t, compileReq, runReq)

			pDmg := quinnHarrierDamageEvidence(done)
			if len(pDmg) != 1 {
				t.Fatalf("P bonus=%d want 1", len(pDmg))
			}
			quinnHarrierAssertDamage(t, pDmg[0], quinnHarrierExpectedRaw152, quinnHarrierExpectedMit76)
			_, vuln := quinnHSTargetStateValue(t, done)
			if vuln != 0 {
				t.Fatalf("harrier_vulnerable=%v want 0", vuln)
			}
			if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 1 {
				t.Fatalf("heightened_senses_active=%v want 1 (P step0 keeps order-independent arm)", got)
			}
		})
	}
}

// TestGenericQuinnHarrierIsolationDeterminismCompileShapeTags: target isolation,
// deterministic evidence/release, compile shape, exact tags/boundary/exclusions.
func TestGenericQuinnHarrierIsolationDeterminismCompileShapeTags(t *testing.T) {
	if quinnHarrierExclusions != "mark production from Q/E/Skystrike/Valor; 4s mark duration/reveal/overwrite; "+
		"1s cooldown; targeting/visibility/AI; monster75; R disable; parry/negation; "+
		"levels1-17; multiple targets; loadout/crit/Runaan/Guinsoo/phantom replication; "+
		"live/publish/E2E/full fidelity" {
		t.Fatal("frozen exclusions constant drifted")
	}
	tags := quinnHarrierOrderedTags()
	if len(tags) != 5 || tags[0] != "on_hit" || tags[1] != "formula_on_hit" ||
		tags[2] != "bonus_ad_ratio" || tags[3] != "copyable_on_hit_false" ||
		tags[4] != "provider_target_state_consume" {
		t.Fatalf("ordered tags drifted: %#v", tags)
	}

	// Target isolation: vulnerable bound to source must not fire vs cast target.
	compileIso, runIso := loadQuinnHarrierFixture(t, quinnHarrierFixtureOpts{
		resolvedAD:   quinnHarrierADResolvedDefault,
		vulnerable:   1,
		vulnerableOn: model.SelectorSource,
	})
	assertQuinnHarrierCompileShape(t, compileIso, true, "wp")
	runIso.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runIso.StopPolicy.DurationMs = 50
	doneIso := runQuinnHarrier(t, compileIso, runIso)
	if len(quinnHarrierDamageEvidence(doneIso)) != 0 {
		t.Fatalf("isolated P bonus=%d want 0", len(quinnHarrierDamageEvidence(doneIso)))
	}
	if got := quinnHSStateValue(t, doneIso, quinnHSActiveKey); got != 0 {
		t.Fatalf("isolated active=%v want 0", got)
	}
	tgt, vuln := quinnHSTargetStateValue(t, doneIso)
	if tgt != model.SelectorSource {
		t.Fatalf("targetState.target=%q want source binding retained", tgt)
	}
	if vuln != 1 {
		t.Fatalf("harrier_vulnerable=%v want 1 (unconsumed under mismatched binding)", vuln)
	}

	// Deterministic evidence + canonical compile/run/release frame path.
	var fingerprints []string
	for i := 0; i < 2; i++ {
		c, r := loadQuinnHarrierFixture(t, quinnHarrierFixtureOpts{
			resolvedAD: quinnHarrierADResolvedDefault,
			vulnerable: 1,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runQuinnHarrier(t, c, r)
		pDmg := quinnHarrierDamageEvidence(done)
		if len(pDmg) != 1 {
			t.Fatalf("iter %d P bonus=%d want 1", i, len(pDmg))
		}
		quinnHarrierAssertDamage(t, pDmg[0], quinnHarrierExpectedRaw152, quinnHarrierExpectedMit76)
		fingerprints = append(fingerprints, quinnHarrierEvidenceFingerprint(done))
	}
	if fingerprints[0] == "" || fingerprints[0] != fingerprints[1] {
		t.Fatalf("evidence fingerprint unstable: %q vs %q", fingerprints[0], fingerprints[1])
	}

	c, r := loadQuinnHarrierFixture(t, quinnHarrierFixtureOpts{
		resolvedAD: quinnHarrierADResolvedDefault,
		vulnerable: 1,
	})
	assertQuinnHarrierCompileShape(t, c, true, "wp")
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	r.StopPolicy.DurationMs = 50
	bundle := runQuinnHarrierFrames(t, c, r)
	if len(quinnHarrierDamageEvidence(bundle.done)) != 1 {
		t.Fatalf("frame-path P bonus=%d want 1", len(quinnHarrierDamageEvidence(bundle.done)))
	}
	quinnHarrierAssertDamage(t, quinnHarrierDamageEvidence(bundle.done)[0],
		quinnHarrierExpectedRaw152, quinnHarrierExpectedMit76)
	if bundle.sessionID == "" || bundle.rulesHash == "" {
		t.Fatal("frame path must return sessionID/rulesHash")
	}

	// Excluded full-fidelity surfaces remain present in wiki prose only.
	doc := quinnHarrierLoadWikiSidecar(t)
	if !strings.Contains(doc.Fields.Description, "Valor") ||
		!strings.Contains(doc.Fields.Description3, "75") ||
		!strings.Contains(doc.Fields.Description4, "Behind Enemy Lines") ||
		!strings.Contains(doc.Fields.Notes, "parried") {
		t.Fatalf("wiki must retain excluded Valor/monster75/R-disable/parry prose: %+v", doc.Fields)
	}
	seed, _ := quinnHarrierLoadSeedSQL(t)
	for _, excl := range []string{"Valor", "monster", "parry", "reveal", "mark"} {
		if !strings.Contains(seed, excl) && !strings.Contains(strings.ToLower(seed), strings.ToLower(excl)) {
			t.Fatalf("seed comments must document exclusion surface %q", excl)
		}
	}
}
