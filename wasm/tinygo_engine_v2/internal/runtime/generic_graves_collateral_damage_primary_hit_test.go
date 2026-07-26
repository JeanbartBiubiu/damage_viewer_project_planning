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

// hero_graves R Collateral Damage / 终极爆弹 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: graves-r-collateral-damage-primary-hit-phase-a-v2).
//
// Frozen boundary:
//
//	rank3_primary_target_single_hit; immediate_impact_scaffold;
//	physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage
//
// Wiki authority (repository sidecar only; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_graves|R|终极爆弹
//	Request Template:Data Graves/R → resolved Template:Data Graves/Collateral Damage
//	wikiPageId 1307373 / rev 4007499 / timestamp 2026-04-11T22:21:36Z
//	sidecar rawByteSize 2722 / SHA256 834843a7722fc9463e21e8d636b8adc644c220928b90f7bb4afedbaa08f85dd1
//	数据参考/lol-wiki-current-champions/normalized/generic/graves-r.json
//	pages/raw siblings: pages/graves-r.json, raw/graves-r.wikitext
//	Local raw materialization is exactly 2723 bytes with one terminal LF; removing
//	exactly that LF yields the canonical 2722 bytes and SHA. Do not assert the
//	untrimmed local raw hash equals the canonical hash.
//
// Rank-3 Phase-A contract:
//   - Independent provider provider_hero_graves_r_collateral_damage_primary_hit
//     (not New Destiny / Quickdraw / Smoke Screen / basic-attack / True Grit reuse)
//   - ability ability_hero_graves_r_collateral_damage_primary_hit with ability_key
//     collateral_damage: active; mana 100; cooldown 60000 ms
//   - Exactly one immediate direct-target physical damage op:
//     575 + 1.50*(source.attr.ad.resolved - source.attr.ad.base)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / state / cast-delay / recoil/dash / projectile / travel /
//     collision / direction / geometry / line / AOE / multitarget / explosion /
//     cone / reduced damage / repeat / phantom / equipment / loadout / on-hit /
//     P/E/W/basic behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Wiki describes cast time, direction shell / projectile travel/collision,
//   recoil dash, explosion cone dealing reduced damage to additional enemies —
//   but this scaffold is immediate primary-target full shell physical damage
//   only. description2/leveling2 establish the reduced cone branch as source
//   evidence for exclusion, not runtime behavior. Do not claim the explosion
//   does not happen in game. Do not invent cast-delay/recoil/projectile/
//   geometry/line/AOE/multitarget/explosion/cone/reduced-damage, ranks 1–2,
//   P New Destiny / E Quickdraw / W Smoke Screen / basic / ammo / True Grit,
//   live publish, or full fidelity.

