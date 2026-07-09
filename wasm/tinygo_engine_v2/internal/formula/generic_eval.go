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
		case GenericOpAdd, GenericOpSub, GenericOpMul, GenericOpDiv, GenericOpMin, GenericOpMax:
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

func evalRead(kind GenericReadKind, key string, ctx GenericEvalContext) (float64, error) {
	switch kind {
	case ReadSourceAttr:
		return readAttrValue(ctx.SourceAttrs, key), nil
	case ReadTargetAttr:
		return readAttrValue(ctx.TargetAttrs, key), nil
	case ReadSourceResource:
		return readResourceValue(ctx.SourceResources, key), nil
	case ReadTargetResource:
		return readResourceValue(ctx.TargetResources, key), nil
	case ReadAbilityParam:
		if ctx.AbilityParams == nil {
			return 0, nil
		}
		return ctx.AbilityParams[key], nil
	default:
		return 0, errors.New("unknown read kind")
	}
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
	slot, ok := resources[key]
	if !ok {
		return 0
	}
	return slot.Current
}

func finite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
