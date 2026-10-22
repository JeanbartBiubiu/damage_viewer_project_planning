package model

import (
	"encoding/json"
	"errors"
)

const OperationKindConsumeTargetMark = "consume_target_mark"

// TargetMarkDefinition is one owned finite target field consumed by a real hit.
type TargetMarkDefinition struct {
	StateKey          string               `json:"stateKey"`
	StateScope        string               `json:"stateScope"`
	TriggerKind       string               `json:"triggerKind"`
	TriggerAbilityRef string               `json:"triggerAbilityRef"`
	DamageBlockScope  string               `json:"damageBlockScope"`
	Damage            *OperationDefinition `json:"damage"`
	Restore           *OperationDefinition `json:"restore,omitempty"`
}

func (v *OperationDefinition) UnmarshalJSON(data []byte) error {
	type plain OperationDefinition
	fields, err := strictJSONObject(data, "OperationDefinition")
	if err != nil {
		return err
	}
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	_, present := fields["targetMark"]
	if decoded.Operation == OperationKindConsumeTargetMark {
		if err := processJSONShape(data, "consume_target_mark", "operation target ref targetMark", "operation target ref targetMark"); err != nil {
			return err
		}
	} else if present {
		return errors.New("targetMark is only allowed on consume_target_mark")
	}
	*v = OperationDefinition(decoded)
	return nil
}

func (v *TargetMarkDefinition) UnmarshalJSON(data []byte) error {
	const required = "stateKey stateScope triggerKind triggerAbilityRef damageBlockScope damage"
	if err := targetMarkJSONShape(data, "targetMark", required+" restore", required); err != nil {
		return err
	}
	type plain TargetMarkDefinition
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	fields, _ := strictJSONObject(data, "targetMark")
	if err := targetMarkJSONShape(fields["damage"], "targetMark.damage",
		"operation target ref damageType amount types vampQualification vampOverrides critEligible",
		"operation target ref damageType amount types vampQualification"); err != nil {
		return err
	}
	damageFields, _ := strictJSONObject(fields["damage"], "targetMark.damage")
	if err := targetMarkExpressionJSON(damageFields["amount"], "targetMark.damage.amount"); err != nil {
		return err
	}
	if raw, present := damageFields["vampOverrides"]; present {
		var overrides []json.RawMessage
		if err := json.Unmarshal(raw, &overrides); err != nil {
			return err
		}
		for _, override := range overrides {
			if err := targetMarkJSONShape(override, "targetMark.damage.vampOverrides", "vampType mode basisOutputKind efficiency", "vampType mode"); err != nil {
				return err
			}
			values, _ := strictJSONObject(override, "targetMark.damage.vampOverrides")
			if efficiency, present := values["efficiency"]; present {
				if err := targetMarkExpressionJSON(efficiency, "targetMark.damage.vampOverrides.efficiency"); err != nil {
					return err
				}
			}
		}
	}
	if restore, present := fields["restore"]; present {
		if err := targetMarkJSONShape(restore, "targetMark.restore", "operation target ref resourceKey amount", "operation target ref resourceKey amount"); err != nil {
			return err
		}
		restoreFields, _ := strictJSONObject(restore, "targetMark.restore")
		if err := targetMarkExpressionJSON(restoreFields["amount"], "targetMark.restore.amount"); err != nil {
			return err
		}
	}
	*v = TargetMarkDefinition(decoded)
	return nil
}

// New payloads use exactly the existing expression-node fields consumed by
// their operator; ignored authoring keys cannot masquerade as runtime input.
func targetMarkExpressionJSON(data []byte, name string) error {
	fields, err := strictJSONObject(data, name)
	if err != nil {
		return err
	}
	var op string
	if err := json.Unmarshal(fields["op"], &op); err != nil {
		return err
	}
	allowed, required := "op args", "op args"
	switch op {
	case "const":
		allowed, required = "op value", "op value"
	case "read":
		allowed, required = "op path", "op path"
	case "ref":
		allowed, required = "op ref", "op ref"
	case "clamp":
		allowed, required = "op expr min max", "op expr min max"
	case "round":
		allowed, required = "op expr decimals", "op expr"
	case "floor", "ceil", "trunc":
		allowed, required = "op expr", "op expr"
	}
	if err := targetMarkJSONShape(data, name, allowed, required); err != nil {
		return err
	}
	for _, key := range []string{"expr", "min", "max"} {
		if raw, exists := fields[key]; exists {
			if err := targetMarkExpressionJSON(raw, name+"."+key); err != nil {
				return err
			}
		}
	}
	if raw, exists := fields["args"]; exists {
		var args []json.RawMessage
		if err := json.Unmarshal(raw, &args); err != nil {
			return err
		}
		for _, arg := range args {
			if err := targetMarkExpressionJSON(arg, name+".args"); err != nil {
				return err
			}
		}
	}
	return nil
}

func targetMarkJSONShape(data []byte, name, allowed, required string) error {
	if err := processJSONShape(data, name, allowed, required); err != nil {
		return err
	}
	fields, err := strictJSONObject(data, name)
	if err != nil {
		return err
	}
	for key, value := range fields {
		if string(value) == "null" {
			return errors.New(name + "." + key + " cannot be null")
		}
	}
	return nil
}

// TargetMarkSummary counts committed consumptions even when records are omitted.
type TargetMarkSummary struct {
	ConsumedCount      int64 `json:"consumedCount"`
	AttackCount        int64 `json:"attackCount"`
	SkillCount         int64 `json:"skillCount"`
	DamageBlockedCount int64 `json:"damageBlockedCount"`
}
