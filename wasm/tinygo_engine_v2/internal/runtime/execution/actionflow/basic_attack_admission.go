package actionflow

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// AttackSourceCheck 标识普攻准入需要调用的既有来源校验，不注册运行时扩展。
type AttackSourceCheck uint8

const (
	AttackSourcePlanned AttackSourceCheck = iota
	AttackSourceIdle
	AttackSourceTargetTiming
	AttackSourceTargetWindow
	AttackSourceInitialization
	AttackSourceHit
	AttackSourcePeriodic
	AttackSourcePermanentPeriod
)

// AttackDefinitions 只借用本次普攻来源准入实际消费的只读定义和类型绑定。
type AttackDefinitions struct {
	Combatants   []planbundle.CompiledCombatant
	Providers    []planbundle.CompiledProvider
	Abilities    []planbundle.CompiledAbility
	Operations   []planbundle.CompiledOperation
	Listeners    []planbundle.CompiledListener
	RuntimeTypes planbundle.RuntimeTypeBindings
	Types        typeset.CatalogResult
}

// AttackAdmissionChecks 只交接普攻初始化阶段的真实来源、既有准入和命中主体绑定。
type AttackAdmissionChecks interface {
	// InitialAttackSnapshot 核对原始和物化来源输入，不改变战斗状态。
	InitialAttackSnapshot() *model.EngineError
	// InitialAttackActorsValid 核对唯一双方的明确正生命值。
	InitialAttackActorsValid(source, target string) bool
	// InitialAttackAttributes 借用实际来源的已物化属性。
	InitialAttackAttributes(source string) attribute.Table
	// SupportingAttackProvider 路由到指定现有来源准入，校验算法仍只有原所有者一份。
	SupportingAttackProvider(kind AttackSourceCheck, provider planbundle.CompiledProvider, owner, ref string, index uint16) *model.EngineError
	// AddAttackTargetOperations 收集已经核定目标时序来源的允许操作路径。
	AddAttackTargetOperations(provider planbundle.CompiledProvider, allowed map[string]bool)
	// LookupInitialAttackAbility 按真实驱动规则解析实际能力及完整引用。
	LookupInitialAttackAbility(entry model.DriverEntry) (planbundle.CompiledAbility, string, bool)
	// BindInitialAttackPrimary 交由命中所有者绑定实际唯一主体。
	BindInitialAttackPrimary(ability planbundle.CompiledAbility, provider string) *model.EngineError
	// DynamicAttackListeners 返回当前真实动态监听数量。
	DynamicAttackListeners() int
	// InitialAttackListener 路由到初始化或命中来源的既有监听准入。
	InitialAttackListener(listener planbundle.CompiledListener, initialization bool) *model.EngineError
	// NativeAttackListenerMatches 核对真实开始事件与现有监听类型匹配，不执行监听。
	NativeAttackListenerMatches(listener planbundle.CompiledListener, source, target string, set typeset.TypeSet) bool
}

