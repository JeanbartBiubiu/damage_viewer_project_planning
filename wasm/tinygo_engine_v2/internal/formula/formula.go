// 本文件实现公式 bytecode 编译和执行，用于把公式 DTO 转成热路径可执行的短指令。
package formula

import (
	"errors"
	"math"

	"tinygo_engine_v2/internal/model"
)

type ProgramID uint16

type Op uint8

const (
	OpConst Op = iota
	OpAttr
	OpResource
	OpCounter
	OpInput
	OpAdd
	OpSub
	OpMul
	OpDiv
	OpMax
	OpMin
	OpSign
)

type Instr struct {
	Op       Op
	Value    float64
	Attr     uint16
	ReadKind model.AttributeReadKind
	Resource uint16
	Counter  string
}

type Program struct {
	ID    string
	Instr []Instr
}

type Registry struct {
	Programs []Program
	Index    map[string]ProgramID
}

type AttributeReader interface {
	ReadAttr(index uint16, kind model.AttributeReadKind) (float64, bool)
}

type ResourceReader interface {
	ReadResource(index uint16) (current float64, max float64, ok bool)
}

type CounterReader interface {
	ReadCounter(key string) (float64, bool)
}

type EvalContext struct {
	SourceAttrs AttributeReader
	TargetAttrs AttributeReader
	Resources   ResourceReader
	Counters    CounterReader
	Input       float64
}

func CompileRegistry(defs []model.FormulaDefinition, attrIndex map[string]uint16, resourceIndex map[string]uint16) (Registry, []string) {
	reg := Registry{Programs: make([]Program, 0, len(defs)), Index: make(map[string]ProgramID, len(defs))}
	defIndex := make(map[string]model.FormulaDefinition, len(defs))
	var problems []string
	for _, def := range defs {
		if def.ID == "" {
			problems = append(problems, "formula id is empty")
			continue
		}
		if _, exists := defIndex[def.ID]; exists {
			problems = append(problems, "duplicate formula: "+def.ID)
			continue
		}
		defIndex[def.ID] = def
	}
	for _, def := range defs {
		if def.ID == "" {
			continue
		}
		var instr []Instr
		visiting := make(map[string]bool)
		if err := compile(def.ID, defIndex, attrIndex, resourceIndex, visiting, &instr); err != nil {
			problems = append(problems, def.ID+": "+err.Error())
			continue
		}
		reg.Index[def.ID] = ProgramID(len(reg.Programs))
		reg.Programs = append(reg.Programs, Program{ID: def.ID, Instr: instr})
	}
	return reg, problems
}

func (r Registry) Lookup(id string) (ProgramID, bool) {
	pid, ok := r.Index[id]
	return pid, ok
}

func (r Registry) Eval(id ProgramID, ctx EvalContext) (float64, error) {
	if int(id) >= len(r.Programs) {
		return 0, errors.New("formula id out of range")
	}
	stack := make([]float64, 0, 16)
	for _, instr := range r.Programs[id].Instr {
		switch instr.Op {
		case OpConst:
			stack = append(stack, instr.Value)
		case OpAttr:
			if ctx.SourceAttrs == nil {
				return 0, errors.New("source attrs unavailable")
			}
			value, ok := ctx.SourceAttrs.ReadAttr(instr.Attr, instr.ReadKind)
			if !ok {
				return 0, errors.New("attr index out of range")
			}
			stack = append(stack, value)
		case OpResource:
			if ctx.Resources == nil {
				return 0, errors.New("resources unavailable")
			}
			current, _, ok := ctx.Resources.ReadResource(instr.Resource)
			if !ok {
				return 0, errors.New("resource index out of range")
			}
			stack = append(stack, current)
		case OpCounter:
			if ctx.Counters == nil {
				stack = append(stack, 0)
				continue
			}
			value, ok := ctx.Counters.ReadCounter(instr.Counter)
			if !ok {
				value = 0
			}
			stack = append(stack, value)
		case OpInput:
			stack = append(stack, ctx.Input)
		case OpAdd, OpSub, OpMul, OpDiv, OpMax, OpMin:
			if len(stack) < 2 {
				return 0, errors.New("formula stack underflow")
			}
			right := stack[len(stack)-1]
			left := stack[len(stack)-2]
			stack = stack[:len(stack)-2]
			var value float64
			switch instr.Op {
			case OpAdd:
				value = left + right
			case OpSub:
				value = left - right
			case OpMul:
				value = left * right
			case OpDiv:
				if right == 0 {
					return 0, errors.New("division by zero")
				}
				value = left / right
			case OpMax:
				value = math.Max(left, right)
			case OpMin:
				value = math.Min(left, right)
			}
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return 0, errors.New("non-finite formula result")
			}
			stack = append(stack, value)
		case OpSign:
			if len(stack) < 1 {
				return 0, errors.New("formula stack underflow")
			}
			value := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			switch {
			case value > 0:
				stack = append(stack, 1)
			case value < 0:
				stack = append(stack, -1)
			default:
				stack = append(stack, 0)
			}
		default:
			return 0, errors.New("unsupported formula opcode")
		}
	}
	if len(stack) != 1 {
		return 0, errors.New("formula stack did not settle to one value")
	}
	return stack[0], nil
}

func compile(id string, defs map[string]model.FormulaDefinition, attrIndex map[string]uint16, resourceIndex map[string]uint16, visiting map[string]bool, out *[]Instr) error {
	def, ok := defs[id]
	if !ok {
		return errors.New("unknown formula: " + id)
	}
	if visiting[id] {
		return errors.New("formula cycle: " + id)
	}
	visiting[id] = true
	defer delete(visiting, id)

	switch def.Op {
	case "", "const":
		*out = append(*out, Instr{Op: OpConst, Value: def.Value})
	case "attr":
		idx, ok := attrIndex[def.Attr]
		if !ok {
			return errors.New("unknown attr: " + def.Attr)
		}
		readKind := def.AttrRead
		if readKind == "" {
			readKind = model.AttrReadResolved
		}
		*out = append(*out, Instr{Op: OpAttr, Attr: idx, ReadKind: readKind})
	case "resource":
		idx, ok := resourceIndex[def.Resource]
		if !ok {
			return errors.New("unknown resource: " + def.Resource)
		}
		*out = append(*out, Instr{Op: OpResource, Resource: idx})
	case "counter":
		if def.Counter == "" {
			return errors.New("counter key is empty")
		}
		*out = append(*out, Instr{Op: OpCounter, Counter: def.Counter})
	case "input":
		*out = append(*out, Instr{Op: OpInput})
	case "sign":
		if err := compile(def.Left, defs, attrIndex, resourceIndex, visiting, out); err != nil {
			return err
		}
		*out = append(*out, Instr{Op: OpSign})
	case "add", "sub", "mul", "div", "max", "min":
		if err := compile(def.Left, defs, attrIndex, resourceIndex, visiting, out); err != nil {
			return err
		}
		if err := compile(def.Right, defs, attrIndex, resourceIndex, visiting, out); err != nil {
			return err
		}
		*out = append(*out, Instr{Op: opFor(def.Op)})
	default:
		return errors.New("unsupported formula op: " + def.Op)
	}
	return nil
}

func opFor(op string) Op {
	switch op {
	case "add":
		return OpAdd
	case "sub":
		return OpSub
	case "mul":
		return OpMul
	case "div":
		return OpDiv
	case "max":
		return OpMax
	case "min":
		return OpMin
	default:
		return OpConst
	}
}
