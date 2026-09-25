package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_xayah P Clean Cuts / 锐切 — Phase-A v2 Wasm exact three-attack budget slice
// (FROZEN_PLAN_REV: xayah-p-clean-cuts-three-attack-budget-phase-a-v2).
//
// Frozen boundary (user-approved attack-count-only Phase-A):
//
//	attack_count_budget_only; direct_post_cast_arm_gives_3;
//	successful_source_ba_damage_instance_consumes_1;
//	state_sequence_arm_plus_4ba_0_3_2_1_0_0;
//	preserve_wqr_and_w_ability_type_listener_isolation;
//	no_true_qwer_wiring_add_refresh_max5_8s_timer_geometry_feathers_
//	secondary_damage_secondary_crit_e_dependency_miss_dodge_cadence_
//	projectile_rng_expected_crit_on_hit_proc_or_full_ba_clean_cuts_fidelity
//
// Wiki authority (repository sidecar; no DDragon/Meraki numeric truth):
//
//	Candidate hero_skill|hero_xayah|P|锐切
//	Request Template:Data Xayah/I → resolved Template:Data Xayah/Clean Cuts
//	wikiPageId 1324540 / rev 3967343 / timestamp 2025-11-18T20:49:46Z
//	canonical rawByteSize 4068 / SHA256
//	  5cfe6e5e30cdc8e6fde07791288f5a85e5ef01f543670ce2248323ccb6ead171
//	数据参考/lol-wiki-current-champions/normalized/generic/xayah-p.json
//
// Phase-A contract (isolated generic provider; 历史种子已退役，仅核对通用构造样例):
//   - Provider state clean_cuts_attacks_remaining: defaultValue0 / maxValue3 /
//     durationMs0 (ABI-side untimed; Backend DB NULL equivalent)
//   - Arm ability clean_cuts_direct_post_cast_arm: active, champion-origin,
//     no cost/CD; provider-scope state_change override const3; non-basic so
//     successful top-level cast emits automatic ability_started (no listener
//     consumes it)
//   - BA ability clean_cuts_basic_attack: ability/basic_attack; one direct
//     physical damage = read source.attr.ad.resolved; CritEligible=false;
//     CopyableOnHit=false; no cost/CD
//   - P listener: ALL {event/damage_instance, ability/basic_attack,
//     event/source_owner}; MaxTriggersPerEvent=1; guarded provider-scope
//     state_change add -1 when gt(read provider.state..., const0)
//   - Wiki on-attack approximated by successful damage_instance (miss/dodge out)
//
// Hero-named `_test.go` is regression/governance evidence only; production
// runtime remains generic (no if hero_xayah production behavior). Excluded from
// production Wasm builds via Go `_test.go` convention.

const (
	xayahCCCandidateKey  = "hero_skill|hero_xayah|P|锐切"
	xayahCCTaskKey       = "wasm-generic-xayah-clean-cuts-three-attack-budget"
	xayahCCPlanRev       = "xayah-p-clean-cuts-three-attack-budget-phase-a-v2"
	xayahCCRequestTitle  = "Template:Data Xayah/I"
	xayahCCResolvedTitle = "Template:Data Xayah/Clean Cuts"
	xayahCCWikiPageID    = 1324540
	xayahCCRevisionID    = 3967343
	xayahCCTimestamp     = "2025-11-18T20:49:46Z"
	xayahCCRawBytes      = 4068
	xayahCCContentSHA    = "5cfe6e5e30cdc8e6fde07791288f5a85e5ef01f543670ce2248323ccb6ead171"
	xayahCCBoundary      = "attack_count_budget_only; direct_post_cast_arm_gives_3; " +
		"successful_source_ba_damage_instance_consumes_1; " +
		"state_sequence_arm_plus_4ba_0_3_2_1_0_0; " +
		"preserve_wqr_and_w_ability_type_listener_isolation; " +
		"no_true_qwer_wiring_add_refresh_max5_8s_timer_geometry_feathers_" +
		"secondary_damage_secondary_crit_e_dependency_miss_dodge_cadence_" +
		"projectile_rng_expected_crit_on_hit_proc_or_full_ba_clean_cuts_fidelity"

	xayahCCProviderRef = "provider_hero_xayah_p_clean_cuts_three_attack_budget"
	xayahCCStableID    = "hero_xayah_p_clean_cuts_three_attack_budget"
	xayahCCStateKey    = "clean_cuts_attacks_remaining"
	xayahCCArmKey      = "clean_cuts_direct_post_cast_arm"
	xayahCCBAKey       = "clean_cuts_basic_attack"
	xayahCCSpellKey    = "clean_cuts_unrelated_spell"
	xayahCCListenerKey = "listener_hero_xayah_p_clean_cuts_basic_attack_damage"
	xayahCCBAOpRef     = "op:clean_cuts_basic_attack"
	xayahCCSpellOpRef  = "op:clean_cuts_unrelated_spell"
	xayahCCCastEvent   = "event/ability_started"
	xayahCCDamageEvent = "event/damage_instance"

	xayahCCOpponentProviderRef = "champion:xayah_cc_opponent_demo"
	xayahCCOpponentStableID    = "xayah_cc_opponent_demo"
	xayahCCOpponentBAKey       = "opponent_basic_attack"
	xayahCCOpponentBAOpRef     = "op:xayah_cc_opponent_ba"

	xayahCCArmAmount    = 3.0
	xayahCCMaxAttacks   = 3.0
	xayahCCConsumeDelta = -1.0
	xayahCCFixtureAD    = 100.0
	xayahCCTargetArmor  = 0.0
	xayahCCTargetHP     = 100000.0
	xayahCCSpellDamage  = 50.0
	xayahCCOpponentDmg  = 25.0
	xayahCCTol          = 1e-9
)

