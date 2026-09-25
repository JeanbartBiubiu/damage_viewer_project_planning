package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_kogmaw R Living Artillery / 活体大炮 — Phase-A v2 Wasm exact verification
// (FROZEN_PLAN_REV: kogmaw-r-living-artillery-phase-a-v2).
//
// Frozen boundary:
//
//	rank3_primary_target_living_artillery; immediate_impact_scaffold;
//	magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier;
//	escalating_mana_40_plus_40_per_stack_max9_for_8000ms;
//	no_delay_location_geometry_multitarget_sight_reveal_or_stealth
//
// Wiki authority (repository sidecar/pages; keep local-raw materialization caveat;
// do not claim equivalence or source contradiction):
//
//	Candidate hero_skill|hero_kogmaw|R|活体大炮
//	task wasm-generic-kogmaw-living-artillery
//	Request Template:Data Kog'Maw/R → resolved Template:Data Kog'Maw/Living Artillery
//	wikiPageId 1307963 / rev 4007636 / timestamp 2026-04-12T08:34:32Z
//	canonical rawByteSize 2453 / SHA256 32f8dd8d…8641
//	local raw noncanonical 2452 / SHA256 11db6c16…e447
//	数据参考/lol-wiki-current-champions/{normalized/generic,pages}/kogmaw-r.json
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_kogmaw_r_living_artillery
//   - timed state living_artillery_stacks: default0 / max9 / 8000ms / refresh_on_write
//   - active living_artillery: CD const1000ms; cost 40*(1+stacks) before ops
//   - op0: non-crit/non-copyable magic damage; op1: provider state add const1
//   - Exactly two ordered operations; zero listeners; no ability_started/source_owner
//
// Explicit exclusions (completed boundary; not remaining blockers):
//   0.6s delay; location/range/radius/projectile/arc/collision/travel/area/
//   multi-target; sight/reveal/stealth; ranks1–2; P/Q/W/E/basic/combo;
//   equipment/runes/loadout; spell shield; animation; live migration/publish/
//   browser E2E/full-game fidelity.

const (
	kogmawLivingArtilleryCandidateKey   = "hero_skill|hero_kogmaw|R|活体大炮"
	kogmawLivingArtilleryTaskKey        = "wasm-generic-kogmaw-living-artillery"
	kogmawLivingArtilleryPlanRev        = "kogmaw-r-living-artillery-phase-a-v2"
	kogmawLivingArtilleryRequestTitle   = "Template:Data Kog'Maw/R"
	kogmawLivingArtilleryResolvedTitle  = "Template:Data Kog'Maw/Living Artillery"
	kogmawLivingArtilleryWikiPageID     = 1307963
	kogmawLivingArtilleryRevisionID     = 4007636
	kogmawLivingArtilleryTimestamp      = "2026-04-12T08:34:32Z"
	kogmawLivingArtilleryCanonicalBytes = 2453
	kogmawLivingArtilleryContentSHA     = "32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641"
	kogmawLivingArtilleryLocalRawBytes  = 2452
	kogmawLivingArtilleryLocalRawSHA    = "11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447"
	kogmawLivingArtilleryBoundary       = "rank3_primary_target_living_artillery; immediate_impact_scaffold; " +
		"magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; " +
		"escalating_mana_40_plus_40_per_stack_max9_for_8000ms; " +
		"no_delay_location_geometry_multitarget_sight_reveal_or_stealth"

	kogmawLivingArtilleryProviderRef = "provider_hero_kogmaw_r_living_artillery"
	kogmawLivingArtilleryStableID    = "hero_kogmaw_r_living_artillery"
	kogmawLivingArtilleryAbilityID   = "ability_hero_kogmaw_r_living_artillery"
	kogmawLivingArtilleryAbilityKey  = "living_artillery"
	kogmawLivingArtilleryStacksKey   = "living_artillery_stacks"
	kogmawLivingArtilleryDamageOpRef = "op:kogmaw_living_artillery_damage"
	kogmawLivingArtilleryProbeKey    = "living_artillery_clock_probe"
	kogmawLivingArtilleryProbeOpRef  = "op:kogmaw_living_artillery_clock_probe"
	// Fixture-only flat AD so ad.base stays 61 while ad.resolved becomes 141
	// (attribute resolve overwrites a hand-set Resolved that differs from Base).
	kogmawLivingArtilleryBonusADMod = "fixture_kogmaw_living_artillery_bonus_ad"

	kogmawLivingArtilleryBaseDamage = 180.0
	kogmawLivingArtilleryBonusADRat = 0.75
	kogmawLivingArtilleryAPRatio    = 0.45
	kogmawLivingArtilleryCDMs       = 1000.0
	kogmawLivingArtilleryDurationMs = 8000.0
	kogmawLivingArtilleryMaxStacks  = 9.0
	kogmawLivingArtilleryCostBase   = 40.0

	// Fixture: baseAD61 / resolvedAD141 / AP100 → base 285.
	kogmawLivingArtilleryADBase      = 61.0
	kogmawLivingArtilleryADResolved  = 141.0
	kogmawLivingArtilleryFixtureAP   = 100.0
	kogmawLivingArtilleryTargetMR    = 100.0
	kogmawLivingArtilleryTargetMaxHP = 1000.0

	kogmawLivingArtilleryBaseRaw = 285.0 // 180 + 0.75*80 + 0.45*100

	kogmawLivingArtilleryTol = 1e-9
)

func kogmawLivingArtilleryOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"bonus_ad_and_ap_ratio",
		"missing_health_damage_multiplier",
		"stack_escalating_mana_cost",
		"timed_provider_state",
	}
}

func kogmawLivingArtilleryExpectedBaseRaw(resolvedAD, baseAD, ap float64) float64 {
	return kogmawLivingArtilleryBaseDamage +
		kogmawLivingArtilleryBonusADRat*(resolvedAD-baseAD) +
		kogmawLivingArtilleryAPRatio*ap
}

func kogmawLivingArtilleryMissingHealthMultiplier(currentHP, maxHP float64) float64 {
	denom := maxHP
	if denom < 1 {
		denom = 1
	}
	h := currentHP / denom
	if h < 0 {
		h = 0
	}
	if h > 1 {
		h = 1
	}
	if h < 0.4 {
		return 2
	}
	m := 1 - h
	if m < 0 {
		m = 0
	}
	inc := (5.0 / 6.0) * m
	if inc > 0.5 {
		inc = 0.5
	}
	return 1 + inc
}

func kogmawLivingArtilleryExpectedRaw(currentHP, maxHP float64) float64 {
	return kogmawLivingArtilleryBaseRaw * kogmawLivingArtilleryMissingHealthMultiplier(currentHP, maxHP)
}

func kogmawLivingArtilleryExpectedCost(stacks float64) float64 {
	return kogmawLivingArtilleryCostBase * (1 + stacks)
}

func kogmawLivingArtilleryHPRatioExpr() model.GenericFormulaExpr {
	zero := 0.0
	one := 1.0
	minExpr := model.GenericFormulaExpr{Op: "const", Value: &zero}
	maxExpr := model.GenericFormulaExpr{Op: "const", Value: &one}
	return model.GenericFormulaExpr{
		Op: "clamp",
		Expr: &model.GenericFormulaExpr{
			Op: "div",
			Args: []model.GenericFormulaExpr{
				{Op: "read", Path: "target.attr.hp.current"},
				{
					Op: "max",
					Args: []model.GenericFormulaExpr{
						{Op: "const", Value: &one},
						{Op: "read", Path: "target.attr.hp.max"},
					},
				},
			},
		},
		Min: &minExpr,
		Max: &maxExpr,
	}
}

func kogmawLivingArtilleryDamageAmount() *model.GenericFormulaExpr {
	base := kogmawLivingArtilleryBaseDamage
	adRatio := kogmawLivingArtilleryBonusADRat
	apRatio := kogmawLivingArtilleryAPRatio
	two := 2.0
	one := 1.0
	half := 0.5
	fourTenths := 0.4
	five := 5.0
	six := 6.0
	zero := 0.0
	hpRatio := kogmawLivingArtilleryHPRatioExpr()
	hpRatio2 := kogmawLivingArtilleryHPRatioExpr()
	hpRatio3 := kogmawLivingArtilleryHPRatioExpr()

	// Nested binary add: add(add(180, 0.75*bonusAD), 0.45*AP).
	baseExpr := model.GenericFormulaExpr{
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

	// multiplier = lt(h,0.4)*2 + gte(h,0.4)*normal
	// normal = 1 + min(0.5, (5/6)*max(0,1-h))
	normal := model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &one},
			{
				Op: "min",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &half},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{
								Op: "div",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &five},
									{Op: "const", Value: &six},
								},
							},
							{
								Op: "max",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &zero},
									{
										Op: "sub",
										Args: []model.GenericFormulaExpr{
											{Op: "const", Value: &one},
											hpRatio3,
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
	multiplier := model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{
						Op: "lt",
						Args: []model.GenericFormulaExpr{
							hpRatio,
							{Op: "const", Value: &fourTenths},
						},
					},
					{Op: "const", Value: &two},
				},
			},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{
						Op: "gte",
						Args: []model.GenericFormulaExpr{
							hpRatio2,
							{Op: "const", Value: &fourTenths},
						},
					},
					normal,
				},
			},
		},
	}
	return &model.GenericFormulaExpr{
		Op:   "mul",
		Args: []model.GenericFormulaExpr{baseExpr, multiplier},
	}
}

func kogmawLivingArtilleryManaCostAmount() model.GenericFormulaExpr {
	forty := kogmawLivingArtilleryCostBase
	one := 1.0
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &forty},
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &one},
					{Op: "read", Path: "provider.state." + kogmawLivingArtilleryStacksKey},
				},
			},
		},
	}
}

