package effect

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/contract"
)

// BagStateAPI 列出供值状态注册表的能力；注册表与包头继续按所属状态的写时复制规则隔离。
type BagStateAPI interface {
	// Lookup 按供值引用借用已有包头，不创建包、不准备到期或默认值。
	Lookup(ref string) BagView
	// Len 返回注册的状态包数。
	Len() int
	// Range 以未规定顺序遍历只读借用；回调不能保留可写包头。
	Range(visit func(string, BagView))
	// Freeze 冻结包头视图并标记共享，使后续按规则编辑保持旧视图隔离。
	Freeze() BagState
	// Clone 复制状态包注册表及包内状态，形成独立后续写入分支。
	Clone() BagState
	// Remove 通过注册表写时复制删除指定引用。
	Remove(ref string)
	// Edit 取得本次独占写句柄；发布、冻结或再次共享后必须重新获取。
	Edit(ref string, create bool) BagChange
	// PrepareRead 按真实时刻准备读取，可能复制包头、绑定元数据、处理到期与投影，属于受控写入。
	PrepareRead(ref string, create bool, fields *FieldMetadata, now int64, options ReadOptions) BagView
	// Snapshot 按真实冷却与当前时刻导出可恢复状态快照，不把数值投影当真实截止。
	Snapshot(cooldowns contract.CooldownView, owner string, now int64) map[string]interface{}
	// Keys 复制并返回注册引用列表，顺序未定义。
	Keys() []string
}

// BagState 独占供值状态注册表；外部只能取得只读视图或暂存操作。
type BagState struct {
	bags   map[string]*bagData
	shared bool
}

// BagChangeSetAPI 列出状态包注册表的暂存操作；Publish只发布本包投影，不是跨子系统事务。
type BagChangeSetAPI interface {
	// Lookup 借用暂存注册表中的已有包头，不执行读取准备。
	Lookup(ref string) BagView
	// Len 返回暂存注册表中的状态包数。
	Len() int
	// Range 遍历暂存注册表的只读借用，顺序未定义。
	Range(visit func(string, BagView))
	// Edit 取得本次独占写句柄；发布、冻结或再次共享后丢弃该句柄。
	Edit(ref string, create bool) BagChange
	// Remove 在暂存注册表中按写时复制规则移除引用。
	Remove(ref string)
	// PrepareRead 在暂存状态上进行受控读取准备，可能写入包头、默认值、期限及冷却投影。
	PrepareRead(ref string, create bool, fields *FieldMetadata, now int64, options ReadOptions) BagView
	// Publish 冻结并交出本包状态投影；继续写入须重新取得独占访问。
	Publish() BagState
	// Clone 复制本次暂存状态，建立独立后续写入分支。
	Clone() BagChangeSet
	// Keys 复制并返回暂存注册引用列表，顺序未定义。
	Keys() []string
}

type BagChangeSet struct{ state BagState }

