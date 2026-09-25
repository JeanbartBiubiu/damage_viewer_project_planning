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

// hero_varus Q Piercing Arrow / 穿刺之箭 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: varus-q-piercing-arrow-max-charge-primary-first-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_max_charge_max_range_selected_primary_first_enemy_physical_hit; immediate_impact_scaffold;
//	physical_360_plus_1_20_bonus_ad; mana70_listed_cooldown12000ms_scaffold;
//	no_real_charge_channel_post_effect_cooldown_start_charge_duration_cooldown_reduction_pierce_
//	falloff_projectile_geometry_blight_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_varus|Q|穿刺之箭
//	task wasm-generic-varus-piercing-arrow-max-charge-primary-first-hit
//	Request Template:Data Varus/Q → resolved Template:Data Varus/Piercing Arrow
//	wikiPageId 1309981 / rev 4026469 / timestamp 2026-06-09T22:00:25Z
//	canonical rawByteSize 3888 / SHA256
//	  bdbbe064008b969e153800f7d5cdb305f84eca1ef043d8e6f8ce41c5db2659dd
//	数据参考/lol-wiki-current-champions/normalized/generic/varus-q.json
//	  local normalized 4131 bytes / SHA256
//	  bb5af7baaf053d1266a3702664c2df09e89f67c6125e8cf6da15f28f5b0c1f8e
//	pages/raw siblings: pages/varus-q.json (bytes 689 / SHA256
//	  85975963850f79395fbeec142049176aa945a3728bcecc55ca01a7863d849f61),
//	  raw/varus-q.wikitext
//	已删除历史种子（原跨工作树路径； Backend owning commit d493781):
//	  C:/project/damage_backend_dev/db/game_manage/seeds/
//	  lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed.sql
//	Local raw materialization caveat: 3888 bytes / SHA256
//	  5a350cecb53d37bd2640f7de3398c1be0a798a75f88c42eb327933920d487962.
//	Assert sidecar/pages canonical identity + local/canonical caveat; do not claim
//	local-raw equivalence or source contradiction (同 size 不等于等价).
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit
//     (standalone; not W Blighted Quiver / W Q-carrier / E / R / basic reuse)
//   - ability ability_hero_varus_q_piercing_arrow_max_charge_primary_first_hit with
//     ability_key piercing_arrow_max_charge_primary_first_hit: active; mana 70;
//     listed cooldown scaffold 12000 ms
//   - Exactly one immediate selected-primary / first-enemy physical damage op:
//     add(const 360, mul(const 1.20, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base)))
//     (bonus AD; each AD path exactly once; no AP/crit reads)
//   - CritEligible=false, CopyableOnHit=false; Types empty (no ability/basic_attack)
//   - 当前通用构造样例使用 damage/physical；不核对历史目录编码
//   - No Q state/modifier/listener/matcher/repeat/tick/control/scheduler/explicit
//     event/Q-specific type — successful cast relies on runtime automatic
//     ability_started. Fixture-only flat AD modifier may set resolved AD and is
//     clearly test-only.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   real charge/channel/range-growth/cancel/refund/recast/movement slow/cast
//   restrictions; post-effect cooldown start / charge-duration cooldown
//   reduction/haste fidelity; projectile/travel/collision/geometry/pierce
//   falloff/multi-target; W active/passive/Blight/missing-health/detonation/
//   reset/cooldown refund/full Q+W integration; cosmetic/actual crit; other
//   ranks/siblings/items/full fidelity; live/publish/push/Web/assets/E2E.
//   One max-charge max-range selected-primary first-enemy physical hit, not full Q.
//
// Ordered governed tags (exactly; do not substitute immediate_impact_scaffold
// as a governed tag — that phrase remains boundary-only):
//   ability_cost_cooldown, active_physical_damage, bonus_ad_ratio,
//   max_charge_max_range_selected_primary_first_hit_scaffold
//
// Governance identity: this hero-named `_test.go` is regression/governance evidence
// only. It is excluded from production Wasm builds and must construct the existing
// canonical generic ABI. Production runtime remains generic (no if hero_varus /
// production hero switch). Reuse same-package Varus W helpers where safe; do not
// modify the W test.

