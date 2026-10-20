package runtime

import (
	"math"

	"testing"
	"tinygo_engine_v2/internal/testkit/formuladefinition"

	"tinygo_engine_v2/internal/model"
)

// 固定构造的通用机制样例；资料说明仅保留历史出处，不作为测试断言。
// hero_kogmaw E Void Ooze / 虚空淤泥 — Phase-A v1 Wasm exact verification slice
// (FROZEN_PLAN_REV: kogmaw-e-void-ooze-primary-hit-phase-a-v1).
//
// Frozen boundary:
//
//	rank5_primary_target_single_hit; immediate_impact_scaffold;
//	magic_230_plus_0_65_ap; no_projectile_geometry_multitarget_slow_field_or_duration
//
// Wiki authority (repository sidecar only; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_kogmaw|E|虚空淤泥
//	Request Template:Data Kog'Maw/E → resolved Template:Data Kog'Maw/Void Ooze
//	wikiPageId 1307961 / rev 3965135 / timestamp 2025-11-11T17:05:55Z
//	sidecar rawByteSize 1356 / SHA256 1dd448ea1985237f002dec43e2bf93d860eb976f7c98e75883254cb3cf70794b
//	数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-e.json
//	pages/raw siblings: pages/kogmaw-e.json, raw/kogmaw-e.wikitext

//
// Rank-5 Phase-A contract:
//   - Independent provider provider_hero_kogmaw_e_void_ooze_primary_hit
//     (not Caustic Spittle / Bio-Arcane Barrage / basic-attack reuse)
//   - ability ability_hero_kogmaw_e_void_ooze_primary_hit with ability_key void_ooze:
//     active; mana 100; cooldown 12000 ms
//   - Exactly one immediate direct-target magic damage op:
//     230 + 0.65*source.attr.ap.resolved
//   - CritEligible=false, CopyableOnHit=false; not ability/basic_attack
//   - No listener / state / modifier / projectile / geometry / multi-target /
//     ooze field / slow / duration / repeat / phantom / equipment / loadout /
//     on-hit behavior
//
// Explicit exclusions (completed boundary wording; not remaining blockers):
//   Wiki describes target-direction missile, ooze field path blobs every 125
//   units, 3s duration, slow 40–60% every 0.25s — but this scaffold is
//   immediate primary-target damage only. Wiki "Effect at cast time start"
//   is compatible with the immediate scaffold; do not add a fake cast-delay
//   phase. Do not claim or invent projectile/missile/travel/collision/path/
//   range/width/speed/geometry, all-enemies/multi-target/repeated hits, ooze
//   field/path blobs/duration, slow ticks/linger, cast animation beyond
//   scaffold, ranks 1–4, basic / Bio-Arcane Barrage / Caustic Spittle /
//   on-hit / equipment / loadout coupling, live publish, or full fidelity.

const (
	kogmawVoidOozePrimaryHitProviderRef = "provider_hero_kogmaw_e_void_ooze_primary_hit"
	kogmawVoidOozePrimaryHitStableID    = "hero_kogmaw_e_void_ooze_primary_hit"
	kogmawVoidOozePrimaryHitAbilityID   = "ability_hero_kogmaw_e_void_ooze_primary_hit"
	kogmawVoidOozePrimaryHitAbilityKey  = "void_ooze"
	kogmawVoidOozePrimaryHitDamageOpRef = "op:kogmaw_void_ooze_primary_hit_damage"

	// Must not collide with existing Kog'Maw Caustic Spittle / Bio-Arcane Barrage fixtures.
	kogmawCausticSpittleProviderKeyAlias = "provider_hero_kogmaw_caustic_spittle"
	kogmawBioArcaneBarrageProviderKey    = "hero:kogmaw_bio_arcane_barrage"
	kogmawBioArcaneBarrageDefRef         = "provider_hero_kogmaw_bio_arcane_barrage"

	kogmawVoidOozePrimaryHitBaseDamage = 230.0
	kogmawVoidOozePrimaryHitAPRatio    = 0.65
	kogmawVoidOozePrimaryHitManaCost   = 100.0
	kogmawVoidOozePrimaryHitCDMs       = 12000.0

	kogmawVoidOozePrimaryHitFixtureAP   = 100.0
	kogmawVoidOozePrimaryHitFixtureMana = 325.0
	kogmawVoidOozePrimaryHitTargetMR    = 100.0
	kogmawVoidOozePrimaryHitTargetHP    = 100000.0

	// Independent cross-check: AP=100 → raw 295; MR 100 → mitigated 147.5.
	kogmawVoidOozePrimaryHitExpectedRaw       = 295.0
	kogmawVoidOozePrimaryHitExpectedMitigated = 147.5
	kogmawVoidOozePrimaryHitManaAfter2        = 125.0 // 325 - 100 - 100

	kogmawVoidOozePrimaryHitTol = 1e-9
)

