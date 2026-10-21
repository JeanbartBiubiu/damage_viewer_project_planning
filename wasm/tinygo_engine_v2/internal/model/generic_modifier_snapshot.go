package model

import (
	"encoding/json"
	"errors"
)

type ModifierSnapshotValues map[string]float64

func (m *ModifierSnapshotValues) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return errors.New("modifierSnapshots must be an explicit numeric object")
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for _, value := range raw {
		if string(value) == "null" {
			return errors.New("modifierSnapshots value cannot be null")
		}
	}
	var value map[string]float64
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*m = value
	return nil
}
