package execution

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	anchoredVenomStateKey = "venom_stacks"
	anchoredVenomTickKey  = "venom_tick"
	anchoredVenomApplyKey = "apply_venom"
	anchoredVenomDmgOp    = "op:anchored_venom_tick"
	anchoredVenomPipeMod  = "anchored_venom_amp"
)

func anchoredEnsureTypes(req *model.CompileRequest) {
	formuladefinition.SetDamageFormula(req, "damage/true", formuladefinition.ConstantDefense("1"))

	need := []model.TypeCatalogEntry{
		{Key: "ability/tick", Domain: "ability"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
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
}

func anchoredTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

type anchoredFixtureOpts struct {
	intervalMs   int64
	durationMs   float64
	maxStacks    float64
	tickAmount   float64
	withPipeline bool
	// formulaReadsStacks makes onTick amount read provider.target_state.venom_stacks.
	formulaReadsStacks bool
}

func loadAnchoredVenomFixture(t *testing.T, opts anchoredFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.intervalMs <= 0 {
		opts.intervalMs = 1000
	}
	if opts.durationMs <= 0 {
		opts.durationMs = 6000
	}
	if opts.maxStacks <= 0 {
		opts.maxStacks = 6
	}
	if opts.tickAmount <= 0 {
		opts.tickAmount = 10
	}
	compileReq, runReq := loadBasicFixture(t)
	anchoredEnsureTypes(&compileReq)

	one := 1.0
	tickAmount := opts.tickAmount
	var tickAmountExpr *model.GenericFormulaExpr
	if opts.formulaReadsStacks {
		tickAmountExpr = &model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				{Op: "const", Value: &tickAmount},
				{Op: "read", Path: "provider.target_state." + anchoredVenomStateKey},
			},
		}
	} else {
		tickAmountExpr = &model.GenericFormulaExpr{Op: "const", Value: &tickAmount}
	}

	compileReq.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		anchoredVenomStateKey: anchoredTimedSlot(0, opts.maxStacks, opts.durationMs),
	}
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: anchoredVenomApplyKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: []model.OperationDefinition{{
				Operation:   "state_change",
				Target:      "source",
				Ref:         anchoredVenomStateKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			}},
		},
		{
			AbilityKey: anchoredVenomTickKey,
			Kind:       "tick",
			Types:      []string{"ability/tick"},
			TickSpec: &model.TickSpec{
				IntervalMs:     opts.intervalMs,
				AnchorScope:    "state_scope/provider_target",
				AnchorStateKey: anchoredVenomStateKey,
				OnTick: []model.OperationDefinition{{
					Operation:  "damage",
					Target:     "target",
					Ref:        anchoredVenomDmgOp,
					DamageType: "damage/true",
					Amount:     tickAmountExpr,
				}},
			},
		},
	}
	if opts.withPipeline {
		compileReq.SharedProviders[0].Modifiers = []model.ModifierDefinition{{
			ModifierKey: anchoredVenomPipeMod,
			Kind:        "pipeline",
			Command:     "damage",
			Channel:     "all_damage",
			Stage:       "outgoing_pre_mitigation",
			Bucket:      "all_instances",
			Priority:    0,
			ValuePolicy: "multiply",
			Value: model.GenericFormulaExpr{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					gfConst(1),
					{Op: "read", Path: "provider.target_state." + anchoredVenomStateKey},
				},
			},
		}}
	}

	abilityRef := "source.provider[champion:source_demo].ability[" + anchoredVenomApplyKey + "]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "apply", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = int64(opts.durationMs) + 2000
	runReq.Sampling.SampleEveryMs = 10000
	return compileReq, runReq
}

func anchoredTickTimes(done model.DoneResult) []int64 {
	var times []int64
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindProviderTick {
			continue
		}
		anchored, _ := item.Data["anchored"].(bool)
		if !anchored {
			continue
		}
		times = append(times, item.TimeMs)
	}
	return times
}

