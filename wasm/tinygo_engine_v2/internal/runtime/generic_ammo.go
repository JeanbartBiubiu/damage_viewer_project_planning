package runtime

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

// 等待按实际挂载实例分槽；不对含字符串的组合身份做结构体哈希。
type pendingAmmoRecovery struct {
	ammo *basicAttackAmmo
	wait ammoRecoveryWait
}

func (s *genericRunState) bindBasicAttackAmmo(ammo *basicAttackAmmo) {
	if s.basicAttack != nil && ammo == s.basicAttack.ammo {
		ammo.target, ammo.abilityRef, ammo.ability = s.basicAttack.plan.Target, s.basicAttack.plan.InitialControlAbilityRef, s.basicAttack.initialAbility
	}
}

func (s *genericRunState) initPlannedAmmo() {
	for _, action := range s.plannedSkillSources() {
		ability := s.compiled.Abilities[action.binding.InitialAbilityIndex]
		provider := s.compiled.Providers[ability.ProviderIndex]
		if provider.AmmoBinding == nil || s.findAmmo(action.binding.Source, action.binding.ProviderRef, provider.AmmoBinding.StateKey) != nil {
			continue
		}
		ref := action.binding.Source + ".provider[" + action.binding.ProviderRef + "].ability[" + ability.AbilityKey + "]"
		s.ammoInstances = append(s.ammoInstances, &basicAttackAmmo{owner: action.binding.Source, providerRef: action.binding.ProviderRef,
			definition: provider, binding: *provider.AmmoBinding, target: action.plan.Target, abilityRef: ref, ability: ability})
	}
	if s.basicAttack != nil && s.basicAttack.ammo != nil {
		ammo := s.basicAttack.ammo
		s.bindBasicAttackAmmo(ammo)
		if ammo.definition.StateFields[ammo.binding.StateKey].AmmoRecovery.OneByOne || s.hasSkillPlan() {
			s.ammoInstances = append(s.ammoInstances, ammo)
		}
	}
}

func (s *genericRunState) findAmmo(owner, provider, key string) *basicAttackAmmo {
	for _, ammo := range s.ammoInstances {
		if ammo.owner == owner && ammo.providerRef == provider && ammo.binding.StateKey == key {
			return ammo
		}
	}
	if s.basicAttack != nil && s.basicAttack.ammo != nil {
		ammo := s.basicAttack.ammo
		if ammo.owner == owner && ammo.providerRef == provider && ammo.binding.StateKey == key {
			s.bindBasicAttackAmmo(ammo)
			return ammo
		}
	}
	return nil
}

func (s *genericRunState) initAmmoFrame(f *executionFrame, ammo *basicAttackAmmo) {
	s.initExecutionFrame(f, ammo.owner, ammo.target, ammo.abilityRef)
	f.ownerCombatantKey, f.ownerProviderRef, f.strictReads = ammo.owner, ammo.providerRef, true
}

func (f *executionFrame) ammoInventory(ammo *basicAttackAmmo) (float64, *model.EngineError) {
	bag := f.providerStateBag(ammo.owner, ammo.providerRef, true)
	value := bag.state[ammo.binding.StateKey]
	if !validStateInteger(value) || value < 0 || value > ammo.definition.StateFields[ammo.binding.StateKey].MaxValue {
		return 0, f.run.basicAttackErr("ammo readiness requires an explicit legal inventory", ammo.binding.StateKey)
	}
	return value, nil
}

func (f *executionFrame) ammoWait(ammo *basicAttackAmmo) ammoRecoveryWait {
	for _, pending := range f.pendingAmmoWaits {
		if pending.ammo == ammo {
			return pending.wait
		}
	}
	return ammo.wait
}

func (f *executionFrame) setAmmoWait(ammo *basicAttackAmmo, wait ammoRecoveryWait) {
	for i := range f.pendingAmmoWaits {
		if f.pendingAmmoWaits[i].ammo == ammo {
			f.pendingAmmoWaits[i].wait = wait
			return
		}
	}
	f.pendingAmmoWaits = append(f.pendingAmmoWaits, pendingAmmoRecovery{ammo: ammo, wait: wait})
}

