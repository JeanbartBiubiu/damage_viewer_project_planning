package runtime

import (
	"math"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/resource"
	"tinygo_engine_v2/internal/scheduler"
)

// PerformCastAt 供 DPS 等竖切场景同步施法：不走堆，但复用 castIntentResult 与 effect 链。
func (ctx *RunContext) PerformCastAt(timeMs int64, source uint8, target uint8, action uint16) model.ActionRunResultV2 {
	wasDone := ctx.Done
	ctx.NowMs = timeMs
	ev := scheduler.Event{TimeMs: timeMs, Source: source, Target: target, Action: action}
	result, _, code := ctx.castIntentResult(ev)
	if code != model.ErrOK {
		result.BlockedReason = string(code)
	}
	ctx.Done = wasDone
	return result
}

func (ctx *RunContext) onCastIntent(ev scheduler.Event) model.ErrCode {
	result, executionHandle, code := ctx.castIntentResult(ev)
	if code != model.ErrOK {
		return code
	}
	if result.ExecutionStarted && !result.ExecutionCompleted {
		ctx.ActionResults = append(ctx.ActionResults, result)
		ctx.log("action_start", ev.Source, ev.Target, ev.Action, 0, 0, "")
		return ctx.Queue.Push(scheduler.Event{
			TimeMs: result.ExecutionCompleteAtMs, Priority: 5, Kind: scheduler.EventActionComplete,
			Source: ev.Source, Target: ev.Target, Action: ev.Action, Execution: executionHandle,
		})
	}
	ctx.ActionResults = append(ctx.ActionResults, result)
	return model.ErrOK
}

func (ctx *RunContext) castIntentResult(ev scheduler.Event) (model.ActionRunResultV2, scheduler.Handle, model.ErrCode) {
	result := ctx.newActionRunResult(ev)
	result.CooldownBefore = ctx.actionCooldownRunState(ev.Source, ev.Action)
	if int(ev.Action) < len(ctx.Bundle.Actions) {
		ctx.fillActionConditionState(&result, ctx.Bundle.Actions[ev.Action])
	}
	gate := ctx.CanCast(ev.Source, ev.Action, ctx.NowMs)
	if gate.Code != CastOK {
		result.BlockedReason = castBlockedReason(gate)
		result.BlockedRuleID = gate.RuleID
		result.BlockedStatusID = ctx.statusID(gate.StatusID)
		result.CooldownAfter = ctx.actionCooldownRunState(ev.Source, ev.Action)
		ctx.handleCastBlocked(ev, gate)
		return result, scheduler.Handle{}, model.ErrOK
	}
	action := ctx.Bundle.Actions[ev.Action]
	var executionHandle scheduler.Handle
	executionStarted := false
	if action.ChannelDurationMs > 0 {
		handle, ok := ctx.startExecution(ev.Source, ev.Target, ev.Action, ctx.NowMs+action.ChannelDurationMs)
		if !ok {
			result.BlockedReason = "execution_arena_full"
			result.CooldownAfter = ctx.actionCooldownRunState(ev.Source, ev.Action)
			return result, scheduler.Handle{}, model.ErrOK
		}
		executionHandle = handle
		executionStarted = true
	}
	resourceDeltas := ctx.actionResourceDeltasBefore(ev.Source, ev.Action)
	if !ctx.commitCastStart(ev.Source, ev.Action, ctx.NowMs) {
		if executionStarted {
			ctx.cancelExecution(executionHandle)
		}
		result.BlockedReason = "cast_commit_failed"
		result.CooldownAfter = ctx.actionCooldownRunState(ev.Source, ev.Action)
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, 0, 0, "cast commit failed")
		return result, scheduler.Handle{}, model.ErrOK
	}
	result.Accepted = true
	result.ResourceDeltas = ctx.actionResourceDeltasAfter(ev.Source, resourceDeltas)
	result.CooldownAfter = ctx.actionCooldownRunState(ev.Source, ev.Action)
	if action.ChannelDurationMs > 0 {
		result.ExecutionStarted = true
		result.ExecutionCompleteAtMs = ctx.NowMs + action.ChannelDurationMs
		return result, executionHandle, model.ErrOK
	}
	ctx.log("action_cast", ev.Source, ev.Target, ev.Action, 0, 0, "")
	if code := ctx.fireTriggers(compilebundle.TriggerOnActionCast, ev.Source, ev.Target, 0, ev.ChainDepth); code != model.ErrOK {
		return result, scheduler.Handle{}, code
	}
	actionInput := float64(ctx.actionSkillLevel(ev.Source, ev.Action))
	for index, effect := range action.Effects {
		if code := ctx.applyEffect(effect, ev.Source, ev.Target, ev.ChainDepth, actionInput, &result, index); code != model.ErrOK {
			return result, scheduler.Handle{}, code
		}
	}
	return result, scheduler.Handle{}, model.ErrOK
}

