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

type ContributionView struct{ values []StatusContribution }

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

func (p Provider) Expired(now int64) bool { return p.ExpireAt > 0 && p.ExpireAt <= now }
func (p Provider) NeverExpires() bool     { return p.ExpireAt <= 0 }

type ProviderList struct{ values []Provider }

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

type Shield struct {
	ShieldRef, DefinitionRef, LifecycleProviderRef, Source, Owner string
	Remaining                                                     float64
	Priority                                                      int16
	ExpireAt                                                      int64
	State                                                         ObjectView
}

func (s Shield) Expired(now int64) bool { return s.ExpireAt > 0 && s.ExpireAt <= now }

type ShieldList struct {
	values []pipeline.ShieldInstance
}

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

type ResourceContribution struct {
	ProviderRef, Source, UseRef    string
	DefinitionIndex, ModifierIndex uint16
	Value                          float64
}
type ResourceContributions struct{ values []ResourceContribution }

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

// AttributeResolver keeps the immutable pipeline plan behind a value view.
type AttributeResolver struct{ value pipeline.AttributeResolver }
type AttributeModifiers struct {
	values []pipeline.MountedAttributeModifier
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

type DamageResolver struct {
	value pipeline.DamageModifierResolver
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

type InstanceState struct {
	providers  ProviderList
	shields    ShieldList
	attributes AttributeResolver
	damage     DamageResolver
	resources  ResourceContributions
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

type InstanceChangeSet struct {
	providers         ProviderList
	baseProviders     ProviderList
	projected, shared bool
	shields           []pipeline.ShieldInstance
	attributes        AttributeResolver
	damage            DamageResolver
	resources         ResourceContributions
}

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
