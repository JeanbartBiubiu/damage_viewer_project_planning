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

// hero_teemo Q Blinding Dart / 致盲吹箭 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: teemo-q-blinding-dart-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_target_single_hit; immediate_impact_scaffold;
//	magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry
//
// Wiki authority (repository sidecar only; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_teemo|Q|致盲吹箭
//	Request Template:Data Teemo/Q → resolved Template:Data Teemo/Blinding Dart
//	wikiPageId 1308208 / rev 3948425 / timestamp 2025-08-19T15:37:23Z
//	raw bytes 1639 / SHA256 4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7
//	数据参考/lol-wiki-current-champions/normalized/generic/teemo-q.json
//	raw sibling: raw/teemo-q.wikitext
//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_teemo_q_blinding_dart (not Toxic Shot / AA reuse)
//   - ability_key blinding_dart: active; mana 90; cooldown 7000 ms
//   - Exactly one immediate direct-target magic damage op:
//     260 + 0.70*source.attr.ap.resolved
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / state / blind / repeat / phantom / loadout / on-hit behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Wiki describes blind duration and cast/projectile/geometry notes — but this
//   scaffold is immediate primary-target damage only. Do not claim or invent
//   blind/control, 0.25s cast time, projectile/speed/range/geometry/collision,
//   ranks 1–4, Toxic Shot / basic-attack coupling, multi-target, or full fidelity.
//   Existing Draven E / Kayle Q projections establish excluded control effects do
//   not block a bounded direct-damage projection.

const (
	teemoBlindingDartCandidateKey = "hero_skill|hero_teemo|Q|致盲吹箭"
	teemoBlindingDartRequestTitle = "Template:Data Teemo/Q"
	teemoBlindingDartResolvedTitle = "Template:Data Teemo/Blinding Dart"
	teemoBlindingDartWikiPageID   = 1308208
	teemoBlindingDartRevisionID   = 3948425
	teemoBlindingDartTimestamp    = "2025-08-19T15:37:23Z"
	teemoBlindingDartRawBytes     = 1639
	teemoBlindingDartContentSHA   = "4e3c475ed55ec865f6a9060c8ad0b2665e5379b3ae7e9e5cb644f83212b240a7"
	teemoBlindingDartBoundary     = "rank5_primary_target_single_hit; immediate_impact_scaffold; " +
		"magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry"

	teemoBlindingDartProviderRef = "provider_hero_teemo_q_blinding_dart"
	teemoBlindingDartStableID    = "hero_teemo_q_blinding_dart"
	teemoBlindingDartAbilityKey  = "blinding_dart"
	teemoBlindingDartDamageOpRef = "op:teemo_blinding_dart_damage"

	// Must not collide with existing Teemo Toxic Shot generic/on-hit fixtures.
	teemoToxicShotProviderKey = "hero:teemo_toxic_shot"
	teemoToxicShotDefRef      = "provider_hero_teemo_toxic_shot"

	teemoBlindingDartBaseDamage = 260.0
	teemoBlindingDartAPRatio    = 0.70
	teemoBlindingDartManaCost   = 90.0
	teemoBlindingDartCDMs       = 7000.0

	teemoBlindingDartFixtureAP  = 200.0
	teemoBlindingDartFixtureMana = 334.0
	teemoBlindingDartTargetMR   = 100.0
	teemoBlindingDartTargetHP   = 100000.0

	// Independent cross-check: AP=200 → raw 400; MR 100 → mitigated 200.
	teemoBlindingDartExpectedRaw       = 400.0
	teemoBlindingDartExpectedMitigated = 200.0
	teemoBlindingDartManaAfter2        = 154.0 // 334 - 90 - 90

	teemoBlindingDartTol = 1e-9
)

func teemoBlindingDartExpectedRawFromAP(resolvedAP float64) float64 {
	return teemoBlindingDartBaseDamage + teemoBlindingDartAPRatio*resolvedAP
}

func teemoBlindingDartDamageAmount() *model.GenericFormulaExpr {
	base := teemoBlindingDartBaseDamage
	ratio := teemoBlindingDartAPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{Op: "read", Path: "source.attr.ap.resolved"},
				},
			},
		},
	}
}

