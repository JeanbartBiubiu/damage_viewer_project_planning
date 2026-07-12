package runtime

import (
	"math"
)

const (
	stateScopeProvider       = "state_scope/provider"
	stateScopeProviderTarget = "state_scope/provider_target"
)

// providerStateBag holds numeric provider state for one mounted providerRef.
// Snapshot JSON shape (stable):
//
//	providerState[providerRef] = {
//	  "state": { "<key>": <number> },
//	  "targetState": { "target": "<combatantKey>", "values": { "<key>": <number> } }
//	}
//
// targetState is single-active-target: writing a key for a new target clears prior target values.
type providerStateBag struct {
	state        map[string]float64
	targetKey    string
	targetValues map[string]float64
}

func (b *providerStateBag) ensure() {
	if b.state == nil {
		b.state = map[string]float64{}
	}
	if b.targetValues == nil {
		b.targetValues = map[string]float64{}
	}
}

func cloneProviderStateMap(src map[string]*providerStateBag) map[string]*providerStateBag {
	if len(src) == 0 {
		return map[string]*providerStateBag{}
	}
	out := make(map[string]*providerStateBag, len(src))
	for k, bag := range src {
		if bag == nil {
			out[k] = &providerStateBag{state: map[string]float64{}, targetValues: map[string]float64{}}
			continue
		}
		out[k] = &providerStateBag{
			state:        cloneFloatMap(bag.state),
			targetKey:    bag.targetKey,
			targetValues: cloneFloatMap(bag.targetValues),
		}
	}
	return out
}

func cloneFloatMap(src map[string]float64) map[string]float64 {
	if len(src) == 0 {
		return map[string]float64{}
	}
	out := make(map[string]float64, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func materializeProviderState(raw map[string]interface{}) map[string]*providerStateBag {
	out := map[string]*providerStateBag{}
	if len(raw) == 0 {
		return out
	}
	for providerRef, entry := range raw {
		bag := &providerStateBag{state: map[string]float64{}, targetValues: map[string]float64{}}
		obj, ok := entry.(map[string]interface{})
		if !ok {
			out[providerRef] = bag
			continue
		}
		if stateObj, ok := obj["state"].(map[string]interface{}); ok {
			for k, v := range stateObj {
				if n, ok := asFloat64(v); ok {
					bag.state[k] = n
				}
			}
		}
		if tsObj, ok := obj["targetState"].(map[string]interface{}); ok {
			if t, ok := tsObj["target"].(string); ok {
				bag.targetKey = t
			}
			if values, ok := tsObj["values"].(map[string]interface{}); ok {
				for k, v := range values {
					if n, ok := asFloat64(v); ok {
						bag.targetValues[k] = n
					}
				}
			}
		}
		out[providerRef] = bag
	}
	return out
}

func providerStateToSnapshot(bags map[string]*providerStateBag) map[string]interface{} {
	out := map[string]interface{}{}
	if len(bags) == 0 {
		return out
	}
	for providerRef, bag := range bags {
		if bag == nil {
			continue
		}
		stateObj := map[string]interface{}{}
		for k, v := range bag.state {
			stateObj[k] = v
		}
		entry := map[string]interface{}{
			"state": stateObj,
		}
		if bag.targetKey != "" || len(bag.targetValues) > 0 {
			valuesObj := map[string]interface{}{}
			for k, v := range bag.targetValues {
				valuesObj[k] = v
			}
			entry["targetState"] = map[string]interface{}{
				"target": bag.targetKey,
				"values": valuesObj,
			}
		}
		out[providerRef] = entry
	}
	return out
}

func asFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	default:
		return 0, false
	}
}

func applyStatePolicy(current, amount float64, policy string) (float64, bool) {
	switch policy {
	case "override", "set":
		return amount, true
	case "add", "":
		return current + amount, true
	default:
		return 0, false
	}
}

func finiteState(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
