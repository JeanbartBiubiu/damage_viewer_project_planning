package runtime

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_twistedfate Q Wild Cards / 万能牌 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: twisted-fate-q-wild-cards-primary-hit-phase-a-v2).
//
// Frozen boundary:
//
//	rank5_primary_target_single_hit; immediate_impact_scaffold;
//	magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget
//
// Wiki authority (repository sidecar only; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_twistedfate|Q|万能牌
//	Request Template:Data Twisted Fate/Q → resolved Template:Data Twisted Fate/Wild Cards
//	wikiPageId 1309741 / rev 3950864 / timestamp 2025-08-31T01:31:17Z
//	sidecar rawByteSize 1237 / SHA256 9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597
//	数据参考/lol-wiki-current-champions/normalized/generic/twistedfate-q.json
//	pages/raw siblings: pages/twistedfate-q.json, raw/twistedfate-q.wikitext
//	Caveat: local raw may be 1235 bytes / SHAdd26f599… due newline materialization;
//	assert sidecar canonical metadata only — do not require local raw len/hash == sidecar.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_twistedfate_q_wild_cards_primary_hit
//     (not basic-attack / Stacked Deck reuse)
//   - ability ability_hero_twistedfate_q_wild_cards_primary_hit with ability_key
//     wild_cards: active; mana 100; cooldown 5000 ms
//   - Exactly one immediate direct-target magic damage op:
//     240 + 0.50*(source.attr.ad.resolved - source.attr.ad.base)
//       + 0.85*source.attr.ap.resolved
//     (bonus AD via sub(ad.resolved, ad.base); never bake total-AD or fixture
//     bonus-AD constants into the formula tree)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / state schema / events / cast-delay / fan / three-card /
//     cone / projectile / travel / collision / pass / geometry / AOE /
//     multitarget / spellshield / repeat / phantom / equipment / loadout /
//     Stacked Deck / on-hit / basic-attack behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Wiki describes Effect at cast time end, a fan of three cards in a cone,
//   projectile travel/collision/pass, and once-per-pass — but this scaffold is
//   immediate primary-target magic damage only. once-per-pass is source
//   justification for the single direct hit, not runtime pass fidelity.
//   Do not claim or invent cast-delay/fan/three-card/cone/projectile/travel/
//   collision/pass/geometry/range/width/speed/angles, AOE/multitarget/
//   all-enemies/repeat, spellshield, ranks 1–4, equipment/loadout, basic /
//   Stacked Deck / on-hit coupling, live publish, or full fidelity.

