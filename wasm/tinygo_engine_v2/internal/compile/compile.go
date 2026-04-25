// 本文件负责把面向传输和编辑的 EngineBundleV2 编译成运行时只读的 CompiledBundle。
package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

const (
	DefaultMaxCommandsPerEvent = 64
	DefaultMaxEvents           = 10000
)

type CompiledBundle struct {
	Attrs         []CompiledAttribute
	AttrIndex     map[string]uint16
	Resources     []CompiledResource
	ResourceIndex map[string]uint16
	Actors        []CompiledActor
	ActorIndex    map[string]uint8
	Actions       []CompiledAction
	ActionIndex   map[string]uint16
	Statuses      []CompiledStatus
	StatusIndex   map[string]uint16
	Formulas      formula.Registry
	Triggers      []CompiledTrigger
	Settings      Settings
}

type Settings struct {
	MaxEvents           int
	MaxCommandsPerEvent int
	MaxQueueEvents      int
	MaxChainDepth       int
}

type CompiledAttribute struct {
	ID                string
	DefaultBase       float64
	DefaultCurrent    float64
	DefaultMax        float64
	HasDefaultCurrent bool
	HasDefaultMax     bool
	ClampMin          float64
	HasClampMin       bool
	ClampMax          float64
	HasClampMax       bool
	DerivedFormula    formula.ProgramID
	HasDerivedFormula bool
}

type CompiledResource struct {
	ID             string
	DefaultCurrent float64
	DefaultMax     float64
}

type CompiledActor struct {
	ID         string
	MaxHP      float64
	InitialHP  float64
	Attributes []model.AttributeValueV2
	Resources  []model.ResourceValueV2
	Actions    []uint16
}

type CompiledAction struct {
	ID           string
	Label        string
	CooldownMs   int64
	Effects      []CompiledEffect
	RequiresMark string
	ConsumesMark bool
}

type CompiledStatus struct {
	ID             string
	Kind           string
	DurationMs     int64
	BlocksActions  bool
	RetryOnRelease bool
	Magnitude      float64
	ShieldKind     string
}

type TriggerEvent uint8

const (
	TriggerOnDamageTaken TriggerEvent = iota + 1
	TriggerOnDamageDealt
	TriggerOnActionCast
)

type CompiledTrigger struct {
	ID             string
	Event          TriggerEvent
	OwnerRole      string
	OwnerID        string
	RequiresDamage bool
	Effects        []CompiledEffect
}

type EffectType uint8

const (
	EffectDealDamage EffectType = iota + 1
	EffectHeal
	EffectApplyStatus
	EffectGrantShield
	EffectApplyMark
	EffectConsumeMark
	EffectDamageFromRecent
)

type CompiledEffect struct {
	Type            EffectType
	Formula         formula.ProgramID
	HasFormula      bool
	Amount          float64
	DamageType      string
	Status          uint16
	SourceRole      string
	TargetRole      string
	HistoryWindowMs int64
	CounterKey      string
	MarkID          string
}

type Result struct {
	Bundle   CompiledBundle
	Problems []string
}

