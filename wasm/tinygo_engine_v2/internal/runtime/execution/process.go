package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"math"
	"sort"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

func (s *Engine) processErr(path, message, ref string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (s *Engine) processMounted(owner, provider string, definition uint16) bool {
	c, ok := s.combatants[owner]
	if !ok {
		return false
	}
	for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		p := instanceValues.At(instanceIndex)
		if p.ProviderRef == provider && p.DefinitionRef == s.compiled.Providers[definition].ProviderKey && (p.ExpireAt == 0 || p.ExpireAt > s.loop.TimeMs()) {
			return true
		}
	}
	return false
}

func (s *Engine) handleProcessCommand(entry model.DriverEntry, entryIndex int, controlAbility planbundle.CompiledAbility, resolvedRef string) *model.EngineError {
	control := controlAbility.ProcessControl
	fact := s.actions.ProcessFact(entry.EntryKey)
	source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	target, targetAvailable := s.resolveDriverCombatantKey(entry.Target, source)
	if control.RequireExplicitSelfTarget != nil && *control.RequireExplicitSelfTarget && (entry.Target == "" || !targetAvailable || target != source) {
		return s.rejectProcess(entry, "explicit_self_target_required")
	}
	parsed, _ := planbundle.ParseAbilityRef(resolvedRef)
	p := &s.compiled.Providers[controlAbility.ProviderIndex].Processes[control.ProcessIndex]
	var instance *actionpkg.ProcessView
	for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
		current := s.actions.ProcessAt(processSlot)
		if current.UseKey() == fact.UseRef {
			instance = current
			break
		}
	}
	if !s.processMounted(source, parsed.ProviderRef, controlAbility.ProviderIndex) {
		return s.rejectProcess(entry, "provider_unavailable")
	}
	if control.Action == "INITIAL" {
		if instance != nil {
			return s.rejectProcess(entry, "use_already_started")
		}
		var mountKey string
		var replaced *actionpkg.ProcessView
		for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
			current := s.actions.ProcessAt(processSlot)
			if current.Status() != "active" {
				continue
			}
			if mountKey == "" {
				mountKey = actionpkg.ProcessMountKey(source, parsed.ProviderRef, p.ProcessKey)
			}
			if current.MountKey() == mountKey {
				if actionpkg.IsEmpoweredProcess(p) && p.Steps[0].MaximumAttackCount == 0 && current.HasEmpoweredAbility() && current.StepExecutionIndex() == 0 {
					replaced = current
				} else {
					return s.rejectProcess(entry, "process_already_active")
				}
			}
		}
		if s.combatantHasHp(source) && s.combatantHp(source) <= 0 {
			return s.rejectProcess(entry, "source_dead")
		}
		if s.hasSkillPlan() && s.actionOccupied(source) {
			return s.rejectProcess(entry, "action_occupied")
		}
		if _, blocked := s.cooldownGate(source, resolvedRef); blocked {
			return s.rejectProcess(entry, "cooldown_not_ready")
		}
		if actionpkg.IsEmpoweredProcess(p) {
			return s.startEmpoweredProcess(entry, entryIndex, source, target, parsed.ProviderRef, resolvedRef, controlAbility, p, fact.UseRef, replaced)
		}
		return s.startProcess(entry, entryIndex, source, target, parsed.ProviderRef, resolvedRef, controlAbility, p, fact.UseRef, 0, nil)
	}
	if instance == nil {
		return s.rejectProcess(entry, "process_not_started")
	}
	if instance.Owner() != source || instance.ProviderRef() != parsed.ProviderRef || instance.ProcessKey() != p.ProcessKey || instance.Target() != target {
		return s.rejectProcess(entry, "process_identity_mismatch")
	}
	if instance.Status() != "active" {
		return s.rejectProcess(entry, "process_already_finished")
	}
	if instance.HasExpiry() && s.loop.TimeMs() >= instance.Expiry() {
		return s.rejectProcess(entry, "process_expired")
	}
	if control.StepKey != "" && control.StepKey != instance.StepKey() {
		return s.rejectProcess(entry, "wrong_step")
	}
	if control.Action == "RECAST" {
		if s.combatantHasHp(source) && s.combatantHp(source) <= 0 {
			return s.rejectProcess(entry, "source_dead")
		}
		for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
			other := s.actions.ProcessAt(processSlot)
			if other != instance && other.OccupiesAction(source) {
				return s.rejectProcess(entry, "action_occupied")
			}
		}
	}
	var conditionFrame Frame
	s.initProcessFrame(&conditionFrame, instance)
	allowed, conditionErr := s.evalProcessCondition(entryIndex, &conditionFrame, controlAbility)
	if conditionErr != nil {
		return conditionErr
	}
	if !allowed {
		return s.rejectProcess(entry, "condition_false")
	}
	if control.Action == "RECAST" || control.Action == "CHARGE_RELEASE" {
		if s.loop.TimeMs() < instance.AdvanceAtMs() {
			return s.rejectProcess(entry, "advance_too_early")
		}
		step := instance.Definition().Steps[instance.StepIndex()]
		if (control.Action == "RECAST" && step.StepType != "RECAST") || (control.Action == "CHARGE_RELEASE" && step.StepType != "CHARGE") {
			return s.rejectProcess(entry, "wrong_step")
		}
		if control.Action == "RECAST" {
			return s.acceptRecast(entry, instance, controlAbility, resolvedRef)
		}
		var frameStorage Frame
		s.initProcessFrame(&frameStorage, instance)
		f := &frameStorage
		f.countCastOnCommit, f.castStatRef = true, resolvedRef
		f.recordProcess(f.pendingProcess, "process_use", control.Action)
		if err := s.applyProcessMoment(instance, f, "STEP_EXECUTION", ""); err != nil {
			return err
		}
		if err := s.commitProcessFrame(instance, f); err != nil {
			return err
		}
		if err := s.resolveSkillActionMoment(instance, "STEP_EXECUTION"); err != nil {
			return err
		}
		return s.completeProcessStep(instance)
	}
	// Cancel/interruption are explicit successful actions, never merely a request event.
	if control.Action == "INTERRUPT" && control.FailureReason == "SOURCE_DIED" && (!s.combatantHasHp(source) || s.combatantHp(source) > 0) {
		return s.rejectProcess(entry, "source_not_dead")
	}
	return s.finishProcessWithCast(instance, "failed", control.FailureReason, resolvedRef)
}

