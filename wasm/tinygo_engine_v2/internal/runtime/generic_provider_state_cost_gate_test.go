package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// Focused proofs for provider-aware dynamic cost preflight in resourceGate
// (FROZEN_PLAN_REV: kogmaw-r-living-artillery-phase-a-v2 internal correction).
//
// Proves:
//   - const cost still passes/fails and charges identically
//   - provider.state changes dynamic cost; preflight amount == staged charged amount
//   - insufficient resource → resource_insufficient with no cost/state/damage staging
//   - exact expiry (nowMs >= expireAt) lazily clears state before preflight
//   - malformed/unparseable provider refs with provider.state cost remain fail-closed
//   - no listener / event/ability_started / event/source_owner dependency

const (
	pscgProviderRef = "provider:cost_gate_demo"
	pscgStableID    = "cost_gate_demo"
	pscgStacksKey   = "cost_stacks"
	pscgAbilityKey  = "dynamic_cost_cast"
	pscgConstKey    = "const_cost_cast"
	pscgDamageOpRef = "op:cost_gate_damage"

	pscgDurationMs = 5000.0
	pscgMaxStacks  = 3.0
	pscgManaMax    = 500.0
	pscgTol        = 1e-9
)

func pscgTimedStacksSchema() map[string]interface{} {
	return map[string]interface{}{
		pscgStacksKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      pscgMaxStacks,
			"durationMs":    pscgDurationMs,
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func pscgDynamicCostAmount() model.GenericFormulaExpr {
	forty := 40.0
	one := 1.0
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &forty},
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &one},
					{Op: "read", Path: "provider.state." + pscgStacksKey},
				},
			},
		},
	}
}

func pscgConstCostAmount(amount float64) model.GenericFormulaExpr {
	v := amount
	return model.GenericFormulaExpr{Op: "const", Value: &v}
}

func pscgEnsureTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "damage/true", Domain: "damage"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, e := range need {
		if !have[e.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, e)
		}
	}
	filtered := make([]model.TypeCatalogEntry, 0, len(req.TypeCatalog.Types))
	for _, e := range req.TypeCatalog.Types {
		if e.Key == "event/ability_started" || e.Key == "event/source_owner" {
			continue
		}
		filtered = append(filtered, e)
	}
	req.TypeCatalog.Types = filtered
}

func pscgProviderDef() model.ProviderDefinition {
	cd := 1000.0
	one := 1.0
	ten := 10.0
	sixty := 60.0
	return model.ProviderDefinition{
		ProviderKey:        pscgProviderRef,
		Kind:               "passive",
		StableID:           pscgStableID,
		InitialStateSchema: pscgTimedStacksSchema(),
		Abilities: []model.AbilityDefinition{
			{
				AbilityKey: pscgAbilityKey,
				Kind:       "active",
				Types:      []string{},
				Cost: &model.AbilityCost{
					ResourceKey: "mana",
					Amount:      pscgDynamicCostAmount(),
				},
				Cooldown: &model.AbilityCooldown{
					DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
				},
				Operations: []model.OperationDefinition{
					{
						Operation:  "damage",
						Target:     "target",
						DamageType: "damage/true",
						Ref:        pscgDamageOpRef,
						Amount:     &model.GenericFormulaExpr{Op: "const", Value: &ten},
					},
					{
						Operation:   "state_change",
						Target:      "source",
						Ref:         pscgStacksKey,
						Types:       []string{"state_scope/provider"},
						ValuePolicy: "add",
						Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
					},
				},
			},
			{
				AbilityKey: pscgConstKey,
				Kind:       "active",
				Types:      []string{},
				Cost: &model.AbilityCost{
					ResourceKey: "mana",
					Amount:      pscgConstCostAmount(sixty),
				},
				Cooldown: &model.AbilityCooldown{
					DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
				},
				Operations: []model.OperationDefinition{{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Ref:        "op:const_cost_damage",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &ten},
				}},
			},
		},
	}
}

func pscgDynamicRef() string {
	return "source.provider[" + pscgProviderRef + "].ability[" + pscgAbilityKey + "]"
}

func pscgConstRef() string {
	return "source.provider[" + pscgProviderRef + "].ability[" + pscgConstKey + "]"
}

