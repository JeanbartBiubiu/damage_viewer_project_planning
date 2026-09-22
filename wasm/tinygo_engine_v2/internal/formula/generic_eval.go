package formula

import (
	"errors"
	"math"
	"strings"

	"tinygo_engine_v2/internal/model"
)

// GenericEvalContext 是 generic formula 运行时只读视图。
type GenericEvalContext struct {
	SourceAttrs     map[string]model.AttributeSlotDef
	TargetAttrs     map[string]model.AttributeSlotDef
	SourceResources map[string]model.ResourceSlotDef
	TargetResources map[string]model.ResourceSlotDef
	AbilityParams   map[string]float64
	// StrictReads 用于需要区分缺值与真实零值的吸血效率和治疗修正。
	StrictReads bool

	// Provider state reads require a concrete provider context.
	HasProviderContext  bool
	ProviderState       map[string]float64
	ProviderTargetState map[string]float64

	// Event snapshot reads require an emit_event listener / child-ability context.
	// Participants are the original emitted event source/target (not owner-remapped).
	HasEventContext           bool
	EventEntrySourceAttrs     map[string]model.AttributeSlotDef
	EventEntryTargetAttrs     map[string]model.AttributeSlotDef
	EventEntrySourceResources map[string]model.ResourceSlotDef
	EventEntryTargetResources map[string]model.ResourceSlotDef
	EventSourceAttrs          map[string]model.AttributeSlotDef
	EventTargetAttrs          map[string]model.AttributeSlotDef
	EventSourceResources      map[string]model.ResourceSlotDef
	EventTargetResources      map[string]model.ResourceSlotDef

	// DamageAmount is transient: only set while evaluating a pipeline damage modifier.
	// Missing damage context must fail structurally (never silently return zero).
	HasDamageContext bool
	DamageAmount     float64
	// DamageTraits lists catalog damage_trait/* keys on the current damage operation.
	DamageTraits []string
	// DamageTypeKey is the current operation damage type (catalog key / settlement alias).
	DamageTypeKey string
	// DamageCastOrigin is the casting ability castOrigin enum value (champion|item|pet|innate); empty if unset.
	DamageCastOrigin string
	// DamageAbilityTypes lists casting ability TypeSet keys (ability/*) for ability_type predicates.
	DamageAbilityTypes []string

	// Event damage snapshot reads require an emitted damage_instance (or equivalent) context.
	HasEventDamageSnapshot bool
	EventDamage            EventDamageSnapshot

	// Skill hit freeze reads: event.skill_hit.firstContact|blocked. Missing value is a path error.
	HasEventSkillHit           bool
	HasSkillHitFirstContact    bool
	SkillHitFirstContact       float64
	HasSkillHitBlocked         bool
	SkillHitBlocked            float64
}

// EventDamageSnapshot is the immutable numeric freeze under event.damage.*.
type EventDamageSnapshot struct {
	BaseRawAmount          float64
	PreMitigationAmount    float64
	MitigatedAmount        float64
	OriginalCritChance     float64
	EffectiveCritChance    float64
	ForcedCritWeight       float64
	NaturalCritWeight      float64
	ForcedCritMultiplier   float64
	NaturalCritMultiplier  float64
	NormalPart             float64
	CritPart               float64
	NaturalBranchRawAmount float64
}

