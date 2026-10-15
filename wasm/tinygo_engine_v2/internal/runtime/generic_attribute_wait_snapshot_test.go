package runtime

import (
	"reflect"
	"testing"
)

func TestInitialWaitingSnapshotSurvivesSameFrameAttributeWrites(t *testing.T) {
	state := waitingTestState(t)
	state.basicAttackEventActive = true
	frame := state.newExecutionFrame("source", "target", state.basicAttack.plan.InitialControlAbilityRef)
	staged := frame.stageFor("source")
	speed := staged.attributes.At("attack_speed")
	speed.Base, speed.Resolved = 2, 2
	staged.attributes = staged.attributes.With("attack_speed", speed)
	process := &processRuntime{abilityRef: state.basicAttack.plan.InitialControlAbilityRef}
	process.UseKey = state.basicAttack.current.UseRef
	if err := frame.stageInitialBasicAttackWait(process, 500); err != nil {
		t.Fatal(err)
	}
	frozen := frame.pendingBasicAttackWait
	if frozen == nil {
		t.Fatal("waiting snapshot was not captured")
	}
	before := independentAttributeTable(frozen.sourceAttributes)
	speed.Base, speed.Resolved = 3, 3
	staged.attributes = staged.attributes.With("attack_speed", speed)
	if !reflect.DeepEqual(frozen.sourceAttributes, before) {
		t.Fatal("later same-frame write changed prior wait input")
	}
	if state.combatants["source"].attributes.At("attack_speed").Resolved != 1 {
		t.Fatal("uncommitted write escaped to live")
	}
}

func TestUpdatedWaitingSnapshotSurvivesFurtherStagedWrites(t *testing.T) {
	state := waitingTestState(t)
	state.nowMs = 400
	frame := state.newExecutionFrame("source", "target", "update-speed")
	staged := frame.stageFor("source")
	speed := staged.attributes.At("attack_speed")
	speed.Base, speed.Resolved = 2, 2
	staged.attributes = staged.attributes.With("attack_speed", speed)
	if _, err := frame.prepareBasicAttackWait(); err != nil {
		t.Fatal(err)
	}
	frozen := frame.pendingBasicAttackWait
	if frozen == nil || basicAttackProgressDeadline(frozen) != 700 {
		t.Fatal("expected adjusted wait", frozen)
	}
	before := independentAttributeTable(frozen.sourceAttributes)
	speed.Base, speed.Resolved = 3, 3
	staged.attributes = staged.attributes.With("attack_speed", speed)
	if !reflect.DeepEqual(frozen.sourceAttributes, before) {
		t.Fatal("updated wait input changed after capture")
	}
	if state.basicAttackReadyAt() != 1000 {
		t.Fatal("uncommitted wait escaped to live")
	}
}