func kogmawLivingArtilleryStateSchema() map[string]interface{} {
	return map[string]interface{}{
		kogmawLivingArtilleryStacksKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      kogmawLivingArtilleryMaxStacks,
			"durationMs":    kogmawLivingArtilleryDurationMs,
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func kogmawLivingArtilleryAbility() model.AbilityDefinition {
	cd := kogmawLivingArtilleryCDMs
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: kogmawLivingArtilleryAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      kogmawLivingArtilleryManaCostAmount(),
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           kogmawLivingArtilleryDamageOpRef,
				Amount:        kogmawLivingArtilleryDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         kogmawLivingArtilleryStacksKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

// Fixture-only clock probe (not Backend-seeded): typed ability/basic_attack so it
// does not synthesize ability_started; forces lazy-expire via evalContext.
func kogmawLivingArtilleryProbeAbility() model.AbilityDefinition {
	zero := 0.0
	return model.AbilityDefinition{
		AbilityKey: kogmawLivingArtilleryProbeKey,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Ref:        kogmawLivingArtilleryProbeOpRef,
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &zero},
		}},
	}
}

func kogmawLivingArtilleryProviderDef() model.ProviderDefinition {
	bonusAD := kogmawLivingArtilleryADResolved - kogmawLivingArtilleryADBase
	return model.ProviderDefinition{
		ProviderKey:        kogmawLivingArtilleryProviderRef,
		Kind:               "passive",
		StableID:           kogmawLivingArtilleryStableID,
		InitialStateSchema: kogmawLivingArtilleryStateSchema(),
		// Fixture-only flat AD (not Backend-seeded) so resolved-base = 80.
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: kogmawLivingArtilleryBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}},
		Abilities: []model.AbilityDefinition{
			kogmawLivingArtilleryAbility(),
			kogmawLivingArtilleryProbeAbility(),
		},
	}
}

func kogmawLivingArtilleryAbilityRef() string {
	return "source.provider[" + kogmawLivingArtilleryProviderRef + "].ability[" + kogmawLivingArtilleryAbilityKey + "]"
}

func kogmawLivingArtilleryProbeRef() string {
	return "source.provider[" + kogmawLivingArtilleryProviderRef + "].ability[" + kogmawLivingArtilleryProbeKey + "]"
}

func ensureKogmawLivingArtilleryTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
		{Key: "damage/true", Domain: "damage"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "ability/basic_attack", Domain: "ability"},
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
	filtered := make([]model.TypeCatalogEntry, 0, len(req.TypeCatalog.Types))
	for _, e := range req.TypeCatalog.Types {
		if e.Key == "event/ability_started" || e.Key == "event/source_owner" {
			continue
		}
		filtered = append(filtered, e)
	}
	req.TypeCatalog.Types = filtered
}

func configureKogmawLivingArtilleryProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{kogmawLivingArtilleryProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: kogmawLivingArtilleryProviderRef, DefinitionRef: kogmawLivingArtilleryProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: kogmawLivingArtilleryProviderRef, DefinitionRef: kogmawLivingArtilleryProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

type kogmawLivingArtilleryFixtureOpts struct {
	mana      float64
	targetHP  float64
	targetMax float64
}

func loadKogmawLivingArtilleryFixture(t *testing.T, opts kogmawLivingArtilleryFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.targetMax == 0 {
		opts.targetMax = kogmawLivingArtilleryTargetMaxHP
	}
	if opts.targetHP == 0 {
		opts.targetHP = opts.targetMax
	}
	if opts.mana == 0 {
		opts.mana = 500
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureKogmawLivingArtilleryTypes(&compileReq)
	configureKogmawLivingArtilleryProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: kogmawLivingArtilleryADBase, Current: kogmawLivingArtilleryADBase,
		Max: kogmawLivingArtilleryADBase, Resolved: kogmawLivingArtilleryADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: kogmawLivingArtilleryFixtureAP, Current: kogmawLivingArtilleryFixtureAP,
		Max: kogmawLivingArtilleryFixtureAP, Resolved: kogmawLivingArtilleryFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, 2500),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.targetMax, Current: opts.targetHP,
		Max: opts.targetMax, Resolved: opts.targetMax,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: kogmawLivingArtilleryTargetMR, Current: kogmawLivingArtilleryTargetMR,
		Max: kogmawLivingArtilleryTargetMR, Resolved: kogmawLivingArtilleryTargetMR,
	})

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runKogmawLivingArtillery(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

type kogmawLivingArtilleryRunBundle struct {
	done      model.DoneResult
	sessionID string
	rulesHash string
}

func runKogmawLivingArtilleryFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) kogmawLivingArtilleryRunBundle {
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
	return kogmawLivingArtilleryRunBundle{done: done, sessionID: compiled.SessionID, rulesHash: compiled.RulesHash}
}

func kogmawLivingArtillerySourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func kogmawLivingArtilleryStacks(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		raw, ok := c.ProviderState[kogmawLivingArtilleryProviderRef]
		if !ok {
			return 0
		}
		bag, ok := raw.(map[string]interface{})
		if !ok {
			return 0
		}
		state, _ := bag["state"].(map[string]interface{})
		v, _ := state[kogmawLivingArtilleryStacksKey].(float64)
		return v
	}
	t.Fatal("source missing")
	return 0
}

func kogmawLivingArtillerySkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func kogmawLivingArtilleryDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != kogmawLivingArtilleryDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func findKogmawLivingArtilleryAbilityStat(t *testing.T, done model.DoneResult, ref string) model.AbilityStat {
	t.Helper()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == ref {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q", ref)
	return model.AbilityStat{}
}

func assertKogmawLivingArtilleryProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := &compileReq.SharedProviders[0]
	if p.ProviderKey != kogmawLivingArtilleryProviderRef {
		t.Fatalf("providerKey=%q", p.ProviderKey)
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.Modifiers) != 1 || p.Modifiers[0].ModifierKey != kogmawLivingArtilleryBonusADMod {
		t.Fatalf("modifiers=%+v want exactly fixture-only bonus AD %q", p.Modifiers, kogmawLivingArtilleryBonusADMod)
	}
	schema, ok := p.InitialStateSchema[kogmawLivingArtilleryStacksKey].(map[string]interface{})
	if !ok {
		t.Fatal("living_artillery_stacks schema missing")
	}
	if schema["refreshPolicy"] != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%v", schema["refreshPolicy"])
	}
	if schema["maxValue"] != kogmawLivingArtilleryMaxStacks || schema["durationMs"] != kogmawLivingArtilleryDurationMs {
		t.Fatalf("schema max/duration=%v/%v", schema["maxValue"], schema["durationMs"])
	}
	if len(p.Abilities) != 2 {
		t.Fatalf("abilities=%d want 2 (R + fixture probe)", len(p.Abilities))
	}
	var r *model.AbilityDefinition
	for i := range p.Abilities {
		if p.Abilities[i].AbilityKey == kogmawLivingArtilleryAbilityKey {
			r = &p.Abilities[i]
		}
	}
	if r == nil {
		t.Fatal("living_artillery ability missing")
	}
	if len(r.Operations) != 2 {
		t.Fatalf("ops=%d want 2", len(r.Operations))
	}
	if r.Operations[0].Operation != "damage" || r.Operations[1].Operation != "state_change" {
		t.Fatalf("op order=%q/%q want damage then state_change",
			r.Operations[0].Operation, r.Operations[1].Operation)
	}
	if r.Operations[0].CritEligible || r.Operations[0].CopyableOnHit {
		t.Fatal("damage must be non-crit / non-copyable")
	}
	for _, e := range compileReq.TypeCatalog.Types {
		if e.Key == "event/ability_started" || e.Key == "event/source_owner" {
			t.Fatalf("type catalog must not include %q", e.Key)
		}
	}
}

func kogmawLivingArtilleryWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "kogmaw-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v", path, err)
	}
	return path
}

func kogmawLivingArtilleryWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "kogmaw-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages missing at %s: %v", path, err)
	}
	return path
}

func kogmawLivingArtilleryWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "kogmaw-r.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v", path, err)
	}
	return path
}

type kogmawLivingArtilleryWikiSidecar struct {
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
}

func kogmawLivingArtilleryLoadWikiSidecar(t *testing.T) kogmawLivingArtilleryWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(kogmawLivingArtilleryWikiSidecarPath(t))
	if err != nil {
		t.Fatal(err)
	}
	var doc kogmawLivingArtilleryWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func kogmawLivingArtillerySHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func kogmawLivingArtilleryAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > kogmawLivingArtilleryTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > kogmawLivingArtilleryTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataBool(item.Data, "phantom") {
		t.Fatal("damage must not be phantom")
	}
}

// compileGenericNode only wires args[0]/args[1] for these binary ops.
var kogmawLivingArtilleryBinaryOps = map[string]struct{}{
	"add": {}, "sub": {}, "mul": {}, "div": {},
	"lt": {}, "lte": {}, "gt": {}, "gte": {},
}

func kogmawLivingArtilleryNodeContainsReadPath(node interface{}, readPath string) bool {
	switch v := node.(type) {
	case map[string]interface{}:
		if op, _ := v["op"].(string); op == "read" {
			if path, _ := v["path"].(string); path == readPath {
				return true
			}
		}
		for _, child := range v {
			if kogmawLivingArtilleryNodeContainsReadPath(child, readPath) {
				return true
			}
		}
	case []interface{}:
		for _, child := range v {
			if kogmawLivingArtilleryNodeContainsReadPath(child, readPath) {
				return true
			}
		}
	}
	return false
}

func kogmawLivingArtilleryAssertBinaryArity(t *testing.T, node interface{}, path string) {
	t.Helper()
	switch v := node.(type) {
	case map[string]interface{}:
		if op, _ := v["op"].(string); op != "" {
			if _, binary := kogmawLivingArtilleryBinaryOps[op]; binary {
				args, ok := v["args"].([]interface{})
				if !ok {
					t.Fatalf("%s op=%s must have args array", path, op)
				}
				if len(args) != 2 {
					t.Fatalf("%s op=%s must be binary (exactly 2 args; compileGenericNode drops extras), got %d",
						path, op, len(args))
				}
			}
		}
		for key, child := range v {
			kogmawLivingArtilleryAssertBinaryArity(t, child, path+"."+key)
		}
	case []interface{}:
		for i, child := range v {
			kogmawLivingArtilleryAssertBinaryArity(t, child, path+"["+itoaRuntime(i)+"]")
		}
	}
}

