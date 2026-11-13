package actionflow

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// AutomaticChoice 保存完整候选遍历后选中的首项及真实最早等待，不包含队列。
type AutomaticChoice struct {
	Rule   *actionpkg.AutomaticRuleView
	NextAt int64
}

// AutomaticCandidates 只借用当前候选读值和等待观察；不能开始行动或改动队列。
type AutomaticCandidates interface {
	// EvaluateAutomatic 依原位置准备该候选入口并返回真实拒绝或等待；不消费前序资格。
	EvaluateAutomatic(rule *actionpkg.AutomaticRuleView) (string, []string, int64, *model.EngineError)
	// ObserveAutomaticWait 观察该候选实际等待，不改变计算资格或候选原序。
	ObserveAutomaticWait(rule *actionpkg.AutomaticRuleView, reason string, related []string, at int64)
}

// ManualActionPhases 只提供手动行动的实际读值、尝试记账与同步过程控制。
type ManualActionPhases interface {
	// BeginManualAttempt 在原位置重置本事件命令计数并记录能力尝试。
	BeginManualAttempt(action *actionpkg.SkillActionView)
	// ManualTargetAlive 查询此刻真实目标生命值，不复用开始前的值。
	ManualTargetAlive(target string) bool
	// RunManualControl 经原过程入口执行当前已绑定控制，不预先接受使用。
	RunManualControl(entry model.DriverEntry, ability planbundle.CompiledAbility) *model.EngineError
	// FinishManualAttempt 记录本次真实结果并清理临时过程事实，失败保留已发生的提交。
	FinishManualAttempt(err *model.EngineError)
}

