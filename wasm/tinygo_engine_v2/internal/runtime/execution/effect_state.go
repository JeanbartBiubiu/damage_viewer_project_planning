// 效果状态写入、期限及目标标记的有限读准备与行动交接。
package execution

import (
	"fmt"
	"sort"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	contractpkg "tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/admission"
	"tinygo_engine_v2/internal/runtime/execution/hit"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	"tinygo_engine_v2/internal/scheduler"
)

type lifecycleStateActionsAPI interface {
	// ConsumeStateAmmo 只暂存同帧实际弹药消费，错误沿原操作返回。
	ConsumeStateAmmo(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, before, after float64) *model.EngineError
	// ReleaseStateTargetCooldowns 清理切换前的实际目标冷却，复用原帧行动账。
	ReleaseStateTargetCooldowns(owner, provider, previous string)
}

type lifecycleStateActions Frame

type lifecycleMarkExecutionAPI interface {
	// MarkContact 取得当前真实监听接触的有限身份，原冻结命中仍由命中执行持有。
	MarkContact(abilityRef, kind string) (lifecycle.MarkContact, *model.EngineError)
	// MarkState 借用当前实际拥有者状态袋，保留原读取点。
	MarkState(owner, provider string) effectpkg.BagView
	// MarkAmount 使用当前帧原能力上下文按操作序求值。
	MarkAmount(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) (float64, *model.EngineError)
	// MarkSpellShields 借用当前目标法术盾列表，不决定多盾优先级。
	MarkSpellShields(target string) effectpkg.ProviderList
	// ConsumeMarkCommand 使用当前原命令预算，失败沿当前操作返回。
	ConsumeMarkCommand() *model.EngineError
	// ClearMark 同帧调用效果状态操作，不新建或提交帧。
	ClearMark(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError
	// BlockMarkDamage 把当前冻结接触及盾身份接为待提交阻挡事实。
	BlockMarkDamage(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, shield effectpkg.Provider)
	// SettleMarkDamage 同帧结算真实伤害，返回新增逐伤数和实际编号。
	SettleMarkDamage(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) (int, uint64, *model.EngineError)
	// RestoreMarkResource 在标记伤害阶段之后同帧执行真实资源操作。
	RestoreMarkResource(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) *model.EngineError
	// RecordMarkConsumption 仅暂存已经完成的标记事实和统计。
	RecordMarkConsumption(consumption lifecycle.MarkConsumption)
}

type lifecycleMarkExecution Frame

// stateExecutionFrameAPI 只目录化状态执行借用的同帧读取、数值同步和行动接线。
type stateExecutionFrameAPI interface {
	// StateAmount 按原能力上下文读取当前金额。
	StateAmount(program formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError)
	// StateContext 准备当前状态属性同步的实际读值。
	StateContext(ability planbundle.CompiledAbility) (formula.GenericEvalContext, *model.EngineError)
	// StateBag 借用本帧指定状态袋，保留原创建标记。
	StateBag(owner, provider string, create bool) effectpkg.BagChange
	// ReadStateBag 保留原目标状态惰性到期标记和只读范围。
	ReadStateBag(owner, provider string, expireTarget bool) effectpkg.BagView
	// StateProviders 借用当前已发布的挂载，不切换成未来暂存。
	StateProviders(owner string) effectpkg.ProviderList
	// ResolveOwnerStateAttributes 按给定上下文同步拥有者属性。
	ResolveOwnerStateAttributes(owner string, context formula.GenericEvalContext)
	// ResolveTargetStateAttributes 按原目标、拥有者顺序同步属性。
	ResolveTargetStateAttributes(owner string, ability planbundle.CompiledAbility, context formula.GenericEvalContext)
	// ResolveAllStateAttributes 原位执行跨双方两遍重算。
	ResolveAllStateAttributes(ability planbundle.CompiledAbility)
	// StateFailure 读取本帧此前已经保留的失败。
	StateFailure() (bool, *model.EngineError)
	// MarkStateChanged 标记实际拥有者的本帧变化。
	MarkStateChanged(owner string)
	// ChangeStateCooldown 在原位置交接内部冷却、计时和数值投影。
	ChangeStateCooldown(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) *model.EngineError
	// SubtractStateCooldown 在原位置交接内部冷却减时。
	SubtractStateCooldown(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError
	// StateAmmo 借用该真实字段绑定的共同弹药。
	StateAmmo(owner, provider, key string) *actionpkg.AmmoView
	// RecoverStateAmmo 交接已经核定的同帧回充准备。
	RecoverStateAmmo(ammo *actionpkg.AmmoView, ability planbundle.CompiledAbility) *model.EngineError
	// SubtractStateAmmo 交接同帧弹药期限减时。
	SubtractStateAmmo(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError
	// ConsumeStateAmmo 暂存本次真实弹药消费。
	ConsumeStateAmmo(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, before, after float64) *model.EngineError
	// ReleaseStateTargetCooldowns 清理切换前的目标冷却。
	ReleaseStateTargetCooldowns(owner, provider, previous string)
	// RemainingTimingSlots 读取唯一队列扣除当前帧待提交计时后的容量。
	RemainingTimingSlots() int
	// StageStateExpiry 只追加状态执行已确定的本帧期限请求。
	StageStateExpiry(at int64, payload effectpkg.ExpiryPayload)
	// StageAnchoredTick 只追加状态执行已确定的本帧周期请求。
	StageAnchoredTick(at int64, payload effectpkg.AnchoredPayload)
}

// 以同布局指针转换借用当前原帧，不创建逐操作适配对象。
type stateExecutionFrame Frame

const (
	stateScopeProvider       = effectpkg.StateScopeProvider
	stateScopeProviderTarget = effectpkg.StateScopeProviderTarget
)

var _ lifecycleStateActionsAPI = (*lifecycleStateActions)(nil)

var _ lifecycle.StateWriteActions = (*lifecycleStateActions)(nil)

var _ lifecycleMarkExecutionAPI = (*lifecycleMarkExecution)(nil)

var _ lifecycle.MarkExecution = (*lifecycleMarkExecution)(nil)

var _ stateExecutionFrameAPI = (*stateExecutionFrame)(nil)

var _ lifecycle.StateExecutionReads = (*stateExecutionFrame)(nil)

var _ lifecycle.StateAttributeExecution = (*stateExecutionFrame)(nil)

var _ lifecycle.StateActionExecution = (*stateExecutionFrame)(nil)

var _ lifecycle.TimingRequests = (*stateExecutionFrame)(nil)

// 初始快照的现有状态形状只在恢复边界读取；随后移除CD的旧数值期限。
func migrateInternalCooldownTimers(bag effectpkg.BagChange, ledger *actionpkg.CooldownLedger, owner, provider string, now int64) {
	lifecycle.MigrateInternalCooldownTimers(bag, ledger, owner, provider, now)
}

func (f *Frame) activateProviderTarget(bag effectpkg.BagChange, owner, provider, target string) {
	if !bag.Present() || target == "" {
		return
	}
	if bag.TargetKey() != "" && bag.TargetKey() != target {
		lifecycle.ActivateProviderTarget(bag, f.stageFor(owner).writableCooldowns(), owner, provider, target, f.run.loop.TimeMs())
		return
	}
	bag.ActivateProviderTarget(target)
	bag.InvalidateCooldownProjection()
}

func (f *Frame) applyInternalCooldownStateChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) *model.EngineError {
	owner := f.providerOwnerKey()
	bag := f.providerStateBag(owner, f.ownerProviderRef, true)
	executor := f.run.lifecycleExecutor()
	id, changed, err := executor.ChangeInternalCooldown(op, owner, f.ownerProviderRef, f.targetKey, amount, bag, f.stageFor(owner).writableCooldowns(), f.run.loop.TimeMs())
	if err != nil {
		return err
	}
	if changed {
		f.stageInternalCooldownExpiry(id)
	}
	f.projectChangedInternalCooldown(owner, bag, ability)
	if f.fatal {
		return f.fatalErr
	}
	return nil
}

func (f *Frame) applyInternalCooldownDurationChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	owner := f.providerOwnerKey()
	bag := f.providerStateBag(owner, f.ownerProviderRef, true)
	executor := f.run.lifecycleExecutor()
	id, active, err := executor.InternalCooldownDurationActive(op, owner, f.ownerProviderRef, f.targetKey, bag, f.stageFor(owner).cooldowns, f.run.loop.TimeMs())
	if err != nil || !active {
		return err
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	changed, err := executor.SubtractInternalCooldown(op, id, amount, f.stageFor(owner).writableCooldowns(), f.run.loop.TimeMs())
	if err != nil {
		return err
	}
	if changed {
		f.stageInternalCooldownExpiry(id)
	}
	f.projectChangedInternalCooldown(owner, bag, ability)
	if f.fatal {
		return f.fatalErr
	}
	return nil
}

func (f *Frame) projectChangedInternalCooldown(owner string, bag effectpkg.BagChange, ability planbundle.CompiledAbility) {
	staged := f.stageFor(owner)
	bag.InvalidateCooldownProjection()
	bag.ProjectInternalCooldowns(staged.cooldowns.View(), owner, f.ownerProviderRef, f.run.loop.TimeMs())
	staged.dirty = true
	f.reResolveStagedAttributesTwoPass(ability)
}

func (f *Frame) stageInternalCooldownExpiry(id contractpkg.CooldownIdentity) {
	ledger := f.stageFor(id.Owner).writableCooldowns()
	key := actionpkg.InternalCooldownWaitKey(id)
	// 同帧多次写同一个CD只发布最终期限，不重复消费队列容量。
	for i := len(f.pendingStateExpiry) - 1; i >= 0; i-- {
		payload := f.pendingStateExpiry[i].payload
		if payload.Kind == "provider_cooldown" && payload.CombatantKey == id.Owner && payload.ProviderRef == id.ProviderRef && payload.StateKey == id.StateKey && payload.TargetKey == id.Target {
			f.pendingStateExpiry = append(f.pendingStateExpiry[:i], f.pendingStateExpiry[i+1:]...)
		}
	}
	if ledger.IsReady(id, f.run.loop.TimeMs()) {
		ledger.CancelWait(key)
		return
	}
	wait := ledger.RegisterWait(key, []contractpkg.CooldownIdentity{id}, 0, f.run.loop.TimeMs())
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: wait.ReadyAt, payload: effectpkg.ExpiryPayload{
		Kind: "provider_cooldown", CombatantKey: id.Owner, ProviderRef: id.ProviderRef, StateKey: id.StateKey,
		TargetKey: id.Target, ExpectedExpireAt: wait.ReadyAt, CooldownVersion: wait.Version,
	}})
}

