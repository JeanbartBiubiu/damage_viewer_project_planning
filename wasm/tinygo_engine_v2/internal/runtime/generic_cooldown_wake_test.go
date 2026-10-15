package runtime

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

const cooldownWakeAbilityRef = "source.provider[champion:source_demo].ability[basic_attack]"

func cooldownWakeWaitingState(t *testing.T, executionSource string) *genericRunState {
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
	first, exists := state.heap.Pop()
	if !exists || first.Kind != scheduler.GenericEventAbilityAttempt || first.TimeMs != 0 {
		t.Fatal("missing real initial driver attempt", first)
	}
	state.nowMs = first.TimeMs
	if err := state.handleAbilityAttempt(first); err != nil {
		t.Fatal(err)
	}
	key := whileReadyCooldownWaitKey("source", "waiting-cast")
	wait, registered := state.combatants["source"].cooldowns.wait(key)
	if !registered || wait.readyAt != 1000 || wait.version == 0 || len(wait.dependencies) != 1 || wait.dependencies[0] != genericAbilityCooldownIdentity("source", cooldownWakeAbilityRef) {
		t.Fatal("CD rejection did not register the actual owner's common cooldown", wait)
	}
	if _, wronglyRegistered := state.combatants["target"].cooldowns.wait(key); wronglyRegistered {
		t.Fatal("the execution source received another owner's cooldown waiter")
	}
	if state.abilityAttemptCount != 1 || state.attemptSkippedCount != 1 || state.abilityCastCount != 0 || state.heap.Len() != 1 {
		t.Fatal("unexpected facts after the first cooldown rejection", state.abilityAttemptCount, state.attemptSkippedCount, state.abilityCastCount, state.heap.Len())
	}
	return state
}

func cooldownWakeQueuedAttempt(t *testing.T, state *genericRunState) scheduler.GenericEvent {
	t.Helper()
	queued, exists := state.heap.Pop()
	if !exists || state.heap.Len() != 0 || queued.Kind != scheduler.GenericEventAbilityAttempt || queued.DriverEntryIndex != 0 || queued.CooldownWaitVersion == 0 {
		t.Fatal("the common waiter must have exactly one queued driver attempt", queued, state.heap.Len())
	}
	// 只读检查通过原序号归还同一事件；不借此制造新事件或新预算。
	if result := state.heap.Push(queued); result != model.ErrOK {
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
				state.heap.SetLimit(1)
				state.nowMs = 200
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
				if updated.TimeMs != change.wantAt || updated.Seq != original.Seq || updated.CooldownWaitVersion == original.CooldownWaitVersion || !ledger.waitCurrent(key, updated.TimeMs, updated.CooldownWaitVersion) || state.heap.Peak != 1 {
					t.Fatal("frame did not replan the unique common waiter in place", original, updated, state.heap.Peak)
				}
				if len(state.combatants["target"].cooldowns.entries) != 0 {
					t.Fatal("cooldown changed the execution source instead of the actual ability owner")
				}
				if err := state.handleAbilityAttempt(original); err != nil {
					t.Fatal(err)
				}
				if state.abilityAttemptCount != 1 || state.attemptSkippedCount != 1 || state.abilityCastCount != 0 || state.heap.Len() != 1 {
					t.Fatal("an obsolete cooldown event was executed or re-registered")
				}
				if err := state.runLoop(); err != nil {
					t.Fatal(err)
				}
				owner := state.combatants["source"]
				if state.abilityAttemptCount != 2 || state.attemptSkippedCount != 1 || state.abilityCastCount != 1 || owner.providerState["champion:source_demo"].state["wake_casts"] != 1 {
					t.Fatal("whileReady did not succeed exactly once", state.abilityAttemptCount, state.attemptSkippedCount, state.abilityCastCount)
				}
				if _, registered := owner.cooldowns.wait(key); registered || state.heap.Len() != 0 || owner.cooldowns.abilityReadyAt("source", cooldownWakeAbilityRef) != change.wantAt+500 {
					t.Fatal("successful finite driver remained registered or automatically looped", owner.cooldowns.waitValue(key), state.heap.Len())
				}
				if err := state.handleAbilityAttempt(updated); err != nil {
					t.Fatal(err)
				}
				if state.abilityAttemptCount != 2 || state.abilityCastCount != 1 || state.heap.Len() != 0 {
					t.Fatal("replaying the consumed wait reopened the driver")
				}
			})
		}
	}
}
