package hit

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// AttemptInput 只借用本次真实命中所需的计划、驱动与来源身份。
type AttemptInput struct {
	Ability              planbundle.CompiledAbility
	Plan                 *planbundle.CompiledSkillHit
	AbilityRef, EntryKey string
	SourceKey, TargetKey string
	RootDamageEvent      bool
	MaxEvents            int
	Entries              []model.DriverEntry
	Identity             Identity
}

// AttemptUse 借用实际行动使用的历史资格及命中所属历史，不登记第二份使用。
type AttemptUse struct {
	Present      bool
	HistoryState string
	History      *History
}

// AttemptWork 只运输实际行动阶段、序号写入及已有命中准备能力。
type AttemptWork interface {
	PrepareHost
	// SetHitAttemptOccurrence 在取得序号后立即记入原帧，后续失败也保留该尝试身份。
	SetHitAttemptOccurrence(id uint64)
	// RequireHitAttackProcess 在原序号取得后检查实际普攻过程资格。
	RequireHitAttackProcess(ability planbundle.CompiledAbility, skill, use string) *model.EngineError
	// MarkHitAttack 在首接触与历史核对之前登记原行动的真实命中。
	MarkHitAttack(use string)
	// HitAttemptUse 只在原使用查询点借用现有身份和所属历史，调用期间不得替换历史。
	HitAttemptUse(use string) AttemptUse
	// HitAttemptBudgetError 保存唯一预算原因并返回原命中次数错误。
	HitAttemptBudgetError() *model.EngineError
}

// PrepareAttempt 完整消费真实命中尝试；序号和接触历史不等到帧发布才登记。
func PrepareAttempt(state *State, input AttemptInput, work AttemptWork) (*Context, *model.EngineError) {
	if input.Plan == nil {
		return nil, work.HitExecutionError(model.GenericErrMissingRequiredField, "resolve_skill_hit missing compiled plan", input.AbilityRef, "")
	}
	if input.Plan.ReplacesPrimary {
		return nil, work.HitExecutionError(model.GenericErrRuntimeInvariantFailed, "primary replacement payload requires its actual empowered native attack consumption", input.AbilityRef, input.Plan.SkillKey)
	}
	if input.EntryKey == "" {
		return nil, work.HitExecutionError(model.GenericErrMissingRequiredField, "resolve_skill_hit requires a single driver fact", input.AbilityRef, "")
	}
	fact, found := state.Fact(input.EntryKey)
	if !found {
		return nil, work.HitExecutionError(model.GenericErrMissingRequiredField, "missing skill hit fact for driver entry", "skillHitFacts", input.EntryKey)
	}
	occurrence, accepted := state.NextOccurrence(input.MaxEvents)
	if !accepted {
		return nil, work.HitAttemptBudgetError()
	}
	work.SetHitAttemptOccurrence(occurrence)
	useRef := ""
	if fact.UseRef != nil {
		useRef = *fact.UseRef
	}
	if input.Ability.IsBasicAttack {
		if err := work.RequireHitAttackProcess(input.Ability, input.Plan.SkillKey, useRef); err != nil {
			return nil, err
		}
	}
	work.MarkHitAttack(useRef)
	firstHas, firstValue := false, float64(0)
	if useRef != "" {
		use := work.HitAttemptUse(useRef)
		if !use.Present {
			return nil, work.HitExecutionError(model.GenericErrUnknownRef, "unknown skill use", "skillUses", useRef)
		}
		if use.HistoryState != model.SkillHitHistoryUnknown {
			at := int64(0)
			for _, entry := range input.Entries {
				if entry.EntryKey == input.EntryKey {
					at = entry.FirstAtMs
					break
				}
			}
			firstHas, firstValue = state.FirstContact(input.EntryKey, useRef, use.HistoryState, use.History, at)
		}
		if use.History.TotalCount() >= MaxHistoryContacts {
			return nil, work.HitExecutionError(model.GenericErrRuntimeInvariantFailed, "skill use history exceeded run budget", "skillUses["+useRef+"].priorQualifiedContacts", useRef)
		}
		use.History.Append(input.TargetKey)
	}
	return prepare(state, prepareInput{
		Facts: Facts{HitSequence: fact.Sequence, RootDamageEvent: input.RootDamageEvent, OccurrenceID: occurrence,
			UseRef: useRef, SkillKey: input.Plan.SkillKey, SourceKey: input.SourceKey, TargetKey: input.TargetKey, HasFirstContact: firstHas, FirstContact: firstValue},
		Ability: input.Ability, Plan: input.Plan, AbilityRef: input.AbilityRef, EntryKey: input.EntryKey, Identity: input.Identity,
	}, work)
}
