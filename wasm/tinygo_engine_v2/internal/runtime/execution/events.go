// 真实事件、伤害快照准备及跨功能固定派发次序。
package execution

import (
	"strings"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	contractpkg "tinygo_engine_v2/internal/runtime/contract"
)

type emittedEvent struct {
	eventType      string
	ref            string
	sourceKey      string
	targetKey      string
	types          []string
	snapshot       eventFormulaSnapshot
	castInstanceID uint64
	castOrigin     string
	skillHit       *frozenSkillHitContext
	hasUse         bool
	useKey         string
	useSource      string
	useSkillKey    string
}

type eventFormulaSnapshot = contractpkg.EventSnapshot

const (
	abilityTypeBasicAttack          = "ability/basic_attack"
	eventTypeAbilityStarted         = "event/ability_started"
	eventTypeBasicAttackHit         = "event/basic_attack_hit"
	eventTypeDamageDealt            = "event/damage_dealt"
	eventTypeDamageDealtBasicAttack = "event/damage_dealt/basic_attack"
	eventTypeDamageInstance         = "event/damage_instance"
	executeThresholdTypeRatio       = "current_hp_ratio"
	executeThresholdComparison      = "strict_below"
)

func (s *Engine) mintCastInstanceID() uint64 {
	s.nextCastInstanceID++
	return s.nextCastInstanceID
}

func attachCastProvenance(data map[string]interface{}, castInstanceID uint64, castOrigin string) {
	if castInstanceID > 0 {
		data["castInstanceId"] = float64(castInstanceID)
	}
	if castOrigin != "" {
		data["castOrigin"] = castOrigin
	}
}

func (f *Frame) appendCastOriginEventType(types []string) []string {
	if f == nil || f.castOrigin == "" || f.run == nil {
		return types
	}
	key := "cast_origin/" + f.castOrigin
	if _, ok := f.run.compiled.Types.Registry.LookupDomain("cast_origin", key); !ok {
		return types
	}
	for _, existing := range types {
		if existing == key {
			return types
		}
	}
	return append(types, key)
}

// buildDamageInstanceSnapshot freezes event.damage.* from current expected-crit settlement evidence.
// originalCritChance is p; effectiveCritChance is q. Weights follow min(p,q) / max(0,q-p).
//
// naturalBranchRawAmount is the unweighted natural critical branch after the same outgoing
// projection applied to the merged amount, before resistance — not the expected merged amount
// and not the probability-weighted crit part. normalPart/critPart remain expected weighted
// parts after outgoing projection and before resistance (already projected into critEv).
func buildDamageInstanceSnapshot(critEv frozenCritEvidence, baseRawAmount, preMitigationAmount, mitigatedAmount float64) formula.EventDamageSnapshot {
	snap := formula.EventDamageSnapshot{
		BaseRawAmount:       baseRawAmount,
		PreMitigationAmount: preMitigationAmount,
		MitigatedAmount:     mitigatedAmount,
	}
	if !critEv.Present || !critEv.Eligible {
		return snap
	}
	snap.OriginalCritChance = critEv.OriginalCritChance
	snap.EffectiveCritChance = critEv.ChanceEffective
	snap.ForcedCritWeight = critEv.ForcedWeight
	snap.NaturalCritWeight = critEv.NaturalWeight
	snap.ForcedCritMultiplier = critEv.ForcedMultiplier
	snap.NaturalCritMultiplier = critEv.NaturalMultiplier
	snap.NormalPart = critEv.NormalPart
	snap.CritPart = critEv.CritPart
	// Unweighted natural branch: base * naturalCritMultiplier * outgoingFactor.
	outgoingFactor := 0.0
	if critEv.CritAdjustedRawAmount != 0 {
		outgoingFactor = preMitigationAmount / critEv.CritAdjustedRawAmount
	}
	snap.NaturalBranchRawAmount = baseRawAmount * critEv.NaturalMultiplier * outgoingFactor
	return snap
}

