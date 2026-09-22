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

	"tinygo_engine_v2/internal/model"
)

// hero_graves Q End of the Line / 穷途末路 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: graves-q-end-of-the-line-first-outbound-pass-phase-a-v2).
//
// Frozen boundary:
//
//	rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold;
//	physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_
//	travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_
//	area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_
//	interaction_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_graves|Q|穷途末路
//	task wasm-generic-graves-end-of-the-line-first-outbound-pass
//	Request Template:Data Graves/Q → resolved Template:Data Graves/End of the Line
//	wikiPageId 1307367 / rev 4007501 / timestamp 2026-04-11T22:23:57Z
//	canonical rawByteSize 2266 / SHA256
//	  c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5
//	数据参考/lol-wiki-current-champions/normalized/generic/graves-q.json
//	pages/raw siblings: pages/graves-q.json, raw/graves-q.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql
//	Local raw materialization caveat: 2265 bytes / SHA256
//	  cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377.
//	Serialization caveat only; assert sidecar/pages canonical identity + caveat;
//	do not claim local-raw equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_graves_q_end_of_the_line_first_outbound_pass
//     (standalone; not P/E/W/R/basic/True Grit synthesis)
//   - ability ability_hero_graves_q_end_of_the_line_first_outbound_pass with ability_key
//     end_of_the_line_first_outbound_pass: active; mana 80; cooldown 6000 ms
//   - Exactly one immediate selected-primary-champion physical damage op:
//     add(const 150, mul(const 0.65, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base)))
//     (every arithmetic node binary; each read path exactly once)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: physical 20220 + add policy 20170; 20230 forbidden
//   - No Graves Q state/modifier/listener/matcher/repeat/control/secondary/
//     projectile/movement/geometry/trail/detonation; no explicit event op —
//     successful cast relies on runtime automatic ability_started.
//     Q Types empty (no ability-specific game-local Q type).
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//     Standalone Q seed contains no E rows and no sibling synthesis.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast time/direction/range/width/line geometry; projectile speed/travel/
//   pass-through/multiple targets; powder trail/terrain/collision; delayed 2s
//   or terrain 0.2s detonation/perpendicular area/reverse wave/second pass/
//   total damage; once-per-pass/spellshield/Wind Wall/Braum terrain; ranks 1–4;
//   P/E/W/R/basic/loadout coupling; bootstrap; crit/on-hit; live/publish/E2E/
//   full fidelity.
//   Exactly one selected-target first-outbound-pass physical hit, not full Q.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, bonus_ad_ratio,
// immediate_impact_scaffold.

const (
	gravesEOLCandidateKey  = "hero_skill|hero_graves|Q|穷途末路"
	gravesEOLTaskKey       = "wasm-generic-graves-end-of-the-line-first-outbound-pass"
	gravesEOLPlanRev       = "graves-q-end-of-the-line-first-outbound-pass-phase-a-v2"
	gravesEOLRequestTitle  = "Template:Data Graves/Q"
	gravesEOLResolvedTitle = "Template:Data Graves/End of the Line"
	gravesEOLWikiPageID    = 1307367
	gravesEOLRevisionID    = 4007501
	gravesEOLTimestamp     = "2026-04-11T22:23:57Z"
	gravesEOLRawBytes      = 2266
	gravesEOLLocalRawBytes = 2265
	gravesEOLContentSHA    = "c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5"
	gravesEOLLocalRawSHA   = "cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377"
	gravesEOLBoundary      = "rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; " +
		"physical_150_plus_0_65_bonus_ad; " +
		"no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_" +
		"multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_" +
		"area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_" +
		"terrain_interaction_other_ranks_or_full_fidelity"

	gravesEOLProviderRef = "provider_hero_graves_q_end_of_the_line_first_outbound_pass"
	gravesEOLStableID    = "hero_graves_q_end_of_the_line_first_outbound_pass"
	gravesEOLAbilityID   = "ability_hero_graves_q_end_of_the_line_first_outbound_pass"
	gravesEOLAbilityKey  = "end_of_the_line_first_outbound_pass"
	gravesEOLDamageOpRef = "op:graves_end_of_the_line_first_outbound_pass_damage"
	gravesEOLBonusADMod  = "fixture_graves_end_of_the_line_first_outbound_pass_bonus_ad"

	gravesEOLSeedBlobSHA  = "E17D4739F2D98D213C3A5FF3E6AB3943F9E2E474F882E03BCCCA01492AF88CA0"
	gravesEOLJUnitBlobSHA = "16CAFE131D75221EB916E96619C14D3AE630D1BA8DEBB485B75AB9A61A6B00AC"

	gravesEOLBaseDamage   = 150.0
	gravesEOLBonusADRatio = 0.65
	gravesEOLManaCost     = 80.0
	gravesEOLCDMs         = 6000.0

	gravesEOLADBaseDefault      = 60.0
	gravesEOLADResolvedDefault  = 160.0
	gravesEOLFixtureManaCD      = 240.0
	gravesEOLFixtureManaShort   = 79.0
	gravesEOLTargetArmorDefault = 100.0
	gravesEOLTargetHP           = 1000.0

	// Default fixture: bonusAD=100 → raw 215; armor100 → mitigated 107.5.
	gravesEOLExpectedRawDefault = 215.0
	gravesEOLExpectedMitDefault = 107.5
	gravesEOLManaAfter2         = 80.0  // 240 - 80 - 80
	gravesEOLHPAfter2           = 785.0 // 1000 - 107.5 - 107.5

	gravesEOLSeedDamageJSON = `{"op":"add","args":[{"op":"const","value":150},` +
		`{"op":"mul","args":[{"op":"const","value":0.65},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}`

	gravesEOLTol = 1e-9
)

func gravesEOLOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func gravesEOLExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return gravesEOLBaseDamage + gravesEOLBonusADRatio*(resolvedAD-baseAD)
}

func gravesEOLDamageAmount() *model.GenericFormulaExpr {
	base := gravesEOLBaseDamage
	ratio := gravesEOLBonusADRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
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

func gravesEOLCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += gravesEOLCountPathReads(&expr.Args[i], path)
	}
	return n
}

func gravesEOLAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		gravesEOLAssertBinaryArity(t, &expr.Args[i])
	}
}

func gravesEOLAbility() model.AbilityDefinition {
	cost := gravesEOLManaCost
	cd := gravesEOLCDMs
	return model.AbilityDefinition{
		AbilityKey: gravesEOLAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical damage; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           gravesEOLDamageOpRef,
				Amount:        gravesEOLDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func gravesEOLProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: gravesEOLProviderRef,
		Kind:        "champion",
		StableID:    gravesEOLStableID,
		Abilities:   []model.AbilityDefinition{gravesEOLAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: gravesEOLBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func gravesEOLAbilityRef() string {
	return "source.provider[" + gravesEOLProviderRef + "].ability[" + gravesEOLAbilityKey + "]"
}

type gravesEOLFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func configureGravesEOLProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts gravesEOLFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{gravesEOLProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: gravesEOLProviderRef, DefinitionRef: gravesEOLProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: gravesEOLProviderRef, DefinitionRef: gravesEOLProviderRef,
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

func ensureGravesEOLTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
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

func loadGravesEOLFixture(t *testing.T, opts gravesEOLFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/armor explicitly
	// (AD0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = gravesEOLFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = gravesEOLTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureGravesEOLTypes(&compileReq)
	configureGravesEOLProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_graves / ad / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, gravesEOLFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

// loadGravesEOLQEFixture mounts independent Quickdraw E beside Q (same-package
// helpers; no sibling synthesis of P/W/R/basic; do not copy E into the Q seed).
func loadGravesEOLQEFixture(t *testing.T, mana float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	opts := gravesEOLFixtureOpts{
		baseAD: gravesEOLADBaseDefault, resolvedAD: gravesEOLADResolvedDefault,
		armor: gravesEOLTargetArmorDefault, mana: mana, hp: gravesEOLTargetHP,
	}
	compileReq, runReq := loadGravesEOLFixture(t, opts)
	ensureGravesQDTypes(&compileReq)
	eProv := gravesQDProviderDef()
	compileReq.SharedProviders = append(compileReq.SharedProviders, eProv)
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers,
		model.CombatantProviderMount{ProviderRef: gravesQDProviderRef, DefinitionRef: gravesQDProviderRef})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: gravesQDProviderRef, DefinitionRef: gravesQDProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor", model.AttributeSlotDef{
		Base: gravesQDBaseArmor, Current: gravesQDBaseArmor, Max: gravesQDBaseArmor, Resolved: gravesQDBaseArmor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_resist", model.AttributeSlotDef{
		Base: gravesQDBaseMR, Current: gravesQDBaseMR, Max: gravesQDBaseMR, Resolved: gravesQDBaseMR,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "bonus_armor", model.AttributeSlotDef{
		Base: gravesQDBonusBase, Current: gravesQDBonusBase, Max: gravesQDBonusBase, Resolved: gravesQDBonusBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "bonus_magic_resist", model.AttributeSlotDef{
		Base: gravesQDBonusBase, Current: gravesQDBonusBase, Max: gravesQDBonusBase, Resolved: gravesQDBonusBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: mana, Max: math.Max(mana, gravesEOLFixtureManaCD),
	})
	return compileReq, runReq
}

func runGravesEOL(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runGravesEOLFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func gravesEOLSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func gravesEOLSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func gravesEOLDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := gravesEOLAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != gravesEOLDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func gravesEOLAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only Q mounted, filter by
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

func gravesEOLFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == gravesEOLProviderRef {
			return p
		}
	}
	return nil
}

func gravesEOLFindQDProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == gravesQDProviderRef {
			return p
		}
	}
	return nil
}

func assertGravesEOLProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := gravesEOLFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_graves_q_end_of_the_line_first_outbound_pass missing from SharedProviders")
	}
	if p.ProviderKey != gravesEOLProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, gravesEOLProviderRef)
	}
	if p.StableID != gravesEOLStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, gravesEOLStableID)
	}
	if p.ProviderKey == gravesQDProviderRef || p.StableID == gravesQDStableID ||
		p.ProviderKey == gravesNDProviderRef || p.StableID == gravesNDStableID ||
		p.ProviderKey == gravesSmokeScreenPrimaryHitProviderRef || p.StableID == gravesSmokeScreenPrimaryHitStableID ||
		p.ProviderKey == gravesCollateralDamagePrimaryHitProviderRef || p.StableID == gravesCollateralDamagePrimaryHitStableID {
		t.Fatal("end_of_the_line first-outbound-pass must not reuse P/E/W/R provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no True Grit / trail / detonation state)", len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != gravesEOLBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], gravesEOLBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production Q has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), gravesEOLAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != gravesEOLAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, gravesEOLAbilityKey, gravesEOLAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("Q Types=%v want empty (no ability-specific game-local Q type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("end_of_the_line_first_outbound_pass must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("Q must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("Q must not carry tickSpec")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("Q must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-gravesEOLManaCost) > gravesEOLTol {
		t.Fatalf("cost=%+v want mana const 80", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-gravesEOLCDMs) > gravesEOLTol {
		t.Fatalf("cooldown=%+v want const 6000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary first-outbound physical hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("end of the line damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("end of the line damage must not be copyable on hit")
	}
	if op.Ref != gravesEOLDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, gravesEOLDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const150, mul(0.65, sub(ad.resolved, ad.base)))", op.Amount)
	}
	gravesEOLAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-gravesEOLBaseDamage) > gravesEOLTol {
		t.Fatalf("base const=%+v want 150", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-gravesEOLBonusADRatio) > gravesEOLTol {
		t.Fatalf("bonus AD ratio=%+v want 0.65", mul.Args[0])
	}
	sub := mul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 {
		t.Fatalf("bonus-AD sub=%+v want sub(resolved, base)", sub)
	}
	if sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD resolved read=%+v want source.attr.ad.resolved", sub.Args[0])
	}
	if sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("AD base read=%+v want source.attr.ad.base", sub.Args[1])
	}
	if mul.Args[1].Op == "read" && mul.Args[1].Path == "source.attr.ad.resolved" {
		t.Fatal("bonus-AD branch must not read total ad.resolved alone (must sub base)")
	}
	if mul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	if gravesEOLCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", gravesEOLCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if gravesEOLCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", gravesEOLCountPathReads(op.Amount, "source.attr.ad.base"))
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
			bannedOp.DamageType == "damage/magic" {
			t.Fatalf("end of the line must not include excluded op: %+v", bannedOp)
		}
	}
}

func findGravesEOLAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := gravesEOLAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func gravesEOLRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func gravesEOLLoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(gravesEOLRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql"))
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

func gravesEOLSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func gravesEOLSHA256HexUpper(b []byte) string {
	return strings.ToUpper(gravesEOLSHA256Hex(b))
}

func gravesEOLAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > gravesEOLTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > gravesEOLTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != gravesEOLDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), gravesEOLDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != gravesEOLAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), gravesEOLAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != gravesEOLProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), gravesEOLProviderRef)
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

// TestGravesEndOfTheLineFirstOutboundPassSourceSeedProviderFormulaShape locks wiki/sidecar/
// pages/local-raw serialization caveat, seed/README/JUnit identities and source blob
// hashes, external-existing-data check-only prerequisites / non-materialization,
// ordered tags, type-policy evidence, and Q provider/bonusAD formula shape.
func TestGravesEndOfTheLineFirstOutboundPassSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Cooldown, Cost, Costtype, Damagetype, Notes string
			Description2, Description3, Leveling2                              string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(gravesEOLRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "graves-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != gravesEOLCandidateKey || doc.RequestTitle != gravesEOLRequestTitle ||
		doc.ResolvedTitle != gravesEOLResolvedTitle || doc.WikiPageID != gravesEOLWikiPageID ||
		doc.RevisionID != gravesEOLRevisionID || doc.RevisionTimestamp != gravesEOLTimestamp ||
		doc.ContentSHA256 != gravesEOLContentSHA || doc.RawByteSize != gravesEOLRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "穷途末路" || doc.OwnerID != "hero_graves" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "leveling2", "description3",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "80\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|13 to 6}}\n" {
		t.Fatalf("cooldown=%q want {{ap|13 to 6}} (rank-5 = 6s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|50 to 150}}") ||
		!strings.Contains(doc.Fields.Leveling, "65% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q want rank5 physical 150 +65%% bonus AD", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "powder trail") {
		t.Fatal("wiki prose must retain physical damage / powder trail wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description2, "2 seconds") ||
		!strings.Contains(doc.Fields.Description2, "detonates") ||
		!strings.Contains(doc.Fields.Description2, "perpendicular") ||
		!strings.Contains(doc.Fields.Description2, "reverse wave") {
		t.Fatal("wiki description2 must retain excluded delayed detonation / reverse-wave surfaces")
	}
	if !strings.Contains(doc.Fields.Leveling2, "Total Physical Damage") {
		t.Fatal("wiki leveling2 must retain excluded total-damage surface")
	}
	if !strings.Contains(doc.Fields.Description3, "once per pass") {
		t.Fatal("wiki description3 must retain excluded once-per-pass surface")
	}
	if !strings.Contains(doc.Fields.Notes, "Spell shield") ||
		!strings.Contains(doc.Fields.Notes, "Wind Wall") ||
		!strings.Contains(doc.Fields.Notes, "Unbreakable") ||
		!strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing excluded spellshield/Wind Wall/Braum/cast-time surfaces: %q",
			doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(gravesEOLRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "graves-q.json"))
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "穷途末路" || pages.OwnerID != "hero_graves" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(gravesEOLRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "graves-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != gravesEOLLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), gravesEOLLocalRawBytes)
	}
	if gravesEOLLocalRawBytes == gravesEOLRawBytes {
		t.Fatal("local raw and canonical sizes must differ (serialization caveat; not equivalence)")
	}
	localSHA := gravesEOLSHA256Hex(rawBytes)
	if localSHA != gravesEOLLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, gravesEOLLocalRawSHA)
	}
	if localSHA == gravesEOLContentSHA {
		t.Fatal("local raw hash must differ from canonical (serialization caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|50 to 150}}",
		"65% '''bonus''' AD",
		"|cost         = 80",
		"|cooldown     = {{ap|13 to 6}}",
		"|damagetype   = Physical",
		"powder trail",
		"detonates",
		"perpendicular",
		"reverse wave",
		"once per pass",
		"Spell shield",
		"Wind Wall",
		"Unbreakable",
		"Effect at cast time end",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if gravesEOLPlanRev != "graves-q-end-of-the-line-first-outbound-pass-phase-a-v2" || gravesEOLBoundary !=
		"rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; "+
			"physical_150_plus_0_65_bonus_ad; "+
			"no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_"+
			"multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_"+
			"area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_"+
			"terrain_interaction_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := gravesEOLRepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := gravesEOLSHA256HexUpper(seedBytes); got != gravesEOLSeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, gravesEOLSeedBlobSHA)
	}
	junitPath := gravesEOLRepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := gravesEOLSHA256HexUpper(junitBytes); got != gravesEOLJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, gravesEOLJUnitBlobSHA)
	}
	_ = gravesEOLRepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := gravesEOLLoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(gravesEOLRepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		gravesEOLCandidateKey, gravesEOLTaskKey, gravesEOLPlanRev,
		gravesEOLRequestTitle, gravesEOLResolvedTitle,
		"1307367", "4007501", gravesEOLTimestamp, "2266", "2265",
		gravesEOLContentSHA, gravesEOLLocalRawSHA,
		gravesEOLBoundary, gravesEOLProviderRef, gravesEOLAbilityID, gravesEOLAbilityKey,
		"end_of_the_line_first_outbound_pass_damage", "q_mana_cost", "q_cooldown_ms",
		`{"op":"const","value":80}`, `{"op":"const","value":6000}`,
		gravesEOLSeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/graves-q.json",
		"external existing-data", "check-only",
		"不物化",
		"bonus AD", "source.attr.ad.resolved", "source.attr.ad.base",
		"ability_started",
		"20220", "20170",
		"true_grit_stacks",
		"Do not copy E into this seed",
		"不创建/突变 P/E/W/R/basic",
		"standalone provider：preserve existing P/E/W/R/basic",
		"missing game_entities hero_graves",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_graves/ad",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_graves/mana",
		"missing reserved_type",
		"150", "0.65",
		"嵌套二元",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range gravesEOLOrderedTags() {
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
	for _, tag := range gravesEOLOrderedTags() {
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
		"phase_hero_graves_q_end_of_the_line_first_outbound_pass_impact",
		"sequence_hero_graves_q_end_of_the_line_first_outbound_pass_impact",
		"step_hero_graves_q_end_of_the_line_first_outbound_pass_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_graves_q_end_of_the_line_first_outbound_pass'\s*,\s*` +
		`'provider_hero_graves_q_end_of_the_line_first_outbound_pass'\s*,\s*` +
		`'end_of_the_line_first_outbound_pass'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("Q must be active ability with stable key end_of_the_line_first_outbound_pass")
	}
	if !regexp.MustCompile(`(?s)'step_hero_graves_q_end_of_the_line_first_outbound_pass_damage'\s*,\s*` +
		`'end_of_the_line_first_outbound_pass_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be physical 20220 add policy copyable_on_hit=false")
	}
	if regexp.MustCompile(`(?is)\b20230\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL/graph must not use provider_action/apply 20230")
	}
	if regexp.MustCompile(`(?is)\b62\d{3}\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL must not invent Q ability-specific 62xxx types")
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
	for _, banned := range []string{
		"true_grit_stacks", "bonus_armor", "bonus_magic_resist",
		"provider_hero_graves_quickdraw", "ability_hero_graves_quickdraw",
		"provider_hero_graves_e_", "provider_hero_graves_w_", "provider_hero_graves_r_",
		"provider_hero_graves_p_", "provider_hero_graves_basic_",
		"hero:graves_new_destiny",
	} {
		if strings.Contains(sqlNoComments, banned) {
			t.Fatalf("standalone Q seed must not contain E/sibling graph token %q", banned)
		}
	}

	for _, want := range []string{
		gravesEOLCandidateKey, gravesEOLTaskKey, gravesEOLPlanRev,
		"lol_generic_graves_end_of_the_line_first_outbound_pass_seed.sql",
		"LolGenericGravesEndOfTheLineFirstOutboundPassSeedSqlTest",
		"external existing-data",
		"physical_150_plus_0_65_bonus_ad",
		"bonus_ad_ratio",
		"true_grit_stacks",
		"Do not copy E into this seed",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦不") {
		t.Fatal("README must document no repository materializer for Graves identity/panel/resource")
	}
	if strings.Contains(readme, "op:graves_end_of_the_line_first_outbound_pass_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}

	compileReq, _ := loadGravesEOLFixture(t, gravesEOLFixtureOpts{
		baseAD: gravesEOLADBaseDefault, resolvedAD: gravesEOLADResolvedDefault,
		armor: gravesEOLTargetArmorDefault, mana: gravesEOLFixtureManaCD,
	})
	assertGravesEOLProviderShape(t, compileReq, 1, true)
	rawX := gravesEOLExpectedRawFromAD(gravesEOLADResolvedDefault, gravesEOLADBaseDefault)
	if math.Abs(rawX-gravesEOLExpectedRawDefault) > gravesEOLTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, gravesEOLExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, gravesEOLTargetArmorDefault)
	if math.Abs(mitX-gravesEOLExpectedMitDefault) > gravesEOLTol {
		t.Fatalf("default mit=%v want %v", mitX, gravesEOLExpectedMitDefault)
	}
	totalAsIf := gravesEOLBaseDamage + gravesEOLBonusADRatio*gravesEOLADResolvedDefault
	if math.Abs(totalAsIf-gravesEOLExpectedRawDefault) < gravesEOLTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestGravesEndOfTheLineFirstOutboundPassFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/armor raw/final table; one isolated successful Q cast per row.
func TestGravesEndOfTheLineFirstOutboundPassFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		baseAD, resolvedAD     float64
		armor                  float64
		wantRaw, wantMitigated float64
	}{
		{"base0_resolved0_armor0", 0, 0, 0, 150, 150},
		{"base60_resolved60_armor0", 60, 60, 0, 150, 150},
		{"base60_resolved160_armor0", 60, 160, 0, 215, 215},
		{"base60_resolved160_armor100", 60, 160, 100, 215, 107.5},
		{"base60_resolved260_armor100", 60, 260, 100, 280, 140},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := gravesEOLExpectedRawFromAD(tc.resolvedAD, tc.baseAD)
			if math.Abs(rawX-tc.wantRaw) > gravesEOLTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > gravesEOLTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadGravesEOLFixture(t, gravesEOLFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: tc.armor, mana: gravesEOLFixtureManaCD,
			})
			assertGravesEOLProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := gravesEOLAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runGravesEOL(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := gravesEOLDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			gravesEOLAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > gravesEOLTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > gravesEOLTol {
				t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)",
					sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(gravesEOLAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(gravesEOLAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestGravesEndOfTheLineFirstOutboundPassBonusADCounterproof: baseAD0/resolvedAD100
// versus baseAD60/resolvedAD160 at armor0 must both raw/final 215 — equal bonus AD.
func TestGravesEndOfTheLineFirstOutboundPassBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100", 0, 100},
		{"baseAD60_resolvedAD160", 60, 160},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadGravesEOLFixture(t, gravesEOLFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: 0, mana: gravesEOLFixtureManaCD,
			})
			assertGravesEOLProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: gravesEOLAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runGravesEOL(t, compileReq, runReq)
			dmg := gravesEOLDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			gravesEOLAssertDamage(t, dmg[0], 215, 215)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > gravesEOLTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > gravesEOLTol {
				t.Fatalf("ad.base=%v want %v", sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	totalAsIf := gravesEOLBaseDamage + gravesEOLBonusADRatio*160
	bonus := gravesEOLExpectedRawFromAD(160, 60)
	if math.Abs(totalAsIf-bonus) < gravesEOLTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestGravesEndOfTheLineFirstOutboundPassCooldownMana240AbilityStarted: mana240/
// base60/resolved160/HP1000/armor100 at t0/t5999/t6000 →
// success/cooldown skip/success; final mana80/HP785; exactly two Q damage
// items and two automatic Q ability_started events.
func TestGravesEndOfTheLineFirstOutboundPassCooldownMana240AbilityStarted(t *testing.T) {
	compileReq, runReq := loadGravesEOLFixture(t, gravesEOLFixtureOpts{
		baseAD: gravesEOLADBaseDefault, resolvedAD: gravesEOLADResolvedDefault,
		armor: gravesEOLTargetArmorDefault, mana: gravesEOLFixtureManaCD, hp: gravesEOLTargetHP,
	})
	assertGravesEOLProviderShape(t, compileReq, 1, true)
	ref := gravesEOLAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6000},
	}
	runReq.StopPolicy.DurationMs = 6100
	done := runGravesEOL(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if gravesEOLSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findGravesEOLAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt5999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 5999 {
			t.Fatalf("cooldown skip TimeMs=%d want 5999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 6000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 6000", item.Data["readyAtMs"])
		}
		skipAt5999 = true
	}
	if !skipAt5999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=5999 with readyAtMs=6000")
	}

	items := gravesEOLDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 6000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		gravesEOLAssertDamage(t, item, gravesEOLExpectedRawDefault, gravesEOLExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * gravesEOLExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-gravesEOLHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, gravesEOLHPAfter2)
	}
	gotMana := gravesEOLSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-gravesEOLManaAfter2) > gravesEOLTol {
		t.Fatalf("mana=%v want %v", gotMana, gravesEOLManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := gravesEOLAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 6000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-gravesEOLADResolvedDefault) > gravesEOLTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), gravesEOLADResolvedDefault)
	}
	if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-gravesEOLADBaseDefault) > gravesEOLTol {
		t.Fatalf("ad.base=%v want %v",
			sourceAttrBase(t, done.FinalSnapshot, "ad"), gravesEOLADBaseDefault)
	}
}