const (
	varusPAPCandidateKey    = "hero_skill|hero_varus|Q|穿刺之箭"
	varusPAPTaskKey         = "wasm-generic-varus-piercing-arrow-max-charge-primary-first-hit"
	varusPAPPlanRev         = "varus-q-piercing-arrow-max-charge-primary-first-hit-phase-a-v1"
	varusPAPRequestTitle    = "Template:Data Varus/Q"
	varusPAPResolvedTitle   = "Template:Data Varus/Piercing Arrow"
	varusPAPWikiPageID      = 1309981
	varusPAPRevisionID      = 4026469
	varusPAPTimestamp       = "2026-06-09T22:00:25Z"
	varusPAPRawBytes        = 3888
	varusPAPLocalRawBytes   = 3888
	varusPAPNormalizedBytes = 4131
	varusPAPPagesBytes      = 689
	varusPAPContentSHA      = "bdbbe064008b969e153800f7d5cdb305f84eca1ef043d8e6f8ce41c5db2659dd"
	varusPAPLocalRawSHA     = "5a350cecb53d37bd2640f7de3398c1be0a798a75f88c42eb327933920d487962"
	varusPAPNormalizedSHA   = "bb5af7baaf053d1266a3702664c2df09e89f67c6125e8cf6da15f28f5b0c1f8e"
	varusPAPPagesSHA        = "85975963850f79395fbeec142049176aa945a3728bcecc55ca01a7863d849f61"
	varusPAPBoundary        = "rank5_max_charge_max_range_selected_primary_first_enemy_physical_hit; immediate_impact_scaffold; " +
		"physical_360_plus_1_20_bonus_ad; mana70_listed_cooldown12000ms_scaffold; " +
		"no_real_charge_channel_post_effect_cooldown_start_charge_duration_cooldown_reduction_pierce_" +
		"falloff_projectile_geometry_blight_or_full_fidelity"

	varusPAPProviderRef = "provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit"
	varusPAPStableID    = "hero_varus_q_piercing_arrow_max_charge_primary_first_hit"
	varusPAPAbilityID   = "ability_hero_varus_q_piercing_arrow_max_charge_primary_first_hit"
	varusPAPAbilityKey  = "piercing_arrow_max_charge_primary_first_hit"
	varusPAPDamageOpRef = "op:varus_piercing_arrow_max_charge_primary_first_hit_damage"
	varusPAPBonusADMod  = "fixture_varus_piercing_arrow_max_charge_primary_first_hit_bonus_ad"

	varusPAPBaseDamage   = 360.0
	varusPAPBonusADRatio = 1.20
	varusPAPManaCost     = 70.0
	varusPAPCDMs         = 12000.0

	varusPAPADBaseDefault     = 60.0
	varusPAPADResolvedDefault = 160.0
	varusPAPFixtureManaCD     = 210.0
	varusPAPFixtureManaShort  = 69.0
	varusPAPTargetArmor       = 100.0
	varusPAPTargetHP          = 1000.0

	// Default CD fixture: bonusAD=100 → raw 480; armor100 → mitigated 240.
	varusPAPExpectedRawDefault = 480.0
	varusPAPExpectedMitDefault = 240.0
	varusPAPManaAfter2         = 70.0  // 210 - 70 - 70
	varusPAPHPAfter2           = 520.0 // 1000 - 240 - 240

	// Zero-bonus baseline: base60/resolved60/armor0 → raw/final 360.
	varusPAPExpectedRawBaseline = 360.0

	varusPAPTol = 1e-9
)

func varusPAPOrderedTags() []string {
	return []string{
		"ability_cost_cooldown",
		"active_physical_damage",
		"bonus_ad_ratio",
		"max_charge_max_range_selected_primary_first_hit_scaffold",
	}
}

func varusPAPExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return varusPAPBaseDamage + varusPAPBonusADRatio*(resolvedAD-baseAD)
}

func varusPAPDamageAmount() *model.GenericFormulaExpr {
	base := varusPAPBaseDamage
	ratio := varusPAPBonusADRatio
	// Exact nested binary AST:
	// add(const360, mul(const1.20, sub(read ad.resolved, read ad.base)))
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

func varusPAPCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += varusPAPCountPathReads(&expr.Args[i], path)
	}
	return n
}

func varusPAPAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		varusPAPAssertBinaryArity(t, &expr.Args[i])
	}
}

