// 本文件实现单次 run 的 1v1 战斗运行时、事件派发、基础效果解析和 outbox 输出。
package runtime

import (
	"math"

	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/attribute"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/history"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/resource"
	"tinygo_engine_v2/internal/scheduler"
)

const (
	statusArenaCap = 128
	shieldArenaCap = 64
)

type ActorRuntime struct {
	ActorID     string
	Template    uint8
	HP          float64
	MaxHP       float64
	Attrs       attribute.Store
	Resources   resource.Store
	DamageTaken history.Window
	Pending     PendingIntent
}

type PendingIntent struct {
	Active bool
	Target uint8
	Action uint16
}

type StatusInstance struct {
	Alive      bool
	Generation uint16
	Actor      uint8
	Def        uint16
	ExpireAt   int64
}

type ShieldInstance struct {
	Alive      bool
	Generation uint16
	Actor      uint8
	Kind       string
	Amount     float64
	ExpireAt   int64
}

type RunContext struct {
	Bundle          compilebundle.CompiledBundle
	Actors          [2]ActorRuntime
	Pair            history.PairState
	Queue           scheduler.Heap
	RNG             RNG
	Statuses        [statusArenaCap]StatusInstance
	Shields         [shieldArenaCap]ShieldInstance
	Outbox          *abi.Outbox
	Logs            []model.LogEntry
	NowMs           int64
	ProcessedEvents int
	ChainDepthPeak  int
	TickEmitCount   int
	StopMaxEvents   int
	Done            bool
	aborted         bool
	trace           model.TraceOptions
}

type StepStatus struct {
	Code    model.ErrCode
	Message string
	Details []string
}

func NewRunContext(bundle compilebundle.CompiledBundle, input model.EngineRunInput, outbox *abi.Outbox) (*RunContext, *model.ErrorPayload) {
	selfTemplate, ok := bundle.ActorIndex[input.Self.TemplateID]
	if !ok {
		return nil, &model.ErrorPayload{Code: model.ErrUnknownActor, Message: "unknown self template: " + input.Self.TemplateID}
	}
	enemyTemplate, ok := bundle.ActorIndex[input.Enemy.TemplateID]
	if !ok {
		return nil, &model.ErrorPayload{Code: model.ErrUnknownActor, Message: "unknown enemy template: " + input.Enemy.TemplateID}
	}
	ctx := &RunContext{
		Bundle:        bundle,
		Queue:         scheduler.NewHeap(64),
		RNG:           NewRNG(input.Seed),
		Outbox:        outbox,
		Logs:          make([]model.LogEntry, 0, 64),
		StopMaxEvents: input.StopCondition.MaxEvents,
		trace:         input.Trace,
	}
	if ctx.StopMaxEvents <= 0 {
		ctx.StopMaxEvents = bundle.Settings.MaxEvents
	}
	ctx.Actors[0] = actorFrom(bundle, bundle.Actors[selfTemplate], input.Self.ActorID, selfTemplate)
	ctx.Actors[1] = actorFrom(bundle, bundle.Actors[enemyTemplate], input.Enemy.ActorID, enemyTemplate)
	for _, statusID := range input.Self.StatusIDs {
		idx, ok := bundle.StatusIndex[statusID]
		if !ok {
			return nil, &model.ErrorPayload{Code: model.ErrUnknownStatus, Message: "unknown initial self status: " + statusID}
		}
		if code := ctx.applyStatus(0, idx); code != model.ErrOK {
			return nil, &model.ErrorPayload{Code: code, Message: "failed to apply initial self status"}
		}
	}
	for _, statusID := range input.Enemy.StatusIDs {
		idx, ok := bundle.StatusIndex[statusID]
		if !ok {
			return nil, &model.ErrorPayload{Code: model.ErrUnknownStatus, Message: "unknown initial enemy status: " + statusID}
		}
		if code := ctx.applyStatus(1, idx); code != model.ErrOK {
			return nil, &model.ErrorPayload{Code: code, Message: "failed to apply initial enemy status"}
		}
	}
	for _, req := range input.InitialActions {
		source, target, action, err := ctx.resolveAction(req)
		if err != nil {
			return nil, err
		}
		code := ctx.Queue.Push(scheduler.Event{
			TimeMs: req.TriggerAtMs, Priority: 10, Kind: scheduler.EventCastIntent,
			Source: source, Target: target, Action: action,
		})
		if code != model.ErrOK {
			return nil, &model.ErrorPayload{Code: code, Message: "failed to queue initial action"}
		}
	}
	return ctx, nil
}

