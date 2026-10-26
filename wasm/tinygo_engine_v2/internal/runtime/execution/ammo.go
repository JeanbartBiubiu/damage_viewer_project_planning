package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"math"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

// 等待按实际挂载实例分槽；不对含字符串的组合身份做结构体哈希。
type pendingAmmoRecovery struct {
	ammo *actionpkg.AmmoView
	wait actionpkg.AmmoWait
}

func (s *Engine) bindBasicAttackAmmo(ammo *actionpkg.AmmoView) {
	if s.actions.BasicAttack() != nil && ammo == s.actions.BasicAttack().Ammo() {
		s.actions.BindAmmo(ammo, s.actions.BasicAttack().Plan().Target, s.actions.BasicAttack().Plan().InitialControlAbilityRef, s.actions.BasicAttack().InitialAbility())
	}
}

func (s *Engine) initPlannedAmmo() {
	for _, action := range s.plannedSkillSources() {
		ability := s.compiled.Abilities[action.Binding().InitialAbilityIndex]
		provider := s.compiled.Providers[ability.ProviderIndex]
		if provider.AmmoBinding == nil || s.findAmmo(action.Binding().Source, action.Binding().ProviderRef, provider.AmmoBinding.StateKey) != nil {
			continue
		}
		ref := action.Binding().Source + ".provider[" + action.Binding().ProviderRef + "].ability[" + ability.AbilityKey + "]"
		s.actions.AddAmmo(actionpkg.NewAmmo(actionpkg.AmmoSeed{Owner: action.Binding().Source, ProviderRef: action.Binding().ProviderRef,
			Definition: provider, Binding: *provider.AmmoBinding, Target: action.Plan().Target(), AbilityRef: ref, Ability: ability}))
	}
	if s.actions.BasicAttack() != nil && s.actions.BasicAttack().Ammo() != nil {
		ammo := s.actions.BasicAttack().Ammo()
		s.bindBasicAttackAmmo(ammo)
		if ammo.Definition().StateFields[ammo.Binding().StateKey].AmmoRecovery.OneByOne || s.hasSkillPlan() {
			s.actions.AddAmmo(ammo)
		}
	}
}

func (s *Engine) findAmmo(owner, provider, key string) *actionpkg.AmmoView {
	for ammoIndex := 0; ammoIndex < s.actions.AmmoCount(); ammoIndex++ {
		ammo := s.actions.AmmoAt(ammoIndex)
		if ammo.Owner() == owner && ammo.ProviderRef() == provider && ammo.Binding().StateKey == key {
			return ammo
		}
	}
	if s.actions.BasicAttack() != nil && s.actions.BasicAttack().Ammo() != nil {
		ammo := s.actions.BasicAttack().Ammo()
		if ammo.Owner() == owner && ammo.ProviderRef() == provider && ammo.Binding().StateKey == key {
			s.bindBasicAttackAmmo(ammo)
			return ammo
		}
	}
	return nil
}

func (s *Engine) initAmmoFrame(f *Frame, ammo *actionpkg.AmmoView) {
	s.initExecutionFrame(f, ammo.Owner(), ammo.Target(), ammo.AbilityRef())
	f.ownerCombatantKey, f.ownerProviderRef, f.strictReads = ammo.Owner(), ammo.ProviderRef(), true
}

func (f *Frame) ammoInventory(ammo *actionpkg.AmmoView) (float64, *model.EngineError) {
	bag := f.providerStateBag(ammo.Owner(), ammo.ProviderRef(), true)
	value := bag.State().At(ammo.Binding().StateKey)
	if !effectpkg.ValidStateInteger(value) || value < 0 || value > ammo.Definition().StateFields[ammo.Binding().StateKey].MaxValue {
		return 0, f.run.basicAttackErr("ammo readiness requires an explicit legal inventory", ammo.Binding().StateKey)
	}
	return value, nil
}

func (f *Frame) ammoWait(ammo *actionpkg.AmmoView) actionpkg.AmmoWait {
	for _, pending := range f.pendingAmmoWaits {
		if pending.ammo == ammo {
			return pending.wait
		}
	}
	return ammo.Wait()
}