const (
	tfWildCardsPrimaryHitCandidateKey  = "hero_skill|hero_twistedfate|Q|万能牌"
	tfWildCardsPrimaryHitRequestTitle  = "Template:Data Twisted Fate/Q"
	tfWildCardsPrimaryHitResolvedTitle = "Template:Data Twisted Fate/Wild Cards"
	tfWildCardsPrimaryHitWikiPageID    = 1309741
	tfWildCardsPrimaryHitRevisionID    = 3950864
	tfWildCardsPrimaryHitTimestamp     = "2025-08-31T01:31:17Z"
	tfWildCardsPrimaryHitRawBytes      = 1237
	tfWildCardsPrimaryHitContentSHA    = "9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597"
	tfWildCardsPrimaryHitBoundary      = "rank5_primary_target_single_hit; immediate_impact_scaffold; " +
		"magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget"

	tfWildCardsPrimaryHitProviderRef = "provider_hero_twistedfate_q_wild_cards_primary_hit"
	tfWildCardsPrimaryHitStableID    = "hero_twistedfate_q_wild_cards_primary_hit"
	tfWildCardsPrimaryHitAbilityID   = "ability_hero_twistedfate_q_wild_cards_primary_hit"
	tfWildCardsPrimaryHitAbilityKey  = "wild_cards"
	tfWildCardsPrimaryHitDamageOpRef = "op:twisted_fate_wild_cards_primary_hit_damage"
	tfWildCardsPrimaryHitBonusADMod  = "fixture_twisted_fate_wild_cards_primary_hit_bonus_ad"

	// Must not collide with / reuse basic-attack or Stacked Deck providers.
	tfBasicAttackProviderRefAlias   = "provider_hero_twistedfate_basic_attack"
	tfStackedDeckProviderRefAlias   = "provider_hero_twistedfate_stacked_deck"
	tfStackedDeckProviderRefRuntime = "hero:twisted_fate_stacked_deck"
	tfStackedDeckStableIDRuntime    = "hero_twistedfate_e_stacked_deck"

	tfWildCardsPrimaryHitBaseDamage   = 240.0
	tfWildCardsPrimaryHitBonusADRatio = 0.50
	tfWildCardsPrimaryHitAPRatio      = 0.85
	tfWildCardsPrimaryHitManaCost     = 100.0
	tfWildCardsPrimaryHitCDMs         = 5000.0

	// Fixture: base AD52 + flat +48 → resolved total AD100; AP100; mana333.
	tfWildCardsPrimaryHitADBase      = 52.0
	tfWildCardsPrimaryHitADResolved  = 100.0
	tfWildCardsPrimaryHitFixtureAP   = 100.0
	tfWildCardsPrimaryHitFixtureMana = 333.0
	tfWildCardsPrimaryHitTargetMR    = 100.0
	tfWildCardsPrimaryHitTargetHP    = 1000.0

	// Independent cross-check: bonusAD=48 + AP=100 → raw 349; MR 100 → mitigated 174.5.
	tfWildCardsPrimaryHitExpectedRaw       = 349.0
	tfWildCardsPrimaryHitExpectedMitigated = 174.5
	tfWildCardsPrimaryHitManaAfter2        = 133.0 // 333 - 100 - 100
	tfWildCardsPrimaryHitHPAfter2          = 651.0 // 1000 - 174.5 - 174.5

	tfWildCardsPrimaryHitTol = 1e-9
)

func tfWildCardsPrimaryHitExpectedRawFromStats(resolvedAD, baseAD, resolvedAP float64) float64 {
	return tfWildCardsPrimaryHitBaseDamage +
		tfWildCardsPrimaryHitBonusADRatio*(resolvedAD-baseAD) +
		tfWildCardsPrimaryHitAPRatio*resolvedAP
}

func tfWildCardsPrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := tfWildCardsPrimaryHitBaseDamage
	adRatio := tfWildCardsPrimaryHitBonusADRatio
	apRatio := tfWildCardsPrimaryHitAPRatio
	// Nested binary add: base + bonusAD + AP (generic add is binary-only).
	// Bonus AD = sub(ad.resolved, ad.base) — never bake fixture constants.
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

func tfWildCardsPrimaryHitAbility() model.AbilityDefinition {
	cost := tfWildCardsPrimaryHitManaCost
	cd := tfWildCardsPrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: tfWildCardsPrimaryHitAbilityKey,
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
				DamageType:    "damage/magic",
				Ref:           tfWildCardsPrimaryHitDamageOpRef,
				Amount:        tfWildCardsPrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func tfWildCardsPrimaryHitProviderDef() model.ProviderDefinition {
	bonusAD := tfWildCardsPrimaryHitADResolved - tfWildCardsPrimaryHitADBase
	return model.ProviderDefinition{
		ProviderKey: tfWildCardsPrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    tfWildCardsPrimaryHitStableID,
		// Fixture-only flat AD so ad.base stays 52 while ad.resolved becomes 100
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: tfWildCardsPrimaryHitBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}},
		Abilities: []model.AbilityDefinition{tfWildCardsPrimaryHitAbility()},
	}
}

func tfWildCardsPrimaryHitAbilityRef() string {
	return "source.provider[" + tfWildCardsPrimaryHitProviderRef + "].ability[" + tfWildCardsPrimaryHitAbilityKey + "]"
}

func configureTFWildCardsPrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{tfWildCardsPrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: tfWildCardsPrimaryHitProviderRef, DefinitionRef: tfWildCardsPrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: tfWildCardsPrimaryHitProviderRef, DefinitionRef: tfWildCardsPrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureTFWildCardsPrimaryHitTypes(req *model.CompileRequest) {
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

func loadTFWildCardsPrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureTFWildCardsPrimaryHitTypes(&compileReq)
	configureTFWildCardsPrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: tfWildCardsPrimaryHitADBase, Current: tfWildCardsPrimaryHitADBase,
		Max: tfWildCardsPrimaryHitADBase, Resolved: tfWildCardsPrimaryHitADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: tfWildCardsPrimaryHitFixtureAP, Current: tfWildCardsPrimaryHitFixtureAP,
		Max: tfWildCardsPrimaryHitFixtureAP, Resolved: tfWildCardsPrimaryHitFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: tfWildCardsPrimaryHitFixtureMana, Max: tfWildCardsPrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: tfWildCardsPrimaryHitTargetHP, Current: tfWildCardsPrimaryHitTargetHP,
		Max: tfWildCardsPrimaryHitTargetHP, Resolved: tfWildCardsPrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: tfWildCardsPrimaryHitTargetMR, Current: tfWildCardsPrimaryHitTargetMR,
		Max: tfWildCardsPrimaryHitTargetMR, Resolved: tfWildCardsPrimaryHitTargetMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runTFWildCardsPrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func tfWildCardsPrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func tfWildCardsPrimaryHitSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func tfWildCardsPrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func tfWildCardsPrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != tfWildCardsPrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func tfWildCardsPrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == tfWildCardsPrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertTFWildCardsPrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := tfWildCardsPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_twistedfate_q_wild_cards_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != tfWildCardsPrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, tfWildCardsPrimaryHitProviderRef)
	}
	if p.StableID != tfWildCardsPrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, tfWildCardsPrimaryHitStableID)
	}
	if p.ProviderKey == tfBasicAttackProviderRefAlias || p.StableID == tfBasicAttackProviderRefAlias ||
		p.ProviderKey == tfStackedDeckProviderRefAlias || p.StableID == tfStackedDeckProviderRefAlias ||
		p.ProviderKey == tfStackedDeckProviderRefRuntime || p.StableID == tfStackedDeckStableIDRuntime ||
		p.ProviderKey == tfStackedDeckStableIDRuntime || p.StableID == tfStackedDeckProviderRefRuntime {
		t.Fatal("wild_cards primary-hit must not reuse basic-attack / Stacked Deck provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / Stacked Deck coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no Stacked Deck / pass / state schema)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat; no equipment/Stacked Deck)", len(p.Modifiers))
	}
	if p.Modifiers[0].ModifierKey != tfWildCardsPrimaryHitBonusADMod ||
		p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
		p.Modifiers[0].ValuePolicy != "add" {
		t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], tfWildCardsPrimaryHitBonusADMod)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), tfWildCardsPrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != tfWildCardsPrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, tfWildCardsPrimaryHitAbilityKey, tfWildCardsPrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("wild_cards must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-tfWildCardsPrimaryHitManaCost) > tfWildCardsPrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-tfWildCardsPrimaryHitCDMs) > tfWildCardsPrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 5000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no cast/projectile/fan/pass)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("wild_cards damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("wild_cards damage must not be copyable on hit")
	}
	if op.Ref != tfWildCardsPrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, tfWildCardsPrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(base+bonusAD, AP)", op.Amount)
	}
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const, mul(adRatio, sub(ad.resolved, ad.base)))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-tfWildCardsPrimaryHitBaseDamage) > tfWildCardsPrimaryHitTol {
		t.Fatalf("base const=%+v want 240", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-tfWildCardsPrimaryHitBonusADRatio) > tfWildCardsPrimaryHitTol {
		t.Fatalf("bonus-AD ratio=%+v want 0.50", adMul.Args[0])
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want sub(source.attr.ad.resolved, source.attr.ad.base)", sub)
	}
	// Formula must not bake total-AD read alone or fixture bonus-AD constants.
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
		math.Abs(*apMul.Args[0].Value-tfWildCardsPrimaryHitAPRatio) > tfWildCardsPrimaryHitTol {
		t.Fatalf("AP ratio=%+v want 0.85", apMul.Args[0])
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
			banned.Operation == "spellshield" {
			t.Fatalf("wild_cards must not include cast/fan/projectile/geometry/pass/AOE/spellshield op: %+v", banned)
		}
	}
}

func findTFWildCardsPrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := tfWildCardsPrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func tfWildCardsPrimaryHitWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "twistedfate-q.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func tfWildCardsPrimaryHitWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "twistedfate-q.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func tfWildCardsPrimaryHitWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "twistedfate-q.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type tfWildCardsPrimaryHitWikiSidecar struct {
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
		Cooldown     string `json:"cooldown"`
		Cost         string `json:"cost"`
		Costtype     string `json:"costtype"`
		Damagetype   string `json:"damagetype"`
		Notes        string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

func tfWildCardsPrimaryHitLoadWikiSidecar(t *testing.T) tfWildCardsPrimaryHitWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(tfWildCardsPrimaryHitWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc tfWildCardsPrimaryHitWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

// TestTwistedFateWildCardsPrimaryHitWikiSidecarIdentityAndBoundary locks repository sidecar
// identity plus the frozen Phase-A completed-boundary constant. Positively asserts
// magic/formula/cost/CD/once-per-pass and excluded fan/three-card/cone/projectile/
// cast-time wording while compile/runtime tests prove those excluded branches are
// absent from the immediate scaffold.
func TestTwistedFateWildCardsPrimaryHitWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := tfWildCardsPrimaryHitLoadWikiSidecar(t)
	if doc.CandidateKey != tfWildCardsPrimaryHitCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, tfWildCardsPrimaryHitCandidateKey)
	}
	if doc.RequestTitle != tfWildCardsPrimaryHitRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, tfWildCardsPrimaryHitRequestTitle)
	}
	if doc.ResolvedTitle != tfWildCardsPrimaryHitResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, tfWildCardsPrimaryHitResolvedTitle)
	}
	if doc.WikiPageID != tfWildCardsPrimaryHitWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, tfWildCardsPrimaryHitWikiPageID)
	}
	if doc.RevisionID != tfWildCardsPrimaryHitRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, tfWildCardsPrimaryHitRevisionID)
	}
	if doc.RevisionTimestamp != tfWildCardsPrimaryHitTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, tfWildCardsPrimaryHitTimestamp)
	}
	if doc.ContentSHA256 != tfWildCardsPrimaryHitContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, tfWildCardsPrimaryHitContentSHA)
	}
	if doc.RawByteSize != tfWildCardsPrimaryHitRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, tfWildCardsPrimaryHitRawBytes)
	}
	if doc.SkillKey != "Q" || doc.ZhDisplayName != "万能牌" || doc.OwnerID != "hero_twistedfate" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want Q/万能牌/hero_twistedfate",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{"description", "leveling", "description2", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "{{ap|60|70|80|90|100}}\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "{{ap|60|70|80|90|100}}\n")
	}
	if doc.Fields.Cooldown != "{{ap|6 to 5}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|6 to 5}}\n")
	}
	if doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("fields.damagetype=%q want Magic", doc.Fields.Damagetype)
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("fields.costtype=%q want Mana", doc.Fields.Costtype)
	}
	if doc.Fields.Description == "" {
		t.Fatal("description empty (fail closed; expect magic / fan / cone wording)")
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") {
		t.Fatalf("description missing magic damage wording: %q", doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "fan of three cards") {
		t.Fatalf("description missing fan of three cards wording (source evidence; excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "cone") {
		t.Fatalf("description missing cone wording (source evidence; excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if doc.Fields.Leveling == "" {
		t.Fatal("leveling empty (fail closed; expect Magic Damage rank formula)")
	}
	if !strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling missing Magic Damage label: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|60 to 240}}") {
		t.Fatalf("leveling missing rank formula {{ap|60 to 240}}: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "50% '''bonus''' AD") {
		t.Fatalf("leveling missing 50%% bonus AD ratio: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "85% AP") {
		t.Fatalf("leveling missing 85%% AP ratio: %q", doc.Fields.Leveling)
	}
	if doc.Fields.Description2 == "" {
		t.Fatal("description2 empty (fail closed; expect once-per-pass wording)")
	}
	if !strings.Contains(doc.Fields.Description2, "once per pass") {
		t.Fatalf("description2 missing once-per-pass wording (justifies single direct hit; not runtime pass fidelity): %q",
			doc.Fields.Description2)
	}
	if doc.Fields.Notes == "" {
		t.Fatal("notes empty (fail closed; expect Effect at cast time end)")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing Effect at cast time end (excluded from immediate scaffold): %q",
			doc.Fields.Notes)
	}

	_ = tfWildCardsPrimaryHitWikiPagesPath(t)

	raw, err := os.ReadFile(tfWildCardsPrimaryHitWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("wiki raw empty (fail closed)")
	}
	// Do not assert local raw len/hash equals sidecar canonical metadata
	// (local may be 1235 bytes / SHAdd26f599… due repository newline materialization).
	if tfWildCardsPrimaryHitBoundary != "rank5_primary_target_single_hit; immediate_impact_scaffold; "+
		"magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget" {
		t.Fatal("frozen boundary constant drifted")
	}
}