func actorFrom(bundle compilebundle.CompiledBundle, template compilebundle.CompiledActor, actorID string, templateID uint8) ActorRuntime {
	hp := template.InitialHP
	if hp <= 0 {
		hp = template.MaxHP
	}
	attrDefs := make([]attribute.AttributeDefinition, 0, len(bundle.Attrs))
	for i, def := range bundle.Attrs {
		value := template.Attributes[i]
		maxValue := value.Max
		if !value.HasMax {
			maxValue = value.Base
		}
		current := value.Current
		if !value.HasCurrent {
			current = maxValue
		}
		attrDefs = append(attrDefs, attribute.AttributeDefinition{
			ID: def.ID, Base: value.Base, Max: maxValue, Current: current,
		})
	}
	resourceSlots := make([]resource.Slot, 0, len(bundle.Resources))
	for i, def := range bundle.Resources {
		value := template.Resources[i]
		resourceSlots = append(resourceSlots, resource.Slot{ID: def.ID, Current: value.Current, Max: value.Max})
	}
	attrs := attribute.NewStore(attrDefs)
	attrs.ResolveAll(0)
	return ActorRuntime{
		ActorID: actorID, Template: templateID, HP: hp, MaxHP: template.MaxHP,
		Attrs:       attrs,
		Resources:   resource.NewStore(resourceSlots),
		DamageTaken: history.NewWindow(128),
	}
}

func (ctx *RunContext) Step(maxEvents int) StepStatus {
	if maxEvents <= 0 {
		maxEvents = 64
	}
	handled := 0
	for handled < maxEvents && !ctx.Done {
		if ctx.aborted {
			ctx.EmitDone("cancelled")
			return StepStatus{Code: model.ErrOK}
		}
		ev, ok := ctx.Queue.Pop()
		if !ok {
			ctx.EmitDone("queue_empty")
			return StepStatus{Code: model.ErrOK}
		}
		ctx.NowMs = ev.TimeMs
		if int(ev.ChainDepth) > ctx.ChainDepthPeak {
			ctx.ChainDepthPeak = int(ev.ChainDepth)
		}
		code := ctx.dispatch(ev)
		if code != model.ErrOK {
			return StepStatus{Code: code, Message: "event dispatch failed"}
		}
		ctx.ProcessedEvents++
		handled++
		if ctx.StopMaxEvents > 0 && ctx.ProcessedEvents >= ctx.StopMaxEvents {
			ctx.EmitDone("max_events")
		}
	}
	if !ctx.Done {
		ctx.emitSample()
	}
	return StepStatus{Code: model.ErrOK}
}

func (ctx *RunContext) More() bool {
	return !ctx.Done && ctx.Queue.Len() > 0
}

func (ctx *RunContext) Abort() {
	ctx.aborted = true
}

func (ctx *RunContext) dispatch(ev scheduler.Event) model.ErrCode {
	switch ev.Kind {
	case scheduler.EventCastIntent:
		return ctx.onCastIntent(ev)
	case scheduler.EventStatusExpire:
		return ctx.onStatusExpire(ev)
	case scheduler.EventShieldExpire:
		return ctx.onShieldExpire(ev)
	case scheduler.EventIntentRecheck:
		return ctx.onIntentRecheck(ev)
	default:
		return model.ErrUnsupported
	}
}

func (ctx *RunContext) onCastIntent(ev scheduler.Event) model.ErrCode {
	if ctx.isActionBlocked(ev.Source) {
		ctx.Actors[ev.Source].Pending = PendingIntent{Active: true, Target: ev.Target, Action: ev.Action}
		ctx.log("action_blocked", ev.Source, ev.Target, ev.Action, 0, 0, "pending intent stored")
		return model.ErrOK
	}
	action := ctx.Bundle.Actions[ev.Action]
	if action.RequiresMark != "" && !ctx.Pair.HasMark(action.RequiresMark) {
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, 0, 0, "required mark missing")
		return model.ErrOK
	}
	if action.ConsumesMark && action.RequiresMark != "" {
		ctx.Pair.ConsumeMark(action.RequiresMark)
	}
	ctx.log("action_cast", ev.Source, ev.Target, ev.Action, 0, 0, "")
	if code := ctx.fireTriggers(compilebundle.TriggerOnActionCast, ev.Source, ev.Target, 0, ev.ChainDepth); code != model.ErrOK {
		return code
	}
	for _, effect := range action.Effects {
		if code := ctx.applyEffect(effect, ev.Source, ev.Target, ev.ChainDepth); code != model.ErrOK {
			return code
		}
	}
	return model.ErrOK
}

