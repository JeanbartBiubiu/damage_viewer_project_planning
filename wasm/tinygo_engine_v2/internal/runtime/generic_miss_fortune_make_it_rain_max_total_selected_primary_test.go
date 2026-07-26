package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_missfortune E Make It Rain / 枪林弹雨 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2).
//
// Governance identity: this hero-named `_test.go` is regression/governance evidence
// only. It is excluded from production Wasm builds and must construct the existing
// generic Provider/Ability/Operation model without any production hero switch.
// Production runtime remains generic (no if hero_missfortune production behavior).
//
// Frozen boundary:
//
//	rank5_selected_primary_champion_max_duration_total_magic_damage; immediate_aggregated_duration_total_scaffold; magic_190_plus_1_20_ap; mana80_cooldown14000ms; exactly_one_aggregated_damage_quantum; no_two_second_duration_eight_ticks_quarter_second_tick_schedule_location_area_geometry_multitarget_sight_slow_dynamic_slow_refresh_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_missfortune|E|枪林弹雨
//	task wasm-generic-miss-fortune-make-it-rain-max-total-selected-primary
//	Request Template:Data Miss Fortune/E → resolved Template:Data Miss Fortune/Make It Rain
//	wikiPageId 1308255 / rev 3936384 / timestamp 2025-07-24T15:45:56Z
//	canonical rawByteSize 1210 / SHA256
//	  a38b513373be3b0491f7c967af8827dbdc9196452e5feb25614af3b78ab286f7
//	数据参考/lol-wiki-current-champions/normalized/generic/missfortune-e.json
//	  bytes 1972 / SHA256
//	  d53466f5d4e7e046620820cfd492133bcfac646e2d81d348dfcf544fe8174596
//	pages/raw siblings: pages/missfortune-e.json (bytes 747 / SHA256
//	  ac8ffb762ccb1667b7c3f955a60e418cb36553b1c653ebb6a70b613c4bf0a0dc),
//	  raw/missfortune-e.wikitext
//	Local raw materialization caveat: 1210 bytes / SHA256
//	  5a8800d1ca721f1583bb3d2c5581977a2e4942d399266ca3c745cd11e6503b7f.
//	Assert sidecar/pages canonical identity + caveat; do not claim local-raw
//	equivalence or source contradiction (同 size 不等于等价).
//
// Rank-5 Phase-A contract:
//   - Independent provider
//     provider_hero_missfortune_e_make_it_rain_max_total_selected_primary
//     (standalone; not P/Q/W/R/basic synthesis; does not depend on / mutate
//     existing Miss Fortune R Bullet Time)
//   - ability ability_hero_missfortune_e_make_it_rain_max_total_selected_primary
//     with ability_key make_it_rain_max_total_selected_primary: active;
//     mana 80; cooldown 14000 ms
//   - Exactly one immediate aggregated selected-primary-champion max-duration
//     total magic damage quantum:
//     add(const 190, mul(const 1.20, read source.attr.ap.resolved))
//     (every arithmetic node binary; AP read exactly once; no AD/crit/
//     crit_damage reads; aggregate algebra 8*(190/8+(120/8)%AP)=190+1.20*AP
//     without per-tick rounding)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No E state/modifier/listener/matcher/repeat/tick/control/scheduler/
//     event/area/geometry; no explicit event op — successful cast relies on
//     runtime automatic ability_started. Fixture may supply entity/attribute/
//     resource values (external-existing-data/check-only) but must not claim
//     the seed materializes them. Unrelated AD / crit chance / crit damage
//     changes must not alter E amount.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   actual 2s / eight ticks / 0.25s schedule / tick snapshots / per-tick
//   rounding; location / area / radius / acquisition / geometry / multi-target /
//   sight; slow / AP slow / refresh / cleanse; spell effects / persistent area /
//   interruption / animation; ranks 1–4; P/Q/W/R/basic/loadout/full fidelity;
//   live/publish/push/Web/E2E/assets. One aggregated max-duration-total magic
//   quantum, not full E.
//
// Ordered tags: ability_cost_cooldown, active_magic_damage, ap_ratio,
// immediate_aggregated_duration_total_scaffold
// (intentionally no immediate_impact_scaffold or meta_or_non_target_dps).