func varusPAPAbility() model.AbilityDefinition {
	cost := varusPAPManaCost
	cd := varusPAPCDMs
	return model.AbilityDefinition{
		AbilityKey: varusPAPAbilityKey,
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
				Ref:           varusPAPDamageOpRef,
				Amount:        varusPAPDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func varusPAPProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: varusPAPProviderRef,
		Kind:        "champion",
		StableID:    varusPAPStableID,
		Abilities:   []model.AbilityDefinition{varusPAPAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: varusPAPBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func varusPAPAbilityRef() string {
	return "source.provider[" + varusPAPProviderRef + "].ability[" + varusPAPAbilityKey + "]"
}

type varusPAPFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
	ap         float64
	critChance float64
	critDamage float64
	withW      bool
	qBonusMod  bool // when withW, optionally still attach Q fixture AD mod
}

func configureVarusPAPProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts varusPAPFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	if opts.withW && !opts.qBonusMod {
		// Combined fixture: reuse W fixture AD modifier; Q provider stays modifier-free.
		bonus = 0
	}
	providers := []model.ProviderDefinition{varusPAPProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: varusPAPProviderRef, DefinitionRef: varusPAPProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: varusPAPProviderRef, DefinitionRef: varusPAPProviderRef,
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

func ensureVarusPAPTypes(req *model.CompileRequest) {
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

func loadVarusPAPFixture(t *testing.T, opts varusPAPFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.mana == 0 {
		opts.mana = varusPAPFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = varusPAPTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureVarusPAPTypes(&compileReq)
	configureVarusPAPProvider(&compileReq, &runReq, opts)

	if opts.withW {
		ensureVarusBQTypes(&compileReq)
		mountVarusBQProvider(&compileReq, &runReq)
		// Match existing W fixture AD base/resolved when co-mounted without Q bonus mod.
		if !opts.qBonusMod {
			bonusAD := opts.resolvedAD - opts.baseAD
			if bonusAD != 0 {
				for i := range compileReq.SharedProviders {
					if compileReq.SharedProviders[i].ProviderKey != varusBQProviderRef {
						continue
					}
					compileReq.SharedProviders[i].Modifiers = append(
						compileReq.SharedProviders[i].Modifiers,
						model.ModifierDefinition{
							ModifierKey: varusBQBonusADModKey,
							Kind:        "attribute",
							Target:      "ad",
							ValuePolicy: "add",
							Value:       gfConst(bonusAD),
						},
					)
				}
			}
		}
	}

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.ap, Current: opts.ap, Max: opts.ap, Resolved: opts.ap,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: opts.critChance, Current: opts.critChance,
		Max: opts.critChance, Resolved: opts.critChance,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_damage", model.AttributeSlotDef{
		Base: opts.critDamage, Current: opts.critDamage,
		Max: opts.critDamage, Resolved: opts.critDamage,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, varusPAPFixtureManaCD),
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

func runVarusPAP(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runVarusPAPFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func varusPAPSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func varusPAPSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func varusPAPDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := varusPAPAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != varusPAPDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func varusPAPAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func varusPAPFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == varusPAPProviderRef {
			return p
		}
	}
	return nil
}

func assertVarusPAPProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := varusPAPFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit missing from SharedProviders")
	}
	if p.ProviderKey != varusPAPProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, varusPAPProviderRef)
	}
	if p.StableID != varusPAPStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, varusPAPStableID)
	}
	if p.ProviderKey == varusBQProviderRef || p.StableID == varusBQStableID ||
		p.ProviderKey == varusBQStableID || p.StableID == varusBQProviderRef {
		t.Fatal("piercing_arrow primary-first-hit must not reuse Varus Blighted Quiver provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / matcher / on-hit)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no Q state)", len(p.InitialStateSchema))
	}
	if expectBonusMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != varusPAPBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], varusPAPBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (production/seed Q has zero modifiers)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), varusPAPAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != varusPAPAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, varusPAPAbilityKey, varusPAPAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("piercing_arrow_max_charge_primary_first_hit must not be tagged ability/basic_attack")
		}
		if strings.Contains(typ, "varus") || strings.Contains(typ, "piercing") ||
			strings.HasPrefix(typ, "62") {
			t.Fatalf("Q must not carry Q-specific type %q", typ)
		}
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
		math.Abs(*a.Cost.Amount.Value-varusPAPManaCost) > varusPAPTol {
		t.Fatalf("cost=%+v want mana const 70", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-varusPAPCDMs) > varusPAPTol {
		t.Fatalf("cooldown=%+v want const 12000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("piercing arrow damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("piercing arrow damage must not be copyable on hit")
	}
	if op.Ref != varusPAPDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, varusPAPDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const360, mul(1.20, sub(ad.resolved, ad.base)))", op.Amount)
	}
	varusPAPAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-varusPAPBaseDamage) > varusPAPTol {
		t.Fatalf("base const=%+v want 360", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-varusPAPBonusADRatio) > varusPAPTol {
		t.Fatalf("bonus AD ratio=%+v want 1.20", mul.Args[0])
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
	if varusPAPCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", varusPAPCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if varusPAPCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", varusPAPCountPathReads(op.Amount, "source.attr.ad.base"))
	}
	for _, banned := range []string{
		"source.attr.ap.resolved", "source.attr.ap.base",
		"source.attr.crit_chance.resolved", "source.attr.crit_damage.resolved",
	} {
		if varusPAPCountPathReads(op.Amount, banned) != 0 {
			t.Fatalf("formula must not read forbidden path %q", banned)
		}
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "projectile" ||
			bannedOp.Operation == "multi_target" || bannedOp.Operation == "state_change" ||
			bannedOp.Operation == "repeat" || bannedOp.Operation == "control" ||
			bannedOp.Operation == "channel" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "scheduler" || bannedOp.Operation == "matcher" ||
			bannedOp.DamageType == "damage/magic" {
			t.Fatalf("piercing arrow must not include excluded op: %+v", bannedOp)
		}
	}
}

func findVarusPAPAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := varusPAPAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func varusPAPWasmRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing wasm path %s: %v (fail closed)", path, err)
	}
	return path
}

func varusPAPSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func varusPAPAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > varusPAPTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > varusPAPTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != varusPAPDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), varusPAPDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != varusPAPAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), varusPAPAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != varusPAPProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), varusPAPProviderRef)
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
}

// TestVarusPiercingArrowMaxChargePrimaryFirstHitWikiSourceAndConstructedFixtureShape 核对历史 Wiki 来源与当前通用运行构造样例的数值、身份和边界；不代表现行管理数据。
func TestVarusPiercingArrowMaxChargePrimaryFirstHitWikiSourceAndConstructedFixtureShape(t *testing.T) {
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
	sidecarRaw, err := os.ReadFile(varusPAPWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "varus-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != varusPAPNormalizedBytes {
		t.Fatalf("normalized len=%d want %d", len(sidecarRaw), varusPAPNormalizedBytes)
	}
	if got := varusPAPSHA256Hex(sidecarRaw); got != varusPAPNormalizedSHA {
		t.Fatalf("normalized sha=%q want %q", got, varusPAPNormalizedSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != varusPAPCandidateKey || doc.RequestTitle != varusPAPRequestTitle ||
		doc.ResolvedTitle != varusPAPResolvedTitle || doc.WikiPageID != varusPAPWikiPageID ||
		doc.RevisionID != varusPAPRevisionID || doc.RevisionTimestamp != varusPAPTimestamp ||
		doc.ContentSHA256 != varusPAPContentSHA || doc.RawByteSize != varusPAPRawBytes ||
		doc.SkillKey != "Q" || doc.ZhDisplayName != "穿刺之箭" || doc.OwnerID != "hero_varus" {
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
	if doc.Fields.Cost != "{{ap|50 to 70}}\n" || doc.Fields.Costtype != "mana\n" ||
		doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("cost/type/damage=%q/%q/%q", doc.Fields.Cost, doc.Fields.Costtype, doc.Fields.Damagetype)
	}
	if !strings.Contains(doc.Fields.Cooldown, "{{ap|16 to 12}}") {
		t.Fatalf("cooldown=%q want rank table ending in 12s", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Description3, "{{as|physical damage}}") {
		t.Fatal("wiki prose must retain physical damage wording")
	}
	if !strings.Contains(doc.Fields.Leveling3, "Maximum Physical Damage") ||
		!strings.Contains(doc.Fields.Leveling3, "{{ap|80 to 360}}") ||
		!strings.Contains(doc.Fields.Leveling3, "120% '''bonus''' AD") {
		t.Fatalf("leveling3=%q", doc.Fields.Leveling3)
	}
	joined := doc.Fields.Description + doc.Fields.Description2 + doc.Fields.Description3 + doc.Fields.Notes
	for _, excl := range []string{
		"charges", "slowed", "recast", "refund", "Blight", "reduced by",
		"channel", "missile",
	} {
		if !strings.Contains(joined, excl) {
			t.Fatalf("wiki must retain excluded surface %q for bounded-exclusion disclosure", excl)
		}
	}

	pagesRaw, err := os.ReadFile(varusPAPWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "varus-q.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(pagesRaw) != varusPAPPagesBytes {
		t.Fatalf("pages len=%d want %d", len(pagesRaw), varusPAPPagesBytes)
	}
	if got := varusPAPSHA256Hex(pagesRaw); got != varusPAPPagesSHA {
		t.Fatalf("pages sha=%q want %q", got, varusPAPPagesSHA)
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
		pages.SkillKey != "Q" || pages.ZhDisplayName != "穿刺之箭" || pages.OwnerID != "hero_varus" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(varusPAPWasmRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "varus-q.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != varusPAPLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), varusPAPLocalRawBytes)
	}
	localSHA := varusPAPSHA256Hex(rawBytes)
	if localSHA != varusPAPLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, varusPAPLocalRawSHA)
	}
	if localSHA == varusPAPContentSHA {
		t.Fatal("local raw hash must differ from canonical (local/canonical caveat; not equivalence/contradiction)")
	}

	if varusPAPPlanRev != "varus-q-piercing-arrow-max-charge-primary-first-hit-phase-a-v1" ||
		varusPAPBoundary !=
			"rank5_max_charge_max_range_selected_primary_first_enemy_physical_hit; immediate_impact_scaffold; "+
				"physical_360_plus_1_20_bonus_ad; mana70_listed_cooldown12000ms_scaffold; "+
				"no_real_charge_channel_post_effect_cooldown_start_charge_duration_cooldown_reduction_pierce_"+
				"falloff_projectile_geometry_blight_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}
	tags := varusPAPOrderedTags()
	if len(tags) != 4 ||
		tags[0] != "ability_cost_cooldown" ||
		tags[1] != "active_physical_damage" ||
		tags[2] != "bonus_ad_ratio" ||
		tags[3] != "max_charge_max_range_selected_primary_first_hit_scaffold" {
		t.Fatalf("ordered governed tags drifted: %+v", tags)
	}
	for _, tag := range tags {
		if tag == "immediate_impact_scaffold" {
			t.Fatal("must not substitute immediate_impact_scaffold as a governed tag")
		}
	}

	// 退役种子、后端旧检查与旧说明字节已归入历史证据；此处核对通用构造样例。

	compileReq, _ := loadVarusPAPFixture(t, varusPAPFixtureOpts{
		baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
		armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD,
	})
	assertVarusPAPProviderShape(t, compileReq, 1, true)
	if varusPAPProviderRef == varusBQProviderRef ||
		varusPAPStableID == varusBQStableID ||
		varusPAPAbilityKey == varusBQCarrierAbilityKey ||
		varusPAPAbilityKey == varusBQActiveAbilityKey ||
		varusPAPDamageOpRef == varusBQCarrierQOpRef {
		t.Fatal("standalone Q IDs must remain distinct from W provider/carrier")
	}
	rawX := varusPAPExpectedRawFromAD(varusPAPADResolvedDefault, varusPAPADBaseDefault)
	if math.Abs(rawX-varusPAPExpectedRawDefault) > varusPAPTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, varusPAPExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, varusPAPTargetArmor)
	if math.Abs(mitX-varusPAPExpectedMitDefault) > varusPAPTol {
		t.Fatalf("default mit=%v want %v", mitX, varusPAPExpectedMitDefault)
	}
}

// TestVarusPiercingArrowMaxChargePrimaryFirstHitDamageMatrix: base60/resolved60/armor0
// => raw/final360; base60/resolved160/armor100 => raw480/final240; unrelated
// AP/crit/crit_damage variation leaves Q unchanged.
func TestVarusPiercingArrowMaxChargePrimaryFirstHitDamageMatrix(t *testing.T) {
	t.Run("base60_resolved60_armor0", func(t *testing.T) {
		compileReq, runReq := loadVarusPAPFixture(t, varusPAPFixtureOpts{
			baseAD: 60, resolvedAD: 60, armor: 0, mana: varusPAPFixtureManaCD,
		})
		assertVarusPAPProviderShape(t, compileReq, 1, false)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: varusPAPAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runVarusPAP(t, compileReq, runReq)
		dmg := varusPAPDamageEvidence(done)
		if len(dmg) != 1 {
			t.Fatalf("Q damage=%d want 1", len(dmg))
		}
		varusPAPAssertDamage(t, dmg[0], varusPAPExpectedRawBaseline, varusPAPExpectedRawBaseline)
		if math.Abs(done.Summary.TargetFinalHp-(varusPAPTargetHP-varusPAPExpectedRawBaseline)) > 1e-6 {
			t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, varusPAPTargetHP-varusPAPExpectedRawBaseline)
		}
	})

	t.Run("base60_resolved160_armor100", func(t *testing.T) {
		compileReq, runReq := loadVarusPAPFixture(t, varusPAPFixtureOpts{
			baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
			armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD,
		})
		assertVarusPAPProviderShape(t, compileReq, 1, true)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: varusPAPAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runVarusPAP(t, compileReq, runReq)
		dmg := varusPAPDamageEvidence(done)
		if len(dmg) != 1 {
			t.Fatalf("Q damage=%d want 1", len(dmg))
		}
		varusPAPAssertDamage(t, dmg[0], varusPAPExpectedRawDefault, varusPAPExpectedMitDefault)
		if math.Abs(done.Summary.TargetFinalHp-(varusPAPTargetHP-varusPAPExpectedMitDefault)) > 1e-6 {
			t.Fatalf("targetFinalHp=%v want %v",
				done.Summary.TargetFinalHp, varusPAPTargetHP-varusPAPExpectedMitDefault)
		}
	})

	t.Run("unrelated_ap_crit_variation_unchanged", func(t *testing.T) {
		cases := []struct {
			name                 string
			ap, critChance, crit float64
		}{
			{"ap0_crit0", 0, 0, 1},
			{"ap250_crit025_damage23", 250, 0.25, 2.3},
			{"ap999_crit1_damage3", 999, 1, 3},
		}
		var baselineRaw, baselineMit float64
		for i, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				compileReq, runReq := loadVarusPAPFixture(t, varusPAPFixtureOpts{
					baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
					armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD,
					ap: tc.ap, critChance: tc.critChance, critDamage: tc.crit,
				})
				runReq.DriverPlan.Entries = []model.DriverEntry{
					{EntryKey: "q0", AbilityRef: varusPAPAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
				}
				runReq.StopPolicy.DurationMs = 50
				done := runVarusPAP(t, compileReq, runReq)
				dmg := varusPAPDamageEvidence(done)
				if len(dmg) != 1 {
					t.Fatalf("Q damage=%d want 1", len(dmg))
				}
				raw := evidenceDataFloat(dmg[0].Data, "rawAmount")
				mit := evidenceDataFloat(dmg[0].Data, "mitigatedAmount")
				if i == 0 {
					baselineRaw, baselineMit = raw, mit
				}
				if math.Abs(raw-varusPAPExpectedRawDefault) > varusPAPTol ||
					math.Abs(mit-varusPAPExpectedMitDefault) > varusPAPTol {
					t.Fatalf("raw/mit=%v/%v want %v/%v", raw, mit, varusPAPExpectedRawDefault, varusPAPExpectedMitDefault)
				}
				if math.Abs(raw-baselineRaw) > varusPAPTol || math.Abs(mit-baselineMit) > varusPAPTol {
					t.Fatalf("AP/crit variation altered Q: baseline=%v/%v got=%v/%v",
						baselineRaw, baselineMit, raw, mit)
				}
				if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.ap) > varusPAPTol {
					t.Fatalf("ap.resolved=%v want probe %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.ap)
				}
			})
		}
	})
}

