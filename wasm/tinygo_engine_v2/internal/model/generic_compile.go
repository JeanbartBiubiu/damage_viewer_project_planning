// canonical CompileRequest 与相关 DTO（Slice B）。
package model

// CompileRequest 是 generic compile frame 的顶层 payload。
type CompileRequest struct {
	SchemaVersion   string                 `json:"schemaVersion"`
	SchemaHash      string                 `json:"schemaHash"`
	RulesHash       string                 `json:"rulesHash"`
	TypeCatalog     TypeCatalog            `json:"typeCatalog"`
	Combatants      []CombatantDefinition  `json:"combatants"`
	SharedProviders []ProviderDefinition   `json:"sharedProviders,omitempty"`
	Rules           RulesContainer         `json:"rules"`
	Formulas        []NamedFormula         `json:"formulas,omitempty"`
	Settings        GenericCompileSettings `json:"settings,omitempty"`
}

// TypeCatalog 声明 canonical type key 与 relation。
type TypeCatalog struct {
	Types     []TypeCatalogEntry `json:"types"`
	Relations []TypeRelation     `json:"relations"`
}

// TypeCatalogEntry 是单个 canonical type key。
type TypeCatalogEntry struct {
	Key    string `json:"key"`
	Domain string `json:"domain"`
	Group  string `json:"group,omitempty"`
}

// TypeRelation 描述 type 之间的父子关系（flat matcher 不展开闭包）。
type TypeRelation struct {
	Parent string `json:"parent"`
	Child  string `json:"child"`
}

// CombatantDefinition 是 P0 双 combatant 槽位定义。
type CombatantDefinition struct {
	Key         string                      `json:"key"`
	DisplayName string                      `json:"displayName,omitempty"`
	Types       []string                    `json:"types,omitempty"`
	Tags        []string                    `json:"tags,omitempty"`
	Attributes  map[string]AttributeSlotDef `json:"attributes"`
	Resources   map[string]ResourceSlotDef  `json:"resources"`
	Providers   []CombatantProviderMount    `json:"providers"`
}

// AttributeSlotDef 是 compile input / snapshot 属性槽。
// finalSnapshot 要求 resolved 稳定输出，故不加 omitempty。
type AttributeSlotDef struct {
	Base     float64 `json:"base"`
	Current  float64 `json:"current"`
	Max      float64 `json:"max"`
	Resolved float64 `json:"resolved"`
}

// ResourceSlotDef 是 compile input 资源槽初始值。
type ResourceSlotDef struct {
	Current float64 `json:"current"`
	Max     float64 `json:"max"`
}

// CombatantProviderMount 是 combatant 上的 provider 挂载引用。
type CombatantProviderMount struct {
	ProviderRef         string                 `json:"providerRef"`
	DefinitionRef       string                 `json:"definitionRef"`
	InitialState        map[string]interface{} `json:"initialState,omitempty"`
	InitialAbilityState map[string]interface{} `json:"initialAbilityState,omitempty"`
}

// ProviderDefinition 是可复用 capability provider 定义。
type ProviderDefinition struct {
	ProviderKey         string                         `json:"providerKey"`
	Kind                string                         `json:"kind"`
	StableID            string                         `json:"stableId"`
	Types               []string                       `json:"types,omitempty"`
	Tags                []string                       `json:"tags,omitempty"`
	Abilities           []AbilityDefinition            `json:"abilities,omitempty"`
	Modifiers           []ModifierDefinition           `json:"modifiers,omitempty"`
	Listeners           []ListenerDefinition           `json:"listeners,omitempty"`
	Lifecycle           *ProviderLifecycle             `json:"lifecycle,omitempty"`
	StatusContributions []StatusContributionDefinition `json:"statusContributions,omitempty"`
	InitialStateSchema  map[string]interface{}         `json:"initialStateSchema,omitempty"`
}

// ProviderStateFieldSchema 是 initialStateSchema 的结构化字段形态（Gate H1）。
// 旧形态仍允许纯数字默认值；结构化对象携带封顶与定时元数据。
type ProviderStateFieldSchema struct {
	DefaultValue  float64 `json:"defaultValue"`
	MaxValue      float64 `json:"maxValue"`
	DurationMs    int64   `json:"durationMs"`
	RefreshPolicy string  `json:"refreshPolicy,omitempty"`
}

