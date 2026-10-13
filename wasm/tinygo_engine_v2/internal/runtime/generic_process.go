package runtime

import (
	"math"
	"sort"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

type processRuntime struct {
	model.ProcessInstanceSnapshot
	definition *planbundle.CompiledProcess
	ability    planbundle.CompiledAbility
	abilityRef string
	// 过程身份在构造后不变；帧复制保留同一份不可变排序键。
	mountKey   string
	stableKey  string
	stepIndex  int
	castID     uint64
	chainDepth int
	collector  *eventCopyableCollector
}

func (s *genericRunState) processErr(path, message, ref string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func processTimeAfter(now int64, value float64, allowZero bool) (int64, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || (!allowZero && value == 0) || math.Trunc(value) != value || value >= 9223372036854775808.0 || now < 0 {
		return 0, false
	}
	duration := int64(value)
	if duration > math.MaxInt64-now {
		return 0, false
	}
	return now + duration, true
}

func processMountKey(owner, provider, process string) string {
	return owner + "\x00" + provider + "\x00" + process
}

func (p *processRuntime) cacheIdentityKeys() {
	p.stableKey = p.Owner + "\x00" + p.ProviderRef + "\x00" + p.ProcessKey + "\x00" + p.UseKey
	p.mountKey = p.stableKey[:len(p.stableKey)-len(p.UseKey)-1]
}

func processInstanceMountKey(p *processRuntime) string {
	if p.mountKey != "" {
		return p.mountKey
	}
	// 内部手工构造或零值对象尚未建立缓存；生产构造始终先建立键。
	return processMountKey(p.Owner, p.ProviderRef, p.ProcessKey)
}

func (s *genericRunState) processMounted(owner, provider string, definition uint16) bool {
	c, ok := s.combatants[owner]
	if !ok {
		return false
	}
	for _, p := range c.providers {
		if p.ProviderRef == provider && p.DefinitionRef == s.compiled.Providers[definition].ProviderKey && (p.ExpireAt == 0 || p.ExpireAt > s.nowMs) {
			return true
		}
	}
	return false
}

func (s *genericRunState) handleProcessCommand(entry model.DriverEntry, entryIndex int, controlAbility planbundle.CompiledAbility, resolvedRef string) *model.EngineError {
	control := controlAbility.ProcessControl
	fact := s.processFacts[entry.EntryKey]
	source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	target, _ := s.resolveDriverCombatantKey(entry.Target, source)
	parsed, _ := planbundle.ParseAbilityRef(resolvedRef)
	p := &s.compiled.Providers[controlAbility.ProviderIndex].Processes[control.ProcessIndex]
	var instance *processRuntime
	for _, current := range s.processInstances {
		if current.UseKey == fact.UseRef {
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
		for _, current := range s.processInstances {
			if current.Status != "active" {
				continue
			}
			if mountKey == "" {
				mountKey = processMountKey(source, parsed.ProviderRef, p.ProcessKey)
			}
			if processInstanceMountKey(current) == mountKey {
				return s.rejectProcess(entry, "process_already_active")
			}
		}
		if s.combatantHasHp(source) && s.combatantHp(source) <= 0 {
			return s.rejectProcess(entry, "source_dead")
		}
		if len(s.skillActions) > 0 && s.actionOccupied(source) {
			return s.rejectProcess(entry, "action_occupied")
		}
		if _, blocked := s.cooldownGate(source, resolvedRef); blocked {
			return s.rejectProcess(entry, "cooldown_not_ready")
		}
		return s.startProcess(entry, entryIndex, source, target, parsed.ProviderRef, resolvedRef, controlAbility, p, fact.UseRef, 0, nil)
	}
	if instance == nil {
		return s.rejectProcess(entry, "process_not_started")
	}
	if instance.Owner != source || instance.ProviderRef != parsed.ProviderRef || instance.ProcessKey != p.ProcessKey || instance.Target != target {
		return s.rejectProcess(entry, "process_identity_mismatch")
	}
	if instance.Status != "active" {
		return s.rejectProcess(entry, "process_already_finished")
	}
	if instance.ExpiresAtMs != nil && s.nowMs >= *instance.ExpiresAtMs {
		return s.rejectProcess(entry, "process_expired")
	}
	if control.StepKey != "" && control.StepKey != instance.StepKey {
		return s.rejectProcess(entry, "wrong_step")
	}
	var conditionFrame executionFrame
	s.initProcessFrame(&conditionFrame, instance)
	allowed, conditionErr := s.evalProcessCondition(entryIndex, &conditionFrame, controlAbility)
	if conditionErr != nil {
		return conditionErr
	}
	if !allowed {
		return s.rejectProcess(entry, "condition_false")
	}
	if control.Action == "RECAST" || control.Action == "CHARGE_RELEASE" {
		if s.nowMs < instance.AdvanceAtMs {
			return s.rejectProcess(entry, "advance_too_early")
		}
		step := instance.definition.Steps[instance.stepIndex]
		if (control.Action == "RECAST" && step.StepType != "RECAST") || (control.Action == "CHARGE_RELEASE" && step.StepType != "CHARGE") {
			return s.rejectProcess(entry, "wrong_step")
		}
		var frameStorage executionFrame
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

func (s *genericRunState) countProcessCast(ref string) {
	s.abilityCastCount++
	s.statFor(ref).castCount++
}

func (s *genericRunState) rejectProcess(entry model.DriverEntry, reason string) *model.EngineError {
	_, ref, _ := s.lookupDriverAbility(entry)
	return s.rejectProcessUse(entry, ref, s.processFacts[entry.EntryKey].UseRef, reason)
}

func (s *genericRunState) rejectProcessUse(entry model.DriverEntry, ref, use, reason string) *model.EngineError {
	if s.skillAction != nil && entry.EntryKey == s.skillAction.plan.InstructionKey {
		s.skillAction.rejection = reason
	}
	s.attemptSkippedCount++
	s.statFor(ref).skipCount++
	s.recordEvidenceLazy("process_rejected", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.nowMs, Kind: "process_rejected", Ref: ref, Path: "driverPlan.entries[" + entry.EntryKey + "]", Data: map[string]interface{}{"entryKey": entry.EntryKey, "useKey": use, "reason": reason}}
	})
	return nil
}

func (s *genericRunState) initProcessFrame(f *executionFrame, p *processRuntime) {
	s.initExecutionFrame(f, p.Owner, p.Target, p.abilityRef)
	staged := *p
	if p.Repeat != nil {
		repeat := *p.Repeat
		staged.Repeat = &repeat
	}
	staged.ActionOccupancies = append([]model.ProcessActionOccupancy{}, p.ActionOccupancies...)
	staged.ActualCosts = make(map[string]float64, len(p.ActualCosts))
	for key, amount := range p.ActualCosts {
		staged.ActualCosts[key] = amount
	}
	f.pendingProcess, f.processOriginal = &staged, p
	f.ownerCombatantKey = p.Owner
	f.ownerProviderRef = p.ProviderRef
	f.strictReads = true
	f.castInstanceID = p.castID
	f.castOrigin = p.ability.CastOrigin
	f.chainDepth, f.copyableCollector = p.chainDepth, p.collector
	f.processActualCosts = staged.ActualCosts
	f.processUseKey, f.processUseSkillKey, f.processUseSource = p.UseKey, p.SkillKey, p.Owner
}

// Condition false is represented by a normal process rejection; formula failures remain errors.
func (s *genericRunState) evalProcessCondition(entryIndex int, f *executionFrame, ability planbundle.CompiledAbility) (bool, *model.EngineError) {
	ids := []formula.GenericProgramID{}
	if entryIndex >= 0 && entryIndex < len(s.entryConditions) && s.entryConditions[entryIndex] != nil {
		ids = append(ids, *s.entryConditions[entryIndex])
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

func (s *genericRunState) startProcess(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, depth int, collector *eventCopyableCollector) *model.EngineError {
	if len(s.processInstances) >= s.budget.MaxProcessInstances {
		err := s.budgetError(model.BudgetCauseMaxProcessInstances, "process instance budget exceeded")
		err.Path, err.Ref = "safetyBudget.maxProcessInstances", use
		return err
	}
	s.refreshProviderAwareAttributes(owner, target)
	p := &processRuntime{ProcessInstanceSnapshot: model.ProcessInstanceSnapshot{Owner: owner, ProviderRef: provider, ProcessKey: definition.ProcessKey, SkillKey: definition.SkillKey, UseKey: use, Target: target, StartedAtMs: s.nowMs, StepStartedAtMs: s.nowMs, AdvanceAtMs: s.nowMs, ActualCosts: map[string]float64{}, ActionOccupancies: []model.ProcessActionOccupancy{}, Status: "active"}, definition: definition, ability: ability, abilityRef: ref, stepIndex: -1}
	p.cacheIdentityKeys()
	p.chainDepth, p.collector = depth, collector
	defer func() { p.chainDepth, p.collector = 0, nil }()
	var frameStorage executionFrame
	s.initProcessFrame(&frameStorage, p)
	f := &frameStorage
	f.processIsNew, f.countCastOnCommit = true, true
	allowed, err := s.evalProcessCondition(entryIndex, f, ability)
	if err != nil {
		return err
	}
	if !allowed {
		return s.rejectProcessUse(entry, ref, use, "condition_false")
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
		slot, ok := f.stageFor(owner).resources[key]
		if !ok || math.IsNaN(slot.Current) || math.IsInf(slot.Current, 0) || slot.Current < 0 {
			return s.processErr("combatants."+owner+".resources."+key, "process cost requires an explicit finite resource", key)
		}
		if slot.Current < totals[key] {
			return s.rejectProcessUse(entry, ref, use, "resource_insufficient")
		}
	}
	for _, key := range keys {
		before := f.stageFor(owner).resources[key].Current
		if err := f.applyResourceChange(owner, key, -totals[key], ability); err != nil {
			return err
		}
		f.pendingProcess.ActualCosts[key] = before - f.stageFor(owner).resources[key].Current
	}
	f.pendingProcess.castID = s.mintCastInstanceID()
	f.castInstanceID = f.pendingProcess.castID
	if err := s.applyProcessMoment(p, f, "PROCESS_START", ""); err != nil {
		return err
	}
	if err := s.commitProcessFrame(p, f); err != nil {
		return err
	}
	if p.Status != "active" {
		return nil
	}
	if err := f.maybeDispatchAbilityStartedEvent(ability); err != nil {
		return err
	}
	if p.Status != "active" {
		return nil
	}
	return s.enterProcessStep(p, 0)
}

func processMomentMatches(m model.ProcessMomentDefinition, kind, step, reason string) bool {
	if m.MomentType != kind {
		return false
	}
	if strings.HasPrefix(kind, "STEP_") && (m.StepKey == nil || *m.StepKey != step) {
		return false
	}
	return kind != "PROCESS_FAILURE" || m.FailureReason == nil || *m.FailureReason == reason
}

func (s *genericRunState) applyProcessMoment(p *processRuntime, f *executionFrame, kind, reason string) *model.EngineError {
	p = f.pendingProcess
	f.processMomentKind = kind
	if kind == "STEP_EXECUTION" {
		if p.StepCompletedAtMs != nil || p.Repeat == nil && p.StepExecutionIndex > 0 {
			return s.processErr(p.definition.Path, "process step execution has already committed", p.UseKey)
		}
		p.StepExecutionIndex++
		at := s.nowMs
		p.LastExecutionAtMs = &at
		if p.Repeat != nil {
			if err := s.stageProcessRepeatExecution(f); err != nil {
				return err
			}
		}
	}
	if kind == "STEP_COMPLETE" {
		if p.StepCompletedAtMs != nil {
			return s.processErr(p.definition.Path, "process step completion has already committed", p.UseKey)
		}
		at := s.nowMs
		p.StepCompletedAtMs = &at
	}
	f.processCostReadable = kind == "PROCESS_COMPLETE" || kind == "PROCESS_FAILURE"
	if cd := p.definition.Cooldown; cd != nil && !p.CooldownStarted && processMomentMatches(cd.StartMoment, kind, p.StepKey, reason) {
		value, err := f.evalAmount(cd.DurationProgram, p.ability)
		if err != nil {
			return err
		}
		if cd.RoundPositiveMs {
			if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
				return f.formulaError(cd.DurationProgram, "process cooldown must be finite and positive before rounding")
			}
			value = math.Max(1, math.Round(value))
		}
		ready, ok := processTimeAfter(s.nowMs, value, !cd.RoundPositiveMs)
		if !ok {
			return f.formulaError(cd.DurationProgram, "invalid process cooldown duration or timestamp overflow")
		}
		if err := f.applyCooldownChange(p.Owner, p.abilityRef, ready); err != nil {
			return err
		}
		if err := f.stageInitialBasicAttackWait(p, ready); err != nil {
			return err
		}
		p.CooldownStarted = true
	}
	f.recordProcess(p, "process_moment", kind)
	for _, moment := range p.definition.MomentOperations {
		if !processMomentMatches(moment.Moment, kind, p.StepKey, reason) {
			continue
		}
		f.operationOutputs = nil
		start, end := int(moment.OperationStart), int(moment.OperationStart)+int(moment.OperationCount)
		if end > len(s.compiled.Operations) {
			return s.processErr(p.definition.Path, "process operation range is invalid", p.ProcessKey)
		}
		for _, op := range s.compiled.Operations[start:end] {
			if op.Operation == "cooldown_change" && op.ValuePolicy == "set_remaining" && normalizeAbilityRef(op.AbilityRefStr, p.Owner, p.Target) != p.abilityRef {
				return s.processErr(moment.Path+".operations.abilityRef", "process set_remaining must address its original mounted initial ability", op.AbilityRefStr)
			}
		}
		if err := f.executeOperations(p.ability, s.compiled.Operations[start:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *genericRunState) commitProcessFrame(p *processRuntime, f *executionFrame) *model.EngineError {
	f.commit()
	if f.fatal {
		return f.fatalErr
	}
	if s.processFailure != nil {
		return s.processFailure
	}
	f.maybeQueueDamageDealtEvent(p.ability)
	if err := f.dispatchPendingEvents(); err != nil {
		return err
	}
	s.checkDeathStopReason()
	return s.processFailure
}

func (s *genericRunState) runProcessMoment(p *processRuntime, kind, reason string) *model.EngineError {
	var frameStorage executionFrame
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

func (s *genericRunState) enterProcessStep(p *processRuntime, index int) *model.EngineError {
	for p.Status == "active" {
		if index >= len(p.definition.Steps) {
			return s.finishProcess(p, "complete", "")
		}
		var frameStorage executionFrame
		s.initProcessFrame(&frameStorage, p)
		f := &frameStorage
		staged := f.pendingProcess
		staged.stepIndex = index
		staged.StepVersion = index + 1
		step := p.definition.Steps[index]
		staged.StepKey = step.StepKey
		staged.StepStartedAtMs = s.nowMs
		staged.AdvanceAtMs = s.nowMs
		staged.ExpiresAtMs = nil
		staged.Repeat = nil
		staged.StepExecutionIndex = 0
		staged.LastExecutionAtMs, staged.StepCompletedAtMs = nil, nil
		duration := func(id formula.GenericProgramID, zero bool, path string) (int64, *model.EngineError) {
			v, err := f.evalAmount(id, p.ability)
			if err != nil {
				return 0, err
			}
			at, ok := processTimeAfter(s.nowMs, v, zero)
			if !ok {
				return 0, s.processErr(p.definition.Path+path, "invalid integer process duration or timestamp overflow", step.StepKey)
			}
			return at, nil
		}
		switch step.StepType {
		case "DELAY":
			at, err := duration(step.DelayProgram, false, ".steps.delayMs")
			if err != nil {
				return err
			}
			staged.AdvanceAtMs = at
			staged.ExpiresAtMs = &at
		case "RECAST":
			at, err := duration(step.WindowProgram, false, ".steps.windowMs")
			if err != nil {
				return err
			}
			staged.ExpiresAtMs = &at
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
				return s.processErr(p.definition.Path+".steps.minimumChargeMs", "minimum charge exceeds maximum", step.StepKey)
			}
			staged.AdvanceAtMs = minimum
			staged.ExpiresAtMs = &maximum
		case "MULTI_HIT", "CHANNEL":
			if err := s.enterProcessRepeat(f, step); err != nil {
				return err
			}
		}
		f.pendingProcessTimer = step.StepType != "IMMEDIATE" && (staged.Repeat == nil || staged.Repeat.NextExecutionAtMs != nil && *staged.Repeat.NextExecutionAtMs > s.nowMs)
		if err := s.applyProcessMoment(p, f, "STEP_START", ""); err != nil {
			return err
		}
		if err := s.commitProcessFrame(p, f); err != nil {
			return err
		}
		if p.Status != "active" {
			return nil
		}
		if p.Repeat != nil {
			if p.Repeat.NextExecutionAtMs != nil && *p.Repeat.NextExecutionAtMs == s.nowMs {
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
		if p.Status != "active" {
			return nil
		}
		if err := s.runProcessMoment(p, "STEP_COMPLETE", ""); err != nil {
			return err
		}
		index++
	}
	return nil
}

func (s *genericRunState) completeProcessStep(p *processRuntime) *model.EngineError {
	if p.Status != "active" {
		return nil
	}
	if err := s.runProcessMoment(p, "STEP_COMPLETE", ""); err != nil {
		return err
	}
	if p.Status != "active" {
		return nil
	}
	return s.enterProcessStep(p, p.stepIndex+1)
}

func (s *genericRunState) finishProcess(p *processRuntime, status, reason string) *model.EngineError {
	return s.finishProcessWithCast(p, status, reason, "")
}

func (s *genericRunState) finishProcessWithCast(p *processRuntime, status, reason, castRef string) *model.EngineError {
	if p.Status != "active" {
		return nil
	}
	var frameStorage executionFrame
	s.initProcessFrame(&frameStorage, p)
	f := &frameStorage
	f.countCastOnCommit, f.castStatRef = castRef != "", castRef
	staged := f.pendingProcess
	staged.Status = status
	if staged.Repeat != nil {
		staged.Repeat.NextExecutionAtMs = nil
	}
	at := s.nowMs
	staged.FinishedAtMs = &at
	staged.FailureReason = nil
	kind := "PROCESS_COMPLETE"
	if status == "failed" {
		staged.FailureReason = &reason
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
	return s.resolveSkillActionMoment(p, kind)
}

func (s *genericRunState) enqueueProcessTimer(p *processRuntime) *model.EngineError {
	if p.ExpiresAtMs == nil && p.StepVersion != 0 && (p.stepIndex < 0 || p.definition.Steps[p.stepIndex].StepType != "IMMEDIATE") {
		return s.processErr("processInstances.expiresAtMs", "active timed process requires expiration", p.UseKey)
	}
	index := -1
	for i, v := range s.processInstances {
		if v == p {
			index = i
			break
		}
	}
	if s.heap.Push(scheduler.GenericEvent{TimeMs: processTimerAt(p), Category: scheduler.GenericCategoryProcessTimer, Kind: scheduler.GenericEventProcessTimer, ProcessIndex: index, ProcessStepVersion: p.StepVersion, ProcessExecutionIndex: p.StepExecutionIndex, ProcessSortKey: processStableKey(p), DriverEntryIndex: -1}) != model.ErrOK {
		return s.budgetError(model.BudgetCauseMaxQueueEvents, "process timer queue overflow")
	}
	return nil
}

func (s *genericRunState) handleProcessTimer(ev scheduler.GenericEvent) *model.EngineError {
	if ev.ProcessIndex < 0 || ev.ProcessIndex >= len(s.processInstances) {
		return s.processErr("processInstances", "unknown process timer instance", "")
	}
	p := s.processInstances[ev.ProcessIndex]
	if p.Status != "active" || p.StepVersion != ev.ProcessStepVersion || p.StepExecutionIndex != ev.ProcessExecutionIndex || processTimerAt(p) != s.nowMs {
		return nil
	}
	if p.StepVersion == 0 {
		return s.enterProcessStep(p, 0)
	}
	if p.StepCompletedAtMs != nil {
		return s.enterProcessStep(p, p.stepIndex+1)
	}
	if p.Repeat == nil && p.StepExecutionIndex > 0 {
		return s.completeProcessStep(p)
	}
	step := p.definition.Steps[p.stepIndex]
	if step.StepType == "IMMEDIATE" {
		if err := s.runProcessMoment(p, "STEP_EXECUTION", ""); err != nil {
			return err
		}
		return s.completeProcessStep(p)
	}
	if p.Repeat != nil {
		if p.Repeat.NextExecutionAtMs != nil {
			return s.executeProcessRepeat(p)
		}
		return s.completeProcessStep(p)
	}
	if step.StepType != "DELAY" {
		if err := s.runProcessMoment(p, "STEP_TIMEOUT", ""); err != nil {
			return err
		}
	}
	if p.Status != "active" {
		return nil
	}
	if step.StepType == "RECAST" || (step.StepType == "CHARGE" && !step.ReleaseAtMaximum) {
		return s.finishProcess(p, "failed", "EVENT_ABORTED")
	}
	if step.StepType == "DELAY" || (step.StepType == "CHARGE" && step.ReleaseAtMaximum) {
		if err := s.runProcessMoment(p, "STEP_EXECUTION", ""); err != nil {
			return err
		}
	}
	return s.completeProcessStep(p)
}

func (s *genericRunState) failDeadProcesses() *model.EngineError {
	if len(s.processInstances) == 0 {
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
		for _, p := range s.processInstances {
			if p.Status == "active" && (s.actionDeaths[p.Owner] || s.combatantHasHp(p.Owner) && s.combatantHp(p.Owner) <= 0) {
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
	ordered := append([]*processRuntime(nil), s.processInstances...)
	sort.Slice(ordered, func(i, j int) bool { return processStableKey(ordered[i]) < processStableKey(ordered[j]) })
	for {
		pending := make([]*processRuntime, 0)
		for _, p := range ordered {
			if p.Status == "active" && (s.actionDeaths[p.Owner] || s.combatantHasHp(p.Owner) && s.combatantHp(p.Owner) <= 0) {
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

func processStableKey(p *processRuntime) string {
	if p.stableKey != "" {
		return p.stableKey
	}
	return processInstanceMountKey(p) + "\x00" + p.UseKey
}

func processSnapshotLess(a, b *processRuntime) bool {
	ka, kb := processInstanceMountKey(a), processInstanceMountKey(b)
	if ka != kb {
		return ka < kb
	}
	return a.UseKey < b.UseKey
}

func (f *executionFrame) recordProcess(p *processRuntime, kind, value string) {
	f.recordEvidenceLazy(model.EvidenceKind(kind), func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: model.EvidenceKind(kind), Ref: p.abilityRef, Data: map[string]interface{}{"owner": p.Owner, "providerRef": p.ProviderRef, "processKey": p.ProcessKey, "skillKey": p.SkillKey, "useKey": p.UseKey, "target": p.Target, "stepKey": p.StepKey, "stepVersion": p.StepVersion, "moment": value, "status": p.Status, "failureReason": p.FailureReason}}
	})
}

func (s *genericRunState) snapshotProcesses() []model.ProcessInstanceSnapshot {
	ordered := s.processInstances
	if len(ordered) > 1 {
		ordered = append([]*processRuntime(nil), ordered...)
		sort.Slice(ordered, func(i, j int) bool { return processSnapshotLess(ordered[i], ordered[j]) })
	}
	rows := make([]model.ProcessInstanceSnapshot, 0, len(ordered))
	for _, p := range ordered {
		row := p.ProcessInstanceSnapshot
		row.ActionOccupancies = append([]model.ProcessActionOccupancy{}, p.ActionOccupancies...)
		if p.Repeat != nil {
			repeat := *p.Repeat
			row.Repeat = &repeat
		}
		row.ActualCosts = make(map[string]float64, len(p.ActualCosts))
		for k, v := range p.ActualCosts {
			row.ActualCosts[k] = v
		}
		rows = append(rows, row)
	}
	return rows
}
