// DPS modifier condition gates for coefficient bucket candidates.
package runtime

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/model"
)

type dpsModifierGateContext struct {
	DamageType     string
	ActionTypes    []string
	ProcScope      string
	HasCritContext bool
	IsCrit         bool
	AttackerHP     float64
	AttackerMaxHP  float64
	TargetHP       float64
	TargetMaxHP    float64
	AttackerAttrs  map[string]float64
	TargetAttrs    map[string]float64
	AttackerViews  map[string]model.AttributeSnapshotV2
}

func evaluateDPSModifierConditions(conditions []model.DPSModifierConditionV2, gate dpsModifierGateContext) (bool, string) {
	for _, condition := range conditions {
		ok, reason := evaluateDPSModifierCondition(condition, gate)
		if !ok {
			return false, reason
		}
	}
	return true, ""
}

func evaluateDPSModifierCondition(condition model.DPSModifierConditionV2, gate dpsModifierGateContext) (bool, string) {
	metric := strings.TrimSpace(condition.Metric)
	if metric == "" {
		return true, ""
	}
	switch metric {
	case "damage_type":
		return evaluateTextMetricCondition(gate.DamageType, condition), ""
	case "action_type":
		return evaluateTextListMetricCondition(gate.ActionTypes, condition), ""
	case "proc_scope":
		procScope := gate.ProcScope
		if procScope == "" {
			procScope = dpsProcScopeRealBasicAttackOnly
		}
		return evaluateTextMetricCondition(procScope, condition), ""
	case "crit":
		if !gate.HasCritContext {
			return false, "passive damage_modifier crit condition requires crit context"
		}
		if condition.Operator == "eq" || condition.Operator == "" {
			wantCrit := condition.Value != 0 || strings.EqualFold(condition.TextValue, "true")
			if wantCrit != gate.IsCrit {
				return false, ""
			}
		}
		return true, ""
	case "max_hp", "current_hp_pct", "missing_hp_pct":
		role := strings.TrimSpace(condition.SubjectRole)
		if role == "" {
			role = dpsRoleTarget
		}
		value, ok := dpsModifierHPMetricValue(role, metric, gate)
		if !ok {
			return false, "passive damage_modifier condition could not resolve hp metric"
		}
		if !evaluateNumericCondition(value, condition) {
			return false, ""
		}
		return true, ""
	case "attr":
		role := strings.TrimSpace(condition.SubjectRole)
		if role == "" {
			role = dpsRoleAttacker
		}
		value, ok := dpsModifierAttrValue(role, condition.AttrKey, gate)
		if !ok {
			return false, "passive damage_modifier condition could not resolve attr metric"
		}
		if !evaluateNumericCondition(value, condition) {
			return false, ""
		}
		return true, ""
	default:
		return false, "passive damage_modifier has unsupported condition metric " + metric
	}
}

func dpsModifierHPMetricValue(role string, metric string, gate dpsModifierGateContext) (float64, bool) {
	currentHP, maxHP := gate.TargetHP, gate.TargetMaxHP
	if role == dpsRoleAttacker {
		currentHP, maxHP = gate.AttackerHP, gate.AttackerMaxHP
	}
	if maxHP <= 0 || math.IsNaN(maxHP) || math.IsInf(maxHP, 0) {
		return 0, false
	}
	switch metric {
	case "max_hp":
		return maxHP, true
	case "current_hp_pct":
		if currentHP < 0 || math.IsNaN(currentHP) || math.IsInf(currentHP, 0) {
			return 0, false
		}
		return currentHP / maxHP, true
	case "missing_hp_pct":
		if currentHP < 0 || math.IsNaN(currentHP) || math.IsInf(currentHP, 0) {
			return 0, false
		}
		missing := maxHP - currentHP
		if missing < 0 {
			missing = 0
		}
		return missing / maxHP, true
	default:
		return 0, false
	}
}

func dpsModifierAttrValue(role string, attrKey string, gate dpsModifierGateContext) (float64, bool) {
	return dpsModifierAttrValueWithReadKind(role, attrKey, model.AttrReadResolved, gate)
}

