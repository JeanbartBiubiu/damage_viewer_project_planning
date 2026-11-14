package model

// CumulativeRatioLimit只声明累计请求比例上限；运行时按真实原使用、目标和冷却能力建立额度。
type CumulativeRatioLimit struct {
	GroupKey string  `json:"groupKey"`
	MaxRatio float64 `json:"maxRatio"`
}

// UseAmountBudgetEntry是已发布的数值额度事实，不能作为累计退款场景的恢复输入。
type UseAmountBudgetEntry struct {
	UseTriggerLedgerEntry
	SubjectRef string  `json:"subjectRef"`
	MaxValue   float64 `json:"maxValue"`
	UsedValue  float64 `json:"usedValue"`
}
