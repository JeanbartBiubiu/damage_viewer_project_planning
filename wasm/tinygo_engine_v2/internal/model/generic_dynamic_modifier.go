package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
)

func (v *ModifierDefinition) UnmarshalJSON(data []byte) error {
	type plain ModifierDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	var fields struct {
		MaximumReductionRatio json.RawMessage `json:"maximumReductionRatio"`
		MultiplierGroupKey    json.RawMessage `json:"multiplierGroupKey"`
		Condition             json.RawMessage `json:"condition"`
	}
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if fields.MultiplierGroupKey != nil {
		if value.MultiplierGroupKey == nil || bytes.Equal(bytes.TrimSpace(fields.MultiplierGroupKey), []byte("null")) {
			return errors.New("multiplierGroupKey must be a non-null string")
		}
		if err := processJSONShape(data, "GroupedMultiplier", "modifierKey kind target command channel bucket stage priority healDirection healCategory healGroupKey healGroupCalculationMode valuePolicy value condition maximumReductionRatio currentValuePolicy affectedAbilityRefs valueReadMode multiplierGroupKey", "modifierKey kind valuePolicy value multiplierGroupKey"); err != nil {
			return err
		}
		if value.Kind == "attribute" && fields.Condition != nil {
			return errors.New("grouped attribute modifiers forbid condition including null")
		}
	}
	if value.Stage == "incoming_pre_mitigation" || fields.MaximumReductionRatio != nil {
		if err := processJSONShape(data, "CappedFlatModifier", "modifierKey kind command channel bucket stage priority valuePolicy value condition maximumReductionRatio multiplierGroupKey", "modifierKey kind command channel bucket stage valuePolicy value condition maximumReductionRatio"); err != nil {
			return err
		}
		if value.Kind != "pipeline" || value.Command != "damage" || value.Stage != "incoming_pre_mitigation" || value.MaximumReductionRatio == nil || math.IsNaN(*value.MaximumReductionRatio) || math.IsInf(*value.MaximumReductionRatio, 0) || *value.MaximumReductionRatio < 0 || *value.MaximumReductionRatio > 1 {
			return errors.New("maximumReductionRatio requires incoming_pre_mitigation damage and a finite ratio in [0,1]")
		}
	}
	if bytes.Contains(data, []byte(`"valueReadMode"`)) {
		if value.ValueReadMode != "APPLICATION_SNAPSHOT" || value.Kind != "attribute" {
			return errors.New("modifier valueReadMode requires explicit attribute APPLICATION_SNAPSHOT")
		}
		if err := processJSONShape(data, "ModifierDefinition", "modifierKey kind target command channel bucket stage priority healDirection healCategory healGroupKey healGroupCalculationMode valuePolicy value condition currentValuePolicy affectedAbilityRefs valueReadMode multiplierGroupKey", "modifierKey kind target valuePolicy value valueReadMode"); err != nil {
			return err
		}
	}
	// Existing dynamic capabilities retain their own validation rules.
	if value.Kind == "resource_max" || value.Kind == "cooldown_duration" || bytes.Contains(data, []byte(`"currentValuePolicy"`)) || bytes.Contains(data, []byte(`"affectedAbilityRefs"`)) {
		if err := processJSONShape(data, "ModifierDefinition", "modifierKey kind target command channel bucket stage priority healDirection healCategory healGroupKey healGroupCalculationMode valuePolicy value condition currentValuePolicy affectedAbilityRefs multiplierGroupKey", "modifierKey kind target valuePolicy value"); err != nil {
			return err
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return err
		}
		_, current := fields["currentValuePolicy"]
		_, refs := fields["affectedAbilityRefs"]
		if (current && (value.Kind != "resource_max" || (value.CurrentValuePolicy != "grant_positive_delta_clamp" && value.CurrentValuePolicy != "preserve_initial_current"))) || (value.Kind == "resource_max" && !current) {
			return errors.New("currentValuePolicy is required only on resource_max")
		}
		if (refs && (value.Kind != "cooldown_duration" || value.AffectedAbilityRefs == nil || *value.AffectedAbilityRefs == nil)) || (value.Kind == "cooldown_duration" && !refs) {
			return errors.New("affectedAbilityRefs is required only on cooldown_duration and must be an array")
		}
		if raw, present := fields["condition"]; present && string(raw) == "null" {
			return errors.New("dynamic modifiers forbid condition including null")
		}
	}
	*v = ModifierDefinition(value)
	return nil
}
