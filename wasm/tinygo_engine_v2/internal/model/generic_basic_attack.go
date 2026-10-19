package model

import (
	"encoding/json"
	"errors"
)

// BudgetCause identifies a recognized execution limit; it is not an error-message convention.
type BudgetCause string

const (
	BudgetCauseMaxEvents           BudgetCause = "max_events"
	BudgetCauseMaxCommandsPerEvent BudgetCause = "max_commands_per_event"
	BudgetCauseMaxChainDepth       BudgetCause = "max_chain_depth"
	BudgetCauseMaxQueueEvents      BudgetCause = "max_queue_events"
	BudgetCauseMaxProcessInstances BudgetCause = "max_process_instances"
	BudgetCauseMaxSkillHits        BudgetCause = "max_skill_hits"
	BudgetCauseMaxBasicAttacks     BudgetCause = "max_basic_attacks"
	BudgetCauseMaxUseTriggerLedger BudgetCause = "max_use_trigger_ledger"
)

type BasicAttackPlan struct {
	PlanKey                  string  `json:"planKey"`
	Source                   string  `json:"source"`
	Target                   string  `json:"target"`
	SkillKey                 string  `json:"skillKey"`
	StartAbilityRef          string  `json:"startAbilityRef"`
	HitAbilityRef            string  `json:"hitAbilityRef"`
	InitialControlAbilityRef string  `json:"initialControlAbilityRef"`
	AttackSpeedAttributeKey  string  `json:"attackSpeedAttributeKey"`
	AttackSpeedInputMax      float64 `json:"attackSpeedInputMax"`
}

func (v *BasicAttackPlan) UnmarshalJSON(data []byte) error {
	const fields = "planKey source target skillKey startAbilityRef hitAbilityRef initialControlAbilityRef attackSpeedAttributeKey attackSpeedInputMax"
	if err := processJSONShape(data, "BasicAttackPlan", fields, fields); err != nil {
		return err
	}
	type plain BasicAttackPlan
	var result plain
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}
	*v = BasicAttackPlan(result)
	return nil
}
func (v *DriverPlan) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "DriverPlan", "entries conditionRecheckIntervalMs basicAttack skillActions automaticSkills", ""); err != nil {
		return err
	}
	type plain DriverPlan
	var result plain
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}
	if (result.BasicAttack != nil || len(result.SkillActions) > 0) && result.Entries == nil {
		return errors.New("continuous driverPlan.entries must be an empty array")
	}
	fields, err := strictJSONObject(data, "driverPlan")
	if err != nil {
		return err
	}
	if raw, present := fields["automaticSkills"]; present {
		if string(raw) == "null" || result.AutomaticSkills == nil {
			return errors.New("driverPlan.automaticSkills must be an object")
		}
		for _, key := range []string{"entries", "skillActions"} {
			if err := requireEmptyJSONArray(fields, key, "driverPlan"); err != nil {
				return err
			}
		}
		if raw, present := fields["basicAttack"]; present && string(raw) == "null" {
			return errors.New("driverPlan.basicAttack must be omitted or a complete plan in automatic mode")
		}
	}
	*v = DriverPlan(result)
	return nil
}

// Pointer budgets distinguish an explicit zero (no retained records) from omission.
type RecordBudget struct {
	MaxResourceChangeRecords *int `json:"maxResourceChangeRecords,omitempty"`
	MaxAutomaticSkillRecords *int `json:"maxAutomaticSkillRecords,omitempty"`
	MaxSkillActionRecords    *int `json:"maxSkillActionRecords,omitempty"`
	MaxSkillUseRecords       *int `json:"maxSkillUseRecords,omitempty"`
	MaxHealingRecords        *int `json:"maxHealingRecords,omitempty"`
	MaxMechanicRecords       *int `json:"maxMechanicRecords,omitempty"`
	MaxAttackRecords         *int `json:"maxAttackRecords,omitempty"`
	MaxDamageRecords         *int `json:"maxDamageRecords,omitempty"`
}