const (
	mfMIRCandidateKey    = "hero_skill|hero_missfortune|E|枪林弹雨"
	mfMIRTaskKey         = "wasm-generic-miss-fortune-make-it-rain-max-total-selected-primary"
	mfMIRPlanRev         = "miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2"
	mfMIRRequestTitle    = "Template:Data Miss Fortune/E"
	mfMIRResolvedTitle   = "Template:Data Miss Fortune/Make It Rain"
	mfMIRWikiPageID      = 1308255
	mfMIRRevisionID      = 3936384
	mfMIRTimestamp       = "2025-07-24T15:45:56Z"
	mfMIRRawBytes        = 1210
	mfMIRLocalRawBytes   = 1210
	mfMIRNormalizedBytes = 1972
	mfMIRPagesBytes      = 747
	mfMIRContentSHA      = "a38b513373be3b0491f7c967af8827dbdc9196452e5feb25614af3b78ab286f7"
	mfMIRLocalRawSHA     = "5a8800d1ca721f1583bb3d2c5581977a2e4942d399266ca3c745cd11e6503b7f"
	mfMIRNormalizedSHA   = "d53466f5d4e7e046620820cfd492133bcfac646e2d81d348dfcf544fe8174596"
	mfMIRPagesSHA        = "ac8ffb762ccb1667b7c3f955a60e418cb36553b1c653ebb6a70b613c4bf0a0dc"
	mfMIRBoundary        = "rank5_selected_primary_champion_max_duration_total_magic_damage; immediate_aggregated_duration_total_scaffold; magic_190_plus_1_20_ap; mana80_cooldown14000ms; exactly_one_aggregated_damage_quantum; no_two_second_duration_eight_ticks_quarter_second_tick_schedule_location_area_geometry_multitarget_sight_slow_dynamic_slow_refresh_or_full_fidelity"

	mfMIRProviderRef = "provider_hero_missfortune_e_make_it_rain_max_total_selected_primary"
	mfMIRStableID    = "hero_missfortune_e_make_it_rain_max_total_selected_primary"
	mfMIRAbilityID   = "ability_hero_missfortune_e_make_it_rain_max_total_selected_primary"
	mfMIRAbilityKey  = "make_it_rain_max_total_selected_primary"
	mfMIRDamageOpRef = "op:miss_fortune_make_it_rain_max_total_selected_primary_damage"

	mfMIRTickCount   = 8.0
	mfMIRBaseDamage  = 190.0
	mfMIRAPRatio     = 1.20
	mfMIRTickAPRatio = 0.15 // (120/8)% = 15%
	mfMIRManaCost    = 80.0
	mfMIRCDMs        = 14000.0

	mfMIRFixtureAPDefault = 100.0
	mfMIRFixtureManaCD    = 240.0
	mfMIRFixtureManaShort = 79.0
	mfMIRTargetMR         = 100.0
	mfMIRTargetHP         = 1000.0
	mfMIRFixtureADProbe   = 200.0
	mfMIRFixtureCritProbe = 0.5
	mfMIRFixtureCritDmg   = 2.3

	mfMIRExpectedRawAP0   = 190.0 // 190 + 1.20*0
	mfMIRExpectedMitAP0   = 95.0  // MR100
	mfMIRExpectedRawAP100 = 310.0 // 190 + 1.20*100
	mfMIRExpectedMitAP100 = 155.0 // MR100
	mfMIRManaAfter2       = 80.0  // 240 - 80 - 80
	mfMIRHPAfter2         = 690.0 // 1000 - 155 - 155

	mfMIRTol = 1e-9
)

func mfMIROrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"ap_ratio",
		"immediate_aggregated_duration_total_scaffold",
	}
}

func mfMIRExpectedRawFromAP(resolvedAP float64) float64 {
	return mfMIRBaseDamage + mfMIRAPRatio*resolvedAP
}

// mfMIRAggregateAlgebraFromTicks proves Wiki eight-tick total equals the
// immediate aggregate without per-tick rounding:
// 8 * (190/8 + (120/8)% AP) == 190 + 1.20*AP.
func mfMIRAggregateAlgebraFromTicks(resolvedAP float64) float64 {
	perTick := (mfMIRBaseDamage / mfMIRTickCount) + mfMIRTickAPRatio*resolvedAP
	return mfMIRTickCount * perTick
}

func mfMIRDamageAmount() *model.GenericFormulaExpr {
	base := mfMIRBaseDamage
	apRatio := mfMIRAPRatio
	// Nested binary AST: add(const190, mul(const1.20, read source.attr.ap.resolved)).
	// AP is read exactly once; no AD/crit/crit_damage reads.
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
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

func mfMIRCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += mfMIRCountPathReads(&expr.Args[i], path)
	}
	return n
}

func mfMIRAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
	t.Helper()
	if expr == nil {
		return
	}
	switch expr.Op {
	case "add", "sub", "mul", "div", "lt", "lte", "gt", "gte", "min", "max":
		if len(expr.Args) != 2 {
			t.Fatalf("op=%q arity=%d want binary 2", expr.Op, len(expr.Args))
		}
	}
	for i := range expr.Args {
		mfMIRAssertBinaryArity(t, &expr.Args[i])
	}
}

func mfMIRAbility() model.AbilityDefinition {
	cost := mfMIRManaCost
	cd := mfMIRCDMs
	return model.AbilityDefinition{
		AbilityKey: mfMIRAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one aggregated magic damage quantum; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           mfMIRDamageOpRef,
				Amount:        mfMIRDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func mfMIRProviderDef() model.ProviderDefinition {
	// Production/seed E provider has zero modifiers/listeners/state.
	return model.ProviderDefinition{
		ProviderKey: mfMIRProviderRef,
		Kind:        "champion",
		StableID:    mfMIRStableID,
		Abilities:   []model.AbilityDefinition{mfMIRAbility()},
	}
}

func mfMIRAbilityRef() string {
	return "source.provider[" + mfMIRProviderRef + "].ability[" + mfMIRAbilityKey + "]"
}

type mfMIRFixtureOpts struct {
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
	resolvedAD float64
	critChance float64
	critDamage float64
	armor      float64
	withR      bool
}

func configureMFMIRProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, withR bool) {
	providers := []model.ProviderDefinition{mfMIRProviderDef()}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: mfMIRProviderRef, DefinitionRef: mfMIRProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: mfMIRProviderRef, DefinitionRef: mfMIRProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if withR {
		// Same-package R helpers (read-only use); do not modify R test file /
		// move helpers into production / duplicate production logic.
		providers = append(providers, mfBTProviderDef(0))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: mfBTProviderRef, DefinitionRef: mfBTProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: mfBTProviderRef, DefinitionRef: mfBTProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	compileReq.SharedProviders = providers
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snaps
	}
}

func ensureMFMIRTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "event/ability_started", Domain: "event"},
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

