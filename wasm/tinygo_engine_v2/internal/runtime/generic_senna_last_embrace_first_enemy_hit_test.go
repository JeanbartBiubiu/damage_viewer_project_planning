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

// hero_senna W Last Embrace / 无尽厮守 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: senna-w-last-embrace-first-enemy-hit-phase-a-v2).
//
// Frozen boundary:
//
//	rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold;
//	physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_
//	line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_
//	early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_
//	other_ranks_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_senna|W|无尽厮守
//	task wasm-generic-senna-last-embrace-first-enemy-hit
//	Request Template:Data Senna/W → resolved Template:Data Senna/Last Embrace
//	wikiPageId 1409576 / rev 4009139 / timestamp 2026-04-15T21:34:10Z
//	canonical rawByteSize 1656 / SHA256
//	  48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492
//	数据参考/lol-wiki-current-champions/normalized/generic/senna-w.json
//	  bytes 2120 / SHA256
//	  c570469e807dcf9a0713af6bb0da3ab8d3be1bc61f192a307b59e7a10a5fdc8b
//	pages/raw siblings: pages/senna-w.json (bytes 685 / SHA256
//	  7f9ffc935d079acb610a07925eccb865b2baf7ecabe16784960d34e2341f41f4),
//	  raw/senna-w.wikitext
//	Backend seed: db/game_manage/seeds/lol_generic_senna_last_embrace_first_enemy_hit_seed.sql
//	Local raw materialization caveat: 1651 bytes / SHA256
//	  737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e.
//	Serialization caveat only; assert sidecar/pages canonical identity + caveat;
//	do not claim local-raw equivalence or source contradiction.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_senna_w_last_embrace_first_enemy_hit
//     (standalone; not P/Q/E/R/basic synthesis)
//   - ability ability_hero_senna_w_last_embrace_first_enemy_hit with ability_key
//     last_embrace_first_enemy_hit: active; mana 70; cooldown 11000 ms
//   - Exactly one immediate selected-primary-champion physical damage op:
//     add(const 230, mul(const 0.90, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base)))
//     (every arithmetic node binary; each read path exactly once)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - Runtime types: physical 20220 + add policy 20170; 20230 forbidden
//   - No Senna W state/modifier/listener/matcher/repeat/control/secondary/
//     projectile/movement/geometry/attachment/root/AOE; no explicit event op —
//     successful cast relies on runtime automatic ability_started.
//     W Types empty (no ability-specific game-local W type).
//     Fixture may supply entity/attribute/resource values (external-existing-data/
//     check-only) and may attach a fixture-only flat AD modifier so ad.resolved
//     can differ from ad.base; must not claim the seed materializes them.
//     Standalone W seed contains no sibling synthesis.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast time/Effect at cast time end/direction/range/width/line geometry;
//   projectile speed/travel/collision/actual first-enemy acquisition;
//   attachment/target-death early spread/delayed root/root duration/
//   surrounding AOE; untargetable/spellshield; ranks 1–4;
//   P/Q/E/R/basic/loadout coupling; bootstrap; crit/on-hit; live/publish/E2E/
//   full fidelity.
//   Exactly one selected-target first-enemy physical hit, not full W.
//
// Ordered tags: ability_cost_cooldown, active_physical_damage, bonus_ad_ratio,
// immediate_impact_scaffold.

