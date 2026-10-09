package plan

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/inputbinding"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

// CompiledAbilityRef 是 intern 后的 ability 三元组引用。
type CompiledAbilityRef struct {
	CombatantIndex uint8
	ProviderIndex  uint16
	AbilityIndex   uint16
}

// CompiledSession 是 generic compile 输出的只读 session 快照。
type CompiledSession struct {
	SkillActionBindings  []CompiledSkillActionBinding
	HasMechanicReads     bool
	StatusKeys           []string
	SchemaVersion        string
	SchemaHash           string
	RulesHash            string
	Types                typeset.CatalogResult
	Combatants           []CompiledCombatant
	Providers            []CompiledProvider
	Abilities            []CompiledAbility
	Operations           []CompiledOperation
	Formulas             formula.GenericRegistry
	Settings             model.GenericCompileSettings
	AbilityRefIndex      map[string]CompiledAbilityRef
	RuleModifiers        []CompiledModifier
	Listeners            []CompiledListener
	VampRules            []CompiledVampRule
	DamageTypeFormulas   map[string]CompiledDamageTypeFormula
	AttributeDerivations []CompiledAttributeDerivation
}

type CompiledAttributeDerivation struct {
	SkillKey     string
	ValuePolicy  string
	CombatantKey string
	AttributeKey string
	ValueProgram formula.GenericProgramID
	Path         string
}

// CompiledCombatant 是 compile 后的 combatant 定义。
type CompiledCombatant struct {
	Key            string
	DisplayName    string
	TypeSet        typeset.TypeSet
	Attributes     map[string]model.AttributeSlotDef
	Resources      map[string]model.ResourceSlotDef
	ProviderMounts []CompiledProviderMount
}

// CompiledProviderMount 是 combatant 上已解析的 provider 挂载。
type CompiledProviderMount struct {
	ProviderRef          string
	DefinitionIndex      uint16
	MountedProviderIndex uint16
}

// CompiledModifier 是 compile 后的 provider / rule modifier。
// CompiledModifier 是 compile 后的 provider / rule modifier。
type CompiledModifier struct {
	ModifierKey              string
	Kind                     string
	Target                   string
	Command                  string
	Channel                  string
	Bucket                   string
	Stage                    string
	Priority                 int
	HealDirection            string
	HealCategory             string
	HealGroupKey             string
	HealGroupCalculationMode string
	ValuePolicy              string
	ValueProgram             formula.GenericProgramID
	HasValue                 bool
	HasCondition             bool
	ConditionProg            formula.GenericProgramID
}

// CompiledListener 是 compile 后的 listener（provider / rules / inline listenerSpec）。
type CompiledListener struct {
	ListenerKey         string
	AbilityRef          string
	HasAbilityRef       bool
	MaxTriggersPerEvent int
	ChainLimitKey       string
	PerCastThrottleMs   int
	EventMatcher        typeset.Matcher
	OwnerCombatantKey   string // empty for rules listeners; concrete key for provider-owned
	OwnerProviderRef    string // empty for rules / inline without mount context
	SourceAbilityIndex  int    // >=0 when compiled from passive_listener ability ops
	OperationStart      uint16
	OperationCount      uint16
	HasCondition        bool
	ConditionProgram    formula.GenericProgramID
	HasOncePerUse       bool
	OncePerUseGroup     string
	OncePerUseScope     string
}

// CompiledProviderLifecycle 是 compile 后的 provider 生命周期。
// CompiledProviderLifecycle 是 compile 后的 provider 生命周期。
type CompiledProviderLifecycle struct {
	DurationProgram formula.GenericProgramID
	HasDuration     bool
	MaxStacks       int
	RefreshPolicy   string
	TickIntervalMs  int64
	InstanceScope   string
	DurationPath    string
}

// AllowsSourceTargetReuse 报告是否按 definitionRef+source+owner 复用实例。
func (lc *CompiledProviderLifecycle) AllowsSourceTargetReuse() bool {
	return lc != nil && lc.InstanceScope == model.InstanceScopeSourceTarget
}

// CompiledStatusContribution 是 compile 后的普通减速能力。
type CompiledStatusContribution struct {
	ResultRef       string
	StatusKey       string
	StatusKind      string
	StrengthProgram formula.GenericProgramID
	HasStrength     bool
	Path            string
}

