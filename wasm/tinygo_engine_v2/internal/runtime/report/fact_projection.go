// 已冻结执行事实到报告字段的纯转换；调用者决定读取、暂存与记账时点。
package report

import (
	"math"
	"strconv"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/contract"
)

// DamageDetailOwnership 是原提交位置读取并决定覆盖后的有限归属，不借用行动或帧。
type DamageDetailOwnership struct {
	SkillPlan         bool
	HitOccurrenceID   uint64
	UseRef            string
	InstructionKey    string
	HasInstructionKey bool
	AttackIndex       int
	HasAttackIndex    bool
}

const (
	executeThresholdTypeRatio  = "current_hp_ratio"
	executeThresholdComparison = "strict_below"
)

// CommittedDamageDetails 只在可靠累计允许保留明细后调用；保留缺失、空值、有效零及原字段类型。
func CommittedDamageDetails(ev contract.DamageFact, timeMs int64, ownership DamageDetailOwnership) map[string]interface{} {
	data := DamageEvidenceItem(ev, timeMs).Data
	if ev.HealthOrder != 0 {
		data["healthOrder"] = ev.HealthOrder
	}
	data["owner"] = ev.Owner
	if ev.ProviderDefinitionRef != "" {
		data["providerDefinitionRef"] = ev.ProviderDefinitionRef
		if ev.ProviderActivatedAtMs != nil {
			data["providerActivatedAtMs"] = *ev.ProviderActivatedAtMs
		}
	}
	data["operationPath"] = ev.OperationPath
	data["hpBefore"] = ev.HpBefore
	data["hpAfter"] = ev.HpAfter
	data["sourceHpBefore"], data["sourceHpAfter"] = nil, nil
	if ev.HasSourceHp {
		data["sourceHpBefore"], data["sourceHpAfter"] = ev.SourceHpBefore, ev.SourceHpAfter
	}
	data["castInstanceId"] = ev.CastInstanceID
	data["abilityRef"] = ev.AbilityRef
	data["operationRef"] = ev.OperationRef
	data["useRef"] = ownership.UseRef
	data["attackIndex"] = 0
	if ownership.SkillPlan {
		data["attackIndex"] = nil
		data["hitRef"] = nil
		if ownership.HitOccurrenceID != 0 {
			data["hitRef"] = "hit:" + strconv.FormatUint(uint64(uint32(ownership.HitOccurrenceID)), 10)
		}
	}
	if ownership.HasInstructionKey {
		data["instructionKey"] = ownership.InstructionKey
	}
	data["timeMs"] = timeMs
	if ownership.HasAttackIndex {
		data["attackIndex"] = ownership.AttackIndex
	}
	if ev.EmpoweredAttack != nil {
		data["hitRef"], data["empoweredAttack"] = ev.EmpoweredAttack.HitRef, ev.EmpoweredAttack
	}
	return data
}

// ExecuteEvidenceItem 把已冻结斩杀事实转换为原证据字段，不读取活动状态。
func ExecuteEvidenceItem(ev contract.ExecuteFact, timeMs int64) model.EvidenceItem {
	data := map[string]interface{}{
		"source":         ev.Source,
		"target":         ev.Target,
		"operationRef":   ev.OperationRef,
		"hpBefore":       ev.HpBefore,
		"maxHp":          ev.MaxHp,
		"hpRatio":        ev.HpRatio,
		"threshold":      ev.Threshold,
		"thresholdType":  executeThresholdTypeRatio,
		"comparison":     executeThresholdComparison,
		"killed":         ev.Killed,
		"shieldBypassed": ev.ShieldBypass,
		"phantom":        false,
	}
	if ev.ProviderRef != "" {
		data["providerRef"] = ev.ProviderRef
	}
	if ev.AbilityRef != "" {
		data["abilityRef"] = ev.AbilityRef
	}
	ref := ev.OperationRef
	if ref == "" {
		ref = ev.AbilityRef
	}
	return model.EvidenceItem{
		TimeMs: timeMs,
		Kind:   model.EvidenceKindExecute,
		Ref:    ref,
		Data:   data,
	}
}

