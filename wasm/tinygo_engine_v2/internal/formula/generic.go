package formula

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/expression"
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
	ReadProcessActualCost
	ReadDamageSelf
	ReadEventLink
	ReadUseAmmoBefore
	ReadUseProviderStateBefore
	ReadSourceStatusPresent
	ReadTargetStatusPresent
	ReadUseChargeDuration
	ReadAuthoredRuntimeParameter
	ReadLinkedShieldPresent
	ReadEventSkillUseContactCount
	ReadProviderElapsedMs
	// ReadAuthoredAbilityParameter retains the declared runtime-input identity;
	// it must not inherit the looser internal ability.param read permissions.
	ReadAuthoredAbilityParameter
	ReadProcessStartState
	ReadReceivedLinkedShieldAbsorbed
	ReadProviderTargetStateRemainingMs
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
	GenericOpJumpIfZero
	GenericOpJump
)

// GenericInstr 是 generic formula 单条指令。
type GenericInstr struct {
	// 绑定索引只在目录原键一致时使用，0号槽由Bound明确区分未绑定。
	AttrIndex      int
	AttrIndexBound bool
	AttrKey        string
	AttrField      string
	// AuthoredRead只标识共同读取依赖；内部指令不借此改变战斗侧语义。
	AuthoredRead   bool
	Op             GenericOp
	Value          float64
	ReadKind       GenericReadKind
	ReadKey        string
	RefIndex       uint16
	ReferenceBound bool
	Decimals       int
	JumpTarget     int // 指令下标；仅前跳，可指向程序末尾。
}

// GenericProgram 是已编译的 generic formula 程序。
type GenericProgram struct {
	// PlanBytes计入使用点保留的归属及定位等计划描述。
	PlanBytes uint64
	Key       string
	Instr     []GenericInstr
	// Authored与Instr互斥；新伤害定义使用共同只读程序。
	Authored *expression.Program
	// BindingBytes是本使用点在执行计划保留的绑定和读值描述计费。
	BindingBytes  uint64
	NamedBinding  *NamedBinding
	DeclaredNamed bool
}

// CompileGenericFormula 编译单个表达式；失败不返回可被消费的部分指令。
func CompileGenericFormula(expr model.GenericFormulaExpr, path string, named map[string]model.GenericFormulaExpr, visiting map[string]bool, addError func(code model.GenericErrCode, path, message, ref string)) []GenericInstr {
	var instr []GenericInstr
	if visiting == nil {
		visiting = make(map[string]bool)
	}
	if !compileGenericNode(expr, path, named, visiting, &instr, 1, addError) {
		return nil
	}
	if !validGenericProgramStack(instr) {
		addError(model.GenericErrFormulaTypeError, path, "formula bytecode stack or jump is invalid", "")
		return nil
	}
	return instr
}

// CompileNamedFormulas 编译命名公式表。
func CompileNamedFormulas(formulas []model.NamedFormula, addError func(code model.GenericErrCode, path, message, ref string)) GenericRegistry {
	reg := GenericRegistry{Programs: make([]GenericProgram, 0), Index: make(map[string]GenericProgramID)}
	CompileDeclaredNamedFormulas(formulas, nil, &reg, addError)
	return reg
}

const maxGenericFormulaDepth = 32

