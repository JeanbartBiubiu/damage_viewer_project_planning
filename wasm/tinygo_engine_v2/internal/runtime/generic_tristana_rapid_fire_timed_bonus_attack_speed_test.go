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

// hero_tristana Q Rapid Fire / 急速射击 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: tristana-q-rapid-fire-timed-bonus-attack-speed-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent;
//	cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot;
//	no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity
//
// Ordered tags:
//  1. ability_cost_cooldown
//  2. active_attack_speed_modifier
//  3. timed_state
//  4. ability_type_listener_isolation
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_tristana|Q|急速射击
//	task wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed
//	Request Template:Data Tristana/Q → resolved Template:Data Tristana/Rapid Fire
//	wikiPageId 1308522 / rev 4026462 / timestamp 2026-06-09T21:59:03Z
//	canonical rawByteSize 872 / SHA256
//	  f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da
//	数据参考/lol-wiki-current-champions/normalized/generic/tristana-q.json
//	pages/raw siblings: pages/tristana-q.json, raw/tristana-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql
//	Local raw materialization caveat: 866 bytes / SHA256
//	  db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170.
//	Serialization caveat only; assert sidecar/pages canonical identity + caveat;
//	do not claim local-raw equivalence or source contradiction.
//
// Rank-5 Phase-A contract (Xayah W ability-type listener isolation + timed AS;
// Kai'Sa E / Vayne R timed modifier lifecycle; same-package Buster Shot for Q/R):
//   - Independent provider provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed
//     (passive 20120; standalone; coexist with R without dependency/synthesis)
//   - ability ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed key
//     rapid_fire_timed_bonus_attack_speed: active; mana 35; CD 16000 ms;
//     typed ability/tristana_rapid_fire (DB game-local 62013, reserved_type_id NULL)
//   - timed provider.state rapid_fire_active: default0 / max1 / 7000ms /
//     refresh_on_write (runtime representation; do not claim policy itself
//     non-refreshing — normal recast cannot refresh because CD16000 > duration7000)
//   - listener AbilityRef empty; ALL matcher exactly
//     {event/ability_started, event/source_owner, ability/tristana_rapid_fire};
//     one state_change override const1 → rapid_fire_active
//   - attack_speed percent_add: mul(const 1.20, read provider.state.rapid_fire_active)
//   - zero Q damage/heal/shield/control/repeat/explicit-event ops; successful Q
//     relies on one automatic ability_started
//   - check-only Backend identity/attack_speed/mana; fixture may supply values
//     but must not claim materialization
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   rank-up update; attack animation/windup; basic attack count/rotation;
//   cooldown bypass/reset/direct state admin; ranks1-4; P/W/E/basic/Explosive Charge/
//   loadout; identity/panel/resource bootstrap; Q damage/heal/shield/control/repeat/
//   explicit event; Buster Shot dependency/synthesis; live migration/publish/E2E/
//   full fidelity.
//
// Path: compile.CompileGeneric → RunGeneric (mechanism proofs) and
// CompileFrame → RunFrame → ReleaseSessionFrame (determinism/release).

const (
	tristanaRFCandidateKey  = "hero_skill|hero_tristana|Q|急速射击"
	tristanaRFTaskKey       = "wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed"
	tristanaRFPlanRev       = "tristana-q-rapid-fire-timed-bonus-attack-speed-phase-a-v1"
	tristanaRFRequestTitle  = "Template:Data Tristana/Q"
	tristanaRFResolvedTitle = "Template:Data Tristana/Rapid Fire"
	tristanaRFWikiPageID    = 1308522
	tristanaRFRevisionID    = 4026462
	tristanaRFTimestamp     = "2026-06-09T21:59:03Z"
	tristanaRFRawBytes      = 872
	tristanaRFLocalRawBytes = 866
	tristanaRFContentSHA    = "f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da"
	tristanaRFLocalRawSHA   = "db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170"
	tristanaRFBoundary      = "rank5_self_timed_bonus_attack_speed; duration_7000ms; " +
		"bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; " +
		"ability_type_listener_isolation_from_buster_shot; " +
		"no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_" +
		"cooldown_bypass_other_ranks_or_full_fidelity"

	tristanaRFTagCostCD    = "ability_cost_cooldown"
	tristanaRFTagActiveAS  = "active_attack_speed_modifier"
	tristanaRFTagTimed     = "timed_state"
	tristanaRFTagIsolation = "ability_type_listener_isolation"

	tristanaRFProviderRef = "provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
	tristanaRFStableID    = "hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
	tristanaRFAbilityID   = "ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed"
	tristanaRFAbilityKey  = "rapid_fire_timed_bonus_attack_speed"
	tristanaRFStateKey    = "rapid_fire_active"
	tristanaRFASModKey    = "rapid_fire_attack_speed"
	tristanaRFListenerKey = "rapid_fire_on_ability_started"
	tristanaRFAbilityType = "ability/tristana_rapid_fire"
	tristanaRFCastEvent   = "event/ability_started"
	tristanaRFProbeKey    = "fixture_tristana_rapid_fire_as_probe"
	tristanaRFProbeOpRef  = "op:fixture_tristana_rapid_fire_as_probe"

	tristanaRFSeedBlobSHA  = "146a1c6ead2c42e76133da184860adc01d006cca33784b441001f93d60f8e09d"
	tristanaRFJUnitBlobSHA = "fa2e8658b82dca7389d9b86a4f01c78bc90b284355bcd689dcbdc874f8e01d08"

	tristanaRFManaCost   = 35.0
	tristanaRFCDMs       = 16000.0
	tristanaRFDurationMs = 7000.0
	tristanaRFASBonus    = 1.20
	tristanaRFBaseAS     = 0.60
	tristanaRFResolvedAS = 1.32 // 0.60 * (1 + 1.20)

	tristanaRFFixtureManaCD    = 105.0
	tristanaRFFixtureManaShort = 34.0
	tristanaRFManaAfter1       = 70.0 // 105 - 35
	tristanaRFManaAfter2       = 35.0 // 105 - 35 - 35
	tristanaRFFixtureManaCast  = 70.0 // simple cast schedules
	tristanaRFManaAfterCast1   = 35.0 // 70 - 35

	tristanaRFTol = 1e-9
)

