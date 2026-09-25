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

	"tinygo_engine_v2/internal/model"
)

// hero_ezreal R Trueshot Barrage / 精准弹幕 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: ezreal-r-trueshot-barrage-primary-hit-phase-a-v2).
//
// Frozen boundary:
//
//	rank3_primary_champion_single_hit; immediate_impact_scaffold;
//	magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage
//
// Wiki authority (repository sidecar/pages; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_ezreal|R|精准弹幕
//	task wasm-generic-ezreal-trueshot-barrage-primary-hit
//	Request Template:Data Ezreal/R → resolved Template:Data Ezreal/Trueshot Barrage
//	wikiPageId 1307113 / rev 4013235 / timestamp 2026-04-28T21:20:36Z
//	sidecar rawByteSize 1453 / SHA256 e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0
//	数据参考/lol-wiki-current-champions/normalized/generic/ezreal-r.json
//	pages/raw siblings: pages/ezreal-r.json, raw/ezreal-r.wikitext
//	已删除历史种子： db/game_manage/seeds/lol_generic_ezreal_trueshot_barrage_primary_hit_seed.sql
//	Local raw is a non-canonical materialization: 1450 bytes / SHA256
//	ddc984665670fe9aee859ec740d63c101b04c7f504f610952f94fe67a014f943.
//	Trimming terminal LF yields 1449 / 57a04bc0…; BOM-prepend yields 1453 /
//	27fbea33… but is not canonical. Sidecar/pages own canonical identity —
//	assert local existence/size/SHA/required substrings only; do not assert
//	equivalence or treat local raw as a source contradiction.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_ezreal_r_trueshot_barrage_primary_hit
//     (not Rising Spell Force / Q/W/E / basic reuse)
//   - ability ability_hero_ezreal_r_trueshot_barrage_primary_hit with ability_key
//     trueshot_barrage: active; mana 100; cooldown 90000 ms
//   - Exactly one immediate direct-target magic damage op (null-duration
//     impact / on_enter scaffold in production seed; Wasm models one op):
//     750 + 1.00*(source.attr.ad.resolved - source.attr.ad.base)
//       + 1.10*source.attr.ap.resolved
//     (历史种子曾使用 multi-arg add; Wasm fixture uses nested binary add
//     with identical arithmetic — never bake fixture bonus-AD/AP constants)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / state / cast-delay / queue / projectile / travel /
//     collision / geometry / direction / multitarget / sight / minion /
//     monster modified / repeat / phantom / equipment / loadout / on-hit /
//     P/Q/W/E/basic behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Wiki describes cast time = 1s, queue = 0.5s, Effect-at-cast-start,
//   projectile travel / global geometry / direction / multitarget /
//   sight / minion-or-monster modified damage — but this scaffold is
//   immediate primary-champion magic damage only. Do not claim these
//   behaviors are absent in the real game; they are absent only from this
//   Phase-A fixture. Do not invent cast-delay/queue/projectile/travel/
//   collision/geometry/direction/multitarget/sight/minion-monster modified,
//   ranks 1–2, P Rising Spell Force / Q / W / E / basic / equipment /
//   loadout, live publish, or full fidelity.

