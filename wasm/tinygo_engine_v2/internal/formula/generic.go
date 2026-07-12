package formula

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/model"
)

// GenericProgramID 是 generic formula bytecode 程序索引。
type GenericProgramID uint16

// GenericReadKind 标识 P0 read path 类别。
type GenericReadKind uint8

const (
	ReadSourceAttr GenericReadKind = iota + 1
	ReadTargetAttr
	ReadSourceResource
	ReadTargetResource
	ReadAbilityParam
	ReadProviderState
	ReadProviderTargetState
)

// GenericOp 是 generic formula bytecode 操作码。
type GenericOp uint8

const (
	GenericOpConst GenericOp = iota
	GenericOpRead
	GenericOpRef
	GenericOpAdd
	GenericOpSub
	GenericOpMul
	GenericOpDiv
	GenericOpMin
	GenericOpMax
	GenericOpClamp
	GenericOpRound
	GenericOpFloor
	GenericOpCeil
	GenericOpTrunc
	GenericOpEq
	GenericOpNe
	GenericOpLt
	GenericOpLte
	GenericOpGt
	GenericOpGte
)

// GenericInstr 是 generic formula 单条指令。
type GenericInstr struct {
	Op       GenericOp
	Value    float64
	ReadKind GenericReadKind
	ReadKey  string
	RefIndex uint16
	Decimals int
}

// GenericProgram 是已编译的 generic formula 程序。
type GenericProgram struct {
	Key   string
	Instr []GenericInstr
}

// GenericRegistry 持有 generic formula 程序表。
type GenericRegistry struct {
	Programs []GenericProgram
	Index    map[string]GenericProgramID
}

// CompileGenericFormula 将单个 GenericFormulaExpr 编译为指令序列（collect-all）。
func CompileGenericFormula(expr model.GenericFormulaExpr, path string, named map[string]model.GenericFormulaExpr, visiting map[string]bool, addError func(code model.GenericErrCode, path, message, ref string)) []GenericInstr {
	var instr []GenericInstr
	compileGenericNode(expr, path, named, visiting, &instr, addError)
	return instr
}

// CompileNamedFormulas 编译命名公式表。
func CompileNamedFormulas(formulas []model.NamedFormula, addError func(code model.GenericErrCode, path, message, ref string)) GenericRegistry {
	reg := GenericRegistry{Programs: make([]GenericProgram, 0, len(formulas)), Index: make(map[string]GenericProgramID, len(formulas))}
	named := make(map[string]model.GenericFormulaExpr, len(formulas))
	for i, def := range formulas {
		path := "formulas[" + itoa(i) + "]"
		if def.Key == "" {
			addError(model.GenericErrMissingRequiredField, path+".key", "formula key is required", "")
			continue
		}
		if _, exists := named[def.Key]; exists {
			addError(model.GenericErrUnknownRef, path+".key", "duplicate formula key", def.Key)
			continue
		}
		named[def.Key] = def.Expression
	}
	for i, def := range formulas {
		if def.Key == "" {
			continue
		}
		path := "formulas[" + itoa(i) + "].expression"
		visiting := map[string]bool{}
		instr := CompileGenericFormula(def.Expression, path, named, visiting, addError)
		if len(instr) == 0 {
			continue
		}
		reg.Index[def.Key] = GenericProgramID(len(reg.Programs))
		reg.Programs = append(reg.Programs, GenericProgram{Key: def.Key, Instr: instr})
	}
	return reg
}

