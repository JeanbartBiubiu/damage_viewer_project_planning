package actionflow

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessControlWork 只交换本次控制的入口事实与真实阶段，不提供任意能力执行。
type ProcessControlWork interface {
	// ResolveProcessActor 按原驱动语义解析真实双方。
	ResolveProcessActor(selector, source string) (string, bool)
	// RejectProcessControl 记录普通控制拒绝，不创建使用或消耗额度。
	RejectProcessControl(entry model.DriverEntry, reason string) *model.EngineError
	// ControlMounted 核对当前实际拥有者的有效挂载。
	ControlMounted(owner, provider string, definition uint16) bool
	// ControlSourceDead 查询显式生命是否已经归零，不把缺失生命当作死亡。
	ControlSourceDead(owner string) bool
	// ControlCooldown 查询原普通冷却是否阻挡本次控制。
	ControlCooldown(owner, ref string) (int64, bool)
	// ControlCondition 在本次独立过程帧按原顺序读取条件。
	ControlCondition(process *actionpkg.ProcessView, index int, ability planbundle.CompiledAbility) (bool, *model.EngineError)
	// StartControlledProcess 通过原启动帧接纳指定的真实过程，强化路径保留原局部准备。
	StartControlledProcess(entry model.DriverEntry, index int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, replaced *actionpkg.ProcessView) *model.EngineError
	// AcceptControlledRecast 通过原接纳帧提交重施，再执行读取开始监听之后状态的负载。
	AcceptControlledRecast(entry model.DriverEntry, process *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref string) *model.EngineError
	// ReleaseControlledCharge 在原释放帧执行实际负载、提交和绑定命中。
	ReleaseControlledCharge(process *actionpkg.ProcessView, ref string) *model.EngineError
}

func (s ProcessExecutor) Control(entry model.DriverEntry, entryIndex int, controlAbility planbundle.CompiledAbility, resolvedRef string, now int64, providers []planbundle.CompiledProvider, work ProcessControlWork, phases ProcessPhases) *model.EngineError {
	control := controlAbility.ProcessControl
	fact := s.actions.ProcessFact(entry.EntryKey)
	source, _ := work.ResolveProcessActor(entry.Source, model.SelectorSource)
	target, targetAvailable := work.ResolveProcessActor(entry.Target, source)
	if control.RequireExplicitSelfTarget != nil && *control.RequireExplicitSelfTarget && (entry.Target == "" || !targetAvailable || target != source) {
		return work.RejectProcessControl(entry, "explicit_self_target_required")
	}
	parsed, _ := planbundle.ParseAbilityRef(resolvedRef)
	p := &providers[controlAbility.ProviderIndex].Processes[control.ProcessIndex]
	var instance *actionpkg.ProcessView
	for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
		current := s.actions.ProcessAt(processSlot)
		if current.UseKey() == fact.UseRef {
			instance = current
			break
		}
	}
	if !work.ControlMounted(source, parsed.ProviderRef, controlAbility.ProviderIndex) {
		return work.RejectProcessControl(entry, "provider_unavailable")
	}
	if control.Action == "INITIAL" {
		if instance != nil {
			return work.RejectProcessControl(entry, "use_already_started")
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
					return work.RejectProcessControl(entry, "process_already_active")
				}
			}
		}
		if work.ControlSourceDead(source) {
			return work.RejectProcessControl(entry, "source_dead")
		}
		if (s.actions.ManualCount() > 0 || s.actions.HasAutomatic()) && s.actions.Occupied(source) {
			return work.RejectProcessControl(entry, "action_occupied")
		}
		if _, blocked := work.ControlCooldown(source, resolvedRef); blocked {
			return work.RejectProcessControl(entry, "cooldown_not_ready")
		}
		return work.StartControlledProcess(entry, entryIndex, source, target, parsed.ProviderRef, resolvedRef, controlAbility, p, fact.UseRef, replaced)
	}
	if instance == nil {
		return work.RejectProcessControl(entry, "process_not_started")
	}
	if instance.Owner() != source || instance.ProviderRef() != parsed.ProviderRef || instance.ProcessKey() != p.ProcessKey || instance.Target() != target {
		return work.RejectProcessControl(entry, "process_identity_mismatch")
	}
	if instance.Status() != "active" {
		return work.RejectProcessControl(entry, "process_already_finished")
	}
	if instance.HasExpiry() && now >= instance.Expiry() {
		return work.RejectProcessControl(entry, "process_expired")
	}
	if control.StepKey != "" && control.StepKey != instance.StepKey() {
		return work.RejectProcessControl(entry, "wrong_step")
	}
	if control.Action == "RECAST" {
		if work.ControlSourceDead(source) {
			return work.RejectProcessControl(entry, "source_dead")
		}
		for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
			other := s.actions.ProcessAt(processSlot)
			if other != instance && other.OccupiesAction(source) {
				return work.RejectProcessControl(entry, "action_occupied")
			}
		}
	}
	allowed, conditionErr := work.ControlCondition(instance, entryIndex, controlAbility)
	if conditionErr != nil {
		return conditionErr
	}
	if !allowed {
		return work.RejectProcessControl(entry, "condition_false")
	}
	if control.Action == "RECAST" || control.Action == "CHARGE_RELEASE" {
		if now < instance.AdvanceAtMs() {
			return work.RejectProcessControl(entry, "advance_too_early")
		}
		step := instance.Definition().Steps[instance.StepIndex()]
		if (control.Action == "RECAST" && step.StepType != "RECAST") || (control.Action == "CHARGE_RELEASE" && step.StepType != "CHARGE") {
			return work.RejectProcessControl(entry, "wrong_step")
		}
		if control.Action == "RECAST" {
			return work.AcceptControlledRecast(entry, instance, controlAbility, resolvedRef)
		}
		return work.ReleaseControlledCharge(instance, resolvedRef)
	}
	// Cancel/interruption are explicit successful actions, never merely a request event.
	if control.Action == "INTERRUPT" && control.FailureReason == "SOURCE_DIED" && !work.ControlSourceDead(source) {
		return work.RejectProcessControl(entry, "source_not_dead")
	}
	return s.Finish(instance, "failed", control.FailureReason, resolvedRef, phases)
}
