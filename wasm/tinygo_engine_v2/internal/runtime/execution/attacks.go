// 普攻、弹药及等待执行的真实帧、捕获和发布接线。
package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/scheduler"
)

type basicAttackBridge struct{ engine *Engine }

type ammoPhasesBridge struct{ engine *Engine }

type ammoWorkBridge struct{ frame *Frame }

type attackWaitBridge struct{ frame, preview *Frame }

type attackAdmissionBridge struct{ engine *Engine }

type startStateBridge struct{ frame *Frame }

type attackProviderPreviewBridge struct{ frame *Frame }

// 等待按实际挂载实例分槽；不对含字符串的组合身份做结构体哈希。
type pendingAmmoRecovery struct {
	ammo *actionpkg.AmmoView
	wait actionpkg.AmmoWait
}

type ammoUseCapture = actionflow.AmmoCapture

const maxJSONSafeInteger int64 = 9007199254740991

var _ actionflow.BasicAttackPhases = basicAttackBridge{}

var _ actionflow.AmmoPhases = ammoPhasesBridge{}

var _ actionflow.AmmoWork = ammoWorkBridge{}

var _ actionflow.NativeAttackStart = basicAttackBridge{}

var _ actionflow.AttackWaitWork = attackWaitBridge{}

var _ actionflow.AttackAdmissionChecks = attackAdmissionBridge{}

var _ actionflow.AttackOccupancyRecords = basicAttackBridge{}

var _ actionflow.StartStateReads = startStateBridge{}

var _ actionflow.AttackReadiness = basicAttackBridge{}

var _ actionflow.AttackTimelineReads = basicAttackBridge{}

var _ actionflow.AttackProviderPreview = attackProviderPreviewBridge{}

var _ actionflow.InitialAttackWaitReads = attackWaitBridge{}

func (bridge startStateBridge) StartStateBag(owner, provider string, create bool) effectpkg.BagView {
	return bridge.frame.providerStateBagForRead(owner, provider, create, effectpkg.ReadOptions{})
}

func (bridge basicAttackBridge) ReadAttackHP(owner string) float64 {
	return bridge.engine.combatantHp(owner)
}

func (bridge basicAttackBridge) ReadyAttackAmmo() (bool, *model.EngineError) {
	return bridge.engine.basicAttackAmmoReady()
}

func (bridge basicAttackBridge) ReadAttackSpeed(owner, key string) float64 {
	return bridge.engine.combatants[owner].attributesView().At(key).Resolved
}

func (bridge basicAttackBridge) AttackTimelineCooldown(owner, ref string) int64 {
	return bridge.engine.combatants[owner].cooldowns.AbilityReadyAt(owner, ref)
}

func (bridge basicAttackBridge) AttackTimelinePermission(owner string, key actionpkg.CooldownWaitKey) int64 {
	if wait, exists := bridge.engine.combatants[owner].cooldowns.Wait(key); exists {
		return wait.NotBefore
	}
	return 0
}

func (bridge basicAttackBridge) AttackTimelineInventory(ammo *actionpkg.AmmoView) float64 {
	if bag := bridge.engine.combatants[ammo.Owner()].providerState.Lookup(ammo.ProviderRef()); bag.Present() {
		return bag.State().At(ammo.Binding().StateKey)
	}
	return ammo.Definition().StateFields[ammo.Binding().StateKey].DefaultValue
}

func (bridge attackProviderPreviewBridge) WaitingMutationCount(owner string) int {
	return len(bridge.frame.stageFor(owner).providerOps)
}

func (bridge attackProviderPreviewBridge) WaitingMutation(owner string, index int) actionflow.AttackWaitMutation {
	mutation := bridge.frame.stageFor(owner).providerOps[index]
	return actionflow.AttackWaitMutation{Kind: mutation.Kind, DefinitionRef: mutation.DefinitionRef, ProviderRef: mutation.ProviderRef, Source: mutation.SourceKey, Projected: mutation.Projected, DefinitionIndex: mutation.DefinitionIndex, ExpireAt: mutation.ExpireAt}
}

func (bridge attackProviderPreviewBridge) WaitingProviderInstances(owner string) *effectpkg.InstanceChangeSet {
	return &bridge.frame.stageFor(owner).instances
}

func (bridge attackProviderPreviewBridge) RemoveWaitingProvider(owner, ref string) {
	bridge.frame.unmountWaitingProvider(owner, ref)
}