func loadMFMIRFixture(t *testing.T, opts mfMIRFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAP/mr explicitly (AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = mfMIRFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = mfMIRTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureMFMIRTypes(&compileReq)
	configureMFMIRProviders(&compileReq, &runReq, opts.withR)

	// Fixture-only AP/AD/crit/mana/HP/MR/armor values (external-existing-data/
	// check-only); do not claim seed materializes hero_missfortune identity or
	// panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.resolvedAD, Current: opts.resolvedAD,
		Max: opts.resolvedAD, Resolved: opts.resolvedAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: opts.critChance, Current: opts.critChance,
		Max: opts.critChance, Resolved: opts.critChance,
	})
	if opts.critDamage != 0 {
		setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_damage", model.AttributeSlotDef{
			Base: opts.critDamage, Current: opts.critDamage,
			Max: opts.critDamage, Resolved: opts.critDamage,
		})
	}
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, mfMIRFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
	})
	if opts.withR {
		setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
			Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
		})
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runMFMIR(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runMFMIRFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, runReq)); code != -1 {
		t.Fatalf("RunFrame after release code=%d want -1", code)
	}
	if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
		t.Fatal("after release want session_not_found")
	}
	return done
}

func mfMIRSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func mfMIRSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func mfMIRDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := mfMIRAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != mfMIRDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func mfMIRAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func mfMIRFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == mfMIRProviderRef {
			return p
		}
	}
	return nil
}

func mfMIRAssertNoForbiddenOneCastEvidence(t *testing.T, done model.DoneResult) {
	t.Helper()
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	for _, item := range done.Evidence.Items {
		switch item.Kind {
		case model.EvidenceKindProviderTick:
			t.Fatalf("must not emit provider_tick: %+v", item)
		case model.EvidenceKindEmittedEvent:
			ref := item.Ref
			if strings.Contains(ref, "on_crit") || strings.Contains(ref, "rng") ||
				strings.Contains(ref, "slow") || strings.Contains(ref, "control") ||
				strings.Contains(ref, "basic_attack") || strings.Contains(ref, "sight") {
				t.Fatalf("forbidden event evidence: %+v", item)
			}
		}
	}
}

func mfMIRAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > mfMIRTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > mfMIRTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != mfMIRDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), mfMIRDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != mfMIRAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), mfMIRAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != mfMIRProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), mfMIRProviderRef)
	}
	if evidenceDataBool(item.Data, "phantom") {
		t.Fatal("damage must not be phantom")
	}
	if evidenceDataString(item.Data, "phase") != "original" {
		t.Fatalf("phase=%q want original", evidenceDataString(item.Data, "phase"))
	}
	if evidenceDataBool(item.Data, "copyableOnHit") || evidenceDataBool(item.Data, "copyable") {
		t.Fatalf("damage must not be copyable: %+v", item.Data)
	}
}

func assertMFMIRProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := mfMIRFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_missfortune_e_make_it_rain_max_total_selected_primary missing from SharedProviders")
	}
	if p.ProviderKey != mfMIRProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, mfMIRProviderRef)
	}
	if p.StableID != mfMIRStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, mfMIRStableID)
	}
	banned := []string{
		"provider_hero_missfortune_p_", "provider_hero_missfortune_q_", "provider_hero_missfortune_w_",
		"provider_hero_missfortune_r_", "provider_hero_missfortune_basic_",
		"ability_hero_missfortune_p_", "ability_hero_missfortune_q_", "ability_hero_missfortune_w_",
		"ability_hero_missfortune_r_", "ability_hero_missfortune_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("make_it_rain max-total must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no duration / tick / area state)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), mfMIRAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != mfMIRAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, mfMIRAbilityKey, mfMIRAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("E Types=%v want empty (no ability-specific game-local E type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("make_it_rain_max_total_selected_primary must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("E must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("E must not carry tickSpec")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("E must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-mfMIRManaCost) > mfMIRTol {
		t.Fatalf("cost=%+v want mana const 80", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-mfMIRCDMs) > mfMIRTol {
		t.Fatalf("cooldown=%+v want const 14000 (immediate aggregate scaffold)", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one aggregated magic quantum)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("make it rain damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("make it rain damage must not be copyable on hit")
	}
	if op.Ref != mfMIRDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, mfMIRDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const190, mul(1.20, ap.resolved))", op.Amount)
	}
	mfMIRAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-mfMIRBaseDamage) > mfMIRTol {
		t.Fatalf("base const=%+v want 190", op.Amount.Args[0])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP mul=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-mfMIRAPRatio) > mfMIRTol {
		t.Fatalf("AP ratio=%+v want 1.20", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if mfMIRCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", mfMIRCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	for _, bannedPath := range []string{
		"source.attr.ad.resolved", "source.attr.ad.base",
		"source.attr.crit_chance.resolved", "source.attr.crit_damage.resolved",
	} {
		if mfMIRCountPathReads(op.Amount, bannedPath) != 0 {
			t.Fatalf("formula must not read forbidden path %q", bannedPath)
		}
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "knockback" || bannedOp.Operation == "reveal" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "channel" ||
			bannedOp.Operation == "matcher" || bannedOp.Operation == "sight" ||
			bannedOp.Operation == "dash" || bannedOp.Operation == "movement" ||
			bannedOp.Operation == "scheduler" || bannedOp.Operation == "tick" ||
			bannedOp.DamageType == "damage/physical" {
			t.Fatalf("make it rain must not include excluded op: %+v", bannedOp)
		}
	}
	if expectShared == 1 {
		if len(compileReq.Combatants[0].Providers) != 1 ||
			compileReq.Combatants[0].Providers[0].ProviderRef != mfMIRProviderRef {
			t.Fatalf("source mounts=%+v want exactly one %s",
				compileReq.Combatants[0].Providers, mfMIRProviderRef)
		}
	}
}

func findMFMIRAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := mfMIRAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func mfMIRRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func mfMIRSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// TestMissFortuneMakeItRainMaxTotalSelectedPrimaryWikiIdentityAndCompileShape locks
// wiki/sidecar/pages/local-raw caveat, frozen boundary/ordered tags, provider shape,
// nested binary AST, and aggregate algebra without per-tick rounding.
func TestMissFortuneMakeItRainMaxTotalSelectedPrimaryWikiIdentityAndCompileShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling                       string
			Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(mfMIRRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "missfortune-e.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != mfMIRNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), mfMIRNormalizedBytes)
	}
	if got := mfMIRSHA256Hex(sidecarRaw); got != mfMIRNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, mfMIRNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != mfMIRCandidateKey || doc.RequestTitle != mfMIRRequestTitle ||
		doc.ResolvedTitle != mfMIRResolvedTitle || doc.WikiPageID != mfMIRWikiPageID ||
		doc.RevisionID != mfMIRRevisionID || doc.RevisionTimestamp != mfMIRTimestamp ||
		doc.ContentSHA256 != mfMIRContentSHA || doc.RawByteSize != mfMIRRawBytes ||
		doc.SkillKey != "E" || doc.ZhDisplayName != "枪林弹雨" || doc.OwnerID != "hero_missfortune" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "80\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|18 to 14}}\n" {
		t.Fatalf("cooldown=%q want {{ap|18 to 14}} (rank-5 = 14s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|70/8 to 190/8}}") ||
		!strings.Contains(doc.Fields.Leveling, "{{ap|120/8}}% AP") ||
		!strings.Contains(doc.Fields.Leveling, "{{ap|70 to 190}}") ||
		!strings.Contains(doc.Fields.Leveling, "120% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Magic Damage Per Tick") ||
		!strings.Contains(doc.Fields.Leveling, "Total Magic Damage") {
		t.Fatalf("leveling=%q want rank5 total 190+120%%AP / eight ticks 190/8+(120/8)%%AP", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") ||
		!strings.Contains(doc.Fields.Description, "2 seconds") ||
		!strings.Contains(doc.Fields.Description, "0.25") ||
		!strings.Contains(doc.Fields.Description, "sight") ||
		!strings.Contains(doc.Fields.Description, "slow") ||
		!strings.Contains(doc.Fields.Description, "40%") ||
		!strings.Contains(doc.Fields.Description, "6% per 100 AP") {
		t.Fatal("wiki prose must retain excluded 2s/0.25s/sight/slow surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "slow") || !strings.Contains(doc.Fields.Notes, "cleanse") {
		t.Fatalf("notes missing excluded slow/cleanse surfaces: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(mfMIRRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "missfortune-e.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != mfMIRPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), mfMIRPagesBytes)
	}
	if got := mfMIRSHA256Hex(pagesRaw); got != mfMIRPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, mfMIRPagesSHA)
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
		pages.SkillKey != "E" || pages.ZhDisplayName != "枪林弹雨" || pages.OwnerID != "hero_missfortune" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(mfMIRRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "missfortune-e.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != mfMIRLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), mfMIRLocalRawBytes)
	}
	localSHA := mfMIRSHA256Hex(rawBytes)
	if localSHA != mfMIRLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, mfMIRLocalRawSHA)
	}
	if localSHA == mfMIRContentSHA {
		t.Fatal("local raw hash must differ from canonical (same-size materialization caveat; not equivalence/contradiction)")
	}
	if mfMIRLocalRawBytes != mfMIRRawBytes {
		t.Fatal("Miss Fortune E local raw and canonical sizes differ; constants drifted")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|70/8 to 190/8}}",
		"{{ap|120/8}}% AP",
		"{{ap|70 to 190}}",
		"120% AP",
		"Magic Damage Per Tick",
		"Total Magic Damage",
		"|cost         = 80",
		"|cooldown     = {{ap|18 to 14}}",
		"|damagetype   = Magic",
		"2 seconds",
		"0.25",
		"magic damage",
		"sight",
		"slow",
		"cleanse",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if mfMIRPlanRev != "miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2" || mfMIRBoundary !=
		"rank5_selected_primary_champion_max_duration_total_magic_damage; immediate_aggregated_duration_total_scaffold; magic_190_plus_1_20_ap; mana80_cooldown14000ms; exactly_one_aggregated_damage_quantum; no_two_second_duration_eight_ticks_quarter_second_tick_schedule_location_area_geometry_multitarget_sight_slow_dynamic_slow_refresh_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}
	if mfMIRTaskKey != "wasm-generic-miss-fortune-make-it-rain-max-total-selected-primary" {
		t.Fatal("task key drifted")
	}
	tags := mfMIROrderedTags()
	wantTags := []string{
		"ability_cost_cooldown", "active_magic_damage", "ap_ratio",
		"immediate_aggregated_duration_total_scaffold",
	}
	if len(tags) != len(wantTags) {
		t.Fatalf("ordered tags=%v want %v", tags, wantTags)
	}
	for i := range wantTags {
		if tags[i] != wantTags[i] {
			t.Fatalf("ordered tags[%d]=%q want %q", i, tags[i], wantTags[i])
		}
	}
	for _, banned := range tags {
		if banned == "immediate_impact_scaffold" || banned == "meta_or_non_target_dps" {
			t.Fatalf("governed tags must not include %q", banned)
		}
	}

	// Aggregate algebra without per-tick rounding.
	for _, ap := range []float64{0, 50, 100, 200} {
		agg := mfMIRExpectedRawFromAP(ap)
		fromTicks := mfMIRAggregateAlgebraFromTicks(ap)
		if math.Abs(agg-fromTicks) > mfMIRTol {
			t.Fatalf("AP=%v aggregate=%v fromTicks=%v (must match without per-tick rounding)",
				ap, agg, fromTicks)
		}
	}
	if math.Abs(mfMIRTickAPRatio-(120.0/8.0)/100.0) > mfMIRTol {
		t.Fatalf("tick AP ratio=%v want (120/8)%% = 0.15", mfMIRTickAPRatio)
	}

	compileReq, _ := loadMFMIRFixture(t, mfMIRFixtureOpts{
		resolvedAP: mfMIRFixtureAPDefault, mr: mfMIRTargetMR, mana: mfMIRFixtureManaCD,
	})
	assertMFMIRProviderShape(t, compileReq, 1)
	rawX := mfMIRExpectedRawFromAP(mfMIRFixtureAPDefault)
	if math.Abs(rawX-mfMIRExpectedRawAP100) > mfMIRTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, mfMIRExpectedRawAP100)
	}
	mitX := expectedMitigatedMagic(rawX, mfMIRTargetMR)
	if math.Abs(mitX-mfMIRExpectedMitAP100) > mfMIRTol {
		t.Fatalf("default mit=%v want %v", mitX, mfMIRExpectedMitAP100)
	}
	raw0 := mfMIRExpectedRawFromAP(0)
	if math.Abs(raw0-mfMIRExpectedRawAP0) > mfMIRTol {
		t.Fatalf("AP0 raw=%v want %v", raw0, mfMIRExpectedRawAP0)
	}
	mit0 := expectedMitigatedMagic(raw0, mfMIRTargetMR)
	if math.Abs(mit0-mfMIRExpectedMitAP0) > mfMIRTol {
		t.Fatalf("AP0 mit=%v want %v", mit0, mfMIRExpectedMitAP0)
	}
}

