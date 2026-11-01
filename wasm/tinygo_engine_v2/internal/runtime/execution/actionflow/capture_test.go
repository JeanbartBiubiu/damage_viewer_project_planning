package actionflow

import (
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type captureReads struct{ calls int }

type ammoReadModes struct {
	AmmoWork
	wait   actionpkg.AmmoWait
	modes  []bool
	amount float64
}

func (reads *captureReads) StartStateBag(owner, provider string, create bool) effectpkg.BagView {
	reads.calls++
	return effectpkg.BagView{}
}

func (work *ammoReadModes) ReadAmmoWait(*actionpkg.AmmoView) actionpkg.AmmoWait {
	return work.wait
}
func (work *ammoReadModes) WriteAmmoWait(_ *actionpkg.AmmoView, wait actionpkg.AmmoWait) {
	work.wait = wait
}
func (work *ammoReadModes) AmmoAmount(_ formula.GenericProgramID, _ planbundle.CompiledAbility, strict bool) (float64, *model.EngineError) {
	work.modes = append(work.modes, strict)
	return work.amount, nil
}
func (work *ammoReadModes) ReadAmmoInventory(*actionpkg.AmmoView) (float64, *model.EngineError) {
	return 0, nil
}
func (work *ammoReadModes) RecordAmmo(*actionpkg.AmmoView, string, float64, float64, string, *string, *int64) {
}

func TestAttackCaptureKeepsZeroAndDropsPartialFailure(t *testing.T) {
	var actions actionpkg.State
	executor := NewBasicAttackExecutor(&actions, Identity{})
	use := actions.NewUse(actionpkg.UseSeed{Source: "source", SkillKey: "skill", UseKey: "use"})
	combatants := []planbundle.CompiledCombatant{{Key: "source", ProviderMounts: []planbundle.CompiledProviderMount{{ProviderRef: "counter_a", DefinitionIndex: 0}}}}
	providers := []planbundle.CompiledProvider{{AttackStartStateKeys: []string{"hits"}, StateFields: map[string]planbundle.CompiledProviderStateField{"hits": {ValueType: model.ProviderStateValueInteger}}}}
	reads := &captureReads{}
	capture, err := executor.CaptureStartState(true, "source", use, false, combatants, providers, reads)
	if err != nil || capture.Len() != 1 || capture.Values("counter_a")[0].Value != 0 || capture.Values("other") != nil {
		t.Fatal(capture, err)
	}
	event := &contract.EventSnapshot{HasUse: true, EventType: model.EventTypeBasicAttackStart, EventSourceKey: "source", UseSource: "source"}
	if values := executor.StartStateContext(true, event, "source", "counter_a", use, &capture); len(values) != 1 || values[0].Value != 0 {
		t.Fatal(values)
	}
	event.UseSource = "target"
	if values := executor.StartStateContext(true, event, "source", "counter_a", use, &capture); values != nil {
		t.Fatal("foreign use exposed capture", values)
	}
	providers[0].AttackStartStateKeys = []string{"hits", "invalid"}
	providers[0].StateFields["invalid"] = planbundle.CompiledProviderStateField{DefaultValue: math.NaN(), ValueType: model.ProviderStateValueInteger}
	failed, err := executor.CaptureStartState(true, "source", use, false, combatants, providers, reads)
	if err == nil || err.Ref != "invalid" || failed.Len() != 0 || capture.Values("counter_a")[0].Value != 0 {
		t.Fatal("late failure retained partial capture or changed original", failed, capture, err)
	}
	if allocations := testing.AllocsPerRun(10, func() {
		_, err := executor.CaptureStartState(false, "", nil, false, nil, nil, reads)
		if err != nil {
			t.Fatal(err)
		}
	}); allocations != 0 {
		t.Fatal("disabled capture allocated", allocations)
	}
	if reads.calls != 2 {
		t.Fatal("disabled capture read state", reads.calls)
	}
}

func TestAmmoRecoveryStrictnessAndFailedSubtractPreserveWait(t *testing.T) {
	executor := NewSkillActionExecutor(nil, nil, nil, Identity{})
	provider := planbundle.CompiledProvider{StateFields: map[string]planbundle.CompiledProviderStateField{"ammo": {AmmoRecovery: &planbundle.CompiledAmmoRecovery{OneByOne: true, Path: "ammo.recovery"}}}}
	ammo := actionpkg.NewAmmo(actionpkg.AmmoSeed{Definition: provider, Binding: planbundle.CompiledAmmoBinding{StateKey: "ammo"}})
	work := &ammoReadModes{amount: 100}
	if err := executor.PrepareAmmoRecovery(ammo, planbundle.CompiledAbility{}, -1, 0, work); err != nil {
		t.Fatal(err)
	}
	operation := planbundle.CompiledOperation{Ref: "ammo", StateScope: "state_scope/provider", Path: "subtract"}
	work.amount = 25
	if err := executor.SubtractAmmoDuration(ammo, operation, planbundle.CompiledAbility{}, 0, work); err != nil || work.wait.ReadyAt != 75 || work.wait.Generation != 2 {
		t.Fatal(work.wait, err)
	}
	before := work.wait
	work.amount = math.NaN()
	if err := executor.SubtractAmmoDuration(ammo, operation, planbundle.CompiledAbility{}, 0, work); err == nil || err.Code != model.GenericErrFormulaTypeError || work.wait != before {
		t.Fatal("invalid subtract changed the live wait", work.wait, err)
	}
	if !reflect.DeepEqual(work.modes, []bool{true, false, false}) {
		t.Fatal("duration subtract changed original frame read mode", work.modes)
	}
}
