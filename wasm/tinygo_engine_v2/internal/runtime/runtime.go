// 本文件实现单次 run 的 1v1 战斗运行时、事件派发、基础效果解析和 outbox 输出。
package runtime

import (
	"math"

	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/cadence"
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
	ActorID      string
	Template     uint8
	HP           float64
	MaxHP        float64
	Attrs        attribute.Store
	Resources    resource.Store
	DamageTaken  history.Window
	OwnsAction   []bool
	ActionState  []cadence.State
	ActionInputs []ActionInputState
	Pending      PendingIntent
}

type ActionInputState struct {
	SkillLevel  int
	PanelInputs map[string]float64
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
	ActionResults   []model.ActionRunResultV2
	NowMs           int64
	ProcessedEvents int
	ChainDepthPeak  int
	TickEmitCount   int
	StopMaxEvents   int
	Done            bool
	aborted         bool
	trace           model.TraceOptions
}

type CastBlockCode uint8

const (
	CastOK CastBlockCode = iota
	CastUnknownAction
	CastNotOwned
	CastBlockedByStatus
	CastMarkMissing
	CastInsufficientResource
	CastCooldown
)

type CastGateResult struct {
	Code           CastBlockCode
	RuleID         string
	StatusID       uint16
	RetryAtMs      int64
	RetryOnRelease bool
	Reason         string
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
		ActionResults: make([]model.ActionRunResultV2, 0, 8),
		StopMaxEvents: input.StopCondition.MaxEvents,
		trace:         input.Trace,
	}
	if ctx.StopMaxEvents <= 0 {
		ctx.StopMaxEvents = bundle.Settings.MaxEvents
	}
	ctx.Actors[0] = actorFrom(bundle, bundle.Actors[selfTemplate], input.Self, selfTemplate)
	ctx.Actors[1] = actorFrom(bundle, bundle.Actors[enemyTemplate], input.Enemy, enemyTemplate)
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

func actorFrom(bundle compilebundle.CompiledBundle, template compilebundle.CompiledActor, input model.CombatantRunInit, templateID uint8) ActorRuntime {
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
	ownsAction := make([]bool, len(bundle.Actions))
	for _, action := range template.Actions {
		if int(action) < len(ownsAction) {
			ownsAction[action] = true
		}
	}
	return ActorRuntime{
		ActorID:      input.ActorID,
		Template:     templateID,
		HP:           hp,
		MaxHP:        template.MaxHP,
		Attrs:        attrs,
		Resources:    resource.NewStore(resourceSlots),
		DamageTaken:  history.NewWindow(128),
		OwnsAction:   ownsAction,
		ActionState:  make([]cadence.State, len(bundle.Actions)),
		ActionInputs: actionInputsFrom(bundle, template, input.ActionInputs),
	}
}

func actionInputsFrom(bundle compilebundle.CompiledBundle, template compilebundle.CompiledActor, overrides map[string]model.ActionRunInput) []ActionInputState {
	inputs := make([]ActionInputState, len(bundle.Actions))
	for _, actionID := range template.Actions {
		if int(actionID) >= len(bundle.Actions) {
			continue
		}
		action := bundle.Actions[actionID]
		inputs[actionID] = ActionInputState{
			SkillLevel:  defaultSkillLevel(action.SkillLevel),
			PanelInputs: copyFloatMap(action.PanelInputs),
		}
		if override, ok := overrides[action.ID]; ok {
			if override.SkillLevel > 0 {
				inputs[actionID].SkillLevel = override.SkillLevel
			}
			if len(override.PanelInputs) > 0 {
				inputs[actionID].PanelInputs = mergeFloatMaps(inputs[actionID].PanelInputs, override.PanelInputs)
			}
		}
	}
	return inputs
}

func defaultSkillLevel(value int) int {
	if value > 0 {
		return value
	}
	return 1
}

func (ctx *RunContext) actionSkillLevel(actor uint8, action uint16) int {
	if int(actor) >= len(ctx.Actors) || int(action) >= len(ctx.Actors[actor].ActionInputs) {
		return 1
	}
	return defaultSkillLevel(ctx.Actors[actor].ActionInputs[action].SkillLevel)
}

func (ctx *RunContext) actionPanelInputs(actor uint8, action uint16) map[string]float64 {
	if int(actor) >= len(ctx.Actors) || int(action) >= len(ctx.Actors[actor].ActionInputs) {
		return nil
	}
	return copyFloatMap(ctx.Actors[actor].ActionInputs[action].PanelInputs)
}

