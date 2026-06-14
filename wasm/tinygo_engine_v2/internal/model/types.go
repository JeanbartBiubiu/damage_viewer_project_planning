// V2 公共契约层：输入/输出 DTO、枚举、frame kind、错误码。
//
// 不变量：字段语义变更必须先改本包，再同步 compile/runtime/前端；此处不含任何运行时逻辑。
// 文件内 alias（EngineBundle 等）仅作旧名兼容，不是新契约入口。
package model

type FrameKind uint16

const (
	SchemaVersion uint16 = 1

	FrameKindInit           FrameKind = 1
	FrameKindRun            FrameKind = 2
	FrameKindTick           FrameKind = 10
	FrameKindLog            FrameKind = 11
	FrameKindSample         FrameKind = 12
	FrameKindDone           FrameKind = 13
	FrameKindError          FrameKind = 14
	FrameKindReady          FrameKind = 15
	FrameKindSnapshot       FrameKind = 16
	FrameKindActionSnapshot FrameKind = 17
	FrameKindBinaryRun      FrameKind = 100
)

type ErrCode string

const (
	ErrOK                   ErrCode = "OK"
	ErrBadMagic             ErrCode = "E_BAD_MAGIC"
	ErrSchemaMismatch       ErrCode = "E_SCHEMA_MISMATCH"
	ErrUnknownAttr          ErrCode = "E_UNKNOWN_ATTR"
	ErrUnknownFormula       ErrCode = "E_UNKNOWN_FORMULA"
	ErrUnknownActor         ErrCode = "E_UNKNOWN_ACTOR"
	ErrUnknownAction        ErrCode = "E_UNKNOWN_ACTION"
	ErrUnknownStatus        ErrCode = "E_UNKNOWN_STATUS"
	ErrUnknownResource      ErrCode = "E_UNKNOWN_RESOURCE"
	ErrRuleConflict         ErrCode = "E_RULE_CONFLICT"
	ErrQueueOverflow        ErrCode = "E_QUEUE_OVERFLOW"
	ErrArenaFull            ErrCode = "E_ARENA_FULL"
	ErrNumeric              ErrCode = "E_NUMERIC"
	ErrUnsupported          ErrCode = "E_UNSUPPORTED"
	ErrInvalidInput         ErrCode = "E_INVALID_INPUT"
	ErrNotReady             ErrCode = "E_NOT_READY"
	ErrInsufficientResource ErrCode = "E_INSUFFICIENT_RESOURCE"
)

type AttributeReadKind string

const (
	AttrReadResolved AttributeReadKind = "resolved"
	AttrReadBase     AttributeReadKind = "base"
	AttrReadCurrent  AttributeReadKind = "current"
	AttrReadMax      AttributeReadKind = "max"
)

type AttrModifierMode string

const (
	AttrModifierFlat            AttrModifierMode = "flat"
	AttrModifierPercent         AttrModifierMode = "percent"
	AttrModifierOverrideBase    AttrModifierMode = "override_base"
	AttrModifierOverrideCurrent AttrModifierMode = "override_current"
	AttrModifierOverrideMax     AttrModifierMode = "override_max"
)

type EventPhase string

const (
	EventPhaseActionCast   EventPhase = "action_cast"
	EventPhaseDamageDealt  EventPhase = "damage_dealt"
	EventPhaseDamageTaken  EventPhase = "damage_taken"
	EventPhaseHealApplied  EventPhase = "heal_applied"
	EventPhaseStatusApply  EventPhase = "status_apply"
	EventPhaseStatusExpire EventPhase = "status_expire"
)

type ValuePhase string

const (
	ValuePhaseRaw        ValuePhase = "raw"
	ValuePhaseCrit       ValuePhase = "crit"
	ValuePhaseOutgoing   ValuePhase = "outgoing"
	ValuePhaseIncoming   ValuePhase = "incoming"
	ValuePhaseMitigation ValuePhase = "mitigation"
	ValuePhaseShield     ValuePhase = "shield"
	ValuePhaseMutation   ValuePhase = "mutation"
)

type EffectType string

const (
	EffectTypeDealDamage       EffectType = "deal_damage"
	EffectTypeHeal             EffectType = "heal"
	EffectTypeApplyStatus      EffectType = "apply_status"
	EffectTypeGrantShield      EffectType = "grant_shield"
	EffectTypeApplyMark        EffectType = "apply_mark"
	EffectTypeConsumeMark      EffectType = "consume_mark"
	EffectTypeDamageFromRecent EffectType = "damage_from_recent"
	EffectTypeInterrupt        EffectType = "interrupt"
	EffectTypeIncrementCounter EffectType = "increment_counter"
	EffectTypeSpendResource    EffectType = "spend_resource"
	EffectTypeModifyAttribute  EffectType = "modify_attribute"
)

type TypeListV2 []string

type ClassifierV2 struct {
	Types TypeListV2 `json:"types,omitempty"`
	Tags  TypeListV2 `json:"tags,omitempty"`
}

type TypeMatcherV2 struct {
	Any  TypeListV2 `json:"any,omitempty"`
	All  TypeListV2 `json:"all,omitempty"`
	None TypeListV2 `json:"none,omitempty"`
}

// EngineBundleV2 是 init frame 的 JSON 根对象；compile.Bundle 将其编译为只读 CompiledBundle。
type EngineBundleV2 struct {
	SchemaVersion            uint16                      `json:"schemaVersion"`
	Attributes               []AttributeDefinitionV2     `json:"attributes"`
	Resources                []ResourceDefinitionV2      `json:"resources,omitempty"`
	Actors                   []ActorTemplateV2           `json:"actors"`
	Actions                  []ActionTemplateV2          `json:"actions"`
	Statuses                 []StatusTemplateV2          `json:"statuses,omitempty"`
	StatusActionControlRules []StatusActionControlRuleV2 `json:"statusActionControlRules,omitempty"`
	Formulas                 []FormulaDefinitionV2       `json:"formulas,omitempty"`
	Triggers                 []TriggerDefinitionV2       `json:"triggers,omitempty"`
	DamageProfiles           []DamageProfileV2           `json:"damageProfiles,omitempty"`
	CoefficientBuckets       []CoefficientBucketV2       `json:"coefficientBuckets,omitempty"`
	Settings                 BundleSettingsV2            `json:"settings"`
}

type CoefficientBucketV2 struct {
	BucketKey        string                    `json:"bucketKey"`
	ResolutionDomain string                    `json:"resolutionDomain"`
	StageKey         string                    `json:"stageKey"`
	TargetAttrKey    string                    `json:"targetAttrKey,omitempty"`
	AggregationMode  string                    `json:"aggregationMode"`
	Provisional      bool                      `json:"provisional,omitempty"`
	Name             string                    `json:"name,omitempty"`
	Description      string                    `json:"description,omitempty"`
	EditorHint       map[string]interface{}    `json:"editorHint,omitempty"`
	BucketConfig     CoefficientBucketConfigV2 `json:"bucketConfig,omitempty"`
}

type NumericBoundEvidenceV2 struct {
	Key          string  `json:"key,omitempty"`
	Source       string  `json:"source,omitempty"`
	Mode         string  `json:"mode,omitempty"`
	RawValue     float64 `json:"rawValue,omitempty"`
	BoundedValue float64 `json:"boundedValue,omitempty"`
	Min          float64 `json:"min,omitempty"`
	HasMin       bool    `json:"hasMin,omitempty"`
	Max          float64 `json:"max,omitempty"`
	HasMax       bool    `json:"hasMax,omitempty"`
	WasClamped   bool    `json:"wasClamped,omitempty"`
}

