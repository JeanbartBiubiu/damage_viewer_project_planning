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

// hero_draven R Whirling Death / 冷血追命 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: draven-r-whirling-death-primary-outbound-hit-phase-a-v2).
//
// Frozen boundary:
//
//	rank3_selected_primary_champion_single_first_outbound_pass_hit; immediate_impact_scaffold;
//	physical_400_plus_1_50_bonus_ad; no_cast_time_direction_projectile_travel_collision_sight_
//	recast_reversal_return_homing_second_pass_execute_adoration_threshold_multitarget_damage_
//	falloff_reset_map_edge_once_per_pass_geometry_or_full_fidelity
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_draven|R|冷血追命
//	Request Template:Data Draven/R → resolved Template:Data Draven/Whirling Death
//	wikiPageId 1307072 / rev 4040576 / timestamp 2026-07-06T14:27:37Z
//	canonical rawByteSize 3079 / SHA256
//	  e38551b6eeefa0306cd40a3e15473c8983075f88edbe007915e3d9213a08adce
//	数据参考/lol-wiki-current-champions/normalized/generic/draven-r.json
//	  local normalized 3361 bytes / SHA256
//	  74e8f95ca03c86a5c809255d6309e4639e949337f4f36ee4fcfd4e8403416754
//	pages/raw siblings: pages/draven-r.json, raw/draven-r.wikitext
//	Local raw materialization caveat: 3079 bytes / SHA256
//	  1110179b1771c03c8ff67b428d6fa7a5b0ba42caf19e241ce512a199ef812059.
//	Same size / different hash is a serialization caveat only; assert both pinned
//	identities without claiming equality or contradiction.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_draven_r_whirling_death_primary_outbound_hit
//     (standalone; not Q/W/E/P/basic reuse)
//   - ability ability_hero_draven_r_whirling_death_primary_outbound_hit with ability_key
//     whirling_death_primary_outbound_hit: active; mana 100; cooldown 80000 ms
//   - Exactly one immediate selected-primary-champion physical damage op:
//     add(const 400, mul(const 1.50, sub(read source.attr.ad.resolved,
//         read source.attr.ad.base)))
//   - CritEligible=false, CopyableOnHit=false; Types empty (no ability/basic/on-hit)
//   - No listener/state/tick/repeat/explicit-event/control/projectile/geometry/
//     multitarget; successful cast relies on runtime automatic ability_started.
//     Fixture may attach a fixture-only flat +100 AD modifier so bonus AD is explicit.
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   cast time/direction; projectile travel/collision/sight; recast/reversal/
//   return/homing/second pass; execute/Adoration threshold; multitarget;
//   damage falloff/reset; map edge; once-per-pass; geometry; ranks 1–2;
//   Q/W/E/P/basic coupling; live/publish/full fidelity.
//   Exactly one selected-target first-outbound-pass physical hit, not full R.

