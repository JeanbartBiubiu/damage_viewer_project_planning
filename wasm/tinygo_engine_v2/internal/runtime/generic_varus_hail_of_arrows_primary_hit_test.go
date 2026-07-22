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

// hero_varus E Hail of Arrows / 恶灵箭雨 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: varus-e-hail-of-arrows-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_target_single_hit; immediate_impact_scaffold;
//	physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation
//
// Wiki authority (repository sidecar only; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_varus|E|恶灵箭雨
//	Request Template:Data Varus/E → resolved Template:Data Varus/Hail of Arrows
//	wikiPageId 1309978 / rev 3969402 / timestamp 2025-11-24T16:03:58Z
//	sidecar rawByteSize 1750 / SHA256 7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9
//	数据参考/lol-wiki-current-champions/normalized/generic/varus-e.json
//	pages/raw siblings: pages/varus-e.json, raw/varus-e.wikitext
//	Caveat: local raw may be 1748 bytes / SHA42ebcd88… due newline materialization;
//	assert sidecar canonical metadata only — do not require local raw len/hash == sidecar.
//
// Source contradiction (locked / disclosed; not runtime truth):
//	Same-revision description + labeled leveling explicitly say physical
//	60 to 180 (+90% bonus AD); isolated fields.damagetype=Magic is contradictory
//	source metadata. Reviewed policy: direct description + rank table govern the
//	bounded physical branch; this test must not interpret Magic as runtime damage.
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_varus_e_hail_of_arrows_primary_hit
//     (not Blighted Quiver / Q carrier / basic-attack reuse)
//   - ability ability_hero_varus_e_hail_of_arrows_primary_hit with ability_key
//     hail_of_arrows: active; mana 90; cooldown 10000 ms
//   - Exactly one immediate direct-target physical damage op:
//     180 + 0.90*(source.attr.ad.resolved - source.attr.ad.base)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / state / cast-delay / projectile / geometry / multi-target /
//     field / slow / Grievous Wounds / Blight detonation / repeat / phantom /
//     equipment / loadout / on-hit behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Wiki describes 0.5s landing delay, target-location hail, radius/range,
//   four-second desecrated field, slow 30–50%/0.25s linger, Grievous Wounds,
//   and Blighted Quiver stack consumption/~0.3s second detonation — but this
//   scaffold is immediate primary-target physical damage only. Do not claim or
//   invent cast0.2419/landing0.5/travel timing, target-location/projectile/
//   range925/radius300/collision/geometry, all-enemies/multi-target/repeat,
//   four-second field, slow/Grievous Wounds, Blight/W/Q/basic/on-hit coupling,
//   ranks 1–4, equipment/loadout, live publish, or full-skill fidelity.

const (
	varusHailOfArrowsPrimaryHitCandidateKey  = "hero_skill|hero_varus|E|恶灵箭雨"
	varusHailOfArrowsPrimaryHitRequestTitle  = "Template:Data Varus/E"
	varusHailOfArrowsPrimaryHitResolvedTitle = "Template:Data Varus/Hail of Arrows"
	varusHailOfArrowsPrimaryHitWikiPageID    = 1309978
	varusHailOfArrowsPrimaryHitRevisionID    = 3969402
	varusHailOfArrowsPrimaryHitTimestamp     = "2025-11-24T16:03:58Z"
	varusHailOfArrowsPrimaryHitRawBytes      = 1750
	varusHailOfArrowsPrimaryHitContentSHA    = "7b4be71bcc26ba933dff0235882d272c14e406abbf505290018ba15a5ba658e9"
	varusHailOfArrowsPrimaryHitBoundary      = "rank5_primary_target_single_hit; immediate_impact_scaffold; " +
		"physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation"

	varusHailOfArrowsPrimaryHitProviderRef = "provider_hero_varus_e_hail_of_arrows_primary_hit"
	varusHailOfArrowsPrimaryHitStableID    = "hero_varus_e_hail_of_arrows_primary_hit"
	varusHailOfArrowsPrimaryHitAbilityID   = "ability_hero_varus_e_hail_of_arrows_primary_hit"
	varusHailOfArrowsPrimaryHitAbilityKey  = "hail_of_arrows"
	varusHailOfArrowsPrimaryHitDamageOpRef = "op:varus_hail_of_arrows_primary_hit_damage"
	varusHailOfArrowsPrimaryHitBonusADMod  = "fixture_varus_hail_of_arrows_primary_hit_bonus_ad"

	varusHailOfArrowsPrimaryHitBaseDamage = 180.0
	varusHailOfArrowsPrimaryHitBonusRatio = 0.90
	varusHailOfArrowsPrimaryHitManaCost   = 90.0
	varusHailOfArrowsPrimaryHitCDMs       = 10000.0

	varusHailOfArrowsPrimaryHitADBase      = 59.0
	varusHailOfArrowsPrimaryHitADResolved  = 159.0
	varusHailOfArrowsPrimaryHitTargetArmor = 100.0
	varusHailOfArrowsPrimaryHitTargetHP    = 100000.0
	varusHailOfArrowsPrimaryHitFixtureMana = 320.0

	// Independent cross-check: bonusAD=100 → raw 270; armor 100 → mitigated 135.
	varusHailOfArrowsPrimaryHitExpectedRaw       = 270.0
	varusHailOfArrowsPrimaryHitExpectedMitigated = 135.0
	varusHailOfArrowsPrimaryHitManaAfter2        = 140.0 // 320 - 90 - 90

	varusHailOfArrowsPrimaryHitTol = 1e-9
)

func varusHailOfArrowsPrimaryHitExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return varusHailOfArrowsPrimaryHitBaseDamage + varusHailOfArrowsPrimaryHitBonusRatio*(resolvedAD-baseAD)
}

func varusHailOfArrowsPrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := varusHailOfArrowsPrimaryHitBaseDamage
	ratio := varusHailOfArrowsPrimaryHitBonusRatio
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

func varusHailOfArrowsPrimaryHitAbility() model.AbilityDefinition {
	cost := varusHailOfArrowsPrimaryHitManaCost
	cd := varusHailOfArrowsPrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: varusHailOfArrowsPrimaryHitAbilityKey,
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
				Ref:           varusHailOfArrowsPrimaryHitDamageOpRef,
				Amount:        varusHailOfArrowsPrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func varusHailOfArrowsPrimaryHitProviderDef() model.ProviderDefinition {
	bonusAD := varusHailOfArrowsPrimaryHitADResolved - varusHailOfArrowsPrimaryHitADBase
	return model.ProviderDefinition{
		ProviderKey: varusHailOfArrowsPrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    varusHailOfArrowsPrimaryHitStableID,
		// Fixture-only flat AD so ad.base stays 59 while ad.resolved becomes 159
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: varusHailOfArrowsPrimaryHitBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}},
		Abilities: []model.AbilityDefinition{varusHailOfArrowsPrimaryHitAbility()},
	}
}

func varusHailOfArrowsPrimaryHitAbilityRef() string {
	return "source.provider[" + varusHailOfArrowsPrimaryHitProviderRef + "].ability[" + varusHailOfArrowsPrimaryHitAbilityKey + "]"
}

func configureVarusHailOfArrowsPrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{varusHailOfArrowsPrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: varusHailOfArrowsPrimaryHitProviderRef, DefinitionRef: varusHailOfArrowsPrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: varusHailOfArrowsPrimaryHitProviderRef, DefinitionRef: varusHailOfArrowsPrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureVarusHailOfArrowsPrimaryHitTypes(req *model.CompileRequest) {
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

func loadVarusHailOfArrowsPrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureVarusHailOfArrowsPrimaryHitTypes(&compileReq)
	configureVarusHailOfArrowsPrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: varusHailOfArrowsPrimaryHitADBase, Current: varusHailOfArrowsPrimaryHitADBase,
		Max: varusHailOfArrowsPrimaryHitADBase, Resolved: varusHailOfArrowsPrimaryHitADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: varusHailOfArrowsPrimaryHitFixtureMana, Max: varusHailOfArrowsPrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: varusHailOfArrowsPrimaryHitTargetHP, Current: varusHailOfArrowsPrimaryHitTargetHP,
		Max: varusHailOfArrowsPrimaryHitTargetHP, Resolved: varusHailOfArrowsPrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: varusHailOfArrowsPrimaryHitTargetArmor, Current: varusHailOfArrowsPrimaryHitTargetArmor,
		Max: varusHailOfArrowsPrimaryHitTargetArmor, Resolved: varusHailOfArrowsPrimaryHitTargetArmor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runVarusHailOfArrowsPrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func varusHailOfArrowsPrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func varusHailOfArrowsPrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func varusHailOfArrowsPrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != varusHailOfArrowsPrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func varusHailOfArrowsPrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == varusHailOfArrowsPrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertVarusHailOfArrowsPrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := varusHailOfArrowsPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_varus_e_hail_of_arrows_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != varusHailOfArrowsPrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, varusHailOfArrowsPrimaryHitProviderRef)
	}
	if p.StableID != varusHailOfArrowsPrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, varusHailOfArrowsPrimaryHitStableID)
	}
	if p.ProviderKey == varusBQProviderRef || p.StableID == varusBQStableID ||
		p.ProviderKey == varusBQStableID || p.StableID == varusBQProviderRef {
		t.Fatal("hail_of_arrows primary-hit must not reuse Varus Blighted Quiver provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / Blighted Quiver coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no field/slow/blight/state)", len(p.InitialStateSchema))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), varusHailOfArrowsPrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != varusHailOfArrowsPrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, varusHailOfArrowsPrimaryHitAbilityKey, varusHailOfArrowsPrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("hail_of_arrows must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-varusHailOfArrowsPrimaryHitManaCost) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 90", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-varusHailOfArrowsPrimaryHitCDMs) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 10000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no delay/field/slow/blight)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target (Magic damagetype must not leak)", op)
	}
	if op.CritEligible {
		t.Fatal("hail_of_arrows damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("hail_of_arrows damage must not be copyable on hit")
	}
	if op.Ref != varusHailOfArrowsPrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, varusHailOfArrowsPrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, sub(ad.resolved, ad.base)))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-varusHailOfArrowsPrimaryHitBaseDamage) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("base const=%+v want 180", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-varusHailOfArrowsPrimaryHitBonusRatio) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("bonus ratio=%+v want 0.90", mul.Args[0])
	}
	sub := mul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want source.attr.ad.resolved - source.attr.ad.base", sub)
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "stun" ||
			banned.Operation == "projectile" || banned.Operation == "multi_target" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" ||
			banned.Operation == "field" || banned.DamageType == "damage/magic" {
			t.Fatalf("hail_of_arrows must not include field/slow/geometry/state/repeat/magic op: %+v", banned)
		}
	}
}

func findVarusHailOfArrowsPrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := varusHailOfArrowsPrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func varusHailOfArrowsPrimaryHitWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "varus-e.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func varusHailOfArrowsPrimaryHitWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "varus-e.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func varusHailOfArrowsPrimaryHitWikiPagesPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "pages", "varus-e.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki pages sibling missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type varusHailOfArrowsPrimaryHitWikiSidecar struct {
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
		Description string `json:"description"`
		Leveling    string `json:"leveling"`
		Cooldown    string `json:"cooldown"`
		Cost        string `json:"cost"`
		Costtype    string `json:"costtype"`
		Damagetype  string `json:"damagetype"`
		Notes       string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