func damageSnapshotEvidenceData(snap formula.EventDamageSnapshot) map[string]interface{} {
	data := map[string]interface{}{
		"baseRawAmount":          snap.BaseRawAmount,
		"preMitigationAmount":    snap.PreMitigationAmount,
		"mitigatedAmount":        snap.MitigatedAmount,
		"originalCritChance":     snap.OriginalCritChance,
		"effectiveCritChance":    snap.EffectiveCritChance,
		"forcedCritWeight":       snap.ForcedCritWeight,
		"naturalCritWeight":      snap.NaturalCritWeight,
		"forcedCritMultiplier":   snap.ForcedCritMultiplier,
		"naturalCritMultiplier":  snap.NaturalCritMultiplier,
		"normalPart":             snap.NormalPart,
		"critPart":               snap.CritPart,
		"naturalBranchRawAmount": snap.NaturalBranchRawAmount,
	}
	if snap.HasKilled {
		data["killed"] = snap.Killed
	}
	return data
}

func (f *Frame) abilityTypeKeys(ability planbundle.CompiledAbility) []string {
	if keys, exists := f.run.abilityTypeKeyCache[ability.TypeSet]; exists {
		return keys
	}
	keys := make([]string, 0)
	for i, key := range f.run.compiled.Types.Registry.Keys {
		if ability.TypeSet.Contains(typeset.TypeID(i)) {
			keys = append(keys, key)
		}
	}
	// 固定内存下只保留常见集合；额外集合继续按原目录求值。
	if len(f.run.abilityTypeKeyCache) >= 64 {
		return keys
	}
	if f.run.abilityTypeKeyCache == nil {
		f.run.abilityTypeKeyCache = make(map[typeset.TypeSet][]string)
	}
	f.run.abilityTypeKeyCache[ability.TypeSet] = keys
	return keys
}

// maybeQueueDamageInstanceEvent emits event/damage_instance once after a non-phantom damage
// operation completes settlement without structural failure (including zero amounts).
func (f *Frame) maybeQueueDamageInstanceEvent(
	cmd pipeline.Command,
	op planbundle.CompiledOperation,
	ability planbundle.CompiledAbility,
	critEv frozenCritEvidence,
	baseRawAmount, preMitigationAmount, mitigatedAmount, killed float64,
	beforeState []frozenDamageStateBefore, damageID uint64,
) {
	if f.copyableCollector != nil && f.copyableCollector.Phantom() {
		return
	}
	if _, ok := f.run.compiled.RuntimeTypes.DamageInstance.Lookup(); !ok {
		return
	}
	traits := append([]string(nil), op.Types...)
	snap := buildDamageInstanceSnapshot(critEv, baseRawAmount, preMitigationAmount, mitigatedAmount)
	snap.HasKilled, snap.Killed = true, killed
	eventTypes := []string{eventTypeDamageInstance}
	if cmd.DamageType != "" {
		if _, ok := f.run.compiled.Types.Registry.LookupDomain("damage", cmd.DamageType); ok {
			eventTypes = append(eventTypes, cmd.DamageType)
		}
	}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = append(eventTypes, traits...)
	eventTypes = f.appendCastOriginEventType(eventTypes)

	snapshot := f.captureEmitSnapshot(eventTypeDamageInstance, cmd.Source, cmd.Target)
	snapshot.HasDamageSnapshot = true
	snapshot.DamageSnapshot = snap
	snapshot.DamageTraits = traits
	snapshot.DamageTypeKey = cmd.DamageType
	if f.run.compiled.HasDamageStateBefore {
		snapshot.DamageStateBefore, snapshot.DamageID = beforeState, damageID
	}
	event := emittedEvent{
		eventType: eventTypeDamageInstance, ref: eventTypeDamageInstance,
		sourceKey: cmd.Source, targetKey: cmd.Target, types: eventTypes, snapshot: snapshot,
		castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
		useKey: f.processUseKey, useSource: f.processUseSource, useSkillKey: f.processUseSkillKey,
	}
	if event.useKey == "" && f.eventCtx != nil && f.eventCtx.HasUse {
		event.useKey, event.useSource, event.useSkillKey = f.eventCtx.UseKey, f.eventCtx.UseSource, f.eventCtx.UseSkillKey
	}
	event.hasUse = event.useKey != ""
	attachUseToSnapshot(&event)

	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		data := map[string]interface{}{
			"source":     cmd.Source,
			"target":     cmd.Target,
			"eventType":  eventTypeDamageInstance,
			"damageType": cmd.DamageType,
			"abilityRef": f.abilityRef,
			"phantom":    false,
			"traits":     traits,
			"damage":     damageSnapshotEvidenceData(snap),
		}
		if event.hasUse {
			data["useRef"], data["skillKey"] = event.useKey, event.useSkillKey
		}
		if f.run.compiled.HasDamageStateBefore {
			data["damageId"] = damageID
		}
		if op.Ref != "" {
			data["operationRef"] = op.Ref
		}
		attachCastProvenance(data, f.castInstanceID, f.castOrigin)
		return model.EvidenceItem{
			TimeMs: f.run.loop.TimeMs(),
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    eventTypeDamageInstance,
			Data:   data,
		}
	})
	f.pendingEvents = append(f.pendingEvents, event)
}