const (
	sennaLECandidateKey    = "hero_skill|hero_senna|W|无尽厮守"
	sennaLETaskKey         = "wasm-generic-senna-last-embrace-first-enemy-hit"
	sennaLEPlanRev         = "senna-w-last-embrace-first-enemy-hit-phase-a-v2"
	sennaLERequestTitle    = "Template:Data Senna/W"
	sennaLEResolvedTitle   = "Template:Data Senna/Last Embrace"
	sennaLEWikiPageID      = 1409576
	sennaLERevisionID      = 4009139
	sennaLETimestamp       = "2026-04-15T21:34:10Z"
	sennaLERawBytes        = 1656
	sennaLELocalRawBytes   = 1651
	sennaLENormalizedBytes = 2120
	sennaLEPagesBytes      = 685
	sennaLEContentSHA      = "48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492"
	sennaLELocalRawSHA     = "737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e"
	sennaLENormalizedSHA   = "c570469e807dcf9a0713af6bb0da3ab8d3be1bc61f192a307b59e7a10a5fdc8b"
	sennaLEPagesSHA        = "7f9ffc935d079acb610a07925eccb865b2baf7ecabe16784960d34e2341f41f4"
	sennaLEBoundary        = "rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; " +
		"physical_230_plus_0_90_bonus_ad; " +
		"no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_" +
		"travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_" +
		"delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_" +
		"other_ranks_or_full_fidelity"

	sennaLEProviderRef = "provider_hero_senna_w_last_embrace_first_enemy_hit"
	sennaLEStableID    = "hero_senna_w_last_embrace_first_enemy_hit"
	sennaLEAbilityID   = "ability_hero_senna_w_last_embrace_first_enemy_hit"
	sennaLEAbilityKey  = "last_embrace_first_enemy_hit"
	sennaLEDamageOpRef = "op:senna_last_embrace_first_enemy_hit_damage"
	sennaLEBonusADMod  = "fixture_senna_last_embrace_first_enemy_hit_bonus_ad"

	sennaLESeedBlobSHA  = "0327787AD71B6BD75CC595565FA11BCCCD5554E9942C9A8B198B0F6FAF95EFC7"
	sennaLEJUnitBlobSHA = "9BB02FFD38F3B79D62FF4264D3A55CB5FA41A56BD0A0F2622BC2D5F0D35D75FF"

	sennaLEBaseDamage   = 230.0
	sennaLEBonusADRatio = 0.90
	sennaLEManaCost     = 70.0
	sennaLECDMs         = 11000.0

	sennaLEADBaseDefault      = 60.0
	sennaLEADResolvedDefault  = 160.0
	sennaLEFixtureManaCD      = 210.0
	sennaLEFixtureManaShort   = 69.0
	sennaLETargetArmorDefault = 100.0
	sennaLETargetHP           = 1000.0

	// Default fixture: bonusAD=100 → raw 320; armor100 → mitigated 160.
	sennaLEExpectedRawDefault = 320.0
	sennaLEExpectedMitDefault = 160.0
	sennaLEManaAfter2         = 70.0  // 210 - 70 - 70
	sennaLEHPAfter2           = 680.0 // 1000 - 160 - 160

	sennaLESeedDamageJSON = `{"op":"add","args":[{"op":"const","value":230},` +
		`{"op":"mul","args":[{"op":"const","value":0.90},{"op":"sub","args":[` +
		`{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}`

	sennaLETol = 1e-9
)

func sennaLEOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"immediate_impact_scaffold",
	}
}

func sennaLEExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return sennaLEBaseDamage + sennaLEBonusADRatio*(resolvedAD-baseAD)
}

func sennaLEDamageAmount() *model.GenericFormulaExpr {
	base := sennaLEBaseDamage
	ratio := sennaLEBonusADRatio
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

func sennaLECountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += sennaLECountPathReads(&expr.Args[i], path)
	}
	return n
}

func sennaLEAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		sennaLEAssertBinaryArity(t, &expr.Args[i])
	}
}

