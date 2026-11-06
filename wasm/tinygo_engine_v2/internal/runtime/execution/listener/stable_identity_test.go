package listener

import (
	"fmt"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type stableListenerHost struct {
	state       *State
	live        map[string]bool
	calls       map[string]int
	removeFirst bool
	failNext    bool
}

func (h *stableListenerHost) ListenerMountLive(definition planbundle.CompiledListener) bool {
	return h.live[definition.OwnerCombatantKey+"/"+definition.OwnerProviderRef]
}
func (h *stableListenerHost) ListenerCondition(_ int, _ planbundle.CompiledListener) (bool, *model.EngineError) {
	return true, nil
}
func (h *stableListenerHost) ReserveListenerUse(_ int, _ *int, _ planbundle.CompiledListener) (bool, bool, *model.EngineError) {
	return false, false, nil
}
func (h *stableListenerHost) FinishListenerUse(_ *int, _ planbundle.CompiledListener, _, _ bool) {}
func (h *stableListenerHost) ListenerOperations(_ int, _ *int, definition planbundle.CompiledListener, _, _ string, _ int) *model.EngineError {
	key := definition.OwnerCombatantKey + "/" + definition.OwnerProviderRef + "/" + definition.ListenerKey
	h.calls[key]++
	if definition.ListenerKey == "first" && h.removeFirst {
		h.live["source/first_mount"] = false
		h.state.Unbind("source", "first_mount")
	}
	if h.failNext {
		h.failNext = false
		return &model.EngineError{Code: model.GenericErrRuntimeInvariantFailed, Message: "listener execution failed"}
	}
	return nil
}
func (h *stableListenerHost) ListenerAbility(_ int, _ *int, _ planbundle.CompiledListener, _, _ string, _ int) (bool, *model.EngineError) {
	return false, nil
}
func (h *stableListenerHost) ListenerSkipped(_ planbundle.CompiledListener, _ string) {}
func (h *stableListenerHost) FinishListenerDispatch(_ *int) *model.EngineError        { return nil }
func (h *stableListenerHost) ListenerDispatchError(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, code, message)
	err.Path, err.Ref = path, ref
	return &err
}

func TestDynamicListenerSameCastThrottleSurvivesEarlierUnbind(t *testing.T) {
	for _, remove := range []bool{false, true} {
		t.Run(fmt.Sprintf("remove_%t", remove), func(t *testing.T) {
			state := New(100)
			if !state.Bind([]planbundle.CompiledListener{{ListenerKey: "first", OperationCount: 1, PerCastThrottleMs: 100}}, "source", "first_mount") ||
				!state.Bind([]planbundle.CompiledListener{{ListenerKey: "follower", OperationCount: 1, PerCastThrottleMs: 100}}, "source", "follower_mount") {
				t.Fatal("listener fixture could not bind")
			}
			host := &stableListenerHost{state: &state, removeFirst: remove, calls: map[string]int{}, live: map[string]bool{"source/first_mount": true, "source/follower_mount": true}}
			collector := 0
			for _, now := range []int64{0, 1, 99, 100} {
				if err := Dispatch(&state, DispatchInput{CastID: 7, NowMs: now}, 1, &collector, host); err != nil {
					t.Fatal(err)
				}
				want := 1
				if now == 100 {
					want = 2
				}
				if got := host.calls["source/follower_mount/follower"]; got != want {
					t.Fatalf("same cast after %dms: follower calls=%d want %d (100ms throttle)", now, got, want)
				}
			}
		})
	}
}

func TestDynamicListenersInSameMountHaveIndependentThrottleAndNewBindings(t *testing.T) {
	state := New(100)
	definitions := []planbundle.CompiledListener{
		{ListenerKey: "first", OperationCount: 1, PerCastThrottleMs: 100},
		{ListenerKey: "second", OperationCount: 1, PerCastThrottleMs: 100},
	}
	if !state.Bind(definitions, "source", "shared") {
		t.Fatal("listener fixture could not bind")
	}
	host := &stableListenerHost{state: &state, calls: map[string]int{}, live: map[string]bool{"source/shared": true}}
	collector := 0
	for _, now := range []int64{0, 1} {
		if err := Dispatch(&state, DispatchInput{CastID: 7, NowMs: now}, 1, &collector, host); err != nil {
			t.Fatal(err)
		}
	}
	if host.calls["source/shared/first"] != 1 || host.calls["source/shared/second"] != 1 || state.dynamic[0].throttleIndex != -1 || state.dynamic[1].throttleIndex != -2 {
		t.Fatal("same-mount listeners shared a throttle identity", host.calls, state.dynamic)
	}
	state.Unbind("source", "shared")
	if !state.Bind(definitions[:1], "source", "shared") || state.dynamic[0].throttleIndex != -3 {
		t.Fatal("rebinding reused the old identity")
	}
	if err := Dispatch(&state, DispatchInput{CastID: 7, NowMs: 1}, 1, &collector, host); err != nil {
		t.Fatal(err)
	}
	if host.calls["source/shared/first"] != 2 || state.Allow(-1, "source", "shared", 7, 100, 1) {
		t.Fatal("new binding inherited old throttle or erased its history", host.calls)
	}
	state.ResetDynamic()
	if !state.Bind(definitions[:1], "source", "shared") || state.dynamic[0].throttleIndex != -4 || !state.Allow(-4, "source", "shared", 7, 100, 1) || state.Allow(-3, "source", "shared", 7, 100, 1) {
		t.Fatal("reset recycled identities or discarded same-run throttle history")
	}
}