const (
	dravenWDPOHCandidateKey  = "hero_skill|hero_draven|R|冷血追命"
	dravenWDPOHPlanRev       = "draven-r-whirling-death-primary-outbound-hit-phase-a-v2"
	dravenWDPOHRequestTitle  = "Template:Data Draven/R"
	dravenWDPOHResolvedTitle = "Template:Data Draven/Whirling Death"
	dravenWDPOHWikiPageID    = 1307072
	dravenWDPOHRevisionID    = 4040576
	dravenWDPOHTimestamp     = "2026-07-06T14:27:37Z"
	dravenWDPOHRawBytes      = 3079
	dravenWDPOHLocalRawBytes = 3079
	dravenWDPOHContentSHA    = "e38551b6eeefa0306cd40a3e15473c8983075f88edbe007915e3d9213a08adce"
	dravenWDPOHLocalRawSHA   = "1110179b1771c03c8ff67b428d6fa7a5b0ba42caf19e241ce512a199ef812059"
	dravenWDPOHNormBytes     = 3361
	dravenWDPOHNormSHA       = "74e8f95ca03c86a5c809255d6309e4639e949337f4f36ee4fcfd4e8403416754"
	dravenWDPOHBoundary      = "rank3_selected_primary_champion_single_first_outbound_pass_hit; immediate_impact_scaffold; " +
		"physical_400_plus_1_50_bonus_ad; no_cast_time_direction_projectile_travel_collision_sight_" +
		"recast_reversal_return_homing_second_pass_execute_adoration_threshold_multitarget_damage_" +
		"falloff_reset_map_edge_once_per_pass_geometry_or_full_fidelity"

	dravenWDPOHProviderRef = "provider_hero_draven_r_whirling_death_primary_outbound_hit"
	dravenWDPOHStableID    = "hero_draven_r_whirling_death_primary_outbound_hit"
	dravenWDPOHAbilityID   = "ability_hero_draven_r_whirling_death_primary_outbound_hit"
	dravenWDPOHAbilityKey  = "whirling_death_primary_outbound_hit"
	dravenWDPOHDamageOpRef = "op:draven_whirling_death_primary_outbound_hit_damage"
	dravenWDPOHBonusADMod  = "fixture_draven_whirling_death_primary_outbound_hit_bonus_ad"

	dravenWDPOHBaseDamage   = 400.0
	dravenWDPOHBonusADRatio = 1.50
	dravenWDPOHManaCost     = 100.0
	dravenWDPOHCDMs         = 80000.0

	dravenWDPOHADBaseDefault      = 62.0
	dravenWDPOHADResolvedDefault  = 162.0
	dravenWDPOHFixtureManaCD      = 361.0
	dravenWDPOHFixtureManaShort   = 99.0
	dravenWDPOHTargetArmorDefault = 100.0
	dravenWDPOHTargetHP           = 1000.0

	// Default fixture: bonusAD=100 → raw 550; armor100 → mitigated 275.
	dravenWDPOHExpectedRawDefault = 550.0
	dravenWDPOHExpectedMitDefault = 275.0
	dravenWDPOHManaAfter2         = 161.0 // 361 - 100 - 100
	dravenWDPOHHPAfter2           = 450.0 // 1000 - 275 - 275

	// Zero-bonus baseline: raw 400; armor100 → mitigated 200.
	dravenWDPOHExpectedRawBaseline = 400.0
	dravenWDPOHExpectedMitBaseline = 200.0

	dravenWDPOHTol = 1e-9
)

func dravenWDPOHExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return dravenWDPOHBaseDamage + dravenWDPOHBonusADRatio*(resolvedAD-baseAD)
}

func dravenWDPOHDamageAmount() *model.GenericFormulaExpr {
	base := dravenWDPOHBaseDamage
	ratio := dravenWDPOHBonusADRatio
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

func dravenWDPOHCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += dravenWDPOHCountPathReads(&expr.Args[i], path)
	}
	return n
}

func dravenWDPOHAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		dravenWDPOHAssertBinaryArity(t, &expr.Args[i])
	}
}

