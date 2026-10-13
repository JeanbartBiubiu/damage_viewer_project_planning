package runtime

import (
	"reflect"
	"testing"

	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/typeset"
)

func TestAbilityTypeCachePreservesRegistryOrderAndRunIsolation(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	state.compiled.Types.Registry.Keys = []string{"same", "extra", "same", "last"}
	frame := state.newExecutionFrame("source", "target", "types")
	ability := planbundle.CompiledAbility{}
	for _, id := range []typeset.TypeID{3, 2, 0} {
		ability.TypeSet.Add(id)
	}
	want := []string{"same", "same", "last"}
	first := frame.abilityTypeKeys(ability)
	if !reflect.DeepEqual(first, want) {
		t.Fatal(first)
	}
	if count := testing.AllocsPerRun(100, func() {
		got := frame.abilityTypeKeys(ability)
		if len(got) != len(want) || &got[0] != &first[0] {
			t.Fatal("cached immutable list was copied")
		}
	}); count != 0 {
		t.Fatal("warm type lookup allocated", count)
	}
	// 追加事件类别不写缓存列表，重复使用保持原集合。
	eventTypes := append([]string{"event"}, first...)
	eventTypes[1] = "changed"
	if !reflect.DeepEqual(frame.abilityTypeKeys(ability), want) {
		t.Fatal("event list changed immutable type keys")
	}
	empty := frame.abilityTypeKeys(planbundle.CompiledAbility{})
	if empty == nil || len(empty) != 0 {
		t.Fatal("empty list changed its non-null shape")
	}
	other := providerFrameHeaderState(t, false)
	other.compiled.Types.Registry.Keys = []string{"different"}
	otherFrame := other.newExecutionFrame("source", "target", "other-run")
	if got := otherFrame.abilityTypeKeys(ability); !reflect.DeepEqual(got, []string{"different"}) {
		t.Fatal("cache crossed run registry", got)
	}
}

func TestAbilityTypeCacheBoundsRetainedSetsWithoutDroppingTypes(t *testing.T) {
	state := providerFrameHeaderState(t, false)
	state.compiled.Types.Registry.Keys = []string{"first", "second"}
	frame := state.newExecutionFrame("source", "target", "bounded")
	for i := uint64(0); i < 70; i++ {
		ability := planbundle.CompiledAbility{TypeSet: typeset.TypeSet{3, i}}
		if got := frame.abilityTypeKeys(ability); !reflect.DeepEqual(got, []string{"first", "second"}) {
			t.Fatal("fallback dropped types", got)
		}
	}
	if len(state.abilityTypeKeyCache) != 64 {
		t.Fatal("unbounded retained type cache", len(state.abilityTypeKeyCache))
	}
}
