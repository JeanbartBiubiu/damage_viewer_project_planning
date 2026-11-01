package actionflow

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// CooldownAttempt 是已核定需改期的实际驱动及其唯一等待，不包含队列。
type CooldownAttempt struct {
	Entry int
	Wait  actionpkg.CooldownWait
}

// CooldownWakePlan 是当前帧的有限唤醒计划，队列容量和写入仍在统一提交边界执行。
type CooldownWakePlan struct {
	Automatic, BasicAttack bool
	Attempts               []CooldownAttempt
}

func (s SkillActionExecutor) PrepareCooldownWake(process *actionpkg.ProcessView, isNew bool) (CooldownWakePlan, *model.EngineError) {
	plan := CooldownWakePlan{Automatic: s.actions.HasAutomatic()}
	if isNew && process != nil {
		if action := s.actions.ActionForUse(process.UseKey()); action != nil && action.AutomaticRule() != nil {
			if rule := action.AutomaticRule(); rule.Predecessor() != nil && rule.Qualification().RemainingCount != 1 {
				err := s.error("initial commit requires an unconsumed predecessor qualification", "automaticSkills.qualifications")
				err.Ref = action.UseRef()
				return plan, err
			}
		}
	}
	return plan, nil
}

func (s SkillActionExecutor) AccumulateCooldownWake(plan CooldownWakePlan, waits []actionpkg.CooldownWait, attackHandled, actorsAlive bool, entries []model.DriverEntry) CooldownWakePlan {
	for _, wait := range waits {
		if attack := s.actions.BasicAttack(); attack != nil && wait.Key == AttackCooldownWaitKey(attack) && !attackHandled && actorsAlive {
			plan.BasicAttack = true
			continue
		}
		if wait.Key.Kind != "while_ready" {
			continue
		}
		for index, entry := range entries {
			if wait.Key.Key == entry.EntryKey && IsWhileReady(entry) {
				plan.Attempts = append(plan.Attempts, CooldownAttempt{Entry: index, Wait: wait})
				break
			}
		}
	}
	return plan
}