func dravenWDPOHAbility() model.AbilityDefinition {
	cost := dravenWDPOHManaCost
	cd := dravenWDPOHCDMs
	return model.AbilityDefinition{
		AbilityKey: dravenWDPOHAbilityKey,
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
				Ref:           dravenWDPOHDamageOpRef,
				Amount:        dravenWDPOHDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func dravenWDPOHProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: dravenWDPOHProviderRef,
		Kind:        "champion",
		StableID:    dravenWDPOHStableID,
		Abilities:   []model.AbilityDefinition{dravenWDPOHAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed R provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: dravenWDPOHBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func dravenWDPOHAbilityRef() string {
	return "source.provider[" + dravenWDPOHProviderRef + "].ability[" + dravenWDPOHAbilityKey + "]"
}

type dravenWDPOHFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func configureDravenWDPOHProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts dravenWDPOHFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	providers := []model.ProviderDefinition{dravenWDPOHProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: dravenWDPOHProviderRef, DefinitionRef: dravenWDPOHProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: dravenWDPOHProviderRef, DefinitionRef: dravenWDPOHProviderRef,
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

func ensureDravenWDPOHTypes(req *model.CompileRequest) {
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

func loadDravenWDPOHFixture(t *testing.T, opts dravenWDPOHFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.mana == 0 {
		opts.mana = dravenWDPOHFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = dravenWDPOHTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureDravenWDPOHTypes(&compileReq)
	configureDravenWDPOHProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values (acceptance data only).
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, dravenWDPOHFixtureManaCD),
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

func runDravenWDPOH(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func dravenWDPOHSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func dravenWDPOHSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func dravenWDPOHDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := dravenWDPOHAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != dravenWDPOHDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func dravenWDPOHAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
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

func dravenWDPOHFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == dravenWDPOHProviderRef {
			return p
		}
	}
	return nil
}

func assertDravenWDPOHProviderShape(t *testing.T, compileReq model.CompileRequest, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := dravenWDPOHFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_draven_r_whirling_death_primary_outbound_hit missing from SharedProviders")
	}
	if p.ProviderKey != dravenWDPOHProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, dravenWDPOHProviderRef)
	}
	if p.StableID != dravenWDPOHStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, dravenWDPOHStableID)
	}
	if p.ProviderKey == dravenSpinningAxeProviderRef || p.StableID == "hero_draven_spinning_axe" ||
		p.ProviderKey == dravenBloodRushProviderRef || p.StableID == dravenBloodRushStableID ||
		p.ProviderKey == dravenStandAsideProviderRef || p.StableID == dravenStandAsideStableID {
		t.Fatal("whirling_death primary-outbound-hit must not reuse Q/W/E provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no projectile/recast/execute state)", len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != dravenWDPOHBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], dravenWDPOHBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 when bonus=0", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), dravenWDPOHAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != dravenWDPOHAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, dravenWDPOHAbilityKey, dravenWDPOHAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("R Types=%v want empty (no ability/basic/on-hit type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("whirling_death_primary_outbound_hit must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("R must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("R must not carry tickSpec")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("R must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-dravenWDPOHManaCost) > dravenWDPOHTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-dravenWDPOHCDMs) > dravenWDPOHTol {
		t.Fatalf("cooldown=%+v want const 80000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary first-outbound physical hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("whirling death damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("whirling death damage must not be copyable on hit")
	}
	if op.Ref != dravenWDPOHDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, dravenWDPOHDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const400, mul(1.50, sub(ad.resolved, ad.base)))", op.Amount)
	}
	dravenWDPOHAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-dravenWDPOHBaseDamage) > dravenWDPOHTol {
		t.Fatalf("base const=%+v want 400", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-dravenWDPOHBonusADRatio) > dravenWDPOHTol {
		t.Fatalf("bonus AD ratio=%+v want 1.50", mul.Args[0])
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
	if dravenWDPOHCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", dravenWDPOHCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if dravenWDPOHCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", dravenWDPOHCountPathReads(op.Amount, "source.attr.ad.base"))
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
			bannedOp.Operation == "execute" || bannedOp.Operation == "homing" ||
			bannedOp.Operation == "recast" || bannedOp.DamageType == "damage/magic" {
			t.Fatalf("whirling death must not include excluded op: %+v", bannedOp)
		}
	}
}

func findDravenWDPOHAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := dravenWDPOHAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func dravenWDPOHRepoPath(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{"..", "..", "..", ".."}, parts...)...)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("missing path %s: %v (fail closed)", path, err)
	}
	return path
}

func dravenWDPOHSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func dravenWDPOHAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > dravenWDPOHTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > dravenWDPOHTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != dravenWDPOHDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), dravenWDPOHDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != dravenWDPOHAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), dravenWDPOHAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != dravenWDPOHProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), dravenWDPOHProviderRef)
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