func sennaLEAbility() model.AbilityDefinition {
	cost := sennaLEManaCost
	cd := sennaLECDMs
	return model.AbilityDefinition{
		AbilityKey: sennaLEAbilityKey,
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
				Ref:           sennaLEDamageOpRef,
				Amount:        sennaLEDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func sennaLEProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: sennaLEProviderRef,
		Kind:        "champion",
		StableID:    sennaLEStableID,
		Abilities:   []model.AbilityDefinition{sennaLEAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed W provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: sennaLEBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func sennaLEAbilityRef() string {
	return "source.provider[" + sennaLEProviderRef + "].ability[" + sennaLEAbilityKey + "]"
}

type sennaLEFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func configureSennaLEProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts sennaLEFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{sennaLEProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: sennaLEProviderRef, DefinitionRef: sennaLEProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: sennaLEProviderRef, DefinitionRef: sennaLEProviderRef,
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

func ensureSennaLETypes(req *model.CompileRequest) {
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

func loadSennaLEFixture(t *testing.T, opts sennaLEFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/armor explicitly
	// (AD0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = sennaLEFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = sennaLETargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureSennaLETypes(&compileReq)
	configureSennaLEProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_senna / ad / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, sennaLEFixtureManaCD),
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

func runSennaLE(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runSennaLEFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func sennaLESourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func sennaLESkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func sennaLEDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := sennaLEAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != sennaLEDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func sennaLEAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only W mounted, filter by
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

func sennaLEFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == sennaLEProviderRef {
			return p
		}
	}
	return nil
}

func assertSennaLEProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := sennaLEFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_senna_w_last_embrace_first_enemy_hit missing from SharedProviders")
	}
	if p.ProviderKey != sennaLEProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, sennaLEProviderRef)
	}
	if p.StableID != sennaLEStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, sennaLEStableID)
	}
	siblingPat := regexp.MustCompile(`provider_hero_senna_[pqer]_|ability_hero_senna_[pqer]_|` +
		`provider_hero_senna_basic_|ability_hero_senna_basic_`)
	if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
		t.Fatal("last_embrace first-enemy-hit must not reuse P/Q/E/R/basic provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no attachment/root/AOE state)", len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != sennaLEBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], sennaLEBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production W has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), sennaLEAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != sennaLEAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, sennaLEAbilityKey, sennaLEAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("W Types=%v want empty (no ability-specific game-local W type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("last_embrace_first_enemy_hit must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("W must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("W must not carry tickSpec")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("W must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-sennaLEManaCost) > sennaLETol {
		t.Fatalf("cost=%+v want mana const 70", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-sennaLECDMs) > sennaLETol {
		t.Fatalf("cooldown=%+v want const 11000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary first-enemy physical hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("last embrace damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("last embrace damage must not be copyable on hit")
	}
	if op.Ref != sennaLEDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, sennaLEDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const230, mul(0.90, sub(ad.resolved, ad.base)))", op.Amount)
	}
	sennaLEAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-sennaLEBaseDamage) > sennaLETol {
		t.Fatalf("base const=%+v want 230", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-sennaLEBonusADRatio) > sennaLETol {
		t.Fatalf("bonus AD ratio=%+v want 0.90", mul.Args[0])
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
	if sennaLECountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", sennaLECountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if sennaLECountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", sennaLECountPathReads(op.Amount, "source.attr.ad.base"))
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
			bannedOp.Operation == "attach" || bannedOp.Operation == "attachment" ||
			bannedOp.DamageType == "damage/magic" {
			t.Fatalf("last embrace must not include excluded op: %+v", bannedOp)
		}
	}
}

func findSennaLEAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := sennaLEAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func sennaLERepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func sennaLELoadSeedSQL(t *testing.T) (full string, noLineComments string) {
	t.Helper()
	raw, err := os.ReadFile(sennaLERepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_senna_last_embrace_first_enemy_hit_seed.sql"))
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

func sennaLESHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func sennaLESHA256HexUpper(b []byte) string {
	return strings.ToUpper(sennaLESHA256Hex(b))
}

func sennaLEAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > sennaLETol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > sennaLETol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != sennaLEDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), sennaLEDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != sennaLEAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), sennaLEAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != sennaLEProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), sennaLEProviderRef)
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