// BagViewAPI 列出状态包的只读借用能力；公式准备可能建立缓存和共享标记，不能当作任意纯函数。
type BagViewAPI interface {
	// NeedsLazyExpiration 检查当前时刻是否需要惰性到期准备，不执行到期写入。
	NeedsLazyExpiration(now int64) bool
	// Present 判断状态包头是否存在。
	Present() bool
	// State 借用本来源状态值的只读视图；缺少包头时返回空视图。
	State() model.NumericView
	// ExpireAt 借用本来源状态期限的只读视图；缺少包头时返回空视图。
	ExpireAt() model.DeadlineView
	// TargetValues 借用当前目标状态值的只读视图；缺少包头时返回空视图。
	TargetValues() model.NumericView
	// TargetExpireAt 借用当前目标状态期限的只读视图；缺少包头时返回空视图。
	TargetExpireAt() model.DeadlineView
	// TargetKey 读取当前绑定目标；缺少包头时返回空字符串。
	TargetKey() string
	// Field 读取单个字段定义；缺失时返回零值。
	Field(key string) FieldDefinition
	// Fields 借用字段定义集合的只读包装。
	Fields() FieldDefinitions
	// DefaultsForFormula 取得公式默认值视图；首次调用可能构建只读默认缓存。
	DefaultsForFormula() model.NumericView
	// TargetStateForFormula 取得已触达目标字段的公式视图；可能准备空表及共享标记，不批量注入默认字段。
	TargetStateForFormula() model.NumericView
	// TargetStateForParticipation 按真实期限投影命中参与所需的目标整数值；到期投影不改包内数值。
	TargetStateForParticipation(now int64) model.NumericView
	// ReadTargetValue 读取已写目标值或对应字段默认值，不注入无关默认字段。
	ReadTargetValue(key string) float64
	// TargetStateRemainingMs 仅对匹配目标、正值及未到期字段返回剩余毫秒，其余返回0。
	TargetStateRemainingMs(key, target string, now int64) int64
	// CurrentAnchoredTickGeneration 读取指定字段的锚定周期世代。
	CurrentAnchoredTickGeneration(key string) uint64
	// HoldsSourceExpiryAt 判断真实到期回调事实是否要求在精确期限暂留本来源字段值。
	HoldsSourceExpiryAt(key string, def FieldDefinition, now, expiry int64) bool
	// SourceExpiry 读取字段的到期回调世代与期限；缺少包头或事实时返回零值。
	SourceExpiry(key string) SourceExpiryFact
	// Timing 读取有效槽的时间事实；包头、时间表或下标无效时返回零值。
	Timing(slot int) TimingFact
	// HasTiming 判断状态包是否持有时间事实表。
	HasTiming() bool
	// HasInternalCooldowns 判断状态元数据是否包含内部冷却字段。
	HasInternalCooldowns() bool
}

// BagView 不公开袋头或其中任一可写集合。
type BagView struct{ data *bagData }