type DPSCritContextV2 struct {
	HasContext         bool                    `json:"hasContext,omitempty"`
	Policy             string                  `json:"policy,omitempty"`
	ChanceRaw          float64                 `json:"chanceRaw,omitempty"`
	ChanceEffective    float64                 `json:"chanceEffective,omitempty"`
	Multiplier         float64                 `json:"multiplier,omitempty"`
	IsCrit             bool                    `json:"isCrit,omitempty"`
	HasActualResult    bool                    `json:"hasActualResult,omitempty"`
	ExpectedNormalPart float64                 `json:"expectedNormalPart,omitempty"`
	ExpectedCritPart   float64                 `json:"expectedCritPart,omitempty"`
	BoundEvidence      *NumericBoundEvidenceV2 `json:"boundEvidence,omitempty"`
}

type CoefficientBucketConfigV2 struct {
	Priority        int     `json:"priority,omitempty"`
	ValueUnit       string  `json:"valueUnit,omitempty"`
	ClampMin        float64 `json:"clampMin,omitempty"`
	HasClampMin     bool    `json:"hasClampMin,omitempty"`
	ClampMax        float64 `json:"clampMax,omitempty"`
	HasClampMax     bool    `json:"hasClampMax,omitempty"`
	EvidenceLabel   string  `json:"evidenceLabel,omitempty"`
	LegacyBucketKey string  `json:"legacyBucketKey,omitempty"`
}

type AttributeDefinitionV2 struct {
	ID                string  `json:"id"`
	DefaultBase       float64 `json:"defaultBase,omitempty"`
	DefaultCurrent    float64 `json:"defaultCurrent,omitempty"`
	DefaultMax        float64 `json:"defaultMax,omitempty"`
	HasDefaultCurrent bool    `json:"hasDefaultCurrent,omitempty"`
	HasDefaultMax     bool    `json:"hasDefaultMax,omitempty"`
	ClampMin          float64 `json:"clampMin,omitempty"`
	HasClampMin       bool    `json:"hasClampMin,omitempty"`
	ClampMax          float64 `json:"clampMax,omitempty"`
	HasClampMax       bool    `json:"hasClampMax,omitempty"`
	DerivedFormulaID  string  `json:"derivedFormulaId,omitempty"`
}

type ResourceDefinitionV2 struct {
	ID             string  `json:"id"`
	DefaultCurrent float64 `json:"defaultCurrent,omitempty"`
	DefaultMax     float64 `json:"defaultMax,omitempty"`
}

type BundleSettingsV2 struct {
	MaxEvents           int `json:"maxEvents"`
	MaxCommandsPerEvent int `json:"maxCommandsPerEvent"`
	MaxQueueEvents      int `json:"maxQueueEvents,omitempty"`
	MaxChainDepth       int `json:"maxChainDepth,omitempty"`
}

type AttributeValueV2 struct {
	Base       float64 `json:"base,omitempty"`
	Current    float64 `json:"current,omitempty"`
	Max        float64 `json:"max,omitempty"`
	Resolved   float64 `json:"resolved,omitempty"`
	HasCurrent bool    `json:"hasCurrent,omitempty"`
	HasMax     bool    `json:"hasMax,omitempty"`
}

type ResourceValueV2 struct {
	Current float64 `json:"current"`
	Max     float64 `json:"max"`
}

type ActorTemplateV2 struct {
	ID         string                      `json:"id"`
	MaxHP      float64                     `json:"maxHp,omitempty"`
	InitialHP  float64                     `json:"initialHp,omitempty"`
	Attributes map[string]AttributeValueV2 `json:"attributes,omitempty"`
	Resources  map[string]ResourceValueV2  `json:"resources,omitempty"`
	Actions    []string                    `json:"actions,omitempty"`
}

type ActionTemplateV2 struct {
	ID                string                `json:"id"`
	Label             string                `json:"label,omitempty"`
	Classifier        ClassifierV2          `json:"classifier,omitempty"`
	CooldownMs        int64                 `json:"cooldownMs,omitempty"`
	CooldownFormulaID string                `json:"cooldownFormulaId,omitempty"`
	ChannelDurationMs int64                 `json:"channelDurationMs,omitempty"`
	SkillLevel        int                   `json:"skillLevel,omitempty"`
	PanelInputs       map[string]float64    `json:"panelInputs,omitempty"`
	Effects           []EffectDefV2         `json:"effects,omitempty"`
	RequiresMark      string                `json:"requiresMark,omitempty"`
	ConsumesMark      bool                  `json:"consumesMark,omitempty"`
	ResourceCost      []ResourceCostV2      `json:"resourceCost,omitempty"`
	PanelCosts        []ActionPanelCostV2   `json:"panelCosts,omitempty"`
	PanelEffects      []ActionPanelEffectV2 `json:"panelEffects,omitempty"`
}

type ResourceCostV2 struct {
	ResourceID string  `json:"resourceId"`
	Amount     float64 `json:"amount"`
	FormulaID  string  `json:"formulaId,omitempty"`
}

type ActionPanelCostV2 struct {
	ResourceID string  `json:"resourceId,omitempty"`
	FormulaID  string  `json:"formulaId,omitempty"`
	Amount     float64 `json:"amount"`
}

type ActionPanelEffectV2 struct {
	EffectIndex int     `json:"effectIndex"`
	Kind        string  `json:"kind"`
	Label       string  `json:"label,omitempty"`
	FormulaID   string  `json:"formulaId,omitempty"`
	Amount      float64 `json:"amount,omitempty"`
	DamageType  string  `json:"damageType,omitempty"`
	StatusID    string  `json:"statusId,omitempty"`
	AttrID      string  `json:"attrId,omitempty"`
	MarkID      string  `json:"markId,omitempty"`
	SourceRole  string  `json:"sourceRole,omitempty"`
	TargetRole  string  `json:"targetRole,omitempty"`
}

type StatusTemplateV2 struct {
	ID                   string              `json:"id"`
	Kind                 string              `json:"kind"`
	Classifier           ClassifierV2        `json:"classifier,omitempty"`
	DurationMs           int64               `json:"durationMs,omitempty"`
	BlocksActions        bool                `json:"blocksActions,omitempty"`
	RetryOnRelease       bool                `json:"retryOnRelease,omitempty"`
	Magnitude            float64             `json:"magnitude,omitempty"`
	ShieldKind           string              `json:"shieldKind,omitempty"`
	TickIntervalMs       int64               `json:"tickIntervalMs,omitempty"`
	TickCount            int                 `json:"tickCount,omitempty"`
	TickEffectType       EffectType          `json:"tickEffectType,omitempty"`
	TickFormulaID        string              `json:"tickFormulaId,omitempty"`
	TickAmount           float64             `json:"tickAmount,omitempty"`
	TickDamageType       string              `json:"tickDamageType,omitempty"`
	TickCritPolicy       string              `json:"tickCritPolicy,omitempty"`
	TickCritChanceSource string              `json:"tickCritChanceSource,omitempty"`
	TickCritChance       float64             `json:"tickCritChance,omitempty"`
	TickCritMultiplier   float64             `json:"tickCritMultiplier,omitempty"`
	AttrModifiers        []AttrModifierDefV2 `json:"attrModifiers,omitempty"`
}