// TestMissFortuneMakeItRainMaxTotalSelectedPrimaryFormulaMitigationAndStatIsolation:
// AP0/100 × MR100 raw/final; unrelated AD / crit chance / crit damage must not alter E.
func TestMissFortuneMakeItRainMaxTotalSelectedPrimaryFormulaMitigationAndStatIsolation(t *testing.T) {
	cases := []struct {
		name                         string
		resolvedAP, mr, ad, crit, cd float64
		wantRaw, wantMitigated       float64
	}{
		{"AP0_MR100", 0, 100, 0, 0, 0, 190, 95},
		{"AP0_MR100_AD200_crit0.5_cd2.3", 0, 100, 200, 0.5, 2.3, 190, 95},
		{"AP100_MR100", 100, 100, 0, 0, 0, 310, 155},
		{"AP100_MR100_AD200_crit0.5_cd2.3", 100, 100, 200, 0.5, 2.3, 310, 155},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := mfMIRExpectedRawFromAP(tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > mfMIRTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			fromTicks := mfMIRAggregateAlgebraFromTicks(tc.resolvedAP)
			if math.Abs(fromTicks-tc.wantRaw) > mfMIRTol {
				t.Fatalf("tick algebra=%v want %v", fromTicks, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > mfMIRTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadMFMIRFixture(t, mfMIRFixtureOpts{
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: mfMIRFixtureManaCD,
				resolvedAD: tc.ad, critChance: tc.crit, critDamage: tc.cd,
			})
			assertMFMIRProviderShape(t, compileReq, 1)
			ref := mfMIRAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runMFMIR(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := mfMIRDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("E damage evidence=%d want 1", len(dmg))
			}
			mfMIRAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > mfMIRTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.ad) > mfMIRTol {
				t.Fatalf("ad.resolved=%v want unrelated probe %v",
					sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.ad)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "crit_chance")-tc.crit) > mfMIRTol {
				t.Fatalf("crit_chance.resolved=%v want unrelated probe %v",
					sourceAttrResolved(t, done.FinalSnapshot, "crit_chance"), tc.crit)
			}
			if tc.cd != 0 {
				if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "crit_damage")-tc.cd) > mfMIRTol {
					t.Fatalf("crit_damage.resolved=%v want unrelated probe %v",
						sourceAttrResolved(t, done.FinalSnapshot, "crit_damage"), tc.cd)
				}
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(mfMIRAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(mfMIRAbilityStartedEvidence(done)))
			}
			mfMIRAssertNoForbiddenOneCastEvidence(t, done)
			p := mfMIRFindProvider(compileReq)
			if p == nil || p.Abilities[0].Operations[0].CritEligible {
				t.Fatal("operation CritEligible must stay false")
			}
		})
	}
}