func (s *Engine) countProcessCast(ref string) {
	s.abilityCastCount++
	s.report.Cast(ref)
}

func (s *Engine) rejectProcess(entry model.DriverEntry, reason string) *model.EngineError {
	_, ref, _ := s.lookupDriverAbility(entry)
	return s.rejectProcessUse(entry, ref, s.actions.ProcessFact(entry.EntryKey).UseRef, reason)
}

func (s *Engine) rejectProcessUse(entry model.DriverEntry, ref, use, reason string) *model.EngineError {
	if s.actions.CurrentAction() != nil && entry.EntryKey == s.actions.CurrentAction().Plan().InstructionKey() {
		s.actions.Reject(s.actions.CurrentAction(), reason)
	}
	s.report.Skip(ref)
	s.recordEvidenceLazy("process_rejected", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "process_rejected", Ref: ref, Path: "driverPlan.entries[" + entry.EntryKey + "]", Data: map[string]interface{}{"entryKey": entry.EntryKey, "useKey": use, "reason": reason}}
	})
	return nil
}

func (s *Engine) initProcessFrame(f *Frame, p *actionpkg.ProcessView) {
	s.initExecutionFrame(f, p.Owner(), p.Target(), p.AbilityRef())
	f.processChanges = actionpkg.StageProcess(p)
	f.pendingProcess, f.processOriginal = f.processChanges.View(), p
	f.ownerCombatantKey = p.Owner()
	f.ownerProviderRef = p.ProviderRef()
	f.strictReads = true
	f.castInstanceID = p.CastID()
	f.castOrigin = p.Ability().CastOrigin
	f.chainDepth, f.copyableCollector = s.processExecution(p.UseKey())
	f.processActualCosts = f.pendingProcess.Costs()
	f.processUseKey, f.processUseSkillKey, f.processUseSource = p.UseKey(), p.SkillKey(), p.Owner()
	if p.CastUseKey() != "" {
		f.processUseKey = p.CastUseKey()
	}
}

