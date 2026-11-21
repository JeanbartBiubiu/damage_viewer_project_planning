package admission

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func validatePassiveProcessListener(input Input, listener planbundle.CompiledListener, operation planbundle.CompiledOperation, sources ListenerSources) *model.EngineError {
	facts := listener.AdmissionFacts
	if !facts.PassiveSkillHit || operation.PassiveProcessAdmission == planbundle.PassiveProcessOutsideProvider {
		return fail(input, "passive process requires its complete owned skill-hit listener", operation.Path)
	}
	if operation.PassiveProcessAdmission == planbundle.PassiveProcessMissingProcess ||
		!input.Compiled.AdmissionFacts.HasMountedDefinition(listener.OwnerCombatantKey, listener.OwnerProviderRef, operation.OwnerProviderIndex) {
		return fail(input, "passive process requires its actual source mount and compiled process", operation.Path)
	}
	if operation.PassiveProcessAdmission != planbundle.PassiveProcessComplete {
		return fail(input, "passive process must retain its compiled permanent passive entry", operation.Path)
	}
	provider := input.Compiled.Providers[operation.OwnerProviderIndex]
	process := provider.Processes[operation.PassiveProcessIndex]
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
