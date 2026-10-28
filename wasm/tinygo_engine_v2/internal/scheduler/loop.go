package scheduler

import "tinygo_engine_v2/internal/model"

// LoopState 只交换循环分支所需的值，不携带执行器或子系统状态。
type LoopState struct {
	Failure                               *model.EngineError
	Automated, HasSkillPlan, HasActions   bool
	SkillPlanDead, BasicWindowSettled     bool
	HasBasicAttack, BasicParticipantsDead bool
	MaxEvents                             int
}

type LoopStopState struct {
	SourceDead, TargetDead bool
	BudgetCause            model.BudgetCause
}

// LoopDriver 是循环与执行协调之间的有限入口。观察方法只消费已提交数值。
// 事件选择保留原有同刻特殊顺序，排程仍使用同一个根循环实例。
type LoopDriver interface {
	// LoopState 提供本轮驱动资格、执行失败及事件预算所需的已提交事实。
	LoopState() LoopState
	// LoopStopState 提供双方死亡及预算事实，由循环核定停止原因。
	LoopStopState() LoopStopState
	// SelectLoopEvent 对候选事件应用既有同刻业务顺序，不能创建另一套时钟。
	SelectLoopEvent(GenericEvent) (GenericEvent, *model.EngineError)
	// HandleLoopEvent 执行已接纳事件；错误由循环按现有停止规则处理。
	HandleLoopEvent(GenericEvent) *model.EngineError
	// ObserveBefore 补齐指定时刻之前的观察点，只消费已提交数值。
	ObserveBefore(int64)
	// ObserveThrough 补齐截至指定时刻的观察点，只消费已提交数值。
	ObserveThrough(int64)
	// ObserveFinal 按既有采样规则补记最终观察点。
	ObserveFinal()
	// PublishLoopWait 将当前等待投影发布回行动状态。
	PublishLoopWait()
	// SettleLoopEnd 完成循环结束时必要的业务结算，并返回实际失败。
	SettleLoopEnd() *model.EngineError
	// LoopBudgetExceeded 保存循环检测到的预算原因和错误事实。
	LoopBudgetExceeded(model.BudgetCause, string)
	// EnsureLoopBudgetCause 在预算停止尚无具体原因时补记既有默认原因。
	EnsureLoopBudgetCause()
}

// LoopAPI 定义唯一机械循环的排程、时钟、计数与停止能力。
type LoopAPI interface {
	// Queue 仅交给根初始化与统一执行提交两个写入口；行动、效果和报告不持有该队列。
	Queue() *GenericHeap
	// TimeMs 返回唯一循环的当前时刻。
	TimeMs() int64
	// StartMs 返回本次运行的起始时刻。
	StartMs() int64
	// DurationMs 返回本次运行配置的完整时长。
	DurationMs() int64
	// ProcessedEvents 返回已经接纳处理的事件数。
	ProcessedEvents() int
	// Reason 返回当前停止原因。
	Reason() model.StopReason
	// Stopped 返回循环是否已标记停止。
	Stopped() bool
	// Advance 只由根循环在选定事件或观察终点后推进，不隐式执行战斗。
	Advance(at int64)
	// AcceptEvent 在选择及前置观察成功后接纳一个事件，同时推进时钟和计数。
	AcceptEvent(at int64)
	// Stop 记录停止状态，只允许优先级更高的原因覆盖已有原因。
	Stop(reason model.StopReason)
	// Finalize 按预算、死亡、时长及队列事实核定最终停止原因。
	Finalize(state LoopStopState)
	// Run 驱动既有唯一循环；根入口和测试均组合此实现，不复制另一份驱动。
	Run(driver LoopDriver) *model.EngineError
}

// Loop 由根运行入口创建并拥有；执行协调借用该实例，不建立第二个时钟或堆。
type Loop struct {
	queue           GenericHeap
	now, start, end int64
	policy          model.StopPolicy
	processed       int
	reason          model.StopReason
	stopped         bool
}

var _ LoopAPI = (*Loop)(nil)

// NewLoop 创建本次运行唯一的时钟、事件队列与停止账，不执行战斗业务。
func NewLoop(start, duration int64, policy model.StopPolicy) *Loop {
	return &Loop{queue: NewGenericHeap(64), now: start, start: start, end: start + duration, policy: policy}
}

func (l *Loop) Queue() *GenericHeap      { return &l.queue }
func (l *Loop) TimeMs() int64            { return l.now }
func (l *Loop) StartMs() int64           { return l.start }
func (l *Loop) DurationMs() int64        { return l.end - l.start }
func (l *Loop) ProcessedEvents() int     { return l.processed }
func (l *Loop) Reason() model.StopReason { return l.reason }
func (l *Loop) Stopped() bool            { return l.stopped }

func (l *Loop) Advance(at int64) { l.now = at }

