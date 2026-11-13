package admission

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func validatePassiveProcessListener(input Input, listener planbundle.CompiledListener, operation planbundle.CompiledOperation, sources ListenerSources) *model.EngineError {
	hit, hasHit := input.Compiled.RuntimeTypes.SkillHit.Lookup()
	owner, hasOwner := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	if !hasHit || !hasOwner || !listener.EventMatcher.RequiresAllType(hit) || !listener.EventMatcher.RequiresAllType(owner) || operation.Target != model.SelectorSelf || operation.OwnerProviderIndex < 0 || operation.OwnerProviderIndex >= len(input.Compiled.Providers) {
		return fail(input, "passive process requires its complete owned skill-hit listener", operation.Path)
	}
	mounted := false
	for _, actor := range input.Compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			if actor.Key == listener.OwnerCombatantKey && mount.ProviderRef == listener.OwnerProviderRef && int(mount.DefinitionIndex) == operation.OwnerProviderIndex {
				mounted = true
			}
		}
	}
	provider := input.Compiled.Providers[operation.OwnerProviderIndex]
	if !mounted || operation.PassiveProcessIndex < 0 || operation.PassiveProcessIndex >= len(provider.Processes) {
		return fail(input, "passive process requires its actual source mount and compiled process", operation.Path)
	}
	process := provider.Processes[operation.PassiveProcessIndex]
	if process.EntryKind != model.ProcessEntrySkillHitPassive || process.InitialAbilityIndex >= 0 || len(process.Costs) != 0 || process.Cooldown != nil {
		return fail(input, "passive process must retain its compiled permanent passive entry", operation.Path)
	}
	// 编译阶段已禁止时点中的再次启动；这里复用同一来源的叶操作准入，不能借过程绕过原白名单。
	for _, moment := range process.MomentOperations {
		if moment.OperationCount == 0 {
			continue
		}
		tail := listener
		tail.OperationStart, tail.OperationCount = moment.OperationStart, moment.OperationCount
		if err := ValidateEquipmentHitListener(input, tail, sources); err != nil {
			return err
		}
	}
	return nil
}