// BagChangeAPI 列出独占包头上的局部操作；发布、冻结或再次共享后丢弃句柄，下一次写入须重新Edit。
type BagChangeAPI interface {
	// Ensure 为独占包头准备缺失的状态容器。
	Ensure()
	// NeedsLazyExpiration 检查当前时刻是否需要惰性到期准备，不执行到期写入。
	NeedsLazyExpiration(now int64) bool
	// View 借用当前可写包头的只读包装，不生成历史快照。
	View() BagView
	// Present 判断状态包头是否存在。
	Present() bool
	// BindFieldDefs 绑定已编译字段元数据，并准备相应默认与冷却信息。
	BindFieldDefs(fields *FieldMetadata)
	// LazyExpireProviderState 按真实时刻处理本来源范围字段的惰性到期。
	LazyExpireProviderState(now int64)
	// LazyExpireProviderTargetState 按真实时刻处理当前目标范围字段的惰性到期。
	LazyExpireProviderTargetState(now int64)
	// ActivateProviderTarget 切换或建立当前目标；目标变化时清理旧目标状态。
	ActivateProviderTarget(key string)
	// SeedTargetValueIfAbsent 仅为尚未写入的指定目标字段补入其默认值。
	SeedTargetValueIfAbsent(key string)
	// SetStateValue 通过写时复制容器设置已核定的本来源字段值。
	SetStateValue(key string, value float64)
	// SetTargetValue 通过写时复制容器设置已核定的当前目标字段值。
	SetTargetValue(key string, value float64)
	// SetExpireAt 设置本来源字段的真实期限。
	SetExpireAt(key string, value int64)
	// SetTargetExpireAt 设置当前目标字段的真实期限。
	SetTargetExpireAt(key string, value int64)
	// DeleteExpireAt 删除本来源字段期限。
	DeleteExpireAt(key string)
	// DeleteTargetExpireAt 删除当前目标字段期限。
	DeleteTargetExpireAt(key string)
	// SetTiming 保存指定有效槽的时间事实，不排程事件。
	SetTiming(slot int, fact TimingFact)
	// RefreshExpireAtOnWrite 依字段刷新规则处理本来源期限，返回操作是否合法；无需更新时间也可成功。
	RefreshExpireAtOnWrite(key string, now int64) bool
	// RefreshTargetExpireAtOnWrite 依字段刷新规则处理目标期限，返回结果期限及操作是否合法；失败时不可发布。
	RefreshTargetExpireAtOnWrite(key string, now int64) (int64, bool)
	// NextStateValue 按字段数值与叠加策略核定下一值；失败原因由执行层处理，不自动写入。
	NextStateValue(key string, current, amount float64, policy string) (float64, string)
	// SubtractProviderExpireAt 缩短本来源字段期限，返回是否应用、是否到期和新期限。
	SubtractProviderExpireAt(key string, now, delta int64) (bool, bool, int64)
	// SubtractTargetExpireAt 缩短当前目标字段期限，返回是否应用、是否到期和新期限。
	SubtractTargetExpireAt(key string, now, delta int64) (bool, bool, int64)
	// RearmSourceExpiry 推进并保存字段到期回调世代，返回新世代；排程由执行层负责。
	RearmSourceExpiry(key string, deadline int64) uint64
	// SetSourceExpiry 保存已经核定的本来源到期回调事实。
	SetSourceExpiry(key string, fact SourceExpiryFact)
	// SetInclusiveAtExpiryHold 暂存指定目标字段在精确期限保留值的读取标记。
	SetInclusiveAtExpiryHold(target, key string)
	// ClearInclusiveAtExpiryHold 清除精确期限的临时保留标记。
	ClearInclusiveAtExpiryHold()
	// BumpAnchoredTickGeneration 推进并返回指定字段的锚定周期世代。
	BumpAnchoredTickGeneration(key string) uint64
	// ClearProviderTargetState 清除当前目标绑定及其状态、期限与相关缓存。
	ClearProviderTargetState()
	// ProjectInternalCooldowns 从真实冷却账本准备只读数值投影，不修改真实截止。
	ProjectInternalCooldowns(view contract.CooldownView, owner, ref string, now int64)
	// RestoreTimers 复核并恢复包内计时状态；返回携带原路径与身份的结构化错误。
	RestoreTimers(now int64, keys map[string]bool, path, schema, rules, session string) *model.EngineError
	// InvalidateCooldownProjection 使现有冷却数值投影失效，供后续真实账本读取重新准备。
	InvalidateCooldownProjection()
	// State 借用本来源状态值的只读视图；缺少包头时返回空视图。
	State() model.NumericView
	// ExpireAt 借用本来源状态期限的只读视图；缺少包头时返回空视图。
	ExpireAt() model.DeadlineView
	// TargetValues 借用当前目标状态值的只读视图；缺少包头时返回空视图。
	TargetValues() model.NumericView
	// TargetExpireAt 借用当前目标状态期限的只读视图；缺少包头时返回空视图。
	TargetExpireAt() model.DeadlineView
	// TargetKey 读取当前绑定目标；缺少包头时返回空字符串。
	TargetKey() string
	// Fields 借用字段定义集合的只读包装。
	Fields() FieldDefinitions
	// DefaultsForFormula 取得公式默认值视图；首次调用可能构建只读默认缓存。
	DefaultsForFormula() model.NumericView
	// TargetStateForFormula 取得已触达目标字段的公式视图；可能准备空表及共享标记，不批量注入默认字段。
	TargetStateForFormula() model.NumericView
	// HasTiming 判断状态包是否持有时间事实表。
	HasTiming() bool
	// HasInternalCooldowns 判断状态元数据是否包含内部冷却字段。
	HasInternalCooldowns() bool
	// Field 读取单个字段定义；缺失时返回零值。
	Field(key string) FieldDefinition
	// ReadTargetValue 读取已写目标值或对应字段默认值，不注入无关默认字段。
	ReadTargetValue(key string) float64
	// TargetStateForParticipation 按真实期限投影命中参与所需的目标整数值；到期投影不改包内数值。
	TargetStateForParticipation(now int64) model.NumericView
	// TargetStateRemainingMs 仅对匹配目标、正值及未到期字段返回剩余毫秒，其余返回0。
	TargetStateRemainingMs(key, target string, now int64) int64
	// CurrentAnchoredTickGeneration 读取指定字段的锚定周期世代。
	CurrentAnchoredTickGeneration(key string) uint64
	// HoldsSourceExpiryAt 判断真实到期回调事实是否要求在精确期限暂留本来源字段值。
	HoldsSourceExpiryAt(key string, def FieldDefinition, now, expiry int64) bool
	// SourceExpiry 读取字段的到期回调世代与期限；缺少包头或事实时返回零值。
	SourceExpiry(key string) SourceExpiryFact
	// Timing 读取有效槽的时间事实；包头、时间表或下标无效时返回零值。
	Timing(slot int) TimingFact
}

