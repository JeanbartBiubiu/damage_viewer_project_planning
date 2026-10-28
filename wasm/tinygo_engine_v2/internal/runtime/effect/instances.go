package effect

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// ObjectView borrows frozen protocol state without exposing its mutable map.
type ObjectView struct{ values map[string]interface{} }

type ContributionView struct{ values []StatusContribution }

// Provider is a value. Its nested fields remain read-only when the value is copied.
type Provider struct {
	ModifierSnapshots                                           model.NumericView
	ActivationUseRef, ProviderRef, DefinitionRef, Source, Owner string
	Stacks                                                      int
	ExpireAt, AppliedAtMs                                       int64
	HasAppliedAt                                                bool
	State                                                       ObjectView
	DefinitionIndex                                             uint16
	StatusContributions                                         ContributionView
}

type ProviderList struct{ values []Provider }

type Shield struct {
	ShieldRef, DefinitionRef, LifecycleProviderRef, Source, Owner string
	Remaining                                                     float64
	Priority                                                      int16
	ExpireAt                                                      int64
	State                                                         ObjectView
}

type ShieldList struct {
	values []pipeline.ShieldInstance
}

type ResourceContribution struct {
	ProviderRef, Source, UseRef    string
	DefinitionIndex, ModifierIndex uint16
	Value                          float64
}

type ResourceContributions struct{ values []ResourceContribution }

// AttributeResolverAPI 列出效果侧属性结算适配；挂载状态由效果拥有，数值规则沿既有管道执行。
type AttributeResolverAPI interface {
	// Clone 复制属性解析器值；内部挂载表沿不可变及写时复制规则共享。
	Clone() AttributeResolver
	// SameMounts 比较两份解析器是否共享相同挂载计划。
	SameMounts(other AttributeResolver) bool
	// MountedModifiers 借用当前挂载修正的只读包装。
	MountedModifiers() AttributeModifiers
	// ResolveAttributes 使用给定属性和公式上下文结算新属性，返回公式或数值错误。
	ResolveAttributes(attrs attribute.Table, ctx formula.GenericEvalContext, formulas formula.GenericRegistry) (attribute.Table, error)
	// ResolveAttributesWithProviderContext 结合各拥有者与供值器上下文结算新属性，不直接发布角色数值。
	ResolveAttributesWithProviderContext(attrs attribute.Table, ctx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext pipeline.ProviderFormulaContextFunc) (attribute.Table, error)
	// ResolveDerivedAttribute 按当前挂载和上下文计算一个派生属性槽；失败返回错误。
	ResolveDerivedAttribute(key string, slot model.AttributeSlotDef, value float64, attrs attribute.Table, ctx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext pipeline.ProviderFormulaContextFunc) (model.AttributeSlotDef, error)
	// MountCompiledModifierOwned 为实际拥有者与供值实例挂载编译后的属性修正。
	MountCompiledModifierOwned(owner, ref string, mod planbundle.CompiledModifier)
	// MountSnapshotModifierOwned 挂载已冻结金额的属性修正，不在后续结算时重取施加金额。
	MountSnapshotModifierOwned(owner, ref string, mod planbundle.CompiledModifier, value float64)
	// MountProviderModifiers 从供值器定义及公式表挂载其属性修正。
	MountProviderModifiers(owner, ref string, provider planbundle.CompiledProvider, formulas formula.GenericRegistry)
	// UnmountProviderOwned 移除该拥有者与供值实例的属性修正。
	UnmountProviderOwned(owner, ref string)
	// MountCompiledModifier 沿现有无拥有者入口挂载编译属性修正。
	MountCompiledModifier(ref string, mod planbundle.CompiledModifier)
}

// AttributeResolver keeps the immutable pipeline plan behind a value view.
type AttributeResolver struct{ value pipeline.AttributeResolver }

type AttributeModifiers struct {
	values []pipeline.MountedAttributeModifier
}

