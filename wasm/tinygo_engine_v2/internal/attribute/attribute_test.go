// 本文件验证属性 modifier 聚合、临时最大值和 current clamp 等基础语义。
package attribute

import "testing"

func TestFlatAndPercentModifier(t *testing.T) {
	slot := NewSlot(AttributeDefinition{ID: "attack_damage", Base: 100})
	slot.AddModifier(Modifier{ID: "flat", Kind: ModifierFlat, Target: TargetValue, Value: 20})
	slot.AddModifier(Modifier{ID: "percent", Kind: ModifierPercent, Target: TargetValue, Value: 0.10})

	slot.Resolve()

	if slot.Resolved != 132 {
		t.Fatalf("resolved %.2f, want 132", slot.Resolved)
	}
	if slot.Dirty {
		t.Fatal("slot should be clean after resolve")
	}
}

func TestTemporaryMaxDoesNotAutoHeal(t *testing.T) {
	slot := NewSlot(AttributeDefinition{ID: "hp", Base: 100, Max: 100, Current: 70})
	slot.AddModifier(Modifier{ID: "temporary_max", Kind: ModifierFlat, Target: TargetMax, Value: 50, ExpireAt: 1000})

	slot.Resolve()

	if slot.Max != 150 {
		t.Fatalf("max %.2f, want 150", slot.Max)
	}
	if slot.Current != 70 {
		t.Fatalf("current %.2f, want 70", slot.Current)
	}
}

func TestMaxClampCurrent(t *testing.T) {
	slot := NewSlot(AttributeDefinition{ID: "hp", Base: 100, Max: 100, Current: 100})
	slot.AddModifier(Modifier{ID: "temporary_max", Kind: ModifierFlat, Target: TargetMax, Value: 50, ExpireAt: 1000})
	slot.Resolve()
	slot.SetCurrent(140)

	slot.Expire(1000)
	slot.Resolve()

	if slot.Max != 100 {
		t.Fatalf("max %.2f, want 100", slot.Max)
	}
	if slot.Current != 100 {
		t.Fatalf("current %.2f, want 100", slot.Current)
	}
}