// TestTwistedFateWildCardsPrimaryHitRank5DamageFormulaCrossCheck: independent numeric
// cross-check 240 + 0.50*(100-52) + 0.85*100 = 349; MR 100 → mitigated 174.5.
// Also proves bonus-AD path differs from total-AD (100) alone.
func TestTwistedFateWildCardsPrimaryHitRank5DamageFormulaCrossCheck(t *testing.T) {
	bonus := tfWildCardsPrimaryHitADResolved - tfWildCardsPrimaryHitADBase
	if math.Abs(bonus-48) > tfWildCardsPrimaryHitTol {
		t.Fatalf("fixture flat AD=%v want 48 (resolved 100 - base 52)", bonus)
	}
	raw := tfWildCardsPrimaryHitExpectedRawFromStats(
		tfWildCardsPrimaryHitADResolved, tfWildCardsPrimaryHitADBase, tfWildCardsPrimaryHitFixtureAP)
	if math.Abs(raw-tfWildCardsPrimaryHitExpectedRaw) > tfWildCardsPrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, tfWildCardsPrimaryHitExpectedRaw)
	}
	totalADOnly := tfWildCardsPrimaryHitBaseDamage +
		tfWildCardsPrimaryHitBonusADRatio*tfWildCardsPrimaryHitADResolved +
		tfWildCardsPrimaryHitAPRatio*tfWildCardsPrimaryHitFixtureAP
	if math.Abs(totalADOnly-tfWildCardsPrimaryHitExpectedRaw) < tfWildCardsPrimaryHitTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw (formula must not treat AD as total)")
	}
	baseOnly := tfWildCardsPrimaryHitExpectedRawFromStats(
		tfWildCardsPrimaryHitADBase, tfWildCardsPrimaryHitADBase, tfWildCardsPrimaryHitFixtureAP)
	if math.Abs(baseOnly-tfWildCardsPrimaryHitExpectedRaw) < tfWildCardsPrimaryHitTol {
		t.Fatal("zero-bonus raw must differ from bonus-AD raw (formula must sub ad.base)")
	}
	mit := expectedMitigatedMagic(raw, tfWildCardsPrimaryHitTargetMR)
	if math.Abs(mit-tfWildCardsPrimaryHitExpectedMitigated) > tfWildCardsPrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, tfWildCardsPrimaryHitExpectedMitigated)
	}
}

// TestTwistedFateWildCardsPrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent Q provider: one magic damage op (bonus AD + AP), cost/CD, no Stacked Deck/basic.
func TestTwistedFateWildCardsPrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadTFWildCardsPrimaryHitFixture(t)
	assertTFWildCardsPrimaryHitProviderShape(t, compileReq)
	if tfWildCardsPrimaryHitProviderRef == tfBasicAttackProviderRefAlias ||
		tfWildCardsPrimaryHitProviderRef == tfStackedDeckProviderRefAlias ||
		tfWildCardsPrimaryHitProviderRef == tfStackedDeckProviderRefRuntime ||
		tfWildCardsPrimaryHitStableID == tfBasicAttackProviderRefAlias ||
		tfWildCardsPrimaryHitStableID == tfStackedDeckProviderRefAlias ||
		tfWildCardsPrimaryHitStableID == tfStackedDeckStableIDRuntime {
		t.Fatal("wild_cards primary-hit must not reuse basic-attack / Stacked Deck provider refs")
	}
	if tfWildCardsPrimaryHitAbilityKey == "basic_attack" ||
		tfWildCardsPrimaryHitAbilityKey == "stacked_deck" ||
		tfWildCardsPrimaryHitAbilityKey == tfStackedDeckHitAbility {
		t.Fatal("wild_cards must not reuse Stacked Deck / basic-attack ability keys")
	}
	if tfWildCardsPrimaryHitDamageOpRef == tfStackedDeckDamageOpRef {
		t.Fatal("wild_cards primary-hit must not reuse Stacked Deck operation refs")
	}
	if tfWildCardsPrimaryHitAbilityID != "ability_hero_twistedfate_q_wild_cards_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if tfWildCardsPrimaryHitStableID != "hero_twistedfate_q_wild_cards_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
}

// TestTwistedFateWildCardsPrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target immediate magic damage scaffold: cost 100,
// CD 5000ms exact boundary, one magic hit per successful cast (no AA/crit/phantom/
// cast-delay/fan/projectile/geometry/pass/Stacked Deck).
func TestTwistedFateWildCardsPrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadTFWildCardsPrimaryHitFixture(t)
	assertTFWildCardsPrimaryHitProviderShape(t, compileReq)

	ref := tfWildCardsPrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100

	done := runTFWildCardsPrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if tfWildCardsPrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findTFWildCardsPrimaryHitAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt4999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 4999 {
			t.Fatalf("cooldown skip TimeMs=%d want 4999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 5000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 5000", item.Data["readyAtMs"])
		}
		skipAt4999 = true
	}
	if !skipAt4999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=4999 with readyAtMs=5000")
	}

	items := tfWildCardsPrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("wild_cards damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 5000}
	wantMit := expectedMitigatedMagic(tfWildCardsPrimaryHitExpectedRaw, tfWildCardsPrimaryHitTargetMR)
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
			t.Fatalf("damage[%d] type=%q", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q want %q", i, evidenceDataString(item.Data, "abilityRef"), ref)
		}
		if evidenceDataString(item.Data, "providerRef") != tfWildCardsPrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), tfWildCardsPrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != tfWildCardsPrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), tfWildCardsPrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-tfWildCardsPrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, tfWildCardsPrimaryHitExpectedRaw)
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
	if math.Abs(done.Summary.TargetFinalHp-tfWildCardsPrimaryHitHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, tfWildCardsPrimaryHitHPAfter2)
	}
	wantHP := tfWildCardsPrimaryHitTargetHP - wantDealt
	if math.Abs(wantHP-tfWildCardsPrimaryHitHPAfter2) > tfWildCardsPrimaryHitTol {
		t.Fatalf("HP cross-check=%v want %v", wantHP, tfWildCardsPrimaryHitHPAfter2)
	}

	gotMana := tfWildCardsPrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-tfWildCardsPrimaryHitManaAfter2) > tfWildCardsPrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 200; skipped attempt costs 0)", gotMana, tfWildCardsPrimaryHitManaAfter2)
	}
	if math.Abs((tfWildCardsPrimaryHitFixtureMana-gotMana)-200) > tfWildCardsPrimaryHitTol {
		t.Fatalf("mana spent=%v want 200", tfWildCardsPrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/Stacked Deck/fan/pass hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-tfWildCardsPrimaryHitADResolved) > tfWildCardsPrimaryHitTol {
		t.Fatalf("ad.resolved=%v want %v (total AD after fixture bonus)", got, tfWildCardsPrimaryHitADResolved)
	}
	if got := tfWildCardsPrimaryHitSourceAttrBase(t, done.FinalSnapshot, "ad"); math.Abs(got-tfWildCardsPrimaryHitADBase) > tfWildCardsPrimaryHitTol {
		t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)", got, tfWildCardsPrimaryHitADBase)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ap"); math.Abs(got-tfWildCardsPrimaryHitFixtureAP) > tfWildCardsPrimaryHitTol {
		t.Fatalf("ap.resolved=%v want %v", got, tfWildCardsPrimaryHitFixtureAP)
	}
}
