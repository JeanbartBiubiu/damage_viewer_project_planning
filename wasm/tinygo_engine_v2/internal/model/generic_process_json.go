package model

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

// 新过程对象拒绝未知字段与必需字段缺失，不影响未声明过程的旧通用请求。
func processJSONShape(data []byte, name, allowed, required string) error {
	fields, err := strictJSONObject(data, name)
	if err != nil {
		return err
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
	for _, key := range []string{"roundPositiveMs", "disabled", "maxAttackRecords", "maxDamageRecords", "conditionRecheckIntervalMs"} {
		if raw, present := fields[key]; present && string(raw) == "null" {
			return errors.New(name + "." + key + " cannot be null")
		}
	}
	// Nullable fields are still part of the frozen new object shape.
	if name == "ProcessDefinition" || name == "ProcessMomentDefinition" || name == "ProcessInstanceSnapshot" || name == "ProcessRepeatSnapshot" || name == "ProcessActionOccupancy" {
		for _, k := range strings.Fields(allowed) {
			if _, present := fields[k]; !present {
				return errors.New(name + "." + k + " is required (null is allowed where declared)")
			}
		}
	}
	if name == "ProcessControlDefinition" {
		if raw, present := fields["useRefFromEvent"]; present && string(raw) == "null" {
			return errors.New(name + ".useRefFromEvent must be an explicit boolean")
		}
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
		var firstExecution string
		if raw, present := fields["firstExecution"]; present {
			if err := json.Unmarshal(raw, &firstExecution); err != nil {
				return err
			}
		}
		customWindow := kind == "CHANNEL" && firstExecution == "CUSTOM_WINDOW"
		for _, key := range []string{"delayMs", "minimumChargeMs", "maximumChargeMs", "releaseAtMaximum", "windowMs", "repeatCount", "intervalMs", "durationMs", "executionCount", "firstExecution", "firstExecutionOffsetMs", "lastExecutionOffsetMs"} {
			if _, present := fields[key]; !present {
				if customWindow && (key == "firstExecutionOffsetMs" || key == "lastExecutionOffsetMs") {
					return errors.New(name + "." + key + " is required")
				}
				continue
			}
			allowed := kind == "DELAY" && key == "delayMs" || kind == "RECAST" && key == "windowMs" || kind == "CHARGE" && (key == "minimumChargeMs" || key == "maximumChargeMs" || key == "releaseAtMaximum") || kind == "MULTI_HIT" && (key == "repeatCount" || key == "intervalMs") || kind == "CHANNEL" && (key == "durationMs" || key == "executionCount" || key == "firstExecution") || customWindow && (key == "firstExecutionOffsetMs" || key == "lastExecutionOffsetMs")
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
	if err := processJSONShape(data, "ProcessControlDefinition", "processKey action stepKey failureReason useRefFromEvent requireExplicitSelfTarget", "processKey action"); err != nil {
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
	if err := processJSONShape(data, "ProcessStepDefinition", "stepKey stepType occupiesAction delayMs minimumChargeMs maximumChargeMs releaseAtMaximum windowMs repeatCount intervalMs durationMs executionCount firstExecution firstExecutionOffsetMs lastExecutionOffsetMs", "stepKey stepType"); err != nil {
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
	if err := processJSONShape(data, "ProcessCooldownDefinition", "durationMs startMoment roundPositiveMs", "durationMs startMoment"); err != nil {
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
	if err := processJSONShape(data, "ProcessInstanceSnapshot", "owner providerRef processKey skillKey useKey target stepKey stepVersion stepExecutionIndex lastExecutionAtMs stepCompletedAtMs startedAtMs stepStartedAtMs advanceAtMs expiresAtMs actualCosts cooldownStarted status failureReason finishedAtMs repeat actionOccupancies", "owner providerRef processKey skillKey useKey target stepKey stepVersion stepExecutionIndex startedAtMs stepStartedAtMs advanceAtMs actualCosts cooldownStarted status actionOccupancies"); err != nil {
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

func (value *ProcessRepeatSnapshot) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessRepeatSnapshot", "executionCount executionIndex intervalMs firstExecutionOffsetMs lastExecutionOffsetMs nextExecutionAtMs", "executionCount executionIndex intervalMs firstExecutionOffsetMs lastExecutionOffsetMs"); err != nil {
		return err
	}
	type plain ProcessRepeatSnapshot
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = ProcessRepeatSnapshot(decoded)
	return nil
}

func (value *ProcessActionOccupancy) UnmarshalJSON(data []byte) error {
	const fields = "stepKey stepVersion startedAtMs expectedEndAtMs finishedAtMs"
	if err := processJSONShape(data, "ProcessActionOccupancy", fields, "stepKey stepVersion startedAtMs expectedEndAtMs"); err != nil {
		return err
	}
	type plain ProcessActionOccupancy
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = ProcessActionOccupancy(decoded)
	return nil
}
