package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

const (
	anchoredVenomStateKey = "venom_stacks"
	anchoredVenomTickKey  = "venom_tick"
	anchoredVenomApplyKey = "apply_venom"
	anchoredVenomDmgOp    = "op:anchored_venom_tick"
	anchoredVenomPipeMod  = "anchored_venom_amp"
)

func anchoredEnsureTypes(req *model.CompileRequest) {
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

func anchoredDamageAt(done model.DoneResult, timeMs int64) (raw float64, source, target string, ok bool) {
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindDamage || item.TimeMs != timeMs {
			continue
		}
		raw, _ = item.Data["rawAmount"].(float64)
		source, _ = item.Data["source"].(string)
		target, _ = item.Data["target"].(string)
		return raw, source, target, true
	}
	return 0, "", "", false
}

func TestGenericRunOmittedAnchorPairPreservesLegacyMountTicks(t *testing.T) {
	compileReq, runReq := loadFixedTickProviderFixture(t)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	tick := result.Session.Abilities[1]
	if tick.TickSpec == nil || tick.TickSpec.IsAnchored() {
		t.Fatalf("fixed tick must remain non-anchored: %+v", tick.TickSpec)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 5 {
		t.Fatalf("legacy provider_tick count=%d want 5", done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)])
	}
}

func TestGenericRunAnchoredTickNoSeedBeforeFirstWrite(t *testing.T) {
	compileReq, runReq := loadAnchoredVenomFixture(t, anchoredFixtureOpts{})
	// No driver writes — provider is mounted but never receives a qualifying write.
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 3000
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 0 {
		t.Fatalf("anchored ticks before write=%d want 0", done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)])
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunAnchoredTickCadenceInclusiveExpiryAndCleanup(t *testing.T) {
	compileReq, runReq := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs: 1000,
		durationMs: 6000,
		tickAmount: 10,
	})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	times := anchoredTickTimes(done)
	want := []int64{1000, 2000, 3000, 4000, 5000, 6000}
	if len(times) != len(want) {
		t.Fatalf("tick times=%v want %v", times, want)
	}
	for i := range want {
		if times[i] != want[i] {
			t.Fatalf("tick times=%v want %v", times, want)
		}
	}
	// 6 ticks * 10 damage; cleanup after final inclusive tick restores no residual damage path.
	if done.Summary.TargetFinalHp != 940 {
		t.Fatalf("targetFinalHp=%v want 940", done.Summary.TargetFinalHp)
	}
	bag := sourceProviderState(t, done.FinalSnapshot, "champion:source_demo")
	ts, _ := bag["targetState"].(map[string]interface{})
	if ts != nil {
		if values, _ := ts["values"].(map[string]interface{}); values != nil {
			if v, ok := values[anchoredVenomStateKey].(float64); ok && v != 0 {
				t.Fatalf("after cleanup stacks=%v want 0/absent", v)
			}
		}
	}
}

func TestGenericRunAnchoredTickCapClampedRefreshRestartsCadence(t *testing.T) {
	compileReq, runReq := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs: 1000,
		durationMs: 6000,
		maxStacks:  1,
		tickAmount: 10,
	})
	abilityRef := "source.provider[champion:source_demo].ability[" + anchoredVenomApplyKey + "]"
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "apply", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 0},
		// Cap-clamped refresh at 2500: value stays 1, duration refreshes, cadence restarts.
		{EntryKey: "refresh", AbilityRef: abilityRef, Source: "source", Target: "target", FirstAtMs: 2500},
	}
	runReq.StopPolicy.DurationMs = 9000
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	times := anchoredTickTimes(done)
	// gen1 executed: 1000,2000; gen1 3000..6000 stale after refresh.
	// gen2 from 2500: 3500,4500,5500,6500,7500,8500.
	want := []int64{1000, 2000, 3500, 4500, 5500, 6500, 7500, 8500}
	if len(times) != len(want) {
		t.Fatalf("tick times=%v want %v", times, want)
	}
	for i := range want {
		if times[i] != want[i] {
			t.Fatalf("tick times=%v want %v", times, want)
		}
	}
}