func teemoBlindingDartAbility() model.AbilityDefinition {
	cost := teemoBlindingDartManaCost
	cd := teemoBlindingDartCDMs
	return model.AbilityDefinition{
		AbilityKey: teemoBlindingDartAbilityKey,
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
				Ref:           teemoBlindingDartDamageOpRef,
				Amount:        teemoBlindingDartDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func teemoBlindingDartProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: teemoBlindingDartProviderRef,
		Kind:        "champion",
		StableID:    teemoBlindingDartStableID,
		Abilities:   []model.AbilityDefinition{teemoBlindingDartAbility()},
	}
}

func teemoBlindingDartAbilityRef() string {
	return "source.provider[" + teemoBlindingDartProviderRef + "].ability[" + teemoBlindingDartAbilityKey + "]"
}

func configureTeemoBlindingDartProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{teemoBlindingDartProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: teemoBlindingDartProviderRef, DefinitionRef: teemoBlindingDartProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: teemoBlindingDartProviderRef, DefinitionRef: teemoBlindingDartProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureTeemoBlindingDartTypes(req *model.CompileRequest) {
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

func loadTeemoBlindingDartFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureTeemoBlindingDartTypes(&compileReq)
	configureTeemoBlindingDartProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: teemoBlindingDartFixtureAP, Current: teemoBlindingDartFixtureAP,
		Max: teemoBlindingDartFixtureAP, Resolved: teemoBlindingDartFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: teemoBlindingDartFixtureMana, Max: teemoBlindingDartFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: teemoBlindingDartTargetHP, Current: teemoBlindingDartTargetHP,
		Max: teemoBlindingDartTargetHP, Resolved: teemoBlindingDartTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: teemoBlindingDartTargetMR, Current: teemoBlindingDartTargetMR,
		Max: teemoBlindingDartTargetMR, Resolved: teemoBlindingDartTargetMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runTeemoBlindingDart(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func teemoBlindingDartSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func teemoBlindingDartSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func teemoBlindingDartDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != teemoBlindingDartDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func teemoBlindingDartFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == teemoBlindingDartProviderRef {
			return p
		}
	}
	return nil
}

func assertTeemoBlindingDartProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := teemoBlindingDartFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_teemo_q_blinding_dart missing from SharedProviders")
	}
	if p.ProviderKey != teemoBlindingDartProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, teemoBlindingDartProviderRef)
	}
	if p.StableID != teemoBlindingDartStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, teemoBlindingDartStableID)
	}
	if p.ProviderKey == teemoToxicShotProviderKey || p.ProviderKey == teemoToxicShotDefRef ||
		p.StableID == teemoToxicShotProviderKey || p.StableID == teemoToxicShotDefRef {
		t.Fatal("blinding_dart must not reuse Teemo Toxic Shot provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / Toxic Shot coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no blind/state)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (no equipment/loadout/state modifiers)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1", len(p.Abilities))
	}
	a := p.Abilities[0]
	if a.AbilityKey != teemoBlindingDartAbilityKey {
		t.Fatalf("abilityKey=%q want %q", a.AbilityKey, teemoBlindingDartAbilityKey)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("blinding_dart must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-teemoBlindingDartManaCost) > teemoBlindingDartTol {
		t.Fatalf("cost=%+v want mana const 90", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-teemoBlindingDartCDMs) > teemoBlindingDartTol {
		t.Fatalf("cooldown=%+v want const 7000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no blind/geometry)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("blinding_dart damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("blinding_dart damage must not be copyable on hit")
	}
	if op.Ref != teemoBlindingDartDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, teemoBlindingDartDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-teemoBlindingDartBaseDamage) > teemoBlindingDartTol {
		t.Fatalf("base const=%+v want 260", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-teemoBlindingDartAPRatio) > teemoBlindingDartTol {
		t.Fatalf("AP ratio=%+v want 0.70", mul.Args[0])
	}
	if mul.Args[1].Op != "read" || mul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", mul.Args[1])
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "blind" ||
			banned.Operation == "projectile" || banned.Operation == "multi_target" ||
			banned.Operation == "state_change" || banned.Operation == "repeat" {
			t.Fatalf("blinding_dart must not include blind/control/geometry/state/repeat op: %+v", banned)
		}
	}
}

func findTeemoBlindingDartAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := teemoBlindingDartAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func teemoBlindingDartWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "teemo-q.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func teemoBlindingDartWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "teemo-q.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type teemoBlindingDartWikiSidecar struct {
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
		Leveling   string `json:"leveling"`
		Cooldown   string `json:"cooldown"`
		Cost       string `json:"cost"`
		Costtype   string `json:"costtype"`
		Damagetype string `json:"damagetype"`
		Notes      string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

func teemoBlindingDartLoadWikiSidecar(t *testing.T) teemoBlindingDartWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(teemoBlindingDartWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc teemoBlindingDartWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

// TestTeemoBlindingDartWikiSidecarIdentityAndBoundary locks repository sidecar
// identity plus the frozen Phase-A completed-boundary constant.
func TestTeemoBlindingDartWikiSidecarIdentityAndBoundary(t *testing.T) {
	doc := teemoBlindingDartLoadWikiSidecar(t)
	if doc.CandidateKey != teemoBlindingDartCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, teemoBlindingDartCandidateKey)
	}
	if doc.RequestTitle != teemoBlindingDartRequestTitle {
		t.Fatalf("requestTitle=%q want %q", doc.RequestTitle, teemoBlindingDartRequestTitle)
	}
	if doc.ResolvedTitle != teemoBlindingDartResolvedTitle {
		t.Fatalf("resolvedTitle=%q want %q", doc.ResolvedTitle, teemoBlindingDartResolvedTitle)
	}
	if doc.WikiPageID != teemoBlindingDartWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, teemoBlindingDartWikiPageID)
	}
	if doc.RevisionID != teemoBlindingDartRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, teemoBlindingDartRevisionID)
	}
	if doc.RevisionTimestamp != teemoBlindingDartTimestamp {
		t.Fatalf("revisionTimestamp=%q want %q", doc.RevisionTimestamp, teemoBlindingDartTimestamp)
	}
	if doc.ContentSHA256 != teemoBlindingDartContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, teemoBlindingDartContentSHA)
	}
	if doc.RawByteSize != teemoBlindingDartRawBytes {
		t.Fatalf("rawByteSize=%d want %d", doc.RawByteSize, teemoBlindingDartRawBytes)
	}
	if doc.SkillKey != "Q" || doc.ZhDisplayName != "致盲吹箭" || doc.OwnerID != "hero_teemo" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want Q/致盲吹箭/hero_teemo",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{"leveling", "cooldown", "cost", "costtype", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.Fields.Cost != "{{ap|70 to 90}}\n" {
		t.Fatalf("fields.cost=%q want %q", doc.Fields.Cost, "{{ap|70 to 90}}\n")
	}
	if doc.Fields.Cooldown != "7\n" {
		t.Fatalf("fields.cooldown=%q want %q", doc.Fields.Cooldown, "7\n")
	}
	if doc.Fields.Damagetype != "Magic\n" {
		t.Fatalf("fields.damagetype=%q want Magic", doc.Fields.Damagetype)
	}
	if doc.Fields.Costtype != "Mana\n" {
		t.Fatalf("fields.costtype=%q want Mana", doc.Fields.Costtype)
	}
	if doc.Fields.Leveling == "" {
		t.Fatal("leveling empty (fail closed)")
	}

	raw, err := os.ReadFile(teemoBlindingDartWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("wiki raw empty (fail closed)")
	}
	if len(raw) != teemoBlindingDartRawBytes {
		t.Fatalf("wiki raw bytes=%d want %d", len(raw), teemoBlindingDartRawBytes)
	}
	if teemoBlindingDartBoundary != "rank5_primary_target_single_hit; immediate_impact_scaffold; "+
		"magic_260_plus_0_70_ap; no_blind_cast_time_projectile_or_geometry" {
		t.Fatal("frozen boundary constant drifted")
	}
}