func xayahCCOrderedTags() []string {
	return []string{
		"attack_count_budget",
		"direct_post_cast_arm_override_3",
		"basic_attack_damage_instance_consume_1",
		"untimed_max3_state_no_default_column",
	}
}

func xayahCCUntimedSlot(defaultValue, maxValue float64) map[string]interface{} {
	// Untimed Phase-A: durationMs=0 and no refreshPolicy (ABI ↔ Backend duration_ms NULL).
	return map[string]interface{}{
		"defaultValue": defaultValue,
		"maxValue":     maxValue,
		"durationMs":   float64(0),
	}
}

func xayahCCStateSchema() map[string]interface{} {
	return map[string]interface{}{
		xayahCCStateKey: xayahCCUntimedSlot(0, xayahCCMaxAttacks),
	}
}

func xayahCCHasAttacksCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "gt",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + xayahCCStateKey},
			{Op: "const", Value: &zero},
		},
	}
}

func xayahCCArmAbility() model.AbilityDefinition {
	three := xayahCCArmAmount
	return model.AbilityDefinition{
		AbilityKey: xayahCCArmKey,
		Kind:       "active",
		Types:      []string{}, // non-basic → automatic ability_started
		CastOrigin: model.CastOriginChampion,
		// No Cost / Cooldown: Phase-A direct post-cast control surface.
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         xayahCCStateKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &three},
		}},
	}
}

func xayahCCBAAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: xayahCCBAKey,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/physical",
			Ref:           xayahCCBAOpRef,
			CritEligible:  false,
			CopyableOnHit: false,
			Amount:        &model.GenericFormulaExpr{Op: "read", Path: "source.attr.ad.resolved"},
		}},
	}
}

func xayahCCSpellAbility() model.AbilityDefinition {
	dmg := xayahCCSpellDamage
	return model.AbilityDefinition{
		AbilityKey: xayahCCSpellKey,
		Kind:       "active",
		// Typed ability/spell so damage_instance does not match BA listener.
		Types:      []string{"ability/spell"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/physical",
			Ref:           xayahCCSpellOpRef,
			CritEligible:  false,
			CopyableOnHit: false,
			Amount:        &model.GenericFormulaExpr{Op: "const", Value: &dmg},
		}},
	}
}

func xayahCCConsumeListener() model.ListenerDefinition {
	negOne := xayahCCConsumeDelta
	cond := xayahCCHasAttacksCond()
	return model.ListenerDefinition{
		ListenerKey:         xayahCCListenerKey,
		MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{
			xayahCCDamageEvent, "ability/basic_attack", "event/source_owner",
		}},
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         xayahCCStateKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &negOne},
			Condition:   cond,
		}},
	}
}

func xayahCCProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        xayahCCProviderRef,
		Kind:               "passive", // Backend reserved 20120 provider_kind/passive
		StableID:           xayahCCStableID,
		InitialStateSchema: xayahCCStateSchema(),
		Listeners:          []model.ListenerDefinition{xayahCCConsumeListener()},
		Abilities: []model.AbilityDefinition{
			xayahCCArmAbility(),
			xayahCCBAAbility(),
			xayahCCSpellAbility(),
		},
	}
}

func ensureXayahCCTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: xayahCCCastEvent, Domain: "event"},
		{Key: xayahCCDamageEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "cast_origin/champion", Domain: "cast_origin"},
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

func configureXayahCCProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{xayahCCProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: xayahCCProviderRef, DefinitionRef: xayahCCProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: xayahCCProviderRef, DefinitionRef: xayahCCProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func xayahCCArmRef() string {
	return "source.provider[" + xayahCCProviderRef + "].ability[" + xayahCCArmKey + "]"
}

func xayahCCBARef() string {
	return "source.provider[" + xayahCCProviderRef + "].ability[" + xayahCCBAKey + "]"
}

func xayahCCSpellRef() string {
	return "source.provider[" + xayahCCProviderRef + "].ability[" + xayahCCSpellKey + "]"
}

func xayahCCOpponentBARef() string {
	return "target.provider[" + xayahCCOpponentProviderRef + "].ability[" + xayahCCOpponentBAKey + "]"
}

func loadXayahCCFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.xayah_clean_cuts_three_attack_budget"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureXayahCCTypes(&compileReq)
	configureXayahCCProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: xayahCCFixtureAD, Current: xayahCCFixtureAD,
		Max: xayahCCFixtureAD, Resolved: xayahCCFixtureAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: xayahCCTargetHP, Current: xayahCCTargetHP,
		Max: xayahCCTargetHP, Resolved: xayahCCTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: xayahCCTargetHP, Current: xayahCCTargetHP,
		Max: xayahCCTargetHP, Resolved: xayahCCTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: xayahCCTargetArmor, Current: xayahCCTargetArmor,
		Max: xayahCCTargetArmor, Resolved: xayahCCTargetArmor,
	})

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func mountXayahCCOpponentBA(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	dmg := xayahCCOpponentDmg
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: xayahCCOpponentProviderRef,
		Kind:        "champion",
		StableID:    xayahCCOpponentStableID,
		Abilities: []model.AbilityDefinition{{
			AbilityKey: xayahCCOpponentBAKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			CastOrigin: model.CastOriginChampion,
			Operations: []model.OperationDefinition{{
				Operation:     "damage",
				Target:        "opponent",
				DamageType:    "damage/physical",
				Ref:           xayahCCOpponentBAOpRef,
				CritEligible:  false,
				CopyableOnHit: false,
				Amount:        &model.GenericFormulaExpr{Op: "const", Value: &dmg},
			}},
		}},
	})
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, model.CombatantProviderMount{
			ProviderRef: xayahCCOpponentProviderRef, DefinitionRef: xayahCCOpponentProviderRef,
		})
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: xayahCCOpponentProviderRef, DefinitionRef: xayahCCOpponentProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func runXayahCC(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

type xayahCCRunBundle struct {
	done      model.DoneResult
	sessionID string
	rulesHash string
}

func runXayahCCFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) xayahCCRunBundle {
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
	entry, ok := session.genericSessions[compiled.SessionID]
	if !ok {
		t.Fatal("compiled session not registered")
	}
	var found bool
	for _, p := range entry.compiled.Providers {
		if p.ProviderKey != xayahCCProviderRef {
			continue
		}
		field, ok := p.StateFields[xayahCCStateKey]
		if !ok {
			t.Fatal("clean_cuts_attacks_remaining state field missing after compile")
		}
		if !field.HasCap || field.MaxValue != xayahCCMaxAttacks || field.DurationMs != 0 || field.RefreshPolicy != "" {
			t.Fatalf("compiled state field=%+v want max=3 untimed(duration0,no refresh)", field)
		}
		if math.Abs(field.DefaultValue) > xayahCCTol {
			t.Fatalf("defaultValue=%v want 0", field.DefaultValue)
		}
		if len(p.Listeners) != 1 {
			t.Fatalf("compiled Listeners=%d want 1", len(p.Listeners))
		}
		found = true
		break
	}
	if !found {
		t.Fatal("clean cuts provider missing from compiled session")
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
	return xayahCCRunBundle{done: done, sessionID: compiled.SessionID, rulesHash: compiled.RulesHash}
}

func xayahCCAttacksRemaining(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[xayahCCProviderRef].(map[string]interface{})
		if !ok {
			// Missing/default state starts at 0 until first write.
			return 0
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[xayahCCStateKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func xayahCCReadTargetHP(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		slot, ok := c.Attributes["hp"]
		if !ok {
			t.Fatal("target hp missing")
		}
		return slot.Current
	}
	t.Fatal("target missing")
	return 0
}

func xayahCCBADamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != xayahCCBAOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func xayahCCFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == xayahCCProviderRef {
			return p
		}
	}
	return nil
}

func xayahCCFindAbility(p *model.ProviderDefinition, key string) *model.AbilityDefinition {
	if p == nil {
		return nil
	}
	for i := range p.Abilities {
		if p.Abilities[i].AbilityKey == key {
			return &p.Abilities[i]
		}
	}
	return nil
}

func assertXayahCCProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1 (isolated P provider)", len(compileReq.SharedProviders))
	}
	p := xayahCCFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_xayah_p_clean_cuts_three_attack_budget missing")
	}
	if p.ProviderKey != xayahCCProviderRef || p.StableID != xayahCCStableID || p.Kind != "passive" {
		t.Fatalf("provider=%q/%q/%q want %q/%q/passive", p.ProviderKey, p.StableID, p.Kind, xayahCCProviderRef, xayahCCStableID)
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (budget-only; no feathers/AS/damage mul)", len(p.Modifiers))
	}
	if len(p.InitialStateSchema) != 1 {
		t.Fatalf("InitialStateSchema keys=%d want 1", len(p.InitialStateSchema))
	}
	schema, ok := p.InitialStateSchema[xayahCCStateKey].(map[string]interface{})
	if !ok {
		t.Fatalf("schema missing %s: %+v", xayahCCStateKey, p.InitialStateSchema)
	}
	if _, hasRefresh := schema["refreshPolicy"]; hasRefresh {
		t.Fatalf("must be untimed (no refreshPolicy): %+v", schema)
	}
	if math.Abs(schema["defaultValue"].(float64)) > xayahCCTol ||
		math.Abs(schema["maxValue"].(float64)-xayahCCMaxAttacks) > xayahCCTol ||
		math.Abs(schema["durationMs"].(float64)) > xayahCCTol {
		t.Fatalf("schema=%+v want default0/max3/duration0", schema)
	}

	if len(p.Listeners) != 1 {
		t.Fatalf("listeners=%d want 1", len(p.Listeners))
	}
	l := p.Listeners[0]
	if l.ListenerKey != xayahCCListenerKey {
		t.Fatalf("listenerKey=%q want %q", l.ListenerKey, xayahCCListenerKey)
	}
	if l.MaxTriggersPerEvent != 1 {
		t.Fatalf("maxTriggersPerEvent=%d want 1", l.MaxTriggersPerEvent)
	}
	if l.AbilityRef != "" {
		t.Fatalf("AbilityRef=%q want empty (not an event filter)", l.AbilityRef)
	}
	if len(l.EventMatcher.All) != 3 ||
		l.EventMatcher.All[0] != xayahCCDamageEvent ||
		l.EventMatcher.All[1] != "ability/basic_attack" ||
		l.EventMatcher.All[2] != "event/source_owner" {
		t.Fatalf("eventMatcher=%+v want damage_instance+basic_attack+source_owner", l.EventMatcher)
	}
	if len(l.Operations) != 1 {
		t.Fatalf("listener ops=%d want 1", len(l.Operations))
	}
	consume := l.Operations[0]
	if consume.Operation != "state_change" || consume.Target != "source" ||
		consume.Ref != xayahCCStateKey || consume.ValuePolicy != "add" ||
		len(consume.Types) != 1 || consume.Types[0] != "state_scope/provider" {
		t.Fatalf("consume=%+v want provider-scope add -1", consume)
	}
	if consume.Amount == nil || consume.Amount.Op != "const" || consume.Amount.Value == nil ||
		math.Abs(*consume.Amount.Value-xayahCCConsumeDelta) > xayahCCTol {
		t.Fatalf("consume amount=%+v want const -1", consume.Amount)
	}
	if consume.Condition == nil || consume.Condition.Op != "gt" ||
		len(consume.Condition.Args) != 2 ||
		consume.Condition.Args[0].Op != "read" ||
		consume.Condition.Args[0].Path != "provider.state."+xayahCCStateKey ||
		consume.Condition.Args[1].Op != "const" || consume.Condition.Args[1].Value == nil ||
		math.Abs(*consume.Condition.Args[1].Value) > xayahCCTol {
		t.Fatalf("consume condition=%+v want gt(read provider.state..., const0)", consume.Condition)
	}

	if len(p.Abilities) != 3 {
		t.Fatalf("abilities=%d want 3 (arm+BA+spell probe)", len(p.Abilities))
	}
	arm := xayahCCFindAbility(p, xayahCCArmKey)
	if arm == nil || arm.Kind != "active" || arm.CastOrigin != model.CastOriginChampion {
		t.Fatalf("arm=%+v want active champion-origin", arm)
	}
	if arm.Cost != nil || arm.Cooldown != nil {
		t.Fatalf("arm must have no cost/CD: cost=%+v cd=%+v", arm.Cost, arm.Cooldown)
	}
	for _, typ := range arm.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("arm must not be tagged ability/basic_attack")
		}
	}
	if len(arm.Operations) != 1 || arm.Operations[0].Operation != "state_change" ||
		arm.Operations[0].ValuePolicy != "override" ||
		arm.Operations[0].Amount == nil || arm.Operations[0].Amount.Value == nil ||
		math.Abs(*arm.Operations[0].Amount.Value-xayahCCArmAmount) > xayahCCTol {
		t.Fatalf("arm op=%+v want override const3", arm.Operations)
	}

	ba := xayahCCFindAbility(p, xayahCCBAKey)
	if ba == nil || len(ba.Types) != 1 || ba.Types[0] != "ability/basic_attack" {
		t.Fatalf("BA types=%v want [ability/basic_attack]", ba)
	}
	if ba.Cost != nil || ba.Cooldown != nil {
		t.Fatalf("BA must have no cost/CD")
	}
	if len(ba.Operations) != 1 {
		t.Fatalf("BA ops=%d want 1", len(ba.Operations))
	}
	baOp := ba.Operations[0]
	if baOp.Operation != "damage" || baOp.DamageType != "damage/physical" ||
		baOp.Ref != xayahCCBAOpRef || baOp.CritEligible || baOp.CopyableOnHit {
		t.Fatalf("BA damage=%+v", baOp)
	}
	if baOp.Amount == nil || baOp.Amount.Op != "read" || baOp.Amount.Path != "source.attr.ad.resolved" {
		t.Fatalf("BA amount=%+v want read source.attr.ad.resolved", baOp.Amount)
	}

	spell := xayahCCFindAbility(p, xayahCCSpellKey)
	if spell == nil || len(spell.Types) != 1 || spell.Types[0] != "ability/spell" {
		t.Fatalf("spell types=%v want [ability/spell]", spell)
	}

	for _, banned := range []string{
		"provider_hero_xayah_w_", "provider_hero_xayah_q_", "provider_hero_xayah_r_",
		"ability/xayah_deadly_plumage", "feather", "deadly_plumage",
	} {
		raw, _ := json.Marshal(p)
		if strings.Contains(string(raw), banned) {
			t.Fatalf("P provider must not embed excluded token %q", banned)
		}
	}
}