// SkillActionExecutorAPI 列出有限行动与自动候选的真实执行能力。
type SkillActionExecutorAPI interface {
	// RunManual 按真实父行动资格和当前目标执行一条手动控制，结束时清除当前行动。
	RunManual(index int, now int64, phases ManualActionPhases) *model.EngineError
	// ChooseAutomatic 完整遍历全部候选并登记每项等待，再返回首个可用候选和最早期限。
	// 冷却账由根层在原位置取得可写副本，方法本身不入队、不消费释放资格。
	ChooseAutomatic(now int64, ledger *actionpkg.CooldownLedger, candidates AutomaticCandidates) (AutomaticChoice, *model.EngineError)
	// Candidate 按原顺序核对前序资格、全部冷却、有效过程、占用、库存和作者付款前条件。
	Candidate(rule *actionpkg.AutomaticRuleView, now int64, ledger *actionpkg.CooldownLedger, reads AutomaticReads) (string, []string, int64, *model.EngineError)
	// PlannedSources 借用有限手动来源或构造自动来源投影，仅供初始化与准入阶段使用。
	PlannedSources() []*actionpkg.SkillActionView
	// BindBasicAmmo 使原普攻库存使用实际选中的能力及目标。
	BindBasicAmmo(ammo *actionpkg.AmmoView)
	// FindAmmo 按实际拥有者、挂载和状态键查找唯一共享库存。
	FindAmmo(owner, provider, key string) *actionpkg.AmmoView
	// InitializePlannedAmmo 按实际来源登记共用库存，不创建第二个回充或时钟。
	InitializePlannedAmmo()
	// InitializeDrivenAmmo 按登记原序启动实际缺少库存的回充，保留各帧提交边界。
	InitializeDrivenAmmo(phases AmmoPhases) *model.EngineError
	// RecoverAmmo 核对完整原队列身份后执行一次真实回充帧。
	RecoverAmmo(event AmmoRecoveryEvent, now int64, phases AmmoPhases) *model.EngineError
	// PrepareInitialAmmo 在当前库存帧核对初始完整区间并暂存首次等待。
	PrepareInitialAmmo(ammo *actionpkg.AmmoView, now int64, work AmmoWork) (bool, *model.EngineError)
	// PrepareAmmoRecovery 仅在未有实际回充时读取完整时长并暂存下一真实期限。
	PrepareAmmoRecovery(ammo *actionpkg.AmmoView, ability planbundle.CompiledAbility, initialRemaining, now int64, work AmmoWork) *model.EngineError
	// PrepareRecoveredAmmo 在实际回充帧内恢复库存、刷新属性并按需安排下一段等待。
	PrepareRecoveredAmmo(ammo *actionpkg.AmmoView, now int64, work AmmoWork) (bool, *model.EngineError)
	// PlannedAmmoReady 核对主动候选和付款帧当前实际库存，不消费回充或弹药。
	PlannedAmmoReady(owner, providerRef string, ability planbundle.CompiledAbility, work AmmoWork) (bool, int64, *model.EngineError)
	// BasicAmmoReady 核对真实普攻库存，仅在尚无回充时准备原首次等待。
	BasicAmmoReady(ammo *actionpkg.AmmoView, now int64, work AmmoWork) (bool, bool, *model.EngineError)
	// ValidateAmmoConsumption 核对原使用、挂载、过程、状态和唯一扣弹结果，不登记伪造使用。
	ValidateAmmoConsumption(input AmmoConsumption, operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, work AmmoWork) *model.EngineError
	// SubtractAmmoDuration 只修改实际活动回充的剩余时间并推进世代，金额失败保留原等待。
	SubtractAmmoDuration(ammo *actionpkg.AmmoView, operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, now int64, work AmmoWork) *model.EngineError
	// CompileDriverConditions 将本次驱动的条件和重复间隔编译进独立运行公式表，不改共享计划。
	CompileDriverConditions(entries []model.DriverEntry, registry *formula.Builder, refsByAbility map[string]planbundle.CompiledAbilityRef) *model.EngineError
	// InitializeManual 核对完整手动计划与不可变绑定，登记真实行动并核验选中来源。
	InitializeManual(input SkillAdmission, bindings []planbundle.CompiledSkillActionBinding, checks SkillAdmissionChecks) *model.EngineError
	// InitializeAutomatic 核对完整自动规则、冷却引用和唯一前序关系，登记真实来源。
	InitializeAutomatic(input SkillAdmission, bindings []planbundle.CompiledSkillActionBinding, checks SkillAdmissionChecks) *model.EngineError
	// RecastCandidate 检查当前真实窗口、占用、挂载与作者条件，不消费普通冷却或前序资格。
	RecastCandidate(r *actionpkg.AutomaticRuleView, p *actionpkg.ProcessView, now int64, reads RecastReads) (string, []string, int64, *model.EngineError)
	// PlannedProvider 判断实际拥有者及挂载是否已由当前行动来源选中。
	PlannedProvider(owner, provider string) bool
	// PlannedOperation 判断操作定义是否属于实际选中的行动来源。
	PlannedOperation(providerIndex int) bool
	// ValidateSource 核对完整静态行动来源、实际绑定能力、监听和全部合法操作位置。
	ValidateSource(owner, providerRef string, providerIndex uint16, listeners []planbundle.CompiledListener, operations []planbundle.CompiledOperation, startedType planbundle.DeclaredType, checks PlannedSourceChecks) *model.EngineError
	// AttributeOperationPosition 核对属性操作实际属于普通过程或即时命中结果。
	AttributeOperationPosition(provider planbundle.CompiledProvider, index int, operations []planbundle.CompiledOperation) bool
	// RunAutomatic 完整选择全部候选后执行首项真实控制，保留接受和前序资格的原提交边界。
	RunAutomatic(generation uint64, now int64, dispatch AutomaticDispatch, candidates AutomaticCandidates) *model.EngineError
	// RunAutomaticRecast 在真实已接受窗口下构造一次重施控制，不生成新的首次资格。
	RunAutomaticRecast(rule *actionpkg.AutomaticRuleView, process *actionpkg.ProcessView, now int64, dispatch AutomaticDispatch) *model.EngineError
	// PublishStart 在首次真实过程提交后接受行动并登记其完整使用身份。
	PublishStart(process *actionpkg.ProcessView, observer SkillActionObserver)
	// PublishFinish 仅记录实际接受过程的首次终结，保留自动资格的原归属。
	PublishFinish(process *actionpkg.ProcessView, observer SkillActionObserver)
	// PublishControl 记录已经提交的实际后续控制及重施使用，不提前接受请求。
	PublishControl(process *actionpkg.ProcessView, abilityRef string, observer SkillActionObserver)
	// PublishMoment 在原提交边界累计步骤、释放资格和真实绑定阶段事实。
	PublishMoment(process *actionpkg.ProcessView, kind string, now int64, observer SkillActionObserver)
	// RecordUse 生成实际使用阶段记录，记录容量不改变真实行动状态。
	RecordUse(process *actionpkg.ProcessView, kind string, hit, reason *string, now int64, records SkillUseRecords)
	// ResolveMoment 在时点提交后按原绑定次序执行真实接触并记录实际完成状态。
	ResolveMoment(process *actionpkg.ProcessView, kind string, phases SkillHitPhases) *model.EngineError
	// ValidateDeadline 在原预检位置核对实际计划步骤、分段和冷却的安全整数期限。
	ValidateDeadline(process *actionpkg.ProcessView, cooldownReady int64) *model.EngineError
	// AttemptGate 按实际双方、能力、冷却、资源和作者条件的原次序完成一次门禁。
	AttemptGate(entry model.DriverEntry, index int, now, recheck int64, reads GateReads) GateResult
	// ResourceGate 对准备完成的付款前上下文核对原资源成本与条件重查等待。
	ResourceGate(ability planbundle.CompiledAbility, ref string, now, recheck int64, current float64, context formula.GenericEvalContext, registry *formula.Library, failures GateFormulaErrors) (int64, bool, *model.EngineError)
	// SeedDrivers 按作者原序请求首次和固定间隔的有限尝试，不自行持有队列。
	SeedDrivers(entries []model.DriverEntry, timing DriverTiming, maxEvents int, schedules DriverSchedules)
	// Attempt 核对原等待版本后执行一项真实驱动，保留门禁、记录和重复安排的原顺序。
	Attempt(event DriverAttempt, entries []model.DriverEntry, timing DriverTiming, phases DriverAttemptPhases, schedules DriverSchedules) *model.EngineError
	// ScheduleDynamicRepeat 在实际尝试之后按当前真实视图核定下一次动态间隔。
	ScheduleDynamicRepeat(entry model.DriverEntry, entryIndex, attemptIndex int, timing DriverTiming, schedules DriverSchedules) *model.EngineError
	// PrepareCast 按原次序核对引用、来源限制、冷却及操作范围，只返回本次有限施放决定。
	// 根层用原局部同步参数立即执行，不将帧、事件或复制收集器保存到决定内。
	PrepareCast(request AbilityCastRequest, definitions AbilityCastDefinitions, reads AbilityCastReads) (PreparedAbility, *model.EngineError)
	// PrepareListenerCast 保留监听先冷却、后引用及用途核对的原顺序，不接纳或消费额度。
	PrepareListenerCast(request AbilityCastRequest, definitions AbilityCastDefinitions, reads AbilityCastReads) (PreparedAbility, *model.EngineError)
	// StageAbilityTerms 先读并暂存普通费用，再读冷却并沿原截断规则暂存期限。
	// 周期与锚定普通帧也使用同一政策；不采用过程费用、倍率或严格时间政策。
	StageAbilityTerms(ability planbundle.CompiledAbility, owner, ref string, now int64, work AbilityTermsWork) *model.EngineError
	// ExecuteAbilityFrame 在同一独立能力帧暂存费用冷却、原位分配身份并同步执行实际操作。
	ExecuteAbilityFrame(prepared PreparedAbility, now int64, work AbilityFrameWork) *model.EngineError
	// ValidateRefundSnapshot 完整核对即时周期及返还来源需要的真实全新快照，不接受导入冷却来源。
	ValidateRefundSnapshot(snapshot model.Snapshot, hasRefund bool) *model.EngineError
	// ValidateImmediatePeriod 核对即时有限周期由本次实际选中的来源过程首次启动。
	ValidateImmediatePeriod(operation planbundle.CompiledOperation, process *actionpkg.ProcessView, moment, owner, provider, expectedTarget string, enabled bool) *model.EngineError
	// BindImmediatePeriod 在真实已提交实例中找到原激活来源，并仅返回该实例的使用绑定变更。
	BindImmediatePeriod(owner, source, definition, use string, now int64, instances effectpkg.ProviderList) (effectpkg.Provider, int, bool)
	// ApplyTotalCooldownRefund 只按真实结算包和已提交普通总冷却计算返还并暂存新期限。
	ApplyTotalCooldownRefund(operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, mounted bool, event *contract.EventSnapshot, owner string, now int64, work CooldownRefundWork) *model.EngineError
	// PrepareCooldownWake 核对首次自动资格并建立当前唤醒计划；不借用遍历回调或持有当前帧。
	PrepareCooldownWake(process *actionpkg.ProcessView, isNew bool) (CooldownWakePlan, *model.EngineError)
	// AccumulateCooldownWake 按调用方原拥有者顺序累计单个账本的变化等待，保留完整身份且不复制账本。
	// 仅实际新增驱动等待时扩展原结果切片，方法不保存输入或创建遍历闭包。
	AccumulateCooldownWake(plan CooldownWakePlan, waits []actionpkg.CooldownWait, attackHandled, actorsAlive bool, entries []model.DriverEntry) CooldownWakePlan
	// AcceptedCastStart 核对原开始事件、完整已接受使用、首次根行动和当前控制的全部身份及时点。
	AcceptedCastStart(ev PlannedCastStart, now int64, bindings []planbundle.CompiledSkillActionBinding, uses PlannedCastUses) bool
	// ConditionGate 按原驱动条件在先、实际能力条件在后的短路次序完成一次尝试条件。
	ConditionGate(index int, ability planbundle.CompiledAbility, reads GateConditions) (bool, *model.EngineError)
	// ApplyCooldown 按实际操作策略核定原冷却、金额和安全期限，全部写入仍沿本帧暂存。
	ApplyCooldown(input CooldownOperationInput, operation planbundle.CompiledOperation, ability planbundle.CompiledAbility, now int64, work CooldownOperationWork) *model.EngineError
	// RecordCommittedHit 仅对真实已接受使用累计命中并保存原帧提交的实际序号、发生身份和阻挡事实。
	RecordCommittedHit(key string, actual *actionpkg.UseView, hitFact CommittedSkillHit, observer SkillActionObserver)
	// PublishAmmoWait 发布本库存所属的唯一等待并投影实际普攻记录，返回是否需交原队列安排回充。
	PublishAmmoWait(ammo *actionpkg.AmmoView, wait actionpkg.AmmoWait, alive bool) bool
}

