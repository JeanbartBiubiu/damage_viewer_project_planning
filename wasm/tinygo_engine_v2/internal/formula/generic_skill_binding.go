package formula

import (
	"math"
	"strconv"
	"strings"
	"unsafe"

	"tinygo_engine_v2/internal/expression"
	"tinygo_engine_v2/internal/inputbinding"
	"tinygo_engine_v2/internal/model"
)

// NamedBinding私有保存真实归属、读值计划和已选参数。
type NamedBinding struct {
	scope, skillKey, path string
	plan                  *inputbinding.Plan
	inputs                []expression.Input
	parameters            []model.FormulaParameter
	dependencies          []GenericInstr
	attributeInputs       []namedAttributeBinding
}

type namedAttributeBinding struct {
	index int
	bound bool
}

func (b *NamedBinding) Scope() string {
	if b == nil {
		return ""
	}
	return b.scope
}

func (b *NamedBinding) SkillKey() string {
	if b == nil {
		return ""
	}
	return b.skillKey
}
func (b *NamedBinding) Path() string {
	if b == nil {
		return ""
	}
	return b.path
}

// CompileDeclaredNamedFormulas把每个完整共同定义直接注册到同一个有界表。
func CompileDeclaredNamedFormulas(defs []model.NamedFormula, attributes []string, reg *GenericRegistry, add func(model.GenericErrCode, string, string, string)) {
	if len(defs) > MaxGenericPrograms {
		add(model.GenericErrCode("FORMULA_LIMIT"), "/formulas/65536/key", "formula program count exceeds maximum", "")
		return
	}
	seen := make(map[string]bool)
	for i, def := range defs {
		path := "/formulas/" + strconv.Itoa(i)
		problem := func(code, suffix string) { add(model.GenericErrCode(code), path+suffix, code, def.Key) }
		if strings.TrimSpace(def.Key) == "" || (def.Scope != "skill" && def.Scope != "game") ||
			(def.Scope == "skill" && strings.TrimSpace(def.SkillKey) == "") ||
			(def.Scope == "game" && (def.SkillKey != "" || len(def.Parameters) != 0)) {
			problem("FORMULA_INVALID_STRUCTURE", "")
			continue
		}
		if seen[def.Key] {
			problem("FORMULA_DUPLICATE_KEY", "/key")
			continue
		}
		seen[def.Key] = true
		if len(reg.Programs) >= MaxGenericPrograms {
			problem("FORMULA_LIMIT", "/key")
			break
		}
		params := make([]model.FormulaParameter, len(def.Parameters))
		paramIndex := make(map[string]int, len(params))
		valid := true
		for j, raw := range def.Parameters {
			pp := "/parameters/" + strconv.Itoa(j)
			if raw.ParameterKey == "" || (raw.ValueType != "DECIMAL" && raw.ValueType != "INTEGER") || (raw.ValueMode != "FIXED" && raw.ValueMode != "SKILL_LEVEL" && raw.ValueMode != "CHARACTER_LEVEL" && raw.ValueMode != "RUNTIME_INPUT") {
				problem("FORMULA_INVALID_STRUCTURE", pp)
				valid = false
				continue
			}
			if _, exists := paramIndex[raw.ParameterKey]; exists {
				problem("FORMULA_DUPLICATE_KEY", pp+"/parameterKey")
				valid = false
				continue
			}
			paramIndex[raw.ParameterKey] = j
			if raw.ValueMode == "RUNTIME_INPUT" {
				if raw.Value != nil {
					problem("FORMULA_INVALID_STRUCTURE", pp+"/value")
					valid = false
				}
				if source := raw.RuntimeSource; source != nil {
					if (source.Kind != "use_charge_duration" && source.Kind != "process_actual_cost") || (source.Kind == "use_charge_duration" && source.ResourceKey != "") || (source.Kind == "process_actual_cost" && strings.TrimSpace(source.ResourceKey) == "") {
						problem("FORMULA_INVALID_STRUCTURE", pp+"/runtimeSource")
						valid = false
					}
					copySource := *source
					raw.RuntimeSource = &copySource
				}
			} else {
				if raw.Value == nil || math.IsNaN(*raw.Value) || math.IsInf(*raw.Value, 0) || (raw.ValueType == "INTEGER" && (math.Trunc(*raw.Value) != *raw.Value || math.Abs(*raw.Value) > 9007199254740991)) || raw.RuntimeSource != nil {
					problem("FORMULA_INVALID_STRUCTURE", pp)
					valid = false
				} else {
					value := *raw.Value
					raw.Value = &value
				}
			}
			params[j] = raw
		}
		if !valid {
			continue
		}
		var allowed []any
		for _, key := range attributes {
			for _, object := range []string{"source", "target"} {
				if def.Scope == "game" && object != "source" {
					continue
				}
				for _, kind := range []string{"BASE", "BONUS", "TOTAL", "CURRENT", "MAX", "MISSING", "CURRENT_RATIO", "MISSING_RATIO"} {
					if def.Scope == "game" && kind != "BASE" && kind != "BONUS" && kind != "TOTAL" {
						continue
					}
					allowed = append(allowed, map[string]any{"kind": "attribute", "object": object, "attributeKey": key, "valueKind": kind, "view": "current_frame"})
				}
			}
		}
		for _, param := range params {
			allowed = append(allowed, map[string]any{"kind": "parameter", "skillKey": def.SkillKey, "parameterKey": param.ParameterKey})
		}
		program, issue := expression.CompileDefinition(def.Expression, allowed)
		if issue != nil {
			problem(issue.Code, "/expression"+issue.Path)
			continue
		}
		inputs := program.Inputs()
		catalog := make([]expression.Binding, len(inputs))
		// Bind要求唯一目录，同一绑定可有多个输入键。
		catalog = catalog[:0]
		for _, input := range inputs {
			found := false
			for _, prior := range catalog {
				if prior == input.Binding {
					found = true
					break
				}
			}
			if !found {
				catalog = append(catalog, input.Binding)
			}
		}
		bindingPlan, issue := inputbinding.Bind(program, catalog)
		if issue != nil {
			problem(issue.Code, "/expression"+issue.Path)
			continue
		}
		ordered := make([]expression.Input, len(catalog))
		for j, binding := range catalog {
			ordered[j].Binding = binding
		}
		binding := &NamedBinding{scope: def.Scope, skillKey: def.SkillKey, path: path + "/expression", plan: bindingPlan, inputs: ordered, parameters: params, attributeInputs: make([]namedAttributeBinding, len(ordered))}
		for _, input := range program.OutputInputs() {
			b := input.Binding
			if b.Kind == "attribute" {
				kind := ReadSourceAttr
				if b.Object == "target" {
					kind = ReadTargetAttr
				}
				fields := []string{"resolved"}
				switch b.ValueKind {
				case "BASE":
					fields = []string{"base"}
				case "CURRENT":
					fields = []string{"current"}
				case "MAX":
					fields = []string{"max"}
				case "BONUS":
					fields = []string{"resolved", "base"}
				case "MISSING", "CURRENT_RATIO", "MISSING_RATIO":
					fields = []string{"max", "current"}
				}
				for _, field := range fields {
					binding.dependencies = append(binding.dependencies, GenericInstr{Op: GenericOpRead, ReadKind: kind, ReadKey: b.AttributeKey + "." + field, AuthoredRead: true})
				}
			} else {
				param := params[paramIndex[b.ParameterKey]]
				if param.ValueMode != "RUNTIME_INPUT" {
					continue
				}
				kind, key := ReadAuthoredRuntimeParameter, b.ParameterKey
				if param.RuntimeSource != nil {
					if param.RuntimeSource.Kind == "use_charge_duration" {
						kind = ReadUseChargeDuration
					} else {
						kind, key = ReadProcessActualCost, param.RuntimeSource.ResourceKey
					}
				}
				binding.dependencies = append(binding.dependencies, GenericInstr{Op: GenericOpRead, ReadKind: kind, ReadKey: key})
			}
		}
		bytes := bindingPlan.ChargedBytes() + uint64(unsafe.Sizeof(NamedBinding{})) + uint64(len(binding.scope)+len(binding.skillKey)+len(binding.path)) + uint64(cap(ordered))*uint64(unsafe.Sizeof(expression.Input{})) + uint64(cap(params))*uint64(unsafe.Sizeof(model.FormulaParameter{})) + uint64(cap(binding.dependencies))*uint64(unsafe.Sizeof(GenericInstr{})) + uint64(cap(binding.attributeInputs))*uint64(unsafe.Sizeof(namedAttributeBinding{}))
		for _, input := range ordered {
			b := input.Binding
			bytes += uint64(len(b.Kind) + len(b.Object) + len(b.AttributeKey) + len(b.ValueKind) + len(b.View) + len(b.SkillKey) + len(b.ParameterKey))
		}
		for _, param := range params {
			bytes += uint64(len(param.ParameterKey) + len(param.ValueMode) + len(param.ValueType))
			if param.Value != nil {
				bytes += 8
			}
			if param.RuntimeSource != nil {
				bytes += uint64(unsafe.Sizeof(model.FormulaRuntimeSource{})) + uint64(len(param.RuntimeSource.Kind)+len(param.RuntimeSource.ResourceKey))
			}
		}
		for _, dep := range binding.dependencies {
			bytes += uint64(len(dep.ReadKey))
		}
		if _, err := reg.Register(GenericProgram{Key: def.Key, Authored: program, NamedBinding: binding, BindingBytes: bytes, DeclaredNamed: true}); err != nil {
			code := "FORMULA_INVALID_PROGRAM"
			if IsRegistryLimit(err) {
				code = "FORMULA_LIMIT"
			}
			problem(code, "")
			if IsRegistryLimit(err) {
				break
			}
		}
	}
}

