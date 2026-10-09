package runtime

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func processTimerAt(process *processRuntime) int64 {
	if process.StepVersion == 0 {
		return process.StartedAtMs
	}
	if process.StepCompletedAtMs != nil {
		return *process.StepCompletedAtMs
	}
	if process.Repeat == nil && process.StepExecutionIndex > 0 && process.LastExecutionAtMs != nil {
		return *process.LastExecutionAtMs
	}
	if process.Repeat != nil && process.Repeat.NextExecutionAtMs != nil {
		return *process.Repeat.NextExecutionAtMs
	}
	if process.ExpiresAtMs != nil {
		return *process.ExpiresAtMs
	}
	return process.AdvanceAtMs
}

func (state *genericRunState) enterProcessRepeat(frame *executionFrame, step planbundle.CompiledProcessStep) *model.EngineError {
	process := frame.pendingProcess
	countProgram := step.RepeatCountProgram
	if step.StepType == "CHANNEL" {
		countProgram = step.ExecutionCountProgram
	}
	count, err := frame.evalAmount(countProgram, process.ability)
	if err != nil {
		return err
	}
	if math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count || count < 1 || count > 64 {
		return state.processErr(step.Path, "finite process execution count must be an integer in [1,64]", step.StepKey)
	}
	repeat := &model.ProcessRepeatSnapshot{ExecutionCount: int(count)}
	process.Repeat = repeat
	duration := float64(0)
	if step.StepType == "CHANNEL" {
		duration, err = frame.evalAmount(step.DurationProgram, process.ability)
		if err != nil {
			return err
		}
		if step.FirstExecution == "CUSTOM_WINDOW" {
			if !validProcessWindowValue(duration, true) {
				return state.processErr(step.Path+".durationMs", "channel window duration requires positive safe integer milliseconds", step.StepKey)
			}
			first, firstErr := frame.evalAmount(step.FirstExecutionOffsetProgram, process.ability)
			if firstErr != nil {
				return firstErr
			}
			last, lastErr := frame.evalAmount(step.LastExecutionOffsetProgram, process.ability)
			if lastErr != nil {
				return lastErr
			}
			if !validProcessWindowValue(first, false) || !validProcessWindowValue(last, false) {
				return state.processErr(step.Path, "channel window offsets require nonnegative safe integer milliseconds", step.StepKey)
			}
			repeat.FirstExecutionOffsetMs, repeat.LastExecutionOffsetMs = int64(first), int64(last)
			if !validProcessChannelWindow(int64(duration), repeat) {
				return state.processErr(step.Path, "channel execution window contradicts its complete duration or execution count", step.StepKey)
			}
		} else if duration < count {
			return state.processErr(step.Path, "channel duration must allow distinct integer segment times", step.StepKey)
		}
	} else if step.HasInterval {
		interval, valueErr := frame.evalAmount(step.IntervalProgram, process.ability)
		if valueErr != nil {
			return valueErr
		}
		if _, valid := processTimeAfter(0, interval, false); !valid {
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
	end, valid := processTimeAfter(state.nowMs, duration, step.StepType == "MULTI_HIT" && count == 1)
	if step.StepType == "MULTI_HIT" {
		valid = state.nowMs >= 0 && repeat.LastExecutionOffsetMs <= math.MaxInt64-state.nowMs
		if valid {
			end = state.nowMs + repeat.LastExecutionOffsetMs
		}
	}
	if !valid {
		return state.processErr(step.Path, "invalid finite process duration or timestamp overflow", step.StepKey)
	}
	process.AdvanceAtMs, process.ExpiresAtMs = end, &end
	if step.StepType == "CHANNEL" && step.FirstExecution != "CUSTOM_WINDOW" {
		repeat.FirstExecutionOffsetMs = processRepeatOffset(process, 0)
		repeat.LastExecutionOffsetMs = processRepeatOffset(process, repeat.ExecutionCount-1)
	}
	first := nextProcessRepeatAt(process)
	repeat.NextExecutionAtMs = &first
	return nil
}

func nextProcessRepeatAt(process *processRuntime) int64 {
	return process.StepStartedAtMs + processRepeatOffset(process, process.Repeat.ExecutionIndex)
}

func processRepeatOffset(process *processRuntime, index int) int64 {
	repeat := process.Repeat
	step := process.definition.Steps[process.stepIndex]
	if step.StepType == "MULTI_HIT" {
		return int64(index) * repeat.IntervalMs
	}
	if step.FirstExecution == "CUSTOM_WINDOW" {
		if repeat.ExecutionCount == 1 {
			return repeat.FirstExecutionOffsetMs
		}
		span := repeat.LastExecutionOffsetMs - repeat.FirstExecutionOffsetMs
		divisor := int64(repeat.ExecutionCount - 1)
		return repeat.FirstExecutionOffsetMs + (span*int64(index)+divisor/2)/divisor
	}
	slot := index
	if step.FirstExecution == "AFTER_INTERVAL" {
		slot++
	}
	duration := *process.ExpiresAtMs - process.StepStartedAtMs
	return int64(math.Round(float64(duration) * float64(slot) / float64(repeat.ExecutionCount)))
}

func validProcessWindowValue(value float64, positive bool) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && (!positive || value > 0) && math.Trunc(value) == value && value <= float64(maxJSONSafeInteger)
}

func validProcessChannelWindow(duration int64, repeat *model.ProcessRepeatSnapshot) bool {
	first, last := repeat.FirstExecutionOffsetMs, repeat.LastExecutionOffsetMs
	return duration > 0 && duration <= maxJSONSafeInteger && first >= 0 && first <= last && last <= duration && (repeat.ExecutionCount == 1 && first == last || repeat.ExecutionCount > 1 && last-first >= int64(repeat.ExecutionCount-1))
}

func (state *genericRunState) stageProcessRepeatExecution(frame *executionFrame) *model.EngineError {
	process := frame.pendingProcess
	repeat := process.Repeat
	if repeat.ExecutionIndex >= repeat.ExecutionCount || repeat.NextExecutionAtMs == nil || *repeat.NextExecutionAtMs != state.nowMs {
		return state.processErr(process.definition.Path, "repeat execution requires the actual next committed segment", process.UseKey)
	}
	repeat.ExecutionIndex++
	repeat.NextExecutionAtMs = nil
	if repeat.ExecutionIndex < repeat.ExecutionCount {
		next := nextProcessRepeatAt(process)
		repeat.NextExecutionAtMs = &next
	}
	frame.pendingProcessTimer = repeat.NextExecutionAtMs != nil || (process.definition.Steps[process.stepIndex].StepType == "CHANNEL" && *process.ExpiresAtMs > state.nowMs)
	return nil
}

func (state *genericRunState) executeProcessRepeat(process *processRuntime) *model.EngineError {
	if err := state.runProcessMoment(process, "STEP_EXECUTION", ""); err != nil {
		return err
	}
	if process.Status != "active" {
		return nil
	}
	if process.Repeat.NextExecutionAtMs == nil && *process.ExpiresAtMs <= state.nowMs {
		return state.completeProcessStep(process)
	}
	return nil
}