func (s *Engine) seedInternalCooldownExpiries() {
	owners := make([]string, 0, len(s.combatants))
	for owner := range s.combatants {
		owners = append(owners, owner)
	}
	sort.Strings(owners)
	for _, owner := range owners {
		actor := s.combatants[owner]
		lifecycle.SeedCooldownExpiries(owner, actor.cooldowns, s.loop.TimeMs(), (*lifecycleExpiryRequests)(s))
		s.combatants[owner] = actor
	}
}

func (s *Engine) applyInternalCooldownExpiry(payload effectpkg.ExpiryPayload) {
	owner, exists := s.combatants[payload.CombatantKey]
	if !exists {
		return
	}
	if _, _, mounted := owner.instances.Providers().Find(payload.ProviderRef); !mounted {
		return
	}
	bag := owner.providerState.Lookup(payload.ProviderRef)
	if !bag.Present() || (payload.TargetKey != "" && bag.TargetKey() != payload.TargetKey) {
		return
	}
	scope := stateScopeProvider
	if payload.TargetKey != "" {
		scope = stateScopeProviderTarget
	}
	id := actionpkg.StateCooldownIdentity(payload.CombatantKey, payload.ProviderRef, payload.StateKey, scope, payload.TargetKey)
	key := actionpkg.InternalCooldownWaitKey(id)
	if !owner.cooldowns.WaitCurrent(key, payload.ExpectedExpireAt, payload.CooldownVersion) || owner.cooldowns.ReadyAt(id) != payload.ExpectedExpireAt || s.loop.TimeMs() < payload.ExpectedExpireAt {
		return
	}
	var storage Frame
	s.initExecutionFrame(&storage, model.SelectorSource, model.SelectorTarget, "cooldown_expiry:"+payload.ProviderRef)
	frame := &storage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.CombatantKey, payload.ProviderRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	ledger := frame.stageFor(payload.CombatantKey).writableCooldowns()
	ledger.Set(id, payload.ExpectedExpireAt, s.loop.TimeMs())
	ledger.CancelWait(key)
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}