func (bridge attackProviderPreviewBridge) MountWaitingAttribute(owner, ref string, modifier planbundle.CompiledModifier) {
	host := bridge.frame.stageFor(modifierMountCombatantKey(owner, modifier.Target))
	host.instances.MountAttributeCompiled(owner, ref, modifier)
}

func (bridge attackProviderPreviewBridge) ResolveWaitingAttributes() *model.EngineError {
	// 本独立副本已由等待预览预演普通生命周期；属性读取不能再次重放父命令的副本。
	bridge.frame.effectProjection.Complete()
	bridge.frame.reResolveStagedAttributesTwoPass(bridge.frame.run.actions.BasicAttack().InitialAbility())
	if bridge.frame.fatal {
		return bridge.frame.fatalErr
	}
	return nil
}

func (bridge attackWaitBridge) InitialAttackWaitPreview() (actionflow.AttackWaitPreview, *model.EngineError) {
	frame := bridge.frame
	attack := frame.run.actions.BasicAttack()
	source := frame.stageFor(attack.Plan().Source).attributesView()
	target := frame.stageFor(attack.Plan().Target).attributesView()
	context, err := frame.evalContext(attack.InitialAbility())
	if err != nil {
		return actionflow.AttackWaitPreview{}, err
	}
	return actionflow.AttackWaitPreview{Source: source, Target: target, Context: context}, nil
}

func (bridge basicAttackBridge) BeginNativeAttack() (string, *model.EngineError) {
	_, hit, err := bridge.engine.beginNativeBasicAttackUse()
	return hit, err
}

func (bridge basicAttackBridge) ExecuteNativeHit(entry model.DriverEntry) *model.EngineError {
	s := bridge.engine
	s.report.Attempt(entry.AbilityRef)
	if err := s.executeAbilityCast(entry); err != nil {
		return err
	}
	return s.processFailure
}

func (bridge basicAttackBridge) NativeAttackActorsAlive(source, target string) bool {
	return !(bridge.engine.combatantHp(source) <= 0 || bridge.engine.combatantHp(target) <= 0)
}

func (bridge basicAttackBridge) FinishNativeAttackRecord() {
	bridge.engine.finishCurrentAttackRecord()
}

func (bridge basicAttackBridge) PublishNativeAttackWait() {
	bridge.engine.publishBasicAttackWait()
}

func (bridge basicAttackBridge) StartActorsAlive(source, target string) bool {
	return !(bridge.engine.combatantHp(source) <= 0 || bridge.engine.combatantHp(target) <= 0)
}

func (bridge basicAttackBridge) RegisterNativeStart(use, start, hit string) {
	s := bridge.engine
	attack := s.actions.BasicAttack()
	s.actions.SetAttackRecordIndex(s.report.AppendAttack(attack.Current().Snapshot(), s.detailedOutput()))
	s.skillUses[use] = &skillUseRuntime{identity: s.actions.NewUse(actionpkg.UseSeed{UseKey: use, Source: attack.Plan().Source, SkillKey: attack.Plan().SkillKey, HistoryState: model.SkillHitHistoryComplete})}
	s.attackStartFacts[start] = model.AttackStartFact{DriverEntryKey: start, UseRef: use}
	sequence := 1
	s.hits.PutFact(hit, model.SkillHitFact{DriverEntryKey: hit, UseRef: &use, Sequence: &sequence})
}

func (bridge basicAttackBridge) ExecuteNativeStart(entry model.DriverEntry) *model.EngineError {
	bridge.engine.report.Attempt(entry.AbilityRef)
	if err := bridge.engine.executeAbilityCast(entry); err != nil {
		return err
	}
	return bridge.engine.processFailure
}

func (bridge basicAttackBridge) NativeCooldownReady(owner, ref string) int64 {
	return bridge.engine.combatants[owner].cooldowns.AbilityReadyAt(owner, ref)
}

func (bridge basicAttackBridge) ReserveNativeEmpowered(use, target string) *model.EngineError {
	return bridge.engine.reserveEmpoweredAttackStart(use, target)
}

func (bridge basicAttackBridge) OccupancyAttackCount() int {
	return bridge.engine.report.AttackRecordCount()
}

func (bridge basicAttackBridge) OccupancyAttackStart(index int) int64 {
	start, _ := bridge.engine.report.AttackStartAt(index)
	return start
}

func (bridge basicAttackBridge) SetAttackOccupancy(index int, ready *int64) {
	bridge.engine.report.SetAttackActionReadyAt(index, ready)
}