func (ctx *RunContext) startExecution(source uint8, target uint8, action uint16, completeAt int64) (scheduler.Handle, bool) {
	for i := range ctx.Executions {
		if ctx.Executions[i].Alive {
			continue
		}
		ctx.Executions[i].Alive = true
		ctx.Executions[i].Generation++
		ctx.Executions[i].Source = source
		ctx.Executions[i].Target = target
		ctx.Executions[i].Action = action
		ctx.Executions[i].CompleteAt = completeAt
		return scheduler.Handle{Index: uint16(i), Generation: ctx.Executions[i].Generation}, true
	}
	return scheduler.Handle{}, false
}

func (ctx *RunContext) cancelExecution(handle scheduler.Handle) {
	if int(handle.Index) >= len(ctx.Executions) {
		return
	}
	exec := &ctx.Executions[handle.Index]
	if exec.Alive && exec.Generation == handle.Generation {
		exec.Alive = false
	}
}

func (ctx *RunContext) onActionComplete(ev scheduler.Event) model.ErrCode {
	if int(ev.Execution.Index) >= len(ctx.Executions) {
		return model.ErrOK
	}
	exec := &ctx.Executions[ev.Execution.Index]
	if !exec.Alive || exec.Generation != ev.Execution.Generation {
		return model.ErrOK
	}
	exec.Alive = false
	result := ctx.newActionRunResult(scheduler.Event{TimeMs: ctx.NowMs, Source: exec.Source, Target: exec.Target, Action: exec.Action})
	result.Accepted = true
	result.ExecutionStarted = true
	result.ExecutionCompleted = true
	result.ExecutionCompleteAtMs = ctx.NowMs
	action := ctx.Bundle.Actions[exec.Action]
	ctx.log("action_complete", exec.Source, exec.Target, exec.Action, 0, 0, "")
	actionInput := float64(ctx.actionSkillLevel(exec.Source, exec.Action))
	for index, effect := range action.Effects {
		if code := ctx.applyEffect(effect, exec.Source, exec.Target, ev.ChainDepth, actionInput, &result, index); code != model.ErrOK {
			return code
		}
	}
	ctx.ActionResults = append(ctx.ActionResults, result)
	return model.ErrOK
}

// CanCast 是 action 门控唯一入口；分散校验会导致 snapshot 与 runtime 行为不一致。
func (ctx *RunContext) CanCast(actor uint8, action uint16, nowMs int64) CastGateResult {
	if int(action) >= len(ctx.Bundle.Actions) {
		return CastGateResult{Code: CastUnknownAction}
	}
	if !ctx.actorOwnsAction(actor, action) {
		return CastGateResult{Code: CastNotOwned}
	}
	if gate := ctx.blockedByStatus(actor, action, nowMs); gate.Code != CastOK {
		return gate
	}
	template := ctx.Bundle.Actions[action]
	if template.RequiresMark != "" && !ctx.Pair.HasMark(template.RequiresMark) {
		return CastGateResult{Code: CastMarkMissing}
	}
	if ok, reason := ctx.canSpendActionCosts(actor, action); !ok {
		return CastGateResult{Code: CastInsufficientResource, Reason: reason}
	}
	if int(action) >= len(ctx.Actors[actor].ActionState) {
		return CastGateResult{Code: CastCooldown}
	}
	state := ctx.Actors[actor].ActionState[action]
	if !state.Ready(nowMs) {
		return CastGateResult{Code: CastCooldown, RetryAtMs: state.ReadyAtMs}
	}
	return CastGateResult{Code: CastOK}
}