func tristanaRFOrderedTags() []string {
	return []string{
		tristanaRFTagCostCD,
		tristanaRFTagActiveAS,
		tristanaRFTagTimed,
		tristanaRFTagIsolation,
	}
}

func tristanaRFTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func tristanaRFStateSchema() map[string]interface{} {
	return map[string]interface{}{
		tristanaRFStateKey: tristanaRFTimedSlot(0, 1, tristanaRFDurationMs),
	}
}

func tristanaRFASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: tristanaRFASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(tristanaRFASBonus),
				{Op: "read", Path: "provider.state." + tristanaRFStateKey},
			},
		},
	}
}

func tristanaRFCastArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey: tristanaRFListenerKey,
		// AbilityRef must stay empty: a populated abilityRef is a child cast, not a filter.
		// Isolation is via ability-type matcher (ability/tristana_rapid_fire), not AbilityRef.
		AbilityRef: "",
		EventMatcher: model.TypeMatcher{All: []string{
			tristanaRFCastEvent, "event/source_owner", tristanaRFAbilityType,
		}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         tristanaRFStateKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func tristanaRFAbility() model.AbilityDefinition {
	cost := tristanaRFManaCost
	cd := tristanaRFCDMs
	return model.AbilityDefinition{
		AbilityKey: tristanaRFAbilityKey,
		Kind:       "active",
		Types:      []string{tristanaRFAbilityType},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// AS arm via ability_started → source-owner + ability-type listener; Q itself has no ops.
		Operations: []model.OperationDefinition{},
	}
}

func tristanaRFProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: tristanaRFProbeKey,
		Kind:       "active",
		// Typed as basic_attack so the probe does not synthesize ability_started.
		Types: []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			Ref:        tristanaRFProbeOpRef,
		}},
	}
}

func tristanaRFProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        tristanaRFProviderRef,
		Kind:               "passive", // Backend reserved 20120 provider_kind/passive
		StableID:           tristanaRFStableID,
		InitialStateSchema: tristanaRFStateSchema(),
		Modifiers:          []model.ModifierDefinition{tristanaRFASModifier()},
		Listeners:          []model.ListenerDefinition{tristanaRFCastArmListener()},
		Abilities: []model.AbilityDefinition{
			tristanaRFAbility(),
			tristanaRFProbeAbility(),
		},
	}
}

func ensureTristanaRFTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: tristanaRFAbilityType, Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: tristanaRFCastEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "state_scope/provider", Domain: "state_scope"},
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

func configureTristanaRFProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{tristanaRFProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: tristanaRFProviderRef, DefinitionRef: tristanaRFProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: tristanaRFProviderRef, DefinitionRef: tristanaRFProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func tristanaRFAbilityRef() string {
	return "source.provider[" + tristanaRFProviderRef + "].ability[" + tristanaRFAbilityKey + "]"
}

func tristanaRFProbeRef() string {
	return "source.provider[" + tristanaRFProviderRef + "].ability[" + tristanaRFProbeKey + "]"
}

func loadTristanaRFFixture(t *testing.T, mana float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.tristana_rapid_fire_timed_bonus_attack_speed"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureTristanaRFTypes(&compileReq)
	configureTristanaRFProvider(&compileReq, &runReq)

	// Fixture-only AS/mana (external-existing-data/check-only); do not claim seed materializes them.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: tristanaRFBaseAS, Current: tristanaRFBaseAS, Max: tristanaRFBaseAS, Resolved: tristanaRFBaseAS,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: mana, Max: math.Max(mana, tristanaRFFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func loadTristanaRFQRFixture(t *testing.T, mana float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadTristanaRFFixture(t, mana)
	// Mount independent existing Buster Shot R beside Q (same-package helpers; no synthesis).
	opts := tristanaBSFixtureOpts{
		baseAD: tristanaBSADBaseDefault, resolvedAD: tristanaBSADResolvedDefault,
		resolvedAP: tristanaBSFixtureAPDefault, mr: tristanaBSTargetMR,
		mana: mana, hp: tristanaBSTargetHP,
	}
	bonus := opts.resolvedAD - opts.baseAD
	rProv := tristanaBSProviderDef(bonus)
	compileReq.SharedProviders = append(compileReq.SharedProviders, rProv)
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers,
		model.CombatantProviderMount{ProviderRef: tristanaBSProviderRef, DefinitionRef: tristanaBSProviderRef})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: tristanaBSProviderRef, DefinitionRef: tristanaBSProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
	ensureTristanaBSTypes(&compileReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD, Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP, Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
	})
	return compileReq, runReq
}

