package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import "tinygo_engine_v2/internal/runtime/contract"

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

func basicAttackProgressDeadline(wait *actionpkg.AttackWaitView) int64 {
	if wait == nil {
		return 0
	}
	return wait.ProgressDeadline()
}

func basicAttackCooldownWaitKey(attack *actionpkg.BasicAttackView) actionpkg.CooldownWaitKey {
	return actionpkg.CooldownWaitKey{Kind: "basic_attack", Owner: attack.Plan().Source, Key: attack.Plan().PlanKey}
}

func (s *Engine) basicAttackReadyAt() int64 {
	if s.actions.BasicAttack() == nil {
		return 0
	}
	return s.combatants[s.actions.BasicAttack().Plan().Source].cooldowns.AbilityReadyAt(s.actions.BasicAttack().Plan().Source, s.actions.BasicAttack().Plan().InitialControlAbilityRef)
}

func (f *Frame) stageInitialBasicAttackWait(process *actionpkg.ProcessView, ready int64) *model.EngineError {
	attack := f.run.actions.BasicAttack()
	if attack == nil || !f.run.actions.AttackActive() || process.AbilityRef() != attack.Plan().InitialControlAbilityRef || process.UseKey() != attack.Current().UseRef() {
		return nil
	}
	if ready <= f.run.loop.TimeMs() || ready > maxJSONSafeInteger {
		return f.run.basicAttackErr("initial attack cooldown must produce a positive safe waiting timestamp", attack.Plan().InitialControlAbilityRef)
	}
	source := f.stageFor(attack.Plan().Source).attributesView()
	target := f.stageFor(attack.Plan().Target).attributesView()
	context := f.evalContext(attack.InitialAbility())
	f.pendingBasicAttackWait = actionpkg.NewAttackWait(actionpkg.AttackWaitSeed{InitialReady: ready, Anchor: f.run.loop.TimeMs(), Period: ready - f.run.loop.TimeMs(), Remaining: 1,
		Speed:            source.At(attack.Plan().AttackSpeedAttributeKey).Resolved,
		SourceAttributes: source, TargetAttributes: target,
		ProviderState: model.BorrowNumericView(basicAttackStateSnapshot(context.ProviderState, context.ProviderStateDefaults)), TargetState: model.BorrowNumericView(basicAttackStateSnapshot(context.ProviderTargetState, context.ProviderStateDefaults))})
	return nil
}

func (f *Frame) prepareBasicAttackWait() (int, *model.EngineError) {
	count, err := f.prepareBasicAttackProgress()
	if err != nil || f.run.actions.BasicAttack() == nil {
		return count, err
	}
	attack := f.run.actions.BasicAttack()
	if f.pendingBasicAttackWait == nil && !f.hasPendingBasicAttackAmmo() && !f.pendingActionWait {
		return count, nil
	}
	notBefore := f.run.loop.TimeMs()
	for processSlot := 0; processSlot < f.run.actions.ProcessCount(); processSlot++ {
		process := f.run.actions.ProcessAt(processSlot)
		if process == f.processOriginal {
			continue
		}
		if process.OccupiesAction(attack.Plan().Source) && process.ActionDeadline() > notBefore {
			notBefore = process.ActionDeadline()
		}
	}
	if f.pendingProcess.OccupiesAction(attack.Plan().Source) && f.pendingProcess.ActionDeadline() > notBefore {
		notBefore = f.pendingProcess.ActionDeadline()
	}
	if ammo := attack.Ammo(); ammo != nil {
		wait := ammo.Wait()
		if f.hasPendingBasicAttackAmmo() {
			wait = f.ammoWait(ammo)
		}
		value, err := f.ammoInventory(ammo)
		if err != nil {
			return 0, err
		}
		if value == 0 && wait.Active && wait.ReadyAt > notBefore {
			notBefore = wait.ReadyAt
		}
	}
	ledger := f.stageFor(attack.Plan().Source).writableCooldowns()
	ledger.RegisterWait(basicAttackCooldownWaitKey(attack), []contract.CooldownIdentity{actionpkg.AbilityCooldownIdentity(attack.Plan().Source, attack.Plan().InitialControlAbilityRef)}, notBefore, f.run.loop.TimeMs())
	return count, nil
}

