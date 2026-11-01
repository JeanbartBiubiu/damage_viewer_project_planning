package actionflow

import (
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

// PlannedCastStart 是实际开始事件与其冻结快照的有限身份，不推导缺失字段。
type PlannedCastStart struct {
	EventType, Source, Target, CastOrigin, UseKey, UseSource, UseSkillKey string
	CastID                                                                uint64
	Snapshot                                                              contract.EventSnapshot
}

// PlannedCastUses 只借用已经登记的原使用，不创建或接受新行动。
type PlannedCastUses interface {
	// PlannedCastUse 返回完整真实使用，未登记时返回nil。
	PlannedCastUse(use string) *actionpkg.UseView
}

func (s SkillActionExecutor) AcceptedCastStart(ev PlannedCastStart, now int64, bindings []planbundle.CompiledSkillActionBinding, uses PlannedCastUses) bool {
	if ev.EventType != "event/ability_started" || ev.CastID == 0 || !ev.Snapshot.HasUse ||
		ev.Snapshot.UseKey != ev.UseKey || ev.Snapshot.UseSource != ev.UseSource || ev.Snapshot.UseSkillKey != ev.UseSkillKey ||
		ev.Snapshot.EventSourceKey != ev.Source || ev.Snapshot.EventTargetKey != ev.Target ||
		ev.Snapshot.CastInstanceID != ev.CastID || ev.Snapshot.CastOrigin != ev.CastOrigin {
		return false
	}
	use := uses.PlannedCastUse(ev.UseKey)
	if use == nil || use.UseKey() != ev.UseKey || use.Source() != ev.UseSource || use.SkillKey() != ev.UseSkillKey ||
		use.CastID() != ev.CastID || !use.ProcessReference().Present || !use.ActionReference().Present {
		return false
	}
	p, action := s.actions.Process(use.ProcessReference()), s.actions.Action(use.ActionReference())
	if action == nil {
		return false
	}
	if p == nil || action != s.actions.CurrentAction() || !action.Accepted() || p.CastID() != use.CastID() ||
		p.Owner() != ev.Source || p.Owner() != ev.UseSource || p.Target() != ev.Target || p.SkillKey() != ev.UseSkillKey ||
		p.CastUseKey() != ev.UseKey || action.UseRef() != p.UseKey() || action.Plan().Source() != p.Owner() || action.Plan().Target() != p.Target() ||
		action.Plan().SkillKey() != p.SkillKey() || action.Plan().FirstAtMs() != now {
		return false
	}
	root, rootUse := s.actions.ActionForUse(p.UseKey()), uses.PlannedCastUse(p.UseKey())
	if root == nil || !root.Accepted() || root.Plan().Action() != "INITIAL" || root.UseRef() != p.UseKey() ||
		rootUse == nil || rootUse.ProcessReference() != use.ProcessReference() || s.actions.Action(rootUse.ActionReference()) != root ||
		int(root.Binding().Slot) >= len(bindings) {
		return false
	}
	binding := bindings[root.Binding().Slot]
	if binding.BindingKey != root.Plan().BindingKey() || binding.BindingKey != action.Plan().BindingKey() ||
		binding.BindingKey != action.Binding().BindingKey || binding.Slot != action.Binding().Slot ||
		binding.Source != p.Owner() || binding.ProviderRef != p.ProviderRef() || binding.ProviderRef != action.Binding().ProviderRef ||
		binding.ProviderDefinitionRef != action.Binding().ProviderDefinitionRef || binding.SkillKey != p.SkillKey() ||
		root.ControlAbilityIndex() != binding.InitialAbilityIndex || int(action.ControlAbilityIndex()) >= len(s.abilities) {
		return false
	}
	controlIndex, ok := binding.ControlAbilityIndices[action.Plan().Action()]
	if !ok || controlIndex != action.ControlAbilityIndex() {
		return false
	}
	ability := s.abilities[controlIndex]
	if ability.ProcessControl == nil || ability.ProcessControl.Action != action.Plan().Action() || ability.ProcessControl.UseRefFromEvent ||
		ability.ProcessControl.ProcessKey != p.ProcessKey() || ability.SkillKey != p.SkillKey() || ability.CastOrigin != ev.CastOrigin ||
		int(ability.ProviderIndex) >= len(s.providers) || s.providers[ability.ProviderIndex].ProviderKey != binding.ProviderDefinitionRef {
		return false
	}
	boundControl := false
	for _, control := range binding.Controls {
		if control.Action == action.Plan().Action() && control.ProcessKey == p.ProcessKey() && control.AbilityRef == action.Plan().AbilityRef() {
			boundControl = true
			break
		}
	}
	if !boundControl {
		return false
	}
	switch action.Plan().Action() {
	case "INITIAL":
		return action == root && use == rootUse && p.UseKey() == ev.UseKey && p.StartedAtMs() == now && p.AbilityRef() == action.Plan().AbilityRef()
	case "RECAST":
		return action != root && action.Plan().ParentInstructionKey() != nil && *action.Plan().ParentInstructionKey() == root.Plan().InstructionKey() &&
			action.AcceptedUseRef() == ev.UseKey && ev.UseKey != p.UseKey() && p.StepIndex() >= 0 && p.StepIndex() < len(p.Definition().Steps) &&
			p.Definition().Steps[p.StepIndex()].StepType == "RECAST" && p.StepExecutionIndex() > 0 && p.HasLastExecution() && p.LastExecution() == now
	default:
		return false
	}
}
