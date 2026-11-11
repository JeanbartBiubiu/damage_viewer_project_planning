package actionflow

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

// BasicAttackPhases 只提供一刀的真实使用、命中帧和已提交观察，不负责准入或预算。
type BasicAttackPhases interface {
	// BeginNativeAttack 发布真实开始使用及同步监听，返回该刀真实命中入口身份。
	BeginNativeAttack() (string, *model.EngineError)
	// ExecuteNativeHit 在原位置记录尝试并执行实际命中帧，返回真实帧或过程失败。
	ExecuteNativeHit(entry model.DriverEntry) *model.EngineError
	// NativeAttackActorsAlive 在实际命中后读取双方生命值，不使用旧冻结生命判断下一刀。
	NativeAttackActorsAlive(source, target string) bool
	// FinishNativeAttackRecord 在本次同步尾部观察并替换已有攻击记录，不影响计算。
	FinishNativeAttackRecord()
	// PublishNativeAttackWait 在真实完整命中后投影共享等待，队列仍由根层统一处理。
	PublishNativeAttackWait()
}

// BasicAttackExecutorAPI 列出已准入普通攻击的实际单刀执行能力。
type BasicAttackExecutorAPI interface {
	// Execute 在根层准入、资源与攻击预算核对之后执行真实开始、命中和尾部。
	// 失败保留已提交事实，始终结束本刀累计范围并观察最终记录。
	Execute(now int64, phases BasicAttackPhases) *model.EngineError
	// Begin 登记真实一刀并同步完成原开始过程，复核冷却等待和当前生命后预留强化。
	Begin(now int64, speed float64, initializationPending int, phases NativeAttackStart) (string, string, *model.EngineError)
	// PrepareWait 核对原进度、共用库存和所有占用后登记唯一等待，返回原队列预检需求。
	PrepareWait(now int64, input AttackWaitInput, original, pending *actionpkg.ProcessView, work AttackWaitWork) (AttackWaitResult, *model.EngineError)
	// PrepareWaitProgress 按原读取与命令消费位置核对实际攻速、依赖变化和剩余周期。
	PrepareWaitProgress(now int64, input AttackWaitInput, work AttackWaitWork) (AttackWaitResult, *model.EngineError)
	// Initialize 核对完整普攻、实际来源和唯一开始监听后建立所属行动状态。
	Initialize(input SkillAdmission, stopOnTargetDeath bool, definitions AttackDefinitions, registry *formula.Library, skills SkillActionExecutor, checks AttackAdmissionChecks) *model.EngineError
	// Contribution 读取真实窗口内全部占用的最晚释放时刻及存在性。
	Contribution(start, end int64) *int64
	// RefreshContributions 按真实首次控制时刻和原保留记录顺序更新占用贡献。
	RefreshContributions(now int64, records AttackOccupancyRecords)
	// CaptureStartState 在实际接纳后且开始监听前完整核定原使用捕获；未启用时不读取或分配。
	CaptureStartState(enabled bool, source string, use *actionpkg.UseView, captured bool, combatants []planbundle.CompiledCombatant, providers []planbundle.CompiledProvider, reads StartStateReads) (AttackCapture, *model.EngineError)
	// StartStateContext 只向同一真实普攻使用和来源的开始或命中公式借用已拥有的捕获。
	StartStateContext(enabled bool, event *contract.EventSnapshot, owner, provider string, use *actionpkg.UseView, captured *AttackCapture) []formula.ProviderStateBeforeValue
	// Admit 按原初始化、双方生命、占用、库存和攻速顺序核对本刀，攻击预算仍由根层核对。
	Admit(initializationPending int, reads AttackReadiness) (bool, *model.EngineError)
	// NextTime 取本刀真实占用、普通冷却及缺弹回充的最晚期限。
	NextTime(now int64, reads AttackTimelineReads) int64
	// EventCurrent 以完整唯一等待、期限和世代核对本次普攻队列事件。
	EventCurrent(at, next int64, generation uint64, ledger *actionpkg.CooldownLedger) bool
	// PublishWait 投影已提交等待与原终止口径，返回是否需要更新现有保留记录。
	PublishWait(input AttackWaitPublication) bool
	// PreviewProviders 在独立等待预览内按原序处理未投影效果与属性宿主，不改变父命令或发布。
	PreviewProviders(now int64, providers []planbundle.CompiledProvider, work AttackProviderPreview) *model.EngineError
	// InitialWait 核对当前真实普攻使用的首次冷却并冻结其完整等待种子，未命中资格时不读视图。
	InitialWait(process *actionpkg.ProcessView, ready, now int64, reads InitialAttackWaitReads) (*actionpkg.AttackWaitView, *model.EngineError)
}

// BasicAttackExecutor 借用普通攻击所属状态，当前使用和记录仍只由行动状态持有。
type BasicAttackExecutor struct {
	actions  *actionpkg.State
	identity Identity
}

var _ BasicAttackExecutorAPI = (*BasicAttackExecutor)(nil)

// NewBasicAttackExecutor 组合本场普通攻击状态与错误身份，不建立第二个等待或计时账。
func NewBasicAttackExecutor(actions *actionpkg.State, identity Identity) BasicAttackExecutor {
	return BasicAttackExecutor{actions: actions, identity: identity}
}

func (s BasicAttackExecutor) Execute(now int64, phases BasicAttackPhases) *model.EngineError {
	attack := s.actions.BasicAttack()
	if attack == nil {
		return s.error("basic attack event has no plan", "driverPlan.basicAttack")
	}
	s.actions.SetAttackActive(true)
	defer finishNativeAttack(s.actions, phases)
	hitKey, err := phases.BeginNativeAttack()
	if err != nil {
		return err
	}
	entry := model.DriverEntry{EntryKey: hitKey, AbilityRef: attack.Plan().HitAbilityRef, Source: attack.Plan().Source, Target: attack.Plan().Target, FirstAtMs: now}
	if err := phases.ExecuteNativeHit(entry); err != nil {
		return err
	}
	if attack.Current().HitAtMs() == nil {
		return s.error("native hit did not consume a real hit fact", attack.Plan().HitAbilityRef)
	}
	s.actions.CompleteAttack()
	if attack.TargetKilledAt() != nil || !phases.NativeAttackActorsAlive(attack.Plan().Source, attack.Plan().Target) {
		return nil
	}
	phases.PublishNativeAttackWait()
	return nil
}

func finishNativeAttack(actions *actionpkg.State, phases BasicAttackPhases) {
	actions.SetAttackActive(false)
	phases.FinishNativeAttackRecord()
}

func (s BasicAttackExecutor) error(message, path string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message)
	err.Path = path
	err.SchemaHash, err.RulesHash, err.SessionID = s.identity.SchemaHash, s.identity.RulesHash, s.identity.SessionID
	return &err
}
