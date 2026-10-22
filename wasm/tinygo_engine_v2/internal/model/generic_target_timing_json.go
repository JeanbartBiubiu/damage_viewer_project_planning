package model

import (
	"encoding/json"
	"errors"
)

func (v *TickSpec) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "TickSpec", "intervalMs onTick startDelayMs anchorScope anchorStateKey phasePolicy", "intervalMs onTick"); err != nil {
		return err
	}
	type plain TickSpec
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if _, present := fields["phasePolicy"]; present {
		if err := processJSONShape(data, "TickSpec", "intervalMs onTick startDelayMs anchorScope anchorStateKey phasePolicy", "intervalMs onTick startDelayMs anchorScope anchorStateKey phasePolicy"); err != nil {
			return err
		}
	}
	if raw, present := fields["phasePolicy"]; present && (string(raw) == "null" || decoded.PhasePolicy != "preserve_on_extend") {
		return errors.New("TickSpec.phasePolicy requires preserve_on_extend")
	}
	*v = TickSpec(decoded)
	return nil
}

func (v *TargetExpirySpec) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "TargetExpirySpec", "anchorScope anchorStateKey onExpire", "anchorScope anchorStateKey onExpire"); err != nil {
		return err
	}
	type plain TargetExpirySpec
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*v = TargetExpirySpec(decoded)
	return nil
}

func (v *AbilityDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "AbilityDefinition", "abilityKey kind types tags params castOrigin skillKey cost cooldown castCondition operations listenerSpec tickSpec stateSchema processControl targetExpirySpec", ""); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if raw, present := fields["targetExpirySpec"]; present && string(raw) == "null" {
		return errors.New("AbilityDefinition.targetExpirySpec cannot be null")
	}
	type plain AbilityDefinition
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*v = AbilityDefinition(decoded)
	return nil
}
