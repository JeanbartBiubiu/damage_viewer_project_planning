package runtime

import (
	"math"

	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// damageNumbers 是普通与复制伤害共用的乘区、抗性和暴击分支数值结算。
// 复制保留原金额、暴击分支及完整冻结防御视图；乘区仍读本笔实际双方。
type damageNumbers struct {
	rawAmount                float64
	mitigatedAmount          float64
	crit                     frozenCritEvidence
	modifiers                []map[string]interface{}
	failClosed               bool
	resistanceFactor         float64
	normalPartPostResistance float64
	critPartPostResistance   float64
}

func (f *executionFrame) resolveDamageNumbers(
	cmd command.Command, op planbundle.CompiledOperation, critEv frozenCritEvidence,
	ability planbundle.CompiledAbility, modifiers []map[string]interface{},
) (damageNumbers, *model.EngineError) {
	out := damageNumbers{crit: critEv, modifiers: modifiers}
	def, err := f.requireConfiguredDefense(cmd.DamageType, op.Path)
	if err != nil {
		return out, err
	}
	traits := append([]string(nil), op.Types...)
	preOutgoingMerged := cmd.Amount
	normalPart, critPart := 0.0, 0.0
	if critEv.present && critEv.eligible {
		normalPart, critPart = critEv.normalPart, critEv.critPart
	}
	cmd.Amount, out.modifiers, err = f.applyPipelineDamageModifiers(
		cmd.Source, cmd.Source, cmd.Target, "damage", "outgoing_pre_mitigation", cmd.Amount,
		ability, cmd.DamageType, traits, out.modifiers)
	if err != nil {
		return out, err
	}
	if critEv.present && critEv.eligible {
		normalPart, critPart = projectCritPartsAfterOutgoing(preOutgoingMerged, normalPart, critPart, cmd.Amount)
		out.crit.normalPart, out.crit.critPart = normalPart, critPart
	}
	out.rawAmount = cmd.Amount
	if math.IsNaN(cmd.Amount) || math.IsInf(cmd.Amount, 0) || cmd.Amount < 0 {
		out.failClosed = true
		return out, nil
	}

	mitigatedNormal, mitigatedCrit := 0.0, 0.0
	mitigation, err := f.resolveConfiguredDefense(cmd, def)
	if err != nil {
		return out, err
	}
	out.resistanceFactor = mitigation.factor
	mitigatedNormal = mitigation.amount
	if critEv.present && critEv.eligible {
		mitigatedNormal = normalPart * mitigation.factor
		mitigatedCrit = critPart * mitigation.factor
	}
	out.normalPartPostResistance, out.critPartPostResistance = mitigatedNormal, mitigatedCrit
	if critEv.present && critEv.eligible {
		mitigatedCrit, out.modifiers, err = f.applyPipelineDamageModifiers(
			cmd.Target, cmd.Source, cmd.Target, "damage", "incoming_crit_part_post_mitigation",
			mitigatedCrit, ability, cmd.DamageType, traits, out.modifiers)
		if err != nil {
			return out, err
		}
	}
	out.mitigatedAmount = mitigatedNormal + mitigatedCrit
	out.mitigatedAmount, out.modifiers, err = f.applyPipelineDamageModifiers(
		cmd.Target, cmd.Source, cmd.Target, "damage", "incoming_post_mitigation",
		out.mitigatedAmount, ability, cmd.DamageType, traits, out.modifiers)
	if err != nil {
		return out, err
	}
	if math.IsNaN(out.mitigatedAmount) || math.IsInf(out.mitigatedAmount, 0) || out.mitigatedAmount < 0 {
		out.failClosed = true
	}
	return out, nil
}
