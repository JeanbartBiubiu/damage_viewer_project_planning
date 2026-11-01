// 数值操作与事件共同引用的已冻结事实；不包含执行器、队列或可写状态。
package contract

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

// CritEvidence 冻结真实命中时的 expected crit 证据；phantom 原样回放，不重读属性。
// chanceEffective 是 q（修饰后有效暴击率）；originalCritChance 是 p（属性 clamp 后、修饰前）。
// normalPart/critPart 在 outgoing 投影后、抗性前更新；critAdjustedRawAmount 保持 pre-outgoing 合并量。
type CritEvidence struct {
	Present               bool
	Eligible              bool
	Policy                string
	ChanceRaw             float64
	OriginalCritChance    float64
	ChanceEffective       float64
	Multiplier            float64
	NaturalWeight         float64
	ForcedWeight          float64
	NaturalMultiplier     float64
	ForcedMultiplier      float64
	BaseRawAmount         float64
	NormalPart            float64
	CritPart              float64
	CritAdjustedRawAmount float64
}

// DamageFact 是 damage evidence Data 的构造输入（不新增顶层 DTO）。
type DamageFact struct {
	HealthOrder           uint64
	EmpoweredAttack       *model.ProcessEmpoweredAttack
	ActivationUseRef      string
	ProviderDefinitionRef string
	ProviderActivatedAtMs *int64
	Source                string
	Target                string
	DamageType            string
	RawAmount             float64
	MitigatedAmount       float64
	ProviderRef           string
	AbilityRef            string
	OperationRef          string
	OperationPath         string
	Owner                 string
	HpBefore              float64
	HpAfter               float64
	HasSourceHp           bool
	SourceHpBefore        float64
	SourceHpAfter         float64
	Phantom               bool
	RepeatTag             string
	ReplayedFrom          map[string]interface{}
	Crit                  CritEvidence
	Modifiers             []map[string]interface{}
	Traits                []string
	CastInstanceID        uint64
	CastOrigin            string
	DamageID              uint64
	Outcome               *pipeline.DamageOutcome
	// 成功的普通与复制结算都记录真实共同倍率和防御后两部分。
	// 金额无效的结算不伪造这些数值。
	HasPostResistanceEvidence bool
	ResistanceFactor          float64
	NormalPartPostResistance  float64
	CritPartPostResistance    float64
}

type ExecuteFact struct {
	Source       string
	Target       string
	ProviderRef  string
	AbilityRef   string
	OperationRef string
	HpBefore     float64
	MaxHp        float64
	HpRatio      float64
	Threshold    float64
	Killed       bool
	ShieldBypass bool
}

type DamageHistory struct {
	TimeMs    int64
	SourceKey string
	TargetKey string
	Amount    float64
}

type DamageStateBefore struct {
	Reader uint16
	Value  float64
}