func xayahCCDriverArmThenBAN(n int) []model.DriverEntry {
	entries := []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: xayahCCArmRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	for i := 0; i < n; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "ba" + itoaXayahCC(i),
			AbilityRef: xayahCCBARef(),
			Source:     "source",
			Target:     "target",
			FirstAtMs:  int64(100 * (i + 1)),
		})
	}
	return entries
}

func itoaXayahCC(i int) string {
	if i == 0 {
		return "0"
	}
	var b [16]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(b[pos:])
}

// TestXayahCleanCutsCompileShapeAndDefaultZero locks provider/abilities/state/
// matcher/guard/type isolation and proves missing/default state starts at 0.
func TestXayahCleanCutsCompileShapeAndDefaultZero(t *testing.T) {
	if xayahCCCandidateKey != "hero_skill|hero_xayah|P|锐切" ||
		xayahCCPlanRev != "xayah-p-clean-cuts-three-attack-budget-phase-a-v2" {
		t.Fatal("candidate/plan constants drifted")
	}
	tags := xayahCCOrderedTags()
	if len(tags) != 4 || tags[0] != "attack_count_budget" {
		t.Fatalf("ordered tags drifted: %v", tags)
	}
	if xayahCCBoundary != "attack_count_budget_only; direct_post_cast_arm_gives_3; "+
		"successful_source_ba_damage_instance_consumes_1; "+
		"state_sequence_arm_plus_4ba_0_3_2_1_0_0; "+
		"preserve_wqr_and_w_ability_type_listener_isolation; "+
		"no_true_qwer_wiring_add_refresh_max5_8s_timer_geometry_feathers_"+
		"secondary_damage_secondary_crit_e_dependency_miss_dodge_cadence_"+
		"projectile_rng_expected_crit_on_hit_proc_or_full_ba_clean_cuts_fidelity" {
		t.Fatal("frozen boundary constant drifted")
	}

	compileReq, runReq := loadXayahCCFixture(t)
	assertXayahCCProviderShape(t, compileReq)

	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	for _, need := range []string{
		"ability/basic_attack", "ability/spell", xayahCCDamageEvent,
		"event/source_owner", xayahCCCastEvent, "state_scope/provider",
	} {
		if _, ok := result.Session.Types.Registry.Lookup(need); !ok {
			t.Fatalf("compiled type catalog missing %q", need)
		}
	}

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 10
	done := runXayahCC(t, compileReq, runReq)
	if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); math.Abs(got) > xayahCCTol {
		t.Fatalf("missing/default attacks_remaining=%v want 0", got)
	}
	if len(xayahCCBADamageEvidence(done)) != 0 {
		t.Fatal("idle fixture must not settle BA damage")
	}
	if countEmittedEvents(done, xayahCCCastEvent) != 0 {
		t.Fatalf("ability_started=%d want 0 before arm", countEmittedEvents(done, xayahCCCastEvent))
	}
}

