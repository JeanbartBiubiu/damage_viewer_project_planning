// 效果到期、锚定及周期执行的真实帧与唯一队列接线。
package execution

import (
	"sort"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/lifecycle"
	"tinygo_engine_v2/internal/scheduler"
)

type lifecycleTickExecutionAPI interface {
	// PeriodicBoundary 在永久周期原边界核对死亡；首次边界清零该事件命令数。
	PeriodicBoundary(first bool) bool
	// PeriodicParticipantsAlive 只读取当前背景普攻双方生命，供周期续排原位复核。
	PeriodicParticipantsAlive() bool
	// PeriodicCooldownBlocked 用实际拥有者冷却账判断本次周期是否受阻。
	PeriodicCooldownBlocked(owner, ref string) bool
	// PeriodicConditionBlocked 准备当前双方读值并运行既有施放条件。
	PeriodicConditionBlocked(source, target string, ability planbundle.CompiledAbility, ref string) (bool, *model.EngineError)
	// RunPeriodicFrame 组合本周期的真实帧、同帧付款/操作和统一提交，不承接周期资格规则。
	RunPeriodicFrame(invocation lifecycle.TickInvocation) *model.EngineError
	// RecordPeriodicTick 在真实周期帧成功后记录原有周期事实。
	RecordPeriodicTick(owner string, instance effectpkg.Provider)
	// EnqueuePeriodicTick 将已决定的计时交给唯一循环，保持原直接入队边界。
	EnqueuePeriodicTick(request lifecycle.ProviderTickRequest)
}

type lifecycleTickExecution Engine

type lifecycleTimingRequestsAPI interface {
	// RemainingTimingSlots 返回唯一队列容量减该帧已暂存计时数，不创建独立容量账。
	RemainingTimingSlots() int
	// StageStateExpiry 追加当前效果状态期限，等待真实预检和提交。
	StageStateExpiry(at int64, payload effectpkg.ExpiryPayload)
	// StageAnchoredTick 追加当前效果锚定周期，等待真实预检和提交。
	StageAnchoredTick(at int64, payload effectpkg.AnchoredPayload)
}

type lifecycleTimingRequests Frame

type lifecycleAnchoredExecutionAPI interface {
	// AnchoredCooldownBlocked 读取真实拥有者冷却账，不缓存周期资格。
	AnchoredCooldownBlocked(owner, abilityRef string) bool
	// AnchoredConditionBlocked 在原位置准备读值并判断当前周期条件。
	AnchoredConditionBlocked(source, target string, ability planbundle.CompiledAbility, ref string) (bool, *model.EngineError)
	// RunAnchoredFrame 组合该周期真实帧、操作与末拍清理，分别返回发布和尾部错误。
	RunAnchoredFrame(invocation lifecycle.AnchoredInvocation) (bool, *model.EngineError)
	// ReleaseAnchoredHold 从当前已提交效果状态释放同世代末拍保护。
	ReleaseAnchoredHold(payload effectpkg.AnchoredPayload, settled bool)
	// RecordAnchoredTick 在真实执行和同步尾部成功后记录原有周期事实。
	RecordAnchoredTick(invocation lifecycle.AnchoredInvocation)
}

type lifecycleAnchoredExecution Engine

type lifecycleExpiryRequestsAPI interface {
	// EnqueueExpiry 将当前效果已决定的实际期限交给唯一循环，不推进时钟。
	EnqueueExpiry(at int64, payload effectpkg.ExpiryPayload)
}

type lifecycleExpiryRequests Engine

var _ lifecycleTickExecutionAPI = (*lifecycleTickExecution)(nil)

var _ lifecycle.TickExecution = (*lifecycleTickExecution)(nil)

var _ lifecycleTimingRequestsAPI = (*lifecycleTimingRequests)(nil)

var _ lifecycle.TimingRequests = (*lifecycleTimingRequests)(nil)

var _ lifecycleAnchoredExecutionAPI = (*lifecycleAnchoredExecution)(nil)