// TestMissFortuneMakeItRainMaxTotalSelectedPrimaryCooldownMana240AbilityStarted:
// AP100/mana240/HP1000/MR100 at t0/t13999/t14000 → success/cooldown skip/success;
// exactly two E damage quanta and two automatic E ability_started; mana80/HP690.
func TestMissFortuneMakeItRainMaxTotalSelectedPrimaryCooldownMana240AbilityStarted(t *testing.T) {
	compileReq, runReq := loadMFMIRFixture(t, mfMIRFixtureOpts{
		resolvedAP: mfMIRFixtureAPDefault, mr: mfMIRTargetMR,
		mana: mfMIRFixtureManaCD, hp: mfMIRTargetHP,
		resolvedAD: mfMIRFixtureADProbe,
	})
	assertMFMIRProviderShape(t, compileReq, 1)
	ref := mfMIRAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 13999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 14000},
	}
	runReq.StopPolicy.DurationMs = 14100
	done := runMFMIR(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if mfMIRSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findMFMIRAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt13999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 13999 {
			t.Fatalf("cooldown skip TimeMs=%d want 13999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 14000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 14000", item.Data["readyAtMs"])
		}
		skipAt13999 = true
	}
	if !skipAt13999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=13999 with readyAtMs=14000")
	}

	items := mfMIRDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("E damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 14000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		mfMIRAssertDamage(t, item, mfMIRExpectedRawAP100, mfMIRExpectedMitAP100)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * mfMIRExpectedMitAP100
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-mfMIRHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, mfMIRHPAfter2)
	}
	gotMana := mfMIRSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-mfMIRManaAfter2) > mfMIRTol {
		t.Fatalf("mana=%v want %v", gotMana, mfMIRManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}
	started := mfMIRAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic E; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 14000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	mfMIRAssertNoForbiddenOneCastEvidence(t, done)
}

