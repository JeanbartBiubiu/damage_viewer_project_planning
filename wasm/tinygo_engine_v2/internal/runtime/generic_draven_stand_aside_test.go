package runtime

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_draven E Stand Aside / 开道利斧 — Phase-A v2 Wasm exact verification slice
// (FROZEN_PLAN_REV: draven-e-stand-aside-phase-a-v2).
//
// Frozen boundary:
//
//	rank5_primary_target_single_hit; immediate_impact_scaffold;
//	physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget
//
// Wiki authority (repository sidecar only; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_draven|E|开道利斧
//	Template:Data Draven/Stand Aside
//	wikiPageId 1307070 / rev 4034694 / timestamp 2026-06-23T21:12:57Z
//	SHA256 7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d
//	数据参考/lol-wiki-current-champions/normalized/generic/draven-e.json
//	raw sibling: raw/draven-e.wikitext
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_draven_e_stand_aside (not Q/W reuse)
//   - ability_key stand_aside: active; mana 70; cooldown 12000 ms
//   - Exactly one immediate direct-target physical damage op:
//     215 + 0.50*(source.attr.ad.resolved - source.attr.ad.base)
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / state / CC / repeat / phantom / loadout behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Wiki notes "{{Effect at cast time end}}" and cast time 0.25s — but AbilityDefinition
//   has no phase/cast-delay field. This scaffold is immediate impact only.
//   Do not claim or invent delayed impact / projectile / knock-aside / slow /
//   line geometry / multi-target / ranks 1–4 / live publish.

const (
	dravenStandAsideCandidateKey = "hero_skill|hero_draven|E|开道利斧"
	dravenStandAsideWikiPageID   = 1307070
	dravenStandAsideRevisionID   = 4034694
	dravenStandAsideTimestamp    = "2026-06-23T21:12:57Z"
	dravenStandAsideContentSHA   = "7bb6ebdc19413ef908e78fea01576d1184a66bc62fd6148120845573c1468e8d"
	dravenStandAsideBoundary     = "rank5_primary_target_single_hit; immediate_impact_scaffold; " +
		"physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget"

	dravenStandAsideProviderRef = "provider_hero_draven_e_stand_aside"
	dravenStandAsideStableID    = "hero_draven_e_stand_aside"
	dravenStandAsideAbilityKey  = "stand_aside"
	dravenStandAsideDamageOpRef = "op:draven_stand_aside_damage"
	dravenStandAsideBonusADMod  = "fixture_draven_stand_aside_bonus_ad"

	dravenStandAsideBaseDamage = 215.0
	dravenStandAsideBonusRatio = 0.50
	dravenStandAsideManaCost   = 70.0
	dravenStandAsideCDMs       = 12000.0

	dravenStandAsideADBase      = 62.0
	dravenStandAsideADResolved  = 142.0
	dravenStandAsideTargetArmor = 100.0
	dravenStandAsideTargetHP    = 100000.0
	dravenStandAsideFixtureMana = 200.0

	// Independent cross-check: bonusAD=80 → raw 255; armor 100 → mitigated 127.5.
	dravenStandAsideExpectedRaw       = 255.0
	dravenStandAsideExpectedMitigated = 127.5

	dravenStandAsideTol = 1e-9
)

func dravenStandAsideExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return dravenStandAsideBaseDamage + dravenStandAsideBonusRatio*(resolvedAD-baseAD)
}

