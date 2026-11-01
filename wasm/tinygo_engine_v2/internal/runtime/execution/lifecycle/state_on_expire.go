package lifecycle

import (
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (e *Executor) StateOnExpireBinding(payload effectpkg.ExpiryPayload, instances effectpkg.ProviderList, bag effectpkg.BagView, now int64) (plan.CompiledProviderStateField, bool) {
	if payload.Kind != "provider_source_state" || payload.StateGeneration == 0 || payload.ExpectedExpireAt <= 0 {
		return plan.CompiledProviderStateField{}, false
	}
	instance, _, mounted := instances.Find(payload.ProviderRef)
	if !mounted || instance.Owner != payload.CombatantKey || instance.Source != payload.CombatantKey || instance.Expired(now) {
		return plan.CompiledProviderStateField{}, false
	}
	field := e.compiled.Providers[instance.DefinitionIndex].StateFields[payload.StateKey]
	if field.OnExpireCount == 0 || !bag.Present() {
		return field, false
	}
	fact := bag.SourceExpiry(payload.StateKey)
	return field, fact.Generation == payload.StateGeneration && fact.Deadline == payload.ExpectedExpireAt
}

// ClearCallbackSourceState 在真实回调帧预算已接纳后清除状态与期限事实，操作负载仍在同一帧随后执行。
func ClearCallbackSourceState(payload effectpkg.ExpiryPayload, field plan.CompiledProviderStateField, bag effectpkg.BagChange) {
	bag.SetStateValue(payload.StateKey, field.DefaultValue)
	bag.SetExpireAt(payload.StateKey, 0)
	fact := bag.SourceExpiry(payload.StateKey)
	fact.Deadline = 0
	bag.SetSourceExpiry(payload.StateKey, fact)
}