// Condition false is represented by a normal process rejection; formula failures remain errors.
func (s *Engine) evalProcessCondition(entryIndex int, f *Frame, ability planbundle.CompiledAbility) (bool, *model.EngineError) {
	ids := []formula.GenericProgramID{}
	if id, present := s.actions.DriverCondition(entryIndex); present {
		ids = append(ids, id)
	}
	if ability.HasCastCondition {
		ids = append(ids, ability.CastConditionProgram)
	}
	for _, id := range ids {
		value, err := f.evalAmount(id, ability)
		if err != nil {
			return false, err
		}
		if value == 0 {
			return false, nil
		}
	}
	return true, nil
}

func (s *Engine) startProcess(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, depth int, collector *eventCopyableCollector) *model.EngineError {
	return s.startProcessReplacing(entry, entryIndex, owner, target, provider, ref, ability, definition, use, depth, collector, nil)
}

func (s *Engine) startProcessReplacing(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, depth int, collector *eventCopyableCollector, replaced *actionpkg.ProcessView) *model.EngineError {
	if planbundle.FiniteRecastProcess(definition) && !s.isBoundFiniteRecastInitial(entry, owner, target, provider, ref, ability, definition, use) {
		return s.processErr(definition.Path, "finite recast requires its current bound INITIAL skill plan", use)
	}
	if s.actions.ProcessCount() >= s.budget.MaxProcessInstances {
		err := s.budgetError(model.BudgetCauseMaxProcessInstances, "process instance budget exceeded")
		err.Path, err.Ref = "safetyBudget.maxProcessInstances", use
		return err
	}
	s.refreshProviderAwareAttributes(owner, target)
	p := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: owner, ProviderRef: provider, ProcessKey: definition.ProcessKey, SkillKey: definition.SkillKey, UseKey: use, Target: target, StartedAtMs: s.loop.TimeMs(), StepStartedAtMs: s.loop.TimeMs(), AdvanceAtMs: s.loop.TimeMs(), ActualCosts: map[string]float64{}, ActionOccupancies: []model.ProcessActionOccupancy{}, Status: "active"}, Definition: definition, Ability: ability, AbilityRef: ref, StepIndex: -1, CastUseKey: use})
	s.processExecutions.push(processExecutionContext{useKey: use, depth: depth, collector: collector})
	defer s.processExecutions.pop()
	var frameStorage Frame
	s.initProcessFrame(&frameStorage, p)
	f := &frameStorage
	f.processIsNew, f.countCastOnCommit = true, true
	if actionpkg.IsEmpoweredProcess(definition) {
		binding, found := s.empoweredBinding(owner, provider, definition.ProcessKey)
		if !found {
			return s.processErr(definition.Path, "empowered attack requires its actual compiled payload binding", use)
		}
		f.processChanges.BindEmpowered(binding.EmpoweredAbilityIndex, binding.ReplacesPrimary, binding.Slot)
		f.empowered = &empoweredFrame{}
	}
	allowed, err := s.evalProcessCondition(entryIndex, f, ability)
	if err != nil {
		return err
	}
	if !allowed {
		return s.rejectProcessUse(entry, ref, use, "condition_false")
	}
	if !ability.IsBasicAttack && s.compiled.Providers[ability.ProviderIndex].AmmoBinding != nil {
		ready, _, err := f.plannedAmmoReady(ability)
		if err != nil {
			return err
		}
		if !ready {
			return s.rejectProcessUse(entry, ref, use, "ammo_empty")
		}
	}
	// All expressions read the same pre-payment frame, and every row is checked before aggregation.
	totals := map[string]float64{}
	keys := []string{}
	for _, cost := range definition.Costs {
		amount, err := f.evalAmount(cost.AmountProgram, ability)
		if err != nil {
			return err
		}
		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
			return s.processErr(cost.Path, "process cost must be finite and non-negative", cost.ResourceKey)
		}
		if _, ok := totals[cost.ResourceKey]; !ok {
			keys = append(keys, cost.ResourceKey)
		}
		totals[cost.ResourceKey] += amount
		if math.IsInf(totals[cost.ResourceKey], 0) {
			return s.processErr(cost.Path, "process cost sum is not finite", cost.ResourceKey)
		}
	}
	for _, key := range keys {
		slot, ok := f.stageFor(owner).resourceView().Lookup(key)
		if !ok || math.IsNaN(slot.Current) || math.IsInf(slot.Current, 0) || slot.Current < 0 {
			return s.processErr("combatants."+owner+".resources."+key, "process cost requires an explicit finite resource", key)
		}
		if slot.Current < totals[key] {
			return s.rejectProcessUse(entry, ref, use, "resource_insufficient")
		}
	}
	for _, key := range keys {
		before := f.stageFor(owner).resourceView().At(key).Current
		if err := f.applyResourceChange(owner, key, -totals[key], ability); err != nil {
			return err
		}
		f.processChanges.SetActualCost(key, before-f.stageFor(owner).resourceView().At(key).Current)
	}
	f.processChanges.SetCast(s.mintCastInstanceID(), f.pendingProcess.CastUseKey())
	f.castInstanceID = f.pendingProcess.CastID()
	if replaced != nil {
		if err := s.stageEmpoweredFailure(f, replaced); err != nil {
			return err
		}
	}
	beforeDamage, beforeHealing := f.damageDealt, f.healingDone
	if err := s.applyProcessMoment(p, f, "PROCESS_START", ""); err != nil {
		return err
	}
	if err := f.captureProcessStartState(); err != nil {
		return err
	}
	if f.empowered != nil {
		if err := s.stageEmpoweredEntry(f); err != nil {
			return err
		}
		f.empowered.stats = append(f.empowered.stats, empoweredStat{ref, f.damageDealt - beforeDamage, f.healingDone - beforeHealing})
	}
	if err := s.commitProcessFrame(p, f); err != nil {
		return err
	}
	if p.Status() != "active" {
		return nil
	}
	if err := f.maybeDispatchAbilityStartedEvent(ability); err != nil {
		return err
	}
	if p.Status() != "active" {
		return nil
	}
	if p.HasEmpoweredAbility() {
		return nil
	}
	return s.enterProcessStep(p, 0)
}