func (f *Frame) setAmmoWait(ammo *actionpkg.AmmoView, wait actionpkg.AmmoWait) {
	for i := range f.pendingAmmoWaits {
		if f.pendingAmmoWaits[i].ammo == ammo {
			f.pendingAmmoWaits[i].wait = wait
			return
		}
	}
	f.pendingAmmoWaits = append(f.pendingAmmoWaits, pendingAmmoRecovery{ammo: ammo, wait: wait})
}

func (f *Frame) hasPendingBasicAttackAmmo() bool {
	if f.run.actions.BasicAttack() == nil || f.run.actions.BasicAttack().Ammo() == nil {
		return false
	}
	for _, pending := range f.pendingAmmoWaits {
		if pending.ammo == f.run.actions.BasicAttack().Ammo() {
			return true
		}
	}
	return false
}

func (f *Frame) ammoCombatantsLive(ammo *actionpkg.AmmoView) bool {
	for _, owner := range []string{ammo.Owner(), opponentCombatantKey(ammo.Owner())} {
		health := f.run.combatantHp(owner)
		if staged := f.staged.Get(owner); staged != nil {
			health = staged.attributesView().At("hp").Current
		}
		if f.run.actions.Dead(owner) || health <= 0 {
			return false
		}
	}
	return true
}

