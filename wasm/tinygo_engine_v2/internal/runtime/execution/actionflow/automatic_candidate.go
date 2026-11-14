package actionflow

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// AutomaticReads 只提供候选入口的真实挂载、库存、作者条件和付款前成本检查。
type AutomaticReads interface {
	// CandidateStunUntil 查询真实来源眩晕许可期限，不修改费用或普通冷却。
	CandidateStunUntil(owner string) (int64, *model.EngineError)
	// RecastCandidate 检查已接受重施窗口的当前实际资格，不创建新的首次使用。
	RecastCandidate(rule *actionpkg.AutomaticRuleView, process *actionpkg.ProcessView) (string, []string, int64, *model.EngineError)
	// CandidateMounted 核对当前真实来源挂载，不以静态定义代替有效实例。
	CandidateMounted(owner, provider string, definition uint16) bool
	// CandidateAmmo 只读实际暂存库存，返回就绪和完整回充期限，不消费弹药。
	CandidateAmmo(rule *actionpkg.AutomaticRuleView, ability planbundle.CompiledAbility) (bool, int64, *model.EngineError)
	// CandidateProcessChecks 在原入口准备同一付款前视图，分别返回作者条件和成本是否允许。
	CandidateProcessChecks(rule *actionpkg.AutomaticRuleView, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess) (bool, bool, *model.EngineError)
}

func (s SkillActionExecutor) Candidate(rule *actionpkg.AutomaticRuleView, now int64, ledger *actionpkg.CooldownLedger, reads AutomaticReads) (string, []string, int64, *model.EngineError) {
	if process := rule.RecastWindow(); process != nil && process.Status() == "active" {
		return reads.RecastCandidate(rule, process)
	}
	if rule.Predecessor() != nil && rule.RemainingQualification() == 0 {
		return model.AutomaticWaitReleaseQualification, []string{rule.Predecessor().Plan().RuleKey()}, 0, nil
	}
	ability := s.abilities[rule.ControlIndex()]
	if until, err := reads.CandidateStunUntil(model.SelectorSource); err != nil {
		return "", nil, 0, err
	} else if until > now {
		for index := 0; index < rule.DependencyCount(); index++ {
			if ready := ledger.ReadyAt(rule.DependencyAt(index)); ready > until {
				until = ready
			}
		}
		if ready := s.actions.ReadyAt(model.SelectorSource, now); ready > until {
			until = ready
		}
		return model.AutomaticWaitControlled, nil, until, nil
	}
	ammoAt, ammoReady := int64(0), true
	hasAmmo := s.providers[ability.ProviderIndex].AmmoBinding != nil
	if hasAmmo {
		if !reads.CandidateMounted(model.SelectorSource, rule.Binding().ProviderRef, ability.ProviderIndex) {
			return model.AutomaticWaitAuthorCondition, nil, 0, nil
		}
		var err *model.EngineError
		ammoReady, ammoAt, err = reads.CandidateAmmo(rule, ability)
		if err != nil {
			return "", nil, 0, err
		}
	}

	if !ledger.IsReady(rule.DependencyAt(0), now) {
		return model.AutomaticWaitOwnCooldown, nil, s.candidateAmmoDeadline(rule, ledger, now, ledger.ReadyAt(rule.DependencyAt(0)), ammoAt, hasAmmo, ammoReady), nil
	}
	deadline := int64(0)
	keys := []string{}
	for index := 0; index < s.actions.AutomaticCount(); index++ {
		dependency := s.actions.AutomaticAt(index)
		for waitIndex := 0; waitIndex < rule.Plan().WaitCount(); waitIndex++ {
			key := rule.Plan().WaitAt(waitIndex)
			if key != dependency.Plan().RuleKey() {
				continue
			}
			id := actionpkg.AbilityCooldownIdentity(model.SelectorSource, dependency.AbilityRef())
			if !ledger.IsReady(id, now) {
				keys = append(keys, key)
				if at := ledger.ReadyAt(id); at > deadline {
					deadline = at
				}
			}
		}
	}
	if len(keys) != 0 {
		return model.AutomaticWaitRelatedCooldown, keys, s.candidateAmmoDeadline(rule, ledger, now, deadline, ammoAt, hasAmmo, ammoReady), nil
	}
	definition := &s.providers[ability.ProviderIndex].Processes[ability.ProcessControl.ProcessIndex]
	if !reads.CandidateMounted(model.SelectorSource, rule.Binding().ProviderRef, ability.ProviderIndex) {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	for index := 0; index < s.actions.ProcessCount(); index++ {
		current := s.actions.ProcessAt(index)
		if current.Owner() == model.SelectorSource && current.ProviderRef() == rule.Binding().ProviderRef && current.ProcessKey() == definition.ProcessKey && current.Status() == "active" {
			return model.AutomaticWaitProcessActive, nil, s.candidateAmmoDeadline(rule, ledger, now, current.ActionDeadline(), ammoAt, hasAmmo, ammoReady), nil
		}
	}
	if s.actions.Occupied(model.SelectorSource) {
		return model.AutomaticWaitActionOccupied, nil, s.candidateAmmoDeadline(rule, ledger, now, s.actions.ReadyAt(model.SelectorSource, now), ammoAt, hasAmmo, ammoReady), nil
	}
	if !ammoReady {
		return model.AutomaticWaitMechanicResource, nil, s.candidateAmmoDeadline(rule, ledger, now, ammoAt, ammoAt, hasAmmo, ammoReady), nil
	}
	condition, affordable, err := reads.CandidateProcessChecks(rule, ability, definition)
	if err != nil {
		return "", nil, 0, err
	}
	if !condition {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	if !affordable {
		return model.AutomaticWaitMechanicResource, nil, 0, nil
	}
	return "", nil, 0, nil
}

func (s SkillActionExecutor) candidateAmmoDeadline(rule *actionpkg.AutomaticRuleView, ledger *actionpkg.CooldownLedger, now, at, ammoAt int64, hasAmmo, ammoReady bool) int64 {
	if !ammoReady && ammoAt > at {
		at = ammoAt
	}
	if hasAmmo {
		for index := 0; index < rule.DependencyCount(); index++ {
			if ready := ledger.ReadyAt(rule.DependencyAt(index)); ready > at {
				at = ready
			}
		}
		if ready := s.actions.ReadyAt(model.SelectorSource, now); ready > at {
			at = ready
		}
		for index := 0; index < s.actions.ProcessCount(); index++ {
			current := s.actions.ProcessAt(index)
			if current.Owner() == model.SelectorSource && current.ProviderRef() == rule.Binding().ProviderRef && current.Status() == "active" && current.ActionDeadline() > at {
				at = current.ActionDeadline()
			}
		}
	}
	return at
}
