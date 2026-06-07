package runtime

import (
	"math"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func (ctx *RunContext) applyStatus(actor uint8, statusID uint16) model.ErrCode {
	return ctx.applyStatusFrom(actor, actor, statusID)
}

func (ctx *RunContext) applyStatusFrom(source uint8, actor uint8, statusID uint16) model.ErrCode {
	if int(statusID) >= len(ctx.Bundle.Statuses) {
		return model.ErrUnknownStatus
	}
	status := ctx.Bundle.Statuses[statusID]
	if status.Kind == "shield" {
		amount := status.Magnitude
		return ctx.grantShieldFrom(source, actor, statusID, amount)
	}
	for i := range ctx.Statuses {
		if !ctx.Statuses[i].Alive {
			ctx.Statuses[i].Alive = true
			ctx.Statuses[i].Generation++
			ctx.Statuses[i].Source = source
			ctx.Statuses[i].Actor = actor
			ctx.Statuses[i].Def = statusID
			ctx.Statuses[i].ExpireAt = ctx.NowMs + status.DurationMs
			ctx.Statuses[i].TickDone = 0
			handle := scheduler.Handle{Index: uint16(i), Generation: ctx.Statuses[i].Generation}
			if status.DurationMs > 0 {
				code := ctx.Queue.Push(scheduler.Event{
					TimeMs: ctx.Statuses[i].ExpireAt, Priority: 1, Kind: scheduler.EventStatusExpire, Source: source, Target: actor, Status: handle,
				})
				if code != model.ErrOK {
					return code
				}
			}
			if hasStatusTick(status) {
				tickAt := ctx.NowMs + status.TickIntervalMs
				if status.DurationMs <= 0 || tickAt <= ctx.Statuses[i].ExpireAt {
					code := ctx.Queue.Push(scheduler.Event{
						TimeMs: tickAt, Priority: 0, Kind: scheduler.EventStatusTick, Source: source, Target: actor, Status: handle,
					})
					if code != model.ErrOK {
						return code
					}
				}
			}
			ctx.log("status_apply", source, actor, 0, statusID, 0, "")
			return model.ErrOK
		}
	}
	return model.ErrArenaFull
}

func (ctx *RunContext) grantShield(actor uint8, statusID uint16, amount float64) model.ErrCode {
	return ctx.grantShieldFrom(actor, actor, statusID, amount)
}

func (ctx *RunContext) grantShieldFrom(source uint8, actor uint8, statusID uint16, amount float64) model.ErrCode {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return model.ErrNumeric
	}
	if int(statusID) >= len(ctx.Bundle.Statuses) {
		return model.ErrUnknownStatus
	}
	status := ctx.Bundle.Statuses[statusID]
	for i := range ctx.Shields {
		if !ctx.Shields[i].Alive {
			ctx.Shields[i].Alive = true
			ctx.Shields[i].Generation++
			ctx.Shields[i].Actor = actor
			ctx.Shields[i].Kind = status.ShieldKind
			if ctx.Shields[i].Kind == "" {
				ctx.Shields[i].Kind = "all"
			}
			ctx.Shields[i].Amount = amount
			ctx.Shields[i].ExpireAt = ctx.NowMs + status.DurationMs
			handle := scheduler.Handle{Index: uint16(i), Generation: ctx.Shields[i].Generation}
			if status.DurationMs > 0 {
				code := ctx.Queue.Push(scheduler.Event{
					TimeMs: ctx.Shields[i].ExpireAt, Priority: 1, Kind: scheduler.EventShieldExpire, Source: actor, Target: actor, Shield: handle,
				})
				if code != model.ErrOK {
					return code
				}
			}
			ctx.log("shield_apply", source, actor, 0, statusID, amount, ctx.Shields[i].Kind)
			return model.ErrOK
		}
	}
	return model.ErrArenaFull
}

