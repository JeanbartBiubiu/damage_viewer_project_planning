package execution

import (
	"strconv"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/usage"
	"tinygo_engine_v2/internal/scheduler"
)

func requireFrameEvalContext(t *testing.T, frame *Frame, ability plan.CompiledAbility) formula.GenericEvalContext {
	t.Helper()
	context, err := frame.evalContext(ability)
	if err != nil {
		t.Fatal(err)
	}
	return context
}

func TestFramePublicationKeepsEarlierAttributeFailure(t *testing.T) {
	state := cumulativeRefundState(t, 1000, true)
	invalidProgram := formula.GenericProgramID(state.formulas.Metadata.Count())
	badModifier := plan.CompiledModifier{
		Kind: "attribute", Target: "armor", ValuePolicy: "add", HasValue: true, ValueProgram: invalidProgram,
	}
	state.compiled.Providers = append(state.compiled.Providers,
		plan.CompiledProvider{ProviderKey: "bad_attribute", Modifiers: []plan.CompiledModifier{badModifier}},
		plan.CompiledProvider{ProviderKey: "linked_only", ShieldDefinitionRef: "shield"},
	)
	// 先扩充定义再建立测试用的按定义缓存，保持真实发布回调。
	state.providerDefinitionFields = effectpkg.DefinitionCache{}
	frame := cumulativeRefundFrame(state)
	frame.stageFor("source").providerOps = []stagedProviderMutation{
		{Kind: "apply", SourceKey: "source", TargetKey: "source", DefinitionRef: "bad_attribute", ProviderRef: "bad-attribute-instance"},
		{Kind: "apply", SourceKey: "source", TargetKey: "source", DefinitionRef: "linked_only", ProviderRef: "linked-instance"},
	}
	ability, refund := cumulativeRefundOperation(state, .13)
	err := frame.dispatchWithAmountBudgets(ability, []plan.CompiledOperation{refund})
	if err == nil || err != state.processFailure || err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("expected the earlier live attribute error, got %+v (first %+v)", err, state.processFailure)
	}
	providers := state.combatants["source"].instances.Providers()
	if _, _, found := providers.Find("bad-attribute-instance"); !found {
		t.Fatal("already published instance was removed")
	}
	if _, _, found := providers.Find("linked-instance"); found || frame.committed || cumulativeReady(state) != 870 {
		t.Fatal("publication crossed the failed effect batch or reverted the refund")
	}
	requireCumulativeUsed(t, state, .13)
}

func TestFramePublicationCompletesBothOwnersBeforeReturningDeferredFailure(t *testing.T) {
	state := cumulativeRefundState(t, 1000, true)
	state.compiled.Providers = append(state.compiled.Providers,
		plan.CompiledProvider{ProviderKey: "bad_attribute", Modifiers: []plan.CompiledModifier{{
			Kind: "attribute", Target: "armor", ValuePolicy: "add", HasValue: true,
			ValueProgram: formula.GenericProgramID(state.formulas.Metadata.Count()),
		}}},
		plan.CompiledProvider{ProviderKey: "target_effect"},
	)
	state.providerDefinitionFields = effectpkg.DefinitionCache{}
	frame := cumulativeRefundFrame(state)
	frame.stageFor("source").providerOps = []stagedProviderMutation{{
		Kind: "apply", SourceKey: "source", TargetKey: "source", DefinitionRef: "bad_attribute", ProviderRef: "bad-attribute-instance",
	}}
	frame.stageFor("target").providerOps = []stagedProviderMutation{{
		Kind: "apply", SourceKey: "source", TargetKey: "target", DefinitionRef: "target_effect", ProviderRef: "target-instance",
	}}
	ability, refund := cumulativeRefundOperation(state, .13)
	err := frame.dispatchWithAmountBudgets(ability, []plan.CompiledOperation{refund})
	if err == nil || err != state.processFailure || err.Code != model.GenericErrFormulaTypeError || frame.committed {
		t.Fatalf("expected the first effect error before frame facts: %+v", err)
	}
	if _, _, found := state.combatants["target"].instances.Providers().Find("target-instance"); !found {
		t.Fatal("deferred source error skipped the other owner in the same publication action")
	}
	requireCumulativeUsed(t, state, .13)
}

