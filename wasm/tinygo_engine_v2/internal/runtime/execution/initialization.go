// 原始与物化输入的准入准备、所属状态恢复及初始化组合。
package execution

import (
	"sort"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/admission"
	"tinygo_engine_v2/internal/runtime/execution/operation"
	"tinygo_engine_v2/internal/scheduler"
)

type initialSourceReads Engine

type fixedEquipmentHealthReads map[string]combatantRuntime

var _ admission.InitialSourceReads = (*initialSourceReads)(nil)
var _ admission.FixedEquipmentHealthReads = fixedEquipmentHealthReads(nil)

type initialNumericAttributes struct {
	actors   map[string]combatantRuntime
	compiled *planbundle.CompiledSession
	time     int64
}

var _ operation.InitialAttributeWork = (*initialNumericAttributes)(nil)

func (r *initialNumericAttributes) InitialAttributeOrder() []string {
	keys := make([]string, 0, len(r.actors))
	for key := range r.actors {
		keys = append(keys, key)
	}
	return keys
}

func (r *initialNumericAttributes) InitialAttributeState(owner string) (operation.LiveAttributeState, bool) {
	c, exists := r.actors[owner]
	return operation.LiveAttributeState{Attributes: c.attributesView(), Resolver: c.instances.Attributes()}, exists
}

func (r *initialNumericAttributes) InitialAttributeProviders(owner, castProxy string) pipeline.ProviderFormulaContextFunc {
	return materializedProviderFormulaContext(r.actors, *r.compiled, owner, castProxy, r.time)
}

func (r *initialNumericAttributes) PublishInitialAttributes(owner string, attrs attribute.Table) {
	c := r.actors[owner]
	c.setAttributes(attrs)
	r.actors[owner] = c
}

func materializeCombatants(snapshot model.Snapshot, compiled planbundle.CompiledSession, formulas formula.Library, sessionID string) (map[string]combatantRuntime, *model.EngineError) {
	if err := validateShieldLifecycleSnapshot(snapshot, compiled, sessionID); err != nil {
		return nil, err
	}
	if err := validateProviderElapsedSnapshot(snapshot, compiled, sessionID); err != nil {
		return nil, err
	}
	out := make(map[string]combatantRuntime, len(snapshot.Combatants))
	layout := compiled.AttributeLayout
	var additional []string
	for _, c := range snapshot.Combatants {
		for key := range c.Attributes {
			additional = append(additional, key)
		}
	}
	if layout == nil {
		layout = attribute.NewLayout(additional)
	} else {
		layout = layout.Extend(additional)
	}
	combatantKeys := make(map[string]bool, len(snapshot.Combatants))
	for _, c := range snapshot.Combatants {
		combatantKeys[c.Key] = true
	}
	for i, c := range snapshot.Combatants {
		attrs := c.Attributes
		resources := c.Resources
		if resources == nil {
			resources = map[string]model.ResourceSlotDef{}
		}
		path := "initialSnapshot.combatants[" + itoa(uint32(i)) + "]"
		providers, resolver, err := effectpkg.RestoreProviders(c.Providers, c.Key, compiled, combatantKeys, path, compiled.SchemaHash, compiled.RulesHash, sessionID)
		if err != nil {
			return nil, err
		}
		shields := effectpkg.RestoreShields(c.Shields, c.Key)
		out[c.Key] = combatantRuntime{
			instances:     effectpkg.NewInstances(providers, shields, resolver, effectpkg.DamageResolver{}, effectpkg.ResourceContributions{}),
			numbers:       actor.New(c.Key, attribute.FromMap(attrs, layout), resources),
			cooldowns:     materializeCooldowns(c.Cooldowns, c.Key),
			providerState: effectpkg.RestoreBags(c.ProviderState),
		}
	}

	remountAllProviderModifiers(out, compiled)
	for key, c := range out {
		resolver := c.instances.Attributes()
		damageResolver := c.instances.Damage()
		operation.MountRuleModifiers(&resolver, &damageResolver, key, compiled.RuleModifiers)
		c.instances.SetAttributes(resolver)
		c.instances.SetDamage(damageResolver)
		out[key] = c
	}
	work := initialNumericAttributes{actors: out, compiled: &compiled, time: snapshot.TimeMs}
	if err := operation.PrepareInitialAttributes(operation.AttributeRules{Plan: &compiled, Formulas: &formulas, SessionID: sessionID}, &work); err != nil {
		return nil, err
	}
	return out, nil
}

