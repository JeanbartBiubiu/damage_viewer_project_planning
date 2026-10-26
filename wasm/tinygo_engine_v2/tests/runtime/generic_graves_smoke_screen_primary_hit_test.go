// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	gravesSmokeScreenPrimaryHitProviderRef = "provider_hero_graves_w_smoke_screen_primary_hit"
	gravesSmokeScreenPrimaryHitStableID    = "hero_graves_w_smoke_screen_primary_hit"
	gravesSmokeScreenPrimaryHitAbilityID   = "ability_hero_graves_w_smoke_screen_primary_hit"
	gravesSmokeScreenPrimaryHitAbilityKey  = "smoke_screen"
	gravesSmokeScreenPrimaryHitDamageOpRef = "op:graves_smoke_screen_primary_hit_damage"

	gravesSmokeScreenPrimaryHitBaseDamage = 260.0
	gravesSmokeScreenPrimaryHitAPRatio    = 0.60
	gravesSmokeScreenPrimaryHitManaCost   = 90.0
	gravesSmokeScreenPrimaryHitCDMs       = 18000.0

	gravesSmokeScreenPrimaryHitFixtureAP   = 200.0
	gravesSmokeScreenPrimaryHitFixtureMana = 325.0
	gravesSmokeScreenPrimaryHitTargetMR    = 100.0
	gravesSmokeScreenPrimaryHitTargetHP    = 1000.0

	// Independent cross-check: AP=200 → raw 380; MR 100 → mitigated 190.
	gravesSmokeScreenPrimaryHitExpectedRaw       = 380.0
	gravesSmokeScreenPrimaryHitExpectedMitigated = 190.0
	gravesSmokeScreenPrimaryHitManaAfter2        = 145.0 // 325 - 90 - 90
	gravesSmokeScreenPrimaryHitHPAfter2          = 620.0 // 1000 - 190 - 190

	gravesSmokeScreenPrimaryHitTol = 1e-9
)

func gravesSmokeScreenPrimaryHitExpectedRawFromAP(resolvedAP float64) float64 {
	return gravesSmokeScreenPrimaryHitBaseDamage + gravesSmokeScreenPrimaryHitAPRatio*resolvedAP
}