// TestGravesEndOfTheLineFirstOutboundPassResourceInsufficientMana79: mana79 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/start evidence.
func TestGravesEndOfTheLineFirstOutboundPassResourceInsufficientMana79(t *testing.T) {
	compileReq, runReq := loadGravesEOLFixture(t, gravesEOLFixtureOpts{
		baseAD: gravesEOLADBaseDefault, resolvedAD: gravesEOLADResolvedDefault,
		armor: gravesEOLTargetArmorDefault, mana: gravesEOLFixtureManaShort, hp: gravesEOLTargetHP,
	})
	ref := gravesEOLAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runGravesEOL(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if gravesEOLSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(gravesEOLSourceMana(t, done.FinalSnapshot)-gravesEOLFixtureManaShort) > gravesEOLTol {
		t.Fatalf("mana changed: got %v want %v",
			gravesEOLSourceMana(t, done.FinalSnapshot), gravesEOLFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-gravesEOLTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, gravesEOLTargetHP)
	}
	if len(gravesEOLDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(gravesEOLAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestGravesEndOfTheLineFirstOutboundPassQECoexistenceIsolation: mount independent Q
// and existing Quickdraw E. Q cast alone produces exactly one Q hit and leaves
// true_grit_stacks and all four E resistance modifiers absent/zero; E cast alone
// reaches governed max-stack state and produces no Q damage. Assert provider refs/
// stable IDs distinct and no P/W/R/basic synthesis. Do not copy E rows into the Q seed.
func TestGravesEndOfTheLineFirstOutboundPassQECoexistenceIsolation(t *testing.T) {
	compileReq, _ := loadGravesEOLQEFixture(t, 400)
	assertGravesEOLProviderShape(t, compileReq, 2, true)

	qRef := gravesEOLAbilityRef()
	eRef := gravesQDAbilityRef()
	if qRef == eRef {
		t.Fatal("Q and E ability refs must be distinct")
	}
	pQ := gravesEOLFindProvider(compileReq)
	pE := gravesEOLFindQDProvider(compileReq)
	if pQ == nil || pE == nil {
		t.Fatal("combined fixture must mount both Q and E providers")
	}
	if pQ.ProviderKey == pE.ProviderKey || pQ.StableID == pE.StableID {
		t.Fatal("Q/E provider keys/stable IDs must not collide")
	}
	if pE.StableID != gravesQDStableID {
		t.Fatalf("E stableId=%q want %q", pE.StableID, gravesQDStableID)
	}
	if len(pE.InitialStateSchema) != 1 {
		t.Fatalf("E InitialStateSchema=%d want 1 (true_grit_stacks)", len(pE.InitialStateSchema))
	}
	if len(pE.Modifiers) != 4 {
		t.Fatalf("E modifiers=%d want 4", len(pE.Modifiers))
	}
	if len(pQ.InitialStateSchema) != 0 {
		t.Fatal("Q must not carry True Grit state")
	}
	for _, mod := range pQ.Modifiers {
		if mod.Target == "armor" || mod.Target == "bonus_armor" ||
			mod.Target == "magic_resist" || mod.Target == "bonus_magic_resist" ||
			strings.Contains(mod.ModifierKey, "true_grit") {
			t.Fatalf("Q must not carry E resistance modifiers: %+v", mod)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_graves_[pwr]_|ability_hero_graves_[pwr]_|` +
		`provider_hero_graves_basic_|ability_hero_graves_basic_|hero:graves_new_destiny`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			t.Fatalf("must not synthesize P/W/R/basic provider: %+v", p)
		}
		if p.ProviderKey == gravesSmokeScreenPrimaryHitProviderRef ||
			p.StableID == gravesSmokeScreenPrimaryHitStableID ||
			p.ProviderKey == gravesCollateralDamagePrimaryHitProviderRef ||
			p.StableID == gravesCollateralDamagePrimaryHitStableID ||
			p.ProviderKey == gravesNDProviderRef || p.StableID == gravesNDStableID {
			t.Fatal("combined Q+E fixture must not synthesize P/W/R providers")
		}
	}

	t.Run("q_cast_alone_leaves_true_grit_zero", func(t *testing.T) {
		c, r := loadGravesEOLQEFixture(t, 400)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: qRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runGravesEOL(t, c, r)

		if got := gravesQDStacks(t, done.FinalSnapshot); math.Abs(got) > gravesEOLTol {
			t.Fatalf("true_grit_stacks after Q-only=%v want 0", got)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "armor"); math.Abs(got-gravesQDBaseArmor) > gravesEOLTol {
			t.Fatalf("armor after Q-only=%v want baseline %v", got, gravesQDBaseArmor)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "bonus_armor"); math.Abs(got-gravesQDBonusBase) > gravesEOLTol {
			t.Fatalf("bonus_armor after Q-only=%v want 0", got)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "magic_resist"); math.Abs(got-gravesQDBaseMR) > gravesEOLTol {
			t.Fatalf("magic_resist after Q-only=%v want baseline %v", got, gravesQDBaseMR)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "bonus_magic_resist"); math.Abs(got-gravesQDBonusBase) > gravesEOLTol {
			t.Fatalf("bonus_magic_resist after Q-only=%v want 0", got)
		}
		dmg := gravesEOLDamageEvidence(done)
		if len(dmg) != 1 {
			t.Fatalf("Q damage evidence=%d want 1", len(dmg))
		}
		gravesEOLAssertDamage(t, dmg[0], gravesEOLExpectedRawDefault, gravesEOLExpectedMitDefault)
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (Q only)", countEmittedEvents(done, "event/ability_started"))
		}
		qStat := findGravesEOLAbilityStat(t, done)
		if qStat.CastCount != 1 {
			t.Fatalf("Q castCount=%d want 1", qStat.CastCount)
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == eRef && st.CastCount != 0 {
				t.Fatalf("E must not cast during Q-only schedule: %+v", st)
			}
		}
	})

	t.Run("e_cast_max_stack_no_q_damage", func(t *testing.T) {
		c, r := loadGravesEOLQEFixture(t, 400)
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: eRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runGravesEOL(t, c, r)

		if got := gravesQDStacks(t, done.FinalSnapshot); math.Abs(got-gravesQDMaxStacks) > gravesEOLTol {
			t.Fatalf("true_grit_stacks after E=%v want %v", got, gravesQDMaxStacks)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "armor"); math.Abs(got-gravesQDWantArmorRes) > gravesEOLTol {
			t.Fatalf("armor after E=%v want %v", got, gravesQDWantArmorRes)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "bonus_armor"); math.Abs(got-gravesQDWantArmorBonus) > gravesEOLTol {
			t.Fatalf("bonus_armor after E=%v want %v", got, gravesQDWantArmorBonus)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "magic_resist"); math.Abs(got-gravesQDWantMRRes) > gravesEOLTol {
			t.Fatalf("magic_resist after E=%v want %v", got, gravesQDWantMRRes)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "bonus_magic_resist"); math.Abs(got-gravesQDWantMRBonus) > gravesEOLTol {
			t.Fatalf("bonus_magic_resist after E=%v want %v", got, gravesQDWantMRBonus)
		}
		if len(gravesEOLDamageEvidence(done)) != 0 {
			t.Fatal("E cast must not produce Q damage")
		}
		if n := len(damageEvidenceItems(done)); n != 0 {
			t.Fatalf("total damage evidence=%d want 0 (E has no damage; Q not cast)", n)
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (E only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == qRef && st.CastCount != 0 {
				t.Fatalf("Q must not cast during E-only schedule: %+v", st)
			}
			if st.AbilityRef == eRef && st.CastCount != 1 {
				t.Fatalf("E castCount=%d want 1", st.CastCount)
			}
		}
	})
}

// TestGravesEndOfTheLineFirstOutboundPassDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// post-release session_not_found.
func TestGravesEndOfTheLineFirstOutboundPassDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadGravesEOLFixture(t, gravesEOLFixtureOpts{
				baseAD: gravesEOLADBaseDefault, resolvedAD: gravesEOLADResolvedDefault,
				armor: gravesEOLTargetArmorDefault, mana: gravesEOLFixtureManaCD,
			})
			ref := gravesEOLAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6000},
			}
			r.StopPolicy.DurationMs = 6100
			done := runGravesEOL(t, c, r)
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
		c, r := loadGravesEOLFixture(t, gravesEOLFixtureOpts{
			baseAD: gravesEOLADBaseDefault, resolvedAD: gravesEOLADResolvedDefault,
			armor: gravesEOLTargetArmorDefault, mana: gravesEOLFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: gravesEOLAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runGravesEOLFrames(t, c, r)
		if len(gravesEOLDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(gravesEOLDamageEvidence(done)))
		}
		gravesEOLAssertDamage(t, gravesEOLDamageEvidence(done)[0],
			gravesEOLExpectedRawDefault, gravesEOLExpectedMitDefault)
		if len(gravesEOLAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadGravesEOLFixture(t, gravesEOLFixtureOpts{
			baseAD: gravesEOLADBaseDefault, resolvedAD: gravesEOLADResolvedDefault,
			armor: gravesEOLTargetArmorDefault, mana: gravesEOLFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: gravesEOLAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
