package report

import "tinygo_engine_v2/internal/model"

// Output 保存展示值与已提交数值累计；所有权由 Snapshot 或 Finish 的约定决定。
type Output struct {
	AttackRecords         []model.BasicAttackRecord
	MechanicRecords       []model.MechanicRecord
	DamageRecords         []map[string]interface{}
	DamageBreakdown       []model.DamageBreakdown
	SkillActionRecords    []model.SkillActionRecord
	SkillUseRecords       []model.SkillUseRecord
	HealingRecords        []model.DirectHealingRecord
	ResourceChangeRecords []model.ResourceChangeRecord
	AutomaticRecords      []model.AutomaticSkillRecord
	Evidence              model.EvidenceCollection
}

func cloneData(value interface{}) interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		if typed == nil {
			return typed
		}
		out := make(map[string]interface{}, len(typed))
		for key, item := range typed {
			out[key] = cloneData(item)
		}
		return out
	case []interface{}:
		if typed == nil {
			return typed
		}
		out := make([]interface{}, len(typed))
		for i, item := range typed {
			out[i] = cloneData(item)
		}
		return out
	case []string:
		return cloneSlice(typed)
	case []map[string]interface{}:
		if typed == nil {
			return typed
		}
		out := make([]map[string]interface{}, len(typed))
		for index, row := range typed {
			out[index] = cloneData(row).(map[string]interface{})
		}
		return out
	case []model.ShieldAbsorptionRecord:
		return cloneSlice(typed)
	case *model.ProcessEmpoweredAttack:
		return cloneEmpoweredAttack(typed)
	case *int64:
		return clonePointer(typed)
	case *uint64:
		return clonePointer(typed)
	case *float64:
		return clonePointer(typed)
	case *string:
		return clonePointer(typed)
	case *bool:
		return clonePointer(typed)
	case []float64:
		return cloneSlice(typed)
	case []int64:
		return cloneSlice(typed)
	case []int:
		return cloneSlice(typed)
	case []byte:
		return cloneSlice(typed)
	case map[string]float64:
		out := make(map[string]float64, len(typed))
		for key, value := range typed {
			out[key] = value
		}
		return out
	case map[string]int64:
		out := make(map[string]int64, len(typed))
		for key, value := range typed {
			out[key] = value
		}
		return out
	default:
		return value
	}
}