var _ lifecycle.AnchoredExecution = (*lifecycleAnchoredExecution)(nil)

var _ lifecycleExpiryRequestsAPI = (*lifecycleExpiryRequests)(nil)

var _ lifecycle.ExpiryRequests = (*lifecycleExpiryRequests)(nil)

func tickSpecAnchoredTo(spec *planbundle.CompiledTickSpec, key string) bool {
	return lifecycle.TickAnchoredTo(spec, key)
}

func (s *Engine) findAnchoredTickAbility(index uint16, key string) (*planbundle.CompiledAbility, bool) {
	executor := s.lifecycleExecutor()
	return executor.FindAnchoredAbility(index, key)
}

func (s *Engine) enqueueAnchoredTickAt(atMs int64, payload effectpkg.AnchoredPayload) {
	if atMs > s.loop.StartMs()+s.loop.DurationMs() {
		return
	}
	idx := s.effectTimers.RegisterAnchored(payload)
	ev := scheduler.GenericEvent{
		TimeMs:           atMs,
		Category:         scheduler.GenericCategoryAnchoredTick,
		Kind:             scheduler.GenericEventAnchoredTick,
		DriverEntryIndex: idx,
		ProviderInstanceRef: scheduler.ProviderInstanceRef{
			CombatantKey: payload.OwnerKey,
			ProviderRef:  payload.ProviderRef,
		},
	}
	if !s.pushCombatEvent(ev) {
		return
	}
	if atMs == payload.ExpectedExpireAt {
		s.effectTimers.AddTerminal(atMs)
		// Other callbacks at this exact boundary may resolve this provider's
		// modifiers before its own terminal runs. Only an actual, still-bound
		// queued terminal grants the existing per-bag inclusive hold.
		if s.currentAnchoredTerminal(ev) {
			owner := s.combatants[payload.OwnerKey]
			bag := owner.providerState.Edit(payload.ProviderRef, false)
			if !payload.Phased {
				bag.SetInclusiveAtExpiryHold(payload.TargetKey, payload.AnchorStateKey)
			}
			s.combatants[payload.OwnerKey] = owner
		}
	}
}

