// Package actionflow 执行普通攻击、技能行动和过程推进，不拥有时钟或统一提交。
package actionflow

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

const maxJSONSafeInteger int64 = 9007199254740991

// Identity 指定本场行动错误的真实归属，不包含执行器或帧。
type Identity struct{ SchemaHash, RulesHash, SessionID string }

// ProcessMoment 是行动内部生成并消费的有限过程时点，不向根适配暴露步骤规则。
// 时点后的命中解析与终结观察仍在原提交边界执行，不承诺跨阶段回滚。
type ProcessMoment struct {
	kind         string
	reason       string
	castRef      string
	finishStatus string
	enterStep    bool
	stepIndex    int
	resolveHits  bool
}

// ProcessTimer 是唯一队列交付的过程计时身份，时刻由本次调用明确提供。
type ProcessTimer struct{ Index, StepVersion, ExecutionIndex int }

// ProcessPhases 只提供过程所需的同步帧和完成事实交接，不提供队列或可写总状态。
type ProcessPhases interface {
	// CommitProcessMoment 在当前调用独立准备原过程帧，执行请求并按原顺序提交和派发。
	// 嵌套调用必须使用各自的局部帧；返回错误时保留原有已发布事实。
	CommitProcessMoment(process *actionpkg.ProcessView, moment ProcessMoment) (ActionResult, *model.EngineError)
	// PublishProcessResolved 在全部绑定命中之后发布真实终结事实，不重新执行过程。
	PublishProcessResolved(process *actionpkg.ProcessView) *model.EngineError
	// FinishEmpoweredWindow 沿原路径结算已计数的强化等待窗口，不模拟普通时点。
	FinishEmpoweredWindow(process *actionpkg.ProcessView) *model.EngineError
}

// ProcessAmounts 只借用当前过程阶段的公式读值；读取不发布状态，错误保留原公式归属。
type ProcessAmounts interface {
	// ProcessAmount 使用当前过程能力和同一暂存视图读取指定的已编译公式。
	ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError)
}

