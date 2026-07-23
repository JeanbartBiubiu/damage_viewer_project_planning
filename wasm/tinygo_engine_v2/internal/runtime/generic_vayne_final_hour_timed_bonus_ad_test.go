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

// hero_vayne R Final Hour / 终极时刻 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: vayne-r-final-hour-timed-bonus-ad-phase-a-v2).
//
// Frozen boundary:
//
//	rank3_timed_bonus_ad_self_buff; direct_provider_state_change;
//	flat_ad_plus_65_for_12000ms;
//	no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement
//
// Ordered tags:
//  1. ability_cost_cooldown
//  2. cast_triggered_timed_bonus_ad
//  3. flat_ad_add
//  4. timed_provider_state
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	CandidateKey (authoritative, sole stable mechanism key for seed/sidecar/pages):
//	  hero_skill|hero_vayne|R|终极时刻
//	Request Template:Data Vayne/R → resolved Template:Data Vayne/Final Hour
//	wikiPageId 1309991 / rev 3807995 / timestamp 2024-11-05T22:07:10Z
//	canonical bytes 2015 / SHA256 e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d
//	数据参考/lol-wiki-current-champions/normalized/generic/vayne-r.json
//	pages/raw siblings: pages/vayne-r.json, raw/vayne-r.wikitext
//	local raw is known non-canonical bytes 2012 /
//	  SHA 343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642
//	  (assert materialization only; do not claim equivalence or source contradiction)
//
// Rank-3 Phase-A contract (direct Graves Quickdraw-style state_change; NOT
// Xayah-W / Draven-W / Kai'Sa-E ability_started listener scaffold):
//   - Independent provider provider_hero_vayne_r_final_hour_timed_bonus_ad
//     mounted on champion hero_vayne (Backend provider_kind/passive 20120)
//   - active ability_key final_hour: 80 mana / 70000 ms CD
//   - timed provider.state final_hour_active: default0 / max1 / 12000ms /
//     refresh_on_write
//   - owner/source AD add: 65 * provider.state.final_hour_active
//   - exactly one operation: state_change source / state_scope/provider /
//     override const1
//   - zero listeners; no event/ability_started or event/source_owner dependency
//   - no R damage / control / movement / projectile / dash / stealth /
//     cooldown-change / takedown / extension / multi-target / geometry
//
// Fixture-only physical probe (NOT R damage; NOT Backend seed):
//   ability typed ability/basic_attack with one damage op whose amount reads
//   source.attr.ad.resolved.
//
// Explicit exclusions (completed boundary; not remaining blockers):
//   Night Hunter MS; Tumble CD/cast/dash/reset; invisibility/stealth;
//   takedown/extension; animation/projectile; ranks1-2; P/Q/W/E/basic;
//   Silver Bolts/Condemn; Spellblade/equipment/runes/loadout; direct R damage;
//   target effects; live migration/publish/browser E2E/full fidelity.
//
// Path: compile.CompileGeneric → RunGeneric (mechanism proofs) and
// CompileFrame → RunFrame → ReleaseSessionFrame (determinism/release).

const (
	// Authoritative and only stable mechanism key (Backend seed, sidecar, pages).
	vayneFinalHourCandidateKey   = "hero_skill|hero_vayne|R|终极时刻"
	vayneFinalHourRequestTitle   = "Template:Data Vayne/R"
	vayneFinalHourResolvedTitle  = "Template:Data Vayne/Final Hour"
	vayneFinalHourWikiPageID     = 1309991
	vayneFinalHourRevisionID     = 3807995
	vayneFinalHourTimestamp      = "2024-11-05T22:07:10Z"
	vayneFinalHourCanonicalBytes = 2015
	vayneFinalHourContentSHA     = "e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d"
	vayneFinalHourLocalRawBytes  = 2012
	vayneFinalHourLocalRawSHA    = "343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642"
	vayneFinalHourPlanRev        = "vayne-r-final-hour-timed-bonus-ad-phase-a-v2"
	vayneFinalHourBoundary       = "rank3_timed_bonus_ad_self_buff; direct_provider_state_change; " +
		"flat_ad_plus_65_for_12000ms; " +
		"no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement"

	vayneFinalHourTagCostCD      = "ability_cost_cooldown"
	vayneFinalHourTagCastTimedAD = "cast_triggered_timed_bonus_ad"
	vayneFinalHourTagFlatADAdd   = "flat_ad_add"
	vayneFinalHourTagTimedProvSt = "timed_provider_state"

	vayneFinalHourProviderRef = "provider_hero_vayne_r_final_hour_timed_bonus_ad"
	vayneFinalHourStableID    = "hero_vayne_r_final_hour_timed_bonus_ad"
	vayneFinalHourAbilityID   = "ability_hero_vayne_r_final_hour_timed_bonus_ad"
	vayneFinalHourAbilityKey  = "final_hour"
	vayneFinalHourStateKey    = "final_hour_active"
	vayneFinalHourBonusADMod  = "final_hour_bonus_ad"
	vayneFinalHourProbeKey    = "fixture_vayne_final_hour_physical_probe"
	vayneFinalHourProbeOpRef  = "op:fixture_vayne_final_hour_physical_probe"

	// Must not collide with existing Vayne Silver Bolts / Tumble / Condemn / AA fixtures.
	vayneFinalHourSilverBoltsKey = "hero:vayne_silver_bolts"
	vayneFinalHourSilverBoltsRef = "provider_hero_vayne_silver_bolts"
	vayneFinalHourTumbleRef      = "provider_hero_vayne_tumble"
	vayneFinalHourBasicRef       = "provider_hero_vayne_basic_attack"
	vayneFinalHourCondemnRef     = "provider_hero_vayne_e_condemn_primary_hit"

	vayneFinalHourBonusAD     = 65.0
	vayneFinalHourManaCost    = 80.0
	vayneFinalHourCDMs        = 70000.0
	vayneFinalHourDurationMs  = 12000.0
	vayneFinalHourADBase      = 60.0
	vayneFinalHourADBuffed    = 125.0 // 60 + 65
	vayneFinalHourTargetArmor = 100.0
	vayneFinalHourTargetHP    = 100000.0
	vayneFinalHourFixtureMana = 300.0 // fixture-only; Backend seed remains 232/232
	vayneFinalHourManaAfter1  = 220.0 // 300 - 80
	vayneFinalHourManaAfter2  = 140.0 // 300 - 80 - 80

	vayneFinalHourProbeRawActive  = 125.0
	vayneFinalHourProbeMitActive  = 62.5
	vayneFinalHourProbeRawExpired = 60.0
	vayneFinalHourProbeMitExpired = 30.0

	vayneFinalHourTol = 1e-9
)

