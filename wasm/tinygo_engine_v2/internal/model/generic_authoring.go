package model

import "encoding/json"

// DamageTypeFormulaDefinition直接保存共同定义原始结构，编译层负责共同校验。
type DamageTypeFormulaDefinition struct {
	DamageType string `json:"damageType"`
	Formula    any    `json:"formula"`
}

func (v *DamageTypeFormulaDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "DamageTypeFormulaDefinition", "damageType formula", "damageType formula"); err != nil {
		return err
	}
	type plain DamageTypeFormulaDefinition
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*v = DamageTypeFormulaDefinition(decoded)
	return nil
}

const (
	OperationKindApplyAttackLink = "apply_attack_link"
	OperationKindApplyHitLink    = "apply_hit_link"
	EventTypeAttackLinkApplied   = "event/attack_link_applied"
	EventTypeHitLinkApplied      = "event/hit_link_applied"
	SkillHitResultAttackLink     = "ATTACK_LINK_APPLICATION"
	SkillHitResultHitLink        = "HIT_LINK_APPLICATION"
)