type StatusActionControlRuleV2 struct {
	ID                  string        `json:"id"`
	StatusTypes         TypeMatcherV2 `json:"statusTypes"`
	RuleKind            string        `json:"ruleKind"`
	ActionTypes         TypeMatcherV2 `json:"actionTypes"`
	ActionMatchTypes    TypeMatcherV2 `json:"actionMatchTypes,omitempty"`
	InterruptPhaseTypes TypeMatcherV2 `json:"interruptPhaseTypes,omitempty"`
	Priority            int           `json:"priority,omitempty"`
	RetryOnRelease      bool          `json:"retryOnRelease,omitempty"`
}

type AttrModifierDefV2 struct {
	AttrID    string           `json:"attrId"`
	Mode      AttrModifierMode `json:"mode"`
	Value     float64          `json:"value,omitempty"`
	FormulaID string           `json:"formulaId,omitempty"`
}

type TriggerDefinitionV2 struct {
	ID                 string        `json:"id"`
	Phase              EventPhase    `json:"phase,omitempty"`
	Event              string        `json:"event,omitempty"`
	OwnerRole          string        `json:"ownerRole,omitempty"`
	OwnerID            string        `json:"ownerId,omitempty"`
	RequiresDamage     bool          `json:"requiresDamage,omitempty"`
	Effects            []EffectDefV2 `json:"effects,omitempty"`
	OncePerEvent       bool          `json:"oncePerEvent,omitempty"`
	InternalCooldownMs int64         `json:"internalCooldownMs,omitempty"`
}

type EffectDefV2 struct {
	Type                 EffectType       `json:"type"`
	FormulaID            string           `json:"formulaId,omitempty"`
	Amount               float64          `json:"amount,omitempty"`
	DamageType           string           `json:"damageType,omitempty"`
	StatusID             string           `json:"statusId,omitempty"`
	SourceRole           string           `json:"sourceRole,omitempty"`
	TargetRole           string           `json:"targetRole,omitempty"`
	HistoryWindowMs      int64            `json:"historyWindowMs,omitempty"`
	CounterKey           string           `json:"counterKey,omitempty"`
	MarkID               string           `json:"markId,omitempty"`
	ResourceID           string           `json:"resourceId,omitempty"`
	AttrID               string           `json:"attrId,omitempty"`
	ModifierMode         AttrModifierMode `json:"modifierMode,omitempty"`
	CritPolicy           string           `json:"critPolicy,omitempty"`
	CritChanceSource     string           `json:"critChanceSource,omitempty"`
	CritChance           float64          `json:"critChance,omitempty"`
	CritMultiplierSource string           `json:"critMultiplierSource,omitempty"`
	CritMultiplier       float64          `json:"critMultiplier,omitempty"`
	ModeAugmentID        string           `json:"modeAugmentId,omitempty"`
	ModeMultiplier       float64          `json:"modeMultiplier,omitempty"`
}

type DamageProfileV2 struct {
	ID         string `json:"id"`
	DamageType string `json:"damageType"`
}

type FormulaDefinitionV2 struct {
	ID       string            `json:"id"`
	Op       string            `json:"op"`
	Value    float64           `json:"value,omitempty"`
	Attr     string            `json:"attr,omitempty"`
	AttrRead AttributeReadKind `json:"attrRead,omitempty"`
	Resource string            `json:"resource,omitempty"`
	Counter  string            `json:"counter,omitempty"`
	Left     string            `json:"left,omitempty"`
	Right    string            `json:"right,omitempty"`
}

// EngineRunInputV2 是普通 run frame 的 JSON 根对象；snapshot 类调用会忽略 InitialActions/Trace。
type EngineRunInputV2 struct {
	Seed           uint64             `json:"seed"`
	Self           CombatantRunInitV2 `json:"self"`
	Enemy          CombatantRunInitV2 `json:"enemy"`
	InitialActions []ActionRequestV2  `json:"initialActions,omitempty"`
	StopCondition  StopConditionV2    `json:"stopCondition,omitempty"`
	Trace          TraceOptionsV2     `json:"trace,omitempty"`
	ModeAugments   []string           `json:"modeAugments,omitempty"`
}

type CombatantRunInitV2 struct {
	ActorID      string                      `json:"actorId"`
	TemplateID   string                      `json:"templateId"`
	StatusIDs    []string                    `json:"statusIds,omitempty"`
	ActionInputs map[string]ActionRunInputV2 `json:"actionInputs,omitempty"`
}

type ActionRunInputV2 struct {
	SkillLevel  int                `json:"skillLevel,omitempty"`
	PanelInputs map[string]float64 `json:"panelInputs,omitempty"`
}

type ActionRequestV2 struct {
	TriggerAtMs   int64  `json:"triggerAtMs"`
	SourceActorID string `json:"sourceActorId"`
	TargetActorID string `json:"targetActorId"`
	ActionID      string `json:"actionId"`
}

type StopConditionV2 struct {
	MaxEvents int `json:"maxEvents"`
}

type TraceOptionsV2 struct {
	EnableLogs  bool `json:"enableLogs"`
	SampleEvery int  `json:"sampleEvery"`
	ValueTrace  bool `json:"valueTrace,omitempty"`
}

// SingleAttackerDPSInputV2 由 session 在 begin_run 时识别（无 self/enemy，有 curves/simulationRules），同步产出 done。
type SingleAttackerDPSInputV2 struct {
	CaseID          string              `json:"caseId,omitempty"`
	VersionCode     string              `json:"versionCode,omitempty"`
	WasmSha256      string              `json:"wasmSha256,omitempty"`
	SimulationRules DPSimulationRulesV2 `json:"simulationRules"`
	TargetSnapshot  DPSActorSnapshotV2  `json:"targetSnapshot,omitempty"`
	Curves          []DPSCurveRunSpecV2 `json:"curves"`
}

type DPSimulationRulesV2 struct {
	DurationMs        int64             `json:"durationMs"`
	WarmupMs          int64             `json:"warmupMs"`
	SampleBy          string            `json:"sampleBy"`
	AttackSpeedCap    float64           `json:"attackSpeedCap"`
	FirstAttackAtMs   int64             `json:"firstAttackAtMs"`
	EventWindowPolicy string            `json:"eventWindowPolicy"`
	DotTickIntervalMs int64             `json:"dotTickIntervalMs"`
	CritPolicy        string            `json:"critPolicy"`
	Seed              uint64            `json:"seed"`
	AutoAttackPlan    DPSAutoAttackPlan `json:"autoAttackPlan"`
	MaxEvents         int               `json:"maxEvents"`
}

type DPSAutoAttackPlan struct {
	Enabled    bool   `json:"enabled"`
	ActionID   string `json:"actionId"`
	StartAtMs  int64  `json:"startAtMs"`
	TargetRole string `json:"targetRole"`
}

type DPSCurveRunSpecV2 struct {
	CurveID          string                `json:"curveId"`
	Label            string                `json:"label,omitempty"`
	Selection        DPSCurveSelectionV2   `json:"selection"`
	ResolvedSnapshot DPSResolvedSnapshotV2 `json:"resolvedSnapshot"`
}

