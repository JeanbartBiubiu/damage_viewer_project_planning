package hit

import (
	"strconv"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// CountedStartFacts 是当前真实原生普攻开始和使用登记的有限投影。
type CountedStartFacts struct {
	HasAttack, HasCurrent, Ready, HasUse, AlreadyReserved bool
	Owner, SkillKey, CurrentUse, Target                   string
	UseSource, UseSkill                                   string
	StartedAt                                             int64
}

// CountedWindowHost 只借用当前强化等待列表及实际挂载，不借出行动控制。
type CountedWindowHost interface {
	// EmpoweredWindowCount 返回当前强化等待数，不冻结或修改列表。
	EmpoweredWindowCount() int
	// EmpoweredWindowAt 借用当前序号的过程视图，只在本次同步准备期间读取。
	EmpoweredWindowAt(index int) *actionpkg.ProcessView
	// EmpoweredMountLive 查询实际拥有者的指定挂载，保留原开始时的资格范围。
	EmpoweredMountLive(owner, provider string, definition uint16) bool
}

// CountedStart 保存已经暂存的消耗请求；调用方按原帧边界统一发布。
type CountedStart struct {
	Original *actionpkg.ProcessView
	Changes  *actionpkg.ProcessChangeSet
	Index    int
}

// CountedCompletion 是原窗口结束请求的独占暂存；零值表示当前窗口已经结束。
type CountedCompletion struct {
	Original *actionpkg.ProcessView
	Changes  *actionpkg.ProcessChangeSet
}

// CountedHitInput 只包含当前原生命中、已预留窗口与原激活历史。
type CountedHitInput struct {
	Original    *actionpkg.ProcessView
	Index       int
	UseKey      string
	UseSource   string
	EventSource string
	Target      string
	Facts       Facts
	Mounted     bool
	History     ActivationHistory
	NowMs       int64
}

// CountedHit 保存本次实际命中对原窗口的独占暂存和双使用关联。
type CountedHit struct {
	Original    *actionpkg.ProcessView
	Changes     *actionpkg.ProcessChangeSet
	Association *model.ProcessEmpoweredAttack
}

// CountedPayloadHost 仅在共享帧执行已预留负载，不推进等待步骤和期限。
type CountedPayloadHost[Event, Binding any] interface {
	ProcessMomentHost[Binding]
	// RecordCountedExecution 暂存原有执行时点事实，不执行步骤转移。
	RecordCountedExecution(process *actionpkg.ProcessView)
	// EmpoweredPayload 在同一共享帧执行本次负载。
	EmpoweredPayload(event Event, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload planbundle.CompiledAbility) *model.EngineError
}

// CountedMissFacts 只描述原生普攻真正完成且没有命中的已提交事实。
type CountedMissFacts struct {
	HasAttack, HasCurrent, Completed, HasHit bool
	CurrentUse, UseSource, UseSkill          string
	Owner, SkillKey                          string
}

// PrepareCountedStart 按原顺序选择唯一窗口并暂存真实开始消耗，不发布事实。
func PrepareCountedStart(facts CountedStartFacts, use, target string, nowMs int64, host CountedWindowHost, identity Identity) (CountedStart, *model.EngineError) {
	if !facts.HasAttack {
		return CountedStart{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "counted attack consumption requires its actual native attack plan", "driverPlan.basicAttack", use)
	}
	var selected *actionpkg.ProcessView
	for index := 0; index < host.EmpoweredWindowCount(); index++ {
		p := host.EmpoweredWindowAt(index)
		if !p.HasEmpoweredWindow() || p.Owner() != facts.Owner || p.Status() != "active" || !p.HasExpiry() || nowMs >= p.Expiry() {
			continue
		}
		if selected != nil {
			return CountedStart{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "an actual attack cannot choose between simultaneous counted windows", "processInstances", use)
		}
		selected = p
	}
	if selected == nil {
		return CountedStart{}, nil
	}
	if !facts.HasCurrent || facts.CurrentUse != use || facts.StartedAt != nowMs || !facts.Ready || facts.Target != target ||
		!facts.HasUse || facts.UseSource != facts.Owner || facts.UseSkill != facts.SkillKey || facts.AlreadyReserved ||
		!host.EmpoweredMountLive(selected.Owner(), selected.ProviderRef(), selected.Ability().ProviderIndex) {
		return CountedStart{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "counted window consumption requires the actual accepted native attack start", "attackStartFacts", use)
	}
	changes := actionpkg.StageProcess(selected)
	index, allowed := changes.ReserveEmpowered(use, target, nowMs)
	if !allowed {
		return CountedStart{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "attack window has no remaining charge", "processInstances.empoweredAttackWindow", changes.View().UseKey())
	}
	return CountedStart{Original: selected, Changes: changes, Index: index}, nil
}

// StageCountedStart 在原开始帧暂存真实消耗，并在耗尽时执行窗口完成；不提交。
func StageCountedStart[Binding any](frame *Frame, prepared CountedStart, use *actionpkg.UseView, nowMs int64, host ProcessMomentHost[Binding]) *model.EngineError {
	frame.StageMutation(prepared.Original, prepared.Changes)
	frame.StageReservation(use, prepared.Original, prepared.Index)
	p := prepared.Changes.View()
	if p.WindowConsumed() == p.WindowMaximum() {
		if err := CompleteCountedWindow(prepared.Changes, nowMs, host); err != nil {
			return err
		}
		frame.StageFinished(p)
	}
	return nil
}

// PrepareCountedCompletion 仅为仍活动的原窗口创建结束暂存，不重新推测已预留普攻的命中。
func PrepareCountedCompletion(original *actionpkg.ProcessView) CountedCompletion {
	if original.Status() != "active" {
		return CountedCompletion{}
	}
	return CountedCompletion{Original: original, Changes: actionpkg.StageProcess(original)}
}

// StageCountedCompletion 在原窗口结束帧执行完成时点，保留待命中预留和原步骤身份。
func StageCountedCompletion[Binding any](frame *Frame, prepared CountedCompletion, nowMs int64, host ProcessMomentHost[Binding]) *model.EngineError {
	frame.StageMutation(prepared.Original, prepared.Changes)
	if err := CompleteCountedWindow(prepared.Changes, nowMs, host); err != nil {
		return err
	}
	frame.StageFinished(prepared.Changes.View())
	return nil
}

// PrepareCountedHit 核对原预留和当前真实命中，沿原时点暂存已解决消耗。
func PrepareCountedHit(input CountedHitInput, identity Identity) (CountedHit, *model.EngineError) {
	p := input.Original
	if p == nil {
		return CountedHit{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "native attack has an invalid process reference", "skillUses", input.UseKey)
	}
	if !p.HasEmpoweredWindow() || input.Index < 0 || input.Index >= p.ConsumptionCount() {
		return CountedHit{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "native attack has an invalid counted-window reservation", "skillUses", input.UseKey)
	}
	reservation := p.Consumption(input.Index)
	if reservation.ResolvedAtMs != nil {
		return CountedHit{}, nil
	}
	if reservation.UseRef != input.UseKey || reservation.Target != input.Target || input.UseSource != p.Owner() || input.EventSource != p.Owner() || !input.Facts.IsBasicAttack || input.Facts.HitSequence == nil || !input.Mounted {
		return CountedHit{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "counted payload must retain its original actual attack identity", "skillHitFacts", input.UseKey)
	}
	if !CompleteActivationHistory(p, input.History) {
		return CountedHit{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "counted window requires its actual activation history", "skillUses", p.UseKey())
	}
	changes := actionpkg.StageProcess(p)
	hit := "hit:" + strconv.FormatUint(input.Facts.OccurrenceID, 10)
	changes.ResolveEmpowered(input.Index, input.NowMs, hit, *input.Facts.HitSequence)
	association := &model.ProcessEmpoweredAttack{UseRef: input.UseKey, HitRef: hit, Target: input.Target}
	changes.SetEmpoweredAttack(association)
	return CountedHit{Original: p, Changes: changes, Association: association}, nil
}

// CompleteCountedWindow 在原完成边界执行两个过程时点，实际消耗不因此变成已命中。
func CompleteCountedWindow[Binding any](changes *actionpkg.ProcessChangeSet, nowMs int64, host ProcessMomentHost[Binding]) *model.EngineError {
	target := changes.View().Target()
	binding := host.BeginEmpoweredProcess(changes, target, nil)
	defer host.EndEmpoweredProcess(binding)
	if err := host.EmpoweredProcessMoment(changes, target, nil, "STEP_COMPLETE"); err != nil {
		return err
	}
	changes.Finish("complete", "", nowMs)
	return host.EmpoweredProcessMoment(changes, target, nil, "PROCESS_COMPLETE")
}

// ExecuteCountedPayload 保留等待步骤，仅在当前真实命中执行预留负载和原时点事实。
func ExecuteCountedPayload[Event, Binding any](frame *Frame, event Event, prepared CountedHit, payload planbundle.CompiledAbility, host CountedPayloadHost[Event, Binding]) *model.EngineError {
	binding := host.BeginEmpoweredProcess(prepared.Changes, prepared.Association.Target, prepared.Association)
	host.RecordCountedExecution(prepared.Changes.View())
	err := host.EmpoweredPayload(event, prepared.Changes, prepared.Association, payload)
	host.EndEmpoweredProcess(binding)
	if err != nil {
		return err
	}
	frame.StageMutation(prepared.Original, prepared.Changes)
	frame.StageContact(prepared.Changes.View(), *prepared.Association)
	return nil
}

// CountedMissMatches 仅允许实际原生未命中续接关闭原预留，不从窗口完成推测未命中。
func CountedMissMatches(use string, facts CountedMissFacts) bool {
	return facts.HasAttack && facts.HasCurrent && facts.CurrentUse == use && facts.Completed && !facts.HasHit &&
		facts.UseSource == facts.Owner && facts.UseSkill == facts.SkillKey
}

// ValidateCountedMiss 先核对原生未命中事实，再核对原过程引用；实际解决由行动所有者原位发布。
func ValidateCountedMiss(use string, facts CountedMissFacts, original *actionpkg.ProcessView, identity Identity) *model.EngineError {
	if !CountedMissMatches(use, facts) {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "a missed reservation requires its actual completed native attack", "attackStartFacts", use)
	}
	if original == nil {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "native attack has an invalid process reference", "skillUses", use)
	}
	return nil
}
