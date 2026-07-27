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

// hero_tristana R Buster Shot / 毁灭射击 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: tristana-r-buster-shot-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold;
//	magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_
//	secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_
//	post_basic_attack_explosive_charge_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_tristana|R|毁灭射击
//	task wasm-generic-tristana-buster-shot-primary-hit
//	Request Template:Data Tristana/R → resolved Template:Data Tristana/Buster Shot
//	wikiPageId 1308525 / rev 4008205 / timestamp 2026-04-14T05:37:16Z
//	canonical rawByteSize 2385 / SHA256
//	  2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058
//	数据参考/lol-wiki-current-champions/normalized/generic/tristana-r.json
//	pages/raw siblings: pages/tristana-r.json, raw/tristana-r.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_tristana_buster_shot_primary_hit_seed.sql
//	Local raw materialization caveat: 2382 bytes / SHA256
//	  42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b.
//	Serialization caveat only; assert sidecar/pages canonical identity + caveat;
//	do not claim local-raw equivalence or source contradiction.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_tristana_r_buster_shot_primary_hit
//     (standalone; not P/Q/W/E/basic/Explosive Charge synthesis)
//   - ability ability_hero_tristana_r_buster_shot_primary_hit with ability_key
//     buster_shot_primary_hit: active; mana 100; cooldown 100000 ms
//   - Exactly one immediate selected-primary-champion magic damage op:
//     add(add(const 325, mul(const 0.70, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base))), mul(const 1.00,
//         read source.attr.ap.resolved))
//     (every arithmetic node binary; each read path exactly once)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: magic 20221 + add policy 20170; 20230 forbidden
//   - No Tristana R state/modifier/listener/matcher/repeat/control/channel/
//     projectile/geometry/knockback/stun/reveal/secondary; no explicit event op —
//     successful cast relies on runtime automatic ability_started.
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast time; knockback/airborne/stun/reveal; displacement direction/distance/
//   speed/terrain/immunity; surrounding/secondary targets and zero default
//   damage/turret aggro; unit-target cancellation; post-cast basic attack;
//   Explosive Charge; ranks 1–2; siblings/loadout/crit/on-hit/live/full fidelity.
//   Exactly one selected-target magic hit, not full R.
//
// Ordered tags: ability_cost_cooldown, active_magic_damage, bonus_ad_ratio,
// ap_ratio, immediate_impact_scaffold.

const (
	tristanaBSCandidateKey  = "hero_skill|hero_tristana|R|毁灭射击"
	tristanaBSTaskKey       = "wasm-generic-tristana-buster-shot-primary-hit"
	tristanaBSPlanRev       = "tristana-r-buster-shot-primary-hit-phase-a-v1"
	tristanaBSRequestTitle  = "Template:Data Tristana/R"
	tristanaBSResolvedTitle = "Template:Data Tristana/Buster Shot"
	tristanaBSWikiPageID    = 1308525
	tristanaBSRevisionID    = 4008205
	tristanaBSTimestamp     = "2026-04-14T05:37:16Z"
	tristanaBSRawBytes      = 2385
	tristanaBSLocalRawBytes = 2382
	tristanaBSContentSHA    = "2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058"
	tristanaBSLocalRawSHA   = "42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b"
	tristanaBSBoundary      = "rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; " +
		"magic_325_plus_0_70_bonus_ad_plus_1_00_ap; " +
		"no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_" +
		"displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_" +
		"other_ranks_or_full_fidelity"

	tristanaBSProviderRef = "provider_hero_tristana_r_buster_shot_primary_hit"
	tristanaBSStableID    = "hero_tristana_r_buster_shot_primary_hit"
	tristanaBSAbilityID   = "ability_hero_tristana_r_buster_shot_primary_hit"
	tristanaBSAbilityKey  = "buster_shot_primary_hit"
	tristanaBSDamageOpRef = "op:tristana_buster_shot_primary_hit_damage"
	tristanaBSBonusADMod  = "fixture_tristana_buster_shot_primary_hit_bonus_ad"

	tristanaBSSeedBlobSHA  = "4481B2AC143D0B610B5A6AA416C3C32A9CEBA323501C21CDBB100C8206589558"
	tristanaBSJUnitBlobSHA = "1D929006D1AEFB0ECCD2BFD9476D7EF6FEF0AFE26C1A5F81EFB1D330FBEB70D9"

	tristanaBSBaseDamage   = 325.0
	tristanaBSBonusADRatio = 0.70
	tristanaBSAPRatio      = 1.00
	tristanaBSManaCost     = 100.0
	tristanaBSCDMs         = 100000.0

	tristanaBSADBaseDefault     = 60.0
	tristanaBSADResolvedDefault = 160.0
	tristanaBSFixtureAPDefault  = 100.0
	tristanaBSFixtureManaCD     = 300.0
	tristanaBSFixtureManaShort  = 99.0
	tristanaBSTargetMR          = 100.0
	tristanaBSTargetHP          = 1000.0

	// Default fixture: bonusAD=100, AP=100 → raw 495; MR100 → mitigated 247.5.
	tristanaBSExpectedRawDefault = 495.0
	tristanaBSExpectedMitDefault = 247.5
	tristanaBSManaAfter2         = 100.0 // 300 - 100 - 100
	tristanaBSHPAfter2           = 505.0 // 1000 - 247.5 - 247.5

	tristanaBSSeedDamageJSON = `{"op":"add","args":[{"op":"add","args":[{"op":"const","value":325},` +
		`{"op":"mul","args":[{"op":"const","value":0.70},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},` +
		`{"op":"mul","args":[{"op":"const","value":1.00},{"op":"read","path":"source.attr.ap.resolved"}]}]}`

	tristanaBSTol = 1e-9
)

func tristanaBSOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_magic_damage",
		"bonus_ad_ratio",
		"ap_ratio",
		"immediate_impact_scaffold",
	}
}

func tristanaBSExpectedRawFromStats(resolvedAD, baseAD, resolvedAP float64) float64 {
	return tristanaBSBaseDamage +
		tristanaBSBonusADRatio*(resolvedAD-baseAD) +
		tristanaBSAPRatio*resolvedAP
}

func tristanaBSDamageAmount() *model.GenericFormulaExpr {
	base := tristanaBSBaseDamage
	adRatio := tristanaBSBonusADRatio
	apRatio := tristanaBSAPRatio
	// Nested binary add: base + bonusAD + AP (generic add is binary-only).
	// Bonus AD = sub(ad.resolved, ad.base); each read path exactly once.
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

func tristanaBSCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += tristanaBSCountPathReads(&expr.Args[i], path)
	}
	return n
}

func tristanaBSAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
	t.Helper()
	if expr == nil {
		return
	}
	switch expr.Op {
	case "add", "sub", "mul", "div", "lt", "lte", "gt", "gte":
		if len(expr.Args) != 2 {
			t.Fatalf("op=%q arity=%d want binary 2", expr.Op, len(expr.Args))
		}
	}
	for i := range expr.Args {
		tristanaBSAssertBinaryArity(t, &expr.Args[i])
	}
}