// maybeDispatchAbilityStartedEvent 在顶层成功 cast 后自动合成 event/ability_started（reserved 20205）。
// 条件：chainDepth==0，且 ability TypeSet 不含 ability/basic_attack（经 type catalog Lookup，禁止 abilityKey 启发式）。
// gate/cost/cooldown 失败不会进入本路径；listener child cast（chainDepth>0）不合成。
// TypeSet includes event/ability_started plus the source ability TypeSet keys.
func (f *Frame) maybeDispatchAbilityStartedEvent(ability planbundle.CompiledAbility) *model.EngineError {
	if f.chainDepth != 0 {
		return nil
	}
	if ability.HasSkillHit {
		if fact, ok := f.run.hits.Fact(f.driverEntryKey); ok && fact.UseRef != nil {
			if use := f.run.skillUses[*fact.UseRef]; use != nil && use.identity.ProcessReference().Present && use.identity.Source() == f.sourceKey && use.identity.SkillKey() == ability.SkillKey {
				return nil
			}
			for processSlot := 0; processSlot < f.run.actions.ProcessCount(); processSlot++ {
				p := f.run.actions.ProcessAt(processSlot)
				if p.UseKey() == *fact.UseRef && p.Owner() == f.sourceKey && p.SkillKey() == ability.SkillKey {
					return nil
				}
			}
		}
	}
	basicAttackID, ok := f.run.compiled.RuntimeTypes.BasicAttack.Lookup()
	if ability.IsBasicAttack || (ok && ability.TypeSet.Contains(basicAttackID)) {
		return nil
	}
	if _, ok := f.run.compiled.RuntimeTypes.AbilityStarted.Lookup(); !ok {
		// Event type absent from catalog: cannot participate in type-set matching; do not invent it.
		return nil
	}
	eventTypes := []string{eventTypeAbilityStarted}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = f.appendCastOriginEventType(eventTypes)
	useRef := f.processUseKey
	phase := f.processCastPhase
	if phase == "" {
		phase = "INITIAL"
	}
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		startedData := map[string]interface{}{
			"source":    f.sourceKey,
			"target":    f.targetKey,
			"eventType": eventTypeAbilityStarted,
		}
		if useRef != "" {
			startedData["useRef"], startedData["skillKey"], startedData["phaseKind"] = useRef, f.processUseSkillKey, phase
			startedData["owner"], startedData["providerRef"] = f.ownerCombatantKey, f.ownerProviderRef
			if action := f.run.skillActionForUse(useRef); action != nil {
				startedData["instructionKey"] = action.Plan().InstructionKey()
				startedData["providerDefinitionRef"] = action.Binding().ProviderDefinitionRef
			}
		}
		attachCastProvenance(startedData, f.castInstanceID, f.castOrigin)
		return model.EvidenceItem{
			TimeMs: f.run.loop.TimeMs(),
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    eventTypeAbilityStarted,
			Data:   startedData,
		}
	})
	ev := emittedEvent{
		eventType:      eventTypeAbilityStarted,
		ref:            eventTypeAbilityStarted,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          eventTypes,
		snapshot:       f.captureEmitSnapshot(eventTypeAbilityStarted, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
	}
	if useRef != "" {
		ev.hasUse, ev.useKey, ev.useSource, ev.useSkillKey = true, useRef, f.processUseSource, f.processUseSkillKey
		ev.snapshot.HasUse, ev.snapshot.UseKey, ev.snapshot.UseSource, ev.snapshot.UseSkillKey = true, useRef, f.processUseSource, f.processUseSkillKey
	}
	return f.run.dispatchListeners(ev, f.chainDepth+1)
}

