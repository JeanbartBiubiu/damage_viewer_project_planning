package actionflow

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessStageWork 借用本次独立过程帧的有限运输与提交能力，不暴露帧或可写队列。
// 同步重入必须保留各自局部帧，提交回执只属于本次调用。
type ProcessStageWork interface {
	ProcessMomentWork
	// BindProcessCast 绑定本次已决定的控制施放统计，不分配或写过程身份。
	BindProcessCast(ref string, count bool)
	// NextProcessCast 在原重施接纳位置分配本次真实编号。
	NextProcessCast() uint64
	// BindRecastUse 运输已暂存的真实重施身份和来源，不决定步骤或期限。
	BindRecastUse(ref, origin, use string, cast uint64)
	// SetRecastExecution 标记本次负载沿用已提交的重施执行序号。
	SetRecastExecution()
	// RecordProcessUse 在原帧保存真实重施或蓄力释放的使用证据。
	RecordProcessUse(process *actionpkg.ProcessView, kind string)
	// CommitProcessStage 保留原统一提交和派发尾部，返回本帧真实完整事实发布回执。
	// 回执为false不承诺此前没有部分发布；错误不撤回已经发布的事实。
	CommitProcessStage() (bool, *model.EngineError)
	// ObserveProcessFinish 在终结帧已发布后观察结束，即使该次提交尾部随后返回错误。
	ObserveProcessFinish()
	// ResolveProcessHits 在本阶段提交成功后沿原顺序解析绑定命中。
	ResolveProcessHits(kind string) *model.EngineError
	// DispatchProcessStarted 在重施接纳提交成功后同步派发真实开始事实。
	DispatchProcessStarted(ability planbundle.CompiledAbility) *model.EngineError
}

func (s ProcessExecutor) ExecuteMoment(process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, moment ProcessMoment, now int64, operations []planbundle.CompiledOperation, work ProcessStageWork) (ActionResult, *model.EngineError) {
	if moment.enterStep {
		timer, err := s.PrepareStep(changes, moment.stepIndex, now, work)
		if err != nil {
			return ActionResult{}, err
		}
		work.SetProcessTimer(timer)
	}
	if moment.finishStatus != "" {
		work.BindProcessCast(moment.castRef, moment.castRef != "")
		changes.Finish(moment.finishStatus, moment.reason, now)
	}
	if err := s.ApplyMoment(changes, moment.kind, moment.reason, now, false, operations, work); err != nil {
		return ActionResult{}, err
	}
	committed, err := work.CommitProcessStage()
	result := ActionResult{Accepted: moment.castRef != "" && committed}
	if moment.finishStatus != "" && committed {
		work.ObserveProcessFinish()
	}
	if err != nil {
		return result, err
	}
	if moment.resolveHits {
		return result, work.ResolveProcessHits(moment.kind)
	}
	return result, nil
}

func (s ProcessExecutor) ExecuteRecastAcceptance(process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, ability planbundle.CompiledAbility, ref, use string, advance, now int64, work ProcessStageWork) (ActionResult, *model.EngineError) {
	step := process.Definition().Steps[process.StepIndex()]
	changes.AcceptRecast(advance, now, work.NextProcessCast(), use)
	pending := changes.View()
	work.BindRecastUse(ref, ability.CastOrigin, pending.CastUseKey(), pending.CastID())
	work.BindProcessCast(ref, true)
	work.SetProcessMoment("STEP_EXECUTION", false)
	work.SetProcessTimer(pending.StepExecutionIndex() < step.MaximumRecastCount)
	work.RecordProcessUse(pending, "RECAST")
	committed, err := work.CommitProcessStage()
	result := ActionResult{Accepted: committed}
	if err != nil {
		return result, err
	}
	return result, work.DispatchProcessStarted(ability)
}

func (s ProcessExecutor) ExecuteRecastExecution(process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, now int64, operations []planbundle.CompiledOperation, work ProcessStageWork) *model.EngineError {
	work.SetRecastExecution()
	if err := s.ApplyMoment(changes, "STEP_EXECUTION", "", now, true, operations, work); err != nil {
		return err
	}
	work.SetProcessMoment("", false)
	if _, err := work.CommitProcessStage(); err != nil {
		return err
	}
	return work.ResolveProcessHits("STEP_EXECUTION")
}

func (s ProcessExecutor) ExecuteChargeRelease(process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, ref string, now int64, operations []planbundle.CompiledOperation, work ProcessStageWork, phases ProcessPhases) (ActionResult, *model.EngineError) {
	work.BindProcessCast(ref, true)
	work.RecordProcessUse(changes.View(), "CHARGE_RELEASE")
	if err := s.ApplyMoment(changes, "STEP_EXECUTION", "", now, false, operations, work); err != nil {
		return ActionResult{}, err
	}
	committed, err := work.CommitProcessStage()
	result := ActionResult{Accepted: committed}
	if err != nil {
		return result, err
	}
	if err := work.ResolveProcessHits("STEP_EXECUTION"); err != nil {
		return result, err
	}
	return result, s.CompleteStep(process, now, phases)
}
