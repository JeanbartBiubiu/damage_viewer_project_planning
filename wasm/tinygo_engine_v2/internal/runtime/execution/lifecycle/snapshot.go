package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (e *Executor) validateRawProviderState(raw map[string]interface{}, owner string, instances effectpkg.ProviderList, actualOwners map[string]bool, cache *effectpkg.DefinitionCache, path string) *model.EngineError {
	fail := func(at, message string) *model.EngineError {
		return e.invariant(at, message, "")
	}
	object := func(parent map[string]interface{}, key, at string) (map[string]interface{}, *model.EngineError) {
		value, exists := parent[key]
		if !exists {
			return nil, nil
		}
		out, ok := value.(map[string]interface{})
		if !ok {
			return nil, fail(at, "providerState field must be an object")
		}
		return out, nil
	}
	numbers := func(values map[string]interface{}, at string, timer bool, fields effectpkg.FieldDefinitions) *model.EngineError {
		for key, value := range values {
			if timer {
				if n, ok := effectpkg.AsInt64Strict(value); !ok || n < 0 {
					return fail(at+"."+key, "expireAt must be a non-negative finite integer")
				}
			} else {
				number, numeric := effectpkg.AsFloat64(value)
				if !numeric || !effectpkg.FiniteState(number) {
					return fail(at+"."+key, "state value must be a finite number")
				}
				field := fields.At(key)
				if field.StateKind == model.ProviderStateKindCooldown && number != 0 && number != 1 {
					return fail(at+"."+key, "internal cooldown activity must be zero or one")
				}
				if field.ValueType == model.ProviderStateValueInteger && (!effectpkg.ValidStateInteger(number) || number < 0 || (field.HasCap && number > field.MaxValue)) {
					return fail(at+"."+key, "integer state value must be a non-negative safe integer within maxValue")
				}
			}
		}
		return nil
	}
	for ref, rawBag := range raw {
		at := path + "[" + ref + "]"
		fields := e.stateFields(owner, ref, instances, cache).Definitions()
		mounted := false
		for instanceIndex, instanceValues := 0, instances; instanceIndex < instanceValues.Len(); instanceIndex++ {
			provider := instanceValues.At(instanceIndex)
			if provider.ProviderRef == ref {
				mounted = true
				break
			}
		}
		if !mounted {
			return fail(at, "providerState must belong to a mounted provider")
		}
		bag, ok := rawBag.(map[string]interface{})
		if !ok {
			return fail(at, "providerState bag must be an object")
		}
		for key := range bag {
			if key != "state" && key != "expireAt" && key != "targetState" {
				return fail(at+"."+key, "unknown providerState bag field")
			}
		}
		state, err := object(bag, "state", at+".state")
		if err != nil {
			return err
		}
		if err = numbers(state, at+".state", false, fields); err != nil {
			return err
		}
		expires, err := object(bag, "expireAt", at+".expireAt")
		if err != nil {
			return err
		}
		if err = numbers(expires, at+".expireAt", true, fields); err != nil {
			return err
		}
		target, err := object(bag, "targetState", at+".targetState")
		if err != nil {
			return err
		}
		if target == nil {
			continue
		}
		for key := range target {
			if key != "target" && key != "values" && key != "expireAt" {
				return fail(at+".targetState."+key, "unknown provider targetState field")
			}
		}
		values, err := object(target, "values", at+".targetState.values")
		if err != nil {
			return err
		}
		if err = numbers(values, at+".targetState.values", false, fields); err != nil {
			return err
		}
		timers, err := object(target, "expireAt", at+".targetState.expireAt")
		if err != nil {
			return err
		}
		if err = numbers(timers, at+".targetState.expireAt", true, fields); err != nil {
			return err
		}
		key, keyOK := target["target"].(string)
		if _, exists := target["target"]; exists && !keyOK {
			return fail(at+".targetState.target", "targetState.target must be a snapshot actor key")
		}
		if (len(values) > 0 || len(timers) > 0 || key != "") && (!keyOK || !actualOwners[key]) {
			return fail(at+".targetState.target", "non-empty targetState requires an actual snapshot actor")
		}
	}
	return nil
}

func (e *Executor) stateFields(owner, reference string, instances effectpkg.ProviderList, cache *effectpkg.DefinitionCache) *effectpkg.FieldMetadata {
	index := StateDefinitionIndex(*e.compiled, owner, reference, instances)
	if index < 0 {
		return nil
	}
	return cache.Lookup(index, e.compiled.Providers)
}

func (e *Executor) RestoreStateTimers(owner string, instances effectpkg.ProviderList, bags *effectpkg.BagState, cooldowns **actionpkg.CooldownLedger, raw map[string]interface{}, actualOwners map[string]bool, cache *effectpkg.DefinitionCache, now int64, path string) *model.EngineError {
	if err := e.validateRawProviderState(raw, owner, instances, actualOwners, cache, path); err != nil {
		return err
	}
	for _, reference := range bags.Keys() {
		bag := bags.Edit(reference, false)
		if !bag.Present() {
			continue
		}
		definitions := e.stateFields(owner, reference, instances, cache)
		if definitions == nil {
			continue
		}
		bag.BindFieldDefs(definitions)
		if err := bag.RestoreTimers(now, actualOwners, path+"["+reference+"]", e.compiled.SchemaHash, e.compiled.RulesHash, e.sessionID); err != nil {
			return err
		}
		if *cooldowns == nil {
			*cooldowns = actionpkg.NewCooldownLedger()
		}
		MigrateInternalCooldownTimers(bag, *cooldowns, owner, reference, now)
	}
	return nil
}

func StateDefinitionIndex(compiled plan.CompiledSession, combatantKey, providerRef string, providers effectpkg.ProviderList) int {
	if providerRef == "" {
		return -1
	}
	for instanceIndex, instanceValues := 0, providers; instanceIndex < instanceValues.Len(); instanceIndex++ {
		inst := instanceValues.At(instanceIndex)
		if inst.ProviderRef != providerRef {
			continue
		}
		if int(inst.DefinitionIndex) < len(compiled.Providers) {
			return int(inst.DefinitionIndex)
		}
	}
	for _, combatant := range compiled.Combatants {
		if combatant.Key != combatantKey {
			continue
		}
		for _, mount := range combatant.ProviderMounts {
			if mount.ProviderRef != providerRef {
				continue
			}
			if int(mount.DefinitionIndex) < len(compiled.Providers) {
				return int(mount.DefinitionIndex)
			}
		}
	}
	for index, p := range compiled.Providers {
		if p.ProviderKey == providerRef {
			return index
		}
	}
	return -1
}