func copyFloatMap(input map[string]float64) map[string]float64 {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]float64, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func mergeFloatMaps(base map[string]float64, overrides map[string]float64) map[string]float64 {
	merged := copyFloatMap(base)
	if len(merged) == 0 {
		merged = make(map[string]float64, len(overrides))
	}
	for key, value := range overrides {
		merged[key] = value
	}
	return merged
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
	result := ctx.newActionRunResult(ev)
	gate := ctx.CanCast(ev.Source, ev.Action, ctx.NowMs)
	if gate.Code != CastOK {
		result.BlockedReason = castBlockedReason(gate)
		ctx.ActionResults = append(ctx.ActionResults, result)
		ctx.handleCastBlocked(ev, gate)
		return model.ErrOK
	}
	resourceDeltas := ctx.actionResourceDeltasBefore(ev.Source, ev.Action)
	result.CooldownBefore = ctx.actionCooldownRunState(ev.Source, ev.Action)
	if !ctx.commitCastStart(ev.Source, ev.Action, ctx.NowMs) {
		result.BlockedReason = "cast_commit_failed"
		ctx.ActionResults = append(ctx.ActionResults, result)
		ctx.log("action_dropped", ev.Source, ev.Target, ev.Action, 0, 0, "cast commit failed")
		return model.ErrOK
	}
	result.Accepted = true
	result.ResourceDeltas = ctx.actionResourceDeltasAfter(ev.Source, resourceDeltas)
	result.CooldownAfter = ctx.actionCooldownRunState(ev.Source, ev.Action)
	action := ctx.Bundle.Actions[ev.Action]
	ctx.log("action_cast", ev.Source, ev.Target, ev.Action, 0, 0, "")
	if code := ctx.fireTriggers(compilebundle.TriggerOnActionCast, ev.Source, ev.Target, 0, ev.ChainDepth); code != model.ErrOK {
		return code
	}
	actionInput := float64(ctx.actionSkillLevel(ev.Source, ev.Action))
	for index, effect := range action.Effects {
		if code := ctx.applyEffect(effect, ev.Source, ev.Target, ev.ChainDepth, actionInput, &result, index); code != model.ErrOK {
			return code
		}
	}
	ctx.ActionResults = append(ctx.ActionResults, result)
	return model.ErrOK
}

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

