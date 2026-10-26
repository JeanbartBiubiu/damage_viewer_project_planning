package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// The same process constructor also serves externally supplied and event-bound
// uses. Only the real current planned INITIAL may establish this new graph.
func (s *Engine) isBoundFiniteRecastInitial(entry model.DriverEntry, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string) bool {
	action := s.actions.CurrentAction()
	if action == nil || action.Accepted() || action.Plan().Action() != "INITIAL" || s.actions.ActionForUse(use) != action || action.UseRef() != use || use != "skill:"+action.Plan().InstructionKey() || int(action.Binding().Slot) >= len(s.compiled.SkillActionBindings) {
		return false
	}
	binding := s.compiled.SkillActionBindings[action.Binding().Slot]
	if !binding.HasFiniteRecast || binding.BindingKey != action.Binding().BindingKey || binding.BindingKey != action.Plan().BindingKey() || binding.InitialAbilityIndex != action.ControlAbilityIndex() || len(binding.Controls) == 0 {
		return false
	}
	initial := s.compiled.Abilities[binding.InitialAbilityIndex]
	return action.Plan().InstructionKey() == entry.EntryKey && action.Plan().FirstAtMs() == s.loop.TimeMs() && entry.FirstAtMs == s.loop.TimeMs() && action.Plan().AbilityRef() == ref && binding.Controls[0].AbilityRef == ref &&
		action.Plan().Source() == owner && entry.Source == owner && binding.Source == owner && action.Plan().Target() == target && entry.Target == target && binding.ProviderRef == provider &&
		action.Plan().SkillKey() == definition.SkillKey && binding.SkillKey == definition.SkillKey && binding.Controls[0].ProcessKey == definition.ProcessKey &&
		binding.ProviderDefinitionRef == s.compiled.Providers[ability.ProviderIndex].ProviderKey && initial.ProviderIndex == ability.ProviderIndex && initial.AbilityKey == ability.AbilityKey &&
		ability.ProcessControl != nil && ability.ProcessControl.Action == "INITIAL" && !ability.ProcessControl.UseRefFromEvent
}

