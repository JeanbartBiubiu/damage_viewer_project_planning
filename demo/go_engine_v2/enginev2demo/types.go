package enginev2demo

type EngineBundle struct {
	ActorTemplates  map[string]ActorTemplate  `json:"actorTemplates"`
	ActionTemplates map[string]ActionTemplate `json:"actionTemplates"`
	ItemTemplates   map[string]ItemTemplate   `json:"itemTemplates"`
	StatusTemplates map[string]StatusTemplate `json:"statusTemplates"`
	DamageProfiles  map[string]DamageProfile  `json:"damageProfiles"`
	Formulas        []FormulaDefinition       `json:"-"`
}

type ActorTemplate struct {
	TemplateID       string                   `json:"templateId"`
	Attributes       map[string]float64       `json:"attributes"`
	InitialResources map[string]float64       `json:"initialResources"`
	ActionIDs        []string                 `json:"actionIds"`
	Triggers         []TriggerSubscriptionDef `json:"triggers"`
}

type ActionTemplate struct {
	ActionID          string                   `json:"actionId"`
	Label             string                   `json:"label"`
	DamageProfileID   string                   `json:"damageProfileId"`
	FormulaID         string                   `json:"formulaId"`
	CooldownFormulaID string                   `json:"cooldownFormulaId"`
	ResourceCosts     map[string]float64       `json:"resourceCosts"`
	Triggers          []TriggerSubscriptionDef `json:"triggers"`
}

type ItemTemplate struct {
	ItemID   string                   `json:"itemId"`
	Label    string                   `json:"label"`
	Triggers []TriggerSubscriptionDef `json:"triggers"`
}

type StatusTemplate struct {
	StatusID           string                   `json:"statusId"`
	Label              string                   `json:"label"`
	StatusKind         StatusKind               `json:"statusKind"`
	DurationMs         int64                    `json:"durationMs"`
	RefreshPolicy      StatusRefreshPolicy      `json:"refreshPolicy"`
	MagnitudeFormulaID string                   `json:"magnitudeFormulaId"`
	Triggers           []TriggerSubscriptionDef `json:"triggers"`
}

type DamageProfile struct {
	DamageProfileID               string `json:"damageProfileId"`
	EffectiveResistanceFormulaID  string `json:"effectiveResistanceFormulaId"`
	MitigationMultiplierFormulaID string `json:"mitigationMultiplierFormulaId"`
}

type TriggerSubscriptionDef struct {
	TriggerType            TriggerType    `json:"triggerType"`
	OwnerEventRole         EventActorRole `json:"ownerEventRole"`
	ConditionFormulaID     string         `json:"conditionFormulaId,omitempty"`
	RequiresPositiveDamage bool           `json:"requiresPositiveDamage"`
	Effects                []EffectDef    `json:"-"`
}

type TriggerType string

const (
	TriggerTypeOnActionCast  TriggerType = "ON_ACTION_CAST"
	TriggerTypeOnDamageTaken TriggerType = "ON_DAMAGE_TAKEN"
)

type EventActorRole string

const (
	EventActorRoleSource EventActorRole = "SOURCE"
	EventActorRoleTarget EventActorRole = "TARGET"
)

type StatusKind string

const (
	StatusKindShield StatusKind = "SHIELD"
	StatusKindStun   StatusKind = "STUN"
)

type StatusRefreshPolicy string

const (
	StatusRefreshTakeMax StatusRefreshPolicy = "TAKE_MAX"
	StatusRefreshReplace StatusRefreshPolicy = "REPLACE"
)

type EffectDef interface {
	effectDef()
}

type DealDamageEffect struct {
	ActionID        string         `json:"actionId"`
	Label           string         `json:"label"`
	DamageProfileID string         `json:"damageProfileId"`
	FormulaID       string         `json:"formulaId"`
	SourceActorRole EventActorRole `json:"sourceActorRole"`
	TargetActorRole EventActorRole `json:"targetActorRole"`
}

func (DealDamageEffect) effectDef() {}

type ApplyStatusEffect struct {
	StatusID        string         `json:"statusId"`
	SourceActorRole EventActorRole `json:"sourceActorRole"`
	TargetActorRole EventActorRole `json:"targetActorRole"`
}

func (ApplyStatusEffect) effectDef() {}

type StopCondition struct {
	MaxEvents int64 `json:"maxEvents"`
}

type CombatantRunInit struct {
	ActorID          string   `json:"actorId"`
	TemplateID       string   `json:"templateId"`
	EquippedItemIDs  []string `json:"equippedItemIds"`
	InitialStatusIDs []string `json:"initialStatusIds"`
}

type ActionRequest struct {
	TriggerAtMs   int64  `json:"triggerAtMs"`
	SourceActorID string `json:"sourceActorId"`
	TargetActorID string `json:"targetActorId"`
	ActionID      string `json:"actionId"`
}

type EngineRunInput struct {
	Seed           int64            `json:"seed"`
	StopCondition  StopCondition    `json:"stopCondition"`
	Self           CombatantRunInit `json:"self"`
	Enemy          CombatantRunInit `json:"enemy"`
	InitialActions []ActionRequest  `json:"initialActions"`
}

type ActorSnapshot struct {
	ActorID      string             `json:"actorId"`
	CurrentHP    float64            `json:"currentHp"`
	ShieldAmount float64            `json:"shieldAmount"`
	Attributes   map[string]float64 `json:"attributes"`
	Resources    map[string]float64 `json:"resources"`
}

type LogEntry struct {
	TimeMs        int64   `json:"timeMs"`
	Kind          string  `json:"kind"`
	ActionID      string  `json:"actionId,omitempty"`
	SourceActorID string  `json:"sourceActorId,omitempty"`
	TargetActorID string  `json:"targetActorId,omitempty"`
	StatusID      string  `json:"statusId,omitempty"`
	Amount        float64 `json:"amount,omitempty"`
	Message       string  `json:"message,omitempty"`
}

type EngineRunResult struct {
	Actors          map[string]ActorSnapshot `json:"actors"`
	Logs            []LogEntry               `json:"logs"`
	FinalTimeMs     int64                    `json:"finalTimeMs"`
	ProcessedEvents int64                    `json:"processedEvents"`
	StopReason      string                   `json:"stopReason"`
}

type BattleSummary struct {
	FinalTimeMs     int64   `json:"finalTimeMs"`
	ProcessedEvents int64   `json:"processedEvents"`
	StopReason      string  `json:"stopReason"`
	SelfHP          float64 `json:"selfHp"`
	EnemyHP         float64 `json:"enemyHp"`
	LogCount        int     `json:"logCount"`
}

type OperationStats struct {
	FirstUs     float64 `json:"firstUs"`
	SampleCount int     `json:"sampleCount"`
	Warmup      int     `json:"warmup"`
	MinUs       float64 `json:"minUs"`
	P50Us       float64 `json:"p50Us"`
	AvgUs       float64 `json:"avgUs"`
	P95Us       float64 `json:"p95Us"`
	MaxUs       float64 `json:"maxUs"`
}

type BenchmarkReport struct {
	Init    OperationStats `json:"init"`
	Run     OperationStats `json:"run"`
	Summary BattleSummary  `json:"summary"`
}