func (f *executionFrame) hasPendingBasicAttackAmmo() bool {
	if f.run.basicAttack == nil || f.run.basicAttack.ammo == nil {
		return false
	}
	for _, pending := range f.pendingAmmoWaits {
		if pending.ammo == f.run.basicAttack.ammo {
			return true
		}
	}
	return false
}

func (f *executionFrame) ammoCombatantsLive(ammo *basicAttackAmmo) bool {
	for _, owner := range []string{ammo.owner, opponentCombatantKey(ammo.owner)} {
		health := f.run.combatantHp(owner)
		if staged := f.staged.Get(owner); staged != nil {
			health = staged.attributes.At("hp").Current
		}
		if f.run.actionDeaths[owner] || health <= 0 {
			return false
		}
	}
	return true
}

func (s *genericRunState) initializeDrivenAmmo() *model.EngineError {
	for _, ammo := range s.ammoInstances {
		if !s.processMounted(ammo.owner, ammo.providerRef, ammo.ability.ProviderIndex) {
			continue
		}
		var frame executionFrame
		s.initAmmoFrame(&frame, ammo)
		value, err := frame.ammoInventory(ammo)
		if err != nil {
			return err
		}
		field := ammo.definition.StateFields[ammo.binding.StateKey]
		if value == field.MaxValue || ammo.wait.active || !field.AmmoRecovery.OneByOne && value > 0 {
			continue
		}
		if err := frame.consumeCommands(1); err != nil {
			return err
		}
		remaining := int64(-1)
		if field.AmmoRecovery.OneByOne {
			if !field.AmmoRecovery.HasInitialRemaining {
				return s.basicAttackErr("incomplete ammo inventory requires explicit initial remaining time", field.AmmoRecovery.Path+".initialRemainingMs")
			}
			remaining = field.AmmoRecovery.InitialRemainingMs
		}
		if err := frame.stageAmmoRecoveryFor(ammo, ammo.ability, remaining); err != nil {
			return err
		}
		frame.commit()
		if frame.fatal {
			return frame.fatalErr
		}
	}
	// 旧整匣普攻仍在原来的准入边界启动首次等待。
	if len(s.ammoInstances) == 0 {
		_, err := s.basicAttackAmmoReady()
		return err
	}
	return nil
}

func (f *executionFrame) stageAmmoConsumption(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, before, after float64) *model.EngineError {
	ammo := f.run.findAmmo(f.providerOwnerKey(), f.ownerProviderRef, operation.Ref)
	if ammo == nil || operation.Path != ammo.binding.ConsumptionPath || f.pendingProcess == nil || f.pendingProcess.abilityRef != ammo.abilityRef ||
		f.pendingProcess.Owner != ammo.owner || f.pendingProcess.ProviderRef != ammo.providerRef || f.pendingProcess.SkillKey != ability.SkillKey ||
		f.pendingAmmoCapture != nil || before < 1 || after != before-1 {
		return f.run.basicAttackErr("ammo consumption does not match its unique owner/provider/state/use binding", operation.Path)
	}
	use := f.run.skillUses[f.processUseKey]
	newActive := f.processIsNew && !ability.IsBasicAttack && f.run.skillActionByUse[f.processUseKey] != nil && use == nil
	if !newActive && (use == nil || use.source != ammo.owner || use.skillKey != ability.SkillKey || use.ammoBefore != nil) {
		return f.run.basicAttackErr("ammo consumption requires its original committed use or staged INITIAL use", operation.Path)
	}
	if f.ammoWait(ammo).active && !ammo.definition.StateFields[ammo.binding.StateKey].AmmoRecovery.OneByOne {
		return f.run.basicAttackErr("all-at-once ammo cannot be consumed during recovery", operation.Path)
	}
	f.pendingAmmoCapture = &ammoUseCapture{useRef: f.processUseKey, owner: ammo.owner, providerRef: ammo.providerRef, stateKey: operation.Ref, before: before}
	useRef := f.processUseKey
	f.pendingMechanicRecords = append(f.pendingMechanicRecords, f.ammoRecordFor(ammo, model.MechanicStateChanged, before, after, operation.Path, &useRef, nil))
	return nil
}

