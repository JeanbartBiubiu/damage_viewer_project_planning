package effect

import (
	"tinygo_engine_v2/internal/model"

	"tinygo_engine_v2/internal/runtime/contract"
)

func stateCooldownIdentity(owner, provider, key, scope, target string) contract.CooldownIdentity {
	return contract.CooldownIdentity{Owner: owner, ProviderRef: provider, StateKey: key, Scope: scope, Target: target}
}

func InternalCooldownValue(ledger contract.CooldownView, id contract.CooldownIdentity, now int64) float64 {
	if ledger.Remaining(id, now) > 0 {
		return 1
	}
	return 0
}

// 投影不保留账本指针；读取者必须传入自己冻结或当次帧的实际版本。
func (b *bagData) projectInternalCooldowns(ledger contract.CooldownView, owner, provider string, now int64) {
	if b == nil || !ledger.Present() || !b.hasInternalCooldowns {
		return
	}
	if b.cooldownProjectionBound && b.cooldownProjectionVersion == ledger.Revision() && b.cooldownProjectionAt == now {
		return
	}
	values := CloneFloatMap(b.state)
	for key, def := range b.fieldDefs {
		if def.StateKind == model.ProviderStateKindCooldown {
			values[key] = InternalCooldownValue(ledger, stateCooldownIdentity(owner, provider, key, StateScopeProvider, ""), now)
		}
	}
	b.state, b.stateShared = values, true
	if b.targetKey != "" {
		target := CloneFloatMap(b.targetValues)
		for slot := 0; slot < ledger.Len(); slot++ {
			id, _ := ledger.At(slot)
			if id.Owner == owner && id.ProviderRef == provider && id.Scope == StateScopeProviderTarget && id.Target == b.targetKey && b.fieldDefs[id.StateKey].StateKind == model.ProviderStateKindCooldown {
				target[id.StateKey] = InternalCooldownValue(ledger, id, now)
			}
		}
		for key := range target {
			if b.fieldDefs[key].StateKind == model.ProviderStateKindCooldown {
				target[key] = InternalCooldownValue(ledger, stateCooldownIdentity(owner, provider, key, StateScopeProviderTarget, b.targetKey), now)
			}
		}
		b.targetValues, b.targetValuesShared = target, true
	}
	b.cooldownProjectionBound, b.cooldownProjectionAt, b.cooldownProjectionVersion = true, now, ledger.Revision()
}

func projectInternalCooldownExpiries(out map[string]interface{}, ledger contract.CooldownView, owner, provider, target, scope string, now int64) {
	if !ledger.Present() {
		return
	}
	for slot := 0; slot < ledger.Len(); slot++ {
		id, entry := ledger.At(slot)
		if id.Owner == owner && id.ProviderRef == provider && id.Scope == scope && id.Target == target && entry.Active && entry.ReadyAt > now {
			out[id.StateKey] = float64(entry.ReadyAt)
		}
	}
}
