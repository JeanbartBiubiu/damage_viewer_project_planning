package admission

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// FixedEquipmentHealthReads 只在已确认常驻装备生命贡献后读取物化属性。
type FixedEquipmentHealthReads interface {
	// InitialHealthAttributes 借用指定角色已物化的不可变属性，不准备或发布状态。
	InitialHealthAttributes(owner string) attribute.Table
}

// ValidateFixedEquipmentHealth 校验常驻装备生命贡献后的上限和当前值，保持原误差与首错。
func ValidateFixedEquipmentHealth(input Input, reads FixedEquipmentHealthReads) *model.EngineError {
	for _, actor := range input.Compiled.Combatants {
		hasHealthContribution := false
		for _, mount := range actor.ProviderMounts {
			provider := input.Compiled.Providers[mount.DefinitionIndex]
			if provider.Kind != "item" || provider.Lifecycle != nil || provider.AbilityCount != 0 {
				continue
			}
			for _, modifier := range provider.Modifiers {
				selector := pipeline.ModifierTargetCombatantSelector(modifier.Target)
				if modifier.Kind == "attribute" && pipeline.AttributeKeyFromModifierTarget(modifier.Target) == "hp" && (selector == "" || selector == "self") {
					hasHealthContribution = true
				}
			}
		}
		if !hasHealthContribution {
			continue
		}
		hp := reads.InitialHealthAttributes(actor.Key).At("hp")
		if math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) || hp.Max <= 0 || hp.Current < 0 || hp.Current > hp.Max || math.Abs(hp.Max-hp.Resolved) > 1e-9*math.Max(1, math.Abs(hp.Max)) {
			return fail(input, "equipped HP maximum must match native contributions and current HP must remain within it", "initialSnapshot.combatants."+actor.Key+".attributes.hp")
		}
	}
	return nil
}