func runTristanaRF(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runTristanaRFFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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
		if p.ProviderKey != tristanaRFProviderRef {
			continue
		}
		field, ok := p.StateFields[tristanaRFStateKey]
		if !ok {
			t.Fatal("rapid_fire_active state field missing after compile")
		}
		if !field.HasCap || field.MaxValue != 1 ||
			field.DurationMs != int64(tristanaRFDurationMs) ||
			field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
			t.Fatalf("compiled rapid_fire_active=%+v want max1 duration7000 refresh_on_write", field)
		}
		if math.Abs(field.DefaultValue) > tristanaRFTol {
			t.Fatalf("defaultValue=%v want 0", field.DefaultValue)
		}
		if len(p.Listeners) != 1 {
			t.Fatalf("compiled Listeners=%d want 1", len(p.Listeners))
		}
		found = true
		break
	}
	if !found {
		t.Fatal("rapid fire provider missing from compiled session")
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
	rerun := runReq
	rerun.SessionID = compiled.SessionID
	rerun.ExpectedRulesHash = compiled.RulesHash
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, rerun)); code != -1 {
		t.Fatalf("RunFrame after release code=%d want -1", code)
	}
	if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
		t.Fatal("after release want session_not_found")
	}
	if _, still := session.genericSessions[compiled.SessionID]; still {
		t.Fatal("released session must not remain registered")
	}
	return done
}

func tristanaRFFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == tristanaRFProviderRef {
			return p
		}
	}
	return nil
}

func tristanaRFFindAbility(p *model.ProviderDefinition, key string) *model.AbilityDefinition {
	for i := range p.Abilities {
		if p.Abilities[i].AbilityKey == key {
			return &p.Abilities[i]
		}
	}
	return nil
}

func tristanaRFSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func tristanaRFActiveState(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		raw, ok := c.ProviderState[tristanaRFProviderRef]
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
		v, _ := state[tristanaRFStateKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func tristanaRFSourceASSlot(t *testing.T, snap model.Snapshot) model.AttributeSlotDef {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes["attack_speed"]
		if !ok {
			t.Fatal("source attack_speed missing")
		}
		return slot
	}
	t.Fatal("source missing")
	return model.AttributeSlotDef{}
}

func tristanaRFSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func tristanaRFAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != tristanaRFCastEvent {
			continue
		}
		out = append(out, item)
	}
	return out
}