func (s BasicAttackExecutor) Initialize(input SkillAdmission, stopOnTargetDeath bool, definitions AttackDefinitions, registry *formula.Library, skills SkillActionExecutor, checks AttackAdmissionChecks) *model.EngineError {
	p := input.BasicAttack
	if p == nil {
		return nil
	}
	if err := checks.InitialAttackSnapshot(); err != nil {
		return err
	}
	if p.PlanKey == "" || p.SkillKey == "" || p.Source != model.SelectorSource || p.Target != model.SelectorTarget || p.Source == p.Target {
		return s.error("basic attack requires a stable plan key and distinct source/target combatants", "driverPlan.basicAttack")
	}
	if input.Start != 0 || input.Duration < 1 || input.Duration > 600000 {
		return s.error("basic attack requires time zero and durationMs in [1,600000]", "stopPolicy.durationMs")
	}
	if !stopOnTargetDeath {
		return s.error("continuous basic attack must stop after the target dies", "stopPolicy.stopOnTargetDeath")
	}
	if len(input.Entries)+input.ExternalFacts != 0 {
		return s.error("basic attack plan cannot be combined with external entries or use facts", "driverPlan")
	}
	if len(input.Snapshot.ProcessInstances)+len(input.Snapshot.UseTriggerLedger) != 0 {
		return s.error("basic attack must start from an unused initial snapshot", "initialSnapshot")
	}
	for _, c := range input.Snapshot.Combatants {
		if len(c.Cooldowns)+len(c.Shields)+len(c.ProviderState)+len(c.AbilityState)+len(c.EffectiveStatuses)+len(c.Vars) != 0 {
			return s.error("basic attack requires empty initial runtime state", "initialSnapshot.combatants")
		}
	}
	if !checks.InitialAttackActorsValid(p.Source, p.Target) {
		return s.error("both initial HP values must be finite and positive", "initialSnapshot.combatants.attributes.hp")
	}
	source := checks.InitialAttackAttributes(p.Source)
	selectedRef, validRef := planbundle.ParseAbilityRef(p.StartAbilityRef)
	if !validRef || selectedRef.Combatant != p.Source {
		return s.error("basic attack requires the selected source provider", "driverPlan.basicAttack.startAbilityRef")
	}
	periodicOperations := map[string]bool{}
	ammoOperations := map[string]bool{}
	idleAttackProvider := ""
	for _, actor := range definitions.Combatants {
		gearKeys := map[string]bool{}
		initializerKeys := map[string]bool{}
		permanentSourceKeys := map[string]bool{}
		initializers := 0
		for _, mount := range actor.ProviderMounts {
			if actor.Key == p.Source && mount.ProviderRef == selectedRef.ProviderRef {
				continue
			}
			if skills.PlannedProvider(actor.Key, mount.ProviderRef) {
				if err := checks.SupportingAttackProvider(AttackSourcePlanned, gearAt(definitions.Providers, mount.DefinitionIndex), actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
					return err
				}
				continue
			}
			gear := definitions.Providers[mount.DefinitionIndex]
			if actor.Key == p.Target && gear.Kind == "skill" {
				if idleAttackProvider != "" {
					return s.error("idle opponent may have only one complete basic-attack binding", "initialSnapshot.combatants.providers")
				}
				if err := checks.SupportingAttackProvider(AttackSourceIdle, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
					return err
				}
				if gear.AmmoBinding != nil {
					ammoOperations[gear.AmmoBinding.ConsumptionPath] = true
				}
				idleAttackProvider = mount.ProviderRef
				continue
			}
			if gear.Kind == "character" || gear.Kind == "build" {
				if permanentSourceKeys[gear.StableID] {
					return s.error("duplicate permanent skill source", "initialSnapshot.combatants.providers")
				}
				if len(gear.TargetTimings) > 0 {
					if err := checks.SupportingAttackProvider(AttackSourceTargetTiming, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
						return err
					}
					checks.AddAttackTargetOperations(gear, periodicOperations)
				} else if tick, hasTick := attackTickAbility(gear, definitions.Abilities); hasTick {
					var err *model.EngineError
					if gear.PermanentCharacterPeriod {
						err = checks.SupportingAttackProvider(AttackSourcePermanentPeriod, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex)
					} else {
						err = checks.SupportingAttackProvider(AttackSourceTargetWindow, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex)
					}
					if err != nil {
						return err
					}
					for _, operation := range definitions.Operations[int(tick.TickSpec.OnTickStart) : int(tick.TickSpec.OnTickStart)+int(tick.TickSpec.OnTickCount)] {
						periodicOperations[operation.Path] = true
					}
				} else if err := checks.SupportingAttackProvider(AttackSourceInitialization, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
					if err := checks.SupportingAttackProvider(AttackSourceHit, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
						return err
					}
				}
				permanentSourceKeys[gear.StableID] = true
				if gear.HasStateOnExpire {
					for _, field := range gear.StateFields {
						for _, operation := range definitions.Operations[int(field.OnExpireStart) : int(field.OnExpireStart)+int(field.OnExpireCount)] {
							periodicOperations[operation.Path] = true
						}
					}
				}
				continue
			}
			tickAbility, hasTick := attackTickAbility(gear, definitions.Abilities)
			if len(gear.Listeners) > 0 || hasTick {
				if initializerKeys[gear.StableID] {
					return s.error("duplicate equipment initialization source", "initialSnapshot.combatants.providers")
				}
				initializerKeys[gear.StableID] = true
				initializers++
				if initializers > 6 {
					return s.error("too many equipment initialization sources", "initialSnapshot.combatants.providers")
				}
				if hasTick {
					if err := checks.SupportingAttackProvider(AttackSourcePeriodic, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
						return err
					}
					for _, operation := range definitions.Operations[int(tickAbility.TickSpec.OnTickStart) : int(tickAbility.TickSpec.OnTickStart)+int(tickAbility.TickSpec.OnTickCount)] {
						periodicOperations[operation.Path] = true
					}
				} else if err := checks.SupportingAttackProvider(AttackSourceInitialization, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
					if err := checks.SupportingAttackProvider(AttackSourceHit, gear, actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
						return err
					}
				}
				continue
			}
			if gear.Kind != "item" || gear.StableID == "" || gearKeys[gear.StableID] || len(gearKeys) >= 6 || gear.AbilityCount != 0 || len(gear.Processes)+len(gear.Listeners)+len(gear.StateFields)+len(gear.StatusContributions) != 0 || gear.Lifecycle != nil {
				return s.error("this stage accepts only complete fixed-attribute equipment providers", "initialSnapshot.combatants.providers")
			}
			gearKeys[gear.StableID] = true
			for _, modifier := range gear.Modifiers {
				if !modifier.HasValue || int(modifier.ValueProgram) >= registry.Metadata.Count() {
					return s.error("equipment attribute contribution is missing", "initialSnapshot.combatants.providers")
				}
				selector := pipeline.ModifierTargetCombatantSelector(modifier.Target)
				_, static := registry.Metadata.FoldStatic(modifier.ValueProgram)
				if modifier.Kind != "attribute" || modifier.HasCondition || modifier.ValuePolicy != "add" || (selector != "" && selector != model.SelectorSelf) || !static {
					return s.error("equipment attributes require unconditional flat contributions", "initialSnapshot.combatants.providers")
				}
			}
		}
		for key := range initializerKeys {
			if !gearKeys[key] {
				return s.error("equipment initializer must belong to a selected fixed equipment source", "initialSnapshot.combatants.providers")
			}
		}
	}
	as, ok := source.Lookup(p.AttackSpeedAttributeKey)
	_, initializes := definitions.RuntimeTypes.SourceInitialized.Lookup()
	if !ok || math.IsNaN(as.Resolved) || math.IsInf(as.Resolved, 0) || as.Resolved <= 0 || math.IsNaN(p.AttackSpeedInputMax) || math.IsInf(p.AttackSpeedInputMax, 0) || p.AttackSpeedInputMax <= 0 || (!initializes && as.Resolved > p.AttackSpeedInputMax) {
		return s.error("attack speed must be positive and within the explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	lookup := func(ref string) (planbundle.CompiledAbility, bool) {
		entry := model.DriverEntry{AbilityRef: ref, Source: p.Source, Target: p.Target}
		ability, normalized, found := checks.LookupInitialAttackAbility(entry)
		parsed, valid := planbundle.ParseAbilityRef(ref)
		return ability, found && valid && normalized == ref && parsed.Combatant == p.Source && parsed.ProviderRef == selectedRef.ProviderRef && ability.SkillKey == p.SkillKey && ability.IsBasicAttack
	}
	start, good := lookup(p.StartAbilityRef)
	if !good || start.OperationCount != 0 || start.HasSkillHit || start.ProcessControl != nil || start.Cost != nil || start.Cooldown != nil || start.HasCastCondition || start.TickSpec != nil {
		return s.error("start ability must be the actual empty basic-attack ability", "driverPlan.basicAttack.startAbilityRef")
	}
	hit, good := lookup(p.HitAbilityRef)
	if !good || !hit.HasSkillHit || hit.ProcessControl != nil || hit.Cost != nil || hit.Cooldown != nil || hit.HasCastCondition || hit.TickSpec != nil || hit.OperationCount != 1 || definitions.Operations[hit.OperationStart].Operation != model.OperationKindResolveSkillHit {
		return s.error("hit ability must be the actual selected native hit ability", "driverPlan.basicAttack.hitAbilityRef")
	}
	initial, good := lookup(p.InitialControlAbilityRef)
	if !good || initial.ProcessControl == nil || initial.ProcessControl.Action != "INITIAL" || !initial.ProcessControl.UseRefFromEvent || initial.OperationCount != 0 || initial.Cost != nil || initial.Cooldown != nil || initial.HasCastCondition || initial.TickSpec != nil {
		return s.error("initial control must consume the native start use reference", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	provider := definitions.Providers[initial.ProviderIndex]
	processIndex := initial.ProcessControl.ProcessIndex
	if processIndex < 0 || processIndex >= len(provider.Processes) {
		return s.error("missing initial process definition", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	process := provider.Processes[processIndex]
	if process.SkillKey != p.SkillKey || process.Cooldown == nil || !process.Cooldown.RoundPositiveMs || process.Cooldown.StartMoment.MomentType != "PROCESS_START" {
		return s.error("attack process requires positive rounded cooldown starting at PROCESS_START", process.Path+".cooldown")
	}
	if len(process.Costs) != 0 {
		return s.error("continuous basic attack does not accept resource costs", process.Path+".costs")
	}
	for _, step := range process.Steps {
		if step.StepType != "IMMEDIATE" {
			return s.error("continuous basic attack currently requires immediate process steps", step.Path)
		}
	}
	s.actions.InitBasicAttack(actionpkg.BasicAttackSeed{Plan: *p, InitialAbility: initial, CooldownDependencies: registry.Metadata.ReadDependencies(process.Cooldown.DurationProgram)})
	if err := checks.BindInitialAttackPrimary(hit, selectedRef.ProviderRef); err != nil {
		return err
	}
	// Stage 2 accepts the same complete static subset emitted by the host adapter.
	// Extra mechanisms fail closed instead of being filtered or implicitly executed.
	if len(provider.Processes) != 1 || provider.AbilityCount != 3 || provider.Lifecycle != nil || len(provider.Modifiers)+len(provider.StatusContributions) != 0 || !ValidBasicAmmoProvider(provider) {
		return s.error("continuous basic attack requires the complete static three-ability provider", "driverPlan.basicAttack")
	}
	if checks.DynamicAttackListeners() != 0 {
		return s.error("continuous basic attack requires the unique native-start listener", "driverPlan.basicAttack")
	}
	if provider.AmmoBinding != nil {
		if provider.AmmoBinding.ProcessIndex != processIndex || definitions.Abilities[provider.AmmoBinding.InitialAbilityIndex].AbilityKey != initial.AbilityKey {
			return s.error("ammo binding does not address the selected initial process", "driverPlan.basicAttack.initialControlAbilityRef")
		}
		s.actions.SetBasicAmmo(actionpkg.NewAmmo(actionpkg.AmmoSeed{Owner: p.Source, ProviderRef: selectedRef.ProviderRef, Definition: provider, Binding: *provider.AmmoBinding}))
		ammoOperations[provider.AmmoBinding.ConsumptionPath] = true
	}
	var listener planbundle.CompiledListener
	startListeners := 0
	initializationOperations := map[string]bool{}
	triggerOperations := map[string]bool{}
	for _, entry := range definitions.Listeners {
		if skills.PlannedProvider(entry.OwnerCombatantKey, entry.OwnerProviderRef) {
			continue
		}
		if entry.OwnerCombatantKey == p.Target && entry.OwnerProviderRef == idleAttackProvider {
			continue
		}
		if entry.OwnerCombatantKey == p.Source && entry.OwnerProviderRef == selectedRef.ProviderRef {
			listener = entry
			startListeners++
		} else {
			if err := checks.InitialAttackListener(entry, true); err != nil {
				if err := checks.InitialAttackListener(entry, false); err != nil {
					return err
				}
				for _, operation := range definitions.Operations[int(entry.OperationStart) : int(entry.OperationStart)+int(entry.OperationCount)] {
					triggerOperations[operation.Path] = true
					if operation.Operation != model.OperationKindStartPassiveProcess {
						continue
					}
					// 完整来源和监听准入已核对新入口；只登记该编译过程的真实尾操作。
					passive := definitions.Providers[operation.OwnerProviderIndex].Processes[operation.PassiveProcessIndex]
					for _, moment := range passive.MomentOperations {
						for _, leaf := range definitions.Operations[int(moment.OperationStart) : int(moment.OperationStart)+int(moment.OperationCount)] {
							triggerOperations[leaf.Path] = true
						}
					}
				}
				continue
			}
			for _, operation := range definitions.Operations[int(entry.OperationStart) : int(entry.OperationStart)+int(entry.OperationCount)] {
				initializationOperations[operation.Path] = true
				if operation.Operation != "apply_provider" {
					continue
				}
				// 初始化准入已核对被挂载定义的完整闭包；登记其实际监听操作，避免把冻结消费误作普攻结果。
				for _, child := range definitions.Providers {
					if child.ProviderKey != operation.ProviderDefinitionRef {
						continue
					}
					for _, childListener := range child.Listeners {
						for _, leaf := range definitions.Operations[int(childListener.OperationStart) : int(childListener.OperationStart)+int(childListener.OperationCount)] {
							initializationOperations[leaf.Path] = true
						}
					}
				}
			}
		}
	}
	if startListeners != 1 {
		return s.error("continuous basic attack requires the unique native-start listener", "driverPlan.basicAttack")
	}
	if listener.OwnerCombatantKey != p.Source || listener.OwnerProviderRef != selectedRef.ProviderRef || !listener.HasAbilityRef || NormalizeAbilityRef(listener.AbilityRef, p.Source, p.Target) != p.InitialControlAbilityRef || listener.OperationCount != 0 || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 {
		return s.error("pre-hit listener must only start the actual selected process", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	set := start.TypeSet
	if id, ok := definitions.RuntimeTypes.BasicAttackStart.Lookup(); ok {
		set.Add(id)
	}
	if start.CastOrigin != "" {
		if id, ok := definitions.Types.Registry.LookupDomain("cast_origin", "cast_origin/"+start.CastOrigin); ok {
			set.Add(id)
		}
	}
	if !checks.NativeAttackListenerMatches(listener, p.Source, p.Target, set) {
		return s.error("native start does not match its actual initial listener", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	for _, moment := range process.MomentOperations {
		if moment.Moment.MomentType != "PROCESS_START" {
			return s.error("unsupported process moment", moment.Path)
		}
		for _, op := range definitions.Operations[int(moment.OperationStart) : int(moment.OperationStart)+int(moment.OperationCount)] {
			if provider.AmmoBinding != nil && op.Path == provider.AmmoBinding.ConsumptionPath {
				continue
			}
			if op.Operation != model.OperationKindApplyAttackLink && op.Operation != model.OperationKindApplyHitLink {
				return s.error("pre-hit operation is outside the static link subset", op.Path)
			}
		}
	}
	for _, op := range definitions.Operations {
		if skills.PlannedOperation(op.OwnerProviderIndex) {
			continue
		}
		if ammoOperations[op.Path] {
			continue
		}
		if initializationOperations[op.Path] || triggerOperations[op.Path] || periodicOperations[op.Path] {
			continue
		}
		if op.Target != "target" {
			return s.error("continuous basic attack results require the actual target", op.Path)
		}
		switch op.Operation {
		case "damage", model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink, model.OperationKindResolveSkillHit:
		default:
			return s.error("dynamic or unsupported operation in continuous basic attack", op.Path)
		}
	}

	return nil
}

func gearAt(providers []planbundle.CompiledProvider, index uint16) planbundle.CompiledProvider {
	return providers[index]
}
func attackTickAbility(provider planbundle.CompiledProvider, abilities []planbundle.CompiledAbility) (*planbundle.CompiledAbility, bool) {
	for index := int(provider.AbilityStart); index < int(provider.AbilityStart)+int(provider.AbilityCount); index++ {
		if abilities[index].Kind == "tick" {
			return &abilities[index], true
		}
	}
	return nil, false
}