func (f *executionFrame) stageAmmoRecoveryFor(ammo *basicAttackAmmo, ability planbundle.CompiledAbility, initialRemaining int64) *model.EngineError {
	wait := f.ammoWait(ammo)
	if wait.active {
		return nil // 继续扣弹不重置已有回充周期。
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
	delay := int64(interval)
	if initialRemaining >= 0 {
		if initialRemaining > delay || initialRemaining > maxJSONSafeInteger-f.run.nowMs {
			return f.run.basicAttackErr("initial remaining time exceeds the complete recovery interval or timestamp", recovery.Path+".initialRemainingMs")
		}
		delay = initialRemaining
	}
	if wait.generation == ^uint64(0) {
		return f.run.basicAttackErr("ammo generation overflow", recovery.Path)
	}
	readyAt := f.run.nowMs + delay
	value, err := f.ammoInventory(ammo)
	if err != nil {
		return err
	}
	f.setAmmoWait(ammo, ammoRecoveryWait{active: true, readyAt: readyAt, generation: wait.generation + 1})
	f.pendingMechanicRecords = append(f.pendingMechanicRecords, f.ammoRecordFor(ammo, model.MechanicWaitStarted, value, value, recovery.Path, nil, &readyAt))
	return nil
}

func (f *executionFrame) ammoRecordFor(ammo *basicAttackAmmo, kind string, before, after float64, operationRef string, useRef *string, readyAt *int64) model.MechanicRecord {
	return model.MechanicRecord{TimeMs: f.run.nowMs, Kind: kind, Owner: ammo.owner, ProviderRef: ammo.providerRef,
		ProviderDefinitionRef: ammo.definition.ProviderKey, SkillKey: ammo.ability.SkillKey, StateKey: ammo.binding.StateKey,
		BeforeValue: before, AfterValue: after, OperationRef: operationRef, UseRef: useRef, ReadyAtMs: readyAt}
}

func (f *executionFrame) commitAmmoWait() {
	for _, pending := range f.pendingAmmoWaits {
		ammo := pending.ammo
		ammo.wait = pending.wait
		if !ammo.wait.active {
			continue
		}
		if attack := f.run.basicAttack; attack != nil && ammo == attack.ammo {
			ready := ammo.wait.readyAt
			if attack.current != nil {
				attack.current.MechanicReadyAtMs = &ready
			} else if attack.summary.StartedCount == 0 && f.ammoCombatantsLive(ammo) {
				attack.summary.InitialMechanicReadyAtMs = &ready
			}
		}
		if f.ammoCombatantsLive(ammo) {
			f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: ammo.wait.readyAt, Category: scheduler.GenericCategoryAmmoRecovery,
				Kind: scheduler.GenericEventAmmoRecovery, AmmoGeneration: ammo.wait.generation, AmmoStateKey: ammo.binding.StateKey, DriverEntryIndex: -1,
				ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: ammo.owner, ProviderRef: ammo.providerRef}})
		}
	}
}

