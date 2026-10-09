package compile

import (
	"math"
	"tinygo_engine_v2/internal/expression"
	"tinygo_engine_v2/internal/inputbinding"
	"unsafe"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func compileDamageTypeFormulas(defs []model.DamageTypeFormulaDefinition, ctx *genericCompileContext) {
	if len(defs) == 0 {
		return
	}
	ctx.session.DamageTypeFormulas = make(map[string]plan.CompiledDamageTypeFormula, len(defs))
	// 授权只能由独立属性目录生成，作者输入声明不能新增目录或权限。
	var catalog []expression.Binding
	var allowed []any
	for _, key := range ctx.catalog.Registry.Keys {
		if _, exists := ctx.catalog.Registry.LookupDomain("attribute", key); !exists {
			continue
		}
		// 同名多域时Keys可重复，仅属性身份一次。
		duplicate := false
		for _, item := range catalog {
			if item.AttributeKey == key {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		for _, object := range []string{"source", "target"} {
			for _, valueKind := range []string{"BASE", "BONUS", "TOTAL"} {
				binding := expression.Binding{Kind: "attribute", Object: object, AttributeKey: key, ValueKind: valueKind, View: "current_frame"}
				catalog = append(catalog, binding)
				allowed = append(allowed, map[string]any{"kind": binding.Kind, "object": object, "attributeKey": key, "valueKind": valueKind, "view": binding.View})
			}
		}
	}
	for i, def := range defs {
		path := "/rules/damageTypeFormulas/" + itoa(i)
		if _, declared := ctx.catalog.Registry.LookupDomain("damage", def.DamageType); !declared {
			ctx.collector.addError(model.GenericErrUnknownTypeKey, path+"/damageType", "unknown damage type in damage domain", def.DamageType)
			continue
		}
		if _, exists := ctx.session.DamageTypeFormulas[def.DamageType]; exists {
			ctx.collector.addError(model.GenericErrUnknownRef, path+"/damageType", "duplicate damage type formula", def.DamageType)
			continue
		}
		formulaPath := path + "/formula"
		program, issue := expression.CompileDefinition(def.Formula, allowed)
		if issue != nil {
			ctx.collector.addError(model.GenericErrCode(issue.Code), formulaPath+issue.Path, issue.Code, def.DamageType)
			continue
		}
		// 仅缩窄已经授权的读值目录，绑定本身不授予权限。
		used := make(map[expression.Binding]bool)
		for _, input := range program.Inputs() {
			used[input.Binding] = true
		}
		var boundCatalog []expression.Binding
		var reads []plan.CompiledDamageAttributeRead
		for _, binding := range catalog {
			if used[binding] {
				boundCatalog = append(boundCatalog, binding)
				reads = append(reads, plan.CompiledDamageAttributeRead{Object: binding.Object, AttributeKey: binding.AttributeKey})
			}
		}
		binding, issue := inputbinding.Bind(program, boundCatalog)
		if issue != nil {
			ctx.collector.addError(model.GenericErrCode(issue.Code), formulaPath+issue.Path, issue.Code, def.DamageType)
			continue
		}
		compiled := plan.CompiledDamageTypeFormula{DamageType: def.DamageType, Binding: binding, Reads: reads, Path: formulaPath, OutputPath: formulaPath}
		root := def.Formula.(map[string]any)
		for stage, raw := range root["stages"].([]any) {
			if raw.(map[string]any)["key"] == root["outputStageKey"] {
				compiled.OutputPath = formulaPath + "/stages/" + itoa(stage) + "/expression"
				break
			}
		}
		bytes := binding.ChargedBytes() + uint64(unsafe.Sizeof(plan.CompiledDamageTypeFormula{})) + uint64(cap(reads))*uint64(unsafe.Sizeof(plan.CompiledDamageAttributeRead{})) + uint64(len(def.DamageType)+len(compiled.Path)+len(compiled.OutputPath))
		for _, read := range reads {
			bytes += uint64(len(read.Object) + len(read.AttributeKey))
		}
		id, err := ctx.session.Formulas.Register(formula.GenericProgram{Key: formulaPath, Authored: program, BindingBytes: bytes})
		if err != nil {
			code := "FORMULA_INVALID_PROGRAM"
			if formula.IsRegistryLimit(err) {
				code = "FORMULA_LIMIT"
			}
			ctx.collector.addError(model.GenericErrCode(code), formulaPath, err.Error(), def.DamageType)
			continue
		}
		compiled.Program = id
		ctx.session.DamageTypeFormulas[def.DamageType] = compiled
	}
}

func compileCritFormulas(op model.OperationDefinition, compiled *plan.CompiledOperation, path string, ctx *genericCompileContext) {
	if op.CritChance == nil && op.CritMultiplier == nil {
		return
	}
	if op.Operation != "damage" || !op.CritEligible {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".critChance", "result crit formulas require a critEligible damage operation", op.Operation)
	}
	if op.CritChance == nil || op.CritMultiplier == nil {
		ctx.collector.addError(model.GenericErrMissingRequiredField, path+".critMultiplier", "critChance and critMultiplier must be declared together", "")
		return
	}
	registeredAll := true
	for i, expr := range []*model.GenericFormulaExpr{op.CritChance, op.CritMultiplier} {
		field := "critChance"
		if i == 1 {
			field = "critMultiplier"
		}
		instr := formula.CompileGenericFormula(*expr, path+"."+field, ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
		validateDamagePredicateReads(ctx.session.Formulas.InstructionDependencies(instr, nil), path+"."+field, ctx.catalog, ctx.collector.addError)
		id, registered := ctx.registerFormula(path+"."+field, instr)
		if !registered {
			registeredAll = false
			continue
		}
		if i == 0 {
			compiled.CritChanceProgram = id
		} else {
			compiled.CritMultiplierProgram = id
		}
	}
	compiled.HasCritFormula = registeredAll
}

func validateLinkOperation(op model.OperationDefinition, path string, ctx *genericCompileContext) {
	if op.Amount == nil {
		ctx.collector.addError(model.GenericErrMissingRequiredField, path+".amount", "link application requires a count formula", op.Operation)
		return
	}
	eventType := model.EventTypeHitLinkApplied
	if op.Operation == model.OperationKindApplyAttackLink {
		eventType = model.EventTypeAttackLinkApplied
	}
	requireEventType(ctx, eventType, path+".operation", "link application requires its native event in typeCatalog")
	instr := formula.CompileGenericFormula(*op.Amount, path+".amount", ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
	if value, constant := ctx.session.Formulas.FoldInstructions(instr); constant && (math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || math.Trunc(value) != value || value > float64(ctx.session.Settings.MaxCommandsPerEvent)) {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".amount", "link count must be a finite non-negative integer within the command budget", "")
	}
	if op.CopyableOnHit || op.CritEligible || op.DamageType != "" || op.EventType != "" || op.Payload != nil || op.ValuePolicy != "" {
		ctx.collector.addError(model.GenericErrUnknownRef, path, "link application cannot carry damage or free-event semantics", op.Operation)
	}
}
