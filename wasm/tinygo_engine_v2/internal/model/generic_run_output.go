// generic run 输出 DTO（§16 DoneResult / summary / evidence / series）。
package model

// StopReason 是 run 结束原因枚举。
type StopReason string

const (
	StopReasonDurationReached StopReason = "duration_reached"
	StopReasonTargetDead      StopReason = "target_dead"
	StopReasonSourceDead      StopReason = "source_dead"
	StopReasonBothDead        StopReason = "both_dead"
	StopReasonNoEvents        StopReason = "no_events"
	StopReasonBudgetExceeded  StopReason = "budget_exceeded"
)

// AttemptSkipReason 是 attempt gate skip 原因。
type AttemptSkipReason string

const (
	AttemptSkipUnknownAbilityRef    AttemptSkipReason = "unknown_ability_ref"
	AttemptSkipTargetUnavailable    AttemptSkipReason = "target_unavailable"
	AttemptSkipCooldownNotReady     AttemptSkipReason = "cooldown_not_ready"
	AttemptSkipResourceInsufficient AttemptSkipReason = "resource_insufficient"
	AttemptSkipConditionFalse       AttemptSkipReason = "condition_false"
)

// EvidenceKind 是 P0 evidence kind 枚举。
type EvidenceKind string

const (
	EvidenceKindAttemptSkipped  EvidenceKind = "attempt_skipped"
	EvidenceKindBudgetExceeded  EvidenceKind = "budget_exceeded"
	EvidenceKindDownsampled     EvidenceKind = "downsampled"
	EvidenceKindProviderTick    EvidenceKind = "provider_tick"
	EvidenceKindEmittedEvent    EvidenceKind = "emitted_event"
	EvidenceKindListenerSkipped EvidenceKind = "listener_skipped"
	EvidenceKindDamage          EvidenceKind = "damage"
	EvidenceKindExecute         EvidenceKind = "execute"
	EvidenceKindVamp            EvidenceKind = "vamp"
	EvidenceKindHeal            EvidenceKind = "heal"
)

// DoneResult 是 generic run 成功时的 outbox payload。
type DoneResult struct {
	OK                     bool                   `json:"ok"`
	Summary                RunSummary             `json:"summary"`
	FinalSnapshot          Snapshot               `json:"finalSnapshot"`
	Series                 []SeriesPoint          `json:"series"`
	Warnings               []WarningItem          `json:"warnings"`
	Evidence               EvidenceCollection     `json:"evidence"`
	SeriesSamplingEvidence SeriesSamplingEvidence `json:"seriesSamplingEvidence"`
}

// RunSummary 是 chart-ready 汇总行。
type RunSummary struct {
	DurationMs          int64         `json:"durationMs"`
	StopReason          StopReason    `json:"stopReason"`
	SourceFinalHp       float64       `json:"sourceFinalHp"`
	TargetFinalHp       float64       `json:"targetFinalHp"`
	SourceDamageDealt   float64       `json:"sourceDamageDealt"`
	SourceDamageTaken   float64       `json:"sourceDamageTaken"`
	TargetDamageDealt   float64       `json:"targetDamageDealt"`
	TargetDamageTaken   float64       `json:"targetDamageTaken"`
	SourceOverheal      float64       `json:"sourceOverheal,omitempty"`
	TargetOverheal      float64       `json:"targetOverheal,omitempty"`
	AbilityAttemptCount int           `json:"abilityAttemptCount"`
	AbilityCastCount    int           `json:"abilityCastCount"`
	AttemptSkippedCount int           `json:"attemptSkippedCount"`
	WarningCount        int           `json:"warningCount"`
	EvidenceTruncated   bool          `json:"evidenceTruncated"`
	SeriesDownsampled   bool          `json:"seriesDownsampled"`
	AbilityStats        []AbilityStat `json:"abilityStats"`
}

// AbilityStat 是按 abilityRef 分组的统计。
type AbilityStat struct {
	AbilityRef   string   `json:"abilityRef"`
	AttemptCount int      `json:"attemptCount"`
	CastCount    int      `json:"castCount"`
	SkipCount    int      `json:"skipCount"`
	DamageDealt  *float64 `json:"damageDealt,omitempty"`
	HealingDone  *float64 `json:"healingDone,omitempty"`
}

// SeriesPoint 是 chart-ready 时间序列点。
type SeriesPoint struct {
	TimeMs              int64   `json:"timeMs"`
	SourceHp            float64 `json:"sourceHp"`
	TargetHp            float64 `json:"targetHp"`
	SourceDamageDealt   float64 `json:"sourceDamageDealt"`
	TargetDamageDealt   float64 `json:"targetDamageDealt"`
	SourceCumulativeDps float64 `json:"sourceCumulativeDps"`
	TargetCumulativeDps float64 `json:"targetCumulativeDps"`
	SourceWindowDps     float64 `json:"sourceWindowDps"`
	TargetWindowDps     float64 `json:"targetWindowDps"`
}

// EvidenceItem 是机器可追踪事实明细。
type EvidenceItem struct {
	TimeMs  int64                  `json:"timeMs"`
	Kind    EvidenceKind           `json:"kind"`
	Ref     string                 `json:"ref,omitempty"`
	Path    string                 `json:"path,omitempty"`
	Message string                 `json:"message,omitempty"`
	Data    map[string]interface{} `json:"data,omitempty"`
}

// EvidenceCollection 是 evidence 集合与截断摘要。
type EvidenceCollection struct {
	Items                  []EvidenceItem `json:"items"`
	Truncated              bool           `json:"truncated"`
	TruncatedEvidenceCount int            `json:"truncatedEvidenceCount"`
	CountsByKind           map[string]int `json:"countsByKind"`
}

// SeriesSamplingEvidence 描述 series 采样与降采样。
type SeriesSamplingEvidence struct {
	RequestedSampleEveryMs int    `json:"requestedSampleEveryMs"`
	EffectiveSampleEveryMs int    `json:"effectiveSampleEveryMs"`
	RequestedPointCount    int    `json:"requestedPointCount"`
	FinalPointCount        int    `json:"finalPointCount"`
	MaxSeriesPoints        int    `json:"maxSeriesPoints"`
	Downsampled            bool   `json:"downsampled"`
	Method                 string `json:"method"`
}

// SafetyBudget 是 run 期安全预算默认值（§4.1）。
type SafetyBudget struct {
	MaxChainDepth       int
	MaxCommandsPerEvent int
	MaxEvents           int
	MaxEvidenceItems    int
	MaxWarnings         int
}

// DefaultSafetyBudget 返回 §4.1 默认安全预算。
func DefaultSafetyBudget() SafetyBudget {
	return SafetyBudget{
		MaxChainDepth:       32,
		MaxCommandsPerEvent: 256,
		MaxEvents:           100000,
		MaxEvidenceItems:    1000,
		MaxWarnings:         100,
	}
}

// DefaultSamplingConfig 返回 §4.1 默认采样配置。
func DefaultSamplingConfig() SamplingConfig {
	return SamplingConfig{
		SampleEveryMs:   100,
		DpsWindowMs:     1000,
		MaxSeriesPoints: 5000,
	}
}