func compileGenericNode(expr model.GenericFormulaExpr, path string, named map[string]model.GenericFormulaExpr, visiting map[string]bool, out *[]GenericInstr, addError func(code model.GenericErrCode, path, message, ref string)) {
	if expr.Op == "" {
		addError(model.GenericErrFormulaTypeError, path+".op", "formula op is required", "")
		return
	}
	switch expr.Op {
	case "const":
		if expr.Value == nil {
			addError(model.GenericErrFormulaTypeError, path+".value", "const formula requires value", "")
			return
		}
		if math.IsNaN(*expr.Value) || math.IsInf(*expr.Value, 0) {
			addError(model.GenericErrFormulaTypeError, path+".value", "const value must be finite", "")
			return
		}
		*out = append(*out, GenericInstr{Op: GenericOpConst, Value: *expr.Value})
	case "read":
		kind, key, ok := parseReadPath(expr.Path)
		if !ok {
			addError(model.GenericErrFormulaTypeError, path+".path", "formula read path not allowed in P0", expr.Path)
			return
		}
		*out = append(*out, GenericInstr{Op: GenericOpRead, ReadKind: kind, ReadKey: key})
	case "ref":
		if expr.Ref == "" {
			addError(model.GenericErrFormulaTypeError, path+".ref", "ref formula requires ref key", "")
			return
		}
		if _, ok := named[expr.Ref]; !ok {
			addError(model.GenericErrUnknownRef, path+".ref", "unknown formula ref", expr.Ref)
			return
		}
		if visiting[expr.Ref] {
			addError(model.GenericErrFormulaTypeError, path+".ref", "formula ref cycle detected", expr.Ref)
			return
		}
		visiting[expr.Ref] = true
		compileGenericNode(named[expr.Ref], path+".ref:"+expr.Ref, named, visiting, out, addError)
		delete(visiting, expr.Ref)
	case "add", "sub", "mul", "div", "min", "max":
		if len(expr.Args) < 2 {
			addError(model.GenericErrFormulaTypeError, path+".args", "binary formula requires two args", expr.Op)
			return
		}
		compileGenericNode(expr.Args[0], path+".args[0]", named, visiting, out, addError)
		compileGenericNode(expr.Args[1], path+".args[1]", named, visiting, out, addError)
		*out = append(*out, GenericInstr{Op: genericOpFor(expr.Op)})
	case "eq", "ne", "lt", "lte", "gt", "gte":
		if len(expr.Args) != 2 {
			addError(model.GenericErrFormulaTypeError, path+".args", "comparison formula requires exactly two args", expr.Op)
			return
		}
		compileGenericNode(expr.Args[0], path+".args[0]", named, visiting, out, addError)
		compileGenericNode(expr.Args[1], path+".args[1]", named, visiting, out, addError)
		*out = append(*out, GenericInstr{Op: genericOpFor(expr.Op)})
	case "clamp":
		valueExpr := expr.Expr
		if valueExpr == nil && len(expr.Args) > 0 {
			valueExpr = &expr.Args[0]
		}
		if valueExpr == nil || expr.Min == nil || expr.Max == nil {
			addError(model.GenericErrFormulaTypeError, path, "clamp requires value, min and max", "")
			return
		}
		compileGenericNode(*valueExpr, path+".value", named, visiting, out, addError)
		compileGenericNode(*expr.Min, path+".min", named, visiting, out, addError)
		compileGenericNode(*expr.Max, path+".max", named, visiting, out, addError)
		*out = append(*out, GenericInstr{Op: GenericOpClamp})
	case "round", "floor", "ceil", "trunc":
		valueExpr := expr.Expr
		if valueExpr == nil && len(expr.Args) > 0 {
			valueExpr = &expr.Args[0]
		}
		if valueExpr == nil {
			addError(model.GenericErrFormulaTypeError, path, expr.Op+" requires value expression", "")
			return
		}
		compileGenericNode(*valueExpr, path+".value", named, visiting, out, addError)
		decimals := 0
		if expr.Decimals != nil {
			decimals = *expr.Decimals
		}
		*out = append(*out, GenericInstr{Op: genericOpFor(expr.Op), Decimals: decimals})
	default:
		addError(model.GenericErrFormulaTypeError, path+".op", "unsupported formula op", expr.Op)
	}
}

func parseReadPath(path string) (GenericReadKind, string, bool) {
	if path == "" {
		return 0, "", false
	}
	if strings.HasPrefix(path, "history.") {
		return 0, "", false
	}
	if strings.HasPrefix(path, "ability.state.") {
		return 0, "", false
	}
	if strings.HasPrefix(path, "event.") {
		return 0, "", false
	}
	if strings.HasPrefix(path, "source.provider[") || strings.HasPrefix(path, "target.provider[") {
		return 0, "", false
	}
	if strings.HasPrefix(path, "provider.state.") {
		key := strings.TrimPrefix(path, "provider.state.")
		if key == "" {
			return 0, "", false
		}
		return ReadProviderState, key, true
	}
	if strings.HasPrefix(path, "provider.target_state.") {
		key := strings.TrimPrefix(path, "provider.target_state.")
		if key == "" {
			return 0, "", false
		}
		return ReadProviderTargetState, key, true
	}
	if strings.HasPrefix(path, "source.attr.") {
		return ReadSourceAttr, strings.TrimPrefix(path, "source.attr."), true
	}
	if strings.HasPrefix(path, "target.attr.") {
		return ReadTargetAttr, strings.TrimPrefix(path, "target.attr."), true
	}
	if strings.HasPrefix(path, "source.resource.") {
		return ReadSourceResource, strings.TrimPrefix(path, "source.resource."), true
	}
	if strings.HasPrefix(path, "target.resource.") {
		return ReadTargetResource, strings.TrimPrefix(path, "target.resource."), true
	}
	if strings.HasPrefix(path, "ability.param.") {
		return ReadAbilityParam, strings.TrimPrefix(path, "ability.param."), true
	}
	return 0, "", false
}

func genericOpFor(op string) GenericOp {
	switch op {
	case "add":
		return GenericOpAdd
	case "sub":
		return GenericOpSub
	case "mul":
		return GenericOpMul
	case "div":
		return GenericOpDiv
	case "min":
		return GenericOpMin
	case "max":
		return GenericOpMax
	case "clamp":
		return GenericOpClamp
	case "round":
		return GenericOpRound
	case "floor":
		return GenericOpFloor
	case "ceil":
		return GenericOpCeil
	case "trunc":
		return GenericOpTrunc
	case "eq":
		return GenericOpEq
	case "ne":
		return GenericOpNe
	case "lt":
		return GenericOpLt
	case "lte":
		return GenericOpLte
	case "gt":
		return GenericOpGt
	case "gte":
		return GenericOpGte
	default:
		return GenericOpConst
	}
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	var buf [12]byte
	pos := len(buf)
	n := v
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
