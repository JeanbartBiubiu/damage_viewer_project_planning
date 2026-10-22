package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (b *providerStateBag) targetStateRemainingMs(key, target string, now int64) int64 {
	if b == nil || target == "" || b.targetKey != target || b.targetValues[key] <= 0 || b.targetExpireAt[key] <= now {
		return 0
	}
	return b.targetExpireAt[key] - now
}

func (f *executionFrame) ensureTargetStateRemaining(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	fail := func(message string) *model.EngineError {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, op.Path, op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.Target != model.SelectorSelf || op.StateScope != stateScopeProviderTarget || op.OwnerProviderIndex < 0 || op.OwnerProviderIndex >= len(f.run.compiled.Providers) {
		return fail("ensure_remaining requires an own provider_target field and target self")
	}
	field, exists := f.run.compiled.Providers[op.OwnerProviderIndex].StateFields[op.Ref]
	if !exists || field.ValueType != model.ProviderStateValueInteger || field.StateKind != "" || field.AmmoRecovery != nil || field.DurationMs <= 0 {
		return fail("ensure_remaining requires a declared own finite ordinary integer field")
	}
	owner := f.providerOwnerKey()
	bag := f.providerStateBagForRead(owner, f.ownerProviderRef, false, providerStateReadOptions{expireTarget: true})
	if bag.targetStateRemainingMs(op.Ref, f.targetKey, f.run.nowMs) == 0 {
		return nil
	}
	// 不活动时不求金额；活动时仍核对实际结果，不容许运行值越界或取整。
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !finiteState(amount) || amount <= 0 || amount > 9007199254740991 || math.Trunc(amount) != amount {
		return fail("ensure_remaining amount must be positive safe integer milliseconds")
	}
	next, valid := addDuration(f.run.nowMs, int64(amount))
	if !valid {
		return fail("ensure_remaining timestamp overflow")
	}
	if next <= bag.targetExpireAt[op.Ref] {
		return nil
	}
	bag = f.providerStateBag(owner, f.ownerProviderRef, false)
	bag.writableTargetExpireAt()[op.Ref] = next
	f.stageProviderTargetStateExpiry(owner, f.ownerProviderRef, f.targetKey, op.Ref, next)
	f.stageFor(owner).dirty = true
	return nil
}
