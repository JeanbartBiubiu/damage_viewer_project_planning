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
	// PrepareAcceptedStart 在全部成本通过并支付后分配真实施放身份和暂存强化替换。
	PrepareAcceptedStart(replaced *actionpkg.ProcessView) *model.EngineError
	// RunStartMoment 在同一个启动帧同步执行过程开始时点和必要捕获、强化进入。
	RunStartMoment() *model.EngineError
	// CommitStart 在原边界统一提交并派发本启动帧，失败保留原部分成功范围。
	CommitStart() *model.EngineError
	// DispatchAcceptedStart 在已提交且仍活动时发布真实能力开始事实。
	DispatchAcceptedStart() *model.EngineError
	// RejectStart 按本次明确驱动记录普通拒绝，不将条件或资源不足当作引擎错误。
	RejectStart(entry model.DriverEntry, reason string) *model.EngineError
}

func (s ProcessExecutor) StartPrepared(entry model.DriverEntry, entryIndex int, process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, replaced *actionpkg.ProcessView, now int64, work ProcessStartWork, phases ProcessPhases) *model.EngineError {
	allowed, err := work.StartCondition(entryIndex)
	if err != nil {
		return err
	}
	if !allowed {
		return work.RejectStart(entry, "condition_false")
	}
	ready, err := work.StartAmmo()
	if err != nil {
		return err
	}
	if !ready {
		return work.RejectStart(entry, "ammo_empty")
	}
	affordable, err := s.PrepareCosts(changes, work.StartCosts(), true)
	if err != nil {
		return err
	}
	if !affordable {
		return work.RejectStart(entry, "resource_insufficient")
	}
	if err := work.PrepareAcceptedStart(replaced); err != nil {
		return err
	}
	if err := work.RunStartMoment(); err != nil {
		return err
	}
	if err := work.CommitStart(); err != nil {
		return err
	}
	if process.Status() != "active" {
		return nil
	}
	if err := work.DispatchAcceptedStart(); err != nil {
		return err
	}
	if process.Status() != "active" {
		return nil
	}
	if process.HasEmpoweredAbility() {
		return nil
	}
	return s.EnterStep(process, 0, now, phases)
}