// ProcessExecutorAPI 列出过程实际推进与当前阶段的准备能力。
type ProcessExecutorAPI interface {
	// EnterStep 按原序同步执行即时步骤，已提交时点之后重新检查真实活动状态。
	EnterStep(process *actionpkg.ProcessView, index int, now int64, phases ProcessPhases) *model.EngineError
	// CompleteStep 先完成当前步骤，再按真实活动状态进入下一步骤。
	CompleteStep(process *actionpkg.ProcessView, now int64, phases ProcessPhases) *model.EngineError
	// Moment 在一个原时点帧成功提交后解析真实绑定命中，不缓存当前帧。
	Moment(process *actionpkg.ProcessView, kind, reason string, phases ProcessPhases) *model.EngineError
	// Finish 仅终结活动过程；提交与命中成功后才发布成功完成事实。
	Finish(process *actionpkg.ProcessView, status, reason, castRef string, phases ProcessPhases) *model.EngineError
	// HandleTimer 核对完整过程槽、步骤和执行序号；已失效计时静默跳过，非法槽报原错误。
	HandleTimer(timer ProcessTimer, now int64, phases ProcessPhases) *model.EngineError
	// RunRepeat 执行实际下一分段，时点后重新核对状态和完整期限。
	RunRepeat(process *actionpkg.ProcessView, now int64, phases ProcessPhases) *model.EngineError
	// PrepareStep 在所属过程变更内准备步骤和冻结时间，不发布、不入队。
	PrepareStep(changes *actionpkg.ProcessChangeSet, index int, now int64, amounts ProcessAmounts) (bool, *model.EngineError)
	// PrepareRepeat 按原读值顺序冻结有限分段与完整窗口，失败只保留本阶段暂存。
	PrepareRepeat(changes *actionpkg.ProcessChangeSet, step planbundle.CompiledProcessStep, now int64, amounts ProcessAmounts) *model.EngineError
	// AdvanceRepeat 仅推进该阶段实际到达的下一分段，返回是否需要原计时请求。
	AdvanceRepeat(changes *actionpkg.ProcessChangeSet, now int64) (bool, *model.EngineError)
	// Restore 核对完整过程身份、冻结进度、成本与占用历史，成功后创建所属行动过程。
	Restore(row model.ProcessInstanceSnapshot, path string, now int64, plan ProcessRestorePlan, facts ProcessRestoreFacts) (*actionpkg.ProcessView, *model.EngineError)
	// ValidateRestoredProgress 核对恢复步骤中实际已提交的执行和完成进度。
	ValidateRestoredProgress(row model.ProcessInstanceSnapshot, definition *planbundle.CompiledProcess, stepIndex int, path string, now int64) *model.EngineError
	// ValidateRestoredRepeat 核对冻结完整窗口、分段序号和下一真实时刻，不重算作者公式。
	ValidateRestoredRepeat(row model.ProcessInstanceSnapshot, step planbundle.CompiledProcessStep, path string, now int64) *model.EngineError
	// ValidateRestoredOccupancies 核对全部实际进入步骤的占用区间及当前开放许可。
	ValidateRestoredOccupancies(process *actionpkg.ProcessView, path string, now int64) *model.EngineError
	// PrepareCosts 先用同一付款前视图求值并核对全部成本；pay为true时才暂存实际付款。
	PrepareCosts(changes *actionpkg.ProcessChangeSet, costs ProcessCosts, pay bool) (bool, *model.EngineError)
	// ApplyMoment 在所属变更与同一时点暂存内执行冷却、操作和有限分段规则，不发布状态。
	ApplyMoment(changes *actionpkg.ProcessChangeSet, kind, reason string, now int64, alreadyCommitted bool, operations []planbundle.CompiledOperation, work ProcessMomentWork) *model.EngineError
	// ExecuteMoment 完整消费内部时点，在同一暂存执行准备、提交、结束观察及命中尾部。
	// 只有明确控制施放且本次已提交时接纳；提交后的失败保留真实接纳前缀。
	ExecuteMoment(process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, moment ProcessMoment, now int64, operations []planbundle.CompiledOperation, work ProcessStageWork) (ActionResult, *model.EngineError)
	// ExecuteRecastAcceptance 在本帧暂存真实重施身份和原期限，提交后才派发开始。
	ExecuteRecastAcceptance(process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, ability planbundle.CompiledAbility, ref, use string, advance, now int64, work ProcessStageWork) (ActionResult, *model.EngineError)
	// ExecuteRecastExecution 在接纳与开始监听后的新帧执行重施负载，不重复统计过程时点。
	ExecuteRecastExecution(process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, now int64, operations []planbundle.CompiledOperation, work ProcessStageWork) *model.EngineError
	// ExecuteChargeRelease 执行原蓄力释放、提交、命中及后继步骤，保留同次接纳前缀。
	ExecuteChargeRelease(process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, ref string, now int64, operations []planbundle.CompiledOperation, work ProcessStageWork, phases ProcessPhases) (ActionResult, *model.EngineError)
	// InitialProcess 构造新过程的默认不变量及已核对强化绑定，不登记、发布或借用帧。
	InitialProcess(input ProcessStartInput) *actionpkg.ProcessView
	// StageCooldown 沿原顺序暂存冷却、保存普通总冷却来源，再准备当前普攻的首次等待。
	// 返回的等待交由原帧暂存，任何失败均不发布所属账本。
	StageCooldown(process *actionpkg.ProcessView, ready, now int64, work ProcessCooldownWork) (*actionpkg.AttackWaitView, *model.EngineError)
	// StartPrepared 完整执行同一启动帧的条件、库存、全部成本、付款、提交及两次活动核对。
	// 驱动与槽位按当前调用显式传递，工作能力只借用该次原帧，不保存同步上下文。
	StartPrepared(entry model.DriverEntry, entryIndex int, process *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, replaced *actionpkg.ProcessView, now int64, work ProcessStartWork, phases ProcessPhases) (ActionResult, *model.EngineError)
	// Control 按实际使用、挂载、过程步骤、死亡、占用和时窗核对一次控制并进入真实阶段。
	Control(entry model.DriverEntry, entryIndex int, controlAbility planbundle.CompiledAbility, resolvedRef string, now int64, providers []planbundle.CompiledProvider, work ProcessControlWork, phases ProcessPhases) (ActionResult, *model.EngineError)
	// BoundFiniteRecastInitial 核对当前未接纳首次行动的全部真实绑定与原使用归属。
	BoundFiniteRecastInitial(entry model.DriverEntry, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, now int64, bindings []planbundle.CompiledSkillActionBinding, abilities []planbundle.CompiledAbility, providers []planbundle.CompiledProvider) bool
	// AcceptRecast 先接纳真实使用和原期限，再在开始监听之后执行负载和必要的实际步骤完成。
	AcceptRecast(entry model.DriverEntry, p *actionpkg.ProcessView, ability planbundle.CompiledAbility, ref string, now int64, phases RecastPhases, processPhases ProcessPhases) (ActionResult, *model.EngineError)
	// Initialize 核对原驱动和过程控制事实、恢复全部合法过程后按原序请求实际计时。
	Initialize(input ProcessInitialInput, plan ProcessRestorePlan, restore ProcessRestoreFacts, checks ProcessInitialChecks) *model.EngineError
	// PrepareOccupancy 根据实际步骤前后状态暂存完整占用历史并返回普攻等待是否需调整。
	PrepareOccupancy(changes *actionpkg.ProcessChangeSet, original *actionpkg.ProcessView, now int64) (bool, *model.EngineError)
	// Condition 按原驱动条件和能力条件顺序读同一个独立条件视图。
	Condition(entryIndex int, ability planbundle.CompiledAbility, values ProcessConditions) (bool, *model.EngineError)
	// IsAttackReset 核对跨过程操作是否属于本拥有者实际选中普攻的明确首次重置。
	IsAttackReset(process *actionpkg.ProcessView, kind string, operation planbundle.CompiledOperation, registry *formula.Library, references map[string]planbundle.CompiledAbilityRef, abilities []planbundle.CompiledAbility) bool
	// FailDeadProcesses 冻结真实死亡实例并按原稳定顺序终结，保留同步失败效果和重入语义。
	FailDeadProcesses(deaths ProcessDeaths, phases ProcessPhases) *model.EngineError
	// PublishResolved 在全部实际绑定命中后核对原完整使用历史并发布一次真实终结事实。
	PublishResolved(process *actionpkg.ProcessView, declared bool, completion ProcessCompletion) *model.EngineError
	// PrepareNativeProcess 核对真实普攻开始事实、完整使用与当前过程集合，只返回原启动或普通拒绝决定。
	// 根层保留原同步深度及复制收集器的局部参数，不将其装入接口适配对象或计时。
	PrepareNativeProcess(input NativeProcessStart, ability planbundle.CompiledAbility, providers []planbundle.CompiledProvider, reads NativeProcessReads) (PreparedNativeProcess, *model.EngineError)
	// PreparePassiveProcess核对当前原生命中及实际来源，创建未发布独立实例；不登记主动使用或计费。
	PreparePassiveProcess(input PassiveProcessStart, ability planbundle.CompiledAbility, operation planbundle.CompiledOperation, providers []planbundle.CompiledProvider, reads NativeProcessReads) (*actionpkg.ProcessView, *model.EngineError)
	// RequireAttackProcess 完整遍历实际过程，核对本次普攻命中依附其原成功开始使用。
	RequireAttackProcess(ability planbundle.CompiledAbility, skill, use, ref, source, target, driver string, now int64, providers []planbundle.CompiledProvider, abilities []planbundle.CompiledAbility) *model.EngineError
	// CaptureStartState 在原启动位置核对强化使用与全部显式安全整数，失败不保存部分捕获。
	CaptureStartState(process *actionpkg.ProcessView, owner, provider string, reads StartStateReads) ([]formula.ProcessStartStateValue, *model.EngineError)
}