// Eval 执行 generic formula 程序，非有限数返回 error。
func (r GenericRegistry) Eval(id GenericProgramID, ctx GenericEvalContext) (float64, error) {
	if int(id) >= len(r.Programs) {
		return 0, errors.New("formula id out of range")
	}
	stack := make([]float64, 0, 16)
	for _, instr := range r.Programs[id].Instr {
		switch instr.Op {
		case GenericOpConst:
			stack = append(stack, instr.Value)
		case GenericOpRead:
			value, err := evalRead(instr.ReadKind, instr.ReadKey, ctx)
			if err != nil {
				return 0, err
			}
			stack = append(stack, value)
		case GenericOpAdd, GenericOpSub, GenericOpMul, GenericOpDiv, GenericOpMin, GenericOpMax,
			GenericOpEq, GenericOpNe, GenericOpLt, GenericOpLte, GenericOpGt, GenericOpGte:
			if len(stack) < 2 {
				return 0, errors.New("formula stack underflow")
			}
			right := stack[len(stack)-1]
			left := stack[len(stack)-2]
			stack = stack[:len(stack)-2]
			var value float64
			switch instr.Op {
			case GenericOpAdd:
				value = left + right
			case GenericOpSub:
				value = left - right
			case GenericOpMul:
				value = left * right
			case GenericOpDiv:
				if right == 0 {
					return 0, errors.New("division by zero")
				}
				value = left / right
			case GenericOpMin:
				value = math.Min(left, right)
			case GenericOpMax:
				value = math.Max(left, right)
			case GenericOpEq:
				value = bool01(left == right)
			case GenericOpNe:
				value = bool01(left != right)
			case GenericOpLt:
				value = bool01(left < right)
			case GenericOpLte:
				value = bool01(left <= right)
			case GenericOpGt:
				value = bool01(left > right)
			case GenericOpGte:
				value = bool01(left >= right)
			}
			if !finite(value) {
				return 0, errors.New("non-finite formula result")
			}
			stack = append(stack, value)
		case GenericOpClamp:
			if len(stack) < 3 {
				return 0, errors.New("formula stack underflow")
			}
			maxV := stack[len(stack)-1]
			minV := stack[len(stack)-2]
			value := stack[len(stack)-3]
			stack = stack[:len(stack)-3]
			stack = append(stack, math.Max(minV, math.Min(maxV, value)))
		case GenericOpRound, GenericOpFloor, GenericOpCeil, GenericOpTrunc:
			if len(stack) < 1 {
				return 0, errors.New("formula stack underflow")
			}
			value := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			decimals := instr.Decimals
			if decimals > 0 {
				scale := math.Pow(10, float64(decimals))
				switch instr.Op {
				case GenericOpRound:
					value = math.Round(value*scale) / scale
				case GenericOpFloor:
					value = math.Floor(value*scale) / scale
				case GenericOpCeil:
					value = math.Ceil(value*scale) / scale
				case GenericOpTrunc:
					if value < 0 {
						value = math.Ceil(value*scale) / scale
					} else {
						value = math.Floor(value*scale) / scale
					}
				}
			} else {
				switch instr.Op {
				case GenericOpRound:
					value = math.Round(value)
				case GenericOpFloor:
					value = math.Floor(value)
				case GenericOpCeil:
					value = math.Ceil(value)
				case GenericOpTrunc:
					value = math.Trunc(value)
				}
			}
			if !finite(value) {
				return 0, errors.New("non-finite formula result")
			}
			stack = append(stack, value)
		default:
			return 0, errors.New("unsupported formula opcode")
		}
	}
	if len(stack) != 1 {
		return 0, errors.New("formula stack did not settle to one value")
	}
	if !finite(stack[0]) {
		return 0, errors.New("non-finite formula result")
	}
	return stack[0], nil
}

func bool01(ok bool) float64 {
	if ok {
		return 1
	}
	return 0
}

func evalRead(kind GenericReadKind, key string, ctx GenericEvalContext) (float64, error) {
	switch kind {
	case ReadSourceAttr:
		return readAttrValueChecked(ctx.SourceAttrs, key, ctx.StrictReads)
	case ReadTargetAttr:
		return readAttrValueChecked(ctx.TargetAttrs, key, ctx.StrictReads)
	case ReadSourceResource:
		return readResourceValue(ctx.SourceResources, key), nil
	case ReadTargetResource:
		return readResourceValue(ctx.TargetResources, key), nil
	case ReadAbilityParam:
		if ctx.StrictReads {
			value, ok := ctx.AbilityParams[key]
			if !ok {
				return 0, errors.New("missing ability parameter: " + key)
			}
			return value, nil
		}
		if ctx.AbilityParams == nil {
			return 0, nil
		}
		return ctx.AbilityParams[key], nil
	case ReadProviderState:
		if !ctx.HasProviderContext {
			return 0, errors.New("provider.state requires provider context")
		}
		if ctx.ProviderState == nil {
			return 0, nil
		}
		return ctx.ProviderState[key], nil
	case ReadProviderTargetState:
		if !ctx.HasProviderContext {
			return 0, errors.New("provider.target_state requires provider context")
		}
		if ctx.ProviderTargetState == nil {
			return 0, nil
		}
		return ctx.ProviderTargetState[key], nil
	case ReadEventEntrySourceAttr:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readAttrValueChecked(ctx.EventEntrySourceAttrs, key, ctx.StrictReads)
	case ReadEventEntryTargetAttr:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readAttrValueChecked(ctx.EventEntryTargetAttrs, key, ctx.StrictReads)
	case ReadEventEntrySourceResource:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readResourceValue(ctx.EventEntrySourceResources, key), nil
	case ReadEventEntryTargetResource:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readResourceValue(ctx.EventEntryTargetResources, key), nil
	case ReadEventSourceAttr:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readAttrValueChecked(ctx.EventSourceAttrs, key, ctx.StrictReads)
	case ReadEventTargetAttr:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readAttrValueChecked(ctx.EventTargetAttrs, key, ctx.StrictReads)
	case ReadEventSourceResource:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readResourceValue(ctx.EventSourceResources, key), nil
	case ReadEventTargetResource:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readResourceValue(ctx.EventTargetResources, key), nil
	case ReadDamageAmount:
		if !ctx.HasDamageContext {
			return 0, errors.New("damage.amount requires damage context")
		}
		return ctx.DamageAmount, nil
	case ReadDamageTrait:
		if !ctx.HasDamageContext {
			return 0, errors.New("damage.trait requires damage context")
		}
		want := "damage_trait/" + key
		for _, t := range ctx.DamageTraits {
			if t == want {
				return 1, nil
			}
		}
		return 0, nil
	case ReadDamageType:
		if !ctx.HasDamageContext {
			return 0, errors.New("damage.type requires damage context")
		}
		if CanonicalDamageTypeKey(ctx.DamageTypeKey) == CanonicalDamageTypeKey(key) {
			return 1, nil
		}
		return 0, nil
	case ReadDamageCastOrigin:
		if !ctx.HasDamageContext {
			return 0, errors.New("damage.cast_origin requires damage context")
		}
		if ctx.DamageCastOrigin != "" && ctx.DamageCastOrigin == key {
			return 1, nil
		}
		return 0, nil
	case ReadDamageAbilityType:
		if !ctx.HasDamageContext {
			return 0, errors.New("damage.ability_type requires damage context")
		}
		want := "ability/" + key
		for _, t := range ctx.DamageAbilityTypes {
			if t == want {
				return 1, nil
			}
		}
		return 0, nil
	case ReadEventSkillHit:
		if !ctx.HasEventSkillHit {
			return 0, errors.New("event.skill_hit." + key + " requires skill hit context")
		}
		switch key {
		case "firstContact":
			if !ctx.HasSkillHitFirstContact {
				return 0, errors.New(model.FormulaPathSkillHitFirstContact)
			}
			return ctx.SkillHitFirstContact, nil
		case "blocked":
			if !ctx.HasSkillHitBlocked {
				return 0, errors.New(model.FormulaPathSkillHitBlocked)
			}
			return ctx.SkillHitBlocked, nil
		default:
			return 0, errors.New("unknown event.skill_hit field")
		}
	case ReadEventDamage:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		if !ctx.HasEventDamageSnapshot {
			return 0, errors.New("event.damage requires damage event context")
		}
		return readEventDamageField(ctx.EventDamage, key)
	default:
		return 0, errors.New("unknown read kind")
	}
}