func (ctx *RunContext) applyEffect(effect compilebundle.CompiledEffect, source uint8, target uint8, chainDepth uint8, input float64, actionResult *model.ActionRunResultV2, effectIndex int) model.ErrCode {
	actualSource := roleActor(effect.SourceRole, source, target)
	actualTarget := roleActor(effect.TargetRole, source, target)
	switch effect.Type {
	case compilebundle.EffectDealDamage:
		amount, formulaID, breakdown, code := ctx.effectAmountTrace(effect, actualSource, actualTarget, input)
		if code != model.ErrOK {
			return code
		}
		hpBefore := ctx.Actors[actualTarget].HP
		finalDamage, code := ctx.dealDamageResult(actualSource, actualTarget, amount, effect.DamageType, chainDepth)
		if actionResult != nil {
			actionResult.Effects = append(actionResult.Effects, model.ActionEffectRunResultV2{
				EffectIndex:      effectIndex,
				Kind:             string(model.EffectTypeDealDamage),
				FormulaID:        formulaID,
				FormulaBreakdown: breakdown,
				RawAmount:        amount,
				HasRawAmount:     true,
				DamageType:       effect.DamageType,
				FinalDamage:      finalDamage,
				HasFinalDamage:   true,
				TargetHPBefore:   hpBefore,
				TargetHPAfter:    ctx.Actors[actualTarget].HP,
				SourceActorID:    ctx.Actors[actualSource].ActorID,
				TargetActorID:    ctx.Actors[actualTarget].ActorID,
			})
		}
		return code
	case compilebundle.EffectDamageFromRecent:
		amount := ctx.Actors[actualSource].DamageTaken.Sum(ctx.NowMs, effect.HistoryWindowMs)
		if effect.Amount != 0 {
			amount *= effect.Amount
		}
		hpBefore := ctx.Actors[actualTarget].HP
		finalDamage, code := ctx.dealDamageResult(actualSource, actualTarget, amount, effect.DamageType, chainDepth)
		if actionResult != nil {
			actionResult.Effects = append(actionResult.Effects, model.ActionEffectRunResultV2{
				EffectIndex:    effectIndex,
				Kind:           string(model.EffectTypeDamageFromRecent),
				RawAmount:      amount,
				HasRawAmount:   true,
				DamageType:     effect.DamageType,
				FinalDamage:    finalDamage,
				HasFinalDamage: true,
				TargetHPBefore: hpBefore,
				TargetHPAfter:  ctx.Actors[actualTarget].HP,
				SourceActorID:  ctx.Actors[actualSource].ActorID,
				TargetActorID:  ctx.Actors[actualTarget].ActorID,
			})
		}
		return code
	case compilebundle.EffectHeal:
		amount, code := ctx.effectAmount(effect, actualSource, actualTarget, input)
		if code != model.ErrOK {
			return code
		}
		ctx.Actors[actualTarget].HP = math.Min(ctx.Actors[actualTarget].MaxHP, ctx.Actors[actualTarget].HP+amount)
		ctx.log("heal", actualSource, actualTarget, 0, 0, amount, "")
	case compilebundle.EffectApplyStatus:
		return ctx.applyStatus(actualTarget, effect.Status)
	case compilebundle.EffectGrantShield:
		amount, code := ctx.effectAmount(effect, actualSource, actualTarget, input)
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

func (ctx *RunContext) effectAmountTrace(effect compilebundle.CompiledEffect, source uint8, target uint8, input float64) (float64, string, []model.ActionValueBreakdownStepV2, model.ErrCode) {
	if effect.HasFormula {
		ctx.Actors[source].Attrs.ResolveAll(ctx.NowMs)
		ctx.Actors[target].Attrs.ResolveAll(ctx.NowMs)
		value, steps, err := ctx.Bundle.Formulas.EvalTrace(effect.Formula, formula.EvalContext{
			SourceAttrs: &ctx.Actors[source].Attrs,
			TargetAttrs: &ctx.Actors[target].Attrs,
			Resources:   &ctx.Actors[source].Resources,
			Input:       input,
		})
		if err != nil {
			return 0, "", nil, model.ErrNumeric
		}
		formulaID := ""
		if int(effect.Formula) < len(ctx.Bundle.Formulas.Programs) {
			formulaID = ctx.Bundle.Formulas.Programs[effect.Formula].ID
		}
		return value, formulaID, steps, model.ErrOK
	}
	return effect.Amount, "", nil, model.ErrOK
}

func (ctx *RunContext) dealDamage(source uint8, target uint8, amount float64, damageType string, chainDepth uint8) model.ErrCode {
	_, code := ctx.dealDamageResult(source, target, amount, damageType, chainDepth)
	return code
}

func (ctx *RunContext) dealDamageResult(source uint8, target uint8, amount float64, damageType string, chainDepth uint8) (float64, model.ErrCode) {
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, model.ErrNumeric
	}
	hpBefore := ctx.Actors[target].HP
	remaining := ctx.consumeShields(target, amount, damageType)
	ctx.Actors[target].HP -= remaining
	if ctx.Actors[target].HP < 0 {
		ctx.Actors[target].HP = 0
	}
	appliedDamage := hpBefore - ctx.Actors[target].HP
	ctx.Actors[target].DamageTaken.Add(ctx.NowMs, remaining)
	ctx.log("damage", source, target, 0, 0, remaining, damageType)
	if code := ctx.fireTriggers(compilebundle.TriggerOnDamageDealt, source, target, remaining, chainDepth); code != model.ErrOK {
		return appliedDamage, code
	}
	if code := ctx.fireTriggers(compilebundle.TriggerOnDamageTaken, source, target, remaining, chainDepth); code != model.ErrOK {
		return appliedDamage, code
	}
	if ctx.Actors[target].HP <= 0 {
		ctx.EmitDone("actor_dead")
	}
	return appliedDamage, model.ErrOK
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
			if code := ctx.applyEffect(effect, source, target, chainDepth+1, 0, nil, -1); code != model.ErrOK {
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

func (ctx *RunContext) InterruptExecutions(actor uint8, status uint16, nowMs int64) model.ErrCode {
	return model.ErrOK
}

func (ctx *RunContext) EmitDone(reason string) {
	if ctx.Done {
		return
	}
	ctx.Done = true
	payload := model.DonePayload{
		StopReason: reason, FinalTimeMs: ctx.NowMs, ProcessedEvents: ctx.ProcessedEvents,
		QueuePeak: ctx.Queue.Peak, ChainDepthPeak: ctx.ChainDepthPeak, TickEmitCount: ctx.TickEmitCount,
		Actors: ctx.snapshots(), Logs: ctx.Logs, ActionResults: ctx.ActionResults, RNG: ctx.RNG.Draws(),
	}
	ctx.Outbox.WriteJSON(model.FrameKindDone, payload)
}

func (ctx *RunContext) snapshots() []model.ActorSnapshot {
	return []model.ActorSnapshot{
		ctx.snapshot(0),
		ctx.snapshot(1),
	}
}

func (ctx *RunContext) actionSnapshots() []model.ActorActionSnapshotV2 {
	return []model.ActorActionSnapshotV2{
		ctx.actionSnapshot(0),
		ctx.actionSnapshot(1),
	}
}

func (ctx *RunContext) actionSnapshot(actor uint8) model.ActorActionSnapshotV2 {
	if int(actor) >= len(ctx.Actors) {
		return model.ActorActionSnapshotV2{}
	}
	templateID := ctx.Actors[actor].Template
	if int(templateID) >= len(ctx.Bundle.Actors) {
		return model.ActorActionSnapshotV2{ActorID: ctx.Actors[actor].ActorID}
	}
	template := ctx.Bundle.Actors[templateID]
	actions := make([]model.ActionInitialStateV2, 0, len(template.Actions))
	for _, actionID := range template.Actions {
		if int(actionID) >= len(ctx.Bundle.Actions) {
			continue
		}
		action := ctx.Bundle.Actions[actionID]
		gate := ctx.CanCast(actor, actionID, ctx.NowMs)
		cooldownMs, cooldownFormulaID, cooldownBreakdown := ctx.actionCooldownSnapshot(actor, actionID)
		readyAtMs := int64(0)
		if int(actionID) < len(ctx.Actors[actor].ActionState) {
			readyAtMs = ctx.Actors[actor].ActionState[actionID].ReadyAtMs
		}
		actions = append(actions, model.ActionInitialStateV2{
			ActionID:          action.ID,
			Label:             action.Label,
			SkillLevel:        ctx.actionSkillLevel(actor, actionID),
			PanelInputs:       ctx.actionPanelInputs(actor, actionID),
			CooldownMs:        cooldownMs,
			CooldownFormulaID: cooldownFormulaID,
			CooldownBreakdown: cooldownBreakdown,
			ReadyAtMs:         readyAtMs,
			CanCast:           gate.Code == CastOK,
			BlockedReason:     castBlockedReason(gate),
			ResourceCosts:     ctx.actionCostSnapshotRows(actor, actionID),
			EffectRows:        ctx.actionEffectSnapshotRows(actor, actionID),
		})
	}
	return model.ActorActionSnapshotV2{
		ActorID: ctx.Actors[actor].ActorID,
		Actions: actions,
	}
}

func (ctx *RunContext) actionCostSnapshotRows(actor uint8, action uint16) []model.ActionCostSnapshotV2 {
	compiled := ctx.Bundle.Actions[action]
	if len(compiled.PanelCosts) > 0 {
		rows := make([]model.ActionCostSnapshotV2, 0, len(compiled.PanelCosts))
		for _, cost := range compiled.PanelCosts {
			amount := cost.Amount
			breakdown := []model.ActionValueBreakdownStepV2(nil)
			if cost.HasFormula {
				value, steps, ok := ctx.evalActionFormula(actor, actor, actor, action, cost.Formula)
				if ok {
					amount = value
					breakdown = steps
				}
			}
			rows = append(rows, model.ActionCostSnapshotV2{
				ResourceID:  cost.ResourceID,
				FormulaID:   cost.FormulaID,
				Amount:      amount,
				Source:      "panel",
				BaseAmount:  cost.Amount,
				FinalAmount: amount,
				Breakdown:   breakdown,
			})
		}
		return rows
	}
	amounts, _, ok := ctx.actionCostAmounts(actor, action)
	if !ok {
		return nil
	}
	rows := make([]model.ActionCostSnapshotV2, 0, len(compiled.Costs))
	for i, cost := range compiled.Costs {
		row := model.ActionCostSnapshotV2{
			Amount:      amounts[i],
			Source:      "resourceCost",
			BaseAmount:  cost.Amount,
			FinalAmount: amounts[i],
		}
		if int(cost.Resource) < len(ctx.Bundle.Resources) {
			row.ResourceID = ctx.Bundle.Resources[cost.Resource].ID
		}
		if cost.HasFormula && int(cost.Formula) < len(ctx.Bundle.Formulas.Programs) {
			row.FormulaID = ctx.Bundle.Formulas.Programs[cost.Formula].ID
			if _, steps, ok := ctx.evalActionFormula(actor, actor, actor, action, cost.Formula); ok {
				row.Breakdown = steps
			}
		}
		rows = append(rows, row)
	}
	return rows
}

func (ctx *RunContext) actionEffectSnapshotRows(actor uint8, action uint16) []model.ActionEffectSnapshotV2 {
	compiled := ctx.Bundle.Actions[action]
	if len(compiled.PanelEffects) > 0 {
		rows := make([]model.ActionEffectSnapshotV2, 0, len(compiled.PanelEffects))
		for _, effect := range compiled.PanelEffects {
			amount := effect.Amount
			breakdown := []model.ActionValueBreakdownStepV2(nil)
			actualSource := roleActor(effect.SourceRole, actor, actor^1)
			actualTarget := roleActor(effect.TargetRole, actor, actor^1)
			if effect.HasFormula {
				value, steps, ok := ctx.evalActionFormula(actor, actualSource, actualTarget, action, effect.Formula)
				if ok {
					amount = value
					breakdown = steps
				}
			}
			rows = append(rows, model.ActionEffectSnapshotV2{
				EffectIndex:       effect.EffectIndex,
				Kind:              effect.Kind,
				Label:             effect.Label,
				FormulaID:         effect.FormulaID,
				DamageType:        effect.DamageType,
				StatusID:          effect.StatusID,
				AttrID:            effect.AttrID,
				MarkID:            effect.MarkID,
				SourceRole:        effect.SourceRole,
				TargetRole:        effect.TargetRole,
				ResolvedAmount:    amount,
				HasResolvedAmount: true,
				Source:            "panel",
				BaseAmount:        effect.Amount,
				FinalAmount:       amount,
				Breakdown:         breakdown,
			})
		}
		return rows
	}
	rows := make([]model.ActionEffectSnapshotV2, 0, len(compiled.Effects))
	for idx, effect := range compiled.Effects {
		row := model.ActionEffectSnapshotV2{
			EffectIndex: idx,
			Kind:        effectKindString(effect.Type),
			DamageType:  effect.DamageType,
			MarkID:      effect.MarkID,
			SourceRole:  effect.SourceRole,
			TargetRole:  effect.TargetRole,
			Source:      "effects",
			BaseAmount:  effect.Amount,
		}
		if effect.HasFormula && int(effect.Formula) < len(ctx.Bundle.Formulas.Programs) {
			row.FormulaID = ctx.Bundle.Formulas.Programs[effect.Formula].ID
		}
		if int(effect.Status) < len(ctx.Bundle.Statuses) {
			row.StatusID = ctx.Bundle.Statuses[effect.Status].ID
		}
		actualSource := roleActor(effect.SourceRole, actor, actor^1)
		actualTarget := roleActor(effect.TargetRole, actor, actor^1)
		switch effect.Type {
		case compilebundle.EffectDealDamage, compilebundle.EffectHeal, compilebundle.EffectGrantShield:
			amount, code := ctx.effectAmount(effect, actualSource, actualTarget, float64(ctx.actionSkillLevel(actor, action)))
			if code == model.ErrOK {
				row.ResolvedAmount = amount
				row.HasResolvedAmount = true
				row.FinalAmount = amount
				if effect.HasFormula {
					if _, steps, ok := ctx.evalActionFormula(actor, actualSource, actualTarget, action, effect.Formula); ok {
						row.Breakdown = steps
					}
				}
			}
		case compilebundle.EffectDamageFromRecent:
			amount := ctx.Actors[actualSource].DamageTaken.Sum(ctx.NowMs, effect.HistoryWindowMs)
			if effect.Amount != 0 {
				amount *= effect.Amount
			}
			row.ResolvedAmount = amount
			row.HasResolvedAmount = true
			row.FinalAmount = amount
		}
		rows = append(rows, row)
	}
	return rows
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

func effectKindString(kind compilebundle.EffectType) string {
	switch kind {
	case compilebundle.EffectDealDamage:
		return string(model.EffectTypeDealDamage)
	case compilebundle.EffectHeal:
		return string(model.EffectTypeHeal)
	case compilebundle.EffectApplyStatus:
		return string(model.EffectTypeApplyStatus)
	case compilebundle.EffectGrantShield:
		return string(model.EffectTypeGrantShield)
	case compilebundle.EffectApplyMark:
		return string(model.EffectTypeApplyMark)
	case compilebundle.EffectConsumeMark:
		return string(model.EffectTypeConsumeMark)
	case compilebundle.EffectDamageFromRecent:
		return string(model.EffectTypeDamageFromRecent)
	default:
		return "unknown"
	}
}
