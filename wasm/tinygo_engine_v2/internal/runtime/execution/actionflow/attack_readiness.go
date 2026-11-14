package actionflow

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// AttackReadiness 只读取本刀门禁原位置的双方、库存和攻速。
type AttackReadiness interface {
	// ReadAttackHP 查询此刻真实生命，不使用上一刀冻结值。
	ReadAttackHP(owner string) float64
	// ReadyAttackAmmo 沿原库存准备位置核对共用弹药，可执行原回充提交。
	ReadyAttackAmmo() (bool, *model.EngineError)
	// ReadAttackSpeed 在库存准备之后读取本刀实际攻速。
	ReadAttackSpeed(owner, key string) float64
}

// AttackTimelineReads 只读取已提交普攻冷却和当前真实库存，不准备或修改状态。
type AttackTimelineReads interface {
	// AttackTimelinePermission 返回现有唯一等待登记的行动许可，不改写攻击冷却。
	AttackTimelinePermission(owner string, key actionpkg.CooldownWaitKey) int64
	// AttackTimelineCooldown 返回实际初始控制的已提交普通期限。
	AttackTimelineCooldown(owner, ref string) int64
	// AttackTimelineInventory 返回当前显式库存或声明默认，保持原有效0语义。
	AttackTimelineInventory(ammo *actionpkg.AmmoView) float64
}

// AttackWaitPublication 是一次已提交等待观察所需的有限时间、终止与生命事实。
type AttackWaitPublication struct {
	Now, End, Next, Cooldown int64
	Stopped, BudgetActive    bool
	StopReason               model.StopReason
	SourceHP, TargetHP       float64
}

func (s BasicAttackExecutor) Admit(initializationPending int, reads AttackReadiness) (bool, *model.EngineError) {
	attack := s.actions.BasicAttack()
	if attack == nil {
		return false, s.error("basic attack event has no plan", "driverPlan.basicAttack")
	}
	if initializationPending != 0 {
		return false, s.error("all source initialization must settle before the first attack", "initialSnapshot")
	}
	if reads.ReadAttackHP(attack.Plan().Source) <= 0 || reads.ReadAttackHP(attack.Plan().Target) <= 0 {
		return false, nil
	}
	if s.actions.Occupied(attack.Plan().Source) {
		return false, s.error("attack cannot start while its source action is occupied", "driverPlan.basicAttack")
	}
	if ready, err := reads.ReadyAttackAmmo(); err != nil || !ready {
		return false, err
	}
	if !validAttackSpeed(reads.ReadAttackSpeed(attack.Plan().Source, attack.Plan().AttackSpeedAttributeKey), attack.Plan().AttackSpeedInputMax) {
		return false, s.error("current attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	return true, nil
}

func (s BasicAttackExecutor) NextTime(now int64, reads AttackTimelineReads) int64 {
	attack := s.actions.BasicAttack()
	ready := s.actions.ReadyAt(attack.Plan().Source, now)
	if permission := reads.AttackTimelinePermission(attack.Plan().Source, AttackCooldownWaitKey(attack)); permission > ready {
		ready = permission
	}
	if cooldown := reads.AttackTimelineCooldown(attack.Plan().Source, attack.Plan().InitialControlAbilityRef); cooldown > ready {
		ready = cooldown
	}
	if ammo := attack.Ammo(); ammo != nil && ammo.Wait().Active && ammo.Wait().ReadyAt > ready && reads.AttackTimelineInventory(ammo) == 0 {
		ready = ammo.Wait().ReadyAt
	}
	return ready
}

func (s BasicAttackExecutor) EventCurrent(at, next int64, generation uint64, ledger *actionpkg.CooldownLedger) bool {
	attack := s.actions.BasicAttack()
	if attack == nil {
		return false
	}
	key := AttackCooldownWaitKey(attack)
	if _, exists := ledger.Wait(key); exists {
		return at == next && ledger.WaitCurrent(key, at, generation)
	}
	return attack.Wait() == nil && generation == 0 && at == next
}

func (s BasicAttackExecutor) PublishWait(input AttackWaitPublication) bool {
	attack := s.actions.BasicAttack()
	if attack == nil {
		return false
	}
	s.actions.SetAttackWindowSettled(input.Next > input.End)
	if attack.StartedCount() == 0 {
		s.actions.SetInitialActionReady(s.Contribution(0, input.Now+1))
	}
	if attack.Current() == nil {
		return false
	}
	if input.Stopped && (input.StopReason == model.StopReasonBudgetExceeded || input.StopReason == model.StopReasonSourceDead || input.StopReason == model.StopReasonTargetDead || input.StopReason == model.StopReasonBothDead) {
		s.actions.SetAttackNext(nil)
		return attack.CurrentRecordIndex() >= 0
	}
	if attack.Wait() == nil {
		return false
	}
	s.actions.SetAttackFinalReady(input.Cooldown, s.Contribution(attack.Current().StartAtMs(), input.Now+1))
	s.actions.SetAttackNext(nil)
	if !attack.WindowSettled() && !s.actions.Dead(attack.Plan().Source) && !s.actions.Dead(attack.Plan().Target) && input.SourceHP > 0 && input.TargetHP > 0 && !input.BudgetActive {
		next := input.Next
		s.actions.SetAttackNext(&next)
	}
	return attack.CurrentRecordIndex() >= 0
}