// CompiledProviderStateField 是 initialStateSchema 规范化后的 provider-scope 字段定义（Gate H1）。
type CompiledProviderStateField struct {
	StateKind     string
	AmmoRecovery  *CompiledAmmoRecovery
	ValueType     string
	DefaultValue  float64
	MaxValue      float64
	HasCap        bool
	DurationMs    int64
	RefreshPolicy string
}

// CompiledProvider 是 compile 后的 provider 定义。
type CompiledProvider struct {
	SkillKey            string
	AmmoBinding         *CompiledAmmoBinding
	Processes           []CompiledProcess
	ProviderKey         string
	Kind                string
	StableID            string
	TypeSet             typeset.TypeSet
	AbilityStart        uint16
	AbilityCount        uint16
	Modifiers           []CompiledModifier
	Listeners           []CompiledListener
	Lifecycle           *CompiledProviderLifecycle
	StateFields         map[string]CompiledProviderStateField
	StatusContributions []CompiledStatusContribution
}

// CompiledAbilityCost 是 compile 后的 ability 资源消耗。
type CompiledAbilityCost struct {
	ResourceKey   string
	AmountProgram formula.GenericProgramID
	HasAmount     bool
	AllowPartial  bool
}

// CompiledAbilityCooldown 是 compile 后的 ability 冷却。
type CompiledAbilityCooldown struct {
	DurationProgram formula.GenericProgramID
	HasDuration     bool
	StartsOn        string
	GroupKey        string
}

// CompiledTickSpec 是 compile 后的 tick ability 行为。
// AnchorScope/AnchorStateKey 非空表示 target-state-anchored 模式（StartDelayMs 保持 0，不默认成 interval）。
type CompiledTickSpec struct {
	IntervalMs     int64
	StartDelayMs   int64
	OnTickStart    uint16
	OnTickCount    uint16
	AnchorScope    string
	AnchorStateKey string
}

// IsAnchored 报告该 tickSpec 是否为配对锚点模式。
func (ts *CompiledTickSpec) IsAnchored() bool {
	return ts != nil && ts.AnchorScope != "" && ts.AnchorStateKey != ""
}

// CompiledAbility 是 compile 后的 ability 定义。
type CompiledAbility struct {
	ProcessControl       *CompiledProcessControl
	AbilityKey           string
	Kind                 string
	TypeSet              typeset.TypeSet
	Params               map[string]float64
	CastOrigin           string // champion|item|pet|innate；空表示未声明
	Cost                 *CompiledAbilityCost
	Cooldown             *CompiledAbilityCooldown
	CastConditionProgram formula.GenericProgramID
	HasCastCondition     bool
	TickSpec             *CompiledTickSpec
	ProviderIndex        uint16
	OperationStart       uint16
	OperationCount       uint16
	HasSkillHit          bool
	SkillHitSkillKey     string
	SkillKey             string
	IsBasicAttack        bool
}

// CompiledOperation 是 compile 后的 operation 定义。
type CompiledOperation struct {
	OwnerProviderIndex    int
	Operation             string
	Target                string
	DamageType            string
	AmountProgram         formula.GenericProgramID
	HasAmount             bool
	ResourceKey           string
	AttributeKey          string
	ValuePolicy           string
	ProviderDefinitionRef string
	ProviderRef           string
	ShieldRef             string
	AbilityRef            CompiledAbilityRef
	HasAbilityRef         bool
	AbilityRefStr         string
	EventType             string
	Ref                   string
	ConditionProgram      formula.GenericProgramID
	HasCondition          bool
	StateScope            string // state_scope/provider | state_scope/provider_target for state_change
	Types                 []string
	CopyableOnHit         bool
	CritEligible          bool
	HasCritFormula        bool
	CritChanceProgram     formula.GenericProgramID
	CritMultiplierProgram formula.GenericProgramID
	Path                  string
	VampQualification     string
	VampOverrides         []CompiledVampOverride
	RepeatScope           string
	RepeatCount           int
	RepeatTag             string
	RepeatDelayMs         int
	TriggerStateKey       string
	Threshold             float64
	ProviderRefFromEvent  bool
	SkillHit              *CompiledSkillHit
	OutputRef             string
	HasShieldDuration     bool
	ShieldDurationProgram formula.GenericProgramID
}