// Assert the constructed damage formula keeps AP under mul.args[0].
func kogmawLivingArtilleryAssertConstructedDamageBinaryAST(t *testing.T, damageJSON string) {
	t.Helper()
	var root interface{}
	if err := json.Unmarshal([]byte(damageJSON), &root); err != nil {
		t.Fatalf("constructed damage JSON: %v", err)
	}
	obj, ok := root.(map[string]interface{})
	if !ok {
		t.Fatal("constructed damage root must be object")
	}
	if op, _ := obj["op"].(string); op != "mul" {
		t.Fatalf("outer damage op=%q want mul", op)
	}
	args, ok := obj["args"].([]interface{})
	if !ok || len(args) != 2 {
		t.Fatalf("outer mul args=%v want exactly 2", obj["args"])
	}
	compiledBase, ok := args[0].(map[string]interface{})
	if !ok {
		t.Fatal("mul.args[0] (compiled base) must be object")
	}
	if op, _ := compiledBase["op"].(string); op != "add" {
		t.Fatalf("compiled base op=%q want add", op)
	}
	baseArgs, ok := compiledBase["args"].([]interface{})
	if !ok || len(baseArgs) != 2 {
		t.Fatalf("compiled base add must be binary nested, got %v", compiledBase["args"])
	}
	inner, ok := baseArgs[0].(map[string]interface{})
	if !ok {
		t.Fatal("compiled base args[0] must be nested add")
	}
	if op, _ := inner["op"].(string); op != "add" {
		t.Fatalf("inner base op=%q want add (nested binary)", op)
	}
	apPath := "source.attr.ap.resolved"
	if !kogmawLivingArtilleryNodeContainsReadPath(compiledBase, apPath) {
		t.Fatal("AP read must remain under compiled base branch (mul.args[0])")
	}
	if kogmawLivingArtilleryNodeContainsReadPath(args[1], apPath) {
		t.Fatal("AP read must not live only under the missing-health multiplier branch")
	}
	kogmawLivingArtilleryAssertBinaryArity(t, root, "living_artillery_damage")
}

// ---------------------------------------------------------------------------
// Algebra / identity / seed
// ---------------------------------------------------------------------------

func TestGenericKogmawLivingArtilleryAlgebraCrossCheck(t *testing.T) {
	base := kogmawLivingArtilleryExpectedBaseRaw(
		kogmawLivingArtilleryADResolved, kogmawLivingArtilleryADBase, kogmawLivingArtilleryFixtureAP)
	if math.Abs(base-kogmawLivingArtilleryBaseRaw) > kogmawLivingArtilleryTol {
		t.Fatalf("base raw algebra=%v want 285", base)
	}
	cases := []struct {
		hp, wantMul, wantRaw, wantMit float64
	}{
		{1000, 1.0, 285, 142.5},
		{400, 1.5, 427.5, 213.75},
		{399, 2.0, 570, 285},
	}
	for _, tc := range cases {
		mul := kogmawLivingArtilleryMissingHealthMultiplier(tc.hp, 1000)
		if math.Abs(mul-tc.wantMul) > kogmawLivingArtilleryTol {
			t.Fatalf("hp=%v mul=%v want %v", tc.hp, mul, tc.wantMul)
		}
		raw := kogmawLivingArtilleryExpectedRaw(tc.hp, 1000)
		if math.Abs(raw-tc.wantRaw) > kogmawLivingArtilleryTol {
			t.Fatalf("hp=%v raw=%v want %v", tc.hp, raw, tc.wantRaw)
		}
		mit := expectedMitigatedMagic(raw, kogmawLivingArtilleryTargetMR)
		if math.Abs(mit-tc.wantMit) > kogmawLivingArtilleryTol {
			t.Fatalf("hp=%v mit=%v want %v", tc.hp, mit, tc.wantMit)
		}
	}
	var sum float64
	for stacks := 0.0; stacks <= 9; stacks++ {
		sum += kogmawLivingArtilleryExpectedCost(stacks)
	}
	if math.Abs(sum-2200) > kogmawLivingArtilleryTol {
		t.Fatalf("ten-cast cost sum=%v want 2200", sum)
	}
}

func TestGenericKogmawLivingArtilleryWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := kogmawLivingArtilleryLoadWikiSidecar(t)
	if doc.CandidateKey != kogmawLivingArtilleryCandidateKey {
		t.Fatalf("candidateKey=%q", doc.CandidateKey)
	}
	if doc.RequestTitle != kogmawLivingArtilleryRequestTitle ||
		doc.ResolvedTitle != kogmawLivingArtilleryResolvedTitle {
		t.Fatalf("titles=%q/%q", doc.RequestTitle, doc.ResolvedTitle)
	}
	if doc.WikiPageID != kogmawLivingArtilleryWikiPageID ||
		doc.RevisionID != kogmawLivingArtilleryRevisionID ||
		doc.RevisionTimestamp != kogmawLivingArtilleryTimestamp ||
		doc.ContentSHA256 != kogmawLivingArtilleryContentSHA ||
		doc.RawByteSize != kogmawLivingArtilleryCanonicalBytes {
		t.Fatalf("canonical identity drifted: %+v", doc)
	}
	if doc.SkillKey != "R" || doc.ZhDisplayName != "活体大炮" || doc.OwnerID != "hero_kogmaw" {
		t.Fatalf("skill/zh/owner=%q/%q/%q", doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}

	pagesRaw, err := os.ReadFile(kogmawLivingArtilleryWikiPagesPath(t))
	if err != nil {
		t.Fatal(err)
	}
	var pages struct {
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
	if err := json.Unmarshal(pagesRaw, &pages); err != nil {
		t.Fatal(err)
	}
	if pages.CandidateKey != doc.CandidateKey ||
		pages.RequestTitle != doc.RequestTitle ||
		pages.ResolvedTitle != doc.ResolvedTitle ||
		pages.PageID != doc.WikiPageID ||
		pages.RevisionID != doc.RevisionID ||
		pages.RevisionTimestamp != doc.RevisionTimestamp ||
		pages.ContentSHA256 != doc.ContentSHA256 ||
		pages.RawByteSize != doc.RawByteSize ||
		pages.SkillKey != "R" || pages.ZhDisplayName != "活体大炮" || pages.OwnerID != "hero_kogmaw" {
		t.Fatalf("pages/sidecar canonical diverge: pages=%+v sidecar=%+v", pages, doc)
	}

	raw, err := os.ReadFile(kogmawLivingArtilleryWikiRawPath(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != kogmawLivingArtilleryLocalRawBytes {
		t.Fatalf("local raw len=%d want %d (noncanonical materialization)", len(raw), kogmawLivingArtilleryLocalRawBytes)
	}
	localSHA := kogmawLivingArtillerySHA256Hex(raw)
	if localSHA != kogmawLivingArtilleryLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, kogmawLivingArtilleryLocalRawSHA)
	}
	if localSHA == kogmawLivingArtilleryContentSHA {
		t.Fatal("local raw must not equal canonical SHA (materialization caveat; not source contradiction)")
	}
	if kogmawLivingArtilleryBoundary == "" || kogmawLivingArtilleryPlanRev == "" {
		t.Fatal("boundary/plan constants empty")
	}
}

func TestGenericKogmawLivingArtilleryConstructedFixtureFormulaAndIdentity(t *testing.T) {

	compileReq, _ := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 500})
	assertKogmawLivingArtilleryProviderShape(t, compileReq)
	damageJSON, err := json.Marshal(kogmawLivingArtilleryDamageAmount())
	if err != nil {
		t.Fatal(err)
	}
	kogmawLivingArtilleryAssertConstructedDamageBinaryAST(t, string(damageJSON))
	for _, tc := range []struct{ hp, want float64 }{
		{1000, 285}, {400, 427.5}, {399, 570},
	} {
		if raw := kogmawLivingArtilleryExpectedRaw(tc.hp, 1000); math.Abs(raw-tc.want) > kogmawLivingArtilleryTol {
			t.Fatalf("constructed fixture hp=%v raw=%v want %v", tc.hp, raw, tc.want)
		}
	}
}

func TestGenericKogmawLivingArtilleryCompileShapeTwoStepZeroListeners(t *testing.T) {
	compileReq, runReq := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 500})
	assertKogmawLivingArtilleryProviderShape(t, compileReq)
	done := runKogmawLivingArtillery(t, compileReq, runReq)
	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("shape-only castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if math.Abs(kogmawLivingArtilleryStacks(t, done.FinalSnapshot)) > kogmawLivingArtilleryTol {
		t.Fatalf("stacks without cast=%v want 0", kogmawLivingArtilleryStacks(t, done.FinalSnapshot))
	}
}

// ---------------------------------------------------------------------------
// Required schedules
// ---------------------------------------------------------------------------

// TestGenericKogmawLivingArtilleryIsolatedMissingHealthDamage: full / exact40% /
// below40% isolated casts prove raw/mitigated, cost40, final stack1.
func TestGenericKogmawLivingArtilleryIsolatedMissingHealthDamage(t *testing.T) {
	cases := []struct {
		name             string
		hp               float64
		wantRaw, wantMit float64
	}{
		{"full_hp", 1000, 285, 142.5},
		{"exact_40_percent", 400, 427.5, 213.75},
		{"below_40_percent", 399, 570, 285},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{
				mana: 500, targetHP: tc.hp, targetMax: 1000,
			})
			assertKogmawLivingArtilleryProviderShape(t, compileReq)
			ref := kogmawLivingArtilleryAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runKogmawLivingArtillery(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			if math.Abs(kogmawLivingArtillerySourceMana(t, done.FinalSnapshot)-460) > kogmawLivingArtilleryTol {
				t.Fatalf("mana=%v want 460 (cost 40)", kogmawLivingArtillerySourceMana(t, done.FinalSnapshot))
			}
			if math.Abs(kogmawLivingArtilleryStacks(t, done.FinalSnapshot)-1) > kogmawLivingArtilleryTol {
				t.Fatalf("stacks=%v want 1", kogmawLivingArtilleryStacks(t, done.FinalSnapshot))
			}
			dmg := kogmawLivingArtilleryDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("damage evidence=%d want 1", len(dmg))
			}
			kogmawLivingArtilleryAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMit)
		})
	}
}

