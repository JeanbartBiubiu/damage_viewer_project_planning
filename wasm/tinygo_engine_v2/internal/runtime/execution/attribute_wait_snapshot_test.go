package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestInitialWaitingSnapshotSurvivesSameFrameAttributeWrites(t *testing.T) {
	state := waitingTestState(t)
	state.actions.SetAttackActive(true)
	frame := state.newExecutionFrame("source", "target", state.actions.BasicAttack().Plan().InitialControlAbilityRef)
	staged := frame.stageFor("source")
	speed := staged.attributesView().At("attack_speed")
	speed.Base, speed.Resolved = 2, 2

	staged.setAttributes(staged.attributesView().With("attack_speed", speed))
	process := actionpkg.NewProcess(actionpkg.ProcessSeed{AbilityRef: state.actions.BasicAttack().Plan().InitialControlAbilityRef, Snapshot: model.ProcessInstanceSnapshot{UseKey: state.actions.BasicAttack().Current().UseRef()}})
	wait, err := state.basicAttackFlowExecutor().InitialWait(process, 500, state.loop.TimeMs(), attackWaitBridge{frame: frame})
	if err != nil {
		t.Fatal(err)
	}
	frame.pendingBasicAttackWait = wait
	frozen := frame.pendingBasicAttackWait
	if frozen == nil {
		t.Fatal("waiting snapshot was not captured")
	}
	before := independentAttributeTable(frozen.SourceAttributes())
	speed.Base, speed.Resolved = 3, 3

	staged.setAttributes(staged.attributesView().With("attack_speed", speed))
	if !reflect.DeepEqual(frozen.SourceAttributes(), before) {
		t.Fatal("later same-frame write changed prior wait input")
	}
	if state.combatants["source"].attributesView().At("attack_speed").Resolved != 1 {
		t.Fatal("uncommitted write escaped to live")
	}
}

func TestUpdatedWaitingSnapshotSurvivesFurtherStagedWrites(t *testing.T) {
	state := waitingTestState(t)
	state.loop.Advance(400)
	frame := state.newExecutionFrame("source", "target", "update-speed")
	staged := frame.stageFor("source")
	speed := staged.attributesView().At("attack_speed")
	speed.Base, speed.Resolved = 2, 2

	staged.setAttributes(staged.attributesView().With("attack_speed", speed))
	if _, err := frame.prepareBasicAttackWait(); err != nil {
		t.Fatal(err)
	}
	frozen := frame.pendingBasicAttackWait
	if frozen == nil || basicAttackProgressDeadline(frozen) != 700 {
		t.Fatal("expected adjusted wait", frozen)
	}
	before := independentAttributeTable(frozen.SourceAttributes())
	speed.Base, speed.Resolved = 3, 3

	staged.setAttributes(staged.attributesView().With("attack_speed", speed))
	if !reflect.DeepEqual(frozen.SourceAttributes(), before) {
		t.Fatal("updated wait input changed after capture")
	}
	if state.basicAttackReadyAt() != 1000 {
		t.Fatal("uncommitted wait escaped to live")
	}
}