// TestDravenWhirlingDeathPrimaryOutboundHitWikiSidecarIdentityAndBoundary locks
// repository sidecar/pages/raw identity, rank-3 markup semantics, fieldPresence,
// exclusion evidence, and the frozen completed-boundary constant.
func TestDravenWhirlingDeathPrimaryOutboundHitWikiSidecarIdentityAndBoundary(t *testing.T) {
	type wikiDoc struct {
		CandidateKey, RequestTitle, ResolvedTitle, ContentSHA256 string
		RevisionTimestamp, SkillKey, ZhDisplayName, OwnerID      string
		WikiPageID, RevisionID, RawByteSize                      int
		Fields                                                   struct {
			Description, Description2, Description3, Description4, Description5 string
			Leveling, Leveling4, Cooldown, Cost, Costtype, Damagetype, Notes    string
		}
		FieldPresence map[string]bool
	}
	sidecarRaw, err := os.ReadFile(dravenWDPOHRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "draven-r.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(sidecarRaw) != dravenWDPOHNormBytes {
		t.Fatalf("local normalized len=%d want %d", len(sidecarRaw), dravenWDPOHNormBytes)
	}
	if got := dravenWDPOHSHA256Hex(sidecarRaw); got != dravenWDPOHNormSHA {
		t.Fatalf("local normalized sha=%q want %q", got, dravenWDPOHNormSHA)
	}
	var doc wikiDoc
	if err := json.Unmarshal(sidecarRaw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.CandidateKey != dravenWDPOHCandidateKey || doc.RequestTitle != dravenWDPOHRequestTitle ||
		doc.ResolvedTitle != dravenWDPOHResolvedTitle || doc.WikiPageID != dravenWDPOHWikiPageID ||
		doc.RevisionID != dravenWDPOHRevisionID || doc.RevisionTimestamp != dravenWDPOHTimestamp ||
		doc.ContentSHA256 != dravenWDPOHContentSHA || doc.RawByteSize != dravenWDPOHRawBytes ||
		doc.SkillKey != "R" || doc.ZhDisplayName != "冷血追命" || doc.OwnerID != "hero_draven" {
		t.Fatalf("sidecar identity drifted: %+v", doc)
	}
	for _, key := range []string{
		"description", "description2", "leveling", "description3", "description4",
		"leveling4", "description5", "cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "100\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "100\n")
	}
	if doc.Fields.Costtype != "mana\n" {
		t.Fatalf("fields.costtype=%q want %q", doc.Fields.Costtype, "mana\n")
	}
	if doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("fields.damagetype=%q want Physical", doc.Fields.Damagetype)
	}
	if doc.Fields.Cooldown != "{{ap|100 to 80}}\n" {
		t.Fatalf("cooldown=%q want {{ap|100 to 80}} (rank-3 = 80s → 80000ms)", doc.Fields.Cooldown)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|200 to 400}}") ||
		!strings.Contains(doc.Fields.Leveling, "{{ap|110 to 150}}% '''bonus''' AD") ||
		!strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling=%q want rank3 physical 400 +150%% bonus AD", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") {
		t.Fatalf("description missing physical damage wording: %q", doc.Fields.Description)
	}
	// Explicit exclusion framing (present in wiki; not modeled by Phase-A scaffold).
	if !strings.Contains(doc.Fields.Description, "{{tip|sight}}") ||
		!strings.Contains(doc.Fields.Description, "{{tip|execute|executed}}") ||
		!strings.Contains(doc.Fields.Description, "Adoration") {
		t.Fatal("wiki description must retain excluded sight / execute / Adoration surfaces")
	}
	if !strings.Contains(doc.Fields.Description2, "recast") ||
		!strings.Contains(doc.Fields.Description2, "traveling") ||
		!strings.Contains(doc.Fields.Description2, "map") {
		t.Fatal("wiki description2 must retain excluded recast / travel / map-edge surfaces")
	}
	if !strings.Contains(doc.Fields.Description3, "Recast") ||
		!strings.Contains(doc.Fields.Description3, "reverse") ||
		!strings.Contains(doc.Fields.Description3, "homing") {
		t.Fatal("wiki description3 must retain excluded recast / reverse / homing / return surfaces")
	}
	if !strings.Contains(doc.Fields.Description4, "enemies hit") ||
		!strings.Contains(doc.Fields.Description4, "resetting") {
		t.Fatal("wiki description4 must retain excluded multitarget damage-falloff / reset surfaces")
	}
	if !strings.Contains(doc.Fields.Leveling, "Total Physical Damage") {
		t.Fatal("wiki leveling must retain excluded total/second-pass damage surface")
	}
	if !strings.Contains(doc.Fields.Leveling4, "Minimum Physical Damage") {
		t.Fatal("wiki leveling4 must retain excluded minimum/falloff damage surface")
	}
	if !strings.Contains(doc.Fields.Description5, "once per pass") {
		t.Fatal("wiki description5 must retain excluded once-per-pass surface")
	}
	if !strings.Contains(doc.Fields.Notes, "Spell shield") ||
		!strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing excluded spellshield/cast-time surfaces: %q", doc.Fields.Notes)
	}

	pagesRaw, err := os.ReadFile(dravenWDPOHRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "pages", "draven-r.json"))
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
		pages.SkillKey != "R" || pages.ZhDisplayName != "冷血追命" || pages.OwnerID != "hero_draven" {
		t.Fatalf("pages must agree with sidecar; got %+v", pages)
	}

	rawBytes, err := os.ReadFile(dravenWDPOHRepoPath(t,
		"数据参考", "lol-wiki-current-champions", "raw", "draven-r.wikitext"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rawBytes) != dravenWDPOHLocalRawBytes {
		t.Fatalf("local raw len=%d want %d", len(rawBytes), dravenWDPOHLocalRawBytes)
	}
	if dravenWDPOHLocalRawBytes != dravenWDPOHRawBytes {
		t.Fatal("local raw and canonical sizes must match for this caveat (same size / different hash)")
	}
	localSHA := dravenWDPOHSHA256Hex(rawBytes)
	if localSHA != dravenWDPOHLocalRawSHA {
		t.Fatalf("local raw sha=%q want %q", localSHA, dravenWDPOHLocalRawSHA)
	}
	if localSHA == dravenWDPOHContentSHA {
		t.Fatal("local raw hash must differ from canonical (same-size materialization caveat; not equivalence)")
	}
	// Do not claim contradiction: both identities are pinned serialization facts.
	rawText := string(rawBytes)
	for _, want := range []string{
		"{{ap|200 to 400}}",
		"{{ap|110 to 150}}% '''bonus''' AD",
		"|cost         = 100",
		"|cooldown     = {{ap|100 to 80}}",
		"|damagetype   = Physical",
		"|cast time    = {{fd|0.5}}",
		"|projectile   = true",
		"recast",
		"homing",
		"once per pass",
		"Adoration",
		"Effect at cast time end",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing positive source-field/exclusion framing %q", want)
		}
	}
	if dravenWDPOHPlanRev != "draven-r-whirling-death-primary-outbound-hit-phase-a-v2" ||
		dravenWDPOHBoundary != "rank3_selected_primary_champion_single_first_outbound_pass_hit; immediate_impact_scaffold; "+
			"physical_400_plus_1_50_bonus_ad; no_cast_time_direction_projectile_travel_collision_sight_"+
			"recast_reversal_return_homing_second_pass_execute_adoration_threshold_multitarget_damage_"+
			"falloff_reset_map_edge_once_per_pass_geometry_or_full_fidelity" {
		t.Fatal("frozen plan/boundary drifted")
	}
}

