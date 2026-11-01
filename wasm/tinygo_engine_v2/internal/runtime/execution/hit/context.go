package hit

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

// Facts 复用共同事件的有限命中事实，不含本包执行上下文。
type Facts = contract.SkillHitFacts

// EmpoweredWait 是真实命中入口捕获的等待身份；实例仍由行动状态持有。
type EmpoweredWait struct {
	Instance *actionpkg.ProcessView
	UseKey   string
	Version  int
	Expires  int64
}

// ContextSeed 指定当前真实命中已取得的事实和只读编译绑定。
type ContextSeed struct {
	Facts
	Ability        planbundle.CompiledAbility
	Plan           *planbundle.CompiledSkillHit
	AbilityRef     string
	EmpoweredWaits []EmpoweredWait
}

// ContextAPI 列出冻结命中执行上下文的有限查询及候选冻结能力。
type ContextAPI interface {
	// View 返回不含执行计划的命中事实值；不重新读取活状态。
	View() Facts
	// FrozenFacts 借用本上下文的有限只读事实；生命周期覆盖其原事件及派生冻结，不得修改。
	FrozenFacts() *Facts
	// Ability 返回本次实际命中的只读能力绑定。
	Ability() planbundle.CompiledAbility
	// Plan 借用本次编译命中计划，仅在本场同步执行内读取。
	Plan() *planbundle.CompiledSkillHit
	// AbilityRef 返回真实来源的完整能力引用。
	AbilityRef() string
	// Waits 借用命中入口捕获的等待列表，调用方不得修改或保留到本次尾部之后。
	Waits() []EmpoweredWait
	// FreezeCandidates 冻结消费候选及规则组条件，期间不执行候选写入。
	FreezeCandidates(selected []int, host SelectionHost) *model.EngineError
	// FreezeAttachedCandidates 只冻结强化负载候选，不引入普通命中规则组。
	FreezeAttachedCandidates(selected []int, host SelectionHost) *model.EngineError
}

// Context 私有保存候选与计划，不能作为通用公式事件快照传递。
type Context struct {
	facts             Facts
	ability           planbundle.CompiledAbility
	plan              *planbundle.CompiledSkillHit
	abilityRef        string
	empoweredWaits    []EmpoweredWait
	matchedIndexes    []int
	matchedRuleGroups []bool
}

var _ ContextAPI = (*Context)(nil)

// NewContext 接收当前命中独占的冻结列表，不复制或重建使用身份。
func NewContext(seed ContextSeed) *Context {
	seed.Facts.HasPlan, seed.Facts.IsBasicAttack, seed.Facts.AbilityRef = seed.Plan != nil, seed.Ability.IsBasicAttack, seed.AbilityRef
	return &Context{facts: seed.Facts, ability: seed.Ability, plan: seed.Plan, abilityRef: seed.AbilityRef, empoweredWaits: seed.EmpoweredWaits}
}

func (c *Context) View() Facts { return c.facts }

func (c *Context) FrozenFacts() *Facts { return &c.facts }

func (c *Context) Ability() planbundle.CompiledAbility { return c.ability }

func (c *Context) Plan() *planbundle.CompiledSkillHit { return c.plan }

func (c *Context) AbilityRef() string { return c.abilityRef }

func (c *Context) Waits() []EmpoweredWait { return c.empoweredWaits }

func (c *Context) FreezeCandidates(selected []int, host SelectionHost) *model.EngineError {
	if err := c.FreezeAttachedCandidates(selected, host); err != nil {
		return err
	}
	if len(c.plan.RuleGroups) == 0 {
		return nil
	}
	c.matchedRuleGroups = make([]bool, len(c.plan.RuleGroups))
	for _, index := range selected {
		candidate := c.plan.Candidates[index]
		groupIndex := candidate.RuleGroupIndex
		if groupIndex < 0 {
			continue
		}
		if groupIndex >= len(c.plan.RuleGroups) {
			return host.HitExecutionError(model.GenericErrRuntimeInvariantFailed, "candidate rule group index is invalid", candidate.Path, candidate.CandidateKey)
		}
		if c.plan.RuleGroups[groupIndex].CandidateStart != index {
			continue
		}
		accepted, err := matchEventValues(candidate, c.facts.HasFirstContact, c.facts.FirstContact, true, c.facts.Blocked, true, host)
		if err != nil {
			return err
		}
		c.matchedRuleGroups[groupIndex] = accepted
	}
	return nil
}

func (c *Context) FreezeAttachedCandidates(selected []int, host SelectionHost) *model.EngineError {
	for _, index := range selected {
		candidate := c.plan.Candidates[index]
		accepted, err := matchEventValues(candidate, c.facts.HasFirstContact, c.facts.FirstContact, true, c.facts.Blocked, true, host)
		if err != nil {
			return err
		}
		if accepted || c.blockedCandidate(candidate) && candidate.InboundBlockEligible {
			c.matchedIndexes = append(c.matchedIndexes, index)
		}
	}
	return nil
}

func (c *Context) blockedCandidate(candidate planbundle.CompiledSkillHitCandidate) bool {
	facts := &c.facts
	return facts.Blocked == 1 && candidate.HasBlockScope &&
		model.ScopeCovers(facts.UnitScope, facts.OccurrenceID, facts.EffectOccurrenceKey, facts.ResultKey, facts.CandidateKey, facts.UseRef,
			candidate.BlockScope, facts.OccurrenceID, candidate.EffectOccurrenceKey, candidate.ResultKey, candidate.CandidateKey, facts.UseRef)
}
