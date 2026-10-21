package runtime

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

const maxJSONSafeInteger int64 = 9007199254740991

type basicAttackRuntime struct {
	primary              *model.BasicAttackPrimaryIdentity
	primaryCandidate     int
	primaryHitPlan       *planbundle.CompiledSkillHit
	replacementSlots     []primaryReplacementSlot
	ammo                 *basicAttackAmmo
	plan                 model.BasicAttackPlan
	summary              model.BasicAttackSummary
	current              *model.BasicAttackRecord
	currentRecordIndex   int
	targetKilledAt       *int64
	unfinishedTail       bool
	windowSettled        bool
	initialAbility       planbundle.CompiledAbility
	wait                 *basicAttackWait
	cooldownDependencies []formula.GenericInstr
}

func (s *genericRunState) basicAttackErr(message, path string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path, "", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (s *genericRunState) initBasicAttack() *model.EngineError {
	p := s.req.DriverPlan.BasicAttack
	if p == nil {
		return nil
	}
	if err := s.validateBasicAttackInitialSnapshot(); err != nil {
		return err
	}
	if p.PlanKey == "" || p.SkillKey == "" || p.Source != model.SelectorSource || p.Target != model.SelectorTarget || p.Source == p.Target {
		return s.basicAttackErr("basic attack requires a stable plan key and distinct source/target combatants", "driverPlan.basicAttack")
	}
	if s.startMs != 0 || s.durationMs < 1 || s.durationMs > 600000 {
		return s.basicAttackErr("basic attack requires time zero and durationMs in [1,600000]", "stopPolicy.durationMs")
	}
	if !s.req.StopPolicy.StopOnTargetDeathOrDefault() {
		return s.basicAttackErr("continuous basic attack must stop after the target dies", "stopPolicy.stopOnTargetDeath")
	}
	if len(s.req.DriverPlan.Entries)+len(s.req.SkillUses)+len(s.req.AttackStartFacts)+len(s.req.SkillHitFacts)+len(s.req.ProcessCommandFacts) != 0 {
		return s.basicAttackErr("basic attack plan cannot be combined with external entries or use facts", "driverPlan")
	}
	if len(s.req.InitialSnapshot.ProcessInstances)+len(s.req.InitialSnapshot.UseTriggerLedger) != 0 {
		return s.basicAttackErr("basic attack must start from an unused initial snapshot", "initialSnapshot")
	}
	for _, c := range s.req.InitialSnapshot.Combatants {
		if len(c.Cooldowns)+len(c.Shields)+len(c.ProviderState)+len(c.AbilityState)+len(c.EffectiveStatuses)+len(c.Vars) != 0 {
			return s.basicAttackErr("basic attack requires empty initial runtime state", "initialSnapshot.combatants")
		}
	}
	if len(s.combatants) != 2 || !s.combatantHasHp(p.Source) || !s.combatantHasHp(p.Target) || s.combatantHp(p.Source) <= 0 || s.combatantHp(p.Target) <= 0 {
		return s.basicAttackErr("both initial HP values must be finite and positive", "initialSnapshot.combatants.attributes.hp")
	}
	source := s.combatants[p.Source]
	selectedRef, validRef := planbundle.ParseAbilityRef(p.StartAbilityRef)
	if !validRef || selectedRef.Combatant != p.Source {
		return s.basicAttackErr("basic attack requires the selected source provider", "driverPlan.basicAttack.startAbilityRef")
	}
	periodicOperations := map[string]bool{}
	ammoOperations := map[string]bool{}
	idleAttackProvider := ""
	for _, actor := range s.compiled.Combatants {
		gearKeys := map[string]bool{}
		initializerKeys := map[string]bool{}
		permanentSourceKeys := map[string]bool{}
		initializers := 0
		for _, mount := range actor.ProviderMounts {
			if actor.Key == p.Source && mount.ProviderRef == selectedRef.ProviderRef {
				continue
			}
			if s.plannedSkillProvider(actor.Key, mount.ProviderRef) {
				if err := s.validatePlannedSkillProvider(actor.Key, mount.ProviderRef, mount.DefinitionIndex); err != nil {
					return err
				}
				continue
			}
			gear := s.compiled.Providers[mount.DefinitionIndex]
			if actor.Key == p.Target && gear.Kind == "skill" {
				if idleAttackProvider != "" {
					return s.basicAttackErr("idle opponent may have only one complete basic-attack binding", "initialSnapshot.combatants.providers")
				}
				if err := s.validateIdleBasicAttackProvider(gear, actor.Key, mount.ProviderRef); err != nil {
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
					return s.basicAttackErr("duplicate permanent skill source", "initialSnapshot.combatants.providers")
				}
				if tick, hasTick := findTickAbility(gear, s.compiled); hasTick {
					if err := s.validateTargetWindowProvider(gear, actor.Key, mount.ProviderRef); err != nil {
						return err
					}
					for _, operation := range s.compiled.Operations[int(tick.TickSpec.OnTickStart) : int(tick.TickSpec.OnTickStart)+int(tick.TickSpec.OnTickCount)] {
						periodicOperations[operation.Path] = true
					}
				} else if err := s.validateStaticInitializer(gear, actor.Key, mount.ProviderRef); err != nil {
					if err := s.validateEquipmentHitProvider(gear, actor.Key, mount.ProviderRef); err != nil {
						return err
					}
				}
				permanentSourceKeys[gear.StableID] = true
				if gear.HasStateOnExpire {
					for _, field := range gear.StateFields {
						for _, operation := range s.compiled.Operations[int(field.OnExpireStart) : int(field.OnExpireStart)+int(field.OnExpireCount)] {
							periodicOperations[operation.Path] = true
						}
					}
				}
				continue
			}
			tickAbility, hasTick := findTickAbility(gear, s.compiled)
			if len(gear.Listeners) > 0 || hasTick {
				if initializerKeys[gear.StableID] {
					return s.basicAttackErr("duplicate equipment initialization source", "initialSnapshot.combatants.providers")
				}
				initializerKeys[gear.StableID] = true
				initializers++
				if initializers > 6 {
					return s.basicAttackErr("too many equipment initialization sources", "initialSnapshot.combatants.providers")
				}
				if hasTick {
					if err := s.validateEquipmentPeriodicProvider(gear, actor.Key, mount.ProviderRef); err != nil {
						return err
					}
					for _, operation := range s.compiled.Operations[int(tickAbility.TickSpec.OnTickStart) : int(tickAbility.TickSpec.OnTickStart)+int(tickAbility.TickSpec.OnTickCount)] {
						periodicOperations[operation.Path] = true
					}
				} else if err := s.validateStaticInitializer(gear, actor.Key, mount.ProviderRef); err != nil {
					if err := s.validateEquipmentHitProvider(gear, actor.Key, mount.ProviderRef); err != nil {
						return err
					}
				}
				continue
			}
			if gear.Kind != "item" || gear.StableID == "" || gearKeys[gear.StableID] || len(gearKeys) >= 6 || gear.AbilityCount != 0 || len(gear.Processes)+len(gear.Listeners)+len(gear.StateFields)+len(gear.StatusContributions) != 0 || gear.Lifecycle != nil {
				return s.basicAttackErr("this stage accepts only complete fixed-attribute equipment providers", "initialSnapshot.combatants.providers")
			}
			gearKeys[gear.StableID] = true
			for _, modifier := range gear.Modifiers {
				if !modifier.HasValue || int(modifier.ValueProgram) >= len(s.formulas.Programs) {
					return s.basicAttackErr("equipment attribute contribution is missing", "initialSnapshot.combatants.providers")
				}
				selector := pipeline.ModifierTargetCombatantSelector(modifier.Target)
				_, static := s.formulas.FoldStatic(modifier.ValueProgram)
				if modifier.Kind != "attribute" || modifier.HasCondition || modifier.ValuePolicy != "add" || (selector != "" && selector != model.SelectorSelf) || !static {
					return s.basicAttackErr("equipment attributes require unconditional flat contributions", "initialSnapshot.combatants.providers")
				}
			}
		}
		for key := range initializerKeys {
			if !gearKeys[key] {
				return s.basicAttackErr("equipment initializer must belong to a selected fixed equipment source", "initialSnapshot.combatants.providers")
			}
		}
	}
	as, ok := source.attributes.Lookup(p.AttackSpeedAttributeKey)
	_, initializes := s.compiled.RuntimeTypes.SourceInitialized.Lookup()
	if !ok || math.IsNaN(as.Resolved) || math.IsInf(as.Resolved, 0) || as.Resolved <= 0 || math.IsNaN(p.AttackSpeedInputMax) || math.IsInf(p.AttackSpeedInputMax, 0) || p.AttackSpeedInputMax <= 0 || (!initializes && as.Resolved > p.AttackSpeedInputMax) {
		return s.basicAttackErr("attack speed must be positive and within the explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	lookup := func(ref string) (planbundle.CompiledAbility, bool) {
		entry := model.DriverEntry{AbilityRef: ref, Source: p.Source, Target: p.Target}
		ability, normalized, found := s.lookupDriverAbility(entry)
		parsed, valid := planbundle.ParseAbilityRef(ref)
		return ability, found && valid && normalized == ref && parsed.Combatant == p.Source && parsed.ProviderRef == selectedRef.ProviderRef && ability.SkillKey == p.SkillKey && ability.IsBasicAttack
	}
	start, good := lookup(p.StartAbilityRef)
	if !good || start.OperationCount != 0 || start.HasSkillHit || start.ProcessControl != nil || start.Cost != nil || start.Cooldown != nil || start.HasCastCondition || start.TickSpec != nil {
		return s.basicAttackErr("start ability must be the actual empty basic-attack ability", "driverPlan.basicAttack.startAbilityRef")
	}
	hit, good := lookup(p.HitAbilityRef)
	if !good || !hit.HasSkillHit || hit.ProcessControl != nil || hit.Cost != nil || hit.Cooldown != nil || hit.HasCastCondition || hit.TickSpec != nil || hit.OperationCount != 1 || s.compiled.Operations[hit.OperationStart].Operation != model.OperationKindResolveSkillHit {
		return s.basicAttackErr("hit ability must be the actual selected native hit ability", "driverPlan.basicAttack.hitAbilityRef")
	}
	initial, good := lookup(p.InitialControlAbilityRef)
	if !good || initial.ProcessControl == nil || initial.ProcessControl.Action != "INITIAL" || !initial.ProcessControl.UseRefFromEvent || initial.OperationCount != 0 || initial.Cost != nil || initial.Cooldown != nil || initial.HasCastCondition || initial.TickSpec != nil {
		return s.basicAttackErr("initial control must consume the native start use reference", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	provider := s.compiled.Providers[initial.ProviderIndex]
	processIndex := initial.ProcessControl.ProcessIndex
	if processIndex < 0 || processIndex >= len(provider.Processes) {
		return s.basicAttackErr("missing initial process definition", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	process := provider.Processes[processIndex]
	if process.SkillKey != p.SkillKey || process.Cooldown == nil || !process.Cooldown.RoundPositiveMs || process.Cooldown.StartMoment.MomentType != "PROCESS_START" {
		return s.basicAttackErr("attack process requires positive rounded cooldown starting at PROCESS_START", process.Path+".cooldown")
	}
	if len(process.Costs) != 0 {
		return s.basicAttackErr("continuous basic attack does not accept resource costs", process.Path+".costs")
	}
	for _, step := range process.Steps {
		if step.StepType != "IMMEDIATE" {
			return s.basicAttackErr("continuous basic attack currently requires immediate process steps", step.Path)
		}
	}
	s.basicAttack = &basicAttackRuntime{plan: *p, summary: model.BasicAttackSummary{PlanKey: p.PlanKey}, currentRecordIndex: -1, initialAbility: initial,
		cooldownDependencies: s.formulas.ReadDependencies(process.Cooldown.DurationProgram)}
	if err := s.bindBasicAttackPrimary(hit, selectedRef.ProviderRef); err != nil {
		return err
	}
	// Stage 2 accepts the same complete static subset emitted by the host adapter.
	// Extra mechanisms fail closed instead of being filtered or implicitly executed.
	if len(provider.Processes) != 1 || provider.AbilityCount != 3 || provider.Lifecycle != nil || len(provider.Modifiers)+len(provider.StatusContributions) != 0 || !validBasicAttackAmmoProvider(provider) {
		return s.basicAttackErr("continuous basic attack requires the complete static three-ability provider", "driverPlan.basicAttack")
	}
	if len(s.runtimeListeners) != 0 {
		return s.basicAttackErr("continuous basic attack requires the unique native-start listener", "driverPlan.basicAttack")
	}
	if provider.AmmoBinding != nil {
		if provider.AmmoBinding.ProcessIndex != processIndex || s.compiled.Abilities[provider.AmmoBinding.InitialAbilityIndex].AbilityKey != initial.AbilityKey {
			return s.basicAttackErr("ammo binding does not address the selected initial process", "driverPlan.basicAttack.initialControlAbilityRef")
		}
		s.basicAttack.ammo = &basicAttackAmmo{owner: p.Source, providerRef: selectedRef.ProviderRef, definition: provider, binding: *provider.AmmoBinding}
		ammoOperations[provider.AmmoBinding.ConsumptionPath] = true
	}
	var listener planbundle.CompiledListener
	startListeners := 0
	initializationOperations := map[string]bool{}
	triggerOperations := map[string]bool{}
	for _, entry := range s.compiled.Listeners {
		if s.plannedSkillProvider(entry.OwnerCombatantKey, entry.OwnerProviderRef) {
			continue
		}
		if entry.OwnerCombatantKey == p.Target && entry.OwnerProviderRef == idleAttackProvider {
			continue
		}
		if entry.OwnerCombatantKey == p.Source && entry.OwnerProviderRef == selectedRef.ProviderRef {
			listener = entry
			startListeners++
		} else {
			if err := s.validateStaticInitializationListener(entry); err != nil {
				if err := s.validateEquipmentHitListener(entry); err != nil {
					return err
				}
				for _, operation := range s.compiled.Operations[int(entry.OperationStart) : int(entry.OperationStart)+int(entry.OperationCount)] {
					triggerOperations[operation.Path] = true
				}
				continue
			}
			for _, operation := range s.compiled.Operations[int(entry.OperationStart) : int(entry.OperationStart)+int(entry.OperationCount)] {
				initializationOperations[operation.Path] = true
			}
		}
	}
	if startListeners != 1 {
		return s.basicAttackErr("continuous basic attack requires the unique native-start listener", "driverPlan.basicAttack")
	}
	if listener.OwnerCombatantKey != p.Source || listener.OwnerProviderRef != selectedRef.ProviderRef || !listener.HasAbilityRef || normalizeAbilityRef(listener.AbilityRef, p.Source, p.Target) != p.InitialControlAbilityRef || listener.OperationCount != 0 || listener.HasCondition || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 {
		return s.basicAttackErr("pre-hit listener must only start the actual selected process", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	set := start.TypeSet
	if id, ok := s.compiled.RuntimeTypes.BasicAttackStart.Lookup(); ok {
		set.Add(id)
	}
	if start.CastOrigin != "" {
		if id, ok := s.compiled.Types.Registry.LookupDomain("cast_origin", "cast_origin/"+start.CastOrigin); ok {
			set.Add(id)
		}
	}
	if !s.listenerMatchesEvent(listener, emittedEvent{eventType: model.EventTypeBasicAttackStart, sourceKey: p.Source, targetKey: p.Target}, set) {
		return s.basicAttackErr("native start does not match its actual initial listener", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	for _, moment := range process.MomentOperations {
		if moment.Moment.MomentType != "PROCESS_START" {
			return s.basicAttackErr("unsupported process moment", moment.Path)
		}
		for _, op := range s.compiled.Operations[int(moment.OperationStart) : int(moment.OperationStart)+int(moment.OperationCount)] {
			if provider.AmmoBinding != nil && op.Path == provider.AmmoBinding.ConsumptionPath {
				continue
			}
			if op.Operation != model.OperationKindApplyAttackLink && op.Operation != model.OperationKindApplyHitLink {
				return s.basicAttackErr("pre-hit operation is outside the static link subset", op.Path)
			}
		}
	}
	for _, op := range s.compiled.Operations {
		if s.plannedSkillOperation(op.OwnerProviderIndex) {
			continue
		}
		if ammoOperations[op.Path] {
			continue
		}
		if initializationOperations[op.Path] || triggerOperations[op.Path] || periodicOperations[op.Path] {
			continue
		}
		if op.Target != "target" {
			return s.basicAttackErr("continuous basic attack results require the actual target", op.Path)
		}
		switch op.Operation {
		case "damage", model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink, model.OperationKindResolveSkillHit:
		default:
			return s.basicAttackErr("dynamic or unsupported operation in continuous basic attack", op.Path)
		}
	}

	return nil
}

func (s *genericRunState) markBasicAttackHit(useRef string) {
	if s.basicAttack == nil || s.basicAttack.current == nil || s.basicAttack.current.UseRef != useRef || s.basicAttack.current.HitAtMs != nil {
		return
	}
	at := s.nowMs
	s.basicAttack.current.HitAtMs = &at
	s.basicAttack.summary.HitCount++
}

func (s *genericRunState) finishCurrentAttackRecord() {
	b := s.basicAttack
	if b == nil || b.current == nil {
		return
	}
	b.current.SourceHpAfter = s.combatantHp(b.plan.Source)
	b.current.TargetHpAfter = s.combatantHp(b.plan.Target)
	if b.currentRecordIndex >= 0 {
		s.attackRecords[b.currentRecordIndex] = *b.current
	}
}

func (s *genericRunState) handleBasicAttack() (err *model.EngineError) {
	b := s.basicAttack
	if b == nil {
		return s.basicAttackErr("basic attack event has no plan", "driverPlan.basicAttack")
	}
	if s.initializationPending != 0 {
		return s.basicAttackErr("all source initialization must settle before the first attack", "initialSnapshot")
	}
	if s.combatantHp(b.plan.Source) <= 0 || s.combatantHp(b.plan.Target) <= 0 {
		return nil
	}
	if s.actionOccupied(b.plan.Source) {
		return s.basicAttackErr("attack cannot start while its source action is occupied", "driverPlan.basicAttack")
	}
	if ready, readinessError := s.basicAttackAmmoReady(); readinessError != nil || !ready {
		return readinessError
	}
	currentSpeed := s.combatants[b.plan.Source].attributes.At(b.plan.AttackSpeedAttributeKey).Resolved
	if math.IsNaN(currentSpeed) || math.IsInf(currentSpeed, 0) || currentSpeed <= 0 || currentSpeed > b.plan.AttackSpeedInputMax {
		return s.basicAttackErr("current attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	if b.summary.StartedCount >= s.budget.MaxBasicAttacks {
		return s.budgetError(model.BudgetCauseMaxBasicAttacks, "basic attack count exceeded")
	}
	s.basicAttackEventActive = true
	s.currentEventCommands = 0
	defer func() { s.basicAttackEventActive = false; s.finishCurrentAttackRecord() }()
	_, hitKey, err := s.beginNativeBasicAttackUse()
	if err != nil {
		return err
	}
	hitEntry := model.DriverEntry{EntryKey: hitKey, AbilityRef: b.plan.HitAbilityRef, Source: b.plan.Source, Target: b.plan.Target, FirstAtMs: s.nowMs}
	s.abilityAttemptCount++
	s.statFor(b.plan.HitAbilityRef).attemptCount++
	if err := s.executeAbilityCast(hitEntry); err != nil {
		return err
	}
	if s.processFailure != nil {
		return s.processFailure
	}
	if b.current.HitAtMs == nil {
		return s.basicAttackErr("native hit did not consume a real hit fact", b.plan.HitAbilityRef)
	}
	b.current.Completed = true
	b.summary.CompletedCount++
	b.unfinishedTail = false
	if b.targetKilledAt != nil || s.combatantHp(b.plan.Source) <= 0 || s.combatantHp(b.plan.Target) <= 0 {
		return nil
	}
	s.publishBasicAttackWait()
	return nil
}
