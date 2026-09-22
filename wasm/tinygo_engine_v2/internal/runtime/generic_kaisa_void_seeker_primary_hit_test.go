package runtime

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_kaisa W Void Seeker / 虚空索敌 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: kaisa-w-void-seeker-primary-hit-phase-a-v2).
//
// Frozen boundary:
//
//	rank5_primary_target_single_hit; immediate_impact_scaffold;
//	magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund
//
// Wiki authority (repository sidecar only; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_kaisa|W|虚空索敌
//	Request Template:Data Kai'Sa/W → resolved Template:Data Kai'Sa/Void Seeker
//	wikiPageId 1353553 / rev 4034696 / timestamp 2026-06-23T21:14:14Z
//	sidecar rawByteSize 1843 / SHA256 aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1
//	数据参考/lol-wiki-current-champions/normalized/generic/kaisa-w.json
//	pages/raw siblings: pages/kaisa-w.json, raw/kaisa-w.wikitext
//	Caveat: local raw may be 1842 bytes / SHA496936a8… due newline materialization;
//	assert sidecar canonical metadata only — do not require local raw len/hash == sidecar.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_kaisa_w_void_seeker_primary_hit
//     (not Second Skin / Supercharge / basic-attack reuse)
//   - ability ability_hero_kaisa_w_void_seeker_primary_hit with ability_key
//     void_seeker: active; mana 75; cooldown 14000 ms
//   - Exactly one immediate direct-target magic damage op:
//     130 + 1.30*source.attr.ad.resolved + 0.45*source.attr.ap.resolved
//     (AD is total AD; never subtract base AD)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / Plasma state / cast-delay / projectile / geometry /
//     sight / reveal / evolution / cooldown-refund / repeat / phantom /
//     equipment / loadout / on-hit behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Wiki describes 0.4s cast / Effect at cast time end, target-direction void
//   bolt, travel/collision/first-enemy acquisition, range3000/width200/
//   speed1750/geometry/spellshield, sight/reveal/true sight 4s, applying 2
//   Plasma, Second Skin/Plasma/Caustic Wounds coupling, item AP100 evolution
//   applying 3 Plasma + champion-hit 75% cooldown refund — but this scaffold
//   is immediate primary-target magic damage only. Immediate scaffold
//   explicitly excludes rather than models/approximates Wiki cast timing.
//   Do not claim or invent cast-delay/projectile/travel/collision/geometry,
//   sight/reveal, Plasma/evolution/cooldown-refund, ranks 1–4, equipment/
//   loadout, Second Skin / Supercharge / basic-attack coupling, live publish,
//   or full fidelity.

const (
	kaisaVoidSeekerPrimaryHitCandidateKey  = "hero_skill|hero_kaisa|W|虚空索敌"
	kaisaVoidSeekerPrimaryHitRequestTitle  = "Template:Data Kai'Sa/W"
	kaisaVoidSeekerPrimaryHitResolvedTitle = "Template:Data Kai'Sa/Void Seeker"
	kaisaVoidSeekerPrimaryHitWikiPageID    = 1353553
	kaisaVoidSeekerPrimaryHitRevisionID    = 4034696
	kaisaVoidSeekerPrimaryHitTimestamp     = "2026-06-23T21:14:14Z"
	kaisaVoidSeekerPrimaryHitRawBytes      = 1843
	kaisaVoidSeekerPrimaryHitContentSHA    = "aa4ba76c6fa345c711651fa56d9b914d4ea8b7eb3ddfae79d7feb25470d7e3d1"
	kaisaVoidSeekerPrimaryHitBoundary      = "rank5_primary_target_single_hit; immediate_impact_scaffold; " +
		"magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund"

	kaisaVoidSeekerPrimaryHitProviderRef = "provider_hero_kaisa_w_void_seeker_primary_hit"
	kaisaVoidSeekerPrimaryHitStableID    = "hero_kaisa_w_void_seeker_primary_hit"
	kaisaVoidSeekerPrimaryHitAbilityID   = "ability_hero_kaisa_w_void_seeker_primary_hit"
	kaisaVoidSeekerPrimaryHitAbilityKey  = "void_seeker"
	kaisaVoidSeekerPrimaryHitDamageOpRef = "op:kaisa_void_seeker_primary_hit_damage"
	kaisaVoidSeekerPrimaryHitTotalADMod  = "fixture_kaisa_void_seeker_primary_hit_total_ad"

	kaisaVoidSeekerPrimaryHitBaseDamage = 130.0
	kaisaVoidSeekerPrimaryHitADRatio    = 1.30
	kaisaVoidSeekerPrimaryHitAPRatio    = 0.45
	kaisaVoidSeekerPrimaryHitManaCost   = 75.0
	kaisaVoidSeekerPrimaryHitCDMs       = 14000.0

	// Total AD=100 while base remains 59 — proves formula reads ad.resolved
	// (total AD), not bonus AD and not base AD alone.
	kaisaVoidSeekerPrimaryHitADBase      = 59.0
	kaisaVoidSeekerPrimaryHitADResolved  = 100.0
	kaisaVoidSeekerPrimaryHitFixtureAP   = 100.0
	kaisaVoidSeekerPrimaryHitFixtureMana = 345.0
	kaisaVoidSeekerPrimaryHitTargetMR    = 100.0
	kaisaVoidSeekerPrimaryHitTargetHP    = 1000.0

	// Independent cross-check: totalAD=100 + AP=100 → raw 305; MR 100 → mitigated 152.5.
	kaisaVoidSeekerPrimaryHitExpectedRaw       = 305.0
	kaisaVoidSeekerPrimaryHitExpectedMitigated = 152.5
	kaisaVoidSeekerPrimaryHitManaAfter2        = 195.0 // 345 - 75 - 75
	kaisaVoidSeekerPrimaryHitHPAfter2          = 695.0 // 1000 - 152.5 - 152.5

	kaisaVoidSeekerPrimaryHitTol = 1e-9
)

