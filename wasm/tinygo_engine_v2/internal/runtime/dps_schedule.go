// 普攻与 DoT 调度容器及时间推进。
package runtime

import (
	"tinygo_engine_v2/internal/model"
)

func (state *dpsCurveState) initBasicAttackSchedules() {
	startAt := state.rules.AutoAttackPlan.StartAtMs
	if startAt < 0 {
		startAt = 0
	}
	for _, ref := range state.curve.ResolvedSnapshot.BasicAttackActions {
		actionIndex, ok := state.bundle.ActionIndex[ref.ActionID]
		if !ok {
			continue
		}
		state.schedules = append(state.schedules, dpsBasicAttackSchedule{
			ref:         ref,
			actionIndex: actionIndex,
			nextAtMs:    startAt,
		})
	}
}

func (state *dpsCurveState) nextBasicAttackAtMs() (int64, bool) {
	var next int64
	found := false
	for _, sched := range state.schedules {
		if sched.nextAtMs < 0 || sched.nextAtMs >= state.rules.DurationMs {
			continue
		}
		if !found || sched.nextAtMs < next {
			next = sched.nextAtMs
			found = true
		}
	}
	return next, found
}

func (state *dpsCurveState) processBasicAttacksAt(timeMs int64) {
	for i := range state.schedules {
		if state.schedules[i].nextAtMs != timeMs {
			continue
		}
		state.processBasicAttack(i, timeMs)
		if state.result.Status == dpsStatusBlocked || state.targetHP <= 0 {
			for j := i + 1; j < len(state.schedules); j++ {
				if state.schedules[j].nextAtMs == timeMs {
					state.schedules[j].nextAtMs = -1
				}
			}
			return
		}
	}
}

func (state *dpsCurveState) applyDot(timeMs int64, passive model.DPSPassiveEffectV2, op model.DPSPassiveOperationV2) {
	tickIntervalMs := state.rules.DotTickIntervalMs
	if op.TickIntervalMs != 0 && op.TickIntervalMs != tickIntervalMs {
		state.block("passive apply_dot operation does not support tickIntervalMs override")
		return
	}
	if op.RefreshMode != "" && op.RefreshMode != "refresh" {
		state.block("passive apply_dot operation has unsupported refreshMode " + op.RefreshMode)
		return
	}
	if op.DurationMs <= 0 || tickIntervalMs <= 0 {
		state.block("passive apply_dot operation requires durationMs and tickIntervalMs")
		return
	}
	stacks := 0
	if op.StackKey != "" {
		stacks = state.stacks[stackRuntimeKey(passive, op.StackKey)]
	}
	key := nonEmpty(op.Source, passiveRuntimeKey(passive)) + ":" + stackRuntimeKey(passive, op.StackKey)
	if op.RefreshMode == "" || op.RefreshMode == "refresh" {
		state.removeDot(key)
	}
	state.dots = append(state.dots, activeDPSDot{
		Key:            key,
		SourceCategory: passive.SourceCategory,
		SourceID:       passive.SourceID,
		SourceType:     passive.SourceType,
		TriggerID:      passive.TriggerID,
		Operation:      op,
		Stacks:         stacks,
		NextTickAtMs:   timeMs + tickIntervalMs,
		ExpireAtMs:     timeMs + op.DurationMs,
	})
	state.result.EffectTimeline = append(state.result.EffectTimeline, model.DPSEffectEventV2{
		TimeMs: timeMs, SourceID: nonEmpty(passive.SourceID, passiveID(passive)), Kind: dpsOpApplyDot,
	})
	state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
		TimeMs:  timeMs,
		Source:  passiveDamageSource(passive, op),
		Kind:    dpsOpApplyDot,
		Amount:  float64(stacks),
		Message: key,
	})
	state.updateQueuePeak()
}

func (state *dpsCurveState) processDotTick(timeMs int64) {
	state.expireStacks(timeMs)
	state.refreshActiveStatModifiers(timeMs)
	if state.result.Status == dpsStatusBlocked {
		return
	}
	for i := range state.dots {
		dot := &state.dots[i]
		if dot.NextTickAtMs != timeMs || dot.NextTickAtMs > dot.ExpireAtMs {
			continue
		}
		state.result.ProcessedEvents++
		state.updateQueuePeak()
		amount, _, ok := state.resolveOperationAmount(dot.Operation, dot.Stacks)
		if !ok {
			return
		}
		source := dot.Operation.Source
		if source == "" {
			source = dot.SourceID
		}
		if state.applyDamage(timeMs, source, dot.Operation.DamageType, amount).Applied {
			state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
				TimeMs:  timeMs,
				Source:  source,
				Kind:    "dot_tick",
				Amount:  amount,
				Message: dot.Key,
			})
		}
		dot.NextTickAtMs += dotInterval(dot.Operation, state.rules)
		break
	}
	state.compactDots()
}

func (state *dpsCurveState) nextDotTick() (int64, bool) {
	var next int64
	found := false
	for _, dot := range state.dots {
		if dot.NextTickAtMs > dot.ExpireAtMs || dot.NextTickAtMs >= state.rules.DurationMs {
			continue
		}
		if !found || dot.NextTickAtMs < next {
			next = dot.NextTickAtMs
			found = true
		}
	}
	return next, found
}

func (state *dpsCurveState) removeDot(key string) {
	next := state.dots[:0]
	for _, dot := range state.dots {
		if dot.Key != key {
			next = append(next, dot)
		}
	}
	state.dots = next
}

func (state *dpsCurveState) compactDots() {
	next := state.dots[:0]
	for _, dot := range state.dots {
		if dot.NextTickAtMs <= dot.ExpireAtMs && dot.NextTickAtMs < state.rules.DurationMs {
			next = append(next, dot)
		}
	}
	state.dots = next
}