func (b *NamedBinding) evaluate(program *expression.Program, ctx *GenericEvalContext, static bool) (expression.Evaluation, *expression.ContractIssue) {
	var valueBuffer [8]inputbinding.Value
	values := valueBuffer[:0]
	if len(b.inputs) <= len(valueBuffer) {
		values = valueBuffer[:len(b.inputs)]
	} else {
		values = make([]inputbinding.Value, len(b.inputs))
	}
	for i, input := range b.inputs {
		binding := input.Binding
		if binding.Kind == "attribute" {
			if static {
				continue
			}
			attrs := ctx.SourceAttrs
			if binding.Object == "target" {
				attrs = ctx.TargetAttrs
			}
			if ctx.HasAuthoredActorContext {
				attrs = ctx.AuthoredSourceAttrs
				if binding.Object == "target" {
					attrs = ctx.AuthoredTargetAttrs
				}
			}
			read := namedAttributeBinding{}
			if i < len(b.attributeInputs) {
				read = b.attributeInputs[i]
			}
			slot, exists := lookupAttributeSlot(attrs, binding.AttributeKey, read.index, read.bound)
			if !exists {
				continue
			}
			values[i] = inputbinding.Value{Base: inputbinding.Scalar{Value: slot.Base, Present: slot.HasBase()}, Total: inputbinding.Scalar{Value: slot.Resolved, Present: slot.HasResolved()}, Current: inputbinding.Scalar{Value: slot.Current, Present: slot.HasCurrent()}, Max: inputbinding.Scalar{Value: slot.Max, Present: slot.HasMax()}}
			continue
		}
		for _, param := range b.parameters {
			if param.ParameterKey != binding.ParameterKey {
				continue
			}
			if param.Value != nil {
				values[i].Number = inputbinding.Scalar{Value: *param.Value, Present: true}
				break
			}
			if static || ctx.RuntimeSkillKey != b.skillKey {
				break
			}
			if source := param.RuntimeSource; source != nil {
				if source.Kind == "use_charge_duration" && ctx.HasUseChargeDuration {
					values[i].Number = inputbinding.Scalar{Value: float64(ctx.UseChargeDurationMs), Present: ctx.UseChargeDurationMs >= 0}
				}
				if source.Kind == "process_actual_cost" && ctx.HasProcessActualCosts {
					value, present := ctx.ProcessActualCosts[source.ResourceKey]
					values[i].Number = inputbinding.Scalar{Value: value, Present: present}
				}
			} else {
				value, present := ctx.RuntimeParameters[param.ParameterKey]
				values[i].Number = inputbinding.Scalar{Value: value, Present: present}
			}
			break
		}
	}
	return b.plan.Evaluate(program, values)
}