func (v *RecordBudget) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "RecordBudget", "maxAttackRecords maxDamageRecords maxMechanicRecords maxSkillActionRecords maxSkillUseRecords maxHealingRecords maxAutomaticSkillRecords maxResourceChangeRecords", ""); err != nil {
		return err
	}
	type plain RecordBudget
	var result plain
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}
	if result.MaxAttackRecords != nil && (*result.MaxAttackRecords < 0 || *result.MaxAttackRecords > 4096) {
		return errors.New("recordBudget.maxAttackRecords must be an integer in [0,4096]")
	}
	if result.MaxDamageRecords != nil && (*result.MaxDamageRecords < 0 || *result.MaxDamageRecords > 10000) {
		return errors.New("recordBudget.maxDamageRecords must be an integer in [0,10000]")
	}
	if result.MaxMechanicRecords != nil && (*result.MaxMechanicRecords < 0 || *result.MaxMechanicRecords > 10000) {
		return errors.New("recordBudget.maxMechanicRecords must be an integer in [0,10000]")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if raw, present := fields["maxMechanicRecords"]; present && string(raw) == "null" {
		return errors.New("recordBudget.maxMechanicRecords must be an integer in [0,10000]")
	}
	if raw, present := fields["maxResourceChangeRecords"]; present && (string(raw) == "null" || result.MaxResourceChangeRecords == nil || *result.MaxResourceChangeRecords < 0 || *result.MaxResourceChangeRecords > 10000) {
		return errors.New("recordBudget.maxResourceChangeRecords must be an integer in [0,10000]")
	}
	if raw, present := fields["maxAutomaticSkillRecords"]; present && (string(raw) == "null" || result.MaxAutomaticSkillRecords == nil || *result.MaxAutomaticSkillRecords < 0 || *result.MaxAutomaticSkillRecords > 4096) {
		return errors.New("recordBudget.maxAutomaticSkillRecords must be an integer in [0,4096]")
	}
	for key, budget := range map[string]*int{"maxSkillActionRecords": result.MaxSkillActionRecords, "maxSkillUseRecords": result.MaxSkillUseRecords, "maxHealingRecords": result.MaxHealingRecords} {
		limit := 10000
		if key == "maxSkillActionRecords" {
			limit = 4096
		}
		if raw, present := fields[key]; present && (string(raw) == "null" || budget == nil || *budget < 0 || *budget > limit) {
			return errors.New("recordBudget." + key + " must be a non-negative integer within its limit")
		}
	}
	*v = RecordBudget(result)
	return nil
}
func (v *SamplingConfig) UnmarshalJSON(data []byte) error {
	if err := processJSONShape(data, "SamplingConfig", "disabled sampleEveryMs dpsWindowMs maxSeriesPoints", ""); err != nil {
		return err
	}
	type plain SamplingConfig
	var result plain
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for key, value := range map[string]int{"sampleEveryMs": result.SampleEveryMs, "dpsWindowMs": result.DpsWindowMs, "maxSeriesPoints": result.MaxSeriesPoints} {
		if raw, present := fields[key]; present && (string(raw) == "null" || value <= 0 || (key == "maxSeriesPoints" && (value < 2 || value > 5000))) {
			return errors.New("sampling." + key + " must be positive and within its limit")
		}
	}
	*v = SamplingConfig(result)
	return nil
}

type BasicAttackSummary struct {
	PlanKey                  string                          `json:"planKey"`
	StartedCount             int                             `json:"startedCount"`
	HitCount                 int                             `json:"hitCount"`
	CompletedCount           int                             `json:"completedCount"`
	InitialMechanicReadyAtMs *int64                          `json:"initialMechanicReadyAtMs"`
	InitialActionReadyAtMs   *int64                          `json:"initialActionReadyAtMs"`
	PrimaryReplacements      []BasicAttackPrimaryReplacement `json:"primaryReplacements,omitempty"`
}

type BasicAttackReplacementIdentity struct {
	Owner         string `json:"owner"`
	ProviderRef   string `json:"providerRef"`
	DefinitionRef string `json:"definitionRef"`
	SkillKey      string `json:"skillKey"`
	ProcessKey    string `json:"processKey"`
	HitAbilityRef string `json:"hitAbilityRef"`
}