// TestDravenWhirlingDeathPrimaryOutboundHitRank3DamageFormulaCrossCheck: independent
// numeric cross-check 400 + 1.50*(162-62) = 550; armor 100 → mitigated 275.
func TestDravenWhirlingDeathPrimaryOutboundHitRank3DamageFormulaCrossCheck(t *testing.T) {
	bonus := dravenWDPOHADResolvedDefault - dravenWDPOHADBaseDefault
	if math.Abs(bonus-100) > dravenWDPOHTol {
		t.Fatalf("bonusAD=%v want 100", bonus)
	}
	raw := dravenWDPOHExpectedRawFromAD(dravenWDPOHADResolvedDefault, dravenWDPOHADBaseDefault)
	if math.Abs(raw-dravenWDPOHExpectedRawDefault) > dravenWDPOHTol {
		t.Fatalf("raw=%v want %v", raw, dravenWDPOHExpectedRawDefault)
	}
	totalADOnly := dravenWDPOHBaseDamage + dravenWDPOHBonusADRatio*dravenWDPOHADResolvedDefault
	if math.Abs(totalADOnly-dravenWDPOHExpectedRawDefault) < dravenWDPOHTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw (formula must not treat AD as total)")
	}
	baseOnly := dravenWDPOHExpectedRawFromAD(dravenWDPOHADBaseDefault, dravenWDPOHADBaseDefault)
	if math.Abs(baseOnly-dravenWDPOHExpectedRawBaseline) > dravenWDPOHTol {
		t.Fatalf("zero-bonus raw=%v want %v", baseOnly, dravenWDPOHExpectedRawBaseline)
	}
	if math.Abs(baseOnly-dravenWDPOHExpectedRawDefault) < dravenWDPOHTol {
		t.Fatal("zero-bonus raw must differ from bonus-AD raw")
	}
	// Total Physical Damage (2×) must not equal primary outbound raw (exclusion evidence).
	totalBothPasses := 2 * raw
	if math.Abs(totalBothPasses-dravenWDPOHExpectedRawDefault) < dravenWDPOHTol {
		t.Fatal("total both-pass raw must differ from single first-outbound raw")
	}
	mit := expectedMitigatedPhysical(raw, dravenWDPOHTargetArmorDefault)
	if math.Abs(mit-dravenWDPOHExpectedMitDefault) > dravenWDPOHTol {
		t.Fatalf("mitigated=%v want %v", mit, dravenWDPOHExpectedMitDefault)
	}
}