func pscgLoadFixture(t *testing.T, mana float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	pscgEnsureTypes(&compileReq)
	compileReq.SharedProviders = []model.ProviderDefinition{pscgProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: pscgProviderRef, DefinitionRef: pscgProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{ProviderRef: pscgProviderRef, DefinitionRef: pscgProviderRef, Stacks: 1, State: map[string]interface{}{}},
		}
	}
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: mana, Max: pscgManaMax,
	})
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func pscgRun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if len(result.Session.Providers) != 1 || len(result.Session.Providers[0].Listeners) != 0 {
		t.Fatalf("compiled listeners must be 0; providers=%d", len(result.Session.Providers))
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func pscgSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func pscgStacks(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	bag := sourceProviderState(t, snap, pscgProviderRef)
	state, _ := bag["state"].(map[string]interface{})
	v, _ := state[pscgStacksKey].(float64)
	return v
}

func pscgSkipCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func pscgDamageCount(done model.DoneResult) int {
	n := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") == pscgDamageOpRef {
			n++
		}
	}
	return n
}

func pscgSeedStacks(runReq *model.RunRequest, stacks float64) {
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[pscgProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{pscgStacksKey: stacks},
		}
	}
}

// TestGenericProviderStateCostGateConstCostPassFailCharge: const cost gate unchanged.
func TestGenericProviderStateCostGateConstCostPassFailCharge(t *testing.T) {
	t.Run("sufficient_charges", func(t *testing.T) {
		compileReq, runReq := pscgLoadFixture(t, 200)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "c0", AbilityRef: pscgConstRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := pscgRun(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if math.Abs(pscgSourceMana(t, done.FinalSnapshot)-140) > pscgTol {
			t.Fatalf("mana=%v want 140 (200-60)", pscgSourceMana(t, done.FinalSnapshot))
		}
		if pscgSkipCount(done, model.AttemptSkipResourceInsufficient) != 0 {
			t.Fatal("unexpected resource_insufficient")
		}
	})
	t.Run("insufficient_skips_no_charge", func(t *testing.T) {
		compileReq, runReq := pscgLoadFixture(t, 50)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "c0", AbilityRef: pscgConstRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := pscgRun(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 0 {
			t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
		}
		if pscgSkipCount(done, model.AttemptSkipResourceInsufficient) != 1 {
			t.Fatal("want exactly one resource_insufficient")
		}
		if math.Abs(pscgSourceMana(t, done.FinalSnapshot)-50) > pscgTol {
			t.Fatalf("mana=%v want 50 (unchanged)", pscgSourceMana(t, done.FinalSnapshot))
		}
	})
}

// TestGenericProviderStateCostGateDynamicPreflightEqualsCharge: stacks change cost;
// preflight admits the same amount lifecycle charging stages.
func TestGenericProviderStateCostGateDynamicPreflightEqualsCharge(t *testing.T) {
	compileReq, runReq := pscgLoadFixture(t, 500)
	pscgSeedStacks(&runReq, 2) // cost = 40*(1+2)=120
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "d0", AbilityRef: pscgDynamicRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := pscgRun(t, compileReq, runReq)
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if pscgDamageCount(done) != 1 {
		t.Fatalf("damage=%d want 1", pscgDamageCount(done))
	}
	gotMana := pscgSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-380) > pscgTol { // 500-120
		t.Fatalf("mana=%v want 380 (preflight+charge both used cost 120)", gotMana)
	}
	if math.Abs(pscgStacks(t, done.FinalSnapshot)-3) > pscgTol {
		t.Fatalf("stacks=%v want 3 (seeded 2 + add 1)", pscgStacks(t, done.FinalSnapshot))
	}
}

// TestGenericProviderStateCostGateInsufficientNoStaging: resource_insufficient skips
// with zero mana/state/damage staging.
func TestGenericProviderStateCostGateInsufficientNoStaging(t *testing.T) {
	compileReq, runReq := pscgLoadFixture(t, 79)
	pscgSeedStacks(&runReq, 1) // cost = 80
	hpBefore := 0.0
	for _, c := range runReq.InitialSnapshot.Combatants {
		if c.Key == model.SelectorTarget {
			hpBefore = c.Attributes["hp"].Current
		}
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "d0", AbilityRef: pscgDynamicRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := pscgRun(t, compileReq, runReq)
	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if pscgSkipCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want resource_insufficient")
	}
	if math.Abs(pscgSourceMana(t, done.FinalSnapshot)-79) > pscgTol {
		t.Fatalf("mana=%v want 79 (no charge)", pscgSourceMana(t, done.FinalSnapshot))
	}
	if math.Abs(pscgStacks(t, done.FinalSnapshot)-1) > pscgTol {
		t.Fatalf("stacks=%v want 1 (no write)", pscgStacks(t, done.FinalSnapshot))
	}
	if pscgDamageCount(done) != 0 {
		t.Fatal("damage must not stage on resource skip")
	}
	if math.Abs(done.Summary.TargetFinalHp-hpBefore) > pscgTol {
		t.Fatalf("targetHp=%v want %v", done.Summary.TargetFinalHp, hpBefore)
	}
}

// TestGenericProviderStateCostGateExactExpiryClearsBeforePreflight: nowMs >= expireAt
// clears stacks before cost eval; admits and charges the lower post-expiry amount.
func TestGenericProviderStateCostGateExactExpiryClearsBeforePreflight(t *testing.T) {
	compileReq, runReq := pscgLoadFixture(t, 500)
	// Cast at t0 → stacks=1, expireAt=5000. At exact t5000 stacks clear → cost 40.
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "d0", AbilityRef: pscgDynamicRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "d_expire", AbilityRef: pscgDynamicRef(), Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100
	done := pscgRun(t, compileReq, runReq)
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("castCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if pscgSkipCount(done, model.AttemptSkipResourceInsufficient) != 0 {
		t.Fatal("expiry must admit lower cost, not resource_insufficient")
	}
	// costs 40 + 40 (expired stacks→0 before second preflight); mana 500-80=420
	if math.Abs(pscgSourceMana(t, done.FinalSnapshot)-420) > pscgTol {
		t.Fatalf("mana=%v want 420 (40+40 after exact expiry clear)", pscgSourceMana(t, done.FinalSnapshot))
	}
	if math.Abs(pscgStacks(t, done.FinalSnapshot)-1) > pscgTol {
		t.Fatalf("stacks=%v want 1 (cleared then re-added)", pscgStacks(t, done.FinalSnapshot))
	}
	if pscgDamageCount(done) != 2 {
		t.Fatalf("damage=%d want 2", pscgDamageCount(done))
	}
}

// TestGenericProviderStateCostGateMalformedProviderRefFailClosed: unparseable ability
// ref keeps HasProviderContext=false → provider.state cost eval errors → reject.
func TestGenericProviderStateCostGateMalformedProviderRefFailClosed(t *testing.T) {
	compileReq, runReq := pscgLoadFixture(t, 500)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	canonical := pscgDynamicRef()
	compiled, ok := result.Session.AbilityRefIndex[canonical]
	if !ok {
		t.Fatal("canonical ability ref missing from index")
	}
	// Inject a non-canonical index key so gate resolves the ability but ParseAbilityRef fails.
	broken := "legacy_unparseable_cost_ref"
	result.Session.AbilityRefIndex[broken] = compiled
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "broken", AbilityRef: broken, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0 (fail-closed)", done.Summary.AbilityCastCount)
	}
	if pscgSkipCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want resource_insufficient from MaxFloat64 cost on missing provider context")
	}
	if math.Abs(pscgSourceMana(t, done.FinalSnapshot)-500) > pscgTol {
		t.Fatalf("mana=%v want 500 (no charge)", pscgSourceMana(t, done.FinalSnapshot))
	}
	if pscgDamageCount(done) != 0 {
		t.Fatal("no damage on fail-closed skip")
	}
}

// TestGenericProviderStateCostGateNoListenerOrEventDependency: fixture graph has zero
// listeners and type catalog excludes ability-start scaffolds.
func TestGenericProviderStateCostGateNoListenerOrEventDependency(t *testing.T) {
	compileReq, runReq := pscgLoadFixture(t, 200)
	for _, p := range compileReq.SharedProviders {
		if len(p.Listeners) != 0 {
			t.Fatalf("listeners=%d want 0", len(p.Listeners))
		}
	}
	for _, e := range compileReq.TypeCatalog.Types {
		if e.Key == "event/ability_started" || e.Key == "event/source_owner" {
			t.Fatalf("type catalog must not include %q", e.Key)
		}
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "d0", AbilityRef: pscgDynamicRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := pscgRun(t, compileReq, runReq)
	if n := done.Evidence.CountsByKind[string(model.EvidenceKindEmittedEvent)]; n != 0 {
		t.Fatalf("emitted events=%d want 0", n)
	}
	if n := done.Evidence.CountsByKind[string(model.EvidenceKindListenerSkipped)]; n != 0 {
		t.Fatalf("listener skips=%d want 0", n)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
}
