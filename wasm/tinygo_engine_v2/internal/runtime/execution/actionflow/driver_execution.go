package actionflow

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// DriverAttempt 是唯一队列交付的驱动槽、尝试序号和原等待版本。
type DriverAttempt struct {
	Entry, Attempt int
	TimeMs         int64
	WaitVersion    uint64
}

// DriverTiming 保留当前唯一循环提供的时刻、窗口和原重查间隔。
type DriverTiming struct{ Now, Start, Duration, Recheck int64 }

// DriverAttemptPhases 只交接本次驱动尝试的真实门禁、记录与控制帧。
type DriverAttemptPhases interface {
	// ResolveAttemptActor 解析原驱动双方并核对当前存在性。
	ResolveAttemptActor(selector, source string) (string, bool)
	// AttemptCooldowns 只取得指定拥有者的唯一冷却账，writable在原取消位置复制。
	AttemptCooldowns(owner string, writable bool) *actionpkg.CooldownLedger
	// ObserveDriverAttempt 在原位置登记能力存在与必要的真实尝试计数。
	ObserveDriverAttempt(ref string, nativeFollowUp bool)
	// DriverControlAbility 读取实际驱动控制能力，不发明缺失引用。
	DriverControlAbility(entry model.DriverEntry) (planbundle.CompiledAbility, bool)
	// RunDriverControl 执行本次实际控制，真实接纳仍由过程提交决定。
	RunDriverControl(entry model.DriverEntry, index int, ability planbundle.CompiledAbility, ref string) *model.EngineError
	// CheckDriverGate 在原入口准备有限视图并返回真实门禁结果。
	CheckDriverGate(entry model.DriverEntry, index int) GateResult
	// ObserveDriverSkip 记录本次真实拒绝，保留原字段和来源。
	ObserveDriverSkip(entry model.DriverEntry, ref string, reason model.AttemptSkipReason, ready int64)
	// ExecuteDriverCast 进入真实能力帧，不重排门禁或重复记录。
	ExecuteDriverCast(entry model.DriverEntry) *model.EngineError
}

// DriverSchedules 只提供已经决定的有限尝试请求和下一动态间隔读值。
type DriverSchedules interface {
	// QueueDriverAttempt 将已核定的真实时间、槽与序号写入唯一队列。
	QueueDriverAttempt(at int64, entry, attempt int)
	// QueueDriverCooldown 登记该实际能力的唯一等待并写入原队列。
	QueueDriverCooldown(at int64, entry, attempt int, owner, ref string)
	// ReadDriverInterval 在原位置读取当前真实双方视图中的运行期间隔公式。
	ReadDriverInterval(program formula.GenericProgramID, entry model.DriverEntry) (float64, *model.EngineError)
}

func (s SkillActionExecutor) SeedDrivers(entries []model.DriverEntry, timing DriverTiming, maxEvents int, schedules DriverSchedules) {
	for index, entry := range entries {
		schedules.QueueDriverAttempt(entry.FirstAtMs, index, 0)
		if entry.Repeat != nil && entry.Repeat.IntervalMs > 0 {
			end := timing.Start + timing.Duration
			if entry.FirstAtMs > end {
				continue
			}
			lastAttempt := (end - entry.FirstAtMs) / entry.Repeat.IntervalMs
			maximum := entry.Repeat.MaxAttempts
			if maximum <= 0 {
				maximum = EstimateDriverAttempts(entry, timing.Start, timing.Duration, maxEvents)
			}
			for attempt := 1; attempt < maximum; attempt++ {
				// 先用剩余窗口判界，再乘加，避免超大间隔回绕到过去。
				if int64(attempt) > lastAttempt {
					break
				}
				at := entry.FirstAtMs + int64(attempt)*entry.Repeat.IntervalMs
				schedules.QueueDriverAttempt(at, index, attempt)
			}
		}
	}
}