func (ctx *RunContext) actorOwnsAction(actor uint8, action uint16) bool {
	if int(actor) >= len(ctx.Actors) || int(action) >= len(ctx.Bundle.Actions) {
		return false
	}
	owned := ctx.Actors[actor].OwnsAction
	return int(action) < len(owned) && owned[action]
}

func (ctx *RunContext) blockedByStatus(actor uint8, action uint16, nowMs int64) CastGateResult {
	if int(action) >= len(ctx.Bundle.Actions) {
		return CastGateResult{Code: CastUnknownAction}
	}
	actionSet := ctx.Bundle.Actions[action].TypeSet
	for i := range ctx.Statuses {
		status := ctx.Statuses[i]
		if !status.Alive || status.Actor != actor {
			continue
		}
		statusSet := ctx.Bundle.Statuses[status.Def].TypeSet
		for _, rule := range ctx.Bundle.ControlRules.Rules {
			if rule.Kind != compilebundle.ControlRuleForbid {
				continue
			}
			if !rule.StatusMatcher.Match(statusSet) || !rule.ActionMatcher.Match(actionSet) || !rule.ActionTagMatcher.Match(actionSet) {
				continue
			}
			return CastGateResult{
				Code:           CastBlockedByStatus,
				RuleID:         rule.ID,
				StatusID:       status.Def,
				RetryOnRelease: rule.RetryOnRelease,
			}
		}
	}
	return CastGateResult{Code: CastOK}
}

func (ctx *RunContext) canSpendActionCosts(actor uint8, action uint16) (bool, string) {
	amounts, reason, ok := ctx.actionCostAmounts(actor, action)
	if !ok {
		return false, reason
	}
	costs := ctx.Bundle.Actions[action].Costs
	for i, cost := range costs {
		if int(cost.Resource) >= len(ctx.Actors[actor].Resources.Slots) {
			return false, "unknown resource"
		}
		if firstCostForResource(costs, i) != i {
			continue
		}
		total := 0.0
		for j, other := range costs {
			if other.Resource == cost.Resource {
				total += amounts[j]
			}
		}
		if !ctx.Actors[actor].Resources.Slots[cost.Resource].CanSpend(total) {
			return false, "insufficient resource"
		}
	}
	return true, ""
}

func firstCostForResource(costs []compilebundle.CompiledResourceCost, index int) int {
	resourceID := costs[index].Resource
	for i, cost := range costs {
		if cost.Resource == resourceID {
			return i
		}
	}
	return index
}

func (ctx *RunContext) commitCastStart(actor uint8, action uint16, nowMs int64) bool {
	if ok, _ := ctx.canSpendActionCosts(actor, action); !ok {
		return false
	}
	amounts, _, ok := ctx.actionCostAmounts(actor, action)
	if !ok {
		return false
	}
	costs := ctx.Bundle.Actions[action].Costs
	for i, cost := range costs {
		if int(cost.Resource) >= len(ctx.Actors[actor].Resources.Slots) {
			return false
		}
		if ctx.Actors[actor].Resources.Slots[cost.Resource].Spend(amounts[i]).Code != resource.ErrOK {
			return false
		}
	}
	template := ctx.Bundle.Actions[action]
	if template.ConsumesMark && template.RequiresMark != "" {
		ctx.Pair.ConsumeMark(template.RequiresMark)
	}
	if int(action) >= len(ctx.Actors[actor].ActionState) {
		return false
	}
	cooldownMs, ok := ctx.actionCooldownMs(actor, action)
	if !ok {
		return false
	}
	return ctx.Actors[actor].ActionState[action].Consume(nowMs, cooldownMs)
}

func (ctx *RunContext) actionCooldownMs(actor uint8, action uint16) (int64, bool) {
	if int(actor) >= len(ctx.Actors) || int(action) >= len(ctx.Bundle.Actions) {
		return 0, false
	}
	template := ctx.Bundle.Actions[action]
	if !template.HasCooldownFormula {
		if template.CooldownMs < 0 {
			return 0, false
		}
		return template.CooldownMs, true
	}
	value, _, ok := ctx.evalActionFormula(actor, actor, actor, action, template.CooldownFormula)
	if !ok || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return int64(math.Round(value)), true
}

