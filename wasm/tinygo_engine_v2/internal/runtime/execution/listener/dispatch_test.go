package listener

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type dispatchFixture struct {
	state       *State
	dynamicLive bool
	log         []string
}

func (f *dispatchFixture) ListenerMountLive(definition planbundle.CompiledListener) bool {
	return definition.ListenerKey != "dynamic" || f.dynamicLive
}

func (f *dispatchFixture) ListenerCondition(event int, definition planbundle.CompiledListener) (bool, *model.EngineError) {
	f.log = append(f.log, "condition:"+definition.ListenerKey)
	return true, nil
}

func (f *dispatchFixture) ReserveListenerUse(event int, collector *int, definition planbundle.CompiledListener) (bool, bool, *model.EngineError) {
	return false, false, nil
}

func (f *dispatchFixture) FinishListenerUse(collector *int, definition planbundle.CompiledListener, reserved, triggered bool) {
}

func (f *dispatchFixture) ListenerOperations(event int, collector *int, definition planbundle.CompiledListener, source, target string, depth int) *model.EngineError {
	f.log = append(f.log, "operations:"+definition.ListenerKey)
	if event == 1 && definition.ListenerKey == "first" {
		f.state.Unbind("source", "dynamic_mount")
		f.dynamicLive = false
		f.state.Bind([]planbundle.CompiledListener{{ListenerKey: "new", HasCondition: true, OperationCount: 1}}, "source", "new_mount")
		// A nested dispatch owns its own frozen list and conditions. The outer
		// dispatch must still use its original list, then recheck the old mount.
		nestedCollector := 0
		if err := Dispatch(f.state, DispatchInput{Compiled: []planbundle.CompiledListener{{ListenerKey: "nested", OperationCount: 1}}},
			2, &nestedCollector, f); err != nil {
			return err
		}
	}
	return nil
}

func (f *dispatchFixture) ListenerAbility(event int, collector *int, definition planbundle.CompiledListener, source, target string, depth int) (bool, *model.EngineError) {
	return false, nil
}

func (f *dispatchFixture) ListenerSkipped(definition planbundle.CompiledListener, reason string) {
	f.log = append(f.log, "skipped:"+definition.ListenerKey)
}

func (f *dispatchFixture) FinishListenerDispatch(collector *int) *model.EngineError {
	f.log = append(f.log, "finish")
	return nil
}

func (f *dispatchFixture) ListenerDispatchError(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, code, message)
	err.Path, err.Ref = path, ref
	return &err
}

func TestDispatchFreezesAllConditionsAndKeepsOuterListAcrossNestedMutation(t *testing.T) {
	state := New(10)
	state.Bind([]planbundle.CompiledListener{{ListenerKey: "dynamic", HasCondition: true, OperationCount: 1}}, "source", "dynamic_mount")
	fixture := &dispatchFixture{state: &state, dynamicLive: true}
	input := DispatchInput{Compiled: []planbundle.CompiledListener{{ListenerKey: "first", HasCondition: true, OperationCount: 1}}}
	collector := 0
	if err := Dispatch(&state, input, 1, &collector, fixture); err != nil {
		t.Fatal(err)
	}
	want := []string{"condition:first", "condition:dynamic", "operations:first", "condition:new", "operations:nested", "operations:new", "finish", "finish"}
	if !reflect.DeepEqual(fixture.log, want) {
		t.Fatal("outer condition/list freeze or live mount recheck changed", fixture.log)
	}
}