func (s *Engine) automaticRecastCandidate(r *actionpkg.AutomaticRuleView, p *actionpkg.ProcessView) (string, []string, int64, *model.EngineError) {
	if p.StepIndex() < 0 || p.Definition().Steps[p.StepIndex()].StepType != "RECAST" || !p.HasExpiry() || s.loop.TimeMs() >= p.Expiry() {
		return model.AutomaticWaitProcessActive, nil, 0, nil
	}
	index := r.Binding().ControlAbilityIndices["RECAST"]
	ability := s.compiled.Abilities[index]
	if !s.processMounted(p.Owner(), p.ProviderRef(), ability.ProviderIndex) {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	at, reason := p.AdvanceAtMs(), model.AutomaticWaitProcessActive
	if occupied := s.actionReadyAt(p.Owner()); occupied > at {
		at, reason = occupied, model.AutomaticWaitActionOccupied
	}
	if at >= p.Expiry() {
		return reason, nil, 0, nil
	}
	if at > s.loop.TimeMs() {
		return reason, nil, at, nil
	}
	s.refreshProviderAwareAttributes(p.Owner(), p.Target())
	var frame Frame
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

func (s *Engine) runAutomaticRecast(r *actionpkg.AutomaticRuleView, p *actionpkg.ProcessView) *model.EngineError {
	parent := s.actions.ActionForUse(p.UseKey())
	if parent == nil || !parent.Accepted() {
		return s.processErr("automaticSkills", "recast requires its real accepted window", p.UseKey())
	}
	index := r.Binding().ControlAbilityIndices["RECAST"]
	key := parent.Plan().InstructionKey() + ":recast:" + strconv.Itoa(p.StepExecutionIndex()+1)
	ref := p.Owner() + ".provider[" + p.ProviderRef() + "].ability[" + s.compiled.Abilities[index].AbilityKey + "]"
	parentKey := parent.Plan().InstructionKey()
	action := actionpkg.NewSkillAction(actionpkg.SkillActionSeed{AutomaticRule: r, Plan: model.SkillActionPlan{InstructionKey: key, BindingKey: r.Binding().BindingKey, SkillKey: p.SkillKey(), Source: p.Owner(), Target: p.Target(), AbilityRef: ref, Action: "RECAST", FirstAtMs: s.loop.TimeMs(), SortOrder: r.Plan().SortOrder(), ParentInstructionKey: &parentKey, HitBindings: []model.SkillActionHitPreset{}}, Binding: r.Binding(), ControlAbilityIndex: index, ParentIndex: -1, UseRef: p.UseKey()})
	s.actions.SetCurrentAction(action)
	defer func() { s.actions.SetCurrentAction(nil); s.actions.RemoveProcessFact(key) }()
	s.report.Attempt(ref)
	s.actions.SetProcessFact(key, model.ProcessCommandFact{DriverEntryKey: key, UseRef: p.UseKey()})
	entry := model.DriverEntry{EntryKey: key, AbilityRef: ref, Source: p.Owner(), Target: p.Target(), FirstAtMs: s.loop.TimeMs()}
	return s.handleProcessCommand(entry, -1, s.compiled.Abilities[index], ref)
}

func recastUseKey(window string, index int) string {
	return "recast:" + window + ":" + strconv.Itoa(index)
}

func (s *Engine) skillActionForUse(use string) *actionpkg.SkillActionView {
	if action := s.actions.ActionForUse(use); action != nil {
		return action
	}
	if strings.HasPrefix(use, "recast:") {
		if actual := s.skillUses[use]; actual != nil && actual.identity.ActionReference().Present {
			return s.actions.Action(actual.identity.ActionReference())
		}
	}
	return nil
}

// Acceptance commits its quota and original-deadline timer before the real cast
// event. The execution payload then reads any changes caused by that event.
func (s *Engine) acceptRecast(entry model.DriverEntry, p *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref string) *model.EngineError {
	step := p.Definition().Steps[p.StepIndex()]
	if step.MaximumRecastCount < 1 || p.StepExecutionIndex() >= step.MaximumRecastCount {
		return s.rejectProcess(entry, "process_already_finished")
	}
	advance, valid := actionpkg.ProcessTimeAfter(s.loop.TimeMs(), float64(step.RecastIntervalMs), true)
	if !valid || advance > maxJSONSafeInteger {
		return s.processErr(step.Path+".intervalMs", "invalid safe recast interval deadline", p.UseKey())
	}
	var storage Frame
	s.initProcessFrame(&storage, p)
	f := &storage
	staged := f.pendingProcess
	use := recastUseKey(p.UseKey(), staged.StepExecutionIndex()+1)
	if s.skillUses[use] != nil {
		return s.processErr("skillUses", "recast identity already exists", use)
	}
	f.processChanges.AcceptRecast(advance, s.loop.TimeMs(), s.mintCastInstanceID(), use)
	f.castInstanceID, f.processUseKey, f.processCastPhase = staged.CastID(), staged.CastUseKey(), "RECAST"
	f.abilityRef = ref
	f.castOrigin = ability.CastOrigin
	f.countCastOnCommit, f.castStatRef, f.processMomentKind = true, ref, "STEP_EXECUTION"
	f.pendingProcessTimer = staged.StepExecutionIndex() < step.MaximumRecastCount
	f.recordProcess(staged, "process_use", "RECAST")
	if err := s.commitProcessFrame(p, f); err != nil {
		return err
	}
	if err := f.maybeDispatchAbilityStartedEvent(ability); err != nil {
		return err
	}
	if p.Status() != "active" {
		return nil
	}
	var executionStorage Frame
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
	if p.StepExecutionIndex() == step.MaximumRecastCount {
		return s.completeProcessStep(p)
	}
	return nil
}
