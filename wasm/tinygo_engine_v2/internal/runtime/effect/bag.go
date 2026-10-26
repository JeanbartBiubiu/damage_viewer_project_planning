package effect

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

const (
	StateScopeProvider       = "state_scope/provider"
	StateScopeProviderTarget = "state_scope/provider_target"
)

// providerStateFieldDef is the runtime copy of compiled provider-scope field metadata (Gate H1).
type FieldDefinition struct {
	HasOnExpire   bool
	StateKind     string
	ValueType     string
	DefaultValue  float64
	MaxValue      float64
	HasCap        bool
	DurationMs    int64
	RefreshPolicy string
}

// 字段表建立后只读，冷却标记与该份定义一起传递。
type FieldMetadata struct {
	fields               map[string]FieldDefinition
	hasInternalCooldowns bool
}

func NewFields(fields map[string]FieldDefinition) *FieldMetadata {
	metadata := &FieldMetadata{fields: fields}
	for _, field := range fields {
		if field.StateKind == model.ProviderStateKindCooldown {
			metadata.hasInternalCooldowns = true
			break
		}
	}
	return metadata
}

func (m *FieldMetadata) definitions() map[string]FieldDefinition {
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
type bagData struct {
	timing                       *timingState
	timingShared                 bool
	sourceExpiryFacts            map[string]SourceExpiryFact
	sourceExpiryFactsShared      bool
	headerShared                 bool
	state                        map[string]float64
	expireAt                     map[string]int64
	stateShared                  bool
	expireAtShared               bool
	targetValuesShared           bool
	targetExpireAtShared         bool
	anchoredTickGenerationShared bool
	fieldDefs                    map[string]FieldDefinition
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
	// 已有真实终点事件入堆时，仅在now==expireAt抑制该锚字段的惰性过期；
	// 终点成功帧原子清理旧字段及hold，避免同刻其他终点先吞掉待结算状态。
	inclusiveAtExpiryKey    string
	inclusiveAtExpiryTarget string
	inclusiveAtExpiryAt     int64
	inclusiveAtExpiryGen    uint64
}

func (b *bagData) ensure() {
	if b.state == nil {
		b.state = map[string]float64{}
		b.stateShared = false
	}
	if b.expireAt == nil {
		b.expireAt = map[string]int64{}
		b.expireAtShared = false
	}
	if b.fieldDefs == nil {
		b.fieldDefs = map[string]FieldDefinition{}
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

func (b *bagData) writableState() map[string]float64 {
	if b.stateShared {
		b.state = CloneFloatMap(b.state)
		b.stateShared = false
	} else if b.state == nil {
		b.state = map[string]float64{}
	}
	return b.state
}

func (b *bagData) writableExpireAt() map[string]int64 {
	if b.expireAtShared {
		b.expireAt = CloneInt64Map(b.expireAt)
		b.expireAtShared = false
	} else if b.expireAt == nil {
		b.expireAt = map[string]int64{}
	}
	return b.expireAt
}

func (b *bagData) writableTargetValues() map[string]float64 {
	if b.targetValuesShared {
		b.targetValues = CloneFloatMap(b.targetValues)
		b.targetValuesShared = false
	} else if b.targetValues == nil {
		b.targetValues = map[string]float64{}
	}
	return b.targetValues
}

func (b *bagData) writableTargetExpireAt() map[string]int64 {
	if b.targetExpireAtShared {
		b.targetExpireAt = CloneInt64Map(b.targetExpireAt)
		b.targetExpireAtShared = false
	} else if b.targetExpireAt == nil {
		b.targetExpireAt = map[string]int64{}
	}
	return b.targetExpireAt
}

func (b *bagData) writableAnchoredTickGeneration() map[string]uint64 {
	if b.anchoredTickGenerationShared {
		b.anchoredTickGeneration = CloneUint64Map(b.anchoredTickGeneration)
		b.anchoredTickGenerationShared = false
	} else if b.anchoredTickGeneration == nil {
		b.anchoredTickGeneration = map[string]uint64{}
	}
	return b.anchoredTickGeneration
}

func cloneProviderStateMap(src map[string]*bagData) map[string]*bagData {
	if len(src) == 0 {
		return map[string]*bagData{}
	}
	out := make(map[string]*bagData, len(src))

	copyHeads := make([]bagData, len(src))
	headIndex := 0
	for k, bag := range src {
		copied := &copyHeads[headIndex]
		headIndex++
		if bag == nil {
			*copied = bagData{
				state:                  map[string]float64{},
				expireAt:               map[string]int64{},
				fieldDefs:              map[string]FieldDefinition{},
				targetValues:           map[string]float64{},
				targetExpireAt:         map[string]int64{},
				anchoredTickGeneration: map[string]uint64{},
			}
			out[k] = copied
			continue
		}

		bag.stateShared, bag.expireAtShared = true, true
		bag.targetValuesShared, bag.targetExpireAtShared = true, true
		bag.anchoredTickGenerationShared = true
		*copied = *bag
		bag.timingShared, copied.timingShared = true, true
		bag.sourceExpiryFactsShared, copied.sourceExpiryFactsShared = true, true
		copied.headerShared = false
		out[k] = copied
	}
	return out
}

// shareProviderStateMap 复制外层字典，冻结包头；使用包之前由所属字典取得独占头。
func shareProviderStateMap(src map[string]*bagData) map[string]*bagData {
	out := make(map[string]*bagData, len(src))
	for key, bag := range src {
		if bag == nil {

			out[key] = &bagData{
				state:                  map[string]float64{},
				expireAt:               map[string]int64{},
				fieldDefs:              map[string]FieldDefinition{},
				targetValues:           map[string]float64{},
				targetExpireAt:         map[string]int64{},
				anchoredTickGeneration: map[string]uint64{},
			}
			continue
		}
		bag.headerShared = true
		bag.timingShared = true
		bag.sourceExpiryFactsShared = true
		bag.stateShared, bag.expireAtShared = true, true
		bag.targetValuesShared, bag.targetExpireAtShared = true, true
		bag.anchoredTickGenerationShared = true
		out[key] = bag
	}
	return out
}

// freezeProviderStateView发布只读外层表；含nil条目时沿原规则独立归一化。
func freezeProviderStateView(src map[string]*bagData) map[string]*bagData {
	for _, bag := range src {
		if bag == nil {
			src = shareProviderStateMap(src)
			break
		}
	}
	for _, bag := range src {
		bag.headerShared = true
		bag.timingShared = true
		bag.sourceExpiryFactsShared = true
		bag.stateShared, bag.expireAtShared = true, true
		bag.targetValuesShared, bag.targetExpireAtShared = true, true
		bag.anchoredTickGenerationShared = true
	}
	return src
}

func writableProviderStateMap(bags *map[string]*bagData, shared *bool) map[string]*bagData {
	if *shared || *bags == nil {
		out := make(map[string]*bagData, len(*bags))
		for key, bag := range *bags {
			out[key] = bag
		}
		*bags, *shared = out, false
	}
	return *bags
}

func readSharedProviderStateBag(bags *map[string]*bagData, shared *bool, providerRef string, create bool, fields *FieldMetadata, nowMs int64, options ReadOptions) *bagData {
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
func writableProviderStateBag(bags map[string]*bagData, providerRef string, create bool) *bagData {
	if bags == nil {
		return nil
	}
	bag := bags[providerRef]
	if bag == nil {
		if !create {
			return nil
		}
		bag = &bagData{
			state:                  map[string]float64{},
			expireAt:               map[string]int64{},
			fieldDefs:              map[string]FieldDefinition{},
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
	bag.sourceExpiryFactsShared, copied.sourceExpiryFactsShared = true, true
	copied.headerShared = false
	copied.stateShared, copied.expireAtShared = true, true
	copied.targetValuesShared, copied.targetExpireAtShared = true, true
	copied.anchoredTickGenerationShared = true
	bag = &copied
	bags[providerRef] = bag
	return bag
}

type ReadOptions struct {
	Cooldowns    contract.CooldownView
	OwnerKey     string
	ExpireTarget bool
	Defaults     bool
	TargetView   bool
	TargetKey    string
}

// readProviderStateBag 仅供公式借用；准备已完成的共享头不复制，真正需要准备时才取得独占头。
// 返回的包及数值表只读，不能用于state_change、期限写入、目标切换或锚定周期写入。
// bags必须由调用方独占；create=true时须先初始化外层字典。
func readProviderStateBag(bags map[string]*bagData, providerRef string, create bool, fields *FieldMetadata, nowMs int64, options ReadOptions) *bagData {
	bag := bags[providerRef]
	if bag != nil && bag.headerShared && !bag.needsReadPreparation(fields, nowMs, options) {
		return bag
	}
	bag = writableProviderStateBag(bags, providerRef, create)
	if bag == nil {
		return nil
	}
	bag.bindFieldDefs(fields)
	bag.projectInternalCooldowns(options.Cooldowns, options.OwnerKey, providerRef, nowMs)
	bag.lazyExpireProviderState(nowMs)
	if options.ExpireTarget {
		bag.lazyExpireProviderTargetState(nowMs)
	}
	if options.Defaults {
		bag.defaultsForFormula()
	}
	if options.TargetView && bag.targetKey == options.TargetKey {
		bag.targetStateForFormula()
	}
	return bag
}

func (b *bagData) needsReadPreparation(fields *FieldMetadata, nowMs int64, options ReadOptions) bool {
	bind := len(fields.definitions()) > 0
	if bind && len(b.fieldDefs) == 0 {
		return true
	}
	hasCooldowns := b.hasInternalCooldowns
	if bind {
		hasCooldowns = fields.hasInternalCooldowns
	}
	if options.Cooldowns.Present() && hasCooldowns && (!b.cooldownProjectionBound || b.cooldownProjectionVersion != options.Cooldowns.Revision() || b.cooldownProjectionAt != nowMs) {
		return true
	}
	if options.Defaults && len(b.fieldDefs) > 0 && b.fieldDefaults == nil {
		return true
	}
	if options.TargetView && b.targetKey == options.TargetKey && (b.targetValues == nil || !b.targetValuesShared) {
		return true
	}
	if len(b.fieldDefs) == 0 {
		return false
	}

	if b.state == nil || b.expireAt == nil || b.targetValues == nil || b.targetExpireAt == nil || b.anchoredTickGeneration == nil {
		return true
	}
	for key, def := range b.fieldDefs {
		if bind {
			if _, exists := b.state[key]; !exists {
				return true
			}
		}
		if def.StateKind == model.ProviderStateKindCooldown || def.DurationMs <= 0 {
			continue
		}
		if expires := b.expireAt[key]; expires > 0 && nowMs >= expires && !b.holdsSourceExpiryAt(key, def, nowMs, expires) {
			return true
		}
		if options.ExpireTarget {
			if expires := b.targetExpireAt[key]; expires > 0 && nowMs >= expires && !b.holdsInclusiveAtExpiry(key, nowMs, expires) {
				return true
			}
		}
	}
	return false
}

// needsLazyExpiration 仅判断既有两类惰性过期是否会写包，不绑定字段或填默认值。
func (b *bagData) needsLazyExpiration(nowMs int64) bool {
	if b == nil || len(b.fieldDefs) == 0 {
		return false
	}
	if b.state == nil || b.expireAt == nil || b.targetValues == nil || b.targetExpireAt == nil || b.anchoredTickGeneration == nil {
		return true
	}
	for key, def := range b.fieldDefs {
		if def.StateKind == model.ProviderStateKindCooldown || def.DurationMs <= 0 {
			continue
		}
		if expires := b.expireAt[key]; expires > 0 && nowMs >= expires && !b.holdsSourceExpiryAt(key, def, nowMs, expires) {
			return true
		}
		if expires := b.targetExpireAt[key]; expires > 0 && nowMs >= expires && !b.holdsInclusiveAtExpiry(key, nowMs, expires) {
			return true
		}
	}
	return false
}

func CloneFloatMap(src map[string]float64) map[string]float64 {
	if len(src) == 0 {
		return map[string]float64{}
	}
	out := make(map[string]float64, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func CloneInt64Map(src map[string]int64) map[string]int64 {
	if len(src) == 0 {
		return map[string]int64{}
	}
	out := make(map[string]int64, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func CloneUint64Map(src map[string]uint64) map[string]uint64 {
	if len(src) == 0 {
		return map[string]uint64{}
	}
	out := make(map[string]uint64, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func CloneFieldDefMap(src map[string]FieldDefinition) map[string]FieldDefinition {
	if len(src) == 0 {
		return map[string]FieldDefinition{}
	}
	out := make(map[string]FieldDefinition, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func materializeProviderState(raw map[string]interface{}) map[string]*bagData {
	out := map[string]*bagData{}
	if len(raw) == 0 {
		return out
	}
	for providerRef, entry := range raw {
		bag := &bagData{
			state:          map[string]float64{},
			expireAt:       map[string]int64{},
			fieldDefs:      map[string]FieldDefinition{},
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
				if n, ok := AsFloat64(v); ok {
					bag.state[k] = n
				}
			}
		}
		if expObj, ok := obj["expireAt"].(map[string]interface{}); ok {
			for k, v := range expObj {
				if n, ok := AsInt64Strict(v); ok {
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
					if n, ok := AsFloat64(v); ok {
						bag.targetValues[k] = n
					}
				}
			}
			if expObj, ok := tsObj["expireAt"].(map[string]interface{}); ok {
				for k, v := range expObj {
					if n, ok := AsInt64Strict(v); ok {
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

func providerStateToSnapshot(bags map[string]*bagData, Cooldowns contract.CooldownView, owner string, now int64) map[string]interface{} {
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
			if def.StateKind == model.ProviderStateKindCooldown {
				stateObj[key] = InternalCooldownValue(Cooldowns, stateCooldownIdentity(owner, providerRef, key, StateScopeProvider, ""), now)
			}
		}
		expireObj := map[string]interface{}{}
		for k, v := range bag.expireAt {
			if v > 0 && bag.fieldDefs[k].StateKind != model.ProviderStateKindCooldown {
				expireObj[k] = float64(v)
			}
		}
		projectInternalCooldownExpiries(expireObj, Cooldowns, owner, providerRef, "", StateScopeProvider, now)
		entry := map[string]interface{}{
			"state":    stateObj,
			"expireAt": expireObj,
		}
		if bag.targetKey != "" || len(bag.targetValues) > 0 {
			valuesObj := map[string]interface{}{}
			for k, v := range bag.targetValues {
				valuesObj[k] = v
			}
			if Cooldowns.Present() {
				for slot := 0; slot < Cooldowns.Len(); slot++ {
					id, _ := Cooldowns.At(slot)
					if id.Owner == owner && id.ProviderRef == providerRef && id.Scope == StateScopeProviderTarget && id.Target == bag.targetKey {
						valuesObj[id.StateKey] = InternalCooldownValue(Cooldowns, id, now)
					}
				}
			}
			targetExpire := map[string]interface{}{}
			for k, v := range bag.targetExpireAt {
				if v > 0 && bag.fieldDefs[k].StateKind != model.ProviderStateKindCooldown {
					targetExpire[k] = float64(v)
				}
			}
			projectInternalCooldownExpiries(targetExpire, Cooldowns, owner, providerRef, bag.targetKey, StateScopeProviderTarget, now)
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

func AsInt64Strict(v interface{}) (int64, bool) {
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

func AsFloat64(v interface{}) (float64, bool) {
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

func ApplyStatePolicy(current, amount float64, policy string) (float64, bool) {
	switch policy {
	case "override", "set":
		return amount, true
	case "add", "":
		return current + amount, true
	default:
		return 0, false
	}
}

func FiniteState(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

func CompileFields(fields map[string]planbundle.CompiledProviderStateField) *FieldMetadata {
	metadata := &FieldMetadata{fields: make(map[string]FieldDefinition, len(fields))}
	for k, f := range fields {
		metadata.fields[k] = FieldDefinition{
			HasOnExpire:   f.OnExpireCount > 0,
			StateKind:     f.StateKind,
			ValueType:     f.ValueType,
			DefaultValue:  f.DefaultValue,
			MaxValue:      f.MaxValue,
			HasCap:        f.HasCap,
			DurationMs:    f.DurationMs,
			RefreshPolicy: f.RefreshPolicy,
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
func (b *bagData) bindFieldDefs(fields *FieldMetadata) {
	if b == nil || len(fields.definitions()) == 0 {
		return
	}
	b.ensure()
	if len(b.fieldDefs) == 0 {
		b.fieldDefs = CloneFieldDefMap(fields.fields)
		b.hasInternalCooldowns = fields.hasInternalCooldowns
		b.fieldDefaults = nil
	}
	for k, def := range b.fieldDefs {
		if _, ok := b.state[k]; !ok {
			b.writableState()[k] = def.DefaultValue
		}
	}
}

// seedTargetValueIfAbsent writes field defaultValue for one provider_target key when absent.
func (b *bagData) seedTargetValueIfAbsent(key string) {
	if b == nil || key == "" {
		return
	}
	b.ensure()
	if _, ok := b.targetValues[key]; ok {
		return
	}
	if def, ok := b.fieldDefs[key]; ok {
		b.writableTargetValues()[key] = def.DefaultValue
	}
}

// readTargetValue returns the active provider_target value, observing defaultValue when the
// key has not been written yet (without inserting unrelated fieldDefs into targetValues).
func (b *bagData) readTargetValue(key string) float64 {
	if b == nil {
		return 0
	}
	if v, ok := b.targetValues[key]; ok {
		return v
	}
	if def, ok := b.fieldDefs[key]; ok {
		return def.DefaultValue
	}
	return 0
}

// activateProviderTarget switches or establishes the active provider_target binding.
// Missing per-key defaults are applied on the subsequent read/write of that key.
func (b *bagData) activateProviderTarget(targetKey string) {
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
func (b *bagData) targetStateForFormula() map[string]float64 {
	if b == nil {
		return map[string]float64{}
	}
	if b.targetValues == nil {
		b.targetValues = map[string]float64{}
	}

	b.targetValuesShared = true
	return b.targetValues
}

// 命中候选可能先于同刻到期清理。只投影普通整数目标计数的真实期限，
// 不写入包、期限或锚；仅首次发现不同于默认值的到期键时复制局部数值表。
func (b *bagData) targetStateForParticipation(nowMs int64) map[string]float64 {
	if b == nil {
		return nil
	}
	var projected map[string]float64
	for key, expires := range b.targetExpireAt {
		if expires <= 0 || nowMs < expires {
			continue
		}
		def, ok := b.fieldDefs[key]
		if !ok || def.StateKind != "" || def.ValueType != model.ProviderStateValueInteger || def.DurationMs <= 0 || def.HasOnExpire {
			continue
		}
		if _, anchored := b.anchoredTickGeneration[key]; anchored {
			continue
		}
		isTiming := false
		if b.timing != nil {
			for _, fact := range b.timing {
				if fact.Key == key {
					isTiming = true
					break
				}
			}
		}
		if isTiming {
			continue
		}
		value, present := b.targetValues[key]
		if !present || value == def.DefaultValue {
			continue
		}
		if projected == nil {
			projected = CloneFloatMap(b.targetValues)
		}
		projected[key] = def.DefaultValue
	}
	if projected != nil {
		return projected
	}
	return b.targetValues
}

func (b *bagData) defaultsForFormula() map[string]float64 {
	if b == nil || len(b.fieldDefs) == 0 {
		return nil
	}
	if b.fieldDefaults != nil {
		return b.fieldDefaults
	}
	Defaults := make(map[string]float64, len(b.fieldDefs))
	for key, field := range b.fieldDefs {
		Defaults[key] = field.DefaultValue
	}
	b.fieldDefaults = Defaults
	return Defaults
}

// lazyExpireProviderState resets expired provider-scope keys to defaultValue (Gate H1).
func (b *bagData) lazyExpireProviderState(nowMs int64) {
	if b == nil || len(b.fieldDefs) == 0 {
		return
	}
	b.ensure()
	for key, def := range b.fieldDefs {
		if def.StateKind == model.ProviderStateKindCooldown || def.DurationMs <= 0 {
			continue
		}
		exp, ok := b.expireAt[key]
		if !ok || exp <= 0 {
			continue
		}
		if nowMs >= exp {
			if b.holdsSourceExpiryAt(key, def, nowMs, exp) {
				continue
			}
			b.writableState()[key] = def.DefaultValue
			b.writableExpireAt()[key] = 0
		}
	}
}

// lazyExpireProviderTargetState resets expired provider_target keys to defaultValue.
// Global semantics remain nowMs >= expireAt. A bag-local inclusive-at-expiry hold may
// suppress exactly one owner/provider/target/anchor key while nowMs == expireAt,
// after its real terminal callback has been queued and until it settles.
func (b *bagData) lazyExpireProviderTargetState(nowMs int64) {
	if b == nil || len(b.fieldDefs) == 0 {
		return
	}
	b.ensure()
	for key, def := range b.fieldDefs {
		if def.StateKind == model.ProviderStateKindCooldown || def.DurationMs <= 0 {
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
			b.writableTargetValues()[key] = def.DefaultValue
			b.writableTargetExpireAt()[key] = 0
		}
	}
}

func (b *bagData) holdsInclusiveAtExpiry(key string, nowMs, exp int64) bool {
	if b != nil && b.timing != nil {
		for _, fact := range b.timing {
			if fact.Active && fact.Key == key && fact.Protect && fact.Expiry == exp && nowMs == exp {
				return true
			}
		}
	}
	if b == nil || b.inclusiveAtExpiryKey == "" {
		return false
	}
	if b.inclusiveAtExpiryKey != key {
		return false
	}
	if b.inclusiveAtExpiryTarget == "" || b.targetKey != b.inclusiveAtExpiryTarget {
		return false
	}
	return nowMs == exp && b.inclusiveAtExpiryAt == exp && b.inclusiveAtExpiryGen == b.currentAnchoredTickGeneration(key)
}

func (b *bagData) setInclusiveAtExpiryHold(targetKey, anchorKey string) {
	if b == nil {
		return
	}
	b.ensure()
	b.inclusiveAtExpiryTarget = targetKey
	b.inclusiveAtExpiryKey = anchorKey
	b.inclusiveAtExpiryAt = b.targetExpireAt[anchorKey]
	b.inclusiveAtExpiryGen = b.currentAnchoredTickGeneration(anchorKey)
}

func (b *bagData) clearInclusiveAtExpiryHold() {
	if b == nil {
		return
	}
	b.inclusiveAtExpiryKey = ""
	b.inclusiveAtExpiryTarget = ""
	b.inclusiveAtExpiryAt = 0
	b.inclusiveAtExpiryGen = 0
}

// bumpAnchoredTickGeneration advances the generation token for one anchor key.
func (b *bagData) bumpAnchoredTickGeneration(anchorKey string) uint64 {
	if b == nil || anchorKey == "" {
		return 0
	}
	b.ensure()
	b.writableAnchoredTickGeneration()[anchorKey]++
	return b.anchoredTickGeneration[anchorKey]
}

func (b *bagData) currentAnchoredTickGeneration(anchorKey string) uint64 {
	if b == nil || anchorKey == "" || b.anchoredTickGeneration == nil {
		return 0
	}
	return b.anchoredTickGeneration[anchorKey]
}

// clearProviderTargetState drops active target binding (values + timers) on target switch.
func (b *bagData) clearProviderTargetState() {
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
	if b.timing != nil {
		facts := b.writableTargetTiming()
		for i := range facts {
			facts[i].Active, facts[i].Protect = false, false
			facts[i].Generation++
		}
	}
}

func (b *bagData) clampProviderStateValue(key string, value float64) float64 {
	if b == nil {
		return value
	}
	def, ok := b.fieldDefs[key]
	if !ok || !def.HasCap {
		return value
	}
	if value > def.MaxValue {
		return def.MaxValue
	}
	return value
}

func ValidStateInteger(value float64) bool {
	return FiniteState(value) && math.Trunc(value) == value && math.Abs(value) <= float64(maxJSONSafeInteger)
}

func (b *bagData) nextStateValue(key string, current, amount float64, policy string) (float64, string) {
	integer := b.fieldDefs[key].ValueType == model.ProviderStateValueInteger
	if integer {
		if !ValidStateInteger(current) || current < 0 || !ValidStateInteger(amount) {
			return 0, "integer state requires a non-negative safe current value and a safe integer operand"
		}
		if (policy == "set" || policy == "override") && amount < 0 {
			return 0, "integer state cannot be assigned a negative value"
		}
		if (policy == "add" || policy == "") && amount > 0 && current > float64(maxJSONSafeInteger)-amount {
			return 0, "integer state addition exceeds the safe integer range"
		}
	}
	next, supported := ApplyStatePolicy(current, amount, policy)
	if !supported {
		return 0, "unsupported state_change valuePolicy"
	}
	if !FiniteState(next) {
		return 0, "non-finite state result"
	}
	if integer && (!ValidStateInteger(next) || next < 0) {
		return 0, "integer state result must be a non-negative safe integer"
	}
	return b.clampProviderStateValue(key, next), ""
}

func (b *bagData) refreshExpireAtOnWrite(key string, nowMs int64) bool {
	if b == nil {
		return true
	}
	def, ok := b.fieldDefs[key]
	if def.StateKind == model.ProviderStateKindCooldown {
		return false
	}
	if !ok || def.DurationMs <= 0 {
		return true
	}
	b.ensure()
	switch def.RefreshPolicy {
	case model.ProviderStateRefreshOnWrite:
		if b.state[key] == def.DefaultValue {
			b.writableExpireAt()[key] = 0
			return true
		}
		exp, ok := addDuration(nowMs, def.DurationMs)
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

func (b *bagData) refreshTargetExpireAtOnWrite(key string, nowMs int64) (int64, bool) {
	if b == nil {
		return 0, true
	}
	def, ok := b.fieldDefs[key]
	if def.StateKind == model.ProviderStateKindCooldown {
		return 0, false
	}
	if !ok || def.DurationMs <= 0 {
		return 0, true
	}
	b.ensure()
	if b.targetValues[key] == def.DefaultValue && b.inclusiveAtExpiryKey == key && b.inclusiveAtExpiryTarget == b.targetKey {
		b.clearInclusiveAtExpiryHold()
	}
	switch def.RefreshPolicy {
	case model.ProviderStateRefreshOnWrite:
		if b.targetValues[key] == def.DefaultValue {
			b.writableTargetExpireAt()[key] = 0
			return 0, true
		}
		exp, ok := addDuration(nowMs, def.DurationMs)
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

func (b *bagData) applyStartOnFirstWrite(key string, nowMs int64, next float64, def FieldDefinition, target bool) bool {
	expire := b.expireAt
	if target {
		expire = b.targetExpireAt
	}
	if next == def.DefaultValue {
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
	exp, ok := addDuration(nowMs, def.DurationMs)
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
func (b *bagData) subtractProviderExpireAt(key string, nowMs, deltaMs int64) (applied, expired bool, newExp int64) {
	if b == nil || key == "" || deltaMs < 0 || b.fieldDefs[key].StateKind == model.ProviderStateKindCooldown {
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
func (b *bagData) subtractTargetExpireAt(key string, nowMs, deltaMs int64) (applied, expired bool, newExp int64) {
	if b == nil || key == "" || deltaMs < 0 || b.fieldDefs[key].StateKind == model.ProviderStateKindCooldown {
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

func restoreBagTimers(bag *bagData, snapshotTime int64, combatantKeys map[string]bool, path, schemaHash, rulesHash, sessionID string) *model.EngineError {
	if bag == nil {
		return nil
	}
	bag.ensure()

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
		if !FiniteState(value) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "providerState value must be finite", path+".state."+key, key, schemaHash, rulesHash, sessionID)
		}
		if def.ValueType == model.ProviderStateValueInteger && (!ValidStateInteger(value) || value < 0) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "integer providerState must be a non-negative safe integer", path+".state."+key, key, schemaHash, rulesHash, sessionID)
		}
		if def.HasCap && value > def.MaxValue {
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
		if !FiniteState(value) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "provider targetState value must be finite", path+".targetState.values."+key, key, schemaHash, rulesHash, sessionID)
		}
		if def.ValueType == model.ProviderStateValueInteger && (!ValidStateInteger(value) || value < 0) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "integer provider targetState must be a non-negative safe integer", path+".targetState.values."+key, key, schemaHash, rulesHash, sessionID)
		}
		if def.HasCap && value > def.MaxValue {
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

func restoreTimedValue(values *map[string]float64, expire map[string]int64, key string, def FieldDefinition, snapshotTime int64, path, schemaHash, rulesHash, sessionID string) *model.EngineError {
	value := (*values)[key]
	exp, hasExp := expire[key]
	if def.DurationMs <= 0 {
		if hasExp && exp > 0 {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "untimed providerState cannot carry expireAt", path+".expireAt."+key, key, schemaHash, rulesHash, sessionID)
		}
		return nil
	}
	if value == def.DefaultValue {
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
		(*values)[key] = def.DefaultValue
		expire[key] = 0
		return nil
	}
	return nil
}