// selectAnchoredTerminalBeforeProcessTimer changes only the next selected event,
// never the heap's category order. Held events retain their original nonzero Seq
// and Priority on reinsert, so all process timers and nonterminal ticks preserve
// their existing order. The selected terminal leaves the heap exactly once and
// is accounted/executed by the normal run loop, including errors and deaths.
func (s *Engine) selectAnchoredTerminalBeforeProcessTimer(timer scheduler.GenericEvent) (scheduler.GenericEvent, *model.EngineError) {
	if s.effectTimers.TerminalCount(timer.TimeMs) == 0 {
		return timer, nil
	}
	selected, restored := s.selectSameTimeEvent(timer, sameTimeAnchoredTerminal)
	if !restored {
		return timer, engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "anchored terminal selection could not restore heap", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	return selected, nil
}

func (s *Engine) currentAnchoredTerminal(ev scheduler.GenericEvent) bool {
	if ev.Kind == scheduler.GenericEventAnchoredTick && ev.DriverEntryIndex >= 0 && ev.DriverEntryIndex < s.effectTimers.AnchoredCount() {
		p := s.effectTimers.AnchoredAt(ev.DriverEntryIndex)
		if p.Phased {
			return s.phasedTerminal(ev, p)
		}
	}
	if ev.Kind != scheduler.GenericEventAnchoredTick || ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= s.effectTimers.AnchoredCount() {
		return false
	}
	payload := s.effectTimers.AnchoredAt(ev.DriverEntryIndex)
	if ev.TimeMs != payload.ExpectedExpireAt || payload.ExpectedExpireAt <= 0 || payload.OwnerKey == "" || payload.ProviderRef == "" || payload.TargetKey == "" || payload.AnchorStateKey == "" {
		return false
	}
	owner, ok := s.combatants[payload.OwnerKey]
	if !ok {
		return false
	}
	inst, _, ok := owner.instances.Providers().Find(payload.ProviderRef)
	if !ok {
		return false
	}
	if _, ok := s.findAnchoredTickAbility(inst.DefinitionIndex, payload.AnchorStateKey); !ok {
		return false
	}
	bag := owner.providerState.Lookup(payload.ProviderRef)
	if !lifecycle.AnchoredStateCurrent(payload, bag) {
		return false
	}
	source := inst.Source
	if source == "" {
		source = payload.OwnerKey
	}
	return payload.SourceKey == "" || payload.SourceKey == source
}

func (s *Engine) handleAnchoredTick(ev scheduler.GenericEvent) *model.EngineError {
	if ev.DriverEntryIndex >= 0 && ev.DriverEntryIndex < s.effectTimers.AnchoredCount() && s.effectTimers.AnchoredAt(ev.DriverEntryIndex).Phased {
		return s.handlePhasedTick(ev, s.effectTimers.AnchoredAt(ev.DriverEntryIndex))
	}
	if ev.DriverEntryIndex < 0 || ev.DriverEntryIndex >= s.effectTimers.AnchoredCount() {
		return nil
	}
	payload := s.effectTimers.AnchoredAt(ev.DriverEntryIndex)
	if ev.TimeMs == payload.ExpectedExpireAt {
		if remaining := s.effectTimers.TerminalCount(ev.TimeMs); remaining > 1 {
			s.effectTimers.SetTerminalCount(ev.TimeMs, remaining-1)
		} else {
			s.effectTimers.ClearTerminal(ev.TimeMs)
		}
	}
	if payload.OwnerKey == "" || payload.ProviderRef == "" || payload.TargetKey == "" || payload.AnchorStateKey == "" {
		return nil
	}
	owner, ok := s.combatants[payload.OwnerKey]
	if !ok {
		return nil
	}
	inst, _, ok := owner.instances.Providers().Find(payload.ProviderRef)
	if !ok {
		return nil
	}
	tickAbility, ok := s.findAnchoredTickAbility(inst.DefinitionIndex, payload.AnchorStateKey)
	if !ok || tickAbility.TickSpec == nil {
		return nil
	}

	bag := owner.providerState.Edit(payload.ProviderRef, false)
	if !bag.Present() {
		return nil
	}
	bag.Ensure()
	s.combatants[payload.OwnerKey] = owner
	executor := s.lifecycleExecutor()
	return executor.RunAnchoredTick(inst, *tickAbility, payload, bag, s.loop.TimeMs(), (*lifecycleAnchoredExecution)(s))
}

// Stage the standard one-field target expiration in the callback's transaction.
// This preserves its expiry evidence and attribute invalidation while preventing
// an intervening process timer from seeing the completed window. A callback that
// cleared or refreshed the state owns its newer value; a failed frame publishes
// neither callback effects nor this cleanup.
func (f *Frame) stageAnchoredTerminalExpiry(payload effectpkg.AnchoredPayload) *model.EngineError {
	staged := f.stageFor(payload.OwnerKey)
	bag := staged.providerState.Edit(payload.ProviderRef, false)
	if !lifecycle.AnchoredStateCurrent(payload, bag.View()) {
		return nil
	}
	if err := f.consumeCommands(1); err != nil {
		return err
	}
	lifecycle.ClearAnchoredTerminal(payload, bag)
	f.reResolveStagedAttributesTwoPass(planbundle.CompiledAbility{})
	f.recordEvidenceLazy("provider_target_state_expired", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "provider_target_state_expired", Ref: payload.ProviderRef,
			Data: map[string]interface{}{"owner": payload.OwnerKey, "target": payload.TargetKey, "stateKey": payload.AnchorStateKey, "expectedExpireAt": payload.ExpectedExpireAt}}
	})
	return nil
}

func (r *lifecycleTickExecution) PeriodicBoundary(first bool) bool {
	s := (*Engine)(r)
	if first {
		s.currentEventCommands = 0
		if s.loop.Stopped() || s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0 {
			s.checkDeathStopReason()
			return false
		}
		return true
	}
	s.checkDeathStopReason()
	return !s.loop.Stopped()
}

