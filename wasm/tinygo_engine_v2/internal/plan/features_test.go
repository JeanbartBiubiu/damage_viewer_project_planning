package plan

import (
	"testing"

	"tinygo_engine_v2/internal/formula"
)

func TestSessionFeaturesPredicatesMatchPreviousGates(t *testing.T) {
	flags := [...]SessionFeatures{
		FeatureResourceMax,
		FeatureCooldownDuration,
		FeatureProviderDurationChange,
		FeatureStagedLinkedShield,
		FeatureModifierSnapshots,
		FeatureActionStun,
		FeatureHasSpecialFormulaFacts,
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
		if got, want := features.HasSpecialFormulaFacts(), has(6); got != want {
			t.Fatalf("特性 %b 的公式事实读取 = %t，预期 %t", features, got, want)
		}
	}
}

func TestFormulaFactsBoundsAndEmptySession(t *testing.T) {
	request := formula.FactRequest{Kind: formula.ReadLinkedShieldPresent, Index: 4}
	session := CompiledSession{FormulaFactReads: [][]formula.FactRequest{{request}}}
	if got := session.FormulaFacts(0); got != nil {
		t.Fatalf("未启用的会话返回了读取请求：%+v", got)
	}
	session.Features = FeatureHasSpecialFormulaFacts
	if got := session.FormulaFacts(0); len(got) != 1 || got[0] != request {
		t.Fatalf("编译编号丢失请求：%+v", got)
	}
	if got := session.FormulaFacts(1); got != nil {
		t.Fatalf("运行期间追加的编号错误地返回了编译事实：%+v", got)
	}
}

func TestSessionFeaturesHasAndAny(t *testing.T) {
	const features = FeatureResourceMax | FeatureModifierSnapshots
	const partial = FeatureResourceMax | FeatureActionStun
	if !features.Has(features) || features.Has(partial) || !features.Any(partial) || features.Any(FeatureActionStun) {
		t.Fatal("Has 要求全部位存在，Any 要求至少一位存在")
	}
}