const (
	ezrealTrueshotBarragePrimaryHitCandidateKey  = "hero_skill|hero_ezreal|R|精准弹幕"
	ezrealTrueshotBarragePrimaryHitTaskKey       = "wasm-generic-ezreal-trueshot-barrage-primary-hit"
	ezrealTrueshotBarragePrimaryHitRequestTitle  = "Template:Data Ezreal/R"
	ezrealTrueshotBarragePrimaryHitResolvedTitle = "Template:Data Ezreal/Trueshot Barrage"
	ezrealTrueshotBarragePrimaryHitWikiPageID    = 1307113
	ezrealTrueshotBarragePrimaryHitRevisionID    = 4013235
	ezrealTrueshotBarragePrimaryHitTimestamp     = "2026-04-28T21:20:36Z"
	ezrealTrueshotBarragePrimaryHitRawBytes      = 1453
	ezrealTrueshotBarragePrimaryHitLocalRawBytes = 1450
	ezrealTrueshotBarragePrimaryHitTrimRawBytes  = 1449
	ezrealTrueshotBarragePrimaryHitBOMRawBytes   = 1453
	ezrealTrueshotBarragePrimaryHitContentSHA    = "e9d7f9d7411bcbb1ab00aeb89fe03a4fb8511625fc0a64266f5f63ced53580e0"
	ezrealTrueshotBarragePrimaryHitLocalRawSHA   = "ddc984665670fe9aee859ec740d63c101b04c7f504f610952f94fe67a014f943"
	ezrealTrueshotBarragePrimaryHitTrimRawSHA    = "57a04bc0b2e42505bd9ec1b324fed4192aecb213ea22dade56f4e77ed553f3ce"
	ezrealTrueshotBarragePrimaryHitBOMRawSHA     = "27fbea33e254bd4b139e49ca0bbface059f490d25fa74cd33b19846596a1c639"
	ezrealTrueshotBarragePrimaryHitPlanRev       = "ezreal-r-trueshot-barrage-primary-hit-phase-a-v2"
	ezrealTrueshotBarragePrimaryHitBoundary      = "rank3_primary_champion_single_hit; immediate_impact_scaffold; " +
		"magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage"

	ezrealTrueshotBarragePrimaryHitProviderRef = "provider_hero_ezreal_r_trueshot_barrage_primary_hit"
	ezrealTrueshotBarragePrimaryHitStableID    = "hero_ezreal_r_trueshot_barrage_primary_hit"
	ezrealTrueshotBarragePrimaryHitAbilityID   = "ability_hero_ezreal_r_trueshot_barrage_primary_hit"
	ezrealTrueshotBarragePrimaryHitAbilityKey  = "trueshot_barrage"
	ezrealTrueshotBarragePrimaryHitDamageOpRef = "op:ezreal_trueshot_barrage_primary_hit_damage"
	ezrealTrueshotBarragePrimaryHitBonusADMod  = "fixture_ezreal_trueshot_barrage_primary_hit_bonus_ad"

	// Must not collide with / reuse Rising Spell Force or Q/W/E providers.
	ezrealRSFProviderRefAlias         = "provider_hero_ezreal_rising_spell_force"
	ezrealRSFProviderRefRuntime       = "hero:ezreal"
	ezrealRSFStableIDAlias            = "hero_ezreal"
	ezrealTrueshotBarrageBaseDamage   = 750.0
	ezrealTrueshotBarrageBonusADRatio = 1.00
	ezrealTrueshotBarrageAPRatio      = 1.10
	ezrealTrueshotBarrageManaCost     = 100.0
	ezrealTrueshotBarrageCDMs         = 90000.0

	// Fixture: base AD60 + flat +50 → resolved total AD110; AP200; mana300.
	ezrealTrueshotBarragePrimaryHitADBase      = 60.0
	ezrealTrueshotBarragePrimaryHitADResolved  = 110.0
	ezrealTrueshotBarragePrimaryHitFixtureAP   = 200.0
	ezrealTrueshotBarragePrimaryHitFixtureMana = 300.0
	ezrealTrueshotBarragePrimaryHitTargetMR    = 100.0
	ezrealTrueshotBarragePrimaryHitTargetHP    = 1500.0

	// Independent cross-check: bonusAD=50 + AP=200 → raw 1020; MR 100 → mitigated 510.
	ezrealTrueshotBarragePrimaryHitExpectedRaw       = 1020.0
	ezrealTrueshotBarragePrimaryHitExpectedMitigated = 510.0
	ezrealTrueshotBarragePrimaryHitManaAfter2        = 100.0 // 300 - 100 - 100
	ezrealTrueshotBarragePrimaryHitHPAfter2          = 480.0 // 1500 - 510 - 510

	ezrealTrueshotBarragePrimaryHitTol = 1e-9
)

func ezrealTrueshotBarragePrimaryHitExpectedRawFromStats(resolvedAD, baseAD, resolvedAP float64) float64 {
	return ezrealTrueshotBarrageBaseDamage +
		ezrealTrueshotBarrageBonusADRatio*(resolvedAD-baseAD) +
		ezrealTrueshotBarrageAPRatio*resolvedAP
}

func ezrealTrueshotBarragePrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := ezrealTrueshotBarrageBaseDamage
	adRatio := ezrealTrueshotBarrageBonusADRatio
	apRatio := ezrealTrueshotBarrageAPRatio
	// Nested binary add: base + bonusAD + AP (generic add is binary-only in Wasm).
	// Bonus AD = sub(ad.resolved, ad.base) — never bake fixture constants.
	// Arithmetic matches Backend multi-arg add seed semantics.
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

func ezrealTrueshotBarragePrimaryHitAbility() model.AbilityDefinition {
	cost := ezrealTrueshotBarrageManaCost
	cd := ezrealTrueshotBarrageCDMs
	return model.AbilityDefinition{
		AbilityKey: ezrealTrueshotBarragePrimaryHitAbilityKey,
		Kind:       "active",
		// Not a basic attack; CritEligible left false on the damage op.
		Types: []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic", // runtime type 20221; not physical 20220
				Ref:           ezrealTrueshotBarragePrimaryHitDamageOpRef,
				Amount:        ezrealTrueshotBarragePrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func ezrealTrueshotBarragePrimaryHitProviderDef() model.ProviderDefinition {
	bonusAD := ezrealTrueshotBarragePrimaryHitADResolved - ezrealTrueshotBarragePrimaryHitADBase
	return model.ProviderDefinition{
		ProviderKey: ezrealTrueshotBarragePrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    ezrealTrueshotBarragePrimaryHitStableID,
		// Fixture-only flat AD so ad.base stays 60 while ad.resolved becomes 110
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: ezrealTrueshotBarragePrimaryHitBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}},
		Abilities: []model.AbilityDefinition{ezrealTrueshotBarragePrimaryHitAbility()},
	}
}

func ezrealTrueshotBarragePrimaryHitAbilityRef() string {
	return "source.provider[" + ezrealTrueshotBarragePrimaryHitProviderRef +
		"].ability[" + ezrealTrueshotBarragePrimaryHitAbilityKey + "]"
}

func configureEzrealTrueshotBarragePrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{ezrealTrueshotBarragePrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: ezrealTrueshotBarragePrimaryHitProviderRef, DefinitionRef: ezrealTrueshotBarragePrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: ezrealTrueshotBarragePrimaryHitProviderRef, DefinitionRef: ezrealTrueshotBarragePrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureEzrealTrueshotBarragePrimaryHitTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
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

func loadEzrealTrueshotBarragePrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureEzrealTrueshotBarragePrimaryHitTypes(&compileReq)
	configureEzrealTrueshotBarragePrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: ezrealTrueshotBarragePrimaryHitADBase, Current: ezrealTrueshotBarragePrimaryHitADBase,
		Max: ezrealTrueshotBarragePrimaryHitADBase, Resolved: ezrealTrueshotBarragePrimaryHitADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: ezrealTrueshotBarragePrimaryHitFixtureAP, Current: ezrealTrueshotBarragePrimaryHitFixtureAP,
		Max: ezrealTrueshotBarragePrimaryHitFixtureAP, Resolved: ezrealTrueshotBarragePrimaryHitFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: ezrealTrueshotBarragePrimaryHitFixtureMana, Max: ezrealTrueshotBarragePrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: ezrealTrueshotBarragePrimaryHitTargetHP, Current: ezrealTrueshotBarragePrimaryHitTargetHP,
		Max: ezrealTrueshotBarragePrimaryHitTargetHP, Resolved: ezrealTrueshotBarragePrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: ezrealTrueshotBarragePrimaryHitTargetMR, Current: ezrealTrueshotBarragePrimaryHitTargetMR,
		Max: ezrealTrueshotBarragePrimaryHitTargetMR, Resolved: ezrealTrueshotBarragePrimaryHitTargetMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runEzrealTrueshotBarragePrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func ezrealTrueshotBarragePrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func ezrealTrueshotBarragePrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func ezrealTrueshotBarragePrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != ezrealTrueshotBarragePrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func ezrealTrueshotBarragePrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == ezrealTrueshotBarragePrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertEzrealTrueshotBarragePrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := ezrealTrueshotBarragePrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_ezreal_r_trueshot_barrage_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != ezrealTrueshotBarragePrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, ezrealTrueshotBarragePrimaryHitProviderRef)
	}
	if p.StableID != ezrealTrueshotBarragePrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, ezrealTrueshotBarragePrimaryHitStableID)
	}
	if p.ProviderKey == ezrealRSFProviderRefAlias || p.StableID == ezrealRSFProviderRefAlias ||
		p.ProviderKey == ezrealRSFProviderRefRuntime || p.StableID == ezrealRSFStableIDAlias ||
		p.ProviderKey == ezrealRSFProviderRef || p.StableID == ezrealRSFStableID {
		t.Fatal("trueshot_barrage primary-hit must not reuse Rising Spell Force provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / Rising Spell Force / on-hit coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no Rising Spell Force / state schema)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat; no equipment/Rising Spell Force)", len(p.Modifiers))
	}
	if p.Modifiers[0].ModifierKey != ezrealTrueshotBarragePrimaryHitBonusADMod ||
		p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
		p.Modifiers[0].ValuePolicy != "add" {
		t.Fatalf("modifier=%+v want fixture-only flat AD add %q",
			p.Modifiers[0], ezrealTrueshotBarragePrimaryHitBonusADMod)
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil (no projectile/AOE/field lifecycle)", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), ezrealTrueshotBarragePrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != ezrealTrueshotBarragePrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, ezrealTrueshotBarragePrimaryHitAbilityKey, ezrealTrueshotBarragePrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("trueshot_barrage must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("trueshot_barrage must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("trueshot_barrage must not carry tickSpec (no AOE/projectile ticks)")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("trueshot_barrage must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-ezrealTrueshotBarrageManaCost) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-ezrealTrueshotBarrageCDMs) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 90000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no cast/projectile/multitarget)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target (runtime 20221)", op)
	}
	if op.DamageType == "damage/physical" {
		t.Fatal("trueshot_barrage must not use physical damage (20220)")
	}
	if op.CritEligible {
		t.Fatal("trueshot_barrage damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("trueshot_barrage damage must not be copyable on hit")
	}
	if op.Ref != ezrealTrueshotBarragePrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, ezrealTrueshotBarragePrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(base+bonusAD, AP)", op.Amount)
	}
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const, mul(adRatio, sub(ad.resolved, ad.base)))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-ezrealTrueshotBarrageBaseDamage) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("base const=%+v want 750", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-ezrealTrueshotBarrageBonusADRatio) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("bonus-AD ratio=%+v want 1.00", adMul.Args[0])
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want sub(source.attr.ad.resolved, source.attr.ad.base)", sub)
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
		math.Abs(*apMul.Args[0].Value-ezrealTrueshotBarrageAPRatio) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("AP ratio=%+v want 1.10", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "stun" ||
			banned.Operation == "projectile" || banned.Operation == "multi_target" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" ||
			banned.Operation == "field" || banned.Operation == "reveal" ||
			banned.Operation == "sight" || banned.Operation == "cast_delay" ||
			banned.Operation == "spellshield" || banned.DamageType == "damage/physical" {
			t.Fatalf("trueshot_barrage must not include cast/queue/projectile/geometry/direction/multitarget/sight/physical op: %+v", banned)
		}
	}
}

func findEzrealTrueshotBarragePrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := ezrealTrueshotBarragePrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func ezrealTrueshotBarragePrimaryHitWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "ezreal-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func ezrealTrueshotBarragePrimaryHitWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "ezreal-r.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func ezrealTrueshotBarragePrimaryHitWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "ezreal-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type ezrealTrueshotBarragePrimaryHitWikiSidecar struct {
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
		Cooldown     string `json:"cooldown"`
		Cost         string `json:"cost"`
		Costtype     string `json:"costtype"`
		Damagetype   string `json:"damagetype"`
		Notes        string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

type ezrealTrueshotBarragePrimaryHitWikiPages struct {
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

func ezrealTrueshotBarragePrimaryHitLoadWikiSidecar(t *testing.T) ezrealTrueshotBarragePrimaryHitWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(ezrealTrueshotBarragePrimaryHitWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc ezrealTrueshotBarragePrimaryHitWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

func ezrealTrueshotBarragePrimaryHitLoadWikiPages(t *testing.T) ezrealTrueshotBarragePrimaryHitWikiPages {
	t.Helper()
	raw, err := os.ReadFile(ezrealTrueshotBarragePrimaryHitWikiPagesPath(t))
	if err != nil {
		t.Fatalf("read wiki pages: %v", err)
	}
	var doc ezrealTrueshotBarragePrimaryHitWikiPages
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki pages: %v", err)
	}
	return doc
}

func ezrealTrueshotBarragePrimaryHitSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// TestEzrealTrueshotBarragePrimaryHitWikiSidecarIdentityAndBoundary locks repository
// sidecar/pages/raw/seed identity plus the frozen Phase-A completed-boundary /
// plan-rev constants. Positively asserts rank-3 champion magic/formula/cost/CD,
// cast=1 / queue=0.5 / Effect-at-cast-start, and minion/monster modified formula
// as source evidence; compile/runtime prove those branches are absent from the
// immediate scaffold (not modeled). Local raw is asserted for known
// materialization identity only — not as canonical equivalence.
func TestEzrealTrueshotBarragePrimaryHitWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := ezrealTrueshotBarragePrimaryHitLoadWikiSidecar(t)
	if doc.CandidateKey != ezrealTrueshotBarragePrimaryHitCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, ezrealTrueshotBarragePrimaryHitCandidateKey)
	}
	if doc.RequestTitle != ezrealTrueshotBarragePrimaryHitRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, ezrealTrueshotBarragePrimaryHitRequestTitle)
	}
	if doc.ResolvedTitle != ezrealTrueshotBarragePrimaryHitResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, ezrealTrueshotBarragePrimaryHitResolvedTitle)
	}
	if doc.WikiPageID != ezrealTrueshotBarragePrimaryHitWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, ezrealTrueshotBarragePrimaryHitWikiPageID)
	}
	if doc.RevisionID != ezrealTrueshotBarragePrimaryHitRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, ezrealTrueshotBarragePrimaryHitRevisionID)
	}
	if doc.RevisionTimestamp != ezrealTrueshotBarragePrimaryHitTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, ezrealTrueshotBarragePrimaryHitTimestamp)
	}
	if doc.ContentSHA256 != ezrealTrueshotBarragePrimaryHitContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, ezrealTrueshotBarragePrimaryHitContentSHA)
	}
	if doc.RawByteSize != ezrealTrueshotBarragePrimaryHitRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, ezrealTrueshotBarragePrimaryHitRawBytes)
	}
	if doc.SkillKey != "R" || doc.ZhDisplayName != "精准弹幕" || doc.OwnerID != "hero_ezreal" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want R/精准弹幕/hero_ezreal",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{
		"description", "leveling", "description2", "leveling2",
		"cooldown", "cost", "costtype", "damagetype", "notes",
	} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "100\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "100\n")
	}
	if doc.Fields.Cooldown != "{{ap|120 to 90}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|120 to 90}}\n")
	}
	if doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("fields.damagetype=%q want Magic", doc.Fields.Damagetype)
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("fields.costtype=%q want Mana", doc.Fields.Costtype)
	}
	if doc.Fields.Description == "" {
		t.Fatal("description empty (fail closed; expect magic / sight / direction wording)")
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") {
		t.Fatalf("description missing magic damage wording: %q", doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "{{tip|sight}}") {
		t.Fatalf("description missing sight wording (source evidence; excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "target direction") {
		t.Fatalf("description missing target-direction wording (excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if doc.Fields.Leveling == "" {
		t.Fatal("leveling empty (fail closed; expect Magic Damage rank formula)")
	}
	if !strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling missing Magic Damage label: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|350 to 750}}") {
		t.Fatalf("leveling missing rank formula {{ap|350 to 750}}: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "100% '''bonus''' AD") {
		t.Fatalf("leveling missing 100%% bonus AD ratio: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "110% AP") {
		t.Fatalf("leveling missing 110%% AP ratio: %q", doc.Fields.Leveling)
	}
	if doc.Fields.Description2 == "" {
		t.Fatal("description2 empty (fail closed; expect minion/monster modified)")
	}
	if !strings.Contains(doc.Fields.Description2, "Minion") || !strings.Contains(doc.Fields.Description2, "monster") {
		t.Fatalf("description2 missing minion/monster wording (excluded from scaffold): %q",
			doc.Fields.Description2)
	}
	if !strings.Contains(doc.Fields.Description2, "modified damage") {
		t.Fatalf("description2 missing modified damage wording (excluded from scaffold): %q",
			doc.Fields.Description2)
	}
	if doc.Fields.Leveling2 == "" {
		t.Fatal("leveling2 empty (fail closed; expect Modified Damage rank formula)")
	}
	if !strings.Contains(doc.Fields.Leveling2, "Modified Damage") {
		t.Fatalf("leveling2 missing Modified Damage label: %q", doc.Fields.Leveling2)
	}
	if !strings.Contains(doc.Fields.Leveling2, "{{ap|150 to 300}}") {
		t.Fatalf("leveling2 missing rank formula {{ap|150 to 300}}: %q", doc.Fields.Leveling2)
	}
	if doc.Fields.Notes == "" {
		t.Fatal("notes empty (fail closed; expect Effect at cast time start / projectile)")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time start") {
		t.Fatalf("notes missing Effect at cast time start (excluded from immediate scaffold): %q",
			doc.Fields.Notes)
	}
	if !strings.Contains(doc.Fields.Notes, "projectile") {
		t.Fatalf("notes missing projectile wording (excluded from scaffold): %q", doc.Fields.Notes)
	}

	pages := ezrealTrueshotBarragePrimaryHitLoadWikiPages(t)
	if pages.CandidateKey != ezrealTrueshotBarragePrimaryHitCandidateKey ||
		pages.RequestTitle != ezrealTrueshotBarragePrimaryHitRequestTitle ||
		pages.ResolvedTitle != ezrealTrueshotBarragePrimaryHitResolvedTitle ||
		pages.PageID != ezrealTrueshotBarragePrimaryHitWikiPageID ||
		pages.RevisionID != ezrealTrueshotBarragePrimaryHitRevisionID ||
		pages.RevisionTimestamp != ezrealTrueshotBarragePrimaryHitTimestamp ||
		pages.ContentSHA256 != ezrealTrueshotBarragePrimaryHitContentSHA ||
		pages.RawByteSize != ezrealTrueshotBarragePrimaryHitRawBytes ||
		pages.SkillKey != "R" || pages.ZhDisplayName != "精准弹幕" || pages.OwnerID != "hero_ezreal" {
		t.Fatalf("pages identity must agree with sidecar canonical fields; got %+v", pages)
	}

	raw, err := os.ReadFile(ezrealTrueshotBarragePrimaryHitWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) != ezrealTrueshotBarragePrimaryHitLocalRawBytes {
		t.Fatalf("local raw len=%d want %d (known non-canonical materialization)",
			len(raw), ezrealTrueshotBarragePrimaryHitLocalRawBytes)
	}
	localSHA := ezrealTrueshotBarragePrimaryHitSHA256Hex(raw)
	if localSHA != ezrealTrueshotBarragePrimaryHitLocalRawSHA {
		t.Fatalf("local raw sha=%q want known materialization %q",
			localSHA, ezrealTrueshotBarragePrimaryHitLocalRawSHA)
	}
	if localSHA == ezrealTrueshotBarragePrimaryHitContentSHA {
		t.Fatal("local raw hash must not equal canonical contentSha256 (non-canonical materialization)")
	}
	if raw[len(raw)-1] != '\n' {
		t.Fatal("local raw must end with terminal LF for known trim materialization")
	}
	trimmed := raw[:len(raw)-1]
	if len(trimmed) != ezrealTrueshotBarragePrimaryHitTrimRawBytes {
		t.Fatalf("trimmed local raw len=%d want known %d",
			len(trimmed), ezrealTrueshotBarragePrimaryHitTrimRawBytes)
	}
	trimSHA := ezrealTrueshotBarragePrimaryHitSHA256Hex(trimmed)
	if trimSHA != ezrealTrueshotBarragePrimaryHitTrimRawSHA {
		t.Fatalf("trimmed local raw sha=%q want known materialization %q",
			trimSHA, ezrealTrueshotBarragePrimaryHitTrimRawSHA)
	}
	if trimSHA == ezrealTrueshotBarragePrimaryHitContentSHA {
		t.Fatal("trimming terminal LF must not be treated as reproducing canonical (sidecar/pages own identity)")
	}
	bomPrepend := append([]byte{0xEF, 0xBB, 0xBF}, raw...)
	if len(bomPrepend) != ezrealTrueshotBarragePrimaryHitBOMRawBytes {
		t.Fatalf("BOM-prepend len=%d want known %d",
			len(bomPrepend), ezrealTrueshotBarragePrimaryHitBOMRawBytes)
	}
	bomSHA := ezrealTrueshotBarragePrimaryHitSHA256Hex(bomPrepend)
	if bomSHA != ezrealTrueshotBarragePrimaryHitBOMRawSHA {
		t.Fatalf("BOM-prepend sha=%q want known materialization %q",
			bomSHA, ezrealTrueshotBarragePrimaryHitBOMRawSHA)
	}
	if bomSHA == ezrealTrueshotBarragePrimaryHitContentSHA {
		t.Fatal("BOM-prepend must not be treated as reproducing canonical (sidecar/pages own identity)")
	}
	rawText := string(raw)
	for _, want := range []string{
		"|cast time    = 1",
		"|queue time   = {{fd|0.5}}",
		"{{Effect at cast time start}}",
		"{{ap|350 to 750}}",
		"100% '''bonus''' AD",
		"110% AP",
		"|cost         = 100",
		"{{ap|120 to 90}}",
		"{{ap|150 to 300}}",
		"modified damage",
		"{{as|magic damage}}",
		"|projectile   = True",
	} {
		if !strings.Contains(rawText, want) {
			t.Fatalf("local raw missing required substring %q", want)
		}
	}

	if ezrealTrueshotBarragePrimaryHitPlanRev != "ezreal-r-trueshot-barrage-primary-hit-phase-a-v2" {
		t.Fatal("frozen plan-rev constant drifted")
	}
	if ezrealTrueshotBarragePrimaryHitBoundary != "rank3_primary_champion_single_hit; immediate_impact_scaffold; "+
		"magic_750_plus_1_00_bonus_ad_plus_1_10_ap; no_cast_delay_queue_projectile_travel_collision_geometry_direction_multitarget_sight_minion_or_monster_modified_damage" {
		t.Fatal("frozen boundary constant drifted")
	}
}

// TestEzrealTrueshotBarragePrimaryHitConstructedFixtureFormulaAndIdentity 核对历史数值边界在现有通用运行构造样例中的身份与公式。
func TestEzrealTrueshotBarragePrimaryHitConstructedFixtureFormulaAndIdentity(t *testing.T) {

	compileReq, _ := loadEzrealTrueshotBarragePrimaryHitFixture(t)
	assertEzrealTrueshotBarragePrimaryHitProviderShape(t, compileReq)
	raw := ezrealTrueshotBarragePrimaryHitExpectedRawFromStats(
		ezrealTrueshotBarragePrimaryHitADResolved, ezrealTrueshotBarragePrimaryHitADBase,
		ezrealTrueshotBarragePrimaryHitFixtureAP)
	if math.Abs(raw-ezrealTrueshotBarragePrimaryHitExpectedRaw) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("constructed fixture raw=%v want %v", raw, ezrealTrueshotBarragePrimaryHitExpectedRaw)
	}
	if mit := expectedMitigatedMagic(raw, ezrealTrueshotBarragePrimaryHitTargetMR); math.Abs(mit-ezrealTrueshotBarragePrimaryHitExpectedMitigated) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("constructed fixture mitigated=%v want %v", mit, ezrealTrueshotBarragePrimaryHitExpectedMitigated)
	}
}