func tristanaBSAbility() model.AbilityDefinition {
	cost := tristanaBSManaCost
	cd := tristanaBSCDMs
	return model.AbilityDefinition{
		AbilityKey: tristanaBSAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target magic damage; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           tristanaBSDamageOpRef,
				Amount:        tristanaBSDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func tristanaBSProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: tristanaBSProviderRef,
		Kind:        "champion",
		StableID:    tristanaBSStableID,
		Abilities:   []model.AbilityDefinition{tristanaBSAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed R provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: tristanaBSBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func tristanaBSAbilityRef() string {
	return "source.provider[" + tristanaBSProviderRef + "].ability[" + tristanaBSAbilityKey + "]"
}

type tristanaBSFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
}

func configureTristanaBSProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts tristanaBSFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{tristanaBSProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: tristanaBSProviderRef, DefinitionRef: tristanaBSProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: tristanaBSProviderRef, DefinitionRef: tristanaBSProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
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

func ensureTristanaBSTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
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

func loadTristanaBSFixture(t *testing.T, opts tristanaBSFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/mr explicitly
	// (AD0 / AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = tristanaBSFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = tristanaBSTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureTristanaBSTypes(&compileReq)
	configureTristanaBSProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/mana/HP/MR values (external-existing-data/check-only); do not
	// claim seed materializes hero_tristana / ad / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, tristanaBSFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runTristanaBS(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runTristanaBSFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func tristanaBSSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func tristanaBSSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func tristanaBSSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func tristanaBSDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := tristanaBSAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != tristanaBSDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func tristanaBSAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only R mounted, filter by
	// event ref and successful-cast times. Damage evidence still filters by op/ability.
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func tristanaBSFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == tristanaBSProviderRef {
			return p
		}
	}
	return nil
}

func assertTristanaBSProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := tristanaBSFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_tristana_r_buster_shot_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != tristanaBSProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, tristanaBSProviderRef)
	}
	if p.StableID != tristanaBSStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, tristanaBSStableID)
	}
	banned := []string{
		"provider_hero_tristana_p_", "provider_hero_tristana_q_", "provider_hero_tristana_w_",
		"provider_hero_tristana_e_", "provider_hero_tristana_basic_",
		"ability_hero_tristana_p_", "ability_hero_tristana_q_", "ability_hero_tristana_w_",
		"ability_hero_tristana_e_", "ability_hero_tristana_basic_",
		"explosive_charge",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("buster_shot primary-hit must not reuse sibling/basic/Explosive Charge refs: %q", b)
		}
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
		if p.Modifiers[0].ModifierKey != tristanaBSBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], tristanaBSBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production R has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), tristanaBSAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != tristanaBSAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, tristanaBSAbilityKey, tristanaBSAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("buster_shot_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-tristanaBSManaCost) > tristanaBSTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-tristanaBSCDMs) > tristanaBSTol {
		t.Fatalf("cooldown=%+v want const 100000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary magic hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("buster shot damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("buster shot damage must not be copyable on hit")
	}
	if op.Ref != tristanaBSDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, tristanaBSDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(add(base, bonusAD), AP)", op.Amount)
	}
	tristanaBSAssertBinaryArity(t, op.Amount)
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const325, mul(0.70, sub(ad.resolved, ad.base)))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-tristanaBSBaseDamage) > tristanaBSTol {
		t.Fatalf("base const=%+v want 325", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-tristanaBSBonusADRatio) > tristanaBSTol {
		t.Fatalf("bonus AD ratio=%+v want 0.70", adMul.Args[0])
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 {
		t.Fatalf("bonus-AD sub=%+v want sub(resolved, base)", sub)
	}
	if sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD resolved read=%+v want source.attr.ad.resolved", sub.Args[0])
	}
	if sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("AD base read=%+v want source.attr.ad.base", sub.Args[1])
	}
	if adMul.Args[1].Op == "read" && adMul.Args[1].Path == "source.attr.ad.resolved" {
		t.Fatal("bonus-AD branch must not read total ad.resolved alone (must sub base)")
	}
	if adMul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-tristanaBSAPRatio) > tristanaBSTol {
		t.Fatalf("AP ratio=%+v want 1.00", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if tristanaBSCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", tristanaBSCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if tristanaBSCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", tristanaBSCountPathReads(op.Amount, "source.attr.ad.base"))
	}
	if tristanaBSCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", tristanaBSCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if tristanaBSCountPathReads(op.Amount, "source.attr.ap.base") != 0 {
		t.Fatal("formula must not invent ap.base reads")
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
			bannedOp.Operation == "matcher" || bannedOp.Operation == "sight" {
			t.Fatalf("buster shot must not include excluded op: %+v", bannedOp)
		}
	}
}

func findTristanaBSAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := tristanaBSAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func tristanaBSRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func tristanaBSLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(tristanaBSRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_tristana_buster_shot_primary_hit_seed.sql"))
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

func tristanaBSSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func tristanaBSSHA256HexUpper(b []byte) string {
	return strings.ToUpper(tristanaBSSHA256Hex(b))
}

func tristanaBSAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > tristanaBSTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > tristanaBSTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != tristanaBSDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), tristanaBSDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != tristanaBSAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), tristanaBSAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != tristanaBSProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), tristanaBSProviderRef)
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
	if evidenceDataBool(item.Data, "copyableOnHit") || evidenceDataBool(item.Data, "copyable") {
		t.Fatalf("damage must not be copyable: %+v", item.Data)
	}
}