func kaisaVoidSeekerPrimaryHitExpectedRawFromStats(resolvedAD, resolvedAP float64) float64 {
	return kaisaVoidSeekerPrimaryHitBaseDamage +
		kaisaVoidSeekerPrimaryHitADRatio*resolvedAD +
		kaisaVoidSeekerPrimaryHitAPRatio*resolvedAP
}

func kaisaVoidSeekerPrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := kaisaVoidSeekerPrimaryHitBaseDamage
	adRatio := kaisaVoidSeekerPrimaryHitADRatio
	apRatio := kaisaVoidSeekerPrimaryHitAPRatio
	// Nested binary add: base + totalAD + AP (generic add is binary-only).
	// Total AD = source.attr.ad.resolved — never subtract ad.base.
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
							{Op: "read", Path: "source.attr.ad.resolved"},
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

func kaisaVoidSeekerPrimaryHitAbility() model.AbilityDefinition {
	cost := kaisaVoidSeekerPrimaryHitManaCost
	cd := kaisaVoidSeekerPrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: kaisaVoidSeekerPrimaryHitAbilityKey,
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
				Ref:           kaisaVoidSeekerPrimaryHitDamageOpRef,
				Amount:        kaisaVoidSeekerPrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func kaisaVoidSeekerPrimaryHitProviderDef() model.ProviderDefinition {
	flatAD := kaisaVoidSeekerPrimaryHitADResolved - kaisaVoidSeekerPrimaryHitADBase
	return model.ProviderDefinition{
		ProviderKey: kaisaVoidSeekerPrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    kaisaVoidSeekerPrimaryHitStableID,
		// Fixture-only flat AD so ad.base stays 59 while ad.resolved becomes 100
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: kaisaVoidSeekerPrimaryHitTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatAD),
		}},
		Abilities: []model.AbilityDefinition{kaisaVoidSeekerPrimaryHitAbility()},
	}
}

func kaisaVoidSeekerPrimaryHitAbilityRef() string {
	return "source.provider[" + kaisaVoidSeekerPrimaryHitProviderRef + "].ability[" + kaisaVoidSeekerPrimaryHitAbilityKey + "]"
}

func configureKaisaVoidSeekerPrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{kaisaVoidSeekerPrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: kaisaVoidSeekerPrimaryHitProviderRef, DefinitionRef: kaisaVoidSeekerPrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: kaisaVoidSeekerPrimaryHitProviderRef, DefinitionRef: kaisaVoidSeekerPrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureKaisaVoidSeekerPrimaryHitTypes(req *model.CompileRequest) {
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

func loadKaisaVoidSeekerPrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureKaisaVoidSeekerPrimaryHitTypes(&compileReq)
	configureKaisaVoidSeekerPrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: kaisaVoidSeekerPrimaryHitADBase, Current: kaisaVoidSeekerPrimaryHitADBase,
		Max: kaisaVoidSeekerPrimaryHitADBase, Resolved: kaisaVoidSeekerPrimaryHitADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: kaisaVoidSeekerPrimaryHitFixtureAP, Current: kaisaVoidSeekerPrimaryHitFixtureAP,
		Max: kaisaVoidSeekerPrimaryHitFixtureAP, Resolved: kaisaVoidSeekerPrimaryHitFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: kaisaVoidSeekerPrimaryHitFixtureMana, Max: kaisaVoidSeekerPrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: kaisaVoidSeekerPrimaryHitTargetHP, Current: kaisaVoidSeekerPrimaryHitTargetHP,
		Max: kaisaVoidSeekerPrimaryHitTargetHP, Resolved: kaisaVoidSeekerPrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: kaisaVoidSeekerPrimaryHitTargetMR, Current: kaisaVoidSeekerPrimaryHitTargetMR,
		Max: kaisaVoidSeekerPrimaryHitTargetMR, Resolved: kaisaVoidSeekerPrimaryHitTargetMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runKaisaVoidSeekerPrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func kaisaVoidSeekerPrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func kaisaVoidSeekerPrimaryHitSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func kaisaVoidSeekerPrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func kaisaVoidSeekerPrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != kaisaVoidSeekerPrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func kaisaVoidSeekerPrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == kaisaVoidSeekerPrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertKaisaVoidSeekerPrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := kaisaVoidSeekerPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_kaisa_w_void_seeker_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != kaisaVoidSeekerPrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, kaisaVoidSeekerPrimaryHitProviderRef)
	}
	if p.StableID != kaisaVoidSeekerPrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, kaisaVoidSeekerPrimaryHitStableID)
	}
	if p.ProviderKey == kaisaSSProviderRef || p.StableID == kaisaSSStableID ||
		p.ProviderKey == kaisaProviderRef || p.StableID == kaisaStableID ||
		p.ProviderKey == kaisaSSStableID || p.StableID == kaisaSSProviderRef ||
		p.ProviderKey == kaisaStableID || p.StableID == kaisaProviderRef {
		t.Fatal("void_seeker primary-hit must not reuse Second Skin / Supercharge provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / Plasma / evolution coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no Plasma/Second Skin/evolution state)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1 (fixture-only total-AD flat; no Plasma/evolution/equipment)", len(p.Modifiers))
	}
	if p.Modifiers[0].ModifierKey != kaisaVoidSeekerPrimaryHitTotalADMod ||
		p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
		p.Modifiers[0].ValuePolicy != "add" {
		t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], kaisaVoidSeekerPrimaryHitTotalADMod)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), kaisaVoidSeekerPrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != kaisaVoidSeekerPrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, kaisaVoidSeekerPrimaryHitAbilityKey, kaisaVoidSeekerPrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("void_seeker must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-kaisaVoidSeekerPrimaryHitManaCost) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 75", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-kaisaVoidSeekerPrimaryHitCDMs) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 14000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no cast/projectile/Plasma/evolution)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("void_seeker damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("void_seeker damage must not be copyable on hit")
	}
	if op.Ref != kaisaVoidSeekerPrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, kaisaVoidSeekerPrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(base+totalAD, AP)", op.Amount)
	}
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const, mul(adRatio, ad.resolved))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-kaisaVoidSeekerPrimaryHitBaseDamage) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("base const=%+v want 130", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-kaisaVoidSeekerPrimaryHitADRatio) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("AD ratio=%+v want 1.30", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-kaisaVoidSeekerPrimaryHitAPRatio) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("AP ratio=%+v want 0.45", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "stun" ||
			banned.Operation == "projectile" || banned.Operation == "multi_target" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" ||
			banned.Operation == "field" || banned.Operation == "reveal" ||
			banned.Operation == "sight" || banned.Operation == "cast_delay" {
			t.Fatalf("void_seeker must not include cast/projectile/geometry/sight/reveal/Plasma/state/repeat op: %+v", banned)
		}
	}
}

func findKaisaVoidSeekerPrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := kaisaVoidSeekerPrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func kaisaVoidSeekerPrimaryHitWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "kaisa-w.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func kaisaVoidSeekerPrimaryHitWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "kaisa-w.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func kaisaVoidSeekerPrimaryHitWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "kaisa-w.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type kaisaVoidSeekerPrimaryHitWikiSidecar struct {
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

