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
}

// RunSafetyBudget 是 run 请求级安全预算覆盖（§4.1）。
type RunSafetyBudget struct {
	MaxChainDepth       int `json:"maxChainDepth,omitempty"`
	MaxCommandsPerEvent int `json:"maxCommandsPerEvent,omitempty"`
	MaxEvents           int `json:"maxEvents,omitempty"`
}

// Snapshot 是 run 起始战斗状态。
type Snapshot struct {
	SchemaHash string              `json:"schemaHash"`
	RulesHash  string              `json:"rulesHash"`
	TimeMs     int64               `json:"timeMs"`
	Combatants []CombatantSnapshot `json:"combatants"`
}

// CombatantSnapshot 是 run 期单个 combatant 状态。
// finalSnapshot 输出要求稳定 shape：空 map/array 也必须 materialize，故关键字段不加 omitempty。
type CombatantSnapshot struct {
	Key           string                      `json:"key"`
	Attributes    map[string]AttributeSlotDef `json:"attributes"`
	Resources     map[string]ResourceSlotDef  `json:"resources"`
	Cooldowns     map[string]interface{}      `json:"cooldowns"`
	Providers     []CombatantProviderSnapshot `json:"providers"`
	Shields       []CombatantShieldSnapshot   `json:"shields"`
	AbilityState  map[string]interface{}      `json:"abilityState"`
	ProviderState map[string]interface{}      `json:"providerState"`
	Vars          map[string]interface{}      `json:"vars"`
}

// CombatantProviderSnapshot 是 combatant 上已挂载 provider 的运行态。
// finalSnapshot 要求 source/owner/stacks/expireAt/state 稳定输出；expireAt 为 null 表示 persistent。
type CombatantProviderSnapshot struct {
	ProviderRef   string                 `json:"providerRef"`
	DefinitionRef string                 `json:"definitionRef"`
	Source        string                 `json:"source"`
	Owner         string                 `json:"owner"`
	Stacks        int                    `json:"stacks"`
	ExpireAt      *int64                 `json:"expireAt"` // nil / JSON null = persistent
	State         map[string]interface{} `json:"state"`
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

// SamplingConfig 控制 series 采样。
type SamplingConfig struct {
	SampleEveryMs   int `json:"sampleEveryMs,omitempty"`
	DpsWindowMs     int `json:"dpsWindowMs,omitempty"`
	MaxSeriesPoints int `json:"maxSeriesPoints,omitempty"`
}