func (s *Engine) applyProcessMoment(p *actionpkg.ProcessView, f *Frame, kind, reason string) *model.EngineError {
	p = f.pendingProcess
	f.processMomentKind = kind
	if kind == "STEP_EXECUTION" {
		if !f.processChanges.ExecuteStep(s.loop.TimeMs(), f.recastExecutionCommitted) {
			return s.processErr(p.Definition().Path, "process step execution has already committed", p.UseKey())
		}
		if p.HasRepeat() {
			if err := s.stageProcessRepeatExecution(f); err != nil {
				return err
			}
		}
	}
	if kind == "STEP_COMPLETE" && !f.processChanges.CompleteStep(s.loop.TimeMs()) {
		return s.processErr(p.Definition().Path, "process step completion has already committed", p.UseKey())
	}
	f.processCostReadable = kind == "PROCESS_COMPLETE" || kind == "PROCESS_FAILURE"
	if cd := p.Definition().Cooldown; cd != nil && !p.CooldownStarted() && actionpkg.MomentMatches(cd.StartMoment, kind, p.StepKey(), reason) {
		value, err := f.evalAmount(cd.DurationProgram, p.Ability())
		if err != nil {
			return err
		}
		factor, factorError := f.cooldownDurationFactor(p)
		if factorError != nil {
			return factorError
		}
		if math.IsNaN(factor) || math.IsInf(factor, 0) || factor <= 0 {
			return s.processErr(cd.Path+".durationMs", "cooldown duration factor must remain finite and positive", p.UseKey())
		}
		value *= factor
		if cd.RoundPositiveMs || factor != 1 {
			if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
				return f.formulaError(cd.DurationProgram, "process cooldown must be finite and positive before rounding")
			}
			value = math.Max(1, math.Round(value))
		}
		if action := s.actions.ActionForUse(p.UseKey()); action != nil && action.AutomaticRule() != nil && (math.IsNaN(value) || math.IsInf(value, 0) || value <= 0) {
			return f.formulaError(cd.DurationProgram, "automatic cooldown must be finite and strictly positive")
		}
		ready, ok := actionpkg.ProcessTimeAfter(s.loop.TimeMs(), value, !cd.RoundPositiveMs)
		if !ok {
			return f.formulaError(cd.DurationProgram, "invalid process cooldown duration or timestamp overflow")
		}
		if err := f.applyCooldownChange(p.Owner(), p.AbilityRef(), ready); err != nil {
			return err
		}
		f.stageFor(p.Owner()).writableCooldowns().CommitOrdinary(actionpkg.AbilityCooldownIdentity(p.Owner(), p.AbilityRef()), ready, s.loop.TimeMs())
		if err := f.stageInitialBasicAttackWait(p, ready); err != nil {
			return err
		}
		f.processChanges.SetCooldownStarted()
	}
	f.recordProcess(p, "process_moment", kind)
	for _, moment := range p.Definition().MomentOperations {
		if !actionpkg.MomentMatches(moment.Moment, kind, p.StepKey(), reason) {
			continue
		}
		f.operationOutputs = nil
		start, end := int(moment.OperationStart), int(moment.OperationStart)+int(moment.OperationCount)
		if end > len(s.compiled.Operations) {
			return s.processErr(p.Definition().Path, "process operation range is invalid", p.ProcessKey())
		}
		for _, op := range s.compiled.Operations[start:end] {
			if op.Operation == "cooldown_change" && op.ValuePolicy == "set_remaining" && normalizeAbilityRef(op.AbilityRefStr, p.Owner(), p.Target()) != p.AbilityRef() && !s.isProcessBasicAttackReset(p, kind, op) {
				return s.processErr(moment.Path+".operations.abilityRef", "process set_remaining must address its original mounted initial ability", op.AbilityRefStr)
			}
		}
		if err := f.executeOperations(p.Ability(), s.compiled.Operations[start:end]); err != nil {
			return err
		}
	}
	if f.empowered != nil {
		f.empowered.moments = append(f.empowered.moments, empoweredMoment{process: p.Freeze(), kind: kind})
	}
	return nil
}

