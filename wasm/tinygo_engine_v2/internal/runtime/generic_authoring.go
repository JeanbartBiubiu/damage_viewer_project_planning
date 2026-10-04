package runtime

import (
	"math"

	"tinygo_engine_v2/internal/command"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

func (f *executionFrame) formulaError(id formula.GenericProgramID, message string) *model.EngineError {
	path := "formula"
	if int(id) < len(f.run.compiled.Formulas.Programs) {
		path = f.run.compiled.Formulas.Programs[id].Key
	}
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, path, f.abilityRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
}

func (f *executionFrame) evalResultFormula(id formula.GenericProgramID, ability compilebundle.CompiledAbility, target string) (float64, *model.EngineError) {
	ctx := f.evalContext(ability)
	ctx.StrictReads = true
	ctx.TargetAttrs = f.stageFor(target).attributes
	ctx.TargetResources = f.stageFor(target).resources
	value, err := f.run.compiled.Formulas.Eval(id, ctx)
	if err != nil {
		return 0, f.formulaError(id, err.Error())
	}
	return value, nil
}

func (f *executionFrame) resolveConfiguredDefense(cmd command.Command, targetAttrs, sourceAttrs map[string]model.AttributeSlotDef) (pipeline.MitigationResult, *model.EngineError) {
	def := f.run.compiled.DamageTypeFormulas[cmd.DamageType]
	ctx := formula.GenericEvalContext{
		SourceAttrs: sourceAttrs, TargetAttrs: targetAttrs,
		SourceResources: f.stageFor(cmd.Source).resources, TargetResources: f.stageFor(cmd.Target).resources,
		StrictReads: true,
	}
	if f.damageDefenseContext != nil {
		ctx = *f.damageDefenseContext
	}
	ctx.StrictReads = true
	for stage, id := range def.Programs {
		ctx.DamageStageCount = stage
		value, err := f.run.compiled.Formulas.Eval(id, ctx)
		if err != nil {
			return pipeline.MitigationResult{}, f.formulaError(id, err.Error())
		}
		ctx.DamageStages[stage] = value
	}
	factor := ctx.DamageStages[4]
	amount := cmd.Amount * factor
	if factor < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return pipeline.MitigationResult{}, f.formulaError(def.Programs[4], "configured resistance factor must be non-negative and produce finite damage")
	}
	return pipeline.MitigationResult{
		Amount: amount, ResistanceBeforePenetration: ctx.DamageStages[0], PenetrationPercent: ctx.DamageStages[1],
		PenetrationFlat: ctx.DamageStages[2], EffectiveResistance: ctx.DamageStages[3], ResistanceFactor: factor,
	}, nil
}

func attachUseToSnapshot(ev *emittedEvent) {
	if ev == nil || !ev.hasUse {
		return
	}
	ev.snapshot.hasUse = true
	ev.snapshot.useKey, ev.snapshot.useSource, ev.snapshot.useSkillKey = ev.useKey, ev.useSource, ev.useSkillKey
}

func (f *executionFrame) applyLink(ability compilebundle.CompiledAbility, op compilebundle.CompiledOperation, target string) *model.EngineError {
	useKey, useSource, useSkill := f.processUseKey, f.processUseSource, f.processUseSkillKey
	if useKey == "" && f.eventCtx != nil && f.eventCtx.hasUse {
		useKey, useSource, useSkill = f.eventCtx.useKey, f.eventCtx.useSource, f.eventCtx.useSkillKey
	}
	if useKey == "" || useSource != f.sourceKey || useSkill == "" {
		return f.run.processErr(op.Path, "link application requires the real originating source, skill and use identity", useKey)
	}
	value, err := f.evalResultFormula(op.AmountProgram, ability, target)
	if err != nil {
		return err
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || math.Trunc(value) != value || value > 9007199254740991 {
		return f.formulaError(op.AmountProgram, "link count must be a finite non-negative safe integer")
	}
	remaining := f.run.budget.MaxCommandsPerEvent - f.commandsSpent()
	if value > float64(remaining) {
		return f.consumeCommands(remaining + 1)
	}
	if value > float64(f.run.budget.MaxEvents) {
		return f.run.budgetError(model.BudgetCauseMaxEvents, "link application event budget exceeded")
	}
	count := int(value)
	if err := f.consumeCommands(count); err != nil {
		return err
	}
	eventType := model.EventTypeHitLinkApplied
	if op.Operation == model.OperationKindApplyAttackLink {
		eventType = model.EventTypeAttackLinkApplied
	}
	f.recordEvidence(model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "link_application", Ref: op.Ref, Path: op.Path, Data: map[string]interface{}{
		"eventType": eventType, "source": f.sourceKey, "target": target, "useRef": useKey, "skillKey": useSkill, "count": count,
	}})
	for index := 1; index <= count; index++ {
		eventTypes := append([]string{eventType}, f.abilityTypeKeys(ability)...)
		snapshot := f.captureEmitSnapshot(eventType, f.sourceKey, target)
		snapshot.hasLink, snapshot.linkIndex, snapshot.linkCount = true, index, count
		ev := emittedEvent{
			eventType: eventType, ref: op.Ref, sourceKey: f.sourceKey, targetKey: target,
			types: f.appendCastOriginEventType(eventTypes), snapshot: snapshot,
			castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
			hasUse: true, useKey: useKey, useSource: useSource, useSkillKey: useSkill,
		}
		attachUseToSnapshot(&ev)
		f.pendingEvents = append(f.pendingEvents, ev)
		f.recordEvidence(model.EvidenceItem{TimeMs: f.run.nowMs, Kind: model.EvidenceKindEmittedEvent, Ref: eventType, Path: op.Path, Data: map[string]interface{}{
			"eventType": eventType, "source": f.sourceKey, "target": target, "useRef": useKey, "skillKey": useSkill,
			"LINK_INDEX": index, "LINK_COUNT": count,
		}})
	}
	return nil
}

