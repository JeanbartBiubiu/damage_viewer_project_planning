package model

// 第4项 casting-runtime-r2：主动过程、明确控制事实与可恢复实例。
type ProcessControlDefinition struct {
	ProcessKey    string `json:"processKey"`
	Action        string `json:"action"`
	StepKey       string `json:"stepKey,omitempty"`
	FailureReason string `json:"failureReason,omitempty"`
}

type ProcessStepDefinition struct {
	StepKey          string              `json:"stepKey"`
	StepType         string              `json:"stepType"`
	DelayMs          *GenericFormulaExpr `json:"delayMs,omitempty"`
	MinimumChargeMs  *GenericFormulaExpr `json:"minimumChargeMs,omitempty"`
	MaximumChargeMs  *GenericFormulaExpr `json:"maximumChargeMs,omitempty"`
	ReleaseAtMaximum *bool               `json:"releaseAtMaximum,omitempty"`
	WindowMs         *GenericFormulaExpr `json:"windowMs,omitempty"`
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
	DurationMs  GenericFormulaExpr      `json:"durationMs"`
	StartMoment ProcessMomentDefinition `json:"startMoment"`
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

type ProcessInstanceSnapshot struct {
	Owner           string             `json:"owner"`
	ProviderRef     string             `json:"providerRef"`
	ProcessKey      string             `json:"processKey"`
	SkillKey        string             `json:"skillKey"`
	UseKey          string             `json:"useKey"`
	Target          string             `json:"target"`
	StepKey         string             `json:"stepKey"`
	StepVersion     int                `json:"stepVersion"`
	StartedAtMs     int64              `json:"startedAtMs"`
	StepStartedAtMs int64              `json:"stepStartedAtMs"`
	AdvanceAtMs     int64              `json:"advanceAtMs"`
	ExpiresAtMs     *int64             `json:"expiresAtMs"`
	ActualCosts     map[string]float64 `json:"actualCosts"`
	CooldownStarted bool               `json:"cooldownStarted"`
	Status          string             `json:"status"`
	FailureReason   *string            `json:"failureReason"`
	FinishedAtMs    *int64             `json:"finishedAtMs"`
}

func ValidProcessFailureReason(reason string) bool {
	switch reason {
	case "CONTROLLED", "SOURCE_DIED", "TARGET_UNTARGETABLE", "ACTIVE_CANCELLED", "EVENT_ABORTED":
		return true
	}
	return false
}
