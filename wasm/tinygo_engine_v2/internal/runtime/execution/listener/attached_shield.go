package listener

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// AttachedShieldInput 只描述当前共享强化帧中原盾自己的消费监听。
type AttachedShieldInput struct {
	Event             EventMatchFacts
	Bindings          planbundle.RuntimeTypeBindings
	Compiled          []planbundle.CompiledListener
	Operations        []planbundle.CompiledOperation
	Abilities         []planbundle.CompiledAbility
	ShieldOwner       string
	ShieldProviderRef string
}

// AttachedShieldHost 在当前暂存执行唯一的盾消费监听，不建立子帧或提前派发。
type AttachedShieldHost[Snapshot, Binding any] interface {
	// ListenerMountLive 读取当前实际挂载资格。
	ListenerMountLive(definition planbundle.CompiledListener) bool
	// BeginAttachedListener 暂时绑定该监听的实际双方及原阻挡事实，返回当前调用的恢复凭据。
	BeginAttachedListener(snapshot Snapshot, definition planbundle.CompiledListener, ability planbundle.CompiledAbility, source, target string) Binding
	// EndAttachedListener 恢复原求值范围；executed表示已执行操作，需要单独归属实际输出。
	EndAttachedListener(binding Binding, executed bool)
	// AttachedListenerCondition 在当前共享暂存中求值条件并核对有限结果。
	AttachedListenerCondition(definition planbundle.CompiledListener, ability planbundle.CompiledAbility) (bool, *model.EngineError)
	// AttachedListenerOperations 在当前共享帧执行已核定操作，不自行提交。
	AttachedListenerOperations(ability planbundle.CompiledAbility, operations []planbundle.CompiledOperation) *model.EngineError
	// AttachedListenerError 返回原过程错误，不发布状态。
	AttachedListenerError(path, message, provider string) *model.EngineError
}

// ConsumeAttachedShield 保留专用盾监听原有原序、实时条件和同帧操作边界。
func ConsumeAttachedShield[Snapshot, Binding any](state *State, input AttachedShieldInput, snapshot Snapshot, host AttachedShieldHost[Snapshot, Binding]) *model.EngineError {
	matched := false
	compiledCount := len(input.Compiled)
	for index := 0; index < compiledCount+state.DynamicLen(); index++ {
		var definition planbundle.CompiledListener
		if index < compiledCount {
			definition = input.Compiled[index]
		} else {
			definition = state.DynamicAt(index - compiledCount)
		}
		if definition.OwnerCombatantKey != input.ShieldOwner || definition.OwnerProviderRef != input.ShieldProviderRef {
			continue
		}
		facts := input.Event
		facts.MountLive = host.ListenerMountLive(definition)
		if !Matches(definition, facts, input.Bindings) {
			continue
		}
		if definition.HasAbilityRef || definition.HasOncePerUse || definition.PerCastThrottleMs != 0 || definition.MaxTriggersPerEvent != 1 || definition.OperationCount == 0 {
			return host.AttachedListenerError("listeners."+definition.ListenerKey, "attached spell shield requires its complete single consumption listener", input.ShieldProviderRef)
		}
		operations := input.Operations[int(definition.OperationStart) : int(definition.OperationStart)+int(definition.OperationCount)]
		consumes := 0
		for _, operation := range operations {
			if operation.Operation == "expire_provider" && operation.ProviderRefFromEvent {
				consumes++
			}
		}
		if consumes != 1 {
			return host.AttachedListenerError("listeners."+definition.ListenerKey, "attached spell shield listener must consume its frozen instance once", input.ShieldProviderRef)
		}
		var ability planbundle.CompiledAbility
		if definition.SourceAbilityIndex >= 0 {
			ability = input.Abilities[definition.SourceAbilityIndex]
		}
		source, target := Combatants(input.Event.EventType, input.Event.SourceKey, input.Event.TargetKey, definition.OwnerCombatantKey)
		binding := host.BeginAttachedListener(snapshot, definition, ability, source, target)
		if definition.HasCondition {
			accepted, err := host.AttachedListenerCondition(definition, ability)
			if err != nil || !accepted {
				host.EndAttachedListener(binding, false)
				if err != nil {
					return err
				}
				continue
			}
		}
		err := host.AttachedListenerOperations(ability, operations)
		host.EndAttachedListener(binding, true)
		if err != nil {
			return err
		}
		matched = true
	}
	if !matched {
		return host.AttachedListenerError("listeners", "spell shield has no complete own consumption listener", input.ShieldProviderRef)
	}
	return nil
}