// TestTristanaBusterShotPrimaryHitSourceSeedProviderFormulaShape locks wiki/sidecar/
// pages/local-raw serialization caveat, seed/README/JUnit identities and source blob
// hashes, external-existing-data check-only prerequisites / non-materialization,
// ordered tags, type-policy evidence, and R provider/nested bonusAD+AP formula shape.
func TestTristanaBusterShotPrimaryHitSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Cooldown, Cost, Costtype, Damagetype, Notes string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(tristanaBSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "tristana-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != tristanaBSCandidateKey || doc.RequestTitle != tristanaBSRequestTitle ||
		doc.ResolvedTitle != tristanaBSResolvedTitle || doc.WikiPageID != tristanaBSWikiPageID ||
		doc.RevisionID != tristanaBSRevisionID || doc.RevisionTimestamp != tristanaBSTimestamp ||
		doc.ContentSHA256 != tristanaBSContentSHA || doc.RawByteSize != tristanaBSRawBytes ||
		doc.SkillKey != "R" || doc.ZhDisplayName != "毁灭射击" || doc.OwnerID != "hero_tristana" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "100\n" || doc.Fields.Costtype != "mana\n" ||
		doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "100\n" {
		t.Fatalf("cooldown=%q want 100 (rank-3 = 100s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|225 to 325}}") ||
		!strings.Contains(doc.Fields.Leveling, "70% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling, "100% AP") ||
		!strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling=%q want rank3 magic 325 +70%% bonus AD +100%% AP", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") {
		t.Fatal("wiki prose must retain magic damage wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description, "knocked back") ||
		!strings.Contains(doc.Fields.Description, "stunned") ||
		!strings.Contains(doc.Fields.Description, "revealed") {
		t.Fatal("wiki prose must retain excluded knockback/stun/reveal surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "secondary") ||
		!strings.Contains(doc.Fields.Notes, "turret") ||
		!strings.Contains(doc.Fields.Notes, "Explosive Charge") ||
		!strings.Contains(doc.Fields.Notes, "basic attack") ||
		!strings.Contains(doc.Fields.Notes, "displacement") ||
		!strings.Contains(doc.Fields.Notes, "Unit-targeted cancel") {
		t.Fatalf("notes missing excluded secondary/turret/Explosive Charge/basic-attack/displacement/cancel surfaces: %q",
			doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Leveling, "Knock Back Distance") ||
		!strings.Contains(doc.Fields.Leveling, "Stun Duration") {
		t.Fatal("wiki leveling must retain excluded knockback/stun leveling surfaces")
	}

	pagesRaw, err := os.ReadFile(tristanaBSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "tristana-r.json"))
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
		pages.SkillKey != "R" || pages.ZhDisplayName != "毁灭射击" || pages.OwnerID != "hero_tristana" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(tristanaBSRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "tristana-r.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != tristanaBSLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), tristanaBSLocalRawBytes)
	}
	if tristanaBSLocalRawBytes == tristanaBSRawBytes {
		t.Fatal("local raw and canonical sizes must differ (serialization caveat; not equivalence)")
	}
	localSHA := tristanaBSSHA256Hex(rawBytes)
	if localSHA != tristanaBSLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, tristanaBSLocalRawSHA)
	}
	if localSHA == tristanaBSContentSHA {
		t.Fatal("local raw hash must differ from canonical (serialization caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|225 to 325}}",
		"70% '''bonus''' AD",
		"100% AP",
		"|cost         = 100",
		"|cooldown     = 100",
		"|damagetype   = Magic",
		"knocked back",
		"stunned",
		"revealed",
		"secondary",
		"Explosive Charge",
		"basic attack",
		"displacement",
		"Unit-targeted cancel",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if tristanaBSPlanRev != "tristana-r-buster-shot-primary-hit-phase-a-v1" || tristanaBSBoundary !=
		"rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; "+
			"magic_325_plus_0_70_bonus_ad_plus_1_00_ap; "+
			"no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_"+
			"displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_"+
			"other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := tristanaBSRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_tristana_buster_shot_primary_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := tristanaBSSHA256HexUpper(seedBytes); got != tristanaBSSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, tristanaBSSeedBlobSHA)
	}
	junitPath := tristanaBSRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericTristanaBusterShotPrimaryHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := tristanaBSSHA256HexUpper(junitBytes); got != tristanaBSJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, tristanaBSJUnitBlobSHA)
	}
	_ = tristanaBSRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := tristanaBSLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(tristanaBSRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		tristanaBSCandidateKey, tristanaBSTaskKey, tristanaBSPlanRev,
		tristanaBSRequestTitle, tristanaBSResolvedTitle,
		"1308525", "4008205", tristanaBSTimestamp, "2385", "2382",
		tristanaBSContentSHA, tristanaBSLocalRawSHA,
		tristanaBSBoundary, tristanaBSProviderRef, tristanaBSAbilityID, tristanaBSAbilityKey,
		"buster_shot_primary_hit_damage", "r_mana_cost", "r_cooldown_ms",
		`{"op":"const","value":100}`, `{"op":"const","value":100000}`,
		tristanaBSSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/tristana-r.json",
		"external existing-data", "check-only",
		"无 materializer", "不物化",
		"bonus AD", "source.attr.ad.resolved", "source.attr.ad.base",
		"source.attr.ap.resolved",
		"ability_started",
		"20221", "20170",
		"Explosive Charge",
		"不要求 P/Q/W/E/basic/Explosive Charge",
		"missing game_entities hero_tristana",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_tristana/ad",
		"missing entity_attribute_values hero_tristana/ap",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_tristana/mana",
		"missing reserved_type",
		"325", "0.70", "1.00",
		"嵌套二元",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range tristanaBSOrderedTags() {
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
	for _, tag := range tristanaBSOrderedTags() {
		i := strings.Index(ordSection, tag)
		if i < 0 || i < prev {
			t.Fatalf("ordered tags not in frozen order around %q", tag)
		}
		prev = i
	}
	if regexp.MustCompile(`(?i)Batch-B\s+prerequisite`).MatchString(seed) {
		t.Fatal("seed must not use Batch-B prerequisite wording")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ad.resolved"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ad.resolved exactly once")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ad.base"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ad.base exactly once")
	}
	if strings.Count(sqlNoComments, `"path":"source.attr.ap.resolved"`) != 1 {
		t.Fatal("executable SQL must read source.attr.ap.resolved exactly once")
	}
	if strings.Contains(sqlNoComments, `"path":"source.attr.ap.base"`) {
		t.Fatal("executable SQL must not invent ap.base reads")
	}
	if !strings.Contains(sqlNoComments, `"op":"sub"`) {
		t.Fatal("executable SQL must use sub(resolved, base) for bonus AD")
	}

	for _, needle := range []string{
		"INSERT INTO public.provider_definitions",
		"INSERT INTO public.ability_definitions",
		"INSERT INTO public.ability_phases",
		"INSERT INTO public.effect_sequences",
		"INSERT INTO public.effect_steps",
		"INSERT INTO public.damage_effect_details",
		"INSERT INTO public.entity_provider_mounts",
		"phase_hero_tristana_r_buster_shot_primary_hit_impact",
		"sequence_hero_tristana_r_buster_shot_primary_hit_impact",
		"step_hero_tristana_r_buster_shot_primary_hit_damage",
	} {
		if !strings.Contains(sqlNoComments, needle) {
			t.Fatalf("executable seed missing %q", needle)
		}
	}
	if strings.Count(sqlNoComments, "INSERT INTO public.provider_definitions") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_definitions") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.ability_phases") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.damage_effect_details") != 1 ||
		strings.Count(sqlNoComments, "INSERT INTO public.entity_provider_mounts") != 1 {
		t.Fatal("seed must define exactly one provider/ability/phase/detail/mount")
	}
	if !regexp.MustCompile(`(?s)'ability_hero_tristana_r_buster_shot_primary_hit'\s*,\s*` +
		`'provider_hero_tristana_r_buster_shot_primary_hit'\s*,\s*` +
		`'buster_shot_primary_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("R must be active ability with stable key buster_shot_primary_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_tristana_r_buster_shot_primary_hit_damage'\s*,\s*` +
		`'buster_shot_primary_hit_damage'\s*,\s*20221\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be magic 20221 add policy copyable_on_hit=false")
	}
	if regexp.MustCompile(`(?is)\b20230\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL/graph must not use provider_action/apply 20230")
	}

	forbiddenSurfaces := []string{
		"provider_listeners", "provider_state_fields", "state_effect_details",
		"event_effect_details", "modifier_effect_details", "modifier_definitions",
		"provider_modifiers", "repeat_effect_details", "control_effect_details",
		"projectile_effect_details", "aoe_effect_details",
	}
	for _, table := range forbiddenSurfaces {
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
	if regexp.MustCompile(`(?is)'provider_hero_tristana_[pqwe]_|'ability_hero_tristana_[pqwe]_|` +
		`'provider_hero_tristana_basic_|'ability_hero_tristana_basic_|explosive_charge`).MatchString(sqlNoComments) {
		t.Fatal("must not create P/Q/W/E/basic/Explosive Charge graph rows")
	}

	for _, want := range []string{
		tristanaBSCandidateKey, tristanaBSTaskKey, tristanaBSPlanRev,
		"lol_generic_tristana_buster_shot_primary_hit_seed.sql",
		"LolGenericTristanaBusterShotPrimaryHitSeedSqlTest",
		"external existing-data",
		"magic_325_plus_0_70_bonus_ad_plus_1_00_ap",
		"bonus_ad_ratio", "ap_ratio",
		"Explosive Charge",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦无 seed") {
		t.Fatal("README must document no repository materializer for Tristana identity/panel/resource")
	}
	if strings.Contains(readme, "op:tristana_buster_shot_primary_hit_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}

	compileReq, _ := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
		baseAD: tristanaBSADBaseDefault, resolvedAD: tristanaBSADResolvedDefault,
		resolvedAP: tristanaBSFixtureAPDefault, mr: tristanaBSTargetMR, mana: tristanaBSFixtureManaCD,
	})
	assertTristanaBSProviderShape(t, compileReq, 1, true)
	rawX := tristanaBSExpectedRawFromStats(
		tristanaBSADResolvedDefault, tristanaBSADBaseDefault, tristanaBSFixtureAPDefault)
	if math.Abs(rawX-tristanaBSExpectedRawDefault) > tristanaBSTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, tristanaBSExpectedRawDefault)
	}
	mitX := expectedMitigatedMagic(rawX, tristanaBSTargetMR)
	if math.Abs(mitX-tristanaBSExpectedMitDefault) > tristanaBSTol {
		t.Fatalf("default mit=%v want %v", mitX, tristanaBSExpectedMitDefault)
	}
	totalAsIf := tristanaBSBaseDamage +
		tristanaBSBonusADRatio*tristanaBSADResolvedDefault +
		tristanaBSAPRatio*tristanaBSFixtureAPDefault
	if math.Abs(totalAsIf-tristanaBSExpectedRawDefault) < tristanaBSTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestTristanaBusterShotPrimaryHitFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/AP/MR raw/final table; one isolated successful R cast per row.
func TestTristanaBusterShotPrimaryHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		baseAD, resolvedAD     float64
		resolvedAP, mr         float64
		wantRaw, wantMitigated float64
	}{
		{"base0_resolved0_AP0_MR0", 0, 0, 0, 0, 325, 325},
		{"base60_resolved60_AP0_MR0", 60, 60, 0, 0, 325, 325},
		{"base60_resolved160_AP0_MR0", 60, 160, 0, 0, 395, 395},
		{"base60_resolved160_AP100_MR0", 60, 160, 100, 0, 495, 495},
		{"base60_resolved160_AP100_MR100", 60, 160, 100, 100, 495, 247.5},
		{"base60_resolved260_AP200_MR100", 60, 260, 200, 100, 665, 332.5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := tristanaBSExpectedRawFromStats(tc.resolvedAD, tc.baseAD, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > tristanaBSTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > tristanaBSTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: tristanaBSFixtureManaCD,
			})
			assertTristanaBSProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := tristanaBSAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runTristanaBS(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := tristanaBSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage evidence=%d want 1", len(dmg))
			}
			tristanaBSAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > tristanaBSTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(tristanaBSSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > tristanaBSTol {
				t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)",
					tristanaBSSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > tristanaBSTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(tristanaBSAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(tristanaBSAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestTristanaBusterShotPrimaryHitBonusADCounterproof: baseAD0/resolvedAD100/AP100
// versus baseAD60/resolvedAD160/AP100 at MR0 must both raw/final 495 — equal bonus AD.
func TestTristanaBusterShotPrimaryHitBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100_AP100", 0, 100},
		{"baseAD60_resolvedAD160_AP100", 60, 160},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: tristanaBSFixtureAPDefault, mr: 0, mana: tristanaBSFixtureManaCD,
			})
			assertTristanaBSProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: tristanaBSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runTristanaBS(t, compileReq, runReq)
			dmg := tristanaBSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage=%d want 1", len(dmg))
			}
			tristanaBSAssertDamage(t, dmg[0], 495, 495)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > tristanaBSTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(tristanaBSSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > tristanaBSTol {
				t.Fatalf("ad.base=%v want %v", tristanaBSSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tristanaBSFixtureAPDefault) > tristanaBSTol {
				t.Fatalf("ap.resolved=%v want %v",
					sourceAttrResolved(t, done.FinalSnapshot, "ap"), tristanaBSFixtureAPDefault)
			}
		})
	}
	totalAsIf := tristanaBSBaseDamage +
		tristanaBSBonusADRatio*160 +
		tristanaBSAPRatio*tristanaBSFixtureAPDefault
	bonus := tristanaBSExpectedRawFromStats(160, 60, tristanaBSFixtureAPDefault)
	if math.Abs(totalAsIf-bonus) < tristanaBSTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestTristanaBusterShotPrimaryHitCooldownMana300AbilityStarted: mana300/