func vayneFinalHourOrderedTags() []string {
	return []string{
		vayneFinalHourTagCostCD,
		vayneFinalHourTagCastTimedAD,
		vayneFinalHourTagFlatADAdd,
		vayneFinalHourTagTimedProvSt,
	}
}

func vayneFinalHourTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func vayneFinalHourStateSchema() map[string]interface{} {
	return map[string]interface{}{
		vayneFinalHourStateKey: vayneFinalHourTimedSlot(0, 1, vayneFinalHourDurationMs),
	}
}

func vayneFinalHourBonusADValue() model.GenericFormulaExpr {
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			gfConst(vayneFinalHourBonusAD),
			{Op: "read", Path: "provider.state." + vayneFinalHourStateKey},
		},
	}
}

func vayneFinalHourAbility() model.AbilityDefinition {
	cost := vayneFinalHourManaCost
	cd := vayneFinalHourCDMs
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: vayneFinalHourAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Direct provider-scope state_change (Graves Quickdraw precedent).
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         vayneFinalHourStateKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}
}

// Fixture-only AD probe — not R damage and not part of Backend seed.
func vayneFinalHourProbeAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: vayneFinalHourProbeKey,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Ref:        vayneFinalHourProbeOpRef,
			Amount: &model.GenericFormulaExpr{
				Op:   "read",
				Path: "source.attr.ad.resolved",
			},
		}},
	}
}

func vayneFinalHourProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        vayneFinalHourProviderRef,
		Kind:               "passive", // Backend reserved 20120 provider_kind/passive
		StableID:           vayneFinalHourStableID,
		InitialStateSchema: vayneFinalHourStateSchema(),
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: vayneFinalHourBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       vayneFinalHourBonusADValue(),
		}},
		Abilities: []model.AbilityDefinition{
			vayneFinalHourAbility(),
			vayneFinalHourProbeAbility(),
		},
	}
}

func ensureVayneFinalHourTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
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
	// Fail closed: compile type catalog must not depend on ability-start scaffold.
	filtered := make([]model.TypeCatalogEntry, 0, len(req.TypeCatalog.Types))
	for _, e := range req.TypeCatalog.Types {
		if e.Key == "event/ability_started" || e.Key == "event/source_owner" {
			continue
		}
		filtered = append(filtered, e)
	}
	req.TypeCatalog.Types = filtered
}

func configureVayneFinalHourProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{vayneFinalHourProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: vayneFinalHourProviderRef, DefinitionRef: vayneFinalHourProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: vayneFinalHourProviderRef, DefinitionRef: vayneFinalHourProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func vayneFinalHourAbilityRef() string {
	return "source.provider[" + vayneFinalHourProviderRef + "].ability[" + vayneFinalHourAbilityKey + "]"
}

func vayneFinalHourProbeRef() string {
	return "source.provider[" + vayneFinalHourProviderRef + "].ability[" + vayneFinalHourProbeKey + "]"
}

func loadVayneFinalHourFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.vayne_final_hour_timed_bonus_ad"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureVayneFinalHourTypes(&compileReq)
	configureVayneFinalHourProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: vayneFinalHourADBase, Current: vayneFinalHourADBase,
		Max: vayneFinalHourADBase, Resolved: vayneFinalHourADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: vayneFinalHourFixtureMana, Max: vayneFinalHourFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: vayneFinalHourTargetHP, Current: vayneFinalHourTargetHP,
		Max: vayneFinalHourTargetHP, Resolved: vayneFinalHourTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: vayneFinalHourTargetArmor, Current: vayneFinalHourTargetArmor,
		Max: vayneFinalHourTargetArmor, Resolved: vayneFinalHourTargetArmor,
	})

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runVayneFinalHour(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

type vayneFinalHourFrameBundle struct {
	done      model.DoneResult
	sessionID string
	rulesHash string
	session   *Session
}

// runVayneFinalHourFrames exercises CompileFrame → RunFrame → ReleaseSessionFrame
// and proves the released session cannot be run again (Graves QD release precedent).
func runVayneFinalHourFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) vayneFinalHourFrameBundle {
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
		if p.ProviderKey != vayneFinalHourProviderRef {
			continue
		}
		field, ok := p.StateFields[vayneFinalHourStateKey]
		if !ok {
			t.Fatal("final_hour_active state field missing after compile")
		}
		if !field.HasCap || field.MaxValue != 1 ||
			field.DurationMs != int64(vayneFinalHourDurationMs) ||
			field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
			t.Fatalf("compiled final_hour_active=%+v want max1 duration12000 refresh_on_write", field)
		}
		if math.Abs(field.DefaultValue) > vayneFinalHourTol {
			t.Fatalf("defaultValue=%v want 0", field.DefaultValue)
		}
		if len(p.Listeners) != 0 {
			t.Fatalf("compiled Listeners=%d want 0", len(p.Listeners))
		}
		found = true
		break
	}
	if !found {
		t.Fatal("final hour provider missing from compiled session")
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

	return vayneFinalHourFrameBundle{
		done: done, sessionID: compiled.SessionID, rulesHash: compiled.RulesHash, session: session,
	}
}

func vayneFinalHourFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == vayneFinalHourProviderRef {
			return p
		}
	}
	return nil
}

func vayneFinalHourFindAbility(p *model.ProviderDefinition, key string) *model.AbilityDefinition {
	for i := range p.Abilities {
		if p.Abilities[i].AbilityKey == key {
			return &p.Abilities[i]
		}
	}
	return nil
}

func vayneFinalHourSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func vayneFinalHourActiveState(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		raw, ok := c.ProviderState[vayneFinalHourProviderRef]
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
		v, _ := state[vayneFinalHourStateKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func vayneFinalHourSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func vayneFinalHourProbeDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != vayneFinalHourProbeOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func vayneFinalHourRDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	ref := vayneFinalHourAbilityRef()
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "abilityRef") == ref {
			out = append(out, item)
		}
	}
	return out
}

func findVayneFinalHourAbilityStat(t *testing.T, done model.DoneResult, abilityRef string) model.AbilityStat {
	t.Helper()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == abilityRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", abilityRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func assertVayneFinalHourProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := vayneFinalHourFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_vayne_r_final_hour_timed_bonus_ad missing from SharedProviders")
	}
	if p.ProviderKey != vayneFinalHourProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, vayneFinalHourProviderRef)
	}
	if p.StableID != vayneFinalHourStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, vayneFinalHourStableID)
	}
	if p.Kind != "passive" {
		t.Fatalf("kind=%q want passive (Backend 20120)", p.Kind)
	}
	for _, banned := range []string{
		vayneFinalHourSilverBoltsKey, vayneFinalHourSilverBoltsRef,
		vayneFinalHourTumbleRef, vayneFinalHourBasicRef, vayneFinalHourCondemnRef,
		gcohVayneProviderRef,
	} {
		if p.ProviderKey == banned || p.StableID == banned {
			t.Fatalf("final hour must not reuse Vayne provider ref %q", banned)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no ability_started / source_owner scaffold)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 1 {
		t.Fatalf("InitialStateSchema keys=%d want 1 (final_hour_active only)", len(p.InitialStateSchema))
	}
	schema, ok := p.InitialStateSchema[vayneFinalHourStateKey].(map[string]interface{})
	if !ok {
		t.Fatalf("initialStateSchema missing %s: %+v", vayneFinalHourStateKey, p.InitialStateSchema)
	}
	if schema["refreshPolicy"] != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%v want %v", schema["refreshPolicy"], model.ProviderStateRefreshOnWrite)
	}
	if math.Abs(schema["defaultValue"].(float64)) > vayneFinalHourTol ||
		math.Abs(schema["maxValue"].(float64)-1) > vayneFinalHourTol ||
		math.Abs(schema["durationMs"].(float64)-vayneFinalHourDurationMs) > vayneFinalHourTol {
		t.Fatalf("final_hour_active schema=%+v want default0/max1/duration12000", schema)
	}

	if len(p.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1 (flat AD add)", len(p.Modifiers))
	}
	mod := p.Modifiers[0]
	if mod.ModifierKey != vayneFinalHourBonusADMod || mod.Kind != "attribute" ||
		mod.Target != "ad" || mod.ValuePolicy != "add" {
		t.Fatalf("modifier=%+v want final_hour_bonus_ad attribute ad add", mod)
	}
	if mod.Value.Op != "mul" || len(mod.Value.Args) != 2 {
		t.Fatalf("modifier value=%+v want mul(65, provider.state.final_hour_active)", mod.Value)
	}
	if mod.Value.Args[0].Op != "const" || mod.Value.Args[0].Value == nil ||
		math.Abs(*mod.Value.Args[0].Value-vayneFinalHourBonusAD) > vayneFinalHourTol {
		t.Fatalf("bonus AD const=%+v want 65", mod.Value.Args[0])
	}
	if mod.Value.Args[1].Op != "read" ||
		mod.Value.Args[1].Path != "provider.state."+vayneFinalHourStateKey {
		t.Fatalf("bonus AD read=%+v want provider.state.%s", mod.Value.Args[1], vayneFinalHourStateKey)
	}

	if len(p.Abilities) != 2 {
		t.Fatalf("abilities=%d want 2 (final_hour + fixture probe)", len(p.Abilities))
	}
	ab := vayneFinalHourFindAbility(p, vayneFinalHourAbilityKey)
	if ab == nil {
		t.Fatal("final_hour ability missing")
	}
	if ab.AbilityKey != vayneFinalHourAbilityKey || ab.Kind != "active" {
		t.Fatalf("ability=%+v want %s active", ab, vayneFinalHourAbilityKey)
	}
	for _, typ := range ab.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("final_hour must not be tagged ability/basic_attack")
		}
	}
	if ab.Cost == nil || ab.Cost.ResourceKey != "mana" ||
		ab.Cost.Amount.Op != "const" || ab.Cost.Amount.Value == nil ||
		math.Abs(*ab.Cost.Amount.Value-vayneFinalHourManaCost) > vayneFinalHourTol {
		t.Fatalf("cost=%+v want mana const 80", ab.Cost)
	}
	if ab.Cooldown == nil || ab.Cooldown.DurationMs.Op != "const" || ab.Cooldown.DurationMs.Value == nil ||
		math.Abs(*ab.Cooldown.DurationMs.Value-vayneFinalHourCDMs) > vayneFinalHourTol {
		t.Fatalf("cooldown=%+v want const 70000", ab.Cooldown)
	}
	if len(ab.Operations) != 1 {
		t.Fatalf("ops=%d want 1 (direct state_change only; no R damage)", len(ab.Operations))
	}
	op := ab.Operations[0]
	if op.Operation != "state_change" || op.Target != "source" ||
		op.Ref != vayneFinalHourStateKey || op.ValuePolicy != "override" ||
		len(op.Types) != 1 || op.Types[0] != "state_scope/provider" ||
		op.Amount == nil || op.Amount.Op != "const" || op.Amount.Value == nil ||
		math.Abs(*op.Amount.Value-1) > vayneFinalHourTol {
		t.Fatalf("op=%+v want state_change source provider override const1", op)
	}

	probe := vayneFinalHourFindAbility(p, vayneFinalHourProbeKey)
	if probe == nil {
		t.Fatal("fixture physical probe missing")
	}
	if len(probe.Types) != 1 || probe.Types[0] != "ability/basic_attack" {
		t.Fatalf("probe types=%v want [ability/basic_attack]", probe.Types)
	}
	if len(probe.Operations) != 1 || probe.Operations[0].Operation != "damage" ||
		probe.Operations[0].DamageType != "damage/physical" ||
		probe.Operations[0].Amount == nil ||
		probe.Operations[0].Amount.Op != "read" ||
		probe.Operations[0].Amount.Path != "source.attr.ad.resolved" {
		t.Fatalf("probe op=%+v want single physical damage reading source.attr.ad.resolved", probe.Operations)
	}

	assertVayneFinalHourNoExcludedGraph(t, *p, compileReq)
}