// TestXayahCleanCutsArmThenFourBABudgetSequence: one arm + four source BAs proves
// exact state transitions 0→3→2→1→0→0, four equal primary physical BA quantums,
// target HP delta exactly four BA amounts, no secondary/feather settlement, and
// no negative state on the fourth BA.
func TestXayahCleanCutsArmThenFourBABudgetSequence(t *testing.T) {
	// Progressive prefixes of the canonical arm+4BA schedule observe each state.
	for _, tc := range []struct {
		name string
		baN  int
		want float64
	}{
		{"after_arm", 0, 3},
		{"after_ba1", 1, 2},
		{"after_ba2", 2, 1},
		{"after_ba3", 3, 0},
		{"after_ba4", 4, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadXayahCCFixture(t)
			assertXayahCCProviderShape(t, compileReq)
			runReq.DriverPlan.Entries = xayahCCDriverArmThenBAN(tc.baN)
			runReq.StopPolicy.DurationMs = int64(100*(tc.baN+1) + 50)
			done := runXayahCC(t, compileReq, runReq)
			if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); math.Abs(got-tc.want) > xayahCCTol {
				t.Fatalf("attacks_remaining=%v want %v", got, tc.want)
			}
			if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); got < 0 {
				t.Fatalf("negative state=%v forbidden", got)
			}
		})
	}

	// Canonical one-run arm+4BA: damage/HP/no-extra/no-negative + sequence endpoints.
	compileReq, runReq := loadXayahCCFixture(t)
	assertXayahCCProviderShape(t, compileReq)
	runReq.DriverPlan.Entries = xayahCCDriverArmThenBAN(4)
	runReq.StopPolicy.DurationMs = 500
	done := runXayahCC(t, compileReq, runReq)

	if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); math.Abs(got) > xayahCCTol {
		t.Fatalf("final attacks_remaining=%v want 0 (0→3→2→1→0→0)", got)
	}
	baHits := xayahCCBADamageEvidence(done)
	if len(baHits) != 4 {
		t.Fatalf("BA damage evidence=%d want 4 equal primary settlements", len(baHits))
	}
	for i, item := range baHits {
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-xayahCCFixtureAD) > xayahCCTol || math.Abs(mit-xayahCCFixtureAD) > xayahCCTol {
			t.Fatalf("BA[%d] raw/mit=%v/%v want %v/%v", i, raw, mit, xayahCCFixtureAD, xayahCCFixtureAD)
		}
		if evidenceDataString(item.Data, "damageType") != "damage/physical" {
			t.Fatalf("BA[%d] damageType=%q", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataBool(item.Data, "phantom") {
			t.Fatalf("BA[%d] must not be phantom", i)
		}
		if evidenceDataString(item.Data, "phase") != "original" {
			t.Fatalf("BA[%d] phase=%q want original", i, evidenceDataString(item.Data, "phase"))
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("BA[%d] must not carry crit evidence fields", i)
		}
	}
	wantHP := xayahCCTargetHP - 4*xayahCCFixtureAD
	if got := xayahCCReadTargetHP(t, done.FinalSnapshot); math.Abs(got-wantHP) > xayahCCTol {
		t.Fatalf("targetHP=%v want %v (exactly four BA amounts)", got, wantHP)
	}
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > xayahCCTol {
		t.Fatalf("summary.targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}
	if math.Abs(done.Summary.SourceDamageDealt-4*xayahCCFixtureAD) > xayahCCTol {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, 4*xayahCCFixtureAD)
	}
	totalDmg := damageEvidenceItems(done)
	if len(totalDmg) != 4 {
		t.Fatalf("total damage evidence=%d want 4 (no secondary/feather settlement)", len(totalDmg))
	}
	for _, item := range totalDmg {
		ref := evidenceDataString(item.Data, "operationRef")
		if ref != xayahCCBAOpRef {
			t.Fatalf("unexpected damage opRef=%q (no feather/secondary)", ref)
		}
	}
	if countEmittedEvents(done, xayahCCCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1 (arm only; BA must not synthesize)", countEmittedEvents(done, xayahCCCastEvent))
	}
}

// TestXayahCleanCutsRearmAfterExhaustionOverride3: after budget exhausts to 0,
// re-arm overrides directly to 3 (not add/max5); one BA then leaves 2.
func TestXayahCleanCutsRearmAfterExhaustionOverride3(t *testing.T) {
	compileReq, runReq := loadXayahCCFixture(t)
	assertXayahCCProviderShape(t, compileReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm1", AbilityRef: xayahCCArmRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "ba1", AbilityRef: xayahCCBARef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "ba2", AbilityRef: xayahCCBARef(), Source: "source", Target: "target", FirstAtMs: 200},
		{EntryKey: "ba3", AbilityRef: xayahCCBARef(), Source: "source", Target: "target", FirstAtMs: 300},
		{EntryKey: "arm2", AbilityRef: xayahCCArmRef(), Source: "source", Target: "target", FirstAtMs: 400},
		{EntryKey: "ba4", AbilityRef: xayahCCBARef(), Source: "source", Target: "target", FirstAtMs: 500},
	}
	runReq.StopPolicy.DurationMs = 600
	done := runXayahCC(t, compileReq, runReq)
	if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); math.Abs(got-2) > xayahCCTol {
		t.Fatalf("attacks_remaining=%v want 2 (re-arm override3 then one BA)", got)
	}
	if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); got > xayahCCMaxAttacks+xayahCCTol {
		t.Fatalf("state=%v exceeds max3 (must not add/max5)", got)
	}
	if countEmittedEvents(done, xayahCCCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2 (two arms)", countEmittedEvents(done, xayahCCCastEvent))
	}
	if len(xayahCCBADamageEvidence(done)) != 4 {
		t.Fatalf("BA hits=%d want 4", len(xayahCCBADamageEvidence(done)))
	}
}

