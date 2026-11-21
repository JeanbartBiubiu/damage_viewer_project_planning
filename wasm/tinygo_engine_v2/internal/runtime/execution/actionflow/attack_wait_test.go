package actionflow

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type attackWaitPreviewFailure struct {
	AttackWaitWork
	ledger *actionpkg.CooldownLedger
	err    *model.EngineError
	order  []string
}

func (f *attackWaitPreviewFailure) PreviewAttackWait() (float64, *model.EngineError) {
	f.order = append(f.order, "project")
	return 1, nil
}

func (f *attackWaitPreviewFailure) AttackCooldowns() *actionpkg.CooldownLedger {
	f.order = append(f.order, "cooldown")
	return f.ledger
}

func (f *attackWaitPreviewFailure) ConsumeAttackWaitCommand() *model.EngineError {
	f.order = append(f.order, "command")
	return nil
}

func (f *attackWaitPreviewFailure) ReadAttackWaitPreview() (AttackWaitPreview, *model.EngineError) {
	f.order = append(f.order, "preview")
	return AttackWaitPreview{}, f.err
}

func TestAttackWaitPreviewErrorKeepsReanchorUnpublished(t *testing.T) {
	var state actionpkg.State
	state.InitBasicAttack(actionpkg.BasicAttackSeed{Plan: model.BasicAttackPlan{
		Source: "source", Target: "target", InitialControlAbilityRef: "initial", AttackSpeedInputMax: 2,
	}})
	original := actionpkg.NewAttackWait(actionpkg.AttackWaitSeed{InitialReady: 350, Anchor: 100, Period: 250, Remaining: 1, Speed: 1})
	state.SetAttackWait(original)
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "attack wait context failed")
	work := &attackWaitPreviewFailure{ledger: actionpkg.NewCooldownLedger(), err: &failure}
	work.ledger.Set(actionpkg.AbilityCooldownIdentity("source", "initial"), 400, 150)
	result, err := NewBasicAttackExecutor(&state, Identity{}).PrepareWait(150, AttackWaitInput{CombatantsAlive: true}, nil, nil, work)
	if err != &failure || result.Wait == nil || result.Wait.ProgressDeadline() != 400 || result.ExtraQueue != 0 ||
		state.BasicAttack().Wait() != original || original.ProgressDeadline() != 350 ||
		!reflect.DeepEqual(work.order, []string{"project", "cooldown", "command", "preview"}) {
		t.Fatal("wait preview failure changed the original reanchor order or published an adjustment", err, result, work.order)
	}
}
