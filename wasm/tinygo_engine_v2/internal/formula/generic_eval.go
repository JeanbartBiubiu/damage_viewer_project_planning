package formula

import (
	"errors"
	"math"
	"strings"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/expression"
	"tinygo_engine_v2/internal/inputbinding"
	"tinygo_engine_v2/internal/model"
)

// GenericEvalContext 是 generic formula 运行时只读视图。
type GenericEvalContext struct {
	ReceivedShieldReader ReceivedShieldReader
	LinkedShieldReader   LinkedShieldReader
	// 只有明确作者派生使用点设置。内部用途读取仍使用SourceAttrs/TargetAttrs。
	HasAuthoredActorContext bool
	AuthoredSourceAttrs     attribute.Table
	AuthoredTargetAttrs     attribute.Table
	AuthoredCombatantKey    string
	RuntimeSkillKey         string
	RuntimeParameters       map[string]float64
	HasUseChargeDuration    bool
	UseChargeDurationMs     int64
	HasUseAmmoBefore        bool
	UseAmmoBefore           float64
	UseProviderStateBefore  []ProviderStateBeforeValue
	HasStatusContext        bool
	SourceStatuses          map[string]bool
	TargetStatuses          map[string]bool
	ReadInput               expression.ReadInput
	HasEventLink            bool
	LinkIndex               int
	LinkCount               int
	ProcessActualCosts      map[string]float64
	HasProcessActualCosts   bool
	ProcessStartStateValues []ProcessStartStateValue
	SourceAttrs             attribute.Table
	TargetAttrs             attribute.Table
	SourceResources         map[string]model.ResourceSlotDef
	TargetResources         map[string]model.ResourceSlotDef
	AbilityParams           map[string]float64
	// StrictReads 用于需要区分缺值与真实零值的吸血效率和治疗修正。
	StrictReads bool

	// Provider state reads require a concrete provider context.
	HasProviderContext    bool
	HasProviderElapsed    bool
	ProviderElapsedMs     int64
	ProviderState         map[string]float64
	ProviderTargetState   map[string]float64
	ProviderStateDefaults map[string]float64

	// Event snapshot reads require an emit_event listener / child-ability context.
	// Participants are the original emitted event source/target (not owner-remapped).
	HasEventContext           bool
	EventEntrySourceAttrs     attribute.Table
	EventEntryTargetAttrs     attribute.Table
	EventEntrySourceResources map[string]model.ResourceSlotDef
	EventEntryTargetResources map[string]model.ResourceSlotDef
	EventSourceAttrs          attribute.Table
	EventTargetAttrs          attribute.Table
	EventSourceResources      map[string]model.ResourceSlotDef
	EventTargetResources      map[string]model.ResourceSlotDef

	// DamageAmount is transient: only set while evaluating a pipeline damage modifier.
	// Missing damage context must fail structurally (never silently return zero).
	HasDamageContext      bool
	DamageAmount          float64
	HasDamageParticipants bool
	DamageSelf            bool
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
	HasEventSkillHit        bool
	HasSkillHitFirstContact bool
	SkillHitFirstContact    float64
	HasSkillHitBlocked      bool
	SkillHitBlocked         float64
	HasSkillUseContactCount bool
	SkillUseContactCount    int

	// Operation output reads require the current execution frame after a real damage settlement.
	HasOperationOutputs bool
	OperationOutputs    map[string]OperationOutputValues
}

// ProcessStartStateValue is an immutable per-use capture. Small ordered slices
// preserve the compiled field identity without a runtime composite map key.
type ProcessStartStateValue struct {
	StateKey string
	Value    float64
}

// LinkedShieldReader resolves one compile-bound definition in a concrete provider frame.
type LinkedShieldReader interface {
	LinkedShieldPresent(providerDefinitionIndex uint16) (float64, error)
}

// Only a mounted native received-damage listener condition supplies this reader.
type ReceivedShieldReader interface {
	ReceivedLinkedShieldAbsorbed(providerDefinitionIndex uint16) (float64, error)
}