func (ctx *RunContext) actionCooldownSnapshot(actor uint8, action uint16) (int64, string, []model.ActionValueBreakdownStepV2) {
	cooldownMs, ok := ctx.actionCooldownMs(actor, action)
	if !ok {
		return 0, "", nil
	}
	template := ctx.Bundle.Actions[action]
	if !template.HasCooldownFormula || int(template.CooldownFormula) >= len(ctx.Bundle.Formulas.Programs) {
		return cooldownMs, "", nil
	}
	_, steps, ok := ctx.evalActionFormula(actor, actor, actor, action, template.CooldownFormula)
	if !ok {
		return cooldownMs, ctx.Bundle.Formulas.Programs[template.CooldownFormula].ID, nil
	}
	return cooldownMs, ctx.Bundle.Formulas.Programs[template.CooldownFormula].ID, steps
}

func (ctx *RunContext) actionCooldownRunState(actor uint8, action uint16) model.ActionCooldownRunStateV2 {
	cooldownMs, formulaID, breakdown := ctx.actionCooldownSnapshot(actor, action)
	readyAtMs := int64(0)
	if int(actor) < len(ctx.Actors) && int(action) < len(ctx.Actors[actor].ActionState) {
		readyAtMs = ctx.Actors[actor].ActionState[action].ReadyAtMs
	}
	return model.ActionCooldownRunStateV2{
		CooldownMs:        cooldownMs,
		CooldownFormulaID: formulaID,
		CooldownBreakdown: breakdown,
		ReadyAtMs:         readyAtMs,
	}
}

func (ctx *RunContext) newActionRunResult(ev scheduler.Event) model.ActionRunResultV2 {
	result := model.ActionRunResultV2{TimeMs: ctx.NowMs}
	if int(ev.Source) < len(ctx.Actors) {
		result.SourceActorID = ctx.Actors[ev.Source].ActorID
	}
	if int(ev.Target) < len(ctx.Actors) {
		result.TargetActorID = ctx.Actors[ev.Target].ActorID
	}
	if int(ev.Action) < len(ctx.Bundle.Actions) {
		result.ActionID = ctx.Bundle.Actions[ev.Action].ID
	}
	return result
}

func (ctx *RunContext) fillActionConditionState(result *model.ActionRunResultV2, action compilebundle.CompiledAction) {
	if action.RequiresMark == "" {
		return
	}
	result.ConditionKind = "mark"
	result.ConditionID = action.RequiresMark
	result.ConditionPassed = ctx.Pair.HasMark(action.RequiresMark)
	result.HasCondition = true
}

func (ctx *RunContext) actionResourceDeltasBefore(actor uint8, action uint16) []model.ActionResourceDeltaV2 {
	if int(actor) >= len(ctx.Actors) || int(action) >= len(ctx.Bundle.Actions) {
		return nil
	}
	costs := ctx.Bundle.Actions[action].Costs
	if len(costs) == 0 {
		return nil
	}
	deltas := make([]model.ActionResourceDeltaV2, 0, len(costs))
	for index, cost := range costs {
		if firstCostForResource(costs, index) != index || int(cost.Resource) >= len(ctx.Bundle.Resources) || int(cost.Resource) >= len(ctx.Actors[actor].Resources.Slots) {
			continue
		}
		deltas = append(deltas, model.ActionResourceDeltaV2{
			ResourceID: ctx.Bundle.Resources[cost.Resource].ID,
			Before:     ctx.Actors[actor].Resources.Slots[cost.Resource].Current,
		})
	}
	return deltas
}

func (ctx *RunContext) actionResourceDeltasAfter(actor uint8, deltas []model.ActionResourceDeltaV2) []model.ActionResourceDeltaV2 {
	if int(actor) >= len(ctx.Actors) || len(deltas) == 0 {
		return nil
	}
	for index := range deltas {
		resourceID := deltas[index].ResourceID
		resourceIndex := -1
		for slotIndex, slot := range ctx.Actors[actor].Resources.Slots {
			if slot.ID == resourceID {
				resourceIndex = slotIndex
				break
			}
		}
		if resourceIndex < 0 {
			continue
		}
		deltas[index].After = ctx.Actors[actor].Resources.Slots[resourceIndex].Current
		deltas[index].Delta = deltas[index].After - deltas[index].Before
	}
	return deltas
}

