package runtime

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/attribute"
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
	sourceAttributes attribute.Table
	targetAttributes attribute.Table
	anchor           int64
	period           int64
	remaining        float64
	speed            float64
}

func basicAttackProgressDeadline(wait *basicAttackWait) int64 {
	if wait == nil {
		return 0
	}
	return wait.anchor + int64(basicAttackRemainingDelay(wait.remaining, wait.period))
}

func basicAttackCooldownWaitKey(attack *basicAttackRuntime) genericCooldownWaitKey {
	return genericCooldownWaitKey{kind: "basic_attack", owner: attack.plan.Source, key: attack.plan.PlanKey}
}

func (s *genericRunState) basicAttackReadyAt() int64 {
	if s.basicAttack == nil {
		return 0
	}
	return s.combatants[s.basicAttack.plan.Source].cooldowns.abilityReadyAt(s.basicAttack.plan.Source, s.basicAttack.plan.InitialControlAbilityRef)
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
		speed:            source.At(attack.plan.AttackSpeedAttributeKey).Resolved,
		sourceAttributes: source, targetAttributes: target,
		providerState: basicAttackStateSnapshot(context.ProviderState, context.ProviderStateDefaults), targetState: basicAttackStateSnapshot(context.ProviderTargetState, context.ProviderStateDefaults)}
	return nil
}

func basicAttackWaitDependenciesChanged(program formula.GenericProgram, wait *basicAttackWait, source, target attribute.Table, context formula.GenericEvalContext) bool {
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
		before, beforeExists := previous.Lookup(key)
		after, afterExists := current.Lookup(key)
		if beforeExists != afterExists || before != after {
			return true
		}
	}
	return false
}

func (f *executionFrame) prepareBasicAttackWait() (int, *model.EngineError) {
	count, err := f.prepareBasicAttackProgress()
	if err != nil || f.run.basicAttack == nil {
		return count, err
	}
	attack := f.run.basicAttack
	if f.pendingBasicAttackWait == nil && f.pendingAmmoWait == nil && !f.pendingActionWait {
		return count, nil
	}
	notBefore := f.run.nowMs
	for _, process := range f.run.processInstances {
		if process == f.processOriginal {
			continue
		}
		if processOccupiesAction(process, attack.plan.Source) && processActionDeadline(process) > notBefore {
			notBefore = processActionDeadline(process)
		}
	}
	if processOccupiesAction(f.pendingProcess, attack.plan.Source) && processActionDeadline(f.pendingProcess) > notBefore {
		notBefore = processActionDeadline(f.pendingProcess)
	}
	if ammo := attack.ammo; ammo != nil {
		wait := ammo.wait
		if f.pendingAmmoWait != nil {
			wait = *f.pendingAmmoWait
		}
		if wait.active && wait.readyAt > notBefore {
			notBefore = wait.readyAt
		}
	}
	ledger := f.stageFor(attack.plan.Source).writableCooldowns()
	ledger.registerWait(basicAttackCooldownWaitKey(attack), []genericCooldownIdentity{genericAbilityCooldownIdentity(attack.plan.Source, attack.plan.InitialControlAbilityRef)}, notBefore, f.run.nowMs)
	return count, nil
}