func (bridge ammoPhasesBridge) AmmoMounted(ammo *actionpkg.AmmoView) bool {
	return bridge.engine.processMounted(ammo.Owner(), ammo.ProviderRef(), ammo.Ability().ProviderIndex)
}

func (bridge ammoPhasesBridge) InitializeAmmoFrame(ammo *actionpkg.AmmoView) *model.EngineError {
	s := bridge.engine
	var frame Frame
	s.initAmmoFrame(&frame, ammo)
	commit, err := s.skillActionFlowExecutor().PrepareInitialAmmo(ammo, s.loop.TimeMs(), ammoWorkBridge{frame: &frame})
	if err != nil || !commit {
		return err
	}
	frame.commit()
	return frame.fatalErr
}

func (bridge ammoPhasesBridge) RecoverAmmoFrame(ammo *actionpkg.AmmoView) *model.EngineError {
	s := bridge.engine
	var frame Frame
	s.initAmmoFrame(&frame, ammo)
	commit, err := s.skillActionFlowExecutor().PrepareRecoveredAmmo(ammo, s.loop.TimeMs(), ammoWorkBridge{frame: &frame})
	if err != nil || !commit {
		return err
	}
	frame.commit()
	return frame.fatalErr
}

func (bridge ammoPhasesBridge) InitialAttackAmmo() *model.EngineError {
	_, err := bridge.engine.basicAttackAmmoReady()
	return err
}

func (bridge ammoWorkBridge) ReadAmmoInventory(ammo *actionpkg.AmmoView) (float64, *model.EngineError) {
	return bridge.frame.ammoInventory(ammo)
}

func (bridge ammoWorkBridge) ReadAmmoWait(ammo *actionpkg.AmmoView) actionpkg.AmmoWait {
	return bridge.frame.ammoWait(ammo)
}

func (bridge ammoWorkBridge) WriteAmmoWait(ammo *actionpkg.AmmoView, wait actionpkg.AmmoWait) {
	bridge.frame.setAmmoWait(ammo, wait)
}

func (bridge ammoWorkBridge) AmmoAmount(program formula.GenericProgramID, ability planbundle.CompiledAbility, strict bool) (float64, *model.EngineError) {
	previous := bridge.frame.strictReads
	bridge.frame.strictReads = previous || strict
	value, err := bridge.frame.evalAmount(program, ability)
	bridge.frame.strictReads = previous
	return value, err
}

func (bridge ammoWorkBridge) WriteAmmoInventory(ammo *actionpkg.AmmoView, value float64) {
	bag := bridge.frame.providerStateBag(ammo.Owner(), ammo.ProviderRef(), true)
	bag.SetStateValue(ammo.Binding().StateKey, value)
	bridge.frame.stageFor(ammo.Owner()).dirty = true
}

func (bridge ammoWorkBridge) RecordAmmo(ammo *actionpkg.AmmoView, kind string, before, after float64, operation string, use *string, ready *int64) {
	f := bridge.frame
	f.pendingMechanicRecords = append(f.pendingMechanicRecords, f.ammoRecordFor(ammo, kind, before, after, operation, use, ready))
}

func (bridge ammoWorkBridge) ConsumeAmmoCommand() *model.EngineError {
	return bridge.frame.consumeCommands(1)
}

func (bridge ammoWorkBridge) ResolveAmmoAttributes(ability planbundle.CompiledAbility) *model.EngineError {
	bridge.frame.reResolveStagedAttributesTwoPass(ability)
	return bridge.frame.fatalErr
}

func (bridge ammoWorkBridge) AmmoActorsAlive(ammo *actionpkg.AmmoView) bool {
	return bridge.frame.ammoCombatantsLive(ammo)
}

func (bridge attackWaitBridge) PreviewAttackWait() (float64, *model.EngineError) {
	if err := bridge.frame.basicAttackWaitContext(bridge.preview); err != nil {
		return 0, err
	}
	attack := bridge.frame.run.actions.BasicAttack()
	return bridge.preview.stageFor(attack.Plan().Source).attributesView().At(attack.Plan().AttackSpeedAttributeKey).Resolved, nil
}

