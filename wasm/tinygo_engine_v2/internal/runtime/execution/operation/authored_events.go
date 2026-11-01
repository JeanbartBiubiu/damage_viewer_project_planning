package operation

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// AuthoredEvent 保存作者操作已经确定的事件事实，不持有根帧或完整事件快照。
type AuthoredEvent struct {
	EventType, Ref, Source, Target string
	InheritAbilityTypes            bool
	HasUse                         bool
	UseKey, UseSource, UseSkillKey string
	HasLink                        bool
	LinkIndex, LinkCount           int
}

// EventHost 只交接唯一预算及当前真实帧的事件和证据追加，不提交或派发。
type EventHost interface {
	// AuthoredEventBudget 读取本操作原位置的剩余命令额度及事件总限制，不预留额度。
	AuthoredEventBudget() (remainingCommands, maxEvents int)
	// ConsumeAuthoredEventCommands 沿原预算账消费整批联动额度，失败不回退已经消费的命令。
	ConsumeAuthoredEventCommands(count int) *model.EngineError
	// AuthoredEventBudgetError 记录原预算原因并返回本场既有错误。
	AuthoredEventBudgetError(cause model.BudgetCause, message string) *model.EngineError
	// AppendAuthoredEvent 按当前帧真实暂存捕获快照并追加待派发事实，不创建子帧。
	AppendAuthoredEvent(ability planbundle.CompiledAbility, event AuthoredEvent)
	// RecordAuthoredEventEvidence 保持当前帧证据的原插入位置；汇总模式只登记种类。
	RecordAuthoredEventEvidence(kind model.EvidenceKind, item model.EvidenceItem)
}

// ApplyLink 在当前帧核对原使用、计算并核对联动数量，再原序生成同帧待派发事实。
func (s *Executor) ApplyLink(state *Frame, input Input, reads NumericReads, host EventHost, op planbundle.CompiledOperation, ability planbundle.CompiledAbility, target string) *model.EngineError {
	useKey, useSource, useSkill := input.ProcessUseKey, input.ProcessUseSource, input.ProcessUseSkill
	if useKey == "" && input.Event != nil && input.Event.HasUse {
		useKey, useSource, useSkill = input.Event.UseKey, input.Event.UseSource, input.Event.UseSkillKey
	}
	f := calculation{executor: s, state: state, input: input, reads: reads}
	if useKey == "" || useSource != input.Source || useSkill == "" {
		return f.processError(op.Path, "link application requires the real originating source, skill and use identity", useKey)
	}
	value, err := f.evalResultFormula(op.AmountProgram, ability, target)
	if err != nil {
		return err
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || math.Trunc(value) != value || value > 9007199254740991 {
		return f.formulaError(op.AmountProgram, "link count must be a finite non-negative safe integer")
	}
	remaining, maxEvents := host.AuthoredEventBudget()
	if value > float64(remaining) {
		return host.ConsumeAuthoredEventCommands(remaining + 1)
	}
	if value > float64(maxEvents) {
		return host.AuthoredEventBudgetError(model.BudgetCauseMaxEvents, "link application event budget exceeded")
	}
	count := int(value)
	if err := host.ConsumeAuthoredEventCommands(count); err != nil {
		return err
	}
	eventType := model.EventTypeHitLinkApplied
	if op.Operation == model.OperationKindApplyAttackLink {
		eventType = model.EventTypeAttackLinkApplied
	}
	var item model.EvidenceItem
	if s.detailed {
		item = model.EvidenceItem{TimeMs: input.TimeMs, Kind: "link_application", Ref: op.Ref, Path: op.Path, Data: map[string]interface{}{
			"eventType": eventType, "source": input.Source, "target": target, "useRef": useKey, "skillKey": useSkill, "count": count,
		}}
	}
	host.RecordAuthoredEventEvidence("link_application", item)
	for index := 1; index <= count; index++ {
		host.AppendAuthoredEvent(ability, AuthoredEvent{EventType: eventType, Ref: op.Ref, Source: input.Source, Target: target,
			InheritAbilityTypes: true, HasUse: true, UseKey: useKey, UseSource: useSource, UseSkillKey: useSkill,
			HasLink: true, LinkIndex: index, LinkCount: count})
		item = model.EvidenceItem{}
		if s.detailed {
			item = model.EvidenceItem{TimeMs: input.TimeMs, Kind: model.EvidenceKindEmittedEvent, Ref: eventType, Path: op.Path, Data: map[string]interface{}{
				"eventType": eventType, "source": input.Source, "target": target, "useRef": useKey, "skillKey": useSkill,
				"LINK_INDEX": index, "LINK_COUNT": count,
			}}
		}
		host.RecordAuthoredEventEvidence(model.EvidenceKindEmittedEvent, item)
	}
	return nil
}

// Emit 在当前帧核对作者事件、防止伪造引擎事实，并生成原时点的待派发请求。
func (s *Executor) Emit(input Input, host EventHost, op planbundle.CompiledOperation, target string) *model.EngineError {
	eventType := op.EventType
	if eventType == "" {
		eventType = op.Ref
	}
	if model.IsEngineProducedEvent(eventType) {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "emit_event cannot forge engine-produced skill hit events", "eventType", eventType, s.plan.SchemaHash, s.plan.RulesHash, s.sessionID)
	}
	ref := op.Ref
	if ref == "" {
		ref = eventType
	}
	if ref == "" {
		ref = "event:auto"
	}
	var item model.EvidenceItem
	if s.detailed {
		data := map[string]interface{}{"source": input.Source, "target": target, "eventType": eventType}
		attachCastProvenance(data, input.CastInstanceID, input.CastOrigin)
		item = model.EvidenceItem{TimeMs: input.TimeMs, Kind: model.EvidenceKindEmittedEvent, Ref: ref, Data: data}
	}
	host.RecordAuthoredEventEvidence(model.EvidenceKindEmittedEvent, item)
	host.AppendAuthoredEvent(planbundle.CompiledAbility{}, AuthoredEvent{EventType: eventType, Ref: ref, Source: input.Source, Target: target})
	return nil
}