// TestGenericKogmawLivingArtilleryCooldownScheduleMana500: attempts t0/t999/t1000;
// two successes; exact CD skip at999; costs 40 then 80; final mana380/state2.
func TestGenericKogmawLivingArtilleryCooldownScheduleMana500(t *testing.T) {
	compileReq, runReq := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 500})
	ref := kogmawLivingArtilleryAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r999", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 999},
		{EntryKey: "r1000", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1000},
	}
	runReq.StopPolicy.DurationMs = 1100
	done := runKogmawLivingArtillery(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 || done.Summary.AbilityCastCount != 2 {
		t.Fatalf("attempt/cast=%d/%d want 3/2", done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount)
	}
	if kogmawLivingArtillerySkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("want exactly one cooldown_not_ready at t999")
	}
	var skipAt999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] == string(model.AttemptSkipCooldownNotReady) && item.TimeMs == 999 {
			skipAt999 = true
		}
	}
	if !skipAt999 {
		t.Fatal("cooldown skip must be at t999")
	}
	if math.Abs(kogmawLivingArtillerySourceMana(t, done.FinalSnapshot)-380) > kogmawLivingArtilleryTol {
		t.Fatalf("mana=%v want 380 (40+80)", kogmawLivingArtillerySourceMana(t, done.FinalSnapshot))
	}
	if math.Abs(kogmawLivingArtilleryStacks(t, done.FinalSnapshot)-2) > kogmawLivingArtilleryTol {
		t.Fatalf("stacks=%v want 2", kogmawLivingArtilleryStacks(t, done.FinalSnapshot))
	}
	if len(kogmawLivingArtilleryDamageEvidence(done)) != 2 {
		t.Fatalf("damage=%d want 2 (only successes)", len(kogmawLivingArtilleryDamageEvidence(done)))
	}
	stat := findKogmawLivingArtilleryAbilityStat(t, done, ref)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}
}

// TestGenericKogmawLivingArtilleryInsufficientSecondCast: mana119; t0 cost40 ok;
// t1000 needs80 with79 → resource_insufficient; final mana79/state1.
func TestGenericKogmawLivingArtilleryInsufficientSecondCast(t *testing.T) {
	compileReq, runReq := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 119})
	ref := kogmawLivingArtilleryAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r1000", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1000},
	}
	runReq.StopPolicy.DurationMs = 1100
	done := runKogmawLivingArtillery(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if kogmawLivingArtillerySkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want resource_insufficient on second cast")
	}
	if math.Abs(kogmawLivingArtillerySourceMana(t, done.FinalSnapshot)-79) > kogmawLivingArtilleryTol {
		t.Fatalf("mana=%v want 79", kogmawLivingArtillerySourceMana(t, done.FinalSnapshot))
	}
	if math.Abs(kogmawLivingArtilleryStacks(t, done.FinalSnapshot)-1) > kogmawLivingArtilleryTol {
		t.Fatalf("stacks=%v want 1", kogmawLivingArtilleryStacks(t, done.FinalSnapshot))
	}
	if len(kogmawLivingArtilleryDamageEvidence(done)) != 1 {
		t.Fatalf("damage=%d want 1 (no second damage/write)", len(kogmawLivingArtilleryDamageEvidence(done)))
	}
}

// TestGenericKogmawLivingArtilleryStackExpiryAndRefresh: fixture-only basic_attack
// clock probe proves expiry and refresh-on-write windows.
func TestGenericKogmawLivingArtilleryStackExpiryAndRefresh(t *testing.T) {
	t.Run("single_cast_expiry", func(t *testing.T) {
		for _, tc := range []struct {
			name    string
			probeAt int64
			want    float64
		}{
			{"before_expire_t7999", 7999, 1},
			{"after_expire_t8001", 8001, 0},
		} {
			t.Run(tc.name, func(t *testing.T) {
				compileReq, runReq := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 500})
				rRef := kogmawLivingArtilleryAbilityRef()
				pRef := kogmawLivingArtilleryProbeRef()
				runReq.DriverPlan.Entries = []model.DriverEntry{
					{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
					{EntryKey: "probe", AbilityRef: pRef, Source: "source", Target: "target", FirstAtMs: tc.probeAt},
				}
				runReq.StopPolicy.DurationMs = tc.probeAt + 50
				done := runKogmawLivingArtillery(t, compileReq, runReq)
				if math.Abs(kogmawLivingArtilleryStacks(t, done.FinalSnapshot)-tc.want) > kogmawLivingArtilleryTol {
					t.Fatalf("stacks=%v want %v", kogmawLivingArtilleryStacks(t, done.FinalSnapshot), tc.want)
				}
			})
		}
	})
	t.Run("refreshed_two_cast_expiry", func(t *testing.T) {
		for _, tc := range []struct {
			name    string
			probeAt int64
			want    float64
		}{
			{"before_refreshed_expire_t8999", 8999, 2},
			{"after_refreshed_expire_t9001", 9001, 0},
		} {
			t.Run(tc.name, func(t *testing.T) {
				compileReq, runReq := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 500})
				rRef := kogmawLivingArtilleryAbilityRef()
				pRef := kogmawLivingArtilleryProbeRef()
				runReq.DriverPlan.Entries = []model.DriverEntry{
					{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
					{EntryKey: "r1000", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 1000},
					{EntryKey: "probe", AbilityRef: pRef, Source: "source", Target: "target", FirstAtMs: tc.probeAt},
				}
				runReq.StopPolicy.DurationMs = tc.probeAt + 50
				done := runKogmawLivingArtillery(t, compileReq, runReq)
				if math.Abs(kogmawLivingArtilleryStacks(t, done.FinalSnapshot)-tc.want) > kogmawLivingArtilleryTol {
					t.Fatalf("stacks=%v want %v", kogmawLivingArtilleryStacks(t, done.FinalSnapshot), tc.want)
				}
			})
		}
	})
}