// DamageResolverAPI 列出效果侧伤害与治疗修正适配；不拥有角色数值或事件队列。
type DamageResolverAPI interface {
	// Clone 复制解析器值；内部挂载表沿既有不可变规则共享。
	Clone() DamageResolver
	// HasCommandStage 判断指定命令与阶段是否存在参与修正。
	HasCommandStage(command, stage string) bool
	// CollectForCommandChannelsWithMatches 按命令、通道和阶段收集修正，并保留实际匹配通道信息。
	CollectForCommandChannelsWithMatches(command string, channels []string, stage string) []pipeline.CollectedDamageModifier
	// CollectForHeal 按治疗方向与类别收集当前挂载修正。
	CollectForHeal(direction, category string) []pipeline.MountedDamageModifier
	// MountCompiledModifierOwned 为实际拥有者和供值实例挂载编译伤害修正。
	MountCompiledModifierOwned(owner, ref string, mod planbundle.CompiledModifier)
	// UnmountProviderOwned 移除该拥有者与供值实例的伤害修正。
	UnmountProviderOwned(owner, ref string)
}

type DamageResolver struct {
	value pipeline.DamageModifierResolver
}

// InstanceStateAPI 列出已提交效果集合的局部能力；其发布时点仍由执行协调者决定。
type InstanceStateAPI interface {
	// Providers 借用当前供值实例集合的只读包装。
	Providers() ProviderList
	// Shields 借用当前普通盾集合的只读包装。
	Shields() ShieldList
	// Attributes 取得当前属性挂载解析器值。
	Attributes() AttributeResolver
	// Damage 取得当前伤害挂载解析器值。
	Damage() DamageResolver
	// ResourceContributions 借用当前资源上限贡献的只读包装。
	ResourceContributions() ResourceContributions
	// SetProviders 替换该状态拥有的供值实例集合。
	SetProviders(v ProviderList)
	// SetShields 替换该状态拥有的普通盾集合。
	SetShields(v ShieldList)
	// SetAttributes 替换该状态拥有的属性挂载解析器。
	SetAttributes(v AttributeResolver)
	// SetDamage 替换该状态拥有的伤害挂载解析器。
	SetDamage(v DamageResolver)
	// SetResourceContributions 替换该状态拥有的资源上限贡献集合。
	SetResourceContributions(v ResourceContributions)
	// AppendProvider 以独立外层集合追加一个供值实例。
	AppendProvider(v Provider)
	// ReplaceProvider 以独立外层集合替换有效下标处的供值实例。
	ReplaceProvider(i int, v Provider)
	// RemoveProvider 以独立外层集合移除有效下标处的供值实例。
	RemoveProvider(i int)
	// MountAttributeCompiled 在当前效果状态中挂载指定归属的编译属性修正。
	MountAttributeCompiled(owner, ref string, mod planbundle.CompiledModifier)
	// MountAttributeSnapshot 在当前效果状态中挂载已冻结金额的属性修正。
	MountAttributeSnapshot(owner, ref string, mod planbundle.CompiledModifier, value float64)
	// UnmountAttribute 移除当前效果状态中指定归属的属性修正。
	UnmountAttribute(owner, ref string)
	// MountDamageCompiled 在当前效果状态中挂载指定归属的编译伤害修正。
	MountDamageCompiled(owner, ref string, mod planbundle.CompiledModifier)
	// UnmountDamage 移除当前效果状态中指定归属的伤害修正。
	UnmountDamage(owner, ref string)
}

type InstanceState struct {
	providers  ProviderList
	shields    ShieldList
	attributes AttributeResolver
	damage     DamageResolver
	resources  ResourceContributions
}