func (ctx *RunContext) applyEffect(effect compilebundle.CompiledEffect, source uint8, target uint8, chainDepth uint8) model.ErrCode {
	actualSource := roleActor(effect.SourceRole, source, target)
	actualTarget := roleActor(effect.TargetRole, source, target)
	switch effect.Type {
	case compilebundle.EffectDealDamage:
		amount, code := ctx.effectAmount(effect, actualSource, actualTarget, 0)
		if code != model.ErrOK {
			return code
		}
		return ctx.dealDamage(actualSource, actualTarget, amount, effect.DamageType, chainDepth)
	case compilebundle.EffectDamageFromRecent:
		amount := ctx.Actors[actualSource].DamageTaken.Sum(ctx.NowMs, effect.HistoryWindowMs)
		if effect.Amount != 0 {
			amount *= effect.Amount
		}
		return ctx.dealDamage(actualSource, actualTarget, amount, effect.DamageType, chainDepth)
	case compilebundle.EffectHeal:
		amount, code := ctx.effectAmount(effect, actualSource, actualTarget, 0)
		if code != model.ErrOK {
			return code
		}
		ctx.Actors[actualTarget].HP = math.Min(ctx.Actors[actualTarget].MaxHP, ctx.Actors[actualTarget].HP+amount)
		ctx.log("heal", actualSource, actualTarget, 0, 0, amount, "")
	case compilebundle.EffectApplyStatus:
		return ctx.applyStatus(actualTarget, effect.Status)
	case compilebundle.EffectGrantShield:
		amount, code := ctx.effectAmount(effect, actualSource, actualTarget, 0)
		if code != model.ErrOK {
			return code
		}
		return ctx.grantShield(actualTarget, effect.Status, amount)
	case compilebundle.EffectApplyMark:
		ctx.Pair.AddMark(effect.MarkID)
		ctx.log("mark_apply", actualSource, actualTarget, 0, 0, 0, effect.MarkID)
	case compilebundle.EffectConsumeMark:
		ctx.Pair.ConsumeMark(effect.MarkID)
		ctx.log("mark_consume", actualSource, actualTarget, 0, 0, 0, effect.MarkID)
	default:
		return model.ErrUnsupported
	}
	return model.ErrOK
}

func (ctx *RunContext) effectAmount(effect compilebundle.CompiledEffect, source uint8, target uint8, input float64) (float64, model.ErrCode) {
	if effect.HasFormula {
		ctx.Actors[source].Attrs.ResolveAll(ctx.NowMs)
		ctx.Actors[target].Attrs.ResolveAll(ctx.NowMs)
		value, err := ctx.Bundle.Formulas.Eval(effect.Formula, formula.EvalContext{
			SourceAttrs: &ctx.Actors[source].Attrs,
			TargetAttrs: &ctx.Actors[target].Attrs,
			Resources:   &ctx.Actors[source].Resources,
			Input:       input,
		})
		if err != nil {
			return 0, model.ErrNumeric
		}
		return value, model.ErrOK
	}
	return effect.Amount, model.ErrOK
}

func (ctx *RunContext) dealDamage(source uint8, target uint8, amount float64, damageType string, chainDepth uint8) model.ErrCode {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return model.ErrNumeric
	}
	remaining := ctx.consumeShields(target, amount, damageType)
	ctx.Actors[target].HP -= remaining
	if ctx.Actors[target].HP < 0 {
		ctx.Actors[target].HP = 0
	}
	ctx.Actors[target].DamageTaken.Add(ctx.NowMs, remaining)
	ctx.log("damage", source, target, 0, 0, remaining, damageType)
	if code := ctx.fireTriggers(compilebundle.TriggerOnDamageDealt, source, target, remaining, chainDepth); code != model.ErrOK {
		return code
	}
	if code := ctx.fireTriggers(compilebundle.TriggerOnDamageTaken, source, target, remaining, chainDepth); code != model.ErrOK {
		return code
	}
	if ctx.Actors[target].HP <= 0 {
		ctx.EmitDone("actor_dead")
	}
	return model.ErrOK
}