func (s *Engine) initializeDrivenAmmo() *model.EngineError {
	for ammoIndex := 0; ammoIndex < s.actions.AmmoCount(); ammoIndex++ {
		ammo := s.actions.AmmoAt(ammoIndex)
		if !s.processMounted(ammo.Owner(), ammo.ProviderRef(), ammo.Ability().ProviderIndex) {
			continue
		}
		var frame Frame
		s.initAmmoFrame(&frame, ammo)
		value, err := frame.ammoInventory(ammo)
		if err != nil {
			return err
		}
		field := ammo.Definition().StateFields[ammo.Binding().StateKey]
		if value == field.MaxValue || ammo.Wait().Active || !field.AmmoRecovery.OneByOne && value > 0 {
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
		if err := frame.stageAmmoRecoveryFor(ammo, ammo.Ability(), remaining); err != nil {
			return err
		}
		frame.commit()
		if frame.fatal {
			return frame.fatalErr
		}
	}
	// 旧整匣普攻仍在原来的准入边界启动首次等待。
	if s.actions.AmmoCount() == 0 {
		_, err := s.basicAttackAmmoReady()
		return err
	}
	return nil
}

func (f *Frame) stageAmmoConsumption(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, before, after float64) *model.EngineError {
	ammo := f.run.findAmmo(f.providerOwnerKey(), f.ownerProviderRef, operation.Ref)
	if ammo == nil || operation.Path != ammo.Binding().ConsumptionPath || f.pendingProcess == nil || f.pendingProcess.AbilityRef() != ammo.AbilityRef() ||
		f.pendingProcess.Owner() != ammo.Owner() || f.pendingProcess.ProviderRef() != ammo.ProviderRef() || f.pendingProcess.SkillKey() != ability.SkillKey ||
		f.pendingAmmoCapture != nil || before < 1 || after != before-1 {
		return f.run.basicAttackErr("ammo consumption does not match its unique owner/provider/state/use binding", operation.Path)
	}
	use := f.run.skillUses[f.processUseKey]
	newActive := f.processIsNew && !ability.IsBasicAttack && f.run.actions.ActionForUse(f.processUseKey) != nil && use == nil
	if !newActive && (use == nil || use.identity.Source() != ammo.Owner() || use.identity.SkillKey() != ability.SkillKey || use.ammoBefore != nil) {
		return f.run.basicAttackErr("ammo consumption requires its original committed use or staged INITIAL use", operation.Path)
	}
	if f.ammoWait(ammo).Active && !ammo.Definition().StateFields[ammo.Binding().StateKey].AmmoRecovery.OneByOne {
		return f.run.basicAttackErr("all-at-once ammo cannot be consumed during recovery", operation.Path)
	}
	f.pendingAmmoCapture = &ammoUseCapture{useRef: f.processUseKey, owner: ammo.Owner(), providerRef: ammo.ProviderRef(), stateKey: operation.Ref, before: before}
	useRef := f.processUseKey
	f.pendingMechanicRecords = append(f.pendingMechanicRecords, f.ammoRecordFor(ammo, model.MechanicStateChanged, before, after, operation.Path, &useRef, nil))
	return nil
}

func (f *Frame) stageAmmoRecoveryFor(ammo *actionpkg.AmmoView, ability planbundle.CompiledAbility, initialRemaining int64) *model.EngineError {
	wait := f.ammoWait(ammo)
	if wait.Active {
		return nil // 继续扣弹不重置已有回充周期。
	}
	recovery := ammo.Definition().StateFields[ammo.Binding().StateKey].AmmoRecovery
	f.strictReads = true
	interval, err := f.evalAmount(recovery.IntervalProgram, ability)
	if err != nil {
		return err
	}
	if !formula.ValidPositiveInt64DurationMs(interval) || interval > float64(maxJSONSafeInteger-f.run.loop.TimeMs()) {
		return f.run.basicAttackErr("ammo recovery requires a positive safe integer interval and timestamp", recovery.Path+".intervalMs")
	}
	delay := int64(interval)
	if initialRemaining >= 0 {
		if initialRemaining > delay || initialRemaining > maxJSONSafeInteger-f.run.loop.TimeMs() {
			return f.run.basicAttackErr("initial remaining time exceeds the complete recovery interval or timestamp", recovery.Path+".initialRemainingMs")
		}
		delay = initialRemaining
	}
	if wait.Generation == ^uint64(0) {
		return f.run.basicAttackErr("ammo generation overflow", recovery.Path)
	}
	readyAt := f.run.loop.TimeMs() + delay
	value, err := f.ammoInventory(ammo)
	if err != nil {
		return err
	}
	f.setAmmoWait(ammo, actionpkg.AmmoWait{Active: true, ReadyAt: readyAt, Generation: wait.Generation + 1})
	f.pendingMechanicRecords = append(f.pendingMechanicRecords, f.ammoRecordFor(ammo, model.MechanicWaitStarted, value, value, recovery.Path, nil, &readyAt))
	return nil
}

func (f *Frame) ammoRecordFor(ammo *actionpkg.AmmoView, kind string, before, after float64, operationRef string, useRef *string, readyAt *int64) model.MechanicRecord {
	return model.MechanicRecord{TimeMs: f.run.loop.TimeMs(), Kind: kind, Owner: ammo.Owner(), ProviderRef: ammo.ProviderRef(),
		ProviderDefinitionRef: ammo.Definition().ProviderKey, SkillKey: ammo.Ability().SkillKey, StateKey: ammo.Binding().StateKey,
		BeforeValue: before, AfterValue: after, OperationRef: operationRef, UseRef: useRef, ReadyAtMs: readyAt}
}

func (f *Frame) commitAmmoWait() {
	for _, pending := range f.pendingAmmoWaits {
		ammo := pending.ammo
		f.run.actions.PublishAmmoWait(ammo, pending.wait)
		if !ammo.Wait().Active {
			continue
		}
		if attack := f.run.actions.BasicAttack(); attack != nil && ammo == attack.Ammo() {
			ready := ammo.Wait().ReadyAt
			if attack.Current() != nil {
				f.run.actions.SetAttackMechanicReady(ready)
			} else if attack.StartedCount() == 0 && f.ammoCombatantsLive(ammo) {
				f.run.actions.SetInitialMechanicReady(&ready)
			}
		}
		if f.ammoCombatantsLive(ammo) {
			f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: ammo.Wait().ReadyAt, Category: scheduler.GenericCategoryAmmoRecovery,
				Kind: scheduler.GenericEventAmmoRecovery, AmmoGeneration: ammo.Wait().Generation, AmmoStateKey: ammo.Binding().StateKey, DriverEntryIndex: -1,
				ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: ammo.Owner(), ProviderRef: ammo.ProviderRef()}})
		}
	}
}