func (r *lifecycleStateActions) ConsumeStateAmmo(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, before, after float64) *model.EngineError {
	return (*Frame)(r).stageAmmoConsumption(operation, ability, before, after)
}

func (r *lifecycleStateActions) ReleaseStateTargetCooldowns(owner, provider, previous string) {
	f := (*Frame)(r)
	f.stageFor(owner).writableCooldowns().RemoveTarget(owner, provider, previous, f.run.loop.TimeMs())
}

func (f *Frame) resolveTargetStateAttributes(owner string, ability planbundle.CompiledAbility, context formula.GenericEvalContext) {
	if f.targetKey != "" {
		target := f.stageFor(f.targetKey)
		target.setAttributes(f.resolveAttributesFor(f.targetKey, target.attributesView(), context))
		target.dirty = true
	}
	if owner != f.targetKey {
		source := f.stageFor(owner)
		source.setAttributes(f.resolveAttributesFor(owner, source.attributesView(), context))
	}
}

func (r *lifecycleMarkExecution) MarkContact(abilityRef, kind string) (lifecycle.MarkContact, *model.EngineError) {
	contact, err := (*Frame)(r).targetMarkContact(abilityRef, kind)
	if err != nil {
		return lifecycle.MarkContact{}, err
	}
	facts := *contact
	return lifecycle.MarkContact{UseRef: facts.UseRef, Source: facts.SourceKey, SkillKey: facts.SkillKey, Blocked: facts.Blocked == 1}, nil
}

func (r *lifecycleMarkExecution) MarkState(owner, provider string) effectpkg.BagView {
	return (*Frame)(r).providerStateBagForRead(owner, provider, false, effectpkg.ReadOptions{})
}

func (r *lifecycleMarkExecution) MarkAmount(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	return (*Frame)(r).evalAmount(operation.AmountProgram, ability)
}

func (r *lifecycleMarkExecution) MarkSpellShields(target string) effectpkg.ProviderList {
	return (*Frame)(r).activeSpellShields(target)
}

func (r *lifecycleMarkExecution) ConsumeMarkCommand() *model.EngineError {
	return (*Frame)(r).bumpCommandBudget()
}

func (r *lifecycleMarkExecution) ClearMark(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	return (*Frame)(r).applyStateChange(operation, ability)
}