// TestDravenWhirlingDeathPrimaryOutboundHitCompileShapeImmediateScaffold asserts
// compile shape: one independent mounted provider/active ability/damage op; no
// listener/state/tick/repeat/explicit-event/control/projectile/geometry/multitarget.
func TestDravenWhirlingDeathPrimaryOutboundHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadDravenWDPOHFixture(t, dravenWDPOHFixtureOpts{
		baseAD: dravenWDPOHADBaseDefault, resolvedAD: dravenWDPOHADResolvedDefault,
		armor: dravenWDPOHTargetArmorDefault, mana: dravenWDPOHFixtureManaCD,
	})
	assertDravenWDPOHProviderShape(t, compileReq, true)
	if dravenWDPOHProviderRef == dravenSpinningAxeProviderRef ||
		dravenWDPOHProviderRef == dravenBloodRushProviderRef ||
		dravenWDPOHProviderRef == dravenStandAsideProviderRef ||
		dravenWDPOHStableID == dravenStandAsideStableID ||
		dravenWDPOHStableID == dravenBloodRushStableID {
		t.Fatal("whirling_death primary-outbound-hit must not reuse Q/W/E provider refs")
	}
	if dravenWDPOHAbilityKey == dravenSpinningAxeQKey ||
		dravenWDPOHAbilityKey == dravenBloodRushWKey ||
		dravenWDPOHAbilityKey == dravenStandAsideAbilityKey ||
		dravenWDPOHAbilityKey == "basic_attack" ||
		dravenWDPOHAbilityKey == "spinning_axe" ||
		dravenWDPOHAbilityKey == "blood_rush" ||
		dravenWDPOHAbilityKey == "stand_aside" {
		t.Fatal("whirling_death must not reuse Q/W/E/basic ability keys")
	}
	if dravenWDPOHAbilityID != "ability_hero_draven_r_whirling_death_primary_outbound_hit" {
		t.Fatal("ability id constant drifted")
	}
	if dravenWDPOHStableID != "hero_draven_r_whirling_death_primary_outbound_hit" {
		t.Fatal("stable id constant drifted")
	}
	if dravenWDPOHProviderRef != "provider_hero_draven_r_whirling_death_primary_outbound_hit" {
		t.Fatal("provider ref constant drifted")
	}
	if strings.Contains(dravenWDPOHDamageOpRef, "spinning_axe") ||
		strings.Contains(dravenWDPOHDamageOpRef, "blood_rush") ||
		strings.Contains(dravenWDPOHDamageOpRef, "stand_aside") {
		t.Fatal("damage op must not reuse Q/W/E operation refs")
	}
}

