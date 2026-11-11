// 原始与物化输入的准入准备、所属状态恢复及初始化组合。
package execution

import (
	"math"
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
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
	"tinygo_engine_v2/internal/scheduler"
)

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
		mountRuleModifiers(&resolver, &damageResolver, key, compiled)
		c.instances.SetAttributes(resolver)
		c.instances.SetDamage(damageResolver)
		out[key] = c
	}
	// Resolve with same-combatant eval first, then cross-combatant context.
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: c.attributesView(),
			TargetAttrs: c.attributesView(),
		}
		resolvedAttributes, resolveErr := c.instances.Attributes().ResolveAttributesWithProviderContext(
			c.attributesView(), evalCtx, formulas,
			materializedProviderFormulaContext(out, compiled, key, "", snapshot.TimeMs),
		)
		c.setAttributes(resolvedAttributes)

		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		out[key] = c
	}
	// Re-resolve with cross-combatant eval context after both sides exist.
	sourceAttrs := attribute.Table{}
	targetAttrs := attribute.Table{}
	if src, ok := out[model.SelectorSource]; ok {
		sourceAttrs = src.attributesView()
	}
	if tgt, ok := out[model.SelectorTarget]; ok {
		targetAttrs = tgt.attributesView()
	}
	for key, c := range out {
		evalCtx := formula.GenericEvalContext{
			SourceAttrs: sourceAttrs,
			TargetAttrs: targetAttrs,
		}
		// Same-combatant cast-proxy default remains target (historical materialize semantics).
		castProxy := model.SelectorTarget
		resolvedAttributes, resolveErr := c.instances.Attributes().ResolveAttributesWithProviderContext(
			c.attributesView(), evalCtx, formulas,
			materializedProviderFormulaContext(out, compiled, key, castProxy, snapshot.TimeMs),
		)
		c.setAttributes(resolvedAttributes)

		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}
		out[key] = c
	}
	for _, key := range []string{"source", "target"} {
		actor, exists := out[key]
		if !exists {
			continue
		}
		var providerContext pipeline.ProviderFormulaContextFunc
		if compiled.HasProviderElapsedReads || compiled.HasFiniteModifierExpiry {
			providerContext = materializedProviderFormulaContext(out, compiled, key, model.SelectorTarget, snapshot.TimeMs)
		}
		resolved, resolveErr := evaluation.ResolveDerivedAttributes(compiled.AttributeDerivations, formulas, key, actor.attributesView(), actor.instances.Attributes(), out["source"].attributesView(), out["target"].attributesView(), providerContext)
		if resolveErr != nil {
			return nil, preserveFormulaIssue(resolveErr, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, resolveErr.Error(), "initialSnapshot.combatants."+key+".attributes", "", compiled.SchemaHash, compiled.RulesHash, sessionID))
		}

		actor.setAttributes(resolved)
		out[key] = actor
	}
	return out, nil
}

func mountRuleModifiers(resolver *effectpkg.AttributeResolver, damageResolver *effectpkg.DamageResolver, combatantKey string, compiled planbundle.CompiledSession) {
	for _, mod := range compiled.RuleModifiers {
		if mod.Kind == "pipeline" {
			mountRulePipelineModifier(damageResolver, combatantKey, mod)
			continue
		}
		if mod.Kind != "attribute" && mod.Kind != "" {
			continue
		}
		selector := pipeline.ModifierTargetCombatantSelector(mod.Target)
		switch selector {
		case "":
			// Bare attribute key: apply to both combatants is too broad; skip unless path is explicit.
			// Provider-mounted bare keys remain supported via MountProviderModifiers.
			continue
		case model.SelectorSource:
			if combatantKey != model.SelectorSource {
				continue
			}
		case model.SelectorTarget:
			if combatantKey != model.SelectorTarget {
				continue
			}
		case model.SelectorSelf, model.SelectorOpponent:
			// Rule-level self/opponent has no entry context; treat as source/target aliases.
			if selector == model.SelectorSelf && combatantKey != model.SelectorSource {
				continue
			}
			if selector == model.SelectorOpponent && combatantKey != model.SelectorTarget {
				continue
			}
		default:
			if combatantKey != selector {
				continue
			}
		}
		resolver.MountCompiledModifier("rules", mod)
	}
}