func assertVayneFinalHourNoExcludedGraph(t *testing.T, p model.ProviderDefinition, compileReq model.CompileRequest) {
	t.Helper()
	ab := vayneFinalHourFindAbility(&p, vayneFinalHourAbilityKey)
	if ab == nil {
		t.Fatal("final_hour missing for exclusion scan")
	}
	bannedOps := map[string]bool{
		"damage": true, "slow": true, "stun": true, "knockback": true,
		"displacement": true, "projectile": true, "dash": true, "move": true,
		"multi_target": true, "geometry": true, "reload": true, "repeat": true,
		"apply_status": true, "emit_event": true, "state_duration_change": true,
		"resource_change": true, "cooldown_change": true,
	}
	for _, op := range ab.Operations {
		if bannedOps[op.Operation] {
			t.Fatalf("final_hour must not include excluded op %q: %+v", op.Operation, op)
		}
		if op.DamageType != "" {
			t.Fatalf("final_hour must not carry damageType: %+v", op)
		}
	}
	for _, mod := range p.Modifiers {
		if mod.Kind == "pipeline" || mod.Command == "damage" {
			t.Fatalf("must not include damage pipeline modifier: %+v", mod)
		}
		if mod.Target == "move_speed" || strings.Contains(mod.Target, "invis") {
			t.Fatalf("must not include Night Hunter / stealth movement modifier: %+v", mod)
		}
	}
	for _, e := range compileReq.TypeCatalog.Types {
		if e.Key == "event/ability_started" || e.Key == "event/source_owner" {
			t.Fatalf("type catalog must not include %q (no ability-start scaffold)", e.Key)
		}
	}
	if vayneFinalHourBoundary != "rank3_timed_bonus_ad_self_buff; direct_provider_state_change; "+
		"flat_ad_plus_65_for_12000ms; "+
		"no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement" {
		t.Fatal("frozen boundary constant drifted")
	}
	tags := vayneFinalHourOrderedTags()
	if len(tags) != 4 ||
		tags[0] != vayneFinalHourTagCostCD ||
		tags[1] != vayneFinalHourTagCastTimedAD ||
		tags[2] != vayneFinalHourTagFlatADAdd ||
		tags[3] != vayneFinalHourTagTimedProvSt {
		t.Fatalf("ordered tags drifted: %v", tags)
	}
}

func vayneFinalHourWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "vayne-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func vayneFinalHourWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "vayne-r.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func vayneFinalHourWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "vayne-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func vayneFinalHourSeedPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"db", "game_manage", "seeds", "lol_generic_vayne_final_hour_timed_bonus_ad_seed.sql")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("backend seed missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type vayneFinalHourWikiSidecar struct {
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
		Leveling2    string `json:"leveling2"`
		Description3 string `json:"description3"`
		Cooldown     string `json:"cooldown"`
		Cost         string `json:"cost"`
		Costtype     string `json:"costtype"`
		Notes        string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

type vayneFinalHourWikiPages struct {
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

func vayneFinalHourLoadWikiSidecar(t *testing.T) vayneFinalHourWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(vayneFinalHourWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc vayneFinalHourWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

func vayneFinalHourLoadWikiPages(t *testing.T) vayneFinalHourWikiPages {
	t.Helper()
	raw, err := os.ReadFile(vayneFinalHourWikiPagesPath(t))
	if err != nil {
		t.Fatalf("read wiki pages: %v", err)
	}
	var doc vayneFinalHourWikiPages
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki pages: %v", err)
	}
	return doc
}

func vayneFinalHourLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(vayneFinalHourSeedPath(t))
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

func vayneFinalHourSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func vayneFinalHourStripSQLStringLiterals(s string) string {
	var b strings.Builder
	inSingle := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == '\'' {
			if inSingle {
				// SQL '' escape inside literal
				if i+1 < len(s) && s[i+1] == '\'' {
					i++
					continue
				}
				inSingle = false
				continue
			}
			inSingle = true
			continue
		}
		if !inSingle {
			b.WriteByte(ch)
		}
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// Evidence tests
// ---------------------------------------------------------------------------

// TestGenericVayneFinalHourWikiSidecarIdentityAndBoundary locks repository
// sidecar/pages/raw identity plus frozen boundary / ordered-tag constants.
// Local raw is asserted for known non-canonical materialization only.
func TestGenericVayneFinalHourWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := vayneFinalHourLoadWikiSidecar(t)
	if doc.CandidateKey != vayneFinalHourCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, vayneFinalHourCandidateKey)
	}
	if doc.RequestTitle != vayneFinalHourRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, vayneFinalHourRequestTitle)
	}
	if doc.ResolvedTitle != vayneFinalHourResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, vayneFinalHourResolvedTitle)
	}
	if doc.WikiPageID != vayneFinalHourWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, vayneFinalHourWikiPageID)
	}
	if doc.RevisionID != vayneFinalHourRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, vayneFinalHourRevisionID)
	}
	if doc.RevisionTimestamp != vayneFinalHourTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, vayneFinalHourTimestamp)
	}
	if doc.ContentSHA256 != vayneFinalHourContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, vayneFinalHourContentSHA)
	}
	if doc.RawByteSize != vayneFinalHourCanonicalBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, vayneFinalHourCanonicalBytes)
	}
	if doc.SkillKey != "R" || doc.ZhDisplayName != "终极时刻" || doc.OwnerID != "hero_vayne" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want R/终极时刻/hero_vayne",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "leveling2", "description3",
		"cooldown", "cost", "costtype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "80\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "80\n")
	}
	if doc.Fields.Cooldown != "{{ap|100 to 70}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|100 to 70}}\n")
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("fields.costtype=%q want Mana", doc.Fields.Costtype)
	}
	if doc.Fields.Leveling == "" || !strings.Contains(doc.Fields.Leveling, "{{ap|35 to 65 3}}") {
		t.Fatalf("leveling missing rank-3 bonus AD band: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|8 to 12}}") {
		t.Fatalf("leveling missing duration band: %q", doc.Fields.Leveling)
	}

	pages := vayneFinalHourLoadWikiPages(t)
	if pages.CandidateKey != vayneFinalHourCandidateKey {
		t.Fatalf("pages.candidateKey=%q want %q", pages.CandidateKey, vayneFinalHourCandidateKey)
	}
	if doc.CandidateKey != pages.CandidateKey {
		t.Fatalf("sidecar/pages candidateKey diverge: sidecar=%q pages=%q",
			doc.CandidateKey, pages.CandidateKey)
	}
	if pages.RequestTitle != vayneFinalHourRequestTitle ||
		pages.ResolvedTitle != vayneFinalHourResolvedTitle ||
		pages.PageID != vayneFinalHourWikiPageID ||
		pages.RevisionID != vayneFinalHourRevisionID ||
		pages.RevisionTimestamp != vayneFinalHourTimestamp ||
		pages.ContentSHA256 != vayneFinalHourContentSHA ||
		pages.RawByteSize != vayneFinalHourCanonicalBytes ||
		pages.SkillKey != "R" || pages.ZhDisplayName != "终极时刻" || pages.OwnerID != "hero_vayne" {
		t.Fatalf("pages identity must agree with sidecar canonical fields; got %+v", pages)
	}

	raw, err := os.ReadFile(vayneFinalHourWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) != vayneFinalHourLocalRawBytes {
		t.Fatalf("local raw len=%d want %d (known non-canonical materialization)",
			len(raw), vayneFinalHourLocalRawBytes)
	}
	localSHA := vayneFinalHourSHA256Hex(raw)
	if localSHA != vayneFinalHourLocalRawSHA {
		t.Fatalf("local raw sha=%q want known materialization %q",
			localSHA, vayneFinalHourLocalRawSHA)
	}
	if localSHA == vayneFinalHourContentSHA {
		t.Fatal("local raw hash must not equal canonical contentSha256 (non-canonical materialization)")
	}

	if vayneFinalHourBoundary != "rank3_timed_bonus_ad_self_buff; direct_provider_state_change; "+
		"flat_ad_plus_65_for_12000ms; "+
		"no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement" {
		t.Fatal("frozen boundary constant drifted")
	}
	tags := vayneFinalHourOrderedTags()
	if tags[0] != "ability_cost_cooldown" || tags[3] != "timed_provider_state" {
		t.Fatalf("ordered tags drifted: %v", tags)
	}
}