func (bridge attackWaitBridge) ReadAttackWaitPreview() (actionflow.AttackWaitPreview, *model.EngineError) {
	attack := bridge.frame.run.actions.BasicAttack()
	bridge.frame.stageFor(attack.Plan().Target)
	source := bridge.preview.stageFor(attack.Plan().Source).attributesView()
	target := bridge.preview.stageFor(attack.Plan().Target).attributesView()
	context, err := bridge.preview.evalContext(attack.InitialAbility())
	if err != nil {
		return actionflow.AttackWaitPreview{}, err
	}
	return actionflow.AttackWaitPreview{Source: source, Target: target, Context: context}, nil
}

func (bridge attackWaitBridge) AttackCooldowns() *actionpkg.CooldownLedger {
	return bridge.frame.stageFor(bridge.frame.run.actions.BasicAttack().Plan().Source).cooldowns
}

func (bridge attackWaitBridge) WritableAttackCooldowns() *actionpkg.CooldownLedger {
	return bridge.frame.stageFor(bridge.frame.run.actions.BasicAttack().Plan().Source).writableCooldowns()
}

func (bridge attackWaitBridge) ConsumeAttackWaitCommand() *model.EngineError {
	return bridge.frame.consumeCommands(1)
}

func (bridge attackWaitBridge) AttackPeriod() (float64, *model.EngineError) {
	s := bridge.frame.run
	attack := s.actions.BasicAttack()
	process := s.compiled.Providers[attack.InitialAbility().ProviderIndex].Processes[attack.InitialAbility().ProcessControl.ProcessIndex]
	return bridge.preview.evalAmount(process.Cooldown.DurationProgram, attack.InitialAbility())
}

func (bridge attackWaitBridge) AttackAmmo(ammo *actionpkg.AmmoView) (float64, actionpkg.AmmoWait, *model.EngineError) {
	frame := bridge.frame
	wait := ammo.Wait()
	if frame.hasPendingBasicAttackAmmo() {
		wait = frame.ammoWait(ammo)
	}
	value, err := frame.ammoInventory(ammo)
	return value, wait, err
}

func (bridge attackAdmissionBridge) InitialAttackSnapshot() *model.EngineError {
	return bridge.engine.validateBasicAttackInitialSnapshot()
}

func (bridge attackAdmissionBridge) InitialAttackActorsValid(source, target string) bool {
	s := bridge.engine
	return len(s.combatants) == 2 && s.combatantHasHp(source) && s.combatantHasHp(target) && !(s.combatantHp(source) <= 0 || s.combatantHp(target) <= 0)
}

func (bridge attackAdmissionBridge) InitialAttackAttributes(source string) attribute.Table {
	return bridge.engine.combatants[source].attributesView()
}

func (bridge attackAdmissionBridge) SupportingAttackProvider(kind actionflow.AttackSourceCheck, provider planbundle.CompiledProvider, owner, ref string, index uint16) *model.EngineError {
	s := bridge.engine
	switch kind {
	case actionflow.AttackSourcePlanned:
		return s.validatePlannedSkillProvider(owner, ref, index)
	case actionflow.AttackSourceIdle:
		return s.validateIdleBasicAttackProvider(provider, owner, ref)
	case actionflow.AttackSourceTargetTiming:
		return s.validateTargetTimingProvider(provider, owner, ref)
	case actionflow.AttackSourceTargetWindow:
		return s.validateTargetWindowProvider(provider, owner, ref)
	case actionflow.AttackSourceInitialization:
		return s.validateStaticInitializer(provider, owner, ref)
	case actionflow.AttackSourceHit:
		return s.validateEquipmentHitProvider(provider, owner, ref)
	case actionflow.AttackSourcePeriodic:
		return s.validateEquipmentPeriodicProvider(provider, owner, ref)
	case actionflow.AttackSourcePermanentPeriod:
		return s.validatePermanentCharacterPeriod(provider)
	}
	return s.basicAttackErr("unknown static attack source check", "initialSnapshot.combatants.providers")
}

func (bridge attackAdmissionBridge) AddAttackTargetOperations(provider planbundle.CompiledProvider, allowed map[string]bool) {
	bridge.engine.addTargetTimingOperations(provider, allowed)
}

func (bridge attackAdmissionBridge) LookupInitialAttackAbility(entry model.DriverEntry) (planbundle.CompiledAbility, string, bool) {
	return bridge.engine.lookupDriverAbility(entry)
}

func (bridge attackAdmissionBridge) BindInitialAttackPrimary(ability planbundle.CompiledAbility, provider string) *model.EngineError {
	return bridge.engine.bindBasicAttackPrimary(ability, provider)
}

