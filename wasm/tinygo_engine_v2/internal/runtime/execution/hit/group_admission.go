package hit

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

// RuleGroupWork 只交接实际来源事实、原预算归属和已经接纳的共享真实帧。
type RuleGroupWork[Event any] interface {
	// RuleGroupOrigin 在范围核验通过后读取本次原父能力、实际挂载和真实使用。
	RuleGroupOrigin(event Event, context *Context) RuleOrigin
	// RuleGroupReservationFailure 在原额度容量失败点保留本场预算原因。
	RuleGroupReservationFailure(err *model.EngineError)
	// RunRuleGroupFrame 建立原共享帧并运输原凭据；候选仍共用该帧且在原事实点提交。
	RunRuleGroupFrame(event Event, context *Context, group planbundle.CompiledSkillHitRuleGroup, grant RuleGrant, token usage.Reservation, depth int) *model.EngineError
}

// ExecuteAdmittedGroup 完整核对规则组、预留共同额度并执行共享帧；已提交凭据不因尾部失败释放。
func ExecuteAdmittedGroup[Event any](context *Context, group planbundle.CompiledSkillHitRuleGroup, event Event, depth int, identity Identity, ledger *usage.Ledger, work RuleGroupWork[Event]) *model.EngineError {
	if !ValidRuleRange(context, group) {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "rule group candidate range is invalid", group.Path, group.RuleKey)
	}
	grant, err := ruleQuota(context, group, work.RuleGroupOrigin(event, context), identity)
	if err != nil {
		return err
	}
	token, skip, err := ledger.Reserve(grant.Key, grant.UseSkillKey)
	if err != nil {
		work.RuleGroupReservationFailure(err)
		return err
	}
	if skip {
		return nil
	}
	if token == (usage.Reservation{}) {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "matched rule group did not reserve its quota", group.Path, group.RuleKey)
	}
	defer ledger.Release(token)
	return work.RunRuleGroupFrame(event, context, group, grant, token, depth)
}