func (r *lifecycleMarkExecution) BlockMarkDamage(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, shield effectpkg.Provider) {
	f := (*Frame)(r)
	contact := f.eventCtx.SkillHit
	facts := *contact
	facts.UnitScope, facts.SkillKey, facts.AbilityRef = model.SpellShieldScopeDamageInstance, ability.SkillKey, f.abilityRef
	facts.IsBasicAttack = ability.IsBasicAttack
	facts.CandidateKey, facts.EffectOccurrenceKey, facts.ResultKey = op.Ref, op.Ref, op.TargetMark.Damage.Ref
	facts.Blocked, facts.ReusedSkillUnit = 1, false
	facts.ShieldOwner, facts.ShieldProviderRef, facts.ShieldDefinitionRef, facts.ShieldSource = shield.Owner, shield.ProviderRef, shield.DefinitionRef, shield.Source
	local := hit.NewContext(hit.ContextSeed{Facts: facts, Ability: ability, AbilityRef: f.abilityRef})
	snapshot := f.captureEmitSnapshot(model.EventTypeSpellShieldBlocked, f.sourceKey, f.targetKey)
	snapshot.HasSkillHit, snapshot.SkillHit = true, &facts
	f.pendingEvents = append(f.pendingEvents, emittedEvent{eventType: model.EventTypeSpellShieldBlocked, ref: model.EventTypeSpellShieldBlocked, sourceKey: f.sourceKey, targetKey: f.targetKey, types: []string{model.EventTypeSpellShieldBlocked}, snapshot: snapshot,
		castInstanceID: f.castInstanceID, castOrigin: f.castOrigin, skillHit: local, hasUse: true, useKey: facts.UseRef, useSource: facts.SourceKey, useSkillKey: facts.SkillKey})
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: model.EventTypeSpellShieldBlocked, Data: skillHitEvidenceData(local)}
	})
}

func (r *lifecycleMarkExecution) SettleMarkDamage(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) (int, uint64, *model.EngineError) {
	f := (*Frame)(r)
	before := len(f.numeric.Facts().Damages)
	command := pipeline.Command{Kind: pipeline.KindDamage, Source: f.sourceKey, Target: f.targetKey, Amount: amount, DamageType: operation.DamageType}
	if err := f.applyDamageCommand(command, operation, frozenCritEvidence{}, ability, nil); err != nil {
		return 0, 0, err
	}
	count := len(f.numeric.Facts().Damages) - before
	if count != 1 {
		return count, 0, nil
	}
	return count, f.numeric.Facts().Damages[before].DamageID, nil
}

func (r *lifecycleMarkExecution) RestoreMarkResource(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) *model.EngineError {
	f := (*Frame)(r)
	return f.applyResourceOperation(f.ownerCombatantKey, amount, operation, ability)
}

func (r *lifecycleMarkExecution) RecordMarkConsumption(consumption lifecycle.MarkConsumption) {
	f := (*Frame)(r)
	op := consumption.Operation
	m := op.TargetMark
	contact := consumption.Contact
	deadline, blocked := consumption.Deadline, consumption.DamageBlocked
	var damageID interface{}
	if consumption.DamageID != 0 {
		damageID = consumption.DamageID
	}
	f.pendingTargetMark.ConsumedCount++
	if m.TriggerKind == model.EventTypeBasicAttackHit {
		f.pendingTargetMark.AttackCount++
	} else {
		f.pendingTargetMark.SkillCount++
	}
	if blocked {
		f.pendingTargetMark.DamageBlockedCount++
	}
	f.recordEvidenceLazy("target_mark_consumed", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "target_mark_consumed", Ref: op.Ref, Path: op.Path, Data: map[string]interface{}{
			"owner": m.OwnerCombatantKey, "providerRef": m.OwnerProviderRef, "definitionRef": f.run.compiled.Providers[op.OwnerProviderIndex].ProviderKey, "stateKey": m.StateKey, "target": f.targetKey,
			"triggerKind": m.TriggerKind, "triggerAbilityRef": m.TriggerAbilityRef, "useRef": contact.UseRef, "useSource": contact.Source, "useSkillKey": contact.SkillKey, "castInstanceId": f.castInstanceID,
			"stateBefore": float64(1), "stateAfter": float64(0), "deadlineBefore": deadline, "damageBlocked": blocked, "damageId": damageID}}
	})
}

func (s *Engine) restoreProviderStateTimers(snapshot model.Snapshot) *model.EngineError {
	combatantKeys := map[string]bool{}
	for _, c := range snapshot.Combatants {
		combatantKeys[c.Key] = true
	}
	for i, snap := range snapshot.Combatants {
		rt, ok := s.combatants[snap.Key]
		if !ok {
			continue
		}
		base := "initialSnapshot.combatants[" + itoa(uint32(i)) + "].providerState"
		executor := s.lifecycleExecutor()
		if err := executor.RestoreStateTimers(snap.Key, rt.instances.Providers(), &rt.providerState, &rt.cooldowns, snap.ProviderState, combatantKeys, &s.providerDefinitionFields, snapshot.TimeMs, base); err != nil {
			return err
		}
		s.combatants[snap.Key] = rt
	}
	return nil
}

func (s *Engine) applyProviderSourceStateExpiry(payload effectpkg.ExpiryPayload) {
	if payload.StateGeneration > 0 {
		s.applyStateOnExpire(payload)
		return
	}
	actor, exists := s.combatants[payload.CombatantKey]
	if !exists {
		return
	}
	bag := actor.providerState.Lookup(payload.ProviderRef)
	if !lifecycle.SourceExpiryCurrent(payload, bag, s.loop.TimeMs()) {
		return
	}
	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, model.SelectorSource, model.SelectorTarget, "state_expiry:"+payload.ProviderRef)
	frame := &frameStorage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.CombatantKey, payload.ProviderRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	staged := frame.stageFor(payload.CombatantKey)
	stagedBag := staged.providerState.Edit(payload.ProviderRef, false)
	lifecycle.ClearExpiredSourceState(payload, stagedBag)
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.recordEvidenceLazy("provider_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "provider_state_expired", Ref: payload.ProviderRef,
			Data: map[string]interface{}{"owner": payload.CombatantKey, "stateKey": payload.StateKey, "expectedExpireAt": payload.ExpectedExpireAt}}
	})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}