// base60/resolved160/AP100/HP1000/MR100 at t0/t99999/t100000 →
// success/cooldown skip/success; final mana100/HP505; exactly two R damage
// items and two automatic R ability_started events.
func TestTristanaBusterShotPrimaryHitCooldownMana300AbilityStarted(t *testing.T) {
	compileReq, runReq := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
		baseAD: tristanaBSADBaseDefault, resolvedAD: tristanaBSADResolvedDefault,
		resolvedAP: tristanaBSFixtureAPDefault, mr: tristanaBSTargetMR,
		mana: tristanaBSFixtureManaCD, hp: tristanaBSTargetHP,
	})
	assertTristanaBSProviderShape(t, compileReq, 1, true)
	ref := tristanaBSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 99999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100000},
	}
	runReq.StopPolicy.DurationMs = 100100
	done := runTristanaBS(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if tristanaBSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findTristanaBSAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt99999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 99999 {
			t.Fatalf("cooldown skip TimeMs=%d want 99999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 100000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 100000", item.Data["readyAtMs"])
		}
		skipAt99999 = true
	}
	if !skipAt99999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=99999 with readyAtMs=100000")
	}

	items := tristanaBSDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("R damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 100000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		tristanaBSAssertDamage(t, item, tristanaBSExpectedRawDefault, tristanaBSExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * tristanaBSExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-tristanaBSHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, tristanaBSHPAfter2)
	}
	gotMana := tristanaBSSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-tristanaBSManaAfter2) > tristanaBSTol {
		t.Fatalf("mana=%v want %v", gotMana, tristanaBSManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := tristanaBSAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic R; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 100000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tristanaBSADResolvedDefault) > tristanaBSTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), tristanaBSADResolvedDefault)
	}
	if math.Abs(tristanaBSSourceAttrBase(t, done.FinalSnapshot, "ad")-tristanaBSADBaseDefault) > tristanaBSTol {
		t.Fatalf("ad.base=%v want %v",
			tristanaBSSourceAttrBase(t, done.FinalSnapshot, "ad"), tristanaBSADBaseDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tristanaBSFixtureAPDefault) > tristanaBSTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), tristanaBSFixtureAPDefault)
	}
}