func (ctx *RunContext) onStatusTick(ev scheduler.Event) model.ErrCode {
	if int(ev.Status.Index) >= len(ctx.Statuses) {
		return model.ErrOK
	}
	status := &ctx.Statuses[ev.Status.Index]
	if !status.Alive || status.Generation != ev.Status.Generation {
		return model.ErrOK
	}
	def := ctx.Bundle.Statuses[status.Def]
	if !hasStatusTick(def) {
		return model.ErrOK
	}
	status.TickDone++
	tickIndex := status.TickDone
	source := status.Source
	target := status.Actor
	amount, formulaID, breakdown, code := ctx.statusTickAmountTrace(def, source, target, float64(tickIndex))
	if code != model.ErrOK {
		return code
	}
	critResult, code := ctx.resolveStatusTickCrit(def, source)
	if code != model.ErrOK {
		return code
	}
	effectiveAmount := amount * critResult.Scalar
	result := model.StatusTickRunResultV2{
		TimeMs:            ctx.NowMs,
		StatusID:          def.ID,
		TickIndex:         tickIndex,
		TickCount:         def.TickCount,
		Kind:              effectKindString(def.TickEffect),
		FormulaID:         formulaID,
		FormulaBreakdown:  breakdown,
		RawAmount:         amount,
		HasRawAmount:      true,
		CritPolicy:        def.TickCritPolicy,
		CritRoll:          critResult.Roll,
		HasCritRoll:       critResult.HasRoll,
		CritResult:        critResult.Result,
		HasCritResult:     critResult.HasResult,
		CritMultiplier:    critResult.Multiplier,
		HasCritMultiplier: critResult.HasMultiplier,
		TargetHPBefore:    ctx.Actors[target].HP,
		SourceActorID:     ctx.Actors[source].ActorID,
		TargetActorID:     ctx.Actors[target].ActorID,
	}
	switch def.TickEffect {
	case compilebundle.EffectDealDamage:
		// DoT ticks are top-level damage events for M4 evidence. Trigger effects
		// run at depth 1, so fireTriggers still prevents recursive expansion.
		damage, code := ctx.dealDamageResult(source, target, effectiveAmount, def.TickDamageType, ev.ChainDepth)
		result.DamageType = def.TickDamageType
		result.FinalDamage = damage.FinalDamage
		result.HasFinalDamage = true
		result.TargetHPAfter = ctx.Actors[target].HP
		ctx.TickResults = append(ctx.TickResults, result)
		if code != model.ErrOK {
			return code
		}
	case compilebundle.EffectHeal:
		heal, code := ctx.applyHeal(source, target, effectiveAmount)
		result.HealApplied = heal.Applied
		result.HasHealApplied = true
		result.OverhealAmount = heal.Overheal
		result.HasOverheal = true
		result.TargetHPAfter = heal.HPAfter
		ctx.TickResults = append(ctx.TickResults, result)
		if code != model.ErrOK {
			return code
		}
	default:
		return model.ErrUnsupported
	}
	ctx.log("status_tick", source, target, 0, status.Def, effectiveAmount, effectKindString(def.TickEffect))
	if status.TickDone < def.TickCount {
		nextAt := ctx.NowMs + def.TickIntervalMs
		if def.DurationMs <= 0 || nextAt <= status.ExpireAt {
			return ctx.Queue.Push(scheduler.Event{
				TimeMs: nextAt, Priority: 0, Kind: scheduler.EventStatusTick, Source: source, Target: target, Status: ev.Status,
			})
		}
	}
	return model.ErrOK
}

func (ctx *RunContext) onStatusExpire(ev scheduler.Event) model.ErrCode {
	if int(ev.Status.Index) >= len(ctx.Statuses) {
		return model.ErrOK
	}
	status := &ctx.Statuses[ev.Status.Index]
	if !status.Alive || status.Generation != ev.Status.Generation {
		return model.ErrOK
	}
	status.Alive = false
	ctx.log("status_expire", status.Actor, status.Actor, 0, status.Def, 0, "")
	if ctx.Actors[status.Actor].Pending.Active {
		return ctx.Queue.Push(scheduler.Event{TimeMs: ctx.NowMs, Priority: 2, Kind: scheduler.EventIntentRecheck, Source: status.Actor, Target: ctx.Actors[status.Actor].Pending.Target})
	}
	return model.ErrOK
}

func (ctx *RunContext) onShieldExpire(ev scheduler.Event) model.ErrCode {
	if int(ev.Shield.Index) >= len(ctx.Shields) {
		return model.ErrOK
	}
	shield := &ctx.Shields[ev.Shield.Index]
	if !shield.Alive || shield.Generation != ev.Shield.Generation {
		return model.ErrOK
	}
	shield.Alive = false
	ctx.log("shield_expire", shield.Actor, shield.Actor, 0, 0, 0, "")
	return model.ErrOK
}

func (ctx *RunContext) onIntentRecheck(ev scheduler.Event) model.ErrCode {
	pending := ctx.Actors[ev.Source].Pending
	if !pending.Active {
		return model.ErrOK
	}
	ctx.Actors[ev.Source].Pending.Active = false
	return ctx.Queue.Push(scheduler.Event{
		TimeMs: ctx.NowMs, Priority: 10, Kind: scheduler.EventCastIntent,
		Source: ev.Source, Target: pending.Target, Action: pending.Action,
	})
}

func (ctx *RunContext) interruptExecutions(actor uint8) string {
	for i := range ctx.Executions {
		exec := &ctx.Executions[i]
		if !exec.Alive || exec.Source != actor {
			continue
		}
		exec.Alive = false
		actionID := ctx.Bundle.Actions[exec.Action].ID
		ctx.ActionResults = append(ctx.ActionResults, model.ActionRunResultV2{
			TimeMs:                ctx.NowMs,
			ActionID:              actionID,
			SourceActorID:         ctx.Actors[exec.Source].ActorID,
			TargetActorID:         ctx.Actors[exec.Target].ActorID,
			Accepted:              true,
			ExecutionStarted:      true,
			Interrupted:           true,
			ExecutionCompleteAtMs: exec.CompleteAt,
		})
		return actionID
	}
	return ""
}

func (ctx *RunContext) InterruptExecutions(actor uint8, status uint16, nowMs int64) model.ErrCode {
	return model.ErrOK
}

func hasStatusTick(status compilebundle.CompiledStatus) bool {
	return status.TickIntervalMs > 0 && status.TickCount > 0 && (status.TickEffect == compilebundle.EffectDealDamage || status.TickEffect == compilebundle.EffectHeal)
}
