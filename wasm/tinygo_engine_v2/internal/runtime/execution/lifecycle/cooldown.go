package lifecycle

import (
	"math"
	"sort"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func MigrateInternalCooldownTimers(bag effectpkg.BagChange, ledger *actionpkg.CooldownLedger, owner, provider string, now int64) {
	if !bag.Present() || !bag.HasInternalCooldowns() {
		return
	}
	keys := make([]string, 0)
	bag.Fields().Range(func(key string, def effectpkg.FieldDefinition) {
		if def.StateKind == model.ProviderStateKindCooldown {
			keys = append(keys, key)
		}
	})
	sort.Strings(keys)
	for _, key := range keys {
		if ready := bag.ExpireAt().At(key); bag.State().At(key) != 0 && ready > now {
			ledger.Set(actionpkg.StateCooldownIdentity(owner, provider, key, stateScopeProvider, ""), ready, now)
		}
		bag.DeleteExpireAt(key)
		if bag.TargetKey() != "" {
			if ready := bag.TargetExpireAt().At(key); bag.TargetValues().At(key) != 0 && ready > now {
				ledger.Set(actionpkg.StateCooldownIdentity(owner, provider, key, stateScopeProviderTarget, bag.TargetKey()), ready, now)
			}
		}
		bag.DeleteTargetExpireAt(key)
	}
	bag.InvalidateCooldownProjection()
	bag.ProjectInternalCooldowns(ledger.View(), owner, provider, now)
}

func ActivateProviderTarget(bag effectpkg.BagChange, ledger *actionpkg.CooldownLedger, owner, provider, target string, now int64) {
	if !bag.Present() || target == "" {
		return
	}
	if bag.TargetKey() != "" && bag.TargetKey() != target {
		ledger.RemoveTarget(owner, provider, bag.TargetKey(), now)
	}
	bag.ActivateProviderTarget(target)
	bag.InvalidateCooldownProjection()
}

func (e *Executor) ChangeInternalCooldown(op plan.CompiledOperation, owner, provider, target string, amount float64, bag effectpkg.BagChange, ledger *actionpkg.CooldownLedger, now int64) (contract.CooldownIdentity, bool, *model.EngineError) {
	if !bag.Present() || bag.Fields().At(op.Ref).StateKind != model.ProviderStateKindCooldown {
		return contract.CooldownIdentity{}, false, e.invariant(op.Path, "internal cooldown requires its explicit compiled state binding", op.Ref)
	}
	if op.StateScope != stateScopeProvider && op.StateScope != stateScopeProviderTarget {
		return contract.CooldownIdentity{}, false, e.invariant(op.Path, "internal cooldown requires its explicit state scope", op.Ref)
	}
	if op.StateScope == stateScopeProviderTarget {
		ActivateProviderTarget(bag, ledger, owner, provider, target, now)
	}
	id := actionpkg.StateCooldownIdentity(owner, provider, op.Ref, op.StateScope, target)
	current := effectpkg.InternalCooldownValue(ledger.View(), id, now)
	next, message := bag.NextStateValue(op.Ref, current, amount, op.ValuePolicy)
	if message != "" || next != 0 && next != 1 {
		if message == "" {
			message = "internal cooldown activity must be zero or one"
		}
		return id, false, e.fail(model.GenericErrFormulaTypeError, op.Path+".amount", message, op.Ref)
	}
	changed := false
	if next == 0 {
		changed = ledger.Reset(id, now)
	} else {
		var valid bool
		changed, valid = ledger.Start(id, bag.Fields().At(op.Ref).DurationMs, now)
		if !valid {
			return id, false, e.invariant(op.Path, "internal cooldown requires a safe positive deadline", op.Ref)
		}
	}
	return id, changed, nil
}

func (e *Executor) InternalCooldownDurationActive(op plan.CompiledOperation, owner, provider, target string, bag effectpkg.BagChange, ledger *actionpkg.CooldownLedger, now int64) (contract.CooldownIdentity, bool, *model.EngineError) {
	if !bag.Present() || bag.Fields().At(op.Ref).StateKind != model.ProviderStateKindCooldown {
		return contract.CooldownIdentity{}, false, e.invariant(op.Path, "internal cooldown requires its explicit compiled state binding", op.Ref)
	}
	if op.StateScope != stateScopeProvider && op.StateScope != stateScopeProviderTarget {
		return contract.CooldownIdentity{}, false, e.invariant(op.Path, "internal cooldown requires its explicit state scope", op.Ref)
	}
	activeTarget := ""
	if op.StateScope == stateScopeProviderTarget {
		if bag.TargetKey() == "" || bag.TargetKey() != target {
			return contract.CooldownIdentity{}, false, nil
		}
		activeTarget = target
	}
	id := actionpkg.StateCooldownIdentity(owner, provider, op.Ref, op.StateScope, activeTarget)
	return id, !ledger.IsReady(id, now), nil
}

func (e *Executor) SubtractInternalCooldown(op plan.CompiledOperation, id contract.CooldownIdentity, amount float64, ledger *actionpkg.CooldownLedger, now int64) (bool, *model.EngineError) {
	if !effectpkg.FiniteState(amount) || amount < 0 || amount > float64(maxJSONSafeInteger) {
		return false, e.fail(model.GenericErrFormulaTypeError, op.Path+".amount", "state_duration_change amount must be finite, non-negative and safe", op.Ref)
	}
	changed, _, _ := ledger.Subtract(id, int64(math.Round(amount)), now)
	return changed, nil
}