func (l *Loop) AcceptEvent(at int64) {
	l.now = at
	l.processed++
}

// StopReasonPriority 返回既有停止原因的固定优先级，用于保留更重要的终结事实。
func StopReasonPriority(reason model.StopReason) int {
	switch reason {
	case model.StopReasonBudgetExceeded:
		return 5
	case model.StopReasonBothDead:
		return 4
	case model.StopReasonSourceDead, model.StopReasonTargetDead:
		return 3
	case model.StopReasonDurationReached:
		return 2
	case model.StopReasonNoEvents:
		return 1
	default:
		return 0
	}
}

func (l *Loop) Stop(reason model.StopReason) {
	if l.stopped && StopReasonPriority(reason) <= StopReasonPriority(l.reason) {
		return
	}
	l.reason, l.stopped = reason, true
}

func (l *Loop) Finalize(state LoopStopState) {
	var best model.StopReason
	priority := -1
	consider := func(reason model.StopReason) {
		if next := StopReasonPriority(reason); next > priority {
			priority, best = next, reason
		}
	}
	if state.BudgetCause != "" || l.stopped && l.reason == model.StopReasonBudgetExceeded {
		consider(model.StopReasonBudgetExceeded)
	}
	if state.SourceDead && state.TargetDead {
		consider(model.StopReasonBothDead)
	} else if state.SourceDead {
		consider(model.StopReasonSourceDead)
	} else if state.TargetDead && l.policy.StopOnTargetDeathOrDefault() {
		consider(model.StopReasonTargetDead)
	}
	if l.now >= l.end {
		consider(model.StopReasonDurationReached)
	}
	if l.stopped && l.reason == model.StopReasonNoEvents {
		consider(model.StopReasonNoEvents)
	}
	if priority >= 0 {
		l.reason, l.stopped = best, true
	} else if !l.stopped {
		l.reason, l.stopped = model.StopReasonDurationReached, true
	}
}

func (l *Loop) Run(driver LoopDriver) *model.EngineError {
	for {
		state := driver.LoopState()
		if state.Failure != nil {
			if !state.Automated || state.Failure.BudgetCause == "" {
				return state.Failure
			}
			l.Stop(model.StopReasonBudgetExceeded)
			break
		}
		next, hasNext := l.queue.PeekTime()
		if state.HasSkillPlan && state.SkillPlanDead {
			l.Finalize(driver.LoopStopState())
			break
		}
		if state.HasActions && (!hasNext || next > l.end) {
			driver.ObserveBefore(l.end)
			l.Advance(l.end)
			l.Stop(model.StopReasonDurationReached)
			break
		}
		if state.BasicWindowSettled && (!hasNext || next > l.end) {
			driver.ObserveBefore(l.end)
			l.Advance(l.end)
			l.Stop(model.StopReasonDurationReached)
			break
		}
		if l.processed >= state.MaxEvents {
			driver.LoopBudgetExceeded(model.BudgetCauseMaxEvents, "event budget exceeded")
			l.Stop(model.StopReasonBudgetExceeded)
			break
		}
		event, ok := l.queue.Pop()
		if !ok {
			if l.now >= l.end {
				l.Stop(model.StopReasonDurationReached)
			} else if l.policy.StopWhenNoEventsOrDefault() {
				l.Stop(model.StopReasonNoEvents)
			} else {
				driver.ObserveBefore(l.end)
				l.Advance(l.end)
				l.Stop(model.StopReasonDurationReached)
			}
			break
		}
		if event.TimeMs > l.end {
			driver.ObserveBefore(l.end)
			l.Advance(l.end)
			l.Stop(model.StopReasonDurationReached)
			break
		}
		var err *model.EngineError
		event, err = driver.SelectLoopEvent(event)
		if err != nil {
			return err
		}
		driver.ObserveBefore(event.TimeMs)
		l.AcceptEvent(event.TimeMs)
		err = driver.HandleLoopEvent(event)
		state = driver.LoopState()
		if err == nil {
			err = state.Failure
		}
		if err != nil {
			if !state.Automated || err.BudgetCause == "" {
				return err
			}
			l.Stop(model.StopReasonBudgetExceeded)
			break
		}
		if state.HasBasicAttack && state.BasicParticipantsDead {
			driver.PublishLoopWait()
			l.Finalize(driver.LoopStopState())
		}
		next, hasNext = l.queue.PeekTime()
		if !hasNext || next > l.now {
			driver.ObserveThrough(l.now)
		}
		if l.stopped {
			break
		}
	}
	if err := driver.SettleLoopEnd(); err != nil {
		return err
	}
	l.Finalize(driver.LoopStopState())
	driver.PublishLoopWait()
	if l.reason == model.StopReasonBudgetExceeded {
		driver.EnsureLoopBudgetCause()
	}
	driver.ObserveThrough(l.now)
	driver.ObserveFinal()
	return nil
}