// InstanceChangeSetAPI 列出效果集合的暂存能力；只发布本包状态，不能代替执行层的跨子系统提交。
type InstanceChangeSetAPI interface {
	// Providers 借用本次暂存供值实例集合；保留历史时使用FreezeProviders。
	Providers() ProviderList
	// BaseProviders 借用首次投影前保存的基础供值集合。
	BaseProviders() ProviderList
	// Projected 判断本次暂存是否已建立供值投影。
	Projected() bool
	// ProjectProviders 首次保存基础集合并取得可写外层副本；重复调用不重建。
	ProjectProviders()
	// SetProviders 暂存供值集合并标记共享，后续编辑按写时复制隔离。
	SetProviders(v ProviderList)
	// AppendProvider 在取得独占外层集合后追加供值实例。
	AppendProvider(v Provider)
	// ReplaceProvider 在取得独占外层集合后替换有效下标的供值实例。
	ReplaceProvider(i int, v Provider)
	// RemoveProvider 在取得独占外层集合后移除有效下标的供值实例。
	RemoveProvider(i int)
	// Shields 借用本次暂存普通盾集合；结算不得绕过所属暂存规则写已提交集合。
	Shields() ShieldList
	// SetShields 保存本次盾结算投影，保持已提交与暂存的隔离责任。
	SetShields(v ShieldList)
	// Attributes 取得本次暂存属性挂载解析器值。
	Attributes() AttributeResolver
	// Damage 取得本次暂存伤害挂载解析器值。
	Damage() DamageResolver
	// ResourceContributions 借用本次暂存资源上限贡献集合。
	ResourceContributions() ResourceContributions
	// SetAttributes 保存本次暂存属性挂载解析器。
	SetAttributes(v AttributeResolver)
	// SetDamage 保存本次暂存伤害挂载解析器。
	SetDamage(v DamageResolver)
	// SetResourceContributions 保存本次暂存资源上限贡献集合。
	SetResourceContributions(v ResourceContributions)
	// Clone 复制暂存值并标记供值集合共享；后续供值编辑各自取得副本。
	Clone() InstanceChangeSet
	// Publish 交出本包投影并复制规范化盾集合；补齐缺失归属，不执行跨包提交。
	Publish(owner, source string) InstanceState
	// MountAttributeCompiled 在暂存解析器中挂载指定归属的编译属性修正。
	MountAttributeCompiled(owner, ref string, mod planbundle.CompiledModifier)
	// MountAttributeSnapshot 在暂存解析器中挂载已冻结金额的属性修正。
	MountAttributeSnapshot(owner, ref string, mod planbundle.CompiledModifier, value float64)
	// UnmountAttribute 从暂存解析器移除指定归属的属性修正。
	UnmountAttribute(owner, ref string)
	// MountDamageCompiled 在暂存解析器中挂载指定归属的编译伤害修正。
	MountDamageCompiled(owner, ref string, mod planbundle.CompiledModifier)
	// UnmountDamage 从暂存解析器移除指定归属的伤害修正。
	UnmountDamage(owner, ref string)
	// FreezeProviders 保留当前供值集合并标记共享，使后续供值编辑不改该外层视图。
	FreezeProviders() ProviderList
}

type InstanceChangeSet struct {
	providers         ProviderList
	baseProviders     ProviderList
	projected, shared bool
	shields           []pipeline.ShieldInstance
	attributes        AttributeResolver
	damage            DamageResolver
	resources         ResourceContributions
}

var _ AttributeResolverAPI = (*AttributeResolver)(nil)
var _ DamageResolverAPI = (*DamageResolver)(nil)
var _ InstanceStateAPI = (*InstanceState)(nil)
var _ InstanceChangeSetAPI = (*InstanceChangeSet)(nil)

func ObjectState(values map[string]interface{}) ObjectView {
	return ObjectView{values: copyObject(values)}
}
func (v ObjectView) Len() int                      { return len(v.values) }
func (v ObjectView) Present() bool                 { return v.values != nil }
func (v ObjectView) ToMap() map[string]interface{} { return copyObject(v.values) }
func copyObject(values map[string]interface{}) map[string]interface{} {
	if values == nil {
		return nil
	}
	out := make(map[string]interface{}, len(values))
	for key, value := range values {
		out[key] = copyObjectValue(value)
	}
	return out
}
func copyObjectValue(value interface{}) interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		return copyObject(typed)
	case []interface{}:
		if typed == nil {
			return typed
		}
		out := make([]interface{}, len(typed))
		for i, v := range typed {
			out[i] = copyObjectValue(v)
		}
		return out
	case []string:
		return append([]string(nil), typed...)
	default:
		return value
	}
}

func StatusContributions(values []StatusContribution) ContributionView {
	if values == nil {
		return ContributionView{}
	}
	out := make([]StatusContribution, len(values))
	copy(out, values)
	return ContributionView{values: out}
}
func (v ContributionView) Len() int                        { return len(v.values) }
func (v ContributionView) At(index int) StatusContribution { return v.values[index] }
func (v ContributionView) Snapshot() []StatusContribution {
	if v.values == nil {
		return nil
	}
	out := make([]StatusContribution, len(v.values))
	copy(out, v.values)
	return out
}

func (p Provider) Expired(now int64) bool { return p.ExpireAt > 0 && p.ExpireAt <= now }
func (p Provider) NeverExpires() bool     { return p.ExpireAt <= 0 }