// TestMissFortuneMakeItRainMaxTotalSelectedPrimaryResourceInsufficientMana79:
// AP100/mana79 at t0 → resource_insufficient; mana/HP unchanged; zero E damage/start.
func TestMissFortuneMakeItRainMaxTotalSelectedPrimaryResourceInsufficientMana79(t *testing.T) {
	compileReq, runReq := loadMFMIRFixture(t, mfMIRFixtureOpts{
		resolvedAP: mfMIRFixtureAPDefault, mr: mfMIRTargetMR,
		mana: mfMIRFixtureManaShort, hp: mfMIRTargetHP,
	})
	ref := mfMIRAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runMFMIR(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if mfMIRSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(mfMIRSourceMana(t, done.FinalSnapshot)-mfMIRFixtureManaShort) > mfMIRTol {
		t.Fatalf("mana changed: got %v want %v",
			mfMIRSourceMana(t, done.FinalSnapshot), mfMIRFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-mfMIRTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, mfMIRTargetHP)
	}
	if len(mfMIRDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero E damage evidence")
	}
	if len(mfMIRAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestMissFortuneMakeItRainMaxTotalSelectedPrimaryERIsolationCoexistence: test-only
// composition of independent E + existing standalone R graphs (same-package R
// helpers, unmodified). Providers/abilities/refs remain distinct; E cast emits
// only E amount/ref and does not arm/mutate/call R; R remains independently callable.
func TestMissFortuneMakeItRainMaxTotalSelectedPrimaryERIsolationCoexistence(t *testing.T) {
	t.Run("e_only_no_r_synthesis", func(t *testing.T) {
		compileReq, runReq := loadMFMIRFixture(t, mfMIRFixtureOpts{
			resolvedAP: mfMIRFixtureAPDefault, mr: mfMIRTargetMR, mana: mfMIRFixtureManaCD,
			resolvedAD: mfBTADResolvedDefault,
		})
		assertMFMIRProviderShape(t, compileReq, 1)
		for _, p := range compileReq.SharedProviders {
			if p.ProviderKey == mfBTProviderRef || p.StableID == mfBTStableID {
				t.Fatal("E-only must not synthesize R provider")
			}
			for _, a := range p.Abilities {
				if a.AbilityKey == mfBTAbilityKey {
					t.Fatal("E-only must not synthesize R ability key")
				}
			}
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: mfMIRAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runMFMIR(t, compileReq, runReq)
		if len(mfBTDamageEvidence(done)) != 0 {
			t.Fatal("E-only must not produce R damage")
		}
		if len(done.Summary.AbilityStats) != 1 ||
			done.Summary.AbilityStats[0].AbilityRef != mfMIRAbilityRef() {
			t.Fatalf("AbilityStats=%+v want only E", done.Summary.AbilityStats)
		}
	})

	t.Run("combined_er_e_cast_no_r_evidence", func(t *testing.T) {
		compileReq, runReq := loadMFMIRFixture(t, mfMIRFixtureOpts{
			resolvedAP: mfMIRFixtureAPDefault, mr: mfMIRTargetMR,
			mana: mfMIRFixtureManaCD, withR: true,
			resolvedAD: mfBTADResolvedDefault, armor: 0,
		})
		assertMFMIRProviderShape(t, compileReq, 2)
		rProv := mfBTFindProvider(compileReq)
		if rProv == nil {
			t.Fatal("combined fixture must include standalone R provider")
		}
		if rProv.ProviderKey != mfBTProviderRef || rProv.StableID != mfBTStableID ||
			len(rProv.Abilities) != 1 || rProv.Abilities[0].AbilityKey != mfBTAbilityKey {
			t.Fatalf("R provider drifted in combined fixture: %+v", rProv)
		}

		if mfMIRProviderRef == mfBTProviderRef ||
			mfMIRStableID == mfBTStableID ||
			mfMIRAbilityID == mfBTAbilityID ||
			mfMIRAbilityKey == mfBTAbilityKey ||
			mfMIRAbilityRef() == mfBTAbilityRef() ||
			mfMIRDamageOpRef == mfBTDamageOpRef {
			t.Fatal("E and R provider/ability/op refs must remain distinct")
		}
		foundE, foundR := false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == mfMIRProviderRef {
				foundE = true
			}
			if m.ProviderRef == mfBTProviderRef {
				foundR = true
			}
		}
		if !foundE || !foundR {
			t.Fatalf("combined mounts=%+v want both E and R", compileReq.Combatants[0].Providers)
		}

		eRef := mfMIRAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: eRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runMFMIR(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(mfMIRDamageEvidence(done)) != 1 {
			t.Fatalf("E damage=%d want 1", len(mfMIRDamageEvidence(done)))
		}
		mfMIRAssertDamage(t, mfMIRDamageEvidence(done)[0],
			mfMIRExpectedRawAP100, mfMIRExpectedMitAP100)
		if len(mfBTDamageEvidence(done)) != 0 {
			t.Fatal("E cast must not produce R damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture E cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (E only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == mfBTAbilityRef() {
				t.Fatalf("E cast must not produce R AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != eRef {
			t.Fatalf("AbilityStats=%+v want only E", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == mfBTAbilityRef() {
				t.Fatalf("E cast must not produce R abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == mfBTDamageOpRef {
				t.Fatalf("E cast must not produce R operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == mfBTProviderRef {
				t.Fatalf("E cast must not produce R providerRef evidence: %+v", item)
			}
		}
	})

	t.Run("combined_er_r_cast_no_e_evidence", func(t *testing.T) {
		compileReq, runReq := loadMFMIRFixture(t, mfMIRFixtureOpts{
			resolvedAP: mfMIRFixtureAPDefault, mr: mfMIRTargetMR,
			mana: mfMIRFixtureManaCD, withR: true,
			resolvedAD: mfBTADResolvedDefault, critChance: 0, armor: 0,
			hp: mfBTTargetHP,
		})
		assertMFMIRProviderShape(t, compileReq, 2)
		if mfBTFindProvider(compileReq) == nil {
			t.Fatal("combined fixture must keep R independently callable")
		}

		rRef := mfBTAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runMFMIR(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(mfBTDamageEvidence(done)) != 1 {
			t.Fatalf("R damage=%d want 1", len(mfBTDamageEvidence(done)))
		}
		// AD100/AP100/crit0 → noncrit aggregated channel total 2250 (existing R contract).
		mfBTAssertDamage(t, mfBTDamageEvidence(done)[0],
			mfBTExpectedNoncritAP100, mfBTExpectedNoncritAP100)
		if len(mfMIRDamageEvidence(done)) != 0 {
			t.Fatal("R cast must not produce E damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture R cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (R only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == mfMIRAbilityRef() {
				t.Fatalf("R cast must not produce E AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != rRef {
			t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == mfMIRAbilityRef() {
				t.Fatalf("R cast must not produce E abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == mfMIRDamageOpRef {
				t.Fatalf("R cast must not produce E operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == mfMIRProviderRef {
				t.Fatalf("R cast must not produce E providerRef evidence: %+v", item)
			}
		}
	})
}

// TestMissFortuneMakeItRainMaxTotalSelectedPrimaryDeterminismAndLifecycle: repeated
// compile/run stability plus CompileFrame→RunFrame→ReleaseSessionFrame.
func TestMissFortuneMakeItRainMaxTotalSelectedPrimaryDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadMFMIRFixture(t, mfMIRFixtureOpts{
				resolvedAP: mfMIRFixtureAPDefault, mr: mfMIRTargetMR, mana: mfMIRFixtureManaCD,
			})
			ref := mfMIRAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 13999},
				{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 14000},
			}
			r.StopPolicy.DurationMs = 14100
			done := runMFMIR(t, c, r)
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

	t.Run("frame_release", func(t *testing.T) {
		c, r := loadMFMIRFixture(t, mfMIRFixtureOpts{
			resolvedAP: mfMIRFixtureAPDefault, mr: mfMIRTargetMR, mana: mfMIRFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: mfMIRAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runMFMIRFrames(t, c, r)
		if len(mfMIRDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path E damage=%d want 1", len(mfMIRDamageEvidence(done)))
		}
		mfMIRAssertDamage(t, mfMIRDamageEvidence(done)[0], mfMIRExpectedRawAP100, mfMIRExpectedMitAP100)
		if len(mfMIRAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})
}

// TestMissFortuneMakeItRainMaxTotalSelectedPrimaryGovernanceExclusionsAndNonclaims:
// prove hero-named `_test.go` status, allowed write surface, no production hero
// switch, and explicit exclusions/nonclaims remain locked.
func TestMissFortuneMakeItRainMaxTotalSelectedPrimaryGovernanceExclusionsAndNonclaims(t *testing.T) {
	allowedTestRel := filepath.ToSlash(filepath.Join(
		"wasm", "tinygo_engine_v2", "internal", "runtime",
		"generic_miss_fortune_make_it_rain_max_total_selected_primary_test.go",
	))

	cmd := exec.Command("git", "status", "--porcelain", "--",
		"wasm/tinygo_engine_v2/internal/runtime",
		"wasm/tinygo_engine_v2/internal/model",
		"wasm/tinygo_engine_v2/internal/compile",
		"wasm/tinygo_engine_v2/internal/abi",
		"wasm/tinygo_engine_v2/cmd",
	)
	cmd.Dir = filepath.Join("..", "..", "..", "..")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git status failed: %v (%s)", err, string(out))
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		path := line
		if len(line) >= 3 {
			path = strings.TrimSpace(line[2:])
		}
		if idx := strings.Index(path, " -> "); idx >= 0 {
			path = path[idx+4:]
		}
		path = filepath.ToSlash(path)
		if path == allowedTestRel {
			continue
		}
		if strings.HasSuffix(path, "_test.go") {
			t.Fatalf("unexpected dirty test path %q (only %q may change)", path, allowedTestRel)
		}
		t.Fatalf("production/non-allowed path dirty: %q (only %q may change)", path, allowedTestRel)
	}

	err = filepath.Walk(filepath.Join(".."), func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
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
		for _, frag := range []string{
			`case "hero_missfortune"`,
			`case "missfortune"`,
			`if hero_missfortune`,
			`make_it_rain_max_total_selected_primary`,
			`provider_hero_missfortune_e_make_it_rain`,
		} {
			if strings.Contains(body, frag) {
				t.Fatalf("production source %s contains hero-switch/E-graph fragment %q", rel, frag)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	self := "generic_miss_fortune_make_it_rain_max_total_selected_primary_test.go"
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
	body := string(raw)
	if !strings.Contains(body, "FROZEN_PLAN_REV: miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2") {
		t.Fatal("evidence file missing frozen plan marker")
	}
	if !strings.Contains(body, mfMIRTaskKey) {
		t.Fatal("evidence file missing task key")
	}
	if !strings.Contains(body, "hero-named `_test.go` is regression/governance evidence") {
		t.Fatal("evidence file must declare hero-named _test.go governance status")
	}
	if !strings.Contains(body, "Production runtime remains generic") {
		t.Fatal("evidence file must declare production runtime remains generic")
	}
	for _, claim := range []string{
		"no equivalence/contradiction",
		"without per-tick rounding",
		"no explicit event op",
		"does not depend on / mutate",
		"actual 2s / eight ticks / 0.25s schedule",
		"intentionally no immediate_impact_scaffold or meta_or_non_target_dps",
	} {
		if !strings.Contains(body, claim) {
			t.Fatalf("evidence file missing exclusion/nonclaim framing %q", claim)
		}
	}
	// Exclusions must remain negative framing (not shipping claims).
	if !strings.Contains(body, "Explicit exclusions") {
		t.Fatal("evidence file missing Explicit exclusions section")
	}
	if !strings.Contains(body, "One aggregated max-duration-total magic") {
		t.Fatal("evidence must keep bounded aggregated-quantum nonclaim")
	}
	if strings.Count(body, "immediate_aggregated_duration_total_scaffold") < 1 {
		t.Fatal("evidence must retain duration-total scaffold tag/boundary framing")
	}
	_ = fmt.Sprintf("%s", mfMIRBoundary) // keep boundary constant referenced
}
