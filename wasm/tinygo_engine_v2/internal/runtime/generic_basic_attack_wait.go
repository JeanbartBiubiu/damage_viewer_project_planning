package runtime

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
	"tinygo_engine_v2/internal/status"
)

type basicAttackWait struct {
	providerState    map[string]float64
	targetState      map[string]float64
	initialReady     int64
	sourceAttributes map[string]model.AttributeSlotDef
	targetAttributes map[string]model.AttributeSlotDef
	anchor           int64
	period           int64
	remaining        float64
	speed            float64
	ready            int64
	generation       uint64
}

func basicAttackRemainingDelay(remaining float64, period int64) float64 {
	if remaining <= 0 {
		return 0
	}
	value := remaining * float64(period)
	nearest := math.Round(value)
	spacing := math.Nextafter(value, math.Inf(1)) - value
	if nearest >= 1 && math.Abs(value-nearest) <= math.Min(1e-9, 4*spacing) {
		value = nearest
	}
	return math.Max(1, math.Ceil(value))
}

func (f *executionFrame) stageInitialBasicAttackWait(process *processRuntime, ready int64) *model.EngineError {
	attack := f.run.basicAttack
	if attack == nil || !f.run.basicAttackEventActive || process.abilityRef != attack.plan.InitialControlAbilityRef || process.UseKey != attack.current.UseRef {
		return nil
	}
	if ready <= f.run.nowMs || ready > maxJSONSafeInteger {
		return f.run.basicAttackErr("initial attack cooldown must produce a positive safe waiting timestamp", attack.plan.InitialControlAbilityRef)
	}
	source := f.stageFor(attack.plan.Source).attributes
	target := f.stageFor(attack.plan.Target).attributes
	context := f.evalContext(attack.initialAbility)
	f.pendingBasicAttackWait = &basicAttackWait{initialReady: ready, anchor: f.run.nowMs, period: ready - f.run.nowMs, remaining: 1,
		speed: source[attack.plan.AttackSpeedAttributeKey].Resolved, ready: ready, generation: attack.waitGeneration + 1,
		sourceAttributes: cloneAttributeMap(source), targetAttributes: cloneAttributeMap(target),
		providerState: basicAttackStateSnapshot(context.ProviderState, context.ProviderStateDefaults), targetState: basicAttackStateSnapshot(context.ProviderTargetState, context.ProviderStateDefaults)}
	return nil
}

func basicAttackWaitDependenciesChanged(program formula.GenericProgram, wait *basicAttackWait, source, target map[string]model.AttributeSlotDef, context formula.GenericEvalContext) bool {
	for _, instruction := range program.Instr {
		if instruction.Op != formula.GenericOpRead {
			continue
		}
		if instruction.ReadKind == formula.ReadProviderState || instruction.ReadKind == formula.ReadProviderTargetState {
			previous, current := wait.providerState, context.ProviderState
			if instruction.ReadKind == formula.ReadProviderTargetState {
				previous, current = wait.targetState, context.ProviderTargetState
			}
			value, exists := current[instruction.ReadKey]
			if !exists {
				value = context.ProviderStateDefaults[instruction.ReadKey]
			}
			if previous[instruction.ReadKey] != value {
				return true
			}
			continue
		}
		previous, current := wait.sourceAttributes, source
		if instruction.ReadKind == formula.ReadTargetAttr {
			previous, current = wait.targetAttributes, target
		} else if instruction.ReadKind != formula.ReadSourceAttr {
			continue
		}
		key := instruction.ReadKey
		if separator := strings.LastIndex(key, "."); separator >= 0 {
			key = key[:separator]
		}
		before, beforeExists := previous[key]
		after, afterExists := current[key]
		if beforeExists != afterExists || before != after {
			return true
		}
	}
	return false
}