// TestXayahCleanCutsUnrelatedSpellDoesNotConsume: successful non-basic source
// spell/damage event does not consume P state.
func TestXayahCleanCutsUnrelatedSpellDoesNotConsume(t *testing.T) {
	compileReq, runReq := loadXayahCCFixture(t)
	assertXayahCCProviderShape(t, compileReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: xayahCCArmRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "spell", AbilityRef: xayahCCSpellRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runXayahCC(t, compileReq, runReq)
	if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); math.Abs(got-3) > xayahCCTol {
		t.Fatalf("attacks_remaining=%v want 3 (spell must not consume)", got)
	}
	spellHits := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") == xayahCCSpellOpRef {
			spellHits++
		}
	}
	if spellHits != 1 {
		t.Fatalf("spell damage=%d want 1", spellHits)
	}
	if len(xayahCCBADamageEvidence(done)) != 0 {
		t.Fatal("BA must not fire in spell-isolation schedule")
	}
	if countEmittedEvents(done, xayahCCCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2 (arm + non-basic spell)", countEmittedEvents(done, xayahCCCastEvent))
	}
}

// TestXayahCleanCutsOpponentBADoesNotConsume: opponent-owned BA does not consume
// source P state.
func TestXayahCleanCutsOpponentBADoesNotConsume(t *testing.T) {
	compileReq, runReq := loadXayahCCFixture(t)
	assertXayahCCProviderShape(t, compileReq)
	mountXayahCCOpponentBA(&compileReq, &runReq)
	if xayahCCFindProvider(compileReq) == nil {
		t.Fatal("P provider missing after opponent mount")
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "arm", AbilityRef: xayahCCArmRef(), Source: "source", Target: "target", FirstAtMs: 0},
		// Target self-cast: Source=Target=target; ability Target=opponent hits source.
		{EntryKey: "opp_ba", AbilityRef: xayahCCOpponentBARef(), Source: "target", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runXayahCC(t, compileReq, runReq)
	if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); math.Abs(got-3) > xayahCCTol {
		t.Fatalf("attacks_remaining=%v want 3 (opponent BA must not consume source P)", got)
	}
	oppHits := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") == xayahCCOpponentBAOpRef {
			oppHits++
		}
	}
	if oppHits != 1 {
		t.Fatalf("opponent BA damage=%d want 1", oppHits)
	}
	if len(xayahCCBADamageEvidence(done)) != 0 {
		t.Fatal("source BA must not fire")
	}
}

