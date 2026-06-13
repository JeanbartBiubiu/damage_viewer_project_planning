// 本文件验证属性 modifier 聚合、临时最大值和 current clamp 等基础语义。
package attribute

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func critChanceBounds() AttributeDefinition {
	return AttributeDefinition{
		ID: "crit_chance", HasClampMin: true, ClampMin: 0, HasClampMax: true, ClampMax: 1,
	}
}

func TestCritChanceBaseAboveMaxClampResolvesToOne(t *testing.T) {
	def := critChanceBounds()
	def.Base = 1.25
	slot := NewSlot(def)
	slot.Resolve()
	if slot.Base != 1 {
		t.Fatalf("base %.2f, want clamped 1", slot.Base)
	}
	if slot.BasePreClamp != 1.25 {
		t.Fatalf("basePreClamp %.2f, want raw 1.25", slot.BasePreClamp)
	}
	if slot.Resolved != 1 {
		t.Fatalf("resolved %.2f, want 1", slot.Resolved)
	}
	if !almostEqualAttr(slot.ResolvedPreClamp, 1.25) {
		t.Fatalf("resolvedPreClamp %.2f, want 1.25", slot.ResolvedPreClamp)
	}
	store := NewStore([]AttributeDefinition{def})
	got, ok := store.ReadAttr(0, model.AttrReadBase)
	if !ok || got != 1 {
		t.Fatalf("ReadAttr base %.2f ok=%v, want 1 true", got, ok)
	}
	got, ok = store.ReadAttr(0, model.AttrReadResolved)
	if !ok || got != 1 {
		t.Fatalf("ReadAttr resolved %.2f ok=%v, want 1 true", got, ok)
	}
	preClamp, clamped, ok := store.ReadResolvedClampEvidence(0)
	if !ok || !almostEqualAttr(preClamp, 1.25) || clamped != 1 {
		t.Fatalf("clamp evidence pre=%.2f clamped=%.2f ok=%v, want 1.25/1/true", preClamp, clamped, ok)
	}
}

func TestCritChanceSetBasePreservesRawForEvidence(t *testing.T) {
	def := critChanceBounds()
	slot := NewSlot(def)
	slot.SetBase(1.25)
	slot.Resolve()
	if slot.Base != 1 {
		t.Fatalf("base %.2f, want clamped 1", slot.Base)
	}
	if slot.BasePreClamp != 1.25 {
		t.Fatalf("basePreClamp %.2f, want raw 1.25", slot.BasePreClamp)
	}
	if !almostEqualAttr(slot.ResolvedPreClamp, 1.25) || slot.Resolved != 1 {
		t.Fatalf("resolved pre/clamped = %.2f/%.2f, want 1.25/1", slot.ResolvedPreClamp, slot.Resolved)
	}
}

func TestCritChanceBaseBelowMinClampResolvesToZero(t *testing.T) {
	def := critChanceBounds()
	def.Base = -0.2
	slot := NewSlot(def)
	slot.Resolve()
	if slot.Resolved != 0 {
		t.Fatalf("resolved %.2f, want 0", slot.Resolved)
	}
}

func TestCritChanceModifierOvercapClampEvidence(t *testing.T) {
	def := critChanceBounds()
	def.Base = 0.8
	slot := NewSlot(def)
	slot.AddModifier(Modifier{ID: "percent", Kind: ModifierPercent, Target: TargetValue, Value: 0.5})
	slot.Resolve()
	if !almostEqualAttr(slot.ResolvedPreClamp, 1.2) {
		t.Fatalf("resolvedPreClamp %.2f, want 1.2", slot.ResolvedPreClamp)
	}
	if slot.Resolved != 1 {
		t.Fatalf("resolved %.2f, want 1", slot.Resolved)
	}
	store := NewStore([]AttributeDefinition{def})
	store.Slots[0].AddModifier(Modifier{ID: "percent", Kind: ModifierPercent, Target: TargetValue, Value: 0.5})
	preClamp, clamped, ok := store.ReadResolvedClampEvidence(0)
	if !ok || !almostEqualAttr(preClamp, 1.2) || clamped != 1 {
		t.Fatalf("clamp evidence pre=%.2f clamped=%.2f ok=%v, want 1.2/1/true", preClamp, clamped, ok)
	}
	got, ok := store.ReadAttr(0, model.AttrReadResolved)
	if !ok || got != 1 {
		t.Fatalf("ReadAttr resolved %.2f ok=%v, want 1 true", got, ok)
	}
	got, ok = store.ReadAttr(0, model.AttrReadBase)
	if !ok || !almostEqualAttr(got, 0.8) {
		t.Fatalf("ReadAttr base %.2f ok=%v, want 0.8 true", got, ok)
	}
}

func TestAttackSpeedExplicitBoundsClamp(t *testing.T) {
	def := AttributeDefinition{
		ID: "attack_speed", Base: 9, HasClampMin: true, ClampMin: 0, HasClampMax: true, ClampMax: 5,
	}
	slot := NewSlot(def)
	slot.Resolve()
	if slot.Resolved != 5 {
		t.Fatalf("resolved %.2f, want 5", slot.Resolved)
	}
}

func TestNoBoundsCompatibilityUnchanged(t *testing.T) {
	slot := NewSlot(AttributeDefinition{ID: "attack_damage", Base: 100})
	slot.Resolve()
	if slot.Resolved != 100 {
		t.Fatalf("resolved %.2f, want 100", slot.Resolved)
	}
}

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

func almostEqualAttr(left float64, right float64) bool {
	diff := left - right
	if diff < 0 {
		diff = -diff
	}
	return diff < 0.000001
}