func (s *genericRunState) handleAmmoRecovery(event scheduler.GenericEvent) *model.EngineError {
	stateKey := event.AmmoStateKey
	if stateKey == "" && s.basicAttack != nil && s.basicAttack.ammo != nil { // 既有原生普攻构造用例。
		ammo := s.basicAttack.ammo
		if event.ProviderInstanceRef.CombatantKey == ammo.owner && event.ProviderInstanceRef.ProviderRef == ammo.providerRef {
			stateKey = ammo.binding.StateKey
		}
	}
	ammo := s.findAmmo(event.ProviderInstanceRef.CombatantKey, event.ProviderInstanceRef.ProviderRef, stateKey)
	if ammo == nil || !ammo.wait.active || event.AmmoGeneration != ammo.wait.generation || event.TimeMs != ammo.wait.readyAt || event.TimeMs != s.nowMs ||
		!s.processMounted(ammo.owner, ammo.providerRef, ammo.ability.ProviderIndex) {
		return nil
	}
	var frame executionFrame
	s.initAmmoFrame(&frame, ammo)
	if !frame.ammoCombatantsLive(ammo) {
		return nil
	}
	if err := frame.consumeCommands(1); err != nil {
		return err
	}
	before, err := frame.ammoInventory(ammo)
	if err != nil {
		return err
	}
	field := ammo.definition.StateFields[ammo.binding.StateKey]
	if before >= field.MaxValue || !field.AmmoRecovery.OneByOne && before != 0 {
		return s.basicAttackErr("ammo recovery requires an incomplete original inventory", ammo.binding.StateKey)
	}
	after := field.MaxValue
	if field.AmmoRecovery.OneByOne {
		after = before + 1
	}
	bag := frame.providerStateBag(ammo.owner, ammo.providerRef, true)
	bag.writableState()[ammo.binding.StateKey] = after
	frame.stageFor(ammo.owner).dirty = true
	wait := ammo.wait
	wait.active = false
	frame.setAmmoWait(ammo, wait)
	readyAt := wait.readyAt
	frame.pendingMechanicRecords = append(frame.pendingMechanicRecords,
		frame.ammoRecordFor(ammo, model.MechanicStateChanged, before, after, field.AmmoRecovery.Path, nil, &readyAt),
		frame.ammoRecordFor(ammo, model.MechanicWaitEnded, before, after, field.AmmoRecovery.Path, nil, &readyAt))
	frame.reResolveStagedAttributesTwoPass(ammo.ability)
	if frame.fatal {
		return frame.fatalErr
	}
	if after < field.MaxValue {
		if err := frame.stageAmmoRecoveryFor(ammo, ammo.ability, -1); err != nil {
			return err
		}
	}
	frame.commit()
	return frame.fatalErr
}

func (f *executionFrame) applyAmmoDurationChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	ammo := f.run.findAmmo(f.providerOwnerKey(), f.ownerProviderRef, op.Ref)
	if ammo == nil || !ammo.definition.StateFields[op.Ref].AmmoRecovery.OneByOne || op.StateScope != stateScopeProvider {
		return f.run.basicAttackErr("ammo duration change requires its driven one-by-one provider state", op.Path)
	}
	wait := f.ammoWait(ammo)
	if !wait.active {
		return nil
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !finiteState(amount) || amount < 0 || amount > float64(maxJSONSafeInteger) {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "ammo duration subtract must be finite, non-negative and safe", op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	delta := int64(math.Round(amount))
	ready := wait.readyAt - delta
	if ready < f.run.nowMs {
		ready = f.run.nowMs
	}
	if ready == wait.readyAt {
		return nil
	}
	if wait.generation == ^uint64(0) {
		return f.run.basicAttackErr("ammo generation overflow", op.Path)
	}
	wait.readyAt, wait.generation = ready, wait.generation+1
	f.setAmmoWait(ammo, wait)
	f.stageFor(ammo.owner).dirty = true
	return nil
}

// 候选只读库存；付款帧再次调用，以实际暂存状态为准。
func (f *executionFrame) plannedAmmoReady(ability planbundle.CompiledAbility) (bool, int64, *model.EngineError) {
	provider := f.run.compiled.Providers[ability.ProviderIndex]
	if provider.AmmoBinding == nil {
		return true, 0, nil
	}
	ammo := f.run.findAmmo(f.providerOwnerKey(), f.ownerProviderRef, provider.AmmoBinding.StateKey)
	if ammo == nil {
		return false, 0, f.run.basicAttackErr("active ammo requires its selected actual source", provider.ProviderKey)
	}
	value, err := f.ammoInventory(ammo)
	if err != nil || value > 0 {
		return value > 0, 0, err
	}
	wait := f.ammoWait(ammo)
	if !wait.active {
		return false, 0, f.run.basicAttackErr("empty active ammo has no recovery wait", provider.ProviderKey)
	}
	return false, wait.readyAt, nil
}
