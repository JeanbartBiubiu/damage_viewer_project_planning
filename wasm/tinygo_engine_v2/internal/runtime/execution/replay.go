package execution

import (
	"sort"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/scheduler"
)

// copyableDamageFrozen 冻结一次 CopyableOnHit damage 的 replay 输入（不做公式重算 / 不二次 crit 结算）。
type copyableDamageFrozen struct {
	rawAmount            float64
	damageType           string
	sourceKey            string
	targetKey            string
	providerRef          string
	originRef            string // abilityRef 或 listener:<key>
	operationRef         string // op.Ref；有则写入 evidence / replayedFrom
	entrySourceAttrs     attribute.Table
	entryTargetAttrs     attribute.Table
	entrySourceResources model.ResourceView
	entryTargetResources model.ResourceView
	eventSourceKey       string
	eventTargetKey       string
	crit                 frozenCritEvidence
	ability              planbundle.CompiledAbility
	operation            planbundle.CompiledOperation
	castInstanceID       uint64
	castOrigin           string
	consumedFirstPerCast map[string]bool
	ownerCombatantKey    string
	eventCtx             *eventFormulaSnapshot
}

// deferredRepeatRequest 登记 phantom replay 门槛；不立即执行。
type deferredRepeatRequest struct {
	ownerCombatantKey string
	ownerProviderRef  string
	triggerStateKey   string
	threshold         float64
	repeatCount       int
	repeatScope       string
	repeatTag         string
	repeatDelayMs     int
}

// triggeredContinuationPayload 是延迟 phantom replay 的 run-local 冻结载荷。
type triggeredContinuationPayload struct {
	damages      []copyableDamageFrozen
	req          deferredRepeatRequest
	commandCount int
}

// eventCopyableCollector 是单次真实 emitted event 的局部 collector（嵌套 emit 独立实例）。
type eventCopyableCollector struct {
	damages      []copyableDamageFrozen
	repeats      []deferredRepeatRequest
	phantomDepth int
	commandCount int
	reservation  *pendingUseReservation
}

