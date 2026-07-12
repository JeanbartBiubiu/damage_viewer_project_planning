package runtime

import (
	"math"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	stateScopeProvider       = "state_scope/provider"
	stateScopeProviderTarget = "state_scope/provider_target"
)

// providerStateFieldDef is the runtime copy of compiled provider-scope field metadata (Gate H1).
type providerStateFieldDef struct {
	defaultValue  float64
	maxValue      float64
	hasCap        bool
	durationMs    int64
	refreshPolicy string
}

// providerStateBag holds numeric provider state for one mounted providerRef.
// Snapshot JSON shape (stable):
//
//	providerState[providerRef] = {
//	  "state": { "<key>": <number> },
//	  "targetState": { "target": "<combatantKey>", "values": { "<key>": <number> } }
//	}
//
// targetState is single-active-target: writing a key for a new target clears prior target values.
// Provider-scope timed metadata (expireAt) is runtime-only and not emitted in snapshots.
type providerStateBag struct {
	state        map[string]float64
	expireAt     map[string]int64
	fieldDefs    map[string]providerStateFieldDef
	targetKey    string
	targetValues map[string]float64
}

func (b *providerStateBag) ensure() {
	if b.state == nil {
		b.state = map[string]float64{}
	}
	if b.expireAt == nil {
		b.expireAt = map[string]int64{}
	}
	if b.fieldDefs == nil {
		b.fieldDefs = map[string]providerStateFieldDef{}
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
			out[k] = &providerStateBag{
				state:        map[string]float64{},
				expireAt:     map[string]int64{},
				fieldDefs:    map[string]providerStateFieldDef{},
				targetValues: map[string]float64{},
			}
			continue
		}
		out[k] = &providerStateBag{
			state:        cloneFloatMap(bag.state),
			expireAt:     cloneInt64Map(bag.expireAt),
			fieldDefs:    cloneFieldDefMap(bag.fieldDefs),
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

func cloneInt64Map(src map[string]int64) map[string]int64 {
	if len(src) == 0 {
		return map[string]int64{}
	}
	out := make(map[string]int64, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func cloneFieldDefMap(src map[string]providerStateFieldDef) map[string]providerStateFieldDef {
	if len(src) == 0 {
		return map[string]providerStateFieldDef{}
	}
	out := make(map[string]providerStateFieldDef, len(src))
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
		bag := &providerStateBag{
			state:        map[string]float64{},
			expireAt:     map[string]int64{},
			fieldDefs:    map[string]providerStateFieldDef{},
			targetValues: map[string]float64{},
		}
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

func compiledStateFieldsToRuntime(fields map[string]compilebundle.CompiledProviderStateField) map[string]providerStateFieldDef {
	if len(fields) == 0 {
		return map[string]providerStateFieldDef{}
	}
	out := make(map[string]providerStateFieldDef, len(fields))
	for k, f := range fields {
		out[k] = providerStateFieldDef{
			defaultValue:  f.DefaultValue,
			maxValue:      f.MaxValue,
			hasCap:        f.HasCap,
			durationMs:    f.DurationMs,
			refreshPolicy: f.RefreshPolicy,
		}
	}
	return out
}

// bindFieldDefs attaches compiled field definitions once and seeds missing keys with defaultValue.
func (b *providerStateBag) bindFieldDefs(fields map[string]providerStateFieldDef) {
	if b == nil || len(fields) == 0 {
		return
	}
	b.ensure()
	if len(b.fieldDefs) == 0 {
		b.fieldDefs = cloneFieldDefMap(fields)
	}
	for k, def := range b.fieldDefs {
		if _, ok := b.state[k]; !ok {
			b.state[k] = def.defaultValue
		}
	}
}

// lazyExpireProviderState resets expired provider-scope keys to defaultValue (Gate H1).
func (b *providerStateBag) lazyExpireProviderState(nowMs int64) {
	if b == nil || len(b.fieldDefs) == 0 {
		return
	}
	b.ensure()
	for key, def := range b.fieldDefs {
		if def.durationMs <= 0 {
			continue
		}
		exp, ok := b.expireAt[key]
		if !ok || exp <= 0 {
			continue
		}
		if nowMs >= exp {
			b.state[key] = def.defaultValue
			b.expireAt[key] = 0
		}
	}
}

func (b *providerStateBag) clampProviderStateValue(key string, value float64) float64 {
	if b == nil {
		return value
	}
	def, ok := b.fieldDefs[key]
	if !ok || !def.hasCap {
		return value
	}
	if value > def.maxValue {
		return def.maxValue
	}
	return value
}

func (b *providerStateBag) refreshExpireAtOnWrite(key string, nowMs int64) {
	if b == nil {
		return
	}
	def, ok := b.fieldDefs[key]
	if !ok || def.durationMs <= 0 {
		return
	}
	if def.refreshPolicy != model.ProviderStateRefreshOnWrite {
		return
	}
	b.ensure()
	b.expireAt[key] = nowMs + def.durationMs
}
