package model

import (
	"encoding/json"
	"errors"
	"strings"
)

func (v *ProcessAttackConsumption) UnmarshalJSON(data []byte) error {
	const fields = "consumptionIndex useRef target startedAtMs hitRef hitSequence resolvedAtMs"
	if err := processJSONShape(data, "ProcessAttackConsumption", fields, "consumptionIndex useRef target startedAtMs"); err != nil {
		return err
	}
	raw, err := strictJSONObject(data, "ProcessAttackConsumption")
	if err != nil {
		return err
	}
	for _, field := range []string{"hitRef", "hitSequence", "resolvedAtMs"} {
		if _, ok := raw[field]; !ok {
			return errors.New("ProcessAttackConsumption." + field + " is required, null is allowed")
		}
	}
	type plain ProcessAttackConsumption
	var row plain
	if err := json.Unmarshal(data, &row); err != nil {
		return err
	}
	if row.ConsumptionIndex < 1 || row.ConsumptionIndex > 64 || strings.TrimSpace(row.UseRef) == "" || (row.Target != "source" && row.Target != "target") || row.StartedAtMs < 0 || row.StartedAtMs > 9007199254740991 || (row.HitRef == nil) != (row.HitSequence == nil) || row.HitRef != nil && (strings.TrimSpace(*row.HitRef) == "" || *row.HitSequence < 0 || row.ResolvedAtMs == nil) || row.ResolvedAtMs != nil && (*row.ResolvedAtMs < row.StartedAtMs || *row.ResolvedAtMs > 9007199254740991) {
		return errors.New("ProcessAttackConsumption requires a complete actual bounded attack identity")
	}
	*v = ProcessAttackConsumption(row)
	return nil
}

func (v *ProcessEmpoweredAttackWindow) UnmarshalJSON(data []byte) error {
	const fields = "maximumAttackCount consumptionCount pendingHitCount consumptions"
	if err := processJSONShape(data, "ProcessEmpoweredAttackWindow", fields, fields); err != nil {
		return err
	}
	type plain ProcessEmpoweredAttackWindow
	var row plain
	if err := json.Unmarshal(data, &row); err != nil {
		return err
	}
	if row.MaximumAttackCount < 1 || row.MaximumAttackCount > 64 || row.ConsumptionCount < 0 || row.ConsumptionCount > row.MaximumAttackCount || len(row.Consumptions) != row.ConsumptionCount {
		return errors.New("ProcessEmpoweredAttackWindow requires its bounded complete consumption ledger")
	}
	pending := 0
	for i, item := range row.Consumptions {
		if item.ConsumptionIndex != i+1 {
			return errors.New("ProcessEmpoweredAttackWindow consumption indices must be consecutive")
		}
		for _, earlier := range row.Consumptions[:i] {
			if earlier.UseRef == item.UseRef {
				return errors.New("ProcessEmpoweredAttackWindow cannot consume the same attack twice")
			}
		}
		if item.ResolvedAtMs == nil {
			pending++
		}
	}
	if row.PendingHitCount != pending {
		return errors.New("ProcessEmpoweredAttackWindow pending count disagrees with actual resolutions")
	}
	*v = ProcessEmpoweredAttackWindow(row)
	return nil
}