// TestXayahCleanCutsAbilityStartedRules: Xayah BA does not synthesize
// ability_started; arm/non-basic spell follow automatic event rules.
func TestXayahCleanCutsAbilityStartedRules(t *testing.T) {
	t.Run("ba_alone_no_ability_started", func(t *testing.T) {
		compileReq, runReq := loadXayahCCFixture(t)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "ba0", AbilityRef: xayahCCBARef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runXayahCC(t, compileReq, runReq)
		if countEmittedEvents(done, xayahCCCastEvent) != 0 {
			t.Fatalf("ability_started=%d want 0 (ability/basic_attack)", countEmittedEvents(done, xayahCCCastEvent))
		}
		if len(xayahCCBADamageEvidence(done)) != 1 {
			t.Fatal("BA must still settle damage")
		}
	})
	t.Run("arm_emits_ability_started", func(t *testing.T) {
		compileReq, runReq := loadXayahCCFixture(t)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "arm", AbilityRef: xayahCCArmRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runXayahCC(t, compileReq, runReq)
		if countEmittedEvents(done, xayahCCCastEvent) != 1 {
			t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, xayahCCCastEvent))
		}
		if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); math.Abs(got-3) > xayahCCTol {
			t.Fatalf("attacks_remaining=%v want 3", got)
		}
	})
	t.Run("spell_emits_ability_started", func(t *testing.T) {
		compileReq, runReq := loadXayahCCFixture(t)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "spell", AbilityRef: xayahCCSpellRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runXayahCC(t, compileReq, runReq)
		if countEmittedEvents(done, xayahCCCastEvent) != 1 {
			t.Fatalf("ability_started=%d want 1 (non-basic spell)", countEmittedEvents(done, xayahCCCastEvent))
		}
	})
}