// The only cross-process set_remaining admitted here is an authored initial
// reset of this owner's actual selected native basic-attack clock.
func (s *Engine) isProcessBasicAttackReset(p *actionpkg.ProcessView, kind string, op planbundle.CompiledOperation) bool {
	attack := s.actions.BasicAttack()
	if kind != "PROCESS_START" || attack == nil || p.Owner() != attack.Plan().Source || (op.Target != model.SelectorSelf && op.Target != model.SelectorSource) || !op.HasAmount {
		return false
	}
	ref := normalizeAbilityRef(op.AbilityRefStr, p.Owner(), p.Target())
	if ref != attack.Plan().InitialControlAbilityRef {
		return false
	}
	value, constant := s.formulas.FoldStatic(op.AmountProgram)
	if !constant || value != 0 {
		return false
	}
	bound, found := s.compiled.AbilityRefIndex[ref]
	if !found || int(bound.AbilityIndex) >= len(s.compiled.Abilities) {
		return false
	}
	ability := s.compiled.Abilities[bound.AbilityIndex]
	return ability.IsBasicAttack && ability.SkillKey == attack.Plan().SkillKey && ability.ProcessControl != nil && ability.ProcessControl.Action == "INITIAL" && ability.ProcessControl.UseRefFromEvent && ability.ProviderIndex == attack.InitialAbility().ProviderIndex && ability.AbilityKey == attack.InitialAbility().AbilityKey
}