type DPSCurveSelectionV2 struct {
	HeroID                      string               `json:"heroId,omitempty"`
	HeroLevel                   int                  `json:"heroLevel,omitempty"`
	TargetID                    string               `json:"targetId,omitempty"`
	TargetType                  string               `json:"targetType,omitempty"`
	SkillLevels                 map[string]int       `json:"skillLevels"`
	EquipmentSet                []string             `json:"equipmentSet"`
	EnabledPassiveEffects       []string             `json:"enabledPassiveEffects"`
	TargetEquipmentSet          []string             `json:"targetEquipmentSet,omitempty"`
	TargetEnabledPassiveEffects []string             `json:"targetEnabledPassiveEffects,omitempty"`
	ScenarioStates              []DPSScenarioStateV2 `json:"scenarioStates"`
	CritPolicy                  string               `json:"critPolicy,omitempty"`
}

type DPSBasicAttackActionRefV2 struct {
	ActionID   string       `json:"actionId"`
	SkillID    string       `json:"skillId"`
	Label      string       `json:"label,omitempty"`
	Classifier ClassifierV2 `json:"classifier,omitempty"`
}

type DPSActiveActionRefV2 struct {
	ActionID   string       `json:"actionId"`
	SkillID    string       `json:"skillId,omitempty"`
	Label      string       `json:"label,omitempty"`
	Kind       string       `json:"kind,omitempty"`
	Priority   int          `json:"priority,omitempty"`
	StartAtMs  int64        `json:"startAtMs,omitempty"`
	Classifier ClassifierV2 `json:"classifier,omitempty"`
}

type DPSResolvedSnapshotV2 struct {
	AttackerSnapshot            DPSActorSnapshotV2          `json:"attackerSnapshot"`
	TargetSnapshot              DPSActorSnapshotV2          `json:"targetSnapshot"`
	BasicAttackActions          []DPSBasicAttackActionRefV2 `json:"basicAttackActions,omitempty"`
	ActiveActions               []DPSActiveActionRefV2      `json:"activeActions,omitempty"`
	EquipmentSet                []string                    `json:"equipmentSet"`
	EquipmentStats              map[string]float64          `json:"equipmentStats"`
	EnabledPassiveEffects       []string                    `json:"enabledPassiveEffects"`
	TargetEquipmentSet          []string                    `json:"targetEquipmentSet,omitempty"`
	TargetEquipmentStats        map[string]float64          `json:"targetEquipmentStats,omitempty"`
	TargetEnabledPassiveEffects []string                    `json:"targetEnabledPassiveEffects,omitempty"`
	PassiveEffects              []DPSPassiveEffectV2        `json:"passiveEffects,omitempty"`
	ExternalPassiveEffects      []string                    `json:"externalPassiveEffects"`
	ScenarioStates              []DPSScenarioStateV2        `json:"scenarioStates"`
	RuneStatAdjustments         map[string]float64          `json:"runeStatAdjustments"`
}

type DPSActorSnapshotV2 struct {
	ActorID        string                         `json:"actorId"`
	TemplateID     string                         `json:"templateId,omitempty"`
	Name           string                         `json:"name,omitempty"`
	Level          int                            `json:"level,omitempty"`
	Types          []string                       `json:"types"`
	StatusIDs      []string                       `json:"statusIds,omitempty"`
	Attributes     map[string]float64             `json:"attributes"`
	AttributeViews map[string]AttributeSnapshotV2 `json:"attributeViews,omitempty"`
	CurrentHP      float64                        `json:"currentHp"`
	MaxHP          float64                        `json:"maxHp"`
}

type DPSScenarioStateV2 struct {
	StateID     string `json:"stateId,omitempty"`
	SourceType  string `json:"sourceType,omitempty"`
	SourceID    string `json:"sourceId,omitempty"`
	Activation  string `json:"activation,omitempty"`
	Stacks      int    `json:"stacks,omitempty"`
	StartTimeMs int64  `json:"startTimeMs,omitempty"`
	DurationMs  int64  `json:"durationMs,omitempty"`
}

type DPSPassiveTriggerSpecV2 struct {
	Event   string                     `json:"event,omitempty"`
	Matcher DPSPassiveTriggerMatcherV2 `json:"matcher,omitempty"`
}

type DPSPassiveTriggerMatcherV2 struct {
	DamageTypes      []string      `json:"damageTypes,omitempty"`
	ActionTypes      TypeMatcherV2 `json:"actionTypes,omitempty"`
	EffectTypes      TypeMatcherV2 `json:"effectTypes,omitempty"`
	EffectTags       TypeMatcherV2 `json:"effectTags,omitempty"`
	SourceTypes      []string      `json:"sourceTypes,omitempty"`
	SourceCategories []string      `json:"sourceCategories,omitempty"`
	ProcScopes       []string      `json:"procScopes,omitempty"`
	IncludePhantom   bool          `json:"includePhantom,omitempty"`
	ExcludePhantom   bool          `json:"excludePhantom,omitempty"`
}

type DPSPassiveEffectV2 struct {
	PassiveID                string                  `json:"passiveId,omitempty"`
	EffectID                 string                  `json:"effectId,omitempty"`
	SourceCategory           string                  `json:"sourceCategory,omitempty"`
	SourceID                 string                  `json:"sourceId,omitempty"`
	SourceType               string                  `json:"sourceType,omitempty"`
	OwnerRole                string                  `json:"ownerRole,omitempty"`
	Priority                 int                     `json:"priority,omitempty"`
	Trigger                  DPSPassiveTriggerSpecV2 `json:"trigger,omitempty"`
	TriggerID                string                  `json:"triggerId,omitempty"`
	TriggerKind              string                  `json:"triggerKind,omitempty"`
	EveryN                   int                     `json:"everyN,omitempty"`
	RequiresScenarioStateID  string                  `json:"requiresScenarioStateId,omitempty"`
	ChargeKey                string                  `json:"chargeKey,omitempty"`
	ChargeGainPerBasicAttack float64                 `json:"chargeGainPerBasicAttack,omitempty"`
	ChargeThreshold          float64                 `json:"chargeThreshold,omitempty"`
	ChargeCap                float64                 `json:"chargeCap,omitempty"`
	ChargeReadyPolicy        string                  `json:"chargeReadyPolicy,omitempty"`
	ConsumeChargeOnTrigger   bool                    `json:"consumeChargeOnTrigger,omitempty"`
	ProcScope                string                  `json:"procScope,omitempty"`
	InternalCooldownMs       int64                   `json:"internalCooldownMs,omitempty"`
	Operations               []DPSPassiveOperationV2 `json:"operations,omitempty"`
}

