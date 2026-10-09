package runtime

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

type ammoUseCapture struct {
	useRef      string
	owner       string
	providerRef string
	stateKey    string
	before      float64
}

type ammoRecoveryWait struct {
	readyAt    int64
	generation uint64
	active     bool
}

type basicAttackAmmo struct {
	owner       string
	providerRef string
	definition  planbundle.CompiledProvider
	binding     planbundle.CompiledAmmoBinding
	wait        ammoRecoveryWait
}

func validBasicAttackAmmoProvider(provider planbundle.CompiledProvider) bool {
	if provider.AmmoBinding == nil {
		return len(provider.StateFields) == 0
	}
	field, exists := provider.StateFields[provider.AmmoBinding.StateKey]
	return exists && len(provider.StateFields) == 1 && field.StateKind == model.ProviderStateKindAmmo && field.AmmoRecovery != nil
}

func (s *genericRunState) basicAttackAmmoReady() (bool, *model.EngineError) {
	ammo := s.basicAttack.ammo
	if ammo == nil {
		return true, nil
	}
	frame := s.newExecutionFrame(ammo.owner, s.basicAttack.plan.Target, s.basicAttack.plan.InitialControlAbilityRef)
	frame.ownerCombatantKey, frame.ownerProviderRef = ammo.owner, ammo.providerRef
	frame.strictReads = true
	bag := frame.providerStateBag(ammo.owner, ammo.providerRef, true)
	value := bag.state[ammo.binding.StateKey]
	if !validStateInteger(value) || value < 0 || value > ammo.definition.StateFields[ammo.binding.StateKey].MaxValue {
		return false, s.basicAttackErr("ammo readiness requires an explicit legal inventory", ammo.binding.StateKey)
	}
	if value > 0 {
		if ammo.wait.active {
			return false, s.basicAttackErr("a recovering ammo inventory cannot contain usable ammo", ammo.binding.StateKey)
		}
		return true, nil
	}
	if ammo.wait.active {
		if ammo.wait.readyAt <= s.nowMs {
			return false, s.basicAttackErr("ammo recovery must settle before attack admission", ammo.binding.StateKey)
		}
		return false, nil
	}
	if err := frame.consumeCommands(1); err != nil {
		return false, err
	}
	if err := frame.stageAmmoRecovery(s.basicAttack.initialAbility); err != nil {
		return false, err
	}
	frame.commit()
	return false, frame.fatalErr
}

func (f *executionFrame) stageAmmoConsumption(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, before, after float64) *model.EngineError {
	attack := f.run.basicAttack
	if attack == nil || attack.ammo == nil {
		return f.run.basicAttackErr("ammo consumption requires the native attack's original use", operation.Path)
	}
	ammo := attack.ammo
	use := f.run.skillUses[f.processUseKey]
	if ammo.owner != f.providerOwnerKey() || ammo.providerRef != f.ownerProviderRef || operation.Ref != ammo.binding.StateKey || operation.Path != ammo.binding.ConsumptionPath || f.pendingProcess == nil || f.pendingProcess.abilityRef != attack.plan.InitialControlAbilityRef || use == nil || use.source != ammo.owner || use.skillKey != ability.SkillKey || use.ammoBefore != nil || f.pendingAmmoCapture != nil || before < 1 || after != before-1 || ammo.wait.active {
		return f.run.basicAttackErr("ammo consumption does not match its unique owner/provider/state/use binding", operation.Path)
	}
	f.pendingAmmoCapture = &ammoUseCapture{useRef: f.processUseKey, owner: ammo.owner, providerRef: ammo.providerRef, stateKey: operation.Ref, before: before}
	useRef := f.processUseKey
	f.pendingMechanicRecords = append(f.pendingMechanicRecords, f.ammoRecord(model.MechanicStateChanged, before, after, operation.Path, &useRef, nil))
	return nil
}

func (f *executionFrame) stageAmmoRecovery(ability planbundle.CompiledAbility) *model.EngineError {
	ammo := f.run.basicAttack.ammo
	if ammo.wait.active || f.pendingAmmoWait != nil {
		return f.run.basicAttackErr("ammo recovery is already scheduled", ammo.binding.StateKey)
	}
	recovery := ammo.definition.StateFields[ammo.binding.StateKey].AmmoRecovery
	f.strictReads = true
	interval, err := f.evalAmount(recovery.IntervalProgram, ability)
	if err != nil {
		return err
	}
	if !formula.ValidPositiveInt64DurationMs(interval) || interval > float64(maxJSONSafeInteger-f.run.nowMs) {
		return f.run.basicAttackErr("ammo recovery requires a positive safe integer interval and timestamp", recovery.Path+".intervalMs")
	}
	readyAt := f.run.nowMs + int64(interval)
	f.pendingAmmoWait = &ammoRecoveryWait{active: true, readyAt: readyAt, generation: ammo.wait.generation + 1}
	f.pendingMechanicRecords = append(f.pendingMechanicRecords, f.ammoRecord(model.MechanicWaitStarted, 0, 0, recovery.Path, nil, &readyAt))
	return nil
}

func (f *executionFrame) ammoRecord(kind string, before, after float64, operationRef string, useRef *string, readyAt *int64) model.MechanicRecord {
	ammo := f.run.basicAttack.ammo
	return model.MechanicRecord{TimeMs: f.run.nowMs, Kind: kind, Owner: ammo.owner, ProviderRef: ammo.providerRef,
		ProviderDefinitionRef: ammo.definition.ProviderKey, SkillKey: f.run.basicAttack.plan.SkillKey, StateKey: ammo.binding.StateKey,
		BeforeValue: before, AfterValue: after, OperationRef: operationRef, UseRef: useRef, ReadyAtMs: readyAt}
}

