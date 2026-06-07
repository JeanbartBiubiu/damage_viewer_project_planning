package runtime

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

// Step 从堆弹出至多 maxEvents 个事件；队列空或达 StopMaxEvents 时 EmitDone。
// 返回 ErrOK 不代表 run 结束，需结合 More() 与 engine_step 返回值判断。
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

// dispatch 是 scheduler 事件到机制处理的唯一 switch；新增 EventKind 必须在此注册。
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
	case scheduler.EventStatusTick:
		return ctx.onStatusTick(ev)
	case scheduler.EventActionComplete:
		return ctx.onActionComplete(ev)
	default:
		return model.ErrUnsupported
	}
}

func (ctx *RunContext) EmitDone(reason string) {
	if ctx.Done {
		return
	}
	ctx.Done = true
	payload := model.DonePayload{
		StopReason: reason, FinalTimeMs: ctx.NowMs, ProcessedEvents: ctx.ProcessedEvents,
		QueuePeak: ctx.Queue.Peak, ChainDepthPeak: ctx.ChainDepthPeak, TickEmitCount: ctx.TickEmitCount,
		Actors: ctx.snapshots(), Logs: ctx.Logs, ActionResults: ctx.ActionResults,
		TickResults: ctx.TickResults, TriggerResults: ctx.TriggerResults, RNG: ctx.RNG.Draws(),
	}
	ctx.Outbox.WriteJSON(model.FrameKindDone, payload)
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