func (bridge attackAdmissionBridge) DynamicAttackListeners() int {
	return bridge.engine.listeners.DynamicLen()
}

func (bridge attackAdmissionBridge) InitialAttackListener(listener planbundle.CompiledListener, initialization bool) *model.EngineError {
	if initialization {
		return bridge.engine.validateStaticInitializationListener(listener)
	}
	return bridge.engine.validateEquipmentHitListener(listener)
}

func (bridge attackAdmissionBridge) NativeAttackListenerMatches(listener planbundle.CompiledListener, source, target string, set typeset.TypeSet) bool {
	return bridge.engine.listenerMatchesEvent(listener, emittedEvent{eventType: model.EventTypeBasicAttackStart, sourceKey: source, targetKey: target}, set)
}

func (s *Engine) bindBasicAttackAmmo(ammo *actionpkg.AmmoView) {
	s.skillActionFlowExecutor().BindBasicAmmo(ammo)
}

func (s *Engine) initPlannedAmmo() { s.skillActionFlowExecutor().InitializePlannedAmmo() }

func (s *Engine) findAmmo(owner, provider, key string) *actionpkg.AmmoView {
	return s.skillActionFlowExecutor().FindAmmo(owner, provider, key)
}

func (s *Engine) initAmmoFrame(f *Frame, ammo *actionpkg.AmmoView) {
	s.initExecutionFrame(f, ammo.Owner(), ammo.Target(), ammo.AbilityRef())
	f.ownerCombatantKey, f.ownerProviderRef, f.strictReads = ammo.Owner(), ammo.ProviderRef(), true
}

func (f *Frame) ammoInventory(ammo *actionpkg.AmmoView) (float64, *model.EngineError) {
	bag := f.providerStateBag(ammo.Owner(), ammo.ProviderRef(), true)
	value := bag.State().At(ammo.Binding().StateKey)
	if !actionflow.ValidateAmmoInventory(value, ammo.Definition().StateFields[ammo.Binding().StateKey].MaxValue) {
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
	return s.skillActionFlowExecutor().InitializeDrivenAmmo(ammoPhasesBridge{engine: s})
}

func (f *Frame) stageAmmoConsumption(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, before, after float64) *model.EngineError {
	ammo := f.run.findAmmo(f.providerOwnerKey(), f.ownerProviderRef, operation.Ref)
	input := actionflow.AmmoConsumption{Ammo: ammo, Process: f.pendingProcess, UseKey: f.processUseKey, PendingCapture: f.pendingAmmoCapture != nil, ProcessIsNew: f.processIsNew, Before: before, After: after}
	if use := f.run.skillUses[f.processUseKey]; use != nil {
		input.Use = use.identity
		input.UseCaptured = use.ammoBefore != nil
	}
	if err := f.run.skillActionFlowExecutor().ValidateAmmoConsumption(input, operation, ability, ammoWorkBridge{frame: f}); err != nil {
		return err
	}
	f.pendingAmmoCapture = actionflow.NewAmmoCapture(f.processUseKey, ammo.Owner(), ammo.ProviderRef(), operation.Ref, before)
	use := f.processUseKey
	f.pendingMechanicRecords = append(f.pendingMechanicRecords, f.ammoRecordFor(ammo, model.MechanicStateChanged, before, after, operation.Path, &use, nil))
	return nil
}

func (f *Frame) stageAmmoRecoveryFor(ammo *actionpkg.AmmoView, ability planbundle.CompiledAbility, initialRemaining int64) *model.EngineError {
	return f.run.skillActionFlowExecutor().PrepareAmmoRecovery(ammo, ability, initialRemaining, f.run.loop.TimeMs(), ammoWorkBridge{frame: f})
}

func (f *Frame) ammoRecordFor(ammo *actionpkg.AmmoView, kind string, before, after float64, operationRef string, useRef *string, readyAt *int64) model.MechanicRecord {
	return model.MechanicRecord{TimeMs: f.run.loop.TimeMs(), Kind: kind, Owner: ammo.Owner(), ProviderRef: ammo.ProviderRef(),
		ProviderDefinitionRef: ammo.Definition().ProviderKey, SkillKey: ammo.Ability().SkillKey, StateKey: ammo.Binding().StateKey,
		BeforeValue: before, AfterValue: after, OperationRef: operationRef, UseRef: useRef, ReadyAtMs: readyAt}
}

func (f *Frame) commitAmmoWait() {
	for _, pending := range f.pendingAmmoWaits {
		ammo := pending.ammo
		if f.run.skillActionFlowExecutor().PublishAmmoWait(ammo, pending.wait, f.ammoCombatantsLive(ammo)) {
			f.run.pushCombatEvent(scheduler.GenericEvent{TimeMs: ammo.Wait().ReadyAt, Category: scheduler.GenericCategoryAmmoRecovery,
				Kind: scheduler.GenericEventAmmoRecovery, AmmoGeneration: ammo.Wait().Generation, AmmoStateKey: ammo.Binding().StateKey, DriverEntryIndex: -1,
				ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: ammo.Owner(), ProviderRef: ammo.ProviderRef()}})
		}
	}
}

