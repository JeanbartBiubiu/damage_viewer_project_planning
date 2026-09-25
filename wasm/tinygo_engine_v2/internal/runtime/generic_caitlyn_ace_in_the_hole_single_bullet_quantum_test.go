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

// hero_caitlyn R Ace in the Hole / 让子弹飞 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: caitlyn-r-ace-in-the-hole-single-bullet-quantum-phase-a-v1).
//
// Frozen boundary:
//
//	rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold;
//	physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_
//	cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_
//	untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_
//	conditions_ability_lockout_other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_caitlyn|R|让子弹飞
//	task wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum
//	Request Template:Data Caitlyn/R → resolved Template:Data Caitlyn/Ace in the Hole
//	wikiPageId 1306918 / rev 3982561 / timestamp 2026-01-09T09:02:59Z
//	canonical rawByteSize 3119 / SHA256
//	  08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8
//	数据参考/lol-wiki-current-champions/normalized/generic/caitlyn-r.json
//	pages/raw siblings: pages/caitlyn-r.json, raw/caitlyn-r.wikitext
//	已删除历史种子： db/game_manage/seeds/lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed.sql
//	Local raw materialization caveat: also 3119 bytes / SHA256
//	  015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003.
//	Same-size caveat; assert sidecar/pages canonical identity + caveat; do not claim
//	local-raw equivalence or source contradiction.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum
//     (standalone; not P/Q/W/E/basic synthesis; does not require Caitlyn Q/E publication)
//   - ability ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum with ability_key
//     ace_in_the_hole_single_bullet_quantum: active; mana 100; cooldown 90000 ms
//   - Exactly one immediate selected-primary-champion direct physical damage op
//     (bullet quantum):
//     add(const 650, mul(const 1.00, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base)))
//     (bonus AD; resolved and base each read exactly once; no total-AD substitution;
//     no crit read)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: physical 20220 + add policy 20170; 20230 forbidden
//   - No Caitlyn R state/modifier/listener/matcher/repeat/control/channel/
//     projectile/geometry/interception/crit/sibling; no explicit event op —
//     successful cast relies on runtime automatic ability_started.
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   1s channel / channel locks; target/self reveal; cancel/interrupt/death/
//   untargetable/mana refund/5s canceled cooldown/resurrection; homing/
//   projectile travel/destruction/interception/first-enemy geometry; crit
//   chance 0–30% / crit scaling; target death/corpse continuation; sight 1500;
//   unit-target cancel conditions / ability lockout; ranks 1–2; other Caitlyn
//   behaviors; equipment/runes/loadout/on-hit; live/full fidelity.
//   This is one selected-target damage quantum, not the full ultimate lifecycle.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, bonus_ad_ratio,
// immediate_impact_scaffold (explicitly no crit-ratio governed tag).

const (
	caitlynAHCandidateKey  = "hero_skill|hero_caitlyn|R|让子弹飞"
	caitlynAHTaskKey       = "wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum"
	caitlynAHPlanRev       = "caitlyn-r-ace-in-the-hole-single-bullet-quantum-phase-a-v1"
	caitlynAHRequestTitle  = "Template:Data Caitlyn/R"
	caitlynAHResolvedTitle = "Template:Data Caitlyn/Ace in the Hole"
	caitlynAHWikiPageID    = 1306918
	caitlynAHRevisionID    = 3982561
	caitlynAHTimestamp     = "2026-01-09T09:02:59Z"
	caitlynAHRawBytes      = 3119
	caitlynAHLocalRawBytes = 3119
	caitlynAHContentSHA    = "08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8"
	caitlynAHLocalRawSHA   = "015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003"
	caitlynAHBoundary      = "rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; " +
		"physical_650_plus_1_00_bonus_ad; " +
		"no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_" +
		"interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_" +
		"corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity"

	caitlynAHProviderRef = "provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum"
	caitlynAHStableID    = "hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum"
	caitlynAHAbilityID   = "ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum"
	caitlynAHAbilityKey  = "ace_in_the_hole_single_bullet_quantum"
	caitlynAHDamageOpRef = "op:caitlyn_ace_in_the_hole_single_bullet_quantum_damage"
	caitlynAHBonusADMod  = "fixture_caitlyn_ace_in_the_hole_single_bullet_quantum_bonus_ad"

	caitlynAHBaseDamage   = 650.0
	caitlynAHBonusADRatio = 1.00
	caitlynAHManaCost     = 100.0
	caitlynAHCDMs         = 90000.0

	caitlynAHADBaseDefault      = 60.0
	caitlynAHADResolvedDefault  = 160.0
	caitlynAHFixtureManaCD      = 300.0
	caitlynAHFixtureManaShort   = 99.0
	caitlynAHTargetArmorDefault = 100.0
	caitlynAHTargetHP           = 1000.0

	caitlynAHExpectedRawDefault = 750.0 // 650 + 1.00*(160-60)
	caitlynAHExpectedMitDefault = 375.0 // armor100
	caitlynAHManaAfter2         = 100.0 // 300 - 100 - 100
	caitlynAHHPAfter2           = 250.0 // 1000 - 375 - 375

	caitlynAHTol = 1e-9
)

func caitlynAHOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func caitlynAHExpectedRawFromStats(resolvedAD, baseAD float64) float64 {
	return caitlynAHBaseDamage + caitlynAHBonusADRatio*(resolvedAD-baseAD)
}

func caitlynAHDamageAmount() *model.GenericFormulaExpr {
	base := caitlynAHBaseDamage
	ratio := caitlynAHBonusADRatio
	// Binary add: const650 + mul(1.00, sub(ad.resolved, ad.base)).
	// Bonus AD — resolved and base each read exactly once; no total-AD substitution; no crit.
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

func caitlynAHCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += caitlynAHCountPathReads(&expr.Args[i], path)
	}
	return n
}

func caitlynAHAbility() model.AbilityDefinition {
	cost := caitlynAHManaCost
	cd := caitlynAHCDMs
	return model.AbilityDefinition{
		AbilityKey: caitlynAHAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical bullet quantum; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           caitlynAHDamageOpRef,
				Amount:        caitlynAHDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func caitlynAHProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: caitlynAHProviderRef,
		Kind:        "champion",
		StableID:    caitlynAHStableID,
		Abilities:   []model.AbilityDefinition{caitlynAHAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed R provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: caitlynAHBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func caitlynAHAbilityRef() string {
	return "source.provider[" + caitlynAHProviderRef + "].ability[" + caitlynAHAbilityKey + "]"
}

type caitlynAHFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
	withQ      bool
	withE      bool
}

func configureCaitlynAHProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts caitlynAHFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{caitlynAHProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: caitlynAHProviderRef, DefinitionRef: caitlynAHProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: caitlynAHProviderRef, DefinitionRef: caitlynAHProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if opts.withQ {
		// Same-package Q helpers (read-only use); do not modify Q test file.
		// Only R carries the fixture-only bonus-AD mod when co-mounted.
		providers = append(providers, caitlynPPProviderDef(0))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: caitlynPPProviderRef, DefinitionRef: caitlynPPProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: caitlynPPProviderRef, DefinitionRef: caitlynPPProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	if opts.withE {
		// Same-package E helpers (read-only use); do not modify E test file.
		providers = append(providers, caitlynCNProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: caitlynCNProviderRef, DefinitionRef: caitlynCNProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: caitlynCNProviderRef, DefinitionRef: caitlynCNProviderRef,
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

func ensureCaitlynAHTypes(req *model.CompileRequest, withE bool) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/physical", Domain: "damage"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "event/ability_started", Domain: "event"},
	}
	if withE {
		need = append(need, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"})
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

func loadCaitlynAHFixture(t *testing.T, opts caitlynAHFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/armor explicitly
	// (AD0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = caitlynAHFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = caitlynAHTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureCaitlynAHTypes(&compileReq, opts.withE)
	configureCaitlynAHProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_caitlyn / ad / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, caitlynAHFixtureManaCD),
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

func runCaitlynAH(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runCaitlynAHFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func caitlynAHSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func caitlynAHSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func caitlynAHSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func caitlynAHDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := caitlynAHAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != caitlynAHDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func caitlynAHAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func caitlynAHFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == caitlynAHProviderRef {
			return p
		}
	}
	return nil
}

func assertCaitlynAHProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := caitlynAHFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum missing from SharedProviders")
	}
	if p.ProviderKey != caitlynAHProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, caitlynAHProviderRef)
	}
	if p.StableID != caitlynAHStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, caitlynAHStableID)
	}
	banned := []string{
		"provider_hero_caitlyn_p_", "provider_hero_caitlyn_q_", "provider_hero_caitlyn_w_",
		"provider_hero_caitlyn_e_", "provider_hero_caitlyn_basic_",
		"ability_hero_caitlyn_p_", "ability_hero_caitlyn_q_", "ability_hero_caitlyn_w_",
		"ability_hero_caitlyn_e_", "ability_hero_caitlyn_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("ace_in_the_hole single-bullet quantum must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != caitlynAHBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], caitlynAHBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production R has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), caitlynAHAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != caitlynAHAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, caitlynAHAbilityKey, caitlynAHAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("ace_in_the_hole_single_bullet_quantum must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-caitlynAHManaCost) > caitlynAHTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-caitlynAHCDMs) > caitlynAHTol {
		t.Fatalf("cooldown=%+v want const 90000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one physical bullet quantum)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("ace in the hole bullet-quantum damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("ace in the hole bullet-quantum damage must not be copyable on hit")
	}
	if op.Ref != caitlynAHDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, caitlynAHDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const650, mul(1.00, sub(ad.resolved, ad.base)))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-caitlynAHBaseDamage) > caitlynAHTol {
		t.Fatalf("base const=%+v want 650", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-caitlynAHBonusADRatio) > caitlynAHTol {
		t.Fatalf("bonus AD ratio=%+v want 1.00", adMul.Args[0])
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
	if caitlynAHCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", caitlynAHCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if caitlynAHCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", caitlynAHCountPathReads(op.Amount, "source.attr.ad.base"))
	}
	if caitlynAHCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 0 ||
		caitlynAHCountPathReads(op.Amount, "source.attr.crit_damage.resolved") != 0 {
		t.Fatal("bullet-quantum formula must not read crit attrs")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "channel" ||
			bannedOp.Operation == "interception" || bannedOp.Operation == "crit" {
			t.Fatalf("ace in the hole bullet quantum must not include excluded op: %+v", bannedOp)
		}
	}
}

func findCaitlynAHAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := caitlynAHAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func caitlynAHRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func caitlynAHSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func caitlynAHSHA256HexUpper(b []byte) string {
	return strings.ToUpper(caitlynAHSHA256Hex(b))
}

func caitlynAHAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > caitlynAHTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > caitlynAHTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != caitlynAHDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), caitlynAHDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != caitlynAHAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), caitlynAHAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != caitlynAHProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), caitlynAHProviderRef)
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

// TestCaitlynAceInTheHoleSingleBulletQuantumWikiSourceAndConstructedFixtureFormulaShape 核对历史 Wiki 来源与当前通用运行构造样例的数值、身份和边界；不代表现行管理数据。
func TestCaitlynAceInTheHoleSingleBulletQuantumWikiSourceAndConstructedFixtureFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Description2, Description3, Leveling3 string
			Cooldown, Cost, Costtype, Damagetype, Notes        string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(caitlynAHRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "caitlyn-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != caitlynAHCandidateKey || doc.RequestTitle != caitlynAHRequestTitle ||
		doc.ResolvedTitle != caitlynAHResolvedTitle || doc.WikiPageID != caitlynAHWikiPageID ||
		doc.RevisionID != caitlynAHRevisionID || doc.RevisionTimestamp != caitlynAHTimestamp ||
		doc.ContentSHA256 != caitlynAHContentSHA || doc.RawByteSize != caitlynAHRawBytes ||
		doc.SkillKey != "R" || doc.ZhDisplayName != "让子弹飞" || doc.OwnerID != "hero_caitlyn" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "description2", "description3", "leveling3",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "100\n" || doc.Fields.Costtype != "mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "90\n" {
		t.Fatalf("cooldown=%q want 90 (rank-3 = 90s)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling3, "{{ap|300 to 650}}") ||
		!strings.Contains(doc.Fields.Leveling3, "100%") ||
		!strings.Contains(doc.Fields.Leveling3, "bonus") ||
		!strings.Contains(doc.Fields.Leveling3, "AD") {
		t.Fatalf("leveling3=%q want rank3 650 + 100%% bonus AD", doc.Fields.Leveling3)
	}
	if !strings.Contains(doc.Fields.Description3, "{{as|physical damage}}") {
		t.Fatal("wiki prose must retain physical damage wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description, "channel") ||
		!strings.Contains(doc.Fields.Description, "revealing") {
		t.Fatal("wiki prose must retain excluded channel/reveal surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "canceled") ||
		!strings.Contains(doc.Fields.Description2, "5-second") {
		t.Fatal("wiki prose must retain excluded cancel/short-cooldown surfaces")
	}
	if !strings.Contains(doc.Fields.Description3, "homing") ||
		!strings.Contains(doc.Fields.Description3, "critical damage") ||
		!strings.Contains(doc.Fields.Description3, "critScaling") {
		t.Fatal("wiki prose must retain excluded homing/crit scaling surfaces")
	}
	if !strings.Contains(doc.Fields.Notes, "untargetable") ||
		!strings.Contains(doc.Fields.Notes, "resurrection") ||
		!strings.Contains(doc.Fields.Notes, "corpse") ||
		!strings.Contains(doc.Fields.Notes, "1500") ||
		!strings.Contains(doc.Fields.Notes, "cancel") ||
		!strings.Contains(doc.Fields.Notes, "not compensated") {
		t.Fatalf("notes missing excluded cancel/refund/untargetable/resurrection/corpse/sight surfaces: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(caitlynAHRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "caitlyn-r.json"))
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
		pages.SkillKey != "R" || pages.ZhDisplayName != "让子弹飞" || pages.OwnerID != "hero_caitlyn" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(caitlynAHRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "caitlyn-r.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != caitlynAHLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), caitlynAHLocalRawBytes)
	}
	if caitlynAHLocalRawBytes != caitlynAHRawBytes {
		t.Fatal("local raw and canonical sizes must both be 3119 (same-size caveat)")
	}
	localSHA := caitlynAHSHA256Hex(rawBytes)
	if localSHA != caitlynAHLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, caitlynAHLocalRawSHA)
	}
	if localSHA == caitlynAHContentSHA {
		t.Fatal("local raw hash must differ from canonical (same-size caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|300 to 650}}",
		"100% '''bonus''' AD",
		"|cost         = 100",
		"|cooldown     = 90",
		"|damagetype   = Physical",
		"|projectile   = True",
		"channel",
		"revealing",
		"canceled",
		"homing",
		"critScaling",
		"untargetable",
		"resurrection",
		"corpse",
		"1500",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if caitlynAHPlanRev != "caitlyn-r-ace-in-the-hole-single-bullet-quantum-phase-a-v1" || caitlynAHBoundary !=
		"rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; "+
			"physical_650_plus_1_00_bonus_ad; "+
			"no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_"+
			"interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_"+
			"corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	// 退役种子、后端旧检查与旧说明字节已归入历史证据；此处核对通用构造样例。

	compileReq, _ := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
		baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
		armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaCD,
	})
	assertCaitlynAHProviderShape(t, compileReq, 1, true)
	rawX := caitlynAHExpectedRawFromStats(caitlynAHADResolvedDefault, caitlynAHADBaseDefault)
	if math.Abs(rawX-caitlynAHExpectedRawDefault) > caitlynAHTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, caitlynAHExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, caitlynAHTargetArmorDefault)
	if math.Abs(mitX-caitlynAHExpectedMitDefault) > caitlynAHTol {
		t.Fatalf("default mit=%v want %v", mitX, caitlynAHExpectedMitDefault)
	}
	totalAsIf := caitlynAHBaseDamage + caitlynAHBonusADRatio*caitlynAHADResolvedDefault
	if math.Abs(totalAsIf-caitlynAHExpectedRawDefault) < caitlynAHTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestCaitlynAceInTheHoleSingleBulletQuantumFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/armor raw/final table; proves bonus-AD binary formula.
func TestCaitlynAceInTheHoleSingleBulletQuantumFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		baseAD, resolvedAD     float64
		armor                  float64
		wantRaw, wantMitigated float64
	}{
		{"baseAD0_resolvedAD0_armor0", 0, 0, 0, 650, 650},
		{"baseAD60_resolvedAD60_armor0", 60, 60, 0, 650, 650},
		{"baseAD60_resolvedAD160_armor0", 60, 160, 0, 750, 750},
		{"baseAD60_resolvedAD160_armor100", 60, 160, 100, 750, 375},
		{"baseAD60_resolvedAD260_armor100", 60, 260, 100, 850, 425},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := caitlynAHExpectedRawFromStats(tc.resolvedAD, tc.baseAD)
			if math.Abs(rawX-tc.wantRaw) > caitlynAHTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > caitlynAHTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: tc.armor, mana: caitlynAHFixtureManaCD,
			})
			assertCaitlynAHProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := caitlynAHAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runCaitlynAH(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := caitlynAHDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R bullet-quantum damage evidence=%d want 1", len(dmg))
			}
			caitlynAHAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > caitlynAHTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(caitlynAHSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > caitlynAHTol {
				t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)",
					caitlynAHSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(caitlynAHAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(caitlynAHAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestCaitlynAceInTheHoleSingleBulletQuantumBonusADCounterproof: baseAD0/resolvedAD100
// versus baseAD60/resolvedAD160 with armor0 must both raw/final 750 — equal bonus AD.
func TestCaitlynAceInTheHoleSingleBulletQuantumBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100", 0, 100},
		{"baseAD60_resolvedAD160", 60, 160},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: 0, mana: caitlynAHFixtureManaCD,
			})
			assertCaitlynAHProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: caitlynAHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runCaitlynAH(t, compileReq, runReq)
			dmg := caitlynAHDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("R damage=%d want 1", len(dmg))
			}
			caitlynAHAssertDamage(t, dmg[0], 750, 750)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > caitlynAHTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(caitlynAHSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > caitlynAHTol {
				t.Fatalf("ad.base=%v want %v", caitlynAHSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	totalAsIf := caitlynAHBaseDamage + caitlynAHBonusADRatio*160
	bonus := caitlynAHExpectedRawFromStats(160, 60)
	if math.Abs(totalAsIf-bonus) < caitlynAHTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestCaitlynAceInTheHoleSingleBulletQuantumCooldownMana300AbilityStarted: mana300/
// baseAD60/resolvedAD160/HP1000/armor100 at t0/t89999/t90000 →
// success/cooldown skip/success; final mana100/HP250; two R bullet-quantum damage
// items and two automatic R ability_started events.
func TestCaitlynAceInTheHoleSingleBulletQuantumCooldownMana300AbilityStarted(t *testing.T) {
	compileReq, runReq := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
		baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
		armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaCD, hp: caitlynAHTargetHP,
	})
	assertCaitlynAHProviderShape(t, compileReq, 1, true)
	ref := caitlynAHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 89999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 90000},
	}
	runReq.StopPolicy.DurationMs = 90100
	done := runCaitlynAH(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if caitlynAHSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findCaitlynAHAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt89999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 89999 {
			t.Fatalf("cooldown skip TimeMs=%d want 89999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 90000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 90000", item.Data["readyAtMs"])
		}
		skipAt89999 = true
	}
	if !skipAt89999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=89999 with readyAtMs=90000")
	}

	items := caitlynAHDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("R bullet-quantum damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 90000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		caitlynAHAssertDamage(t, item, caitlynAHExpectedRawDefault, caitlynAHExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * caitlynAHExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-caitlynAHHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, caitlynAHHPAfter2)
	}
	gotMana := caitlynAHSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-caitlynAHManaAfter2) > caitlynAHTol {
		t.Fatalf("mana=%v want %v", gotMana, caitlynAHManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := caitlynAHAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic R; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 90000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-caitlynAHADResolvedDefault) > caitlynAHTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), caitlynAHADResolvedDefault)
	}
	if math.Abs(caitlynAHSourceAttrBase(t, done.FinalSnapshot, "ad")-caitlynAHADBaseDefault) > caitlynAHTol {
		t.Fatalf("ad.base=%v want %v",
			caitlynAHSourceAttrBase(t, done.FinalSnapshot, "ad"), caitlynAHADBaseDefault)
	}
}

