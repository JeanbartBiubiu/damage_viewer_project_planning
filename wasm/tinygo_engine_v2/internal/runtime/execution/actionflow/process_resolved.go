package actionflow

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessCompletion 只读取原使用的已提交接触历史并发布实际终结事实。
type ProcessCompletion interface {
	// ResolvedProcessUse 返回真实已登记使用与已提交接触总数，缺失使用返回nil。
	ResolvedProcessUse(use string) (*actionpkg.UseView, int)
	// DispatchResolvedProcess 在原完成时点捕获有限事件值并同步派发，沿用原事件预算和因果。
	DispatchResolvedProcess(process *actionpkg.ProcessView, contactCount int, types []string) *model.EngineError
}

func (s ProcessExecutor) PublishResolved(process *actionpkg.ProcessView, declared bool, completion ProcessCompletion) *model.EngineError {
	if process.Definition().EntryKind == model.ProcessEntrySkillHitPassive {
		return nil
	}
	if process.HasEmpoweredWindow() && (process.Status() != "complete" || process.WindowPending() != 0 || process.EmpoweredResolvedPublished()) {
		return nil
	}
	if !declared {
		return nil
	}
	use, contacts := completion.ResolvedProcessUse(process.UseKey())
	if use == nil || use.HistoryState() != model.SkillHitHistoryComplete || use.Source() != process.Owner() || use.SkillKey() != process.SkillKey() {
		return s.error("event.skill_use.contactCount", "completed process requires its real complete skill-use history", process.UseKey())
	}
	types := []string{model.EventTypeProcessResolved, "ability/" + process.SkillKey(), "event/process_resolved/" + process.SkillKey() + "/" + process.ProcessKey()}
	if err := completion.DispatchResolvedProcess(process, contacts, types); err != nil {
		return err
	}
	if process.HasEmpoweredWindow() {
		s.actions.MarkEmpoweredResolved(process)
	}
	return nil
}