const (
	gravesCollateralDamagePrimaryHitCandidateKey  = "hero_skill|hero_graves|R|终极爆弹"
	gravesCollateralDamagePrimaryHitRequestTitle  = "Template:Data Graves/R"
	gravesCollateralDamagePrimaryHitResolvedTitle = "Template:Data Graves/Collateral Damage"
	gravesCollateralDamagePrimaryHitWikiPageID    = 1307373
	gravesCollateralDamagePrimaryHitRevisionID    = 4007499
	gravesCollateralDamagePrimaryHitTimestamp     = "2026-04-11T22:21:36Z"
	gravesCollateralDamagePrimaryHitRawBytes      = 2722
	gravesCollateralDamagePrimaryHitLocalRawBytes = 2723
	gravesCollateralDamagePrimaryHitContentSHA    = "834843a7722fc9463e21e8d636b8adc644c220928b90f7bb4afedbaa08f85dd1"
	gravesCollateralDamagePrimaryHitBoundary      = "rank3_primary_target_single_hit; immediate_impact_scaffold; " +
		"physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage"

	gravesCollateralDamagePrimaryHitProviderRef = "provider_hero_graves_r_collateral_damage_primary_hit"
	gravesCollateralDamagePrimaryHitStableID    = "hero_graves_r_collateral_damage_primary_hit"
	gravesCollateralDamagePrimaryHitAbilityID   = "ability_hero_graves_r_collateral_damage_primary_hit"
	gravesCollateralDamagePrimaryHitAbilityKey  = "collateral_damage"
	gravesCollateralDamagePrimaryHitDamageOpRef = "op:graves_collateral_damage_primary_hit_damage"
	gravesCollateralDamagePrimaryHitBonusADMod  = "fixture_graves_collateral_damage_primary_hit_bonus_ad"

	gravesCollateralDamagePrimaryHitBaseDamage = 575.0
	gravesCollateralDamagePrimaryHitBonusRatio = 1.50
	gravesCollateralDamagePrimaryHitManaCost   = 100.0
	gravesCollateralDamagePrimaryHitCDMs       = 60000.0

	// Fixture: base AD 66 + flat +54 → resolved total AD 120; mana 325.
	gravesCollateralDamagePrimaryHitADBase      = 66.0
	gravesCollateralDamagePrimaryHitADResolved  = 120.0
	gravesCollateralDamagePrimaryHitFixtureMana = 325.0
	gravesCollateralDamagePrimaryHitTargetArmor = 100.0
	gravesCollateralDamagePrimaryHitTargetHP    = 1000.0

	// Independent cross-check: bonusAD=54 → raw 656; armor 100 → mitigated 328.
	gravesCollateralDamagePrimaryHitExpectedRaw       = 656.0
	gravesCollateralDamagePrimaryHitExpectedMitigated = 328.0
	gravesCollateralDamagePrimaryHitManaAfter2        = 125.0 // 325 - 100 - 100
	gravesCollateralDamagePrimaryHitHPAfter2          = 344.0 // 1000 - 328 - 328

	gravesCollateralDamagePrimaryHitTol = 1e-9
)

func gravesCollateralDamagePrimaryHitExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return gravesCollateralDamagePrimaryHitBaseDamage +
		gravesCollateralDamagePrimaryHitBonusRatio*(resolvedAD-baseAD)
}

func gravesCollateralDamagePrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := gravesCollateralDamagePrimaryHitBaseDamage
	ratio := gravesCollateralDamagePrimaryHitBonusRatio
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

func gravesCollateralDamagePrimaryHitAbility() model.AbilityDefinition {
	cost := gravesCollateralDamagePrimaryHitManaCost
	cd := gravesCollateralDamagePrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: gravesCollateralDamagePrimaryHitAbilityKey,
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
				DamageType:    "damage/physical",
				Ref:           gravesCollateralDamagePrimaryHitDamageOpRef,
				Amount:        gravesCollateralDamagePrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func gravesCollateralDamagePrimaryHitProviderDef() model.ProviderDefinition {
	bonusAD := gravesCollateralDamagePrimaryHitADResolved - gravesCollateralDamagePrimaryHitADBase
	return model.ProviderDefinition{
		ProviderKey: gravesCollateralDamagePrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    gravesCollateralDamagePrimaryHitStableID,
		// Fixture-only flat AD so ad.base stays 66 while ad.resolved becomes 120
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: gravesCollateralDamagePrimaryHitBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}},
		Abilities: []model.AbilityDefinition{gravesCollateralDamagePrimaryHitAbility()},
	}
}

func gravesCollateralDamagePrimaryHitAbilityRef() string {
	return "source.provider[" + gravesCollateralDamagePrimaryHitProviderRef + "].ability[" + gravesCollateralDamagePrimaryHitAbilityKey + "]"
}

func configureGravesCollateralDamagePrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{gravesCollateralDamagePrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: gravesCollateralDamagePrimaryHitProviderRef, DefinitionRef: gravesCollateralDamagePrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: gravesCollateralDamagePrimaryHitProviderRef, DefinitionRef: gravesCollateralDamagePrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureGravesCollateralDamagePrimaryHitTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "damage/physical", Domain: "damage"},
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

func loadGravesCollateralDamagePrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureGravesCollateralDamagePrimaryHitTypes(&compileReq)
	configureGravesCollateralDamagePrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: gravesCollateralDamagePrimaryHitADBase, Current: gravesCollateralDamagePrimaryHitADBase,
		Max: gravesCollateralDamagePrimaryHitADBase, Resolved: gravesCollateralDamagePrimaryHitADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: gravesCollateralDamagePrimaryHitFixtureMana, Max: gravesCollateralDamagePrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: gravesCollateralDamagePrimaryHitTargetHP, Current: gravesCollateralDamagePrimaryHitTargetHP,
		Max: gravesCollateralDamagePrimaryHitTargetHP, Resolved: gravesCollateralDamagePrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: gravesCollateralDamagePrimaryHitTargetArmor, Current: gravesCollateralDamagePrimaryHitTargetArmor,
		Max: gravesCollateralDamagePrimaryHitTargetArmor, Resolved: gravesCollateralDamagePrimaryHitTargetArmor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runGravesCollateralDamagePrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func gravesCollateralDamagePrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func gravesCollateralDamagePrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func gravesCollateralDamagePrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != gravesCollateralDamagePrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func gravesCollateralDamagePrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == gravesCollateralDamagePrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertGravesCollateralDamagePrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := gravesCollateralDamagePrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_graves_r_collateral_damage_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != gravesCollateralDamagePrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, gravesCollateralDamagePrimaryHitProviderRef)
	}
	if p.StableID != gravesCollateralDamagePrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, gravesCollateralDamagePrimaryHitStableID)
	}
	if p.ProviderKey == gravesQDProviderRef || p.StableID == gravesQDStableID ||
		p.ProviderKey == gravesNDProviderRef || p.StableID == gravesNDStableID ||
		p.ProviderKey == gravesSmokeScreenPrimaryHitProviderRef || p.StableID == gravesSmokeScreenPrimaryHitStableID ||
		p.ProviderKey == gravesQDStableID || p.StableID == gravesQDProviderRef ||
		p.ProviderKey == gravesNDStableID || p.StableID == gravesNDProviderRef ||
		p.ProviderKey == gravesSmokeScreenPrimaryHitStableID || p.StableID == gravesSmokeScreenPrimaryHitProviderRef {
		t.Fatal("collateral_damage primary-hit must not reuse New Destiny / Quickdraw / Smoke Screen provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / True Grit / P/E/W coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no recoil/cone/explosion/True Grit state)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat; no equipment/True Grit)", len(p.Modifiers))
	}
	if p.Modifiers[0].ModifierKey != gravesCollateralDamagePrimaryHitBonusADMod ||
		p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
		p.Modifiers[0].ValuePolicy != "add" {
		t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], gravesCollateralDamagePrimaryHitBonusADMod)
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil (no projectile/cone/field lifecycle)", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), gravesCollateralDamagePrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != gravesCollateralDamagePrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, gravesCollateralDamagePrimaryHitAbilityKey, gravesCollateralDamagePrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("collateral_damage must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("collateral_damage must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("collateral_damage must not carry tickSpec (no repeat/cone ticks)")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("collateral_damage must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-gravesCollateralDamagePrimaryHitManaCost) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-gravesCollateralDamagePrimaryHitCDMs) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 60000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no cast/recoil/projectile/cone)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("collateral_damage damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("collateral_damage damage must not be copyable on hit")
	}
	if op.Ref != gravesCollateralDamagePrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, gravesCollateralDamagePrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, sub(ad.resolved, ad.base)))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-gravesCollateralDamagePrimaryHitBaseDamage) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("base const=%+v want 575", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-gravesCollateralDamagePrimaryHitBonusRatio) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("bonus ratio=%+v want 1.50", mul.Args[0])
	}
	sub := mul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want sub(source.attr.ad.resolved, source.attr.ad.base)", sub)
	}
	// Formula must not bake total-AD read alone or fixture bonus-AD constants.
	if mul.Args[1].Op == "read" && mul.Args[1].Path == "source.attr.ad.resolved" {
		t.Fatal("bonus-AD branch must not read total ad.resolved alone (must sub base)")
	}
	if mul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "stun" ||
			banned.Operation == "projectile" || banned.Operation == "multi_target" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" ||
			banned.Operation == "field" || banned.Operation == "dash" ||
			banned.Operation == "knockback" || banned.DamageType == "damage/magic" {
			t.Fatalf("collateral_damage must not include cast/recoil/projectile/geometry/AOE/cone/reduced op: %+v", banned)
		}
	}
}

func findGravesCollateralDamagePrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := gravesCollateralDamagePrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func gravesCollateralDamagePrimaryHitWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "graves-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func gravesCollateralDamagePrimaryHitWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "graves-r.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func gravesCollateralDamagePrimaryHitWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "graves-r.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type gravesCollateralDamagePrimaryHitWikiSidecar struct {
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

func gravesCollateralDamagePrimaryHitLoadWikiSidecar(t *testing.T) gravesCollateralDamagePrimaryHitWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(gravesCollateralDamagePrimaryHitWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc gravesCollateralDamagePrimaryHitWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

func gravesCollateralDamagePrimaryHitSHA256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// TestGravesCollateralDamagePrimaryHitWikiSidecarIdentityAndBoundary locks repository sidecar
// identity plus the frozen Phase-A completed-boundary constant. Positively asserts
// same-revision physical shell formula/cost/CD and excluded recoil/projectile/
// explosion-cone/reduced-damage facts in governed strings; compile/runtime prove
// those branches are absent from the immediate scaffold (not modeled).
func TestGravesCollateralDamagePrimaryHitWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := gravesCollateralDamagePrimaryHitLoadWikiSidecar(t)
	if doc.CandidateKey != gravesCollateralDamagePrimaryHitCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, gravesCollateralDamagePrimaryHitCandidateKey)
	}
	if doc.RequestTitle != gravesCollateralDamagePrimaryHitRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, gravesCollateralDamagePrimaryHitRequestTitle)
	}
	if doc.ResolvedTitle != gravesCollateralDamagePrimaryHitResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, gravesCollateralDamagePrimaryHitResolvedTitle)
	}
	if doc.WikiPageID != gravesCollateralDamagePrimaryHitWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, gravesCollateralDamagePrimaryHitWikiPageID)
	}
	if doc.RevisionID != gravesCollateralDamagePrimaryHitRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, gravesCollateralDamagePrimaryHitRevisionID)
	}
	if doc.RevisionTimestamp != gravesCollateralDamagePrimaryHitTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, gravesCollateralDamagePrimaryHitTimestamp)
	}
	if doc.ContentSHA256 != gravesCollateralDamagePrimaryHitContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, gravesCollateralDamagePrimaryHitContentSHA)
	}
	if doc.RawByteSize != gravesCollateralDamagePrimaryHitRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, gravesCollateralDamagePrimaryHitRawBytes)
	}
	if doc.SkillKey != "R" || doc.ZhDisplayName != "终极爆弹" || doc.OwnerID != "hero_graves" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want R/终极爆弹/hero_graves",
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
	if doc.Fields.Cooldown != "{{ap|100 to 60}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|100 to 60}}\n")
	}
	if doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("fields.damagetype=%q want Physical", doc.Fields.Damagetype)
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("fields.costtype=%q want Mana", doc.Fields.Costtype)
	}
	if doc.Fields.Description == "" {
		t.Fatal("description empty (fail closed; expect physical / shell / recoil wording)")
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") {
		t.Fatalf("description missing physical damage wording: %q", doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "{{tip|dash|recoil}}") {
		t.Fatalf("description missing recoil wording (source evidence; excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if doc.Fields.Leveling == "" {
		t.Fatal("leveling empty (fail closed; expect Physical Damage rank formula)")
	}
	if !strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling missing Physical Damage label: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|275 to 575}}") {
		t.Fatalf("leveling missing rank formula {{ap|275 to 575}}: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "150% '''bonus''' AD") {
		t.Fatalf("leveling missing 150%% bonus AD ratio: %q", doc.Fields.Leveling)
	}
	// description2/leveling2 establish reduced cone damage to additional enemies
	// as source evidence for exclusion only — not runtime behavior.
	if doc.Fields.Description2 == "" {
		t.Fatal("description2 empty (fail closed; expect explosion cone / additional enemies)")
	}
	if !strings.Contains(doc.Fields.Description2, "explodes in a cone") {
		t.Fatalf("description2 missing explosion cone wording (excluded from scaffold): %q",
			doc.Fields.Description2)
	}
	if !strings.Contains(doc.Fields.Description2, "reduced damage") {
		t.Fatalf("description2 missing reduced damage wording (excluded from scaffold): %q",
			doc.Fields.Description2)
	}
	if !strings.Contains(doc.Fields.Description2, "additional enemies") {
		t.Fatalf("description2 missing additional enemies wording (excluded from scaffold): %q",
			doc.Fields.Description2)
	}
	if doc.Fields.Leveling2 == "" {
		t.Fatal("leveling2 empty (fail closed; expect Reduced Damage rank formula)")
	}
	if !strings.Contains(doc.Fields.Leveling2, "Reduced Damage") {
		t.Fatalf("leveling2 missing Reduced Damage label: %q", doc.Fields.Leveling2)
	}
	if !strings.Contains(doc.Fields.Leveling2, "{{ap|200 to 440}}") {
		t.Fatalf("leveling2 missing rank formula {{ap|200 to 440}}: %q", doc.Fields.Leveling2)
	}
	if !strings.Contains(doc.Fields.Leveling2, "120% '''bonus''' AD") {
		t.Fatalf("leveling2 missing 120%% bonus AD ratio: %q", doc.Fields.Leveling2)
	}
	if doc.Fields.Notes == "" {
		t.Fatal("notes empty (fail closed; expect Effect at cast time end / spellshield / cone)")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing Effect at cast time end (excluded from immediate scaffold): %q",
			doc.Fields.Notes)
	}

	_ = gravesCollateralDamagePrimaryHitWikiPagesPath(t)

	raw, err := os.ReadFile(gravesCollateralDamagePrimaryHitWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) != gravesCollateralDamagePrimaryHitLocalRawBytes {
		t.Fatalf("local raw len=%d want %d (terminal LF materialization)",
			len(raw), gravesCollateralDamagePrimaryHitLocalRawBytes)
	}
	if raw[len(raw)-1] != '\n' {
		t.Fatal("local raw must end with exactly one terminal LF")
	}
	untrimmedSHA := gravesCollateralDamagePrimaryHitSHA256Hex(raw)
	if untrimmedSHA == gravesCollateralDamagePrimaryHitContentSHA {
		t.Fatal("untrimmed local raw hash must not equal canonical contentSha256 (terminal LF present)")
	}
	trimmed := raw[:len(raw)-1]
	if len(trimmed) != gravesCollateralDamagePrimaryHitRawBytes {
		t.Fatalf("trimmed raw len=%d want %d", len(trimmed), gravesCollateralDamagePrimaryHitRawBytes)
	}
	trimmedSHA := gravesCollateralDamagePrimaryHitSHA256Hex(trimmed)
	if trimmedSHA != gravesCollateralDamagePrimaryHitContentSHA {
		t.Fatalf("trimmed raw sha=%q want canonical %q", trimmedSHA, gravesCollateralDamagePrimaryHitContentSHA)
	}

	if gravesCollateralDamagePrimaryHitBoundary != "rank3_primary_target_single_hit; immediate_impact_scaffold; "+
		"physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage" {
		t.Fatal("frozen boundary constant drifted")
	}
}