func TestGenericRunAnchoredTickMissingBindingNoops(t *testing.T) {
	compileReq, runReq := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs: 1000,
		durationMs: 3000,
	})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	state, err := newGenericRunState(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// Process the apply at t=0.
	ev, ok := state.loop.Queue().Pop()
	if !ok {
		t.Fatal("expected apply event")
	}
	state.loop.Advance(ev.TimeMs)
	if err := state.handleAbilityAttempt(ev); err != nil {
		t.Fatal(err)
	}
	c := state.combatants["source"]
	bag := c.providerState.Lookup("champion:source_demo")
	if !bag.Present() || bag.TargetKey() != "target" {
		t.Fatalf("expected target binding, bag=%+v", bag)
	}
	// Clear binding before ticks fire — must no-op and never fall back to owner.
	generation := bag.CurrentAnchoredTickGeneration(anchoredVenomStateKey)
	raw := c.providerState.Snapshot(c.cooldowns.View(), "source", state.loop.TimeMs())
	raw["champion:source_demo"].(map[string]interface{})["targetState"].(map[string]interface{})["target"] = ""
	c.providerState = effectpkg.RestoreBags(raw)
	change := c.providerState.Edit("champion:source_demo", false)
	change.BindFieldDefs(state.resolveProviderStateFieldDefs("source", "champion:source_demo", c.instances.Providers()))
	for change.CurrentAnchoredTickGeneration(anchoredVenomStateKey) < generation {
		change.BumpAnchoredTickGeneration(anchoredVenomStateKey)
	}
	state.combatants["source"] = c

	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 0 {
		t.Fatalf("ticks with missing binding=%d want 0", done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)])
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunAnchoredTickStaleGenerationAndNoRecursion(t *testing.T) {
	compileReq, runReq := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs: 1000,
		durationMs: 3000,
	})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	state, err := newGenericRunState(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	ev, ok := state.loop.Queue().Pop()
	if !ok {
		t.Fatal("expected apply")
	}
	state.loop.Advance(ev.TimeMs)
	if err := state.handleAbilityAttempt(ev); err != nil {
		t.Fatal(err)
	}
	payloadCountAfterWrite := state.effectTimers.AnchoredCount()
	if payloadCountAfterWrite != 3 {
		t.Fatalf("scheduled payloads=%d want 3 (1000,2000,3000)", payloadCountAfterWrite)
	}
	// Invalidate generation without rewriting — scheduled events must no-op.
	c := state.combatants["source"]
	bag := c.providerState.Edit("champion:source_demo", false)
	bag.BumpAnchoredTickGeneration(anchoredVenomStateKey)
	state.combatants["source"] = c

	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 0 {
		t.Fatalf("stale generation ticks=%d want 0", done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)])
	}
	// No recursion: handler must not append further anchored payloads.
	if state.effectTimers.AnchoredCount() != payloadCountAfterWrite {
		t.Fatalf("payloads grew from %d to %d (tick must not reschedule)", payloadCountAfterWrite, state.effectTimers.AnchoredCount())
	}
}

func TestGenericRunAnchoredTickExpiredStateNoops(t *testing.T) {
	compileReq, runReq := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs: 1000,
		durationMs: 1000,
	})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	state, err := newGenericRunState(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// Apply write.
	ev, _ := state.loop.Queue().Pop()
	state.loop.Advance(ev.TimeMs)
	if err := state.handleAbilityAttempt(ev); err != nil {
		t.Fatal(err)
	}
	// Force-clear timer as if expire_cleanup already ran, before the inclusive tick.
	c := state.combatants["source"]
	bag := c.providerState.Edit("champion:source_demo", false)
	bag.SetTargetExpireAt(anchoredVenomStateKey, 0)
	bag.SetTargetValue(anchoredVenomStateKey, 0)
	state.combatants["source"] = c

	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 0 {
		t.Fatalf("expired-state ticks=%d want 0", done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)])
	}
}
