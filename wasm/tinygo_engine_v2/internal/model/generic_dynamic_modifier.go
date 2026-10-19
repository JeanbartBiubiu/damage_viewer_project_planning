package model

import (
	"bytes"
	"encoding/json"
	"errors"
)

func (v *ModifierDefinition) UnmarshalJSON(data []byte) error {
	type plain ModifierDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	// Keep legacy decoding allocation unchanged except for the new capabilities.
	if value.Kind == "resource_max" || value.Kind == "cooldown_duration" || bytes.Contains(data, []byte(`"currentValuePolicy"`)) || bytes.Contains(data, []byte(`"affectedAbilityRefs"`)) {
		if err := processJSONShape(data, "ModifierDefinition", "modifierKey kind target command channel bucket stage priority healDirection healCategory healGroupKey healGroupCalculationMode valuePolicy value condition currentValuePolicy affectedAbilityRefs", "modifierKey kind target valuePolicy value"); err != nil {
			return err
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			return err
		}
		_, current := fields["currentValuePolicy"]
		_, refs := fields["affectedAbilityRefs"]
		if (current && (value.Kind != "resource_max" || value.CurrentValuePolicy != "grant_positive_delta_clamp")) || (value.Kind == "resource_max" && !current) {
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
