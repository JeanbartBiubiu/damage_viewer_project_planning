package model

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

// 新过程对象拒绝未知字段与必需字段缺失，不影响未声明过程的旧通用请求。
func processJSONShape(data []byte, name, allowed, required string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if fields == nil {
		return errors.New(name + " must be an object")
	}
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !strings.Contains(" "+allowed+" ", " "+k+" ") {
			return errors.New(name + "." + k + " is unknown")
		}
	}
	for _, k := range strings.Fields(required) {
		v, ok := fields[k]
		if !ok || string(v) == "null" {
			return errors.New(name + "." + k + " is required")
		}
	}
	// Nullable fields are still part of the frozen new object shape.
	if name == "ProcessDefinition" || name == "ProcessMomentDefinition" || name == "ProcessInstanceSnapshot" {
		for _, k := range strings.Fields(allowed) {
			if _, present := fields[k]; !present {
				return errors.New(name + "." + k + " is required (null is allowed where declared)")
			}
		}
	}
	if name == "ProcessControlDefinition" {
		var action string
		if err := json.Unmarshal(fields["action"], &action); err != nil {
			return err
		}
		for _, key := range []string{"stepKey", "failureReason"} {
			if _, present := fields[key]; !present {
				continue
			}
			allowed := key == "stepKey" && (action == "RECAST" || action == "CHARGE_RELEASE") || key == "failureReason" && (action == "CANCEL" || action == "INTERRUPT")
			if !allowed || string(fields[key]) == "null" {
				return errors.New(name + "." + key + " does not belong to this action")
			}
		}
	}
	if name == "ProcessStepDefinition" {
		var kind string
		if err := json.Unmarshal(fields["stepType"], &kind); err != nil {
			return err
		}
		for _, key := range []string{"delayMs", "minimumChargeMs", "maximumChargeMs", "releaseAtMaximum", "windowMs"} {
			if _, present := fields[key]; !present {
				continue
			}
			allowed := kind == "DELAY" && key == "delayMs" || kind == "RECAST" && key == "windowMs" || kind == "CHARGE" && (key == "minimumChargeMs" || key == "maximumChargeMs" || key == "releaseAtMaximum")
			if !allowed || string(fields[key]) == "null" {
				return errors.New(name + "." + key + " does not belong to this step type")
			}
		}
	}
	return nil
}
func (v *ProcessDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessDefinition", "processKey skillKey steps costs cooldown momentOperations", "processKey skillKey steps costs momentOperations"); err != nil {
		return err
	}
	type plain ProcessDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessDefinition(value)
	return nil
}
func (v *ProcessControlDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessControlDefinition", "processKey action stepKey failureReason", "processKey action"); err != nil {
		return err
	}
	type plain ProcessControlDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessControlDefinition(value)
	return nil
}
func (v *ProcessStepDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessStepDefinition", "stepKey stepType delayMs minimumChargeMs maximumChargeMs releaseAtMaximum windowMs", "stepKey stepType"); err != nil {
		return err
	}
	type plain ProcessStepDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessStepDefinition(value)
	return nil
}
func (v *ProcessMomentDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessMomentDefinition", "momentType stepKey failureReason", "momentType"); err != nil {
		return err
	}
	type plain ProcessMomentDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessMomentDefinition(value)
	return nil
}
func (v *ProcessCostDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessCostDefinition", "resourceKey amount", "resourceKey amount"); err != nil {
		return err
	}
	type plain ProcessCostDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessCostDefinition(value)
	return nil
}
func (v *ProcessCooldownDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessCooldownDefinition", "durationMs startMoment", "durationMs startMoment"); err != nil {
		return err
	}
	type plain ProcessCooldownDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessCooldownDefinition(value)
	return nil
}
func (v *ProcessMomentOperations) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessMomentOperations", "moment operations", "moment operations"); err != nil {
		return err
	}
	type plain ProcessMomentOperations
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessMomentOperations(value)
	return nil
}
func (v *ProcessCommandFact) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessCommandFact", "driverEntryKey useRef", "driverEntryKey useRef"); err != nil {
		return err
	}
	type plain ProcessCommandFact
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessCommandFact(value)
	return nil
}
func (v *ProcessInstanceSnapshot) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessInstanceSnapshot", "owner providerRef processKey skillKey useKey target stepKey stepVersion startedAtMs stepStartedAtMs advanceAtMs expiresAtMs actualCosts cooldownStarted status failureReason finishedAtMs", "owner providerRef processKey skillKey useKey target stepKey stepVersion startedAtMs stepStartedAtMs advanceAtMs actualCosts cooldownStarted status"); err != nil {
		return err
	}
	type plain ProcessInstanceSnapshot
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessInstanceSnapshot(value)
	return nil
}
