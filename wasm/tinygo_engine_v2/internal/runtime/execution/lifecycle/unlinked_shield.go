package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ShieldPreparation 只按原操作时点准备并求值严格护盾期限，不获取发布能力。
type ShieldPreparation interface {
	// ShieldDeadline 保留原帧严格读值和公式错误归属，只返回此盾真实截止时刻。
	ShieldDeadline(op plan.CompiledOperation, ability plan.CompiledAbility) (int64, *model.EngineError)
}

func (e *Executor) StageUnlinkedShield(op plan.CompiledOperation, ability plan.CompiledAbility, source, target string, amount float64, instances *effectpkg.InstanceChangeSet, preparation ShieldPreparation) (ShieldExpiry, *model.EngineError) {
	reference := op.ShieldRef
	if reference == "" {
		reference = "shield:auto"
	}
	expiry := int64(0)
	if op.HasShieldDuration {
		var err *model.EngineError
		expiry, err = preparation.ShieldDeadline(op, ability)
		if err != nil {
			return ShieldExpiry{}, err
		}
		reference = e.identities.NextShield(reference)
	}
	e.identities.ReserveShield(reference)
	instances.SetShields(instances.Shields().Append(effectpkg.Shield{ShieldRef: reference, Source: source, Owner: target,
		Remaining: amount, ExpireAt: expiry, State: effectpkg.ObjectState(map[string]interface{}{})}))
	return ShieldExpiry{CombatantKey: target, ShieldRef: reference, ExpireAt: expiry}, nil
}