func Providers(values []Provider) ProviderList {
	return ProviderList{values: append([]Provider(nil), values...)}
}
func (v ProviderList) Len() int              { return len(v.values) }
func (v ProviderList) At(index int) Provider { return v.values[index] }
func (v ProviderList) Present() bool         { return v.values != nil }
func (v ProviderList) Snapshot() []Provider  { return append([]Provider(nil), v.values...) }
func (v ProviderList) Find(ref string) (Provider, int, bool) {
	for i, p := range v.values {
		if p.ProviderRef == ref {
			return p, i, true
		}
	}
	return Provider{}, -1, false
}
func (v ProviderList) FindSourceTarget(definition, source, owner string, now int64) (Provider, int, bool) {
	for i, p := range v.values {
		if p.DefinitionRef == definition && p.Source == source && p.Owner == owner && !p.Expired(now) {
			return p, i, true
		}
	}
	return Provider{}, -1, false
}
func (v ProviderList) With(index int, value Provider) ProviderList {
	out := v.Snapshot()
	out[index] = value
	return ProviderList{out}
}
func (v ProviderList) Append(value Provider) ProviderList {
	out := make([]Provider, len(v.values), len(v.values)+1)
	copy(out, v.values)
	return ProviderList{append(out, value)}
}
func (v ProviderList) Remove(index int) ProviderList {
	out := make([]Provider, 0, len(v.values)-1)
	out = append(out, v.values[:index]...)
	out = append(out, v.values[index+1:]...)
	return ProviderList{out}
}
func (v ProviderList) Active(now int64) ProviderList {
	if len(v.values) == 0 {
		return ProviderList{}
	}
	out := make([]Provider, 0, len(v.values))
	for _, p := range v.values {
		if !p.Expired(now) {
			out = append(out, p)
		}
	}
	return ProviderList{out}
}

func (s Shield) Expired(now int64) bool { return s.ExpireAt > 0 && s.ExpireAt <= now }

func Shields(values []Shield) ShieldList {
	out := make([]pipeline.ShieldInstance, len(values))
	for i, value := range values {
		out[i] = shieldValue(value)
	}
	return ShieldList{values: out}
}
func (v ShieldList) Len() int      { return len(v.values) }
func (v ShieldList) Present() bool { return v.values != nil }
func (v ShieldList) At(i int) Shield {
	s := v.values[i]
	return Shield{s.ShieldRef, s.DefinitionRef, s.LifecycleProviderRef, s.Source, s.Owner, s.Remaining, s.Priority, s.ExpireAt, ObjectView{s.State}}
}
func (v ShieldList) Snapshot() []Shield {
	out := make([]Shield, v.Len())
	for i := range out {
		out[i] = v.At(i)
	}
	return out
}
func (v ShieldList) Append(value Shield) ShieldList {
	out := make([]pipeline.ShieldInstance, len(v.values), len(v.values)+1)
	copy(out, v.values)
	return ShieldList{values: append(out, shieldValue(value))}
}
func (v ShieldList) Remove(index int) ShieldList {
	return v.Slice(0, index).AppendList(v.Slice(index+1, v.Len()))
}
func (v ShieldList) WithoutProvider(ref string) ShieldList {
	first := -1
	for i, value := range v.values {
		if value.LifecycleProviderRef == ref {
			first = i
			break
		}
	}
	if first < 0 {
		return v
	}
	out := make([]pipeline.ShieldInstance, 0, v.Len()-1)
	for _, value := range v.values {
		if value.LifecycleProviderRef != ref {
			out = append(out, value)
		}
	}
	return ShieldList{values: out}
}

func ResourceMaxContributions(values []ResourceContribution) ResourceContributions {
	return ResourceContributions{append([]ResourceContribution(nil), values...)}
}
func (v ResourceContributions) Len() int                      { return len(v.values) }
func (v ResourceContributions) At(i int) ResourceContribution { return v.values[i] }
func (v ResourceContributions) Contains(ref string, index uint16) bool {
	for _, value := range v.values {
		if value.ProviderRef == ref && value.ModifierIndex == index {
			return true
		}
	}
	return false
}
func (v ResourceContributions) Append(value ResourceContribution) ResourceContributions {
	out := make([]ResourceContribution, len(v.values), len(v.values)+1)
	copy(out, v.values)
	return ResourceContributions{append(out, value)}
}