func (s *Engine) stateOnExpireBinding(payload effectpkg.ExpiryPayload) (planbundle.CompiledProviderStateField, bool) {
	actor, exists := s.combatants[payload.CombatantKey]
	if !exists {
		return planbundle.CompiledProviderStateField{}, false
	}
	executor := s.lifecycleExecutor()
	return executor.StateOnExpireBinding(payload, actor.instances.Providers(), actor.providerState.Lookup(payload.ProviderRef), s.loop.TimeMs())
}

func (s *Engine) currentStateOnExpire(event scheduler.GenericEvent) bool {
	if event.Kind != scheduler.GenericEventExpireCleanup || event.DriverEntryIndex < 0 || event.DriverEntryIndex >= s.effectTimers.ExpiryCount() {
		return false
	}
	payload := s.effectTimers.ExpiryAt(event.DriverEntryIndex)
	_, current := s.stateOnExpireBinding(payload)
	return current && event.TimeMs == payload.ExpectedExpireAt
}

// 只有新到期回调排在同刻真实战斗之后；原清理事件与事件身份均不改。
func (s *Engine) selectCombatBeforeStateOnExpire(expiry scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError) {
	selected, restored := s.selectSameTimeEvent(expiry, sameTimeBeforeStateExpiry)
	if !restored {
		return expiry, s.basicAttackErr("state expiry selection could not restore original events", "events")
	}
	return selected, nil
}

func (s *Engine) applyStateOnExpire(payload effectpkg.ExpiryPayload) {
	field, current := s.stateOnExpireBinding(payload)
	if !current || payload.ExpectedExpireAt > s.loop.TimeMs() || s.combatantHp(payload.CombatantKey) <= 0 {
		return
	}
	var storage Frame
	s.initExecutionFrame(&storage, payload.CombatantKey, payload.CombatantKey, "state_expiry:"+payload.ProviderRef)
	f := &storage
	f.ownerCombatantKey, f.ownerProviderRef = payload.CombatantKey, payload.ProviderRef
	if err := f.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	bag := f.stageFor(payload.CombatantKey).providerState.Edit(payload.ProviderRef, false)
	lifecycle.ClearCallbackSourceState(payload, field, bag)
	f.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	ability := planbundle.CompiledAbility{}
	if field.OnExpireBeforeCombat {
		ability = s.compiled.Abilities[field.OnExpireAbilityIndex]
	}
	if err := f.executeOperations(ability, s.compiled.Operations[int(field.OnExpireStart):int(field.OnExpireStart)+int(field.OnExpireCount)]); err != nil {
		s.processFailure = err
		return
	}
	f.recordEvidenceLazy("provider_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "provider_state_expired", Ref: payload.ProviderRef, Data: map[string]interface{}{"owner": payload.CombatantKey, "stateKey": payload.StateKey, "expectedExpireAt": payload.ExpectedExpireAt}}
	})
	f.commit()
	if f.fatal {
		s.processFailure = f.fatalErr
		return
	}
	s.processFailure = f.dispatchPendingEvents()
}

func (f *Frame) applyStateChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	if op.TargetMarkWriterRef != "" {
		if err := f.validateTargetMarkWriter(op); err != nil {
			return err
		}
	}
	executor := f.run.lifecycleExecutor()
	work := (*stateExecutionFrame)(f)
	return f.adoptLifecycleBudget(executor.ExecuteStateWrite(f.stateExecutionInput(op, ability), work, work, work, work))
}

func (f *Frame) applyStateDurationChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	executor := f.run.lifecycleExecutor()
	work := (*stateExecutionFrame)(f)
	return f.adoptLifecycleBudget(executor.ExecuteStateDuration(f.stateExecutionInput(op, ability), work, work, work, work))
}

func (f *Frame) stateExecutionInput(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) lifecycle.StateExecutionInput {
	return lifecycle.StateExecutionInput{Operation: op, Ability: ability, Owner: f.providerOwnerKey(), Provider: f.ownerProviderRef,
		Source: f.sourceKey, Target: f.targetKey, Now: f.run.loop.TimeMs(), Stop: f.run.loop.StartMs() + f.run.loop.DurationMs(),
		Automated: f.run.automatedRun(), MountedListener: f.mountedListener, Event: f.eventCtx}
}

func (r *stateExecutionFrame) StateAmount(program formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError) {
	return (*Frame)(r).evalAmount(program, ability)
}

func (r *stateExecutionFrame) StateContext(ability planbundle.CompiledAbility) (formula.GenericEvalContext, *model.EngineError) {
	return (*Frame)(r).evalContext(ability)
}

func (r *stateExecutionFrame) StateBag(owner, provider string, create bool) effectpkg.BagChange {
	return (*Frame)(r).providerStateBag(owner, provider, create)
}

func (r *stateExecutionFrame) ReadStateBag(owner, provider string, expireTarget bool) effectpkg.BagView {
	return (*Frame)(r).providerStateBagForRead(owner, provider, false, effectpkg.ReadOptions{ExpireTarget: expireTarget})
}

func (r *stateExecutionFrame) StateProviders(owner string) effectpkg.ProviderList {
	return (*Frame)(r).run.combatants[owner].instances.Providers()
}