func dpsModifierAttrValueWithReadKind(role string, attrKey string, readKind model.AttributeReadKind, gate dpsModifierGateContext) (float64, bool) {
	attrKey = strings.TrimSpace(attrKey)
	if attrKey == "" {
		return 0, false
	}
	attrs := gate.AttackerAttrs
	views := gate.AttackerViews
	if role == dpsRoleTarget {
		attrs = gate.TargetAttrs
		views = nil
	}
	if readKind == "" {
		readKind = model.AttrReadResolved
	}
	value, ok := readDPSModifierAttr(attrs, views, attrKey, readKind)
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value, true
}

func readDPSModifierAttr(attrs map[string]float64, views map[string]model.AttributeSnapshotV2, attrKey string, readKind model.AttributeReadKind) (float64, bool) {
	keys := dpsModifierAttrLookupKeys(attrKey)
	for _, key := range keys {
		if value, ok := readDPSModifierAttrByKey(attrs, views, key, readKind); ok {
			return value, true
		}
	}
	return 0, false
}

func dpsModifierAttrLookupKeys(attrKey string) []string {
	attrKey = strings.TrimSpace(attrKey)
	if attrKey == "" {
		return nil
	}
	keys := []string{attrKey}
	if alias, ok := dpsAttrAliases[attrKey]; ok && alias != attrKey {
		keys = append(keys, alias)
	}
	for alias, canonical := range dpsAttrAliases {
		if canonical == attrKey && alias != attrKey {
			keys = append(keys, alias)
		}
	}
	return keys
}

func readDPSModifierAttrByKey(attrs map[string]float64, views map[string]model.AttributeSnapshotV2, attrKey string, readKind model.AttributeReadKind) (float64, bool) {
	switch readKind {
	case model.AttrReadBase, model.AttrReadCurrent, model.AttrReadMax:
		if views == nil {
			return 0, false
		}
		view, ok := views[attrKey]
		if !ok {
			return 0, false
		}
		switch readKind {
		case model.AttrReadBase:
			return view.Base, true
		case model.AttrReadCurrent:
			return view.Current, true
		case model.AttrReadMax:
			return view.Max, true
		}
	default:
		value, ok := attrs[attrKey]
		return value, ok
	}
	return 0, false
}

func evaluateTextMetricCondition(actual string, condition model.DPSModifierConditionV2) bool {
	actual = strings.TrimSpace(actual)
	switch strings.TrimSpace(condition.Operator) {
	case "", "eq":
		return actual == strings.TrimSpace(condition.TextValue)
	case "neq":
		return actual != strings.TrimSpace(condition.TextValue)
	case "in":
		for _, candidate := range condition.TextValues {
			if actual == strings.TrimSpace(candidate) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func evaluateTextListMetricCondition(actuals []string, condition model.DPSModifierConditionV2) bool {
	set := normalizeStringSet(actuals)
	switch strings.TrimSpace(condition.Operator) {
	case "", "eq":
		return set[strings.TrimSpace(condition.TextValue)]
	case "neq":
		return !set[strings.TrimSpace(condition.TextValue)]
	case "in":
		for _, candidate := range condition.TextValues {
			if set[strings.TrimSpace(candidate)] {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func evaluateNumericCondition(actual float64, condition model.DPSModifierConditionV2) bool {
	if math.IsNaN(actual) || math.IsInf(actual, 0) {
		return false
	}
	operator := strings.TrimSpace(condition.Operator)
	if operator == "" {
		operator = "eq"
	}
	switch operator {
	case "eq":
		return actual == condition.Value
	case "neq":
		return actual != condition.Value
	case "gt":
		return actual > condition.Value
	case "gte":
		return actual >= condition.Value
	case "lt":
		return actual < condition.Value
	case "lte":
		return actual <= condition.Value
	case "between":
		return actual >= condition.Value && actual <= condition.MaxValue
	default:
		return false
	}
}
