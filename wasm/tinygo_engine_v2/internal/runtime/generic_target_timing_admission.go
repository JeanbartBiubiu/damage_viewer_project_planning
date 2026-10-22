package runtime

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *genericRunState) validateTargetTimingProvider(provider planbundle.CompiledProvider, owner, ref string) *model.EngineError {
	if !s.compiled.HasTargetTiming || len(provider.TargetTimings) > 4 || (provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || provider.SkillKey == "" || provider.Lifecycle != nil || provider.AmmoBinding != nil || len(provider.Processes)+len(provider.Modifiers)+len(provider.StatusContributions) != 0 {
		return s.basicAttackErr("target timing requires its complete bounded permanent natural source", ref)
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == ref {
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *genericRunState) addTargetTimingOperations(provider planbundle.CompiledProvider, allowed map[string]bool) {
	for _, timing := range provider.TargetTimings {
		a := s.compiled.Abilities[timing.AbilityIndex]
		start, count := uint16(0), uint16(0)
		if timing.Phased {
			start, count = a.TickSpec.OnTickStart, a.TickSpec.OnTickCount
		} else {
			start, count = a.TargetExpirySpec.OnExpireStart, a.TargetExpirySpec.OnExpireCount
		}
		for _, op := range s.compiled.Operations[int(start) : int(start)+int(count)] {
			allowed[op.Path] = true
		}
	}
}