func kaisaVoidSeekerPrimaryHitLoadWikiSidecar(t *testing.T) kaisaVoidSeekerPrimaryHitWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(kaisaVoidSeekerPrimaryHitWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc kaisaVoidSeekerPrimaryHitWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

// TestKaisaVoidSeekerPrimaryHitWikiSidecarIdentityAndBoundary locks repository sidecar
// identity plus the frozen Phase-A completed-boundary constant. Positively asserts
// magic/first-enemy, rank formula, cost/CD, and evolution text while compile/runtime
// tests prove those excluded branches are absent from the immediate scaffold.
func TestKaisaVoidSeekerPrimaryHitWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := kaisaVoidSeekerPrimaryHitLoadWikiSidecar(t)
	if doc.CandidateKey != kaisaVoidSeekerPrimaryHitCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, kaisaVoidSeekerPrimaryHitCandidateKey)
	}
	if doc.RequestTitle != kaisaVoidSeekerPrimaryHitRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, kaisaVoidSeekerPrimaryHitRequestTitle)
	}
	if doc.ResolvedTitle != kaisaVoidSeekerPrimaryHitResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, kaisaVoidSeekerPrimaryHitResolvedTitle)
	}
	if doc.WikiPageID != kaisaVoidSeekerPrimaryHitWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, kaisaVoidSeekerPrimaryHitWikiPageID)
	}
	if doc.RevisionID != kaisaVoidSeekerPrimaryHitRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, kaisaVoidSeekerPrimaryHitRevisionID)
	}
	if doc.RevisionTimestamp != kaisaVoidSeekerPrimaryHitTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, kaisaVoidSeekerPrimaryHitTimestamp)
	}
	if doc.ContentSHA256 != kaisaVoidSeekerPrimaryHitContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, kaisaVoidSeekerPrimaryHitContentSHA)
	}
	if doc.RawByteSize != kaisaVoidSeekerPrimaryHitRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, kaisaVoidSeekerPrimaryHitRawBytes)
	}
	if doc.SkillKey != "W" || doc.ZhDisplayName != "虚空索敌" || doc.OwnerID != "hero_kaisa" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want W/虚空索敌/hero_kaisa",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{"description", "leveling", "description2", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "{{ap|55 to 75}}\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "{{ap|55 to 75}}\n")
	}
	if doc.Fields.Cooldown != "{{ap|20 to 14}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|20 to 14}}\n")
	}
	if doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("fields.damagetype=%q want Magic", doc.Fields.Damagetype)
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("fields.costtype=%q want Mana", doc.Fields.Costtype)
	}
	if doc.Fields.Description == "" {
		t.Fatal("description empty (fail closed; expect magic / first-enemy wording)")
	}
	if !strings.Contains(doc.Fields.Description, "{{as|magic damage}}") {
		t.Fatalf("description missing magic damage wording: %q", doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "first enemy") {
		t.Fatalf("description missing first-enemy wording: %q", doc.Fields.Description)
	}
	if !strings.Contains(doc.Fields.Description, "2 Plasma") {
		t.Fatalf("description missing normal 2 Plasma wording (source evidence; excluded from scaffold): %q",
			doc.Fields.Description)
	}
	if doc.Fields.Leveling == "" {
		t.Fatal("leveling empty (fail closed; expect Magic Damage rank formula)")
	}
	if !strings.Contains(doc.Fields.Leveling, "Magic Damage") {
		t.Fatalf("leveling missing Magic Damage label: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|30 to 130}}") {
		t.Fatalf("leveling missing rank formula {{ap|30 to 130}}: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "130% AD") {
		t.Fatalf("leveling missing 130%% AD ratio: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "45% AP") {
		t.Fatalf("leveling missing 45%% AP ratio: %q", doc.Fields.Leveling)
	}
	if doc.Fields.Description2 == "" {
		t.Fatal("description2 empty (fail closed; expect Evolution / 3 Plasma / 75% refund)")
	}
	if !strings.Contains(doc.Fields.Description2, "Evolution") {
		t.Fatalf("description2 missing Evolution wording: %q", doc.Fields.Description2)
	}
	if !strings.Contains(doc.Fields.Description2, "3 Plasma") {
		t.Fatalf("description2 missing evolved 3 Plasma wording: %q", doc.Fields.Description2)
	}
	if !strings.Contains(doc.Fields.Description2, "75%") || !strings.Contains(doc.Fields.Description2, "cooldown") {
		t.Fatalf("description2 missing 75%% cooldown refund wording: %q", doc.Fields.Description2)
	}
	if doc.Fields.Notes == "" {
		t.Fatal("notes empty (fail closed; expect Effect at cast time end)")
	}
	if !strings.Contains(doc.Fields.Notes, "Effect at cast time end") {
		t.Fatalf("notes missing Effect at cast time end (excluded from immediate scaffold): %q",
			doc.Fields.Notes)
	}

	_ = kaisaVoidSeekerPrimaryHitWikiPagesPath(t)

	raw, err := os.ReadFile(kaisaVoidSeekerPrimaryHitWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("wiki raw empty (fail closed)")
	}
	// Do not assert local raw len/hash equals sidecar canonical metadata
	// (local may be 1842 bytes / SHA496936a8… due repository newline materialization).
	if kaisaVoidSeekerPrimaryHitBoundary != "rank5_primary_target_single_hit; immediate_impact_scaffold; "+
		"magic_130_plus_1_30_total_ad_plus_0_45_ap; no_cast_delay_projectile_geometry_sight_reveal_plasma_evolution_or_cooldown_refund" {
		t.Fatal("frozen boundary constant drifted")
	}
}

// TestKaisaVoidSeekerPrimaryHitRank5DamageFormulaCrossCheck: independent numeric
// cross-check 130 + 1.30*100 + 0.45*100 = 305; MR 100 → mitigated 152.5.
// Also proves total-AD path differs from bonus-AD (41) and base-AD (59) alone.
func TestKaisaVoidSeekerPrimaryHitRank5DamageFormulaCrossCheck(t *testing.T) {
	if math.Abs(kaisaVoidSeekerPrimaryHitADResolved-kaisaVoidSeekerPrimaryHitADBase-41) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("fixture flat AD=%v want 41 (resolved 100 - base 59)",
			kaisaVoidSeekerPrimaryHitADResolved-kaisaVoidSeekerPrimaryHitADBase)
	}
	raw := kaisaVoidSeekerPrimaryHitExpectedRawFromStats(
		kaisaVoidSeekerPrimaryHitADResolved, kaisaVoidSeekerPrimaryHitFixtureAP)
	if math.Abs(raw-kaisaVoidSeekerPrimaryHitExpectedRaw) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, kaisaVoidSeekerPrimaryHitExpectedRaw)
	}
	bonusOnly := kaisaVoidSeekerPrimaryHitExpectedRawFromStats(
		kaisaVoidSeekerPrimaryHitADResolved-kaisaVoidSeekerPrimaryHitADBase, kaisaVoidSeekerPrimaryHitFixtureAP)
	if math.Abs(bonusOnly-kaisaVoidSeekerPrimaryHitExpectedRaw) < kaisaVoidSeekerPrimaryHitTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw (formula must not treat AD as bonus)")
	}
	baseOnly := kaisaVoidSeekerPrimaryHitExpectedRawFromStats(
		kaisaVoidSeekerPrimaryHitADBase, kaisaVoidSeekerPrimaryHitFixtureAP)
	if math.Abs(baseOnly-kaisaVoidSeekerPrimaryHitExpectedRaw) < kaisaVoidSeekerPrimaryHitTol {
		t.Fatal("base-AD raw must differ from total-AD raw (formula must read ad.resolved)")
	}
	mit := expectedMitigatedMagic(raw, kaisaVoidSeekerPrimaryHitTargetMR)
	if math.Abs(mit-kaisaVoidSeekerPrimaryHitExpectedMitigated) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, kaisaVoidSeekerPrimaryHitExpectedMitigated)
	}
}

// TestKaisaVoidSeekerPrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent W provider: one magic damage op (total AD + AP), cost/CD, no Plasma/evolution.
func TestKaisaVoidSeekerPrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadKaisaVoidSeekerPrimaryHitFixture(t)
	assertKaisaVoidSeekerPrimaryHitProviderShape(t, compileReq)
	if kaisaVoidSeekerPrimaryHitProviderRef == kaisaSSProviderRef ||
		kaisaVoidSeekerPrimaryHitProviderRef == kaisaProviderRef ||
		kaisaVoidSeekerPrimaryHitStableID == kaisaSSStableID ||
		kaisaVoidSeekerPrimaryHitStableID == kaisaStableID {
		t.Fatal("void_seeker primary-hit must not reuse Second Skin / Supercharge provider refs")
	}
	if kaisaVoidSeekerPrimaryHitAbilityKey == kaisaEKey ||
		kaisaVoidSeekerPrimaryHitAbilityKey == kaisaSSAbilityKey ||
		kaisaVoidSeekerPrimaryHitAbilityKey == "basic_attack" ||
		kaisaVoidSeekerPrimaryHitAbilityKey == "supercharge" ||
		kaisaVoidSeekerPrimaryHitAbilityKey == "second_skin" {
		t.Fatal("void_seeker must not reuse Second Skin / Supercharge / basic-attack ability keys")
	}
	if kaisaVoidSeekerPrimaryHitDamageOpRef == kaisaSSCausticOpRef ||
		kaisaVoidSeekerPrimaryHitDamageOpRef == kaisaSSRuptureOpRef ||
		kaisaVoidSeekerPrimaryHitDamageOpRef == kaisaSSAAOpRef {
		t.Fatal("void_seeker primary-hit must not reuse Second Skin operation refs")
	}
	if kaisaVoidSeekerPrimaryHitAbilityID != "ability_hero_kaisa_w_void_seeker_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if kaisaVoidSeekerPrimaryHitStableID != "hero_kaisa_w_void_seeker_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
}

// TestKaisaVoidSeekerPrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target immediate magic damage scaffold: cost 75,
// CD 14000ms exact boundary, one magic hit per successful cast (no AA/crit/phantom/
// cast-delay/projectile/Plasma/evolution/cooldown-refund).
func TestKaisaVoidSeekerPrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadKaisaVoidSeekerPrimaryHitFixture(t)
	assertKaisaVoidSeekerPrimaryHitProviderShape(t, compileReq)

	ref := kaisaVoidSeekerPrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 13999},
		{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 14000},
	}
	runReq.StopPolicy.DurationMs = 14100

	done := runKaisaVoidSeekerPrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if kaisaVoidSeekerPrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findKaisaVoidSeekerPrimaryHitAbilityStat(t, done)
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

	items := kaisaVoidSeekerPrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("void_seeker damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 14000}
	wantMit := expectedMitigatedMagic(kaisaVoidSeekerPrimaryHitExpectedRaw, kaisaVoidSeekerPrimaryHitTargetMR)
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
		if evidenceDataString(item.Data, "providerRef") != kaisaVoidSeekerPrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), kaisaVoidSeekerPrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != kaisaVoidSeekerPrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), kaisaVoidSeekerPrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-kaisaVoidSeekerPrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, kaisaVoidSeekerPrimaryHitExpectedRaw)
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
	if math.Abs(done.Summary.TargetFinalHp-kaisaVoidSeekerPrimaryHitHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, kaisaVoidSeekerPrimaryHitHPAfter2)
	}
	wantHP := kaisaVoidSeekerPrimaryHitTargetHP - wantDealt
	if math.Abs(wantHP-kaisaVoidSeekerPrimaryHitHPAfter2) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("HP cross-check=%v want %v", wantHP, kaisaVoidSeekerPrimaryHitHPAfter2)
	}

	gotMana := kaisaVoidSeekerPrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-kaisaVoidSeekerPrimaryHitManaAfter2) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 150; skipped attempt costs 0)", gotMana, kaisaVoidSeekerPrimaryHitManaAfter2)
	}
	if math.Abs((kaisaVoidSeekerPrimaryHitFixtureMana-gotMana)-150) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("mana spent=%v want 150", kaisaVoidSeekerPrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/Plasma/Second Skin/evolution hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-kaisaVoidSeekerPrimaryHitADResolved) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)", got, kaisaVoidSeekerPrimaryHitADResolved)
	}
	if got := kaisaVoidSeekerPrimaryHitSourceAttrBase(t, done.FinalSnapshot, "ad"); math.Abs(got-kaisaVoidSeekerPrimaryHitADBase) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("ad.base=%v want %v (total-AD formula must leave base independent)", got, kaisaVoidSeekerPrimaryHitADBase)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ap"); math.Abs(got-kaisaVoidSeekerPrimaryHitFixtureAP) > kaisaVoidSeekerPrimaryHitTol {
		t.Fatalf("ap.resolved=%v want %v", got, kaisaVoidSeekerPrimaryHitFixtureAP)
	}
}