// SkillActionExecutor 借用所属行动状态和只读能力定义，局部遍历不保存当前帧。
type SkillActionExecutor struct {
	actions   *actionpkg.State
	abilities []planbundle.CompiledAbility
	providers []planbundle.CompiledProvider
	identity  Identity
}

var _ SkillActionExecutorAPI = (*SkillActionExecutor)(nil)

// NewSkillActionExecutor 组合本场行动与必要只读计划，不接收完整执行计划或执行器。
func NewSkillActionExecutor(actions *actionpkg.State, abilities []planbundle.CompiledAbility, providers []planbundle.CompiledProvider, identity Identity) SkillActionExecutor {
	return SkillActionExecutor{actions: actions, abilities: abilities, providers: providers, identity: identity}
}

func (s SkillActionExecutor) RunManual(index int, now int64, phases ManualActionPhases) *model.EngineError {
	if index < 0 || index >= s.actions.ManualCount() {
		return s.error("unknown skill instruction event", "driverPlan.skillActions")
	}
	action := s.actions.ManualAt(index)
	s.actions.SetCurrentAction(action)
	defer func() { s.actions.SetCurrentAction(nil) }()
	s.actions.Reached(action)
	phases.BeginManualAttempt(action)
	entry := model.DriverEntry{EntryKey: action.Plan().InstructionKey(), AbilityRef: action.Plan().AbilityRef(), Source: action.Plan().Source(), Target: action.Plan().Target(), FirstAtMs: now}
	s.actions.SetProcessFact(entry.EntryKey, model.ProcessCommandFact{DriverEntryKey: entry.EntryKey, UseRef: action.UseRef()})
	ability := s.abilities[action.ControlAbilityIndex()]
	if action.ParentIndex() >= 0 && !s.actions.ManualAt(action.ParentIndex()).Accepted() {
		s.actions.Reject(action, "parent_not_accepted")
	} else if !phases.ManualTargetAlive(action.Plan().Target()) {
		s.actions.Reject(action, "target_unavailable")
	} else {
		if err := phases.RunManualControl(entry, ability); err != nil {
			phases.FinishManualAttempt(err)
			return err
		}
	}
	phases.FinishManualAttempt(nil)
	return nil
}

