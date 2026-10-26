package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import "tinygo_engine_v2/internal/model"

// Validate the supplied values before materialization can drop malformed data.
func (s *Engine) validateRawProviderState(raw map[string]interface{}, actor combatantRuntime, path string) *model.EngineError {
	fail := func(at, message string) *model.EngineError {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, message, at, "")
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
		fields := s.resolveProviderStateFieldDefs(actor.numbers.Key(), ref, actor.instances.Providers()).Definitions()
		mounted := false
		for instanceIndex, instanceValues := 0, actor.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
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
		if (len(values) > 0 || len(timers) > 0 || key != "") && (!keyOK || !s.combatantExists(key)) {
			return fail(at+".targetState.target", "non-empty targetState requires an actual snapshot actor")
		}
	}
	return nil
}
