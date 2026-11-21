package admission

import planbundle "tinygo_engine_v2/internal/plan"

// 被动过程沿用原监听的能力，但以当前时点的操作范围核对单操作约束。
func ownedSettledEventHeal(input Input, listener planbundle.CompiledListener, operationIndex int) bool {
	return listener.AdmissionFacts.SettledDamageHeal && listener.OperationCount == 1 && input.Compiled.AdmissionFacts.SettledEventHeal(listener.SourceAbilityIndex, operationIndex)
}
