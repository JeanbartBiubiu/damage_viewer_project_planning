package execution

import "tinygo_engine_v2/internal/runtime/contract"

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

// A real action can postpone the first attack before an attack period exists.
// Resetting that attack's cooldown must republish the registered wait version.
func TestBasicAttackResetBeforeFirstAttackRepublishesWaitingVersion(t *testing.T) {
	for _, family := range []string{"cobalt", "saffron"} {
		t.Run(family, func(t *testing.T) {
			input, request := resetAttackInput(t, family, false, 2200)
			state, issue := newGenericRunState(authoringCompile(t, input), request)
			if issue != nil {
				t.Fatal(issue)
			}
			state.loop.Advance(200)
			key := basicAttackCooldownWaitKey(state.actions.BasicAttack())
			wait := state.combatants["source"].cooldowns.RegisterWait(key, []contract.CooldownIdentity{actionpkg.AbilityCooldownIdentity("source", request.DriverPlan.BasicAttack.InitialControlAbilityRef)}, 200, state.loop.TimeMs())
			if !state.loop.RescheduleBasicAttack(200, wait.Version) {
				t.Fatal("missing genuine initial attack node")
			}
			old := resetQueuedAttack(t, state)
			if !state.basicAttackEventCurrent(old) || state.actions.BasicAttack().Wait() != nil {
				t.Fatal("fixture must retain a current first-attack wait", old)
			}
			frame := resetAttackFrame(t, state, 200)
			if frame.fatal || !frame.committed {
				t.Fatal(frame.fatalErr)
			}
			next := resetQueuedAttack(t, state)
			if next.TimeMs != 200 || next.Seq != old.Seq || next.BasicAttackGeneration == old.BasicAttackGeneration || !state.basicAttackEventCurrent(next) || state.basicAttackEventCurrent(old) {
				t.Fatal("reset left the only initial attack node with an obsolete cooldown wait version", old, next)
			}
			if state.actions.BasicAttack().Wait() != nil {
				t.Fatal("waking first attack must not fabricate an attack period")
			}
			if issue := state.handleBasicAttack(); issue != nil {
				t.Fatal(issue)
			}
			if state.actions.BasicAttack().StartedCount() != 1 || state.basicAttackReadyAt() != 1200 {
				t.Fatal(state.actions.BasicAttack().Summary(), state.basicAttackReadyAt())
			}
		})
	}
}

func TestBasicAttackResetMatureWaitRepublishesVersion(t *testing.T) {
	input, request := resetAttackInput(t, "mature", false, 3000)
	state := resetAttackState(t, input, request)
	old := resetQueuedAttack(t, state)
	frame := resetAttackFrame(t, state, 1200)
	next := resetQueuedAttack(t, state)
	if frame.fatal || !frame.committed || next.TimeMs != 1200 || next.Seq != old.Seq || !state.basicAttackEventCurrent(next) || state.basicAttackEventCurrent(old) {
		t.Fatal("mature attack wait must also publish the latest cooldown version", frame.fatalErr, old, next)
	}
}

func TestBasicAttackFirstResetMissingNodeBudgetIsAtomic(t *testing.T) {
	for _, limited := range []bool{false, true} {
		input, request := resetAttackInput(t, "budgeted", false, 2200)
		state, issue := newGenericRunState(authoringCompile(t, input), request)
		if issue != nil {
			t.Fatal(issue)
		}
		state.loop.Advance(200)
		key := basicAttackCooldownWaitKey(state.actions.BasicAttack())
		wait := state.combatants["source"].cooldowns.RegisterWait(key, []contract.CooldownIdentity{actionpkg.AbilityCooldownIdentity("source", request.DriverPlan.BasicAttack.InitialControlAbilityRef)}, 200, 200)
		var others []scheduler.GenericEvent
		for state.loop.QueuedEvents() > 0 {
			event, _ := takeNextEventForTest(state.loop)
			if event.Kind != scheduler.GenericEventBasicAttack {
				others = append(others, event)
			}
		}
		for _, event := range others {
			state.loop.Enqueue(event)
		}
		if limited {
			if state.loop.QueuedEvents() == 0 {
				t.Fatal("budget fixture needs a real occupied slot")
			}
			state.loop.SetQueueLimit(state.loop.QueuedEvents())
		}
		frame := resetAttackFrame(t, state, 200)
		if limited {
			current, _ := state.combatants["source"].cooldowns.Wait(key)
			if !frame.fatal || frame.committed || frame.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || state.loop.HasBasicAttack() || current.Version != wait.Version || state.basicAttackReadyAt() != 0 {
				t.Fatal("failed preflight published a cooldown or fallback attack", frame.fatalErr, current)
			}
		} else {
			next := resetQueuedAttack(t, state)
			if frame.fatal || !frame.committed || next.TimeMs != 200 || !state.basicAttackEventCurrent(next) || state.actions.BasicAttack().Wait() != nil {
				t.Fatal(frame.fatalErr, next)
			}
		}
	}
}