func (f *Frame) prepareBasicAttackProgress() (int, *model.EngineError) {
	attack := f.run.actions.BasicAttack()
	if err := f.prepareActionWait(); err != nil {
		return 0, err
	}
	if attack == nil {
		return 0, nil
	}
	// 初始化时尚无等待节点也要在本帧提交前检查真正消费的速度。
	var initialContext Frame
	if initialError := f.basicAttackWaitContext(&initialContext); initialError != nil {
		return 0, initialError
	}
	initialSpeed := initialContext.stageFor(attack.Plan().Source).attributesView().At(attack.Plan().AttackSpeedAttributeKey).Resolved
	if math.IsNaN(initialSpeed) || math.IsInf(initialSpeed, 0) || initialSpeed <= 0 || initialSpeed > attack.Plan().AttackSpeedInputMax {
		return 0, f.run.basicAttackErr("modified attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	previous := attack.Wait()
	if f.pendingBasicAttackWait != nil {
		previous = f.pendingBasicAttackWait
	}
	if previous == nil {
		if (f.hasPendingBasicAttackAmmo() || f.pendingActionWait) && !f.run.loop.Queue().HasBasicAttack() && f.continuousCombatantsLive() {
			return 1, nil
		}
		return 0, nil
	}
	staged := f.stageFor(attack.Plan().Source)
	previousReady := basicAttackProgressDeadline(previous)
	actualReady := staged.cooldowns.AbilityReadyAt(attack.Plan().Source, attack.Plan().InitialControlAbilityRef)
	if f.pendingBasicAttackWait == nil && actualReady != previousReady && (actualReady > f.run.loop.TimeMs() || previousReady > f.run.loop.TimeMs()) {
		ready := staged.cooldowns.AbilityReadyAt(attack.Plan().Source, attack.Plan().InitialControlAbilityRef)
		if ready > maxJSONSafeInteger {
			return 0, f.run.basicAttackErr("changed attack cooldown requires a safe actual remaining deadline", attack.Plan().InitialControlAbilityRef)
		}
		if ready < f.run.loop.TimeMs() {
			ready = f.run.loop.TimeMs()
		}
		if err := f.consumeCommands(1); err != nil {
			return 0, err
		}
		wait := previous.Reanchor(f.run.loop.TimeMs(), ready)
		f.pendingBasicAttackWait, previous = wait, wait
		previousReady = ready
	}
	if previousReady <= f.run.loop.TimeMs() {
		if (f.pendingBasicAttackWait != nil || f.hasPendingBasicAttackAmmo() || f.pendingActionWait) && !f.run.loop.Queue().HasBasicAttack() && f.continuousCombatantsLive() {
			return 1, nil
		}
		return 0, nil
	}
	f.stageFor(attack.Plan().Target)
	// 上述等待信息调整不会写公式输入，复用本帧已完成的预检视图。
	context := &initialContext
	sourceAttributes := context.stageFor(attack.Plan().Source).attributesView()
	targetAttributes := context.stageFor(attack.Plan().Target).attributesView()
	speed := sourceAttributes.At(attack.Plan().AttackSpeedAttributeKey).Resolved
	if math.IsNaN(speed) || math.IsInf(speed, 0) || speed <= 0 || speed > attack.Plan().AttackSpeedInputMax {
		return 0, f.run.basicAttackErr("modified attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	process := f.run.compiled.Providers[attack.InitialAbility().ProviderIndex].Processes[attack.InitialAbility().ProcessControl.ProcessIndex]
	evalContext := context.evalContext(attack.InitialAbility())
	if speed == previous.Speed() && !attack.WaitDependenciesChanged(previous, sourceAttributes, targetAttributes, evalContext) {
		if (f.pendingBasicAttackWait != nil || f.hasPendingBasicAttackAmmo() || f.pendingActionWait) && !f.run.loop.Queue().HasBasicAttack() && f.continuousCombatantsLive() {
			return 1, nil
		}
		return 0, nil
	}
	if err := f.consumeCommands(1); err != nil {
		return 0, err
	}
	periodValue, err := context.evalAmount(process.Cooldown.DurationProgram, attack.InitialAbility())
	if err != nil {
		return 0, err
	}
	if math.IsNaN(periodValue) || math.IsInf(periodValue, 0) || periodValue <= 0 || periodValue > float64(maxJSONSafeInteger) {
		return 0, f.run.basicAttackErr("adjusted attack period must be finite, positive and safe", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	period := int64(math.Max(1, math.Round(periodValue)))
	delay := actionpkg.BasicAttackRemainingDelay(previous.RemainingAt(f.run.loop.TimeMs()), period)
	if delay > float64(maxJSONSafeInteger-f.run.loop.TimeMs()) {
		return 0, f.run.basicAttackErr("adjusted attack time exceeds safe integer range", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	f.pendingBasicAttackWait = previous.Recalculate(f.run.loop.TimeMs(), period, speed, context.stageFor(attack.Plan().Source).attributesView(), context.stageFor(attack.Plan().Target).attributesView(), model.BorrowNumericView(basicAttackStateSnapshot(evalContext.ProviderState, evalContext.ProviderStateDefaults)), model.BorrowNumericView(basicAttackStateSnapshot(evalContext.ProviderTargetState, evalContext.ProviderStateDefaults)))
	staged.writableCooldowns().Set(actionpkg.AbilityCooldownIdentity(attack.Plan().Source, attack.Plan().InitialControlAbilityRef), f.run.loop.TimeMs()+int64(delay), f.run.loop.TimeMs())
	if !f.run.loop.Queue().HasBasicAttack() && f.continuousCombatantsLive() {
		return 1, nil
	}
	return 0, nil
}

func (f *Frame) basicAttackWaitContext(context *Frame) *model.EngineError {
	attack := f.run.actions.BasicAttack()
	*context = Frame{run: f.run, sourceKey: attack.Plan().Source, targetKey: attack.Plan().Target,
		abilityRef: attack.Plan().InitialControlAbilityRef, strictReads: true, staged: f.staged}
	parsed, _ := planbundle.ParseAbilityRef(attack.Plan().InitialControlAbilityRef)
	context.ownerCombatantKey, context.ownerProviderRef = attack.Plan().Source, parsed.ProviderRef
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
		// Dynamic projection marks mutations; the waiting preview cannot mark the parent's commands.
		copy.providerOps = append([]stagedProviderMutation(nil), staged.providerOps...)

		copy.setAttributes(staged.attributesView())
		copy.numbers = staged.numbers.Clone()
		copy.cooldowns = staged.readonlyCooldowns()
		copy.cooldownsShared = true
		copy.providerState = staged.providerState.Clone()

		copy.instances = staged.instances.Clone()
		context.staged.Set(key, &copy)
	})
	for _, owner := range []string{attack.Plan().Source, attack.Plan().Target} {
		staged := context.stageFor(owner)
		for index, mutation := range staged.providerOps {
			if mutation.projected {
				continue
			}
			if mutation.kind == "apply" || mutation.kind == "shield_apply" {
				definitionIndex, exists := mutation.definitionIndex, mutation.kind == "shield_apply"
				if !exists {
					definitionIndex, exists = f.run.findProviderDefinitionIndex(mutation.definitionRef)
				}
				if !exists {
					return f.run.basicAttackErr("missing dynamic result definition", mutation.definitionRef)
				}
				definition := f.run.compiled.Providers[definitionIndex]
				if mutation.kind != "shield_apply" && definition.Lifecycle != nil && definition.Lifecycle.AllowsSourceTargetReuse() {
					if current, currentIndex, reused := staged.instances.Providers().FindSourceTarget(mutation.definitionRef, mutation.sourceKey, owner, f.run.loop.TimeMs()); reused {
						if definition.NeedsElapsedTime {
							current.AppliedAtMs, current.HasAppliedAt, current.ExpireAt = f.run.loop.TimeMs(), true, mutation.expireAt
							staged.instances.ReplaceProvider(currentIndex, current)
						}
						continue
					}
					for instanceIndex, instanceValues := 0, staged.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
						instance := instanceValues.At(instanceIndex)
						if instance.DefinitionRef == mutation.definitionRef && instance.Source == mutation.sourceKey && instance.Owner == owner && instance.Expired(f.run.loop.TimeMs()) {
							context.unmountWaitingProvider(owner, instance.ProviderRef)
						}
					}
				}
				instance := effectpkg.Provider{ProviderRef: mutation.definitionRef + "@pending:" + itoa(uint32(index)),
					DefinitionRef: mutation.definitionRef, DefinitionIndex: definitionIndex, Source: mutation.sourceKey, Owner: owner, Stacks: 1, ExpireAt: mutation.expireAt}
				if mutation.kind == "shield_apply" {
					instance.ProviderRef = mutation.providerRef
				}
				if definition.NeedsElapsedTime {
					instance.AppliedAtMs, instance.HasAppliedAt = f.run.loop.TimeMs(), true
				}
				staged.instances.AppendProvider(instance)
				for _, modifier := range definition.Modifiers {
					if modifier.Kind == "attribute" || modifier.Kind == "" {
						host := context.stageFor(modifierMountCombatantKey(owner, modifier.Target))
						host.instances.MountAttributeCompiled(owner, instance.ProviderRef, modifier)
					}
				}
			} else if mutation.kind == "expire" {
				context.unmountWaitingProvider(owner, mutation.providerRef)
			}
		}
	}
	context.reResolveStagedAttributesTwoPass(attack.InitialAbility())
	if context.fatal {
		return context.fatalErr
	}
	return nil
}

func (f *Frame) unmountWaitingProvider(owner, ref string) {
	staged := f.stageFor(owner)
	staged.instances.SetProviders(staged.instances.Providers().RemoveRef(ref))
	staged.providerState.Remove(ref)
	f.staged.Range(func(_ string, host *stagedCombatant) {
		host.instances.UnmountAttribute(owner, ref)
	})
}

func (f *Frame) commitBasicAttackWait() {
	if f.run.actions.BasicAttack() == nil || f.pendingBasicAttackWait == nil && !f.hasPendingBasicAttackAmmo() && !f.pendingActionWait {
		return
	}
	attack := f.run.actions.BasicAttack()
	wait := f.pendingBasicAttackWait
	initial := wait != nil && attack.Wait() == nil
	if wait != nil {
		f.run.actions.SetAttackWait(wait)
	}
	if f.continuousCombatantsLive() {
		generation := uint64(0)
		if registration, exists := f.run.combatants[attack.Plan().Source].cooldowns.Wait(basicAttackCooldownWaitKey(attack)); exists {
			generation = registration.Version
		}
		ready := f.run.nextBasicAttackTime()
		if !f.run.loop.Queue().RescheduleBasicAttack(ready, generation) {
			f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: ready, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventBasicAttack, DriverEntryIndex: -1, BasicAttackGeneration: generation})
		}
	}
	if initial && attack.Current() != nil {
		ready := wait.InitialReady()
		f.run.actions.SetAttackReady(ready)
	}
	f.run.publishBasicAttackWait()
	if wait == nil || (initial && f.run.basicAttackReadyAt() == wait.InitialReady()) {
		return
	}
	f.recordEvidenceLazy("basic_attack_wait_adjusted", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "basic_attack_wait_adjusted", Ref: f.run.actions.BasicAttack().Plan().InitialControlAbilityRef,
			Data: map[string]interface{}{"periodMs": wait.Period(), "remainingRatio": wait.Remaining(), "readyAtMs": f.run.basicAttackReadyAt(), "generation": f.run.combatants[attack.Plan().Source].cooldowns.WaitValue(basicAttackCooldownWaitKey(attack)).Version}}
	})
}

func (s *Engine) publishBasicAttackWait() {
	attack := s.actions.BasicAttack()
	if attack == nil {
		return
	}
	next := s.nextBasicAttackTime()
	s.actions.SetAttackWindowSettled(next > s.loop.StartMs()+s.loop.DurationMs())
	if attack.StartedCount() == 0 {
		s.actions.SetInitialActionReady(s.actionContribution(0, s.loop.TimeMs()+1))
	}
	if attack.Current() == nil {
		return
	}
	if s.loop.Stopped() && (s.loop.Reason() == model.StopReasonBudgetExceeded || s.loop.Reason() == model.StopReasonSourceDead || s.loop.Reason() == model.StopReasonTargetDead || s.loop.Reason() == model.StopReasonBothDead) {
		s.actions.SetAttackNext(nil)
		if attack.CurrentRecordIndex() >= 0 {
			s.report.ReplaceAttackRecord(attack.CurrentRecordIndex(), attack.Current().Snapshot())
		}
		return
	}
	if attack.Wait() == nil {
		return
	}
	ready := s.basicAttackReadyAt()
	s.actions.SetAttackFinalReady(ready, s.actionContribution(attack.Current().StartAtMs(), s.loop.TimeMs()+1))
	s.actions.SetAttackNext(nil)
	if !attack.WindowSettled() && !s.actions.Dead(attack.Plan().Source) && !s.actions.Dead(attack.Plan().Target) && s.combatantHp(attack.Plan().Source) > 0 && s.combatantHp(attack.Plan().Target) > 0 && s.budgetCause == "" {
		s.actions.SetAttackNext(&next)
	}
	if attack.CurrentRecordIndex() >= 0 {
		s.report.ReplaceAttackRecord(attack.CurrentRecordIndex(), attack.Current().Snapshot())
	}
}

func (s *Engine) basicAttackEventCurrent(event scheduler.GenericEvent) bool {
	if s.actions.BasicAttack() == nil {
		return false
	}
	ledger := s.combatants[s.actions.BasicAttack().Plan().Source].cooldowns
	key := basicAttackCooldownWaitKey(s.actions.BasicAttack())
	if _, exists := ledger.Wait(key); exists {
		return event.TimeMs == s.nextBasicAttackTime() && ledger.WaitCurrent(key, event.TimeMs, event.BasicAttackGeneration)
	}
	return s.actions.BasicAttack().Wait() == nil && event.BasicAttackGeneration == 0 && event.TimeMs == s.nextBasicAttackTime()
}

func (s *Engine) nextBasicAttackTime() int64 {
	ready := s.actionReadyAt(s.actions.BasicAttack().Plan().Source)
	if cooldown := s.basicAttackReadyAt(); cooldown > ready {
		ready = cooldown
	}
	if ammo := s.actions.BasicAttack().Ammo(); ammo != nil && ammo.Wait().Active && ammo.Wait().ReadyAt > ready {
		value := ammo.Definition().StateFields[ammo.Binding().StateKey].DefaultValue
		if bag := s.combatants[ammo.Owner()].providerState.Lookup(ammo.ProviderRef()); bag.Present() {
			value = bag.State().At(ammo.Binding().StateKey)
		}
		if value == 0 {
			ready = ammo.Wait().ReadyAt
		}
	}
	return ready
}

func basicAttackStateSnapshot(values, defaults model.NumericView) map[string]float64 {
	if values.Len()+defaults.Len() == 0 {
		return nil
	}
	snapshot := make(map[string]float64, values.Len()+defaults.Len())
	defaults.Range(func(key string, value float64) bool {
		snapshot[key] = value
		return true
	})
	values.Range(func(key string, value float64) bool {
		snapshot[key] = value
		return true
	})
	return snapshot
}