// TestSennaLastEmbraceFirstEnemyHitSourceSeedProviderFormulaShape locks wiki/sidecar/
// pages/local-raw serialization caveat, seed/README/JUnit identities and source blob
// hashes, external-existing-data check-only prerequisites / non-materialization,
// ordered tags, type-policy evidence, and W provider/bonusAD formula shape.
func TestSennaLastEmbraceFirstEnemyHitSourceSeedProviderFormulaShape(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Leveling, Cooldown, Cost, Costtype, Damagetype, Notes string
			Description2, Leveling2                                            string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(sennaLERepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "senna-w.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != sennaLENormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), sennaLENormalizedBytes)
	}
	if got := sennaLESHA256Hex(sidecarRaw); got != sennaLENormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, sennaLENormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != sennaLECandidateKey || doc.RequestTitle != sennaLERequestTitle ||
		doc.ResolvedTitle != sennaLEResolvedTitle || doc.WikiPageID != sennaLEWikiPageID ||
		doc.RevisionID != sennaLERevisionID || doc.RevisionTimestamp != sennaLETimestamp ||
		doc.ContentSHA256 != sennaLEContentSHA || doc.RawByteSize != sennaLERawBytes ||
		doc.SkillKey != "W" || doc.ZhDisplayName != "无尽厮守" || doc.OwnerID != "hero_senna" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "leveling2",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false", key)
		}
	}
	if doc.Fields.Cost != "{{ap|50 to 70}}\n" || doc.Fields.Costtype != "Mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "11\n" {
		t.Fatalf("cooldown=%q want 11 (rank-5 = 11s / 11000ms)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|70 to 230}}") ||
		!strings.Contains(doc.Fields.Leveling, "90% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q want rank5 physical 230 +90%% bonus AD", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") ||
		!strings.Contains(doc.Fields.Description, "first enemy hit") ||
		!strings.Contains(doc.Fields.Description, "attaches to them for 1 second") {
		t.Fatal("wiki prose must retain physical damage / first enemy / 1s attachment wording")
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description2, "rooting") ||
		!strings.Contains(doc.Fields.Description2, "surrounding enemies") ||
		!strings.Contains(doc.Fields.Description2, "target dies") {
		t.Fatal("wiki description2 must retain excluded delayed root / surrounding AOE surfaces")
	}
	if !strings.Contains(doc.Fields.Leveling2, "Root Duration") {
		t.Fatal("wiki leveling2 must retain excluded root-duration surface")
	}
	if !strings.Contains(doc.Fields.Notes, "untargetable") ||
		!strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing excluded untargetable/cast-time surfaces: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(sennaLERepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "senna-w.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != sennaLEPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), sennaLEPagesBytes)
	}
	if got := sennaLESHA256Hex(pagesRaw); got != sennaLEPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, sennaLEPagesSHA)
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
		pages.SkillKey != "W" || pages.ZhDisplayName != "无尽厮守" || pages.OwnerID != "hero_senna" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(sennaLERepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "senna-w.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != sennaLELocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), sennaLELocalRawBytes)
	}
	if sennaLELocalRawBytes == sennaLERawBytes {
		t.Fatal("local raw and canonical sizes must differ (serialization caveat; not equivalence)")
	}
	localSHA := sennaLESHA256Hex(rawBytes)
	if localSHA != sennaLELocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, sennaLELocalRawSHA)
	}
	if localSHA == sennaLEContentSHA {
		t.Fatal("local raw hash must differ from canonical (serialization caveat; not equivalence/contradiction)")
	}
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|70 to 230}}",
		"90% '''bonus''' AD",
		"|cost         = {{ap|50 to 70}}",
		"|cooldown     = 11",
		"|damagetype   = Physical",
		"first enemy hit",
		"attaches to them for 1 second",
		"rooting",
		"surrounding enemies",
		"Root Duration",
		"untargetable",
		"Effect at cast time end",
		"|cast time    =",
		"|target range =",
		"|width        =",
		"|speed        =",
		"|spellshield  = True",
		"|projectile   = True",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if sennaLEPlanRev != "senna-w-last-embrace-first-enemy-hit-phase-a-v2" || sennaLEBoundary !=
		"rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; "+
			"physical_230_plus_0_90_bonus_ad; "+
			"no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_"+
			"travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_"+
			"delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_"+
			"other_ranks_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}

	seedPath := sennaLERepoPath(t,
		"db", "game_manage", "seeds", "lol_generic_senna_last_embrace_first_enemy_hit_seed.sql")
	seedBytes, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := sennaLESHA256HexUpper(seedBytes); got != sennaLESeedBlobSHA {
		t.Fatalf("seed blob sha=%q want %q", got, sennaLESeedBlobSHA)
	}
	junitPath := sennaLERepoPath(t, "server", "data_manage", "src", "test", "java", "xyz", "game",
		"datamanage", "db", "LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest.java")
	junitBytes, err := os.ReadFile(junitPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := sennaLESHA256HexUpper(junitBytes); got != sennaLEJUnitBlobSHA {
		t.Fatalf("junit blob sha=%q want %q", got, sennaLEJUnitBlobSHA)
	}
	_ = sennaLERepoPath(t, "server", "data_manage", "README.md")

	seed, sqlNoComments := sennaLELoadSeedSQL(t)
	readmeBytes, err := os.ReadFile(sennaLERepoPath(t, "server", "data_manage", "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	readme := string(readmeBytes)

	for _, want := range []string{
		sennaLECandidateKey, sennaLETaskKey, sennaLEPlanRev,
		sennaLERequestTitle, sennaLEResolvedTitle,
		"1409576", "4009139", sennaLETimestamp, "1656", "1651", "2120", "685",
		sennaLEContentSHA, sennaLELocalRawSHA, sennaLENormalizedSHA, sennaLEPagesSHA,
		sennaLEBoundary, sennaLEProviderRef, sennaLEAbilityID, sennaLEAbilityKey,
		"last_embrace_first_enemy_hit_damage", "w_mana_cost", "w_cooldown_ms",
		`{"op":"const","value":70}`, `{"op":"const","value":11000}`,
		sennaLESeedDamageJSON, "local raw materialization caveat",
		"normalized/generic/senna-w.json", "pages/senna-w.json",
		"external existing-data", "check-only",
		"不物化",
		"bonus AD", "source.attr.ad.resolved", "source.attr.ad.base",
		"ability_started",
		"20220", "20170",
		"不创建/突变/合成/复制 P/Q/E/R/basic",
		"standalone isolation",
		"missing game_entities hero_senna",
		"missing attribute_definitions",
		"missing entity_attribute_values hero_senna/ad",
		"missing resource_definitions mana",
		"missing entity_resource_values hero_senna/mana",
		"missing reserved_type",
		"230", "0.90",
		"嵌套二元",
	} {
		if !strings.Contains(seed, want) {
			t.Fatalf("seed missing %q", want)
		}
	}
	for _, tag := range sennaLEOrderedTags() {
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
	for _, tag := range sennaLEOrderedTags() {
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
		"phase_hero_senna_w_last_embrace_first_enemy_hit_impact",
		"sequence_hero_senna_w_last_embrace_first_enemy_hit_impact",
		"step_hero_senna_w_last_embrace_first_enemy_hit_damage",
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
	if !regexp.MustCompile(`(?s)'ability_hero_senna_w_last_embrace_first_enemy_hit'\s*,\s*` +
		`'provider_hero_senna_w_last_embrace_first_enemy_hit'\s*,\s*` +
		`'last_embrace_first_enemy_hit'\s*,\s*20130`).MatchString(seed) {
		t.Fatal("W must be active ability with stable key last_embrace_first_enemy_hit")
	}
	if !regexp.MustCompile(`(?s)'step_hero_senna_w_last_embrace_first_enemy_hit_damage'\s*,\s*` +
		`'last_embrace_first_enemy_hit_damage'\s*,\s*20220\s*,\s*20170\s*,\s*false`).MatchString(seed) {
		t.Fatal("damage must be physical 20220 add policy copyable_on_hit=false")
	}
	if regexp.MustCompile(`(?is)\b20230\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL/graph must not use provider_action/apply 20230")
	}
	if regexp.MustCompile(`(?is)\b62\d{3}\b`).MatchString(sqlNoComments) {
		t.Fatal("executable SQL must not invent W ability-specific 62xxx types")
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
		"provider_hero_senna_q_", "ability_hero_senna_q_",
		"provider_hero_senna_e_", "ability_hero_senna_e_",
		"provider_hero_senna_r_", "ability_hero_senna_r_",
		"provider_hero_senna_p_", "ability_hero_senna_p_",
		"provider_hero_senna_basic_", "ability_hero_senna_basic_",
	} {
		if strings.Contains(sqlNoComments, banned) {
			t.Fatalf("standalone W seed must not contain sibling graph token %q", banned)
		}
	}

	for _, want := range []string{
		sennaLECandidateKey, sennaLETaskKey, sennaLEPlanRev,
		"lol_generic_senna_last_embrace_first_enemy_hit_seed.sql",
		"LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest",
		"external existing-data",
		"physical_230_plus_0_90_bonus_ad",
		"bonus_ad_ratio",
		"standalone isolation",
		"不创建/突变/合成/复制 P/Q/E/R/basic",
	} {
		if !strings.Contains(readme, want) {
			t.Fatalf("README missing %q", want)
		}
	}
	if !strings.Contains(readme, "materializer") && !strings.Contains(readme, "不物化") &&
		!strings.Contains(readme, "亦不") {
		t.Fatal("README must document no repository materializer for Senna identity/panel/resource")
	}
	if strings.Contains(readme, "op:senna_last_embrace_first_enemy_hit_damage") {
		t.Fatal("README must not claim fixture-only Wasm op ref as production seed behavior")
	}

	compileReq, _ := loadSennaLEFixture(t, sennaLEFixtureOpts{
		baseAD: sennaLEADBaseDefault, resolvedAD: sennaLEADResolvedDefault,
		armor: sennaLETargetArmorDefault, mana: sennaLEFixtureManaCD,
	})
	assertSennaLEProviderShape(t, compileReq, 1, true)
	rawX := sennaLEExpectedRawFromAD(sennaLEADResolvedDefault, sennaLEADBaseDefault)
	if math.Abs(rawX-sennaLEExpectedRawDefault) > sennaLETol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, sennaLEExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, sennaLETargetArmorDefault)
	if math.Abs(mitX-sennaLEExpectedMitDefault) > sennaLETol {
		t.Fatalf("default mit=%v want %v", mitX, sennaLEExpectedMitDefault)
	}
	totalAsIf := sennaLEBaseDamage + sennaLEBonusADRatio*sennaLEADResolvedDefault
	if math.Abs(totalAsIf-sennaLEExpectedRawDefault) < sennaLETol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestSennaLastEmbraceFirstEnemyHitFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/armor raw/final table; one isolated successful W cast per row.
func TestSennaLastEmbraceFirstEnemyHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		baseAD, resolvedAD     float64
		armor                  float64
		wantRaw, wantMitigated float64
	}{
		{"base0_resolved0_armor0", 0, 0, 0, 230, 230},
		{"base60_resolved60_armor0", 60, 60, 0, 230, 230},
		{"base60_resolved160_armor0", 60, 160, 0, 320, 320},
		{"base60_resolved160_armor100", 60, 160, 100, 320, 160},
		{"base60_resolved260_armor100", 60, 260, 100, 410, 205},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := sennaLEExpectedRawFromAD(tc.resolvedAD, tc.baseAD)
			if math.Abs(rawX-tc.wantRaw) > sennaLETol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > sennaLETol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadSennaLEFixture(t, sennaLEFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: tc.armor, mana: sennaLEFixtureManaCD,
			})
			assertSennaLEProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := sennaLEAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSennaLE(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := sennaLEDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("W damage evidence=%d want 1", len(dmg))
			}
			sennaLEAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > sennaLETol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > sennaLETol {
				t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)",
					sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(sennaLEAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(sennaLEAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestSennaLastEmbraceFirstEnemyHitBonusADCounterproof: baseAD0/resolvedAD100
// versus baseAD60/resolvedAD160 at armor0 must both raw/final 320 — equal bonus AD.
func TestSennaLastEmbraceFirstEnemyHitBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100", 0, 100},
		{"baseAD60_resolvedAD160", 60, 160},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadSennaLEFixture(t, sennaLEFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: 0, mana: sennaLEFixtureManaCD,
			})
			assertSennaLEProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: sennaLEAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSennaLE(t, compileReq, runReq)
			dmg := sennaLEDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("W damage=%d want 1", len(dmg))
			}
			sennaLEAssertDamage(t, dmg[0], 320, 320)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > sennaLETol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > sennaLETol {
				t.Fatalf("ad.base=%v want %v", sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	totalAsIf := sennaLEBaseDamage + sennaLEBonusADRatio*160
	bonus := sennaLEExpectedRawFromAD(160, 60)
	if math.Abs(totalAsIf-bonus) < sennaLETol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestSennaLastEmbraceFirstEnemyHitCooldownMana210AbilityStarted: mana210/
// base60/resolved160/HP1000/armor100 at t0/t10999/t11000 →
// success/cooldown skip/success; final mana70/HP680; exactly two W damage
// items and two automatic W ability_started events.
func TestSennaLastEmbraceFirstEnemyHitCooldownMana210AbilityStarted(t *testing.T) {
	compileReq, runReq := loadSennaLEFixture(t, sennaLEFixtureOpts{
		baseAD: sennaLEADBaseDefault, resolvedAD: sennaLEADResolvedDefault,
		armor: sennaLETargetArmorDefault, mana: sennaLEFixtureManaCD, hp: sennaLETargetHP,
	})
	assertSennaLEProviderShape(t, compileReq, 1, true)
	ref := sennaLEAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10999},
		{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11000},
	}
	runReq.StopPolicy.DurationMs = 11100
	done := runSennaLE(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if sennaLESkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findSennaLEAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt10999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 10999 {
			t.Fatalf("cooldown skip TimeMs=%d want 10999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 11000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 11000", item.Data["readyAtMs"])
		}
		skipAt10999 = true
	}
	if !skipAt10999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=10999 with readyAtMs=11000")
	}

	items := sennaLEDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("W damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 11000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		sennaLEAssertDamage(t, item, sennaLEExpectedRawDefault, sennaLEExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * sennaLEExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-sennaLEHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, sennaLEHPAfter2)
	}
	gotMana := sennaLESourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-sennaLEManaAfter2) > sennaLETol {
		t.Fatalf("mana=%v want %v", gotMana, sennaLEManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := sennaLEAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic W; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 11000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-sennaLEADResolvedDefault) > sennaLETol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), sennaLEADResolvedDefault)
	}
	if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-sennaLEADBaseDefault) > sennaLETol {
		t.Fatalf("ad.base=%v want %v",
			sourceAttrBase(t, done.FinalSnapshot, "ad"), sennaLEADBaseDefault)
	}
}

// TestSennaLastEmbraceFirstEnemyHitResourceInsufficientMana69: mana69 at t0 →
// resource_insufficient; mana/HP unchanged; zero W damage/start evidence.
func TestSennaLastEmbraceFirstEnemyHitResourceInsufficientMana69(t *testing.T) {
	compileReq, runReq := loadSennaLEFixture(t, sennaLEFixtureOpts{
		baseAD: sennaLEADBaseDefault, resolvedAD: sennaLEADResolvedDefault,
		armor: sennaLETargetArmorDefault, mana: sennaLEFixtureManaShort, hp: sennaLETargetHP,
	})
	ref := sennaLEAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSennaLE(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if sennaLESkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(sennaLESourceMana(t, done.FinalSnapshot)-sennaLEFixtureManaShort) > sennaLETol {
		t.Fatalf("mana changed: got %v want %v",
			sennaLESourceMana(t, done.FinalSnapshot), sennaLEFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-sennaLETargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, sennaLETargetHP)
	}
	if len(sennaLEDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero W damage evidence")
	}
	if len(sennaLEAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestSennaLastEmbraceFirstEnemyHitStandaloneNoSiblingSynthesis: standalone W
// provider graph is the only mounted Senna provider; no P/Q/E/R/basic synthesis;
// no W state/modifier/listener/root/control/secondary-target structure beyond the
// fixture-only bonus-AD flat. Do not invent sibling graphs or cross-skill state.
func TestSennaLastEmbraceFirstEnemyHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadSennaLEFixture(t, sennaLEFixtureOpts{
		baseAD: sennaLEADBaseDefault, resolvedAD: sennaLEADResolvedDefault,
		armor: sennaLETargetArmorDefault, mana: sennaLEFixtureManaCD,
	})
	assertSennaLEProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_senna_last_embrace_unrelated_sentinel"
	sentinelStable := "fixture_senna_last_embrace_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != sennaLEProviderRef {
		t.Fatalf("source mounts=%+v want only W", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != sennaLEProviderRef {
			t.Fatalf("source snapshots=%+v want only W", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_senna_[pqer]_|ability_hero_senna_[pqer]_|` +
		`provider_hero_senna_basic_|ability_hero_senna_basic_|` +
		`(?i)attachment|root|aoe|projectile|secondary`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == sennaLEProviderRef || p.StableID == sennaLEStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic/excluded provider: %+v", p)
		}
		if p.ProviderKey != sennaLEProviderRef {
			continue
		}
		if len(p.Listeners) != 0 || len(p.InitialStateSchema) != 0 {
			t.Fatalf("W must not carry listener/state structures: listeners=%d state=%d",
				len(p.Listeners), len(p.InitialStateSchema))
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("W must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
			for _, op := range a.Operations {
				if op.Operation == "root" || op.Operation == "control" ||
					op.Operation == "aoe" || op.Operation == "projectile" ||
					op.Operation == "attach" || op.Operation == "attachment" ||
					op.Target == "secondary" {
					t.Fatalf("W must not carry root/control/secondary structures: %+v", op)
				}
			}
		}
	}

	ref := sennaLEAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSennaLE(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(sennaLEDamageEvidence(done)) != 1 {
		t.Fatalf("W damage=%d want 1", len(sennaLEDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone W must not synthesize extra damage")
	}
	if len(sennaLEAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic W ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
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
				if ps.ProviderRef == sennaLEProviderRef || ps.DefinitionRef == sennaLEProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic/excluded: %+v", ps)
			}
		}
	}
}

// TestSennaLastEmbraceFirstEnemyHitDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// post-release session_not_found.
func TestSennaLastEmbraceFirstEnemyHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadSennaLEFixture(t, sennaLEFixtureOpts{
				baseAD: sennaLEADBaseDefault, resolvedAD: sennaLEADResolvedDefault,
				armor: sennaLETargetArmorDefault, mana: sennaLEFixtureManaCD,
			})
			ref := sennaLEAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10999},
				{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11000},
			}
			r.StopPolicy.DurationMs = 11100
			done := runSennaLE(t, c, r)
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
		c, r := loadSennaLEFixture(t, sennaLEFixtureOpts{
			baseAD: sennaLEADBaseDefault, resolvedAD: sennaLEADResolvedDefault,
			armor: sennaLETargetArmorDefault, mana: sennaLEFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: sennaLEAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runSennaLEFrames(t, c, r)
		if len(sennaLEDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path W damage=%d want 1", len(sennaLEDamageEvidence(done)))
		}
		sennaLEAssertDamage(t, sennaLEDamageEvidence(done)[0],
			sennaLEExpectedRawDefault, sennaLEExpectedMitDefault)
		if len(sennaLEAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadSennaLEFixture(t, sennaLEFixtureOpts{
			baseAD: sennaLEADBaseDefault, resolvedAD: sennaLEADResolvedDefault,
			armor: sennaLETargetArmorDefault, mana: sennaLEFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: sennaLEAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
