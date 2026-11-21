package actionflow

import (
	"sort"

	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessStunReads 在提交后读取实际控制，重入标记只覆盖本次同步过程失败收敛。
type ProcessStunReads interface {
	// ProcessStunUntil 返回该拥有方当前实际有限眩晕截止；无控制为0。
	ProcessStunUntil(owner string) (int64, *model.EngineError)
	// ProcessStunSettling 查询同一同步收敛是否已经进入。
	ProcessStunSettling() bool
	// BeginProcessStun 开始有界失败收敛，防止失败帧重入原活动过程。
	BeginProcessStun()
	// EndProcessStun 在当前同步收敛返回时释放标记。
	EndProcessStun()
}

func (s ProcessExecutor) FailStunnedProcesses(now int64, reads ProcessStunReads, phases ProcessPhases) *model.EngineError {
	if reads.ProcessStunSettling() || s.actions.ProcessCount() == 0 {
		return nil
	}
	reads.BeginProcessStun()
	defer reads.EndProcessStun()
	for {
		pending := false
		for i := 0; i < s.actions.ProcessCount(); i++ {
			process := s.actions.ProcessAt(i)
			if !stunInterruptible(process) {
				continue
			}
			until, err := reads.ProcessStunUntil(process.Owner())
			if err != nil {
				return err
			}
			if until > now {
				pending = true
				break
			}
		}
		if !pending {
			return nil
		}
		ordered := s.actions.ProcessViews()
		sort.Slice(ordered, func(i, j int) bool { return ordered[i].StableKey() < ordered[j].StableKey() })
		for _, process := range ordered {
			if !stunInterruptible(process) {
				continue
			}
			until, err := reads.ProcessStunUntil(process.Owner())
			if err != nil {
				return err
			}
			if until > now {
				if err := s.Finish(process, "failed", "CONTROLLED", "", phases); err != nil {
					return err
				}
				if process.Status() == "active" {
					return s.error("processInstances", "controlled process finish did not publish progress", process.UseKey())
				}
			}
		}
		// 同步失败效果可能改变先前实例的控制或新增实例。
		// 每次完成必须发布进展，派生工作仍消费原命令与实例额度。
	}
}

func stunInterruptible(process *actionpkg.ProcessView) bool {
	if process.Status() != "active" || process.StepIndex() < 0 || process.StepIndex() >= len(process.Definition().Steps) {
		return false
	}
	kind := process.Definition().Steps[process.StepIndex()].StepType
	return kind == "CHARGE" || kind == "CHANNEL"
}
