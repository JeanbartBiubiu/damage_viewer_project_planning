package execution

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/scheduler"
)

const (
	defaultConditionRecheckMs = 100
	minConditionRecheckMs     = 10
	maxConditionRecheckMs     = 1000
)

func (s *Engine) compileDriverConditions() *model.EngineError {
	n := len(s.req.DriverPlan.Entries)
	s.actions.InitDriverEntries(n)
	var compileErrors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		err := model.NewEngineError(model.GenericPhaseRun, code, message)
		err.Path = path
		err.Ref = ref
		err.SchemaHash = s.compiled.SchemaHash
		err.RulesHash = s.compiled.RulesHash
		err.SessionID = s.req.SessionID
		compileErrors = append(compileErrors, err)
	}
	for i, entry := range s.req.DriverPlan.Entries {
		refs := s.formulas.DeclaredReferences()
		skill := ""
		source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
		target, _ := s.resolveDriverCombatantKey(entry.Target, source)
		if ref, ok := s.compiled.AbilityRefIndex[normalizeAbilityRef(entry.AbilityRef, source, target)]; ok {
			skill = s.compiled.Abilities[ref.AbilityIndex].SkillKey
		}
		if entry.Condition != nil {
			path := "driverPlan.entries[" + entry.EntryKey + "].condition"
			instr := formula.CompileGenericFormula(*entry.Condition, path, refs, map[string]bool{}, addError)
			if !s.formulas.ValidDeclaredScope(instr, skill) {
				addError(model.GenericErrUnknownRef, path, "driver common formula requires its actual ability skill", entry.AbilityRef)
				continue
			}
			for _, in := range s.formulas.InstructionDependencies(instr, nil) {
				if in.ReadKind == formula.ReadEventProviderTargetStateBefore {
					addError(model.GenericErrFormulaTypeError, path, "damage state before is unavailable in driver conditions", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProviderTargetStateRemainingMs {
					addError(model.GenericErrFormulaTypeError, path, "target state remaining time is unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadReceivedLinkedShieldAbsorbed {
					addError(model.GenericErrFormulaTypeError, path, "linked shield absorption is unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadAuthoredRuntimeParameter || in.ReadKind == formula.ReadAuthoredAbilityParameter || in.ReadKind == formula.ReadUseChargeDuration || in.ReadKind == formula.ReadProcessStartState {
					addError(model.GenericErrFormulaTypeError, path, "runtime parameters unavailable in driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProcessActualCost {
					addError(model.GenericErrFormulaTypeError, path, "process actual costs are unavailable in a driver condition", in.ReadKey)
				}
				if in.ReadKind == formula.ReadUseAmmoBefore {
					addError(model.GenericErrFormulaTypeError, path, "use.ammo.before is unavailable before native attack admission", "use.ammo.before")
				}
			}
			if len(instr) > 0 {
				key := "run:" + path
				id, err := s.formulas.Register(formula.GenericProgram{Key: key, Instr: instr})
				if err != nil {
					addError(model.GenericErrFormulaTypeError, path, err.Error(), key)
				} else {
					s.actions.SetDriverCondition(i, id)
				}
			}
		}
		if entry.Repeat == nil {
			continue
		}
		repeatPath := "driverPlan.entries[" + entry.EntryKey + "].repeat"
		hasFixed := entry.Repeat.IntervalMs > 0
		hasFormula := entry.Repeat.IntervalFormula != nil
		switch {
		case hasFixed && hasFormula:
			addError(model.GenericErrFormulaTypeError, repeatPath, "repeat must have exactly one of intervalMs or intervalFormula", entry.AbilityRef)
		case !hasFixed && !hasFormula:
			addError(model.GenericErrMissingRequiredField, repeatPath, "repeat requires intervalMs or intervalFormula", entry.AbilityRef)
		case hasFormula:
			path := repeatPath + ".intervalFormula"
			instr := formula.CompileGenericFormula(*entry.Repeat.IntervalFormula, path, refs, map[string]bool{}, addError)
			if !s.formulas.ValidDeclaredScope(instr, skill) {
				addError(model.GenericErrUnknownRef, path, "driver common formula requires its actual ability skill", entry.AbilityRef)
				continue
			}
			for _, in := range s.formulas.InstructionDependencies(instr, nil) {
				if in.ReadKind == formula.ReadEventProviderTargetStateBefore {
					addError(model.GenericErrFormulaTypeError, path, "damage state before is unavailable in driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProviderTargetStateRemainingMs {
					addError(model.GenericErrFormulaTypeError, path, "target state remaining time is unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadReceivedLinkedShieldAbsorbed {
					addError(model.GenericErrFormulaTypeError, path, "linked shield absorption is unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadAuthoredRuntimeParameter || in.ReadKind == formula.ReadAuthoredAbilityParameter || in.ReadKind == formula.ReadUseChargeDuration || in.ReadKind == formula.ReadProcessStartState {
					addError(model.GenericErrFormulaTypeError, path, "runtime parameters unavailable in driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadProcessActualCost {
					addError(model.GenericErrFormulaTypeError, path, "process actual costs are unavailable in a driver repeat", in.ReadKey)
				}
				if in.ReadKind == formula.ReadUseAmmoBefore {
					addError(model.GenericErrFormulaTypeError, path, "use.ammo.before is unavailable in a driver repeat", "use.ammo.before")
				}
			}
			if len(instr) == 0 {
				continue
			}
			key := "run:" + path
			id, err := s.formulas.Register(formula.GenericProgram{Key: key, Instr: instr})
			if err != nil {
				addError(model.GenericErrFormulaTypeError, path, err.Error(), key)
			} else {
				s.actions.SetDriverInterval(i, id)
			}
		}
	}
	if len(compileErrors) > 0 {
		return &compileErrors[0]
	}
	return nil
}

func normalizeConditionRecheckInterval(raw int64) int64 {
	if raw <= 0 {
		return defaultConditionRecheckMs
	}
	if raw < minConditionRecheckMs {
		return minConditionRecheckMs
	}
	if raw > maxConditionRecheckMs {
		return maxConditionRecheckMs
	}
	return raw
}

func (s *Engine) seedDriverAttempts() {
	for i, entry := range s.req.DriverPlan.Entries {
		s.enqueueAttempt(entry.FirstAtMs, i, 0)
		// Fixed interval: pre-schedule future attempts. Dynamic (intervalFormula): seed first only.
		if entry.Repeat != nil && entry.Repeat.IntervalMs > 0 {
			maxAttempts := entry.Repeat.MaxAttempts
			if maxAttempts <= 0 {
				maxAttempts = s.estimateRepeatAttempts(entry)
			}
			for n := 1; n < maxAttempts; n++ {
				at := entry.FirstAtMs + int64(n)*entry.Repeat.IntervalMs
				if at > s.loop.StartMs()+s.loop.DurationMs() {
					break
				}
				s.enqueueAttempt(at, i, n)
			}
		}
	}
}

func (s *Engine) estimateRepeatAttempts(entry model.DriverEntry) int {
	if entry.Repeat == nil || entry.Repeat.IntervalMs <= 0 {
		return 1
	}
	span := s.loop.DurationMs()
	if span <= 0 {
		return 1
	}
	firstOffset := entry.FirstAtMs - s.loop.StartMs()
	if firstOffset < 0 {
		firstOffset = 0
	}
	remaining := span - firstOffset
	if remaining < 0 {
		return 1
	}
	count := int(remaining/entry.Repeat.IntervalMs) + 1
	if count > s.budget.MaxEvents {
		count = s.budget.MaxEvents
	}
	return count
}

func (s *Engine) enqueueAttempt(timeMs int64, entryIndex, attemptIndex int) {
	entry := s.req.DriverPlan.Entries[entryIndex]
	s.pushCombatEvent(scheduler.GenericEvent{
		TimeMs:           timeMs,
		Category:         scheduler.GenericCategoryAbilityAttempt,
		Priority:         int16(entry.Priority),
		Kind:             scheduler.GenericEventAbilityAttempt,
		DriverEntryIndex: entryIndex,
		AttemptIndex:     attemptIndex,
	})
}

func (s *Engine) handleAbilityAttempt(ev scheduler.GenericEvent) *model.EngineError {
	entry := s.req.DriverPlan.Entries[ev.DriverEntryIndex]
	waitOwner, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	waitTarget, _ := s.resolveDriverCombatantKey(entry.Target, waitOwner)
	waitOwner = actionpkg.AbilityCooldownOwner(waitOwner, normalizeAbilityRef(entry.AbilityRef, waitOwner, waitTarget))
	waitKey := whileReadyCooldownWaitKey(waitOwner, entry.EntryKey)
	if ev.CooldownWaitVersion != 0 {
		c := s.combatants[waitOwner]
		if !c.cooldowns.WaitCurrent(waitKey, ev.TimeMs, ev.CooldownWaitVersion) {
			return nil
		}
	}
	if s.isWhileReady(entry) {
		c := s.combatants[waitOwner]
		c.cooldowns = c.cooldowns.Clone()
		c.cooldowns.CancelWait(waitKey)
		s.combatants[waitOwner] = c
	}
	if !isNativeHitFollowUp(entry.EntryKey) {
		s.actions.RecordDriverAttempt(ev.DriverEntryIndex)
	}

	sourceKey, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, _ := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	statRef := normalizeAbilityRef(entry.AbilityRef, sourceKey, targetKey)
	s.report.EnsureAbility(statRef)
	if !isNativeHitFollowUp(entry.EntryKey) {
		s.report.Attempt(statRef)
	}

	if ability, _, ok := s.lookupDriverAbility(entry); ok && ability.ProcessControl != nil {
		return s.handleProcessCommand(entry, ev.DriverEntryIndex, ability, statRef)
	}
	gate := s.checkAttemptGate(entry, ev.DriverEntryIndex)
	if gate.err != nil {
		return gate.err
	}
	if gate.skipped {
		s.report.Skip(statRef)
		s.recordAttemptSkipped(entry, gate.reason, gate.readyAtMs)
		if s.isWhileReady(entry) {
			nextAt := s.nextWhileReadyTime(entry, gate)
			if nextAt > s.loop.TimeMs() {
				if gate.reason == model.AttemptSkipCooldownNotReady {
					s.enqueueCooldownAttempt(nextAt, ev.DriverEntryIndex, ev.AttemptIndex+1, actionpkg.AbilityCooldownOwner(sourceKey, statRef), statRef)
				} else {
					s.enqueueAttempt(nextAt, ev.DriverEntryIndex, ev.AttemptIndex+1)
				}
			}
			// whileReady owns reschedule; do not also schedule dynamic interval.
			return nil
		}
		return s.scheduleDynamicRepeatNext(entry, ev.DriverEntryIndex, ev.AttemptIndex)
	}
	if err := s.executeAbilityCast(entry); err != nil {
		return err
	}
	return s.scheduleDynamicRepeatNext(entry, ev.DriverEntryIndex, ev.AttemptIndex)
}

// scheduleDynamicRepeatNext 在 dynamic DriverRepeat 每次 attempt 处理后按最新 attrs/resources 排下一发。
func (s *Engine) scheduleDynamicRepeatNext(entry model.DriverEntry, entryIndex, attemptIndex int) *model.EngineError {
	if entry.Repeat == nil || entry.Repeat.IntervalFormula == nil {
		return nil
	}
	programID, present := s.actions.DriverInterval(entryIndex)
	if !present {
		return nil
	}
	nextAttempt := attemptIndex + 1
	if entry.Repeat.MaxAttempts > 0 && nextAttempt >= entry.Repeat.MaxAttempts {
		return nil
	}

	sourceKey, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, _ := s.resolveDriverCombatantKey(entry.Target, sourceKey)
	src := s.combatants[sourceKey]
	tgt := s.combatants[targetKey]
	evalCtx := formula.GenericEvalContext{
		SourceAttrs:     src.attributesView(),
		TargetAttrs:     tgt.attributesView(),
		SourceResources: src.resourceView(),
		TargetResources: tgt.resourceView(),
	}
	path := "driverPlan.entries[" + entry.EntryKey + "].repeat.intervalFormula"
	raw, evalErr := s.formulas.EvalContext(programID, &evalCtx)
	if evalErr != nil {
		return s.evalFormulaError(programID, evalErr, entry.AbilityRef)
	}
	if math.IsNaN(raw) || math.IsInf(raw, 0) || raw <= 0 {
		err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "intervalFormula must evaluate to a finite value > 0")
		err.Path = path
		err.Ref = entry.AbilityRef
		err.SchemaHash = s.compiled.SchemaHash
		err.RulesHash = s.compiled.RulesHash
		err.SessionID = s.req.SessionID
		return &err
	}
	intervalMs := int64(math.Round(raw))
	if intervalMs < 1 {
		intervalMs = 1
	}
	nextAt := s.loop.TimeMs() + intervalMs
	if nextAt > s.loop.StartMs()+s.loop.DurationMs() {
		return nil
	}
	s.enqueueAttempt(nextAt, entryIndex, nextAttempt)
	return nil
}

func (s *Engine) isWhileReady(entry model.DriverEntry) bool {
	switch v := entry.WhileReady.(type) {
	case bool:
		return v
	case nil:
		return false
	default:
		return true
	}
}

func (s *Engine) recordAttemptSkipped(entry model.DriverEntry, reason model.AttemptSkipReason, readyAtMs int64) {
	s.recordEvidenceLazy(model.EvidenceKindAttemptSkipped, func() model.EvidenceItem {
		data := map[string]interface{}{
			"entryKey":   entry.EntryKey,
			"source":     entry.Source,
			"target":     entry.Target,
			"skipReason": string(reason),
		}
		if readyAtMs > 0 {
			data["readyAtMs"] = readyAtMs
		}
		return model.EvidenceItem{
			TimeMs:  s.loop.TimeMs(),
			Kind:    model.EvidenceKindAttemptSkipped,
			Ref:     entry.AbilityRef,
			Path:    "driverPlan.entries[" + entry.EntryKey + "]",
			Message: string(reason),
			Data:    data,
		}
	})
}
