package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

const cooldownWakeAbilityRef = "source.provider[champion:source_demo].ability[basic_attack]"

func cooldownWakeWaitingState(t *testing.T, executionSource string) *Engine {
	t.Helper()
	input, request := loadBasicFixture(t)
	ability := &input.SharedProviders[0].Abilities[0]
	ability.Cooldown = &model.AbilityCooldown{DurationMs: authoringConst(500)}
	ability.Operations = []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "wake_casts", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}}
	input.SharedProviders[0].InitialStateSchema = map[string]interface{}{"wake_casts": float64(0)}
	request.InitialSnapshot.Combatants[0].Cooldowns = map[string]interface{}{cooldownWakeAbilityRef: float64(1000)}
	target := "target"
	if executionSource == "target" {
		target = "source"
	}
	request.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "waiting-cast", AbilityRef: cooldownWakeAbilityRef, Source: executionSource, Target: target, FirstAtMs: 0, WhileReady: true}}
	request.StopPolicy.DurationMs = 2500
	request.Sampling.Disabled = true
	compiled := compileMigrated(&input, &request)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	state, err := newGenericRunState(compiled.Session, request)
	if err != nil {
		t.Fatal(err)
	}
	first, exists := state.loop.Queue().Pop()
	if !exists || first.Kind != scheduler.GenericEventAbilityAttempt || first.TimeMs != 0 {
		t.Fatal("missing real initial driver attempt", first)
	}
	state.loop.Advance(first.TimeMs)
	if err := state.handleAbilityAttempt(first); err != nil {
		t.Fatal(err)
	}
	key := whileReadyCooldownWaitKey("source", "waiting-cast")
	wait, registered := state.combatants["source"].cooldowns.Wait(key)
	if !registered || wait.ReadyAt != 1000 || wait.Version == 0 {
		t.Fatal("CD rejection did not register the actual owner's common cooldown", wait)
	}
	if _, wronglyRegistered := state.combatants["target"].cooldowns.Wait(key); wronglyRegistered {
		t.Fatal("the execution source received another owner's cooldown waiter")
	}
	if state.report.Totals().AbilityAttemptCount != 1 || state.report.Totals().AttemptSkippedCount != 1 || state.abilityCastCount != 0 || state.loop.Queue().Len() != 1 {
		t.Fatal("unexpected facts after the first cooldown rejection", state.report.Totals().AbilityAttemptCount, state.report.Totals().AttemptSkippedCount, state.abilityCastCount, state.loop.Queue().Len())
	}
	return state
}

func cooldownWakeQueuedAttempt(t *testing.T, state *Engine) scheduler.GenericEvent {
	t.Helper()
	queued, exists := state.loop.Queue().Pop()
	if !exists || state.loop.Queue().Len() != 0 || queued.Kind != scheduler.GenericEventAbilityAttempt || queued.DriverEntryIndex != 0 || queued.CooldownWaitVersion == 0 {
		t.Fatal("the common waiter must have exactly one queued driver attempt", queued, state.loop.Queue().Len())
	}
	// 只读检查通过原序号归还同一事件；不借此制造新事件或新预算。
	if result := state.loop.Queue().Push(queued); result != model.ErrOK {
		t.Fatal("failed to return the inspected attempt", result)
	}
	return queued
}

func TestCommonCooldownWhileReadyFrameReplansOneAttemptAndStopsAfterSuccess(t *testing.T) {
	for _, executionSource := range []string{"source", "target"} {
		for _, change := range []struct {
			name     string
			deadline int64
			wantAt   int64
		}{{"shorten", 600, 600}, {"extend", 1800, 1800}, {"reset", 0, 200}} {
			t.Run(executionSource+"/"+change.name, func(t *testing.T) {
				state := cooldownWakeWaitingState(t, executionSource)
				original := cooldownWakeQueuedAttempt(t, state)
				// 队列已满仍应原位改期，不额外占一个槽。
				state.loop.Queue().SetLimit(1)
				state.loop.Advance(200)
				frame := state.newExecutionFrame(executionSource, "target", "cooldown-change")
				if err := frame.applyCooldownChange(executionSource, cooldownWakeAbilityRef, change.deadline); err != nil {
					t.Fatal(err)
				}
				frame.commit()
				if frame.fatal || !frame.committed {
					t.Fatal("real cooldown change frame failed", frame.fatalErr)
				}
				updated := cooldownWakeQueuedAttempt(t, state)
				key := whileReadyCooldownWaitKey("source", "waiting-cast")
				ledger := state.combatants["source"].cooldowns
				if updated.TimeMs != change.wantAt || updated.Seq != original.Seq || updated.CooldownWaitVersion == original.CooldownWaitVersion || !ledger.WaitCurrent(key, updated.TimeMs, updated.CooldownWaitVersion) || state.loop.Queue().Peak != 1 {
					t.Fatal("frame did not replan the unique common waiter in place", original, updated, state.loop.Queue().Peak)
				}
				if state.combatants["target"].cooldowns.EntryCount() != 0 {
					t.Fatal("cooldown changed the execution source instead of the actual ability owner")
				}
				if err := state.handleAbilityAttempt(original); err != nil {
					t.Fatal(err)
				}
				if state.report.Totals().AbilityAttemptCount != 1 || state.report.Totals().AttemptSkippedCount != 1 || state.abilityCastCount != 0 || state.loop.Queue().Len() != 1 {
					t.Fatal("an obsolete cooldown event was executed or re-registered")
				}
				if err := state.runLoop(); err != nil {
					t.Fatal(err)
				}
				owner := state.combatants["source"]
				if state.report.Totals().AbilityAttemptCount != 2 || state.report.Totals().AttemptSkippedCount != 1 || state.abilityCastCount != 1 || owner.providerState.Lookup("champion:source_demo").State().At("wake_casts") != 1 {
					t.Fatal("whileReady did not succeed exactly once", state.report.Totals().AbilityAttemptCount, state.report.Totals().AttemptSkippedCount, state.abilityCastCount)
				}
				if _, registered := owner.cooldowns.Wait(key); registered || state.loop.Queue().Len() != 0 || owner.cooldowns.AbilityReadyAt("source", cooldownWakeAbilityRef) != change.wantAt+500 {
					t.Fatal("successful finite driver remained registered or automatically looped", owner.cooldowns.WaitValue(key), state.loop.Queue().Len())
				}
				if err := state.handleAbilityAttempt(updated); err != nil {
					t.Fatal(err)
				}
				if state.report.Totals().AbilityAttemptCount != 2 || state.abilityCastCount != 1 || state.loop.Queue().Len() != 0 {
					t.Fatal("replaying the consumed wait reopened the driver")
				}
			})
		}
	}
}
