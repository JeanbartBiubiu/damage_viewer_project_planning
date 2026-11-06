package listener

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// DispatchInput 保存本次派发不随同步子调用改变的事件事实。
type DispatchInput struct {
	Event      EventMatchFacts
	Bindings   planbundle.RuntimeTypeBindings
	Compiled   []planbundle.CompiledListener
	CastID     uint64
	NowMs      int64
	ChainDepth int
}

// DispatchHost 只交接监听不能自行发布的同步执行阶段。
// 事件与收集器由根层独立拥有；监听包不保存或解释其中的帧与复制收集。
type DispatchHost[Event, Collector any] interface {
	// ListenerMountLive 重新读取实际挂载资格，不沿用冻结前的结果。
	ListenerMountLive(definition planbundle.CompiledListener) bool
	// ListenerCondition 在任何监听写入之前求值一次条件。
	ListenerCondition(event Event, definition planbundle.CompiledListener) (bool, *model.EngineError)
	// ReserveListenerUse 在唯一共同额度账预留，并将凭据绑定本次子帧收集范围。
	ReserveListenerUse(event Event, collector Collector, definition planbundle.CompiledListener) (reserved, skip bool, err *model.EngineError)
	// FinishListenerUse 在真实触发成功后提交；失败只释放尚未提交的额度。
	FinishListenerUse(collector Collector, definition planbundle.CompiledListener, reserved, triggered bool)
	// ListenerOperations 同步执行当前监听的真实操作子帧及既有提交、尾部。
	ListenerOperations(event Event, collector Collector, definition planbundle.CompiledListener, source, target string, chainDepth int) *model.EngineError
	// ListenerAbility 同步尝试当前监听的真实子能力，返回是否实际施放。
	ListenerAbility(event Event, collector Collector, definition planbundle.CompiledListener, source, target string, chainDepth int) (bool, *model.EngineError)
	// ListenerSkipped 仅记录已经确定的跳过事实。
	ListenerSkipped(definition planbundle.CompiledListener, reason string)
	// FinishListenerDispatch 执行本次派发完成后原有的复制收尾。
	FinishListenerDispatch(collector Collector) *model.EngineError
	// ListenerDispatchError 为当前编译监听生成归属本场的错误。
	ListenerDispatchError(code model.GenericErrCode, message, path, ref string) *model.EngineError
}

// Dispatch 先冻结列表与全部条件，再按原序逐项复查活资格并同步执行。
// 事件与收集器只在本次调用期间借用；递归派发具有独立上下文和冻结数组。
func Dispatch[Event, Collector any](state *State, input DispatchInput, event Event, collector Collector, host DispatchHost[Event, Collector]) *model.EngineError {
	dynamic := append([]dynamicListenerBinding(nil), state.dynamic...)
	compiledCount := len(input.Compiled)
	listenerCount := compiledCount + len(dynamic)
	var inlineConditions [16]uint8
	frozen := inlineConditions[:]
	if listenerCount > len(frozen) {
		frozen = make([]uint8, listenerCount)
	}
	for index := 0; index < listenerCount; index++ {
		definition := dispatchBinding(input.Compiled, dynamic, index).definition
		if !definition.HasCondition || !dispatchMatches(input, definition, host.ListenerMountLive(definition)) {
			continue
		}
		accepted, err := host.ListenerCondition(event, definition)
		if err != nil {
			return err
		}
		frozen[index] = 2
		if accepted {
			frozen[index] = 1
		}
	}
	for index := 0; index < listenerCount; index++ {
		binding := dispatchBinding(input.Compiled, dynamic, index)
		definition := binding.definition
		if !dispatchMatches(input, definition, host.ListenerMountLive(definition)) {
			continue
		}
		if frozen[index] == 2 {
			host.ListenerSkipped(definition, "condition_false")
			continue
		}
		triggers := definition.MaxTriggersPerEvent
		if triggers <= 0 {
			triggers = 1
		}
		hasOperations := definition.OperationCount > 0
		hasAbility := definition.HasAbilityRef && definition.AbilityRef != ""
		if !hasOperations && !hasAbility {
			continue
		}
		if !state.Allow(binding.throttleIndex, definition.OwnerCombatantKey, definition.OwnerProviderRef, input.CastID, definition.PerCastThrottleMs, input.NowMs) {
			continue
		}
		if definition.HasOncePerUse && index >= compiledCount {
			return host.ListenerDispatchError(model.GenericErrUnknownRef, "dynamic listeners do not support oncePerUse", "listeners["+definition.ListenerKey+"].oncePerUse", definition.OncePerUseGroup)
		}
		reserved := false
		if definition.HasOncePerUse {
			didReserve, skip, err := host.ReserveListenerUse(event, collector, definition)
			if err != nil {
				return err
			}
			if skip {
				host.ListenerSkipped(definition, "once_per_use")
				continue
			}
			reserved = didReserve
		}
		source, target := Combatants(input.Event.EventType, input.Event.SourceKey, input.Event.TargetKey, definition.OwnerCombatantKey)
		triggered := false
		for trigger := 0; trigger < triggers; trigger++ {
			if hasOperations {
				if err := host.ListenerOperations(event, collector, definition, source, target, input.ChainDepth); err != nil {
					host.FinishListenerUse(collector, definition, reserved, false)
					return err
				}
				triggered = true
			}
			if hasAbility {
				cast, err := host.ListenerAbility(event, collector, definition, source, target, input.ChainDepth)
				if err != nil {
					host.FinishListenerUse(collector, definition, reserved, false)
					return err
				}
				triggered = triggered || cast
			}
		}
		host.FinishListenerUse(collector, definition, reserved, triggered)
		if triggered && definition.PerCastThrottleMs > 0 {
			state.Triggered(binding.throttleIndex, definition.OwnerCombatantKey, definition.OwnerProviderRef, input.CastID, input.NowMs)
		}
	}
	return host.FinishListenerDispatch(collector)
}

func dispatchBinding(compiled []planbundle.CompiledListener, dynamic []dynamicListenerBinding, index int) dynamicListenerBinding {
	if index < len(compiled) {
		return dynamicListenerBinding{definition: compiled[index], throttleIndex: index}
	}
	return dynamic[index-len(compiled)]
}

func dispatchMatches(input DispatchInput, definition planbundle.CompiledListener, live bool) bool {
	facts := input.Event
	facts.MountLive = live
	return Matches(definition, facts, input.Bindings)
}
