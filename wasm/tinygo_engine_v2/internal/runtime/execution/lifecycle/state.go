package lifecycle

import (
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

const (
	stateScopeProvider       = effectpkg.StateScopeProvider
	stateScopeProviderTarget = effectpkg.StateScopeProviderTarget
)

// StateWriteActions 只在效果写入的原同步位置处理共享弹药和旧目标冷却。
type StateWriteActions interface {
	// ConsumeStateAmmo 暂存本次实际弹药消耗；失败沿当前效果操作返回，不创建子帧。
	ConsumeStateAmmo(operation plan.CompiledOperation, ability plan.CompiledAbility, before, after float64) *model.EngineError
	// ReleaseStateTargetCooldowns 清理切换前的实际目标冷却，不能改变其他帧或发布。
	ReleaseStateTargetCooldowns(owner, provider, previous string)
}

type StateWriteInput struct {
	Operation       plan.CompiledOperation
	Ability         plan.CompiledAbility
	Owner, Provider string
	Target          string
	Amount          float64
	Now             int64
	Automated       bool
	Bag             effectpkg.BagChange
	Actions         StateWriteActions
}

type StateWriteResult struct {
	Before, After float64
	Ammo          bool
	ExpireAt      int64
	Expiry        effectpkg.ExpiryPayload
}

type DurationChange struct {
	Applied, Expired bool
	ExpireAt         int64
}

func (e *Executor) ValidateStateWrite(operation plan.CompiledOperation, provider string) *model.EngineError {
	switch {
	case provider == "":
		return e.invariant("", "state_change requires provider context", "")
	case operation.Ref == "":
		return e.fail(model.GenericErrMissingRequiredField, "", "state_change requires ref state key", "")
	case !operation.HasAmount:
		return e.fail(model.GenericErrMissingRequiredField, "", "state_change requires amount", "")
	case operation.StateScope == "":
		return e.fail(model.GenericErrUnknownTypeKey, "", "state_change requires supported state scope", "")
	}
	return nil
}

func (e *Executor) WriteState(input StateWriteInput) (StateWriteResult, *model.EngineError) {
	op, bag := input.Operation, input.Bag
	if !effectpkg.FiniteState(input.Amount) {
		return StateWriteResult{}, e.fail(model.GenericErrFormulaTypeError, "", "non-finite state result", "")
	}
	bag.Ensure()
	result := StateWriteResult{}
	switch op.StateScope {
	case stateScopeProvider:
		bag.LazyExpireProviderState(input.Now)
		result.Before = bag.State().At(op.Ref)
	case stateScopeProviderTarget:
		bag.LazyExpireProviderTargetState(input.Now)
		if bag.Present() && input.Target != "" {
			if previous := bag.TargetKey(); previous != "" && previous != input.Target {
				input.Actions.ReleaseStateTargetCooldowns(input.Owner, input.Provider, previous)
			}
			bag.ActivateProviderTarget(input.Target)
			bag.InvalidateCooldownProjection()
		}
		bag.SeedTargetValueIfAbsent(op.Ref)
		result.Before = bag.ReadTargetValue(op.Ref)
	default:
		return result, e.fail(model.GenericErrUnknownTypeKey, "", "unsupported state scope", "")
	}
	next, message := bag.NextStateValue(op.Ref, result.Before, input.Amount, op.ValuePolicy)
	if message != "" {
		return result, e.fail(model.GenericErrFormulaTypeError, op.Path+".amount", message, op.Ref)
	}
	result.After = next
	if op.StateScope == stateScopeProviderTarget {
		bag.SetTargetValue(op.Ref, next)
		var valid bool
		result.ExpireAt, valid = bag.RefreshTargetExpireAtOnWrite(op.Ref, input.Now)
		if !valid {
			return result, e.invariant("", "provider target state duration overflow", "")
		}
		return result, nil
	}
	bag.SetStateValue(op.Ref, next)
	result.Ammo = op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(e.compiled.Providers) &&
		e.compiled.Providers[op.OwnerProviderIndex].StateFields[op.Ref].StateKind == model.ProviderStateKindAmmo
	if result.Ammo {
		if err := input.Actions.ConsumeStateAmmo(op, input.Ability, result.Before, next); err != nil {
			return result, err
		}
	}
	if !bag.RefreshExpireAtOnWrite(op.Ref, input.Now) {
		return result, e.invariant("", "provider state duration overflow", "")
	}
	generation := uint64(0)
	if bag.Fields().At(op.Ref).HasOnExpire {
		generation = bag.RearmSourceExpiry(op.Ref, bag.ExpireAt().At(op.Ref))
	}
	if expires := bag.ExpireAt().At(op.Ref); expires > 0 && (input.Automated || generation > 0) {
		result.ExpireAt = expires
		result.Expiry = effectpkg.ExpiryPayload{Kind: "provider_source_state", CombatantKey: input.Owner,
			ProviderRef: input.Provider, StateKey: op.Ref, ExpectedExpireAt: expires, StateGeneration: generation,
			BeforeCombat: bag.Fields().At(op.Ref).OnExpireBeforeCombat}
	}
	return result, nil
}

func (e *Executor) ValidateDurationChange(op plan.CompiledOperation, provider string) *model.EngineError {
	switch {
	case provider == "":
		return e.invariant("", "state_duration_change requires provider context", "")
	case op.Ref == "":
		return e.fail(model.GenericErrMissingRequiredField, "", "state_duration_change requires ref state key", "")
	case !op.HasAmount:
		return e.fail(model.GenericErrMissingRequiredField, "", "state_duration_change requires amount", "")
	}
	if op.ValuePolicy == "ensure_remaining" || op.ValuePolicy == "ensure_remaining_preserve_phase" {
		return nil
	}
	switch {
	case op.ValuePolicy != "subtract":
		return e.invariant("", "state_duration_change requires valuePolicy=subtract", "")
	case op.Target != model.SelectorSource && op.Target != model.SelectorSelf:
		return e.fail(model.GenericErrOperationTargetMissing, "", "state_duration_change target must be source or self", "")
	case op.StateScope == "":
		return e.fail(model.GenericErrUnknownTypeKey, "", "state_duration_change requires supported state scope", "")
	}
	return nil
}

func (e *Executor) StateDurationActive(op plan.CompiledOperation, bag effectpkg.BagChange, now int64) (bool, *model.EngineError) {
	switch op.StateScope {
	case stateScopeProvider:
		bag.LazyExpireProviderState(now)
		expiry, found := bag.ExpireAt().Lookup(op.Ref)
		return found && expiry > 0, nil
	case stateScopeProviderTarget:
		bag.LazyExpireProviderTargetState(now)
		if bag.TargetKey() == "" {
			return false, nil
		}
		expiry, found := bag.TargetExpireAt().Lookup(op.Ref)
		return found && expiry > 0, nil
	default:
		return false, e.fail(model.GenericErrUnknownTypeKey, "", "unsupported state scope", "")
	}
}

func (e *Executor) SubtractStateDuration(op plan.CompiledOperation, bag effectpkg.BagChange, amount float64, now int64) (DurationChange, *model.EngineError) {
	if !effectpkg.FiniteState(amount) || amount < 0 {
		return DurationChange{}, e.fail(model.GenericErrFormulaTypeError, "", "state_duration_change amount must be finite and non-negative", "")
	}
	delta := int64(math.Round(amount))
	var applied, expired bool
	var expiry int64
	if op.StateScope == stateScopeProvider {
		applied, expired, expiry = bag.SubtractProviderExpireAt(op.Ref, now, delta)
	} else {
		applied, expired, expiry = bag.SubtractTargetExpireAt(op.Ref, now, delta)
	}
	if applied && expired {
		definition, found := bag.Fields().Lookup(op.Ref)
		defaultValue := 0.0
		if found {
			defaultValue = definition.DefaultValue
		}
		if op.StateScope == stateScopeProvider {
			bag.SetStateValue(op.Ref, defaultValue)
		} else {
			bag.SetTargetValue(op.Ref, defaultValue)
		}
	}
	return DurationChange{Applied: applied, Expired: expired, ExpireAt: expiry}, nil
}
