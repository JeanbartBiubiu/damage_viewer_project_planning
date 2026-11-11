package actionflow

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// AbilityTermsWork 只借用原普通能力帧的求值与暂存，不发布角色或冷却。
type AbilityTermsWork interface {
	// AbilityTermAmount 在调用时读取原能力的当前帧上下文，保留付款前后差异。
	AbilityTermAmount(program formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError)
	// ChangeAbilityResource 沿原资源操作暂存已决定的金额，不另加付款或舍入政策。
	ChangeAbilityResource(owner, resource string, delta float64, ability planbundle.CompiledAbility) *model.EngineError
	// StageAbilityCooldown 沿原普通冷却操作暂存期限，不发布或写入过程总冷却来源。
	StageAbilityCooldown(owner, ref string, ready int64) *model.EngineError
}

func (s SkillActionExecutor) StageAbilityTerms(ability planbundle.CompiledAbility, owner, ref string, now int64, work AbilityTermsWork) *model.EngineError {
	if ability.Cost != nil && ability.Cost.HasAmount {
		amount, err := work.AbilityTermAmount(ability.Cost.AmountProgram, ability)
		if err != nil {
			return err
		}
		if err := work.ChangeAbilityResource(owner, ability.Cost.ResourceKey, -amount, ability); err != nil {
			return err
		}
	}
	if ability.Cooldown != nil && ability.Cooldown.HasDuration {
		duration, err := work.AbilityTermAmount(ability.Cooldown.DurationProgram, ability)
		if err != nil {
			return err
		}
		return work.StageAbilityCooldown(owner, ref, now+int64(duration))
	}
	return nil
}