// TestGenericVayneFinalHourBackendSeedDirectStateChangeGraph asserts the integrated
// Backend SQL matches the direct state-change graph, zero listener/event scaffold,
// formula/numerics, independent provider mount, and Vayne coexistence guards.
func TestGenericVayneFinalHourBackendSeedDirectStateChangeGraph(t *testing.T) {
	seed, sqlNoComments := vayneFinalHourLoadSeedSQL(t)
	sqlExec := vayneFinalHourStripSQLStringLiterals(sqlNoComments)

	for _, want := range []string{
		vayneFinalHourCandidateKey,
		vayneFinalHourPlanRev,
		vayneFinalHourRequestTitle,
		vayneFinalHourResolvedTitle,
		"1309991",
		"3807995",
		vayneFinalHourTimestamp,
		vayneFinalHourContentSHA,
		vayneFinalHourLocalRawSHA,
		"2015",
		"2012",
		vayneFinalHourBoundary,
		vayneFinalHourProviderRef,
		vayneFinalHourAbilityID,
		vayneFinalHourAbilityKey,
		vayneFinalHourStableID,
		vayneFinalHourStateKey,
		vayneFinalHourBonusADMod,
		"final_hour_active_arm",
		`{"op":"mul","args":[{"op":"const","value":65},{"op":"read","path":"provider.state.final_hour_active"}]}`,
		`{"op":"const","value":80}`,
		`{"op":"const","value":70000}`,
		`{"op":"const","value":1}`,
		"mana300",
		"232/232",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing required substring %q", want)
		}
	}
	// Fail closed: one authoritative key only; reject seed/wiki naming split and typo.
	if !strings.Contains(seed, vayneFinalHourCandidateKey) {
		t.Fatalf("seed missing exact stable candidateKey %q", vayneFinalHourCandidateKey)
	}
	bannedTypoKey := "hero_skill|hero_vayne|R|最终时刻"
	if strings.Contains(seed, bannedTypoKey) {
		t.Fatalf("seed must not contain typo candidateKey %q", bannedTypoKey)
	}
	if strings.Contains(seed, "最终时刻") {
		t.Fatal("seed must not contain human-readable typo 最终时刻 (authoritative name is 终极时刻)")
	}
	for _, tag := range vayneFinalHourOrderedTags() {
		if !strings.Contains(seed, tag) {
			t.Fatalf("seed missing ordered tag %q", tag)
		}
	}
	i0 := strings.Index(seed, vayneFinalHourTagCostCD)
	i1 := strings.Index(seed, vayneFinalHourTagCastTimedAD)
	i2 := strings.Index(seed, vayneFinalHourTagFlatADAdd)
	i3 := strings.Index(seed, vayneFinalHourTagTimedProvSt)
	if !(i0 >= 0 && i0 < i1 && i1 < i2 && i2 < i3) {
		t.Fatal("ordered tags must appear in frozen order in seed comments")
	}

	// Direct state-change graph: one impact phase / sequence / step / state_effect_details.
	for _, needle := range []string{
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.state_effect_details",
		"INSERT INTO public.provider_modifiers",
		"phase_hero_vayne_r_final_hour_timed_bonus_ad_impact",
		"sequence_hero_vayne_r_final_hour_timed_bonus_ad_impact",
		"step_hero_vayne_r_final_hour_timed_bonus_ad_active_arm",
		"modifier_hero_vayne_r_final_hour_timed_bonus_ad",
	} {
		if !strings.Contains(sqlNoComments, needle) {
			t.Fatalf("executable-ish seed missing %q", needle)
		}
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.ability_phases") != 1 {
		t.Fatal("seed must define exactly one ability phase")
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.state_effect_details") != 1 {
		t.Fatal("seed must define exactly one state_effect_details")
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.provider_modifiers") != 1 {
		t.Fatal("seed must define exactly one provider modifier")
	}
	if !strings.Contains(seed, "12000") || !strings.Contains(seed, "20190") {
		t.Fatal("seed must encode duration 12000ms / refresh_on_write 20190")
	}
	if !strings.Contains(seed, "20250") || !strings.Contains(seed, "20172") {
		t.Fatal("seed must encode state_scope/provider 20250 / override 20172")
	}
	if !strings.Contains(seed, "20160") || !strings.Contains(seed, "20110") {
		t.Fatal("seed must encode operation/state_change 20160 targeting self/source 20110")
	}

	// Zero listener / ability_started / source_owner scaffold.
	for _, banned := range []string{
		"INSERT INTO public.provider_listeners",
		"INSERT INTO public.listener_match_types",
		"INSERT INTO public.listener_effect_sequences",
	} {
		if strings.Contains(strings.ToLower(sqlNoComments), strings.ToLower(banned)) {
			t.Fatalf("seed must not write listener scaffold: %s", banned)
		}
	}
	if strings.Contains(sqlExec, "20205") || strings.Contains(sqlExec, "20212") {
		t.Fatal("executable SQL must not depend on event/ability_started 20205 or event/source_owner 20212")
	}
	lowerExec := strings.ToLower(sqlExec)
	if strings.Contains(lowerExec, "ability_started") || strings.Contains(lowerExec, "source_owner") {
		t.Fatal("executable SQL must not embed ability_started/source_owner scaffold tokens")
	}

	// Independent mount + coexistence with existing Vayne providers (comments/guards).
	if !strings.Contains(seed, "entity_provider_mounts") ||
		!strings.Contains(seed, "'hero_vayne'") ||
		!strings.Contains(seed, vayneFinalHourProviderRef) {
		t.Fatal("seed must mount independent final-hour provider on hero_vayne")
	}
	for _, preserved := range []string{
		vayneFinalHourBasicRef, vayneFinalHourSilverBoltsRef,
		vayneFinalHourTumbleRef, vayneFinalHourCondemnRef,
	} {
		if !strings.Contains(seed, preserved) {
			t.Fatalf("seed must document coexistence guard for %q", preserved)
		}
	}
	if !strings.Contains(seed, "不更新") && !strings.Contains(seed, "永不更新") &&
		!strings.Contains(strings.ToLower(seed), "never") {
		t.Fatal("seed must preserve existing Vayne providers (no update/delete/rebuild)")
	}

	// Excluded damage/control surfaces absent from executable inserts.
	for _, banned := range []string{
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.control_effect_details",
		"INSERT INTO public.event_effect_details",
		"INSERT INTO public.repeat_effect_details",
	} {
		if strings.Contains(strings.ToLower(sqlNoComments), strings.ToLower(banned)) {
			t.Fatalf("seed must not write excluded detail surface: %s", banned)
		}
	}
}