func (r *lifecycleTickExecution) PeriodicParticipantsAlive() bool {
	s := (*Engine)(r)
	basic := s.actions.BasicAttack()
	return basic == nil || !(s.combatantHp(basic.Plan().Source) <= 0 || s.combatantHp(basic.Plan().Target) <= 0)
}

func (r *lifecycleTickExecution) PeriodicCooldownBlocked(owner, ref string) bool {
	_, blocked := (*Engine)(r).cooldownGate(owner, ref)
	return blocked
}

func (r *lifecycleTickExecution) PeriodicConditionBlocked(source, target string, ability planbundle.CompiledAbility, ref string) (bool, *model.EngineError) {
	return (*Engine)(r).castConditionBlocked(source, target, ability, ref)
}

func (r *lifecycleTickExecution) RunPeriodicFrame(invocation lifecycle.TickInvocation) *model.EngineError {
	s := (*Engine)(r)
	var frame Frame
	s.initExecutionFrame(&frame, invocation.Source, invocation.Target, invocation.AbilityRef)
	frame.strictReads = invocation.StrictReads
	frame.ownerCombatantKey, frame.ownerProviderRef = invocation.Owner, invocation.Instance.ProviderRef
	if invocation.BindActivation {
		frame.providerDefinitionRef = invocation.DefinitionRef
		activatedAt := invocation.ActivatedAt
		frame.providerActivatedAtMs = &activatedAt
		frame.damageOwnerKey = invocation.Source
	}
	frame.castInstanceID, frame.castOrigin = s.mintCastInstanceID(), invocation.Ability.CastOrigin
	if err := frame.stageLifecycleCostCooldown(invocation.Ability, invocation.Owner); err != nil {
		return err
	}
	if err := frame.executeOperations(invocation.Ability, invocation.Operations); err != nil {
		return err
	}
	if invocation.HasNext {
		next := invocation.Next
		frame.pendingProviderTick = &pendingFrameProviderTick{at: next.At, owner: next.Owner, provider: next.Provider, intervalMs: next.Interval, expireAt: next.ExpireAt, activatedAt: next.ActivatedAt}
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	return frame.dispatchPendingEvents()
}

func (r *lifecycleTickExecution) RecordPeriodicTick(owner string, instance effectpkg.Provider) {
	s := (*Engine)(r)
	if !s.detailedOutput() {
		s.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindProviderTick})
		return
	}
	s.recordEvidence(model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: model.EvidenceKindProviderTick, Ref: instance.ProviderRef,
		Message: "provider tick executed", Data: map[string]interface{}{"combatantKey": owner, "providerRef": instance.ProviderRef, "definitionRef": instance.DefinitionRef}})
}

func (r *lifecycleTickExecution) EnqueuePeriodicTick(request lifecycle.ProviderTickRequest) {
	(*Engine)(r).enqueueProviderTickAt(request.At, request.Owner, request.Provider, request.Interval, request.ExpireAt, request.ActivatedAt)
}

func (r *lifecycleTimingRequests) RemainingTimingSlots() int {
	return (*Frame)(r).remainingTimingSlots()
}

func (r *lifecycleTimingRequests) StageStateExpiry(at int64, payload effectpkg.ExpiryPayload) {
	frame := (*Frame)(r)
	frame.pendingStateExpiry = append(frame.pendingStateExpiry, pendingFrameStateExpiry{at: at, payload: payload})
}

func (r *lifecycleTimingRequests) StageAnchoredTick(at int64, payload effectpkg.AnchoredPayload) {
	frame := (*Frame)(r)
	frame.pendingAnchoredTicks = append(frame.pendingAnchoredTicks, pendingFrameAnchoredTick{at: at, payload: payload})
}

