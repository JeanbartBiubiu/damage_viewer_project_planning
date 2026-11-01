package listener

import (
	"tinygo_engine_v2/internal/model"
)

// RecoveryRecipient 指定普通挂载监听恢复时的真实拥有者，不影响主动恢复原语。
type RecoveryRecipient struct {
	Mounted       bool
	Owner, Target string
	Path          string
}

// RecoveryHost 只在身份已经正确后读取当前暂存生命及生成原错误。
type RecoveryHost interface {
	// ListenerRecoveryHP 返回指定实际拥有者在本帧的当前暂存生命，不提交。
	ListenerRecoveryHP(owner string) float64
	// ListenerRecoveryError 返回原恢复资格错误，不读取或修改其他状态。
	ListenerRecoveryError(message, path, target string) *model.EngineError
}

// RecoveryProvenance 保存恢复输出实际需要的有限来源与触发伤害事实。
type RecoveryProvenance struct {
	Owner, Provider, Definition, Ability, Operation, Path string
	Use                                                   string
	HasTriggerDamage                                      bool
	DamageID                                              uint64
	DamageSource, DamageTarget                            string
}

// CheckRecoveryRecipient 先核对实际拥有者，再读取当前暂存生命并拒绝死亡后的普通监听恢复。
func CheckRecoveryRecipient(input RecoveryRecipient, host RecoveryHost) (bool, *model.EngineError) {
	if !input.Mounted {
		return false, nil
	}
	if input.Target != input.Owner {
		return false, host.ListenerRecoveryError("ordinary listener recovery requires its actual provider owner", input.Path+".target", input.Target)
	}
	return host.ListenerRecoveryHP(input.Target) <= 0, nil
}

// AttachRecoveryProvenance 将已经冻结的有限来源写入本次证据，不查询活状态。
func AttachRecoveryProvenance(data map[string]interface{}, facts RecoveryProvenance) {
	data["owner"], data["providerRef"] = facts.Owner, facts.Provider
	data["providerDefinitionRef"], data["abilityRef"] = facts.Definition, facts.Ability
	data["operationRef"], data["operationPath"] = facts.Operation, facts.Path
	data["useRef"] = nil
	if facts.Use != "" {
		data["useRef"] = facts.Use
	}
	if facts.HasTriggerDamage && facts.DamageID > 0 {
		data["triggerDamageId"], data["triggerDamageSource"], data["triggerDamageTarget"] = facts.DamageID, facts.DamageSource, facts.DamageTarget
	}
}