func (r *stateExecutionFrame) ResolveOwnerStateAttributes(owner string, context formula.GenericEvalContext) {
	f := (*Frame)(r)
	staged := f.stageFor(owner)
	staged.setAttributes(f.resolveAttributesFor(owner, staged.attributesView(), context))
}

func (r *stateExecutionFrame) ResolveTargetStateAttributes(owner string, ability planbundle.CompiledAbility, context formula.GenericEvalContext) {
	(*Frame)(r).resolveTargetStateAttributes(owner, ability, context)
}

func (r *stateExecutionFrame) ResolveAllStateAttributes(ability planbundle.CompiledAbility) {
	(*Frame)(r).reResolveStagedAttributesTwoPass(ability)
}

func (r *stateExecutionFrame) StateFailure() (bool, *model.EngineError) {
	f := (*Frame)(r)
	return f.fatal, f.fatalErr
}

func (r *stateExecutionFrame) MarkStateChanged(owner string) {
	(*Frame)(r).stageFor(owner).dirty = true
}

func (r *stateExecutionFrame) ChangeStateCooldown(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64) *model.EngineError {
	return (*Frame)(r).applyInternalCooldownStateChange(operation, ability, amount)
}

func (r *stateExecutionFrame) SubtractStateCooldown(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	return (*Frame)(r).applyInternalCooldownDurationChange(operation, ability)
}

func (r *stateExecutionFrame) StateAmmo(owner, provider, key string) *actionpkg.AmmoView {
	return (*Frame)(r).run.findAmmo(owner, provider, key)
}

func (r *stateExecutionFrame) RecoverStateAmmo(ammo *actionpkg.AmmoView, ability planbundle.CompiledAbility) *model.EngineError {
	return (*Frame)(r).stageAmmoRecoveryFor(ammo, ability, -1)
}

func (r *stateExecutionFrame) SubtractStateAmmo(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	return (*Frame)(r).applyAmmoDurationChange(operation, ability)
}

func (r *stateExecutionFrame) ConsumeStateAmmo(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, before, after float64) *model.EngineError {
	return (*Frame)(r).stageAmmoConsumption(operation, ability, before, after)
}

func (r *stateExecutionFrame) ReleaseStateTargetCooldowns(owner, provider, previous string) {
	(*Frame)(r).stageFor(owner).writableCooldowns().RemoveTarget(owner, provider, previous, (*Frame)(r).run.loop.TimeMs())
}

func (r *stateExecutionFrame) RemainingTimingSlots() int {
	return (*Frame)(r).remainingTimingSlots()
}

func (r *stateExecutionFrame) StageStateExpiry(at int64, payload effectpkg.ExpiryPayload) {
	f := (*Frame)(r)
	f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: at, payload: payload})
}

func (r *stateExecutionFrame) StageAnchoredTick(at int64, payload effectpkg.AnchoredPayload) {
	f := (*Frame)(r)
	f.pendingAnchoredTicks = append(f.pendingAnchoredTicks, pendingFrameAnchoredTick{at: at, payload: payload})
}

func (f *Frame) applyCooldownChange(targetKey, abilityRef string, readyAt int64) *model.EngineError {
	if abilityRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "cooldown_change requires abilityRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if ref, valid := planbundle.ParseAbilityRef(abilityRef); valid && f.run.combatantExists(ref.Combatant) {
		targetKey = ref.Combatant
	}
	sc := f.stageFor(targetKey)
	sc.writableCooldowns().Set(actionpkg.AbilityCooldownIdentity(targetKey, abilityRef), readyAt, f.run.loop.TimeMs())
	return nil
}

func (s *Engine) targetMarkSummaryOutput() *model.TargetMarkSummary {
	if !s.compiled.HasTargetMarkConsumption {
		return nil
	}
	copy := s.report.TargetMarkSummary()
	return &copy
}

func (f *Frame) commitTargetMarkSummary() { f.run.report.AddTargetMark(f.pendingTargetMark) }

func (s *Engine) initTargetMarkSources() *model.EngineError {
	if !s.compiled.HasTargetMarkConsumption {
		return nil
	}
	sources := admission.TargetMarkSources{StartMs: s.loop.StartMs(), Selection: admission.SourceSelection{SkillBindings: s.plannedSkillBindings()}}
	if attack := s.actions.BasicAttack(); attack != nil {
		plan := attack.Plan()
		sources.Selection.BasicAttack = &plan
	}
	for index, operation := range s.compiled.Operations {
		mark := operation.TargetMark
		if mark == nil {
			continue
		}
		bag := s.combatants[mark.OwnerCombatantKey].providerState.Lookup(mark.OwnerProviderRef)
		sources.Initial = append(sources.Initial, admission.TargetMarkInitialState{OperationIndex: index, BagPresent: bag.Present(), Value: bag.TargetValues().At(mark.StateKey), ExpireAt: bag.TargetExpireAt().At(mark.StateKey)})
	}
	return admission.ValidateTargetMarkSources(s.admissionInput(model.SelectorSource), sources)
}

