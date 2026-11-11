package actionflow

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessCooldownWork 只借用原帧的数值冷却操作、同一所属暂存账及有限普攻等待读值。
type ProcessCooldownWork interface {
	InitialAttackWaitReads
	// StageActionCooldown 按原来源解析和操作语义暂存已核定期限，不发布状态。
	StageActionCooldown(owner, ref string, ready int64) *model.EngineError
	// WritableProcessCooldown 在原首次写入位置借用该拥有者的唯一冷却暂存账。
	WritableProcessCooldown(owner string) *actionpkg.CooldownLedger
}

func (s ProcessExecutor) StageCooldown(process *actionpkg.ProcessView, ready, now int64, work ProcessCooldownWork) (*actionpkg.AttackWaitView, *model.EngineError) {
	if err := work.StageActionCooldown(process.Owner(), process.AbilityRef(), ready); err != nil {
		return nil, err
	}
	work.WritableProcessCooldown(process.Owner()).CommitOrdinary(actionpkg.AbilityCooldownIdentity(process.Owner(), process.AbilityRef()), ready, now)
	return NewBasicAttackExecutor(s.actions, s.identity).InitialWait(process, ready, now, work)
}