func gravesSmokeScreenPrimaryHitDamageAmount() *model.GenericFormulaExpr {
	base := gravesSmokeScreenPrimaryHitBaseDamage
	ratio := gravesSmokeScreenPrimaryHitAPRatio
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

func gravesSmokeScreenPrimaryHitAbility() model.AbilityDefinition {
	cost := gravesSmokeScreenPrimaryHitManaCost
	cd := gravesSmokeScreenPrimaryHitCDMs
	return model.AbilityDefinition{
		AbilityKey: gravesSmokeScreenPrimaryHitAbilityKey,
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
				Ref:           gravesSmokeScreenPrimaryHitDamageOpRef,
				Amount:        gravesSmokeScreenPrimaryHitDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func gravesSmokeScreenPrimaryHitProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: gravesSmokeScreenPrimaryHitProviderRef,
		Kind:        "champion",
		StableID:    gravesSmokeScreenPrimaryHitStableID,
		Abilities:   []model.AbilityDefinition{gravesSmokeScreenPrimaryHitAbility()},
	}
}

func gravesSmokeScreenPrimaryHitAbilityRef() string {
	return "source.provider[" + gravesSmokeScreenPrimaryHitProviderRef + "].ability[" + gravesSmokeScreenPrimaryHitAbilityKey + "]"
}

func configureGravesSmokeScreenPrimaryHitProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{gravesSmokeScreenPrimaryHitProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: gravesSmokeScreenPrimaryHitProviderRef, DefinitionRef: gravesSmokeScreenPrimaryHitProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: gravesSmokeScreenPrimaryHitProviderRef, DefinitionRef: gravesSmokeScreenPrimaryHitProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureGravesSmokeScreenPrimaryHitTypes(req *model.CompileRequest) {
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

func loadGravesSmokeScreenPrimaryHitFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureGravesSmokeScreenPrimaryHitTypes(&compileReq)
	configureGravesSmokeScreenPrimaryHitProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: gravesSmokeScreenPrimaryHitFixtureAP, Current: gravesSmokeScreenPrimaryHitFixtureAP,
		Max: gravesSmokeScreenPrimaryHitFixtureAP, Resolved: gravesSmokeScreenPrimaryHitFixtureAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: gravesSmokeScreenPrimaryHitFixtureMana, Max: gravesSmokeScreenPrimaryHitFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: gravesSmokeScreenPrimaryHitTargetHP, Current: gravesSmokeScreenPrimaryHitTargetHP,
		Max: gravesSmokeScreenPrimaryHitTargetHP, Resolved: gravesSmokeScreenPrimaryHitTargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: gravesSmokeScreenPrimaryHitTargetMR, Current: gravesSmokeScreenPrimaryHitTargetMR,
		Max: gravesSmokeScreenPrimaryHitTargetMR, Resolved: gravesSmokeScreenPrimaryHitTargetMR,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runGravesSmokeScreenPrimaryHit(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := runtimeengine.RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func gravesSmokeScreenPrimaryHitSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func gravesSmokeScreenPrimaryHitSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func gravesSmokeScreenPrimaryHitDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != gravesSmokeScreenPrimaryHitDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func gravesSmokeScreenPrimaryHitFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == gravesSmokeScreenPrimaryHitProviderRef {
			return p
		}
	}
	return nil
}

func assertGravesSmokeScreenPrimaryHitProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := gravesSmokeScreenPrimaryHitFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_graves_w_smoke_screen_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != gravesSmokeScreenPrimaryHitProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, gravesSmokeScreenPrimaryHitProviderRef)
	}
	if p.StableID != gravesSmokeScreenPrimaryHitStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, gravesSmokeScreenPrimaryHitStableID)
	}
	if p.ProviderKey == gravesQDProviderRef || p.StableID == gravesQDStableID ||
		p.ProviderKey == gravesNDProviderRef || p.StableID == gravesNDStableID ||
		p.ProviderKey == gravesQDStableID || p.StableID == gravesQDProviderRef ||
		p.ProviderKey == gravesNDStableID || p.StableID == gravesNDProviderRef {
		t.Fatal("smoke_screen primary-hit must not reuse New Destiny / Quickdraw provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no listener / on-hit / True Grit / P/E coupling)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no smoke/nearsight/True Grit state)", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (no equipment/loadout/True Grit/bonus resistance)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil (no cloud/field/duration lifecycle)", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), gravesSmokeScreenPrimaryHitAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != gravesSmokeScreenPrimaryHitAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, gravesSmokeScreenPrimaryHitAbilityKey, gravesSmokeScreenPrimaryHitAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("smoke_screen must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("smoke_screen must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("smoke_screen must not carry tickSpec (no periodic nearsight/cloud)")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("smoke_screen must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-gravesSmokeScreenPrimaryHitManaCost) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("cost=%+v want mana const 90", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-gravesSmokeScreenPrimaryHitCDMs) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("cooldown=%+v want const 18000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (single-hit immediate scaffold; no cast/projectile/AOE/slow/cloud)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("smoke_screen damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("smoke_screen damage must not be copyable on hit")
	}
	if op.Ref != gravesSmokeScreenPrimaryHitDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, gravesSmokeScreenPrimaryHitDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const, mul(ratio, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-gravesSmokeScreenPrimaryHitBaseDamage) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("base const=%+v want 260", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-gravesSmokeScreenPrimaryHitAPRatio) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("AP ratio=%+v want 0.60", mul.Args[0])
	}
	if mul.Args[1].Op != "read" || mul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved (must not bake fixture AP)", mul.Args[1])
	}
	for _, banned := range a.Operations {
		if banned.Operation == "slow" || banned.Operation == "projectile" ||
			banned.Operation == "multi_target" || banned.Operation == "state_change" ||
			banned.Operation == "repeat" || banned.Operation == "field" ||
			banned.Operation == "nearsight" {
			t.Fatalf("smoke_screen must not include cast/projectile/geometry/AOE/slow/cloud/nearsight op: %+v", banned)
		}
	}
}

func findGravesSmokeScreenPrimaryHitAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := gravesSmokeScreenPrimaryHitAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

// TestGravesSmokeScreenPrimaryHitRank5DamageFormulaCrossCheck: independent numeric
// cross-check 260 + 0.60*200 = 380; MR 100 → mitigated 190.
func TestGravesSmokeScreenPrimaryHitRank5DamageFormulaCrossCheck(t *testing.T) {
	raw := gravesSmokeScreenPrimaryHitExpectedRawFromAP(gravesSmokeScreenPrimaryHitFixtureAP)
	if math.Abs(raw-gravesSmokeScreenPrimaryHitExpectedRaw) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("raw=%v want %v", raw, gravesSmokeScreenPrimaryHitExpectedRaw)
	}
	mit := expectedMitigatedMagic(raw, gravesSmokeScreenPrimaryHitTargetMR)
	if math.Abs(mit-gravesSmokeScreenPrimaryHitExpectedMitigated) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("mitigated=%v want %v", mit, gravesSmokeScreenPrimaryHitExpectedMitigated)
	}
}

// TestGravesSmokeScreenPrimaryHitCompileShapeImmediateScaffold asserts compile shape for the
// independent W provider: one magic damage op, cost/CD, no listener/state/P/E/cloud.
func TestGravesSmokeScreenPrimaryHitCompileShapeImmediateScaffold(t *testing.T) {
	compileReq, _ := loadGravesSmokeScreenPrimaryHitFixture(t)
	assertGravesSmokeScreenPrimaryHitProviderShape(t, compileReq)
	if gravesSmokeScreenPrimaryHitProviderRef == gravesQDProviderRef ||
		gravesSmokeScreenPrimaryHitProviderRef == gravesNDProviderRef ||
		gravesSmokeScreenPrimaryHitStableID == gravesQDStableID ||
		gravesSmokeScreenPrimaryHitStableID == gravesNDStableID {
		t.Fatal("smoke_screen primary-hit must not reuse New Destiny / Quickdraw provider refs")
	}
	if gravesSmokeScreenPrimaryHitAbilityKey == gravesQDAbilityKey ||
		gravesSmokeScreenPrimaryHitAbilityKey == gravesNDAbilityKey ||
		gravesSmokeScreenPrimaryHitAbilityKey == "basic_attack" ||
		gravesSmokeScreenPrimaryHitAbilityKey == "quickdraw" ||
		gravesSmokeScreenPrimaryHitAbilityKey == "new_destiny" ||
		gravesSmokeScreenPrimaryHitAbilityKey == "true_grit" {
		t.Fatal("smoke_screen must not reuse New Destiny / Quickdraw / basic-attack / True Grit ability keys")
	}
	if gravesSmokeScreenPrimaryHitDamageOpRef == "op:graves_new_destiny" ||
		strings.Contains(gravesSmokeScreenPrimaryHitDamageOpRef, "quickdraw") ||
		strings.Contains(gravesSmokeScreenPrimaryHitDamageOpRef, "true_grit") {
		t.Fatal("smoke_screen primary-hit must not reuse New Destiny / Quickdraw / True Grit operation refs")
	}
	if gravesSmokeScreenPrimaryHitAbilityID != "ability_hero_graves_w_smoke_screen_primary_hit" {
		t.Fatal("ability id constant drifted")
	}
	if gravesSmokeScreenPrimaryHitStableID != "hero_graves_w_smoke_screen_primary_hit" {
		t.Fatal("stable id constant drifted")
	}
	if gravesSmokeScreenPrimaryHitProviderRef != "provider_hero_graves_w_smoke_screen_primary_hit" {
		t.Fatal("provider ref constant drifted")
	}
}

