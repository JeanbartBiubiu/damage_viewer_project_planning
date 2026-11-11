package actionflow

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// GateResult 保留一次驱动尝试的实际门禁结果及能力存在标记。
type GateResult struct {
	Error      *model.EngineError
	Skipped    bool
	Reason     model.AttemptSkipReason
	ReadyAt    int64
	Ability    planbundle.CompiledAbility
	Source     string
	HasAbility bool
}

// GateReads 只提供本次驱动的实际引用及按原位置准备的三类门禁读取。
type GateReads interface {
	// GateActor 解析真实双方并核对当前存在性。
	GateActor(selector, source string) (string, bool)
	// GateAbility 读取已经归一到真实拥有者的能力引用。
	GateAbility(ref string) (planbundle.CompiledAbility, bool)
	// GateCooldown 查询该能力当前唯一普通冷却。
	GateCooldown(owner, ref string) (int64, bool)
	// GateResource 在原位置准备来源状态及付款前资源视图，返回实际资源门禁。
	GateResource(source, target string, ability planbundle.CompiledAbility, ref string, entry model.DriverEntry) (int64, bool, *model.EngineError)
	// GateCondition 按原位置准备作者条件及严格读取语义。
	GateCondition(entry model.DriverEntry, index int, source, target string, ability planbundle.CompiledAbility, ref string) (bool, *model.EngineError)
}

// GateFormulaErrors 只将原求值错误和数值错误绑定回真实公式，不提供求值或执行能力。
type GateFormulaErrors interface {
	// GateEvaluationError 保留原求值错误的类型、路径及公式读取归属。
	GateEvaluationError(program formula.GenericProgramID, issue error, ref string) *model.EngineError
	// GateAmountError 按原公式位置报告非法数值，不将其解释为合法0。
	GateAmountError(program formula.GenericProgramID, message, ref string) *model.EngineError
}

func (s SkillActionExecutor) AttemptGate(entry model.DriverEntry, index int, now, recheck int64, reads GateReads) GateResult {
	source, sourceOK := reads.GateActor(entry.Source, model.SelectorSource)
	target, targetOK := reads.GateActor(entry.Target, source)
	_, sourceSelector := model.ValidCombatantSelectors[entry.Source]
	_, targetSelector := model.ValidCombatantSelectors[entry.Target]
	if !sourceSelector || !targetSelector || !sourceOK || !targetOK {
		return GateResult{Skipped: true, Reason: model.AttemptSkipTargetUnavailable}
	}
	ref := NormalizeAbilityRef(entry.AbilityRef, source, target)
	ability, found := reads.GateAbility(ref)
	if !found {
		return GateResult{Skipped: true, Reason: model.AttemptSkipUnknownAbilityRef}
	}
	result := GateResult{Ability: ability, Source: source, HasAbility: true}
	if ready, blocked := reads.GateCooldown(source, ref); blocked {
		result.Skipped, result.Reason, result.ReadyAt = true, model.AttemptSkipCooldownNotReady, ready
		return result
	}
	ready, blocked, err := reads.GateResource(source, target, ability, ref, entry)
	if err != nil {
		return GateResult{Error: err}
	}
	if blocked {
		result.Skipped, result.Reason, result.ReadyAt = true, model.AttemptSkipResourceInsufficient, ready
		return result
	}
	blocked, err = reads.GateCondition(entry, index, source, target, ability, ref)
	if err != nil {
		return GateResult{Error: err}
	}
	if blocked {
		result.Skipped, result.Reason, result.ReadyAt = true, model.AttemptSkipConditionFalse, now+recheck
	}
	return result
}

func (s SkillActionExecutor) ResourceGate(ability planbundle.CompiledAbility, ref string, now, recheck int64, current float64, context formula.GenericEvalContext, registry *formula.Library, failures GateFormulaErrors) (int64, bool, *model.EngineError) {
	amount, err := registry.Evaluation.EvalContext(ability.Cost.AmountProgram, &context)
	if err != nil {
		return 0, false, failures.GateEvaluationError(ability.Cost.AmountProgram, err, ref)
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return 0, false, failures.GateAmountError(ability.Cost.AmountProgram, "resource cost must be finite and nonnegative", ref)
	}
	if ability.Cost.AllowPartial {
		if current >= 0 {
			return 0, false, nil
		}
	} else if current >= amount {
		return 0, false, nil
	}
	ready := ResourceReadyTimeMs(now, current, amount, recheck)
	if ready <= now {
		ready = now + recheck
	}
	return ready, true, nil
}

// MaterializeCooldowns 等只读转换由实际冷却状态拥有者承接，门禁只消费已准备的唯一账本。