// OperationOutputValues 保存一次真实伤害管道的封闭口径。
type OperationOutputValues struct {
	PostDefenseDamage float64
	ShieldAbsorbed    float64
	ActualHPLoss      float64
}

// EventDamageSnapshot is the immutable numeric freeze under event.damage.*.
type EventDamageSnapshot struct {
	HasActualHPLoss        bool
	ActualHPLoss           float64
	HasKilled              bool
	Killed                 float64
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
	return r.eval(id, &ctx, false, 1, new(int))
}

// EvalContext 同步借用只读上下文，避免再次复制完整视图；不会保存指针。
// 调用方及自定义读取回调在求值期间不得修改上下文字段。
func (r GenericRegistry) EvalContext(id GenericProgramID, ctx *GenericEvalContext) (float64, error) {
	if ctx == nil {
		return 0, errors.New("formula evaluation context is required")
	}
	return r.eval(id, ctx, false, 1, new(int))
}

var errConstFormulaRead = errors.New("formula requires runtime read")

// AuthoredEvaluationError保留共同错误码和原表达式JSON字段定位。
type AuthoredEvaluationError struct {
	CombatantKey               string
	Issue                      expression.ContractIssue
	ProgramKey, DefinitionPath string
}

func (e *AuthoredEvaluationError) Error() string { return e.Issue.Code + " at " + e.Issue.Path }

func (r GenericRegistry) programForEvaluation(id GenericProgramID, depth int, spent *int) (*GenericProgram, error) {
	if depth > 32 {
		return nil, &AuthoredEvaluationError{Issue: expression.ContractIssue{Code: "FORMULA_LIMIT"}}
	}
	if int(id) >= len(r.Programs) {
		return nil, errors.New("formula id out of range")
	}
	program := &r.Programs[id]
	charge := len(program.Instr)
	if program.Authored != nil {
		charge = program.Authored.Stats().Instructions
	}
	if charge > MaxGenericTotalInstructions-*spent {
		return nil, &AuthoredEvaluationError{Issue: expression.ContractIssue{Code: "FORMULA_LIMIT"}, ProgramKey: program.Key}
	}
	*spent += charge
	return program, nil
}

// EvalBound直接执行已注册作者程序的同步数值绑定，复用通用指令计费。
// 它不创建供值闭包，也不保存values；具名程序仍走各自的作者绑定。
func (r GenericRegistry) EvalBound(id GenericProgramID, binding *inputbinding.Plan, values []inputbinding.Value) (float64, error) {
	var spent int
	program, err := r.programForEvaluation(id, 1, &spent)
	if err != nil {
		return 0, err
	}
	if program.Authored == nil || program.NamedBinding != nil || len(program.Instr) != 0 {
		return 0, &AuthoredEvaluationError{Issue: expression.ContractIssue{Code: "FORMULA_INVALID_PROGRAM"}}
	}
	result, issue := binding.Evaluate(program.Authored, values)
	if issue != nil {
		return 0, &AuthoredEvaluationError{Issue: *issue, ProgramKey: program.Key}
	}
	return result.Value, nil
}