type BagChange struct{ data *bagData }

type FieldDefinitions struct{ values map[string]FieldDefinition }

var _ BagStateAPI = (*BagState)(nil)
var _ BagChangeSetAPI = (*BagChangeSet)(nil)
var _ BagViewAPI = (*BagView)(nil)
var _ BagChangeAPI = (*BagChange)(nil)

func (c BagChange) Ensure()                            { c.data.ensure() }
func (v BagView) NeedsLazyExpiration(now int64) bool   { return v.data.needsLazyExpiration(now) }
func (c BagChange) NeedsLazyExpiration(now int64) bool { return c.View().NeedsLazyExpiration(now) }

func RestoreBags(raw map[string]interface{}) BagState {
	return BagState{bags: materializeProviderState(raw)}
}
func StageBags(state *BagState) BagChangeSet { return BagChangeSet{state: state.Freeze()} }
func (s BagState) Lookup(ref string) BagView { return BagView{data: s.bags[ref]} }
func (s BagState) Len() int                  { return len(s.bags) }
func (s BagState) Range(visit func(string, BagView)) {
	for ref, data := range s.bags {
		visit(ref, BagView{data: data})
	}
}
func (s *BagState) Freeze() BagState {
	frozen := freezeProviderStateView(s.bags)
	s.shared = true
	return BagState{bags: frozen, shared: true}
}
func (s *BagState) Clone() BagState   { return BagState{bags: cloneProviderStateMap(s.bags)} }
func (s *BagState) Remove(ref string) { delete(writableProviderStateMap(&s.bags, &s.shared), ref) }
func (s *BagState) Edit(ref string, create bool) BagChange {
	return BagChange{data: writableProviderStateBag(writableProviderStateMap(&s.bags, &s.shared), ref, create)}
}
func (s *BagState) PrepareRead(ref string, create bool, fields *FieldMetadata, now int64, options ReadOptions) BagView {
	return BagView{data: readSharedProviderStateBag(&s.bags, &s.shared, ref, create, fields, now, options)}
}
func (s BagState) Snapshot(cooldowns contract.CooldownView, owner string, now int64) map[string]interface{} {
	return providerStateToSnapshot(s.bags, cooldowns, owner, now)
}
func (s *BagChangeSet) Lookup(ref string) BagView              { return s.state.Lookup(ref) }
func (s *BagChangeSet) Len() int                               { return s.state.Len() }
func (s *BagChangeSet) Range(visit func(string, BagView))      { s.state.Range(visit) }
func (s *BagChangeSet) Edit(ref string, create bool) BagChange { return s.state.Edit(ref, create) }
func (s *BagChangeSet) Remove(ref string)                      { s.state.Remove(ref) }
func (s *BagChangeSet) PrepareRead(ref string, create bool, fields *FieldMetadata, now int64, options ReadOptions) BagView {
	return s.state.PrepareRead(ref, create, fields, now, options)
}
func (s *BagChangeSet) Publish() BagState   { return s.state.Freeze() }
func (s *BagChangeSet) Clone() BagChangeSet { return BagChangeSet{state: s.state.Clone()} }