// Committed counters are independent of record retention and output mode.
type BasicAttackPrimaryReplacement struct {
	Primary           BasicAttackPrimaryIdentity     `json:"primary"`
	Replacement       BasicAttackReplacementIdentity `json:"replacement"`
	Target            string                         `json:"target"`
	Count             int                            `json:"count"`
	BlockedCount      int                            `json:"blockedCount"`
	PostDefenseDamage float64                        `json:"postDefenseDamage"`
	ShieldAbsorbed    float64                        `json:"shieldAbsorbed"`
	ActualHpLoss      float64                        `json:"actualHpLoss"`
}
type RunExecutionSummary struct {
	RequestedDurationMs int64        `json:"requestedDurationMs"`
	Complete            bool         `json:"complete"`
	IncompleteReason    *string      `json:"incompleteReason"`
	BudgetCause         *BudgetCause `json:"budgetCause"`
	TargetKilled        bool         `json:"targetKilled"`
	TargetKilledAtMs    *int64       `json:"targetKilledAtMs"`
}
type BasicAttackRecord struct {
	MechanicReadyAtMs *int64  `json:"mechanicReadyAtMs"`
	ActionReadyAtMs   *int64  `json:"actionReadyAtMs"`
	PlanKey           string  `json:"planKey"`
	AttackIndex       int     `json:"attackIndex"`
	UseRef            string  `json:"useRef"`
	Source            string  `json:"source"`
	Target            string  `json:"target"`
	SkillKey          string  `json:"skillKey"`
	StartAtMs         int64   `json:"startAtMs"`
	HitAtMs           *int64  `json:"hitAtMs"`
	ReadyAtMs         *int64  `json:"readyAtMs"`
	FinalReadyAtMs    *int64  `json:"finalReadyAtMs"`
	NextStartAtMs     *int64  `json:"nextStartAtMs"`
	AttackSpeed       float64 `json:"attackSpeed"`
	PostDefenseDamage float64 `json:"postDefenseDamage"`
	ActualHpLoss      float64 `json:"actualHpLoss"`
	SourceHpAfter     float64 `json:"sourceHpAfter"`
	TargetHpAfter     float64 `json:"targetHpAfter"`
	Completed         bool    `json:"completed"`
}
type DamageBreakdown struct {
	ProviderDefinitionRef string  `json:"providerDefinitionRef,omitempty"`
	Owner                 string  `json:"owner"`
	Source                string  `json:"source"`
	Target                string  `json:"target"`
	AbilityRef            string  `json:"abilityRef"`
	OperationRef          string  `json:"operationRef"`
	DamageType            string  `json:"damageType"`
	DamageCount           int     `json:"damageCount"`
	PostDefenseDamage     float64 `json:"postDefenseDamage"`
	ShieldAbsorbed        float64 `json:"shieldAbsorbed"`
	ActualHpLoss          float64 `json:"actualHpLoss"`
	OverkillDamage        float64 `json:"overkillDamage"`
}
type RecordingSummary struct {
	ResourceChangeRecordCount      *int  `json:"resourceChangeRecordCount,omitempty"`
	ReturnedResourceChangeRecords  *int  `json:"returnedResourceChangeRecords,omitempty"`
	DroppedResourceChangeRecords   *int  `json:"droppedResourceChangeRecords,omitempty"`
	ResourceChangeRecordsTruncated *bool `json:"resourceChangeRecordsTruncated,omitempty"`
	SkillActionRecordCount         int   `json:"skillActionRecordCount"`
	ReturnedSkillActionRecords     int   `json:"returnedSkillActionRecords"`
	DroppedSkillActionRecords      int   `json:"droppedSkillActionRecords"`
	SkillActionRecordsTruncated    bool  `json:"skillActionRecordsTruncated"`
	SkillUseRecordCount            int   `json:"skillUseRecordCount"`
	ReturnedSkillUseRecords        int   `json:"returnedSkillUseRecords"`
	DroppedSkillUseRecords         int   `json:"droppedSkillUseRecords"`
	SkillUseRecordsTruncated       bool  `json:"skillUseRecordsTruncated"`
	HealingRecordCount             int   `json:"healingRecordCount"`
	ReturnedHealingRecords         int   `json:"returnedHealingRecords"`
	DroppedHealingRecords          int   `json:"droppedHealingRecords"`
	HealingRecordsTruncated        bool  `json:"healingRecordsTruncated"`
	MechanicRecordCount            int   `json:"mechanicRecordCount"`
	ReturnedMechanicRecords        int   `json:"returnedMechanicRecords"`
	DroppedMechanicRecords         int   `json:"droppedMechanicRecords"`
	MechanicRecordsTruncated       bool  `json:"mechanicRecordsTruncated"`
	AttackRecordCount              int   `json:"attackRecordCount"`
	ReturnedAttackRecords          int   `json:"returnedAttackRecords"`
	DroppedAttackRecords           int   `json:"droppedAttackRecords"`
	AttackRecordsTruncated         bool  `json:"attackRecordsTruncated"`
	DamageRecordCount              int   `json:"damageRecordCount"`
	ReturnedDamageRecords          int   `json:"returnedDamageRecords"`
	DroppedDamageRecords           int   `json:"droppedDamageRecords"`
	DamageRecordsTruncated         bool  `json:"damageRecordsTruncated"`
}

type MechanicRecord struct {
	TimeMs                int64   `json:"timeMs"`
	Kind                  string  `json:"kind"`
	Owner                 string  `json:"owner"`
	ProviderRef           string  `json:"providerRef"`
	ProviderDefinitionRef string  `json:"providerDefinitionRef"`
	SkillKey              string  `json:"skillKey"`
	StateKey              string  `json:"stateKey"`
	BeforeValue           float64 `json:"beforeValue"`
	AfterValue            float64 `json:"afterValue"`
	OperationRef          string  `json:"operationRef"`
	UseRef                *string `json:"useRef"`
	ReadyAtMs             *int64  `json:"readyAtMs"`
}

const (
	MechanicStateChanged = "STATE_CHANGED"
	MechanicWaitStarted  = "WAIT_STARTED"
	MechanicWaitEnded    = "WAIT_ENDED"
)
