package lifecycle

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/actor"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

const maxJSONSafeInteger int64 = 9007199254740991

// ExecutorAPI 列出效果执行对象的能力；真实实例与状态袋仍由效果包持有。
type ExecutorAPI interface {
	// ApplyLive 完整应用或复用真实实例，过期卸载后重读；后续绑定错误保留已发布前缀。
	ApplyLive(input ProviderApplication, now int64, work ProviderWork) *model.EngineError
	// RefreshLive 在原期限请求之后发布实际刷新，保留叠层、引用和延后数值错误。
	RefreshLive(owner, reference string, expiry int64, hasExpiry bool, contributions effectpkg.ContributionView, now int64, work ProviderWork) *model.EngineError
	// RemoveLive 完整移除指定实例及反向关联，原外部清理和所属发布次序不变。
	RemoveLive(owner, reference string, context formula.GenericEvalContext, kind model.EvidenceKind, now int64, work ProviderWork)
	// RemoveLiveStrict 按原错误定位核对拥有者、实例与定义后执行完整移除，不承诺整链回滚。
	RemoveLiveStrict(owner, reference, definition string, context formula.GenericEvalContext, now int64, work ProviderWork) *model.EngineError
	// PublishMutations 在全部拥有者暂存已发布后消费原序效果批次，使用同一原移除上下文。
	// 只在显式失败位置返回，不将原延后错误升级为逐项提前中止。
	PublishMutations(mutations []Mutation, context formula.GenericEvalContext, now int64, work ProviderWork) *model.EngineError
	// SweepLive 保留普通清扫的原拥有者遍历，以及关联盾先实例后重新读取护盾的独立语义。
	SweepLive(now int64, work ProviderWork, expired ExpiredEffects)
	// StageExpiryFrame 在指定真实帧的所属暂存中消费有限到期命令，不发布或解释根帧。
	StageExpiryFrame(frame ExpiryFrame, mutations []Mutation, projection *Projection, dirty *bool) []Mutation
	// HandleExpiry 核对实际载荷及旧期限，决定原直接清理或真实帧，并交接既有状态到期阶段。
	HandleExpiry(payload effectpkg.ExpiryPayload, now int64, automated bool, work ProviderWork, execution ExpiryExecution)
	// RemoveExpiredShield 只消费当前同引用已到期盾；按原关联政策保留实际帧边界。
	RemoveExpiredShield(owner, reference string, now int64, work ProviderWork, execution ExpiryExecution)
	// RemoveLiveShield 完整消费盾及关联实例的原移除政策，缺失或不匹配不生成伪造变化。
	RemoveLiveShield(owner, reference string, kind model.EvidenceKind, now int64, work ProviderWork, execution ExpiryExecution)
	// ValidateProjectedMutations 在原早期预检核对投影批次完整性，不发布或提前准备其他计时。
	ValidateProjectedMutations(projection *Projection, mutations []Mutation) *model.EngineError
	// PreflightOwner 选取原所属底表并顺序预演全部效果操作，只交出原排程需求。
	PreflightOwner(instances effectpkg.InstanceChangeSet, mutations []Mutation, input MutationPreflight) (int, *model.EngineError)
	// ExecuteLinkedShield 依次验证金额和绑定、读取原期限及应用事实，再暂存真实关联盾。
	// 失败前不提前借用角色暂存；合法0保持替换旧盾而不新建身份的原语义。
	ExecuteLinkedShield(op plan.CompiledOperation, ability plan.CompiledAbility, source, target string, amount float64, now int64, reads LinkedShieldPreparation) (ShieldProjection, *model.EngineError)
	// ChangeInternalCooldown 通过行动包真实冷却账处理状态写入，不另存冷却期限。
	ChangeInternalCooldown(op plan.CompiledOperation, owner, provider, target string, amount float64, bag effectpkg.BagChange, ledger *actionpkg.CooldownLedger, now int64) (contract.CooldownIdentity, bool, *model.EngineError)
	// ConsumeTargetMark 在当前真实帧组合清除、阻挡或伤害及恢复；金额按原位置逐次求值。
	ConsumeTargetMark(input MarkInput, execution MarkExecution) *model.EngineError
	// CooldownDurationFactor 在动态投影完成后的真实效果视图上计算该过程冷却倍率。
	CooldownDurationFactor(p *actionpkg.ProcessView, instances effectpkg.ProviderList, now int64) (float64, *model.EngineError)
	// PrepareDurationChange 先核验原来源与静态期限，再准备动态投影并核定实际续时，不发布实例。
	PrepareDurationChange(operation plan.CompiledOperation, owner, source, provider string, now int64, reads ProviderDurationPreparation) (Mutation, bool, *model.EngineError)
	// PrepareOwnDefinitionExpiry 核对实际父挂载及自身来源，先准备投影，再借用当前列表定位唯一有限实例。
	// 不发布状态或保存借用；缺失和精确到期为空操作，多实例或异源身份错误保持失败。
	PrepareOwnDefinitionExpiry(operation plan.CompiledOperation, owner, source, provider, target string, now int64, reads ProviderDurationPreparation) (Mutation, bool, *model.EngineError)
	// ExecuteStateDuration 拥有普通状态减时及两种目标续时的资格、金额短路和暂存流程。
	ExecuteStateDuration(input StateExecutionInput, reads StateExecutionReads, attributes StateAttributeExecution, actions StateActionExecution, requests TimingRequests) *model.EngineError
	// ExecuteStateWrite 拥有状态写入、期限和回充资格的完整流程；真实暂存和跨功能同步仍在原帧。
	ExecuteStateWrite(input StateExecutionInput, reads StateExecutionReads, attributes StateAttributeExecution, actions StateActionExecution, requests TimingRequests) *model.EngineError
	// FindAnchoredAbility 按编译顺序定位该真实实例的锚定周期，不用状态键拼接新的注册表。
	FindAnchoredAbility(index uint16, key string) (*plan.CompiledAbility, bool)
	// FindDefinition 按编译顺序定位定义，不隐式生成缺失定义。
	FindDefinition(key string) (uint16, bool)
	// FreezeModifierSnapshots 使用原调用点准备的上下文冻结本次施加金额；失败不发布实例。
	FreezeModifierSnapshots(provider plan.CompiledProvider, source, target string, context formula.GenericEvalContext) (map[string]float64, *model.EngineError)
	// InitialResourceMaximum 核对真实初始生命上限和动态贡献恢复限制，返回原冷初始化锚点。
	InitialResourceMaximum(owner string, attributes attribute.Table, instances effectpkg.ProviderList) (float64, *model.EngineError)
	// InitialTickRequest 计算实际挂载的首个周期请求；锚定周期只由目标状态写入触发。
	InitialTickRequest(owner, reference string, index uint16, expiry, now, stop int64, basic, basicAlive bool) (ProviderTickRequest, bool)
	// InstallPermanentResourceMax 在双方验证通过后安装本拥有者的真实实例、上限贡献和数值，不执行事件派发。
	InstallPermanentResourceMax(prepared PermanentResourcePlan, instances *effectpkg.InstanceState, numbers *actor.State, detailed bool) PermanentResourceInstallation
	// InternalCooldownDurationActive 在金额求值前复核实际目标及冷却活动，保持不活动短路。
	InternalCooldownDurationActive(op plan.CompiledOperation, owner, provider, target string, bag effectpkg.BagChange, ledger *actionpkg.CooldownLedger, now int64) (contract.CooldownIdentity, bool, *model.EngineError)
	// LinkedShieldPresent 按实际施加者、拥有者及当前暂存关联判断护盾存在，不修改投影。
	LinkedShieldPresent(index uint16, provider, owner string, instances effectpkg.ProviderList, shields effectpkg.ShieldList, mutations []Mutation, now int64) (float64, error)
	// MountProvider 将定义的数值修正挂到双方所属效果解析器，保留施加快照及实际来源。
	MountProvider(pair EffectMountPair, owner string, instance effectpkg.Provider)
	// ObserveMomentStatuses 仅更新调用方已经拥有的最终快照，不改实际实例中的施加快照。
	ObserveMomentStatuses(instances effectpkg.ProviderList, snapshots []model.CombatantProviderSnapshot, now int64) *model.EngineError
	// PermanentHealthAnchor 独立核对实际静态装备的生命值贡献，禁止用派生或规则修正补足冷初始化。
	PermanentHealthAnchor(owner string, attributes attribute.Table) (float64, *model.EngineError)
	// PermanentOperationConsumed 只接受实际零时刻来源初始化消费已安装的永久贡献操作。
	PermanentOperationConsumed(op plan.CompiledOperation, owner, provider string, initialization bool, now int64) *model.EngineError
	// PrepareLifecycle 求值期限及状态贡献，不更改实例、角色或队列。
	PrepareLifecycle(provider plan.CompiledProvider, evalCtx formula.GenericEvalContext, now int64) (PreparedLifecycle, *model.EngineError)
	// PreflightMutations 复制有变更角色的基础实例并按原序只读预演，返回排程数或原错误；不发布、登记身份或入队。
	PreflightMutations(base effectpkg.ProviderList, mutations []Mutation, input MutationPreflight) (int, *model.EngineError)
	// ProjectShieldCandidates 仅预演现有实例的移除和刷新供同组后续选盾；临时列表只借用于本次同步选盾，不发布。
	ProjectShieldCandidates(base effectpkg.ProviderList, mutations []Mutation, now int64) (effectpkg.ProviderList, *model.EngineError)
	// PreparePermanentResourceMax 先验证双方容量、静态锚点和真实来源挂载，任一失败均不安装贡献。
	PreparePermanentResourceMax(snapshot model.Snapshot, owners [2]InitialResourceOwner, now int64) ([2]PermanentResourcePlan, *model.EngineError)
	// PrepareProviderMutation 核对真实施加或刷新目标及定义，再在原位置准备期限和贡献。
	PrepareProviderMutation(input ProviderPreparationInput, reads ProviderPreparation) (PreparedLifecycle, *model.EngineError)
	// ProjectDynamic 按原顺序暂存动态实例及关联盾；出错保留此前真实暂存，不发布或排队。
	ProjectDynamic(input ProjectionInput) (bool, *model.EngineError)
	// ProjectResourceMaximum 按真实活动实例识别上限贡献和惰性到期事实，不改变角色当前生命。
	ProjectResourceMaximum(instances effectpkg.InstanceChangeSet, anchor float64, records []model.ResourceChangeContributor, now int64) ResourceMaximum
	// ReferencesPermanentPeriod 按双方真实来源语境判断能力引用是否指向永久角色周期。
	ReferencesPermanentPeriod(abilityRef string, normalize AbilityReference) bool
	// ResourceContributor 把实际效果贡献转换成原报告归属，不重新求值或生成新的使用身份。
	ResourceContributor(item effectpkg.ResourceContribution, reason string) model.ResourceChangeContributor
	// RestoreStateTimers 在原快照恢复边界核对原值、绑定字段并恢复所属期限及真实冷却账，不重建事件堆。
	RestoreStateTimers(owner string, instances effectpkg.ProviderList, bags *effectpkg.BagState, cooldowns **actionpkg.CooldownLedger, raw map[string]interface{}, actualOwners map[string]bool, cache *effectpkg.DefinitionCache, now int64, path string) *model.EngineError
	// RunAnchoredTick 处理实际目标、世代、末拍保护、门禁及同步帧执行，发布后失败仍释放已完成末拍。
	RunAnchoredTick(instance effectpkg.Provider, ability plan.CompiledAbility, payload effectpkg.AnchoredPayload, bag effectpkg.BagChange, now int64, execution AnchoredExecution) *model.EngineError
	// RunPhasedTick 按当前世代真实相位核定执行，不因旧回调期限覆盖续时后的状态事实。
	RunPhasedTick(instance effectpkg.Provider, timing plan.CompiledTargetTiming, fact effectpkg.TimingFact, payload effectpkg.AnchoredPayload, at int64, execution AnchoredExecution) *model.EngineError
	// RunProviderTick 拥有真实周期的来源、资格、门禁短路及续排规则，帧执行和唯一队列在原位置同步交接。
	RunProviderTick(input ProviderTickInput, execution TickExecution) *model.EngineError
	// ShieldDuration 用当前操作已经准备的严格上下文求值正整数期限，不发布或排队。
	ShieldDuration(op plan.CompiledOperation, context formula.GenericEvalContext, now int64) (int64, *model.EngineError)
	// SourceInitializationStart 在初始选择前核对原生来源初始化的声明、零时刻及未使用快照。
	SourceInitializationStart(now int64, snapshot model.Snapshot) (bool, *model.EngineError)
	// SourceInitializationState 在初始选择通过后拒绝恢复旧运行状态，保持原失败先后。
	SourceInitializationState(snapshot model.Snapshot) *model.EngineError
	// StageAnchoredTargetWrite 按原目标写入资格核定全部周期；容量失败早于世代变化，成功后仅追加当前帧计时。
	StageAnchoredTargetWrite(input AnchoredWriteInput, reads StateProviderReads, requests TimingRequests) *model.EngineError
	// StageProviderOperation 拥有效果应用、刷新和移除的同帧分支规则，返回应追加的真实效果操作。
	StageProviderOperation(input ProviderOperationInput, preparation ProviderOperationPreparation) (Mutation, bool, *model.EngineError)
	// StageTargetPhases 只追加本次世代尚未预约的真实相位，先检查真实剩余容量，保留原部分暂存边界。
	StageTargetPhases(instance effectpkg.Provider, slot int, timing plan.CompiledTargetTiming, bag effectpkg.BagChange, after, stop int64, requests TimingRequests) *model.EngineError
	// StageTargetTiming 按本次真实写入重建目标时序世代及到期，必要时同步准备相位周期。
	StageTargetTiming(instance effectpkg.Provider, slot int, timing plan.CompiledTargetTiming, target, key string, value float64, expires, now, stop int64, bag effectpkg.BagChange, requests TimingRequests) *model.EngineError
	// StageUnlinkedShield 按原盾操作顺序准备期限、分配身份并暂存普通盾，不更改关联生命周期子集。
	StageUnlinkedShield(op plan.CompiledOperation, ability plan.CompiledAbility, source, target string, amount float64, instances *effectpkg.InstanceChangeSet, preparation ShieldPreparation) (ShieldExpiry, *model.EngineError)
	// StateDurationActive 先处理惰性到期，再返回是否需要金额求值；不活动期限保持短路。
	StateDurationActive(op plan.CompiledOperation, bag effectpkg.BagChange, now int64) (bool, *model.EngineError)
	// StateOnExpireBinding 核对来源实例、回调字段与当前世代；不将新写入的旧期限当作有效回调。
	StateOnExpireBinding(payload effectpkg.ExpiryPayload, instances effectpkg.ProviderList, bag effectpkg.BagView, now int64) (plan.CompiledProviderStateField, bool)
	// SubtractInternalCooldown 在真实账上减时并返回是否需替换原到期请求。
	SubtractInternalCooldown(op plan.CompiledOperation, id contract.CooldownIdentity, amount float64, ledger *actionpkg.CooldownLedger, now int64) (bool, *model.EngineError)
	// SubtractStateDuration 只更改所属状态袋的期限与到期默认值，返回属性和计时后续阶段所需事实。
	SubtractStateDuration(op plan.CompiledOperation, bag effectpkg.BagChange, amount float64, now int64) (DurationChange, *model.EngineError)
	// TargetRemainingDeadline 只为活动目标计算安全续时期望，保留有效零与缺失的区别。
	TargetRemainingDeadline(op plan.CompiledOperation, current int64, amount float64, now int64) (int64, bool, *model.EngineError)
	// TargetTimingBinding 核对真实永久挂载与有界目标时序槽，陈旧或外国实例不可取得计时资格。
	TargetTimingBinding(instances effectpkg.ProviderList, owner, ref, key string, now int64) (effectpkg.Provider, int, plan.CompiledTargetTiming, bool)
	// TickSchedule 根据实际编译周期能力及生命周期生成间隔和首拍延迟。
	TickSchedule(defIdx uint16) (intervalMs, startDelayMs int64, ok bool)
	// ValidateDurationChange 在读袋及金额求值前检查期限操作，不把未活动期限变成一次求值。
	ValidateDurationChange(op plan.CompiledOperation, provider string) *model.EngineError
	// ValidatePermanentPeriodDefinition 核对永久角色来源的唯一完整纯伤害周期定义，不扩大准入子集。
	ValidatePermanentPeriodDefinition(provider plan.CompiledProvider) *model.EngineError
	// ValidatePermanentPeriods 核对真实永久来源、双方生命、初始状态和全部反向控制引用。
	ValidatePermanentPeriods(snapshot model.Snapshot, owners [2]InitialPeriodicOwner, entries []model.DriverEntry, normalize AbilityReference) *model.EngineError
	// ValidatePermanentPeriodScene 在初始选择前检查永久周期的时间、停止策略及外部事实限制。
	ValidatePermanentPeriodScene(start, duration int64, stopOnDeath, externalFacts bool, snapshot model.Snapshot) *model.EngineError
	// ValidatePermanentResourceFresh 在选择校验前检查永久上限初始化的零时刻及未使用快照。
	ValidatePermanentResourceFresh(now int64, snapshot model.Snapshot) *model.EngineError
	// ValidateStateWrite 在金额求值及状态袋准备前校验状态操作的必要字段。
	ValidateStateWrite(operation plan.CompiledOperation, provider string) *model.EngineError
	// ValidateTargetRemaining 在读取实际目标状态前验证普通整数状态续时的编译声明。
	ValidateTargetRemaining(op plan.CompiledOperation) *model.EngineError
	// ValidateTargetTimingFresh 核对双方目标时序的唯一永久挂载及初始默认状态，不恢复已有世代。
	ValidateTargetTimingFresh(owners [2]InitialEffectOwner) *model.EngineError
	// WriteState 按惰性到期、实际目标、值策略和期限顺序写入借用状态袋；跨行动同步只经有限能力。
	WriteState(input StateWriteInput) (StateWriteResult, *model.EngineError)
}