// mountRulePipelineModifier mounts rules pipeline modifiers by stage ownership:
// command=crit + outgoing_pre_mitigation → source;
// incoming_crit_part_post_mitigation + incoming_post_mitigation → target.
func mountRulePipelineModifier(damageResolver *effectpkg.DamageResolver, combatantKey string, mod planbundle.CompiledModifier) {
	if damageResolver == nil {
		return
	}
	switch mod.Command {
	case "crit":
		switch mod.Stage {
		case "crit_chance_pre_settlement", "crit_multiplier_forced_branch", "crit_multiplier_natural_branch":
			if combatantKey != model.SelectorSource {
				return
			}
		default:
			return
		}
	case "damage":
		switch mod.Stage {
		case "outgoing_pre_mitigation":
			if combatantKey != model.SelectorSource {
				return
			}
		case "incoming_crit_part_post_mitigation", "incoming_post_mitigation":
			if combatantKey != model.SelectorTarget {
				return
			}
		default:
			return
		}
	case "heal":
	default:
		return
	}
	damageResolver.MountCompiledModifierOwned("", "rules", mod)
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
	return dst
}

func validateFixedEquipmentHealth(compiled planbundle.CompiledSession, actors map[string]combatantRuntime, sessionID string) *model.EngineError {
	for _, actor := range compiled.Combatants {
		hasHealthContribution := false
		for _, mount := range actor.ProviderMounts {
			provider := compiled.Providers[mount.DefinitionIndex]
			if provider.Kind != "item" || provider.Lifecycle != nil || provider.AbilityCount != 0 {
				continue
			}
			for _, modifier := range provider.Modifiers {
				selector := pipeline.ModifierTargetCombatantSelector(modifier.Target)
				if modifier.Kind == "attribute" && pipeline.AttributeKeyFromModifierTarget(modifier.Target) == "hp" && (selector == "" || selector == "self") {
					hasHealthContribution = true
				}
			}
		}
		if !hasHealthContribution {
			continue
		}
		hp := actors[actor.Key].attributesView().At("hp")
		if math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) || hp.Max <= 0 || hp.Current < 0 || hp.Current > hp.Max || math.Abs(hp.Max-hp.Resolved) > 1e-9*math.Max(1, math.Abs(hp.Max)) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "equipped HP maximum must match native contributions and current HP must remain within it", "initialSnapshot.combatants."+actor.Key+".attributes.hp", "", compiled.SchemaHash, compiled.RulesHash, sessionID)
		}
	}
	return nil
}

func (s *Engine) validateBasicAttackInitialSnapshot() *model.EngineError {
	return s.validateInitialSelection(true)
}

func (s *Engine) validateInitialSelection(checkMaximum bool) *model.EngineError {
	return admission.ValidateInitialSelection(s.admissionInput(model.SelectorSource), s.req.InitialSnapshot.Combatants, checkMaximum)
}

func (s *Engine) validateIdleBasicAttackProvider(provider planbundle.CompiledProvider, owner, ref string) *model.EngineError {
	start, initialRef, err := admission.ValidateIdleBasicAttackAbilities(s.admissionInput(owner), provider, owner, ref, validBasicAttackAmmoProvider(provider))
	if err != nil {
		return err
	}
	fail := func() *model.EngineError {
		return s.basicAttackErr("idle opponent binding must contain its complete static basic attack and unique owner-start listener", "initialSnapshot.combatants.providers")
	}
	startType, declared := s.compiled.RuntimeTypes.BasicAttackStart.Lookup()
	ownerType, ownerDeclared := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	start.TypeSet.Add(startType)
	listeners := 0
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != ref {
			continue
		}
		if !declared || !ownerDeclared || !listener.HasAbilityRef || normalizeAbilityRef(listener.AbilityRef, owner, opponentCombatantKey(owner)) != initialRef || listener.OperationCount != 0 || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || !listener.EventMatcher.RequiresAllType(startType) || !listener.EventMatcher.RequiresAllType(ownerType) || !s.listenerMatchesEvent(listener, emittedEvent{eventType: model.EventTypeBasicAttackStart, sourceKey: owner, targetKey: opponentCombatantKey(owner)}, start.TypeSet) {
			return fail()
		}
		listeners++
	}
	if listeners != 1 {
		return fail()
	}
	return nil
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

func (s *Engine) validateEquipmentPeriodicProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if err := admission.ValidateEquipmentPeriodicDefinition(s.admissionInput(owner), provider, owner); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) validateStaticInitializer(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if err := admission.ValidateStaticInitializerDefinition(s.admissionInput(owner), provider, s.isIncomingCappedFlatParent(provider, owner, providerRef)); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateStaticInitializationListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) validateStaticInitializationListener(listener planbundle.CompiledListener) *model.EngineError {
	if s.ownLinkedShieldInitialization(listener) {
		return nil
	}
	initializationType, declared := s.compiled.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, ownerDeclared := s.compiled.RuntimeTypes.SourceOwner.Lookup()
	var eventTypes typeset.TypeSet
	eventTypes.Add(initializationType)
	if !declared || !ownerDeclared || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" || listener.HasAbilityRef || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.OperationCount == 0 || listener.MaxTriggersPerEvent != 1 || !listener.EventMatcher.RequiresAllType(initializationType) || !listener.EventMatcher.RequiresAllType(ownerType) || !s.listenerMatchesEvent(listener, emittedEvent{eventType: model.EventTypeSourceInitialized, sourceKey: listener.OwnerCombatantKey, targetKey: listener.OwnerCombatantKey}, eventTypes) {
		return s.basicAttackErr("this stage accepts only unconditional owner source initialization listeners", "listeners."+listener.ListenerKey)
	}
	if listener.OperationCount == 1 && s.compiled.Operations[listener.OperationStart].Operation == "shield" && s.pureOwnedLinkedShieldInitialization(listener) {
		return nil
	}
	for _, operation := range s.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
		if err := admission.ValidateStaticInitializationOperation(s.admissionInput(listener.OwnerCombatantKey), listener, operation, s.isIncomingCappedFlatInitializer(listener, operation)); err != nil {
			return err
		}

	}
	return nil
}

// 纯初始化盾独立核闭包；旧到期补盾仍由ownLinkedShieldInitialization及其完整门负责。
func (s *Engine) pureOwnedLinkedShieldInitialization(listener planbundle.CompiledListener) bool {
	instance, _, present := s.combatants[listener.OwnerCombatantKey].instances.Providers().Find(listener.OwnerProviderRef)
	return admission.PureOwnedLinkedShieldInitialization(s.admissionInput(listener.OwnerCombatantKey), listener, admission.InitialProvider{Present: present, DefinitionIndex: instance.DefinitionIndex, DefinitionRef: instance.DefinitionRef, Source: instance.Source, Owner: instance.Owner, Stacks: instance.Stacks, ExpireAt: instance.ExpireAt, StateCount: instance.State.Len()})
}

func (s *Engine) validateTargetTimingProvider(provider planbundle.CompiledProvider, owner, ref string) *model.EngineError {
	if err := admission.ValidateTargetTimingDefinition(s.admissionInput(owner), provider, ref); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == ref {
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) addTargetTimingOperations(provider planbundle.CompiledProvider, allowed map[string]bool) {
	admission.AddTargetTimingOperations(s.compiled, provider, allowed)
}

// 永久技能伴随来源使用真实目标状态驱动周期；装备固定周期仍走自己的准入。
func (s *Engine) validateTargetWindowProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if len(provider.TargetTimings) > 0 {
		return s.validateTargetTimingProvider(provider, owner, providerRef)
	}
	if err := admission.ValidateTargetWindowDefinition(s.admissionInput(owner), provider, owner); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) validateEquipmentHitListener(listener planbundle.CompiledListener) *model.EngineError {
	sources := admission.ListenerSources{Selection: admission.SourceSelection{SkillBindings: s.plannedSkillBindings(), BasicAttack: s.req.DriverPlan.BasicAttack}}
	owner := s.combatants[listener.OwnerCombatantKey]
	if index := compiledStateDefinitionIndex(s.compiled, listener.OwnerCombatantKey, listener.OwnerProviderRef, owner.instances.Providers()); index >= 0 {
		sources.StateFields = s.compiled.Providers[index].StateFields
	}
	return admission.ValidateEquipmentHitListener(s.admissionInput(listener.OwnerCombatantKey), listener, sources)
}