// TestEzrealTrueshotBarragePrimaryHitRank3DamageFormulaCrossCheck: independent numeric
// cross-check 750 + 1.00*(110-60) + 1.10*200 = 1020; MR 100 → mitigated 510.
// Also proves bonus-AD path differs from total-AD (110) alone, and minion-modified
// 300+1.00*bonusAD+1.10*AP differs from champion primary formula.
func TestEzrealTrueshotBarragePrimaryHitRank3DamageFormulaCrossCheck(t *testing.T) {
	bonus := ezrealTrueshotBarragePrimaryHitADResolved - ezrealTrueshotBarragePrimaryHitADBase
	if math.Abs(bonus-50) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("fixture flat AD=%v want 50 (resolved 110 - base 60)", bonus)
	}
	raw := ezrealTrueshotBarragePrimaryHitExpectedRawFromStats(
		ezrealTrueshotBarragePrimaryHitADResolved, ezrealTrueshotBarragePrimaryHitADBase,
		ezrealTrueshotBarragePrimaryHitFixtureAP)
	if math.Abs(raw-ezrealTrueshotBarragePrimaryHitExpectedRaw) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, ezrealTrueshotBarragePrimaryHitExpectedRaw)
	}
	totalADOnly := ezrealTrueshotBarrageBaseDamage +
		ezrealTrueshotBarrageBonusADRatio*ezrealTrueshotBarragePrimaryHitADResolved +
		ezrealTrueshotBarrageAPRatio*ezrealTrueshotBarragePrimaryHitFixtureAP
	if math.Abs(totalADOnly-ezrealTrueshotBarragePrimaryHitExpectedRaw) < ezrealTrueshotBarragePrimaryHitTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw (formula must not treat AD as total)")
	}
	baseOnly := ezrealTrueshotBarragePrimaryHitExpectedRawFromStats(
		ezrealTrueshotBarragePrimaryHitADBase, ezrealTrueshotBarragePrimaryHitADBase,
		ezrealTrueshotBarragePrimaryHitFixtureAP)
	if math.Abs(baseOnly-ezrealTrueshotBarragePrimaryHitExpectedRaw) < ezrealTrueshotBarragePrimaryHitTol {
		t.Fatal("zero-bonus raw must differ from bonus-AD raw (formula must sub ad.base)")
	}
	minionModified := 300.0 + ezrealTrueshotBarrageBonusADRatio*bonus +
		ezrealTrueshotBarrageAPRatio*ezrealTrueshotBarragePrimaryHitFixtureAP
	if math.Abs(minionModified-ezrealTrueshotBarragePrimaryHitExpectedRaw) < ezrealTrueshotBarragePrimaryHitTol {
		t.Fatal("minion/monster modified raw must differ from champion primary raw (must not model modified branch)")
	}
	mit := expectedMitigatedMagic(raw, ezrealTrueshotBarragePrimaryHitTargetMR)
	if math.Abs(mit-ezrealTrueshotBarragePrimaryHitExpectedMitigated) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, ezrealTrueshotBarragePrimaryHitExpectedMitigated)
	}
}

// TestEzrealTrueshotBarragePrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent R provider: one magic damage op (bonus AD + AP), cost/CD, fixture bonus-AD
// modifier with base AD60, no listener/state/P/Q/W/E/basic graph.
func TestEzrealTrueshotBarragePrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadEzrealTrueshotBarragePrimaryHitFixture(t)
	assertEzrealTrueshotBarragePrimaryHitProviderShape(t, compileReq)
	if ezrealTrueshotBarragePrimaryHitProviderRef == ezrealRSFProviderRefAlias ||
		ezrealTrueshotBarragePrimaryHitProviderRef == ezrealRSFProviderRefRuntime ||
		ezrealTrueshotBarragePrimaryHitProviderRef == ezrealRSFProviderRef ||
		ezrealTrueshotBarragePrimaryHitStableID == ezrealRSFStableIDAlias ||
		ezrealTrueshotBarragePrimaryHitStableID == ezrealRSFStableID {
		t.Fatal("trueshot_barrage primary-hit must not reuse Rising Spell Force provider refs")
	}
	if ezrealTrueshotBarragePrimaryHitAbilityKey == "basic_attack" ||
		ezrealTrueshotBarragePrimaryHitAbilityKey == "rising_spell_force" ||
		ezrealTrueshotBarragePrimaryHitAbilityKey == ezrealRSFSpellKey ||
		ezrealTrueshotBarragePrimaryHitAbilityKey == "mystic_shot" ||
		ezrealTrueshotBarragePrimaryHitAbilityKey == "essence_flux" ||
		ezrealTrueshotBarragePrimaryHitAbilityKey == "arcane_shift" {
		t.Fatal("trueshot_barrage must not reuse Rising Spell Force / Q / W / E / basic-attack ability keys")
	}
	if strings.Contains(ezrealTrueshotBarragePrimaryHitDamageOpRef, "rising_spell_force") ||
		strings.Contains(ezrealTrueshotBarragePrimaryHitDamageOpRef, "mystic_shot") ||
		strings.Contains(ezrealTrueshotBarragePrimaryHitDamageOpRef, "essence_flux") ||
		strings.Contains(ezrealTrueshotBarragePrimaryHitDamageOpRef, "arcane_shift") {
		t.Fatal("trueshot_barrage primary-hit must not reuse P/Q/W/E operation refs")
	}
	if ezrealTrueshotBarragePrimaryHitAbilityID != "ability_hero_ezreal_r_trueshot_barrage_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if ezrealTrueshotBarragePrimaryHitStableID != "hero_ezreal_r_trueshot_barrage_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
	if ezrealTrueshotBarragePrimaryHitProviderRef != "provider_hero_ezreal_r_trueshot_barrage_primary_hit" {
		t.Fatal("provider ref constant drifted")
	}
	if ezrealTrueshotBarragePrimaryHitPlanRev != "ezreal-r-trueshot-barrage-primary-hit-phase-a-v2" {
		t.Fatal("plan-rev fixture metadata drifted")
	}

	blob, err := json.Marshal(compileReq.SharedProviders)
	if err != nil {
		t.Fatalf("marshal SharedProviders: %v", err)
	}
	compiled := string(blob)
	for _, banned := range []string{
		"rising_spell_force", "mystic_shot", "essence_flux", "arcane_shift",
		"basic_attack", "projectile", "multi_target", "minion", "monster",
		"cast_delay", "queue",
	} {
		if strings.Contains(compiled, banned) {
			t.Fatalf("compiled fixture must not contain excluded branch %q", banned)
		}
	}
}

// TestEzrealTrueshotBarragePrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-3 primary-champion immediate magic damage scaffold: cost 100,
// CD 90000ms exact boundary, baseAD60/resolvedAD110/AP200, one magic hit per successful
// cast (no AA/crit/phantom/cast-delay/queue/projectile/geometry/direction/multitarget/
// sight/minion/monster/P/Q/W/E). Runtime damage type is magic (20221), not physical (20220).
//
// Explicit exclusions (not modeled or denied as live-game absences): cast 1s / queue 0.5 /
// Effect-at-cast-start / projectile / travel / global geometry / direction / multitarget /
// sight / minion-monster modified damage / ranks 1–2 / P/Q/W/E / basic / loadout / full fidelity.
func TestEzrealTrueshotBarragePrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadEzrealTrueshotBarragePrimaryHitFixture(t)
	assertEzrealTrueshotBarragePrimaryHitProviderShape(t, compileReq)

	ref := ezrealTrueshotBarragePrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 89999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 90000},
	}
	runReq.StopPolicy.DurationMs = 90100

	done := runEzrealTrueshotBarragePrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if ezrealTrueshotBarragePrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findEzrealTrueshotBarragePrimaryHitAbilityStat(t, done)
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

	items := ezrealTrueshotBarragePrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("trueshot_barrage damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 90000}
	wantMit := expectedMitigatedMagic(ezrealTrueshotBarragePrimaryHitExpectedRaw, ezrealTrueshotBarragePrimaryHitTargetMR)
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		if evidenceDataBool(item.Data, "phantom") {
			t.Fatalf("damage[%d] must not be phantom: %+v", i, item.Data)
		}
		if evidenceDataString(item.Data, "phase") != "original" {
			t.Fatalf("damage[%d] phase=%q want original", i, evidenceDataString(item.Data, "phase"))
		}
		if evidenceDataString(item.Data, "damageType") != "damage/magic" {
			t.Fatalf("damage[%d] type=%q want damage/magic (runtime 20221)", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataString(item.Data, "damageType") == "damage/physical" {
			t.Fatalf("damage[%d] must not be physical (20220)", i)
		}
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q want %q", i, evidenceDataString(item.Data, "abilityRef"), ref)
		}
		if evidenceDataString(item.Data, "providerRef") != ezrealTrueshotBarragePrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), ezrealTrueshotBarragePrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != ezrealTrueshotBarragePrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), ezrealTrueshotBarragePrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		rawAmt := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(rawAmt-ezrealTrueshotBarragePrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, rawAmt, ezrealTrueshotBarragePrimaryHitExpectedRaw)
		}
		if math.Abs(mit-wantMit) > 1e-9 {
			t.Fatalf("damage[%d] mitigatedAmount=%v want %v", i, mit, wantMit)
		}
		mitSum += mit
	}

	wantDealt := 2 * wantMit
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-ezrealTrueshotBarragePrimaryHitHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, ezrealTrueshotBarragePrimaryHitHPAfter2)
	}
	wantHP := ezrealTrueshotBarragePrimaryHitTargetHP - wantDealt
	if math.Abs(wantHP-ezrealTrueshotBarragePrimaryHitHPAfter2) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("HP cross-check=%v want %v", wantHP, ezrealTrueshotBarragePrimaryHitHPAfter2)
	}

	gotMana := ezrealTrueshotBarragePrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-ezrealTrueshotBarragePrimaryHitManaAfter2) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 200; skipped attempt costs 0)",
			gotMana, ezrealTrueshotBarragePrimaryHitManaAfter2)
	}
	if math.Abs((ezrealTrueshotBarragePrimaryHitFixtureMana-gotMana)-200) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("mana spent=%v want 200", ezrealTrueshotBarragePrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/P/Q/W/E/minion/monster hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-ezrealTrueshotBarragePrimaryHitADResolved) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("ad.resolved=%v want %v (total AD after fixture bonus)", got, ezrealTrueshotBarragePrimaryHitADResolved)
	}
	if got := sourceAttrBase(t, done.FinalSnapshot, "ad"); math.Abs(got-ezrealTrueshotBarragePrimaryHitADBase) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)", got, ezrealTrueshotBarragePrimaryHitADBase)
	}
	bonusAD := sourceAttrResolved(t, done.FinalSnapshot, "ad") - sourceAttrBase(t, done.FinalSnapshot, "ad")
	if math.Abs(bonusAD-50) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("bonus AD=%v want 50", bonusAD)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ap"); math.Abs(got-ezrealTrueshotBarragePrimaryHitFixtureAP) > ezrealTrueshotBarragePrimaryHitTol {
		t.Fatalf("ap.resolved=%v want %v", got, ezrealTrueshotBarragePrimaryHitFixtureAP)
	}

	// Exclusions / no hidden behavior: Phase-A fixture only — not a claim about live game.
	p := ezrealTrueshotBarragePrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider missing after run")
	}
	if len(p.Listeners) != 0 || len(p.InitialStateSchema) != 0 || p.Lifecycle != nil {
		t.Fatal("fixture must not grow listener/state/lifecycle after compile (Phase-A exclusions)")
	}
	a := p.Abilities[0]
	if a.TickSpec != nil || a.ListenerSpec != nil || a.CastCondition != nil || len(a.StateSchema) != 0 {
		t.Fatal("fixture ability must not carry cast/queue/projectile/AOE/listener/state surfaces")
	}
	for _, op := range a.Operations {
		if op.Operation != "damage" || op.DamageType != "damage/magic" {
			t.Fatalf("fixture must remain single magic damage op only: %+v", op)
		}
	}
	outBlob, err := json.Marshal(done.Summary)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	out := string(outBlob)
	for _, banned := range []string{
		"rising_spell_force", "mystic_shot", "essence_flux", "arcane_shift",
		"projectile", "multi_target", "minion", "monster",
	} {
		if strings.Contains(out, banned) {
			t.Fatalf("runtime summary must not contain excluded branch %q", banned)
		}
	}
}
