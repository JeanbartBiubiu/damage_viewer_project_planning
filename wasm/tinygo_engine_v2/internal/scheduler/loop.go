package scheduler

import "tinygo_engine_v2/internal/model"

// LoopState 只交换事件处理后必须立即复核的事实，不携带执行器或子系统状态。
type LoopState struct {
	Failure                               *model.EngineError
	Automated                             bool
	HasBasicAttack, BasicParticipantsDead bool
}

type LoopStopState struct {
	SourceDead, TargetDead bool
	BudgetCause            model.BudgetCause
}

// LoopObservation 是前置决策读取的机械循环事实；无下一事件时不使用其时刻。
type LoopObservation struct {
	NowMs, EndMs    int64
	ProcessedEvents int
	HasNextEvent    bool
	NextEventAtMs   int64
}

// LoopDecisionKind 表示下一次事件接纳前需要循环完成的动作。
type LoopDecisionKind uint8

const (
	LoopHandleNext LoopDecisionKind = iota + 1
	LoopEndAtLimit
	LoopFinalizeNow
	LoopStopNow
)

// LoopDecision 不执行事件或推进时钟；停止与预算字段只在LoopStopNow下使用。
type LoopDecision struct {
	Kind          LoopDecisionKind
	StopReason    model.StopReason
	BudgetCause   model.BudgetCause
	BudgetMessage string
}

// LoopDriver 是循环与执行协调之间的有限入口。观察方法只消费已提交数值。
// 事件选择保留原有同刻特殊顺序，排程仍使用同一个根循环实例。
type LoopDriver interface {
	// DecideNext 根据机械事实作前置业务决定；可以返回原执行失败，不改变队列、时钟或停止账。
	DecideNext(LoopObservation) (LoopDecision, *model.EngineError)
	// LoopDecisionError 为无效决定生成带本场身份的非空运行不变量错误，不发布状态。
	LoopDecisionError(message string) *model.EngineError
	// LoopState 在处理事件返回后立即提供内部失败、自动预算路径与普攻死亡事实。
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
	// SetQueueLimit 在本场装配位置设置有效队列上限，沿用编译限额及硬上限。
	SetQueueLimit(limit int)
	// NextEventAt 只查询下一事件时刻及存在性，不出队或推进时钟。
	NextEventAt() (int64, bool)
	// CanEnqueue 预检新增数量是否可容纳，不保留容量票据。
	CanEnqueue(count int) bool
	// RemainingCapacity 返回当前队列剩余容量，不包含调用方尚未提交的计时请求。
	RemainingCapacity() int
	// Enqueue 沿用稳定堆序及容量错误；新事件的零序号在实际入队时分配。
	Enqueue(event GenericEvent) model.ErrCode
	// HasBasicAttack 查询队列是否已有普攻唤醒，不判断业务资格。
	HasBasicAttack() bool
	// RescheduleBasicAttack 改期已有普攻唤醒并更新世代，保留其原序号；不存在返回false。
	RescheduleBasicAttack(at int64, generation uint64) bool
	// HasAutomaticSkill 查询队列是否已有自动行动唤醒，不将改期算作新增。
	HasAutomaticSkill() bool
	// RescheduleAutomaticSkill 改期已有自动行动唤醒并更新世代，保留其原序号。
	RescheduleAutomaticSkill(at int64, generation uint64) bool
	// HasCooldownAttempt 查询实际等待索引是否已有带非零版本的冷却尝试。
	HasCooldownAttempt(entry int) bool
	// RescheduleCooldownAttempt 改期指定等待的已有尝试并更新版本，保留其原序号。
	RescheduleCooldownAttempt(entry int, at int64, version uint64) bool
	// TakeAt 仅取出堆顶恰好同刻的候选，不接纳、执行或推进时钟。
	TakeAt(at int64) (GenericEvent, bool)
	// RestoreCandidate 在同次同步选择内恢复本循环取出的原事件；零序号拒绝，容量错误显式返回。
	RestoreCandidate(event GenericEvent) model.ErrCode
	// QueuedEvents 返回实际入队数，不包括已经取出的候选。
	QueuedEvents() int
	// PeakQueuedEvents 返回本场队列曾同时持有的最高事件数。
	PeakQueuedEvents() int
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
eventLoop:
	for {
		next, hasNext := l.queue.PeekTime()
		decision, err := driver.DecideNext(LoopObservation{
			NowMs: l.now, EndMs: l.end, ProcessedEvents: l.processed,
			HasNextEvent: hasNext, NextEventAtMs: next,
		})
		if err != nil {
			return err
		}
		if message := l.decisionIssue(decision); message != "" {
			return driver.LoopDecisionError(message)
		}
		switch decision.Kind {
		case LoopHandleNext:
			// 无事件与越过终点仍由同一循环的机械停止策略处理。
		case LoopEndAtLimit:
			driver.ObserveBefore(l.end)
			l.Advance(l.end)
			l.Stop(model.StopReasonDurationReached)
			break eventLoop
		case LoopFinalizeNow:
			l.Finalize(driver.LoopStopState())
			break eventLoop
		case LoopStopNow:
			if decision.BudgetCause != "" {
				driver.LoopBudgetExceeded(decision.BudgetCause, decision.BudgetMessage)
			}
			l.Stop(decision.StopReason)
			break eventLoop
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
		event, err = driver.SelectLoopEvent(event)
		if err != nil {
			return err
		}
		driver.ObserveBefore(event.TimeMs)
		l.AcceptEvent(event.TimeMs)
		err = driver.HandleLoopEvent(event)
		state := driver.LoopState()
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

func (l *Loop) decisionIssue(decision LoopDecision) string {
	if decision.Kind != LoopStopNow && (decision.StopReason != "" || decision.BudgetCause != "" || decision.BudgetMessage != "") {
		return "loop decision carries stop or budget facts without stopping"
	}
	switch decision.Kind {
	case LoopHandleNext, LoopFinalizeNow:
		return ""
	case LoopEndAtLimit:
		if l.end < l.now {
			return "loop decision cannot move time backwards"
		}
		return ""
	case LoopStopNow:
		if StopReasonPriority(decision.StopReason) == 0 {
			return "loop decision has no valid stop reason"
		}
		if decision.BudgetCause == "" {
			if decision.BudgetMessage != "" {
				return "loop decision carries a budget message without its cause"
			}
		} else if decision.BudgetCause != model.BudgetCauseMaxEvents || decision.StopReason != model.StopReasonBudgetExceeded || decision.BudgetMessage != "event budget exceeded" {
			return "loop decision has inconsistent event budget facts"
		}
		return ""
	default:
		return "loop decision kind is invalid"
	}
}
