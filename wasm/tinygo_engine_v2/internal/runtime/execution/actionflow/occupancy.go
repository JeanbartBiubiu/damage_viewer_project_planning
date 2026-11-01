package actionflow

import (
	"sort"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// AttackOccupancyRecords 只借用现有攻击记录的时间和占用投影，不影响数值计算。
type AttackOccupancyRecords interface {
	// OccupancyAttackCount 返回已保留攻击记录数，不用展示数量代替实际攻击数。
	OccupancyAttackCount() int
	// OccupancyAttackStart 读取指定保留攻击的真实开始时刻。
	OccupancyAttackStart(index int) int64
	// SetAttackOccupancy 更新对应保留记录的真实占用贡献。
	SetAttackOccupancy(index int, ready *int64)
}

func (s ProcessExecutor) PrepareOccupancy(changes *actionpkg.ProcessChangeSet, original *actionpkg.ProcessView, now int64) (bool, *model.EngineError) {
	if changes == nil || changes.View() == nil {
		return false, nil
	}
	process := changes.View()
	if !changes.ReconcileOccupancy(original, now) {
		return false, s.error("processInstances.actionOccupancies", "action release requires its real active interval", process.UseKey())
	}
	attack := s.actions.BasicAttack()
	if attack == nil {
		return false, nil
	}
	before, after := original.OccupiesAction(attack.Plan().Source), process.OccupiesAction(attack.Plan().Source)
	return before != after || before && original.ActionDeadline() != process.ActionDeadline(), nil
}

func (s SkillActionExecutor) ValidateDeadline(process *actionpkg.ProcessView, cooldownReady int64) *model.EngineError {
	if process == nil || s.actions.ActionForUse(process.UseKey()) == nil {
		return nil
	}
	if process.AdvanceAtMs() > maxJSONSafeInteger || process.HasExpiry() && process.Expiry() > maxJSONSafeInteger {
		return s.error("planned process requires a safe real step deadline", "processInstances.advanceAtMs")
	}
	if process.HasNextExecution() && process.NextExecutionAt() > maxJSONSafeInteger {
		return s.error("planned segment requires a safe real execution deadline", "processInstances.repeat.nextExecutionAtMs")
	}
	if cooldownReady > maxJSONSafeInteger {
		return s.error("planned cooldown requires a safe actual deadline", "processInstances.cooldown")
	}
	return nil
}

func (s BasicAttackExecutor) Contribution(start, end int64) *int64 {
	if s.actions.BasicAttack() == nil {
		return nil
	}
	value, present := s.actions.OccupancyContribution(s.actions.BasicAttack().Plan().Source, start, end)
	if !present {
		return nil
	}
	return &value
}

func (s BasicAttackExecutor) RefreshContributions(now int64, records AttackOccupancyRecords) {
	if s.actions.BasicAttack() == nil {
		return
	}
	starts := []int64{}
	for index := 0; index < s.actions.ProcessCount(); index++ {
		process := s.actions.ProcessAt(index)
		if process.AbilityRef() == s.actions.BasicAttack().Plan().InitialControlAbilityRef && process.Owner() == s.actions.BasicAttack().Plan().Source {
			starts = append(starts, process.StartedAtMs())
		}
	}
	sort.Slice(starts, func(i, j int) bool { return starts[i] < starts[j] })
	first := now + 1
	if len(starts) > 0 {
		first = starts[0]
	}
	s.actions.SetInitialActionReady(s.Contribution(0, first))
	for index := 0; index < records.OccupancyAttackCount(); index++ {
		startedAt := records.OccupancyAttackStart(index)
		next := now + 1
		for _, start := range starts {
			if start > startedAt {
				next = start
				break
			}
		}
		records.SetAttackOccupancy(index, s.Contribution(startedAt, next))
	}
}