func findTristanaRFAbilityStat(t *testing.T, done model.DoneResult, abilityRef string) model.AbilityStat {
	t.Helper()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == abilityRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", abilityRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func assertTristanaRFProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := tristanaRFFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed missing")
	}
	if p.ProviderKey != tristanaRFProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, tristanaRFProviderRef)
	}
	if p.StableID != tristanaRFStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, tristanaRFStableID)
	}
	if p.Kind != "passive" {
		t.Fatalf("kind=%q want passive (Backend 20120)", p.Kind)
	}
	banned := []string{
		"provider_hero_tristana_p_", "provider_hero_tristana_w_", "provider_hero_tristana_e_",
		"provider_hero_tristana_basic_", "ability_hero_tristana_p_", "ability_hero_tristana_w_",
		"ability_hero_tristana_e_", "ability_hero_tristana_basic_", "explosive_charge",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("rapid fire must not reuse sibling/basic/Explosive Charge refs: %q", b)
		}
	}
	if p.ProviderKey == tristanaBSProviderRef || p.StableID == tristanaBSStableID {
		t.Fatal("Q provider must not collide with Buster Shot R provider refs")
	}

	if len(p.InitialStateSchema) != 1 {
		t.Fatalf("InitialStateSchema keys=%d want 1", len(p.InitialStateSchema))
	}
	schema, ok := p.InitialStateSchema[tristanaRFStateKey].(map[string]interface{})
	if !ok {
		t.Fatalf("initialStateSchema missing %s: %+v", tristanaRFStateKey, p.InitialStateSchema)
	}
	if schema["refreshPolicy"] != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%v want %v", schema["refreshPolicy"], model.ProviderStateRefreshOnWrite)
	}
	if math.Abs(schema["defaultValue"].(float64)) > tristanaRFTol ||
		math.Abs(schema["maxValue"].(float64)-1) > tristanaRFTol ||
		math.Abs(schema["durationMs"].(float64)-tristanaRFDurationMs) > tristanaRFTol {
		t.Fatalf("rapid_fire_active schema=%+v want default0/max1/duration7000", schema)
	}

	if len(p.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1", len(p.Modifiers))
	}
	mod := p.Modifiers[0]
	if mod.ModifierKey != tristanaRFASModKey || mod.Kind != "attribute" ||
		mod.Target != "attack_speed" || mod.ValuePolicy != "percent_add" {
		t.Fatalf("modifier=%+v want rapid_fire_attack_speed attribute attack_speed percent_add", mod)
	}
	if mod.Value.Op != "mul" || len(mod.Value.Args) != 2 {
		t.Fatalf("modifier value=%+v want mul(1.20, provider.state.rapid_fire_active)", mod.Value)
	}
	if mod.Value.Args[0].Op != "const" || mod.Value.Args[0].Value == nil ||
		math.Abs(*mod.Value.Args[0].Value-tristanaRFASBonus) > tristanaRFTol {
		t.Fatalf("AS bonus const=%+v want 1.20", mod.Value.Args[0])
	}
	if mod.Value.Args[1].Op != "read" ||
		mod.Value.Args[1].Path != "provider.state."+tristanaRFStateKey {
		t.Fatalf("AS read=%+v want provider.state.%s", mod.Value.Args[1], tristanaRFStateKey)
	}

	if len(p.Listeners) != 1 {
		t.Fatalf("listeners=%d want 1", len(p.Listeners))
	}
	listener := p.Listeners[0]
	if listener.ListenerKey != tristanaRFListenerKey {
		t.Fatalf("listenerKey=%q want %q", listener.ListenerKey, tristanaRFListenerKey)
	}
	if listener.AbilityRef != "" {
		t.Fatalf("AbilityRef=%q want empty (populated abilityRef is child cast, not filter)", listener.AbilityRef)
	}
	wantMatcher := []string{tristanaRFCastEvent, "event/source_owner", tristanaRFAbilityType}
	if len(listener.EventMatcher.All) != 3 ||
		listener.EventMatcher.All[0] != wantMatcher[0] ||
		listener.EventMatcher.All[1] != wantMatcher[1] ||
		listener.EventMatcher.All[2] != wantMatcher[2] {
		t.Fatalf("EventMatcher.All=%v want %v", listener.EventMatcher.All, wantMatcher)
	}
	if len(listener.Operations) != 1 {
		t.Fatalf("listener ops=%d want 1", len(listener.Operations))
	}
	op := listener.Operations[0]
	if op.Operation != "state_change" || op.Target != "source" ||
		op.Ref != tristanaRFStateKey || op.ValuePolicy != "override" ||
		len(op.Types) != 1 || op.Types[0] != "state_scope/provider" ||
		op.Amount == nil || op.Amount.Op != "const" || op.Amount.Value == nil ||
		math.Abs(*op.Amount.Value-1) > tristanaRFTol {
		t.Fatalf("listener op=%+v want state_change source provider override const1", op)
	}

	haveType := false
	for _, e := range compileReq.TypeCatalog.Types {
		if e.Key == tristanaRFAbilityType && e.Domain == "ability" {
			haveType = true
			break
		}
	}
	if !haveType {
		t.Fatalf("type catalog missing %s domain=ability", tristanaRFAbilityType)
	}

	ab := tristanaRFFindAbility(p, tristanaRFAbilityKey)
	if ab == nil {
		t.Fatal("rapid_fire_timed_bonus_attack_speed ability missing")
	}
	if ab.AbilityKey != tristanaRFAbilityKey || ab.Kind != "active" {
		t.Fatalf("ability=%+v want %s active", ab, tristanaRFAbilityKey)
	}
	if len(ab.Types) != 1 || ab.Types[0] != tristanaRFAbilityType {
		t.Fatalf("Q types=%v want [%s]", ab.Types, tristanaRFAbilityType)
	}
	for _, typ := range ab.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("Q must not be tagged ability/basic_attack")
		}
	}
	if ab.Cost == nil || ab.Cost.ResourceKey != "mana" ||
		ab.Cost.Amount.Op != "const" || ab.Cost.Amount.Value == nil ||
		math.Abs(*ab.Cost.Amount.Value-tristanaRFManaCost) > tristanaRFTol {
		t.Fatalf("cost=%+v want mana const 35", ab.Cost)
	}
	if ab.Cooldown == nil || ab.Cooldown.DurationMs.Op != "const" || ab.Cooldown.DurationMs.Value == nil ||
		math.Abs(*ab.Cooldown.DurationMs.Value-tristanaRFCDMs) > tristanaRFTol {
		t.Fatalf("cooldown=%+v want const 16000", ab.Cooldown)
	}
	if len(ab.Operations) != 0 {
		t.Fatalf("Q operations=%+v want empty (no damage/heal/shield/control/repeat/event)", ab.Operations)
	}
	for _, bannedOp := range []string{
		"damage", "heal", "shield", "slow", "stun", "knockback", "repeat", "emit_event",
		"control", "projectile", "channel", "cooldown_change",
	} {
		for _, op := range ab.Operations {
			if op.Operation == bannedOp {
				t.Fatalf("Q must not include excluded op %q", bannedOp)
			}
		}
	}

	probe := tristanaRFFindAbility(p, tristanaRFProbeKey)
	if probe == nil {
		t.Fatal("fixture AS probe missing")
	}
	if len(probe.Types) != 1 || probe.Types[0] != "ability/basic_attack" {
		t.Fatalf("probe types=%v want [ability/basic_attack]", probe.Types)
	}

	if tristanaRFAbilityID != "ability_hero_tristana_q_rapid_fire_timed_bonus_attack_speed" {
		t.Fatal("ability id constant drifted")
	}
	if tristanaRFBoundary != "rank5_self_timed_bonus_attack_speed; duration_7000ms; "+
		"bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; "+
		"ability_type_listener_isolation_from_buster_shot; "+
		"no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_"+
		"cooldown_bypass_other_ranks_or_full_fidelity" {
		t.Fatal("frozen boundary constant drifted")
	}
	tags := tristanaRFOrderedTags()
	if len(tags) != 4 ||
		tags[0] != tristanaRFTagCostCD ||
		tags[1] != tristanaRFTagActiveAS ||
		tags[2] != tristanaRFTagTimed ||
		tags[3] != tristanaRFTagIsolation {
		t.Fatalf("ordered tags drifted: %v", tags)
	}
}

func tristanaRFRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func tristanaRFLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(tristanaRFRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql"))
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

func tristanaRFSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func tristanaRFCountOccurrences(s, needle string) int {
	return strings.Count(s, needle)
}

// TestGenericTristanaRapidFireWikiSidecarSeedGraphAndIdentity locks repository
// sidecar/pages/raw identity, mirrored seed/JUnit hashes, exact seed graph
// cardinality, collision guards, empty ability_id, matcher/type-relation,
// formula, ordered tags/boundary, and exclusions.
func TestGenericTristanaRapidFireWikiSidecarSeedGraphAndIdentity(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(tristanaRFRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "tristana-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != tristanaRFCandidateKey || doc.RequestTitle != tristanaRFRequestTitle ||
		doc.ResolvedTitle != tristanaRFResolvedTitle || doc.WikiPageID != tristanaRFWikiPageID ||
		doc.RevisionID != tristanaRFRevisionID || doc.RevisionTimestamp != tristanaRFTimestamp ||
		doc.ContentSHA256 != tristanaRFContentSHA || doc.RawByteSize != tristanaRFRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "急速射击" || doc.OwnerID != "hero_tristana" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|15 to 35}}\n" {
		t.Fatalf("fields.cost=%q want rank band 15→35", doc.Fields.Cost)
	}
	if doc.Fields.Cooldown != "{{ap|20 to 16}}\n" {
		t.Fatalf("fields.cooldown=%q want rank band 20→16s", doc.Fields.Cooldown)
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("costtype=%q want Mana", doc.Fields.Costtype)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|60 to 120}}%") {
		t.Fatalf("leveling missing +60→120%% AS band: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "7 seconds") {
		t.Fatalf("description missing 7s duration: %q", doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Notes, "non-refreshing") ||
		!strings.Contains(doc.Fields.Notes, "rank-up") {
		t.Fatalf("notes missing non-refreshing / rank-up framing: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(tristanaRFRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "tristana-q.json"))
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "急速射击" || pages.OwnerID != "hero_tristana" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(tristanaRFRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "tristana-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != tristanaRFLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), tristanaRFLocalRawBytes)
	}
	if tristanaRFLocalRawBytes == tristanaRFRawBytes {
		t.Fatal("local raw and canonical sizes must differ (serialization caveat; not equivalence)")
	}
	localSHA := tristanaRFSHA256Hex(rawBytes)
	if localSHA != tristanaRFLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, tristanaRFLocalRawSHA)
	}
	if localSHA == tristanaRFContentSHA {
		t.Fatal("local raw hash must differ from canonical (serialization caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|60 to 120}}%",
		"{{ap|15 to 35}}",
		"{{ap|20 to 16}}",
		"|costtype     = Mana",
		"7 seconds",
		"non-refreshing",
		"rank-up",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field framing %q", want)
		}
	}
	if tristanaRFPlanRev != "tristana-q-rapid-fire-timed-bonus-attack-speed-phase-a-v1" ||
		tristanaRFBoundary != "rank5_self_timed_bonus_attack_speed; duration_7000ms; "+
			"bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; "+
			"ability_type_listener_isolation_from_buster_shot; "+
			"no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_"+
			"cooldown_bypass_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := tristanaRFRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := tristanaRFSHA256Hex(seedBytes); got != tristanaRFSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, tristanaRFSeedBlobSHA)
	}
	junitPath := tristanaRFRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := tristanaRFSHA256Hex(junitBytes); got != tristanaRFJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, tristanaRFJUnitBlobSHA)
	}
	_ = tristanaRFRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := tristanaRFLoadSeedSQL(t)
	for _, want := range []string{
		tristanaRFCandidateKey, tristanaRFTaskKey, tristanaRFPlanRev,
		tristanaRFRequestTitle, tristanaRFResolvedTitle,
		"1308522", "4026462", tristanaRFTimestamp, "872", "866",
		tristanaRFContentSHA, tristanaRFLocalRawSHA,
		tristanaRFBoundary, tristanaRFProviderRef, tristanaRFAbilityID, tristanaRFAbilityKey,
		tristanaRFStableID, tristanaRFStateKey, tristanaRFASModKey,
		"rapid_fire_active_arm", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":35}`, `{"op":"const","value":16000}`, `{"op":"const","value":1}`,
		`{"op":"mul","args":[{"op":"const","value":1.20},{"op":"read","path":"provider.state.rapid_fire_active"}]}`,
		"local raw materialization caveat",
		"normalized/generic/tristana-q.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"ability/tristana_rapid_fire", "62013",
		"ability_id", "NULL",
		"20205", "20212", "20190", "20173", "20172", "20160", "20250",
		"missing game_entities hero_tristana",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_tristana/attack_speed",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_tristana/mana",
		"missing reserved_type",
		"AS0.60", "1.32", "t6999", "t7000", "mana105", "t15999", "t16000",
		"readyAt16000", "mana34", "Buster Shot",
		"1.20", "7000", "16000", "35",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range tristanaRFOrderedTags() {
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
	for _, tag := range tristanaRFOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if regexp.MustCompile(`(?i)Batch-B\s+prerequisite`).MatchString(seed) {
		t.Fatal("seed must not use Batch-B prerequisite wording")
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.ability_definitions",
		"INSERT INTO public.ability_costs",
		"INSERT INTO public.ability_cooldowns",
		"INSERT INTO public.provider_state_fields",
		"INSERT INTO public.provider_modifiers",
		"INSERT INTO public.provider_listeners",
		"INSERT INTO public.listener_match_types",
		"INSERT INTO public.listener_effect_sequences",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.state_effect_details",
		"INSERT INTO public.type_relations",
		"INSERT INTO public.entity_provider_mounts",
		"sequence_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_arm",
		"step_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_active_arm",
		"listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started",
		"modifier_hero_tristana_q_rapid_fire_timed_bonus_attack_speed",
	} {
		if !strings.Contains(sqlNoComments, needle) {
			t.Fatalf("executable seed missing %q", needle)
		}
	}
	card := map[string]int{
		"INSERT INTO public.provider_definitions":      1,
		"INSERT INTO public.ability_definitions":       1,
		"INSERT INTO public.ability_costs":             1,
		"INSERT INTO public.ability_cooldowns":         1,
		"INSERT INTO public.provider_state_fields":     1,
		"INSERT INTO public.provider_modifiers":        1,
		"INSERT INTO public.provider_listeners":        1,
		"INSERT INTO public.effect_sequences":          1,
		"INSERT INTO public.effect_steps":              1,
		"INSERT INTO public.state_effect_details":      1,
		"INSERT INTO public.type_relations":            1,
		"INSERT INTO public.listener_effect_sequences": 1,
		"INSERT INTO public.entity_provider_mounts":    1,
	}
	for needle, want := range card {
		if got := tristanaRFCountOccurrences(sqlNoComments, needle); got != want {
			t.Fatalf("%s count=%d want %d", needle, got, want)
		}
	}
	if got := tristanaRFCountOccurrences(sqlNoComments,
		"'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed_ability_started', 20181,"); got != 3 {
		t.Fatalf("ALL matchers=%d want exactly 3 {20205,20212,62013}", got)
	}
	if !regexp.MustCompile(`(?s)'listener_hero_tristana_q_rapid_fire_timed_bonus_attack_speed` +
		`_ability_started'\s*,\s*` +
		`'provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed'\s*,\s*` +
		`'rapid_fire_on_ability_started'\s*,\s*20205\s*,\s*NULL`).MatchString(seed) {
		t.Fatal("listener ability_id must be NULL")
	}
	if !regexp.MustCompile(`(?s)62013\s*,\s*'ability/tristana_rapid_fire'[\s\S]{0,400}NULL`).MatchString(seed) {
		t.Fatal("62013 must bind ability/tristana_rapid_fire with reserved_type_id=NULL")
	}
	if !regexp.MustCompile(`(?i)type_id=62013 already bound`).MatchString(seed) ||
		!regexp.MustCompile(`(?i)type_key=ability/tristana_rapid_fire already bound`).MatchString(seed) {
		t.Fatal("seed must include bidirectional 62013 collision guards")
	}
	if regexp.MustCompile(`(?is)ability_kind_type_id\s*=\s*62013`).MatchString(sqlNoComments) {
		t.Fatal("must not write 62013 into ability_kind_type_id")
	}
	if regexp.MustCompile(`(?is)INSERT\s+INTO\s+public\.ability_phases\b`).MatchString(sqlNoComments) {
		t.Fatal("seed must not write ability_phases (zero Q damage scaffold)")
	}
	for _, table := range []string{
		"damage_effect_details", "heal_effect_details", "shield_effect_details",
		"control_effect_details", "repeat_effect_details", "event_effect_details",
	} {
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
	if regexp.MustCompile(`(?is)'provider_hero_tristana_[pwer]_|'ability_hero_tristana_[pwer]_|` +
		`'provider_hero_tristana_basic_|'ability_hero_tristana_basic_|explosive_charge|buster_shot`).MatchString(sqlNoComments) {
		t.Fatal("must not create/mutate P/W/E/R/basic/Explosive Charge/Buster Shot graph rows")
	}
	if !strings.Contains(seed, "不 claim") && !strings.Contains(seed, "不得把 runtime") {
		t.Fatal("seed must not claim runtime refresh_policy itself is non-refresh")
	}
	if !strings.Contains(seed, "16000") || !(strings.Contains(seed, "正常路径无法") ||
		strings.Contains(seed, "无法 refresh") || strings.Contains(seed, "non-refreshing")) {
		t.Fatal("seed must document CD16000 > duration7000 normal non-refresh path")
	}

	compileReq, _ := loadTristanaRFFixture(t, tristanaRFFixtureManaCast)
	assertTristanaRFProviderShape(t, compileReq, 1)
	wantAS := tristanaRFBaseAS * (1 + tristanaRFASBonus)
	if math.Abs(wantAS-tristanaRFResolvedAS) > tristanaRFTol {
		t.Fatalf("formula=%v want %v", wantAS, tristanaRFResolvedAS)
	}
}

// TestGenericTristanaRapidFireBaselineAndTimedASSchedule: baseline AS0.60; successful
// Q@t0 spends mana and yields AS1.32 from t0 through t6999; at t7000 state expires
// and resolved AS returns 0.60.
func TestGenericTristanaRapidFireBaselineAndTimedASSchedule(t *testing.T) {
	t.Run("baseline_before_cast", func(t *testing.T) {
		compileReq, runReq := loadTristanaRFFixture(t, tristanaRFFixtureManaCast)
		assertTristanaRFProviderShape(t, compileReq, 1)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "probe", AbilityRef: tristanaRFProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runTristanaRF(t, compileReq, runReq)
		if countEmittedEvents(done, tristanaRFCastEvent) != 0 {
			t.Fatalf("ability_started=%d want 0 before Q cast", countEmittedEvents(done, tristanaRFCastEvent))
		}
		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 0 {
			t.Fatalf("rapid_fire_active=%v want 0 before cast", got)
		}
		slot := tristanaRFSourceASSlot(t, done.FinalSnapshot)
		if math.Abs(slot.Base-tristanaRFBaseAS) > tristanaRFTol {
			t.Fatalf("attack_speed.base=%v want %v", slot.Base, tristanaRFBaseAS)
		}
		if math.Abs(slot.Resolved-tristanaRFBaseAS) > tristanaRFTol {
			t.Fatalf("attack_speed.resolved=%v want baseline %v", slot.Resolved, tristanaRFBaseAS)
		}
		if got := tristanaRFSourceMana(t, done.FinalSnapshot); math.Abs(got-tristanaRFFixtureManaCast) > tristanaRFTol {
			t.Fatalf("mana=%v want %v (no Q cost)", got, tristanaRFFixtureManaCast)
		}
	})

	t.Run("active_from_t0", func(t *testing.T) {
		compileReq, runReq := loadTristanaRFFixture(t, tristanaRFFixtureManaCast)
		assertTristanaRFProviderShape(t, compileReq, 1)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: tristanaRFAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runTristanaRF(t, compileReq, runReq)
		if countEmittedEvents(done, tristanaRFCastEvent) != 1 {
			t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, tristanaRFCastEvent))
		}
		if got := tristanaRFSourceMana(t, done.FinalSnapshot); math.Abs(got-tristanaRFManaAfterCast1) > tristanaRFTol {
			t.Fatalf("mana=%v want %v", got, tristanaRFManaAfterCast1)
		}
		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 1 {
			t.Fatalf("rapid_fire_active=%v want 1", got)
		}
		slot := tristanaRFSourceASSlot(t, done.FinalSnapshot)
		if math.Abs(slot.Base-tristanaRFBaseAS) > tristanaRFTol {
			t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, tristanaRFBaseAS)
		}
		if math.Abs(slot.Resolved-tristanaRFResolvedAS) > tristanaRFTol {
			t.Fatalf("attack_speed.resolved=%v want %v", slot.Resolved, tristanaRFResolvedAS)
		}
		if math.Abs(done.Summary.SourceDamageDealt) > tristanaRFTol {
			t.Fatalf("sourceDamageDealt=%v want 0 (Q has no damage ops)", done.Summary.SourceDamageDealt)
		}
		if n := len(damageEvidenceItems(done)); n != 0 {
			t.Fatalf("damage evidence=%d want 0", n)
		}
	})

	t.Run("still_active_through_t6999", func(t *testing.T) {
		compileReq, runReq := loadTristanaRFFixture(t, tristanaRFFixtureManaCast)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: tristanaRFAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "probe_live", AbilityRef: tristanaRFProbeRef(), Source: "source", Target: "target", FirstAtMs: 6999},
		}
		runReq.StopPolicy.DurationMs = 6999
		done := runTristanaRF(t, compileReq, runReq)
		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 1 {
			t.Fatalf("rapid_fire_active@t6999=%v want 1", got)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-tristanaRFResolvedAS) > tristanaRFTol {
			t.Fatalf("attack_speed@t6999=%v want %v", got, tristanaRFResolvedAS)
		}
	})

	t.Run("expires_at_t7000", func(t *testing.T) {
		compileReq, runReq := loadTristanaRFFixture(t, tristanaRFFixtureManaCast)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: tristanaRFAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "probe_expired", AbilityRef: tristanaRFProbeRef(), Source: "source", Target: "target", FirstAtMs: 7000},
		}
		runReq.StopPolicy.DurationMs = 7050
		done := runTristanaRF(t, compileReq, runReq)
		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 0 {
			t.Fatalf("rapid_fire_active after t7000=%v want 0", got)
		}
		slot := tristanaRFSourceASSlot(t, done.FinalSnapshot)
		if math.Abs(slot.Base-tristanaRFBaseAS) > tristanaRFTol {
			t.Fatalf("attack_speed.base after expiry=%v want %v", slot.Base, tristanaRFBaseAS)
		}
		if math.Abs(slot.Resolved-tristanaRFBaseAS) > tristanaRFTol {
			t.Fatalf("attack_speed.resolved after expiry=%v want baseline %v", slot.Resolved, tristanaRFBaseAS)
		}
	})
}

