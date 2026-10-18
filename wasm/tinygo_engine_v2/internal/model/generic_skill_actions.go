package model

import "encoding/json"

type SkillActionControl struct {
	Action     string `json:"action"`
	ProcessKey string `json:"processKey"`
	AbilityRef string `json:"abilityRef"`
}

type SkillActionHitBinding struct {
	HitBindingKey string                  `json:"hitBindingKey"`
	ProcessKey    string                  `json:"processKey"`
	Moment        ProcessMomentDefinition `json:"moment"`
	HitAbilityRef string                  `json:"hitAbilityRef"`
}

type SkillActionBinding struct {
	BindingKey            string                  `json:"bindingKey"`
	Source                string                  `json:"source"`
	ProviderRef           string                  `json:"providerRef"`
	ProviderDefinitionRef string                  `json:"providerDefinitionRef"`
	SkillKey              string                  `json:"skillKey"`
	Controls              []SkillActionControl    `json:"controls"`
	HitBindings           []SkillActionHitBinding `json:"hitBindings"`
}

func (value *SkillActionBinding) UnmarshalJSON(data []byte) error {
	const fields = "bindingKey source providerRef providerDefinitionRef skillKey controls hitBindings"
	if err := processJSONShape(data, "SkillActionBinding", fields, fields); err != nil {
		return err
	}
	type plain SkillActionBinding
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = SkillActionBinding(decoded)
	return nil
}

func (value *SkillActionControl) UnmarshalJSON(data []byte) error {
	const fields = "action processKey abilityRef"
	if err := processJSONShape(data, "SkillActionControl", fields, fields); err != nil {
		return err
	}
	type plain SkillActionControl
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = SkillActionControl(decoded)
	return nil
}

func (value *SkillActionHitBinding) UnmarshalJSON(data []byte) error {
	const fields = "hitBindingKey processKey moment hitAbilityRef"
	if err := processJSONShape(data, "SkillActionHitBinding", fields, fields); err != nil {
		return err
	}
	type plain SkillActionHitBinding
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = SkillActionHitBinding(decoded)
	return nil
}

type SkillActionHitPreset struct {
	HitBindingKey string `json:"hitBindingKey"`
	Preset        string `json:"preset"`
}

type SkillActionPlan struct {
	InstructionKey       string                 `json:"instructionKey"`
	FirstAtMs            int64                  `json:"firstAtMs"`
	SortOrder            int                    `json:"sortOrder"`
	Source               string                 `json:"source"`
	Target               string                 `json:"target"`
	SkillKey             string                 `json:"skillKey"`
	BindingKey           string                 `json:"bindingKey"`
	Action               string                 `json:"action"`
	AbilityRef           string                 `json:"abilityRef"`
	ParentInstructionKey *string                `json:"parentInstructionKey,omitempty"`
	HitBindings          []SkillActionHitPreset `json:"hitBindings"`
}

func (value *SkillActionPlan) UnmarshalJSON(data []byte) error {
	const fields = "instructionKey firstAtMs sortOrder source target skillKey bindingKey action abilityRef parentInstructionKey hitBindings"
	const required = "instructionKey firstAtMs sortOrder source target skillKey bindingKey action abilityRef hitBindings"
	if err := processJSONShape(data, "SkillActionPlan", fields, required); err != nil {
		return err
	}
	type plain SkillActionPlan
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = SkillActionPlan(decoded)
	return nil
}

func (value *SkillActionHitPreset) UnmarshalJSON(data []byte) error {
	const fields = "hitBindingKey preset"
	if err := processJSONShape(data, "SkillActionHitPreset", fields, fields); err != nil {
		return err
	}
	type plain SkillActionHitPreset
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*value = SkillActionHitPreset(decoded)
	return nil
}

type SkillActionSummary struct {
	PlannedCount             int `json:"plannedCount"`
	ReachedCount             int `json:"reachedCount"`
	AcceptedCount            int `json:"acceptedCount"`
	RejectedCount            int `json:"rejectedCount"`
	AbortedBeforeAcceptCount int `json:"abortedBeforeAcceptCount"`
	UnreachedCount           int `json:"unreachedCount"`
}

type SkillUseSummary struct {
	StepEnteredCount   int `json:"stepEnteredCount"`
	StepExecutedCount  int `json:"stepExecutedCount"`
	StepCompletedCount int `json:"stepCompletedCount"`
	StartedCount       int `json:"startedCount"`
	ReleasedCount      int `json:"releasedCount"`
	HitCount           int `json:"hitCount"`
	CompletedCount     int `json:"completedCount"`
	FailedCount        int `json:"failedCount"`
	InFlightCount      int `json:"inFlightCount"`
}

type SkillActionRecord struct {
	ParentInstructionKey  *string `json:"parentInstructionKey"`
	InstructionKey        string  `json:"instructionKey"`
	RequestedAtMs         int64   `json:"requestedAtMs"`
	ActualAtMs            int64   `json:"actualAtMs"`
	Action                string  `json:"action"`
	Source                string  `json:"source"`
	Target                string  `json:"target"`
	SkillKey              string  `json:"skillKey"`
	BindingKey            string  `json:"bindingKey"`
	ProviderRef           string  `json:"providerRef"`
	ProviderDefinitionRef string  `json:"providerDefinitionRef"`
	Outcome               string  `json:"outcome"`
	Reason                *string `json:"reason"`
	UseRef                *string `json:"useRef"`
}

type SkillUseRecord struct {
	EmpoweredAttack *ProcessEmpoweredAttack `json:"empoweredAttack,omitempty"`
	StepKey         string                  `json:"stepKey"`
	StepVersion     int                     `json:"stepVersion"`
	ExecutionIndex  int                     `json:"executionIndex"`
	InstructionKey  string                  `json:"instructionKey"`
	TimeMs          int64                   `json:"timeMs"`
	Kind            string                  `json:"kind"`
	Source          string                  `json:"source"`
	Target          string                  `json:"target"`
	SkillKey        string                  `json:"skillKey"`
	ProviderRef     string                  `json:"providerRef"`
	ProcessKey      string                  `json:"processKey"`
	UseRef          string                  `json:"useRef"`
	HitRef          *string                 `json:"hitRef"`
	Reason          *string                 `json:"reason"`
}

type DirectHealingRecord struct {
	TimeMs                int64   `json:"timeMs"`
	Source                string  `json:"source"`
	Target                string  `json:"target"`
	AbilityRef            string  `json:"abilityRef"`
	OperationRef          string  `json:"operationRef"`
	UseRef                *string `json:"useRef"`
	InstructionKey        *string `json:"instructionKey"`
	RawAmount             float64 `json:"rawAmount"`
	HealingAfterDone      float64 `json:"healingAfterDone"`
	HealingAfterModifiers float64 `json:"healingAfterModifiers"`
	ActualHealing         float64 `json:"actualHealing"`
	Overheal              float64 `json:"overheal"`
	HpBefore              float64 `json:"hpBefore"`
	HpAfter               float64 `json:"hpAfter"`
}
