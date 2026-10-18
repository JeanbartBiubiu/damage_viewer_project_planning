package runtime

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
			state.nowMs = 200
			key := basicAttackCooldownWaitKey(state.basicAttack)
			wait := state.combatants["source"].cooldowns.registerWait(key, []genericCooldownIdentity{genericAbilityCooldownIdentity("source", request.DriverPlan.BasicAttack.InitialControlAbilityRef)}, 200, state.nowMs)
			if !state.heap.RescheduleBasicAttack(200, wait.version) {
				t.Fatal("missing genuine initial attack node")
			}
			old := resetQueuedAttack(t, state)
			if !state.basicAttackEventCurrent(old) || state.basicAttack.wait != nil {
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
			if state.basicAttack.wait != nil {
				t.Fatal("waking first attack must not fabricate an attack period")
			}
			if issue := state.handleBasicAttack(); issue != nil {
				t.Fatal(issue)
			}
			if state.basicAttack.summary.StartedCount != 1 || state.basicAttackReadyAt() != 1200 {
				t.Fatal(state.basicAttack.summary, state.basicAttackReadyAt())
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
		state.nowMs = 200
		key := basicAttackCooldownWaitKey(state.basicAttack)
		wait := state.combatants["source"].cooldowns.registerWait(key, []genericCooldownIdentity{genericAbilityCooldownIdentity("source", request.DriverPlan.BasicAttack.InitialControlAbilityRef)}, 200, 200)
		var others []scheduler.GenericEvent
		for state.heap.Len() > 0 {
			event, _ := state.heap.Pop()
			if event.Kind != scheduler.GenericEventBasicAttack {
				others = append(others, event)
			}
		}
		for _, event := range others {
			state.heap.Push(event)
		}
		if limited {
			if state.heap.Len() == 0 {
				t.Fatal("budget fixture needs a real occupied slot")
			}
			state.heap.SetLimit(state.heap.Len())
		}
		frame := resetAttackFrame(t, state, 200)
		if limited {
			current, _ := state.combatants["source"].cooldowns.wait(key)
			if !frame.fatal || frame.committed || frame.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || state.heap.HasBasicAttack() || current.version != wait.version || state.basicAttackReadyAt() != 0 {
				t.Fatal("failed preflight published a cooldown or fallback attack", frame.fatalErr, current)
			}
		} else {
			next := resetQueuedAttack(t, state)
			if frame.fatal || !frame.committed || next.TimeMs != 200 || !state.basicAttackEventCurrent(next) || state.basicAttack.wait != nil {
				t.Fatal(frame.fatalErr, next)
			}
		}
	}
}