func TestDynamicListenerThrottleKeepsOwnerProviderAndSuccessBoundaries(t *testing.T) {
	state := New(100)
	definition := []planbundle.CompiledListener{{ListenerKey: "same", OperationCount: 1, PerCastThrottleMs: 100}}
	for _, identity := range []struct{ owner, provider string }{{"source", "shared"}, {"target", "shared"}, {"source", "other"}} {
		if !state.Bind(definition, identity.owner, identity.provider) {
			t.Fatal("listener fixture could not bind")
		}
	}
	host := &stableListenerHost{state: &state, calls: map[string]int{}, live: map[string]bool{"source/shared": true, "target/shared": true, "source/other": true}, failNext: true}
	collector := 0
	if err := Dispatch(&state, DispatchInput{CastID: 7}, 1, &collector, host); err == nil {
		t.Fatal("failed listener execution was accepted")
	}
	if !state.Allow(-1, "source", "shared", 7, 100, 1) || len(state.throttle) != 0 {
		t.Fatal("failed execution consumed its success throttle")
	}
	for _, now := range []int64{1, 2} {
		if err := Dispatch(&state, DispatchInput{CastID: 7, NowMs: now}, 1, &collector, host); err != nil {
			t.Fatal(err)
		}
	}
	if host.calls["source/shared/same"] != 2 || host.calls["target/shared/same"] != 1 || host.calls["source/other/same"] != 1 {
		t.Fatal("actual mounts shared throttle or failure changed success boundaries", host.calls)
	}
	state.Triggered(-1, "source", "shared", 9, 0)
	if state.Allow(-1, "source", "shared", 9, 100, 1) || !state.Allow(-1, "target", "shared", 9, 100, 1) || !state.Allow(-1, "source", "other", 9, 100, 1) {
		t.Fatal("negative listener identities lost owner/provider separation")
	}
}

func TestDynamicListenerBindingRejectsWholeBatchBeforeIntegerExhaustion(t *testing.T) {
	minimum := -int(^uint(0)>>1) - 1
	definitions := []planbundle.CompiledListener{{ListenerKey: "last-but-one"}, {ListenerKey: "last"}}
	state := New(100)
	if !state.Bind(definitions[:1], "source", "existing") {
		t.Fatal("listener fixture could not bind")
	}
	state.lastDynamicIndex = minimum + 1
	before := append([]dynamicListenerBinding(nil), state.dynamic...)
	if state.Bind(definitions, "source", "too-large") || state.lastDynamicIndex != minimum+1 || !reflect.DeepEqual(state.dynamic, before) {
		t.Fatal("exhausted batch partially changed bindings or the identity cursor")
	}
	if !state.Bind(definitions[1:], "source", "final") || state.lastDynamicIndex != minimum || state.dynamic[len(state.dynamic)-1].throttleIndex != minimum {
		t.Fatal("minimum negative int was not allocated exactly once", state.lastDynamicIndex, state.dynamic)
	}
	if state.Bind(definitions[:1], "source", "overflow") || !state.Bind(nil, "source", "empty") || state.lastDynamicIndex != minimum {
		t.Fatal("exhausted cursor wrapped or empty batch was refused")
	}
	state.Unbind("source", "final")
	state.ResetDynamic()
	if state.Bind(definitions[:1], "source", "reused") || !state.Bind(nil, "source", "empty") || state.DynamicLen() != 0 || state.lastDynamicIndex != minimum {
		t.Fatal("unbind/reset recycled an exhausted identity")
	}
	state = New(100)
	state.lastDynamicIndex = minimum + 2
	if !state.Bind(definitions, "source", "last-batch") || state.dynamic[0].throttleIndex != minimum+1 || state.dynamic[1].throttleIndex != minimum {
		t.Fatal("the final complete batch did not preserve binding order")
	}
}

func TestMixedStaticAndDynamicThrottleEvictionKeepsStableBindingOrder(t *testing.T) {
	minimum := -int(^uint(0)>>1) - 1
	state := State{capacity: 4, throttle: map[perCastThrottleKey]int64{}}
	for _, index := range []int{minimum, -2, 1, -1} {
		state.Triggered(index, "source", "mount", 9, 0)
	}
	for _, step := range []struct {
		add, victim int
		cast        uint64
	}{{0, 1, 9}, {2, 0, 9}, {-3, 2, 10}, {-4, -1, 10}, {-5, -2, 10}, {-6, minimum, 10}} {
		state.Triggered(step.add, "source", "mount", step.cast, 1)
		if _, exists := state.throttle[perCastThrottleKey{listenerIndex: step.victim, ownerCombatantKey: "source", ownerProviderRef: "mount", castInstanceID: 9}]; exists || len(state.throttle) != 4 {
			t.Fatal("mixed throttle eviction lost static-first, binding-order or cast-order semantics", step, state.throttle)
		}
	}
	if warning := state.OverflowWarning(); warning == nil || warning.Count != 6 {
		t.Fatal("mixed identity eviction lost its actual warning count", warning)
	}
}
