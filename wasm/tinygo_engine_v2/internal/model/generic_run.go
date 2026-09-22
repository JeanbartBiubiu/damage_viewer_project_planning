// canonical RunRequest 与 snapshot DTO（Slice B fixture / 后续 A2/C）。
package model

import "encoding/json"

// RunRequest 是 generic run frame 的顶层 payload。
type RunRequest struct {
	SessionID         string           `json:"sessionId"`
	ExpectedRulesHash string           `json:"expectedRulesHash,omitempty"`
	SchemaVersion     string           `json:"schemaVersion,omitempty"`
	SchemaHash        string           `json:"schemaHash,omitempty"`
	RulesHash         string           `json:"rulesHash,omitempty"`
	InitialSnapshot   Snapshot         `json:"initialSnapshot"`
	DriverPlan        DriverPlan       `json:"driverPlan"`
	StopPolicy        StopPolicy       `json:"stopPolicy"`
	SafetyBudget      *RunSafetyBudget `json:"safetyBudget,omitempty"`
	RuntimeOptions    json.RawMessage  `json:"runtimeOptions,omitempty"`
	Sampling          SamplingConfig   `json:"sampling,omitempty"`
	SkillUses         []SkillUseFact    `json:"skillUses,omitempty"`
	SkillHitFacts     []SkillHitFact    `json:"skillHitFacts,omitempty"`
	AttackStartFacts  []AttackStartFact `json:"attackStartFacts,omitempty"`
}

// RunSafetyBudget 是 run 请求级安全预算覆盖（§4.1）。
type RunSafetyBudget struct {
	MaxChainDepth       int `json:"maxChainDepth,omitempty"`
	MaxCommandsPerEvent int `json:"maxCommandsPerEvent,omitempty"`
	MaxEvents           int `json:"maxEvents,omitempty"`
}

// Snapshot 是 run 起始战斗状态。
type Snapshot struct {
	SchemaHash       string                  `json:"schemaHash"`
	RulesHash        string                  `json:"rulesHash"`
	TimeMs           int64                   `json:"timeMs"`
	Combatants       []CombatantSnapshot     `json:"combatants"`
	UseTriggerLedger []UseTriggerLedgerEntry `json:"useTriggerLedger"`
}

// CombatantSnapshot 是 run 期单个 combatant 状态。
// finalSnapshot 输出要求稳定 shape：空 map/array 也必须 materialize，故关键字段不加 omitempty。
// CombatantSnapshot 是 run 期单个 combatant 状态。
// finalSnapshot 输出要求稳定 shape：空 map/array 也必须 materialize，故关键字段不加 omitempty。
type CombatantSnapshot struct {
	Key               string                      `json:"key"`
	Attributes        map[string]AttributeSlotDef `json:"attributes"`
	Resources         map[string]ResourceSlotDef  `json:"resources"`
	Cooldowns         map[string]interface{}      `json:"cooldowns"`
	Providers         []CombatantProviderSnapshot `json:"providers"`
	Shields           []CombatantShieldSnapshot   `json:"shields"`
	AbilityState      map[string]interface{}      `json:"abilityState"`
	ProviderState     map[string]interface{}      `json:"providerState"`
	Vars              map[string]interface{}      `json:"vars"`
	EffectiveStatuses []EffectiveStatusSnapshot   `json:"effectiveStatuses"`
}

// CombatantProviderSnapshot 是 combatant 上已挂载 provider 的运行态。
// finalSnapshot 要求 source/owner/stacks/expireAt/state 稳定输出；expireAt 为 null 表示 persistent。
type CombatantProviderSnapshot struct {
	ProviderRef         string                               `json:"providerRef"`
	DefinitionRef       string                               `json:"definitionRef"`
	Source              string                               `json:"source"`
	Owner               string                               `json:"owner"`
	Stacks              int                                  `json:"stacks"`
	ExpireAt            *int64                               `json:"expireAt"` // nil / JSON null = persistent
	State               map[string]interface{}               `json:"state"`
	StatusContributions []ProviderStatusContributionSnapshot `json:"statusContributions,omitempty"`
}

// ProviderStatusContributionSnapshot 保存 apply/refresh 当时的真实强度；strength 用指针区分 JSON 0 与缺失。
type ProviderStatusContributionSnapshot struct {
	ResultRef  string   `json:"resultRef"`
	StatusKey  string   `json:"statusKey"`
	StatusKind string   `json:"statusKind"`
	Strength   *float64 `json:"strength"`
}

// EffectiveStatusSnapshot 是最终对象快照上只读的有效状态合并。
type EffectiveStatusSnapshot struct {
	StatusKind    string                        `json:"statusKind"`
	Strength      float64                       `json:"strength"`
	Contributions []EffectiveStatusContribution `json:"contributions"`
}

// EffectiveStatusContribution 是一条仍有效的普通减速贡献。
type EffectiveStatusContribution struct {
	ProviderRef string  `json:"providerRef"`
	ResultRef   string  `json:"resultRef"`
	StatusKey   string  `json:"statusKey"`
	Source      string  `json:"source"`
	ExpireAt    int64   `json:"expireAt"`
	Strength    float64 `json:"strength"`
}

// CombatantShieldSnapshot 是 combatant 上护盾运行态。
// finalSnapshot 要求 source/owner/remaining/priority/expireAt/state 稳定输出；expireAt 为 null 表示 persistent。
type CombatantShieldSnapshot struct {
	ShieldRef string                 `json:"shieldRef"`
	Source    string                 `json:"source"`
	Owner     string                 `json:"owner"`
	Remaining float64                `json:"remaining"`
	Priority  int16                  `json:"priority"`
	ExpireAt  *int64                 `json:"expireAt"` // nil / JSON null = persistent
	State     map[string]interface{} `json:"state"`
}

// StopPolicy 控制 run 停止条件。
type StopPolicy struct {
	DurationMs        int64 `json:"durationMs"`
	StopOnTargetDeath *bool `json:"stopOnTargetDeath,omitempty"`
	StopWhenNoEvents  *bool `json:"stopWhenNoEvents,omitempty"`
}

// StopOnTargetDeathOrDefault 返回 stopOnTargetDeath，省略时默认为 true（§4.1）。
func (p StopPolicy) StopOnTargetDeathOrDefault() bool {
	if p.StopOnTargetDeath == nil {
		return true
	}
	return *p.StopOnTargetDeath
}

// StopWhenNoEventsOrDefault 返回 stopWhenNoEvents，省略时默认为 true（§4.1）。
func (p StopPolicy) StopWhenNoEventsOrDefault() bool {
	if p.StopWhenNoEvents == nil {
		return true
	}
	return *p.StopWhenNoEvents
}

// BoolPtr 返回 bool 指针，供测试与构造 StopPolicy 使用。
func BoolPtr(v bool) *bool {
	return &v
}

// Float64Ptr 返回 float64 指针，供快照强度区分 JSON 0 与缺失。
func Float64Ptr(v float64) *float64 {
	return &v
}

// SamplingConfig 控制 series 采样。
type SamplingConfig struct {
	SampleEveryMs   int `json:"sampleEveryMs,omitempty"`
	DpsWindowMs     int `json:"dpsWindowMs,omitempty"`
	MaxSeriesPoints int `json:"maxSeriesPoints,omitempty"`
}