func (f *Frame) targetMarkContact(abilityRef, kind string) (*contractpkg.SkillHitFacts, *model.EngineError) {
	fail := func(message string) (*contractpkg.SkillHitFacts, *model.EngineError) {
		return nil, f.run.basicAttackErr(message, f.abilityRef)
	}
	if !f.run.compiled.HasTargetMarkConsumption || !f.mountedListener || f.castInstanceID == 0 || f.eventCtx == nil || f.eventCtx.EventType != kind || f.eventCtx.SkillHit == nil || !f.eventCtx.HasUse {
		return fail("target mark requires its native mounted listener contact")
	}
	contact := f.eventCtx.SkillHit
	facts := contact
	use := f.run.skillUses[facts.UseRef]
	if !facts.HasPlan || !facts.RootDamageEvent || facts.OccurrenceID == 0 || facts.AbilityRef != abilityRef || facts.SourceKey != f.sourceKey || facts.SourceKey != f.ownerCombatantKey || facts.TargetKey != f.targetKey || use == nil ||
		use.identity.Source() != facts.SourceKey || use.identity.SkillKey() != facts.SkillKey || f.eventCtx.UseKey != facts.UseRef || f.eventCtx.UseSource != use.identity.Source() || f.eventCtx.UseSkillKey != use.identity.SkillKey() {
		return fail("target mark native contact/use/ability/target identity mismatch")
	}
	if kind == model.EventTypeBasicAttackHit {
		b := f.run.actions.BasicAttack()
		if b == nil || b.Current() == nil || b.Current().UseRef() != facts.UseRef || b.Current().HitAtMs() == nil || *b.Current().HitAtMs() != f.run.loop.TimeMs() || b.Plan().HitAbilityRef != abilityRef || !facts.IsBasicAttack {
			return fail("target mark requires the current selected attack's completed hit")
		}
	} else {
		action := f.run.skillActionForUse(facts.UseRef)
		found := false
		if action != nil {
			for _, hit := range action.Binding().HitBindings {
				found = found || hit.HitAbilityRef == abilityRef
			}
		}
		if action == nil || !found || facts.IsBasicAttack {
			return fail("target mark requires a real INITIAL process hit, not an external use fact")
		}
	}
	return contact, nil
}

func (f *Frame) validateTargetMarkWriter(op planbundle.CompiledOperation) *model.EngineError {
	contact, err := f.targetMarkContact(op.TargetMarkWriterRef, model.EventTypeSkillHit)
	if err != nil {
		return err
	}
	facts := contact
	if facts.Blocked != 0 || op.OwnerProviderIndex < 0 || op.OwnerProviderIndex >= len(f.run.compiled.Providers) || facts.SkillKey != f.run.compiled.Providers[op.OwnerProviderIndex].SkillKey {
		return f.run.basicAttackErr("mark SET1 requires its own unblocked INITIAL contact", op.Path)
	}
	return nil
}

func (f *Frame) consumeTargetMark(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	executor := f.run.lifecycleExecutor()
	return executor.ConsumeTargetMark(lifecycle.MarkInput{Operation: op, Ability: ability, Owner: f.providerOwnerKey(),
		Provider: f.ownerProviderRef, AbilityRef: f.abilityRef, Target: f.targetKey, Now: f.run.loop.TimeMs()}, (*lifecycleMarkExecution)(f))
}

// applyProviderTargetStateExpiry clears one expired target-bound state key and re-resolves
// the affected target combatant's attributes so final snapshot/sample reflect restored armor
// without requiring another cast.
func (s *Engine) applyProviderTargetStateExpiry(payload effectpkg.ExpiryPayload) {
	if payload.CombatantKey == "" || payload.ProviderRef == "" || payload.StateKey == "" {
		return
	}
	owner, ok := s.combatants[payload.CombatantKey]
	if !ok {
		return
	}
	bag := owner.providerState.Edit(payload.ProviderRef, false)
	if !bag.Present() {
		return
	}
	bag.Ensure()
	s.combatants[payload.CombatantKey] = owner
	if !lifecycle.TargetExpiryCurrent(payload, bag.View(), s.loop.TimeMs()) {
		return
	}
	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, payload.CombatantKey, payload.TargetKey, "target_state_expiry:"+payload.ProviderRef)
	frame := &frameStorage
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.CombatantKey, payload.ProviderRef
	if err := frame.consumeCommands(1); err != nil {
		s.processFailure = err
		return
	}
	staged := frame.stageFor(payload.CombatantKey)
	stagedBag := staged.providerState.Edit(payload.ProviderRef, false)
	lifecycle.ClearExpiredTargetState(payload, stagedBag)
	frame.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	frame.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "provider_target_state_expired", Ref: payload.ProviderRef,
			Data: map[string]interface{}{"owner": payload.CombatantKey, "target": payload.TargetKey, "stateKey": payload.StateKey, "expectedExpireAt": payload.ExpectedExpireAt}}
	})
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}

func (s *Engine) targetTimingBinding(owner, ref, key string) (effectpkg.Provider, int, planbundle.CompiledTargetTiming, bool) {
	actor, exists := s.combatants[owner]
	if !exists {
		return effectpkg.Provider{}, 0, planbundle.CompiledTargetTiming{}, false
	}
	executor := s.lifecycleExecutor()
	return executor.TargetTimingBinding(actor.instances.Providers(), owner, ref, key, s.loop.TimeMs())
}

func (s *Engine) phasedFact(payload effectpkg.AnchoredPayload) (effectpkg.Provider, planbundle.CompiledTargetTiming, effectpkg.BagView, effectpkg.TimingFact, bool) {
	instance, slot, timing, exists := s.targetTimingBinding(payload.OwnerKey, payload.ProviderRef, payload.AnchorStateKey)
	if !exists {
		return instance, timing, effectpkg.BagView{}, effectpkg.TimingFact{}, false
	}
	bag := s.combatants[payload.OwnerKey].providerState.Lookup(payload.ProviderRef)
	fact, current := lifecycle.CurrentPhasedFact(payload, instance, slot, timing, bag)
	return instance, timing, bag, fact, current
}

