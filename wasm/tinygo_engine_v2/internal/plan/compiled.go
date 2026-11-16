package plan

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/inputbinding"
	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// CompiledAbilityRef 是 intern 后的 ability 三元组引用。
type CompiledAbilityRef struct {
	CombatantIndex uint8
	ProviderIndex  uint16
	AbilityIndex   uint16
}

// CompiledSession 是 generic compile 输出的只读 session 快照。
type CompiledDamageStateReader struct {
	Owner, ProviderRef, StateKey string
	ProviderIndex                uint16
}
type CompiledTargetTiming struct {
	StateKey     string
	AbilityIndex uint16
	Phased       bool
}
type CompiledSession struct {
	MultiplierGroupCount        uint32
	IncomingCappedFlatSources   []CompiledIncomingCappedFlatSource
	HasPermanentCharacterPeriod bool
	HasImmediatePeriodic        bool
	HasTotalCooldownRefund      bool
	HasCumulativeCooldownRefund bool
	HasTargetTiming             bool
	HasDamageStateBefore        bool
	DamageStateReaders          []CompiledDamageStateReader
	HasTargetMarkConsumption    bool
	HasReceivedShieldReads      bool
	HasAttackStartStateReads    bool
	HasStateOnExpire            bool
	HasStagedLinkedShield       bool
	HasModifierSnapshots        bool
	AttributeLayout             *attribute.Layout
	SkillActionBindings         []CompiledSkillActionBinding
	HasMechanicReads            bool
	HasShieldLifecycle          bool
	HasLinkedShieldReads        bool
	HasProviderElapsedReads     bool
	HasTargetStateTimeReads     bool
	HasFiniteModifierExpiry     bool
	HasResourceMax              bool
	PermanentResourceMax        []CompiledPermanentResourceMax
	HasCooldownDuration         bool
	HasProviderDurationChange   bool
	HasActionStun               bool
	StatusKeys                  []string
	SchemaVersion               string
	SchemaHash                  string
	RulesHash                   string
	Types                       typeset.CatalogResult
	RuntimeTypes                RuntimeTypeBindings
	Combatants                  []CompiledCombatant
	Providers                   []CompiledProvider
	Abilities                   []CompiledAbility
	Operations                  []CompiledOperation
	Formulas                    formula.Library
	// FormulaFactReads 只在实际条件准备时使用；运行期不遍历公式收集特殊事实。
	FormulaFactReads     map[formula.GenericProgramID][]formula.FactRequest
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
	ValueType    string
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
type CompiledModifier struct {
	HasMultiplierGroup       bool
	MultiplierGroupID        uint16
	HasMaximumReductionRatio bool
	MaximumReductionRatio    float64
	ValueReadMode            string
	// OwnedHealthReads仅由同技能作者生命读取的动态自身加算推导，不是公开协议字段。
	OwnedHealthReads         bool
	CurrentValuePolicy       string
	AffectedAbilityRefs      []string
	HasAffectedAbilityRefs   bool
	StaticValue              float64
	CooldownTargets          []CompiledCooldownDurationTarget
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

// Cold admission links a pure permanent status to its sole real character initializer.
type CompiledIncomingCappedFlatSource struct {
	Owner             string
	ParentProviderRef string
	EffectProviderRef string
	ParentIndex       uint16
	EffectIndex       uint16
}

type CompiledCooldownDurationTarget struct {
	CombatantKey  string
	ProviderRef   string
	ProviderIndex uint16
	AbilityIndex  uint16
}

// CompiledPermanentResourceMax is an actual mounted initialization consumer.
// It is installed once per fresh run, before any combat operation executes.
type CompiledPermanentResourceMax struct {
	Owner, SourceProviderRef, SourceDefinitionRef string
	ListenerKey, ProviderRef                      string
	OperationIndex, ProviderIndex                 uint16
}

// CompiledListener 是 compile 后的 listener（provider / rules / inline listenerSpec）。
type CompiledListener struct {
	ReadsDamageStateBefore bool
	ListenerKey            string
	AbilityRef             string
	HasAbilityRef          bool
	MaxTriggersPerEvent    int
	ChainLimitKey          string
	PerCastThrottleMs      int
	EventMatcher           typeset.Matcher
	OwnerCombatantKey      string // empty for rules listeners; concrete key for provider-owned
	OwnerProviderRef       string // empty for rules / inline without mount context
	SourceAbilityIndex     int    // >=0 when compiled from passive_listener ability ops
	OperationStart         uint16
	OperationCount         uint16
	HasCondition           bool
	ConditionProgram       formula.GenericProgramID
	HasOncePerUse          bool
	OncePerUseGroup        string
	OncePerUseScope        string
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

// CompiledStatusContribution 是 compile 后的普通减速能力。
type CompiledStatusContribution struct {
	ResultRef        string
	StatusKey        string
	StatusKind       string
	StrengthProgram  formula.GenericProgramID
	HasStrength      bool
	MomentEvaluation bool
	Path             string
}

// CompiledProviderStateField 是 initialStateSchema 规范化后的 provider-scope 字段定义（Gate H1）。
type CompiledProviderStateField struct {
	OnExpireStart uint16
	OnExpireCount uint16
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
	// ClosedStatusKey 来自已验证控制候选的实际状态键，只读绑定到本定义的有效实例。
	ClosedStatusKey string
	// ActionStun 来自已验证目录的眩晕类型，供实际拥有者的行动资格使用。
	ActionStun bool
	// FormulaLinkedReads 只准备此定义已获准读取的关联盾事实，不含监听专属回执。
	FormulaLinkedReads        []formula.FactRequest
	PermanentCharacterPeriod  bool
	TargetTimings             []CompiledTargetTiming
	HasReceivedShieldBinding  bool
	ReceivedShieldParentIndex uint16
	AttackStartStateKeys      []string
	HasStateOnExpire          bool
	AtomicLinkedShield        bool
	HasModifierSnapshots      bool
	// SelfModifierSnapshots 由完整自身属性快照闭包证明；冻结与恢复共用此归属事实。
	SelfModifierSnapshots bool
	// ShieldDefinitionRef is set only for a provider owned by an actual numeric shield.
	ShieldDefinitionRef  string
	NeedsElapsedTime     bool
	HasMomentStatus      bool
	NeedsModifierExpiry  bool
	HasResourceMax       bool
	PermanentResourceMax bool
	HasCooldownDuration  bool
	StaticDurationMs     int64
	AtomicDynamic        bool
	SkillKey             string
	AmmoBinding          *CompiledAmmoBinding
	Processes            []CompiledProcess
	ProviderKey          string
	Kind                 string
	StableID             string
	TypeSet              typeset.TypeSet
	AbilityStart         uint16
	AbilityCount         uint16
	Modifiers            []CompiledModifier
	Listeners            []CompiledListener
	Lifecycle            *CompiledProviderLifecycle
	StateFields          map[string]CompiledProviderStateField
	StatusContributions  []CompiledStatusContribution
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
	ImmediateFirst bool
	PhasePolicy    string
	IntervalMs     int64
	StartDelayMs   int64
	OnTickStart    uint16
	OnTickCount    uint16
	AnchorScope    string
	AnchorStateKey string
}

// CompiledAbility 是 compile 后的 ability 定义。
type CompiledTargetExpirySpec struct {
	AnchorStateKey               string
	OnExpireStart, OnExpireCount uint16
}

type CompiledAbility struct {
	TargetExpirySpec     *CompiledTargetExpirySpec
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
	PassiveProcessIndex          int
	TotalCooldownTarget          *CompiledCooldownDurationTarget
	TotalCooldownRatio           float64
	CumulativeLimit              *model.CumulativeRatioLimit
	TargetMark                   *CompiledTargetMark
	TargetMarkWriterRef          string
	ColdResourceMax              bool
	OwnerProviderIndex           int
	Operation                    string
	Target                       string
	DamageType                   string
	AmountProgram                formula.GenericProgramID
	HasAmount                    bool
	ResourceKey                  string
	AttributeKey                 string
	ValuePolicy                  string
	ProviderDefinitionRef        string
	ProviderRef                  string
	ShieldRef                    string
	HasShieldLifecycleProvider   bool
	ShieldLifecycleProviderIndex uint16
	AbilityRef                   CompiledAbilityRef
	HasAbilityRef                bool
	AbilityRefStr                string
	EventType                    string
	Ref                          string
	ConditionProgram             formula.GenericProgramID
	HasCondition                 bool
	StateScope                   string // state_scope/provider | state_scope/provider_target for state_change
	Types                        []string
	CopyableOnHit                bool
	CritEligible                 bool
	HasCritFormula               bool
	CritChanceProgram            formula.GenericProgramID
	CritMultiplierProgram        formula.GenericProgramID
	HasCritMultiplierMin         bool
	CritMultiplierMin            float64
	Path                         string
	VampQualification            string
	VampOverrides                []CompiledVampOverride
	RepeatScope                  string
	RepeatCount                  int
	RepeatTag                    string
	RepeatDelayMs                int
	TriggerStateKey              string
	Threshold                    float64
	ProviderRefFromEvent         bool
	SkillHit                     *CompiledSkillHit
	OutputRef                    string
	HasShieldDuration            bool
	ShieldDurationProgram        formula.GenericProgramID
}

// CompiledTargetMark keeps nested leaves out of the listener's flat operation range.
type CompiledTargetMark struct {
	StateKey, TriggerKind, TriggerAbilityRef string
	OwnerProviderRef, OwnerCombatantKey      string
	TriggerAbilityIndex                      uint16
	MarkAbilityRef                           string
	Clear                                    *CompiledOperation
	Damage                                   *CompiledOperation
	Restore                                  *CompiledOperation
}

type CompiledSkillHit struct {
	SkillKey           string
	Candidates         []CompiledSkillHitCandidate
	RuleGroups         []CompiledSkillHitRuleGroup
	OwnerProviderIndex int
	PrimaryCandidate   int // -1 unless an explicit validated PRIMARY exists.
	ReplacesPrimary    bool
}

type CompiledSkillHitRuleGroup struct {
	RuleKey, OncePerUseGroup, OncePerUseScope, Path string
	CandidateStart, CandidateCount                  int
}

// CompiledSkillHitCandidate 保存资格、条件程序与候选操作区间。
type CompiledSkillHitCandidate struct {
	RuleGroupIndex                   int // -1 for an ungrouped candidate.
	AttackDamageRole                 uint8
	CandidateKey                     string
	EffectOccurrenceKey              string
	EffectKey                        string
	ResultKey                        string
	Semantic                         model.SkillHitSemantic
	BlockScope                       string // empty = null
	HasBlockScope                    bool
	InboundBlockEligible             bool
	ParticipationProgram             formula.GenericProgramID
	HasParticipation                 bool
	ParticipationProviderRef         string
	ParticipationProviderRefs        [2]string // source/target; compile-bound original mounts only
	ParticipationProviderDefinitions [2]uint16
	EventValueConds                  []CompiledSkillHitValueCond
	OperationStart                   uint16
	OperationCount                   uint16
	Path                             string
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
	IntervalProgram     formula.GenericProgramID
	Path                string
	OneByOne            bool
	HasInitialRemaining bool
	InitialRemainingMs  int64
}

type CompiledAmmoBinding struct {
	StateKey            string
	InitialAbilityIndex int
	ProcessIndex        int
	ConsumptionPath     string
}

// CompiledProcess 保存有序步骤和作者顺序的时点操作，不持有运行实例。
type CompiledProcess struct {
	EntryKind           string
	StartStateKeys      []string
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
	MaximumAttackCount          int
	MaximumRecastCount          int
	RecastIntervalMs            int64
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
	Slot                      uint16
	InitialAbilityIndex       uint16
	ControlAbilityIndices     map[string]uint16
	AutomaticEligible         bool
	AutomaticIneligiblePath   string
	AutomaticIneligibleReason string
	HasEmpoweredAttack        bool
	HasFiniteRecast           bool
	EmpoweredAbilityIndex     uint16
	ReplacesPrimary           bool
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

// AllowsSourceTargetReuse 报告是否按 definitionRef+source+owner 复用实例。
func (lc *CompiledProviderLifecycle) AllowsSourceTargetReuse() bool {
	return lc != nil && lc.InstanceScope == model.InstanceScopeSourceTarget
}

// IsAnchored 报告该 tickSpec 是否为配对锚点模式。
func (ts *CompiledTickSpec) IsAnchored() bool {
	return ts != nil && ts.AnchorScope != "" && ts.AnchorStateKey != ""
}

// CompiledSkillHit 是 resolve_skill_hit 的编译计划。
const (
	AttackDamageRolePrimary        uint8 = 1
	AttackDamageRoleReplacePrimary uint8 = 2
)

// FiniteRecastProcess is the only newly admitted repeated active-cast graph.
func FiniteRecastProcess(process *CompiledProcess) bool {
	return process != nil && len(process.Steps) == 2 && process.Steps[0].StepType == "IMMEDIATE" && process.Steps[1].StepType == "RECAST" &&
		process.Steps[0].HasActionOccupancy && !process.Steps[0].OccupiesAction && process.Steps[1].HasActionOccupancy && !process.Steps[1].OccupiesAction
}