func (v AttributeModifiers) Len() int                                   { return len(v.values) }
func (v AttributeModifiers) At(i int) pipeline.MountedAttributeModifier { return v.values[i] }
func (r AttributeResolver) Clone() AttributeResolver                    { return r }
func (r AttributeResolver) SameMounts(other AttributeResolver) bool {
	return r.value.SameMounts(other.value)
}
func (r AttributeResolver) MountedModifiers() AttributeModifiers {
	return AttributeModifiers{r.value.MountedModifiers()}
}
func (r AttributeResolver) ResolveAttributes(attrs attribute.Table, ctx formula.GenericEvalContext, formulas formula.GenericRegistry) (attribute.Table, error) {
	return r.value.ResolveAttributes(attrs, ctx, formulas)
}
func (r AttributeResolver) ResolveAttributesWithProviderContext(attrs attribute.Table, ctx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext pipeline.ProviderFormulaContextFunc) (attribute.Table, error) {
	return r.value.ResolveAttributesWithProviderContext(attrs, ctx, formulas, providerContext)
}
func (r AttributeResolver) ResolveDerivedAttribute(key string, slot model.AttributeSlotDef, value float64, attrs attribute.Table, ctx formula.GenericEvalContext, formulas formula.GenericRegistry, providerContext pipeline.ProviderFormulaContextFunc) (model.AttributeSlotDef, error) {
	return r.value.ResolveDerivedAttribute(key, slot, value, attrs, ctx, formulas, providerContext)
}
func (r *AttributeResolver) MountCompiledModifierOwned(owner, ref string, mod planbundle.CompiledModifier) {
	r.value.MountCompiledModifierOwned(owner, ref, mod)
}
func (r *AttributeResolver) MountSnapshotModifierOwned(owner, ref string, mod planbundle.CompiledModifier, value float64) {
	r.value.MountSnapshotModifierOwned(owner, ref, mod, value)
}
func (r *AttributeResolver) MountProviderModifiers(owner, ref string, provider planbundle.CompiledProvider, formulas formula.GenericRegistry) {
	r.value.MountProviderModifiers(owner, ref, provider, formulas)
}
func (r *AttributeResolver) UnmountProviderOwned(owner, ref string) {
	r.value.UnmountProviderOwned(owner, ref)
}

func (r DamageResolver) Clone() DamageResolver { return r }
func (r DamageResolver) HasCommandStage(command, stage string) bool {
	return r.value.HasCommandStage(command, stage)
}
func (r DamageResolver) CollectForCommandChannelsWithMatches(command string, channels []string, stage string) []pipeline.CollectedDamageModifier {
	return r.value.CollectForCommandChannelsWithMatches(command, channels, stage)
}
func (r DamageResolver) CollectForHeal(direction, category string) []pipeline.MountedDamageModifier {
	return r.value.CollectForHeal(direction, category)
}
func (r *DamageResolver) MountCompiledModifierOwned(owner, ref string, mod planbundle.CompiledModifier) {
	r.value.MountCompiledModifierOwned(owner, ref, mod)
}
func (r *DamageResolver) UnmountProviderOwned(owner, ref string) {
	r.value.UnmountProviderOwned(owner, ref)
}

func NewInstances(providers ProviderList, shields ShieldList, resolver AttributeResolver, damage DamageResolver, resources ResourceContributions) InstanceState {
	return InstanceState{providers: providers, shields: shields, attributes: resolver, damage: damage, resources: resources}
}
func (s InstanceState) Providers() ProviderList                           { return s.providers }
func (s InstanceState) Shields() ShieldList                               { return s.shields }
func (s InstanceState) Attributes() AttributeResolver                     { return s.attributes }
func (s InstanceState) Damage() DamageResolver                            { return s.damage }
func (s InstanceState) ResourceContributions() ResourceContributions      { return s.resources }
func (s *InstanceState) SetProviders(v ProviderList)                      { s.providers = v }
func (s *InstanceState) SetShields(v ShieldList)                          { s.shields = v }
func (s *InstanceState) SetAttributes(v AttributeResolver)                { s.attributes = v }
func (s *InstanceState) SetDamage(v DamageResolver)                       { s.damage = v }
func (s *InstanceState) SetResourceContributions(v ResourceContributions) { s.resources = v }
func (s *InstanceState) AppendProvider(v Provider)                        { s.providers = s.providers.Append(v) }
func (s *InstanceState) ReplaceProvider(i int, v Provider)                { s.providers = s.providers.With(i, v) }
func (s *InstanceState) RemoveProvider(i int)                             { s.providers = s.providers.Remove(i) }