func (s *Engine) phasedTerminal(event scheduler.GenericEvent, payload effectpkg.AnchoredPayload) bool {
	_, timing, _, fact, valid := s.phasedFact(payload)
	if !valid || fact.Expiry != event.TimeMs || !fact.Protect || event.TimeMs <= fact.Origin {
		return false
	}
	interval := s.compiled.Abilities[timing.AbilityIndex].TickSpec.IntervalMs
	return interval > 0 && (event.TimeMs-fact.Origin)%interval == 0
}

func (s *Engine) handlePhasedTick(event scheduler.GenericEvent, payload effectpkg.AnchoredPayload) *model.EngineError {
	if event.TimeMs == payload.ExpectedExpireAt && s.effectTimers.TerminalCount(event.TimeMs) > 0 {
		s.effectTimers.DecrementTerminal(event.TimeMs)
		if s.effectTimers.TerminalCount(event.TimeMs) == 0 {
			s.effectTimers.ClearTerminal(event.TimeMs)
		}
	}
	inst, timing, _, fact, valid := s.phasedFact(payload)
	if !valid || event.TimeMs > fact.Expiry {
		return nil
	}
	executor := s.lifecycleExecutor()
	return executor.RunPhasedTick(inst, timing, fact, payload, event.TimeMs, (*lifecycleAnchoredExecution)(s))
}

func (f *Frame) stageTargetTimingClear(owner, ref, target, key string, slot int, gen uint64, expiry int64) *model.EngineError {
	bag := f.providerStateBag(owner, ref, false)
	if !lifecycle.TargetTimingClearCurrent(bag, target, slot, gen, expiry) {
		return nil
	}
	if err := f.consumeCommands(1); err != nil {
		return err
	}
	lifecycle.ClearTargetTiming(bag, key, slot)
	f.stageFor(owner).dirty = true
	f.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "provider_target_state_expired", Ref: ref, Data: map[string]interface{}{"owner": owner, "target": target, "stateKey": key, "expectedExpireAt": expiry}}
	})
	return nil
}

func (s *Engine) currentTargetTimingExpiry(event scheduler.GenericEvent) bool {
	return event.Kind == scheduler.GenericEventExpireCleanup && event.DriverEntryIndex >= 0 && event.DriverEntryIndex < s.effectTimers.ExpiryCount() && s.effectTimers.ExpiryAt(event.DriverEntryIndex).Kind == "target_timing"
}

func (s *Engine) applyTargetTimingExpiry(payload effectpkg.ExpiryPayload) {
	inst, slot, timing, exists := s.targetTimingBinding(payload.CombatantKey, payload.ProviderRef, payload.StateKey)
	if !exists || slot != payload.TimingSlot {
		return
	}
	bag := s.combatants[inst.Owner].providerState.Lookup(inst.ProviderRef)
	if !bag.Present() || !bag.HasTiming() || bag.TargetKey() != payload.TargetKey {
		return
	}
	fact := bag.Timing(slot)
	if !fact.Active || fact.Generation != payload.StateGeneration || fact.Expiry != payload.ExpectedExpireAt || s.loop.TimeMs() != fact.Expiry {
		return
	}
	ability := s.compiled.Abilities[timing.AbilityIndex]
	var frame Frame
	s.initExecutionFrame(&frame, inst.Source, payload.TargetKey, fmt.Sprintf("%s.provider[%s].ability[%s]", inst.Owner, inst.ProviderRef, ability.AbilityKey))
	frame.ownerCombatantKey, frame.ownerProviderRef = inst.Owner, inst.ProviderRef
	frame.castInstanceID, frame.castOrigin = s.mintCastInstanceID(), ability.CastOrigin
	frame.strictReads = true
	if err := frame.stageTargetTimingClear(inst.Owner, inst.ProviderRef, payload.TargetKey, payload.StateKey, slot, payload.StateGeneration, fact.Expiry); err != nil {
		s.processFailure = err
		return
	}
	if !timing.Phased {
		x := ability.TargetExpirySpec
		if x == nil {
			s.processFailure = s.basicAttackErr("target expiry lacks its actual compiled payload", payload.StateKey)
			return
		}
		if err := frame.executeOperations(ability, s.compiled.Operations[int(x.OnExpireStart):int(x.OnExpireStart)+int(x.OnExpireCount)]); err != nil {
			s.processFailure = err
			return
		}
	}
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
		return
	}
	s.processFailure = frame.dispatchPendingEvents()
}

func (s *Engine) validateTargetTimingFresh() *model.EngineError {
	executor := s.lifecycleExecutor()
	var owners [2]lifecycle.InitialEffectOwner
	source, target := s.combatants["source"], s.combatants["target"]
	owners[0] = lifecycle.InitialEffectOwner{Owner: "source", Instances: source.instances.Providers(), Bags: &source.providerState}
	owners[1] = lifecycle.InitialEffectOwner{Owner: "target", Instances: target.instances.Providers(), Bags: &target.providerState}
	return executor.ValidateTargetTimingFresh(owners)
}