func (s SkillActionExecutor) Attempt(event DriverAttempt, entries []model.DriverEntry, timing DriverTiming, phases DriverAttemptPhases, schedules DriverSchedules) *model.EngineError {
	entry := entries[event.Entry]
	waitOwner, _ := phases.ResolveAttemptActor(entry.Source, model.SelectorSource)
	waitTarget, _ := phases.ResolveAttemptActor(entry.Target, waitOwner)
	waitOwner = actionpkg.AbilityCooldownOwner(waitOwner, NormalizeAbilityRef(entry.AbilityRef, waitOwner, waitTarget))
	waitKey := WhileReadyWaitKey(waitOwner, entry.EntryKey)
	if event.WaitVersion != 0 && !phases.AttemptCooldowns(waitOwner, false).WaitCurrent(waitKey, event.TimeMs, event.WaitVersion) {
		return nil
	}
	if IsWhileReady(entry) {
		phases.AttemptCooldowns(waitOwner, true).CancelWait(waitKey)
	}
	native := IsNativeHitFollowUp(entry.EntryKey)
	if !native {
		s.actions.RecordDriverAttempt(event.Entry)
	}
	source, _ := phases.ResolveAttemptActor(entry.Source, model.SelectorSource)
	target, _ := phases.ResolveAttemptActor(entry.Target, source)
	ref := NormalizeAbilityRef(entry.AbilityRef, source, target)
	phases.ObserveDriverAttempt(ref, native)
	if ability, found := phases.DriverControlAbility(entry); found && ability.ProcessControl != nil {
		return phases.RunDriverControl(entry, event.Entry, ability, ref)
	}
	gate := phases.CheckDriverGate(entry, event.Entry)
	if gate.Error != nil {
		return gate.Error
	}
	if gate.Skipped {
		phases.ObserveDriverSkip(entry, ref, gate.Reason, gate.ReadyAt)
		if IsWhileReady(entry) {
			next := NextWhileReadyTime(gate.Reason, gate.ReadyAt, timing.Now, timing.Recheck)
			if next > timing.Now {
				if gate.Reason == model.AttemptSkipCooldownNotReady {
					schedules.QueueDriverCooldown(next, event.Entry, event.Attempt+1, actionpkg.AbilityCooldownOwner(source, ref), ref)
				} else {
					schedules.QueueDriverAttempt(next, event.Entry, event.Attempt+1)
				}
			}
			return nil
		}
		return s.ScheduleDynamicRepeat(entry, event.Entry, event.Attempt, timing, schedules)
	}
	if err := phases.ExecuteDriverCast(entry); err != nil {
		return err
	}
	return s.ScheduleDynamicRepeat(entry, event.Entry, event.Attempt, timing, schedules)
}

func (s SkillActionExecutor) ScheduleDynamicRepeat(entry model.DriverEntry, entryIndex, attemptIndex int, timing DriverTiming, schedules DriverSchedules) *model.EngineError {
	if entry.Repeat == nil || entry.Repeat.IntervalFormula == nil {
		return nil
	}
	program, present := s.actions.DriverInterval(entryIndex)
	if !present {
		return nil
	}
	nextAttempt := attemptIndex + 1
	if entry.Repeat.MaxAttempts > 0 && nextAttempt >= entry.Repeat.MaxAttempts {
		return nil
	}
	raw, err := schedules.ReadDriverInterval(program, entry)
	if err != nil {
		return err
	}
	if math.IsNaN(raw) || math.IsInf(raw, 0) || raw <= 0 {
		err := s.error("intervalFormula must evaluate to a finite value > 0", "driverPlan.entries["+entry.EntryKey+"].repeat.intervalFormula")
		err.Code, err.Ref = model.GenericErrFormulaTypeError, entry.AbilityRef
		return err
	}
	next, within := DynamicRepeatTime(raw, timing.Now, timing.Start+timing.Duration)
	if within {
		schedules.QueueDriverAttempt(next, entryIndex, nextAttempt)
	}
	return nil
}

// IsNativeHitFollowUp 保留真实命中续接的既有保留后缀，不改变使用身份。
func IsNativeHitFollowUp(entry string) bool { return strings.HasSuffix(entry, "__native_hit") }

// WhileReadyWaitKey 返回原驱动在唯一冷却账中的完整等待身份。
func WhileReadyWaitKey(owner, entry string) actionpkg.CooldownWaitKey {
	return actionpkg.CooldownWaitKey{Kind: "while_ready", Owner: owner, Key: entry}
}