// TestGenericTristanaRapidFireCooldownMana105: mana105 attempts t0/t15999/t16000 →
// success/cooldown-skip/success; exactly two Q automatic ability_started; one
// cooldown skip readyAt16000; final mana35 / active1 / AS1.32.
// Normal successful recast cannot refresh before expiry because CD16000 > duration7000;
// do not claim refresh policy itself is non-refreshing.
func TestGenericTristanaRapidFireCooldownMana105(t *testing.T) {
	compileReq, runReq := loadTristanaRFFixture(t, tristanaRFFixtureManaCD)
	assertTristanaRFProviderShape(t, compileReq, 1)
	ref := tristanaRFAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 15999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 16000},
	}
	runReq.StopPolicy.DurationMs = 16100
	done := runTristanaRF(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if tristanaRFSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findTristanaRFAbilityStat(t, done, ref)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	started := tristanaRFAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("Q ability_started=%d want 2 (automatic; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 16000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}

	var skipAt15999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 15999 {
			t.Fatalf("cooldown skip TimeMs=%d want 15999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 16000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 16000", item.Data["readyAtMs"])
		}
		skipAt15999 = true
	}
	if !skipAt15999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=15999 with readyAtMs=16000")
	}

	if got := tristanaRFSourceMana(t, done.FinalSnapshot); math.Abs(got-tristanaRFManaAfter2) > tristanaRFTol {
		t.Fatalf("mana=%v want %v (two successful casts; early skipped)", got, tristanaRFManaAfter2)
	}
	if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 1 {
		t.Fatalf("rapid_fire_active after second success=%v want 1", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-tristanaRFResolvedAS) > tristanaRFTol {
		t.Fatalf("attack_speed after second cast=%v want %v", got, tristanaRFResolvedAS)
	}
	// CD16000 > duration7000 ⇒ second success is after first window expiry; no claim on policy itself.
	if !(tristanaRFCDMs > tristanaRFDurationMs) {
		t.Fatal("contract requires CD16000 > duration7000 so normal recast cannot refresh before expiry")
	}
	if math.Abs(done.Summary.SourceDamageDealt) > tristanaRFTol {
		t.Fatalf("sourceDamageDealt=%v want 0", done.Summary.SourceDamageDealt)
	}
}