func cloneAttributeMap(src map[string]model.AttributeSlotDef) map[string]model.AttributeSlotDef {
	dst := make(map[string]model.AttributeSlotDef, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func cloneResourceMap(src map[string]model.ResourceSlotDef) map[string]model.ResourceSlotDef {
	dst := make(map[string]model.ResourceSlotDef, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func cloneSnapshot(src model.Snapshot) model.Snapshot {
	dst := src
	dst.Combatants = make([]model.CombatantSnapshot, len(src.Combatants))
	for i, c := range src.Combatants {
		dst.Combatants[i] = c
		if c.Attributes != nil {
			dst.Combatants[i].Attributes = cloneAttributeMap(c.Attributes)
		}
		if c.Resources != nil {
			dst.Combatants[i].Resources = cloneResourceMap(c.Resources)
		}
	}
	if src.UseTriggerLedger != nil {
		dst.UseTriggerLedger = append([]model.UseTriggerLedgerEntry(nil), src.UseTriggerLedger...)
	} else {
		dst.UseTriggerLedger = []model.UseTriggerLedgerEntry{}
	}
	if src.UseAmountBudgets != nil {
		dst.UseAmountBudgets = append([]model.UseAmountBudgetEntry(nil), src.UseAmountBudgets...)
		for index, row := range dst.UseAmountBudgets {
			if row.Target != nil {
				target := *row.Target
				dst.UseAmountBudgets[index].Target = &target
			}
		}
	}
	return dst
}

func validateFixedEquipmentHealth(compiled planbundle.CompiledSession, actors map[string]combatantRuntime, sessionID string) *model.EngineError {
	return admission.ValidateFixedEquipmentHealth(admission.Input{Compiled: &compiled, Identity: admission.Identity{SchemaHash: compiled.SchemaHash, RulesHash: compiled.RulesHash, SessionID: sessionID}}, fixedEquipmentHealthReads(actors))
}

func (s *Engine) validateBasicAttackInitialSnapshot() *model.EngineError {
	return s.validateInitialSelection(true)
}

func (s *Engine) validateInitialSelection(checkMaximum bool) *model.EngineError {
	return admission.ValidateInitialSelection(s.admissionInput(model.SelectorSource), s.req.InitialSnapshot.Combatants, checkMaximum)
}

func (s *Engine) validateIdleBasicAttackProvider(provider planbundle.CompiledProvider, owner, ref string) *model.EngineError {
	return admission.ValidateIdleBasicAttackProvider(s.admissionInput(owner), provider, owner, ref, validBasicAttackAmmoProvider(provider), (*initialSourceReads)(s))
}

// 只借用当前准入涉及的双方数值，不将执行器或状态集合传入子包。
func (s *Engine) admissionInput(owner string) admission.Input {
	out := admission.Input{Compiled: &s.compiled, Formulas: &s.formulas, Identity: admission.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID}}
	for i, key := range [2]string{owner, opponentCombatantKey(owner)} {
		value, present := s.combatants[key]
		out.Actors[i] = admission.Actor{Key: key, Attributes: value.attributesView(), Resources: value.resourceView(), Present: present}
	}
	return out
}

func (s *Engine) validateEquipmentPeriodicProvider(provider planbundle.CompiledProvider, owner, reference string) *model.EngineError {
	return admission.ValidateEquipmentPeriodicProvider(s.admissionInput(owner), provider, owner, reference, (*initialSourceReads)(s))
}

func (s *Engine) validateStaticInitializer(provider planbundle.CompiledProvider, owner, reference string) *model.EngineError {
	return admission.ValidateStaticInitializer(s.admissionInput(owner), provider, owner, reference, (*initialSourceReads)(s))
}

func (s *Engine) validateStaticInitializationListener(listener planbundle.CompiledListener) *model.EngineError {
	input := admission.Input{Compiled: &s.compiled, Formulas: &s.formulas, Identity: admission.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID}}
	return admission.ValidateStaticInitializationListener(input, listener, (*initialSourceReads)(s))
}

func (s *Engine) validateTargetTimingProvider(provider planbundle.CompiledProvider, owner, reference string) *model.EngineError {
	return admission.ValidateTargetTimingProvider(s.admissionInput(owner), provider, owner, reference, (*initialSourceReads)(s))
}

func (s *Engine) addTargetTimingOperations(provider planbundle.CompiledProvider, allowed map[string]bool) {
	admission.AddTargetTimingOperations(s.compiled, provider, allowed)
}

// 永久技能伴随来源使用真实目标状态驱动周期；装备固定周期仍走自己的准入。
func (s *Engine) validateTargetWindowProvider(provider planbundle.CompiledProvider, owner, reference string) *model.EngineError {
	return admission.ValidateTargetWindowProvider(s.admissionInput(owner), provider, owner, reference, (*initialSourceReads)(s))
}

func (s *Engine) validateEquipmentHitListener(listener planbundle.CompiledListener) *model.EngineError {
	sources := (*initialSourceReads)(s).InitialListenerSources(listener)
	return admission.ValidateEquipmentHitListener(s.admissionInput(listener.OwnerCombatantKey), listener, sources)
}

func (s *Engine) validateEquipmentHitProvider(provider planbundle.CompiledProvider, owner, reference string) *model.EngineError {
	return admission.ValidateEquipmentHitProvider(s.admissionInput(owner), provider, owner, reference, (*initialSourceReads)(s))
}

func (s *Engine) seedSourceInitialization() *model.EngineError {
	executor := s.lifecycleExecutor()
	enabled, err := executor.SourceInitializationStart(s.loop.StartMs(), s.req.InitialSnapshot)
	if err != nil || !enabled {
		return err
	}
	if err := s.validateBasicAttackInitialSnapshot(); err != nil {
		return err
	}
	if err := executor.SourceInitializationState(s.req.InitialSnapshot); err != nil {
		return err
	}
	keys := make([]string, 0, len(s.combatants))
	for key := range s.combatants {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	s.effectInitialization.Reset(len(keys))
	for _, key := range keys {
		if !s.pushCombatEvent(scheduler.GenericEvent{
			TimeMs: 0, Category: scheduler.GenericCategorySourceInitialization,
			Kind: scheduler.GenericEventSourceInitialized, DriverEntryIndex: -1,
			ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: key},
		}) {
			break
		}
	}
	return nil
}

func (s *Engine) handleSourceInitialized(event scheduler.GenericEvent) *model.EngineError {
	key := event.ProviderInstanceRef.CombatantKey
	if !s.effectInitialization.Begin(s.loop.TimeMs(), s.combatantExists(key)) {
		return s.basicAttackErr("invalid native source initialization event", "initialSnapshot")
	}
	s.currentEventCommands = 0
	defer s.effectInitialization.End()
	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, key, key, "")
	frame := &frameStorage
	initialization := emittedEvent{
		eventType: model.EventTypeSourceInitialized, sourceKey: key, targetKey: key,
		types:    []string{model.EventTypeSourceInitialized},
		snapshot: frame.captureEmitSnapshot(model.EventTypeSourceInitialized, key, key),
	}
	if err := s.dispatchListeners(initialization, 0); err != nil {
		return err
	}
	if s.processFailure != nil {
		return s.processFailure
	}
	s.effectInitialization.Complete()
	s.recordEvidenceLazy("source_initialized", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: 0, Kind: "source_initialized", Ref: key,
			Data: map[string]interface{}{"eventSource": key, "currentTarget": key, "completed": true}}
	})
	return nil
}

