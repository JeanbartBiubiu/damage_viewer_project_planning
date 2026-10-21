package model

import (
	"encoding/json"
	"errors"
)

func (value *StatusContributionDefinition) UnmarshalJSON(data []byte) error {
	type plain StatusContributionDefinition
	var wire struct {
		plain
		ValueReadMode json.RawMessage `json:"valueReadMode"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	mode := ""
	if len(wire.ValueReadMode) != 0 {
		if err := json.Unmarshal(wire.ValueReadMode, &mode); err != nil {
			return err
		}
		if mode != StatusValueReadApplicationSnapshot && mode != StatusValueReadMomentEvaluation {
			return errors.New("status contribution valueReadMode must be APPLICATION_SNAPSHOT or MOMENT_EVALUATION when present")
		}
	}
	*value = StatusContributionDefinition(wire.plain)
	value.ValueReadMode = mode
	return nil
}