// TestCaitlynAceInTheHoleSingleBulletQuantumResourceInsufficientMana99: mana99 at t0 →
// resource_insufficient; mana/HP unchanged; zero R damage/event evidence.
func TestCaitlynAceInTheHoleSingleBulletQuantumResourceInsufficientMana99(t *testing.T) {
	compileReq, runReq := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
		baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
		armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaShort, hp: caitlynAHTargetHP,
	})
	ref := caitlynAHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCaitlynAH(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if caitlynAHSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(caitlynAHSourceMana(t, done.FinalSnapshot)-caitlynAHFixtureManaShort) > caitlynAHTol {
		t.Fatalf("mana changed: got %v want %v",
			caitlynAHSourceMana(t, done.FinalSnapshot), caitlynAHFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-caitlynAHTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, caitlynAHTargetHP)
	}
	if len(caitlynAHDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero R damage evidence")
	}
	if len(caitlynAHAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestCaitlynAceInTheHoleSingleBulletQuantumStandaloneNoSiblingSynthesis: standalone R
// provider does not synthesize P/Q/W/E/basic or overwrite unrelated definitions.
func TestCaitlynAceInTheHoleSingleBulletQuantumStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
		baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
		armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaCD,
	})
	assertCaitlynAHProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_caitlyn_ace_in_the_hole_unrelated_sentinel"
	sentinelStable := "fixture_caitlyn_ace_in_the_hole_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != caitlynAHProviderRef {
		t.Fatalf("source mounts=%+v want only R", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != caitlynAHProviderRef {
			t.Fatalf("source snapshots=%+v want only R", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_caitlyn_[pqwe]_|ability_hero_caitlyn_[pqwe]_|` +
		`provider_hero_caitlyn_basic_|ability_hero_caitlyn_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == caitlynAHProviderRef || p.StableID == caitlynAHStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != caitlynAHProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("R must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}
	for _, p := range compileReq.SharedProviders {
		if p.ProviderKey == caitlynPPProviderRef || p.StableID == caitlynPPStableID {
			t.Fatal("R-only fixture must not synthesize Piltover Peacemaker Q provider")
		}
		if p.ProviderKey == caitlynCNProviderRef || p.StableID == caitlynCNStableID {
			t.Fatal("R-only fixture must not synthesize 90 Caliber Net E provider")
		}
	}

	ref := caitlynAHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runCaitlynAH(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(caitlynAHDamageEvidence(done)) != 1 {
		t.Fatalf("R damage=%d want 1", len(caitlynAHDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone R must not synthesize extra damage")
	}
	if len(caitlynPPDamageEvidence(done)) != 0 {
		t.Fatal("R-only must not produce Q damage evidence")
	}
	if len(caitlynCNDamageEvidence(done)) != 0 {
		t.Fatal("R-only must not produce E damage evidence")
	}
	if len(caitlynAHAbilityStartedEvidence(done)) != 1 {
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
				if ps.ProviderRef == caitlynAHProviderRef || ps.DefinitionRef == caitlynAHProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestCaitlynAceInTheHoleSingleBulletQuantumQEIsolationCoexistence: R-only does not
// synthesize Q/E; combined Q+E+R keeps distinct provider/ability refs; R casts
// produce no Q/E damage/start/stats evidence. Uses same-package Q/E helpers
// read-only; Q and E test files unmodified.
func TestCaitlynAceInTheHoleSingleBulletQuantumQEIsolationCoexistence(t *testing.T) {
	t.Run("r_only_no_qe_synthesis", func(t *testing.T) {
		compileReq, runReq := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
			baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
			armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaCD,
		})
		assertCaitlynAHProviderShape(t, compileReq, 1, true)
		for _, p := range compileReq.SharedProviders {
			if p.ProviderKey == caitlynPPProviderRef || p.StableID == caitlynPPStableID {
				t.Fatal("R-only must not synthesize Q provider")
			}
			if p.ProviderKey == caitlynCNProviderRef || p.StableID == caitlynCNStableID {
				t.Fatal("R-only must not synthesize E provider")
			}
			for _, a := range p.Abilities {
				if a.AbilityKey == caitlynPPAbilityKey || a.AbilityKey == caitlynCNAbilityKey {
					t.Fatalf("R-only must not synthesize Q/E ability key %q", a.AbilityKey)
				}
			}
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: caitlynAHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runCaitlynAH(t, compileReq, runReq)
		if len(caitlynPPDamageEvidence(done)) != 0 {
			t.Fatal("R-only must not produce Q damage")
		}
		if len(caitlynCNDamageEvidence(done)) != 0 {
			t.Fatal("R-only must not produce E damage")
		}
		if len(done.Summary.AbilityStats) != 1 ||
			done.Summary.AbilityStats[0].AbilityRef != caitlynAHAbilityRef() {
			t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
		}
	})

	t.Run("combined_qer_distinct_r_cast_no_qe_evidence", func(t *testing.T) {
		compileReq, runReq := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
			baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
			armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaCD, withQ: true, withE: true,
		})
		assertCaitlynAHProviderShape(t, compileReq, 3, true)
		assertCaitlynPPProviderShape(t, compileReq, 3, false)
		assertCaitlynCNProviderShape(t, compileReq, 3)

		if caitlynAHProviderRef == caitlynPPProviderRef || caitlynAHProviderRef == caitlynCNProviderRef ||
			caitlynAHStableID == caitlynPPStableID || caitlynAHStableID == caitlynCNStableID ||
			caitlynAHAbilityID == caitlynPPAbilityID || caitlynAHAbilityID == caitlynCNAbilityID ||
			caitlynAHAbilityKey == caitlynPPAbilityKey || caitlynAHAbilityKey == caitlynCNAbilityKey ||
			caitlynAHAbilityRef() == caitlynPPAbilityRef() || caitlynAHAbilityRef() == caitlynCNAbilityRef() ||
			caitlynAHDamageOpRef == caitlynPPDamageOpRef || caitlynAHDamageOpRef == caitlynCNDamageOpRef {
			t.Fatal("Q/E/R provider/ability/op refs must remain distinct")
		}
		foundQ, foundE, foundR := false, false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == caitlynPPProviderRef {
				foundQ = true
			}
			if m.ProviderRef == caitlynCNProviderRef {
				foundE = true
			}
			if m.ProviderRef == caitlynAHProviderRef {
				foundR = true
			}
		}
		if !foundQ || !foundE || !foundR {
			t.Fatalf("combined mounts=%+v want Q+E+R", compileReq.Combatants[0].Providers)
		}

		rRef := caitlynAHAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: rRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runCaitlynAH(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(caitlynAHDamageEvidence(done)) != 1 {
			t.Fatalf("R damage=%d want 1", len(caitlynAHDamageEvidence(done)))
		}
		caitlynAHAssertDamage(t, caitlynAHDamageEvidence(done)[0],
			caitlynAHExpectedRawDefault, caitlynAHExpectedMitDefault)
		if len(caitlynPPDamageEvidence(done)) != 0 {
			t.Fatal("R cast must not produce Q damage evidence")
		}
		if len(caitlynCNDamageEvidence(done)) != 0 {
			t.Fatal("R cast must not produce E damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture R cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (R only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == caitlynPPAbilityRef() || st.AbilityRef == caitlynCNAbilityRef() {
				t.Fatalf("R cast must not produce Q/E AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != rRef {
			t.Fatalf("AbilityStats=%+v want only R", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == caitlynPPAbilityRef() ||
				evidenceDataString(item.Data, "abilityRef") == caitlynCNAbilityRef() {
				t.Fatalf("R cast must not produce Q/E abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == caitlynPPDamageOpRef ||
				evidenceDataString(item.Data, "operationRef") == caitlynCNDamageOpRef {
				t.Fatalf("R cast must not produce Q/E operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == caitlynPPProviderRef ||
				evidenceDataString(item.Data, "providerRef") == caitlynCNProviderRef {
				t.Fatalf("R cast must not produce Q/E providerRef evidence: %+v", item)
			}
		}
	})
}

// TestCaitlynAceInTheHoleSingleBulletQuantumDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// wrong/missing/released session behavior.
func TestCaitlynAceInTheHoleSingleBulletQuantumDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
				baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
				armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaCD,
			})
			ref := caitlynAHAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 89999},
				{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 90000},
			}
			r.StopPolicy.DurationMs = 90100
			done := runCaitlynAH(t, c, r)
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
		c, r := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
			baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
			armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: caitlynAHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runCaitlynAHFrames(t, c, r)
		if len(caitlynAHDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path R damage=%d want 1", len(caitlynAHDamageEvidence(done)))
		}
		caitlynAHAssertDamage(t, caitlynAHDamageEvidence(done)[0], caitlynAHExpectedRawDefault, caitlynAHExpectedMitDefault)
		if len(caitlynAHAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadCaitlynAHFixture(t, caitlynAHFixtureOpts{
			baseAD: caitlynAHADBaseDefault, resolvedAD: caitlynAHADResolvedDefault,
			armor: caitlynAHTargetArmorDefault, mana: caitlynAHFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "r0", AbilityRef: caitlynAHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
