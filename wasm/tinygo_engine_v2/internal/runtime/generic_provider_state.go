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
// targetState is single-active-target: writing a key for a new target clears prior target values
// and per-key targetExpireAt timers. Timed metadata (expireAt / targetExpireAt) is runtime-only
// and not emitted in snapshots. Field schema (defaultValue/maxValue/durationMs/refresh_on_write)
// applies to both provider-scope and provider_target writes.
type providerStateBag struct {
	state          map[string]float64
	expireAt       map[string]int64
	fieldDefs      map[string]providerStateFieldDef
	targetKey      string
	targetValues   map[string]float64
	targetExpireAt map[string]int64
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
	if b.targetExpireAt == nil {
		b.targetExpireAt = map[string]int64{}
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
				state:          map[string]float64{},
				expireAt:       map[string]int64{},
				fieldDefs:      map[string]providerStateFieldDef{},
				targetValues:   map[string]float64{},
				targetExpireAt: map[string]int64{},
			}
			continue
		}
		out[k] = &providerStateBag{
			state:          cloneFloatMap(bag.state),
			expireAt:       cloneInt64Map(bag.expireAt),
			fieldDefs:      cloneFieldDefMap(bag.fieldDefs),
			targetKey:      bag.targetKey,
			targetValues:   cloneFloatMap(bag.targetValues),
			targetExpireAt: cloneInt64Map(bag.targetExpireAt),
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
			state:          map[string]float64{},
			expireAt:       map[string]int64{},
			fieldDefs:      map[string]providerStateFieldDef{},
			targetValues:   map[string]float64{},
			targetExpireAt: map[string]int64{},
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

// bindFieldDefs attaches compiled field definitions once and seeds missing provider-scope
// keys with defaultValue. provider_target keys are seeded lazily on activate/write/read of
// that specific key so provider-scope fields do not leak into targetState snapshots.
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

// seedTargetValueIfAbsent writes field defaultValue for one provider_target key when absent.
func (b *providerStateBag) seedTargetValueIfAbsent(key string) {
	if b == nil || key == "" {
		return
	}
	b.ensure()
	if _, ok := b.targetValues[key]; ok {
		return
	}
	if def, ok := b.fieldDefs[key]; ok {
		b.targetValues[key] = def.defaultValue
	}
}

// readTargetValue returns the active provider_target value, observing defaultValue when the
// key has not been written yet (without inserting unrelated fieldDefs into targetValues).
func (b *providerStateBag) readTargetValue(key string) float64 {
	if b == nil {
		return 0
	}
	if v, ok := b.targetValues[key]; ok {
		return v
	}
	if def, ok := b.fieldDefs[key]; ok {
		return def.defaultValue
	}
	return 0
}

// activateProviderTarget switches or establishes the active provider_target binding.
// Missing per-key defaults are applied on the subsequent read/write of that key.
func (b *providerStateBag) activateProviderTarget(targetKey string) {
	if b == nil || targetKey == "" {
		return
	}
	b.ensure()
	if b.targetKey != "" && b.targetKey != targetKey {
		b.clearProviderTargetState()
	}
	b.targetKey = targetKey
}

// targetStateForFormula returns only provider_target keys already seeded/written in
// targetValues. Unrelated fieldDefs (including provider-scope defaults) must not appear
// in the formula overlay — first-touch defaults are applied via seedTargetValueIfAbsent
// on the specific key, not by bulk-filling fieldDefs here.
func (b *providerStateBag) targetStateForFormula() map[string]float64 {
	if b == nil {
		return map[string]float64{}
	}
	return cloneFloatMap(b.targetValues)
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

// lazyExpireProviderTargetState resets expired provider_target keys to defaultValue.
func (b *providerStateBag) lazyExpireProviderTargetState(nowMs int64) {
	if b == nil || len(b.fieldDefs) == 0 {
		return
	}
	b.ensure()
	for key, def := range b.fieldDefs {
		if def.durationMs <= 0 {
			continue
		}
		exp, ok := b.targetExpireAt[key]
		if !ok || exp <= 0 {
			continue
		}
		if nowMs >= exp {
			b.targetValues[key] = def.defaultValue
			b.targetExpireAt[key] = 0
		}
	}
}

// clearProviderTargetState drops active target binding (values + timers) on target switch.
func (b *providerStateBag) clearProviderTargetState() {
	if b == nil {
		return
	}
	b.targetKey = ""
	b.targetValues = map[string]float64{}
	b.targetExpireAt = map[string]int64{}
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

// refreshTargetExpireAtOnWrite refreshes provider_target duration on every qualifying write,
// including cap-clamped writes that leave the numeric value unchanged.
func (b *providerStateBag) refreshTargetExpireAtOnWrite(key string, nowMs int64) int64 {
	if b == nil {
		return 0
	}
	def, ok := b.fieldDefs[key]
	if !ok || def.durationMs <= 0 {
		return 0
	}
	if def.refreshPolicy != model.ProviderStateRefreshOnWrite {
		return 0
	}
	b.ensure()
	exp := nowMs + def.durationMs
	b.targetExpireAt[key] = exp
	return exp
}

// subtractProviderExpireAt shortens a provider-scope timer without mutating state value or
// refreshing durationMs. Inactive timers (missing/<=0) are a no-op. Returns:
//
//	applied — whether an active timer was adjusted
//	expired — whether the new expiry reached nowMs (caller must restore defaultValue)
//	newExp  — resulting expireAt (0 when expired or inactive)
func (b *providerStateBag) subtractProviderExpireAt(key string, nowMs, deltaMs int64) (applied, expired bool, newExp int64) {
	if b == nil || key == "" || deltaMs < 0 {
		return false, false, 0
	}
	b.ensure()
	old, ok := b.expireAt[key]
	if !ok || old <= 0 {
		return false, false, 0
	}
	next := old - deltaMs
	if next < nowMs {
		next = nowMs
	}
	if next <= nowMs {
		b.expireAt[key] = 0
		return true, true, 0
	}
	b.expireAt[key] = next
	return true, false, next
}

// subtractTargetExpireAt is the provider_target counterpart of subtractProviderExpireAt.
func (b *providerStateBag) subtractTargetExpireAt(key string, nowMs, deltaMs int64) (applied, expired bool, newExp int64) {
	if b == nil || key == "" || deltaMs < 0 {
		return false, false, 0
	}
	b.ensure()
	old, ok := b.targetExpireAt[key]
	if !ok || old <= 0 {
		return false, false, 0
	}
	next := old - deltaMs
	if next < nowMs {
		next = nowMs
	}
	if next <= nowMs {
		b.targetExpireAt[key] = 0
		return true, true, 0
	}
	b.targetExpireAt[key] = next
	return true, false, next
}
