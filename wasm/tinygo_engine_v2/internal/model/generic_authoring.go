package model

import (
	"encoding/json"
	"errors"
	"strconv"
)

// DamageTypeFormulaDefinition 声明防御结算位置的五阶段公式；类型按目录身份精确匹配。
type DamageTypeFormulaDefinition struct {
	DamageType string            `json:"damageType"`
	Formula    DamageTypeFormula `json:"formula"`
}

type DamageTypeFormula struct {
	ResistanceBeforePenetration GenericFormulaExpr `json:"resistanceBeforePenetration"`
	PenetrationPercent          GenericFormulaExpr `json:"penetrationPercent"`
	PenetrationFlat             GenericFormulaExpr `json:"penetrationFlat"`
	EffectiveResistance         GenericFormulaExpr `json:"effectiveResistance"`
	ResistanceFactor            GenericFormulaExpr `json:"resistanceFactor"`
}

var DamageStageKeys = [5]string{
	"RESISTANCE_BEFORE_PENETRATION", "PENETRATION_PERCENT", "PENETRATION_FLAT", "EFFECTIVE_RESISTANCE", "RESISTANCE_FACTOR",
}

var DamageStageFields = [5]string{
	"resistanceBeforePenetration", "penetrationPercent", "penetrationFlat", "effectiveResistance", "resistanceFactor",
}

func DamageStageIndex(key string) (int, bool) {
	for i, candidate := range DamageStageKeys {
		if key == candidate {
			return i, true
		}
	}
	return 0, false
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

func (v *DamageTypeFormula) UnmarshalJSON(data []byte) error {
	fields := "resistanceBeforePenetration penetrationPercent penetrationFlat effectiveResistance resistanceFactor"
	if err := processJSONShape(data, "DamageTypeFormula", fields, fields); err != nil {
		return err
	}
	var stages map[string]json.RawMessage
	if err := json.Unmarshal(data, &stages); err != nil {
		return err
	}
	for _, field := range DamageStageFields {
		nodes := 0
		if err := validateDamageFormulaJSON(stages[field], "DamageTypeFormula."+field, 1, &nodes); err != nil {
			return err
		}
	}
	type plain DamageTypeFormula
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*v = DamageTypeFormula(decoded)
	return nil
}

func validateDamageFormulaJSON(data []byte, path string, depth int, nodes *int) error {
	(*nodes)++
	if depth > 32 || *nodes > 256 {
		return errors.New(path + " exceeds the defense formula depth or node limit")
	}
	var node map[string]json.RawMessage
	if err := json.Unmarshal(data, &node); err != nil {
		return err
	}
	var op string
	if err := json.Unmarshal(node["op"], &op); err != nil {
		return errors.New(path + ".op is required")
	}
	allowed := "op"
	switch op {
	case "const":
		allowed += " value"
	case "read":
		allowed += " path"
	case "add", "sub", "mul", "div", "min", "max":
		allowed += " args"
	default:
		return errors.New(path + ".op is outside the four author node kinds")
	}
	if err := processJSONShape(data, path, allowed, allowed); err != nil {
		return err
	}
	if op != "const" && op != "read" {
		var operands []json.RawMessage
		if err := json.Unmarshal(node["args"], &operands); err != nil || len(operands) != 2 {
			return errors.New(path + ".args requires exactly two operands")
		}
		for i, child := range operands {
			if err := validateDamageFormulaJSON(child, path+".args["+strconv.Itoa(i)+"]", depth+1, nodes); err != nil {
				return err
			}
		}
	}
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
