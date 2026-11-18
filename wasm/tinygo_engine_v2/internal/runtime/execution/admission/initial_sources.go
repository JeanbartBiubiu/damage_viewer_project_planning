package admission

import (
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// InitialSourceReads 仅在初始化准入的原分支借用实际事实；不安装效果或执行战斗。
type InitialSourceReads interface {
	// InitialAbilityReference 通过行动所属规则归一化引用，不修改无效引用。
	InitialAbilityReference(reference, source, target string) string
	// InitialListenerMatches 在原头部检查通过后复用监听所属匹配，不求值条件或派发。
	InitialListenerMatches(listener planbundle.CompiledListener, event, source, target string, types typeset.TypeSet) bool
	// InitialProviderView 只在关联盾闭包检查点取得实际单一挂载事实。
	InitialProviderView(owner, reference string) InitialProvider
	// InitialListenerSources 借用本次实际选中的来源和真实挂载字段，不补造选中来源。
	InitialListenerSources(listener planbundle.CompiledListener) ListenerSources
	// InitialActors 借用原准入位置所需的实际双方数值，不触发效果准备。
	InitialActors(owner string) [2]Actor
	// InitialDriverReference 运输原驱动双方解析后的能力引用，不判断该来源是否准入。
	InitialDriverReference(entry model.DriverEntry) string
}

// ValidateIdleBasicAttackProvider 校验完整闲置普攻及唯一开始监听；首错和匹配时点保持。
func ValidateIdleBasicAttackProvider(input Input, provider planbundle.CompiledProvider, owner, reference string, validAmmo bool, reads InitialSourceReads) *model.EngineError {
	start, initialRef, err := validateIdleBasicAttackAbilities(input, provider, owner, reference, validAmmo)
	if err != nil {
		return err
	}
	startType, declared := input.Compiled.RuntimeTypes.BasicAttackStart.Lookup()
	ownerType, ownerDeclared := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	start.TypeSet.Add(startType)
	listeners := 0
	for _, listener := range input.Compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != reference {
			continue
		}
		if !declared || !ownerDeclared || !listener.HasAbilityRef || reads.InitialAbilityReference(listener.AbilityRef, owner, opponent(owner)) != initialRef || listener.OperationCount != 0 || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || !listener.EventMatcher.RequiresAllType(startType) || !listener.EventMatcher.RequiresAllType(ownerType) || !reads.InitialListenerMatches(listener, model.EventTypeBasicAttackStart, owner, opponent(owner), start.TypeSet) {
			return fail(input, "idle opponent binding must contain its complete static basic attack and unique owner-start listener", "initialSnapshot.combatants.providers")
		}
		listeners++
	}
	if listeners != 1 {
		return fail(input, "idle opponent binding must contain its complete static basic attack and unique owner-start listener", "initialSnapshot.combatants.providers")
	}
	return nil
}

// ValidateEquipmentPeriodicProvider 按原定义、实际所属监听顺序校验完整固定周期来源。
func ValidateEquipmentPeriodicProvider(input Input, provider planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads) *model.EngineError {
	if err := ValidateEquipmentPeriodicDefinition(input, provider, owner); err != nil {
		return err
	}
	return validateInitialSourceListeners(input, owner, reference, reads, false)
}

// ValidateStaticInitializer 校验完整静态来源和所属初始化监听，不安装其结果。
func ValidateStaticInitializer(input Input, provider planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads) *model.EngineError {
	if ownedSpellShieldInitializer(input, provider, owner, reference, reads) {
		return nil
	}
	capped := IncomingCappedFlatParent(input.Compiled.IncomingCappedFlatSources, input.Compiled.Providers, provider.ProviderKey, owner, reference)
	if err := validateStaticInitializerDefinition(input, provider, capped); err != nil {
		return err
	}
	for _, listener := range input.Compiled.Listeners {
		if listener.OwnerCombatantKey == owner && listener.OwnerProviderRef == reference {
			if err := ValidateStaticInitializationListener(input, listener, reads); err != nil {
				return err
			}
		}
	}
	return nil
}