type DPSPassiveOperationV2 struct {
	Kind                      string                   `json:"kind"`
	Source                    string                   `json:"source,omitempty"`
	DamageType                string                   `json:"damageType,omitempty"`
	Amount                    float64                  `json:"amount,omitempty"`
	AmountPerStack            float64                  `json:"amountPerStack,omitempty"`
	TargetCurrentHPRatio      float64                  `json:"targetCurrentHpRatio,omitempty"`
	TargetCurrentHPBasis      string                   `json:"targetCurrentHpBasis,omitempty"`
	TargetMaxHPRatio          float64                  `json:"targetMaxHpRatio,omitempty"`
	TargetMissingHPRatio      float64                  `json:"targetMissingHpRatio,omitempty"`
	TargetMissingHPBasis      string                   `json:"targetMissingHpBasis,omitempty"`
	TargetMissingHPAmp        float64                  `json:"targetMissingHpAmp,omitempty"`
	AttackerAttr              string                   `json:"attackerAttr,omitempty"`
	AttackerAttrRead          AttributeReadKind        `json:"attackerAttrRead,omitempty"`
	AttackerAttrRatio         float64                  `json:"attackerAttrRatio,omitempty"`
	MinAmount                 float64                  `json:"minAmount,omitempty"`
	HasMinAmount              bool                     `json:"hasMinAmount,omitempty"`
	StackKey                  string                   `json:"stackKey,omitempty"`
	MaxStacks                 int                      `json:"maxStacks,omitempty"`
	TriggerStacks             int                      `json:"triggerStacks,omitempty"`
	ResetStacks               bool                     `json:"resetStacks,omitempty"`
	DurationMs                int64                    `json:"durationMs,omitempty"`
	TickIntervalMs            int64                    `json:"tickIntervalMs,omitempty"`
	RefreshMode               string                   `json:"refreshMode,omitempty"`
	AttrKey                   string                   `json:"attrKey,omitempty"`
	ModifierMode              string                   `json:"modifierMode,omitempty"`
	Value                     float64                  `json:"value,omitempty"`
	PerStack                  bool                     `json:"perStack,omitempty"`
	TargetRole                string                   `json:"targetRole,omitempty"`
	RepeatCount               int                      `json:"repeatCount,omitempty"`
	RepeatTag                 string                   `json:"repeatTag,omitempty"`
	RepeatScope               string                   `json:"repeatScope,omitempty"`
	PhantomHitCopyable        bool                     `json:"phantomHitCopyable,omitempty"`
	ValuePhase                string                   `json:"valuePhase,omitempty"`
	CritOnly                  bool                     `json:"critOnly,omitempty"`
	ForceCrit                 bool                     `json:"forceCrit,omitempty"`
	CritMultiplierOverride    float64                  `json:"critMultiplierOverride,omitempty"`
	HasCritMultiplierOverride bool                     `json:"hasCritMultiplierOverride,omitempty"`
	CritMultiplierScale       float64                  `json:"critMultiplierScale,omitempty"`
	HasCritMultiplierScale    bool                     `json:"hasCritMultiplierScale,omitempty"`
	BucketKey                 string                   `json:"bucketKey,omitempty"`
	ValueSpec                 DPSModifierValueSpecV2   `json:"valueSpec,omitempty"`
	Conditions                []DPSModifierConditionV2 `json:"conditions,omitempty"`
	Priority                  int                      `json:"priority,omitempty"`
	EvidenceKey               string                   `json:"evidenceKey,omitempty"`
	ThresholdType             string                   `json:"thresholdType,omitempty"`
	ThresholdValue            float64                  `json:"thresholdValue,omitempty"`
	CheckTiming               string                   `json:"checkTiming,omitempty"`
}

type DPSModifierValueSpecV2 struct {
	Kind        string            `json:"kind,omitempty"`
	Value       float64           `json:"value,omitempty"`
	OwnerRole   string            `json:"ownerRole,omitempty"`
	CompareRole string            `json:"compareRole,omitempty"`
	AttrKey     string            `json:"attrKey,omitempty"`
	AttrRead    AttributeReadKind `json:"attrRead,omitempty"`
	HPMeter     string            `json:"hpMeter,omitempty"`
	Ratio       float64           `json:"ratio,omitempty"`
	ClampMin    float64           `json:"clampMin,omitempty"`
	HasClampMin bool              `json:"hasClampMin,omitempty"`
	ClampMax    float64           `json:"clampMax,omitempty"`
	HasClampMax bool              `json:"hasClampMax,omitempty"`
	FormulaID   string            `json:"formulaId,omitempty"`
}

type DPSModifierConditionV2 struct {
	SubjectRole string   `json:"subjectRole,omitempty"`
	CompareRole string   `json:"compareRole,omitempty"`
	Metric      string   `json:"metric,omitempty"`
	AttrKey     string   `json:"attrKey,omitempty"`
	Operator    string   `json:"operator,omitempty"`
	Value       float64  `json:"value,omitempty"`
	MaxValue    float64  `json:"maxValue,omitempty"`
	TextValue   string   `json:"textValue,omitempty"`
	TextValues  []string `json:"textValues,omitempty"`
}

type SingleAttackerDPSOutputV2 struct {
	CaseID          string              `json:"caseId,omitempty"`
	VersionCode     string              `json:"versionCode,omitempty"`
	WasmSha256      string              `json:"wasmSha256,omitempty"`
	SimulationRules DPSimulationRulesV2 `json:"simulationRules"`
	TargetSnapshot  DPSActorSnapshotV2  `json:"targetSnapshot,omitempty"`
	CurveResults    []DPSCurveResultV2  `json:"curveResults"`
}

type DPSCurveResultV2 struct {
	CurveID                 string                     `json:"curveId"`
	Status                  string                     `json:"status"`
	Selection               DPSCurveSelectionV2        `json:"selection"`
	ResolvedSnapshot        DPSResolvedSnapshotV2      `json:"resolvedSnapshot"`
	DurationMs              int64                      `json:"durationMs"`
	FinalTimeMs             int64                      `json:"finalTimeMs"`
	StopReason              string                     `json:"stopReason"`
	ProcessedEvents         int                        `json:"processedEvents"`
	QueuePeak               int                        `json:"queuePeak"`
	AttackCount             int                        `json:"attackCount"`
	AttackTimeline          []DPSAttackEventV2         `json:"attackTimeline"`
	AttackIntervalTimeline  []DPSAttackIntervalV2      `json:"attackIntervalTimeline"`
	DamageTimeline          []DPSDamageEventV2         `json:"damageTimeline"`
	AttackerDamageTimeline  []DPSAttackerDamageEventV2 `json:"attackerDamageTimeline,omitempty"`
	AttackerDamageBySource  map[string]float64         `json:"attackerDamageBySource,omitempty"`
	TargetHPTimeline        []DPSTargetHPEventV2       `json:"targetHpTimeline"`
	EffectTimeline          []DPSEffectEventV2         `json:"effectTimeline"`
	TotalDamage             float64                    `json:"totalDamage"`
	TimeWindowDps           float64                    `json:"timeWindowDps"`
	KillDps                 *float64                   `json:"killDps"`
	KillTimeMs              *int64                     `json:"killTimeMs"`
	DamageByType            map[string]float64         `json:"damageByType"`
	DamageBySource          map[string]float64         `json:"damageBySource"`
	SkillPassiveTriggers    []DPSPassiveTriggerV2      `json:"skillPassiveTriggers"`
	ItemPassiveTriggers     []DPSPassiveTriggerV2      `json:"itemPassiveTriggers"`
	ExternalPassiveTriggers []DPSPassiveTriggerV2      `json:"externalPassiveTriggers"`
	EffectBreakdown         []DPSEffectBreakdownV2     `json:"effectBreakdown"`
	CritPolicy              string                     `json:"critPolicy"`
	Seed                    uint64                     `json:"seed"`
	BlockedReasons          []string                   `json:"blockedReasons"`
}

