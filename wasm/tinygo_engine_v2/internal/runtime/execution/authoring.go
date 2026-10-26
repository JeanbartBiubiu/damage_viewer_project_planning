package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"math"
	"tinygo_engine_v2/internal/base/expression"
	"tinygo_engine_v2/internal/base/inputbinding"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (f *Frame) formulaError(id formula.GenericProgramID, message string) *model.EngineError {
	path := "formula"
	if int(id) < len(f.run.formulas.Programs) {
		path = f.run.formulas.Programs[id].Key
	}
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, path, f.abilityRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
}

func (f *Frame) evalResultFormula(id formula.GenericProgramID, ability planbundle.CompiledAbility, target string) (float64, *model.EngineError) {
	ctx := f.evalContext(ability)
	ctx.StrictReads = true
	ctx.TargetAttrs = f.stageFor(target).attributesView()
	ctx.TargetResources = f.stageFor(target).resourceView()
	value, err := f.run.formulas.EvalContext(id, &ctx)
	if err != nil {
		return 0, f.run.evalFormulaError(id, err, f.abilityRef)
	}
	return value, nil
}

func (f *Frame) configuredFormulaIssue(def planbundle.CompiledDamageTypeFormula, issue expression.ContractIssue) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrCode(issue.Code), issue.Code, def.Path+issue.Path, f.abilityRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
}

type configuredDefenseResult struct{ amount, factor float64 }

func (f *Frame) requireConfiguredDefense(damageType, operationPath string) (planbundle.CompiledDamageTypeFormula, *model.EngineError) {
	def, exists := f.run.compiled.DamageTypeFormulas[damageType]
	valid := exists && def.DamageType == damageType && def.Binding != nil && int(def.Program) < len(f.run.formulas.Programs)
	if valid {
		program := f.run.formulas.Programs[def.Program]
		valid = program.Authored != nil && program.Authored.Stats().Stages > 0 && len(program.Instr) == 0 && program.NamedBinding == nil
	}
	if !valid {
		return planbundle.CompiledDamageTypeFormula{}, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "damage operation requires a valid authored defense plan", operationPath+".damageType", damageType, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return def, nil
}

func (f *Frame) resolveConfiguredDefense(cmd command.Command, def planbundle.CompiledDamageTypeFormula) (configuredDefenseResult, *model.EngineError) {
	var sourceAttrs, targetAttrs attribute.Table
	if f.damageDefenseContext != nil {
		sourceAttrs, targetAttrs = f.damageDefenseContext.SourceAttrs, f.damageDefenseContext.TargetAttrs
	} else {
		// 当前帧读值使用进入帧时已完成派生的只读视图，不观察后续暂存写入。
		entry := func(key string) attribute.Table {
			if key == f.sourceKey {
				return f.entrySourceAttrs
			}
			if key == f.targetKey {
				return f.entryTargetAttrs
			}
			attrs, _ := f.snapshotCombatantMaps(key)
			return attrs
		}
		sourceAttrs, targetAttrs = entry(cmd.Source), entry(cmd.Target)
	}
	var valueBuffer [8]inputbinding.Value
	values := valueBuffer[:0]
	if len(def.Reads) <= len(valueBuffer) {
		values = valueBuffer[:len(def.Reads)]
	} else {
		values = make([]inputbinding.Value, len(def.Reads))
	}
	for i, read := range def.Reads {
		attrs := sourceAttrs
		if read.Object == "target" {
			attrs = targetAttrs
		}
		slot, exists := attrs.Lookup(read.AttributeKey)
		if !exists {
			continue
		}
		values[i] = inputbinding.Value{Base: inputbinding.Scalar{Value: slot.Base, Present: slot.HasBase()}, Total: inputbinding.Scalar{Value: slot.Resolved, Present: slot.HasResolved()}}
	}
	factor, err := f.run.formulas.EvalBound(def.Program, def.Binding, values)
	if err != nil {
		if authored, ok := err.(*formula.AuthoredEvaluationError); ok {
			return configuredDefenseResult{}, f.configuredFormulaIssue(def, authored.Issue)
		}
		return configuredDefenseResult{}, f.formulaError(def.Program, err.Error())
	}
	amount := cmd.Amount * factor
	if factor < 0 {
		result := f.configuredFormulaIssue(def, expression.ContractIssue{Code: "FORMULA_INVALID_OUTPUT"})
		result.Path, result.Message = def.OutputPath, "configured defense factor must be non-negative"
		return configuredDefenseResult{}, result
	}
	if math.IsNaN(factor) || math.IsInf(factor, 0) || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		result := f.configuredFormulaIssue(def, expression.ContractIssue{Code: "FORMULA_NON_FINITE"})
		result.Path = def.OutputPath
		return configuredDefenseResult{}, result
	}
	return configuredDefenseResult{amount: amount, factor: factor}, nil
}