// ProviderStateRefreshOnWrite 是每次写入续期的既有 refreshPolicy。
const ProviderStateRefreshOnWrite = "refresh_on_write"

// Provider 实例范围与普通减速种类。
const (
	InstanceScopeSourceTarget = "source_target"
	StatusKindMovementSlow    = "movement_slow"
	RefreshPolicyReplace      = "replace"
)

// ProviderLifecycle 描述 dynamic provider 生命周期。
type ProviderLifecycle struct {
	DurationMs     *GenericFormulaExpr `json:"durationMs,omitempty"`
	MaxStacks      int                 `json:"maxStacks,omitempty"`
	RefreshPolicy  string              `json:"refreshPolicy,omitempty"`
	TickIntervalMs int64               `json:"tickIntervalMs,omitempty"`
	InstanceScope  string              `json:"instanceScope,omitempty"`
}

// StatusContributionDefinition 是供值器在 apply/refresh 时快照的普通减速能力。
type StatusContributionDefinition struct {
	ResultRef  string             `json:"resultRef"`
	StatusKey  string             `json:"statusKey"`
	StatusKind string             `json:"statusKind"`
	Strength   GenericFormulaExpr `json:"strength"`
}

// CastOrigin 枚举：能力施放来源（可选；非空时必须是下列之一）。
const (
	CastOriginChampion = "champion"
	CastOriginItem     = "item"
	CastOriginPet      = "pet"
	CastOriginInnate   = "innate"
)

// ValidCastOrigins 是 AbilityDefinition.castOrigin 的合法非空值。
var ValidCastOrigins = map[string]struct{}{
	CastOriginChampion: {},
	CastOriginItem:     {},
	CastOriginPet:      {},
	CastOriginInnate:   {},
}

// AbilityDefinition 是 provider 内能力定义。
type AbilityDefinition struct {
	AbilityKey    string                 `json:"abilityKey"`
	Kind          string                 `json:"kind"`
	Types         []string               `json:"types,omitempty"`
	Tags          []string               `json:"tags,omitempty"`
	Params        map[string]float64     `json:"params,omitempty"`
	CastOrigin    string                 `json:"castOrigin,omitempty"` // champion|item|pet|innate
	SkillKey      string                 `json:"skillKey,omitempty"`
	Cost          *AbilityCost           `json:"cost,omitempty"`
	Cooldown      *AbilityCooldown       `json:"cooldown,omitempty"`
	CastCondition *GenericFormulaExpr    `json:"castCondition,omitempty"`
	Operations    []OperationDefinition  `json:"operations,omitempty"`
	ListenerSpec  *ListenerDefinition    `json:"listenerSpec,omitempty"`
	TickSpec      *TickSpec              `json:"tickSpec,omitempty"`
	StateSchema   map[string]interface{} `json:"stateSchema,omitempty"`
}

// AbilityCost 是 active ability 资源消耗。
type AbilityCost struct {
	ResourceKey  string             `json:"resourceKey"`
	Amount       GenericFormulaExpr `json:"amount"`
	AllowPartial bool               `json:"allowPartial,omitempty"`
}

// AbilityCooldown 是 active ability 基础 CD。
type AbilityCooldown struct {
	DurationMs GenericFormulaExpr `json:"durationMs"`
	StartsOn   string             `json:"startsOn,omitempty"`
	GroupKey   string             `json:"groupKey,omitempty"`
}

// TickSpec 是 tick ability 行为。
// 可选配对字段 AnchorScope + AnchorStateKey：同时省略时保持既有 mount/run provider tick；
// 同时存在时进入 target-state-anchored tick（当前仅支持 state_scope/provider_target）。
type TickSpec struct {
	IntervalMs     int64                 `json:"intervalMs"`
	OnTick         []OperationDefinition `json:"onTick"`
	StartDelayMs   int64                 `json:"startDelayMs,omitempty"`
	AnchorScope    string                `json:"anchorScope,omitempty"`
	AnchorStateKey string                `json:"anchorStateKey,omitempty"`
}

// Operation kind / repeat scope 常量（Gate K / execute compile 合同；非旧 DPS DTO）。
const (
	OperationKindRepeat              = "repeat"
	OperationKindExecuteThreshold    = "execute_threshold"
	OperationKindStateDurationChange = "state_duration_change"
	RepeatScopeCopyableOnHit         = "copyable_on_hit"
)