type DPSAttackEventV2 struct {
	TimeMs        int64  `json:"timeMs"`
	ActionID      string `json:"actionId"`
	SourceActorID string `json:"sourceActorId"`
	TargetActorID string `json:"targetActorId"`
}

type DPSAttackIntervalV2 struct {
	TimeMs               int64   `json:"timeMs"`
	RawAttackSpeed       float64 `json:"rawAttackSpeed"`
	EffectiveAttackSpeed float64 `json:"effectiveAttackSpeed"`
	OverflowAttackSpeed  float64 `json:"overflowAttackSpeed"`
	AttackIntervalMs     int64   `json:"attackIntervalMs"`
	NextAttackAtMs       int64   `json:"nextAttackAtMs"`
	Source               string  `json:"source"`
}

type DPSDamageEventV2 struct {
	TimeMs         int64             `json:"timeMs"`
	Source         string            `json:"source"`
	DamageType     string            `json:"damageType"`
	RawDamage      float64           `json:"rawDamage"`
	FinalDamage    float64           `json:"finalDamage"`
	TargetHPBefore float64           `json:"targetHpBefore"`
	TargetHPAfter  float64           `json:"targetHpAfter"`
	PhantomHit     bool              `json:"phantomHit,omitempty"`
	RepeatTag      string            `json:"repeatTag,omitempty"`
	CritContext    *DPSCritContextV2 `json:"critContext,omitempty"`
}

type DPSAttackerDamageEventV2 struct {
	TimeMs      int64   `json:"timeMs"`
	Source      string  `json:"source"`
	DamageType  string  `json:"damageType"`
	RawDamage   float64 `json:"rawDamage"`
	FinalDamage float64 `json:"finalDamage"`
}

type DPSTargetHPEventV2 struct {
	TimeMs    int64   `json:"timeMs"`
	CurrentHP float64 `json:"currentHp"`
	MaxHP     float64 `json:"maxHp"`
}

type DPSEffectEventV2 struct {
	TimeMs   int64  `json:"timeMs"`
	SourceID string `json:"sourceId,omitempty"`
	Kind     string `json:"kind,omitempty"`
}

type DPSPassiveTriggerV2 struct {
	TimeMs             int64  `json:"timeMs"`
	ProcSourceCategory string `json:"procSourceCategory,omitempty"`
	SourceID           string `json:"sourceId,omitempty"`
	SourceType         string `json:"sourceType,omitempty"`
	TriggerID          string `json:"triggerId,omitempty"`
	PhantomHit         bool   `json:"phantomHit,omitempty"`
	RepeatTag          string `json:"repeatTag,omitempty"`
}

type DPSCoefficientBucketCandidateEvidenceV2 struct {
	Source        string  `json:"source,omitempty"`
	SourceType    string  `json:"sourceType,omitempty"`
	PassiveID     string  `json:"passiveId,omitempty"`
	OperationKind string  `json:"operationKind,omitempty"`
	Value         float64 `json:"value,omitempty"`
	Priority      int     `json:"priority,omitempty"`
	EvidenceKey   string  `json:"evidenceKey,omitempty"`
	Applied       bool    `json:"applied,omitempty"`
	SkipReason    string  `json:"skipReason,omitempty"`
}

type DPSCoefficientBucketEvidenceV2 struct {
	Domain          string                                    `json:"domain,omitempty"`
	StageKey        string                                    `json:"stageKey,omitempty"`
	BucketKey       string                                    `json:"bucketKey,omitempty"`
	AggregationMode string                                    `json:"aggregationMode,omitempty"`
	ValueUnit       string                                    `json:"valueUnit,omitempty"`
	Raw             float64                                   `json:"raw,omitempty"`
	Result          float64                                   `json:"result,omitempty"`
	EvidenceKeys    []string                                  `json:"evidenceKeys,omitempty"`
	Candidates      []DPSCoefficientBucketCandidateEvidenceV2 `json:"candidates,omitempty"`
	Skipped         []DPSCoefficientBucketCandidateEvidenceV2 `json:"skipped,omitempty"`
}

type DPSEffectBreakdownV2 struct {
	TimeMs            int64                           `json:"timeMs"`
	Source            string                          `json:"source,omitempty"`
	Kind              string                          `json:"kind,omitempty"`
	Amount            float64                         `json:"amount,omitempty"`
	Message           string                          `json:"message,omitempty"`
	PhantomHit        bool                            `json:"phantomHit,omitempty"`
	RepeatTag         string                          `json:"repeatTag,omitempty"`
	CoefficientBucket *DPSCoefficientBucketEvidenceV2 `json:"coefficientBucket,omitempty"`
	NumericBound      *NumericBoundEvidenceV2         `json:"numericBound,omitempty"`
	CritContext       *DPSCritContextV2               `json:"critContext,omitempty"`
	PassiveCooldown   *DPSPassiveCooldownEvidenceV2   `json:"passiveCooldown,omitempty"`
}

type DPSPassiveCooldownEvidenceV2 struct {
	PassiveKey         string `json:"passiveKey,omitempty"`
	InternalCooldownMs int64  `json:"internalCooldownMs,omitempty"`
	ReadyAtMs          int64  `json:"readyAtMs,omitempty"`
	NextReadyAtMs      int64  `json:"nextReadyAtMs,omitempty"`
	Triggered          bool   `json:"triggered,omitempty"`
	Skipped            bool   `json:"skipped,omitempty"`
}

type AttributeSnapshotV2 struct {
	Base     float64 `json:"base"`
	Current  float64 `json:"current"`
	Max      float64 `json:"max"`
	Resolved float64 `json:"resolved"`
}

type ActorSnapshotV2 struct {
	ActorID      string                         `json:"actorId"`
	CurrentHP    float64                        `json:"currentHp"`
	MaxHP        float64                        `json:"maxHp"`
	ShieldAmount float64                        `json:"shieldAmount"`
	Attributes   map[string]AttributeSnapshotV2 `json:"attributes,omitempty"`
	Resources    map[string]ResourceValueV2     `json:"resources,omitempty"`
}

type ActionCostSnapshotV2 struct {
	ResourceID  string                       `json:"resourceId,omitempty"`
	FormulaID   string                       `json:"formulaId,omitempty"`
	Amount      float64                      `json:"amount"`
	Source      string                       `json:"source,omitempty"`
	BaseAmount  float64                      `json:"baseAmount,omitempty"`
	FinalAmount float64                      `json:"finalAmount,omitempty"`
	Breakdown   []ActionValueBreakdownStepV2 `json:"breakdown,omitempty"`
}

type ActionValueBreakdownStepV2 struct {
	FormulaID string  `json:"formulaId,omitempty"`
	Op        string  `json:"op"`
	Ref       string  `json:"ref,omitempty"`
	Value     float64 `json:"value"`
}