// DeclaredReferences不向宿主开放临时用途包装。
func (r GenericRegistry) DeclaredReferences() map[string]model.GenericFormulaExpr {
	refs := make(map[string]model.GenericFormulaExpr)
	for i, p := range r.Programs {
		if p.DeclaredNamed {
			id := uint16(i)
			refs[p.Key] = model.GenericFormulaExpr{LinkedProgram: &id}
		}
	}
	return refs
}

func (r GenericRegistry) ValidDeclaredScope(instructions []GenericInstr, skill string) bool {
	for _, in := range instructions {
		if in.Op != GenericOpRef {
			continue
		}
		if int(in.RefIndex) >= len(r.Programs) {
			return false
		}
		p := r.Programs[in.RefIndex]
		if !p.DeclaredNamed || p.NamedBinding == nil ||
			(p.NamedBinding.Scope() != "skill" && p.NamedBinding.Scope() != "game") ||
			(p.NamedBinding.Scope() == "skill" && (skill == "" || p.NamedBinding.SkillKey() != skill)) {
			return false
		}
	}
	return true
}

// ReadDependencies返回输出可达读取并递归覆盖外部调用，包含条件两支。
func (r GenericRegistry) ReadDependencies(id GenericProgramID) []GenericInstr {
	if int(id) >= len(r.Programs) {
		return nil
	}
	return r.InstructionDependencies(r.Programs[id].Instr, r.Programs[id].NamedBinding)
}
func (r GenericRegistry) InstructionDependencies(instructions []GenericInstr, own *NamedBinding) []GenericInstr {
	var out []GenericInstr
	seen := make(map[GenericProgramID]bool)
	var visit func([]GenericInstr, *NamedBinding)
	visit = func(code []GenericInstr, b *NamedBinding) {
		if b != nil {
			out = append(out, b.dependencies...)
		}
		for _, in := range code {
			if in.Op == GenericOpRead {
				out = append(out, in)
			}
			if in.Op == GenericOpRef {
				id := GenericProgramID(in.RefIndex)
				if !seen[id] && int(id) < len(r.Programs) {
					seen[id] = true
					p := r.Programs[id]
					visit(p.Instr, p.NamedBinding)
				}
			}
		}
	}
	visit(instructions, own)
	return out
}

func (r GenericRegistry) FoldStatic(id GenericProgramID) (float64, bool) {
	if int(id) >= len(r.Programs) || len(r.ReadDependencies(id)) != 0 {
		return 0, false
	}
	value, err := r.eval(id, &GenericEvalContext{}, true, 1, new(int))
	return value, err == nil
}

func (r GenericRegistry) FoldInstructions(instr []GenericInstr) (float64, bool) {
	if len(instr) == 0 || len(r.InstructionDependencies(instr, nil)) != 0 {
		return 0, false
	}
	value, err := r.EvaluateInstructions(instr, GenericEvalContext{}, true)
	return value, err == nil
}

func (r GenericRegistry) EvaluateInstructions(instr []GenericInstr, ctx GenericEvalContext, static bool) (float64, error) {
	if len(r.Programs) >= MaxGenericPrograms {
		return 0, errGenericProgramLimit
	}
	clone := r
	clone.Programs = make([]GenericProgram, len(r.Programs)+1)
	copy(clone.Programs, r.Programs)
	clone.Programs[len(r.Programs)] = GenericProgram{Key: "internal:constant", Instr: instr}
	return clone.eval(GenericProgramID(len(r.Programs)), &ctx, static, 1, new(int))
}