func (f *Frame) maybeDispatchBasicAttackHit(ability planbundle.CompiledAbility) *model.EngineError {
	if f.chainDepth != 0 || f.driverEntryKey == "" {
		return nil
	}
	if !ability.IsBasicAttack || ability.HasSkillHit || ability.OperationCount == 0 {
		return nil
	}
	if strings.TrimSpace(ability.SkillKey) == "" {
		return nil
	}
	if _, isStart := f.run.attackStartFacts[f.driverEntryKey]; isStart {
		return nil
	}
	if _, ok := f.run.compiled.RuntimeTypes.BasicAttackHit.Lookup(); !ok {
		return nil
	}
	eventTypes := []string{model.EventTypeBasicAttackHit}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = f.appendCastOriginEventType(eventTypes)
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		data := map[string]interface{}{
			"source":    f.sourceKey,
			"target":    f.targetKey,
			"eventType": model.EventTypeBasicAttackHit,
		}
		attachCastProvenance(data, f.castInstanceID, f.castOrigin)
		if fact, ok := f.run.hits.Fact(f.driverEntryKey); ok && fact.UseRef != nil && *fact.UseRef != "" {
			if use, found := f.run.skillUses[*fact.UseRef]; found {
				data["useRef"], data["skillKey"] = use.identity.UseKey(), use.identity.SkillKey()
			}
		}
		return model.EvidenceItem{
			TimeMs: f.run.loop.TimeMs(),
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    model.EventTypeBasicAttackHit,
			Data:   data,
		}
	})
	ev := emittedEvent{
		eventType:      model.EventTypeBasicAttackHit,
		ref:            model.EventTypeBasicAttackHit,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          eventTypes,
		snapshot:       f.captureEmitSnapshot(model.EventTypeBasicAttackHit, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
	}
	if fact, ok := f.run.hits.Fact(f.driverEntryKey); ok && fact.UseRef != nil && *fact.UseRef != "" {
		if use, found := f.run.skillUses[*fact.UseRef]; found {
			ev.hasUse = true
			ev.useKey = use.identity.UseKey()
			ev.useSource = use.identity.Source()
			ev.useSkillKey = use.identity.SkillKey()
		}
	}
	return f.run.dispatchListeners(ev, f.chainDepth+1)
}