type ActionEffectSnapshotV2 struct {
	EffectIndex       int                          `json:"effectIndex"`
	Kind              string                       `json:"kind"`
	Label             string                       `json:"label,omitempty"`
	FormulaID         string                       `json:"formulaId,omitempty"`
	DamageType        string                       `json:"damageType,omitempty"`
	StatusID          string                       `json:"statusId,omitempty"`
	AttrID            string                       `json:"attrId,omitempty"`
	MarkID            string                       `json:"markId,omitempty"`
	SourceRole        string                       `json:"sourceRole,omitempty"`
	TargetRole        string                       `json:"targetRole,omitempty"`
	ResolvedAmount    float64                      `json:"resolvedAmount,omitempty"`
	HasResolvedAmount bool                         `json:"hasResolvedAmount,omitempty"`
	Source            string                       `json:"source,omitempty"`
	BaseAmount        float64                      `json:"baseAmount,omitempty"`
	FinalAmount       float64                      `json:"finalAmount,omitempty"`
	Breakdown         []ActionValueBreakdownStepV2 `json:"breakdown,omitempty"`
}

type ActionInitialStateV2 struct {
	ActionID          string                       `json:"actionId"`
	Label             string                       `json:"label,omitempty"`
	SkillLevel        int                          `json:"skillLevel,omitempty"`
	PanelInputs       map[string]float64           `json:"panelInputs,omitempty"`
	CooldownMs        int64                        `json:"cooldownMs"`
	CooldownFormulaID string                       `json:"cooldownFormulaId,omitempty"`
	CooldownBreakdown []ActionValueBreakdownStepV2 `json:"cooldownBreakdown,omitempty"`
	ReadyAtMs         int64                        `json:"readyAtMs"`
	CanCast           bool                         `json:"canCast"`
	BlockedReason     string                       `json:"blockedReason,omitempty"`
	ResourceCosts     []ActionCostSnapshotV2       `json:"resourceCosts,omitempty"`
	EffectRows        []ActionEffectSnapshotV2     `json:"effectRows,omitempty"`
}

type ActorActionSnapshotV2 struct {
	ActorID string                 `json:"actorId"`
	Actions []ActionInitialStateV2 `json:"actions"`
}

type EngineEventLogV2 struct {
	TimeMs        int64      `json:"timeMs"`
	Kind          string     `json:"kind"`
	Phase         EventPhase `json:"phase,omitempty"`
	SourceActorID string     `json:"sourceActorId,omitempty"`
	TargetActorID string     `json:"targetActorId,omitempty"`
	ActionID      string     `json:"actionId,omitempty"`
	StatusID      string     `json:"statusId,omitempty"`
	Amount        float64    `json:"amount,omitempty"`
	Message       string     `json:"message,omitempty"`
	Sequence      uint64     `json:"sequence,omitempty"`
}

type ValueTraceV2 struct {
	TimeMs        int64      `json:"timeMs"`
	Phase         ValuePhase `json:"phase"`
	Channel       string     `json:"channel"`
	SourceActorID string     `json:"sourceActorId,omitempty"`
	TargetActorID string     `json:"targetActorId,omitempty"`
	Input         float64    `json:"input"`
	Output        float64    `json:"output"`
	Reason        string     `json:"reason,omitempty"`
}

type ActionCooldownRunStateV2 struct {
	CooldownMs        int64                        `json:"cooldownMs"`
	CooldownFormulaID string                       `json:"cooldownFormulaId,omitempty"`
	CooldownBreakdown []ActionValueBreakdownStepV2 `json:"cooldownBreakdown,omitempty"`
	ReadyAtMs         int64                        `json:"readyAtMs"`
}

type ActionResourceDeltaV2 struct {
	ResourceID string  `json:"resourceId"`
	Before     float64 `json:"before"`
	After      float64 `json:"after"`
	Delta      float64 `json:"delta"`
}

type ActionEffectRunResultV2 struct {
	EffectIndex         int                          `json:"effectIndex"`
	Kind                string                       `json:"kind"`
	FormulaID           string                       `json:"formulaId,omitempty"`
	FormulaBreakdown    []ActionValueBreakdownStepV2 `json:"formulaBreakdown,omitempty"`
	RawAmount           float64                      `json:"rawAmount,omitempty"`
	HasRawAmount        bool                         `json:"hasRawAmount,omitempty"`
	DamageType          string                       `json:"damageType,omitempty"`
	StatusID            string                       `json:"statusId,omitempty"`
	FinalDamage         float64                      `json:"finalDamage,omitempty"`
	HasFinalDamage      bool                         `json:"hasFinalDamage,omitempty"`
	HealApplied         float64                      `json:"healApplied,omitempty"`
	HasHealApplied      bool                         `json:"hasHealApplied,omitempty"`
	OverhealAmount      float64                      `json:"overhealAmount,omitempty"`
	HasOverheal         bool                         `json:"hasOverheal,omitempty"`
	ShieldBefore        float64                      `json:"shieldBefore,omitempty"`
	HasShieldBefore     bool                         `json:"hasShieldBefore,omitempty"`
	ShieldAfter         float64                      `json:"shieldAfter,omitempty"`
	HasShieldAfter      bool                         `json:"hasShieldAfter,omitempty"`
	ShieldGranted       float64                      `json:"shieldGranted,omitempty"`
	HasShieldGranted    bool                         `json:"hasShieldGranted,omitempty"`
	ShieldAbsorbed      float64                      `json:"shieldAbsorbed,omitempty"`
	HasShieldAbsorbed   bool                         `json:"hasShieldAbsorbed,omitempty"`
	MarkID              string                       `json:"markId,omitempty"`
	MarkActive          bool                         `json:"markActive,omitempty"`
	HasMarkState        bool                         `json:"hasMarkState,omitempty"`
	MarkCount           int                          `json:"markCount,omitempty"`
	CritPolicy          string                       `json:"critPolicy,omitempty"`
	CritRoll            float64                      `json:"critRoll,omitempty"`
	HasCritRoll         bool                         `json:"hasCritRoll,omitempty"`
	CritResult          bool                         `json:"critResult,omitempty"`
	HasCritResult       bool                         `json:"hasCritResult,omitempty"`
	CritMultiplier      float64                      `json:"critMultiplier,omitempty"`
	HasCritMultiplier   bool                         `json:"hasCritMultiplier,omitempty"`
	CritChanceRaw       float64                      `json:"critChanceRaw,omitempty"`
	CritChanceEffective float64                      `json:"critChanceEffective,omitempty"`
	HasCritChance       bool                         `json:"hasCritChance,omitempty"`
	CritChanceBound     *NumericBoundEvidenceV2      `json:"critChanceBound,omitempty"`
	InterruptedActionID string                       `json:"interruptedActionId,omitempty"`
	HasInterrupt        bool                         `json:"hasInterrupt,omitempty"`
	HistoryWindowMs     int64                        `json:"historyWindowMs,omitempty"`
	HasHistoryWindow    bool                         `json:"hasHistoryWindow,omitempty"`
	CounterKey          string                       `json:"counterKey,omitempty"`
	CounterBefore       float64                      `json:"counterBefore,omitempty"`
	CounterAfter        float64                      `json:"counterAfter,omitempty"`
	HasCounterState     bool                         `json:"hasCounterState,omitempty"`
	ModeAugmentID       string                       `json:"modeAugmentId,omitempty"`
	ModeActive          bool                         `json:"modeActive,omitempty"`
	ModeMultiplier      float64                      `json:"modeMultiplier,omitempty"`
	HasModeState        bool                         `json:"hasModeState,omitempty"`
	TargetHPBefore      float64                      `json:"targetHpBefore,omitempty"`
	TargetHPAfter       float64                      `json:"targetHpAfter,omitempty"`
	SourceActorID       string                       `json:"sourceActorId,omitempty"`
	TargetActorID       string                       `json:"targetActorId,omitempty"`
}