// TestGenericKogmawLivingArtilleryTenCastEscalatingManaCap9: ten successful casts
// spaced 1000ms; costs 40..400; total 2200; state caps at 9; every write refreshes.
func TestGenericKogmawLivingArtilleryTenCastEscalatingManaCap9(t *testing.T) {
	compileReq, runReq := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 2500})
	ref := kogmawLivingArtilleryAbilityRef()
	entries := make([]model.DriverEntry, 0, 10)
	for i := 0; i < 10; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "r_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     "source",
			Target:     "target",
			FirstAtMs:  int64(i) * 1000,
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = 9500
	done := runKogmawLivingArtillery(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 10 {
		t.Fatalf("castCount=%d want 10", done.Summary.AbilityCastCount)
	}
	if math.Abs(kogmawLivingArtillerySourceMana(t, done.FinalSnapshot)-300) > kogmawLivingArtilleryTol {
		t.Fatalf("mana=%v want 300 (2500-2200)", kogmawLivingArtillerySourceMana(t, done.FinalSnapshot))
	}
	if math.Abs(kogmawLivingArtilleryStacks(t, done.FinalSnapshot)-9) > kogmawLivingArtilleryTol {
		t.Fatalf("stacks=%v want 9 (capped)", kogmawLivingArtilleryStacks(t, done.FinalSnapshot))
	}
	if len(kogmawLivingArtilleryDamageEvidence(done)) != 10 {
		t.Fatalf("damage=%d want 10", len(kogmawLivingArtilleryDamageEvidence(done)))
	}
	// Refresh proof: last write at t9000 → still alive at t9000+7999 via probe.
	compileReq2, runReq2 := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 2500})
	pRef := kogmawLivingArtilleryProbeRef()
	entries2 := append([]model.DriverEntry{}, entries...)
	entries2 = append(entries2, model.DriverEntry{
		EntryKey: "probe_live", AbilityRef: pRef, Source: "source", Target: "target", FirstAtMs: 9000 + 7999,
	})
	runReq2.DriverPlan.Entries = entries2
	runReq2.StopPolicy.DurationMs = 9000 + 8000
	done2 := runKogmawLivingArtillery(t, compileReq2, runReq2)
	if math.Abs(kogmawLivingArtilleryStacks(t, done2.FinalSnapshot)-9) > kogmawLivingArtilleryTol {
		t.Fatalf("refreshed stacks at t16999=%v want 9", kogmawLivingArtilleryStacks(t, done2.FinalSnapshot))
	}
}

func TestGenericKogmawLivingArtilleryDeterminismAndRelease(t *testing.T) {
	runOnce := func() (string, string, string) {
		c, r := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 500})
		ref := kogmawLivingArtilleryAbilityRef()
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "r999", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 999},
			{EntryKey: "r1000", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1000},
		}
		r.StopPolicy.DurationMs = 1100
		done := runKogmawLivingArtillery(t, c, r)
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

	c, r := loadKogmawLivingArtilleryFixture(t, kogmawLivingArtilleryFixtureOpts{mana: 500})
	r.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: kogmawLivingArtilleryAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	r.StopPolicy.DurationMs = 50
	bundle := runKogmawLivingArtilleryFrames(t, c, r)
	if math.Abs(kogmawLivingArtilleryStacks(t, bundle.done.FinalSnapshot)-1) > kogmawLivingArtilleryTol {
		t.Fatalf("frame-path stacks=%v want 1", kogmawLivingArtilleryStacks(t, bundle.done.FinalSnapshot))
	}
	if n := bundle.done.Evidence.CountsByKind[string(model.EvidenceKindEmittedEvent)]; n != 0 {
		t.Fatalf("emitted events=%d want 0 (no ability_started dependency)", n)
	}
}