func compileGenericNode(expr model.GenericFormulaExpr, path string, named map[string]model.GenericFormulaExpr, visiting map[string]bool, out *[]GenericInstr, depth int, addError func(code model.GenericErrCode, path, message, ref string)) bool {
	if depth > maxGenericFormulaDepth {
		addError(model.GenericErrFormulaTypeError, path, "formula exceeds maximum depth", "")
		return false
	}
	if expr.Op == "" {
		addError(model.GenericErrFormulaTypeError, path+".op", "formula op is required", "")
		return false
	}
	emit := func(instr GenericInstr) bool {
		if len(*out) >= MaxGenericProgramInstructions {
			addError(model.GenericErrFormulaTypeError, path, "formula instruction count exceeds maximum", "")
			return false
		}
		*out = append(*out, instr)
		return true
	}
	switch expr.Op {
	case "const":
		if expr.Value == nil {
			addError(model.GenericErrFormulaTypeError, path+".value", "const formula requires value", "")
			return false
		}
		if math.IsNaN(*expr.Value) || math.IsInf(*expr.Value, 0) {
			addError(model.GenericErrFormulaTypeError, path+".value", "const value must be finite", "")
			return false
		}
		return emit(GenericInstr{Op: GenericOpConst, Value: *expr.Value})
	case "read":
		kind, key, ok := parseReadPath(expr.Path)
		if !ok {
			addError(model.GenericErrFormulaTypeError, path+".path", "formula read path not allowed in P0", expr.Path)
			return false
		}
		return emit(GenericInstr{Op: GenericOpRead, ReadKind: kind, ReadKey: key})
	case "ref":
		if expr.Ref == "" {
			addError(model.GenericErrFormulaTypeError, path+".ref", "ref formula requires ref key", "")
			return false
		}
		if _, ok := named[expr.Ref]; !ok {
			addError(model.GenericErrUnknownRef, path+".ref", "unknown formula ref", expr.Ref)
			return false
		}
		if linked := named[expr.Ref].LinkedProgram; linked != nil {
			return emit(GenericInstr{Op: GenericOpRef, RefIndex: *linked})
		}
		if visiting[expr.Ref] {
			addError(model.GenericErrFormulaTypeError, path+".ref", "formula ref cycle detected", expr.Ref)
			return false
		}
		visiting[expr.Ref] = true
		ok := compileGenericNode(named[expr.Ref], path+".ref:"+expr.Ref, named, visiting, out, depth+1, addError)
		delete(visiting, expr.Ref)
		return ok
	case "add", "sub", "mul", "div", "min", "max":
		if len(expr.Args) < 2 {
			addError(model.GenericErrFormulaTypeError, path+".args", "binary formula requires two args", expr.Op)
			return false
		}
		if !compileGenericNode(expr.Args[0], path+".args[0]", named, visiting, out, depth+1, addError) ||
			!compileGenericNode(expr.Args[1], path+".args[1]", named, visiting, out, depth+1, addError) {
			return false
		}
		return emit(GenericInstr{Op: genericOpFor(expr.Op)})
	case "eq", "ne", "lt", "lte", "gt", "gte":
		if len(expr.Args) != 2 {
			addError(model.GenericErrFormulaTypeError, path+".args", "comparison formula requires exactly two args", expr.Op)
			return false
		}
		if !compileGenericNode(expr.Args[0], path+".args[0]", named, visiting, out, depth+1, addError) ||
			!compileGenericNode(expr.Args[1], path+".args[1]", named, visiting, out, depth+1, addError) {
			return false
		}
		return emit(GenericInstr{Op: genericOpFor(expr.Op)})
	case "if":
		if len(expr.Args) != 3 {
			addError(model.GenericErrFormulaTypeError, path+".args", "if formula requires exactly three args", expr.Op)
			return false
		}
		if !compileGenericNode(expr.Args[0], path+".args[0]", named, visiting, out, depth+1, addError) {
			return false
		}
		conditionJump := len(*out)
		if !emit(GenericInstr{Op: GenericOpJumpIfZero}) {
			return false
		}
		if !compileGenericNode(expr.Args[1], path+".args[1]", named, visiting, out, depth+1, addError) {
			return false
		}
		endJump := len(*out)
		if !emit(GenericInstr{Op: GenericOpJump}) {
			return false
		}
		(*out)[conditionJump].JumpTarget = len(*out)
		if !compileGenericNode(expr.Args[2], path+".args[2]", named, visiting, out, depth+1, addError) {
			return false
		}
		(*out)[endJump].JumpTarget = len(*out)
		return true
	case "clamp":
		valueExpr := expr.Expr
		if valueExpr == nil && len(expr.Args) > 0 {
			valueExpr = &expr.Args[0]
		}
		if valueExpr == nil || expr.Min == nil || expr.Max == nil {
			addError(model.GenericErrFormulaTypeError, path, "clamp requires value, min and max", "")
			return false
		}
		if !compileGenericNode(*valueExpr, path+".value", named, visiting, out, depth+1, addError) ||
			!compileGenericNode(*expr.Min, path+".min", named, visiting, out, depth+1, addError) ||
			!compileGenericNode(*expr.Max, path+".max", named, visiting, out, depth+1, addError) {
			return false
		}
		return emit(GenericInstr{Op: GenericOpClamp})
	case "round", "floor", "ceil", "trunc":
		valueExpr := expr.Expr
		if valueExpr == nil && len(expr.Args) > 0 {
			valueExpr = &expr.Args[0]
		}
		if valueExpr == nil {
			addError(model.GenericErrFormulaTypeError, path, expr.Op+" requires value expression", "")
			return false
		}
		if !compileGenericNode(*valueExpr, path+".value", named, visiting, out, depth+1, addError) {
			return false
		}
		decimals := 0
		if expr.Decimals != nil {
			decimals = *expr.Decimals
		}
		return emit(GenericInstr{Op: genericOpFor(expr.Op), Decimals: decimals})
	default:
		addError(model.GenericErrFormulaTypeError, path+".op", "unsupported formula op", expr.Op)
		return false
	}
}

