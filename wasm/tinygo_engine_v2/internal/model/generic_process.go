package model

const EventTypeProcessResolved = "event/process_resolved"

// 第4项 casting-runtime-r2：主动过程、明确控制事实与可恢复实例。
type ProcessControlDefinition struct {
	ProcessKey    string `json:"processKey"`
	Action        string `json:"action"`
	StepKey       string `json:"stepKey,omitempty"`
	FailureReason string `json:"failureReason,omitempty"`
	// UseRefFromEvent 仅 INITIAL 普攻控制从原生开始事件复用真实使用归属。
	UseRefFromEvent bool `json:"useRefFromEvent,omitempty"`
	// RequireExplicitSelfTarget is an authored INITIAL gate, before any process writes.
	RequireExplicitSelfTarget *bool `json:"requireExplicitSelfTarget,omitempty"`
}

type ProcessStepDefinition struct {
	StepKey                string              `json:"stepKey"`
	StepType               string              `json:"stepType"`
	OccupiesAction         *bool               `json:"occupiesAction,omitempty"`
	DelayMs                *GenericFormulaExpr `json:"delayMs,omitempty"`
	MinimumChargeMs        *GenericFormulaExpr `json:"minimumChargeMs,omitempty"`
	MaximumChargeMs        *GenericFormulaExpr `json:"maximumChargeMs,omitempty"`
	ReleaseAtMaximum       *bool               `json:"releaseAtMaximum,omitempty"`
	WindowMs               *GenericFormulaExpr `json:"windowMs,omitempty"`
	ConsumeMoment          *string             `json:"consumeMoment,omitempty"`
	MaximumAttackCount     *GenericFormulaExpr `json:"maximumAttackCount,omitempty"`
	RepeatCount            *GenericFormulaExpr `json:"repeatCount,omitempty"`
	IntervalMs             *GenericFormulaExpr `json:"intervalMs,omitempty"`
	DurationMs             *GenericFormulaExpr `json:"durationMs,omitempty"`
	ExecutionCount         *GenericFormulaExpr `json:"executionCount,omitempty"`
	FirstExecution         *string             `json:"firstExecution,omitempty"`
	FirstExecutionOffsetMs *GenericFormulaExpr `json:"firstExecutionOffsetMs,omitempty"`
	LastExecutionOffsetMs  *GenericFormulaExpr `json:"lastExecutionOffsetMs,omitempty"`
}

type ProcessMomentDefinition struct {
	MomentType    string  `json:"momentType"`
	StepKey       *string `json:"stepKey"`
	FailureReason *string `json:"failureReason"`
}

type ProcessCostDefinition struct {
	ResourceKey string             `json:"resourceKey"`
	Amount      GenericFormulaExpr `json:"amount"`
}

type ProcessCooldownDefinition struct {
	RoundPositiveMs bool                    `json:"roundPositiveMs,omitempty"`
	DurationMs      GenericFormulaExpr      `json:"durationMs"`
	StartMoment     ProcessMomentDefinition `json:"startMoment"`
}

type ProcessMomentOperations struct {
	Moment     ProcessMomentDefinition `json:"moment"`
	Operations []OperationDefinition   `json:"operations"`
}

type ProcessDefinition struct {
	ProcessKey       string                     `json:"processKey"`
	SkillKey         string                     `json:"skillKey"`
	Steps            []ProcessStepDefinition    `json:"steps"`
	Costs            []ProcessCostDefinition    `json:"costs"`
	Cooldown         *ProcessCooldownDefinition `json:"cooldown"`
	MomentOperations []ProcessMomentOperations  `json:"momentOperations"`
}

type ProcessCommandFact struct {
	DriverEntryKey string `json:"driverEntryKey"`
	UseRef         string `json:"useRef"`
}

type ProcessRepeatSnapshot struct {
	ExecutionCount         int    `json:"executionCount"`
	ExecutionIndex         int    `json:"executionIndex"`
	IntervalMs             int64  `json:"intervalMs"`
	FirstExecutionOffsetMs int64  `json:"firstExecutionOffsetMs"`
	LastExecutionOffsetMs  int64  `json:"lastExecutionOffsetMs"`
	NextExecutionAtMs      *int64 `json:"nextExecutionAtMs"`
}

type ProcessActionOccupancy struct {
	StepKey         string `json:"stepKey"`
	StepVersion     int    `json:"stepVersion"`
	StartedAtMs     int64  `json:"startedAtMs"`
	ExpectedEndAtMs int64  `json:"expectedEndAtMs"`
	FinishedAtMs    *int64 `json:"finishedAtMs"`
}

