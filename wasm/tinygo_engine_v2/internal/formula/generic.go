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
	ReadEventEntrySourceAttr
	ReadEventEntryTargetAttr
	ReadEventEntrySourceResource
	ReadEventEntryTargetResource
	ReadEventSourceAttr
	ReadEventTargetAttr
	ReadEventSourceResource
	ReadEventTargetResource
	// ReadDamageAmount is a transient read available only while a pipeline damage modifier evaluates.
	ReadDamageAmount
	// ReadDamageTrait / ReadDamageType are boolean (0/1) predicates over the current damage operation.
	ReadDamageTrait
	ReadDamageType
	// ReadDamageCastOrigin / ReadDamageAbilityType are boolean (0/1) provenance predicates.
	ReadDamageCastOrigin
	ReadDamageAbilityType
	// ReadEventDamage is an immutable numeric snapshot field under event.damage.*.
	ReadEventDamage
	// ReadEventSkillHit 读取 event.skill_hit.firstContact|blocked；缺值必须报路径。
	ReadEventSkillHit
	// ReadOperationOutput 读取 operation.output.<ref>.<kind>；仅同帧已结算伤害。
	ReadOperationOutput
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
	if strings.HasPrefix(path, "operation.output.") {
		return parseOperationOutputPath(path)
	}
	if strings.HasPrefix(path, "history.") {
		return 0, "", false
	}
	if strings.HasPrefix(path, "ability.state.") {
		return 0, "", false
	}
	if strings.HasPrefix(path, "event.") {
		return parseEventReadPath(path)
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
	if path == "damage.amount" {
		return ReadDamageAmount, "amount", true
	}
	if strings.HasPrefix(path, "damage.trait.") {
		name := strings.TrimPrefix(path, "damage.trait.")
		if name == "" || strings.Contains(name, ".") || strings.Contains(name, "/") {
			return 0, "", false
		}
		return ReadDamageTrait, name, true
	}
	if strings.HasPrefix(path, "damage.type.") {
		name := strings.TrimPrefix(path, "damage.type.")
		if !isKnownDamageTypePredicateName(name) {
			return 0, "", false
		}
		return ReadDamageType, name, true
	}
	if strings.HasPrefix(path, "damage.cast_origin.") {
		name := strings.TrimPrefix(path, "damage.cast_origin.")
		if name == "" || strings.Contains(name, ".") || strings.Contains(name, "/") {
			return 0, "", false
		}
		return ReadDamageCastOrigin, name, true
	}
	if strings.HasPrefix(path, "damage.ability_type.") {
		name := strings.TrimPrefix(path, "damage.ability_type.")
		if name == "" || strings.Contains(name, ".") || strings.Contains(name, "/") {
			return 0, "", false
		}
		return ReadDamageAbilityType, name, true
	}
	return 0, "", false
}

// isKnownDamageTypePredicateName reports whether name is a compile-time damage.type.* token.
func isKnownDamageTypePredicateName(name string) bool {
	switch name {
	case "physical", "magic", "true":
		return true
	default:
		return false
	}
}

// CanonicalDamageTypeKey maps a damage.type.* predicate name or settlement alias to the
// canonical damage/* catalog key used for runtime matching.
func CanonicalDamageTypeKey(nameOrKey string) string {
	switch strings.ToLower(nameOrKey) {
	case "physical", "damage/physical":
		return "damage/physical"
	case "magic", "damage/magic", "magical", "damage/magical":
		return "damage/magic"
	case "true", "damage/true":
		return "damage/true"
	default:
		return nameOrKey
	}
}

// EventDamageSnapshotField names the frozen event.damage.* numeric paths.
var EventDamageSnapshotFields = map[string]struct{}{
	"baseRawAmount":         {},
	"preMitigationAmount":   {},
	"mitigatedAmount":       {},
	"originalCritChance":    {},
	"effectiveCritChance":   {},
	"forcedCritWeight":      {},
	"naturalCritWeight":     {},
	"forcedCritMultiplier":  {},
	"naturalCritMultiplier": {},
	"normalPart":            {},
	"critPart":              {},
	"naturalBranchRawAmount": {},
}

func parseOperationOutputPath(path string) (GenericReadKind, string, bool) {
	rest := strings.TrimPrefix(path, "operation.output.")
	if rest == "" || strings.HasPrefix(rest, ".") {
		return 0, "", false
	}
	dot := strings.IndexByte(rest, '.')
	if dot <= 0 || dot == len(rest)-1 {
		return 0, "", false
	}
	ref := rest[:dot]
	kind := rest[dot+1:]
	if ref == "" || strings.Contains(ref, ".") {
		return 0, "", false
	}
	if _, ok := model.ValidOperationOutputKind[kind]; !ok {
		return 0, "", false
	}
	return ReadOperationOutput, rest, true
}

func parseEventReadPath(path string) (GenericReadKind, string, bool) {
	if path == model.FormulaPathSkillHitFirstContact {
		return ReadEventSkillHit, "firstContact", true
	}
	if path == model.FormulaPathSkillHitBlocked {
		return ReadEventSkillHit, "blocked", true
	}
	if strings.HasPrefix(path, "event.damage.") {
		key := strings.TrimPrefix(path, "event.damage.")
		if key == "" {
			return 0, "", false
		}
		if _, ok := EventDamageSnapshotFields[key]; !ok {
			return 0, "", false
		}
		return ReadEventDamage, key, true
	}
	type prefixKind struct {
		prefix string
		kind   GenericReadKind
	}
	prefixes := []prefixKind{
		{"event.entry_source.attr.", ReadEventEntrySourceAttr},
		{"event.entry_target.attr.", ReadEventEntryTargetAttr},
		{"event.entry_source.resource.", ReadEventEntrySourceResource},
		{"event.entry_target.resource.", ReadEventEntryTargetResource},
		{"event.source.attr.", ReadEventSourceAttr},
		{"event.target.attr.", ReadEventTargetAttr},
		{"event.source.resource.", ReadEventSourceResource},
		{"event.target.resource.", ReadEventTargetResource},
	}
	for _, p := range prefixes {
		if strings.HasPrefix(path, p.prefix) {
			key := strings.TrimPrefix(path, p.prefix)
			if key == "" {
				return 0, "", false
			}
			return p.kind, key, true
		}
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

// maxInt64ExclusiveFloat 是不能落入 int64 的下限（2^63）。
const maxInt64ExclusiveFloat = 9223372036854775808.0

// ValidPositiveInt64DurationMs 判断期限在转换为 int64 前是否为有限正整数毫秒。
func ValidPositiveInt64DurationMs(value float64) bool {
	return finite(value) && value == math.Trunc(value) && value > 0 && value < maxInt64ExclusiveFloat
}

// TryFoldConst 仅在程序不含 read 时折叠常量。折叠失败（非有限、除零等）仍视为已折叠的非法值。
func TryFoldConst(instr []GenericInstr) (float64, bool) {
	if len(instr) == 0 {
		return 0, false
	}
	for _, in := range instr {
		if in.Op == GenericOpRead {
			return 0, false
		}
	}
	reg := GenericRegistry{Programs: []GenericProgram{{Instr: instr}}}
	value, err := reg.Eval(0, GenericEvalContext{})
	if err != nil {
		return math.NaN(), true
	}
	return value, true
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