// TestVarusPiercingArrowMaxChargePrimaryFirstHitCooldownMana210AbilityStarted:
// mana210/HP1000/armor100 at t0/t11999/t12000 => success/skip/success; exactly
// two Q damage quanta and two automatic Q ability_started; final mana70/HP520.
func TestVarusPiercingArrowMaxChargePrimaryFirstHitCooldownMana210AbilityStarted(t *testing.T) {
	compileReq, runReq := loadVarusPAPFixture(t, varusPAPFixtureOpts{
		baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
		armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD, hp: varusPAPTargetHP,
	})
	assertVarusPAPProviderShape(t, compileReq, 1, true)
	ref := varusPAPAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 12000},
	}
	runReq.StopPolicy.DurationMs = 12100
	done := runVarusPAP(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if varusPAPSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findVarusPAPAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt11999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 11999 {
			t.Fatalf("cooldown skip TimeMs=%d want 11999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 12000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 12000", item.Data["readyAtMs"])
		}
		skipAt11999 = true
	}
	if !skipAt11999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=11999 with readyAtMs=12000")
	}

	items := varusPAPDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 12000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		varusPAPAssertDamage(t, item, varusPAPExpectedRawDefault, varusPAPExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * varusPAPExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-varusPAPHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, varusPAPHPAfter2)
	}
	gotMana := varusPAPSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-varusPAPManaAfter2) > varusPAPTol {
		t.Fatalf("mana=%v want %v", gotMana, varusPAPManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := varusPAPAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 12000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
}

// TestVarusPiercingArrowMaxChargePrimaryFirstHitResourceInsufficientMana69:
// mana69 at t0 → resource_insufficient; mana/HP and Q event counts unchanged.
func TestVarusPiercingArrowMaxChargePrimaryFirstHitResourceInsufficientMana69(t *testing.T) {
	compileReq, runReq := loadVarusPAPFixture(t, varusPAPFixtureOpts{
		baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
		armor: varusPAPTargetArmor, mana: varusPAPFixtureManaShort, hp: varusPAPTargetHP,
	})
	ref := varusPAPAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runVarusPAP(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if varusPAPSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(varusPAPSourceMana(t, done.FinalSnapshot)-varusPAPFixtureManaShort) > varusPAPTol {
		t.Fatalf("mana changed: got %v want %v",
			varusPAPSourceMana(t, done.FinalSnapshot), varusPAPFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-varusPAPTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, varusPAPTargetHP)
	}
	if len(varusPAPDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(varusPAPAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
	if varusPAPSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 0 {
		t.Fatal("resource skip must not start cooldown")
	}
}

// TestVarusPiercingArrowMaxChargePrimaryFirstHitWCoexistence: both providers
// mount/compile together; standalone Q cast emits only its Q quantum and leaves
// W state untouched; existing W carrier remains independently callable.
func TestVarusPiercingArrowMaxChargePrimaryFirstHitWCoexistence(t *testing.T) {
	t.Run("mount_compile_together", func(t *testing.T) {
		compileReq, _ := loadVarusPAPFixture(t, varusPAPFixtureOpts{
			baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
			armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD, withW: true,
		})
		assertVarusPAPProviderShape(t, compileReq, 2, false)
		w := varusBQFindProvider(compileReq)
		if w == nil {
			t.Fatal("combined fixture must include provider_hero_varus_w_blighted_quiver_phase_a")
		}
		if w.ProviderKey != varusBQProviderRef || w.StableID != varusBQStableID {
			t.Fatalf("W provider drifted: %+v", w)
		}
		foundCarrier := false
		for _, a := range w.Abilities {
			if a.AbilityKey == varusBQCarrierAbilityKey {
				foundCarrier = true
			}
		}
		if !foundCarrier {
			t.Fatal("W carrier key blighted_quiver_q_max_charge_carrier must remain present")
		}
		if varusPAPProviderRef == varusBQProviderRef ||
			varusPAPAbilityKey == varusBQCarrierAbilityKey ||
			varusPAPDamageOpRef == varusBQCarrierQOpRef {
			t.Fatal("Q and W refs must remain distinct")
		}
		result := compile.CompileGeneric(compileReq)
		if !result.OK {
			t.Fatalf("combined Q+W compile failed: %+v", result.Result.Errors)
		}
	})

	t.Run("q_cast_leaves_w_untouched", func(t *testing.T) {
		compileReq, runReq := loadVarusPAPFixture(t, varusPAPFixtureOpts{
			baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
			armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD, withW: true,
		})
		assertVarusPAPProviderShape(t, compileReq, 2, false)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: varusPAPAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runVarusPAP(t, compileReq, runReq)

		if len(varusPAPDamageEvidence(done)) != 1 {
			t.Fatalf("Q damage=%d want 1", len(varusPAPDamageEvidence(done)))
		}
		varusPAPAssertDamage(t, varusPAPDamageEvidence(done)[0],
			varusPAPExpectedRawDefault, varusPAPExpectedMitDefault)
		if n, _, _, _ := varusBQDamageByOp(done, varusBQCarrierQOpRef); n != 0 {
			t.Fatal("standalone Q cast must not emit W carrier Q physical")
		}
		if n, _, _, _ := varusBQDamageByOp(done, varusBQOnHitOpRef); n != 0 {
			t.Fatal("standalone Q cast must not emit W on-hit")
		}
		if n, _, _, _ := varusBQDamageByOp(done, varusBQCarrierActiveOpRef); n != 0 {
			t.Fatal("standalone Q cast must not emit W active missing-HP")
		}
		if n, _, _, _ := varusBQDamageByOp(done, varusBQCarrierBlightOpRef); n != 0 {
			t.Fatal("standalone Q cast must not emit W blight detonate")
		}
		// W never wrote state during the Q-only cast — missing/empty bag counts as untouched.
		for _, c := range done.FinalSnapshot.Combatants {
			if c.Key != model.SelectorSource {
				continue
			}
			if bag, ok := c.ProviderState[varusBQProviderRef].(map[string]interface{}); ok {
				if ts, ok := bag["targetState"].(map[string]interface{}); ok {
					if values, ok := ts["values"].(map[string]interface{}); ok {
						if v, _ := values[varusBQBlightKey].(float64); v != 0 {
							t.Fatalf("blight_stacks=%v want 0 (W untouched)", v)
						}
					}
				}
				if state, ok := bag["state"].(map[string]interface{}); ok {
					if v, _ := state[varusBQActiveKey].(float64); v != 0 {
						t.Fatalf("blighted_quiver_active=%v want 0 (W untouched)", v)
					}
				}
			}
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("Q-only cast on combined fixture must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (Q only)", countEmittedEvents(done, "event/ability_started"))
		}
	})

	t.Run("w_carrier_independently_callable", func(t *testing.T) {
		compileReq, runReq := loadVarusPAPFixture(t, varusPAPFixtureOpts{
			baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
			armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD, withW: true,
			hp: varusBQDefaultHP,
		})
		assertVarusPAPProviderShape(t, compileReq, 2, false)
		if varusBQFindProvider(compileReq) == nil {
			t.Fatal("combined fixture must keep W independently callable")
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{{
			EntryKey: "carrier", AbilityRef: varusBQCarrierRef(),
			Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
		}}
		runReq.StopPolicy.DurationMs = 50
		done := runVarusPAP(t, compileReq, runReq)

		wantRaw := varusBQExpectedCarrierQRaw(varusPAPADResolvedDefault, varusPAPADBaseDefault)
		wantMit := expectedMitigatedPhysical(wantRaw, varusPAPTargetArmor)
		n, raw, mit, _ := varusBQDamageByOp(done, varusBQCarrierQOpRef)
		if n != 1 || math.Abs(raw-wantRaw) > varusPAPTol || math.Abs(mit-wantMit) > varusPAPTol {
			t.Fatalf("W carrier Q physical n/raw/mit=%d/%v/%v want 1/%v/%v", n, raw, mit, wantRaw, wantMit)
		}
		if len(varusPAPDamageEvidence(done)) != 0 {
			t.Fatal("W carrier cast must not emit standalone Q damage evidence")
		}
		if nA, _, _, _ := varusBQDamageByOp(done, varusBQCarrierActiveOpRef); nA != 0 {
			t.Fatalf("active damage=%d want 0 without arm", nA)
		}
		if nB, _, _, _ := varusBQDamageByOp(done, varusBQCarrierBlightOpRef); nB != 0 {
			t.Fatalf("blight damage=%d want 0 without stacks", nB)
		}
	})
}

// TestVarusPiercingArrowMaxChargePrimaryFirstHitDeterminismAndLifecycle: repeated
// compile/run stability plus CompileFrame→RunFrame→ReleaseSessionFrame.
func TestVarusPiercingArrowMaxChargePrimaryFirstHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string) {
			c, r := loadVarusPAPFixture(t, varusPAPFixtureOpts{
				baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
				armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD,
			})
			ref := varusPAPAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 12000},
			}
			r.StopPolicy.DurationMs = 12100
			done := runVarusPAP(t, c, r)
			sum, err := json.Marshal(done.Summary)
			if err != nil {
				t.Fatal(err)
			}
			ev, err := json.Marshal(done.Evidence)
			if err != nil {
				t.Fatal(err)
			}
			return string(sum), string(ev)
		}
		s1, e1 := runOnce()
		s2, e2 := runOnce()
		if s1 != s2 || e1 != e2 {
			t.Fatal("repeated compile/run evidence must be deterministic")
		}
	})

	t.Run("frame_lifecycle", func(t *testing.T) {
		compileReq, runReq := loadVarusPAPFixture(t, varusPAPFixtureOpts{
			baseAD: varusPAPADBaseDefault, resolvedAD: varusPAPADResolvedDefault,
			armor: varusPAPTargetArmor, mana: varusPAPFixtureManaCD,
		})
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: varusPAPAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runVarusPAPFrames(t, compileReq, runReq)
		if len(varusPAPDamageEvidence(done)) != 1 {
			t.Fatal("frame-path want one Q damage quantum")
		}
		if len(varusPAPAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})
}