func (s *Engine) commitProcessFrame(p *actionpkg.ProcessView, f *Frame) *model.EngineError {
	f.commit()
	if f.fatal {
		return f.fatalErr
	}
	if s.processFailure != nil {
		return s.processFailure
	}
	f.maybeQueueDamageDealtEvent(p.Ability())
	if err := f.dispatchPendingEvents(); err != nil {
		return err
	}
	s.checkDeathStopReason()
	return s.processFailure
}

func (s *Engine) runProcessMoment(p *actionpkg.ProcessView, kind, reason string) *model.EngineError {
	var frameStorage Frame
	s.initProcessFrame(&frameStorage, p)
	f := &frameStorage
	if err := s.applyProcessMoment(p, f, kind, reason); err != nil {
		return err
	}
	err := s.commitProcessFrame(p, f)
	if err != nil {
		return err
	}
	return s.resolveSkillActionMoment(p, kind)
}

func (s *Engine) enterProcessStep(p *actionpkg.ProcessView, index int) *model.EngineError {
	for p.Status() == "active" {
		if index >= len(p.Definition().Steps) {
			return s.finishProcess(p, "complete", "")
		}
		var frameStorage Frame
		s.initProcessFrame(&frameStorage, p)
		f := &frameStorage
		staged := f.pendingProcess
		step := p.Definition().Steps[index]
		f.processChanges.EnterStep(index, step, s.loop.TimeMs())
		duration := func(id formula.GenericProgramID, zero bool, path string) (int64, *model.EngineError) {
			v, err := f.evalAmount(id, p.Ability())
			if err != nil {
				return 0, err
			}
			at, ok := actionpkg.ProcessTimeAfter(s.loop.TimeMs(), v, zero)
			if !ok {
				return 0, s.processErr(p.Definition().Path+path, "invalid integer process duration or timestamp overflow", step.StepKey)
			}
			return at, nil
		}
		switch step.StepType {
		case "DELAY":
			at, err := duration(step.DelayProgram, false, ".steps.delayMs")
			if err != nil {
				return err
			}
			f.processChanges.SetTiming(at, &at)
		case "RECAST":
			advance, ok := actionpkg.ProcessTimeAfter(s.loop.TimeMs(), float64(step.RecastIntervalMs), true)
			if !ok || advance > maxJSONSafeInteger {
				return s.processErr(step.Path+".intervalMs", "invalid safe recast interval deadline", step.StepKey)
			}
			f.processChanges.SetTiming(advance, nil)
			at, err := duration(step.WindowProgram, false, ".steps.windowMs")
			if err != nil {
				return err
			}
			if at > maxJSONSafeInteger {
				return s.processErr(step.Path+".windowMs", "recast expiration must be a safe integer deadline", step.StepKey)
			}
			f.processChanges.SetTiming(staged.AdvanceAtMs(), &at)
		case "CHARGE":
			minimum, err := duration(step.MinimumChargeProgram, true, ".steps.minimumChargeMs")
			if err != nil {
				return err
			}
			maximum, err := duration(step.MaximumChargeProgram, false, ".steps.maximumChargeMs")
			if err != nil {
				return err
			}
			if minimum > maximum {
				return s.processErr(p.Definition().Path+".steps.minimumChargeMs", "minimum charge exceeds maximum", step.StepKey)
			}
			f.processChanges.SetTiming(minimum, &maximum)
		case "MULTI_HIT", "CHANNEL":
			if err := s.enterProcessRepeat(f, step); err != nil {
				return err
			}
		}
		f.pendingProcessTimer = step.StepType != "IMMEDIATE" && (!staged.HasRepeat() || staged.HasNextExecution() && staged.NextExecutionAt() > s.loop.TimeMs())
		if err := s.applyProcessMoment(p, f, "STEP_START", ""); err != nil {
			return err
		}
		if err := s.commitProcessFrame(p, f); err != nil {
			return err
		}
		if p.Status() != "active" {
			return nil
		}
		if p.HasRepeat() {
			if p.HasNextExecution() && p.NextExecutionAt() == s.loop.TimeMs() {
				return s.executeProcessRepeat(p)
			}
			return nil
		}
		if step.StepType != "IMMEDIATE" {
			return nil
		}
		if err := s.runProcessMoment(p, "STEP_EXECUTION", ""); err != nil {
			return err
		}
		if p.Status() != "active" {
			return nil
		}
		if err := s.runProcessMoment(p, "STEP_COMPLETE", ""); err != nil {
			return err
		}
		index++
	}
	return nil
}