func TestGenericRunAnchoredTickUsesActiveTargetNeverOwnerFallback(t *testing.T) {
	compileReq, runReq := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs: 1000,
		durationMs: 2000,
		tickAmount: 10,
	})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	raw, source, target, ok := anchoredDamageAt(done, 1000)
	if !ok {
		t.Fatal("missing damage at first anchored tick")
	}
	if source != "source" {
		t.Fatalf("damage source=%q want source (instance source preserved)", source)
	}
	if target != "target" {
		t.Fatalf("damage target=%q want active bag.targetKey=target (never inst.Owner fallback)", target)
	}
	if raw != 10 {
		t.Fatalf("rawAmount=%v want 10", raw)
	}
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
	ev, ok := state.heap.Pop()
	if !ok {
		t.Fatal("expected apply event")
	}
	state.nowMs = ev.TimeMs
	if err := state.handleAbilityAttempt(ev); err != nil {
		t.Fatal(err)
	}
	c := state.combatants["source"]
	bag := c.providerState["champion:source_demo"]
	if bag == nil || bag.targetKey != "target" {
		t.Fatalf("expected target binding, bag=%+v", bag)
	}
	// Clear binding before ticks fire — must no-op and never fall back to owner.
	bag.targetKey = ""
	c.providerState["champion:source_demo"] = bag
	state.combatants["source"] = c

	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult()
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 0 {
		t.Fatalf("ticks with missing binding=%d want 0", done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)])
	}
	if done.Summary.TargetFinalHp != 1000 {
		t.Fatalf("targetFinalHp=%v want 1000", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunAnchoredTickInclusiveAtExpiryFormulaAndPipeline(t *testing.T) {
	compileReq, runReq := loadAnchoredVenomFixture(t, anchoredFixtureOpts{
		intervalMs:         1000,
		durationMs:         1000,
		tickAmount:         10,
		withPipeline:       true,
		formulaReadsStacks: true,
	})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	times := anchoredTickTimes(done)
	if len(times) != 1 || times[0] != 1000 {
		t.Fatalf("tick times=%v want [1000]", times)
	}
	// Formula sees stacks=1 => base 10; pipeline multiply by (1+stacks)=2 => raw 20.
	raw, _, _, ok := anchoredDamageAt(done, 1000)
	if !ok {
		t.Fatal("missing inclusive-at-expiry damage")
	}
	if raw != 20 {
		t.Fatalf("rawAmount=%v want 20 (formula+pipeline inclusive hold)", raw)
	}
	// Global expiry semantics unchanged: after expire_cleanup, stacks restored.
	if done.Summary.TargetFinalHp != 980 {
		t.Fatalf("targetFinalHp=%v want 980", done.Summary.TargetFinalHp)
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
	ev, ok := state.heap.Pop()
	if !ok {
		t.Fatal("expected apply")
	}
	state.nowMs = ev.TimeMs
	if err := state.handleAbilityAttempt(ev); err != nil {
		t.Fatal(err)
	}
	payloadCountAfterWrite := len(state.anchoredTickPayloads)
	if payloadCountAfterWrite != 3 {
		t.Fatalf("scheduled payloads=%d want 3 (1000,2000,3000)", payloadCountAfterWrite)
	}
	// Invalidate generation without rewriting — scheduled events must no-op.
	c := state.combatants["source"]
	bag := c.providerState["champion:source_demo"]
	bag.bumpAnchoredTickGeneration(anchoredVenomStateKey)
	c.providerState["champion:source_demo"] = bag
	state.combatants["source"] = c

	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult()
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 0 {
		t.Fatalf("stale generation ticks=%d want 0", done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)])
	}
	// No recursion: handler must not append further anchored payloads.
	if len(state.anchoredTickPayloads) != payloadCountAfterWrite {
		t.Fatalf("payloads grew from %d to %d (tick must not reschedule)", payloadCountAfterWrite, len(state.anchoredTickPayloads))
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
	ev, _ := state.heap.Pop()
	state.nowMs = ev.TimeMs
	if err := state.handleAbilityAttempt(ev); err != nil {
		t.Fatal(err)
	}
	// Force-clear timer as if expire_cleanup already ran, before the inclusive tick.
	c := state.combatants["source"]
	bag := c.providerState["champion:source_demo"]
	bag.targetExpireAt[anchoredVenomStateKey] = 0
	bag.targetValues[anchoredVenomStateKey] = 0
	c.providerState["champion:source_demo"] = bag
	state.combatants["source"] = c

	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult()
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 0 {
		t.Fatalf("expired-state ticks=%d want 0", done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)])
	}
}

func TestGenericHeapOldCategoriesRetainRelativeOrderWithAnchored(t *testing.T) {
	// Anchored is earliest; expire_cleanup still precedes provider_tick / ability / continuation / sample.
	order := []scheduler.GenericEventCategory{
		scheduler.GenericCategoryAnchoredTick,
		scheduler.GenericCategoryExpireCleanup,
		scheduler.GenericCategoryProviderTick,
		scheduler.GenericCategoryAbilityAttempt,
		scheduler.GenericCategoryTriggeredContinuation,
		scheduler.GenericCategorySample,
	}
	for i := 1; i < len(order); i++ {
		a := scheduler.GenericEvent{TimeMs: 0, Category: order[i-1], Seq: 1}
		b := scheduler.GenericEvent{TimeMs: 0, Category: order[i], Seq: 2}
		if !scheduler.GenericLess(a, b) {
			t.Fatalf("category %d should precede %d", order[i-1], order[i])
		}
	}
}

func TestInclusiveAtExpiryHoldSkipsOnlyMatchedKey(t *testing.T) {
	bag := &providerStateBag{
		fieldDefs: map[string]providerStateFieldDef{
			"venom_stacks": {defaultValue: 0, maxValue: 6, hasCap: true, durationMs: 1000, refreshPolicy: model.ProviderStateRefreshOnWrite},
			"other":        {defaultValue: 0, maxValue: 1, hasCap: true, durationMs: 1000, refreshPolicy: model.ProviderStateRefreshOnWrite},
		},
		targetKey: "target",
		targetValues: map[string]float64{
			"venom_stacks": 3,
			"other":        1,
		},
		targetExpireAt: map[string]int64{
			"venom_stacks": 1000,
			"other":        1000,
		},
	}
	bag.setInclusiveAtExpiryHold("target", "venom_stacks")
	bag.lazyExpireProviderTargetState(1000)
	if bag.targetValues["venom_stacks"] != 3 {
		t.Fatalf("held key expired: %v", bag.targetValues["venom_stacks"])
	}
	if bag.targetValues["other"] != 0 {
		t.Fatalf("unmatched key must still expire globally: %v", bag.targetValues["other"])
	}
	bag.clearInclusiveAtExpiryHold()
	bag.targetValues["venom_stacks"] = 3
	bag.targetExpireAt["venom_stacks"] = 1000
	bag.lazyExpireProviderTargetState(1000)
	if bag.targetValues["venom_stacks"] != 0 {
		t.Fatalf("without hold, global now>=exp must clear: %v", bag.targetValues["venom_stacks"])
	}
}