// TestTeemoBlindingDartRank5DamageFormulaCrossCheck: independent numeric
// cross-check 260 + 0.70*200 = 400; MR 100 → mitigated 200.
func TestTeemoBlindingDartRank5DamageFormulaCrossCheck(t *testing.T) {
	raw := teemoBlindingDartExpectedRawFromAP(teemoBlindingDartFixtureAP)
	if math.Abs(raw-teemoBlindingDartExpectedRaw) > teemoBlindingDartTol {
		t.Fatalf("raw=%v want %v", raw, teemoBlindingDartExpectedRaw)
	}
	mit := expectedMitigatedMagic(raw, teemoBlindingDartTargetMR)
	if math.Abs(mit-teemoBlindingDartExpectedMitigated) > teemoBlindingDartTol {
		t.Fatalf("mitigated=%v want %v", mit, teemoBlindingDartExpectedMitigated)
	}
}

// TestTeemoBlindingDartCompileShapeImmediateScaffold asserts compile shape for the
// independent Q provider: one magic damage op, cost/CD, no listener/state/blind.
func TestTeemoBlindingDartCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadTeemoBlindingDartFixture(t)
	assertTeemoBlindingDartProviderShape(t, compileReq)
	if teemoBlindingDartProviderRef == teemoToxicShotProviderKey ||
		teemoBlindingDartProviderRef == teemoToxicShotDefRef ||
		teemoBlindingDartProviderRef == gcohTeemoProviderRef {
		t.Fatal("blinding_dart must not reuse Teemo Toxic Shot provider refs")
	}
	if teemoBlindingDartAbilityKey == "toxic_shot" || teemoBlindingDartAbilityKey == "basic_attack" {
		t.Fatal("blinding_dart must not reuse Toxic Shot / basic-attack ability keys")
	}
	if teemoBlindingDartDamageOpRef == gcohTeemoOpRef {
		t.Fatal("blinding_dart must not reuse Toxic Shot operation refs")
	}
}

// TestTeemoBlindingDartCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target immediate magic damage scaffold: cost 90,
// CD 7000ms exact boundary, one magic hit per successful cast (no AA/crit/phantom/blind).
func TestTeemoBlindingDartCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadTeemoBlindingDartFixture(t)
	assertTeemoBlindingDartProviderShape(t, compileReq)

	ref := teemoBlindingDartAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 6999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7000},
	}
	runReq.StopPolicy.DurationMs = 7100

	done := runTeemoBlindingDart(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if teemoBlindingDartSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findTeemoBlindingDartAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt6999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 6999 {
			t.Fatalf("cooldown skip TimeMs=%d want 6999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 7000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 7000", item.Data["readyAtMs"])
		}
		skipAt6999 = true
	}
	if !skipAt6999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=6999 with readyAtMs=7000")
	}

	items := teemoBlindingDartDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("blinding_dart damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 7000}
	wantMit := expectedMitigatedMagic(teemoBlindingDartExpectedRaw, teemoBlindingDartTargetMR)
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
		if evidenceDataString(item.Data, "providerRef") != teemoBlindingDartProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), teemoBlindingDartProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != teemoBlindingDartDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), teemoBlindingDartDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-teemoBlindingDartExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, teemoBlindingDartExpectedRaw)
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
	wantHP := teemoBlindingDartTargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}

	gotMana := teemoBlindingDartSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-teemoBlindingDartManaAfter2) > teemoBlindingDartTol {
		t.Fatalf("mana=%v want %v (spent exactly 180; skipped attempt costs 0)", gotMana, teemoBlindingDartManaAfter2)
	}
	if math.Abs((teemoBlindingDartFixtureMana-gotMana)-180) > teemoBlindingDartTol {
		t.Fatalf("mana spent=%v want 180", teemoBlindingDartFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/blind/Toxic Shot hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ap"); math.Abs(got-teemoBlindingDartFixtureAP) > teemoBlindingDartTol {
		t.Fatalf("ap.resolved=%v want %v", got, teemoBlindingDartFixtureAP)
	}
}