func (ctx *RunContext) evalActionFormula(owner uint8, source uint8, target uint8, action uint16, formulaID formula.ProgramID) (float64, []model.ActionValueBreakdownStepV2, bool) {
	if int(owner) >= len(ctx.Actors) || int(source) >= len(ctx.Actors) || int(target) >= len(ctx.Actors) || int(action) >= len(ctx.Bundle.Actions) {
		return 0, nil, false
	}
	ctx.Actors[source].Attrs.ResolveAll(ctx.NowMs)
	ctx.Actors[target].Attrs.ResolveAll(ctx.NowMs)
	value, steps, err := ctx.Bundle.Formulas.EvalTrace(formulaID, formula.EvalContext{
		SourceAttrs: &ctx.Actors[source].Attrs,
		TargetAttrs: &ctx.Actors[target].Attrs,
		Resources:   &ctx.Actors[source].Resources,
		Counters:    ctx,
		Input:       float64(ctx.actionSkillLevel(owner, action)),
	})
	if err != nil {
		return 0, nil, false
	}
	return value, steps, true
}

func (ctx *RunContext) actionCostAmounts(actor uint8, action uint16) ([]float64, string, bool) {
	if int(actor) >= len(ctx.Actors) || int(action) >= len(ctx.Bundle.Actions) {
		return nil, "unknown action", false
	}
	costs := ctx.Bundle.Actions[action].Costs
	amounts := make([]float64, len(costs))
	for i, cost := range costs {
		amount := cost.Amount
		if cost.HasFormula {
			ctx.Actors[actor].Attrs.ResolveAll(ctx.NowMs)
			value, err := ctx.Bundle.Formulas.Eval(cost.Formula, formula.EvalContext{
				SourceAttrs: &ctx.Actors[actor].Attrs,
				TargetAttrs: &ctx.Actors[actor].Attrs,
				Resources:   &ctx.Actors[actor].Resources,
				Counters:    ctx,
				Input:       float64(ctx.actionSkillLevel(actor, action)),
			})
			if err != nil {
				return nil, "resource cost formula failed", false
			}
			amount = value
		}
		if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
			return nil, "invalid resource cost", false
		}
		amounts[i] = amount
	}
	return amounts, "", true
}

func (ctx *RunContext) handleCastBlocked(ev scheduler.Event, gate CastGateResult) {
	switch gate.Code {
	case CastBlockedByStatus:
		message := "blocked by status rule " + gate.RuleID
		if gate.RetryOnRelease {
			ctx.Actors[ev.Source].Pending = PendingIntent{Active: true, Target: ev.Target, Action: ev.Action}
			ctx.log("action_blocked", ev.Source, ev.Target, ev.Action, gate.StatusID, 0, message)
			return
		}
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, gate.StatusID, 0, message)
	case CastMarkMissing:
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, 0, 0, "required mark missing")
	case CastNotOwned:
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, 0, 0, "action not owned")
	case CastInsufficientResource:
		message := gate.Reason
		if message == "" {
			message = "insufficient resource"
		}
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, 0, 0, message)
	case CastCooldown:
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, 0, 0, "cooldown")
	default:
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, 0, 0, "unknown action")
	}
}

func castBlockedReason(gate CastGateResult) string {
	switch gate.Code {
	case CastOK:
		return ""
	case CastBlockedByStatus:
		if gate.RuleID != "" {
			return "blocked_by_status:" + gate.RuleID
		}
		return "blocked_by_status"
	case CastMarkMissing:
		return "required_mark_missing"
	case CastNotOwned:
		return "action_not_owned"
	case CastInsufficientResource:
		if gate.Reason != "" {
			return gate.Reason
		}
		return "insufficient_resource"
	case CastCooldown:
		return "cooldown"
	default:
		return "unknown_action"
	}
}
