package actionflow

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessStartWork 借用唯一启动帧的有限阶段；任何方法都不更换本次付款前视图。
type ProcessStartWork interface {
	// StartCondition 按明确驱动槽和原能力条件顺序读取本启动帧，不在适配对象中保存驱动。
	StartCondition(entryIndex int) (bool, *model.EngineError)
	// StartAmmo 读取当前启动帧中实际库存，缺失与有效0保持区分。
	StartAmmo() (bool, *model.EngineError)
	// StartCosts 提供同一启动帧的付款前金额与资源暂存。
	StartCosts() ProcessCosts
	// NextStartCast 在全部成本通过并付款后分配本次真实施放身份。
	NextStartCast() uint64
	// PrepareAcceptedStart 绑定已由行动暂存的施放身份，并在原帧暂存跨强化替换。
	PrepareAcceptedStart(replaced *actionpkg.ProcessView) *model.EngineError
	// RunStartMoment 在同一个启动帧同步执行过程开始时点和必要捕获、强化进入。
	RunStartMoment() *model.EngineError
	// CommitStart 在原边界统一提交并派发本启动帧，失败保留原部分成功范围。
	CommitStart() (ActionResult, *model.EngineError)
	// DispatchAcceptedStart 在已提交且仍活动时发布真实能力开始事实。
	DispatchAcceptedStart() *model.EngineError
	// RejectStart 按本次明确驱动记录普通拒绝，不将条件或资源不足当作引擎错误。
	RejectStart(entry model.DriverEntry, reason string) *model.EngineError
}

func (s ProcessExecutor) StartPrepared(entry model.DriverEntry, entryIndex int, process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, replaced *actionpkg.ProcessView, now int64, work ProcessStartWork, phases ProcessPhases) (ActionResult, *model.EngineError) {
	allowed, err := work.StartCondition(entryIndex)
	if err != nil {
		return ActionResult{}, err
	}
	if !allowed {
		return ActionResult{Reason: "condition_false"}, work.RejectStart(entry, "condition_false")
	}
	ready, err := work.StartAmmo()
	if err != nil {
		return ActionResult{}, err
	}
	if !ready {
		return ActionResult{Reason: "ammo_empty"}, work.RejectStart(entry, "ammo_empty")
	}
	affordable, err := s.PrepareCosts(changes, work.StartCosts(), true)
	if err != nil {
		return ActionResult{}, err
	}
	if !affordable {
		return ActionResult{Reason: "resource_insufficient"}, work.RejectStart(entry, "resource_insufficient")
	}
	changes.SetCast(work.NextStartCast(), changes.View().CastUseKey())
	if err := work.PrepareAcceptedStart(replaced); err != nil {
		return ActionResult{}, err
	}
	if err := work.RunStartMoment(); err != nil {
		return ActionResult{}, err
	}
	result, err := work.CommitStart()
	if err != nil {
		return result, err
	}
	if process.Status() != "active" {
		return result, nil
	}
	if err := work.DispatchAcceptedStart(); err != nil {
		return result, err
	}
	if process.Status() != "active" {
		return result, nil
	}
	if process.HasEmpoweredAbility() {
		return result, nil
	}
	return result, s.EnterStep(process, 0, now, phases)
}