func (s *Engine) handleAmmoRecovery(event scheduler.GenericEvent) *model.EngineError {
	return s.skillActionFlowExecutor().RecoverAmmo(actionflow.AmmoRecoveryEvent{Owner: event.ProviderInstanceRef.CombatantKey, ProviderRef: event.ProviderInstanceRef.ProviderRef, StateKey: event.AmmoStateKey, Generation: event.AmmoGeneration, TimeMs: event.TimeMs}, s.loop.TimeMs(), ammoPhasesBridge{engine: s})
}

func (f *Frame) applyAmmoDurationChange(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	ammo := f.run.findAmmo(f.providerOwnerKey(), f.ownerProviderRef, operation.Ref)
	var before actionpkg.AmmoWait
	if ammo != nil {
		before = f.ammoWait(ammo)
	}
	err := f.run.skillActionFlowExecutor().SubtractAmmoDuration(ammo, operation, ability, f.run.loop.TimeMs(), ammoWorkBridge{frame: f})
	if err == nil && ammo != nil && f.ammoWait(ammo) != before {
		f.stageFor(ammo.Owner()).dirty = true
	}
	return err
}

func (f *Frame) plannedAmmoReady(ability planbundle.CompiledAbility) (bool, int64, *model.EngineError) {
	return f.run.skillActionFlowExecutor().PlannedAmmoReady(f.providerOwnerKey(), f.ownerProviderRef, ability, ammoWorkBridge{frame: f})
}

func (f *Frame) captureAttackStartState(use *skillUseRuntime) *model.EngineError {
	if !f.run.compiled.Features.Has(planbundle.FeatureAttackStartStateReads) {
		return nil
	}
	var identity *actionpkg.UseView
	var existing bool
	if use != nil {
		identity, existing = use.identity, use.providerStateBefore.Len() != 0
	}
	capture, err := f.run.basicAttackFlowExecutor().CaptureStartState(true, f.sourceKey, identity, existing, f.run.compiled.Combatants, f.run.compiled.Providers, startStateBridge{frame: f})
	if err != nil {
		return err
	}
	use.providerStateBefore = capture
	return nil
}

func (f *Frame) populateAttackStartStateContext(ctx *formula.GenericEvalContext) {
	if !f.run.compiled.Features.Has(planbundle.FeatureAttackStartStateReads) || f.eventCtx == nil {
		return
	}
	use := f.run.skillUses[f.eventCtx.UseKey]
	var identity *actionpkg.UseView
	var capture *actionflow.AttackCapture
	if use != nil {
		identity, capture = use.identity, &use.providerStateBefore
	}
	values := f.run.basicAttackFlowExecutor().StartStateContext(true, f.eventCtx, f.providerOwnerKey(), f.ownerProviderRef, identity, capture)
	if values != nil {
		ctx.UseProviderStateBefore = formula.BorrowProviderStateBefore(values)
	}
}