func varusHailOfArrowsPrimaryHitLoadWikiSidecar(t *testing.T) varusHailOfArrowsPrimaryHitWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(varusHailOfArrowsPrimaryHitWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc varusHailOfArrowsPrimaryHitWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

// TestVarusHailOfArrowsPrimaryHitWikiSidecarIdentityAndBoundary locks repository sidecar
// identity plus the frozen Phase-A completed-boundary constant, and discloses the
// damagetype=Magic contradiction without treating it as runtime truth.
func TestVarusHailOfArrowsPrimaryHitWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := varusHailOfArrowsPrimaryHitLoadWikiSidecar(t)
	if doc.CandidateKey != varusHailOfArrowsPrimaryHitCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, varusHailOfArrowsPrimaryHitCandidateKey)
	}
	if doc.RequestTitle != varusHailOfArrowsPrimaryHitRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, varusHailOfArrowsPrimaryHitRequestTitle)
	}
	if doc.ResolvedTitle != varusHailOfArrowsPrimaryHitResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, varusHailOfArrowsPrimaryHitResolvedTitle)
	}
	if doc.WikiPageID != varusHailOfArrowsPrimaryHitWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, varusHailOfArrowsPrimaryHitWikiPageID)
	}
	if doc.RevisionID != varusHailOfArrowsPrimaryHitRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, varusHailOfArrowsPrimaryHitRevisionID)
	}
	if doc.RevisionTimestamp != varusHailOfArrowsPrimaryHitTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, varusHailOfArrowsPrimaryHitTimestamp)
	}
	if doc.ContentSHA256 != varusHailOfArrowsPrimaryHitContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, varusHailOfArrowsPrimaryHitContentSHA)
	}
	if doc.RawByteSize != varusHailOfArrowsPrimaryHitRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, varusHailOfArrowsPrimaryHitRawBytes)
	}
	if doc.SkillKey != "E" || doc.ZhDisplayName != "恶灵箭雨" || doc.OwnerID != "hero_varus" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want E/恶灵箭雨/hero_varus",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{"description", "leveling", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "90\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "90\n")
	}
	if doc.Fields.Cooldown != "{{ap|18|16|14|12|10}}\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "{{ap|18|16|14|12|10}}\n")
	}
	if doc.Fields.Costtype != "mana\n" {
		t.Fatalf("fields.costtype=%q want mana", doc.Fields.Costtype)
	}
	// Positive physical evidence from same-revision description + leveling (governs runtime).
	if doc.Fields.Description == "" {
		t.Fatal("description empty (fail closed; expect physical damage wording)")
	}
	if !strings.Contains(doc.Fields.Description, "{{as|physical damage}}") {
		t.Fatalf("description missing physical damage wording: %q", doc.Fields.Description)
	}
	if doc.Fields.Leveling == "" {
		t.Fatal("leveling empty (fail closed; expect Physical Damage rank formula)")
	}
	if !strings.Contains(doc.Fields.Leveling, "Physical Damage") {
		t.Fatalf("leveling missing Physical Damage label: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "{{ap|60 to 180}}") {
		t.Fatalf("leveling missing rank formula {{ap|60 to 180}}: %q", doc.Fields.Leveling)
	}
	if !strings.Contains(doc.Fields.Leveling, "90% '''bonus''' AD") {
		t.Fatalf("leveling missing 90%% bonus AD ratio: %q", doc.Fields.Leveling)
	}
	// Known contradiction: isolated damagetype=Magic is source metadata only — not runtime truth.
	if doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("fields.damagetype=%q want %q (known contradiction; must remain disclosed)",
			doc.Fields.Damagetype, "Magic\n")
	}
	if doc.Fields.Notes == "" {
		t.Fatal("notes empty (fail closed)")
	}

	_ = varusHailOfArrowsPrimaryHitWikiPagesPath(t)

	raw, err := os.ReadFile(varusHailOfArrowsPrimaryHitWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("wiki raw empty (fail closed)")
	}
	// Do not assert local raw len/hash equals sidecar canonical metadata
	// (local may be 1748 bytes / SHA42ebcd88… due repository newline materialization).
	if varusHailOfArrowsPrimaryHitBoundary != "rank5_primary_target_single_hit; immediate_impact_scaffold; "+
		"physical_180_plus_0_90_bonus_ad; no_landing_delay_geometry_multitarget_field_slow_grievous_wounds_or_blight_detonation" {
		t.Fatal("frozen boundary constant drifted")
	}
}

// TestVarusHailOfArrowsPrimaryHitRank5DamageFormulaCrossCheck: independent numeric
// cross-check 180 + 0.90*(159-59) = 270; armor 100 → mitigated 135.
func TestVarusHailOfArrowsPrimaryHitRank5DamageFormulaCrossCheck(t *testing.T) {
	bonus := varusHailOfArrowsPrimaryHitADResolved - varusHailOfArrowsPrimaryHitADBase
	if math.Abs(bonus-100) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("bonusAD=%v want 100", bonus)
	}
	raw := varusHailOfArrowsPrimaryHitExpectedRawFromAD(varusHailOfArrowsPrimaryHitADResolved, varusHailOfArrowsPrimaryHitADBase)
	if math.Abs(raw-varusHailOfArrowsPrimaryHitExpectedRaw) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, varusHailOfArrowsPrimaryHitExpectedRaw)
	}
	mit := expectedMitigatedPhysical(raw, varusHailOfArrowsPrimaryHitTargetArmor)
	if math.Abs(mit-varusHailOfArrowsPrimaryHitExpectedMitigated) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, varusHailOfArrowsPrimaryHitExpectedMitigated)
	}
}

// TestVarusHailOfArrowsPrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent E provider: one physical damage op, cost/CD, no listener/state/field/blight.
func TestVarusHailOfArrowsPrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadVarusHailOfArrowsPrimaryHitFixture(t)
	assertVarusHailOfArrowsPrimaryHitProviderShape(t, compileReq)
	if varusHailOfArrowsPrimaryHitProviderRef == varusBQProviderRef ||
		varusHailOfArrowsPrimaryHitProviderRef == varusBQStableID ||
		varusHailOfArrowsPrimaryHitStableID == varusBQProviderRef ||
		varusHailOfArrowsPrimaryHitStableID == varusBQStableID {
		t.Fatal("hail_of_arrows primary-hit must not reuse Varus Blighted Quiver provider refs")
	}
	if varusHailOfArrowsPrimaryHitAbilityKey == varusBQActiveAbilityKey ||
		varusHailOfArrowsPrimaryHitAbilityKey == varusBQCarrierAbilityKey ||
		varusHailOfArrowsPrimaryHitAbilityKey == "basic_attack" ||
		varusHailOfArrowsPrimaryHitAbilityKey == "blighted_quiver" {
		t.Fatal("hail_of_arrows must not reuse Blighted Quiver / Q carrier / basic-attack ability keys")
	}
	if varusHailOfArrowsPrimaryHitDamageOpRef == varusBQOnHitOpRef ||
		varusHailOfArrowsPrimaryHitDamageOpRef == varusBQCarrierQOpRef ||
		varusHailOfArrowsPrimaryHitDamageOpRef == varusBQCarrierActiveOpRef ||
		varusHailOfArrowsPrimaryHitDamageOpRef == varusBQCarrierBlightOpRef ||
		varusHailOfArrowsPrimaryHitDamageOpRef == varusBQAAOpRef {
		t.Fatal("hail_of_arrows primary-hit must not reuse Blighted Quiver operation refs")
	}
	if varusHailOfArrowsPrimaryHitAbilityID != "ability_hero_varus_e_hail_of_arrows_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if varusHailOfArrowsPrimaryHitStableID != "hero_varus_e_hail_of_arrows_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
}

// TestVarusHailOfArrowsPrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target immediate physical damage scaffold: cost 90,
// CD 10000ms exact boundary, one physical hit per successful cast (no AA/crit/phantom/
// field/slow/blight; Magic damagetype metadata does not leak into runtime).
func TestVarusHailOfArrowsPrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadVarusHailOfArrowsPrimaryHitFixture(t)
	assertVarusHailOfArrowsPrimaryHitProviderShape(t, compileReq)

	ref := varusHailOfArrowsPrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10000},
	}
	runReq.StopPolicy.DurationMs = 10100

	done := runVarusHailOfArrowsPrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if varusHailOfArrowsPrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findVarusHailOfArrowsPrimaryHitAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt9999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 9999 {
			t.Fatalf("cooldown skip TimeMs=%d want 9999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 10000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 10000", item.Data["readyAtMs"])
		}
		skipAt9999 = true
	}
	if !skipAt9999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=9999 with readyAtMs=10000")
	}

	items := varusHailOfArrowsPrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("hail_of_arrows damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 10000}
	wantMit := expectedMitigatedPhysical(varusHailOfArrowsPrimaryHitExpectedRaw, varusHailOfArrowsPrimaryHitTargetArmor)
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
			t.Fatalf("damage[%d] type=%q want damage/physical (Magic damagetype must not leak)",
				i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q want %q", i, evidenceDataString(item.Data, "abilityRef"), ref)
		}
		if evidenceDataString(item.Data, "providerRef") != varusHailOfArrowsPrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), varusHailOfArrowsPrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != varusHailOfArrowsPrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), varusHailOfArrowsPrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-varusHailOfArrowsPrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, varusHailOfArrowsPrimaryHitExpectedRaw)
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
	wantHP := varusHailOfArrowsPrimaryHitTargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}

	gotMana := varusHailOfArrowsPrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-varusHailOfArrowsPrimaryHitManaAfter2) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 180; skipped attempt costs 0)", gotMana, varusHailOfArrowsPrimaryHitManaAfter2)
	}
	if math.Abs((varusHailOfArrowsPrimaryHitFixtureMana-gotMana)-180) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("mana spent=%v want 180", varusHailOfArrowsPrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/field/blight hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-varusHailOfArrowsPrimaryHitADResolved) > varusHailOfArrowsPrimaryHitTol {
		t.Fatalf("ad.resolved=%v want %v", got, varusHailOfArrowsPrimaryHitADResolved)
	}
}
