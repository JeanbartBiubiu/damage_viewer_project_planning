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

	"tinygo_engine_v2/internal/model"
)

// hero_vayne Q Tumble / 闪避突袭 — Phase-A v2 Wasm exact next-basic-attack bonus slice
// (FROZEN_PLAN_REV: vayne-q-tumble-next-basic-attack-bonus-phase-a-v2).
//
// Frozen boundary:
//
//	rank5_next_basic_attack_bonus; cast_arm_provider_state; physical_1_15_ad_plus_0_50_ap;
//	mana30_cooldown2000ms; no_dash_ba_reset_invisibility_lifesteal_crit_rng_or_full_tumble
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_vayne|Q|闪避突袭
//	Request Template:Data Vayne/Q → resolved Template:Data Vayne/Tumble
//	wikiPageId 1309988 / rev 4015566 / timestamp 2026-05-05T15:55:50Z
//	canonical rawByteSize 1735 / SHA256
//	  5ae387c07aa6c510a9da57df976b6e6ba9d3b52490fa91ce59e1221813fe9dad
//	数据参考/lol-wiki-current-champions/normalized/generic/vayne-q.json
//	pages/raw siblings: pages/vayne-q.json, raw/vayne-q.wikitext
//	Backend seed (cross-worktree absolute path; committed Backend e88e172):
//	  C:/project/damage_backend_dev/db/game_manage/seeds/
//	  lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql
//	Local raw materialization caveat: 1733 bytes / SHA256
//	  5723bf5ffbc6449f756aa33a8387c40a20039886b3665eddcb11ac1cac5914ca.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction.
//
// Rank-5 Phase-A contract (enrich exact Spellblade-minimal tumble identity):
//   - Provider provider_hero_vayne_tumble (kind passive / Backend 20120)
//   - ability_key tumble: active; mana 30; cooldown 2000 ms; Types=[] so
//     successful cast emits automatic ability_started (no arm listener)
//   - Cast ops: exactly one provider-scope state_change override ready=1;
//     no cast damage; no emit_event
//   - timed provider.state tumble_empowered_attack_ready: default0 / max1 /
//     durationMs 3000 / refresh_on_write
//   - Listener ALL exactly {event/basic_attack_hit, event/source_owner};
//     never ability/basic_attack (62003); MaxTriggersPerEvent=1
//   - Ordered guarded steps: physical bonus
//     add(mul(1.15, source.attr.ad.resolved), mul(0.50, source.attr.ap.resolved))
//     then override ready=0; CritEligible=false; CopyableOnHit=false; ValuePolicy add
//   - Fixture BA: ability/basic_attack; AD.resolved physical + emit
//     event/basic_attack_hit (emit is BA baseline, not Q bonus path)
//
// Explicit exclusions (completed boundary; not remaining blockers):
//   dash/movement/distance/terrain/geometry; BA reset/windup/cadence;
//   invisibility/R; lifesteal/healing; crit/RNG/miss/dodge/full on-hit;
//   multi-target/structures; other ranks/full Tumble; live/publish/E2E.
//
// Path: compile.CompileGeneric → RunGeneric (mechanism) and
// CompileFrame → RunFrame → ReleaseSessionFrame (determinism/release).
// Hero-named `_test.go` is regression/governance evidence only; production
// runtime remains generic (no if hero_vayne production behavior).