func (f *Frame) registerDeferredRepeat(op planbundle.CompiledOperation) *model.EngineError {
	collector := f.copyableCollector
	if collector == nil || collector.phantomDepth > 0 {
		return nil
	}
	if op.RepeatScope != model.RepeatScopeCopyableOnHit {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "repeat requires repeatScope="+model.RepeatScopeCopyableOnHit, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if f.ownerProviderRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "repeat requires owning provider context", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	repeatCount := op.RepeatCount
	if repeatCount <= 0 {
		repeatCount = 1
	}
	f.pendingRepeats = append(f.pendingRepeats, deferredRepeatRequest{
		ownerCombatantKey: f.providerOwnerKey(),
		ownerProviderRef:  f.ownerProviderRef,
		triggerStateKey:   op.TriggerStateKey,
		threshold:         op.Threshold,
		repeatCount:       repeatCount,
		repeatScope:       op.RepeatScope,
		repeatTag:         op.RepeatTag,
		repeatDelayMs:     op.RepeatDelayMs,
	})
	return nil
}

func (f *Frame) maybeCollectCopyableDamage(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, rawAmount float64, targetKey string, critEv frozenCritEvidence) *model.EngineError {
	collector := f.copyableCollector
	if collector == nil || collector.phantomDepth > 0 || !op.CopyableOnHit || op.Operation != "damage" {
		return nil
	}
	if f.commandsSpent() > f.run.budget.MaxCommandsPerEvent {
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	if f.consumedFirstPerCast == nil {
		f.consumedFirstPerCast = map[string]bool{}
	}
	rec := copyableDamageFrozen{
		rawAmount:            rawAmount,
		damageType:           op.DamageType,
		sourceKey:            f.sourceKey,
		targetKey:            targetKey,
		providerRef:          f.ownerProviderRef,
		originRef:            f.abilityRef,
		operationRef:         op.Ref,
		crit:                 critEv,
		ability:              ability,
		operation:            op,
		castInstanceID:       f.castInstanceID,
		castOrigin:           f.castOrigin,
		consumedFirstPerCast: f.consumedFirstPerCast,
		ownerCombatantKey:    f.providerOwnerKey(),
		eventCtx:             cloneEventSnapshot(f.eventCtx),
	}
	if f.eventCtx != nil {
		rec.eventSourceKey = f.eventCtx.eventSourceKey
		rec.eventTargetKey = f.eventCtx.eventTargetKey
		rec.entrySourceAttrs = f.eventCtx.entrySourceAttrs
		rec.entryTargetAttrs = f.eventCtx.entryTargetAttrs
		rec.entrySourceResources = f.eventCtx.entrySourceResources
		rec.entryTargetResources = f.eventCtx.entryTargetResources
	} else {
		rec.eventSourceKey = f.sourceKey
		rec.eventTargetKey = f.targetKey
		rec.entrySourceAttrs = f.entrySourceAttrs
		rec.entryTargetAttrs = f.entryTargetAttrs
		rec.entrySourceResources = f.entrySourceResources
		rec.entryTargetResources = f.entryTargetResources
	}
	f.pendingCopyable = append(f.pendingCopyable, rec)
	if len(collector.damages)+len(collector.repeats)+len(f.pendingCopyable)+len(f.pendingRepeats) > f.run.budget.MaxCommandsPerEvent {
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	return nil
}

// sortCopyableDamagesStable 按 provenance 升序稳定排序；完全相同项保持原始相对顺序。
// 键：providerRef、originRef、sourceKey、targetKey、damageType。不依赖 map 遍历。
func sortCopyableDamagesStable(damages []copyableDamageFrozen) {
	sort.SliceStable(damages, func(i, j int) bool {
		a, b := damages[i], damages[j]
		if a.providerRef != b.providerRef {
			return a.providerRef < b.providerRef
		}
		if a.originRef != b.originRef {
			return a.originRef < b.originRef
		}
		if a.sourceKey != b.sourceKey {
			return a.sourceKey < b.sourceKey
		}
		if a.targetKey != b.targetKey {
			return a.targetKey < b.targetKey
		}
		return a.damageType < b.damageType
	})
}

// sortDeferredRepeatsStable 按 provenance 升序稳定排序；完全相同项保持原始相对顺序。
// 键：ownerProviderRef、ownerCombatantKey、repeatTag、triggerStateKey、repeatScope、threshold、repeatCount。
func sortDeferredRepeatsStable(repeats []deferredRepeatRequest) {
	sort.SliceStable(repeats, func(i, j int) bool {
		a, b := repeats[i], repeats[j]
		if a.ownerProviderRef != b.ownerProviderRef {
			return a.ownerProviderRef < b.ownerProviderRef
		}
		if a.ownerCombatantKey != b.ownerCombatantKey {
			return a.ownerCombatantKey < b.ownerCombatantKey
		}
		if a.repeatTag != b.repeatTag {
			return a.repeatTag < b.repeatTag
		}
		if a.triggerStateKey != b.triggerStateKey {
			return a.triggerStateKey < b.triggerStateKey
		}
		if a.repeatScope != b.repeatScope {
			return a.repeatScope < b.repeatScope
		}
		if a.threshold != b.threshold {
			return a.threshold < b.threshold
		}
		return a.repeatCount < b.repeatCount
	})
}

// sortEventCopyableProvenanceStable 对 collector 内切片原地稳定排序（测试 helper）。
// flush 路径必须使用 cloneAndSortEventCopyableProvenance，避免破坏 collector 原始 append 顺序。
func sortEventCopyableProvenanceStable(collector *eventCopyableCollector) {
	if collector == nil {
		return
	}
	sortCopyableDamagesStable(collector.damages)
	sortDeferredRepeatsStable(collector.repeats)
}

// cloneAndSortEventCopyableProvenance 复制 damages/repeats 后做稳定 provenance 排序。
// 返回的切片供 phantom replay 遍历；不修改 collector 原切片。
func cloneAndSortEventCopyableProvenance(collector *eventCopyableCollector) (damages []copyableDamageFrozen, repeats []deferredRepeatRequest) {
	if collector == nil {
		return nil, nil
	}
	damages = append([]copyableDamageFrozen(nil), collector.damages...)
	repeats = append([]deferredRepeatRequest(nil), collector.repeats...)
	sortCopyableDamagesStable(damages)
	sortDeferredRepeatsStable(repeats)
	return damages, repeats
}

func (s *Engine) flushDeferredPhantomReplay(collector *eventCopyableCollector) *model.EngineError {
	if collector == nil || len(collector.repeats) == 0 || collector.phantomDepth > 0 {
		return nil
	}
	damages, repeats := cloneAndSortEventCopyableProvenance(collector)
	immediate := make([]deferredRepeatRequest, 0, len(repeats))
	delayed := make([]deferredRepeatRequest, 0, len(repeats))
	for _, req := range repeats {
		if req.repeatDelayMs > 0 {
			delayed = append(delayed, req)
		} else {
			immediate = append(immediate, req)
		}
	}

	collector.phantomDepth = 1
	defer func() { collector.phantomDepth = 0 }()

	for _, req := range immediate {
		if req.repeatScope != model.RepeatScopeCopyableOnHit {
			continue
		}
		if !s.repeatTriggerMet(req) {
			continue
		}
		times := req.repeatCount
		if times <= 0 {
			times = 1
		}
		for i := 0; i < times; i++ {
			for _, dmg := range damages {
				if err := s.applyPhantomCopyableDamage(collector, dmg, req.repeatTag); err != nil {
					return err
				}
			}
		}
	}
	s.checkDeathStopReason()

	if !s.loop.Stopped() {
		for _, req := range delayed {
			if req.repeatScope != model.RepeatScopeCopyableOnHit {
				continue
			}
			if !s.repeatTriggerMet(req) {
				continue
			}
			if err := s.enqueueTriggeredContinuation(damages, req); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Engine) enqueueTriggeredContinuation(damages []copyableDamageFrozen, req deferredRepeatRequest) *model.EngineError {
	s.nextContinuationID++
	id := s.nextContinuationID
	frozen := append([]copyableDamageFrozen(nil), damages...)
	s.continuations[id] = &triggeredContinuationPayload{
		damages:      frozen,
		req:          req,
		commandCount: 0,
	}
	code := s.loop.Queue().Push(scheduler.GenericEvent{
		TimeMs:         s.loop.TimeMs() + int64(req.repeatDelayMs),
		Category:       scheduler.GenericCategoryTriggeredContinuation,
		Kind:           scheduler.GenericEventTriggeredContinuation,
		ContinuationID: id,
	})
	if code != model.ErrOK {
		delete(s.continuations, id)
		return s.budgetError(model.BudgetCauseMaxQueueEvents, "triggered continuation queue overflow")
	}
	return nil
}

func (s *Engine) handleTriggeredContinuation(ev scheduler.GenericEvent) *model.EngineError {
	payload, ok := s.continuations[ev.ContinuationID]
	if !ok || payload == nil {
		return nil
	}
	delete(s.continuations, ev.ContinuationID)
	if s.loop.Stopped() {
		return nil
	}
	req := payload.req
	if req.repeatScope != model.RepeatScopeCopyableOnHit {
		return nil
	}
	collector := &eventCopyableCollector{
		phantomDepth: 1,
		commandCount: payload.commandCount,
	}
	times := req.repeatCount
	if times <= 0 {
		times = 1
	}
	for i := 0; i < times; i++ {
		for _, dmg := range payload.damages {
			if err := s.applyPhantomCopyableDamage(collector, dmg, req.repeatTag); err != nil {
				return err
			}
		}
	}
	s.checkDeathStopReason()
	return nil
}

func (s *Engine) repeatTriggerMet(req deferredRepeatRequest) bool {
	if req.ownerCombatantKey == "" || req.ownerProviderRef == "" || req.triggerStateKey == "" {
		return false
	}
	c, ok := s.combatants[req.ownerCombatantKey]
	if !ok {
		return false
	}
	bag := c.providerState.PrepareRead(req.ownerProviderRef, false,
		s.resolveProviderStateFieldDefs(req.ownerCombatantKey, req.ownerProviderRef, c.instances.Providers()), s.loop.TimeMs(), effectpkg.ReadOptions{Cooldowns: c.cooldowns.View(), OwnerKey: req.ownerCombatantKey})
	if !bag.Present() {
		return false
	}
	s.combatants[req.ownerCombatantKey] = c
	value, ok := bag.State().Lookup(req.triggerStateKey)
	if !ok {
		return false
	}
	return value >= req.threshold
}

func (s *Engine) applyPhantomCopyableDamage(collector *eventCopyableCollector, dmg copyableDamageFrozen, repeatTag string) *model.EngineError {
	if collector == nil {
		return nil
	}
	if _, ok := s.combatants[dmg.targetKey]; !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
	}
	var frameStorage Frame
	s.initExecutionFrame(&frameStorage, dmg.sourceKey, dmg.targetKey, dmg.originRef)
	frame := &frameStorage
	frame.copyableCollector = collector
	if err := frame.bumpCommandBudget(); err != nil {
		return err
	}
	frame.ownerCombatantKey = dmg.ownerCombatantKey
	frame.ownerProviderRef = dmg.providerRef
	frame.castInstanceID, frame.castOrigin = dmg.castInstanceID, dmg.castOrigin
	frame.consumedFirstPerCast = dmg.consumedFirstPerCast
	frame.eventCtx = cloneEventSnapshot(dmg.eventCtx)
	targetStage := frame.stageFor(dmg.targetKey)
	viewAttributes, viewShields := targetStage.attributesView(), targetStage.instances.Shields()
	cmd := pipeline.Command{
		Kind:       pipeline.KindDamage,
		Source:     dmg.sourceKey,
		Target:     dmg.targetKey,
		Amount:     dmg.rawAmount,
		DamageType: dmg.damageType,
	}
	// 共同防御读取原事件入口完整冻结视图；提交仍使用当前护盾和生命。
	frame.damageDefenseContext = &formula.GenericEvalContext{
		SourceAttrs:     dmg.entryAttrsForCombatant(dmg.sourceKey),
		TargetAttrs:     dmg.entryAttrsForCombatant(dmg.targetKey),
		SourceResources: dmg.entryResourcesForCombatant(dmg.sourceKey),
		TargetResources: dmg.entryResourcesForCombatant(dmg.targetKey),
		StrictReads:     true,
	}
	// 暴击分支已冻结在 dmg.crit；本笔 modifiers 只登记重新执行的伤害修正。
	numbers, err := frame.resolveDamageNumbers(cmd, dmg.operation, dmg.crit, dmg.ability, nil)
	if err != nil {
		return err
	}
	var replayedFrom map[string]interface{}
	if s.detailedOutput() {
		replayedFrom = stableDamageReplayedFrom(dmg.providerRef, dmg.originRef, dmg.operationRef)
	}
	if numbers.failClosed {
		frame.recordGenericDamageEvidence(genericDamageEvidence{
			source: dmg.sourceKey, target: dmg.targetKey, damageType: dmg.damageType,
			rawAmount: numbers.rawAmount, mitigatedAmount: 0,
			providerRef: dmg.providerRef, abilityRef: dmg.originRef, operationRef: dmg.operationRef, operationPath: dmg.operation.Path,
			phantom: true, repeatTag: repeatTag,
			replayedFrom: replayedFrom,
			crit:         numbers.crit, modifiers: numbers.modifiers, traits: dmg.operation.Types,
		})
		frame.commit()
		return frame.fatalErr
	}
	targetHPBefore := attribute.ReadHP(viewAttributes)
	outcome, nextAttributes, nextShields := viewShields.ApplyDamage(numbers.rawAmount, numbers.mitigatedAmount, viewAttributes, s.loop.TimeMs(), false)
	sourceHealthBefore, sourceHasHealth := frame.stageFor(dmg.sourceKey).attributesView().Lookup("hp")
	result := pipeline.CommandResult{Kind: cmd.Kind, Applied: outcome.HPDamage > 0 || outcome.ShieldAbsorbed > 0, Amount: outcome.MitigatedAmount}
	damageID := frame.nextDamageID()

	targetStage.setAttributes(nextAttributes)
	targetStage.instances.SetShields(nextShields)
	if err := frame.settleDepletedShieldAttributes(); err != nil {
		return err
	}
	frame.reResolveStagedAttributesTwoPass(dmg.ability)
	frame.damageDealt += result.Amount
	frame.recordDamage(dmg.sourceKey, dmg.targetKey, result.Amount)
	damageRecordIndex := len(frame.pendingDamage)
	frame.recordGenericDamageEvidence(genericDamageEvidence{
		source:                    dmg.sourceKey,
		target:                    dmg.targetKey,
		damageType:                dmg.damageType,
		rawAmount:                 numbers.rawAmount,
		mitigatedAmount:           result.Amount,
		providerRef:               dmg.providerRef,
		abilityRef:                dmg.originRef,
		operationRef:              dmg.operationRef,
		operationPath:             dmg.operation.Path,
		hpBefore:                  targetHPBefore,
		hpAfter:                   attribute.ReadHP(nextAttributes),
		hasSourceHp:               sourceHasHealth,
		sourceHpBefore:            sourceHealthBefore.Current,
		phantom:                   true,
		repeatTag:                 repeatTag,
		replayedFrom:              replayedFrom,
		crit:                      numbers.crit,
		modifiers:                 numbers.modifiers,
		traits:                    dmg.operation.Types,
		castInstanceID:            dmg.castInstanceID,
		castOrigin:                dmg.castOrigin,
		damageID:                  damageID,
		outcome:                   &outcome,
		hasPostResistanceEvidence: true,
		resistanceFactor:          numbers.resistanceFactor,
		normalPartPostResistance:  numbers.normalPartPostResistance,
		critPartPostResistance:    numbers.critPartPostResistance,
	})
	if err := frame.settleDamageVamp(cmd, dmg.operation, dmg.ability, outcome, targetHPBefore, damageID, true); err != nil {
		return err
	}
	frame.pendingDamage[damageRecordIndex].sourceHpAfter = frame.stageFor(dmg.sourceKey).attributesView().At("hp").Current
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	return nil
}

func (d copyableDamageFrozen) entryAttrsForCombatant(combatantKey string) attribute.Table {
	// entry_* 对应原始 emitted event 的 source/target；damage target 可能经 owner remap。
	// 优先按 damage target 与 frame event keys 对齐；若无匹配则回退 entryTarget（常见 on-hit 受害方）。
	if combatantKey == d.eventTargetKey {
		return d.entryTargetAttrs
	}
	if combatantKey == d.eventSourceKey {
		return d.entrySourceAttrs
	}
	if d.entryTargetAttrs.Len() > 0 {
		return d.entryTargetAttrs
	}
	return d.entrySourceAttrs
}