func (r *lifecycleAnchoredExecution) AnchoredCooldownBlocked(owner, abilityRef string) bool {
	_, blocked := (*Engine)(r).cooldownGate(owner, abilityRef)
	return blocked
}

func (r *lifecycleAnchoredExecution) AnchoredConditionBlocked(source, target string, ability planbundle.CompiledAbility, ref string) (bool, *model.EngineError) {
	return (*Engine)(r).castConditionBlocked(source, target, ability, ref)
}

func (r *lifecycleAnchoredExecution) RunAnchoredFrame(invocation lifecycle.AnchoredInvocation) (bool, *model.EngineError) {
	s := (*Engine)(r)
	payload := invocation.Payload
	var frame Frame
	s.initExecutionFrame(&frame, invocation.Source, payload.TargetKey, invocation.AbilityRef)
	frame.ownerCombatantKey, frame.ownerProviderRef = payload.OwnerKey, payload.ProviderRef
	frame.castInstanceID, frame.castOrigin = s.mintCastInstanceID(), invocation.Ability.CastOrigin
	frame.strictReads = invocation.Phased
	if !invocation.Blocked {
		if !invocation.Phased {
			if err := frame.stageLifecycleCostCooldown(invocation.Ability, payload.OwnerKey); err != nil {
				return false, err
			}
		}
		if err := frame.executeOperations(invocation.Ability, invocation.Operations); err != nil {
			return false, err
		}
	}
	if invocation.Terminal {
		if invocation.Phased {
			if err := frame.stageTargetTimingClear(payload.OwnerKey, payload.ProviderRef, payload.TargetKey, payload.AnchorStateKey, payload.TimingSlot, payload.Generation, payload.ExpectedExpireAt); err != nil {
				return false, err
			}
		} else {
			if err := frame.stageAnchoredTerminalExpiry(payload); err != nil {
				return false, err
			}
		}
	}
	frame.commit()
	if frame.fatal {
		return false, frame.fatalErr
	}
	return true, frame.dispatchPendingEvents()
}

func (r *lifecycleAnchoredExecution) ReleaseAnchoredHold(payload effectpkg.AnchoredPayload, settled bool) {
	s := (*Engine)(r)
	if owner, exists := s.combatants[payload.OwnerKey]; exists {
		bag := owner.providerState.Edit(payload.ProviderRef, false)
		lifecycle.ReleaseAnchoredHold(payload, bag, settled)
		s.combatants[payload.OwnerKey] = owner
	}
}

func (r *lifecycleAnchoredExecution) RecordAnchoredTick(invocation lifecycle.AnchoredInvocation) {
	s := (*Engine)(r)
	if !s.detailedOutput() {
		s.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindProviderTick})
		return
	}
	payload := invocation.Payload
	evidence := model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: model.EvidenceKindProviderTick, Ref: payload.ProviderRef,
		Data: map[string]interface{}{"combatantKey": payload.OwnerKey, "providerRef": payload.ProviderRef, "definitionRef": invocation.Instance.DefinitionRef,
			"targetKey": payload.TargetKey, "anchorStateKey": payload.AnchorStateKey, "generation": payload.Generation, "anchored": true}}
	if !invocation.Phased {
		evidence.Message = "anchored provider tick executed"
	}
	s.recordEvidence(evidence)
}

func (r *lifecycleExpiryRequests) EnqueueExpiry(at int64, payload effectpkg.ExpiryPayload) {
	(*Engine)(r).enqueueExpireCleanup(at, payload)
}

func (s *Engine) validatePermanentCharacterPeriod(provider planbundle.CompiledProvider) *model.EngineError {
	executor := s.lifecycleExecutor()
	return executor.ValidatePermanentPeriodDefinition(provider)
}