type StatusTickRunResultV2 struct {
	TimeMs              int64                        `json:"timeMs"`
	StatusID            string                       `json:"statusId"`
	TickIndex           int                          `json:"tickIndex"`
	TickCount           int                          `json:"tickCount"`
	Kind                string                       `json:"kind"`
	FormulaID           string                       `json:"formulaId,omitempty"`
	FormulaBreakdown    []ActionValueBreakdownStepV2 `json:"formulaBreakdown,omitempty"`
	RawAmount           float64                      `json:"rawAmount,omitempty"`
	HasRawAmount        bool                         `json:"hasRawAmount,omitempty"`
	CritPolicy          string                       `json:"critPolicy,omitempty"`
	DamageType          string                       `json:"damageType,omitempty"`
	FinalDamage         float64                      `json:"finalDamage,omitempty"`
	HasFinalDamage      bool                         `json:"hasFinalDamage,omitempty"`
	HealApplied         float64                      `json:"healApplied,omitempty"`
	HasHealApplied      bool                         `json:"hasHealApplied,omitempty"`
	OverhealAmount      float64                      `json:"overhealAmount,omitempty"`
	HasOverheal         bool                         `json:"hasOverheal,omitempty"`
	CritRoll            float64                      `json:"critRoll,omitempty"`
	HasCritRoll         bool                         `json:"hasCritRoll,omitempty"`
	CritResult          bool                         `json:"critResult,omitempty"`
	HasCritResult       bool                         `json:"hasCritResult,omitempty"`
	CritMultiplier      float64                      `json:"critMultiplier,omitempty"`
	HasCritMultiplier   bool                         `json:"hasCritMultiplier,omitempty"`
	CritChanceRaw       float64                      `json:"critChanceRaw,omitempty"`
	CritChanceEffective float64                      `json:"critChanceEffective,omitempty"`
	HasCritChance       bool                         `json:"hasCritChance,omitempty"`
	CritChanceBound     *NumericBoundEvidenceV2      `json:"critChanceBound,omitempty"`
	TargetHPBefore      float64                      `json:"targetHpBefore,omitempty"`
	TargetHPAfter       float64                      `json:"targetHpAfter,omitempty"`
	SourceActorID       string                       `json:"sourceActorId,omitempty"`
	TargetActorID       string                       `json:"targetActorId,omitempty"`
}

type ActionRunResultV2 struct {
	TimeMs                int64                     `json:"timeMs"`
	ActionID              string                    `json:"actionId"`
	SourceActorID         string                    `json:"sourceActorId"`
	TargetActorID         string                    `json:"targetActorId"`
	Accepted              bool                      `json:"accepted"`
	BlockedReason         string                    `json:"blockedReason,omitempty"`
	BlockedRuleID         string                    `json:"blockedRuleId,omitempty"`
	BlockedStatusID       string                    `json:"blockedStatusId,omitempty"`
	ConditionKind         string                    `json:"conditionKind,omitempty"`
	ConditionID           string                    `json:"conditionId,omitempty"`
	ConditionPassed       bool                      `json:"conditionPassed,omitempty"`
	HasCondition          bool                      `json:"hasCondition,omitempty"`
	ExecutionStarted      bool                      `json:"executionStarted,omitempty"`
	ExecutionCompleted    bool                      `json:"executionCompleted,omitempty"`
	Interrupted           bool                      `json:"interrupted,omitempty"`
	ExecutionCompleteAtMs int64                     `json:"executionCompleteAtMs,omitempty"`
	ResourceDeltas        []ActionResourceDeltaV2   `json:"resourceDeltas,omitempty"`
	CooldownBefore        ActionCooldownRunStateV2  `json:"cooldownBefore,omitempty"`
	CooldownAfter         ActionCooldownRunStateV2  `json:"cooldownAfter,omitempty"`
	Effects               []ActionEffectRunResultV2 `json:"effects,omitempty"`
}

type SnapshotV2 struct {
	TimeMs int64             `json:"timeMs"`
	Actors []ActorSnapshotV2 `json:"actors"`
}

type ActionSnapshotV2 struct {
	TimeMs int64                   `json:"timeMs"`
	Actors []ActorActionSnapshotV2 `json:"actors"`
}

type TriggerRunResultV2 struct {
	TimeMs        int64  `json:"timeMs"`
	TriggerID     string `json:"triggerId"`
	Event         string `json:"event"`
	SourceActorID string `json:"sourceActorId,omitempty"`
	TargetActorID string `json:"targetActorId,omitempty"`
	EffectCount   int    `json:"effectCount"`
	ChainDepth    int    `json:"chainDepth"`
}

type DonePayloadV2 struct {
	StopReason      string                  `json:"stopReason"`
	FinalTimeMs     int64                   `json:"finalTimeMs"`
	ProcessedEvents int                     `json:"processedEvents"`
	QueuePeak       int                     `json:"queuePeak"`
	ChainDepthPeak  int                     `json:"chainDepthPeak"`
	TickEmitCount   int                     `json:"tickEmitCount"`
	Actors          []ActorSnapshotV2       `json:"actors"`
	Logs            []EngineEventLogV2      `json:"logs,omitempty"`
	ValueTrace      []ValueTraceV2          `json:"valueTrace,omitempty"`
	ActionResults   []ActionRunResultV2     `json:"actionResults,omitempty"`
	TickResults     []StatusTickRunResultV2 `json:"tickResults,omitempty"`
	TriggerResults  []TriggerRunResultV2    `json:"triggerResults,omitempty"`
	RNG             []RNGDraw               `json:"rng,omitempty"`
}

type OutboxRecordV2 struct {
	Kind    FrameKind `json:"kind"`
	Payload any       `json:"payload"`
}

type ReadyPayload struct {
	SchemaVersion  uint16 `json:"schemaVersion"`
	ActorCount     int    `json:"actorCount"`
	ActionCount    int    `json:"actionCount"`
	StatusCount    int    `json:"statusCount"`
	FormulaCount   int    `json:"formulaCount"`
	TriggerCount   int    `json:"triggerCount"`
	AttributeCount int    `json:"attributeCount"`
	ResourceCount  int    `json:"resourceCount"`
}

type ErrorPayload struct {
	Code    ErrCode  `json:"code"`
	Message string   `json:"message"`
	Details []string `json:"details,omitempty"`
}

type RNGDraw struct {
	Stream string  `json:"stream"`
	Index  uint64  `json:"index"`
	Use    string  `json:"use"`
	Value  float64 `json:"value"`
}

type EngineBundle = EngineBundleV2
type BundleSettings = BundleSettingsV2
type ActorTemplate = ActorTemplateV2
type ActionTemplate = ActionTemplateV2
type StatusTemplate = StatusTemplateV2
type TriggerDefinition = TriggerDefinitionV2
type EffectDef = EffectDefV2
type FormulaDefinition = FormulaDefinitionV2
type EngineRunInput = EngineRunInputV2
type CombatantRunInit = CombatantRunInitV2
type ActionRunInput = ActionRunInputV2
type ActionRequest = ActionRequestV2
type StopCondition = StopConditionV2
type TraceOptions = TraceOptionsV2
type ActorSnapshot = ActorSnapshotV2
type LogEntry = EngineEventLogV2
type DonePayload = DonePayloadV2