func (s *Engine) basicAttackErr(message, path string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path, "", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (s *Engine) initBasicAttack() *model.EngineError {
	return s.basicAttackFlowExecutor().Initialize(s.skillAdmissionInput(), s.req.StopPolicy.StopOnTargetDeathOrDefault(), actionflow.AttackDefinitions{Combatants: s.compiled.Combatants, Providers: s.compiled.Providers, Abilities: s.compiled.Abilities, Operations: s.compiled.Operations, Listeners: s.compiled.Listeners, RuntimeTypes: s.compiled.RuntimeTypes, Types: s.compiled.Types}, &s.formulas, s.skillActionFlowExecutor(), attackAdmissionBridge{engine: s})
}

func (s *Engine) markBasicAttackHit(use string) {
	s.actions.MarkAttackHit(use, s.loop.TimeMs())
}

func (s *Engine) finishCurrentAttackRecord() {
	attack := s.actions.BasicAttack()
	if attack == nil || attack.Current() == nil {
		return
	}
	s.actions.FinishAttackRecord(s.combatantHp(attack.Plan().Source), s.combatantHp(attack.Plan().Target))
	if attack.CurrentRecordIndex() >= 0 {
		s.report.ReplaceAttackRecord(attack.CurrentRecordIndex(), attack.Current().Snapshot())
	}
}

func (s *Engine) handleBasicAttack() (err *model.EngineError) {
	if attack := s.actions.BasicAttack(); attack != nil {
		if until, err := s.stunUntil(attack.Plan().Source); err != nil {
			return err
		} else if until > s.loop.TimeMs() {
			var frame Frame
			s.initExecutionFrame(&frame, attack.Plan().Source, attack.Plan().Target, attack.Plan().InitialControlAbilityRef)
			frame.pendingActionWait = true
			frame.commit()
			return frame.fatalErr
		}
	}
	admitted, err := s.basicAttackFlowExecutor().Admit(s.effectInitialization.Pending(), basicAttackBridge{engine: s})
	if err != nil || !admitted {
		return err
	}
	b := s.actions.BasicAttack()
	if b.StartedCount() >= s.budget.MaxBasicAttacks {
		return s.budgetError(model.BudgetCauseMaxBasicAttacks, "basic attack count exceeded")
	}
	s.currentEventCommands = 0
	return s.basicAttackFlowExecutor().Execute(s.loop.TimeMs(), basicAttackBridge{engine: s})
}

func validBasicAttackAmmoProvider(provider planbundle.CompiledProvider) bool {
	return actionflow.ValidBasicAmmoProvider(provider)
}

func validBoundAmmoFields(provider planbundle.CompiledProvider) bool {
	return actionflow.ValidBoundAmmoFields(provider)
}

func (s *Engine) basicAttackAmmoReady() (bool, *model.EngineError) {
	if s.actions.BasicAttack() == nil || s.actions.BasicAttack().Ammo() == nil {
		return true, nil
	}
	ammo := s.actions.BasicAttack().Ammo()
	s.bindBasicAttackAmmo(ammo)
	var frame Frame
	s.initAmmoFrame(&frame, ammo)
	ready, commit, err := s.skillActionFlowExecutor().BasicAmmoReady(ammo, s.loop.TimeMs(), ammoWorkBridge{frame: &frame})
	if err != nil || !commit {
		return ready, err
	}
	frame.commit()
	return ready, frame.fatalErr
}

func (f *Frame) populateMechanicEvalContext(context *formula.GenericEvalContext, ability planbundle.CompiledAbility) {
	f.populateAttackStartStateContext(context)
	if !f.run.compiled.Features.Has(planbundle.FeatureMechanicReads) {
		return
	}
	if int(ability.ProviderIndex) < len(f.run.compiled.Providers) {
		provider := f.run.compiled.Providers[ability.ProviderIndex]
		if provider.AmmoBinding != nil {
			var factUse *string
			if f.eventCtx == nil || !f.eventCtx.HasUse {
				if fact, exists := f.run.hits.Fact(f.driverEntryKey); exists {
					factUse = fact.UseRef
				}
			}
			useRef := actionflow.MechanicUseReference(f.processUseKey, f.eventCtx, factUse)
			if use := f.run.skillUses[useRef]; use != nil {
				if value, present := actionflow.UseAmmoBefore(use.identity, useRef, f.providerOwnerKey(), f.ownerProviderRef, ability.SkillKey, provider.AmmoBinding.StateKey, use.ammoBefore, f.pendingAmmoCapture); present {
					context.UseAmmoBefore, context.HasUseAmmoBefore = value, true
				}
			}
		}
	}
	context.HasStatusContext = true
	context.SourceStatuses = formula.BorrowBoolView(f.statusPresence(f.sourceKey))
	context.TargetStatuses = formula.BorrowBoolView(f.statusPresence(f.targetKey))
}

func (f *Frame) statusPresence(owner string) map[string]bool {
	return actionflow.StatusPresence(f.run.compiled.StatusKeys, f.stageFor(owner).instances.Providers(), f.run.compiled.Providers, f.run.loop.TimeMs())
}

func (s *Engine) beginNativeBasicAttackUse() (string, string, *model.EngineError) {
	speed := float64(0)
	if attack := s.actions.BasicAttack(); attack != nil {
		speed = s.combatants[attack.Plan().Source].attributesView().At(attack.Plan().AttackSpeedAttributeKey).Resolved
	}
	return s.basicAttackFlowExecutor().Begin(s.loop.TimeMs(), speed, s.effectInitialization.Pending(), basicAttackBridge{engine: s})
}

func basicAttackProgressDeadline(wait *actionpkg.AttackWaitView) int64 {
	if wait == nil {
		return 0
	}
	return wait.ProgressDeadline()
}

func basicAttackCooldownWaitKey(attack *actionpkg.BasicAttackView) actionpkg.CooldownWaitKey {
	return actionflow.AttackCooldownWaitKey(attack)
}

func (s *Engine) basicAttackReadyAt() int64 {
	if s.actions.BasicAttack() == nil {
		return 0
	}
	return s.combatants[s.actions.BasicAttack().Plan().Source].cooldowns.AbilityReadyAt(s.actions.BasicAttack().Plan().Source, s.actions.BasicAttack().Plan().InitialControlAbilityRef)
}

func (f *Frame) prepareBasicAttackWait() (int, *model.EngineError) {
	if err := f.prepareActionWait(); err != nil {
		return 0, err
	}
	if f.run.actions.BasicAttack() == nil {
		return 0, nil
	}
	if err := f.prepareStunAttackPermission(); err != nil {
		return 0, err
	}
	var preview Frame
	result, err := f.run.basicAttackFlowExecutor().PrepareWait(f.run.loop.TimeMs(), f.attackWaitInput(), f.processOriginal, f.pendingProcess, attackWaitBridge{frame: f, preview: &preview})
	f.pendingBasicAttackWait = result.Wait
	return result.ExtraQueue, err
}

func (f *Frame) prepareBasicAttackProgress() (int, *model.EngineError) {
	if err := f.prepareActionWait(); err != nil {
		return 0, err
	}
	if f.run.actions.BasicAttack() == nil {
		return 0, nil
	}
	var preview Frame
	result, err := f.run.basicAttackFlowExecutor().PrepareWaitProgress(f.run.loop.TimeMs(), f.attackWaitInput(), attackWaitBridge{frame: f, preview: &preview})
	f.pendingBasicAttackWait = result.Wait
	return result.ExtraQueue, err
}

func (f *Frame) attackWaitInput() actionflow.AttackWaitInput {
	return actionflow.AttackWaitInput{PendingWait: f.pendingBasicAttackWait, PendingAmmo: f.hasPendingBasicAttackAmmo(), PendingAction: f.pendingActionWait, HasQueuedAttack: f.run.loop.HasBasicAttack(), CombatantsAlive: f.continuousCombatantsLive()}
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
	return f.run.basicAttackFlowExecutor().PreviewProviders(f.run.loop.TimeMs(), f.run.compiled.Providers, attackProviderPreviewBridge{frame: context})
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
		if !f.run.loop.RescheduleBasicAttack(ready, generation) {
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
	if s.basicAttackFlowExecutor().PublishWait(actionflow.AttackWaitPublication{Now: s.loop.TimeMs(), End: s.loop.StartMs() + s.loop.DurationMs(), Next: s.nextBasicAttackTime(), Cooldown: s.basicAttackReadyAt(), Stopped: s.loop.Stopped(), StopReason: s.loop.Reason(), SourceHP: s.combatantHp(attack.Plan().Source), TargetHP: s.combatantHp(attack.Plan().Target), BudgetActive: s.budgetCause != ""}) {
		s.report.ReplaceAttackRecord(attack.CurrentRecordIndex(), attack.Current().Snapshot())
	}
}

func (s *Engine) basicAttackEventCurrent(event scheduler.GenericEvent) bool {
	attack := s.actions.BasicAttack()
	if attack == nil {
		return false
	}
	return s.basicAttackFlowExecutor().EventCurrent(event.TimeMs, s.nextBasicAttackTime(), event.BasicAttackGeneration, s.combatants[attack.Plan().Source].cooldowns)
}

func (s *Engine) nextBasicAttackTime() int64 {
	return s.basicAttackFlowExecutor().NextTime(s.loop.TimeMs(), basicAttackBridge{engine: s})
}

func basicAttackStateSnapshot(values, defaults model.NumericView) map[string]float64 {
	return actionflow.AttackStateSnapshot(values, defaults)
}
