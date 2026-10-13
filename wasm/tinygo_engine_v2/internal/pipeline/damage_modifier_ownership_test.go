package pipeline

import (
	"reflect"
	"testing"

	planbundle "tinygo_engine_v2/internal/plan"
)

func ownershipDamageModifier(key string) planbundle.CompiledModifier {
	return planbundle.CompiledModifier{Kind: "pipeline", ModifierKey: key, Command: "damage", Channel: "incoming", Stage: "post_defense"}
}

func TestDamageModifierPlanCopiesKeepMountAndUnmountIsolation(t *testing.T) {
	var original DamageModifierResolver
	original.MountCompiledModifierOwned("source", "item", ownershipDamageModifier("a"))
	original.MountCompiledModifierOwned("target", "item", ownershipDamageModifier("b"))
	want := append([]MountedDamageModifier(nil), original.mounts...)
	first, second := original.Clone(), original
	first.MountCompiledModifierOwned("source", "new", ownershipDamageModifier("c"))
	original.UnmountProviderOwned("source", "item")
	if !reflect.DeepEqual(second.mounts, want) || len(first.mounts) != 3 || len(original.mounts) != 1 {
		t.Fatal("mount or unmount changed a frozen plan")
	}
	first.UnmountProviderOwned("target", "item")
	if len(first.mounts) != 2 || first.mounts[0] != want[0] || len(original.mounts) != 1 || !reflect.DeepEqual(second.mounts, want) {
		t.Fatal("same provider name on the other owner lost isolation or order")
	}
	first.MountCompiledModifierOwned("target", "third", ownershipDamageModifier("d"))
	if len(first.mounts) != 3 || !reflect.DeepEqual(second.mounts, want) {
		t.Fatal("write after removal changed an older plan")
	}
	original.UnmountProviderOwned("target", "item")
	if len(original.mounts) != 0 || !reflect.DeepEqual(second.mounts, want) {
		t.Fatal("removing every mount changed a frozen plan")
	}
}

func TestDamageModifierPlanReadCloneAndUnknownRemovalDoNotAllocate(t *testing.T) {
	var original DamageModifierResolver
	original.MountCompiledModifierOwned("source", "item", ownershipDamageModifier("a"))
	if allocations := testing.AllocsPerRun(100, func() {
		copy := original.Clone()
		copy.UnmountProviderOwned("target", "item")
		if len(copy.mounts) != 1 || copy.mounts[0].ModifierKey != "a" {
			t.Fatal("read clone or unmatched owner removal changed the plan")
		}
	}); allocations != 0 {
		t.Fatalf("read clone or unmatched removal allocated %v objects", allocations)
	}
}
