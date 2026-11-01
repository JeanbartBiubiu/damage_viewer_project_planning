package hit

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// CandidateHost 保留候选真实帧及跨行动的同步交接；Scope 由根层独立拥有。
type CandidateHost[Scope any] interface {
	// HitCandidate 同步执行一个已选候选的真实子帧及提交尾部。
	HitCandidate(scope Scope, context *Context, candidate planbundle.CompiledSkillHitCandidate, blocked bool, depth int) *model.EngineError
	// HitRuleGroup 同步进入一组共用真实帧及共同额度的候选。
	HitRuleGroup(scope Scope, context *Context, group planbundle.CompiledSkillHitRuleGroup, depth int) *model.EngineError
	// HitPrimaryReplacement 同步尝试该原生主体的实际强化替换，返回是否已经替换。
	HitPrimaryReplacement(scope Scope, context *Context, candidate int, depth int) (bool, *model.EngineError)
	// HitExecutionError 生成归属本场的命中错误，不发布状态。
	HitExecutionError(code model.GenericErrCode, message, path, ref string) *model.EngineError
}

// RuleFrameHost 只暴露同组候选的连续执行及唯一提交，不借出根帧。
type RuleFrameHost interface {
	// HitRuleCandidate 清理上一候选输出，在共享暂存中执行本候选并暂存其伤害事实。
	HitRuleCandidate(context *Context, candidate planbundle.CompiledSkillHitCandidate, blocked bool) *model.EngineError
	// CommitHitRule 发布整个规则组，再同步处理已经生成的事实。
	CommitHitRule() *model.EngineError
}

// OperationHost 提供候选作者结果所需的有限实际属性槽事实。
type OperationHost interface {
	// HitPersistentAttributeSlot 查询实际目标上修正落点的显式属性槽，不物化或发布状态。
	HitPersistentAttributeSlot(target, modifierTarget, key string) bool
	// HitExecutionError 生成归属本场的命中错误，不发布状态。
	HitExecutionError(code model.GenericErrCode, message, path, ref string) *model.EngineError
}

// AttachedFrameHost 仅执行当前共享强化帧内的一个候选，不创建子帧或当场派发。
type AttachedFrameHost interface {
	// AttachedHitCandidate 复用当前强化暂存及输出，保留该候选的根伤害资格。
	AttachedHitCandidate(context *Context, candidate planbundle.CompiledSkillHitCandidate, blocked, rootDamage bool) *model.EngineError
}

// ExecuteCandidates 按冻结原序执行候选、完整规则组及原生主体替换。
func ExecuteCandidates[Scope any](context *Context, scope Scope, depth int, host CandidateHost[Scope]) *model.EngineError {
	for _, index := range context.matchedIndexes {
		candidate := context.plan.Candidates[index]
		if len(context.plan.RuleGroups) != 0 && candidate.RuleGroupIndex >= 0 {
			groupIndex := candidate.RuleGroupIndex
			if groupIndex >= len(context.plan.RuleGroups) || groupIndex >= len(context.matchedRuleGroups) {
				return host.HitExecutionError(model.GenericErrRuntimeInvariantFailed, "rule group requires its frozen predicate", candidate.Path, candidate.CandidateKey)
			}
			group := context.plan.RuleGroups[groupIndex]
			if index != group.CandidateStart || !context.matchedRuleGroups[groupIndex] {
				continue
			}
			if err := host.HitRuleGroup(scope, context, group, depth); err != nil {
				return err
			}
			continue
		}
		if candidate.AttackDamageRole == planbundle.AttackDamageRolePrimary && len(context.empoweredWaits) != 0 {
			replaced, err := host.HitPrimaryReplacement(scope, context, index, depth)
			if err != nil {
				return err
			}
			if replaced {
				continue
			}
		}
		if err := host.HitCandidate(scope, context, candidate, context.blockedCandidate(candidate), depth); err != nil {
			return err
		}
	}
	return nil
}

// ValidRuleRange 核对编译组区间，须在额度预留及真实帧创建之前调用。
func ValidRuleRange(context *Context, group planbundle.CompiledSkillHitRuleGroup) bool {
	return group.CandidateStart >= 0 && group.CandidateCount > 0 && group.CandidateStart <= len(context.plan.Candidates)-group.CandidateCount
}

// ExecuteRuleGroup 在同一真实暂存中执行组内原序候选，完成后才发布整组。
func ExecuteRuleGroup(context *Context, group planbundle.CompiledSkillHitRuleGroup, host RuleFrameHost) *model.EngineError {
	for _, candidate := range context.plan.Candidates[group.CandidateStart : group.CandidateStart+group.CandidateCount] {
		if err := host.HitRuleCandidate(context, candidate, context.blockedCandidate(candidate)); err != nil {
			return err
		}
	}
	return host.CommitHitRule()
}

// ExecuteAttachedCandidates 在同一强化暂存内按冻结原序执行实际负载。
func ExecuteAttachedCandidates(context *Context, rootDamage bool, host AttachedFrameHost) *model.EngineError {
	for _, index := range context.matchedIndexes {
		candidate := context.plan.Candidates[index]
		if err := host.AttachedHitCandidate(context, candidate, context.blockedCandidate(candidate), rootDamage); err != nil {
			return err
		}
	}
	return nil
}

// CandidateOperations 返回当前候选借用的编译操作，先核对持久目标属性结果的完整落点。
func CandidateOperations(context *Context, candidate planbundle.CompiledSkillHitCandidate, blocked bool, operations []planbundle.CompiledOperation, providers []planbundle.CompiledProvider, host OperationHost) ([]planbundle.CompiledOperation, *model.EngineError) {
	start := candidate.OperationStart
	end := start + candidate.OperationCount
	if int(end) > len(operations) {
		return nil, host.HitExecutionError(model.GenericErrRuntimeInvariantFailed, "skill hit candidate operation range out of bounds", candidate.Path, candidate.CandidateKey)
	}
	ops := operations[start:end]
	if blocked || candidate.Semantic.ResultType != model.SkillHitResultAttributeChange || candidate.Semantic.Moment != model.SkillHitMomentPersistent || candidate.Semantic.Target != model.SkillHitTargetTARGET {
		return ops, nil
	}
	for _, operation := range ops {
		if operation.Operation != "apply_provider" {
			continue
		}
		providerIndex := -1
		for index := range providers {
			if providers[index].ProviderKey == operation.ProviderDefinitionRef {
				providerIndex = index
				break
			}
		}
		if providerIndex < 0 {
			return nil, host.HitExecutionError(model.GenericErrUnknownRef, "persistent target attribute result requires its complete definition", operation.Path, operation.ProviderDefinitionRef)
		}
		for _, modifier := range providers[providerIndex].Modifiers {
			key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			if !host.HitPersistentAttributeSlot(context.facts.TargetKey, modifier.Target, key) {
				return nil, host.HitExecutionError(model.GenericErrMissingRequiredField, "persistent target attribute result requires an explicit attribute slot on the actual hit target", operation.Path, key)
			}
		}
	}
	return ops, nil
}