// DamageEvidenceItem 把普通或复制伤害事实转换为原证据字段，保留嵌套事实既有所有权。
func DamageEvidenceItem(ev contract.DamageFact, timeMs int64) model.EvidenceItem {
	phase := "original"
	if ev.Phantom {
		phase = "phantom"
	}
	data := map[string]interface{}{
		"phase":           phase,
		"phantom":         ev.Phantom,
		"source":          ev.Source,
		"target":          ev.Target,
		"damageType":      ev.DamageType,
		"rawAmount":       ev.RawAmount,
		"mitigatedAmount": ev.MitigatedAmount,
	}
	if ev.EmpoweredAttack != nil {
		data["empoweredAttack"], data["useRef"] = ev.EmpoweredAttack, ev.ActivationUseRef
	}
	if ev.Outcome != nil {
		data["damageId"] = ev.DamageID
		data["postDefenseDamage"] = ev.Outcome.MitigatedAmount
		data["shieldAbsorbed"] = ev.Outcome.ShieldAbsorbed
		data["actualHpLoss"] = ev.Outcome.HPDamage
		data["overkillDamage"] = math.Max(0, ev.Outcome.MitigatedAmount-ev.Outcome.ShieldAbsorbed-ev.Outcome.HPDamage)
	}
	if ev.ProviderRef != "" {
		data["providerRef"] = ev.ProviderRef
	}
	if ev.AbilityRef != "" {
		data["abilityRef"] = ev.AbilityRef
	}
	if ev.OperationRef != "" {
		data["operationRef"] = ev.OperationRef
	}
	if len(ev.Traits) > 0 {
		data["traits"] = append([]string(nil), ev.Traits...)
	}
	AttachCastProvenance(data, ev.CastInstanceID, ev.CastOrigin)
	if ev.Phantom {
		if ev.RepeatTag != "" {
			data["repeatTag"] = ev.RepeatTag
		}
		if len(ev.ReplayedFrom) > 0 {
			data["replayedFrom"] = ev.ReplayedFrom
		}
	}
	writeCritEvidenceFields(data, ev.Crit)
	if ev.HasPostResistanceEvidence {
		data["resistanceFactor"] = ev.ResistanceFactor
		data["normalPartPostResistance"] = ev.NormalPartPostResistance
		data["critPartPostResistance"] = ev.CritPartPostResistance
	}
	if len(ev.Modifiers) > 0 {
		data["modifiers"] = ev.Modifiers
	}
	ref := ev.AbilityRef
	if ref == "" {
		ref = ev.OperationRef
	}
	return model.EvidenceItem{
		TimeMs: timeMs,
		Kind:   model.EvidenceKindDamage,
		Ref:    ref,
		Data:   data,
	}
}

func writeCritEvidenceFields(data map[string]interface{}, critEv contract.CritEvidence) {
	if !critEv.Present {
		return
	}
	data["eligible"] = critEv.Eligible
	if critEv.Policy != "" {
		data["policy"] = critEv.Policy
	}
	data["baseRawAmount"] = critEv.BaseRawAmount
	if !critEv.Eligible {
		return
	}
	data["chanceRaw"] = critEv.ChanceRaw
	data["chanceEffective"] = critEv.ChanceEffective
	data["originalCritChance"] = critEv.OriginalCritChance
	data["effectiveCritChance"] = critEv.ChanceEffective
	data["multiplier"] = critEv.Multiplier
	data["naturalCritWeight"] = critEv.NaturalWeight
	data["forcedCritWeight"] = critEv.ForcedWeight
	data["naturalCritMultiplier"] = critEv.NaturalMultiplier
	data["forcedCritMultiplier"] = critEv.ForcedMultiplier
	data["normalPart"] = critEv.NormalPart
	data["critPart"] = critEv.CritPart
	data["critAdjustedRawAmount"] = critEv.CritAdjustedRawAmount
}

// AttachCastProvenance 只补充已分配的施放身份与来源，保留编号的原浮点字段类型。
func AttachCastProvenance(data map[string]interface{}, castInstanceID uint64, castOrigin string) {
	if castInstanceID > 0 {
		data["castInstanceId"] = float64(castInstanceID)
	}
	if castOrigin != "" {
		data["castOrigin"] = castOrigin
	}
}

// DamageSnapshotEvidenceData 只读公式使用的冻结伤害快照，不求值或绑定运行上下文。
func DamageSnapshotEvidenceData(snap formula.EventDamageSnapshot) map[string]interface{} {
	data := map[string]interface{}{
		"baseRawAmount":          snap.BaseRawAmount,
		"preMitigationAmount":    snap.PreMitigationAmount,
		"mitigatedAmount":        snap.MitigatedAmount,
		"originalCritChance":     snap.OriginalCritChance,
		"effectiveCritChance":    snap.EffectiveCritChance,
		"forcedCritWeight":       snap.ForcedCritWeight,
		"naturalCritWeight":      snap.NaturalCritWeight,
		"forcedCritMultiplier":   snap.ForcedCritMultiplier,
		"naturalCritMultiplier":  snap.NaturalCritMultiplier,
		"normalPart":             snap.NormalPart,
		"critPart":               snap.CritPart,
		"naturalBranchRawAmount": snap.NaturalBranchRawAmount,
	}
	if snap.HasKilled {
		data["killed"] = snap.Killed
	}
	return data
}