// ValidateStaticInitializationListener 完整消费例外、监听头部及操作闭包，保留原短路首错。
func ValidateStaticInitializationListener(input Input, listener planbundle.CompiledListener, reads InitialSourceReads) *model.EngineError {
	if ownedSpellShieldInitializationListener(input, listener, reads) {
		return nil
	}
	if ownLinkedShieldInitialization(*input.Compiled, listener) {
		return nil
	}
	initializationType, declared := input.Compiled.RuntimeTypes.SourceInitialized.Lookup()
	ownerType, ownerDeclared := input.Compiled.RuntimeTypes.SourceOwner.Lookup()
	var eventTypes typeset.TypeSet
	eventTypes.Add(initializationType)
	if !declared || !ownerDeclared || listener.OwnerCombatantKey == "" || listener.OwnerProviderRef == "" || listener.HasAbilityRef || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.OperationCount == 0 || listener.MaxTriggersPerEvent != 1 || !listener.EventMatcher.RequiresAllType(initializationType) || !listener.EventMatcher.RequiresAllType(ownerType) || !reads.InitialListenerMatches(listener, model.EventTypeSourceInitialized, listener.OwnerCombatantKey, listener.OwnerCombatantKey, eventTypes) {
		return fail(input, "this stage accepts only unconditional owner source initialization listeners", "listeners."+listener.ListenerKey)
	}
	if listener.OperationCount == 1 && input.Compiled.Operations[listener.OperationStart].Operation == "shield" {
		instance := reads.InitialProviderView(listener.OwnerCombatantKey, listener.OwnerProviderRef)
		local := initialActorInput(input, listener.OwnerCombatantKey, reads)
		if pureOwnedLinkedShieldInitialization(local, listener, instance) {
			return nil
		}
	}
	for _, operation := range input.Compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
		local := initialActorInput(input, listener.OwnerCombatantKey, reads)
		capped := IncomingCappedFlatInitializer(input.Compiled.IncomingCappedFlatSources, input.Compiled.Providers, listener, operation)
		if err := validateStaticInitializationOperation(local, listener, operation, capped); err != nil {
			return err
		}
	}
	return nil
}

// ValidateTargetTimingProvider 校验完整目标计时来源，再按实际挂载的原监听顺序准入。
func ValidateTargetTimingProvider(input Input, provider planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads) *model.EngineError {
	if err := ValidateTargetTimingDefinition(input, provider, reference); err != nil {
		return err
	}
	return validateInitialSourceListeners(input, owner, reference, reads, false)
}

// ValidateTargetWindowProvider 在原优先级选择目标计时或窗口来源，并完整核对所属监听。
func ValidateTargetWindowProvider(input Input, provider planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads) *model.EngineError {
	if len(provider.TargetTimings) > 0 {
		return ValidateTargetTimingProvider(input, provider, owner, reference, reads)
	}
	if err := ValidateTargetWindowDefinition(input, provider, owner); err != nil {
		return err
	}
	return validateInitialSourceListeners(input, owner, reference, reads, false)
}

// ValidateEquipmentHitProvider 按原到期来源优先级和静态初始化回退校验完整触发来源。
func ValidateEquipmentHitProvider(input Input, provider planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads) *model.EngineError {
	if provider.HasStateOnExpire {
		return validateStateOnExpireProvider(input, provider, owner, reference, reads)
	}
	if err := ValidateEquipmentHitDefinition(input, provider, owner); err != nil {
		return err
	}
	return validateInitialSourceListeners(input, owner, reference, reads, true)
}

