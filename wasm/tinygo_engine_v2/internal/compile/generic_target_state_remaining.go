package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func finiteIntegerTargetState(field plan.CompiledProviderStateField) bool {
	return field.ValueType == model.ProviderStateValueInteger && field.StateKind == "" && field.AmmoRecovery == nil && field.DurationMs > 0
}

// 作者范围由宿主验证；原生验证实际所属字段和明确的目标状态消费点。
// 名称引用与if所有分支都通过展开后的依赖检查，不能借另一处合法条件授权金额。
func finalizeTargetStateRemaining(ctx *genericCompileContext) {
	allowed := map[formula.GenericProgramID]bool{}
	condition := func(program formula.GenericProgramID, owner int) {
		for _, read := range ctx.session.Formulas.ReadDependencies(program) {
			if read.ReadKind != formula.ReadProviderTargetStateRemainingMs {
				continue
			}
			path := ctx.session.Formulas.Programs[program].Key
			if owner < 0 || owner >= len(ctx.session.Providers) {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "target state remaining time requires an owning provider condition", read.ReadKey)
				continue
			}
			allowed[program] = true
			field, exists := ctx.session.Providers[owner].StateFields[read.ReadKey]
			if !exists || !finiteIntegerTargetState(field) {
				ctx.collector.addError(model.GenericErrUnknownRef, path, "target state remaining time requires a declared own finite ordinary integer field", read.ReadKey)
				continue
			}
			ctx.session.HasTargetStateTimeReads = true
		}
	}
	for owner, provider := range ctx.session.Providers {
		for _, listener := range provider.Listeners {
			if listener.HasCondition {
				condition(listener.ConditionProgram, owner)
			}
		}
	}
	for _, operation := range ctx.session.Operations {
		if operation.HasCondition {
			condition(operation.ConditionProgram, operation.OwnerProviderIndex)
		}
		if operation.Operation != model.OperationKindStateDurationChange || operation.ValuePolicy != "ensure_remaining" {
			continue
		}
		fail := func(message string) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, operation.Path, message, operation.Ref)
		}
		owner := operation.OwnerProviderIndex
		if owner < 0 || owner >= len(ctx.session.Providers) || operation.Target != model.SelectorSelf || operation.StateScope != "state_scope/provider_target" {
			fail("ensure_remaining requires an own provider_target field and target self")
			continue
		}
		field, exists := ctx.session.Providers[owner].StateFields[operation.Ref]
		if !exists || !finiteIntegerTargetState(field) {
			fail("ensure_remaining requires a declared own finite ordinary integer field")
		}
		provider := ctx.session.Providers[owner]
		for _, ability := range ctx.session.Abilities[int(provider.AbilityStart) : int(provider.AbilityStart)+int(provider.AbilityCount)] {
			if tick := ability.TickSpec; tick != nil && tick.AnchorScope == "state_scope/provider_target" && tick.AnchorStateKey == operation.Ref {
				fail("ensure_remaining cannot change an anchored tick field without rescheduling its callbacks")
			}
		}
		amount, static := ctx.session.Formulas.FoldStatic(operation.AmountProgram)
		if !operation.HasAmount || len(ctx.session.Formulas.ReadDependencies(operation.AmountProgram)) != 0 || !static || !validStateInteger(amount) || amount <= 0 {
			fail("ensure_remaining amount must be static positive safe integer milliseconds")
		}
	}
	for index, program := range ctx.session.Formulas.Programs {
		if !program.DeclaredNamed {
			for _, read := range ctx.session.Formulas.ReadDependencies(formula.GenericProgramID(index)) {
				if read.ReadKind == formula.ReadProviderTargetStateRemainingMs && !allowed[formula.GenericProgramID(index)] {
					ctx.collector.addError(model.GenericErrFormulaTypeError, program.Key, "target state remaining time is only available in an owning listener or operation condition", read.ReadKey)
				}
			}
		}
		for instruction, read := range program.Instr {
			if read.Op == formula.GenericOpRead && read.ReadKind == formula.ReadProviderTargetStateRemainingMs {
				ctx.session.Formulas.Programs[index].Instr[instruction].ReferenceBound = true
			}
		}
	}
}