// Executor 只借用本场固定定义、公式与效果身份账，不持有战斗总状态。
type Executor struct {
	compiled   *plan.CompiledSession
	formulas   *formula.Library
	identities *effectpkg.IdentityRegistry
	sessionID  string
}

// Mutation 是原有同帧效果操作，不具有提交或调度能力。
type Mutation struct {
	Projected       bool
	UseRef          string
	DefinitionIndex uint16
	EvidenceKind    model.EvidenceKind
	Kind            string
	ProviderRef     string
	DefinitionRef   string
	TargetKey       string
	SourceKey       string
	ShieldAmount    float64
	ShieldRef       string
	ShieldPriority  int16
	ExpireAt        int64
	HasExpireAt     bool
	Strict          bool
	Contributions   effectpkg.ContributionView
}

type ProjectedChange struct {
	Instance      effectpkg.Provider
	Kind          model.EvidenceKind
	EnqueueExpiry bool
}

type PreparedLifecycle struct {
	ExpireAt      int64
	HasExpireAt   bool
	Contributions effectpkg.ContributionView
}

// OwnerProjection 只借用当前阶段的所属变更对象，不保存第二套实例或属性快照。
type OwnerProjection struct {
	Key                  string
	Instances            *effectpkg.InstanceChangeSet
	Bags                 *effectpkg.BagChangeSet
	Numbers              *actor.ChangeSet
	Mutations            []Mutation
	ResourceContributors *[]model.ResourceChangeContributor
	Dirty                *bool
}