func (v BagView) Present() bool { return v.data != nil }
func (v BagView) State() model.NumericView {
	if v.data == nil {
		return model.NumericView{}
	}
	return model.BorrowNumericView(v.data.state)
}
func (v BagView) ExpireAt() model.DeadlineView {
	if v.data == nil {
		return model.DeadlineView{}
	}
	return model.BorrowDeadlineView(v.data.expireAt)
}
func (v BagView) TargetValues() model.NumericView {
	if v.data == nil {
		return model.NumericView{}
	}
	return model.BorrowNumericView(v.data.targetValues)
}
func (v BagView) TargetExpireAt() model.DeadlineView {
	if v.data == nil {
		return model.DeadlineView{}
	}
	return model.BorrowDeadlineView(v.data.targetExpireAt)
}
func (v BagView) TargetKey() string {
	if v.data == nil {
		return ""
	}
	return v.data.targetKey
}
func (v BagView) Field(key string) FieldDefinition {
	if v.data == nil {
		return FieldDefinition{}
	}
	return v.data.fieldDefs[key]
}
func (v BagView) Fields() FieldDefinitions {
	if v.data == nil {
		return FieldDefinitions{}
	}
	return FieldDefinitions{values: v.data.fieldDefs}
}
func (v BagView) DefaultsForFormula() model.NumericView {
	return model.BorrowNumericView(v.data.defaultsForFormula())
}
func (v BagView) TargetStateForFormula() model.NumericView {
	return model.BorrowNumericView(v.data.targetStateForFormula())
}
func (v BagView) TargetStateForParticipation(now int64) model.NumericView {
	return model.BorrowNumericView(v.data.targetStateForParticipation(now))
}
func (v BagView) ReadTargetValue(key string) float64 { return v.data.readTargetValue(key) }
func (v BagView) TargetStateRemainingMs(key, target string, now int64) int64 {
	return v.data.targetStateRemainingMs(key, target, now)
}
func (v BagView) CurrentAnchoredTickGeneration(key string) uint64 {
	return v.data.currentAnchoredTickGeneration(key)
}
func (v BagView) HoldsSourceExpiryAt(key string, def FieldDefinition, now, expiry int64) bool {
	if v.data == nil {
		return false
	}
	return v.data.holdsSourceExpiryAt(key, def, now, expiry)
}
func (v BagView) SourceExpiry(key string) SourceExpiryFact {
	if v.data == nil {
		return SourceExpiryFact{}
	}
	return v.data.sourceExpiryFacts[key]
}
func (v BagView) Timing(slot int) TimingFact {
	if v.data == nil || v.data.timing == nil || slot < 0 || slot >= len(*v.data.timing) {
		return TimingFact{}
	}
	return v.data.timing[slot]
}
func (v BagView) HasTiming() bool { return v.data != nil && v.data.timing != nil }

func (c BagChange) View() BagView                       { return BagView{data: c.data} }
func (c BagChange) Present() bool                       { return c.data != nil }
func (c BagChange) BindFieldDefs(fields *FieldMetadata) { c.data.bindFieldDefs(fields) }
func (c BagChange) LazyExpireProviderState(now int64)   { c.data.lazyExpireProviderState(now) }
func (c BagChange) LazyExpireProviderTargetState(now int64) {
	c.data.lazyExpireProviderTargetState(now)
}
func (c BagChange) ActivateProviderTarget(key string)       { c.data.activateProviderTarget(key) }
func (c BagChange) SeedTargetValueIfAbsent(key string)      { c.data.seedTargetValueIfAbsent(key) }
func (c BagChange) SetStateValue(key string, value float64) { c.data.writableState()[key] = value }
func (c BagChange) SetTargetValue(key string, value float64) {
	c.data.writableTargetValues()[key] = value
}
func (c BagChange) SetExpireAt(key string, value int64) { c.data.writableExpireAt()[key] = value }
func (c BagChange) SetTargetExpireAt(key string, value int64) {
	c.data.writableTargetExpireAt()[key] = value
}
func (c BagChange) DeleteExpireAt(key string)           { delete(c.data.writableExpireAt(), key) }
func (c BagChange) DeleteTargetExpireAt(key string)     { delete(c.data.writableTargetExpireAt(), key) }
func (c BagChange) SetTiming(slot int, fact TimingFact) { c.data.writableTargetTiming()[slot] = fact }
func (c BagChange) RefreshExpireAtOnWrite(key string, now int64) bool {
	return c.data.refreshExpireAtOnWrite(key, now)
}
func (c BagChange) RefreshTargetExpireAtOnWrite(key string, now int64) (int64, bool) {
	return c.data.refreshTargetExpireAtOnWrite(key, now)
}
func (c BagChange) NextStateValue(key string, current, amount float64, policy string) (float64, string) {
	return c.data.nextStateValue(key, current, amount, policy)
}
func (c BagChange) SubtractProviderExpireAt(key string, now, delta int64) (bool, bool, int64) {
	return c.data.subtractProviderExpireAt(key, now, delta)
}
func (c BagChange) SubtractTargetExpireAt(key string, now, delta int64) (bool, bool, int64) {
	return c.data.subtractTargetExpireAt(key, now, delta)
}
func (c BagChange) RearmSourceExpiry(key string, deadline int64) uint64 {
	return c.data.rearmSourceExpiry(key, deadline)
}
func (c BagChange) SetSourceExpiry(key string, fact SourceExpiryFact) {
	c.data.writableSourceExpiryFacts()[key] = fact
}
func (c BagChange) SetInclusiveAtExpiryHold(target, key string) {
	c.data.setInclusiveAtExpiryHold(target, key)
}
func (c BagChange) ClearInclusiveAtExpiryHold() { c.data.clearInclusiveAtExpiryHold() }
func (c BagChange) BumpAnchoredTickGeneration(key string) uint64 {
	return c.data.bumpAnchoredTickGeneration(key)
}
func (c BagChange) ClearProviderTargetState() { c.data.clearProviderTargetState() }
func (c BagChange) ProjectInternalCooldowns(view contract.CooldownView, owner, ref string, now int64) {
	c.data.projectInternalCooldowns(view, owner, ref, now)
}
func (c BagChange) RestoreTimers(now int64, keys map[string]bool, path, schema, rules, session string) *model.EngineError {
	return restoreBagTimers(c.data, now, keys, path, schema, rules, session)
}