func (s *Engine) initPermanentCharacterPeriods() *model.EngineError {
	executor := s.lifecycleExecutor()
	external := len(s.req.SkillUses)+len(s.req.AttackStartFacts)+len(s.req.SkillHitFacts)+len(s.req.ProcessCommandFacts) != 0
	if err := executor.ValidatePermanentPeriodScene(s.loop.StartMs(), s.loop.DurationMs(), s.req.StopPolicy.StopOnTargetDeathOrDefault(), external, s.req.InitialSnapshot); err != nil {
		return err
	}
	if err := s.validateBasicAttackInitialSnapshot(); err != nil {
		return err
	}
	var owners [2]lifecycle.InitialPeriodicOwner
	for index, key := range [2]string{"source", "target"} {
		owners[index] = lifecycle.InitialPeriodicOwner{Owner: key, HP: s.combatantHp(key), Present: s.combatantExists(key)}
	}
	return executor.ValidatePermanentPeriods(s.req.InitialSnapshot, owners, s.req.DriverPlan.Entries, normalizeAbilityRef)
}

func (s *Engine) referencesPermanentCharacterPeriod(reference string) bool {
	executor := s.lifecycleExecutor()
	return executor.ReferencesPermanentPeriod(reference, normalizeAbilityRef)
}

func findTickAbility(provider planbundle.CompiledProvider, session planbundle.CompiledSession) (*planbundle.CompiledAbility, bool) {
	return lifecycle.FindTickAbility(provider, session)
}

func (s *Engine) providerTickSchedule(index uint16) (int64, int64, bool) {
	executor := s.lifecycleExecutor()
	return executor.TickSchedule(index)
}

func (s *Engine) scheduleInitialProviderTick(owner, reference string, index uint16, expiry int64, source string) {
	executor := s.lifecycleExecutor()
	basic := s.actions.BasicAttack()
	request, exists := executor.InitialTickRequest(owner, reference, index, expiry, s.loop.TimeMs(),
		s.loop.StartMs()+s.loop.DurationMs(), basic != nil, (*lifecycleTickExecution)(s).PeriodicParticipantsAlive())
	if exists {
		(*lifecycleTickExecution)(s).EnqueuePeriodicTick(request)
	}
}

func (s *Engine) seedProviderTicks() {
	owners := make([]string, 0, len(s.combatants))
	for key := range s.combatants {
		owners = append(owners, key)
	}
	sort.Strings(owners)
	for _, key := range owners {
		instances := s.combatants[key].instances.Providers().Snapshot()
		sort.SliceStable(instances, func(previous, next int) bool { return instances[previous].ProviderRef < instances[next].ProviderRef })
		for _, inst := range instances {
			if inst.ExpireAt > 0 && inst.ExpireAt <= s.loop.TimeMs() {
				continue
			}
			s.scheduleInitialProviderTick(key, inst.ProviderRef, inst.DefinitionIndex, inst.ExpireAt, inst.Source)
		}
	}
}

func (s *Engine) handleProviderTick(event scheduler.GenericEvent) *model.EngineError {
	reference := event.ProviderInstanceRef
	if reference.CombatantKey == "" || reference.ProviderRef == "" {
		return nil
	}
	actor, exists := s.combatants[reference.CombatantKey]
	if !exists {
		return nil
	}
	instance, _, exists := actor.instances.Providers().Find(reference.ProviderRef)
	if !exists || instance.Expired(s.loop.TimeMs()) {
		return nil
	}
	input := lifecycle.ProviderTickInput{Owner: reference.CombatantKey, Instance: instance, Now: s.loop.TimeMs(),
		StopAt: s.loop.StartMs() + s.loop.DurationMs(), ActivatedAt: event.ProviderTickActivatedAtMs}
	if basic := s.actions.BasicAttack(); basic != nil {
		input.HasBasicAttack, input.BasicAttack = true, basic.Plan()
	}
	if instance.ActivationUseRef != "" {
		use, exists := s.skillUses[instance.ActivationUseRef]
		process := s.processForUse(use)
		if exists && process != nil {
			input.HasAcceptedProcess, input.AcceptedSource, input.AcceptedTarget = true, process.Owner(), process.Target()
		}
	}
	executor := s.lifecycleExecutor()
	return executor.RunProviderTick(input, (*lifecycleTickExecution)(s))
}
