package runtime

import (
	"math"
	"sort"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

type processRuntime struct {
	model.ProcessInstanceSnapshot
	definition *compilebundle.CompiledProcess
	ability    compilebundle.CompiledAbility
	abilityRef string
	stepIndex  int
	castID     uint64
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

func (s *genericRunState) handleProcessCommand(entry model.DriverEntry, entryIndex int, controlAbility compilebundle.CompiledAbility, resolvedRef string) *model.EngineError {
	control := controlAbility.ProcessControl
	fact := s.processFacts[entry.EntryKey]
	source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	target, _ := s.resolveDriverCombatantKey(entry.Target, source)
	parsed, _ := compilebundle.ParseAbilityRef(resolvedRef)
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
		for _, current := range s.processInstances {
			if current.Status == "active" && processMountKey(current.Owner, current.ProviderRef, current.ProcessKey) == processMountKey(source, parsed.ProviderRef, p.ProcessKey) {
				return s.rejectProcess(entry, "process_already_active")
			}
		}
		if s.combatantHasHp(source) && s.combatantHp(source) <= 0 {
			return s.rejectProcess(entry, "source_dead")
		}
		if _, blocked := s.cooldownGate(source, resolvedRef); blocked {
			return s.rejectProcess(entry, "cooldown_not_ready")
		}
		return s.startProcess(entry, entryIndex, source, target, parsed.ProviderRef, resolvedRef, controlAbility, p, fact.UseRef)
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
	allowed, conditionErr := s.evalProcessCondition(entryIndex, s.newProcessFrame(instance), controlAbility)
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
		s.recordProcess(instance, "process_use", control.Action)
		s.countProcessCast(resolvedRef)
		if err := s.runProcessMoment(instance, "STEP_EXECUTION", ""); err != nil {
			return err
		}
		return s.completeProcessStep(instance)
	}
	// Cancel/interruption are explicit successful actions, never merely a request event.
	if control.Action == "INTERRUPT" && control.FailureReason == "SOURCE_DIED" && (!s.combatantHasHp(source) || s.combatantHp(source) > 0) {
		return s.rejectProcess(entry, "source_not_dead")
	}
	s.countProcessCast(resolvedRef)
	return s.finishProcess(instance, "failed", control.FailureReason)
}

func (s *genericRunState) countProcessCast(ref string) {
	s.abilityCastCount++
	s.statFor(ref).castCount++
}

func (s *genericRunState) rejectProcess(entry model.DriverEntry, reason string) *model.EngineError {
	s.attemptSkippedCount++
	_, ref, _ := s.lookupDriverAbility(entry)
	s.statFor(ref).skipCount++
	s.recordEvidence(model.EvidenceItem{TimeMs: s.nowMs, Kind: "process_rejected", Ref: ref, Path: "driverPlan.entries[" + entry.EntryKey + "]", Data: map[string]interface{}{"entryKey": entry.EntryKey, "useKey": s.processFacts[entry.EntryKey].UseRef, "reason": reason}})
	return nil
}

func (s *genericRunState) newProcessFrame(p *processRuntime) *executionFrame {
	f := s.newExecutionFrame(p.Owner, p.Target, p.abilityRef)
	f.ownerCombatantKey = p.Owner
	f.ownerProviderRef = p.ProviderRef
	f.strictReads = true
	f.castInstanceID = p.castID
	f.castOrigin = p.ability.CastOrigin
	f.processActualCosts = p.ActualCosts
	return f
}

// Condition false is represented by a normal process rejection; formula failures remain errors.
func (s *genericRunState) evalProcessCondition(entryIndex int, f *executionFrame, ability compilebundle.CompiledAbility) (bool, *model.EngineError) {
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

func (s *genericRunState) startProcess(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability compilebundle.CompiledAbility, definition *compilebundle.CompiledProcess, use string) *model.EngineError {
	if len(s.processInstances) >= s.budget.MaxProcessInstances {
		return s.processErr("safetyBudget.maxProcessInstances", "process instance budget exceeded", use)
	}
	s.refreshProviderAwareAttributes(owner, target)
	p := &processRuntime{ProcessInstanceSnapshot: model.ProcessInstanceSnapshot{Owner: owner, ProviderRef: provider, ProcessKey: definition.ProcessKey, SkillKey: definition.SkillKey, UseKey: use, Target: target, StartedAtMs: s.nowMs, StepStartedAtMs: s.nowMs, AdvanceAtMs: s.nowMs, ActualCosts: map[string]float64{}, Status: "active"}, definition: definition, ability: ability, abilityRef: ref, stepIndex: -1}
	f := s.newProcessFrame(p)
	allowed, err := s.evalProcessCondition(entryIndex, f, ability)
	if err != nil {
		return err
	}
	if !allowed {
		return s.rejectProcess(entry, "condition_false")
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
			return s.rejectProcess(entry, "resource_insufficient")
		}
	}
	for _, key := range keys {
		before := f.stageFor(owner).resources[key].Current
		if err := f.applyResourceChange(owner, key, -totals[key], ability); err != nil {
			return err
		}
		p.ActualCosts[key] = before - f.stageFor(owner).resources[key].Current
	}
	p.castID = s.mintCastInstanceID()
	f.castInstanceID = p.castID
	s.processInstances = append(s.processInstances, p)
	if err := s.applyProcessMoment(p, f, "PROCESS_START", ""); err != nil {
		return err
	}
	if err := s.commitProcessFrame(p, f); err != nil {
		return err
	}
	s.countProcessCast(ref)
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
	f.processCostReadable = kind == "PROCESS_COMPLETE" || kind == "PROCESS_FAILURE"
	if cd := p.definition.Cooldown; cd != nil && !p.CooldownStarted && processMomentMatches(cd.StartMoment, kind, p.StepKey, reason) {
		value, err := f.evalAmount(cd.DurationProgram, p.ability)
		if err != nil {
			return err
		}
		ready, ok := processTimeAfter(s.nowMs, value, true)
		if !ok {
			return s.processErr(p.definition.Path+".cooldown.durationMs", "invalid process cooldown duration", p.ProcessKey)
		}
		if err := f.applyCooldownChange(p.Owner, p.abilityRef, ready); err != nil {
			return err
		}
		p.CooldownStarted = true
	}
	s.recordProcess(p, "process_moment", kind)
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
	acc := s.statFor(p.abilityRef)
	if f.damageDealt > 0 {
		if acc.damageDealt == nil {
			value := f.damageDealt
			acc.damageDealt = &value
		} else {
			*acc.damageDealt += f.damageDealt
		}
	}
	if f.healingDone > 0 {
		if acc.healingDone == nil {
			value := f.healingDone
			acc.healingDone = &value
		} else {
			*acc.healingDone += f.healingDone
		}
	}
	f.maybeQueueDamageDealtEvent(p.ability)
	if err := f.dispatchPendingEvents(); err != nil {
		return err
	}
	s.checkDeathStopReason()
	return s.processFailure
}

func (s *genericRunState) runProcessMoment(p *processRuntime, kind, reason string) *model.EngineError {
	f := s.newProcessFrame(p)
	if err := s.applyProcessMoment(p, f, kind, reason); err != nil {
		return err
	}
	return s.commitProcessFrame(p, f)
}

func (s *genericRunState) enterProcessStep(p *processRuntime, index int) *model.EngineError {
	for p.Status == "active" {
		if index >= len(p.definition.Steps) {
			return s.finishProcess(p, "complete", "")
		}
		p.stepIndex = index
		p.StepVersion = index + 1
		step := p.definition.Steps[index]
		p.StepKey = step.StepKey
		p.StepStartedAtMs = s.nowMs
		p.AdvanceAtMs = s.nowMs
		p.ExpiresAtMs = nil
		f := s.newProcessFrame(p)
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
			p.AdvanceAtMs = at
			p.ExpiresAtMs = &at
		case "RECAST":
			at, err := duration(step.WindowProgram, false, ".steps.windowMs")
			if err != nil {
				return err
			}
			p.ExpiresAtMs = &at
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
			p.AdvanceAtMs = minimum
			p.ExpiresAtMs = &maximum
		}
		if err := s.applyProcessMoment(p, f, "STEP_START", ""); err != nil {
			return err
		}
		if err := s.commitProcessFrame(p, f); err != nil {
			return err
		}
		if p.Status != "active" {
			return nil
		}
		if step.StepType != "IMMEDIATE" {
			return s.enqueueProcessTimer(p)
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
	if p.Status != "active" {
		return nil
	}
	p.Status = status
	at := s.nowMs
	p.FinishedAtMs = &at
	p.FailureReason = nil
	kind := "PROCESS_COMPLETE"
	if status == "failed" {
		p.FailureReason = &reason
		kind = "PROCESS_FAILURE"
	}
	return s.runProcessMoment(p, kind, reason)
}

func (s *genericRunState) enqueueProcessTimer(p *processRuntime) *model.EngineError {
	if p.ExpiresAtMs == nil {
		return s.processErr("processInstances.expiresAtMs", "active timed process requires expiration", p.UseKey)
	}
	index := -1
	for i, v := range s.processInstances {
		if v == p {
			index = i
			break
		}
	}
	if s.heap.Push(scheduler.GenericEvent{TimeMs: *p.ExpiresAtMs, Category: scheduler.GenericCategoryProcessTimer, Kind: scheduler.GenericEventProcessTimer, ProcessIndex: index, ProcessStepVersion: p.StepVersion, ProcessSortKey: processMountKey(p.Owner, p.ProviderRef, p.ProcessKey) + "\x00" + p.UseKey, DriverEntryIndex: -1}) != model.ErrOK {
		return s.processErr("processInstances", "process timer queue overflow", p.UseKey)
	}
	return nil
}

func (s *genericRunState) handleProcessTimer(ev scheduler.GenericEvent) *model.EngineError {
	if ev.ProcessIndex < 0 || ev.ProcessIndex >= len(s.processInstances) {
		return s.processErr("processInstances", "unknown process timer instance", "")
	}
	p := s.processInstances[ev.ProcessIndex]
	if p.Status != "active" || p.StepVersion != ev.ProcessStepVersion || p.ExpiresAtMs == nil || *p.ExpiresAtMs != s.nowMs {
		return nil
	}
	step := p.definition.Steps[p.stepIndex]
	if step.StepType != "DELAY" {
		if err := s.runProcessMoment(p, "STEP_TIMEOUT", ""); err != nil {
			return err
		}
	}
	if p.Status != "active" {
		return nil
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
	s.settlingProcessDeaths = true
	defer func() { s.settlingProcessDeaths = false }()
	// Stable instance order; termination claims ownership before executing failure effects.
	ordered := append([]*processRuntime(nil), s.processInstances...)
	sort.Slice(ordered, func(i, j int) bool { return processStableKey(ordered[i]) < processStableKey(ordered[j]) })
	for {
		pending := make([]*processRuntime, 0)
		for _, p := range ordered {
			if p.Status == "active" && s.combatantHasHp(p.Owner) && s.combatantHp(p.Owner) <= 0 {
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
	return processMountKey(p.Owner, p.ProviderRef, p.ProcessKey) + "\x00" + p.UseKey
}

func (s *genericRunState) recordProcess(p *processRuntime, kind, value string) {
	s.recordEvidence(model.EvidenceItem{TimeMs: s.nowMs, Kind: model.EvidenceKind(kind), Ref: p.abilityRef, Data: map[string]interface{}{"owner": p.Owner, "providerRef": p.ProviderRef, "processKey": p.ProcessKey, "skillKey": p.SkillKey, "useKey": p.UseKey, "target": p.Target, "stepKey": p.StepKey, "stepVersion": p.StepVersion, "moment": value, "status": p.Status, "failureReason": p.FailureReason}})
}

func (s *genericRunState) snapshotProcesses() []model.ProcessInstanceSnapshot {
	rows := make([]model.ProcessInstanceSnapshot, 0, len(s.processInstances))
	for _, p := range s.processInstances {
		row := p.ProcessInstanceSnapshot
		row.ActualCosts = make(map[string]float64, len(p.ActualCosts))
		for k, v := range p.ActualCosts {
			row.ActualCosts[k] = v
		}
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		ka, kb := processMountKey(a.Owner, a.ProviderRef, a.ProcessKey), processMountKey(b.Owner, b.ProviderRef, b.ProcessKey)
		if ka != kb {
			return ka < kb
		}
		return a.UseKey < b.UseKey
	})
	return rows
}