// ProjectionReads 只在原位置准备应用快照的公式输入，不能执行操作、提交或访问队列。
type ProjectionReads interface {
	// ApplicationContext 借用当前同步阶段的实际双方读值，嵌套读取仍由原帧保护。
	ApplicationContext(source, target string) formula.GenericEvalContext
}

type ProjectionInput struct {
	Owners      [2]OwnerProjection
	Now         int64
	InitialRead bool
	State       *Projection
	Reads       ProjectionReads
	changes     *[]ProjectedChange
}

var _ ExecutorAPI = (*Executor)(nil)

// New 借用本场稳定对象；调用者须保证其存活覆盖本次执行，不复制编译表或身份账。
func New(compiled *plan.CompiledSession, formulas *formula.Library, identities *effectpkg.IdentityRegistry, sessionID string) Executor {
	return Executor{compiled: compiled, formulas: formulas, identities: identities, sessionID: sessionID}
}

func (e *Executor) FindDefinition(key string) (uint16, bool) {
	for index, provider := range e.compiled.Providers {
		if provider.ProviderKey == key {
			return uint16(index), true
		}
	}
	return 0, false
}

func (e *Executor) fail(code model.GenericErrCode, path, message, ref string) *model.EngineError {
	result := model.NewEngineError(model.GenericPhaseRun, code, message)
	result.Path, result.Ref = path, ref
	result.SchemaHash, result.RulesHash, result.SessionID = e.compiled.SchemaHash, e.compiled.RulesHash, e.sessionID
	return &result
}

func (e *Executor) invariant(path, message, ref string) *model.EngineError {
	return e.fail(model.GenericErrRuntimeInvariantFailed, path, message, ref)
}

func (input *ProjectionInput) owner(key string) OwnerProjection {
	for index := range input.Owners {
		if input.Owners[index].Key == key {
			return input.Owners[index]
		}
	}
	return OwnerProjection{}
}

func projectionAttributes(owner OwnerProjection) attribute.Table {
	if owner.Numbers == nil {
		return attribute.Table{}
	}
	return owner.Numbers.Attributes()
}