func Bundle(input model.EngineBundle) Result {
	var problems []string
	if input.SchemaVersion != 0 && input.SchemaVersion != model.SchemaVersion {
		return Result{Problems: []string{"schemaVersion mismatch"}}
	}

	cb := CompiledBundle{
		Attrs:         make([]CompiledAttribute, 0, len(input.Attributes)),
		AttrIndex:     make(map[string]uint16, len(input.Attributes)),
		Resources:     make([]CompiledResource, 0, len(input.Resources)),
		ResourceIndex: make(map[string]uint16, len(input.Resources)),
		ActorIndex:    make(map[string]uint8, len(input.Actors)),
		ActionIndex:   make(map[string]uint16, len(input.Actions)),
		StatusIndex:   make(map[string]uint16, len(input.Statuses)),
	}
	cb.Settings.MaxEvents = input.Settings.MaxEvents
	if cb.Settings.MaxEvents <= 0 {
		cb.Settings.MaxEvents = DefaultMaxEvents
	}
	cb.Settings.MaxCommandsPerEvent = input.Settings.MaxCommandsPerEvent
	if cb.Settings.MaxCommandsPerEvent <= 0 {
		cb.Settings.MaxCommandsPerEvent = DefaultMaxCommandsPerEvent
	}
	cb.Settings.MaxQueueEvents = input.Settings.MaxQueueEvents
	cb.Settings.MaxChainDepth = input.Settings.MaxChainDepth

	for i, attr := range input.Attributes {
		if attr.ID == "" {
			problems = append(problems, "attribute id is empty")
			continue
		}
		if _, exists := cb.AttrIndex[attr.ID]; exists {
			problems = append(problems, "duplicate attribute: "+attr.ID)
			continue
		}
		cb.AttrIndex[attr.ID] = uint16(i)
		cb.Attrs = append(cb.Attrs, CompiledAttribute{
			ID: attr.ID, DefaultBase: attr.DefaultBase, DefaultCurrent: attr.DefaultCurrent,
			DefaultMax: attr.DefaultMax, HasDefaultCurrent: attr.HasDefaultCurrent,
			HasDefaultMax: attr.HasDefaultMax, ClampMin: attr.ClampMin, HasClampMin: attr.HasClampMin,
			ClampMax: attr.ClampMax, HasClampMax: attr.HasClampMax,
		})
	}
	for i, resource := range input.Resources {
		if resource.ID == "" {
			problems = append(problems, "resource id is empty")
			continue
		}
		if _, exists := cb.ResourceIndex[resource.ID]; exists {
			problems = append(problems, "duplicate resource: "+resource.ID)
			continue
		}
		cb.ResourceIndex[resource.ID] = uint16(i)
		cb.Resources = append(cb.Resources, CompiledResource{
			ID: resource.ID, DefaultCurrent: resource.DefaultCurrent, DefaultMax: resource.DefaultMax,
		})
	}
	registry, formulaProblems := formula.CompileRegistry(input.Formulas, cb.AttrIndex, cb.ResourceIndex)
	problems = append(problems, formulaProblems...)
	cb.Formulas = registry
	for i, inputAttr := range input.Attributes {
		if i >= len(cb.Attrs) || inputAttr.ID == "" || inputAttr.DerivedFormulaID == "" {
			continue
		}
		compiledIdx, ok := cb.AttrIndex[inputAttr.ID]
		if !ok {
			continue
		}
		pid, ok := cb.Formulas.Lookup(inputAttr.DerivedFormulaID)
		if !ok {
			problems = append(problems, "unknown derived formula reference: "+inputAttr.ID+"."+inputAttr.DerivedFormulaID)
			continue
		}
		cb.Attrs[compiledIdx].DerivedFormula = pid
		cb.Attrs[compiledIdx].HasDerivedFormula = true
	}

	for _, status := range input.Statuses {
		if status.ID == "" {
			problems = append(problems, "status id is empty")
			continue
		}
		cb.StatusIndex[status.ID] = uint16(len(cb.Statuses))
		cb.Statuses = append(cb.Statuses, CompiledStatus{
			ID:             status.ID,
			Kind:           status.Kind,
			DurationMs:     status.DurationMs,
			BlocksActions:  status.BlocksActions,
			RetryOnRelease: status.RetryOnRelease,
			Magnitude:      status.Magnitude,
			ShieldKind:     status.ShieldKind,
		})
	}

	for _, action := range input.Actions {
		if action.ID == "" {
			problems = append(problems, "action id is empty")
			continue
		}
		compiledEffects, effectProblems := compileEffects(action.Effects, cb)
		problems = append(problems, effectProblems...)
		cb.ActionIndex[action.ID] = uint16(len(cb.Actions))
		cb.Actions = append(cb.Actions, CompiledAction{
			ID:           action.ID,
			Label:        action.Label,
			CooldownMs:   action.CooldownMs,
			Effects:      compiledEffects,
			RequiresMark: action.RequiresMark,
			ConsumesMark: action.ConsumesMark,
		})
	}

	for _, actor := range input.Actors {
		if actor.ID == "" {
			problems = append(problems, "actor id is empty")
			continue
		}
		attrs := make([]model.AttributeValueV2, len(cb.Attrs))
		for i, def := range cb.Attrs {
			attrs[i] = model.AttributeValueV2{
				Base: def.DefaultBase, Current: def.DefaultCurrent, Max: def.DefaultMax,
				Resolved: def.DefaultBase, HasCurrent: def.HasDefaultCurrent, HasMax: def.HasDefaultMax,
			}
			if !def.HasDefaultCurrent {
				attrs[i].Current = def.DefaultBase
			}
			if !def.HasDefaultMax {
				attrs[i].Max = def.DefaultBase
			}
		}
		for attr, value := range actor.Attributes {
			idx, ok := cb.AttrIndex[attr]
			if !ok {
				problems = append(problems, "unknown actor attr: "+actor.ID+"."+attr)
				continue
			}
			attrs[idx] = value
		}
		resources := make([]model.ResourceValueV2, len(cb.Resources))
		for i, def := range cb.Resources {
			resources[i] = model.ResourceValueV2{Current: def.DefaultCurrent, Max: def.DefaultMax}
		}
		for resourceID, value := range actor.Resources {
			idx, ok := cb.ResourceIndex[resourceID]
			if !ok {
				problems = append(problems, "unknown actor resource: "+actor.ID+"."+resourceID)
				continue
			}
			resources[idx] = value
		}
		actions := make([]uint16, 0, len(actor.Actions))
		for _, actionID := range actor.Actions {
			idx, ok := cb.ActionIndex[actionID]
			if !ok {
				problems = append(problems, "unknown actor action: "+actor.ID+"."+actionID)
				continue
			}
			actions = append(actions, idx)
		}
		cb.ActorIndex[actor.ID] = uint8(len(cb.Actors))
		cb.Actors = append(cb.Actors, CompiledActor{
			ID: actor.ID, MaxHP: actor.MaxHP, InitialHP: actor.InitialHP,
			Attributes: attrs, Resources: resources, Actions: actions,
		})
	}

	for _, trigger := range input.Triggers {
		effects, effectProblems := compileEffects(trigger.Effects, cb)
		problems = append(problems, effectProblems...)
		event := triggerEvent(trigger.Event)
		if event == 0 {
			problems = append(problems, "unsupported trigger event: "+trigger.Event)
			continue
		}
		cb.Triggers = append(cb.Triggers, CompiledTrigger{
			ID: trigger.ID, Event: event, OwnerRole: trigger.OwnerRole, OwnerID: trigger.OwnerID,
			RequiresDamage: trigger.RequiresDamage, Effects: effects,
		})
	}

	return Result{Bundle: cb, Problems: problems}
}