func dravenStandAsideDamageAmount() *model.GenericFormulaExpr {
	base := dravenStandAsideBaseDamage
	ratio := dravenStandAsideBonusRatio
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

func dravenStandAsideAbility() model.AbilityDefinition {
	cost := dravenStandAsideManaCost
	cd := dravenStandAsideCDMs
	return model.AbilityDefinition{
		AbilityKey: dravenStandAsideAbilityKey,
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
				Ref:           dravenStandAsideDamageOpRef,
				Amount:        dravenStandAsideDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func dravenStandAsideProviderDef() model.ProviderDefinition {
	bonusAD := dravenStandAsideADResolved - dravenStandAsideADBase
	return model.ProviderDefinition{
		ProviderKey: dravenStandAsideProviderRef,
		Kind:        "champion",
		StableID:    dravenStandAsideStableID,
		// Fixture-only flat AD so ad.base stays 62 while ad.resolved becomes 142
		// (attribute resolve overwrites a hand-set Resolved that differs from Base).
		Modifiers: []model.ModifierDefinition{{
			ModifierKey: dravenStandAsideBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}},
		Abilities: []model.AbilityDefinition{dravenStandAsideAbility()},
	}
}

func dravenStandAsideAbilityRef() string {
	return "source.provider[" + dravenStandAsideProviderRef + "].ability[" + dravenStandAsideAbilityKey + "]"
}

func configureDravenStandAsideProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{dravenStandAsideProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: dravenStandAsideProviderRef, DefinitionRef: dravenStandAsideProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: dravenStandAsideProviderRef, DefinitionRef: dravenStandAsideProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureDravenStandAsideTypes(req *model.CompileRequest) {
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

func loadDravenStandAsideFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureDravenStandAsideTypes(&compileReq)
	configureDravenStandAsideProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: dravenStandAsideADBase, Current: dravenStandAsideADBase,
		Max: dravenStandAsideADBase, Resolved: dravenStandAsideADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: dravenStandAsideFixtureMana, Max: dravenStandAsideFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: dravenStandAsideTargetHP, Current: dravenStandAsideTargetHP,
		Max: dravenStandAsideTargetHP, Resolved: dravenStandAsideTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: dravenStandAsideTargetArmor, Current: dravenStandAsideTargetArmor,
		Max: dravenStandAsideTargetArmor, Resolved: dravenStandAsideTargetArmor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runDravenStandAside(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func dravenStandAsideSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func dravenStandAsideSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func dravenStandAsideDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != dravenStandAsideDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func dravenStandAsideFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == dravenStandAsideProviderRef {
			return p
		}
	}
	return nil
}

func assertDravenStandAsideProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := dravenStandAsideFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_draven_e_stand_aside missing from SharedProviders")
	}
	if p.ProviderKey != dravenStandAsideProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, dravenStandAsideProviderRef)
	}
	if p.StableID != dravenStandAsideStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, dravenStandAsideStableID)
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener behavior)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no state)", len(p.InitialStateSchema))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1", len(p.Abilities))
	}
	a := p.Abilities[0]
	if a.AbilityKey != dravenStandAsideAbilityKey {
		t.Fatalf("abilityKey=%q want %q", a.AbilityKey, dravenStandAsideAbilityKey)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("stand_aside must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-dravenStandAsideManaCost) > dravenStandAsideTol {
		t.Fatalf("cost=%+v want mana const 70", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-dravenStandAsideCDMs) > dravenStandAsideTol {
		t.Fatalf("cooldown=%+v want const 12000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no CC/geometry)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("stand_aside damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("stand_aside damage must not be copyable on hit")
	}
	if op.Ref != dravenStandAsideDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, dravenStandAsideDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, sub(ad.resolved, ad.base)))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-dravenStandAsideBaseDamage) > dravenStandAsideTol {
		t.Fatalf("base const=%+v want 215", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-dravenStandAsideBonusRatio) > dravenStandAsideTol {
		t.Fatalf("bonus ratio=%+v want 0.50", mul.Args[0])
	}
	sub := mul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want source.attr.ad.resolved - source.attr.ad.base", sub)
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "projectile" ||
			banned.Operation == "multi_target" || banned.Operation == "state_change" ||
			banned.Operation == "repeat" {
			t.Fatalf("stand_aside must not include CC/geometry/state/repeat op: %+v", banned)
		}
	}
}

func findDravenStandAsideAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := dravenStandAsideAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func dravenStandAsideWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "draven-e.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func dravenStandAsideWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "draven-e.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type dravenStandAsideWikiSidecar struct {
	CandidateKey      string `json:"candidateKey"`
	WikiPageID        int    `json:"wikiPageId"`
	RevisionID        int    `json:"revisionId"`
	RevisionTimestamp string `json:"revisionTimestamp"`
	ContentSHA256     string `json:"contentSha256"`
	SkillKey          string `json:"skillKey"`
	ZhDisplayName     string `json:"zhDisplayName"`
	OwnerID           string `json:"ownerId"`
	ResolvedTitle     string `json:"resolvedTitle"`
	Fields            struct {
		Leveling   string `json:"leveling"`
		Cooldown   string `json:"cooldown"`
		Cost       string `json:"cost"`
		Costtype   string `json:"costtype"`
		Damagetype string `json:"damagetype"`
		Notes      string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

func dravenStandAsideLoadWikiSidecar(t *testing.T) dravenStandAsideWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(dravenStandAsideWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc dravenStandAsideWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

// TestDravenStandAsideWikiSidecarIdentityAndBoundary locks repository sidecar
// identity plus the frozen Phase-A completed-boundary constant.
func TestDravenStandAsideWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := dravenStandAsideLoadWikiSidecar(t)
	if doc.CandidateKey != dravenStandAsideCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, dravenStandAsideCandidateKey)
	}
	if doc.WikiPageID != dravenStandAsideWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, dravenStandAsideWikiPageID)
	}
	if doc.RevisionID != dravenStandAsideRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, dravenStandAsideRevisionID)
	}
	if doc.RevisionTimestamp != dravenStandAsideTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, dravenStandAsideTimestamp)
	}
	if doc.ContentSHA256 != dravenStandAsideContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, dravenStandAsideContentSHA)
	}
	if doc.SkillKey != "E" || doc.ZhDisplayName != "开道利斧" || doc.OwnerID != "hero_draven" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want E/开道利斧/hero_draven",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	if doc.ResolvedTitle != "Template:Data Draven/Stand Aside" {
		t.Fatalf("resolvedTitle=%q want Template:Data Draven/Stand Aside", doc.ResolvedTitle)
	}
	for _, key := range []string{"leveling", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "70\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "70\n")
	}
	if doc.Fields.Damagetype != "Physical\n" {
		t.Fatalf("fields.damagetype=%q want Physical", doc.Fields.Damagetype)
	}
	if doc.Fields.Leveling == "" || doc.Fields.Cooldown == "" {
		t.Fatal("leveling/cooldown empty (fail closed)")
	}

	raw, err := os.ReadFile(dravenStandAsideWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("wiki raw empty (fail closed)")
	}
	if dravenStandAsideBoundary != "rank5_primary_target_single_hit; immediate_impact_scaffold; "+
		"physical_215_plus_0_50_bonus_ad; no_cast_time_control_geometry_or_multitarget" {
		t.Fatal("frozen boundary constant drifted")
	}
}