func (ctx *RunContext) fireTriggers(event compilebundle.TriggerEvent, source uint8, target uint8, damage float64, chainDepth uint8) model.ErrCode {
	if chainDepth > 0 {
		return model.ErrOK
	}
	count := 0
	for _, trigger := range ctx.Bundle.Triggers {
		if trigger.Event != event {
			continue
		}
		if trigger.RequiresDamage && damage <= 0 {
			continue
		}
		count += len(trigger.Effects)
		if count > ctx.Bundle.Settings.MaxCommandsPerEvent {
			return model.ErrUnsupported
		}
		for _, effect := range trigger.Effects {
			if code := ctx.applyEffect(effect, source, target, chainDepth+1); code != model.ErrOK {
				return code
			}
		}
	}
	return model.ErrOK
}

func (ctx *RunContext) applyStatus(actor uint8, statusID uint16) model.ErrCode {
	status := ctx.Bundle.Statuses[statusID]
	if status.Kind == "shield" {
		amount := status.Magnitude
		return ctx.grantShield(actor, statusID, amount)
	}
	for i := range ctx.Statuses {
		if !ctx.Statuses[i].Alive {
			ctx.Statuses[i].Alive = true
			ctx.Statuses[i].Generation++
			ctx.Statuses[i].Actor = actor
			ctx.Statuses[i].Def = statusID
			ctx.Statuses[i].ExpireAt = ctx.NowMs + status.DurationMs
			handle := scheduler.Handle{Index: uint16(i), Generation: ctx.Statuses[i].Generation}
			if status.DurationMs > 0 {
				code := ctx.Queue.Push(scheduler.Event{
					TimeMs: ctx.Statuses[i].ExpireAt, Priority: 1, Kind: scheduler.EventStatusExpire, Source: actor, Target: actor, Status: handle,
				})
				if code != model.ErrOK {
					return code
				}
			}
			ctx.log("status_apply", actor, actor, 0, statusID, 0, "")
			return model.ErrOK
		}
	}
	return model.ErrArenaFull
}

func (ctx *RunContext) grantShield(actor uint8, statusID uint16, amount float64) model.ErrCode {
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
			ctx.log("shield_apply", actor, actor, 0, statusID, amount, ctx.Shields[i].Kind)
			return model.ErrOK
		}
	}
	return model.ErrArenaFull
}