func StageInstances(s InstanceState, now int64) InstanceChangeSet {
	return InstanceChangeSet{providers: s.providers, shared: true, shields: pipeline.ActiveShields(s.shields.values, now), attributes: s.attributes, damage: s.damage, resources: s.resources}
}
func (s InstanceChangeSet) Providers() ProviderList     { return s.providers }
func (s InstanceChangeSet) BaseProviders() ProviderList { return s.baseProviders }
func (s InstanceChangeSet) Projected() bool             { return s.projected }
func (s *InstanceChangeSet) ProjectProviders() {
	if s.projected {
		return
	}
	s.baseProviders = s.providers
	s.projected = true
	s.shared = true
	s.writableProviders()
}
func (s *InstanceChangeSet) writableProviders() {
	if s.shared {
		s.providers = Providers(s.providers.values)
		s.shared = false
	}
}
func (s *InstanceChangeSet) SetProviders(v ProviderList) { s.providers = v; s.shared = true }
func (s *InstanceChangeSet) AppendProvider(v Provider) {
	s.writableProviders()
	s.providers.values = append(s.providers.values, v)
}
func (s *InstanceChangeSet) ReplaceProvider(i int, v Provider) {
	s.writableProviders()
	s.providers.values[i] = v
}
func (s *InstanceChangeSet) RemoveProvider(i int) {
	s.writableProviders()
	s.providers.values = append(s.providers.values[:i], s.providers.values[i+1:]...)
}
func (s InstanceChangeSet) Shields() ShieldList {
	return ShieldList{values: s.shields}
}
func (s *InstanceChangeSet) SetShields(v ShieldList) {
	s.shields = v.values
}
func (s InstanceChangeSet) Attributes() AttributeResolver                     { return s.attributes }
func (s InstanceChangeSet) Damage() DamageResolver                            { return s.damage }
func (s InstanceChangeSet) ResourceContributions() ResourceContributions      { return s.resources }
func (s *InstanceChangeSet) SetAttributes(v AttributeResolver)                { s.attributes = v }
func (s *InstanceChangeSet) SetDamage(v DamageResolver)                       { s.damage = v }
func (s *InstanceChangeSet) SetResourceContributions(v ResourceContributions) { s.resources = v }
func (s *InstanceChangeSet) Clone() InstanceChangeSet                         { s.shared = true; return *s }
func (s *InstanceChangeSet) Publish(owner, source string) InstanceState {
	s.shared = true
	return InstanceState{providers: s.providers, shields: ShieldList{values: pipeline.NormalizeShields(s.shields, owner, source)}, attributes: s.attributes, damage: s.damage, resources: s.resources}
}

