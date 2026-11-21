package plan

// SessionFeatures 由编译阶段汇总，运行阶段只读。
type SessionFeatures uint64

const (
	FeaturePermanentCharacterPeriod SessionFeatures = 1 << iota
	FeatureImmediatePeriodic
	FeatureTotalCooldownRefund
	FeatureCumulativeCooldownRefund
	FeatureTargetTiming
	FeatureDamageStateBefore
	FeatureTargetMarkConsumption
	FeatureReceivedShieldReads
	FeatureAttackStartStateReads
	FeatureStateOnExpire
	FeatureStagedLinkedShield
	FeatureModifierSnapshots
	FeatureMechanicReads
	FeatureShieldLifecycle
	FeatureLinkedShieldReads
	FeatureProviderElapsedReads
	FeatureTargetStateTimeReads
	FeatureFiniteModifierExpiry
	FeatureResourceMax
	FeatureCooldownDuration
	FeatureProviderDurationChange
	FeatureActionStun
)

// Has 测试指定的位是否全部存在。
func (f SessionFeatures) Has(flag SessionFeatures) bool {
	return f&flag == flag
}

// Any 测试指定的位是否至少存在一项。
func (f SessionFeatures) Any(mask SessionFeatures) bool {
	return f&mask != 0
}

// NeedsDynamicProviderFlush 判断会话是否需要同步暂存的动态供值器。
func (f SessionFeatures) NeedsDynamicProviderFlush() bool {
	return f.Any(FeatureResourceMax | FeatureCooldownDuration | FeatureProviderDurationChange | FeatureStagedLinkedShield | FeatureModifierSnapshots)
}

// AllowsDurationOnlyLinkedShieldProjection 判断会话是否允许按续时规则检查普通关联盾的投影资格。
func (f SessionFeatures) AllowsDurationOnlyLinkedShieldProjection() bool {
	return f.Has(FeatureProviderDurationChange) && !f.Any(FeatureResourceMax|FeatureCooldownDuration)
}

// NeedsExactExpirySweep 判断当前特性是否要求通过独立帧处理供值器到期。
func (f SessionFeatures) NeedsExactExpirySweep() bool {
	return f.Has(FeatureActionStun) || f.NeedsDynamicProviderFlush()
}

// HasSpecialFormulaFacts 判断会话是否启用三类公式事实读取之一。
func (f SessionFeatures) HasSpecialFormulaFacts() bool {
	return f.Any(FeatureLinkedShieldReads | FeatureReceivedShieldReads | FeatureDamageStateBefore)
}