// TestDravenStandAsideRank5DamageFormulaCrossCheck: independent numeric
// cross-check 215 + 0.50*(142-62) = 255; armor 100 → mitigated 127.5.
func TestDravenStandAsideRank5DamageFormulaCrossCheck(t *testing.T) {
	bonus := dravenStandAsideADResolved - dravenStandAsideADBase
	if math.Abs(bonus-80) > dravenStandAsideTol {
		t.Fatalf("bonusAD=%v want 80", bonus)
	}
	raw := dravenStandAsideExpectedRawFromAD(dravenStandAsideADResolved, dravenStandAsideADBase)
	if math.Abs(raw-dravenStandAsideExpectedRaw) > dravenStandAsideTol {
		t.Fatalf("raw=%v want %v", raw, dravenStandAsideExpectedRaw)
	}
	mit := expectedMitigatedPhysical(raw, dravenStandAsideTargetArmor)
	if math.Abs(mit-dravenStandAsideExpectedMitigated) > dravenStandAsideTol {
		t.Fatalf("mitigated=%v want %v", mit, dravenStandAsideExpectedMitigated)
	}
}

// TestDravenStandAsideCompileShapeImmediateScaffold asserts compile shape for the
// independent E provider: one physical damage op, cost/CD, no listener/state/CC.
func TestDravenStandAsideCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadDravenStandAsideFixture(t)
	assertDravenStandAsideProviderShape(t, compileReq)
	if dravenStandAsideProviderRef == dravenSpinningAxeProviderRef ||
		dravenStandAsideProviderRef == dravenBloodRushProviderRef {
		t.Fatal("stand_aside must not reuse Draven Q/W provider refs")
	}
	if dravenStandAsideAbilityKey == dravenSpinningAxeQKey ||
		dravenStandAsideAbilityKey == dravenBloodRushWKey {
		t.Fatal("stand_aside must not reuse Draven Q/W ability keys")
	}
}

// TestDravenStandAsideCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target immediate damage scaffold: cost 70, CD 12000ms
// exact boundary, one physical hit per successful cast (no AA/crit/phantom/CC).
func TestDravenStandAsideCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadDravenStandAsideFixture(t)
	assertDravenStandAsideProviderShape(t, compileReq)

	ref := dravenStandAsideAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 12000},
	}
	runReq.StopPolicy.DurationMs = 12100

	done := runDravenStandAside(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if dravenStandAsideSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findDravenStandAsideAbilityStat(t, done)
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

	items := dravenStandAsideDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("stand_aside damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 12000}
	wantMit := expectedMitigatedPhysical(dravenStandAsideExpectedRaw, dravenStandAsideTargetArmor)
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
			t.Fatalf("damage[%d] type=%q", i, evidenceDataString(item.Data, "damageType"))
		}
		if evidenceDataString(item.Data, "abilityRef") != ref {
			t.Fatalf("damage[%d] abilityRef=%q want %q", i, evidenceDataString(item.Data, "abilityRef"), ref)
		}
		if evidenceDataString(item.Data, "providerRef") != dravenStandAsideProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), dravenStandAsideProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != dravenStandAsideDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), dravenStandAsideDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-dravenStandAsideExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, dravenStandAsideExpectedRaw)
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
	wantHP := dravenStandAsideTargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}

	gotMana := dravenStandAsideSourceMana(t, done.FinalSnapshot)
	wantMana := dravenStandAsideFixtureMana - 2*dravenStandAsideManaCost
	if math.Abs(gotMana-wantMana) > dravenStandAsideTol {
		t.Fatalf("mana=%v want %v (spent exactly 140; skipped attempt costs 0)", gotMana, wantMana)
	}
	if math.Abs((dravenStandAsideFixtureMana-gotMana)-140) > dravenStandAsideTol {
		t.Fatalf("mana spent=%v want 140", dravenStandAsideFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/CC hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-dravenStandAsideADResolved) > dravenStandAsideTol {
		t.Fatalf("ad.resolved=%v want %v", got, dravenStandAsideADResolved)
	}
}