// OperationDefinition 是 ability 成功执行后的 operation。
type OperationDefinition struct {
	Operation             string                   `json:"operation"`
	Target                string                   `json:"target"`
	Amount                *GenericFormulaExpr      `json:"amount,omitempty"`
	ValuePolicy           string                   `json:"valuePolicy,omitempty"`
	DamageType            string                   `json:"damageType,omitempty"`
	ResourceKey           string                   `json:"resourceKey,omitempty"`
	AttributeKey          string                   `json:"attributeKey,omitempty"`
	AbilityRef            string                   `json:"abilityRef,omitempty"`
	ShieldRef             string                   `json:"shieldRef,omitempty"`
	ProviderDefinitionRef string                   `json:"providerDefinitionRef,omitempty"`
	ProviderRef           string                   `json:"providerRef,omitempty"`
	EventType             string                   `json:"eventType,omitempty"`
	Payload               map[string]interface{}   `json:"payload,omitempty"`
	Types                 []string                 `json:"types,omitempty"`
	Tags                  []string                 `json:"tags,omitempty"`
	Ref                   string                   `json:"ref,omitempty"`
	Condition             *GenericFormulaExpr      `json:"condition,omitempty"`
	CopyableOnHit         bool                     `json:"copyableOnHit,omitempty"`
	CritEligible          bool                     `json:"critEligible,omitempty"`
	VampQualification     string                   `json:"vampQualification,omitempty"`
	VampOverrides         []VampOverrideDefinition `json:"vampOverrides,omitempty"`
	RepeatScope           string                   `json:"repeatScope,omitempty"`
	RepeatCount           int                      `json:"repeatCount,omitempty"`
	RepeatTag             string                   `json:"repeatTag,omitempty"`
	// RepeatDelayMs 可选非负延迟；省略/0 保持即时 phantom replay。
	RepeatDelayMs   int     `json:"repeatDelayMs,omitempty"`
	TriggerStateKey string  `json:"triggerStateKey,omitempty"`
	Threshold       float64 `json:"threshold,omitempty"`
	// SkillHit 仅 resolve_skill_hit 使用；无自由 payload。
	SkillHit *SkillHitDefinition `json:"skillHit,omitempty"`
	// ProviderRefFromEvent 仅 expire_provider 在 event/spell_shield_blocked 上定位冻结实例。
	ProviderRefFromEvent bool `json:"providerRefFromEvent,omitempty"`
	// OutputRef 仅真实 damage 结算导出同帧口径；后续操作用 operation.output.<ref>.<kind> 读取。
	OutputRef string `json:"outputRef,omitempty"`
	// ShieldDurationMs 仅 shield 允许；省略表示无期限。有字段时运行按施加帧严格求值。
	ShieldDurationMs *GenericFormulaExpr `json:"shieldDurationMs,omitempty"`
}

// ModifierDefinition 是 provider 级 modifier。
type ModifierDefinition struct {
	ModifierKey              string              `json:"modifierKey"`
	Kind                     string              `json:"kind"`
	Target                   string              `json:"target,omitempty"`
	Command                  string              `json:"command,omitempty"`
	Channel                  string              `json:"channel,omitempty"`
	Bucket                   string              `json:"bucket,omitempty"`
	Stage                    string              `json:"stage,omitempty"`
	Priority                 int                 `json:"priority,omitempty"`
	HealDirection            string              `json:"healDirection,omitempty"`
	HealCategory             string              `json:"healCategory,omitempty"`
	HealGroupKey             string              `json:"healGroupKey,omitempty"`
	HealGroupCalculationMode string              `json:"healGroupCalculationMode,omitempty"`
	ValuePolicy              string              `json:"valuePolicy"`
	Value                    GenericFormulaExpr  `json:"value"`
	Condition                *GenericFormulaExpr `json:"condition,omitempty"`
}