// TestVarusPiercingArrowMaxChargePrimaryFirstHitGovernanceExclusionsAndNonclaims:
// prove hero-named `_test.go` status, production generic source scan, no hero
// switch, and explicit exclusions/nonclaims remain locked.
func TestVarusPiercingArrowMaxChargePrimaryFirstHitGovernanceExclusionsAndNonclaims(t *testing.T) {
	// 保留生产源码扫描；工作树独占限制属于历史执行现场。
	err := filepath.Walk(filepath.Join(".."), func(path string, info os.FileInfo, err error) error {
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
			`case "hero_varus"`,
			`case "varus"`,
			`if hero_varus`,
			`piercing_arrow_max_charge_primary_first_hit`,
			`provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit`,
		} {
			if strings.Contains(body, frag) {
				t.Fatalf("production source %s contains hero-switch/Q-graph fragment %q", rel, frag)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	self := "generic_varus_piercing_arrow_max_charge_primary_first_hit_test.go"
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
	if !strings.Contains(body, "FROZEN_PLAN_REV: varus-q-piercing-arrow-max-charge-primary-first-hit-phase-a-v1") {
		t.Fatal("evidence file missing frozen plan marker")
	}
	if !strings.Contains(body, varusPAPTaskKey) {
		t.Fatal("evidence file missing task key")
	}
	if !strings.Contains(body, "hero-named `_test.go` is regression/governance evidence") {
		t.Fatal("evidence file must declare hero-named _test.go governance status")
	}
	if !strings.Contains(body, "Production runtime remains generic") {
		t.Fatal("evidence file must declare production runtime remains generic")
	}
	for _, claim := range []string{
		"local/canonical caveat",
		"no explicit event op",
		"do not substitute immediate_impact_scaffold as a governed tag",
		"max_charge_max_range_selected_primary_first_hit_scaffold",
		"blighted_quiver_q_max_charge_carrier",
		"provider_hero_varus_w_blighted_quiver_phase_a",
	} {
		if !strings.Contains(body, claim) {
			t.Fatalf("evidence file missing exclusion/nonclaim framing %q", claim)
		}
	}
	if !strings.Contains(body, "Explicit exclusions") {
		t.Fatal("evidence file missing Explicit exclusions section")
	}
	if strings.Count(body, "immediate_impact_scaffold") < 1 {
		t.Fatal("boundary may retain immediate_impact_scaffold phrasing")
	}
	if !strings.Contains(body, "One max-charge max-range selected-primary first-enemy physical hit") {
		t.Fatal("evidence must keep bounded quantum nonclaim")
	}
}