// TestGenericVayneFinalHourCompileShapeDirectTimedBonusAD asserts compile/shape
// for the frozen direct provider-state AD buff (zero listeners; no ability-start).
func TestGenericVayneFinalHourCompileShapeDirectTimedBonusAD(t *testing.T) {
	compileReq, runReq := loadVayneFinalHourFixture(t)
	assertVayneFinalHourProviderShape(t, compileReq)
	done := runVayneFinalHour(t, compileReq, runReq)
	if math.Abs(done.Summary.SourceDamageDealt) > vayneFinalHourTol {
		t.Fatalf("sourceDamageDealt=%v want 0 (shape-only; no cast)", done.Summary.SourceDamageDealt)
	}
	if got := vayneFinalHourActiveState(t, done.FinalSnapshot); math.Abs(got) > vayneFinalHourTol {
		t.Fatalf("final_hour_active without cast=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-vayneFinalHourADBase) > vayneFinalHourTol {
		t.Fatalf("ad.resolved without cast=%v want %v", got, vayneFinalHourADBase)
	}
	if vayneFinalHourAbilityID != "ability_hero_vayne_r_final_hour_timed_bonus_ad" {
		t.Fatal("ability id constant drifted")
	}
	if vayneFinalHourPlanRev != "vayne-r-final-hour-timed-bonus-ad-phase-a-v2" {
		t.Fatal("plan rev constant drifted")
	}
}

// TestGenericVayneFinalHourActivationExpirySchedule: R@t0, probe@t1, probe@t12001.
// Asserts one successful R cast, mana 300→220, AD 125 then 60, probe damages
// 125/62.5 then 60/30, and R itself contributes no damage.
func TestGenericVayneFinalHourActivationExpirySchedule(t *testing.T) {
	compileReq, runReq := loadVayneFinalHourFixture(t)
	assertVayneFinalHourProviderShape(t, compileReq)

	rRef := vayneFinalHourAbilityRef()
	pRef := vayneFinalHourProbeRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_live", AbilityRef: pRef, Source: "source", Target: "target", FirstAtMs: 1},
		{EntryKey: "probe_expired", AbilityRef: pRef, Source: "source", Target: "target", FirstAtMs: 12001},
	}
	runReq.StopPolicy.DurationMs = 12100

	done := runVayneFinalHour(t, compileReq, runReq)

	rStat := findVayneFinalHourAbilityStat(t, done, rRef)
	if rStat.CastCount != 1 || rStat.AttemptCount != 1 || rStat.SkipCount != 0 {
		t.Fatalf("R abilityStat cast/attempt/skip=%d/%d/%d want 1/1/0",
			rStat.CastCount, rStat.AttemptCount, rStat.SkipCount)
	}
	pStat := findVayneFinalHourAbilityStat(t, done, pRef)
	if pStat.CastCount != 2 {
		t.Fatalf("probe castCount=%d want 2", pStat.CastCount)
	}

	if got := vayneFinalHourSourceMana(t, done.FinalSnapshot); math.Abs(got-vayneFinalHourManaAfter1) > vayneFinalHourTol {
		t.Fatalf("mana=%v want %v (one successful R; probes free)", got, vayneFinalHourManaAfter1)
	}
	if got := vayneFinalHourActiveState(t, done.FinalSnapshot); math.Abs(got) > vayneFinalHourTol {
		t.Fatalf("final_hour_active after expiry=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-vayneFinalHourADBase) > vayneFinalHourTol {
		t.Fatalf("ad.resolved after expiry=%v want %v", got, vayneFinalHourADBase)
	}

	if n := len(vayneFinalHourRDamageEvidence(done)); n != 0 {
		t.Fatalf("R damage evidence=%d want 0 (R contributes no damage)", n)
	}
	probes := vayneFinalHourProbeDamageEvidence(done)
	if len(probes) != 2 {
		t.Fatalf("probe damages=%d want 2", len(probes))
	}
	want := []struct {
		tMs int64
		raw float64
		mit float64
	}{
		{1, vayneFinalHourProbeRawActive, vayneFinalHourProbeMitActive},
		{12001, vayneFinalHourProbeRawExpired, vayneFinalHourProbeMitExpired},
	}
	for i, w := range want {
		item := probes[i]
		if item.TimeMs != w.tMs {
			t.Fatalf("probe[%d] TimeMs=%d want %d", i, item.TimeMs, w.tMs)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-w.raw) > vayneFinalHourTol {
			t.Fatalf("probe[%d] raw=%v want %v", i, raw, w.raw)
		}
		if math.Abs(mit-w.mit) > vayneFinalHourTol {
			t.Fatalf("probe[%d] mitigated=%v want %v", i, mit, w.mit)
		}
		wantMit := expectedMitigatedPhysical(w.raw, vayneFinalHourTargetArmor)
		if math.Abs(mit-wantMit) > vayneFinalHourTol {
			t.Fatalf("probe[%d] mitigated algebra=%v want %v", i, mit, wantMit)
		}
		if evidenceDataString(item.Data, "damageType") != "damage/physical" {
			t.Fatalf("probe[%d] type=%q", i, evidenceDataString(item.Data, "damageType"))
		}
	}

	wantDealt := vayneFinalHourProbeMitActive + vayneFinalHourProbeMitExpired
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v (probes only)", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestGenericVayneFinalHourActiveBuffSnapshotAtT1: R@0 + probe@1 proves live
// state/AD while buff is active (complements expiry schedule).
func TestGenericVayneFinalHourActiveBuffSnapshotAtT1(t *testing.T) {
	compileReq, runReq := loadVayneFinalHourFixture(t)
	rRef := vayneFinalHourAbilityRef()
	pRef := vayneFinalHourProbeRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_live", AbilityRef: pRef, Source: "source", Target: "target", FirstAtMs: 1},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runVayneFinalHour(t, compileReq, runReq)

	if got := vayneFinalHourActiveState(t, done.FinalSnapshot); math.Abs(got-1) > vayneFinalHourTol {
		t.Fatalf("final_hour_active@t1=%v want 1", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-vayneFinalHourADBuffed) > vayneFinalHourTol {
		t.Fatalf("ad.resolved@t1=%v want %v", got, vayneFinalHourADBuffed)
	}
	if got := vayneFinalHourSourceMana(t, done.FinalSnapshot); math.Abs(got-vayneFinalHourManaAfter1) > vayneFinalHourTol {
		t.Fatalf("mana=%v want %v", got, vayneFinalHourManaAfter1)
	}
	probes := vayneFinalHourProbeDamageEvidence(done)
	if len(probes) != 1 {
		t.Fatalf("probes=%d want 1", len(probes))
	}
	if math.Abs(evidenceDataFloat(probes[0].Data, "rawAmount")-vayneFinalHourProbeRawActive) > vayneFinalHourTol {
		t.Fatalf("probe raw=%v want %v", evidenceDataFloat(probes[0].Data, "rawAmount"), vayneFinalHourProbeRawActive)
	}
}

// TestGenericVayneFinalHourCooldownSchedule: R attempts at t0 / t69999 / t70000.
// First and third succeed; t69999 is exactly one cooldown skip with no mana spend
// and no state write/rearm; final mana 140; state active after second success.
func TestGenericVayneFinalHourCooldownSchedule(t *testing.T) {
	compileReq, runReq := loadVayneFinalHourFixture(t)
	assertVayneFinalHourProviderShape(t, compileReq)

	ref := vayneFinalHourAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 69999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 70000},
	}
	runReq.StopPolicy.DurationMs = 70100

	done := runVayneFinalHour(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2 (canonical cast evidence; not ability_started)",
			done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if vayneFinalHourSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findVayneFinalHourAbilityStat(t, done, ref)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt69999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 69999 {
			t.Fatalf("cooldown skip TimeMs=%d want 69999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 70000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 70000", item.Data["readyAtMs"])
		}
		skipAt69999 = true
	}
	if !skipAt69999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=69999 with readyAtMs=70000")
	}

	if got := vayneFinalHourSourceMana(t, done.FinalSnapshot); math.Abs(got-vayneFinalHourManaAfter2) > vayneFinalHourTol {
		t.Fatalf("mana=%v want %v (two successful casts; early skipped; no mana spend on skip)",
			got, vayneFinalHourManaAfter2)
	}
	if got := vayneFinalHourActiveState(t, done.FinalSnapshot); math.Abs(got-1) > vayneFinalHourTol {
		t.Fatalf("final_hour_active after second success=%v want 1 (skip did not rearm; second cast did)", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-vayneFinalHourADBuffed) > vayneFinalHourTol {
		t.Fatalf("ad.resolved after second cast=%v want %v", got, vayneFinalHourADBuffed)
	}
	if n := len(vayneFinalHourRDamageEvidence(done)); n != 0 {
		t.Fatalf("R damage evidence=%d want 0", n)
	}
	if math.Abs(done.Summary.SourceDamageDealt) > vayneFinalHourTol {
		t.Fatalf("sourceDamageDealt=%v want 0 (R has no damage; no probe in this schedule)",
			done.Summary.SourceDamageDealt)
	}
}

// TestGenericVayneFinalHourAlgebraCrossCheck: independent 60+65 and armor mitigation.
func TestGenericVayneFinalHourAlgebraCrossCheck(t *testing.T) {
	if math.Abs(vayneFinalHourADBase+vayneFinalHourBonusAD-vayneFinalHourADBuffed) > vayneFinalHourTol {
		t.Fatalf("buffed AD algebra=%v want %v", vayneFinalHourADBase+vayneFinalHourBonusAD, vayneFinalHourADBuffed)
	}
	mitActive := expectedMitigatedPhysical(vayneFinalHourProbeRawActive, vayneFinalHourTargetArmor)
	mitExpired := expectedMitigatedPhysical(vayneFinalHourProbeRawExpired, vayneFinalHourTargetArmor)
	if math.Abs(mitActive-vayneFinalHourProbeMitActive) > vayneFinalHourTol {
		t.Fatalf("active mitigated=%v want %v", mitActive, vayneFinalHourProbeMitActive)
	}
	if math.Abs(mitExpired-vayneFinalHourProbeMitExpired) > vayneFinalHourTol {
		t.Fatalf("expired mitigated=%v want %v", mitExpired, vayneFinalHourProbeMitExpired)
	}
	if math.Abs(vayneFinalHourFixtureMana-vayneFinalHourManaCost-vayneFinalHourManaAfter1) > vayneFinalHourTol ||
		math.Abs(vayneFinalHourFixtureMana-2*vayneFinalHourManaCost-vayneFinalHourManaAfter2) > vayneFinalHourTol {
		t.Fatal("mana algebra drifted")
	}
}

// TestGenericVayneFinalHourDeterminismAndRelease: repeat CompileGeneric/RunGeneric
// evidence is stable; CompileFrame path releases the session without leak.
func TestGenericVayneFinalHourDeterminismAndRelease(t *testing.T) {
	runOnce := func() (string, string, string) {
		c, r := loadVayneFinalHourFixture(t)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: vayneFinalHourAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "probe", AbilityRef: vayneFinalHourProbeRef(), Source: "source", Target: "target", FirstAtMs: 1},
			{EntryKey: "probe2", AbilityRef: vayneFinalHourProbeRef(), Source: "source", Target: "target", FirstAtMs: 12001},
		}
		r.StopPolicy.DurationMs = 12100
		done := runVayneFinalHour(t, c, r)
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
	if s1 != s2 {
		t.Fatal("summary unstable across runs")
	}
	if e1 != e2 {
		t.Fatal("evidence unstable across runs")
	}
	if f1 != f2 {
		t.Fatal("finalSnapshot unstable across runs")
	}

	c, r := loadVayneFinalHourFixture(t)
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: vayneFinalHourAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	r.StopPolicy.DurationMs = 50
	bundle := runVayneFinalHourFrames(t, c, r)
	if got := vayneFinalHourActiveState(t, bundle.done.FinalSnapshot); math.Abs(got-1) > vayneFinalHourTol {
		t.Fatalf("frame-path final_hour_active=%v want 1", got)
	}
	if got := vayneFinalHourSourceMana(t, bundle.done.FinalSnapshot); math.Abs(got-vayneFinalHourManaAfter1) > vayneFinalHourTol {
		t.Fatalf("frame-path mana=%v want %v", got, vayneFinalHourManaAfter1)
	}
	if _, still := bundle.session.genericSessions[bundle.sessionID]; still {
		t.Fatal("released session must not remain registered (session leak)")
	}
}