func (ctx *RunContext) consumeShields(actor uint8, amount float64, damageType string) float64 {
	remaining := amount
	for i := range ctx.Shields {
		if remaining <= 0 {
			break
		}
		shield := &ctx.Shields[i]
		if !shield.Alive || shield.Actor != actor || !shieldMatches(shield.Kind, damageType) {
			continue
		}
		used := math.Min(shield.Amount, remaining)
		shield.Amount -= used
		remaining -= used
		ctx.log("shield_absorb", actor, actor, 0, 0, used, shield.Kind)
		if shield.Amount <= 0 {
			shield.Alive = false
		}
	}
	return remaining
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
	def := ctx.Bundle.Statuses[status.Def]
	ctx.log("status_expire", status.Actor, status.Actor, 0, status.Def, 0, "")
	if def.BlocksActions && ctx.Actors[status.Actor].Pending.Active {
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

func (ctx *RunContext) isActionBlocked(actor uint8) bool {
	for i := range ctx.Statuses {
		status := ctx.Statuses[i]
		if !status.Alive || status.Actor != actor {
			continue
		}
		if ctx.Bundle.Statuses[status.Def].BlocksActions {
			return true
		}
	}
	return false
}

func (ctx *RunContext) EmitDone(reason string) {
	if ctx.Done {
		return
	}
	ctx.Done = true
	payload := model.DonePayload{
		StopReason: reason, FinalTimeMs: ctx.NowMs, ProcessedEvents: ctx.ProcessedEvents,
		QueuePeak: ctx.Queue.Peak, ChainDepthPeak: ctx.ChainDepthPeak, TickEmitCount: ctx.TickEmitCount,
		Actors: ctx.snapshots(), Logs: ctx.Logs, RNG: ctx.RNG.Draws(),
	}
	ctx.Outbox.WriteJSON(model.FrameKindDone, payload)
}

func (ctx *RunContext) snapshots() []model.ActorSnapshot {
	return []model.ActorSnapshot{
		ctx.snapshot(0),
		ctx.snapshot(1),
	}
}

func (ctx *RunContext) snapshot(actor uint8) model.ActorSnapshot {
	ctx.Actors[actor].Attrs.ResolveAll(ctx.NowMs)
	attrs := make(map[string]model.AttributeSnapshotV2, len(ctx.Bundle.Attrs))
	for i, def := range ctx.Bundle.Attrs {
		slot := ctx.Actors[actor].Attrs.Slots[i]
		attrs[def.ID] = model.AttributeSnapshotV2{
			Base: slot.Base, Current: slot.Current, Max: slot.Max, Resolved: slot.Resolved,
		}
	}
	resources := make(map[string]model.ResourceValueV2, len(ctx.Bundle.Resources))
	for i, def := range ctx.Bundle.Resources {
		slot := ctx.Actors[actor].Resources.Slots[i]
		resources[def.ID] = model.ResourceValueV2{Current: slot.Current, Max: slot.Max}
	}
	return model.ActorSnapshot{
		ActorID: ctx.Actors[actor].ActorID, CurrentHP: ctx.Actors[actor].HP, MaxHP: ctx.Actors[actor].MaxHP,
		ShieldAmount: ctx.shieldTotal(actor), Attributes: attrs, Resources: resources,
	}
}

func (ctx *RunContext) shieldTotal(actor uint8) float64 {
	total := 0.0
	for _, shield := range ctx.Shields {
		if shield.Alive && shield.Actor == actor {
			total += shield.Amount
		}
	}
	return total
}

func (ctx *RunContext) emitSample() {
	if ctx.trace.SampleEvery <= 0 || ctx.ProcessedEvents%ctx.trace.SampleEvery != 0 {
		return
	}
	ctx.TickEmitCount++
	ctx.Outbox.WriteJSON(model.FrameKindSample, model.DonePayload{
		StopReason: "sample", FinalTimeMs: ctx.NowMs, ProcessedEvents: ctx.ProcessedEvents,
		QueuePeak: ctx.Queue.Peak, ChainDepthPeak: ctx.ChainDepthPeak, TickEmitCount: ctx.TickEmitCount,
		Actors: ctx.snapshots(),
	})
}

func (ctx *RunContext) log(kind string, source uint8, target uint8, action uint16, status uint16, amount float64, message string) {
	if !ctx.trace.EnableLogs {
		return
	}
	entry := model.LogEntry{TimeMs: ctx.NowMs, Kind: kind, SourceActorID: ctx.Actors[source].ActorID, TargetActorID: ctx.Actors[target].ActorID, Amount: amount, Message: message, Sequence: ctx.Queue.NextSeq()}
	if int(action) < len(ctx.Bundle.Actions) {
		entry.ActionID = ctx.Bundle.Actions[action].ID
	}
	if int(status) < len(ctx.Bundle.Statuses) {
		entry.StatusID = ctx.Bundle.Statuses[status].ID
	}
	ctx.Logs = append(ctx.Logs, entry)
	ctx.Outbox.WriteJSON(model.FrameKindLog, entry)
}

func (ctx *RunContext) resolveAction(req model.ActionRequest) (uint8, uint8, uint16, *model.ErrorPayload) {
	source := uint8(255)
	target := uint8(255)
	for i := range ctx.Actors {
		if ctx.Actors[i].ActorID == req.SourceActorID {
			source = uint8(i)
		}
		if ctx.Actors[i].ActorID == req.TargetActorID {
			target = uint8(i)
		}
	}
	if source == 255 || target == 255 {
		return 0, 0, 0, &model.ErrorPayload{Code: model.ErrUnknownActor, Message: "unknown run actor"}
	}
	action, ok := ctx.Bundle.ActionIndex[req.ActionID]
	if !ok {
		return 0, 0, 0, &model.ErrorPayload{Code: model.ErrUnknownAction, Message: "unknown action: " + req.ActionID}
	}
	return source, target, action, nil
}

func roleActor(role string, source uint8, target uint8) uint8 {
	if role == "target" {
		return target
	}
	if role == "source" || role == "" {
		return source
	}
	return target
}

func shieldMatches(kind string, damageType string) bool {
	return kind == "" || kind == "all" || kind == damageType
}
