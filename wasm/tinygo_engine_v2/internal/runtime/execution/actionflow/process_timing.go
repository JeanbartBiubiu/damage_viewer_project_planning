package actionflow

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

func (s ProcessExecutor) PrepareStep(changes *actionpkg.ProcessChangeSet, index int, now int64, amounts ProcessAmounts) (bool, *model.EngineError) {
	process := changes.View()
	step := process.Definition().Steps[index]
	changes.EnterStep(index, step, now)
	switch step.StepType {
	case "DELAY":
		at, err := s.duration(amounts, step.DelayProgram, now, false, process.Definition().Path+".steps.delayMs", step.StepKey)
		if err != nil {
			return false, err
		}
		changes.SetTiming(at, &at)
	case "RECAST":
		advance, ok := actionpkg.ProcessTimeAfter(now, float64(step.RecastIntervalMs), true)
		if !ok || advance > maxJSONSafeInteger {
			return false, s.error(step.Path+".intervalMs", "invalid safe recast interval deadline", step.StepKey)
		}
		changes.SetTiming(advance, nil)
		at, err := s.duration(amounts, step.WindowProgram, now, false, process.Definition().Path+".steps.windowMs", step.StepKey)
		if err != nil {
			return false, err
		}
		if at > maxJSONSafeInteger {
			return false, s.error(step.Path+".windowMs", "recast expiration must be a safe integer deadline", step.StepKey)
		}
		changes.SetTiming(process.AdvanceAtMs(), &at)
	case "CHARGE":
		minimum, err := s.duration(amounts, step.MinimumChargeProgram, now, true, process.Definition().Path+".steps.minimumChargeMs", step.StepKey)
		if err != nil {
			return false, err
		}
		maximum, err := s.duration(amounts, step.MaximumChargeProgram, now, false, process.Definition().Path+".steps.maximumChargeMs", step.StepKey)
		if err != nil {
			return false, err
		}
		if minimum > maximum {
			return false, s.error(process.Definition().Path+".steps.minimumChargeMs", "minimum charge exceeds maximum", step.StepKey)
		}
		changes.SetTiming(minimum, &maximum)
	case "MULTI_HIT", "CHANNEL":
		if err := s.PrepareRepeat(changes, step, now, amounts); err != nil {
			return false, err
		}
	}
	timer := step.StepType != "IMMEDIATE" && (!process.HasRepeat() || process.HasNextExecution() && process.NextExecutionAt() > now)
	return timer, nil
}

func (s ProcessExecutor) duration(amounts ProcessAmounts, program formula.GenericProgramID, now int64, zero bool, path, step string) (int64, *model.EngineError) {
	value, err := amounts.ProcessAmount(program)
	if err != nil {
		return 0, err
	}
	at, ok := actionpkg.ProcessTimeAfter(now, value, zero)
	if !ok {
		return 0, s.error(path, "invalid integer process duration or timestamp overflow", step)
	}
	return at, nil
}

func (s ProcessExecutor) PrepareRepeat(changes *actionpkg.ProcessChangeSet, step planbundle.CompiledProcessStep, now int64, amounts ProcessAmounts) *model.EngineError {
	process := changes.View()
	countProgram := step.RepeatCountProgram
	if step.StepType == "CHANNEL" {
		countProgram = step.ExecutionCountProgram
	}
	count, err := amounts.ProcessAmount(countProgram)
	if err != nil {
		return err
	}
	if math.IsNaN(count) || math.IsInf(count, 0) || math.Trunc(count) != count || count < 1 || count > 64 {
		return s.error(step.Path, "finite process execution count must be an integer in [1,64]", step.StepKey)
	}
	repeat := &model.ProcessRepeatSnapshot{ExecutionCount: int(count)}
	duration := float64(0)
	if step.StepType == "CHANNEL" {
		duration, err = amounts.ProcessAmount(step.DurationProgram)
		if err != nil {
			return err
		}
		if step.FirstExecution == "CUSTOM_WINDOW" {
			if !actionpkg.ValidProcessWindowValue(duration, true) {
				return s.error(step.Path+".durationMs", "channel window duration requires positive safe integer milliseconds", step.StepKey)
			}
			first, firstErr := amounts.ProcessAmount(step.FirstExecutionOffsetProgram)
			if firstErr != nil {
				return firstErr
			}
			last, lastErr := amounts.ProcessAmount(step.LastExecutionOffsetProgram)
			if lastErr != nil {
				return lastErr
			}
			if !actionpkg.ValidProcessWindowValue(first, false) || !actionpkg.ValidProcessWindowValue(last, false) {
				return s.error(step.Path, "channel window offsets require nonnegative safe integer milliseconds", step.StepKey)
			}
			repeat.FirstExecutionOffsetMs, repeat.LastExecutionOffsetMs = int64(first), int64(last)
			if !actionpkg.ValidProcessChannelWindow(int64(duration), repeat) {
				return s.error(step.Path, "channel execution window contradicts its complete duration or execution count", step.StepKey)
			}
		} else if duration < count {
			return s.error(step.Path, "channel duration must allow distinct integer segment times", step.StepKey)
		}
	} else if step.HasInterval {
		interval, valueErr := amounts.ProcessAmount(step.IntervalProgram)
		if valueErr != nil {
			return valueErr
		}
		if _, valid := actionpkg.ProcessTimeAfter(0, interval, false); !valid {
			return s.error(step.Path, "multi-hit interval requires positive integer milliseconds", step.StepKey)
		}
		repeat.IntervalMs = int64(interval)
		if repeat.ExecutionCount > 1 && repeat.IntervalMs > math.MaxInt64/int64(repeat.ExecutionCount-1) {
			return s.error(step.Path, "multi-hit duration exceeds the integer time range", step.StepKey)
		}
		repeat.LastExecutionOffsetMs = repeat.IntervalMs * int64(repeat.ExecutionCount-1)
		duration = float64(repeat.LastExecutionOffsetMs)
	} else if count > 1 {
		return s.error(step.Path, "multiple executions require an explicit interval", step.StepKey)
	}
	if err != nil {
		return err
	}
	end, valid := actionpkg.ProcessTimeAfter(now, duration, step.StepType == "MULTI_HIT" && count == 1)
	if step.StepType == "MULTI_HIT" {
		valid = now >= 0 && repeat.LastExecutionOffsetMs <= math.MaxInt64-now
		if valid {
			end = now + repeat.LastExecutionOffsetMs
		}
	}
	if !valid {
		return s.error(step.Path, "invalid finite process duration or timestamp overflow", step.StepKey)
	}
	changes.SetTiming(end, &end)
	changes.SetRepeat(repeat)
	if step.StepType == "CHANNEL" && step.FirstExecution != "CUSTOM_WINDOW" {
		repeat.FirstExecutionOffsetMs = process.RepeatOffset(0)
		repeat.LastExecutionOffsetMs = process.RepeatOffset(repeat.ExecutionCount - 1)
	}
	first := process.NextRepeatAt()
	repeat.NextExecutionAtMs = &first
	changes.SetRepeat(repeat)
	return nil
}

func (s ProcessExecutor) AdvanceRepeat(changes *actionpkg.ProcessChangeSet, now int64) (bool, *model.EngineError) {
	timer, valid := changes.AdvanceRepeat(now)
	if !valid {
		process := changes.View()
		return false, s.error(process.Definition().Path, "repeat execution requires the actual next committed segment", process.UseKey())
	}
	return timer, nil
}