func (f *Frame) maybeDispatchBasicAttackStart(ability planbundle.CompiledAbility) *model.EngineError {
	if f.chainDepth != 0 || f.driverEntryKey == "" {
		return nil
	}
	fact, ok := f.run.attackStartFacts[f.driverEntryKey]
	if !ok {
		return nil
	}
	if !ability.IsBasicAttack || ability.HasSkillHit || ability.OperationCount != 0 {
		return f.run.skillHitErr(model.GenericErrUnknownRef, "attack start driver must be an empty-operations basic_attack ability", "attackStartFacts", f.driverEntryKey)
	}
	if _, ok := f.run.compiled.RuntimeTypes.BasicAttackStart.Lookup(); !ok {
		return f.run.skillHitErr(model.GenericErrUnknownTypeKey, "attack start requires event/basic_attack_start in typeCatalog", "attackStartFacts", f.driverEntryKey)
	}
	use, found := f.run.skillUses[fact.UseRef]
	if !found {
		return f.run.skillHitErr(model.GenericErrUnknownRef, "attack start useRef is missing", "attackStartFacts.useRef", fact.UseRef)
	}
	if err := f.captureAttackStartState(use); err != nil {
		return err
	}
	eventTypes := []string{model.EventTypeBasicAttackStart}
	eventTypes = append(eventTypes, f.abilityTypeKeys(ability)...)
	eventTypes = f.appendCastOriginEventType(eventTypes)
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		data := map[string]interface{}{
			"source":    f.sourceKey,
			"target":    f.targetKey,
			"eventType": model.EventTypeBasicAttackStart,
			"useRef":    fact.UseRef,
			"skillKey":  use.identity.SkillKey(),
		}
		attachCastProvenance(data, f.castInstanceID, f.castOrigin)
		return model.EvidenceItem{
			TimeMs: f.run.loop.TimeMs(),
			Kind:   model.EvidenceKindEmittedEvent,
			Ref:    model.EventTypeBasicAttackStart,
			Data:   data,
		}
	})
	ev := emittedEvent{
		eventType:      model.EventTypeBasicAttackStart,
		ref:            model.EventTypeBasicAttackStart,
		sourceKey:      f.sourceKey,
		targetKey:      f.targetKey,
		types:          eventTypes,
		snapshot:       f.captureEmitSnapshot(model.EventTypeBasicAttackStart, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID,
		castOrigin:     f.castOrigin,
		hasUse:         true,
		useKey:         use.identity.UseKey(),
		useSource:      use.identity.Source(),
		useSkillKey:    use.identity.SkillKey(),
	}
	return f.run.dispatchListeners(ev, f.chainDepth+1)
}

func (f *Frame) dispatchPendingEvents() *model.EngineError {
	if len(f.pendingEvents) == 0 {
		return nil
	}
	events := append([]emittedEvent(nil), f.pendingEvents...)
	f.pendingEvents = nil
	for _, ev := range events {
		if ev.skillHit != nil && (ev.eventType == model.EventTypeSkillHit || ev.eventType == model.EventTypeBasicAttackHit) {
			if err := f.run.dispatchSkillHitEvent(ev, f.chainDepth+1); err != nil {
				return err
			}
			continue
		}
		if err := f.run.dispatchListeners(ev, f.chainDepth+1); err != nil {
			return err
		}
	}
	return nil
}

func (f *Frame) captureEmitSnapshot(eventType, eventSourceKey, eventTargetKey string) eventFormulaSnapshot {
	src := f.stageFor(eventSourceKey)
	tgt := f.stageFor(eventTargetKey)
	entrySrcAttrs, entrySrcRes := f.entryMapsForKey(eventSourceKey)
	entryTgtAttrs, entryTgtRes := f.entryMapsForKey(eventTargetKey)
	snap := eventFormulaSnapshot{
		EventType:            eventType,
		EventSourceKey:       eventSourceKey,
		EventTargetKey:       eventTargetKey,
		EntrySourceAttrs:     entrySrcAttrs,
		EntryTargetAttrs:     entryTgtAttrs,
		EntrySourceResources: entrySrcRes,
		EntryTargetResources: entryTgtRes,
		SourceAttrs:          src.attributesView(),
		TargetAttrs:          tgt.attributesView(),
		SourceResources:      src.readonlyResources(),
		TargetResources:      tgt.readonlyResources(),
		CastInstanceID:       f.castInstanceID,
		CastOrigin:           f.castOrigin,
	}
	if f.eventCtx != nil && f.eventCtx.HasSkillHit {
		snap.HasSkillHit = true
		snap.SkillHit = f.eventCtx.SkillHit
	}
	return snap
}

func cloneEventSnapshot(src *eventFormulaSnapshot) *eventFormulaSnapshot {
	return contractpkg.CloneEventSnapshot(src)
}