func (f *executionFrame) commitAmmoWait() {
	if f.pendingAmmoWait == nil {
		return
	}
	ammo := f.run.basicAttack.ammo
	ammo.wait = *f.pendingAmmoWait
	if !ammo.wait.active {
		return
	}
	if f.run.basicAttack.current != nil {
		ready := ammo.wait.readyAt
		f.run.basicAttack.current.MechanicReadyAtMs = &ready
	}
	if f.continuousCombatantsLive() {
		if f.run.basicAttack.summary.StartedCount == 0 && f.run.basicAttack.current == nil {
			ready := ammo.wait.readyAt
			f.run.basicAttack.summary.InitialMechanicReadyAtMs = &ready
		}
		f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: ammo.wait.readyAt, Category: scheduler.GenericCategoryAmmoRecovery,
			Kind: scheduler.GenericEventAmmoRecovery, AmmoGeneration: ammo.wait.generation, DriverEntryIndex: -1,
			ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: ammo.owner, ProviderRef: ammo.providerRef}})
	}
}

func (s *genericRunState) handleAmmoRecovery(event scheduler.GenericEvent) *model.EngineError {
	if s.basicAttack == nil || s.basicAttack.ammo == nil {
		return nil
	}
	ammo := s.basicAttack.ammo
	if !ammo.wait.active || event.AmmoGeneration != ammo.wait.generation || event.TimeMs != ammo.wait.readyAt || event.TimeMs != s.nowMs || event.ProviderInstanceRef.CombatantKey != ammo.owner || event.ProviderInstanceRef.ProviderRef != ammo.providerRef || s.combatantHp(s.basicAttack.plan.Source) <= 0 || s.combatantHp(s.basicAttack.plan.Target) <= 0 {
		return nil
	}
	frame := s.newExecutionFrame(ammo.owner, s.basicAttack.plan.Target, s.basicAttack.plan.InitialControlAbilityRef)
	frame.ownerCombatantKey, frame.ownerProviderRef = ammo.owner, ammo.providerRef
	frame.strictReads = true
	if err := frame.consumeCommands(1); err != nil {
		return err
	}
	bag := frame.providerStateBag(ammo.owner, ammo.providerRef, true)
	before := bag.state[ammo.binding.StateKey]
	if before != 0 {
		return s.basicAttackErr("ammo recovery requires the original empty inventory", ammo.binding.StateKey)
	}
	field := ammo.definition.StateFields[ammo.binding.StateKey]
	after, message := bag.nextStateValue(ammo.binding.StateKey, before, field.MaxValue, "set")
	if message != "" {
		return s.basicAttackErr(message, ammo.binding.StateKey)
	}
	bag.state[ammo.binding.StateKey] = after
	frame.stageFor(ammo.owner).dirty = true
	wait := ammo.wait
	wait.active = false
	frame.pendingAmmoWait = &wait
	readyAt := wait.readyAt
	frame.pendingMechanicRecords = append(frame.pendingMechanicRecords,
		frame.ammoRecord(model.MechanicStateChanged, before, after, field.AmmoRecovery.Path, nil, &readyAt),
		frame.ammoRecord(model.MechanicWaitEnded, before, after, field.AmmoRecovery.Path, nil, &readyAt))
	frame.reResolveStagedAttributesTwoPass(s.basicAttack.initialAbility)
	frame.commit()
	return frame.fatalErr
}

func (f *executionFrame) populateMechanicEvalContext(context *formula.GenericEvalContext, ability planbundle.CompiledAbility) {
	if !f.run.compiled.HasMechanicReads {
		return
	}
	if int(ability.ProviderIndex) < len(f.run.compiled.Providers) {
		provider := f.run.compiled.Providers[ability.ProviderIndex]
		if provider.AmmoBinding != nil {
			useRef := f.processUseKey
			if f.eventCtx != nil && f.eventCtx.hasUse {
				useRef = f.eventCtx.useKey
			} else if fact, exists := f.run.skillHitFacts[f.driverEntryKey]; exists && fact.UseRef != nil {
				useRef = *fact.UseRef
			}
			if use := f.run.skillUses[useRef]; use != nil && use.source == f.providerOwnerKey() && use.skillKey == ability.SkillKey {
				capture := use.ammoBefore
				if f.pendingAmmoCapture != nil && f.pendingAmmoCapture.useRef == useRef {
					capture = f.pendingAmmoCapture
				}
				if capture != nil && capture.owner == f.providerOwnerKey() && capture.providerRef == f.ownerProviderRef && capture.stateKey == provider.AmmoBinding.StateKey {
					context.HasUseAmmoBefore, context.UseAmmoBefore = true, capture.before
				}
			}
		}
	}
	context.HasStatusContext = true
	context.SourceStatuses = f.statusPresence(f.sourceKey)
	context.TargetStatuses = f.statusPresence(f.targetKey)
}

func (f *executionFrame) statusPresence(owner string) map[string]bool {
	values := map[string]bool{}
	for _, statusKey := range f.run.compiled.StatusKeys {
		values[statusKey] = false
	}
	for _, instance := range f.stageFor(owner).providers {
		if instance.Expired(f.run.nowMs) {
			continue
		}
		for _, contribution := range instance.StatusContributions {
			if _, declared := values[contribution.StatusKey]; declared {
				values[contribution.StatusKey] = true
			}
		}
	}
	return values
}