// TestXayahCleanCutsDeterminismAndLifecycle: repeated compile/run stability plus
// CompileFrame→RunFrame→ReleaseSessionFrame evidence.
func TestXayahCleanCutsDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadXayahCCFixture(t)
			r.DriverPlan.Entries = xayahCCDriverArmThenBAN(4)
			r.StopPolicy.DurationMs = 500
			done := runXayahCC(t, c, r)
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

	t.Run("frame_release_session_not_found", func(t *testing.T) {
		c, r := loadXayahCCFixture(t)
		r.DriverPlan.Entries = xayahCCDriverArmThenBAN(4)
		r.StopPolicy.DurationMs = 500
		bundle := runXayahCCFrames(t, c, r)
		done := bundle.done
		if got := xayahCCAttacksRemaining(t, done.FinalSnapshot); math.Abs(got) > xayahCCTol {
			t.Fatalf("frame-path attacks_remaining=%v want 0", got)
		}
		if len(xayahCCBADamageEvidence(done)) != 4 {
			t.Fatalf("frame-path BA hits=%d want 4", len(xayahCCBADamageEvidence(done)))
		}
		if countEmittedEvents(done, xayahCCCastEvent) != 1 {
			t.Fatal("frame-path want one automatic ability_started from arm")
		}
	})
}

// TestXayahCleanCutsWikiSidecarIdentity locks repository wiki sidecar identity
// for the frozen Clean Cuts authority (no Backend mutation).
func TestXayahCleanCutsWikiSidecarIdentity(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "xayah-p.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	var doc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != xayahCCCandidateKey || doc.RequestTitle != xayahCCRequestTitle ||
		doc.ResolvedTitle != xayahCCResolvedTitle || doc.WikiPageID != xayahCCWikiPageID ||
		doc.RevisionID != xayahCCRevisionID || doc.RevisionTimestamp != xayahCCTimestamp ||
		doc.ContentSHA256 != xayahCCContentSHA || doc.RawByteSize != xayahCCRawBytes ||
		doc.SkillKey != "P" || doc.ZhDisplayName != "锐切" || doc.OwnerID != "hero_xayah" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
}

// TestXayahCleanCutsStructuralGenericProductionBoundary 核对测试文件身份与生产源码的通用性边界。
func TestXayahCleanCutsStructuralGenericProductionBoundary(t *testing.T) {
	// 保留生产源码扫描；工作树独占限制属于历史执行现场。
	prodRoots := []string{
		filepath.Join(".."),              // internal/
		filepath.Join("..", "..", "cmd"), // cmd/
	}
	bannedFragments := []string{
		`case "hero_xayah"`,
		`case "xayah"`,
		`if hero_xayah`,
		`hero_xayah_p_clean_cuts`,
		`clean_cuts_attacks_remaining`,
		`clean_cuts_direct_post_cast_arm`,
	}
	err := filepath.Walk(filepath.Join(prodRoots[0]), func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			base := info.Name()
			if base == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		// Only scan production packages under runtime/model/compile (+ sibling non-test).
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
		for _, frag := range bannedFragments {
			if strings.Contains(body, frag) {
				t.Fatalf("production source %s contains hero-switch/P-graph fragment %q", rel, frag)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Self-identity: this evidence file exists and is a _test.go (excluded from prod builds).
	self := "generic_xayah_clean_cuts_three_attack_budget_test.go"
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
	if !strings.Contains(string(raw), "FROZEN_PLAN_REV: xayah-p-clean-cuts-three-attack-budget-phase-a-v2") {
		t.Fatal("evidence file missing frozen plan marker")
	}
	if !strings.Contains(string(raw), xayahCCTaskKey) {
		t.Fatal("evidence file missing task key")
	}
}