func (f *executionFrame) prepareBasicAttackProgress() (int, *model.EngineError) {
	attack := f.run.basicAttack
	if err := f.prepareActionWait(); err != nil {
		return 0, err
	}
	if attack == nil {
		return 0, nil
	}
	// 初始化时尚无等待节点也要在本帧提交前检查真正消费的速度。
	var initialContext executionFrame
	if initialError := f.basicAttackWaitContext(&initialContext); initialError != nil {
		return 0, initialError
	}
	initialSpeed := initialContext.stageFor(attack.plan.Source).attributes.At(attack.plan.AttackSpeedAttributeKey).Resolved
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
	previousReady := basicAttackProgressDeadline(previous)
	actualReady := staged.cooldowns.abilityReadyAt(attack.plan.Source, attack.plan.InitialControlAbilityRef)
	if f.pendingBasicAttackWait == nil && actualReady != previousReady && (actualReady > f.run.nowMs || previousReady > f.run.nowMs) {
		ready := staged.cooldowns.abilityReadyAt(attack.plan.Source, attack.plan.InitialControlAbilityRef)
		if ready > maxJSONSafeInteger {
			return 0, f.run.basicAttackErr("changed attack cooldown requires a safe actual remaining deadline", attack.plan.InitialControlAbilityRef)
		}
		if ready < f.run.nowMs {
			ready = f.run.nowMs
		}
		if err := f.consumeCommands(1); err != nil {
			return 0, err
		}
		wait := *previous
		wait.anchor = f.run.nowMs
		wait.remaining = float64(ready-f.run.nowMs) / float64(wait.period)
		f.pendingBasicAttackWait, previous = &wait, &wait
		previousReady = ready
	}
	if previousReady <= f.run.nowMs {
		if (f.pendingBasicAttackWait != nil || f.pendingAmmoWait != nil || f.pendingActionWait) && !f.run.heap.HasBasicAttack() && f.continuousCombatantsLive() {
			return 1, nil
		}
		return 0, nil
	}
	f.stageFor(attack.plan.Target)
	// 上述等待信息调整不会写公式输入，复用本帧已完成的预检视图。
	context := &initialContext
	sourceAttributes := context.stageFor(attack.plan.Source).attributes
	targetAttributes := context.stageFor(attack.plan.Target).attributes
	speed := sourceAttributes.At(attack.plan.AttackSpeedAttributeKey).Resolved
	if math.IsNaN(speed) || math.IsInf(speed, 0) || speed <= 0 || speed > attack.plan.AttackSpeedInputMax {
		return 0, f.run.basicAttackErr("modified attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	process := f.run.compiled.Providers[attack.initialAbility.ProviderIndex].Processes[attack.initialAbility.ProcessControl.ProcessIndex]
	program := formula.GenericProgram{Instr: attack.cooldownDependencies}
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
	wait.sourceAttributes = context.stageFor(attack.plan.Source).attributes
	wait.targetAttributes = context.stageFor(attack.plan.Target).attributes
	wait.providerState = basicAttackStateSnapshot(evalContext.ProviderState, evalContext.ProviderStateDefaults)
	wait.targetState = basicAttackStateSnapshot(evalContext.ProviderTargetState, evalContext.ProviderStateDefaults)
	f.pendingBasicAttackWait = &wait
	staged.writableCooldowns().set(genericAbilityCooldownIdentity(attack.plan.Source, attack.plan.InitialControlAbilityRef), f.run.nowMs+int64(delay), f.run.nowMs)
	if !f.run.heap.HasBasicAttack() && f.continuousCombatantsLive() {
		return 1, nil
	}
	return 0, nil
}

func (f *executionFrame) basicAttackWaitContext(context *executionFrame) *model.EngineError {
	attack := f.run.basicAttack
	*context = executionFrame{run: f.run, sourceKey: attack.plan.Source, targetKey: attack.plan.Target,
		abilityRef: attack.plan.InitialControlAbilityRef, strictReads: true, staged: f.staged}
	parsed, _ := planbundle.ParseAbilityRef(attack.plan.InitialControlAbilityRef)
	context.ownerCombatantKey, context.ownerProviderRef = attack.plan.Source, parsed.ProviderRef
	providerChanges := false
	f.staged.Range(func(_ string, staged *stagedCombatant) {
		providerChanges = providerChanges || len(staged.providerOps) > 0
	})
	if !providerChanges {
		return nil
	}
	context.staged = &frameStagedCollection{}
	f.staged.Range(func(key string, staged *stagedCombatant) {
		copy := *staged
		copy.attributes = staged.attributes
		copy.resources = staged.readonlyResources()
		copy.resourcesShared = true
		copy.cooldowns = staged.readonlyCooldowns()
		copy.cooldownsShared = true
		copy.providerState = cloneProviderStateMap(staged.providerState)
		copy.providerStateShared = false
		copy.providers = append([]status.ProviderInstance(nil), staged.providers...)
		copy.resolver = staged.resolver.Clone()
		copy.damageResolver = staged.damageResolver.Clone()
		context.staged.Set(key, &copy)
	})
	for _, owner := range []string{attack.plan.Source, attack.plan.Target} {
		staged := context.stageFor(owner)
		for index, mutation := range staged.providerOps {
			if mutation.kind == "apply" {
				definitionIndex, exists := f.run.findProviderDefinitionIndex(mutation.definitionRef)
				if !exists {
					return f.run.basicAttackErr("missing dynamic result definition", mutation.definitionRef)
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
		return context.fatalErr
	}
	return nil
}

func (f *executionFrame) unmountWaitingProvider(owner, ref string) {
	staged := f.stageFor(owner)
	staged.providers = status.RemoveByRef(staged.providers, ref)
	delete(staged.writableProviderStates(), ref)
	f.staged.Range(func(_ string, host *stagedCombatant) {
		host.resolver.UnmountProviderOwned(owner, ref)
	})
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
	}
	if f.continuousCombatantsLive() {
		generation := uint64(0)
		if registration, exists := f.run.combatants[attack.plan.Source].cooldowns.wait(basicAttackCooldownWaitKey(attack)); exists {
			generation = registration.version
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
	if wait == nil || (initial && f.run.basicAttackReadyAt() == wait.initialReady) {
		return
	}
	f.recordEvidenceLazy("basic_attack_wait_adjusted", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "basic_attack_wait_adjusted", Ref: f.run.basicAttack.plan.InitialControlAbilityRef,
			Data: map[string]interface{}{"periodMs": wait.period, "remainingRatio": wait.remaining, "readyAtMs": f.run.basicAttackReadyAt(), "generation": f.run.combatants[attack.plan.Source].cooldowns.waitValue(basicAttackCooldownWaitKey(attack)).version}}
	})
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
	ready := s.basicAttackReadyAt()
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
	ledger := s.combatants[s.basicAttack.plan.Source].cooldowns
	key := basicAttackCooldownWaitKey(s.basicAttack)
	if _, exists := ledger.wait(key); exists {
		return event.TimeMs == s.nextBasicAttackTime() && ledger.waitCurrent(key, event.TimeMs, event.BasicAttackGeneration)
	}
	return s.basicAttack.wait == nil && event.BasicAttackGeneration == 0 && event.TimeMs == s.nextBasicAttackTime()
}

func (s *genericRunState) nextBasicAttackTime() int64 {
	ready := s.actionReadyAt(s.basicAttack.plan.Source)
	if cooldown := s.basicAttackReadyAt(); cooldown > ready {
		ready = cooldown
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
