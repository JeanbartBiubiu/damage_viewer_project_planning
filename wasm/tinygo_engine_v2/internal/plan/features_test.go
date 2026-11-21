package plan

import "testing"

func TestSessionFeaturesPredicatesMatchPreviousGates(t *testing.T) {
	flags := [...]SessionFeatures{
		FeatureResourceMax,
		FeatureCooldownDuration,
		FeatureProviderDurationChange,
		FeatureStagedLinkedShield,
		FeatureModifierSnapshots,
		FeatureActionStun,
		FeatureLinkedShieldReads,
		FeatureReceivedShieldReads,
		FeatureDamageStateBefore,
		FeatureShieldLifecycle,
	}
	for combination := 0; combination < 1<<len(flags); combination++ {
		has := func(index uint) bool { return combination&(1<<index) != 0 }
		var features SessionFeatures
		for index, flag := range flags {
			if has(uint(index)) {
				features |= flag
			}
		}
		resourceMax, cooldownDuration, durationChange := has(0), has(1), has(2)
		stagedShield, modifierSnapshots, actionStun := has(3), has(4), has(5)
		dynamic := resourceMax || cooldownDuration || durationChange || stagedShield || modifierSnapshots
		if got := features.NeedsDynamicProviderFlush(); got != dynamic {
			t.Fatalf("特性 %b 的动态同步 = %t，预期 %t", features, got, dynamic)
		}
		if got, want := features.AllowsDurationOnlyLinkedShieldProjection(), durationChange && !resourceMax && !cooldownDuration; got != want {
			t.Fatalf("特性 %b 的普通关联盾续时投影 = %t，预期 %t", features, got, want)
		}
		if got, want := features.NeedsExactExpirySweep(), actionStun || dynamic; got != want {
			t.Fatalf("特性 %b 的独立帧到期处理 = %t，预期 %t", features, got, want)
		}
		if got, want := features.HasSpecialFormulaFacts(), has(6) || has(7) || has(8); got != want {
			t.Fatalf("特性 %b 的公式事实读取 = %t，预期 %t", features, got, want)
		}
	}
}

func TestSessionFeaturesHasAndAny(t *testing.T) {
	const features = FeatureResourceMax | FeatureModifierSnapshots
	const partial = FeatureResourceMax | FeatureActionStun
	if !features.Has(features) || features.Has(partial) || !features.Any(partial) || features.Any(FeatureActionStun) {
		t.Fatal("Has 要求全部位存在，Any 要求至少一位存在")
	}
}
