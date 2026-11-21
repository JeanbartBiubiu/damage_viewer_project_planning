package admission

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ValidateTargetTimingDefinition 核对有界目标时序的静态来源，不安装运行状态。
func ValidateTargetTimingDefinition(input Input, provider planbundle.CompiledProvider, ref string) *model.EngineError {
	if !input.Compiled.Features.Has(planbundle.FeatureTargetTiming) || len(provider.TargetTimings) > 4 || (provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.SkillKey == "" || provider.Lifecycle != nil || provider.AmmoBinding != nil || len(provider.Processes)+len(provider.Modifiers)+len(provider.StatusContributions) != 0 {
		return fail(input, "target timing requires its complete bounded permanent natural source", ref)
	}
	return nil
}

// AddTargetTimingOperations 将已准入目标时序的操作路径加入调用方独占的临时准入集合。
func AddTargetTimingOperations(compiled planbundle.CompiledSession, provider planbundle.CompiledProvider, allowed map[string]bool) {
	for _, timing := range provider.TargetTimings {
		a := compiled.Abilities[timing.AbilityIndex]
		start, count := uint16(0), uint16(0)
		if timing.Phased {
			start, count = a.TickSpec.OnTickStart, a.TickSpec.OnTickCount
		} else {
			start, count = a.TargetExpirySpec.OnExpireStart, a.TargetExpirySpec.OnExpireCount
		}
		for _, op := range compiled.Operations[int(start) : int(start)+int(count)] {
			allowed[op.Path] = true
		}
	}
}