// TestDravenWhirlingDeathPrimaryOutboundHitCooldownMana361AbilityStarted: mana361/
// base62/resolved162/HP1000/armor100 at t0/t79999/t80000 →
// success/cooldown skip/success; final mana161/HP450; exactly two R damage
// settlements and two synthesized ability_started events.
func TestDravenWhirlingDeathPrimaryOutboundHitCooldownMana361AbilityStarted(t *testing.T) {
	compileReq, runReq := loadDravenWDPOHFixture(t, dravenWDPOHFixtureOpts{
		baseAD: dravenWDPOHADBaseDefault, resolvedAD: dravenWDPOHADResolvedDefault,
		armor: dravenWDPOHTargetArmorDefault, mana: dravenWDPOHFixtureManaCD, hp: dravenWDPOHTargetHP,
	})
	assertDravenWDPOHProviderShape(t, compileReq, true)
	ref := dravenWDPOHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 79999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 80000},
	}
	runReq.StopPolicy.DurationMs = 80100
	done := runDravenWDPOH(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if dravenWDPOHSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findDravenWDPOHAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt79999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 79999 {
			t.Fatalf("cooldown skip TimeMs=%d want 79999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 80000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 80000", item.Data["readyAtMs"])
		}
		skipAt79999 = true
	}
	if !skipAt79999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=79999 with readyAtMs=80000")
	}

	items := dravenWDPOHDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("R damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 80000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		dravenWDPOHAssertDamage(t, item, dravenWDPOHExpectedRawDefault, dravenWDPOHExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * dravenWDPOHExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-dravenWDPOHHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, dravenWDPOHHPAfter2)
	}
	gotMana := dravenWDPOHSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-dravenWDPOHManaAfter2) > dravenWDPOHTol {
		t.Fatalf("mana=%v want %v", gotMana, dravenWDPOHManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := dravenWDPOHAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic R; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 80000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-dravenWDPOHADResolvedDefault) > dravenWDPOHTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), dravenWDPOHADResolvedDefault)
	}
	if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-dravenWDPOHADBaseDefault) > dravenWDPOHTol {
		t.Fatalf("ad.base=%v want %v",
			sourceAttrBase(t, done.FinalSnapshot, "ad"), dravenWDPOHADBaseDefault)
	}
}

// TestDravenWhirlingDeathPrimaryOutboundHitBaselineZeroBonusAD: resolvedAD=baseAD62
// → raw400, mitigated200 at armor100 (bonus-AD path subtracts base).
func TestDravenWhirlingDeathPrimaryOutboundHitBaselineZeroBonusAD(t *testing.T) {
	compileReq, runReq := loadDravenWDPOHFixture(t, dravenWDPOHFixtureOpts{
		baseAD: dravenWDPOHADBaseDefault, resolvedAD: dravenWDPOHADBaseDefault,
		armor: dravenWDPOHTargetArmorDefault, mana: dravenWDPOHFixtureManaCD, hp: dravenWDPOHTargetHP,
	})
	assertDravenWDPOHProviderShape(t, compileReq, false)
	ref := dravenWDPOHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runDravenWDPOH(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	dmg := dravenWDPOHDamageEvidence(done)
	if len(dmg) != 1 {
		t.Fatalf("R damage evidence=%d want 1", len(dmg))
	}
	dravenWDPOHAssertDamage(t, dmg[0], dravenWDPOHExpectedRawBaseline, dravenWDPOHExpectedMitBaseline)
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-dravenWDPOHADBaseDefault) > dravenWDPOHTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), dravenWDPOHADBaseDefault)
	}
	if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-dravenWDPOHADBaseDefault) > dravenWDPOHTol {
		t.Fatalf("ad.base=%v want %v",
			sourceAttrBase(t, done.FinalSnapshot, "ad"), dravenWDPOHADBaseDefault)
	}
	if len(dravenWDPOHAbilityStartedEvidence(done)) != 1 {
		t.Fatalf("ability_started=%d want 1", len(dravenWDPOHAbilityStartedEvidence(done)))
	}
}

// TestDravenWhirlingDeathPrimaryOutboundHitResourceInsufficientMana99: mana99 at t0 →
// resource_insufficient; mana/HP unchanged; zero R damage/ability_started evidence.
func TestDravenWhirlingDeathPrimaryOutboundHitResourceInsufficientMana99(t *testing.T) {
	compileReq, runReq := loadDravenWDPOHFixture(t, dravenWDPOHFixtureOpts{
		baseAD: dravenWDPOHADBaseDefault, resolvedAD: dravenWDPOHADResolvedDefault,
		armor: dravenWDPOHTargetArmorDefault, mana: dravenWDPOHFixtureManaShort, hp: dravenWDPOHTargetHP,
	})
	ref := dravenWDPOHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runDravenWDPOH(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if dravenWDPOHSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(dravenWDPOHSourceMana(t, done.FinalSnapshot)-dravenWDPOHFixtureManaShort) > dravenWDPOHTol {
		t.Fatalf("mana changed: got %v want %v",
			dravenWDPOHSourceMana(t, done.FinalSnapshot), dravenWDPOHFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-dravenWDPOHTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, dravenWDPOHTargetHP)
	}
	if len(dravenWDPOHDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero R damage evidence")
	}
	if len(dravenWDPOHAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}