// ValidateStateOnExpireSources 先完整核对原序挂载，再检查原序驱动；拒绝不改变运行状态。
func ValidateStateOnExpireSources(input Input, entries []model.DriverEntry, reads InitialSourceReads) *model.EngineError {
	if !input.Compiled.HasStateOnExpire {
		return nil
	}
	for _, actor := range input.Compiled.Combatants {
		for _, mount := range actor.ProviderMounts {
			provider := input.Compiled.Providers[mount.DefinitionIndex]
			if provider.HasStateOnExpire && !provider.HasCooldownStateExpiry {
				local := initialActorInput(input, actor.Key, reads)
				if err := validateStateOnExpireProvider(local, provider, actor.Key, mount.ProviderRef, reads); err != nil {
					return err
				}
			}
		}
	}
	for _, entry := range entries {
		if ref, exists := input.Compiled.AbilityRefIndex[reads.InitialDriverReference(entry)]; exists && input.Compiled.Providers[input.Compiled.Abilities[ref.AbilityIndex].ProviderIndex].HasStateOnExpire {
			return fail(input, "state expiry source abilities can only run through their actual initialization or received-damage listeners", "driverPlan.entries")
		}
	}
	return nil
}

func validateInitialSourceListeners(input Input, owner, reference string, reads InitialSourceReads, allowInitialization bool) *model.EngineError {
	for _, listener := range input.Compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != reference {
			continue
		}
		if allowInitialization {
			if err := ValidateStaticInitializationListener(input, listener, reads); err == nil {
				continue
			}
		}
		if err := validateInitialEquipmentHitListener(input, listener, reads); err != nil {
			return err
		}
	}
	return nil
}

func validateInitialEquipmentHitListener(input Input, listener planbundle.CompiledListener, reads InitialSourceReads) *model.EngineError {
	sources := reads.InitialListenerSources(listener)
	return ValidateEquipmentHitListener(initialActorInput(input, listener.OwnerCombatantKey, reads), listener, sources)
}

func initialActorInput(input Input, owner string, reads InitialSourceReads) Input {
	input.Actors = reads.InitialActors(owner)
	return input
}

func validateStateOnExpireProvider(input Input, provider planbundle.CompiledProvider, owner, reference string, reads InitialSourceReads) *model.EngineError {
	if provider.HasCooldownStateExpiry {
		return validateCooldownStateExpiryProvider(input, provider, owner, reference, reads)
	}
	if err := validateStateOnExpireDefinition(input, provider); err != nil {
		return err
	}
	initializers := 0
	for _, listener := range input.Compiled.Listeners {
		if listener.OwnerCombatantKey != owner || listener.OwnerProviderRef != reference {
			continue
		}
		if ownLinkedShieldInitialization(*input.Compiled, listener) {
			initializers++
			continue
		}
		damage, declared := input.Compiled.RuntimeTypes.DamageTaken.Lookup()
		receiver, receiverDeclared := input.Compiled.RuntimeTypes.TargetOwner.Lookup()
		if !declared || !receiverDeclared || !listener.EventMatcher.RequiresAllType(damage) || !listener.EventMatcher.RequiresAllType(receiver) || !listener.HasCondition || listener.HasOncePerUse {
			return fail(input, "state expiry source requires complete permanent own shield initialization and damage-driven state writes", "initialSnapshot.combatants.providers")
		}
		if err := validateInitialEquipmentHitListener(input, listener, reads); err != nil {
			return err
		}
		for _, operation := range input.Compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
			field := provider.StateFields[operation.Ref]
			amount, static := input.Formulas.Metadata.FoldStatic(operation.AmountProgram)
			if operation.Operation != "state_change" || operation.StateScope != "state_scope/provider" || operation.Target != "self" || field.OnExpireCount == 0 || !static || amount != 1 || (operation.ValuePolicy != "set" && operation.ValuePolicy != "override") {
				return fail(input, "state expiry source requires complete permanent own shield initialization and damage-driven state writes", "initialSnapshot.combatants.providers")
			}
		}
	}
	if initializers != 1 {
		return fail(input, "state expiry source requires complete permanent own shield initialization and damage-driven state writes", "initialSnapshot.combatants.providers")
	}
	return nil
}