// ProcessEmpoweredAttack links an activation use to the actual native attack.
// The activation identity remains ProcessInstanceSnapshot.UseKey.
type ProcessEmpoweredAttack struct {
	UseRef          string                      `json:"useRef"`
	HitRef          string                      `json:"hitRef"`
	Target          string                      `json:"target"`
	ReplacedPrimary *BasicAttackPrimaryIdentity `json:"replacedPrimary,omitempty"`
}

// ProcessAttackConsumption binds a consumed window charge to one real attack.
// A resolved non-hit has no HitRef/HitSequence; an in-flight attack has no resolution time.
type ProcessAttackConsumption struct {
	ConsumptionIndex int     `json:"consumptionIndex"`
	UseRef           string  `json:"useRef"`
	Target           string  `json:"target"`
	StartedAtMs      int64   `json:"startedAtMs"`
	HitRef           *string `json:"hitRef"`
	HitSequence      *int    `json:"hitSequence"`
	ResolvedAtMs     *int64  `json:"resolvedAtMs"`
}

type ProcessEmpoweredAttackWindow struct {
	MaximumAttackCount int                        `json:"maximumAttackCount"`
	ConsumptionCount   int                        `json:"consumptionCount"`
	PendingHitCount    int                        `json:"pendingHitCount"`
	Consumptions       []ProcessAttackConsumption `json:"consumptions"`
}

// BasicAttackPrimaryIdentity names the real native input binding, not an IR offset.
type BasicAttackPrimaryIdentity struct {
	Owner                    string `json:"owner"`
	ProviderRef              string `json:"providerRef"`
	DefinitionRef            string `json:"definitionRef"`
	StartAbilityRef          string `json:"startAbilityRef"`
	InitialControlAbilityRef string `json:"initialControlAbilityRef"`
	HitAbilityRef            string `json:"hitAbilityRef"`
	CandidateKey             string `json:"candidateKey"`
	EffectOccurrenceKey      string `json:"effectOccurrenceKey"`
	EffectKey                string `json:"effectKey"`
	ResultKey                string `json:"resultKey"`
}

// 已执行的显式简单阶段事实；不受展示记录预算影响，也不用于恢复资格。
type ProcessSkillHitStage struct {
	HitBindingKey string `json:"hitBindingKey"`
	StepKey       string `json:"stepKey"`
	TimeMs        int64  `json:"timeMs"`
	Released      bool   `json:"released"`
	Contact       bool   `json:"contact"`
	Completed     bool   `json:"completed"`
}

type ProcessInstanceSnapshot struct {
	Owner                      string                        `json:"owner"`
	ProviderRef                string                        `json:"providerRef"`
	ProcessKey                 string                        `json:"processKey"`
	SkillKey                   string                        `json:"skillKey"`
	UseKey                     string                        `json:"useKey"`
	Target                     string                        `json:"target"`
	StepKey                    string                        `json:"stepKey"`
	StepVersion                int                           `json:"stepVersion"`
	StepExecutionIndex         int                           `json:"stepExecutionIndex"`
	LastExecutionAtMs          *int64                        `json:"lastExecutionAtMs"`
	StepCompletedAtMs          *int64                        `json:"stepCompletedAtMs"`
	StartedAtMs                int64                         `json:"startedAtMs"`
	StepStartedAtMs            int64                         `json:"stepStartedAtMs"`
	AdvanceAtMs                int64                         `json:"advanceAtMs"`
	ExpiresAtMs                *int64                        `json:"expiresAtMs"`
	ActualCosts                map[string]float64            `json:"actualCosts"`
	CooldownStarted            bool                          `json:"cooldownStarted"`
	Status                     string                        `json:"status"`
	FailureReason              *string                       `json:"failureReason"`
	FinishedAtMs               *int64                        `json:"finishedAtMs"`
	Repeat                     *ProcessRepeatSnapshot        `json:"repeat"`
	ActionOccupancies          []ProcessActionOccupancy      `json:"actionOccupancies"`
	EmpoweredAttack            *ProcessEmpoweredAttack       `json:"empoweredAttack,omitempty"`
	EmpoweredAttackWindow      *ProcessEmpoweredAttackWindow `json:"empoweredAttackWindow,omitempty"`
	EmpoweredPredecessorUseRef *string                       `json:"empoweredPredecessorUseRef,omitempty"`
	SkillHitStages             *[]ProcessSkillHitStage       `json:"skillHitStages,omitempty"`
}

func ValidProcessFailureReason(reason string) bool {
	switch reason {
	case "CONTROLLED", "SOURCE_DIED", "TARGET_UNTARGETABLE", "ACTIVE_CANCELLED", "EVENT_ABORTED":
		return true
	}
	return false
}