// ProcessExecutor 借用所属行动状态，过程循环和每次调用的局部阶段均由本对象执行。
type ProcessExecutor struct {
	actions  *actionpkg.State
	identity Identity
}

var _ ProcessExecutorAPI = (*ProcessExecutor)(nil)

// NewProcessExecutor 组合本场所属状态与错误身份，不取得时钟或其他执行能力。
func NewProcessExecutor(actions *actionpkg.State, identity Identity) ProcessExecutor {
	return ProcessExecutor{actions: actions, identity: identity}
}

func (s ProcessExecutor) EnterStep(process *actionpkg.ProcessView, index int, now int64, phases ProcessPhases) *model.EngineError {
	for process.Status() == "active" {
		if index >= len(process.Definition().Steps) {
			return s.Finish(process, "complete", "", "", phases)
		}
		step := process.Definition().Steps[index]
		if _, err := phases.CommitProcessMoment(process, ProcessMoment{kind: "STEP_START", enterStep: true, stepIndex: index}); err != nil {
			return err
		}
		if process.Status() != "active" {
			return nil
		}
		if process.HasRepeat() {
			if process.HasNextExecution() && process.NextExecutionAt() == now {
				return s.RunRepeat(process, now, phases)
			}
			return nil
		}
		if step.StepType != "IMMEDIATE" {
			return nil
		}
		if err := s.Moment(process, "STEP_EXECUTION", "", phases); err != nil {
			return err
		}
		if process.Status() != "active" {
			return nil
		}
		if err := s.Moment(process, "STEP_COMPLETE", "", phases); err != nil {
			return err
		}
		index++
	}
	return nil
}