// TestTristanaBusterShotPrimaryHitResourceInsufficientMana99: mana99 at t0 →
// resource_insufficient; mana/HP unchanged; zero R damage/start evidence.
func TestTristanaBusterShotPrimaryHitResourceInsufficientMana99(t *testing.T) {
	compileReq, runReq := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
		baseAD: tristanaBSADBaseDefault, resolvedAD: tristanaBSADResolvedDefault,
		resolvedAP: tristanaBSFixtureAPDefault, mr: tristanaBSTargetMR,
		mana: tristanaBSFixtureManaShort, hp: tristanaBSTargetHP,
	})
	ref := tristanaBSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runTristanaBS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if tristanaBSSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(tristanaBSSourceMana(t, done.FinalSnapshot)-tristanaBSFixtureManaShort) > tristanaBSTol {
		t.Fatalf("mana changed: got %v want %v",
			tristanaBSSourceMana(t, done.FinalSnapshot), tristanaBSFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-tristanaBSTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, tristanaBSTargetHP)
	}
	if len(tristanaBSDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero R damage evidence")
	}
	if len(tristanaBSAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestTristanaBusterShotPrimaryHitStandaloneNoSiblingSynthesis: standalone R
// provider does not synthesize P/Q/W/E/basic/Explosive Charge or overwrite
// unrelated definitions.
func TestTristanaBusterShotPrimaryHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
		baseAD: tristanaBSADBaseDefault, resolvedAD: tristanaBSADResolvedDefault,
		resolvedAP: tristanaBSFixtureAPDefault, mr: tristanaBSTargetMR, mana: tristanaBSFixtureManaCD,
	})
	assertTristanaBSProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_tristana_buster_shot_unrelated_sentinel"
	sentinelStable := "fixture_tristana_buster_shot_unrelated_stable"
	sentinel := model.ProviderDefinition{
		ProviderKey: sentinelKey,
		Kind:        "champion",
		StableID:    sentinelStable,
		Abilities: []model.AbilityDefinition{{
			AbilityKey: "sentinel_noop",
			Kind:       "active",
			Operations: nil,
		}},
	}
	before, err := json.Marshal(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	compileReq.SharedProviders = append(compileReq.SharedProviders, sentinel)

	if len(compileReq.Combatants[0].Providers) != 1 ||
		compileReq.Combatants[0].Providers[0].ProviderRef != tristanaBSProviderRef {
		t.Fatalf("source mounts=%+v want only R", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != tristanaBSProviderRef {
			t.Fatalf("source snapshots=%+v want only R", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_tristana_[pqwe]_|ability_hero_tristana_[pqwe]_|` +
		`provider_hero_tristana_basic_|ability_hero_tristana_basic_|explosive_charge`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == tristanaBSProviderRef || p.StableID == tristanaBSStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic/Explosive Charge provider: %+v", p)
		}
		if p.ProviderKey != tristanaBSProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) ||
				strings.Contains(a.AbilityKey, "explosive_charge") {
				t.Fatalf("R must not reuse sibling/basic/Explosive Charge ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := tristanaBSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runTristanaBS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(tristanaBSDamageEvidence(done)) != 1 {
		t.Fatalf("R damage=%d want 1", len(tristanaBSDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone R must not synthesize extra damage")
	}
	if len(tristanaBSAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic R ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
	}

	var found *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == sentinelKey {
			found = &compileReq.SharedProviders[i]
		}
	}
	if found == nil {
		t.Fatal("unrelated sentinel provider definition was dropped")
	}
	after, err := json.Marshal(*found)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("unrelated sentinel definition overwritten:\nbefore=%s\nafter=%s", before, after)
	}
	for _, mount := range compileReq.Combatants[0].Providers {
		if mount.ProviderRef == sentinelKey {
			t.Fatal("sentinel must remain unmounted")
		}
	}
	for _, snapC := range done.FinalSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		for _, ps := range snapC.Providers {
			if ps.ProviderRef == sentinelKey {
				t.Fatal("sentinel must not appear in final provider snapshots")
			}
			if siblingPat.MatchString(ps.ProviderRef) || siblingPat.MatchString(ps.DefinitionRef) {
				if ps.ProviderRef == tristanaBSProviderRef || ps.DefinitionRef == tristanaBSProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic/Explosive Charge: %+v", ps)
			}
		}
	}
}

// TestTristanaBusterShotPrimaryHitDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// wrong/missing/released session behavior (post-release session_not_found).
func TestTristanaBusterShotPrimaryHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
				baseAD: tristanaBSADBaseDefault, resolvedAD: tristanaBSADResolvedDefault,
				resolvedAP: tristanaBSFixtureAPDefault, mr: tristanaBSTargetMR, mana: tristanaBSFixtureManaCD,
			})
			ref := tristanaBSAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 99999},
				{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100000},
			}
			r.StopPolicy.DurationMs = 100100
			done := runTristanaBS(t, c, r)
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
		c, r := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
			baseAD: tristanaBSADBaseDefault, resolvedAD: tristanaBSADResolvedDefault,
			resolvedAP: tristanaBSFixtureAPDefault, mr: tristanaBSTargetMR, mana: tristanaBSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: tristanaBSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runTristanaBSFrames(t, c, r)
		if len(tristanaBSDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path R damage=%d want 1", len(tristanaBSDamageEvidence(done)))
		}
		tristanaBSAssertDamage(t, tristanaBSDamageEvidence(done)[0],
			tristanaBSExpectedRawDefault, tristanaBSExpectedMitDefault)
		if len(tristanaBSAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadTristanaBSFixture(t, tristanaBSFixtureOpts{
			baseAD: tristanaBSADBaseDefault, resolvedAD: tristanaBSADResolvedDefault,
			resolvedAP: tristanaBSFixtureAPDefault, mr: tristanaBSTargetMR, mana: tristanaBSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: tristanaBSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50

		session := NewSession()
		session.ClearOutbox()
		if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, c)); code != 0 {
			t.Fatalf("CompileFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
		}
		compiled := lastGenericCompileResult(session.OutboxBytes())
		if !compiled.OK || compiled.SessionID == "" {
			t.Fatalf("compile failed: %+v", compiled)
		}

		session.ClearOutbox()
		wrongHash := r
		wrongHash.SessionID = compiled.SessionID
		wrongHash.ExpectedRulesHash = "rules.wrong-hash"
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, wrongHash)); code != -1 {
			t.Fatalf("wrong hash RunFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrHashMismatch {
			t.Fatal("want hash_mismatch for wrong ExpectedRulesHash")
		}

		session.ClearOutbox()
		missing := r
		missing.SessionID = "missing-session"
		missing.ExpectedRulesHash = compiled.RulesHash
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, missing)); code != -1 {
			t.Fatalf("missing session RunFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("want session_not_found for missing session")
		}

		session.ClearOutbox()
		releaseReq := model.ReleaseSessionRequest{
			SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash,
		}
		if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
			t.Fatalf("ReleaseSessionFrame code=%d", code)
		}
		released := lastGenericReleaseDone(session.OutboxBytes())
		if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
			t.Fatalf("release=%+v", released)
		}

		session.ClearOutbox()
		if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != -1 {
			t.Fatalf("second ReleaseSessionFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("second release want session_not_found")
		}

		session.ClearOutbox()
		rerun := r
		rerun.SessionID = compiled.SessionID
		rerun.ExpectedRulesHash = compiled.RulesHash
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, rerun)); code != -1 {
			t.Fatalf("RunFrame after release code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("released session re-run want session_not_found")
		}
	})
}