// TestGravesCollateralDamagePrimaryHitRank3DamageFormulaCrossCheck: independent numeric
// cross-check 575 + 1.50*(120-66) = 656; armor 100 → mitigated 328.
// Also proves bonus-AD path differs from total-AD (120) alone.
func TestGravesCollateralDamagePrimaryHitRank3DamageFormulaCrossCheck(t *testing.T) {
	bonus := gravesCollateralDamagePrimaryHitADResolved - gravesCollateralDamagePrimaryHitADBase
	if math.Abs(bonus-54) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("bonusAD=%v want 54", bonus)
	}
	raw := gravesCollateralDamagePrimaryHitExpectedRawFromAD(
		gravesCollateralDamagePrimaryHitADResolved, gravesCollateralDamagePrimaryHitADBase)
	if math.Abs(raw-gravesCollateralDamagePrimaryHitExpectedRaw) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, gravesCollateralDamagePrimaryHitExpectedRaw)
	}
	totalADOnly := gravesCollateralDamagePrimaryHitBaseDamage +
		gravesCollateralDamagePrimaryHitBonusRatio*gravesCollateralDamagePrimaryHitADResolved
	if math.Abs(totalADOnly-gravesCollateralDamagePrimaryHitExpectedRaw) < gravesCollateralDamagePrimaryHitTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw (formula must not treat AD as total)")
	}
	baseOnly := gravesCollateralDamagePrimaryHitExpectedRawFromAD(
		gravesCollateralDamagePrimaryHitADBase, gravesCollateralDamagePrimaryHitADBase)
	if math.Abs(baseOnly-gravesCollateralDamagePrimaryHitExpectedRaw) < gravesCollateralDamagePrimaryHitTol {
		t.Fatal("zero-bonus raw must differ from bonus-AD raw (formula must sub ad.base)")
	}
	// Reduced cone formula must not equal primary shell formula (exclusion evidence).
	reducedRaw := 440.0 + 1.20*bonus
	if math.Abs(reducedRaw-gravesCollateralDamagePrimaryHitExpectedRaw) < gravesCollateralDamagePrimaryHitTol {
		t.Fatal("reduced cone raw must differ from primary shell raw (must not model cone damage)")
	}
	mit := expectedMitigatedPhysical(raw, gravesCollateralDamagePrimaryHitTargetArmor)
	if math.Abs(mit-gravesCollateralDamagePrimaryHitExpectedMitigated) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, gravesCollateralDamagePrimaryHitExpectedMitigated)
	}
}

// TestGravesCollateralDamagePrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent R provider: one physical damage op, cost/CD, no listener/state/P/E/W/cone.
func TestGravesCollateralDamagePrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadGravesCollateralDamagePrimaryHitFixture(t)
	assertGravesCollateralDamagePrimaryHitProviderShape(t, compileReq)
	if gravesCollateralDamagePrimaryHitProviderRef == gravesQDProviderRef ||
		gravesCollateralDamagePrimaryHitProviderRef == gravesNDProviderRef ||
		gravesCollateralDamagePrimaryHitProviderRef == gravesSmokeScreenPrimaryHitProviderRef ||
		gravesCollateralDamagePrimaryHitStableID == gravesQDStableID ||
		gravesCollateralDamagePrimaryHitStableID == gravesNDStableID ||
		gravesCollateralDamagePrimaryHitStableID == gravesSmokeScreenPrimaryHitStableID {
		t.Fatal("collateral_damage primary-hit must not reuse New Destiny / Quickdraw / Smoke Screen provider refs")
	}
	if gravesCollateralDamagePrimaryHitAbilityKey == gravesQDAbilityKey ||
		gravesCollateralDamagePrimaryHitAbilityKey == gravesNDAbilityKey ||
		gravesCollateralDamagePrimaryHitAbilityKey == gravesSmokeScreenPrimaryHitAbilityKey ||
		gravesCollateralDamagePrimaryHitAbilityKey == "basic_attack" ||
		gravesCollateralDamagePrimaryHitAbilityKey == "quickdraw" ||
		gravesCollateralDamagePrimaryHitAbilityKey == "new_destiny" ||
		gravesCollateralDamagePrimaryHitAbilityKey == "smoke_screen" ||
		gravesCollateralDamagePrimaryHitAbilityKey == "true_grit" {
		t.Fatal("collateral_damage must not reuse New Destiny / Quickdraw / Smoke Screen / basic-attack / True Grit ability keys")
	}
	if gravesCollateralDamagePrimaryHitDamageOpRef == "op:graves_new_destiny" ||
		gravesCollateralDamagePrimaryHitDamageOpRef == gravesSmokeScreenPrimaryHitDamageOpRef ||
		strings.Contains(gravesCollateralDamagePrimaryHitDamageOpRef, "quickdraw") ||
		strings.Contains(gravesCollateralDamagePrimaryHitDamageOpRef, "true_grit") ||
		strings.Contains(gravesCollateralDamagePrimaryHitDamageOpRef, "smoke_screen") {
		t.Fatal("collateral_damage primary-hit must not reuse New Destiny / Quickdraw / Smoke Screen / True Grit operation refs")
	}
	if gravesCollateralDamagePrimaryHitAbilityID != "ability_hero_graves_r_collateral_damage_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if gravesCollateralDamagePrimaryHitStableID != "hero_graves_r_collateral_damage_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
	if gravesCollateralDamagePrimaryHitProviderRef != "provider_hero_graves_r_collateral_damage_primary_hit" {
		t.Fatal("provider ref constant drifted")
	}
}

// TestGravesCollateralDamagePrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-3 single-target immediate physical shell damage scaffold: cost 100,
// CD 60000ms exact boundary, one physical hit per successful cast (no AA/crit/phantom/
// cast-delay/recoil/projectile/geometry/line/AOE/multitarget/explosion/cone/reduced/
// P/E/W).
func TestGravesCollateralDamagePrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadGravesCollateralDamagePrimaryHitFixture(t)
	assertGravesCollateralDamagePrimaryHitProviderShape(t, compileReq)

	ref := gravesCollateralDamagePrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "r0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "r_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 59999},
		{EntryKey: "r_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 60000},
	}
	runReq.StopPolicy.DurationMs = 60100

	done := runGravesCollateralDamagePrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if gravesCollateralDamagePrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findGravesCollateralDamagePrimaryHitAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt59999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 59999 {
			t.Fatalf("cooldown skip TimeMs=%d want 59999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 60000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 60000", item.Data["readyAtMs"])
		}
		skipAt59999 = true
	}
	if !skipAt59999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=59999 with readyAtMs=60000")
	}

	items := gravesCollateralDamagePrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("collateral_damage damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 60000}
	wantMit := expectedMitigatedPhysical(gravesCollateralDamagePrimaryHitExpectedRaw, gravesCollateralDamagePrimaryHitTargetArmor)
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
		if evidenceDataString(item.Data, "damageType") != "damage/physical" {
			t.Fatalf("damage[%d] type=%q want damage/physical", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q want %q", i, evidenceDataString(item.Data, "abilityRef"), ref)
		}
		if evidenceDataString(item.Data, "providerRef") != gravesCollateralDamagePrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), gravesCollateralDamagePrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != gravesCollateralDamagePrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), gravesCollateralDamagePrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-gravesCollateralDamagePrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, gravesCollateralDamagePrimaryHitExpectedRaw)
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
	if math.Abs(done.Summary.TargetFinalHp-gravesCollateralDamagePrimaryHitHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, gravesCollateralDamagePrimaryHitHPAfter2)
	}
	wantHP := gravesCollateralDamagePrimaryHitTargetHP - wantDealt
	if math.Abs(wantHP-gravesCollateralDamagePrimaryHitHPAfter2) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("HP cross-check=%v want %v", wantHP, gravesCollateralDamagePrimaryHitHPAfter2)
	}

	gotMana := gravesCollateralDamagePrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-gravesCollateralDamagePrimaryHitManaAfter2) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 200; skipped attempt costs 0)", gotMana, gravesCollateralDamagePrimaryHitManaAfter2)
	}
	if math.Abs((gravesCollateralDamagePrimaryHitFixtureMana-gotMana)-200) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("mana spent=%v want 200", gravesCollateralDamagePrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/cone/New Destiny/Quickdraw/Smoke Screen hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-gravesCollateralDamagePrimaryHitADResolved) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("ad.resolved=%v want %v", got, gravesCollateralDamagePrimaryHitADResolved)
	}
	if got := sourceAttrBase(t, done.FinalSnapshot, "ad"); math.Abs(got-gravesCollateralDamagePrimaryHitADBase) > gravesCollateralDamagePrimaryHitTol {
		t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)", got, gravesCollateralDamagePrimaryHitADBase)
	}
}
