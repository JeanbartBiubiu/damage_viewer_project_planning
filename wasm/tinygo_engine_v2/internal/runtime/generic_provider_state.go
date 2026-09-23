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
//	  "expireAt": { "<key>": <int64> },
//	  "targetState": { "target": "<combatantKey>", "values": { "<key>": <number> }, "expireAt": { "<key>": <int64> } }
//	}
//
// targetState is single-active-target: writing a key for a new target clears prior target values
// and per-key targetExpireAt timers. Timed metadata is part of the snapshot contract.
// Field schema (defaultValue/maxValue/durationMs/refresh_on_write|start_on_first_write)
// applies to both provider-scope and provider_target writes.
type providerStateBag struct {
	state          map[string]float64
	expireAt       map[string]int64
	fieldDefs      map[string]providerStateFieldDef
	targetKey      string
	targetValues   map[string]float64
	targetExpireAt map[string]int64
	// anchoredTickGeneration 按 anchorStateKey 记录当前调度世代；target 切换时清空。
	anchoredTickGeneration map[string]uint64
	// inclusiveAtExpiry*：仅在锚定 tick 帧内、now==expireAt 时抑制该 key 的惰性过期。
	inclusiveAtExpiryKey    string
	inclusiveAtExpiryTarget string
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
	if b.anchoredTickGeneration == nil {
		b.anchoredTickGeneration = map[string]uint64{}
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
				state:                  map[string]float64{},
				expireAt:               map[string]int64{},
				fieldDefs:              map[string]providerStateFieldDef{},
				targetValues:           map[string]float64{},
				targetExpireAt:         map[string]int64{},
				anchoredTickGeneration: map[string]uint64{},
			}
			continue
		}
		out[k] = &providerStateBag{
			state:                   cloneFloatMap(bag.state),
			expireAt:                cloneInt64Map(bag.expireAt),
			fieldDefs:               cloneFieldDefMap(bag.fieldDefs),
			targetKey:               bag.targetKey,
			targetValues:            cloneFloatMap(bag.targetValues),
			targetExpireAt:          cloneInt64Map(bag.targetExpireAt),
			anchoredTickGeneration:  cloneUint64Map(bag.anchoredTickGeneration),
			inclusiveAtExpiryKey:    bag.inclusiveAtExpiryKey,
			inclusiveAtExpiryTarget: bag.inclusiveAtExpiryTarget,
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

func cloneUint64Map(src map[string]uint64) map[string]uint64 {
	if len(src) == 0 {
		return map[string]uint64{}
	}
	out := make(map[string]uint64, len(src))
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
		if expObj, ok := obj["expireAt"].(map[string]interface{}); ok {
			for k, v := range expObj {
				if n, ok := asInt64Strict(v); ok {
					bag.expireAt[k] = n
				} else {
					bag.expireAt[k] = math.MinInt64
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
			if expObj, ok := tsObj["expireAt"].(map[string]interface{}); ok {
				for k, v := range expObj {
					if n, ok := asInt64Strict(v); ok {
						bag.targetExpireAt[k] = n
					} else {
						bag.targetExpireAt[k] = math.MinInt64
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
		expireObj := map[string]interface{}{}
		for k, v := range bag.expireAt {
			if v > 0 {
				expireObj[k] = float64(v)
			}
		}
		entry := map[string]interface{}{
			"state":    stateObj,
			"expireAt": expireObj,
		}
		if bag.targetKey != "" || len(bag.targetValues) > 0 {
			valuesObj := map[string]interface{}{}
			for k, v := range bag.targetValues {
				valuesObj[k] = v
			}
			targetExpire := map[string]interface{}{}
			for k, v := range bag.targetExpireAt {
				if v > 0 {
					targetExpire[k] = float64(v)
				}
			}
			entry["targetState"] = map[string]interface{}{
				"target":   bag.targetKey,
				"values":   valuesObj,
				"expireAt": targetExpire,
			}
		}
		out[providerRef] = entry
	}
	return out
}

func asInt64Strict(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) {
			return 0, false
		}
		return int64(n), true
	case int:
		return int64(n), true
	case int64:
		return n, true
	case int32:
		return int64(n), true
	default:
		return 0, false
	}
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

func (b *providerStateBag) defaultsForFormula() map[string]float64 {
	if b == nil || len(b.fieldDefs) == 0 {
		return nil
	}
	defaults := make(map[string]float64, len(b.fieldDefs))
	for key, field := range b.fieldDefs {
		defaults[key] = field.defaultValue
	}
	return defaults
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
// Global semantics remain nowMs >= expireAt. A bag-local inclusive-at-expiry hold may
// suppress exactly one owner/provider/target/anchor key while nowMs == expireAt.
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
			if b.holdsInclusiveAtExpiry(key, nowMs, exp) {
				continue
			}
			b.targetValues[key] = def.defaultValue
			b.targetExpireAt[key] = 0
		}
	}
}

func (b *providerStateBag) holdsInclusiveAtExpiry(key string, nowMs, exp int64) bool {
	if b == nil || b.inclusiveAtExpiryKey == "" {
		return false
	}
	if b.inclusiveAtExpiryKey != key {
		return false
	}
	if b.inclusiveAtExpiryTarget == "" || b.targetKey != b.inclusiveAtExpiryTarget {
		return false
	}
	return nowMs == exp
}

func (b *providerStateBag) setInclusiveAtExpiryHold(targetKey, anchorKey string) {
	if b == nil {
		return
	}
	b.ensure()
	b.inclusiveAtExpiryTarget = targetKey
	b.inclusiveAtExpiryKey = anchorKey
}

func (b *providerStateBag) clearInclusiveAtExpiryHold() {
	if b == nil {
		return
	}
	b.inclusiveAtExpiryKey = ""
	b.inclusiveAtExpiryTarget = ""
}

// bumpAnchoredTickGeneration advances the generation token for one anchor key.
func (b *providerStateBag) bumpAnchoredTickGeneration(anchorKey string) uint64 {
	if b == nil || anchorKey == "" {
		return 0
	}
	b.ensure()
	b.anchoredTickGeneration[anchorKey]++
	return b.anchoredTickGeneration[anchorKey]
}

func (b *providerStateBag) currentAnchoredTickGeneration(anchorKey string) uint64 {
	if b == nil || anchorKey == "" || b.anchoredTickGeneration == nil {
		return 0
	}
	return b.anchoredTickGeneration[anchorKey]
}

// clearProviderTargetState drops active target binding (values + timers) on target switch.
func (b *providerStateBag) clearProviderTargetState() {
	if b == nil {
		return
	}
	b.targetKey = ""
	b.targetValues = map[string]float64{}
	b.targetExpireAt = map[string]int64{}
	b.anchoredTickGeneration = map[string]uint64{}
	b.clearInclusiveAtExpiryHold()
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

func (b *providerStateBag) refreshExpireAtOnWrite(key string, nowMs int64) bool {
	if b == nil {
		return true
	}
	def, ok := b.fieldDefs[key]
	if !ok || def.durationMs <= 0 {
		return true
	}
	b.ensure()
	switch def.refreshPolicy {
	case model.ProviderStateRefreshOnWrite:
		exp, ok := addDuration(nowMs, def.durationMs)
		if !ok {
			return false
		}
		b.expireAt[key] = exp
		return true
	case model.ProviderStateRefreshStartOnFirstWrite:
		return b.applyStartOnFirstWrite(key, nowMs, b.state[key], def, false)
	default:
		return true
	}
}

func (b *providerStateBag) refreshTargetExpireAtOnWrite(key string, nowMs int64) (int64, bool) {
	if b == nil {
		return 0, true
	}
	def, ok := b.fieldDefs[key]
	if !ok || def.durationMs <= 0 {
		return 0, true
	}
	b.ensure()
	switch def.refreshPolicy {
	case model.ProviderStateRefreshOnWrite:
		exp, ok := addDuration(nowMs, def.durationMs)
		if !ok {
			return 0, false
		}
		b.targetExpireAt[key] = exp
		return exp, true
	case model.ProviderStateRefreshStartOnFirstWrite:
		if !b.applyStartOnFirstWrite(key, nowMs, b.targetValues[key], def, true) {
			return 0, false
		}
		return b.targetExpireAt[key], true
	default:
		return 0, true
	}
}

func (b *providerStateBag) applyStartOnFirstWrite(key string, nowMs int64, next float64, def providerStateFieldDef, target bool) bool {
	expire := b.expireAt
	if target {
		expire = b.targetExpireAt
	}
	if next == def.defaultValue {
		expire[key] = 0
		return true
	}
	current := expire[key]
	if current > nowMs {
		return true
	}
	exp, ok := addDuration(nowMs, def.durationMs)
	if !ok {
		return false
	}
	expire[key] = exp
	return true
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

func (s *genericRunState) restoreProviderStateTimers(snapshot model.Snapshot) *model.EngineError {
	combatantKeys := map[string]bool{}
	for _, c := range snapshot.Combatants {
		combatantKeys[c.Key] = true
	}
	for i, snap := range snapshot.Combatants {
		rt, ok := s.combatants[snap.Key]
		if !ok {
			continue
		}
		base := "initialSnapshot.combatants[" + itoa(uint32(i)) + "].providerState"
		if err := s.validateRawProviderState(snap.ProviderState, rt, base); err != nil {
			return err
		}
		for providerRef, bag := range rt.providerState {
			if bag == nil {
				continue
			}
			defs := s.resolveProviderStateFieldDefs(snap.Key, providerRef, rt.providers)
			if defs == nil {
				continue
			}
			bag.bindFieldDefs(defs)
			path := base + "[" + providerRef + "]"
			if err := restoreBagTimers(bag, snapshot.TimeMs, combatantKeys, path, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID); err != nil {
				return err
			}
		}
		s.combatants[snap.Key] = rt
	}
	return nil
}

func restoreBagTimers(bag *providerStateBag, snapshotTime int64, combatantKeys map[string]bool, path, schemaHash, rulesHash, sessionID string) *model.EngineError {
	if bag == nil {
		return nil
	}
	bag.ensure()
	if bag.targetKey != "" && !combatantKeys[bag.targetKey] {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "providerState target is unknown", path+".targetState.target", bag.targetKey, schemaHash, rulesHash, sessionID)
	}
	for key, value := range bag.state {
		def, ok := bag.fieldDefs[key]
		if !ok {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown providerState key", path+".state."+key, key, schemaHash, rulesHash, sessionID)
		}
		if !finiteState(value) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "providerState value must be finite", path+".state."+key, key, schemaHash, rulesHash, sessionID)
		}
		if def.hasCap && value > def.maxValue {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "providerState value exceeds maxValue", path+".state."+key, key, schemaHash, rulesHash, sessionID)
		}
		exp, hasExp := bag.expireAt[key]
		if hasExp && exp == math.MinInt64 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "providerState expireAt must be a finite integer", path+".expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		if err := restoreTimedValue(&bag.state, bag.expireAt, key, def, snapshotTime, path, schemaHash, rulesHash, sessionID); err != nil {
			return err
		}
	}
	for key, exp := range bag.expireAt {
		if _, ok := bag.state[key]; ok {
			continue
		}
		if _, ok := bag.fieldDefs[key]; !ok {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown providerState expireAt key", path+".expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		if exp == math.MinInt64 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "providerState expireAt must be a finite integer", path+".expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		if exp > 0 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "default providerState cannot carry a positive expireAt", path+".expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
	}
	for key, value := range bag.targetValues {
		def, ok := bag.fieldDefs[key]
		if !ok {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider targetState key", path+".targetState.values."+key, key, schemaHash, rulesHash, sessionID)
		}
		if !finiteState(value) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "provider targetState value must be finite", path+".targetState.values."+key, key, schemaHash, rulesHash, sessionID)
		}
		if def.hasCap && value > def.maxValue {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "provider targetState value exceeds maxValue", path+".targetState.values."+key, key, schemaHash, rulesHash, sessionID)
		}
		if exp, hasExp := bag.targetExpireAt[key]; hasExp && exp == math.MinInt64 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "provider targetState expireAt must be a finite integer", path+".targetState.expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		if err := restoreTimedValue(&bag.targetValues, bag.targetExpireAt, key, def, snapshotTime, path+".targetState", schemaHash, rulesHash, sessionID); err != nil {
			return err
		}
	}
	for key, exp := range bag.targetExpireAt {
		if _, ok := bag.targetValues[key]; ok {
			continue
		}
		if _, ok := bag.fieldDefs[key]; !ok {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider targetState expireAt key", path+".targetState.expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		if exp == math.MinInt64 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "provider targetState expireAt must be a finite integer", path+".targetState.expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		if exp > 0 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "default provider targetState cannot carry a positive expireAt", path+".targetState.expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
	}
	return nil
}

func restoreTimedValue(values *map[string]float64, expire map[string]int64, key string, def providerStateFieldDef, snapshotTime int64, path, schemaHash, rulesHash, sessionID string) *model.EngineError {
	value := (*values)[key]
	exp, hasExp := expire[key]
	if def.durationMs <= 0 {
		if hasExp && exp > 0 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "untimed providerState cannot carry expireAt", path+".expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		return nil
	}
	if value == def.defaultValue {
		if hasExp && exp > 0 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "default providerState cannot carry a positive expireAt", path+".expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		expire[key] = 0
		return nil
	}
	if !hasExp || exp <= 0 {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "timed non-default providerState requires expireAt", path+".expireAt."+key, key, schemaHash, rulesHash, sessionID)
	}
	if exp <= snapshotTime {
		(*values)[key] = def.defaultValue
		expire[key] = 0
		return nil
	}
	return nil
}