// TestGenericTristanaRapidFireResourceInsufficientMana34: mana34 at t0 →
// resource skip; mana/AS/state unchanged; zero Q started.
func TestGenericTristanaRapidFireResourceInsufficientMana34(t *testing.T) {
	compileReq, runReq := loadTristanaRFFixture(t, tristanaRFFixtureManaShort)
	ref := tristanaRFAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runTristanaRF(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if tristanaRFSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(tristanaRFSourceMana(t, done.FinalSnapshot)-tristanaRFFixtureManaShort) > tristanaRFTol {
		t.Fatalf("mana changed: got %v want %v",
			tristanaRFSourceMana(t, done.FinalSnapshot), tristanaRFFixtureManaShort)
	}
	if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 0 {
		t.Fatalf("rapid_fire_active=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-tristanaRFBaseAS) > tristanaRFTol {
		t.Fatalf("attack_speed=%v want baseline %v", got, tristanaRFBaseAS)
	}
	if len(tristanaRFAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestGenericTristanaRapidFireQRCoexistenceAbilityTypeIsolation: mount independent
// Q and existing Buster Shot R. R cast alone leaves Q state0/AS0.60 while producing
// exactly its one R magic damage/start; Q cast arms Q/AS1.32 and produces no R damage.
func TestGenericTristanaRapidFireQRCoexistenceAbilityTypeIsolation(t *testing.T) {
	compileReq, _ := loadTristanaRFQRFixture(t, 300)
	assertTristanaRFProviderShape(t, compileReq, 2)
	assertTristanaBSProviderShape(t, compileReq, 2, true)

	qRef := tristanaRFAbilityRef()
	rRef := tristanaBSAbilityRef()
	if qRef == rRef {
		t.Fatal("Q and R ability refs must be distinct")
	}
	pQ := tristanaRFFindProvider(compileReq)
	pR := tristanaBSFindProvider(compileReq)
	if pQ == nil || pR == nil {
		t.Fatal("combined fixture must mount both Q and R providers")
	}
	if pQ.ProviderKey == pR.ProviderKey || pQ.StableID == pR.StableID {
		t.Fatal("Q/R provider keys/stable IDs must not collide")
	}
	qAb := tristanaRFFindAbility(pQ, tristanaRFAbilityKey)
	if qAb == nil || len(qAb.Types) != 1 || qAb.Types[0] != tristanaRFAbilityType {
		t.Fatalf("Q ability type isolation missing: %+v", qAb)
	}
	for _, typ := range pR.Abilities[0].Types {
		if typ == tristanaRFAbilityType {
			t.Fatal("R must not carry ability/tristana_rapid_fire")
		}
	}

	t.Run("r_cast_alone_does_not_arm_q", func(t *testing.T) {
		c, r := loadTristanaRFQRFixture(t, 300)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runTristanaRF(t, c, r)

		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 0 {
			t.Fatalf("rapid_fire_active after R-only=%v want 0 (ability-type isolation)", got)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-tristanaRFBaseAS) > tristanaRFTol {
			t.Fatalf("attack_speed after R-only=%v want baseline %v", got, tristanaRFBaseAS)
		}
		dmg := tristanaBSDamageEvidence(done)
		if len(dmg) != 1 {
			t.Fatalf("R damage evidence=%d want 1", len(dmg))
		}
		tristanaBSAssertDamage(t, dmg[0], tristanaBSExpectedRawDefault, tristanaBSExpectedMitDefault)
		if countEmittedEvents(done, tristanaRFCastEvent) != 1 {
			t.Fatalf("ability_started=%d want 1 (R only)", countEmittedEvents(done, tristanaRFCastEvent))
		}
		rStat := findTristanaRFAbilityStat(t, done, rRef)
		if rStat.CastCount != 1 {
			t.Fatalf("R castCount=%d want 1", rStat.CastCount)
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == qRef && st.CastCount != 0 {
				t.Fatalf("Q must not cast during R-only schedule: %+v", st)
			}
		}
	})

	t.Run("q_cast_arms_q_no_r_damage", func(t *testing.T) {
		c, r := loadTristanaRFQRFixture(t, 300)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: qRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runTristanaRF(t, c, r)

		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 1 {
			t.Fatalf("rapid_fire_active after Q=%v want 1", got)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-tristanaRFResolvedAS) > tristanaRFTol {
			t.Fatalf("attack_speed after Q=%v want %v", got, tristanaRFResolvedAS)
		}
		if len(tristanaBSDamageEvidence(done)) != 0 {
			t.Fatal("Q cast must not produce R damage")
		}
		if n := len(damageEvidenceItems(done)); n != 0 {
			t.Fatalf("total damage evidence=%d want 0 (Q has no damage; R not cast)", n)
		}
		if countEmittedEvents(done, tristanaRFCastEvent) != 1 {
			t.Fatalf("ability_started=%d want 1 (Q only)", countEmittedEvents(done, tristanaRFCastEvent))
		}
		qStat := findTristanaRFAbilityStat(t, done, qRef)
		if qStat.CastCount != 1 {
			t.Fatalf("Q castCount=%d want 1", qStat.CastCount)
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == rRef && st.CastCount != 0 {
				t.Fatalf("R must not cast during Q-only schedule: %+v", st)
			}
		}
	})
}

// TestGenericTristanaRapidFireDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// post-release session_not_found.
func TestGenericTristanaRapidFireDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadTristanaRFFixture(t, tristanaRFFixtureManaCD)
			ref := tristanaRFAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 15999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 16000},
			}
			r.StopPolicy.DurationMs = 16100
			done := runTristanaRF(t, c, r)
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
		c, r := loadTristanaRFFixture(t, tristanaRFFixtureManaCast)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: tristanaRFAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runTristanaRFFrames(t, c, r)
		if got := tristanaRFActiveState(t, done.FinalSnapshot); got != 1 {
			t.Fatalf("frame-path rapid_fire_active=%v want 1", got)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-tristanaRFResolvedAS) > tristanaRFTol {
			t.Fatalf("frame-path attack_speed=%v want %v", got, tristanaRFResolvedAS)
		}
		if len(tristanaRFAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})
}