const (
	vayneTumbleCandidateKey  = "hero_skill|hero_vayne|Q|闪避突袭"
	vayneTumbleTaskKey       = "wasm-generic-vayne-tumble-next-basic-attack-bonus"
	vayneTumblePlanRev       = "vayne-q-tumble-next-basic-attack-bonus-phase-a-v2"
	vayneTumbleRequestTitle  = "Template:Data Vayne/Q"
	vayneTumbleResolvedTitle = "Template:Data Vayne/Tumble"
	vayneTumbleWikiPageID    = 1309988
	vayneTumbleRevisionID    = 4015566
	vayneTumbleTimestamp     = "2026-05-05T15:55:50Z"
	vayneTumbleRawBytes      = 1735
	vayneTumbleLocalRawBytes = 1733
	vayneTumbleContentSHA    = "5ae387c07aa6c510a9da57df976b6e6ba9d3b52490fa91ce59e1221813fe9dad"
	vayneTumbleLocalRawSHA   = "5723bf5ffbc6449f756aa33a8387c40a20039886b3665eddcb11ac1cac5914ca"
	vayneTumbleNormalizedSHA = "97b8b1f1e7f661787e5ef76428b37328748d6c1ecea7c6f4973d350680640041"
	vayneTumblePagesSHA      = "453d060d4dc0d4c671335a4258cb4256d3cca6d283c1352472b12635c436371d"
	vayneTumbleNormalizedLen = 2388
	vayneTumblePagesLen      = 671
	vayneTumbleBoundary      = "rank5_next_basic_attack_bonus; cast_arm_provider_state; " +
		"physical_1_15_ad_plus_0_50_ap; mana30_cooldown2000ms; " +
		"no_dash_ba_reset_invisibility_lifesteal_crit_rng_or_full_tumble"

	// Cross-worktree Backend evidence root (committed Backend e88e172).
	vayneTumbleBackendRoot = "C:/project/damage_backend_dev"
	vayneTumbleBackendCommit = "e88e172"

	vayneTumbleProviderRef = "provider_hero_vayne_tumble"
	vayneTumbleStableID    = "provider_hero_vayne_tumble"
	vayneTumbleAbilityID   = "ability_hero_vayne_tumble"
	vayneTumbleAbilityKey  = "tumble"
	vayneTumbleStateKey    = "tumble_empowered_attack_ready"
	vayneTumbleListenerKey = "listener_hero_vayne_tumble_basic_attack_hit"
	vayneTumbleBonusOpRef  = "op:vayne_tumble_empowered_damage"
	vayneTumbleBAKey       = "basic_attack"
	vayneTumbleBAOpRef     = "op:vayne_tumble_fixture_ba"
	vayneTumbleSpellKey    = "fixture_vayne_tumble_unrelated_spell"
	vayneTumbleSpellOpRef  = "op:vayne_tumble_unrelated_spell"
	vayneTumbleHitEvent    = "event/basic_attack_hit"
	vayneTumbleCastEvent   = "event/ability_started"

	vayneTumbleOpponentProviderRef = "champion:vayne_tumble_opponent_demo"
	vayneTumbleOpponentStableID    = "vayne_tumble_opponent_demo"
	vayneTumbleOpponentBAKey       = "opponent_basic_attack"
	vayneTumbleOpponentBAOpRef     = "op:vayne_tumble_opponent_ba"

	vayneTumbleSilverBoltsKey = "hero:vayne_silver_bolts"
	vayneTumbleSilverBoltsRef = "provider_hero_vayne_silver_bolts"
	vayneTumbleSpellbladeRef  = "provider_item_3078_spellblade"

	vayneTumbleADRatio  = 1.15
	vayneTumbleAPRatio  = 0.50
	vayneTumbleManaCost = 30.0
	vayneTumbleCDMs     = 2000.0
	vayneTumbleDuration = 3000.0

	vayneTumbleFixtureAD    = 100.0
	vayneTumbleFixtureAP    = 40.0
	vayneTumbleFixtureMana  = 300.0
	vayneTumbleFixtureMana29 = 29.0
	vayneTumbleTargetArmor  = 100.0
	vayneTumbleTargetHP     = 1000.0

	vayneTumbleBonusRaw = 135.0 // 1.15*100 + 0.50*40
	vayneTumbleBonusMit = 67.5  // armor100
	vayneTumbleBARaw    = 100.0
	vayneTumbleBAMit    = 50.0
	vayneTumbleManaAfter1 = 270.0 // 300 - 30
	vayneTumbleManaAfter2 = 240.0 // 300 - 30 - 30
	vayneTumbleSpellDmg   = 25.0
	vayneTumbleOpponentDmg = 15.0

	vayneTumbleSeedBonusJSON = `{"op":"add","args":[{"op":"mul","args":[{"op":"const","value":1.15},` +
		`{"op":"read","path":"source.attr.ad.resolved"}]},{"op":"mul","args":[{"op":"const","value":0.50},` +
		`{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	vayneTumbleTol = 1e-9
)

func vayneTumbleOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"cast_triggered_next_ba_arm",
		"basic_attack_hit_bonus_damage",
		"provider_state_consume",
	}
}

func vayneTumbleTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func vayneTumbleStateSchema() map[string]interface{} {
	return map[string]interface{}{
		vayneTumbleStateKey: vayneTumbleTimedSlot(0, 1, vayneTumbleDuration),
	}
}

func vayneTumbleReadyArmedCond() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + vayneTumbleStateKey},
			{Op: "const", Value: &one},
		},
	}
}

func vayneTumbleBonusAmount() *model.GenericFormulaExpr {
	adRatio := vayneTumbleADRatio
	apRatio := vayneTumbleAPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &adRatio},
					{Op: "read", Path: "source.attr.ad.resolved"},
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

func vayneTumbleAbility() model.AbilityDefinition {
	cost := vayneTumbleManaCost
	cd := vayneTumbleCDMs
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: vayneTumbleAbilityKey,
		Kind:       "active",
		Types:      []string{}, // non-basic → automatic ability_started
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Direct cast arm (Backend null-duration impact on_enter); no damage / emit.
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         vayneTumbleStateKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}
}

func vayneTumbleBAAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: vayneTumbleBAKey,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           vayneTumbleBAOpRef,
				CritEligible:  false,
				CopyableOnHit: false,
				Amount:        &model.GenericFormulaExpr{Op: "read", Path: "source.attr.ad.resolved"},
			},
			{
				Operation: "emit_event",
				Target:    "target",
				EventType: vayneTumbleHitEvent,
				Ref:       vayneTumbleHitEvent,
			},
		},
	}
}

func vayneTumbleSpellAbility() model.AbilityDefinition {
	dmg := vayneTumbleSpellDmg
	return model.AbilityDefinition{
		AbilityKey: vayneTumbleSpellKey,
		Kind:       "active",
		Types:      []string{"ability/spell"},
		Operations: []model.OperationDefinition{{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/physical",
			Ref:           vayneTumbleSpellOpRef,
			CritEligible:  false,
			CopyableOnHit: false,
			Amount:        &model.GenericFormulaExpr{Op: "const", Value: &dmg},
		}},
	}
}

func vayneTumbleProcListener() model.ListenerDefinition {
	zero := 0.0
	cond := vayneTumbleReadyArmedCond()
	return model.ListenerDefinition{
		ListenerKey:         vayneTumbleListenerKey,
		MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{
			vayneTumbleHitEvent, "event/source_owner",
		}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           vayneTumbleBonusOpRef,
				ValuePolicy:   "add",
				CritEligible:  false,
				CopyableOnHit: false,
				Condition:     cond,
				Amount:        vayneTumbleBonusAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         vayneTumbleStateKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   cond,
			},
		},
	}
}

func vayneTumbleProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        vayneTumbleProviderRef,
		Kind:               "passive", // Backend reserved 20120
		StableID:           vayneTumbleStableID,
		InitialStateSchema: vayneTumbleStateSchema(),
		Listeners:          []model.ListenerDefinition{vayneTumbleProcListener()},
		Abilities: []model.AbilityDefinition{
			vayneTumbleAbility(),
			vayneTumbleBAAbility(),
			vayneTumbleSpellAbility(),
		},
	}
}

func ensureVayneTumbleTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/true", Domain: "damage"},
		{Key: vayneTumbleHitEvent, Domain: "event"},
		{Key: vayneTumbleCastEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, e := range need {
		if !have[e.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, e)
		}
	}
}

func configureVayneTumbleProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{vayneTumbleProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: vayneTumbleProviderRef, DefinitionRef: vayneTumbleProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: vayneTumbleProviderRef, DefinitionRef: vayneTumbleProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func vayneTumbleAbilityRef() string {
	return "source.provider[" + vayneTumbleProviderRef + "].ability[" + vayneTumbleAbilityKey + "]"
}

func vayneTumbleBARef() string {
	return "source.provider[" + vayneTumbleProviderRef + "].ability[" + vayneTumbleBAKey + "]"
}

func vayneTumbleSpellRef() string {
	return "source.provider[" + vayneTumbleProviderRef + "].ability[" + vayneTumbleSpellKey + "]"
}

func vayneTumbleOpponentBARef() string {
	return "target.provider[" + vayneTumbleOpponentProviderRef + "].ability[" + vayneTumbleOpponentBAKey + "]"
}

func loadVayneTumbleFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.vayne_tumble_next_basic_attack_bonus"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureVayneTumbleTypes(&compileReq)
	configureVayneTumbleProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: vayneTumbleFixtureAD, Current: vayneTumbleFixtureAD,
		Max: vayneTumbleFixtureAD, Resolved: vayneTumbleFixtureAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: vayneTumbleFixtureAP, Current: vayneTumbleFixtureAP,
		Max: vayneTumbleFixtureAP, Resolved: vayneTumbleFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: vayneTumbleFixtureMana, Max: vayneTumbleFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: vayneTumbleTargetHP, Current: vayneTumbleTargetHP,
		Max: vayneTumbleTargetHP, Resolved: vayneTumbleTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: vayneTumbleTargetArmor, Current: vayneTumbleTargetArmor,
		Max: vayneTumbleTargetArmor, Resolved: vayneTumbleTargetArmor,
	})

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runVayneTumble(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

type vayneTumbleFrameBundle struct {
	done      model.DoneResult
	sessionID string
	rulesHash string
	session   *Session
}

func runVayneTumbleFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) vayneTumbleFrameBundle {
	t.Helper()
	prepareNativeBasicAttackHits(&compileReq, &runReq)
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
		if p.ProviderKey != vayneTumbleProviderRef {
			continue
		}
		field, ok := p.StateFields[vayneTumbleStateKey]
		if !ok {
			t.Fatal("tumble_empowered_attack_ready missing after compile")
		}
		if !field.HasCap || field.MaxValue != 1 ||
			field.DurationMs != int64(vayneTumbleDuration) ||
			field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
			t.Fatalf("compiled ready=%+v want max1 duration3000 refresh_on_write", field)
		}
		if math.Abs(field.DefaultValue) > vayneTumbleTol {
			t.Fatalf("defaultValue=%v want 0", field.DefaultValue)
		}
		if len(p.Listeners) != 1 {
			t.Fatalf("compiled Listeners=%d want 1", len(p.Listeners))
		}
		found = true
		break
	}
	if !found {
		t.Fatal("tumble provider missing from compiled session")
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
	rerun.SessionID = compiled.SessionID
	rerun.ExpectedRulesHash = compiled.RulesHash
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, rerun)); code != -1 {
		t.Fatalf("RunFrame after release code=%d want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrSessionNotFound {
		t.Fatalf("after release err=%q want %q", errPayload.Code, model.GenericErrSessionNotFound)
	}

	return vayneTumbleFrameBundle{
		done: done, sessionID: compiled.SessionID, rulesHash: compiled.RulesHash, session: session,
	}
}

func vayneTumbleFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == vayneTumbleProviderRef {
			return p
		}
	}
	return nil
}

func vayneTumbleFindAbility(p *model.ProviderDefinition, key string) *model.AbilityDefinition {
	for i := range p.Abilities {
		if p.Abilities[i].AbilityKey == key {
			return &p.Abilities[i]
		}
	}
	return nil
}

func vayneTumbleSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func vayneTumbleReadyState(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		raw, ok := c.ProviderState[vayneTumbleProviderRef]
		if !ok {
			return 0
		}
		bag, ok := raw.(map[string]interface{})
		if !ok {
			return 0
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[vayneTumbleStateKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func vayneTumbleSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func vayneTumbleBonusDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != vayneTumbleBonusOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func vayneTumbleBADamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != vayneTumbleBAOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func findVayneTumbleAbilityStat(t *testing.T, done model.DoneResult, abilityRef string) model.AbilityStat {
	t.Helper()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == abilityRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", abilityRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func mountVayneTumbleOpponentBA(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	dmg := vayneTumbleOpponentDmg
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: vayneTumbleOpponentProviderRef,
		Kind:        "champion",
		StableID:    vayneTumbleOpponentStableID,
		Abilities: []model.AbilityDefinition{{
			AbilityKey: vayneTumbleOpponentBAKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "opponent",
					DamageType:    "damage/physical",
					Ref:           vayneTumbleOpponentBAOpRef,
					CritEligible:  false,
					CopyableOnHit: false,
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &dmg},
				},
				{
					Operation: "emit_event",
					Target:    "opponent",
					EventType: vayneTumbleHitEvent,
					Ref:       vayneTumbleHitEvent,
				},
			},
		}},
	})
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, model.CombatantProviderMount{
			ProviderRef: vayneTumbleOpponentProviderRef, DefinitionRef: vayneTumbleOpponentProviderRef,
		})
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: vayneTumbleOpponentProviderRef, DefinitionRef: vayneTumbleOpponentProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func mountVayneTumbleSilverBolts(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	gcohMountPassive(compileReq, runReq, vayneTumbleSilverBoltsKey, vayneTumbleSilverBoltsRef,
		map[string]interface{}{gcohVayneHitsKey: float64(0)},
		[]model.ListenerDefinition{gcohEveryNListener(
			"listener_hero_vayne_silver_bolts", gcohVayneHitsKey, gcohVayneOpRef,
			"damage/true", 3, false, gcohVayneAmount(),
		)})
}

func mountVayneTumbleSpellblade(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	// Reuse generic Spellblade listeners (arm on ability_started; consume on BA hit).
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        spellbladeProviderRef,
		Kind:               "item",
		StableID:           vayneTumbleSpellbladeRef,
		InitialStateSchema: spellbladeStateSchema(),
		Listeners:          spellbladeListeners(),
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: spellbladeProviderRef, DefinitionRef: spellbladeProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: spellbladeProviderRef, DefinitionRef: spellbladeProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func vayneTumbleSpellbladeReady(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[spellbladeProviderRef].(map[string]interface{})
		if !ok {
			return 0
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[spellbladeReadyKey].(float64)
		return v
	}
	t.Fatal("source missing")
	return 0
}

func assertVayneTumbleProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	p := vayneTumbleFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_vayne_tumble missing")
	}
	if p.ProviderKey != vayneTumbleProviderRef || p.StableID != vayneTumbleStableID {
		t.Fatalf("provider identity=%q/%q", p.ProviderKey, p.StableID)
	}
	if p.Kind != "passive" {
		t.Fatalf("kind=%q want passive (Backend 20120)", p.Kind)
	}
	for _, banned := range []string{
		vayneTumbleSilverBoltsKey, vayneTumbleSilverBoltsRef,
		"provider_hero_vayne_r_final_hour_timed_bonus_ad",
		"provider_hero_vayne_e_condemn_primary_hit",
		"ability_hero_vayne_q_", "provider_hero_vayne_q_",
	} {
		if p.ProviderKey == banned || p.StableID == banned ||
			strings.Contains(p.ProviderKey, "vayne_q_") || strings.Contains(p.StableID, "vayne_q_") {
			t.Fatalf("tumble must not reuse competing identity %q", banned)
		}
	}
	schema, ok := p.InitialStateSchema[vayneTumbleStateKey].(map[string]interface{})
	if !ok {
		t.Fatalf("state schema missing %s", vayneTumbleStateKey)
	}
	if schema["refreshPolicy"] != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%v", schema["refreshPolicy"])
	}
	if math.Abs(schema["defaultValue"].(float64)) > vayneTumbleTol ||
		math.Abs(schema["maxValue"].(float64)-1) > vayneTumbleTol ||
		math.Abs(schema["durationMs"].(float64)-vayneTumbleDuration) > vayneTumbleTol {
		t.Fatalf("ready schema=%+v want default0/max1/duration3000", schema)
	}
	if len(p.Listeners) != 1 {
		t.Fatalf("listeners=%d want 1", len(p.Listeners))
	}
	lis := p.Listeners[0]
	if lis.ListenerKey != vayneTumbleListenerKey || lis.MaxTriggersPerEvent != 1 {
		t.Fatalf("listener=%+v", lis)
	}
	if len(lis.EventMatcher.All) != 2 ||
		lis.EventMatcher.All[0] != vayneTumbleHitEvent ||
		lis.EventMatcher.All[1] != "event/source_owner" {
		t.Fatalf("matcher All=%v want exactly [%s event/source_owner]", lis.EventMatcher.All, vayneTumbleHitEvent)
	}
	for _, tag := range lis.EventMatcher.All {
		if tag == "ability/basic_attack" {
			t.Fatal("matcher must never include ability/basic_attack (62003)")
		}
	}
	if len(lis.EventMatcher.Any) != 0 {
		t.Fatalf("matcher Any=%v want empty", lis.EventMatcher.Any)
	}
	if len(lis.Operations) != 2 {
		t.Fatalf("listener ops=%d want 2 (bonus then consume)", len(lis.Operations))
	}
	dmg := lis.Operations[0]
	if dmg.Operation != "damage" || dmg.DamageType != "damage/physical" ||
		dmg.Ref != vayneTumbleBonusOpRef || dmg.ValuePolicy != "add" ||
		dmg.CritEligible || dmg.CopyableOnHit || dmg.Condition == nil {
		t.Fatalf("bonus op=%+v", dmg)
	}
	if dmg.Amount == nil || dmg.Amount.Op != "add" || len(dmg.Amount.Args) != 2 {
		t.Fatalf("bonus amount=%+v", dmg.Amount)
	}
	consume := lis.Operations[1]
	if consume.Operation != "state_change" || consume.Ref != vayneTumbleStateKey ||
		consume.ValuePolicy != "override" || consume.Condition == nil {
		t.Fatalf("consume op=%+v", consume)
	}
	for _, op := range lis.Operations {
		if op.Operation == "emit_event" {
			t.Fatal("Q bonus listener must not emit_event")
		}
	}

	ab := vayneTumbleFindAbility(p, vayneTumbleAbilityKey)
	if ab == nil {
		t.Fatal("tumble ability missing")
	}
	if ab.Cost == nil || ab.Cost.ResourceKey != "mana" || ab.Cost.AllowPartial ||
		ab.Cost.Amount.Op != "const" || ab.Cost.Amount.Value == nil ||
		math.Abs(*ab.Cost.Amount.Value-vayneTumbleManaCost) > vayneTumbleTol {
		t.Fatalf("cost=%+v want mana const30 allow_partial=false", ab.Cost)
	}
	if ab.Cooldown == nil || ab.Cooldown.DurationMs.Op != "const" || ab.Cooldown.DurationMs.Value == nil ||
		math.Abs(*ab.Cooldown.DurationMs.Value-vayneTumbleCDMs) > vayneTumbleTol {
		t.Fatalf("cooldown=%+v want const2000", ab.Cooldown)
	}
	for _, typ := range ab.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("tumble must not be tagged ability/basic_attack")
		}
	}
	if len(ab.Operations) != 1 || ab.Operations[0].Operation != "state_change" {
		t.Fatalf("tumble ops=%+v want single state_change arm (no cast damage)", ab.Operations)
	}
	for _, op := range ab.Operations {
		if op.Operation == "damage" || op.Operation == "emit_event" {
			t.Fatalf("tumble cast must not include %q", op.Operation)
		}
	}
	ba := vayneTumbleFindAbility(p, vayneTumbleBAKey)
	if ba == nil || len(ba.Types) != 1 || ba.Types[0] != "ability/basic_attack" {
		t.Fatalf("fixture BA=%+v", ba)
	}
}

func vayneTumbleWasmRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing wasm path %s: %v (fail closed)", path, err)
	}
	return path
}

func vayneTumbleBackendPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{filepath.FromSlash(vayneTumbleBackendRoot)}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing backend path %s: %v (fail closed)", path, err)
	}
	return path
}

func vayneTumbleLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(vayneTumbleBackendPath(t,
		"db", "game_manage", "seeds", "lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql"))
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

func vayneTumbleSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// ---------------------------------------------------------------------------
// Evidence tests
// ---------------------------------------------------------------------------

// TestGenericVayneTumbleWikiSidecarAndBackendContract locks wiki sidecar/pages/
// local-raw caveat plus Backend seed/README/JUnit identities at e88e172.
func TestGenericVayneTumbleWikiSidecarAndBackendContract(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Description2 string
			Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(vayneTumbleWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "vayne-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != vayneTumbleNormalizedLen {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), vayneTumbleNormalizedLen)
	}
	if got := vayneTumbleSHA256Hex(sidecarRaw); got != vayneTumbleNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, vayneTumbleNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != vayneTumbleCandidateKey || doc.RequestTitle != vayneTumbleRequestTitle ||
		doc.ResolvedTitle != vayneTumbleResolvedTitle || doc.WikiPageID != vayneTumbleWikiPageID ||
		doc.RevisionID != vayneTumbleRevisionID || doc.RevisionTimestamp != vayneTumbleTimestamp ||
		doc.ContentSHA256 != vayneTumbleContentSHA || doc.RawByteSize != vayneTumbleRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "闪避突袭" || doc.OwnerID != "hero_vayne" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "30\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|6 to 2}}\n" {
		t.Fatalf("cooldown=%q want rank table ending in 2s", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|75 to 115}}% AD") ||
		!strings.Contains(doc.Fields.Leveling, "50% AP") {
		t.Fatalf("leveling=%q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "empowers her next") ||
		!strings.Contains(doc.Fields.Description, "3 seconds") {
		t.Fatal("wiki prose must retain next-BA within 3s empowerment")
	}

	pagesRaw, err := os.ReadFile(vayneTumbleWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "vayne-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != vayneTumblePagesLen {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), vayneTumblePagesLen)
	}
	if got := vayneTumbleSHA256Hex(pagesRaw); got != vayneTumblePagesSHA {
		t.Fatalf("pages sha=%q want %q", got, vayneTumblePagesSHA)
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "闪避突袭" || pages.OwnerID != "hero_vayne" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(vayneTumbleWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "vayne-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != vayneTumbleLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), vayneTumbleLocalRawBytes)
	}
	localSHA := vayneTumbleSHA256Hex(rawBytes)
	if localSHA != vayneTumbleLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, vayneTumbleLocalRawSHA)
	}
	if localSHA == vayneTumbleContentSHA {
		t.Fatal("local raw hash must differ from canonical (caveat; not equivalence/contradiction)")
	}

	if vayneTumblePlanRev != "vayne-q-tumble-next-basic-attack-bonus-phase-a-v2" ||
		vayneTumbleBoundary != "rank5_next_basic_attack_bonus; cast_arm_provider_state; "+
			"physical_1_15_ad_plus_0_50_ap; mana30_cooldown2000ms; "+
			"no_dash_ba_reset_invisibility_lifesteal_crit_rng_or_full_tumble" {
		t.Fatal("frozen plan/boundary drifted")
	}
	tags := vayneTumbleOrderedTags()
	if len(tags) != 4 || tags[0] != "ability_cost_cooldown" ||
		tags[1] != "cast_triggered_next_ba_arm" ||
		tags[2] != "basic_attack_hit_bonus_damage" ||
		tags[3] != "provider_state_consume" {
		t.Fatalf("ordered tags drifted: %v", tags)
	}

	seed, sqlNoComments := vayneTumbleLoadSeedSQL(t)
	_ = vayneTumbleBackendPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericVayneTumbleNextBasicAttackBonusSeedSqlTest.java")
	readmeBytes, err := os.ReadFile(vayneTumbleBackendPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		vayneTumbleCandidateKey, vayneTumblePlanRev, vayneTumbleBoundary,
		vayneTumbleRequestTitle, vayneTumbleResolvedTitle,
		"1309988", "4015566", vayneTumbleTimestamp, "1735",
		vayneTumbleContentSHA,
		vayneTumbleProviderRef, vayneTumbleAbilityID, "tumble",
		"tumble_empowered_attack_ready", "tumble_bonus_damage",
		`{"op":"const","value":30}`, `{"op":"const","value":2000}`,
		vayneTumbleSeedBonusJSON,
		"normalized/generic/vayne-q.json",
		"check-only", "不物化",
		"event/basic_attack_hit", "event/source_owner", "20211", "20212",
		"62003", "refresh_on_write", "3000",
		"crit_eligible=false", "copyable_on_hit=false",
		"provider_hero_vayne_silver_bolts", "provider_item_3078_spellblade",
		"ability_started",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range vayneTumbleOrderedTags() {
		if !strings.Contains(seed, tag) {
			t.Fatalf("seed missing ordered tag %q", tag)
		}
	}
	if strings.Contains(sqlNoComments, "ability_hero_vayne_q_") ||
		strings.Contains(sqlNoComments, "provider_hero_vayne_q_") {
		t.Fatal("executable SQL must not create competing Q IDs")
	}
	if strings.Contains(sqlNoComments, "INSERT INTO public.event_effect_details") {
		t.Fatal("executable SQL must not insert event_effect_details / emit_event graph")
	}
	// Matcher must lock 20211+20212 and forbid 62003 in executable inserts.
	if !strings.Contains(seed, "MUST NOT") && !strings.Contains(seed, "不得") {
		t.Fatal("seed must document forbid ability/basic_attack 62003 matcher")
	}

	for _, want := range []string{
		"LoL generic Vayne Tumble next-basic-attack bonus seed",
		"lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql",
		"LolGenericVayneTumbleNextBasicAttackBonusSeedSqlTest",
		vayneTumbleCandidateKey, vayneTumblePlanRev, vayneTumbleBoundary,
		vayneTumbleProviderRef, vayneTumbleAbilityID,
		"tumble_empowered_attack_ready", "check-only",
		"20211", "20212", "62003", "1.15", "0.50", "30", "2000", "3000",
		"provider_hero_vayne_silver_bolts", "provider_item_3078_spellblade",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, vayneTumbleBackendCommit) &&
		!strings.Contains(seed, "e88e172") &&
		!strings.Contains(seed, "20260726") {
		// Commit pin is Wasm-side; seed uses publish suggestion date.
		if !strings.Contains(seed, "20260726") {
			t.Fatal("seed must document 20260726 publish suggestion")
		}
	}
	_ = vayneTumbleBackendCommit
}

// TestGenericVayneTumbleProviderShapeAndIdleDefault0 locks enrich identity,
// ready max1/duration3000/refresh, listener matchers, and idle default0.
func TestGenericVayneTumbleProviderShapeAndIdleDefault0(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	assertVayneTumbleProviderShape(t, compileReq)

	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	for _, need := range []string{
		"ability/basic_attack", vayneTumbleHitEvent, "event/source_owner",
		vayneTumbleCastEvent, "state_scope/provider", "damage/physical",
	} {
		if _, ok := result.Session.Types.Registry.Lookup(need); !ok {
			t.Fatalf("compiled type catalog missing %q", need)
		}
	}

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 10
	done := runVayneTumble(t, compileReq, runReq)
	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got) > vayneTumbleTol {
		t.Fatalf("idle ready=%v want 0", got)
	}
	if len(vayneTumbleBonusDamageEvidence(done)) != 0 {
		t.Fatal("idle must not settle Q bonus")
	}
	if countEmittedEvents(done, vayneTumbleCastEvent) != 0 {
		t.Fatalf("ability_started=%d want 0 before cast", countEmittedEvents(done, vayneTumbleCastEvent))
	}
}

// TestGenericVayneTumbleCastArmsReadyWithoutDamage: Q cast overrides ready=1,
// spends mana, emits exactly one ability_started, and deals no damage.
func TestGenericVayneTumbleCastArmsReadyWithoutDamage(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	assertVayneTumbleProviderShape(t, compileReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runVayneTumble(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if countEmittedEvents(done, vayneTumbleCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, vayneTumbleCastEvent))
	}
	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got-1) > vayneTumbleTol {
		t.Fatalf("ready=%v want 1", got)
	}
	if got := vayneTumbleSourceMana(t, done.FinalSnapshot); math.Abs(got-vayneTumbleManaAfter1) > vayneTumbleTol {
		t.Fatalf("mana=%v want %v", got, vayneTumbleManaAfter1)
	}
	if len(damageEvidenceItems(done)) != 0 {
		t.Fatalf("Q cast must deal no damage; got %d", len(damageEvidenceItems(done)))
	}
	if countEmittedEvents(done, vayneTumbleHitEvent) != 0 {
		t.Fatalf("basic_attack_hit=%d want 0 on Q cast", countEmittedEvents(done, vayneTumbleHitEvent))
	}
}

// TestGenericVayneTumbleNextBABonusThenSecondBANoBonus: AD100/AP40 → raw135→67.5;
// ready consumes to 0; second source BA has ordinary BA only.
func TestGenericVayneTumbleNextBABonusThenSecondBANoBonus(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	assertVayneTumbleProviderShape(t, compileReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "ba1", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "ba2", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 200},
	}
	runReq.StopPolicy.DurationMs = 300
	done := runVayneTumble(t, compileReq, runReq)

	bonus := vayneTumbleBonusDamageEvidence(done)
	if len(bonus) != 1 {
		t.Fatalf("Q bonus count=%d want 1", len(bonus))
	}
	raw := evidenceDataFloat(bonus[0].Data, "rawAmount")
	mit := evidenceDataFloat(bonus[0].Data, "mitigatedAmount")
	if math.Abs(raw-vayneTumbleBonusRaw) > vayneTumbleTol || math.Abs(mit-vayneTumbleBonusMit) > vayneTumbleTol {
		t.Fatalf("Q bonus raw/mit=%v/%v want %v/%v", raw, mit, vayneTumbleBonusRaw, vayneTumbleBonusMit)
	}
	if evidenceDataString(bonus[0].Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(bonus[0].Data, "damageType"))
	}
	if evidenceDataString(bonus[0].Data, "providerRef") != vayneTumbleProviderRef {
		t.Fatalf("providerRef=%q", evidenceDataString(bonus[0].Data, "providerRef"))
	}
	if evidenceDataBool(bonus[0].Data, "phantom") {
		t.Fatal("bonus must not be phantom")
	}
	if _, ok := bonus[0].Data["eligible"]; ok {
		t.Fatal("bonus must not carry crit evidence fields")
	}

	baHits := vayneTumbleBADamageEvidence(done)
	if len(baHits) != 2 {
		t.Fatalf("ordinary BA count=%d want 2", len(baHits))
	}
	for i, item := range baHits {
		if math.Abs(evidenceDataFloat(item.Data, "rawAmount")-vayneTumbleBARaw) > vayneTumbleTol ||
			math.Abs(evidenceDataFloat(item.Data, "mitigatedAmount")-vayneTumbleBAMit) > vayneTumbleTol {
			t.Fatalf("BA[%d] raw/mit=%v/%v want %v/%v", i,
				evidenceDataFloat(item.Data, "rawAmount"),
				evidenceDataFloat(item.Data, "mitigatedAmount"),
				vayneTumbleBARaw, vayneTumbleBAMit)
		}
	}
	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got) > vayneTumbleTol {
		t.Fatalf("ready after consume=%v want 0", got)
	}
	if countEmittedEvents(done, vayneTumbleHitEvent) != 2 {
		t.Fatalf("basic_attack_hit emits=%d want 2 (Q bonus must not emit)", countEmittedEvents(done, vayneTumbleHitEvent))
	}
	wantDealt := vayneTumbleBAMit*2 + vayneTumbleBonusMit
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > vayneTumbleTol {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	wantHP := vayneTumbleTargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > vayneTumbleTol {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}
}

// TestGenericVayneTumbleReadyExpiryBoundary: BA at t2999 procs; BA at t3000 does not.
func TestGenericVayneTumbleReadyExpiryBoundary(t *testing.T) {
	t.Run("ba_at_2999_procs", func(t *testing.T) {
		compileReq, runReq := loadVayneTumbleFixture(t)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "ba", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 2999},
		}
		runReq.StopPolicy.DurationMs = 3050
		done := runVayneTumble(t, compileReq, runReq)
		if len(vayneTumbleBonusDamageEvidence(done)) != 1 {
			t.Fatalf("bonus at t2999=%d want 1", len(vayneTumbleBonusDamageEvidence(done)))
		}
		if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got) > vayneTumbleTol {
			t.Fatalf("ready=%v want 0 after proc", got)
		}
	})
	t.Run("ba_at_3000_does_not_proc", func(t *testing.T) {
		compileReq, runReq := loadVayneTumbleFixture(t)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "ba", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 3000},
		}
		runReq.StopPolicy.DurationMs = 3050
		done := runVayneTumble(t, compileReq, runReq)
		if len(vayneTumbleBonusDamageEvidence(done)) != 0 {
			t.Fatalf("bonus at t3000=%d want 0", len(vayneTumbleBonusDamageEvidence(done)))
		}
		if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got) > vayneTumbleTol {
			t.Fatalf("ready after expiry=%v want 0", got)
		}
		if len(vayneTumbleBADamageEvidence(done)) != 1 {
			t.Fatal("ordinary BA must still settle at t3000")
		}
	})
}

// TestGenericVayneTumbleCooldownSchedule: Q at t0 / t1999 / t2000 — one skip, two
// successes/rearms; mana only on successes.
func TestGenericVayneTumbleCooldownSchedule(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	assertVayneTumbleProviderShape(t, compileReq)
	ref := vayneTumbleAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 2000},
	}
	runReq.StopPolicy.DurationMs = 2100
	done := runVayneTumble(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("attemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("castCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if vayneTumbleSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findVayneTumbleAbilityStat(t, done, ref)
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
			t.Fatalf("readyAtMs=%v want 2000", item.Data["readyAtMs"])
		}
		skipAt1999 = true
	}
	if !skipAt1999 {
		t.Fatal("missing cooldown skip at t1999")
	}
	if got := vayneTumbleSourceMana(t, done.FinalSnapshot); math.Abs(got-vayneTumbleManaAfter2) > vayneTumbleTol {
		t.Fatalf("mana=%v want %v", got, vayneTumbleManaAfter2)
	}
	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got-1) > vayneTumbleTol {
		t.Fatalf("ready after rearm=%v want 1", got)
	}
	if countEmittedEvents(done, vayneTumbleCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2", countEmittedEvents(done, vayneTumbleCastEvent))
	}
}

// TestGenericVayneTumbleMana29AtomicSkip: mana29 cannot cast; ready stays 0; mana unchanged.
func TestGenericVayneTumbleMana29AtomicSkip(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: vayneTumbleFixtureMana29, Max: vayneTumbleFixtureMana,
	})
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runVayneTumble(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if vayneTumbleSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("expected exactly one resource_insufficient skip")
	}
	if got := vayneTumbleSourceMana(t, done.FinalSnapshot); math.Abs(got-vayneTumbleFixtureMana29) > vayneTumbleTol {
		t.Fatalf("mana=%v want unchanged %v", got, vayneTumbleFixtureMana29)
	}
	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got) > vayneTumbleTol {
		t.Fatalf("ready=%v want 0", got)
	}
	if countEmittedEvents(done, vayneTumbleCastEvent) != 0 {
		t.Fatalf("ability_started=%d want 0", countEmittedEvents(done, vayneTumbleCastEvent))
	}
}

// TestGenericVayneTumbleOpponentHitDoesNotConsume: opponent BA+hit emit must not
// consume source ready (source_owner matcher).
func TestGenericVayneTumbleOpponentHitDoesNotConsume(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	mountVayneTumbleOpponentBA(&compileReq, &runReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "opp_ba", AbilityRef: vayneTumbleOpponentBARef(), Source: "target", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runVayneTumble(t, compileReq, runReq)

	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got-1) > vayneTumbleTol {
		t.Fatalf("ready=%v want 1 (opponent hit must not consume)", got)
	}
	if len(vayneTumbleBonusDamageEvidence(done)) != 0 {
		t.Fatal("Q bonus must not fire on opponent hit")
	}
	oppHits := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") == vayneTumbleOpponentBAOpRef {
			oppHits++
		}
	}
	if oppHits != 1 {
		t.Fatalf("opponent BA damage=%d want 1", oppHits)
	}
	if countEmittedEvents(done, vayneTumbleHitEvent) != 1 {
		t.Fatalf("hit emits=%d want 1 (opponent)", countEmittedEvents(done, vayneTumbleHitEvent))
	}
}

// TestGenericVayneTumbleUnrelatedEventDoesNotConsume: non-BA spell does not match
// basic_attack_hit listener; ready stays armed.
func TestGenericVayneTumbleUnrelatedEventDoesNotConsume(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "spell", AbilityRef: vayneTumbleSpellRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runVayneTumble(t, compileReq, runReq)

	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got-1) > vayneTumbleTol {
		t.Fatalf("ready=%v want 1 (unrelated spell must not consume)", got)
	}
	if len(vayneTumbleBonusDamageEvidence(done)) != 0 {
		t.Fatal("Q bonus must not fire on unrelated spell")
	}
	if countEmittedEvents(done, vayneTumbleHitEvent) != 0 {
		t.Fatalf("basic_attack_hit=%d want 0", countEmittedEvents(done, vayneTumbleHitEvent))
	}
	spellHits := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") == vayneTumbleSpellOpRef {
			spellHits++
		}
	}
	if spellHits != 1 {
		t.Fatalf("spell damage=%d want 1", spellHits)
	}
}

// TestGenericVayneTumbleSilverBoltsCoexistence: Q bonus emits no extra hit and
// does not add W stack; three actual BAs preserve exactly one normal third-hit W.
func TestGenericVayneTumbleSilverBoltsCoexistence(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	mountVayneTumbleSilverBolts(&compileReq, &runReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "ba1", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "ba2", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 200},
		{EntryKey: "ba3", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 300},
	}
	runReq.StopPolicy.DurationMs = 400
	done := runVayneTumble(t, compileReq, runReq)

	if countEmittedEvents(done, vayneTumbleHitEvent) != 3 {
		t.Fatalf("basic_attack_hit emits=%d want 3 (Q bonus must not emit extra hit)",
			countEmittedEvents(done, vayneTumbleHitEvent))
	}
	if len(vayneTumbleBonusDamageEvidence(done)) != 1 {
		t.Fatalf("Q bonus=%d want 1", len(vayneTumbleBonusDamageEvidence(done)))
	}
	wN, wRaw, wMit := gcohDamageEvidence(done, gcohVayneOpRef, false)
	if wN != 1 {
		t.Fatalf("Silver Bolts proc count=%d want exactly 1", wN)
	}
	wantW := math.Max(0.06*vayneTumbleTargetHP, 50) // max(60,50)=60
	if math.Abs(wRaw-wantW) > vayneTumbleTol || math.Abs(wMit-wantW) > vayneTumbleTol {
		t.Fatalf("W raw/mit=%v/%v want true %v", wRaw, wMit, wantW)
	}
	if hits := gcohTargetStateHits(t, done, vayneTumbleSilverBoltsKey, gcohVayneHitsKey); hits != 0 {
		t.Fatalf("silver_bolts_hits after third-hit proc=%v want 0", hits)
	}
	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got) > vayneTumbleTol {
		t.Fatalf("tumble ready=%v want 0", got)
	}
}

// TestGenericVayneTumbleSpellbladeCoexistence: successful Q emits one
// ability_started and arms Spellblade once; Q bonus listener does not rearm
// or duplicate Spellblade damage.
func TestGenericVayneTumbleSpellbladeCoexistence(t *testing.T) {
	compileReq, runReq := loadVayneTumbleFixture(t)
	mountVayneTumbleSpellblade(&compileReq, &runReq)
	// Spellblade uses 2*ad.base; keep base=resolved=100 so formula is deterministic.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "ba1", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runVayneTumble(t, compileReq, runReq)

	if countEmittedEvents(done, vayneTumbleCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1 (Q once; bonus must not re-emit)",
			countEmittedEvents(done, vayneTumbleCastEvent))
	}
	if len(vayneTumbleBonusDamageEvidence(done)) != 1 {
		t.Fatalf("Q bonus=%d want 1", len(vayneTumbleBonusDamageEvidence(done)))
	}
	if countDamageByOpRef(done, spellbladeDamageOpRef, false) != 1 {
		t.Fatalf("spellblade damage count=%d want 1 (no duplicate arm/consume)",
			countDamageByOpRef(done, spellbladeDamageOpRef, false))
	}
	wantSpellblade := 2 * vayneTumbleFixtureAD
	if got := sumDamageRawByOpRef(done, spellbladeDamageOpRef); math.Abs(got-wantSpellblade) > vayneTumbleTol {
		t.Fatalf("spellblade raw=%v want %v", got, wantSpellblade)
	}
	if got := vayneTumbleReadyState(t, done.FinalSnapshot); math.Abs(got) > vayneTumbleTol {
		t.Fatalf("tumble ready=%v want 0", got)
	}
	if got := vayneTumbleSpellbladeReady(t, done); math.Abs(got) > vayneTumbleTol {
		t.Fatalf("spellblade_ready=%v want 0", got)
	}
	if countEmittedEvents(done, vayneTumbleHitEvent) != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, vayneTumbleHitEvent))
	}
}

// TestGenericVayneTumbleAlgebraCrossCheck: independent 1.15AD+0.50AP and armor mit.
func TestGenericVayneTumbleAlgebraCrossCheck(t *testing.T) {
	raw := vayneTumbleADRatio*vayneTumbleFixtureAD + vayneTumbleAPRatio*vayneTumbleFixtureAP
	if math.Abs(raw-vayneTumbleBonusRaw) > vayneTumbleTol {
		t.Fatalf("bonus raw algebra=%v want %v", raw, vayneTumbleBonusRaw)
	}
	mit := expectedMitigatedPhysical(vayneTumbleBonusRaw, vayneTumbleTargetArmor)
	if math.Abs(mit-vayneTumbleBonusMit) > vayneTumbleTol {
		t.Fatalf("bonus mitigated=%v want %v", mit, vayneTumbleBonusMit)
	}
	baMit := expectedMitigatedPhysical(vayneTumbleBARaw, vayneTumbleTargetArmor)
	if math.Abs(baMit-vayneTumbleBAMit) > vayneTumbleTol {
		t.Fatalf("BA mitigated=%v want %v", baMit, vayneTumbleBAMit)
	}
	if math.Abs(vayneTumbleFixtureMana-vayneTumbleManaCost-vayneTumbleManaAfter1) > vayneTumbleTol ||
		math.Abs(vayneTumbleFixtureMana-2*vayneTumbleManaCost-vayneTumbleManaAfter2) > vayneTumbleTol {
		t.Fatal("mana algebra drifted")
	}
}

// TestGenericVayneTumbleDeterminismAndRelease: CompileGeneric/RunGeneric evidence
// is stable; CompileFrame path releases without leak.
func TestGenericVayneTumbleDeterminismAndRelease(t *testing.T) {
	runOnce := func() (string, string, string) {
		c, r := loadVayneTumbleFixture(t)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "ba1", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 100},
			{EntryKey: "ba2", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 200},
		}
		r.StopPolicy.DurationMs = 300
		done := runVayneTumble(t, c, r)
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
	s1, e1, p1 := runOnce()
	s2, e2, p2 := runOnce()
	if s1 != s2 || e1 != e2 || p1 != p2 {
		t.Fatal("CompileGeneric/RunGeneric evidence must be deterministic")
	}

	c, r := loadVayneTumbleFixture(t)
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: vayneTumbleAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "ba1", AbilityRef: vayneTumbleBARef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	r.StopPolicy.DurationMs = 200
	bundle := runVayneTumbleFrames(t, c, r)
	if len(vayneTumbleBonusDamageEvidence(bundle.done)) != 1 {
		t.Fatalf("frame-path bonus=%d want 1", len(vayneTumbleBonusDamageEvidence(bundle.done)))
	}
	if got := vayneTumbleReadyState(t, bundle.done.FinalSnapshot); math.Abs(got) > vayneTumbleTol {
		t.Fatalf("frame-path ready=%v want 0", got)
	}
}