func TestFrameQueueKeepsFirstFailure(t *testing.T) {
	state := cumulativeRefundState(t, 1000, true)
	clearQueuedEventsForTest(state.loop)
	state.loop.SetQueueLimit(1)
	if state.loop.Enqueue(scheduler.GenericEvent{TimeMs: 1000}) != model.ErrOK {
		t.Fatal("set up full queue")
	}

	frame := cumulativeRefundFrame(state)
	frame.pendingStateExpiry = []pendingFrameStateExpiry{{at: 400}}
	process := state.actions.ProcessAt(0)
	changes := actionpkg.StageProcess(process)
	frame.actionFrame.StageProcess(process, changes)
	frame.actionFrame.StageProcessTimer(changes, true)
	frame.commitFrameQueues()

	err := state.processFailure
	if err == nil || err.Message != "event queue capacity exceeded" || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		t.Fatalf("process timer changed the earlier queue failure: %+v", err)
	}
	if state.loop.QueuedEvents() != 1 {
		t.Fatal("failed frame queue changed the admitted event")
	}
}

func TestCumulativeRefundRetainsBudgetAttribution(t *testing.T) {
	state := cumulativeRefundState(t, 1000, true)
	frame := cumulativeRefundFrame(state)
	if !state.automatedRun() {
		t.Fatal("budget attribution fixture must use the automated run path")
	}
	for index := 0; index < usage.MaxEntries; index++ {
		key := usage.AmountKey{Key: usage.Key{
			Owner: "source", ProviderRef: "refund_owner", GroupKey: "shared_refund",
			Scope:     model.OncePerUseScopeProviderTarget,
			UseSource: "source", UseKey: "committed-" + strconv.Itoa(index), Target: "target",
		}, SubjectRef: cumulativeRef(state)}
		reservation, err := state.useTriggerLedger.ReserveAmount(key, frame.eventCtx.UseSkillKey, .39, .13)
		if err != nil || reservation.Granted() <= 0 {
			t.Fatalf("seed committed amount entry %d: %+v", index, err)
		}
		state.useTriggerLedger.CommitAmount(reservation)
	}
	ability, refund := cumulativeRefundOperation(state, .13)
	err := frame.dispatchWithAmountBudgets(ability, []plan.CompiledOperation{refund})
	if err == nil || err.BudgetCause != model.BudgetCauseMaxUseTriggerLedger {
		t.Fatalf("expected the listener to exhaust the shared budget: %+v", err)
	}
	state.recordFirstProcessFailure(err)
	if err := state.loop.Run(state); err != nil {
		t.Fatal(err)
	}
	if state.loop.Reason() != model.StopReasonBudgetExceeded {
		t.Fatalf("expected a budget stop, got %s", state.loop.Reason())
	}
	if state.budgetCause != model.BudgetCauseMaxUseTriggerLedger || frame.committed || cumulativeReady(state) != 1000 || state.useTriggerLedger.Pending() != 0 {
		t.Fatalf("budget stop lost its cause or published an unavailable refund: cause=%s committed=%v ready=%d", state.budgetCause, frame.committed, cumulativeReady(state))
	}
}

func TestAmmoAmountRestoresStrictReads(t *testing.T) {
	state := cumulativeRefundState(t, 1000, true)
	builder := formula.NewBuilder(state.formulas)
	program, err := builder.Register(formula.GenericProgram{
		Key:   "ammo_strict_scope",
		Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 7}},
	})
	if err != nil {
		t.Fatal(err)
	}
	state.formulas = builder.Freeze()
	missing := formula.GenericProgramID(state.formulas.Metadata.Count())
	for _, tc := range []struct {
		name    string
		program formula.GenericProgramID
		fail    bool
	}{
		{name: "success", program: program},
		{name: "failure", program: missing, fail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			frame := cumulativeRefundFrame(state)
			value, err := (ammoWorkBridge{frame: frame}).AmmoAmount(tc.program, plan.CompiledAbility{}, true)
			if (err != nil) != tc.fail || (!tc.fail && value != 7) {
				t.Fatalf("unexpected ammo result %v, %v", value, err)
			}
			if frame.strictReads {
				t.Fatal("ammo evaluation changed later non-strict reads")
			}
		})
	}
}

func TestFrameEvalAmountReturnsProjectionFailure(t *testing.T) {
	input, run := resourceMaxInput(t, 500, 1500, false)
	state := frameCommitState(t, input, run)
	frame := state.newExecutionFrame("source", "target", "projection_failure")
	frame.stageFor("source").providerOps = []stagedProviderMutation{{
		Kind: "expire", TargetKey: "source", ProviderRef: "missing_projection_provider", Strict: true,
	}}
	ability := plan.CompiledAbility{}

	outOfRange := formula.GenericProgramID(state.formulas.Metadata.Count())
	_, err := frame.evalAmount(outOfRange, ability)
	if !frame.fatal || frame.fatalErr == nil || err != frame.fatalErr {
		t.Fatalf("evalAmount must return the original projection error: got=%+v projection=%+v", err, frame.fatalErr)
	}
	if frame.committed || state.combatantHp("source") != 500 {
		t.Fatal("projection failure published combatant state")
	}
}
