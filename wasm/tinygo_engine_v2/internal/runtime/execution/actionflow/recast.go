package actionflow

import (
	"strconv"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// RecastReads 只读取当前重施来源和一个独立条件阶段。
type RecastReads interface {
	// RecastMounted 核对真实重施来源仍为有效挂载。
	RecastMounted(owner, provider string, definition uint16) bool
	// RecastCondition 在原刷新位置创建独立过程条件视图，不提前接纳。
	RecastCondition(process *actionpkg.ProcessView, ability planbundle.CompiledAbility) (bool, *model.EngineError)
}

// RecastPhases 按原先后边界交接接纳与负载，开始监听可同步改变后续读值。
type RecastPhases interface {
	// RejectRecast 记录原普通拒绝，不创建新的真实使用。
	RejectRecast(entry model.DriverEntry, reason string) *model.EngineError
	// RecastUseExists 核对将要使用的完整身份是否已经登记。
	RecastUseExists(use string) bool
	// CommitRecastAcceptance 提交真实序号、施放及原期限，再同步发布开始事实。
	CommitRecastAcceptance(process *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref, use string, advance int64) (ActionResult, *model.EngineError)
	// CommitRecastExecution 用开始事实完成后的新帧执行原负载并解析绑定命中。
	CommitRecastExecution(process *actionpkg.ProcessView) *model.EngineError
}

// RecastUseKey 保留同一真实重施窗口内的原使用编号。
func RecastUseKey(window string, index int) string {
	return "recast:" + window + ":" + strconv.Itoa(index)
}
func (s ProcessExecutor) BoundFiniteRecastInitial(entry model.DriverEntry, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, now int64, bindings []planbundle.CompiledSkillActionBinding, abilities []planbundle.CompiledAbility, providers []planbundle.CompiledProvider) bool {
	action := s.actions.CurrentAction()
	if action == nil || action.Accepted() || action.Plan().Action() != "INITIAL" || s.actions.ActionForUse(use) != action || action.UseRef() != use || use != "skill:"+action.Plan().InstructionKey() || int(action.Binding().Slot) >= len(bindings) {
		return false
	}
	binding := bindings[action.Binding().Slot]
	if !binding.HasFiniteRecast || binding.BindingKey != action.Binding().BindingKey || binding.BindingKey != action.Plan().BindingKey() || binding.InitialAbilityIndex != action.ControlAbilityIndex() || len(binding.Controls) == 0 {
		return false
	}
	initial := abilities[binding.InitialAbilityIndex]
	return action.Plan().InstructionKey() == entry.EntryKey && action.Plan().FirstAtMs() == now && entry.FirstAtMs == now && action.Plan().AbilityRef() == ref && binding.Controls[0].AbilityRef == ref &&
		action.Plan().Source() == owner && entry.Source == owner && binding.Source == owner && action.Plan().Target() == target && entry.Target == target && binding.ProviderRef == provider &&
		action.Plan().SkillKey() == definition.SkillKey && binding.SkillKey == definition.SkillKey && binding.Controls[0].ProcessKey == definition.ProcessKey &&
		binding.ProviderDefinitionRef == providers[ability.ProviderIndex].ProviderKey && initial.ProviderIndex == ability.ProviderIndex && initial.AbilityKey == ability.AbilityKey &&
		ability.ProcessControl != nil && ability.ProcessControl.Action == "INITIAL" && !ability.ProcessControl.UseRefFromEvent
}
func (s SkillActionExecutor) RecastCandidate(r *actionpkg.AutomaticRuleView, p *actionpkg.ProcessView, now int64, reads RecastReads) (string, []string, int64, *model.EngineError) {
	if p.StepIndex() < 0 || p.Definition().Steps[p.StepIndex()].StepType != "RECAST" || !p.HasExpiry() || now >= p.Expiry() {
		return model.AutomaticWaitProcessActive, nil, 0, nil
	}
	index := r.Binding().ControlAbilityIndices["RECAST"]
	ability := s.abilities[index]
	if !reads.RecastMounted(p.Owner(), p.ProviderRef(), ability.ProviderIndex) {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	at, reason := p.AdvanceAtMs(), model.AutomaticWaitProcessActive
	if occupied := s.actions.ReadyAt(p.Owner(), now); occupied > at {
		at, reason = occupied, model.AutomaticWaitActionOccupied
	}
	if at >= p.Expiry() {
		return reason, nil, 0, nil
	}
	if at > now {
		return reason, nil, at, nil
	}
	allowed, err := reads.RecastCondition(p, ability)
	if err != nil {
		return "", nil, 0, err
	}
	if !allowed {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	return "", nil, 0, nil
}
func (s ProcessExecutor) AcceptRecast(entry model.DriverEntry, p *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref string, now int64, phases RecastPhases, processPhases ProcessPhases) (ActionResult, *model.EngineError) {
	step := p.Definition().Steps[p.StepIndex()]
	if step.MaximumRecastCount < 1 || p.StepExecutionIndex() >= step.MaximumRecastCount {
		return ActionResult{Reason: "process_already_finished"}, phases.RejectRecast(entry, "process_already_finished")
	}
	advance, valid := actionpkg.ProcessTimeAfter(now, float64(step.RecastIntervalMs), true)
	if !valid || advance > maxJSONSafeInteger {
		return ActionResult{}, s.error(step.Path+".intervalMs", "invalid safe recast interval deadline", p.UseKey())
	}
	use := RecastUseKey(p.UseKey(), p.StepExecutionIndex()+1)
	if phases.RecastUseExists(use) {
		return ActionResult{}, s.error("skillUses", "recast identity already exists", use)
	}
	result, err := phases.CommitRecastAcceptance(p, ability, ref, use, advance)
	if err != nil {
		return result, err
	}
	if p.Status() != "active" {
		return result, nil
	}
	if err := phases.CommitRecastExecution(p); err != nil {
		return result, err
	}
	if p.StepExecutionIndex() == step.MaximumRecastCount {
		return result, s.CompleteStep(p, now, processPhases)
	}
	return result, nil
}