func (s *Engine) validateEquipmentHitProvider(provider planbundle.CompiledProvider, owner, providerRef string) *model.EngineError {
	if provider.HasStateOnExpire {
		return s.validateStateOnExpireProvider(provider, owner, providerRef)
	}
	if err := admission.ValidateEquipmentHitDefinition(s.admissionInput(owner), provider, owner); err != nil {
		return err
	}
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == providerRef {
			if err := s.validateStaticInitializationListener(listener); err == nil {
				continue
			}
			if err := s.validateEquipmentHitListener(listener); err != nil {
				return err
			}
		}
	}
	return nil
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
	if !s.compiled.HasStateOnExpire {
		return nil
	}
	for _, actor := range s.compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			provider := s.compiled.Providers[mount.DefinitionIndex]
			if provider.HasStateOnExpire {
				if err := s.validateStateOnExpireProvider(provider, actor.Key, mount.ProviderRef); err != nil {
					return err
				}
			}
		}
	}
	for _, entry := range s.req.DriverPlan.Entries {
		source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
		target, _ := s.resolveDriverCombatantKey(entry.Target, source)
		if ref, exists := s.compiled.AbilityRefIndex[normalizeAbilityRef(entry.AbilityRef, source, target)]; exists && s.compiled.Providers[s.compiled.Abilities[ref.AbilityIndex].ProviderIndex].HasStateOnExpire {
			return s.basicAttackErr("state expiry source abilities can only run through their actual initialization or received-damage listeners", "driverPlan.entries")
		}
	}
	return nil
}

func (s *Engine) ownLinkedShieldInitialization(listener planbundle.CompiledListener) bool {
	return admission.OwnLinkedShieldInitialization(s.compiled, listener)
}

func (s *Engine) validateStateOnExpireProvider(provider planbundle.CompiledProvider, owner, ref string) *model.EngineError {
	if err := admission.ValidateStateOnExpireDefinition(s.admissionInput(owner), provider); err != nil {
		return err
	}
	fail := func() *model.EngineError {
		return s.basicAttackErr("state expiry source requires complete permanent own shield initialization and damage-driven state writes", "initialSnapshot.combatants.providers")
	}
	initializers := 0
	for _, listener := range s.compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != ref {
			continue
		}
		if s.ownLinkedShieldInitialization(listener) {
			initializers++
			continue
		}
		damage, declared := s.compiled.RuntimeTypes.DamageTaken.Lookup()
		receiver, receiverDeclared := s.compiled.RuntimeTypes.TargetOwner.Lookup()
		if !declared || !receiverDeclared || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(receiver) || !listener.HasCondition || listener.HasOncePerUse {
			return fail()
		}
		if err := s.validateEquipmentHitListener(listener); err != nil {
			return err
		}
		for _, operation := range s.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
			field := provider.StateFields[operation.Ref]
			amount, static := s.formulas.Metadata.FoldStatic(operation.AmountProgram)
			if operation.Operation != "state_change" || operation.StateScope != stateScopeProvider || operation.Target != "self" || field.OnExpireCount == 0 || !static || amount != 1 || (operation.ValuePolicy != "set" && operation.ValuePolicy != "override") {
				return fail()
			}
		}
	}
	if initializers != 1 {
		return fail()
	}
	return nil
}

func (s *Engine) observeMomentStatusContributions(instances effectpkg.ProviderList, snapshots []model.CombatantProviderSnapshot) *model.EngineError {
	executor := s.lifecycleExecutor()
	return executor.ObserveMomentStatuses(instances, snapshots, s.loop.TimeMs())
}