func kogmawVoidOozePrimaryHitExpectedRawFromAP(resolvedAP float64) float64 {
	return kogmawVoidOozePrimaryHitBaseDamage + kogmawVoidOozePrimaryHitAPRatio*resolvedAP
}

func kogmawVoidOozePrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := kogmawVoidOozePrimaryHitBaseDamage
	ratio := kogmawVoidOozePrimaryHitAPRatio
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

func kogmawVoidOozePrimaryHitAbility() model.AbilityDefinition {
	cost := kogmawVoidOozePrimaryHitManaCost
	cd := kogmawVoidOozePrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: kogmawVoidOozePrimaryHitAbilityKey,
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
				Ref:           kogmawVoidOozePrimaryHitDamageOpRef,
				Amount:        kogmawVoidOozePrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func kogmawVoidOozePrimaryHitProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: kogmawVoidOozePrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    kogmawVoidOozePrimaryHitStableID,
		Abilities:   []model.AbilityDefinition{kogmawVoidOozePrimaryHitAbility()},
	}
}

func kogmawVoidOozePrimaryHitAbilityRef() string {
	return "source.provider[" + kogmawVoidOozePrimaryHitProviderRef + "].ability[" + kogmawVoidOozePrimaryHitAbilityKey + "]"
}

func configureKogmawVoidOozePrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{kogmawVoidOozePrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: kogmawVoidOozePrimaryHitProviderRef, DefinitionRef: kogmawVoidOozePrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: kogmawVoidOozePrimaryHitProviderRef, DefinitionRef: kogmawVoidOozePrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureKogmawVoidOozePrimaryHitTypes(req *model.CompileRequest) {
	formuladefinition.DeclareAttributes(req, "magic_resist")
	formuladefinition.SetDamageFormula(req, "damage/magic", formuladefinition.ResistanceDefense("magic_resist"))

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

func loadKogmawVoidOozePrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureKogmawVoidOozePrimaryHitTypes(&compileReq)
	configureKogmawVoidOozePrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: kogmawVoidOozePrimaryHitFixtureAP, Current: kogmawVoidOozePrimaryHitFixtureAP,
		Max: kogmawVoidOozePrimaryHitFixtureAP, Resolved: kogmawVoidOozePrimaryHitFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: kogmawVoidOozePrimaryHitFixtureMana, Max: kogmawVoidOozePrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: kogmawVoidOozePrimaryHitTargetHP, Current: kogmawVoidOozePrimaryHitTargetHP,
		Max: kogmawVoidOozePrimaryHitTargetHP, Resolved: kogmawVoidOozePrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: kogmawVoidOozePrimaryHitTargetMR, Current: kogmawVoidOozePrimaryHitTargetMR,
		Max: kogmawVoidOozePrimaryHitTargetMR, Resolved: kogmawVoidOozePrimaryHitTargetMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runKogmawVoidOozePrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func kogmawVoidOozePrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func kogmawVoidOozePrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func kogmawVoidOozePrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != kogmawVoidOozePrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func kogmawVoidOozePrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == kogmawVoidOozePrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertKogmawVoidOozePrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := kogmawVoidOozePrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_kogmaw_e_void_ooze_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != kogmawVoidOozePrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, kogmawVoidOozePrimaryHitProviderRef)
	}
	if p.StableID != kogmawVoidOozePrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, kogmawVoidOozePrimaryHitStableID)
	}
	if p.ProviderKey == kogmawCausticSpittleProviderKeyAlias ||
		p.ProviderKey == kogmawBioArcaneBarrageProviderKey ||
		p.ProviderKey == kogmawBioArcaneBarrageDefRef ||
		p.StableID == kogmawCausticSpittleProviderKeyAlias ||
		p.StableID == kogmawBioArcaneBarrageProviderKey ||
		p.StableID == kogmawBioArcaneBarrageDefRef ||
		p.ProviderKey == gcohKogProviderRef {
		t.Fatal("void_ooze primary-hit must not reuse Caustic Spittle / Bio-Arcane Barrage provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / Bio-Arcane Barrage coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no slow/field/state)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (no equipment/loadout/state modifiers)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), kogmawVoidOozePrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != kogmawVoidOozePrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, kogmawVoidOozePrimaryHitAbilityKey, kogmawVoidOozePrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("void_ooze must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-kogmawVoidOozePrimaryHitManaCost) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 100", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-kogmawVoidOozePrimaryHitCDMs) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 12000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no projectile/field/slow)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("void_ooze damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("void_ooze damage must not be copyable on hit")
	}
	if op.Ref != kogmawVoidOozePrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, kogmawVoidOozePrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-kogmawVoidOozePrimaryHitBaseDamage) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("base const=%+v want 230", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-kogmawVoidOozePrimaryHitAPRatio) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("AP ratio=%+v want 0.65", mul.Args[0])
	}
	if mul.Args[1].Op != "read" || mul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", mul.Args[1])
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "projectile" ||
			banned.Operation == "multi_target" || banned.Operation == "state_change" ||
			banned.Operation == "repeat" || banned.Operation == "field" {
			t.Fatalf("void_ooze must not include field/slow/projectile/geometry/state/repeat op: %+v", banned)
		}
	}
}

func findKogmawVoidOozePrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := kogmawVoidOozePrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

// TestKogmawVoidOozePrimaryHitRank5DamageFormulaCrossCheck: independent numeric
// cross-check 230 + 0.65*100 = 295; MR 100 → mitigated 147.5.
func TestKogmawVoidOozePrimaryHitRank5DamageFormulaCrossCheck(t *testing.T) {
	raw := kogmawVoidOozePrimaryHitExpectedRawFromAP(kogmawVoidOozePrimaryHitFixtureAP)
	if math.Abs(raw-kogmawVoidOozePrimaryHitExpectedRaw) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, kogmawVoidOozePrimaryHitExpectedRaw)
	}
	mit := expectedMitigatedMagic(raw, kogmawVoidOozePrimaryHitTargetMR)
	if math.Abs(mit-kogmawVoidOozePrimaryHitExpectedMitigated) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, kogmawVoidOozePrimaryHitExpectedMitigated)
	}
}

// TestKogmawVoidOozePrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent E provider: one magic damage op, cost/CD, no listener/state/field/slow.
func TestKogmawVoidOozePrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadKogmawVoidOozePrimaryHitFixture(t)
	assertKogmawVoidOozePrimaryHitProviderShape(t, compileReq)
	if kogmawVoidOozePrimaryHitProviderRef == kogmawCausticSpittleProviderKeyAlias ||
		kogmawVoidOozePrimaryHitProviderRef == kogmawBioArcaneBarrageProviderKey ||
		kogmawVoidOozePrimaryHitProviderRef == kogmawBioArcaneBarrageDefRef ||
		kogmawVoidOozePrimaryHitProviderRef == gcohKogProviderRef {
		t.Fatal("void_ooze primary-hit must not reuse Caustic Spittle / Bio-Arcane Barrage provider refs")
	}
	if kogmawVoidOozePrimaryHitAbilityKey == kogmawCausticSpittleAbilityKey ||
		kogmawVoidOozePrimaryHitAbilityKey == "bio_arcane_barrage" ||
		kogmawVoidOozePrimaryHitAbilityKey == "basic_attack" {
		t.Fatal("void_ooze must not reuse Caustic Spittle / Bio-Arcane Barrage / basic-attack ability keys")
	}
	if kogmawVoidOozePrimaryHitDamageOpRef == kogmawCausticSpittleDamageOpRef ||
		kogmawVoidOozePrimaryHitDamageOpRef == gcohKogOpRef {
		t.Fatal("void_ooze primary-hit must not reuse Caustic Spittle / Bio-Arcane Barrage operation refs")
	}
	if kogmawVoidOozePrimaryHitAbilityID != "ability_hero_kogmaw_e_void_ooze_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if kogmawVoidOozePrimaryHitStableID != "hero_kogmaw_e_void_ooze_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
}

// TestKogmawVoidOozePrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target immediate magic damage scaffold: cost 100,
// CD 12000ms exact boundary, one magic hit per successful cast (no AA/crit/phantom/field/slow).
func TestKogmawVoidOozePrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadKogmawVoidOozePrimaryHitFixture(t)
	assertKogmawVoidOozePrimaryHitProviderShape(t, compileReq)

	ref := kogmawVoidOozePrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 12000},
	}
	runReq.StopPolicy.DurationMs = 12100

	done := runKogmawVoidOozePrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if kogmawVoidOozePrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findKogmawVoidOozePrimaryHitAbilityStat(t, done)
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

	items := kogmawVoidOozePrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("void_ooze damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 12000}
	wantMit := expectedMitigatedMagic(kogmawVoidOozePrimaryHitExpectedRaw, kogmawVoidOozePrimaryHitTargetMR)
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
		if evidenceDataString(item.Data, "providerRef") != kogmawVoidOozePrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), kogmawVoidOozePrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != kogmawVoidOozePrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), kogmawVoidOozePrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-kogmawVoidOozePrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, kogmawVoidOozePrimaryHitExpectedRaw)
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
	wantHP := kogmawVoidOozePrimaryHitTargetHP - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}

	gotMana := kogmawVoidOozePrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-kogmawVoidOozePrimaryHitManaAfter2) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 200; skipped attempt costs 0)", gotMana, kogmawVoidOozePrimaryHitManaAfter2)
	}
	if math.Abs((kogmawVoidOozePrimaryHitFixtureMana-gotMana)-200) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("mana spent=%v want 200", kogmawVoidOozePrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/field/Caustic Spittle/Bio-Arcane hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ap"); math.Abs(got-kogmawVoidOozePrimaryHitFixtureAP) > kogmawVoidOozePrimaryHitTol {
		t.Fatalf("ap.resolved=%v want %v", got, kogmawVoidOozePrimaryHitFixtureAP)
	}
}