func (s *Engine) completeProcessStep(p *actionpkg.ProcessView) *model.EngineError {
	if p.Status() != "active" {
		return nil
	}
	if err := s.runProcessMoment(p, "STEP_COMPLETE", ""); err != nil {
		return err
	}
	if p.Status() != "active" {
		return nil
	}
	return s.enterProcessStep(p, p.StepIndex()+1)
}

func (s *Engine) finishProcess(p *actionpkg.ProcessView, status, reason string) *model.EngineError {
	return s.finishProcessWithCast(p, status, reason, "")
}

func (s *Engine) finishProcessWithCast(p *actionpkg.ProcessView, status, reason, castRef string) *model.EngineError {
	if p.Status() != "active" {
		return nil
	}
	var frameStorage Frame
	s.initProcessFrame(&frameStorage, p)
	f := &frameStorage
	f.countCastOnCommit, f.castStatRef = castRef != "", castRef
	f.processChanges.Finish(status, reason, s.loop.TimeMs())
	kind := "PROCESS_COMPLETE"
	if status == "failed" {
		kind = "PROCESS_FAILURE"
	}
	if err := s.applyProcessMoment(p, f, kind, reason); err != nil {
		return err
	}
	err := s.commitProcessFrame(p, f)
	if f.committed {
		s.publishSkillActionFinish(p)
	}
	if err != nil {
		return err
	}
	if err := s.resolveSkillActionMoment(p, kind); err != nil {
		return err
	}
	if status == "complete" {
		return s.publishProcessResolved(p)
	}
	return nil
}

func (s *Engine) enqueueProcessTimer(p *actionpkg.ProcessView) *model.EngineError {
	if !p.HasExpiry() && p.StepVersion() != 0 && (p.StepIndex() < 0 || p.Definition().Steps[p.StepIndex()].StepType != "IMMEDIATE") {
		return s.processErr("processInstances.expiresAtMs", "active timed process requires expiration", p.UseKey())
	}
	index := -1
	for i := 0; i < s.actions.ProcessCount(); i++ {
		v := s.actions.ProcessAt(i)
		if v == p {
			index = i
			break
		}
	}
	if s.loop.Queue().Push(scheduler.GenericEvent{TimeMs: p.TimerAt(), Category: scheduler.GenericCategoryProcessTimer, Kind: scheduler.GenericEventProcessTimer, ProcessIndex: index, ProcessStepVersion: p.StepVersion(), ProcessExecutionIndex: p.StepExecutionIndex(), ProcessSortKey: p.StableKey(), DriverEntryIndex: -1}) != model.ErrOK {
		return s.budgetError(model.BudgetCauseMaxQueueEvents, "process timer queue overflow")
	}
	return nil
}