func readEventDamageField(snap EventDamageSnapshot, key string) (float64, error) {
	switch key {
	case "baseRawAmount":
		return snap.BaseRawAmount, nil
	case "preMitigationAmount":
		return snap.PreMitigationAmount, nil
	case "mitigatedAmount":
		return snap.MitigatedAmount, nil
	case "originalCritChance":
		return snap.OriginalCritChance, nil
	case "effectiveCritChance":
		return snap.EffectiveCritChance, nil
	case "forcedCritWeight":
		return snap.ForcedCritWeight, nil
	case "naturalCritWeight":
		return snap.NaturalCritWeight, nil
	case "forcedCritMultiplier":
		return snap.ForcedCritMultiplier, nil
	case "naturalCritMultiplier":
		return snap.NaturalCritMultiplier, nil
	case "normalPart":
		return snap.NormalPart, nil
	case "critPart":
		return snap.CritPart, nil
	case "naturalBranchRawAmount":
		return snap.NaturalBranchRawAmount, nil
	default:
		return 0, errors.New("unknown event.damage field")
	}
}

func requireEventContext(ctx GenericEvalContext) error {
	if !ctx.HasEventContext {
		return errors.New("event.* requires event context")
	}
	return nil
}

func readAttrValue(attrs map[string]model.AttributeSlotDef, key string) float64 {
	if attrs == nil {
		return 0
	}
	if idx := strings.LastIndex(key, "."); idx > 0 {
		suffix := key[idx+1:]
		attrKey := key[:idx]
		slot, ok := attrs[attrKey]
		if !ok {
			return 0
		}
		switch suffix {
		case "resolved":
			if slot.Resolved != 0 {
				return slot.Resolved
			}
			return slot.Current
		case "current":
			return slot.Current
		case "base":
			return slot.Base
		case "max":
			return slot.Max
		}
	}
	slot, ok := attrs[key]
	if !ok {
		return 0
	}
	if slot.Resolved != 0 {
		return slot.Resolved
	}
	return slot.Current
}

func readResourceValue(resources map[string]model.ResourceSlotDef, key string) float64 {
	if resources == nil {
		return 0
	}
	if idx := strings.LastIndex(key, "."); idx > 0 {
		suffix := key[idx+1:]
		resKey := key[:idx]
		slot, ok := resources[resKey]
		if !ok {
			return 0
		}
		switch suffix {
		case "current":
			return slot.Current
		case "max":
			return slot.Max
		}
	}
	slot, ok := resources[key]
	if !ok {
		return 0
	}
	return slot.Current
}

func finite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