func attachUseToSnapshot(ev *emittedEvent) {
	if ev == nil || !ev.hasUse {
		return
	}
	ev.snapshot.hasUse = true
	ev.snapshot.useKey, ev.snapshot.useSource, ev.snapshot.useSkillKey = ev.useKey, ev.useSource, ev.useSkillKey
}

func (f *Frame) applyLink(ability planbundle.CompiledAbility, op planbundle.CompiledOperation, target string) *model.EngineError {
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
	f.recordEvidenceLazy("link_application", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "link_application", Ref: op.Ref, Path: op.Path, Data: map[string]interface{}{
			"eventType": eventType, "source": f.sourceKey, "target": target, "useRef": useKey, "skillKey": useSkill, "count": count,
		}}
	})
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
		f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
			return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: eventType, Path: op.Path, Data: map[string]interface{}{
				"eventType": eventType, "source": f.sourceKey, "target": target, "useRef": useKey, "skillKey": useSkill,
				"LINK_INDEX": index, "LINK_COUNT": count,
			}}
		})
	}
	return nil
}

func (s *Engine) startProcessFromEvent(source, target, ref string, ability planbundle.CompiledAbility, depth int, event *eventFormulaSnapshot, driverKey string, collector *eventCopyableCollector) *model.EngineError {
	if driverKey != "" || depth < 1 || event == nil || event.eventType != model.EventTypeBasicAttackStart || !event.hasUse || ability.ProcessControl.Action != "INITIAL" || !ability.IsBasicAttack {
		return s.processErr("abilityRef", "event-bound INITIAL requires a real basic_attack_start listener context", ref)
	}
	parsed, ok := planbundle.ParseAbilityRef(ref)
	use, exists := s.skillUses[event.useKey]
	if !ok || !exists || parsed.Combatant != source || event.eventSourceKey != source || event.eventTargetKey != target || event.useSource != source || event.useSkillKey != ability.SkillKey || use.identity.Source() != source || use.identity.SkillKey() != ability.SkillKey {
		return s.processErr("processControl.useRefFromEvent", "native attack and process must share the real source, target, skill and use", ref)
	}
	control := ability.ProcessControl
	def := &s.compiled.Providers[ability.ProviderIndex].Processes[control.ProcessIndex]
	if !s.processMounted(source, parsed.ProviderRef, ability.ProviderIndex) {
		return s.processErr("processControl.processKey", "event-bound process requires its live mounted provider", ref)
	}
	entry := model.DriverEntry{EntryKey: model.EventTypeBasicAttackStart + "/" + event.useKey, AbilityRef: ref, Source: source, Target: target, FirstAtMs: s.loop.TimeMs()}
	var mountKey string
	for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
		current := s.actions.ProcessAt(processSlot)
		if current.UseKey() == event.useKey {
			return s.processErr("processControl.useRefFromEvent", "one native attack use cannot start another process instance", event.useKey)
		}
		if current.Status() != "active" {
			continue
		}
		if mountKey == "" {
			mountKey = actionpkg.ProcessMountKey(source, parsed.ProviderRef, def.ProcessKey)
		}
		if current.MountKey() == mountKey {
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

func (d copyableDamageFrozen) entryResourcesForCombatant(key string) model.ResourceView {
	if key == d.eventTargetKey {
		return d.entryTargetResources
	}
	if key == d.eventSourceKey {
		return d.entrySourceResources
	}
	if d.entryTargetResources.Len() > 0 {
		return d.entryTargetResources
	}
	return d.entrySourceResources
}

func (f *Frame) requireAttackProcess(ability planbundle.CompiledAbility, skill, use string) *model.EngineError {
	parsed, _ := planbundle.ParseAbilityRef(f.abilityRef)
	for _, def := range f.run.compiled.Providers[ability.ProviderIndex].Processes {
		if def.SkillKey != skill || def.InitialAbilityIndex < 0 || !f.run.compiled.Abilities[def.InitialAbilityIndex].ProcessControl.UseRefFromEvent {
			continue
		}
		for processSlot := 0; processSlot < f.run.actions.ProcessCount(); processSlot++ {
			instance := f.run.actions.ProcessAt(processSlot)
			if instance.UseKey() == use && instance.Owner() == f.sourceKey && instance.Target() == f.targetKey && instance.ProviderRef() == parsed.ProviderRef && instance.ProcessKey() == def.ProcessKey && instance.SkillKey() == skill && instance.StartedAtMs() <= f.run.loop.TimeMs() && instance.Status() != "failed" {
				return nil
			}
		}
		return f.run.processErr("skillHitFacts["+f.driverEntryKey+"].useRef", "basic attack hit requires its successful native-start-bound process with the same source, target, skill and use", use)
	}
	return nil
}
