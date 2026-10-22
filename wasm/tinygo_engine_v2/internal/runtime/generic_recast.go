package runtime

import (
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// The same process constructor also serves externally supplied and event-bound
// uses. Only the real current planned INITIAL may establish this new graph.
func (s *genericRunState) isBoundFiniteRecastInitial(entry model.DriverEntry, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string) bool {
	action := s.skillAction
	if action == nil || action.accepted || action.plan.Action != "INITIAL" || s.skillActionByUse[use] != action || action.useRef != use || use != "skill:"+action.plan.InstructionKey || int(action.binding.Slot) >= len(s.compiled.SkillActionBindings) {
		return false
	}
	binding := s.compiled.SkillActionBindings[action.binding.Slot]
	if !binding.HasFiniteRecast || binding.BindingKey != action.binding.BindingKey || binding.BindingKey != action.plan.BindingKey || binding.InitialAbilityIndex != action.controlAbilityIndex || len(binding.Controls) == 0 {
		return false
	}
	initial := s.compiled.Abilities[binding.InitialAbilityIndex]
	return action.plan.InstructionKey == entry.EntryKey && action.plan.FirstAtMs == s.nowMs && entry.FirstAtMs == s.nowMs && action.plan.AbilityRef == ref && binding.Controls[0].AbilityRef == ref &&
		action.plan.Source == owner && entry.Source == owner && binding.Source == owner && action.plan.Target == target && entry.Target == target && binding.ProviderRef == provider &&
		action.plan.SkillKey == definition.SkillKey && binding.SkillKey == definition.SkillKey && binding.Controls[0].ProcessKey == definition.ProcessKey &&
		binding.ProviderDefinitionRef == s.compiled.Providers[ability.ProviderIndex].ProviderKey && initial.ProviderIndex == ability.ProviderIndex && initial.AbilityKey == ability.AbilityKey &&
		ability.ProcessControl != nil && ability.ProcessControl.Action == "INITIAL" && !ability.ProcessControl.UseRefFromEvent
}

func (s *genericRunState) automaticRecastCandidate(r *automaticSkillRuleRuntime, p *processRuntime) (string, []string, int64, *model.EngineError) {
	if p.stepIndex < 0 || p.definition.Steps[p.stepIndex].StepType != "RECAST" || p.ExpiresAtMs == nil || s.nowMs >= *p.ExpiresAtMs {
		return model.AutomaticWaitProcessActive, nil, 0, nil
	}
	index := r.binding.ControlAbilityIndices["RECAST"]
	ability := s.compiled.Abilities[index]
	if !s.processMounted(p.Owner, p.ProviderRef, ability.ProviderIndex) {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	at, reason := p.AdvanceAtMs, model.AutomaticWaitProcessActive
	if occupied := s.actionReadyAt(p.Owner); occupied > at {
		at, reason = occupied, model.AutomaticWaitActionOccupied
	}
	if at >= *p.ExpiresAtMs {
		return reason, nil, 0, nil
	}
	if at > s.nowMs {
		return reason, nil, at, nil
	}
	s.refreshProviderAwareAttributes(p.Owner, p.Target)
	var frame executionFrame
	s.initProcessFrame(&frame, p)
	allowed, err := s.evalProcessCondition(-1, &frame, ability)
	if err != nil {
		return "", nil, 0, err
	}
	if !allowed {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	return "", nil, 0, nil
}

func (s *genericRunState) runAutomaticRecast(r *automaticSkillRuleRuntime, p *processRuntime) *model.EngineError {
	parent := s.skillActionByUse[p.UseKey]
	if parent == nil || !parent.accepted {
		return s.processErr("automaticSkills", "recast requires its real accepted window", p.UseKey)
	}
	index := r.binding.ControlAbilityIndices["RECAST"]
	key := parent.plan.InstructionKey + ":recast:" + strconv.Itoa(p.StepExecutionIndex+1)
	ref := p.Owner + ".provider[" + p.ProviderRef + "].ability[" + s.compiled.Abilities[index].AbilityKey + "]"
	parentKey := parent.plan.InstructionKey
	action := &skillActionRuntime{automaticRule: r, plan: model.SkillActionPlan{InstructionKey: key, BindingKey: r.binding.BindingKey, SkillKey: p.SkillKey, Source: p.Owner, Target: p.Target, AbilityRef: ref, Action: "RECAST", FirstAtMs: s.nowMs, SortOrder: r.plan.SortOrder, ParentInstructionKey: &parentKey, HitBindings: []model.SkillActionHitPreset{}}, binding: r.binding, controlAbilityIndex: index, parentIndex: -1, useRef: p.UseKey}
	s.skillAction = action
	defer func() { s.skillAction = nil; delete(s.processFacts, key) }()
	s.abilityAttemptCount++
	s.statFor(ref).attemptCount++
	s.processFacts[key] = model.ProcessCommandFact{DriverEntryKey: key, UseRef: p.UseKey}
	entry := model.DriverEntry{EntryKey: key, AbilityRef: ref, Source: p.Owner, Target: p.Target, FirstAtMs: s.nowMs}
	return s.handleProcessCommand(entry, -1, s.compiled.Abilities[index], ref)
}

func recastUseKey(window string, index int) string {
	return "recast:" + window + ":" + strconv.Itoa(index)
}

func (s *genericRunState) skillActionForUse(use string) *skillActionRuntime {
	if action := s.skillActionByUse[use]; action != nil {
		return action
	}
	if strings.HasPrefix(use, "recast:") {
		if actual := s.skillUses[use]; actual != nil && actual.plannedAction != nil {
			return actual.plannedAction
		}
	}
	return nil
}

// Acceptance commits its quota and original-deadline timer before the real cast
// event. The execution payload then reads any changes caused by that event.
func (s *genericRunState) acceptRecast(entry model.DriverEntry, p *processRuntime, ability planbundle.CompiledAbility, ref string) *model.EngineError {
	step := p.definition.Steps[p.stepIndex]
	if step.MaximumRecastCount < 1 || p.StepExecutionIndex >= step.MaximumRecastCount {
		return s.rejectProcess(entry, "process_already_finished")
	}
	advance, valid := processTimeAfter(s.nowMs, float64(step.RecastIntervalMs), true)
	if !valid || advance > maxJSONSafeInteger {
		return s.processErr(step.Path+".intervalMs", "invalid safe recast interval deadline", p.UseKey)
	}
	var storage executionFrame
	s.initProcessFrame(&storage, p)
	f := &storage
	staged := f.pendingProcess
	staged.StepExecutionIndex++
	at := s.nowMs
	staged.LastExecutionAtMs, staged.AdvanceAtMs = &at, advance
	staged.castUseKey = recastUseKey(p.UseKey, staged.StepExecutionIndex)
	if s.skillUses[staged.castUseKey] != nil {
		return s.processErr("skillUses", "recast identity already exists", staged.castUseKey)
	}
	staged.castID = s.mintCastInstanceID()
	f.castInstanceID, f.processUseKey, f.processCastPhase = staged.castID, staged.castUseKey, "RECAST"
	f.abilityRef = ref
	f.castOrigin = ability.CastOrigin
	f.countCastOnCommit, f.castStatRef, f.processMomentKind = true, ref, "STEP_EXECUTION"
	f.pendingProcessTimer = staged.StepExecutionIndex < step.MaximumRecastCount
	f.recordProcess(staged, "process_use", "RECAST")
	if err := s.commitProcessFrame(p, f); err != nil {
		return err
	}
	if err := f.maybeDispatchAbilityStartedEvent(ability); err != nil {
		return err
	}
	if p.Status != "active" {
		return nil
	}
	var executionStorage executionFrame
	s.initProcessFrame(&executionStorage, p)
	execution := &executionStorage
	execution.recastExecutionCommitted = true
	if err := s.applyProcessMoment(p, execution, "STEP_EXECUTION", ""); err != nil {
		return err
	}
	// Acceptance already published the one real execution/phase fact.
	execution.processMomentKind = ""
	if err := s.commitProcessFrame(p, execution); err != nil {
		return err
	}
	if err := s.resolveSkillActionMoment(p, "STEP_EXECUTION"); err != nil {
		return err
	}
	if p.StepExecutionIndex == step.MaximumRecastCount {
		return s.completeProcessStep(p)
	}
	return nil
}