// 按全部可达分支检查栈深度；只接受前跳，汇合处的栈深必须一致。
func validGenericProgramStack(instr []GenericInstr) bool {
	if len(instr) == 0 {
		return false
	}
	depths := make([]int, len(instr)+1)
	for i := range depths {
		depths[i] = -1
	}
	depths[0] = 0
	propagate := func(pc, depth int) bool {
		if depths[pc] >= 0 && depths[pc] != depth {
			return false
		}
		depths[pc] = depth
		return true
	}
	for pc, in := range instr {
		depth := depths[pc]
		if depth < 0 {
			continue
		}
		pop, push := 0, 0
		switch in.Op {
		case GenericOpConst, GenericOpRead, GenericOpRef:
			push = 1
		case GenericOpAdd, GenericOpSub, GenericOpMul, GenericOpDiv, GenericOpMin, GenericOpMax,
			GenericOpEq, GenericOpNe, GenericOpLt, GenericOpLte, GenericOpGt, GenericOpGte:
			pop, push = 2, 1
		case GenericOpClamp:
			pop, push = 3, 1
		case GenericOpRound, GenericOpFloor, GenericOpCeil, GenericOpTrunc:
			pop, push = 1, 1
		case GenericOpJumpIfZero:
			if depth < 1 || !validForwardJump(pc, in.JumpTarget, len(instr)) {
				return false
			}
			if !propagate(pc+1, depth-1) || !propagate(in.JumpTarget, depth-1) {
				return false
			}
			continue
		case GenericOpJump:
			if !validForwardJump(pc, in.JumpTarget, len(instr)) || !propagate(in.JumpTarget, depth) {
				return false
			}
			continue
		default:
			return false
		}
		if depth < pop || !propagate(pc+1, depth-pop+push) {
			return false
		}
	}
	return depths[len(instr)] == 1
}

func validForwardJump(pc, target, length int) bool {
	return target > pc && target <= length
}

func parseReadPath(path string) (GenericReadKind, string, bool) {
	if path == "use.charge_duration_ms" {
		return ReadUseChargeDuration, "charge_duration_ms", true
	}
	if path == "use.ammo.before" {
		return ReadUseAmmoBefore, "before", true
	}
	if strings.HasPrefix(path, "use.provider_state_before.") {
		key := strings.TrimPrefix(path, "use.provider_state_before.")
		return ReadUseProviderStateBefore, key, key != "" && !strings.ContainsAny(key, ".[] ")
	}
	for _, statusPath := range []struct {
		prefix string
		kind   GenericReadKind
	}{{"source.status.", ReadSourceStatusPresent}, {"target.status.", ReadTargetStatusPresent}} {
		if strings.HasPrefix(path, statusPath.prefix) {
			key := strings.TrimSuffix(strings.TrimPrefix(path, statusPath.prefix), ".present")
			return statusPath.kind, key, key != "" && !strings.ContainsAny(key, ".[] ") && strings.HasSuffix(path, ".present")
		}
	}

	if strings.HasPrefix(path, "process.actual_cost.") {
		key := strings.TrimPrefix(path, "process.actual_cost.")
		return ReadProcessActualCost, key, key != "" && !strings.ContainsAny(key, ".[] ")
	}
	if path == "" {
		return 0, "", false
	}
	if path == "provider.elapsed_ms" {
		return ReadProviderElapsedMs, "elapsed_ms", true
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
	if strings.HasPrefix(path, "provider.linked_shield[") && strings.HasSuffix(path, "].present") {
		key := strings.TrimSuffix(strings.TrimPrefix(path, "provider.linked_shield["), "].present")
		return ReadLinkedShieldPresent, key, key != "" && !strings.ContainsAny(key, "[]\r\n")
	}
	if strings.HasPrefix(path, "provider.target_state_remaining_ms.") {
		key := strings.TrimPrefix(path, "provider.target_state_remaining_ms.")
		return ReadProviderTargetStateRemainingMs, key, key != "" && !strings.ContainsAny(key, ".[] \t\r\n")
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
	if path == model.FormulaPathDamageSelf {
		return ReadDamageSelf, "self", true
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
		if name == "" || strings.ContainsAny(name, "[] \t\n\r") {
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

// EventDamageSnapshotField names the frozen event.damage.* numeric paths.
var EventDamageSnapshotFields = map[string]struct{}{
	"baseRawAmount":          {},
	"preMitigationAmount":    {},
	"mitigatedAmount":        {},
	"actualHpLoss":           {},
	"killed":                 {},
	"originalCritChance":     {},
	"effectiveCritChance":    {},
	"forcedCritWeight":       {},
	"naturalCritWeight":      {},
	"forcedCritMultiplier":   {},
	"naturalCritMultiplier":  {},
	"normalPart":             {},
	"critPart":               {},
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
	if strings.HasPrefix(path, "event.damage.linked_shield[") && strings.HasSuffix(path, "].absorbed") {
		key := strings.TrimSuffix(strings.TrimPrefix(path, "event.damage.linked_shield["), "].absorbed")
		return ReadReceivedLinkedShieldAbsorbed, key, key != "" && !strings.ContainsAny(key, "[]\t\r\n ")
	}
	if path == "event.skill_use.contactCount" {
		return ReadEventSkillUseContactCount, "contactCount", true
	}
	if path == "event.link.index" || path == "event.link.count" {
		return ReadEventLink, strings.TrimPrefix(path, "event.link."), true
	}
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

// TryFoldConst 仅在实际选中路径不读取运行值时折叠；未选分支仍由编译完整校验。
// 已选路径的除零等计算错误仍视为已折叠的非法值。
func TryFoldConst(instr []GenericInstr) (float64, bool) {
	if len(instr) == 0 {
		return 0, false
	}
	reg := GenericRegistry{Programs: []GenericProgram{{Instr: instr}}}
	value, err := reg.eval(0, &GenericEvalContext{}, true, 1, new(int))
	if err == errConstFormulaRead {
		return 0, false
	}
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