func (s *Engine) handleAmmoRecovery(event scheduler.GenericEvent) *model.EngineError {
	stateKey := event.AmmoStateKey
	if stateKey == "" && s.actions.BasicAttack() != nil && s.actions.BasicAttack().Ammo() != nil { // 既有原生普攻构造用例。
		ammo := s.actions.BasicAttack().Ammo()
		if event.ProviderInstanceRef.CombatantKey == ammo.Owner() && event.ProviderInstanceRef.ProviderRef == ammo.ProviderRef() {
			stateKey = ammo.Binding().StateKey
		}
	}
	ammo := s.findAmmo(event.ProviderInstanceRef.CombatantKey, event.ProviderInstanceRef.ProviderRef, stateKey)
	if ammo == nil || !ammo.Wait().Active || event.AmmoGeneration != ammo.Wait().Generation || event.TimeMs != ammo.Wait().ReadyAt || event.TimeMs != s.loop.TimeMs() ||
		!s.processMounted(ammo.Owner(), ammo.ProviderRef(), ammo.Ability().ProviderIndex) {
		return nil
	}
	var frame Frame
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
	field := ammo.Definition().StateFields[ammo.Binding().StateKey]
	if before >= field.MaxValue || !field.AmmoRecovery.OneByOne && before != 0 {
		return s.basicAttackErr("ammo recovery requires an incomplete original inventory", ammo.Binding().StateKey)
	}
	after := field.MaxValue
	if field.AmmoRecovery.OneByOne {
		after = before + 1
	}
	bag := frame.providerStateBag(ammo.Owner(), ammo.ProviderRef(), true)
	bag.SetStateValue(ammo.Binding().StateKey, after)
	frame.stageFor(ammo.Owner()).dirty = true
	wait := ammo.Wait()
	wait.Active = false
	frame.setAmmoWait(ammo, wait)
	readyAt := wait.ReadyAt
	frame.pendingMechanicRecords = append(frame.pendingMechanicRecords,
		frame.ammoRecordFor(ammo, model.MechanicStateChanged, before, after, field.AmmoRecovery.Path, nil, &readyAt),
		frame.ammoRecordFor(ammo, model.MechanicWaitEnded, before, after, field.AmmoRecovery.Path, nil, &readyAt))
	frame.reResolveStagedAttributesTwoPass(ammo.Ability())
	if frame.fatal {
		return frame.fatalErr
	}
	if after < field.MaxValue {
		if err := frame.stageAmmoRecoveryFor(ammo, ammo.Ability(), -1); err != nil {
			return err
		}
	}
	frame.commit()
	return frame.fatalErr
}

func (f *Frame) applyAmmoDurationChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	ammo := f.run.findAmmo(f.providerOwnerKey(), f.ownerProviderRef, op.Ref)
	if ammo == nil || !ammo.Definition().StateFields[op.Ref].AmmoRecovery.OneByOne || op.StateScope != stateScopeProvider {
		return f.run.basicAttackErr("ammo duration change requires its driven one-by-one provider state", op.Path)
	}
	wait := f.ammoWait(ammo)
	if !wait.Active {
		return nil
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !effectpkg.FiniteState(amount) || amount < 0 || amount > float64(maxJSONSafeInteger) {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "ammo duration subtract must be finite, non-negative and safe", op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	delta := int64(math.Round(amount))
	ready := wait.ReadyAt - delta
	if ready < f.run.loop.TimeMs() {
		ready = f.run.loop.TimeMs()
	}
	if ready == wait.ReadyAt {
		return nil
	}
	if wait.Generation == ^uint64(0) {
		return f.run.basicAttackErr("ammo generation overflow", op.Path)
	}
	wait.ReadyAt, wait.Generation = ready, wait.Generation+1
	f.setAmmoWait(ammo, wait)
	f.stageFor(ammo.Owner()).dirty = true
	return nil
}

// 候选只读库存；付款帧再次调用，以实际暂存状态为准。
func (f *Frame) plannedAmmoReady(ability planbundle.CompiledAbility) (bool, int64, *model.EngineError) {
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
	if !wait.Active {
		return false, 0, f.run.basicAttackErr("empty active ammo has no recovery wait", provider.ProviderKey)
	}
	return false, wait.ReadyAt, nil
}