func (s *Engine) handleProcessTimer(ev scheduler.GenericEvent) *model.EngineError {
	if ev.ProcessIndex < 0 || ev.ProcessIndex >= s.actions.ProcessCount() {
		return s.processErr("processInstances", "unknown process timer instance", "")
	}
	p := s.actions.ProcessAt(ev.ProcessIndex)
	if p.Status() != "active" || p.StepVersion() != ev.ProcessStepVersion || p.StepExecutionIndex() != ev.ProcessExecutionIndex || p.TimerAt() != s.loop.TimeMs() {
		return nil
	}
	if p.StepVersion() == 0 {
		return s.enterProcessStep(p, 0)
	}
	if p.HasStepCompletion() {
		return s.enterProcessStep(p, p.StepIndex()+1)
	}
	if !p.HasRepeat() && p.StepExecutionIndex() > 0 && p.Definition().Steps[p.StepIndex()].StepType != "RECAST" {
		return s.completeProcessStep(p)
	}
	step := p.Definition().Steps[p.StepIndex()]
	if step.StepType == empoweredAttackStep && p.HasEmpoweredWindow() {
		return s.finishCountedEmpoweredWindow(p)
	}
	if step.StepType == "IMMEDIATE" {
		if err := s.runProcessMoment(p, "STEP_EXECUTION", ""); err != nil {
			return err
		}
		return s.completeProcessStep(p)
	}
	if p.HasRepeat() {
		if p.HasNextExecution() {
			return s.executeProcessRepeat(p)
		}
		return s.completeProcessStep(p)
	}
	if step.StepType != "DELAY" {
		if err := s.runProcessMoment(p, "STEP_TIMEOUT", ""); err != nil {
			return err
		}
	}
	if p.Status() != "active" {
		return nil
	}
	if step.StepType == "RECAST" || (step.StepType == "CHARGE" && !step.ReleaseAtMaximum) {
		return s.finishProcess(p, "failed", "EVENT_ABORTED")
	}
	if step.StepType == "EMPOWERED_BASIC_ATTACK" {
		return s.finishProcess(p, "failed", "EVENT_ABORTED")
	}
	if step.StepType == "DELAY" || (step.StepType == "CHARGE" && step.ReleaseAtMaximum) {
		if err := s.runProcessMoment(p, "STEP_EXECUTION", ""); err != nil {
			return err
		}
	}
	return s.completeProcessStep(p)
}

func (s *Engine) failDeadProcesses() *model.EngineError {
	if s.actions.ProcessCount() == 0 {
		return nil
	}
	deadOwner := false
	for key := range s.combatants {
		if s.combatantHasHp(key) && s.combatantHp(key) <= 0 {
			deadOwner = true
			break
		}
	}
	if !deadOwner {
		return nil
	}
	// 无待终结实例时，原冻结循环不会执行任何效果；避免复制并排序历史过程。
	if !s.settlingProcessDeaths {
		hasPending := false
		for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
			p := s.actions.ProcessAt(processSlot)
			if p.Status() == "active" && (s.actions.Dead(p.Owner()) || s.combatantHasHp(p.Owner()) && s.combatantHp(p.Owner()) <= 0) {
				hasPending = true
				break
			}
		}
		if !hasPending {
			return nil
		}
	}
	s.settlingProcessDeaths = true
	defer func() { s.settlingProcessDeaths = false }()
	// Stable instance order; termination claims ownership before executing failure effects.
	ordered := s.actions.ProcessViews()
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].StableKey() < ordered[j].StableKey() })
	for {
		pending := make([]*actionpkg.ProcessView, 0)
		for _, p := range ordered {
			if p.Status() == "active" && (s.actions.Dead(p.Owner()) || s.combatantHasHp(p.Owner()) && s.combatantHp(p.Owner()) <= 0) {
				pending = append(pending, p)
			}
		}
		if len(pending) == 0 {
			break
		}
		// Freeze the dead owners before any failure effect can heal or kill another owner.
		for _, p := range pending {
			if err := s.finishProcess(p, "failed", "SOURCE_DIED"); err != nil {
				return err
			}
		}
	}
	return nil
}

func (f *Frame) recordProcess(p *actionpkg.ProcessView, kind, value string) {
	f.recordEvidenceLazy(model.EvidenceKind(kind), func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKind(kind), Ref: p.AbilityRef(), Data: map[string]interface{}{"owner": p.Owner(), "providerRef": p.ProviderRef(), "processKey": p.ProcessKey(), "skillKey": p.SkillKey(), "useKey": p.UseKey(), "target": p.Target(), "stepKey": p.StepKey(), "stepVersion": p.StepVersion(), "moment": value, "status": p.Status(), "failureReason": p.FailureReason()}}
	})
}

func (s *Engine) snapshotProcesses() []model.ProcessInstanceSnapshot {
	return s.actions.ExportProcesses()
}
