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
			if name == "ProcessDefinition" && k == "entryKind" {
				continue
			}
			if name == "ProcessInstanceSnapshot" && (k == "passiveOrigin" || k == "empoweredAttack" || k == "empoweredAttackWindow" || k == "empoweredPredecessorUseRef" || k == "skillHitStages") {
				continue
			}
			if _, present := fields[k]; !present {
				return errors.New(name + "." + k + " is required (null is allowed where declared)")
			}
		}
	}
	if name == "ProcessInstanceSnapshot" {
		if raw, present := fields["passiveOrigin"]; present && string(raw) == "null" {
			return errors.New(name + ".passiveOrigin must contain actual native origin facts")
		}
		if raw, present := fields["empoweredAttackWindow"]; present && string(raw) == "null" {
			return errors.New(name + ".empoweredAttackWindow must be an actual counted window")
		}
		if raw, present := fields["skillHitStages"]; present && string(raw) == "null" {
			return errors.New(name + ".skillHitStages must be an array")
		}
		if raw, present := fields["empoweredPredecessorUseRef"]; present {
			var ref string
			if err := json.Unmarshal(raw, &ref); err != nil || strings.TrimSpace(ref) == "" {
				return errors.New(name + ".empoweredPredecessorUseRef must be a non-empty string")
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
		for _, key := range []string{"delayMs", "minimumChargeMs", "maximumChargeMs", "releaseAtMaximum", "windowMs", "consumeMoment", "maximumAttackCount", "maximumRecastCount", "repeatCount", "intervalMs", "durationMs", "executionCount", "firstExecution", "firstExecutionOffsetMs", "lastExecutionOffsetMs"} {
			if _, present := fields[key]; !present {
				if customWindow && (key == "firstExecutionOffsetMs" || key == "lastExecutionOffsetMs") {
					return errors.New(name + "." + key + " is required")
				}
				continue
			}
			allowed := kind == "DELAY" && key == "delayMs" || kind == "RECAST" && (key == "windowMs" || key == "maximumRecastCount" || key == "intervalMs") || kind == "EMPOWERED_BASIC_ATTACK" && (key == "windowMs" || key == "consumeMoment" || key == "maximumAttackCount") || kind == "CHARGE" && (key == "minimumChargeMs" || key == "maximumChargeMs" || key == "releaseAtMaximum") || kind == "MULTI_HIT" && (key == "repeatCount" || key == "intervalMs") || kind == "CHANNEL" && (key == "durationMs" || key == "executionCount" || key == "firstExecution") || customWindow && (key == "firstExecutionOffsetMs" || key == "lastExecutionOffsetMs")
			if !allowed || string(fields[key]) == "null" {
				return errors.New(name + "." + key + " does not belong to this step type")
			}
		}
	}
	return nil
}
func (v *ProcessDefinition) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "ProcessDefinition", "processKey skillKey entryKind steps costs cooldown momentOperations", "processKey skillKey steps costs momentOperations"); err != nil {
		return err
	}
	type plain ProcessDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	fields, _ := strictJSONObject(data, "ProcessDefinition")
	if raw, present := fields["entryKind"]; present && (string(raw) == "null" || value.EntryKind != ProcessEntrySkillHitPassive) {
		return errors.New("ProcessDefinition.entryKind must be SKILL_HIT_PASSIVE when present")
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
	if err := processJSONShape(data, "ProcessStepDefinition", "stepKey stepType occupiesAction delayMs minimumChargeMs maximumChargeMs releaseAtMaximum windowMs consumeMoment maximumAttackCount maximumRecastCount repeatCount intervalMs durationMs executionCount firstExecution firstExecutionOffsetMs lastExecutionOffsetMs", "stepKey stepType"); err != nil {
		return err
	}
	type plain ProcessStepDefinition
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if value.StepType == "RECAST" {
		if value.MaximumRecastCount == nil {
			return errors.New("ProcessStepDefinition.maximumRecastCount is required for RECAST")
		}
		fields, _ := strictJSONObject(data, "ProcessStepDefinition")
		if raw, present := fields["intervalMs"]; present && string(raw) == "null" {
			return errors.New("ProcessStepDefinition.intervalMs cannot be null for RECAST")
		}
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
	if err := processJSONShape(data, "ProcessInstanceSnapshot", "owner providerRef processKey skillKey useKey target stepKey stepVersion stepExecutionIndex lastExecutionAtMs stepCompletedAtMs startedAtMs stepStartedAtMs advanceAtMs expiresAtMs actualCosts cooldownStarted status failureReason finishedAtMs repeat actionOccupancies empoweredAttack empoweredAttackWindow empoweredPredecessorUseRef skillHitStages passiveOrigin", "owner providerRef processKey skillKey useKey target stepKey stepVersion stepExecutionIndex startedAtMs stepStartedAtMs advanceAtMs actualCosts cooldownStarted status actionOccupancies"); err != nil {
		return err
	}
	type plain ProcessInstanceSnapshot
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if value.SkillHitStages != nil && len(*value.SkillHitStages) > 64 {
		return errors.New("ProcessInstanceSnapshot.skillHitStages admits at most 64 executed stages")
	}
	*v = ProcessInstanceSnapshot(value)
	return nil
}

func (v *PassiveProcessOrigin) UnmarshalJSON(data []byte) error {
	const fields = "useSource useKey useSkillKey hitAbilityRef hitSequence hitOccurrenceId"
	if err := processJSONShape(data, "PassiveProcessOrigin", fields, fields); err != nil {
		return err
	}
	type plain PassiveProcessOrigin
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if strings.TrimSpace(value.UseSource) == "" || strings.TrimSpace(value.UseKey) == "" || strings.TrimSpace(value.UseSkillKey) == "" || strings.TrimSpace(value.HitAbilityRef) == "" || value.HitSequence < 1 || uint64(value.HitSequence) > 9007199254740991 || value.HitOccurrenceID == 0 || value.HitOccurrenceID > 9007199254740991 {
		return errors.New("PassiveProcessOrigin requires complete native skill-hit identity")
	}
	*v = PassiveProcessOrigin(value)
	return nil
}

func (v *ProcessSkillHitStage) UnmarshalJSON(data []byte) error {
	const fields = "hitBindingKey stepKey timeMs released contact completed"
	if err := processJSONShape(data, "ProcessSkillHitStage", fields+" hitSequence hitOccurrenceId hitBlocked", fields); err != nil {
		return err
	}
	type plain ProcessSkillHitStage
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if strings.TrimSpace(value.HitBindingKey) == "" || strings.TrimSpace(value.StepKey) == "" || value.TimeMs < 0 || value.Contact && !value.Released {
		return errors.New("ProcessSkillHitStage requires actual identity, nonnegative time and released contact")
	}
	if value.Contact {
		if value.HitSequence == nil || value.HitOccurrenceID == nil || value.HitBlocked == nil || *value.HitSequence < 1 || uint64(*value.HitSequence) > 9007199254740991 || *value.HitOccurrenceID == 0 || *value.HitOccurrenceID > 9007199254740991 || *value.HitBlocked != 0 && *value.HitBlocked != 1 {
			return errors.New("ProcessSkillHitStage contact requires complete actual native hit identity and blocked count")
		}
	} else if value.HitSequence != nil || value.HitOccurrenceID != nil || value.HitBlocked != nil {
		return errors.New("ProcessSkillHitStage without contact cannot carry native hit identity")
	}
	rawFields, _ := strictJSONObject(data, "ProcessSkillHitStage")
	for _, key := range []string{"hitSequence", "hitOccurrenceId", "hitBlocked"} {
		if raw, present := rawFields[key]; present && (!value.Contact || string(raw) == "null") {
			return errors.New("ProcessSkillHitStage native hit fields must be actual contact facts")
		}
	}
	*v = ProcessSkillHitStage(value)
	return nil
}

func (v *ProcessEmpoweredAttack) UnmarshalJSON(data []byte) error {
	const fields = "useRef hitRef target"
	if err := processJSONShape(data, "ProcessEmpoweredAttack", fields+" replacedPrimary", fields); err != nil {
		return err
	}
	type plain ProcessEmpoweredAttack
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = ProcessEmpoweredAttack(value)
	return nil
}

func (v *BasicAttackPrimaryIdentity) UnmarshalJSON(data []byte) error {
	const fields = "owner providerRef definitionRef startAbilityRef initialControlAbilityRef hitAbilityRef candidateKey effectOccurrenceKey effectKey resultKey"
	if err := processJSONShape(data, "BasicAttackPrimaryIdentity", fields, fields); err != nil {
		return err
	}
	type plain BasicAttackPrimaryIdentity
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = BasicAttackPrimaryIdentity(value)
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
