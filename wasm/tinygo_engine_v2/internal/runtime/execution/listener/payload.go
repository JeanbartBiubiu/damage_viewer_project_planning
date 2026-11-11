package listener

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// Identity 只指定本场监听错误的规则和会话归属。
type Identity struct{ SchemaHash, RulesHash, SessionID string }

// OperationPayload 借用原监听负载，区分开帧引用和开帧后覆盖的实际引用。
type OperationPayload struct {
	Operations                []planbundle.CompiledOperation
	Ability                   planbundle.CompiledAbility
	EntryReference, Reference string
	Owner, Provider           string
	StrictReads, Mounted      bool
	ReadsDamageStateBefore    bool
}

// PrepareOperations 在原操作监听执行点准备完整负载，范围错误发生在真实帧建立前。
func PrepareOperations(definition planbundle.CompiledListener, operations []planbundle.CompiledOperation, abilities []planbundle.CompiledAbility, automated bool, identity Identity) (OperationPayload, *model.EngineError) {
	start := definition.OperationStart
	end := start + definition.OperationCount
	if int(end) > len(operations) {
		return OperationPayload{}, listenerError(identity, model.GenericErrRuntimeInvariantFailed, "listener operation range out of bounds", "", "")
	}
	payload := OperationPayload{
		Operations: operations[start:end], EntryReference: "listener:" + definition.ListenerKey,
		Owner: definition.OwnerCombatantKey, Provider: definition.OwnerProviderRef,
		StrictReads:            automated || definition.HasCondition || definition.HasOncePerUse,
		Mounted:                definition.OwnerCombatantKey != "" && definition.OwnerProviderRef != "",
		ReadsDamageStateBefore: definition.ReadsDamageStateBefore,
	}
	payload.Reference = payload.EntryReference
	if definition.SourceAbilityIndex >= 0 && definition.SourceAbilityIndex < len(abilities) {
		payload.Ability = abilities[definition.SourceAbilityIndex]
		payload.Reference = definition.OwnerCombatantKey + ".provider[" + definition.OwnerProviderRef + "].ability[" + payload.Ability.AbilityKey + "]"
	}
	return payload, nil
}

func listenerError(identity Identity, code model.GenericErrCode, message, path, ref string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, code, message)
	err.SchemaHash, err.RulesHash, err.SessionID = identity.SchemaHash, identity.RulesHash, identity.SessionID
	err.Path, err.Ref = path, ref
	return &err
}