// ListenerDefinition 是 provider 级 listener。
type ListenerDefinition struct {
	ListenerKey         string                `json:"listenerKey"`
	EventMatcher        TypeMatcher           `json:"eventMatcher"`
	AbilityRef          string                `json:"abilityRef,omitempty"`
	Operations          []OperationDefinition `json:"operations,omitempty"`
	MaxTriggersPerEvent int                   `json:"maxTriggersPerEvent,omitempty"`
	ChainLimitKey       string                `json:"chainLimitKey,omitempty"`
	// PerCastThrottleMs 同一 castInstanceId 上的最小触发间隔；省略/0 保持旧行为。
	PerCastThrottleMs int `json:"perCastThrottleMs,omitempty"`
	// Condition 在分发任何动作前按 owner-relative 上下文与原事件快照冻结。
	Condition *GenericFormulaExpr `json:"condition,omitempty"`
	// OncePerUse 是共享同次使用额度；省略表示未启用本项新限制。
	OncePerUse *OncePerUseLimit `json:"oncePerUse,omitempty"`
}

// TypeMatcher 是 flat bitset matcher 的 JSON 形态。
type TypeMatcher struct {
	Any  []string `json:"any,omitempty"`
	All  []string `json:"all,omitempty"`
	None []string `json:"none,omitempty"`
}

// RulesContainer 聚合全局规则。
type RulesContainer struct {
	VampRules    []VampRuleDefinition  `json:"vampRules,omitempty"`
	Operations   []OperationDefinition `json:"operations,omitempty"`
	Modifiers    []ModifierDefinition  `json:"modifiers,omitempty"`
	Listeners    []ListenerDefinition  `json:"listeners,omitempty"`
	TriggerRules []interface{}         `json:"triggerRules,omitempty"`
}

// NamedFormula 是命名公式定义（供 ref 引用）。
type NamedFormula struct {
	Key        string             `json:"key"`
	Expression GenericFormulaExpr `json:"expression"`
}

// GenericFormulaExpr 是 P0 numeric formula DSL 节点。
type GenericFormulaExpr struct {
	Op       string               `json:"op"`
	Value    *float64             `json:"value,omitempty"`
	Path     string               `json:"path,omitempty"`
	Ref      string               `json:"ref,omitempty"`
	Args     []GenericFormulaExpr `json:"args,omitempty"`
	Decimals *int                 `json:"decimals,omitempty"`
	Min      *GenericFormulaExpr  `json:"min,omitempty"`
	Max      *GenericFormulaExpr  `json:"max,omitempty"`
	// clamp/round/floor/ceil/trunc 使用 value 字段承载子表达式
	Expr *GenericFormulaExpr `json:"expr,omitempty"`
}

// GenericCompileSettings 是 compile 期引擎设置。
type GenericCompileSettings struct {
	MaxEvents           int `json:"maxEvents,omitempty"`
	MaxCommandsPerEvent int `json:"maxCommandsPerEvent,omitempty"`
	MaxQueueEvents      int `json:"maxQueueEvents,omitempty"`
	MaxChainDepth       int `json:"maxChainDepth,omitempty"`
}

// DriverPlan 是 run 期 ability attempt 调度计划（compile 阶段仅校验 DTO 形态）。
type DriverPlan struct {
	Entries                    []DriverEntry `json:"entries"`
	ConditionRecheckIntervalMs int64         `json:"conditionRecheckIntervalMs,omitempty"`
}

// DriverEntry 是 driver plan 单条 entry。
type DriverEntry struct {
	EntryKey   string              `json:"entryKey"`
	AbilityRef string              `json:"abilityRef"`
	Source     string              `json:"source"`
	Target     string              `json:"target"`
	Priority   int                 `json:"priority,omitempty"`
	FirstAtMs  int64               `json:"firstAtMs"`
	Repeat     *DriverRepeat       `json:"repeat,omitempty"`
	WhileReady interface{}         `json:"whileReady,omitempty"`
	Condition  *GenericFormulaExpr `json:"condition,omitempty"`
}

// DriverRepeat 是 ability attempt 重复策略：固定 IntervalMs 或动态 IntervalFormula（二者互斥）。
type DriverRepeat struct {
	IntervalMs      int64               `json:"intervalMs,omitempty"`
	IntervalFormula *GenericFormulaExpr `json:"intervalFormula,omitempty"`
	MaxAttempts     int                 `json:"maxAttempts,omitempty"`
}

// P0 combatant selector 常量。
const (
	SelectorSource   = "source"
	SelectorTarget   = "target"
	SelectorSelf     = "self"
	SelectorOpponent = "opponent"
)

// ValidCombatantSelectors 是 P0 允许的 target selector。
var ValidCombatantSelectors = map[string]struct{}{
	SelectorSource: {}, SelectorTarget: {}, SelectorSelf: {}, SelectorOpponent: {},
}
