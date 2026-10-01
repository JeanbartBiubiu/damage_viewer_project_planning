package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

type CompiledDamageTypeFormula struct {
	DamageType string
	Programs   [5]formula.GenericProgramID
	Paths      [5]string
}

func compileDamageTypeFormulas(defs []model.DamageTypeFormulaDefinition, ctx *genericCompileContext) {
	if len(defs) == 0 {
		return
	}
	ctx.session.DamageTypeFormulas = make(map[string]CompiledDamageTypeFormula, len(defs))
	for i, def := range defs {
		path := "rules.damageTypeFormulas[" + itoa(i) + "]"
		typeset.ValidateTypeKeys([]string{def.DamageType}, typeset.EntityOperationDamageType, ctx.catalog, path+".damageType", ctx.collector.addError)
		if _, exists := ctx.session.DamageTypeFormulas[def.DamageType]; exists {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".damageType", "duplicate damage type formula", def.DamageType)
		}
		compiled := CompiledDamageTypeFormula{DamageType: def.DamageType}
		exprs := [5]model.GenericFormulaExpr{def.Formula.ResistanceBeforePenetration, def.Formula.PenetrationPercent, def.Formula.PenetrationFlat, def.Formula.EffectiveResistance, def.Formula.ResistanceFactor}
		for stage, expr := range exprs {
			stagePath := path + ".formula." + model.DamageStageFields[stage]
			compiled.Paths[stage] = stagePath
			nodes := 0
			validateDamageFormulaNode(expr, stagePath, stage, &nodes, ctx)
			instr := formula.CompileGenericFormula(expr, stagePath, nil, map[string]bool{}, ctx.collector.addError)
			for _, item := range instr {
				if item.Op != formula.GenericOpRead {
					continue
				}
				switch item.ReadKind {
				case formula.ReadSourceAttr, formula.ReadTargetAttr, formula.ReadSourceResource, formula.ReadTargetResource:
				case formula.ReadDamageStage:
					index, ok := model.DamageStageIndex(item.ReadKey)
					if !ok || index >= stage {
						ctx.collector.addError(model.GenericErrFormulaTypeError, stagePath, "defense formula can only read an earlier stage", item.ReadKey)
					}
				default:
					ctx.collector.addError(model.GenericErrFormulaTypeError, stagePath, "defense formula cannot read this context", item.ReadKey)
				}
			}
			compiled.Programs[stage] = ctx.registerFormula(stagePath, instr)
		}
		ctx.session.DamageTypeFormulas[def.DamageType] = compiled
	}
}

// 此处只接受作者四类节点对应的表达式，不扩张作者公式语言。
func validateDamageFormulaNode(expr model.GenericFormulaExpr, path string, stage int, nodes *int, ctx *genericCompileContext) {
	(*nodes)++
	if *nodes > 256 {
		if *nodes == 257 {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "defense formula exceeds 256 nodes", "")
		}
		return
	}
	if expr.Ref != "" || expr.Decimals != nil || expr.Min != nil || expr.Max != nil || expr.Expr != nil {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "defense formula contains a field outside the four author node kinds", "")
	}
	switch expr.Op {
	case "const":
		if expr.Path != "" || len(expr.Args) != 0 {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "constant defense node cannot contain reads or operands", "")
		}
	case "read":
		if expr.Value != nil || len(expr.Args) != 0 {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "defense read cannot contain constants or operands", "")
		}
		if strings.HasPrefix(expr.Path, "damage.stage.") {
			key := strings.TrimPrefix(expr.Path, "damage.stage.")
			index, ok := model.DamageStageIndex(key)
			if !ok || index >= stage {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path+".path", "defense stage must precede the current stage", expr.Path)
			}
		}
	case "add", "sub", "mul", "div", "min", "max":
		if len(expr.Args) != 2 || expr.Value != nil || expr.Path != "" {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path, "defense arithmetic requires exactly two operands and no unrelated fields", expr.Op)
		}
		for i, child := range expr.Args {
			validateDamageFormulaNode(child, path+".args["+itoa(i)+"]", stage, nodes, ctx)
		}
	default:
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".op", "defense formula only allows const/read/add/sub/mul/div/min/max", expr.Op)
	}
}

func validateDamageStageContexts(ctx *genericCompileContext) {
	allowed := map[formula.GenericProgramID]bool{}
	for _, def := range ctx.session.DamageTypeFormulas {
		for _, id := range def.Programs {
			allowed[id] = true
		}
	}
	for i, program := range ctx.session.Formulas.Programs {
		if !allowed[formula.GenericProgramID(i)] && formulaReadsKind(program.Instr, formula.ReadDamageStage) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, program.Key, "stage results are only available inside the matching damage type formula", "")
		}
	}
}

func compileCritFormulas(op model.OperationDefinition, compiled *CompiledOperation, path string, ctx *genericCompileContext) {
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
	for i, expr := range []*model.GenericFormulaExpr{op.CritChance, op.CritMultiplier} {
		field := "critChance"
		if i == 1 {
			field = "critMultiplier"
		}
		instr := formula.CompileGenericFormula(*expr, path+"."+field, ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
		validateDamagePredicateReads(instr, path+"."+field, ctx.catalog, ctx.collector.addError)
		id := ctx.registerFormula(path+"."+field, instr)
		if i == 0 {
			compiled.CritChanceProgram = id
		} else {
			compiled.CritMultiplierProgram = id
		}
	}
	compiled.HasCritFormula = true
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
	requireCatalogType(ctx, eventType, path+".operation", "link application requires its native event in typeCatalog")
	instr := formula.CompileGenericFormula(*op.Amount, path+".amount", ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
	if value, constant := formula.TryFoldConst(instr); constant && (math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || math.Trunc(value) != value || value > float64(ctx.session.Settings.MaxCommandsPerEvent)) {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".amount", "link count must be a finite non-negative integer within the command budget", "")
	}
	if op.CopyableOnHit || op.CritEligible || op.DamageType != "" || op.EventType != "" || op.Payload != nil || op.ValuePolicy != "" {
		ctx.collector.addError(model.GenericErrUnknownRef, path, "link application cannot carry damage or free-event semantics", op.Operation)
	}
}