func (v ContributionView) Present() bool { return v.values != nil }
func (v ContributionView) Append(value StatusContribution) ContributionView {
	out := make([]StatusContribution, len(v.values), len(v.values)+1)
	copy(out, v.values)
	return ContributionView{append(out, value)}
}
func (v ProviderList) Slice(start, end int) ProviderList { return ProviderList{v.values[start:end]} }
func (v ProviderList) AppendList(other ProviderList) ProviderList {
	out := make([]Provider, len(v.values), len(v.values)+len(other.values))
	copy(out, v.values)
	return ProviderList{append(out, other.values...)}
}
func (v ProviderList) RemoveRef(ref string) ProviderList {
	out := make([]Provider, 0, len(v.values))
	for _, value := range v.values {
		if value.ProviderRef != ref {
			out = append(out, value)
		}
	}
	return ProviderList{out}
}
func (v ShieldList) Slice(start, end int) ShieldList {
	return ShieldList{values: v.values[start:end]}
}
func (v ShieldList) AppendList(other ShieldList) ShieldList {
	out := make([]pipeline.ShieldInstance, v.Len(), v.Len()+other.Len())
	copy(out, v.values)
	return ShieldList{values: append(out, other.values...)}
}
func (v ShieldList) With(index int, value Shield) ShieldList {
	out := append([]pipeline.ShieldInstance(nil), v.values...)
	out[index] = shieldValue(value)
	return ShieldList{values: out}
}
func (v ShieldList) RemoveExpired(now int64) ShieldList {
	first := -1
	for i, value := range v.values {
		if value.Remaining <= 0 || value.Expired(now) {
			first = i
			break
		}
	}
	if first < 0 {
		return v
	}
	out := make([]pipeline.ShieldInstance, 0, v.Len()-1)
	for _, value := range v.values {
		if value.Remaining > 0 && !value.Expired(now) {
			out = append(out, value)
		}
	}
	return ShieldList{values: out}
}
func (s *InstanceState) MountAttributeCompiled(owner, ref string, mod planbundle.CompiledModifier) {
	s.attributes.MountCompiledModifierOwned(owner, ref, mod)
}
func (s *InstanceState) MountAttributeSnapshot(owner, ref string, mod planbundle.CompiledModifier, value float64) {
	s.attributes.MountSnapshotModifierOwned(owner, ref, mod, value)
}
func (s *InstanceState) UnmountAttribute(owner, ref string) {
	s.attributes.UnmountProviderOwned(owner, ref)
}
func (s *InstanceState) MountDamageCompiled(owner, ref string, mod planbundle.CompiledModifier) {
	s.damage.MountCompiledModifierOwned(owner, ref, mod)
}
func (s *InstanceState) UnmountDamage(owner, ref string) { s.damage.UnmountProviderOwned(owner, ref) }
func NewInstanceChanges(providers ProviderList, shields ShieldList, attributes AttributeResolver, damage DamageResolver, resources ResourceContributions) InstanceChangeSet {
	out := InstanceChangeSet{providers: providers, shared: true, attributes: attributes, damage: damage, resources: resources}
	out.SetShields(shields)
	return out
}
func (s *InstanceChangeSet) MountAttributeCompiled(owner, ref string, mod planbundle.CompiledModifier) {
	s.attributes.MountCompiledModifierOwned(owner, ref, mod)
}
func (s *InstanceChangeSet) MountAttributeSnapshot(owner, ref string, mod planbundle.CompiledModifier, value float64) {
	s.attributes.MountSnapshotModifierOwned(owner, ref, mod, value)
}
func (s *InstanceChangeSet) UnmountAttribute(owner, ref string) {
	s.attributes.UnmountProviderOwned(owner, ref)
}
func (s *InstanceChangeSet) MountDamageCompiled(owner, ref string, mod planbundle.CompiledModifier) {
	s.damage.MountCompiledModifierOwned(owner, ref, mod)
}
func (s *InstanceChangeSet) UnmountDamage(owner, ref string) {
	s.damage.UnmountProviderOwned(owner, ref)
}

func (v ShieldList) ResolveCommand(cmd pipeline.Command, attrs attribute.Table, now int64) (pipeline.CommandResult, attribute.Table, ShieldList) {
	result, next := pipeline.ResolveCommand(cmd, pipeline.CombatantView{Attributes: attrs, Shields: v.values}, now)
	return result, next.Attributes, ShieldList{values: next.Shields}
}
func (v ShieldList) ApplyDamage(raw, mitigated float64, attrs attribute.Table, now int64, capture bool) (pipeline.DamageOutcome, attribute.Table, ShieldList) {
	result, next := pipeline.ApplyMitigatedDamage(raw, mitigated, pipeline.CombatantView{Attributes: attrs, Shields: v.values}, now, capture)
	return result, next.Attributes, ShieldList{values: next.Shields}
}
func (v ShieldList) ExecuteThreshold(cmd pipeline.Command, attrs attribute.Table) (pipeline.ExecuteOutcome, attribute.Table, ShieldList) {
	result, next := pipeline.ResolveExecuteThreshold(cmd, pipeline.CombatantView{Attributes: attrs, Shields: v.values})
	return result, next.Attributes, ShieldList{values: next.Shields}
}

func (r *AttributeResolver) MountCompiledModifier(ref string, mod planbundle.CompiledModifier) {
	r.value.MountCompiledModifier(ref, mod)
}

func (s *InstanceChangeSet) FreezeProviders() ProviderList { s.shared = true; return s.providers }

func shieldValue(v Shield) pipeline.ShieldInstance {
	return pipeline.ShieldInstance{ShieldRef: v.ShieldRef, DefinitionRef: v.DefinitionRef, LifecycleProviderRef: v.LifecycleProviderRef, Source: v.Source, Owner: v.Owner, Remaining: v.Remaining, Priority: v.Priority, ExpireAt: v.ExpireAt, State: v.State.values}
}