func (s ProcessExecutor) CompleteStep(process *actionpkg.ProcessView, now int64, phases ProcessPhases) *model.EngineError {
	if process.Status() != "active" {
		return nil
	}
	if err := s.Moment(process, "STEP_COMPLETE", "", phases); err != nil {
		return err
	}
	if process.Status() != "active" {
		return nil
	}
	return s.EnterStep(process, process.StepIndex()+1, now, phases)
}

func (s ProcessExecutor) Moment(process *actionpkg.ProcessView, kind, reason string, phases ProcessPhases) *model.EngineError {
	_, err := phases.CommitProcessMoment(process, ProcessMoment{kind: kind, reason: reason, resolveHits: true})
	return err
}

func (s ProcessExecutor) Finish(process *actionpkg.ProcessView, status, reason, castRef string, phases ProcessPhases) *model.EngineError {
	_, err := s.finish(process, status, reason, castRef, phases)
	return err
}

func (s ProcessExecutor) finish(process *actionpkg.ProcessView, status, reason, castRef string, phases ProcessPhases) (ActionResult, *model.EngineError) {
	if process.Status() != "active" {
		return ActionResult{}, nil
	}
	kind := "PROCESS_COMPLETE"
	if status == "failed" {
		kind = "PROCESS_FAILURE"
	}
	result, err := phases.CommitProcessMoment(process, ProcessMoment{kind: kind, reason: reason, castRef: castRef, finishStatus: status, resolveHits: true})
	if err != nil {
		return result, err
	}
	if status == "complete" {
		return result, phases.PublishProcessResolved(process)
	}
	return result, nil
}

func (s ProcessExecutor) HandleTimer(timer ProcessTimer, now int64, phases ProcessPhases) *model.EngineError {
	if timer.Index < 0 || timer.Index >= s.actions.ProcessCount() {
		return s.error("processInstances", "unknown process timer instance", "")
	}
	process := s.actions.ProcessAt(timer.Index)
	if process.Status() != "active" || process.StepVersion() != timer.StepVersion || process.StepExecutionIndex() != timer.ExecutionIndex || process.TimerAt() != now {
		return nil
	}
	if process.StepVersion() == 0 {
		if process.Definition().EntryKind == model.ProcessEntrySkillHitPassive {
			if err := s.Moment(process, "PROCESS_START", "", phases); err != nil {
				return err
			}
		}
		return s.EnterStep(process, 0, now, phases)
	}
	if process.HasStepCompletion() {
		return s.EnterStep(process, process.StepIndex()+1, now, phases)
	}
	if !process.HasRepeat() && process.StepExecutionIndex() > 0 && process.Definition().Steps[process.StepIndex()].StepType != "RECAST" {
		return s.CompleteStep(process, now, phases)
	}
	step := process.Definition().Steps[process.StepIndex()]
	if step.StepType == "EMPOWERED_BASIC_ATTACK" && process.HasEmpoweredWindow() {
		return phases.FinishEmpoweredWindow(process)
	}
	if step.StepType == "IMMEDIATE" {
		if err := s.Moment(process, "STEP_EXECUTION", "", phases); err != nil {
			return err
		}
		return s.CompleteStep(process, now, phases)
	}
	if process.HasRepeat() {
		if process.HasNextExecution() {
			return s.RunRepeat(process, now, phases)
		}
		return s.CompleteStep(process, now, phases)
	}
	if step.StepType != "DELAY" {
		if err := s.Moment(process, "STEP_TIMEOUT", "", phases); err != nil {
			return err
		}
	}
	if process.Status() != "active" {
		return nil
	}
	if step.StepType == "RECAST" || (step.StepType == "CHARGE" && !step.ReleaseAtMaximum) || step.StepType == "EMPOWERED_BASIC_ATTACK" {
		return s.Finish(process, "failed", "EVENT_ABORTED", "", phases)
	}
	if step.StepType == "DELAY" || (step.StepType == "CHARGE" && step.ReleaseAtMaximum) {
		if err := s.Moment(process, "STEP_EXECUTION", "", phases); err != nil {
			return err
		}
	}
	return s.CompleteStep(process, now, phases)
}

func (s ProcessExecutor) RunRepeat(process *actionpkg.ProcessView, now int64, phases ProcessPhases) *model.EngineError {
	if err := s.Moment(process, "STEP_EXECUTION", "", phases); err != nil {
		return err
	}
	if process.Status() != "active" {
		return nil
	}
	if !process.HasNextExecution() && process.Expiry() <= now {
		return s.CompleteStep(process, now, phases)
	}
	return nil
}

func (s ProcessExecutor) error(path, message, ref string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message)
	err.Path, err.Ref = path, ref
	err.SchemaHash, err.RulesHash, err.SessionID = s.identity.SchemaHash, s.identity.RulesHash, s.identity.SessionID
	return &err
}