func (s *Engine) initStateOnExpireSources() *model.EngineError {
	input := admission.Input{Compiled: &s.compiled, Formulas: &s.formulas, Identity: admission.Identity{SchemaHash: s.compiled.SchemaHash, RulesHash: s.compiled.RulesHash, SessionID: s.req.SessionID}}
	return admission.ValidateStateOnExpireSources(input, s.req.DriverPlan.Entries, (*initialSourceReads)(s))
}

func (s *Engine) observeMomentStatusContributions(instances effectpkg.ProviderList, snapshots []model.CombatantProviderSnapshot) *model.EngineError {
	executor := s.lifecycleExecutor()
	return executor.ObserveMomentStatuses(instances, snapshots, s.loop.TimeMs())
}

func (r fixedEquipmentHealthReads) InitialHealthAttributes(owner string) attribute.Table {
	return r[owner].attributesView()
}

func (r *initialSourceReads) InitialAbilityReference(reference, source, target string) string {
	return normalizeAbilityRef(reference, source, target)
}

func (r *initialSourceReads) InitialListenerMatches(listener planbundle.CompiledListener, event, source, target string, types typeset.TypeSet) bool {
	return (*Engine)(r).listenerMatchesEvent(listener, emittedEvent{eventType: event, sourceKey: source, targetKey: target}, types)
}

func (r *initialSourceReads) InitialProviderView(owner, reference string) admission.InitialProvider {
	instance, _, present := r.combatants[owner].instances.Providers().Find(reference)
	return admission.InitialProvider{Present: present, DefinitionIndex: instance.DefinitionIndex, DefinitionRef: instance.DefinitionRef, Source: instance.Source, Owner: instance.Owner, Stacks: instance.Stacks, ExpireAt: instance.ExpireAt, StateCount: instance.State.Len()}
}

func (r *initialSourceReads) InitialListenerSources(listener planbundle.CompiledListener) admission.ListenerSources {
	s := (*Engine)(r)
	sources := admission.ListenerSources{Selection: admission.SourceSelection{SkillBindings: s.plannedSkillBindings(), BasicAttack: s.req.DriverPlan.BasicAttack}}
	owner := s.combatants[listener.OwnerCombatantKey]
	if index := compiledStateDefinitionIndex(s.compiled, listener.OwnerCombatantKey, listener.OwnerProviderRef, owner.instances.Providers()); index >= 0 {
		sources.StateFields = s.compiled.Providers[index].StateFields
	}
	return sources
}

func (r *initialSourceReads) InitialActors(owner string) [2]admission.Actor {
	return (*Engine)(r).admissionInput(owner).Actors
}

func (r *initialSourceReads) InitialDriverReference(entry model.DriverEntry) string {
	s := (*Engine)(r)
	source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	target, _ := s.resolveDriverCombatantKey(entry.Target, source)
	return normalizeAbilityRef(entry.AbilityRef, source, target)
}
