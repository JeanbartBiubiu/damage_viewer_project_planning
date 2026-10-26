package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (state *Engine) enterProcessRepeat(frame *Frame, step planbundle.CompiledProcessStep) *model.EngineError {
	process := frame.pendingProcess
	countProgram := step.RepeatCountProgram
	if step.StepType == "CHANNEL" {
		countProgram = step.ExecutionCountProgram
	}
	count, err := frame.evalAmount(countProgram, process.Ability())
	if err != nil {
		return err
	}
	if math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count || count < 1 || count > 64 {
		return state.processErr(step.Path, "finite process execution count must be an integer in [1,64]", step.StepKey)
	}
	repeat := &model.ProcessRepeatSnapshot{ExecutionCount: int(count)}

	duration := float64(0)
	if step.StepType == "CHANNEL" {
		duration, err = frame.evalAmount(step.DurationProgram, process.Ability())
		if err != nil {
			return err
		}
		if step.FirstExecution == "CUSTOM_WINDOW" {
			if !actionpkg.ValidProcessWindowValue(duration, true) {
				return state.processErr(step.Path+".durationMs", "channel window duration requires positive safe integer milliseconds", step.StepKey)
			}
			first, firstErr := frame.evalAmount(step.FirstExecutionOffsetProgram, process.Ability())
			if firstErr != nil {
				return firstErr
			}
			last, lastErr := frame.evalAmount(step.LastExecutionOffsetProgram, process.Ability())
			if lastErr != nil {
				return lastErr
			}
			if !actionpkg.ValidProcessWindowValue(first, false) || !actionpkg.ValidProcessWindowValue(last, false) {
				return state.processErr(step.Path, "channel window offsets require nonnegative safe integer milliseconds", step.StepKey)
			}
			repeat.FirstExecutionOffsetMs, repeat.LastExecutionOffsetMs = int64(first), int64(last)
			if !actionpkg.ValidProcessChannelWindow(int64(duration), repeat) {
				return state.processErr(step.Path, "channel execution window contradicts its complete duration or execution count", step.StepKey)
			}
		} else if duration < count {
			return state.processErr(step.Path, "channel duration must allow distinct integer segment times", step.StepKey)
		}
	} else if step.HasInterval {
		interval, valueErr := frame.evalAmount(step.IntervalProgram, process.Ability())
		if valueErr != nil {
			return valueErr
		}
		if _, valid := actionpkg.ProcessTimeAfter(0, interval, false); !valid {
			return state.processErr(step.Path, "multi-hit interval requires positive integer milliseconds", step.StepKey)
		}
		repeat.IntervalMs = int64(interval)
		if repeat.ExecutionCount > 1 && repeat.IntervalMs > math.MaxInt64/int64(repeat.ExecutionCount-1) {
			return state.processErr(step.Path, "multi-hit duration exceeds the integer time range", step.StepKey)
		}
		repeat.LastExecutionOffsetMs = repeat.IntervalMs * int64(repeat.ExecutionCount-1)
		duration = float64(repeat.LastExecutionOffsetMs)
	} else if count > 1 {
		return state.processErr(step.Path, "multiple executions require an explicit interval", step.StepKey)
	}
	if err != nil {
		return err
	}
	end, valid := actionpkg.ProcessTimeAfter(state.loop.TimeMs(), duration, step.StepType == "MULTI_HIT" && count == 1)
	if step.StepType == "MULTI_HIT" {
		valid = state.loop.TimeMs() >= 0 && repeat.LastExecutionOffsetMs <= math.MaxInt64-state.loop.TimeMs()
		if valid {
			end = state.loop.TimeMs() + repeat.LastExecutionOffsetMs
		}
	}
	if !valid {
		return state.processErr(step.Path, "invalid finite process duration or timestamp overflow", step.StepKey)
	}
	frame.processChanges.SetTiming(end, &end)
	frame.processChanges.SetRepeat(repeat)
	if step.StepType == "CHANNEL" && step.FirstExecution != "CUSTOM_WINDOW" {
		repeat.FirstExecutionOffsetMs = process.RepeatOffset(0)
		repeat.LastExecutionOffsetMs = process.RepeatOffset(repeat.ExecutionCount - 1)
	}
	first := process.NextRepeatAt()
	repeat.NextExecutionAtMs = &first
	frame.processChanges.SetRepeat(repeat)
	return nil
}

func (state *Engine) stageProcessRepeatExecution(frame *Frame) *model.EngineError {
	timer, valid := frame.processChanges.AdvanceRepeat(state.loop.TimeMs())
	if !valid {
		return state.processErr(frame.pendingProcess.Definition().Path, "repeat execution requires the actual next committed segment", frame.pendingProcess.UseKey())
	}
	frame.pendingProcessTimer = timer
	return nil
}

func (state *Engine) executeProcessRepeat(process *actionpkg.ProcessView) *model.EngineError {
	if err := state.runProcessMoment(process, "STEP_EXECUTION", ""); err != nil {
		return err
	}
	if process.Status() != "active" {
		return nil
	}
	if !process.HasNextExecution() && process.Expiry() <= state.loop.TimeMs() {
		return state.completeProcessStep(process)
	}
	return nil
}
