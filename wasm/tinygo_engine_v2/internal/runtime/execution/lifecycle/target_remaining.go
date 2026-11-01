package lifecycle

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (e *Executor) ValidateTargetRemaining(op plan.CompiledOperation) *model.EngineError {
	if op.Target != model.SelectorSelf || op.StateScope != stateScopeProviderTarget || op.OwnerProviderIndex < 0 || op.OwnerProviderIndex >= len(e.compiled.Providers) {
		return e.fail(model.GenericErrFormulaTypeError, op.Path, "ensure_remaining requires an own provider_target field and target self", op.Ref)
	}
	field, exists := e.compiled.Providers[op.OwnerProviderIndex].StateFields[op.Ref]
	if !exists || field.ValueType != model.ProviderStateValueInteger || field.StateKind != "" || field.AmmoRecovery != nil || field.DurationMs <= 0 {
		return e.fail(model.GenericErrFormulaTypeError, op.Path, "ensure_remaining requires a declared own finite ordinary integer field", op.Ref)
	}
	return nil
}

func (e *Executor) TargetRemainingDeadline(op plan.CompiledOperation, current int64, amount float64, now int64) (int64, bool, *model.EngineError) {
	if !effectpkg.FiniteState(amount) || amount <= 0 || amount > float64(maxJSONSafeInteger) || math.Trunc(amount) != amount {
		return 0, false, e.fail(model.GenericErrFormulaTypeError, op.Path, "ensure_remaining amount must be positive safe integer milliseconds", op.Ref)
	}
	if now > math.MaxInt64-int64(amount) {
		return 0, false, e.fail(model.GenericErrFormulaTypeError, op.Path, "ensure_remaining timestamp overflow", op.Ref)
	}
	next := now + int64(amount)
	return next, next > current, nil
}

// SourceExpiryCurrent 复核原状态期限，陈旧回调不能清除后续写入。
func SourceExpiryCurrent(payload effectpkg.ExpiryPayload, bag effectpkg.BagView, now int64) bool {
	return bag.Present() && bag.ExpireAt().At(payload.StateKey) == payload.ExpectedExpireAt && payload.ExpectedExpireAt <= now
}

// TargetExpiryCurrent 复核实际目标和完整期限，保持目标切换及刷新的旧事件失效。
func TargetExpiryCurrent(payload effectpkg.ExpiryPayload, bag effectpkg.BagView, now int64) bool {
	return payload.CombatantKey != "" && payload.ProviderRef != "" && payload.StateKey != "" &&
		bag.Present() && bag.TargetKey() == payload.TargetKey && bag.TargetExpireAt().At(payload.StateKey) == payload.ExpectedExpireAt &&
		payload.ExpectedExpireAt <= now && payload.TargetKey != ""
}

// ClearExpiredSourceState 暂存来源状态到期，是否运行到期操作由调用者按真实世代另行决定。
func ClearExpiredSourceState(payload effectpkg.ExpiryPayload, bag effectpkg.BagChange) {
	bag.SetStateValue(payload.StateKey, bag.Fields().At(payload.StateKey).DefaultValue)
	bag.SetExpireAt(payload.StateKey, 0)
}

// ClearExpiredTargetState 只暂存该实际目标状态的默认值和零期限。
func ClearExpiredTargetState(payload effectpkg.ExpiryPayload, bag effectpkg.BagChange) {
	bag.SetTargetValue(payload.StateKey, bag.Fields().At(payload.StateKey).DefaultValue)
	bag.SetTargetExpireAt(payload.StateKey, 0)
}