func (v FieldDefinitions) Len() int { return len(v.values) }
func (v FieldDefinitions) Lookup(key string) (FieldDefinition, bool) {
	f, ok := v.values[key]
	return f, ok
}
func (v FieldDefinitions) At(key string) FieldDefinition { return v.values[key] }
func (v FieldDefinitions) Range(visit func(string, FieldDefinition)) {
	for key, value := range v.values {
		visit(key, value)
	}
}
func (m *FieldMetadata) Definitions() FieldDefinitions {
	return FieldDefinitions{values: m.definitions()}
}

func (s BagState) Keys() []string {
	keys := make([]string, 0, len(s.bags))
	for key := range s.bags {
		keys = append(keys, key)
	}
	return keys
}
func (s *BagChangeSet) Keys() []string                       { return s.state.Keys() }
func (v BagView) HasInternalCooldowns() bool                 { return v.data != nil && v.data.hasInternalCooldowns }
func (c BagChange) InvalidateCooldownProjection()            { c.data.cooldownProjectionBound = false }
func (c BagChange) State() model.NumericView                 { return c.View().State() }
func (c BagChange) ExpireAt() model.DeadlineView             { return c.View().ExpireAt() }
func (c BagChange) TargetValues() model.NumericView          { return c.View().TargetValues() }
func (c BagChange) TargetExpireAt() model.DeadlineView       { return c.View().TargetExpireAt() }
func (c BagChange) TargetKey() string                        { return c.View().TargetKey() }
func (c BagChange) Fields() FieldDefinitions                 { return c.View().Fields() }
func (c BagChange) DefaultsForFormula() model.NumericView    { return c.View().DefaultsForFormula() }
func (c BagChange) TargetStateForFormula() model.NumericView { return c.View().TargetStateForFormula() }
func (c BagChange) HasTiming() bool                          { return c.View().HasTiming() }
func (c BagChange) HasInternalCooldowns() bool               { return c.View().HasInternalCooldowns() }
func (c BagChange) Field(key string) FieldDefinition         { return c.View().Field(key) }
func (c BagChange) ReadTargetValue(key string) float64       { return c.View().ReadTargetValue(key) }
func (c BagChange) TargetStateForParticipation(now int64) model.NumericView {
	return c.View().TargetStateForParticipation(now)
}
func (c BagChange) TargetStateRemainingMs(key, target string, now int64) int64 {
	return c.View().TargetStateRemainingMs(key, target, now)
}
func (c BagChange) CurrentAnchoredTickGeneration(key string) uint64 {
	return c.View().CurrentAnchoredTickGeneration(key)
}
func (c BagChange) HoldsSourceExpiryAt(key string, def FieldDefinition, now, expiry int64) bool {
	return c.View().HoldsSourceExpiryAt(key, def, now, expiry)
}
func (c BagChange) SourceExpiry(key string) SourceExpiryFact { return c.View().SourceExpiry(key) }
func (c BagChange) Timing(slot int) TimingFact               { return c.View().Timing(slot) }
