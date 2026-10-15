package runtime

import (
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

const (
	stateScopeProvider       = "state_scope/provider"
	stateScopeProviderTarget = "state_scope/provider_target"
)

// providerStateFieldDef is the runtime copy of compiled provider-scope field metadata (Gate H1).
type providerStateFieldDef struct {
	stateKind     string
	valueType     string
	defaultValue  float64
	maxValue      float64
	hasCap        bool
	durationMs    int64
	refreshPolicy string
}

// 字段表建立后只读，冷却标记与该份定义一起传递。
type providerStateFieldMetadata struct {
	fields               map[string]providerStateFieldDef
	hasInternalCooldowns bool
}

func newProviderStateFieldMetadata(fields map[string]providerStateFieldDef) *providerStateFieldMetadata {
	metadata := &providerStateFieldMetadata{fields: fields}
	for _, field := range fields {
		if field.stateKind == model.ProviderStateKindCooldown {
			metadata.hasInternalCooldowns = true
			break
		}
	}
	return metadata
}

func (m *providerStateFieldMetadata) definitions() map[string]providerStateFieldDef {
	if m == nil {
		return nil
	}
	return m.fields
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
	headerShared                 bool
	state                        map[string]float64
	expireAt                     map[string]int64
	stateShared                  bool
	expireAtShared               bool
	targetValuesShared           bool
	targetExpireAtShared         bool
	anchoredTickGenerationShared bool
	fieldDefs                    map[string]providerStateFieldDef
	hasInternalCooldowns         bool
	// 字段定义与默认值绑定后只读，暂存副本共享这份元数据。
	fieldDefaults map[string]float64
	// CD的数值只是公式只读投影；实际期限与版本全部属于共同账本。
	cooldownProjectionVersion uint64
	cooldownProjectionAt      int64
	cooldownProjectionBound   bool
	targetKey                 string
	targetValues              map[string]float64
	targetExpireAt            map[string]int64
	// anchoredTickGeneration 按 anchorStateKey 记录当前调度世代；target 切换时清空。
	anchoredTickGeneration map[string]uint64
	// inclusiveAtExpiry*：仅在锚定 tick 帧内、now==expireAt 时抑制该 key 的惰性过期。
	inclusiveAtExpiryKey    string
	inclusiveAtExpiryTarget string
}

func (b *providerStateBag) ensure() {
	if b.state == nil {
		b.state = map[string]float64{}
		b.stateShared = false
	}
	if b.expireAt == nil {
		b.expireAt = map[string]int64{}
		b.expireAtShared = false
	}
	if b.fieldDefs == nil {
		b.fieldDefs = map[string]providerStateFieldDef{}
	}
	if b.targetValues == nil {
		b.targetValues = map[string]float64{}
		b.targetValuesShared = false
	}
	if b.targetExpireAt == nil {
		b.targetExpireAt = map[string]int64{}
		b.targetExpireAtShared = false
	}
	if b.anchoredTickGeneration == nil {
		b.anchoredTickGeneration = map[string]uint64{}
		b.anchoredTickGenerationShared = false
	}
}

func (b *providerStateBag) writableState() map[string]float64 {
	if b.stateShared {
		b.state = cloneFloatMap(b.state)
		b.stateShared = false
	} else if b.state == nil {
		b.state = map[string]float64{}
	}
	return b.state
}

func (b *providerStateBag) writableExpireAt() map[string]int64 {
	if b.expireAtShared {
		b.expireAt = cloneInt64Map(b.expireAt)
		b.expireAtShared = false
	} else if b.expireAt == nil {
		b.expireAt = map[string]int64{}
	}
	return b.expireAt
}

func (b *providerStateBag) writableTargetValues() map[string]float64 {
	if b.targetValuesShared {
		b.targetValues = cloneFloatMap(b.targetValues)
		b.targetValuesShared = false
	} else if b.targetValues == nil {
		b.targetValues = map[string]float64{}
	}
	return b.targetValues
}

func (b *providerStateBag) writableTargetExpireAt() map[string]int64 {
	if b.targetExpireAtShared {
		b.targetExpireAt = cloneInt64Map(b.targetExpireAt)
		b.targetExpireAtShared = false
	} else if b.targetExpireAt == nil {
		b.targetExpireAt = map[string]int64{}
	}
	return b.targetExpireAt
}

func (b *providerStateBag) writableAnchoredTickGeneration() map[string]uint64 {
	if b.anchoredTickGenerationShared {
		b.anchoredTickGeneration = cloneUint64Map(b.anchoredTickGeneration)
		b.anchoredTickGenerationShared = false
	} else if b.anchoredTickGeneration == nil {
		b.anchoredTickGeneration = map[string]uint64{}
	}
	return b.anchoredTickGeneration
}

func cloneProviderStateMap(src map[string]*providerStateBag) map[string]*providerStateBag {
	if len(src) == 0 {
		return map[string]*providerStateBag{}
	}
	out := make(map[string]*providerStateBag, len(src))
	// 包头一次连续分配；每个条目仍使用独立头，不共享可变标量。
	copyHeads := make([]providerStateBag, len(src))
	headIndex := 0
	for k, bag := range src {
		copied := &copyHeads[headIndex]
		headIndex++
		if bag == nil {
			*copied = providerStateBag{
				state:                  map[string]float64{},
				expireAt:               map[string]int64{},
				fieldDefs:              map[string]providerStateFieldDef{},
				targetValues:           map[string]float64{},
				targetExpireAt:         map[string]int64{},
				anchoredTickGeneration: map[string]uint64{},
			}
			out[k] = copied
			continue
		}
		// 包头独立，内部数值表共享；双方下一次写入都必须先取得独占表。
		bag.stateShared, bag.expireAtShared = true, true
		bag.targetValuesShared, bag.targetExpireAtShared = true, true
		bag.anchoredTickGenerationShared = true
		*copied = *bag
		copied.headerShared = false
		out[k] = copied
	}
	return out
}

// shareProviderStateMap 复制外层字典，冻结包头；使用包之前由所属字典取得独占头。
func shareProviderStateMap(src map[string]*providerStateBag) map[string]*providerStateBag {
	out := make(map[string]*providerStateBag, len(src))
	for key, bag := range src {
		if bag == nil {
			// 保持帧暂存时空包归一化的既有行为，不改写来源的nil条目。
			out[key] = &providerStateBag{
				state:                  map[string]float64{},
				expireAt:               map[string]int64{},
				fieldDefs:              map[string]providerStateFieldDef{},
				targetValues:           map[string]float64{},
				targetExpireAt:         map[string]int64{},
				anchoredTickGeneration: map[string]uint64{},
			}
			continue
		}
		bag.headerShared = true
		bag.stateShared, bag.expireAtShared = true, true
		bag.targetValuesShared, bag.targetExpireAtShared = true, true
		bag.anchoredTickGenerationShared = true
		out[key] = bag
	}
	return out
}

// freezeProviderStateView发布只读外层表；含nil条目时沿原规则独立归一化。
func freezeProviderStateView(src map[string]*providerStateBag) map[string]*providerStateBag {
	for _, bag := range src {
		if bag == nil {
			src = shareProviderStateMap(src)
			break
		}
	}
	for _, bag := range src {
		bag.headerShared = true
		bag.stateShared, bag.expireAtShared = true, true
		bag.targetValuesShared, bag.targetExpireAtShared = true, true
		bag.anchoredTickGenerationShared = true
	}
	return src
}

func writableProviderStateMap(bags *map[string]*providerStateBag, shared *bool) map[string]*providerStateBag {
	if *shared || *bags == nil {
		out := make(map[string]*providerStateBag, len(*bags))
		for key, bag := range *bags {
			out[key] = bag
		}
		*bags, *shared = out, false
	}
	return *bags
}

func (s *stagedCombatant) writableProviderStates() map[string]*providerStateBag {
	return writableProviderStateMap(&s.providerState, &s.providerStateShared)
}

func (s *stagedCombatant) readonlyProviderStates() map[string]*providerStateBag {
	if !s.providerStateShared {
		s.providerState = freezeProviderStateView(s.providerState)
		s.providerStateShared = true
	}
	return s.providerState
}

func (c *combatantRuntime) writableProviderStates() map[string]*providerStateBag {
	return writableProviderStateMap(&c.providerState, &c.providerStateShared)
}

func readSharedProviderStateBag(bags *map[string]*providerStateBag, shared *bool, providerRef string, create bool, fields *providerStateFieldMetadata, nowMs int64, options providerStateReadOptions) *providerStateBag {
	bag := (*bags)[providerRef]
	if bag != nil && bag.headerShared && !bag.needsReadPreparation(fields, nowMs, options) {
		return bag
	}
	if bag == nil && !create {
		return nil
	}
	return readProviderStateBag(writableProviderStateMap(bags, shared), providerRef, create, fields, nowMs, options)
}

// writableProviderStateBag 只复制实际使用的共享包头；五张表继续各自按写入复制。
// bags必须由调用方独占；创建包前由调用方初始化外层字典。缺包且create=false不插入。
// 包指针只在本次访问期间可写，发布或再次共享后必须从所属字典重新取得。
func writableProviderStateBag(bags map[string]*providerStateBag, providerRef string, create bool) *providerStateBag {
	if bags == nil {
		return nil
	}
	bag := bags[providerRef]
	if bag == nil {
		if !create {
			return nil
		}
		bag = &providerStateBag{
			state:                  map[string]float64{},
			expireAt:               map[string]int64{},
			fieldDefs:              map[string]providerStateFieldDef{},
			targetValues:           map[string]float64{},
			targetExpireAt:         map[string]int64{},
			anchoredTickGeneration: map[string]uint64{},
		}
		bags[providerRef] = bag
		return bag
	}
	if !bag.headerShared {
		return bag
	}
	copied := *bag
	copied.headerShared = false
	copied.stateShared, copied.expireAtShared = true, true
	copied.targetValuesShared, copied.targetExpireAtShared = true, true
	copied.anchoredTickGenerationShared = true
	bag = &copied
	bags[providerRef] = bag
	return bag
}

type providerStateReadOptions struct {
	cooldowns    *genericCooldownLedger
	ownerKey     string
	expireTarget bool
	defaults     bool
	targetView   bool
	targetKey    string
}

// readProviderStateBag 仅供公式借用；准备已完成的共享头不复制，真正需要准备时才取得独占头。
// 返回的包及数值表只读，不能用于state_change、期限写入、目标切换或锚定周期写入。
// bags必须由调用方独占；create=true时须先初始化外层字典。
func readProviderStateBag(bags map[string]*providerStateBag, providerRef string, create bool, fields *providerStateFieldMetadata, nowMs int64, options providerStateReadOptions) *providerStateBag {
	bag := bags[providerRef]
	if bag != nil && bag.headerShared && !bag.needsReadPreparation(fields, nowMs, options) {
		return bag
	}
	bag = writableProviderStateBag(bags, providerRef, create)
	if bag == nil {
		return nil
	}
	bag.bindFieldDefs(fields)
	bag.projectInternalCooldowns(options.cooldowns, options.ownerKey, providerRef, nowMs)
	bag.lazyExpireProviderState(nowMs)
	if options.expireTarget {
		bag.lazyExpireProviderTargetState(nowMs)
	}
	if options.defaults {
		bag.defaultsForFormula()
	}
	if options.targetView && bag.targetKey == options.targetKey {
		bag.targetStateForFormula()
	}
	return bag
}

func (b *providerStateBag) needsReadPreparation(fields *providerStateFieldMetadata, nowMs int64, options providerStateReadOptions) bool {
	bind := len(fields.definitions()) > 0
	if bind && len(b.fieldDefs) == 0 {
		return true
	}
	hasCooldowns := b.hasInternalCooldowns
	if bind {
		hasCooldowns = fields.hasInternalCooldowns
	}
	if options.cooldowns != nil && hasCooldowns && (!b.cooldownProjectionBound || b.cooldownProjectionVersion != options.cooldowns.revision || b.cooldownProjectionAt != nowMs) {
		return true
	}
	if options.defaults && len(b.fieldDefs) > 0 && b.fieldDefaults == nil {
		return true
	}
	if options.targetView && b.targetKey == options.targetKey && (b.targetValues == nil || !b.targetValuesShared) {
		return true
	}
	if len(b.fieldDefs) == 0 {
		return false
	}
	// bind与source惰性过期都沿原ensure初始化全部表；不额外填入未声明的数值键。
	if b.state == nil || b.expireAt == nil || b.targetValues == nil || b.targetExpireAt == nil || b.anchoredTickGeneration == nil {
		return true
	}
	for key, def := range b.fieldDefs {
		if bind {
			if _, exists := b.state[key]; !exists {
				return true
			}
		}
		if def.stateKind == model.ProviderStateKindCooldown || def.durationMs <= 0 {
			continue
		}
		if expires := b.expireAt[key]; expires > 0 && nowMs >= expires {
			return true
		}
		if options.expireTarget {
			if expires := b.targetExpireAt[key]; expires > 0 && nowMs >= expires && !b.holdsInclusiveAtExpiry(key, nowMs, expires) {
				return true
			}
		}
	}
	return false
}

// needsLazyExpiration 仅判断既有两类惰性过期是否会写包，不绑定字段或填默认值。
func (b *providerStateBag) needsLazyExpiration(nowMs int64) bool {
	if b == nil || len(b.fieldDefs) == 0 {
		return false
	}
	if b.state == nil || b.expireAt == nil || b.targetValues == nil || b.targetExpireAt == nil || b.anchoredTickGeneration == nil {
		return true
	}
	for key, def := range b.fieldDefs {
		if def.stateKind == model.ProviderStateKindCooldown || def.durationMs <= 0 {
			continue
		}
		if expires := b.expireAt[key]; expires > 0 && nowMs >= expires {
			return true
		}
		if expires := b.targetExpireAt[key]; expires > 0 && nowMs >= expires && !b.holdsInclusiveAtExpiry(key, nowMs, expires) {
			return true
		}
	}
	return false
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

func providerStateToSnapshot(bags map[string]*providerStateBag, cooldowns *genericCooldownLedger, owner string, now int64) map[string]interface{} {
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
		for key, def := range bag.fieldDefs {
			if def.stateKind == model.ProviderStateKindCooldown {
				stateObj[key] = internalCooldownValue(cooldowns, genericStateCooldownIdentity(owner, providerRef, key, stateScopeProvider, ""), now)
			}
		}
		expireObj := map[string]interface{}{}
		for k, v := range bag.expireAt {
			if v > 0 && bag.fieldDefs[k].stateKind != model.ProviderStateKindCooldown {
				expireObj[k] = float64(v)
			}
		}
		projectInternalCooldownExpiries(expireObj, cooldowns, owner, providerRef, "", stateScopeProvider, now)
		entry := map[string]interface{}{
			"state":    stateObj,
			"expireAt": expireObj,
		}
		if bag.targetKey != "" || len(bag.targetValues) > 0 {
			valuesObj := map[string]interface{}{}
			for k, v := range bag.targetValues {
				valuesObj[k] = v
			}
			if cooldowns != nil {
				for _, slot := range cooldowns.entries {
					id := slot.id
					if id.owner == owner && id.providerRef == providerRef && id.scope == stateScopeProviderTarget && id.target == bag.targetKey {
						valuesObj[id.stateKey] = internalCooldownValue(cooldowns, id, now)
					}
				}
			}
			targetExpire := map[string]interface{}{}
			for k, v := range bag.targetExpireAt {
				if v > 0 && bag.fieldDefs[k].stateKind != model.ProviderStateKindCooldown {
					targetExpire[k] = float64(v)
				}
			}
			projectInternalCooldownExpiries(targetExpire, cooldowns, owner, providerRef, bag.targetKey, stateScopeProviderTarget, now)
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

func compiledStateFieldsToRuntime(fields map[string]planbundle.CompiledProviderStateField) *providerStateFieldMetadata {
	metadata := &providerStateFieldMetadata{fields: make(map[string]providerStateFieldDef, len(fields))}
	for k, f := range fields {
		metadata.fields[k] = providerStateFieldDef{
			stateKind:     f.StateKind,
			valueType:     f.ValueType,
			defaultValue:  f.DefaultValue,
			maxValue:      f.MaxValue,
			hasCap:        f.HasCap,
			durationMs:    f.DurationMs,
			refreshPolicy: f.RefreshPolicy,
		}
		if f.StateKind == model.ProviderStateKindCooldown {
			metadata.hasInternalCooldowns = true
		}
	}
	return metadata
}

// bindFieldDefs attaches compiled field definitions once and seeds missing provider-scope
// keys with defaultValue. provider_target keys are seeded lazily on activate/write/read of
// that specific key so provider-scope fields do not leak into targetState snapshots.
func (b *providerStateBag) bindFieldDefs(fields *providerStateFieldMetadata) {
	if b == nil || len(fields.definitions()) == 0 {
		return
	}
	b.ensure()
	if len(b.fieldDefs) == 0 {
		b.fieldDefs = cloneFieldDefMap(fields.fields)
		b.hasInternalCooldowns = fields.hasInternalCooldowns
		b.fieldDefaults = nil
	}
	for k, def := range b.fieldDefs {
		if _, ok := b.state[k]; !ok {
			b.writableState()[k] = def.defaultValue
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
		b.writableTargetValues()[key] = def.defaultValue
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
	if b.targetValues == nil {
		b.targetValues = map[string]float64{}
	}
	// 公式只能读取；后续写入另建表，保留本次公式视图。
	b.targetValuesShared = true
	return b.targetValues
}

func (b *providerStateBag) defaultsForFormula() map[string]float64 {
	if b == nil || len(b.fieldDefs) == 0 {
		return nil
	}
	if b.fieldDefaults != nil {
		return b.fieldDefaults
	}
	defaults := make(map[string]float64, len(b.fieldDefs))
	for key, field := range b.fieldDefs {
		defaults[key] = field.defaultValue
	}
	b.fieldDefaults = defaults
	return defaults
}

// lazyExpireProviderState resets expired provider-scope keys to defaultValue (Gate H1).
func (b *providerStateBag) lazyExpireProviderState(nowMs int64) {
	if b == nil || len(b.fieldDefs) == 0 {
		return
	}
	b.ensure()
	for key, def := range b.fieldDefs {
		if def.stateKind == model.ProviderStateKindCooldown || def.durationMs <= 0 {
			continue
		}
		exp, ok := b.expireAt[key]
		if !ok || exp <= 0 {
			continue
		}
		if nowMs >= exp {
			b.writableState()[key] = def.defaultValue
			b.writableExpireAt()[key] = 0
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
		if def.stateKind == model.ProviderStateKindCooldown || def.durationMs <= 0 {
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
			b.writableTargetValues()[key] = def.defaultValue
			b.writableTargetExpireAt()[key] = 0
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
	b.writableAnchoredTickGeneration()[anchorKey]++
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
	b.targetValuesShared = false
	b.targetExpireAt = map[string]int64{}
	b.targetExpireAtShared = false
	b.anchoredTickGeneration = map[string]uint64{}
	b.anchoredTickGenerationShared = false
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

func validStateInteger(value float64) bool {
	return finiteState(value) && math.Trunc(value) == value && math.Abs(value) <= float64(maxJSONSafeInteger)
}

func (b *providerStateBag) nextStateValue(key string, current, amount float64, policy string) (float64, string) {
	integer := b.fieldDefs[key].valueType == model.ProviderStateValueInteger
	if integer {
		if !validStateInteger(current) || current < 0 || !validStateInteger(amount) {
			return 0, "integer state requires a non-negative safe current value and a safe integer operand"
		}
		if (policy == "set" || policy == "override") && amount < 0 {
			return 0, "integer state cannot be assigned a negative value"
		}
		if (policy == "add" || policy == "") && amount > 0 && current > float64(maxJSONSafeInteger)-amount {
			return 0, "integer state addition exceeds the safe integer range"
		}
	}
	next, supported := applyStatePolicy(current, amount, policy)
	if !supported {
		return 0, "unsupported state_change valuePolicy"
	}
	if !finiteState(next) {
		return 0, "non-finite state result"
	}
	if integer && (!validStateInteger(next) || next < 0) {
		return 0, "integer state result must be a non-negative safe integer"
	}
	return b.clampProviderStateValue(key, next), ""
}

func (b *providerStateBag) refreshExpireAtOnWrite(key string, nowMs int64) bool {
	if b == nil {
		return true
	}
	def, ok := b.fieldDefs[key]
	if def.stateKind == model.ProviderStateKindCooldown {
		return false
	}
	if !ok || def.durationMs <= 0 {
		return true
	}
	b.ensure()
	switch def.refreshPolicy {
	case model.ProviderStateRefreshOnWrite:
		if b.state[key] == def.defaultValue {
			b.writableExpireAt()[key] = 0
			return true
		}
		exp, ok := addDuration(nowMs, def.durationMs)
		if !ok {
			return false
		}
		b.writableExpireAt()[key] = exp
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
	if def.stateKind == model.ProviderStateKindCooldown {
		return 0, false
	}
	if !ok || def.durationMs <= 0 {
		return 0, true
	}
	b.ensure()
	switch def.refreshPolicy {
	case model.ProviderStateRefreshOnWrite:
		if b.targetValues[key] == def.defaultValue {
			b.writableTargetExpireAt()[key] = 0
			return 0, true
		}
		exp, ok := addDuration(nowMs, def.durationMs)
		if !ok {
			return 0, false
		}
		b.writableTargetExpireAt()[key] = exp
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
		if target {
			b.writableTargetExpireAt()[key] = 0
		} else {
			b.writableExpireAt()[key] = 0
		}
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
	if target {
		b.writableTargetExpireAt()[key] = exp
	} else {
		b.writableExpireAt()[key] = exp
	}
	return true
}

// subtractProviderExpireAt shortens a provider-scope timer without mutating state value or
// refreshing durationMs. Inactive timers (missing/<=0) are a no-op. Returns:
//
//	applied — whether an active timer was adjusted
//	expired — whether the new expiry reached nowMs (caller must restore defaultValue)
//	newExp  — resulting expireAt (0 when expired or inactive)
func (b *providerStateBag) subtractProviderExpireAt(key string, nowMs, deltaMs int64) (applied, expired bool, newExp int64) {
	if b == nil || key == "" || deltaMs < 0 || b.fieldDefs[key].stateKind == model.ProviderStateKindCooldown {
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
		b.writableExpireAt()[key] = 0
		return true, true, 0
	}
	b.writableExpireAt()[key] = next
	return true, false, next
}

// subtractTargetExpireAt is the provider_target counterpart of subtractProviderExpireAt.
func (b *providerStateBag) subtractTargetExpireAt(key string, nowMs, deltaMs int64) (applied, expired bool, newExp int64) {
	if b == nil || key == "" || deltaMs < 0 || b.fieldDefs[key].stateKind == model.ProviderStateKindCooldown {
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
		b.writableTargetExpireAt()[key] = 0
		return true, true, 0
	}
	b.writableTargetExpireAt()[key] = next
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
			if rt.cooldowns == nil {
				rt.cooldowns = newGenericCooldownLedger()
			}
			migrateInternalCooldownTimers(bag, rt.cooldowns, snap.Key, providerRef, snapshot.TimeMs)
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
	// 恢复仅用于初始化校验；其中的默认值和期限写入必须使用独占表。
	bag.writableState()
	bag.writableExpireAt()
	bag.writableTargetValues()
	bag.writableTargetExpireAt()
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
		if def.valueType == model.ProviderStateValueInteger && (!validStateInteger(value) || value < 0) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "integer providerState must be a non-negative safe integer", path+".state."+key, key, schemaHash, rulesHash, sessionID)
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
		if def.valueType == model.ProviderStateValueInteger && (!validStateInteger(value) || value < 0) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "integer provider targetState must be a non-negative safe integer", path+".targetState.values."+key, key, schemaHash, rulesHash, sessionID)
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
