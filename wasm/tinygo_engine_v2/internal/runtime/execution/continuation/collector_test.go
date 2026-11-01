package continuation

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestGenericPhantomProvenanceSortStable(t *testing.T) {
	// 逆序 append；排序后按 provenance 升序；等键项（用 rawAmount 区分）保持相对顺序。
	damages := []FrozenDamage{
		{ProviderRef: "p2", OriginRef: "o2", SourceKey: "source", TargetKey: "target", DamageType: "damage/true", RawAmount: 2},
		{ProviderRef: "p2", OriginRef: "o1", SourceKey: "source", TargetKey: "target", DamageType: "damage/magic", RawAmount: 21},
		{ProviderRef: "p1", OriginRef: "o9", SourceKey: "source", TargetKey: "target", DamageType: "damage/physical", RawAmount: 11},
		{ProviderRef: "p1", OriginRef: "o9", SourceKey: "source", TargetKey: "target", DamageType: "damage/physical", RawAmount: 12},
		{ProviderRef: "p1", OriginRef: "o8", SourceKey: "source", TargetKey: "target", DamageType: "damage/true", RawAmount: 10},
	}
	sortCopyableDamagesStable(damages)
	wantDamages := []FrozenDamage{
		{ProviderRef: "p1", OriginRef: "o8", SourceKey: "source", TargetKey: "target", DamageType: "damage/true", RawAmount: 10},
		{ProviderRef: "p1", OriginRef: "o9", SourceKey: "source", TargetKey: "target", DamageType: "damage/physical", RawAmount: 11},
		{ProviderRef: "p1", OriginRef: "o9", SourceKey: "source", TargetKey: "target", DamageType: "damage/physical", RawAmount: 12},
		{ProviderRef: "p2", OriginRef: "o1", SourceKey: "source", TargetKey: "target", DamageType: "damage/magic", RawAmount: 21},
		{ProviderRef: "p2", OriginRef: "o2", SourceKey: "source", TargetKey: "target", DamageType: "damage/true", RawAmount: 2},
	}
	if len(damages) != len(wantDamages) {
		t.Fatalf("damages len=%d want %d", len(damages), len(wantDamages))
	}
	for i := range wantDamages {
		got, want := damages[i], wantDamages[i]
		if got.ProviderRef != want.ProviderRef || got.OriginRef != want.OriginRef ||
			got.SourceKey != want.SourceKey || got.TargetKey != want.TargetKey ||
			got.DamageType != want.DamageType || got.RawAmount != want.RawAmount {
			t.Fatalf("damages[%d]=prov=%s origin=%s src=%s tgt=%s type=%s amt=%v want prov=%s origin=%s src=%s tgt=%s type=%s amt=%v",
				i, got.ProviderRef, got.OriginRef, got.SourceKey, got.TargetKey, got.DamageType, got.RawAmount,
				want.ProviderRef, want.OriginRef, want.SourceKey, want.TargetKey, want.DamageType, want.RawAmount)
		}
	}

	// 逆序/乱序 repeats；等键两项用相同 provenance，稳定排序后相对顺序不变。
	equalA := RepeatRequest{
		OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a",
		TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 1,
	}
	equalB := equalA // 完全相同 provenance；稳定排序后 A 仍在 B 前
	repeats := []RepeatRequest{
		{OwnerProviderRef: "item:z", OwnerCombatantKey: "source", RepeatTag: "b", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 2},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "target", RepeatTag: "a", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 1},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "z", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 1},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a", TriggerStateKey: "later", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 1},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a", TriggerStateKey: "stacks", RepeatScope: "other_scope", Threshold: 4, RepeatCount: 1},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 5, RepeatCount: 1},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 3},
		equalA,
		equalB,
	}
	sortDeferredRepeatsStable(repeats)
	wantRepeats := []RepeatRequest{
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a", TriggerStateKey: "later", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 1},
		equalA,
		equalB,
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 3},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 5, RepeatCount: 1},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "a", TriggerStateKey: "stacks", RepeatScope: "other_scope", Threshold: 4, RepeatCount: 1},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "source", RepeatTag: "z", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 1},
		{OwnerProviderRef: "item:a", OwnerCombatantKey: "target", RepeatTag: "a", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 1},
		{OwnerProviderRef: "item:z", OwnerCombatantKey: "source", RepeatTag: "b", TriggerStateKey: "stacks", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 4, RepeatCount: 2},
	}
	if len(repeats) != len(wantRepeats) {
		t.Fatalf("repeats len=%d want %d", len(repeats), len(wantRepeats))
	}
	for i := range wantRepeats {
		if repeats[i] != wantRepeats[i] {
			t.Fatalf("repeats[%d]=%+v want %+v", i, repeats[i], wantRepeats[i])
		}
	}

	c := &Collector{
		damages: []FrozenDamage{
			{ProviderRef: "b", OriginRef: "o", SourceKey: "s", TargetKey: "t", DamageType: "damage/true"},
			{ProviderRef: "a", OriginRef: "o", SourceKey: "s", TargetKey: "t", DamageType: "damage/magic"},
		},
		repeats: []RepeatRequest{
			{OwnerProviderRef: "b", OwnerCombatantKey: "source", RepeatTag: "x", TriggerStateKey: "k", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 1, RepeatCount: 1},
			{OwnerProviderRef: "a", OwnerCombatantKey: "source", RepeatTag: "x", TriggerStateKey: "k", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 1, RepeatCount: 1},
		},
	}
	sortCopyableDamagesStable(c.damages)
	sortDeferredRepeatsStable(c.repeats)
	if c.damages[0].ProviderRef != "a" || c.damages[1].ProviderRef != "b" {
		t.Fatalf("collector damages order=%s,%s want a,b", c.damages[0].ProviderRef, c.damages[1].ProviderRef)
	}
	if c.repeats[0].OwnerProviderRef != "a" || c.repeats[1].OwnerProviderRef != "b" {
		t.Fatalf("collector repeats order=%s,%s want a,b", c.repeats[0].OwnerProviderRef, c.repeats[1].OwnerProviderRef)
	}

	// cloneAndSort 不得破坏 collector 原始 append 顺序。
	raw := &Collector{
		damages: []FrozenDamage{
			{ProviderRef: "z", OriginRef: "o", SourceKey: "s", TargetKey: "t", DamageType: "damage/true", RawAmount: 1},
			{ProviderRef: "a", OriginRef: "o", SourceKey: "s", TargetKey: "t", DamageType: "damage/magic", RawAmount: 2},
		},
		repeats: []RepeatRequest{
			{OwnerProviderRef: "z", OwnerCombatantKey: "source", RepeatTag: "r", TriggerStateKey: "k", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 1, RepeatCount: 1},
			{OwnerProviderRef: "a", OwnerCombatantKey: "source", RepeatTag: "r", TriggerStateKey: "k", RepeatScope: model.RepeatScopeCopyableOnHit, Threshold: 1, RepeatCount: 1},
		},
	}
	sortedDamages, sortedRepeats := raw.CloneSorted()
	if raw.damages[0].ProviderRef != "z" || raw.damages[1].ProviderRef != "a" {
		t.Fatalf("collector damages mutated in place: %s,%s", raw.damages[0].ProviderRef, raw.damages[1].ProviderRef)
	}
	if raw.repeats[0].OwnerProviderRef != "z" || raw.repeats[1].OwnerProviderRef != "a" {
		t.Fatalf("collector repeats mutated in place: %s,%s", raw.repeats[0].OwnerProviderRef, raw.repeats[1].OwnerProviderRef)
	}
	if sortedDamages[0].ProviderRef != "a" || sortedDamages[1].ProviderRef != "z" {
		t.Fatalf("sorted damages=%s,%s want a,z", sortedDamages[0].ProviderRef, sortedDamages[1].ProviderRef)
	}
	if sortedRepeats[0].OwnerProviderRef != "a" || sortedRepeats[1].OwnerProviderRef != "z" {
		t.Fatalf("sorted repeats=%s,%s want a,z", sortedRepeats[0].OwnerProviderRef, sortedRepeats[1].OwnerProviderRef)
	}
}

// TestGenericPhantomReplayStableOrderViaShieldHP 直接 flush：逆序 append 的 copyable damages
// 必须按 provenance 回放；用 damageHistory 顺序 + 护盾/HP/不同 damageType 断言，而非只比总伤害。
