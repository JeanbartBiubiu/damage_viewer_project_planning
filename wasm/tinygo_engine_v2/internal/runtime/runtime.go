// 单次 run 的 1v1 战斗运行时：事件堆驱动，效果经 applyEffect/dealDamage 统一改 HP。
//
// 不可绕过入口：
//   - CanCast：action 门控（归属、控制、mark、资源、冷却）
//   - dispatch → onCastIntent/onActionComplete/...：唯一事件处理链
//   - dealDamage/applyHeal：HP 变更应经此处或等效 effect 路径
//
// 热路径禁止 goroutine/lock/反射；Actors 固定 [2]，arena 用 generation handle。
package runtime

import (
	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/cadence"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/counter"
	"tinygo_engine_v2/internal/history"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/resource"
	"tinygo_engine_v2/internal/scheduler"
)

const (
	statusArenaCap    = 128
	shieldArenaCap    = 64
	executionArenaCap = 16
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
	Source     uint8
	Actor      uint8
	Def        uint16
	ExpireAt   int64
	TickDone   int
}

type ShieldInstance struct {
	Alive      bool
	Generation uint16
	Actor      uint8
	Kind       string
	Amount     float64
	ExpireAt   int64
}

type RunningExecution struct {
	Alive      bool
	Generation uint16
	Source     uint8
	Target     uint8
	Action     uint16
	CompleteAt int64
}

// RunContext 聚合单次 run 的全部可变状态；NewRunContext 失败时 session 不得进入 running。
type RunContext struct {
	Bundle          compilebundle.CompiledBundle
	Actors          [2]ActorRuntime
	Pair            history.PairState
	Counters        counter.State
	ModeAugments    map[string]bool
	Queue           scheduler.Heap
	RNG             RNG
	Statuses        [statusArenaCap]StatusInstance
	Shields         [shieldArenaCap]ShieldInstance
	Executions      [executionArenaCap]RunningExecution
	Outbox          *abi.Outbox
	Logs            []model.LogEntry
	ActionResults   []model.ActionRunResultV2
	TickResults     []model.StatusTickRunResultV2
	TriggerResults  []model.TriggerRunResultV2
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

type damageApplication struct {
	FinalDamage    float64
	ShieldBefore   float64
	ShieldAfter    float64
	ShieldAbsorbed float64
}

type healApplication struct {
	HPBefore float64
	HPAfter  float64
	Applied  float64
	Overheal float64
}

type critApplication struct {
	Scalar        float64
	Roll          float64
	HasRoll       bool
	Result        bool
	HasResult     bool
	Multiplier    float64
	HasMultiplier bool
}

type modeApplication struct {
	Scalar       float64
	ModeID       string
	Active       bool
	HasModeState bool
	Multiplier   float64
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
		Bundle:         bundle,
		Counters:       counter.NewState(),
		ModeAugments:   modeAugmentsFrom(input.ModeAugments),
		Queue:          scheduler.NewHeap(64),
		RNG:            NewRNG(input.Seed),
		Outbox:         outbox,
		Logs:           make([]model.LogEntry, 0, 64),
		ActionResults:  make([]model.ActionRunResultV2, 0, 8),
		TickResults:    make([]model.StatusTickRunResultV2, 0, 8),
		TriggerResults: make([]model.TriggerRunResultV2, 0, 4),
		StopMaxEvents:  input.StopCondition.MaxEvents,
		trace:          input.Trace,
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

func (ctx *RunContext) ReadCounter(key string) (float64, bool) {
	value := ctx.Counters.Get(counter.Key{Scope: counter.ScopeGlobal, Name: key})
	return value, value != 0
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