func (f *executionFrame) prepareBasicAttackWait() (int, *model.EngineError) {
	attack := f.run.basicAttack
	if err := f.prepareActionWait(); err != nil {
		return 0, err
	}
	if attack == nil {
		return 0, nil
	}
	// 初始化时尚无等待节点也要在本帧提交前检查真正消费的速度。
	initialContext, initialError := f.basicAttackWaitContext()
	if initialError != nil {
		return 0, initialError
	}
	initialSpeed := initialContext.stageFor(attack.plan.Source).attributes[attack.plan.AttackSpeedAttributeKey].Resolved
	if math.IsNaN(initialSpeed) || math.IsInf(initialSpeed, 0) || initialSpeed <= 0 || initialSpeed > attack.plan.AttackSpeedInputMax {
		return 0, f.run.basicAttackErr("modified attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	previous := attack.wait
	if f.pendingBasicAttackWait != nil {
		previous = f.pendingBasicAttackWait
	}
	if previous == nil {
		if (f.pendingAmmoWait != nil || f.pendingActionWait) && !f.run.heap.HasBasicAttack() && f.continuousCombatantsLive() {
			return 1, nil
		}
		return 0, nil
	}
	staged := f.stageFor(attack.plan.Source)
	if f.pendingBasicAttackWait == nil && staged.cooldowns[attack.plan.InitialControlAbilityRef] != previous.ready {
		ready := staged.cooldowns[attack.plan.InitialControlAbilityRef]
		if ready < f.run.nowMs || ready > maxJSONSafeInteger {
			return 0, f.run.basicAttackErr("changed attack cooldown requires a safe actual remaining deadline", attack.plan.InitialControlAbilityRef)
		}
		if err := f.consumeCommands(1); err != nil {
			return 0, err
		}
		wait := *previous
		wait.anchor, wait.ready = f.run.nowMs, ready
		wait.remaining = float64(ready-f.run.nowMs) / float64(wait.period)
		wait.generation++
		f.pendingBasicAttackWait, previous = &wait, &wait
	}
	if previous.ready <= f.run.nowMs {
		if (f.pendingBasicAttackWait != nil || f.pendingAmmoWait != nil || f.pendingActionWait) && !f.run.heap.HasBasicAttack() && f.continuousCombatantsLive() {
			return 1, nil
		}
		return 0, nil
	}
	f.stageFor(attack.plan.Target)
	context, contextError := f.basicAttackWaitContext()
	if contextError != nil {
		return 0, contextError
	}
	sourceAttributes := context.stageFor(attack.plan.Source).attributes
	targetAttributes := context.stageFor(attack.plan.Target).attributes
	speed := sourceAttributes[attack.plan.AttackSpeedAttributeKey].Resolved
	if math.IsNaN(speed) || math.IsInf(speed, 0) || speed <= 0 || speed > attack.plan.AttackSpeedInputMax {
		return 0, f.run.basicAttackErr("modified attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	process := f.run.compiled.Providers[attack.initialAbility.ProviderIndex].Processes[attack.initialAbility.ProcessControl.ProcessIndex]
	program := formula.GenericProgram{Instr: f.run.formulas.ReadDependencies(process.Cooldown.DurationProgram)}
	evalContext := context.evalContext(attack.initialAbility)
	if speed == previous.speed && !basicAttackWaitDependenciesChanged(program, previous, sourceAttributes, targetAttributes, evalContext) {
		if (f.pendingBasicAttackWait != nil || f.pendingAmmoWait != nil || f.pendingActionWait) && !f.run.heap.HasBasicAttack() && f.continuousCombatantsLive() {
			return 1, nil
		}
		return 0, nil
	}
	if err := f.consumeCommands(1); err != nil {
		return 0, err
	}
	periodValue, err := context.evalAmount(process.Cooldown.DurationProgram, attack.initialAbility)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(periodValue) || math.IsInf(periodValue, 0) || periodValue <= 0 || periodValue > float64(maxJSONSafeInteger) {
		return 0, f.run.basicAttackErr("adjusted attack period must be finite, positive and safe", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	period := int64(math.Max(1, math.Round(periodValue)))
	wait := *previous
	wait.remaining = math.Max(0, wait.remaining-float64(f.run.nowMs-wait.anchor)/float64(wait.period))
	delay := basicAttackRemainingDelay(wait.remaining, period)
	if delay > float64(maxJSONSafeInteger-f.run.nowMs) {
		return 0, f.run.basicAttackErr("adjusted attack time exceeds safe integer range", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	wait.anchor, wait.period, wait.speed = f.run.nowMs, period, speed
	wait.sourceAttributes = cloneAttributeMap(sourceAttributes)
	wait.targetAttributes = cloneAttributeMap(targetAttributes)
	wait.providerState = basicAttackStateSnapshot(evalContext.ProviderState, evalContext.ProviderStateDefaults)
	wait.targetState = basicAttackStateSnapshot(evalContext.ProviderTargetState, evalContext.ProviderStateDefaults)
	wait.ready = f.run.nowMs + int64(delay)
	wait.generation++
	f.pendingBasicAttackWait = &wait
	staged.cooldowns[attack.plan.InitialControlAbilityRef] = wait.ready
	if !f.run.heap.HasBasicAttack() && f.continuousCombatantsLive() {
		return 1, nil
	}
	return 0, nil
}

func (f *executionFrame) basicAttackWaitContext() (*executionFrame, *model.EngineError) {
	attack := f.run.basicAttack
	context := &executionFrame{run: f.run, sourceKey: attack.plan.Source, targetKey: attack.plan.Target,
		abilityRef: attack.plan.InitialControlAbilityRef, strictReads: true, staged: f.staged}
	parsed, _ := planbundle.ParseAbilityRef(attack.plan.InitialControlAbilityRef)
	context.ownerCombatantKey, context.ownerProviderRef = attack.plan.Source, parsed.ProviderRef
	providerChanges := false
	for _, staged := range f.staged {
		providerChanges = providerChanges || len(staged.providerOps) > 0
	}
	if !providerChanges {
		return context, nil
	}
	context.staged = make(map[string]*stagedCombatant, len(f.staged))
	for key, staged := range f.staged {
		copy := *staged
		copy.attributes = cloneAttributeMap(staged.attributes)
		copy.resources = cloneResourceMap(staged.resources)
		copy.cooldowns = cloneCooldownMap(staged.cooldowns)
		copy.providerState = cloneProviderStateMap(staged.providerState)
		copy.providers = append([]status.ProviderInstance(nil), staged.providers...)
		copy.resolver = staged.resolver.Clone()
		copy.damageResolver = staged.damageResolver.Clone()
		context.staged[key] = &copy
	}
	for _, owner := range []string{attack.plan.Source, attack.plan.Target} {
		staged := context.stageFor(owner)
		for index, mutation := range staged.providerOps {
			if mutation.kind == "apply" {
				definitionIndex, exists := f.run.findProviderDefinitionIndex(mutation.definitionRef)
				if !exists {
					return nil, f.run.basicAttackErr("missing dynamic result definition", mutation.definitionRef)
				}
				definition := f.run.compiled.Providers[definitionIndex]
				if definition.Lifecycle != nil && definition.Lifecycle.AllowsSourceTargetReuse() {
					if _, _, reused := findSourceTargetProvider(staged.providers, mutation.definitionRef, mutation.sourceKey, owner, f.run.nowMs); reused {
						continue
					}
					for _, instance := range staged.providers {
						if instance.DefinitionRef == mutation.definitionRef && instance.Source == mutation.sourceKey && instance.Owner == owner && instance.Expired(f.run.nowMs) {
							context.unmountWaitingProvider(owner, instance.ProviderRef)
						}
					}
				}
				instance := status.ProviderInstance{ProviderRef: mutation.definitionRef + "@pending:" + itoa(uint32(index)),
					DefinitionRef: mutation.definitionRef, DefinitionIndex: definitionIndex, Source: mutation.sourceKey, Owner: owner, Stacks: 1, ExpireAt: mutation.expireAt}
				staged.providers = append(staged.providers, instance)
				for _, modifier := range definition.Modifiers {
					if modifier.Kind == "attribute" || modifier.Kind == "" {
						host := context.stageFor(modifierMountCombatantKey(owner, modifier.Target))
						host.resolver.MountCompiledModifierOwned(owner, instance.ProviderRef, modifier)
					}
				}
			} else if mutation.kind == "expire" {
				context.unmountWaitingProvider(owner, mutation.providerRef)
			}
		}
	}
	context.reResolveStagedAttributesTwoPass(attack.initialAbility)
	if context.fatal {
		return nil, context.fatalErr
	}
	return context, nil
}

func (f *executionFrame) unmountWaitingProvider(owner, ref string) {
	staged := f.stageFor(owner)
	staged.providers = status.RemoveByRef(staged.providers, ref)
	delete(staged.providerState, ref)
	for _, host := range f.staged {
		host.resolver.UnmountProviderOwned(owner, ref)
	}
}

func (f *executionFrame) commitBasicAttackWait() {
	if f.pendingBasicAttackWait == nil && f.pendingAmmoWait == nil && !f.pendingActionWait {
		return
	}
	attack := f.run.basicAttack
	wait := f.pendingBasicAttackWait
	initial := wait != nil && attack.wait == nil
	if wait != nil {
		attack.wait = wait
		attack.waitGeneration = wait.generation
	}
	if f.continuousCombatantsLive() {
		generation := uint64(0)
		if attack.wait != nil {
			generation = attack.wait.generation
		}
		ready := f.run.nextBasicAttackTime()
		if !f.run.heap.RescheduleBasicAttack(ready, generation) {
			f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: ready, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1, BasicAttackGeneration: generation})
		}
	}
	if initial && attack.current != nil {
		ready := wait.initialReady
		f.run.basicAttack.current.ReadyAtMs = &ready
	}
	f.run.publishBasicAttackWait()
	if wait == nil || (initial && wait.ready == wait.initialReady) {
		return
	}
	f.recordEvidence(model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "basic_attack_wait_adjusted", Ref: f.run.basicAttack.plan.InitialControlAbilityRef,
		Data: map[string]interface{}{"periodMs": wait.period, "remainingRatio": wait.remaining, "readyAtMs": wait.ready, "generation": wait.generation}})
}

func (s *genericRunState) publishBasicAttackWait() {
	attack := s.basicAttack
	if attack == nil {
		return
	}
	next := s.nextBasicAttackTime()
	attack.windowSettled = next > s.startMs+s.durationMs
	if attack.summary.StartedCount == 0 {
		attack.summary.InitialActionReadyAtMs = s.actionContribution(0, s.nowMs+1)
	}
	if attack.current == nil {
		return
	}
	if s.stopReasonSet && (s.stopReason == model.StopReasonBudgetExceeded || s.stopReason == model.StopReasonSourceDead || s.stopReason == model.StopReasonTargetDead || s.stopReason == model.StopReasonBothDead) {
		attack.current.NextStartAtMs = nil
		if attack.currentRecordIndex >= 0 {
			s.attackRecords[attack.currentRecordIndex] = *attack.current
		}
		return
	}
	if attack.wait == nil {
		return
	}
	ready := attack.wait.ready
	attack.current.FinalReadyAtMs = &ready
	attack.current.ActionReadyAtMs = s.actionContribution(attack.current.StartAtMs, s.nowMs+1)
	attack.current.NextStartAtMs = nil
	if !attack.windowSettled && !s.actionDeaths[attack.plan.Source] && !s.actionDeaths[attack.plan.Target] && s.combatantHp(attack.plan.Source) > 0 && s.combatantHp(attack.plan.Target) > 0 && s.budgetCause == "" {
		attack.current.NextStartAtMs = &next
	}
	if attack.currentRecordIndex >= 0 {
		s.attackRecords[attack.currentRecordIndex] = *attack.current
	}
}

func (s *genericRunState) basicAttackEventCurrent(event scheduler.GenericEvent) bool {
	if s.basicAttack == nil {
		return false
	}
	if s.basicAttack.wait == nil {
		return event.BasicAttackGeneration == 0 && event.TimeMs == s.nextBasicAttackTime()
	}
	wait := s.basicAttack.wait
	return event.BasicAttackGeneration == wait.generation && event.TimeMs == s.nextBasicAttackTime() && s.combatants[s.basicAttack.plan.Source].cooldowns[s.basicAttack.plan.InitialControlAbilityRef] == wait.ready
}

func (s *genericRunState) nextBasicAttackTime() int64 {
	ready := s.actionReadyAt(s.basicAttack.plan.Source)
	if s.basicAttack.wait != nil && s.basicAttack.wait.ready > ready {
		ready = s.basicAttack.wait.ready
	}
	if ammo := s.basicAttack.ammo; ammo != nil && ammo.wait.active && ammo.wait.readyAt > ready {
		ready = ammo.wait.readyAt
	}
	return ready
}

func basicAttackStateSnapshot(values, defaults map[string]float64) map[string]float64 {
	if len(values)+len(defaults) == 0 {
		return nil
	}
	snapshot := make(map[string]float64, len(values)+len(defaults))
	for key, value := range defaults {
		snapshot[key] = value
	}
	for key, value := range values {
		snapshot[key] = value
	}
	return snapshot
}