// CompiledSkillHit 是 resolve_skill_hit 的编译计划。
type CompiledSkillHit struct {
	SkillKey   string
	Candidates []CompiledSkillHitCandidate
}

// CompiledSkillHitCandidate 保存资格、条件程序与候选操作区间。
type CompiledSkillHitCandidate struct {
	CandidateKey         string
	EffectOccurrenceKey  string
	EffectKey            string
	ResultKey            string
	Semantic             model.SkillHitSemantic
	BlockScope           string // empty = null
	HasBlockScope        bool
	InboundBlockEligible bool
	ParticipationProgram formula.GenericProgramID
	HasParticipation     bool
	EventValueConds      []CompiledSkillHitValueCond
	OperationStart       uint16
	OperationCount       uint16
	Path                 string
}

// CompiledSkillHitValueCond 是编译后的 first_contact/blocked 比较。
type CompiledSkillHitValueCond struct {
	Key        string
	Comparator string
	ValueProg  formula.GenericProgramID
	HasValue   bool
	Path       string
}

type CompiledDamageTypeFormula struct {
	DamageType string
	Program    formula.GenericProgramID
	Binding    *inputbinding.Plan
	Reads      []CompiledDamageAttributeRead
	Path       string
	OutputPath string
}

// CompiledDamageAttributeRead只保留已验证的原属性身份和实际双方选择。
type CompiledDamageAttributeRead struct{ Object, AttributeKey string }

type CompiledAmmoRecovery struct {
	IntervalProgram formula.GenericProgramID
	Path            string
}

type CompiledAmmoBinding struct {
	StateKey            string
	InitialAbilityIndex int
	ProcessIndex        int
	ConsumptionPath     string
}

// CompiledProcess 保存有序步骤和作者顺序的时点操作，不持有运行实例。
type CompiledProcess struct {
	ProcessKey          string
	SkillKey            string
	Steps               []CompiledProcessStep
	Costs               []CompiledProcessCost
	Cooldown            *CompiledProcessCooldown
	MomentOperations    []CompiledProcessMomentOperations
	InitialAbilityIndex int
	Path                string
}

type CompiledProcessStep struct {
	StepKey                     string
	StepType                    string
	OccupiesAction              bool
	HasActionOccupancy          bool
	DelayProgram                formula.GenericProgramID
	MinimumChargeProgram        formula.GenericProgramID
	MaximumChargeProgram        formula.GenericProgramID
	WindowProgram               formula.GenericProgramID
	RepeatCountProgram          formula.GenericProgramID
	IntervalProgram             formula.GenericProgramID
	DurationProgram             formula.GenericProgramID
	ExecutionCountProgram       formula.GenericProgramID
	FirstExecutionOffsetProgram formula.GenericProgramID
	LastExecutionOffsetProgram  formula.GenericProgramID
	HasInterval                 bool
	FirstExecution              string
	HasDelay                    bool
	HasMinimumCharge            bool
	HasMaximumCharge            bool
	HasWindow                   bool
	ReleaseAtMaximum            bool
	Path                        string
}

type CompiledProcessCost struct {
	ResourceKey   string
	AmountProgram formula.GenericProgramID
	HasAmount     bool
	Path          string
}

type CompiledProcessCooldown struct {
	DurationProgram formula.GenericProgramID
	HasDuration     bool
	RoundPositiveMs bool
	StartMoment     model.ProcessMomentDefinition
	Path            string
}

type CompiledProcessMomentOperations struct {
	Moment         model.ProcessMomentDefinition
	OperationStart uint16
	OperationCount uint16
	Path           string
}

type CompiledProcessControl struct {
	model.ProcessControlDefinition
	ProcessIndex int
}

type CompiledSkillActionBinding struct {
	model.SkillActionBinding
	InitialAbilityIndex   uint16
	ControlAbilityIndices map[string]uint16
}

type CompiledVampRule struct {
	VampType           string
	SourceAttributeKey string
	BasisOutputKind    string
	DefaultEfficiency  float64
	TargetMatcher      typeset.Matcher
	AbilityMatcher     typeset.Matcher
	DamageMatcher      typeset.Matcher
}

type CompiledVampOverride struct {
	VampType          string
	Mode              string
	BasisOutputKind   string
	EfficiencyProgram formula.GenericProgramID
	Path              string
}
