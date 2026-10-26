package effect

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/contract"
)

func (c BagChange) Ensure()                            { c.data.ensure() }
func (v BagView) NeedsLazyExpiration(now int64) bool   { return v.data.needsLazyExpiration(now) }
func (c BagChange) NeedsLazyExpiration(now int64) bool { return c.View().NeedsLazyExpiration(now) }

// BagState 独占供值状态注册表；外部只能取得只读视图或暂存操作。
type BagState struct {
	bags   map[string]*bagData
	shared bool
}
type BagChangeSet struct{ state BagState }

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

// BagView 不公开袋头或其中任一可写集合。
type BagView struct{ data *bagData }
type BagChange struct{ data *bagData }

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

type FieldDefinitions struct{ values map[string]FieldDefinition }

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