func (s *State) Snapshot() Output {
	out := Output{
		AttackRecords:         append([]model.BasicAttackRecord{}, s.attackRecords...),
		MechanicRecords:       append([]model.MechanicRecord{}, s.mechanicRecords...),
		DamageRecords:         make([]map[string]interface{}, len(s.damageRecords)),
		DamageBreakdown:       append([]model.DamageBreakdown{}, s.damageBreakdown...),
		SkillActionRecords:    append([]model.SkillActionRecord{}, s.skillActionRecords...),
		SkillUseRecords:       append([]model.SkillUseRecord{}, s.skillUseRecords...),
		HealingRecords:        append([]model.DirectHealingRecord{}, s.healingRecords...),
		ResourceChangeRecords: append([]model.ResourceChangeRecord{}, s.resourceChangeRecords...),
		AutomaticRecords:      append([]model.AutomaticSkillRecord{}, s.automaticRecords...),
		Evidence:              model.EvidenceCollection{Items: make([]model.EvidenceItem, len(s.evidence)), Truncated: s.evidenceTruncated, TruncatedEvidenceCount: s.truncatedEvidenceCount, CountsByKind: make(map[string]int, len(s.evidenceCountsByKind))},
	}
	for i, row := range s.damageRecords {
		out.DamageRecords[i] = cloneData(row).(map[string]interface{})
	}
	for i, row := range s.evidence {
		out.Evidence.Items[i] = row
		if row.Data != nil {
			out.Evidence.Items[i].Data = cloneData(row.Data).(map[string]interface{})
		}
	}
	for key, count := range s.evidenceCountsByKind {
		out.Evidence.CountsByKind[key] = count
	}
	for index, row := range out.AttackRecords {
		out.AttackRecords[index] = cloneAttackRecord(row)
	}
	for index, row := range out.MechanicRecords {
		row.UseRef = clonePointer(row.UseRef)
		row.ReadyAtMs = clonePointer(row.ReadyAtMs)
		out.MechanicRecords[index] = row
	}
	for index, row := range out.SkillActionRecords {
		row.ParentInstructionKey = clonePointer(row.ParentInstructionKey)
		row.Reason = clonePointer(row.Reason)
		row.UseRef = clonePointer(row.UseRef)
		out.SkillActionRecords[index] = row
	}
	for index, row := range out.SkillUseRecords {
		row.EmpoweredAttack = cloneEmpoweredAttack(row.EmpoweredAttack)
		row.HitRef = clonePointer(row.HitRef)
		row.Reason = clonePointer(row.Reason)
		out.SkillUseRecords[index] = row
	}
	for index, row := range out.HealingRecords {
		row.HealthOrder = clonePointer(row.HealthOrder)
		row.UseRef = clonePointer(row.UseRef)
		row.InstructionKey = clonePointer(row.InstructionKey)
		out.HealingRecords[index] = row
	}
	for index, row := range out.ResourceChangeRecords {
		row.Contributors = cloneSlice(row.Contributors)
		out.ResourceChangeRecords[index] = row
	}
	for index, row := range out.AutomaticRecords {
		row.UseRef = clonePointer(row.UseRef)
		row.RelatedRuleKey = clonePointer(row.RelatedRuleKey)
		row.RelatedUseRef = clonePointer(row.RelatedUseRef)
		row.Reason = clonePointer(row.Reason)
		row.NextCheckAtMs = clonePointer(row.NextCheckAtMs)
		out.AutomaticRecords[index] = row
	}
	return out
}

func (s *State) Finish() Output {
	out := Output{AttackRecords: s.attackRecords, MechanicRecords: s.mechanicRecords, DamageRecords: s.damageRecords, DamageBreakdown: s.damageBreakdown, SkillActionRecords: s.skillActionRecords, SkillUseRecords: s.skillUseRecords, HealingRecords: s.healingRecords, ResourceChangeRecords: s.resourceChangeRecords, AutomaticRecords: s.automaticRecords, Evidence: model.EvidenceCollection{Items: s.evidence, Truncated: s.evidenceTruncated, TruncatedEvidenceCount: s.truncatedEvidenceCount, CountsByKind: s.evidenceCountsByKind}}
	if out.Evidence.Items == nil {
		out.Evidence.Items = []model.EvidenceItem{}
	}
	if out.Evidence.CountsByKind == nil {
		out.Evidence.CountsByKind = map[string]int{}
	}
	*s = State{}
	return out
}

func clonePointer[T any](pointer *T) *T {
	if pointer == nil {
		return nil
	}
	value := *pointer
	return &value
}

func cloneSlice[T any](values []T) []T {
	if values == nil {
		return nil
	}
	out := make([]T, len(values))
	copy(out, values)
	return out
}

func cloneEmpoweredAttack(pointer *model.ProcessEmpoweredAttack) *model.ProcessEmpoweredAttack {
	if pointer == nil {
		return nil
	}
	out := *pointer
	out.ReplacedPrimary = clonePointer(out.ReplacedPrimary)
	return &out
}

func cloneAttackRecord(row model.BasicAttackRecord) model.BasicAttackRecord {
	row.MechanicReadyAtMs = clonePointer(row.MechanicReadyAtMs)
	row.ActionReadyAtMs = clonePointer(row.ActionReadyAtMs)
	row.HitAtMs = clonePointer(row.HitAtMs)
	row.ReadyAtMs = clonePointer(row.ReadyAtMs)
	row.FinalReadyAtMs = clonePointer(row.FinalReadyAtMs)
	row.NextStartAtMs = clonePointer(row.NextStartAtMs)
	return row
}