func (r GenericRegistry) eval(id GenericProgramID, ctx *GenericEvalContext, constOnly bool, depth int, spent *int) (float64, error) {
	program, err := r.programForEvaluation(id, depth, spent)
	if err != nil {
		return 0, err
	}
	if program.Authored != nil {
		if len(program.Instr) != 0 {
			return 0, &AuthoredEvaluationError{Issue: expression.ContractIssue{Code: "FORMULA_INVALID_PROGRAM"}}
		}
		if constOnly && program.NamedBinding == nil && program.Authored.Stats().Inputs != 0 {
			return 0, errConstFormulaRead
		}
		var result expression.Evaluation
		var issue *expression.ContractIssue
		if program.NamedBinding != nil {
			result, issue = program.NamedBinding.evaluate(program.Authored, ctx, constOnly)
		} else {
			result, issue = program.Authored.Evaluate(ctx.ReadInput)
		}
		if issue != nil {
			path := ""
			if program.NamedBinding != nil {
				path = program.NamedBinding.path
			}
			return 0, &AuthoredEvaluationError{Issue: *issue, ProgramKey: program.Key, DefinitionPath: path, CombatantKey: ctx.AuthoredCombatantKey}
		}
		return result.Value, nil
	}
	instrs := program.Instr
	stack := make([]float64, 0, 16)
	for pc := 0; pc < len(instrs); {
		instr := instrs[pc]
		nextPC := pc + 1
		switch instr.Op {
		case GenericOpConst:
			stack = append(stack, instr.Value)
		case GenericOpRef:
			value, err := r.eval(GenericProgramID(instr.RefIndex), ctx, constOnly, depth+1, spent)
			if err != nil {
				return 0, err
			}
			stack = append(stack, value)
		case GenericOpRead:
			if constOnly {
				return 0, errConstFormulaRead
			}
			value, err := evalInstructionRead(instr, ctx)
			if err != nil {
				return 0, err
			}
			stack = append(stack, value)
		case GenericOpAdd, GenericOpSub, GenericOpMul, GenericOpDiv, GenericOpMin, GenericOpMax,
			GenericOpEq, GenericOpNe, GenericOpLt, GenericOpLte, GenericOpGt, GenericOpGte:
			if len(stack) < 2 {
				return 0, errors.New("formula stack underflow")
			}
			value, issue := expression.Arithmetic(genericArithmeticName(instr.Op), stack[len(stack)-2:], 0)
			if issue != nil {
				return 0, genericArithmeticError(issue)
			}
			stack = stack[:len(stack)-2]
			stack = append(stack, value)
		case GenericOpClamp:
			if len(stack) < 3 {
				return 0, errors.New("formula stack underflow")
			}
			value, issue := expression.Arithmetic("clamp", stack[len(stack)-3:], 0)
			if issue != nil {
				return 0, genericArithmeticError(issue)
			}
			stack = stack[:len(stack)-3]
			stack = append(stack, value)
		case GenericOpRound, GenericOpFloor, GenericOpCeil, GenericOpTrunc:
			if len(stack) < 1 {
				return 0, errors.New("formula stack underflow")
			}
			value, issue := expression.Arithmetic(genericArithmeticName(instr.Op), stack[len(stack)-1:], instr.Decimals)
			if issue != nil {
				return 0, genericArithmeticError(issue)
			}
			stack = stack[:len(stack)-1]
			stack = append(stack, value)
		case GenericOpJumpIfZero:
			if len(stack) < 1 {
				return 0, errors.New("formula stack underflow")
			}
			if !validForwardJump(pc, instr.JumpTarget, len(instrs)) {
				return 0, errors.New("invalid formula jump target")
			}
			condition := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if !finite(condition) {
				return 0, errors.New("non-finite formula condition")
			}
			if condition == 0 {
				nextPC = instr.JumpTarget
			}
		case GenericOpJump:
			if !validForwardJump(pc, instr.JumpTarget, len(instrs)) {
				return 0, errors.New("invalid formula jump target")
			}
			nextPC = instr.JumpTarget
		default:
			return 0, errors.New("unsupported formula opcode")
		}
		pc = nextPC
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

func genericArithmeticError(issue *expression.ContractIssue) error {
	if issue.Code == "FORMULA_DIVISION_BY_ZERO" {
		return errors.New("division by zero")
	}
	if issue.Code == "FORMULA_NON_FINITE" {
		return errors.New("non-finite formula result")
	}
	return errors.New("unsupported formula opcode")
}

func genericArithmeticName(op GenericOp) string {
	switch op {
	case GenericOpAdd:
		return "add"
	case GenericOpSub:
		return "sub"
	case GenericOpMul:
		return "mul"
	case GenericOpDiv:
		return "div"
	case GenericOpMin:
		return "min"
	case GenericOpMax:
		return "max"
	case GenericOpEq:
		return "eq"
	case GenericOpNe:
		return "ne"
	case GenericOpLt:
		return "lt"
	case GenericOpLte:
		return "lte"
	case GenericOpGt:
		return "gt"
	case GenericOpGte:
		return "gte"
	case GenericOpRound:
		return "round"
	case GenericOpFloor:
		return "floor"
	case GenericOpCeil:
		return "ceil"
	case GenericOpTrunc:
		return "trunc"
	default:
		return ""
	}
}

func evalRead(kind GenericReadKind, key string, ctx *GenericEvalContext) (float64, error) {
	if kind == ReadUseProviderStateBefore {
		for _, captured := range ctx.UseProviderStateBefore {
			if captured.StateKey == key {
				return captured.Value, nil
			}
		}
		return 0, errors.New("use.provider_state_before requires the same owning attack's committed counter capture: " + key)
	}
	if kind == ReadUseAmmoBefore {
		if !ctx.HasUseAmmoBefore {
			return 0, errors.New("use.ammo.before requires the original owning use's committed ammo capture")
		}
		return ctx.UseAmmoBefore, nil
	}
	if kind == ReadSourceStatusPresent || kind == ReadTargetStatusPresent {
		if !ctx.HasStatusContext {
			return 0, errors.New("status presence requires a combatant status context")
		}
		statuses := ctx.SourceStatuses
		if kind == ReadTargetStatusPresent {
			statuses = ctx.TargetStatuses
		}
		present, declared := statuses[key]
		if !declared {
			return 0, errors.New("unknown status presence key: " + key)
		}
		if present {
			return 1, nil
		}
		return 0, nil
	}
	switch kind {
	case ReadSourceAttr:
		return readAttrValueChecked(ctx.SourceAttrs, key, ctx.StrictReads)
	case ReadTargetAttr:
		return readAttrValueChecked(ctx.TargetAttrs, key, ctx.StrictReads)
	case ReadSourceResource:
		return readResourceValueChecked(ctx.SourceResources, key, ctx.StrictReads)
	case ReadTargetResource:
		return readResourceValueChecked(ctx.TargetResources, key, ctx.StrictReads)
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
	case ReadProviderElapsedMs:
		if !ctx.HasProviderContext || !ctx.HasProviderElapsed || ctx.ProviderElapsedMs < 0 {
			return 0, errors.New("provider.elapsed_ms requires a finite-lifecycle modifier with actual application time")
		}
		return float64(ctx.ProviderElapsedMs), nil
	case ReadProviderState:
		if !ctx.HasProviderContext {
			return 0, errors.New("provider.state requires provider context")
		}
		return readProviderValue(ctx.ProviderState, ctx.ProviderStateDefaults, key, ctx.StrictReads)
	case ReadProviderTargetState:
		if !ctx.HasProviderContext {
			return 0, errors.New("provider.target_state requires provider context")
		}
		return readProviderValue(ctx.ProviderTargetState, ctx.ProviderStateDefaults, key, ctx.StrictReads)
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
		return readResourceValueChecked(ctx.EventEntrySourceResources, key, ctx.StrictReads)
	case ReadEventEntryTargetResource:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readResourceValueChecked(ctx.EventEntryTargetResources, key, ctx.StrictReads)
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
		return readResourceValueChecked(ctx.EventSourceResources, key, ctx.StrictReads)
	case ReadEventTargetResource:
		if err := requireEventContext(ctx); err != nil {
			return 0, err
		}
		return readResourceValueChecked(ctx.EventTargetResources, key, ctx.StrictReads)
	case ReadDamageAmount:
		if !ctx.HasDamageContext {
			return 0, errors.New("damage.amount requires damage context")
		}
		return ctx.DamageAmount, nil
	case ReadDamageSelf:
		if !ctx.HasDamageContext || !ctx.HasDamageParticipants {
			return 0, errors.New(model.FormulaPathDamageSelf + " requires damage participants")
		}
		if ctx.DamageSelf {
			return 1, nil
		}
		return 0, nil
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
		if ctx.DamageTypeKey == key {
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
	case ReadEventSkillUseContactCount:
		if !ctx.HasSkillUseContactCount || ctx.SkillUseContactCount < 0 {
			return 0, errors.New("event.skill_use.contactCount requires a completed native skill-use history")
		}
		return float64(ctx.SkillUseContactCount), nil
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
	case ReadOperationOutput:
		return readOperationOutput(key, ctx)
	case ReadEventLink:
		if !ctx.HasEventContext || !ctx.HasEventLink || ctx.LinkIndex < 1 || ctx.LinkIndex > ctx.LinkCount {
			return 0, errors.New("event.link." + key + " requires a real link application")
		}
		if key == "index" {
			return float64(ctx.LinkIndex), nil
		}
		return float64(ctx.LinkCount), nil
	case ReadUseChargeDuration:
		if !ctx.HasUseChargeDuration || ctx.UseChargeDurationMs < 0 {
			return 0, errors.New("use.charge_duration_ms requires a real charge execution or associated release hit")
		}
		return float64(ctx.UseChargeDurationMs), nil
	case ReadProcessActualCost:
		if !ctx.HasProcessActualCosts {
			return 0, errors.New("process.actual_cost." + key + " requires process completion or failure context")
		}
		value, ok := ctx.ProcessActualCosts[key]
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return 0, errors.New("process.actual_cost." + key + " is missing or invalid")
		}
		return value, nil
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

func readOperationOutput(key string, ctx *GenericEvalContext) (float64, error) {
	path := "operation.output." + key
	if !ctx.HasOperationOutputs {
		return 0, errors.New(path + " is not available")
	}
	dot := strings.IndexByte(key, '.')
	if dot <= 0 || dot == len(key)-1 {
		return 0, errors.New(path + " is not available")
	}
	ref := key[:dot]
	kind := key[dot+1:]
	vals, ok := ctx.OperationOutputs[ref]
	if !ok {
		return 0, errors.New(path + " is not available")
	}
	switch kind {
	case model.OutputKindPostDefenseDamage:
		return vals.PostDefenseDamage, nil
	case model.OutputKindShieldAbsorbed:
		return vals.ShieldAbsorbed, nil
	case model.OutputKindActualHPLoss:
		return vals.ActualHPLoss, nil
	default:
		return 0, errors.New(path + " is not available")
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
	case "actualHpLoss":
		if !snap.HasActualHPLoss {
			return 0, errors.New("event.damage.actualHpLoss requires its actual received-damage settlement")
		}
		return snap.ActualHPLoss, nil
	case "killed":
		if !snap.HasKilled {
			return 0, errors.New("event.damage.killed requires its actual per-instance damage settlement")
		}
		if snap.Killed != 0 && snap.Killed != 1 {
			return 0, errors.New("event.damage.killed must be zero or one")
		}
		return snap.Killed, nil
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

func requireEventContext(ctx *GenericEvalContext) error {
	if !ctx.HasEventContext {
		return errors.New("event.* requires event context")
	}
	return nil
}

func readAttrValue(attrs attribute.Table, key string) float64 {
	if idx := strings.LastIndex(key, "."); idx > 0 {
		suffix := key[idx+1:]
		attrKey := key[:idx]
		slot, ok := attrs.Lookup(attrKey)
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
	slot, ok := attrs.Lookup(key)
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

func readResourceValueChecked(resources map[string]model.ResourceSlotDef, key string, strict bool) (float64, error) {
	resourceKey := key
	if idx := strings.LastIndex(key, "."); idx > 0 {
		resourceKey = key[:idx]
	}
	if _, ok := resources[resourceKey]; !ok && strict {
		return 0, errors.New("missing resource: " + resourceKey)
	}
	return readResourceValue(resources, key), nil
}

func readProviderValue(values, defaults map[string]float64, key string, strict bool) (float64, error) {
	if value, ok := values[key]; ok {
		return value, nil
	}
	if value, ok := defaults[key]; ok {
		return value, nil
	}
	if strict {
		return 0, errors.New("missing provider state: " + key)
	}
	return 0, nil
}

func finite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}
