package runtime

import (
	"math"

	"tinygo_engine_v2/internal/command"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// damageNumbers 是普通与复制伤害共用的乘区、抗性和暴击分支数值结算。
// 复制仅冻结原金额、暴击分支和入场抗性；条件及金额仍读本笔实际双方。
type damageNumbers struct {
	rawAmount                   float64
	mitigatedAmount             float64
	crit                        frozenCritEvidence
	modifiers                   []map[string]interface{}
	failClosed                  bool
	resistanceFactor            float64
	normalPartPostResistance    float64
	critPartPostResistance      float64
	resistanceBeforePenetration float64
	penetrationPercent          float64
	penetrationFlat             float64
	effectiveResistance         float64
}

func (f *executionFrame) resolveDamageNumbers(
	cmd command.Command, op compilebundle.CompiledOperation, critEv frozenCritEvidence,
	ability compilebundle.CompiledAbility, modifiers []map[string]interface{},
	targetMitigationAttrs, sourcePenetrationAttrs map[string]model.AttributeSlotDef,
) (damageNumbers, *model.EngineError) {
	out := damageNumbers{crit: critEv, modifiers: modifiers}
	traits := append([]string(nil), op.Types...)
	preOutgoingMerged := cmd.Amount
	normalPart, critPart := 0.0, 0.0
	if critEv.present && critEv.eligible {
		normalPart, critPart = critEv.normalPart, critEv.critPart
	}
	var err *model.EngineError
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
	if cmd.Amount == 0 {
		out.resistanceFactor = 1
	} else {
		mitigation, ok := pipeline.MitigateRawDamageWithSource(
			cmd.Amount, cmd.DamageType, targetMitigationAttrs, sourcePenetrationAttrs)
		if !ok {
			out.failClosed = true
			return out, nil
		}
		out.resistanceFactor = mitigation.ResistanceFactor
		out.resistanceBeforePenetration = mitigation.ResistanceBeforePenetration
		out.penetrationPercent = mitigation.PenetrationPercent
		out.penetrationFlat = mitigation.PenetrationFlat
		out.effectiveResistance = mitigation.EffectiveResistance
		mitigatedNormal = mitigation.Amount
		if critEv.present && critEv.eligible {
			mitigatedNormal = normalPart * mitigation.ResistanceFactor
			mitigatedCrit = critPart * mitigation.ResistanceFactor
		}
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
