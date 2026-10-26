package execution

import (
	"math"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (f *Frame) ensureTargetStateRemaining(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
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
	bag := f.providerStateBagForRead(owner, f.ownerProviderRef, false, effectpkg.ReadOptions{ExpireTarget: true})
	if bag.TargetStateRemainingMs(op.Ref, f.targetKey, f.run.loop.TimeMs()) == 0 {
		return nil
	}
	// 不活动时不求金额；活动时仍核对实际结果，不容许运行值越界或取整。
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !effectpkg.FiniteState(amount) || amount <= 0 || amount > 9007199254740991 || math.Trunc(amount) != amount {
		return fail("ensure_remaining amount must be positive safe integer milliseconds")
	}
	next, valid := addDuration(f.run.loop.TimeMs(), int64(amount))
	if !valid {
		return fail("ensure_remaining timestamp overflow")
	}
	if next <= bag.TargetExpireAt().At(op.Ref) {
		return nil
	}
	change := f.providerStateBag(owner, f.ownerProviderRef, false)
	change.SetTargetExpireAt(op.Ref, next)
	f.stageProviderTargetStateExpiry(owner, f.ownerProviderRef, f.targetKey, op.Ref, next)
	f.stageFor(owner).dirty = true
	return nil
}
