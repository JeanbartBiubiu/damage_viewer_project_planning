// 本文件集中定义 TinyGo Engine V2 的输入、输出、枚举和 ABI payload DTO 契约。
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
	Settings                 BundleSettingsV2            `json:"settings"`
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
	ID           string                `json:"id"`
	Label        string                `json:"label,omitempty"`
	Classifier   ClassifierV2          `json:"classifier,omitempty"`
	CooldownMs   int64                 `json:"cooldownMs,omitempty"`
	Effects      []EffectDefV2         `json:"effects,omitempty"`
	RequiresMark string                `json:"requiresMark,omitempty"`
	ConsumesMark bool                  `json:"consumesMark,omitempty"`
	ResourceCost []ResourceCostV2      `json:"resourceCost,omitempty"`
	PanelCosts   []ActionPanelCostV2   `json:"panelCosts,omitempty"`
	PanelEffects []ActionPanelEffectV2 `json:"panelEffects,omitempty"`
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
	ID             string              `json:"id"`
	Kind           string              `json:"kind"`
	Classifier     ClassifierV2        `json:"classifier,omitempty"`
	DurationMs     int64               `json:"durationMs,omitempty"`
	BlocksActions  bool                `json:"blocksActions,omitempty"`
	RetryOnRelease bool                `json:"retryOnRelease,omitempty"`
	Magnitude      float64             `json:"magnitude,omitempty"`
	ShieldKind     string              `json:"shieldKind,omitempty"`
	AttrModifiers  []AttrModifierDefV2 `json:"attrModifiers,omitempty"`
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
	Type            EffectType       `json:"type"`
	FormulaID       string           `json:"formulaId,omitempty"`
	Amount          float64          `json:"amount,omitempty"`
	DamageType      string           `json:"damageType,omitempty"`
	StatusID        string           `json:"statusId,omitempty"`
	SourceRole      string           `json:"sourceRole,omitempty"`
	TargetRole      string           `json:"targetRole,omitempty"`
	HistoryWindowMs int64            `json:"historyWindowMs,omitempty"`
	CounterKey      string           `json:"counterKey,omitempty"`
	MarkID          string           `json:"markId,omitempty"`
	ResourceID      string           `json:"resourceId,omitempty"`
	AttrID          string           `json:"attrId,omitempty"`
	ModifierMode    AttrModifierMode `json:"modifierMode,omitempty"`
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

type EngineRunInputV2 struct {
	Seed           uint64             `json:"seed"`
	Self           CombatantRunInitV2 `json:"self"`
	Enemy          CombatantRunInitV2 `json:"enemy"`
	InitialActions []ActionRequestV2  `json:"initialActions,omitempty"`
	StopCondition  StopConditionV2    `json:"stopCondition,omitempty"`
	Trace          TraceOptionsV2     `json:"trace,omitempty"`
}

type CombatantRunInitV2 struct {
	ActorID    string   `json:"actorId"`
	TemplateID string   `json:"templateId"`
	StatusIDs  []string `json:"statusIds,omitempty"`
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
	ResourceID string  `json:"resourceId,omitempty"`
	FormulaID  string  `json:"formulaId,omitempty"`
	Amount     float64 `json:"amount"`
}

type ActionEffectSnapshotV2 struct {
	EffectIndex       int     `json:"effectIndex"`
	Kind              string  `json:"kind"`
	Label             string  `json:"label,omitempty"`
	FormulaID         string  `json:"formulaId,omitempty"`
	DamageType        string  `json:"damageType,omitempty"`
	StatusID          string  `json:"statusId,omitempty"`
	AttrID            string  `json:"attrId,omitempty"`
	MarkID            string  `json:"markId,omitempty"`
	SourceRole        string  `json:"sourceRole,omitempty"`
	TargetRole        string  `json:"targetRole,omitempty"`
	ResolvedAmount    float64 `json:"resolvedAmount,omitempty"`
	HasResolvedAmount bool    `json:"hasResolvedAmount,omitempty"`
}

type ActionInitialStateV2 struct {
	ActionID      string                   `json:"actionId"`
	Label         string                   `json:"label,omitempty"`
	CooldownMs    int64                    `json:"cooldownMs"`
	ReadyAtMs     int64                    `json:"readyAtMs"`
	CanCast       bool                     `json:"canCast"`
	BlockedReason string                   `json:"blockedReason,omitempty"`
	ResourceCosts []ActionCostSnapshotV2   `json:"resourceCosts,omitempty"`
	EffectRows    []ActionEffectSnapshotV2 `json:"effectRows,omitempty"`
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

type SnapshotV2 struct {
	TimeMs int64             `json:"timeMs"`
	Actors []ActorSnapshotV2 `json:"actors"`
}

type ActionSnapshotV2 struct {
	TimeMs int64                   `json:"timeMs"`
	Actors []ActorActionSnapshotV2 `json:"actors"`
}

type DonePayloadV2 struct {
	StopReason      string             `json:"stopReason"`
	FinalTimeMs     int64              `json:"finalTimeMs"`
	ProcessedEvents int                `json:"processedEvents"`
	QueuePeak       int                `json:"queuePeak"`
	ChainDepthPeak  int                `json:"chainDepthPeak"`
	TickEmitCount   int                `json:"tickEmitCount"`
	Actors          []ActorSnapshotV2  `json:"actors"`
	Logs            []EngineEventLogV2 `json:"logs,omitempty"`
	ValueTrace      []ValueTraceV2     `json:"valueTrace,omitempty"`
	RNG             []RNGDraw          `json:"rng,omitempty"`
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
type ActionRequest = ActionRequestV2
type StopCondition = StopConditionV2
type TraceOptions = TraceOptionsV2
type ActorSnapshot = ActorSnapshotV2
type LogEntry = EngineEventLogV2
type DonePayload = DonePayloadV2