func (s SkillActionExecutor) ChooseAutomatic(now int64, ledger *actionpkg.CooldownLedger, candidates AutomaticCandidates) (AutomaticChoice, *model.EngineError) {
	choice := AutomaticChoice{}
	for index := 0; index < s.actions.AutomaticCount(); index++ {
		rule := s.actions.AutomaticAt(index)
		reason, related, at, err := candidates.EvaluateAutomatic(rule)
		if err != nil {
			return AutomaticChoice{}, err
		}
		if reason == "" && choice.Rule == nil {
			choice.Rule = rule
		}
		key := actionpkg.CooldownWaitKey{Kind: "automatic", Owner: model.SelectorSource, Key: rule.Plan().RuleKey()}
		if at > now {
			notBefore := int64(0)
			if reason == model.AutomaticWaitActionOccupied || reason == model.AutomaticWaitProcessActive {
				notBefore = at
			}
			if s.providers[s.abilities[rule.ControlIndex()].ProviderIndex].AmmoBinding != nil {
				notBefore = at
			}
			recast := rule.RecastWindow() != nil && rule.RecastWindow().Status() == "active"
			if recast {
				notBefore = at
			}
			wait := s.actions.RegisterAutomaticWait(rule, ledger, notBefore, now, recast)
			at = wait.ReadyAt
			if choice.NextAt == 0 || wait.ReadyAt < choice.NextAt {
				choice.NextAt = wait.ReadyAt
			}
		} else {
			ledger.CancelWait(key)
		}
		candidates.ObserveAutomaticWait(rule, reason, related, at)
	}
	return choice, nil
}

func (s SkillActionExecutor) error(message, path string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message)
	err.Path = path
	err.SchemaHash, err.RulesHash, err.SessionID = s.identity.SchemaHash, s.identity.RulesHash, s.identity.SessionID
	return &err
}