// TestGravesSmokeScreenPrimaryHitCanonicalSingleTargetDamage proves CompileGeneric→RunGeneric
// for the Wiki rank-5 single-target immediate magic damage scaffold: cost 90,
// CD 18000ms exact boundary, one magic hit per successful cast (no AA/crit/phantom/
// cast-delay/projectile/AOE/slow/smoke-cloud/nearsight/P/E).
func TestGravesSmokeScreenPrimaryHitCanonicalSingleTargetDamage(t *testing.T) {
	compileReq, runReq := loadGravesSmokeScreenPrimaryHitFixture(t)
	assertGravesSmokeScreenPrimaryHitProviderShape(t, compileReq)

	ref := gravesSmokeScreenPrimaryHitAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 17999},
		{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 18000},
	}
	runReq.StopPolicy.DurationMs = 18100

	done := runGravesSmokeScreenPrimaryHit(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if gravesSmokeScreenPrimaryHitSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}

	stat := findGravesSmokeScreenPrimaryHitAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt17999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 17999 {
			t.Fatalf("cooldown skip TimeMs=%d want 17999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 18000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 18000", item.Data["readyAtMs"])
		}
		skipAt17999 = true
	}
	if !skipAt17999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=17999 with readyAtMs=18000")
	}

	items := gravesSmokeScreenPrimaryHitDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("smoke_screen damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 18000}
	wantMit := expectedMitigatedMagic(gravesSmokeScreenPrimaryHitExpectedRaw, gravesSmokeScreenPrimaryHitTargetMR)
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
		if evidenceDataString(item.Data, "providerRef") != gravesSmokeScreenPrimaryHitProviderRef {
			t.Fatalf("damage[%d] providerRef=%q want %q",
				i, evidenceDataString(item.Data, "providerRef"), gravesSmokeScreenPrimaryHitProviderRef)
		}
		if evidenceDataString(item.Data, "operationRef") != gravesSmokeScreenPrimaryHitDamageOpRef {
			t.Fatalf("damage[%d] operationRef=%q want %q",
				i, evidenceDataString(item.Data, "operationRef"), gravesSmokeScreenPrimaryHitDamageOpRef)
		}
		if _, ok := item.Data["eligible"]; ok {
			t.Fatalf("damage[%d] must not carry crit evidence fields: %+v", i, item.Data)
		}
		raw := evidenceDataFloat(item.Data, "rawAmount")
		mit := evidenceDataFloat(item.Data, "mitigatedAmount")
		if math.Abs(raw-gravesSmokeScreenPrimaryHitExpectedRaw) > 1e-9 {
			t.Fatalf("damage[%d] rawAmount=%v want %v", i, raw, gravesSmokeScreenPrimaryHitExpectedRaw)
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
	if math.Abs(done.Summary.TargetFinalHp-gravesSmokeScreenPrimaryHitHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, gravesSmokeScreenPrimaryHitHPAfter2)
	}
	wantHP := gravesSmokeScreenPrimaryHitTargetHP - wantDealt
	if math.Abs(wantHP-gravesSmokeScreenPrimaryHitHPAfter2) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("HP cross-check=%v want %v", wantHP, gravesSmokeScreenPrimaryHitHPAfter2)
	}

	gotMana := gravesSmokeScreenPrimaryHitSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-gravesSmokeScreenPrimaryHitManaAfter2) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("mana=%v want %v (spent exactly 180; skipped attempt costs 0)", gotMana, gravesSmokeScreenPrimaryHitManaAfter2)
	}
	if math.Abs((gravesSmokeScreenPrimaryHitFixtureMana-gotMana)-180) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("mana spent=%v want 180", gravesSmokeScreenPrimaryHitFixtureMana-gotMana)
	}

	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2 (no extra AA/phantom/cloud/New Destiny/Quickdraw hits)", n)
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit (no basic-attack channel)")
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ap"); math.Abs(got-gravesSmokeScreenPrimaryHitFixtureAP) > gravesSmokeScreenPrimaryHitTol {
		t.Fatalf("ap.resolved=%v want %v", got, gravesSmokeScreenPrimaryHitFixtureAP)
	}
}