func (s *genericRunState) startProcessFromEvent(source, target, ref string, ability compilebundle.CompiledAbility, depth int, event *eventFormulaSnapshot, driverKey string, collector *eventCopyableCollector) *model.EngineError {
	if driverKey != "" || depth < 1 || event == nil || event.eventType != model.EventTypeBasicAttackStart || !event.hasUse || ability.ProcessControl.Action != "INITIAL" || !ability.IsBasicAttack {
		return s.processErr("abilityRef", "event-bound INITIAL requires a real basic_attack_start listener context", ref)
	}
	parsed, ok := compilebundle.ParseAbilityRef(ref)
	use, exists := s.skillUses[event.useKey]
	if !ok || !exists || parsed.Combatant != source || event.eventSourceKey != source || event.eventTargetKey != target || event.useSource != source || event.useSkillKey != ability.SkillKey || use.source != source || use.skillKey != ability.SkillKey {
		return s.processErr("processControl.useRefFromEvent", "native attack and process must share the real source, target, skill and use", ref)
	}
	control := ability.ProcessControl
	def := &s.compiled.Providers[ability.ProviderIndex].Processes[control.ProcessIndex]
	if !s.processMounted(source, parsed.ProviderRef, ability.ProviderIndex) {
		return s.processErr("processControl.processKey", "event-bound process requires its live mounted provider", ref)
	}
	entry := model.DriverEntry{EntryKey: model.EventTypeBasicAttackStart + "/" + event.useKey, AbilityRef: ref, Source: source, Target: target, FirstAtMs: s.nowMs}
	for _, current := range s.processInstances {
		if current.UseKey == event.useKey {
			return s.processErr("processControl.useRefFromEvent", "one native attack use cannot start another process instance", event.useKey)
		}
		if current.Status == "active" && processMountKey(current.Owner, current.ProviderRef, current.ProcessKey) == processMountKey(source, parsed.ProviderRef, def.ProcessKey) {
			return s.rejectProcessUse(entry, ref, event.useKey, "process_already_active")
		}
	}
	if s.combatantHasHp(source) && s.combatantHp(source) <= 0 {
		return s.rejectProcessUse(entry, ref, event.useKey, "source_dead")
	}
	if _, blocked := s.cooldownGate(source, ref); blocked {
		return s.rejectProcessUse(entry, ref, event.useKey, "cooldown_not_ready")
	}
	return s.startProcess(entry, -1, source, target, parsed.ProviderRef, ref, ability, def, event.useKey, depth, collector)
}

func (d copyableDamageFrozen) entryResourcesForCombatant(key string) map[string]model.ResourceSlotDef {
	if key == d.eventTargetKey {
		return d.entryTargetResources
	}
	if key == d.eventSourceKey {
		return d.entrySourceResources
	}
	if len(d.entryTargetResources) > 0 {
		return d.entryTargetResources
	}
	return d.entrySourceResources
}

func (f *executionFrame) requireAttackProcess(ability compilebundle.CompiledAbility, skill, use string) *model.EngineError {
	parsed, _ := compilebundle.ParseAbilityRef(f.abilityRef)
	for _, def := range f.run.compiled.Providers[ability.ProviderIndex].Processes {
		if def.SkillKey != skill || def.InitialAbilityIndex < 0 || !f.run.compiled.Abilities[def.InitialAbilityIndex].ProcessControl.UseRefFromEvent {
			continue
		}
		for _, instance := range f.run.processInstances {
			if instance.UseKey == use && instance.Owner == f.sourceKey && instance.Target == f.targetKey && instance.ProviderRef == parsed.ProviderRef && instance.ProcessKey == def.ProcessKey && instance.SkillKey == skill && instance.StartedAtMs <= f.run.nowMs && instance.Status != "failed" {
				return nil
			}
		}
		return f.run.processErr("skillHitFacts["+f.driverEntryKey+"].useRef", "basic attack hit requires its successful native-start-bound process with the same source, target, skill and use", use)
	}
	return nil
}