func compileEffects(effects []model.EffectDef, cb CompiledBundle) ([]CompiledEffect, []string) {
	compiled := make([]CompiledEffect, 0, len(effects))
	var problems []string
	for _, effect := range effects {
		next := CompiledEffect{
			Type: effectType(effect.Type), Amount: effect.Amount, DamageType: effect.DamageType,
			SourceRole: effect.SourceRole, TargetRole: effect.TargetRole, HistoryWindowMs: effect.HistoryWindowMs,
			CounterKey: effect.CounterKey, MarkID: effect.MarkID,
		}
		if next.Type == 0 {
			problems = append(problems, "unsupported effect type: "+string(effect.Type))
			continue
		}
		if effect.FormulaID != "" {
			pid, ok := cb.Formulas.Lookup(effect.FormulaID)
			if !ok {
				problems = append(problems, "unknown formula reference: "+effect.FormulaID)
			} else {
				next.Formula = pid
				next.HasFormula = true
			}
		}
		if effect.StatusID != "" {
			idx, ok := cb.StatusIndex[effect.StatusID]
			if !ok {
				problems = append(problems, "unknown status reference: "+effect.StatusID)
			} else {
				next.Status = idx
			}
		}
		compiled = append(compiled, next)
	}
	return compiled, problems
}

func effectType(value model.EffectType) EffectType {
	switch value {
	case model.EffectTypeDealDamage:
		return EffectDealDamage
	case model.EffectTypeHeal:
		return EffectHeal
	case model.EffectTypeApplyStatus:
		return EffectApplyStatus
	case model.EffectTypeGrantShield:
		return EffectGrantShield
	case model.EffectTypeApplyMark:
		return EffectApplyMark
	case model.EffectTypeConsumeMark:
		return EffectConsumeMark
	case model.EffectTypeDamageFromRecent:
		return EffectDamageFromRecent
	default:
		return 0
	}
}

func triggerEvent(value string) TriggerEvent {
	switch value {
	case "on_damage_taken":
		return TriggerOnDamageTaken
	case "on_damage_dealt":
		return TriggerOnDamageDealt
	case "on_action_cast":
		return TriggerOnActionCast
	default:
		return 0
	}
}
