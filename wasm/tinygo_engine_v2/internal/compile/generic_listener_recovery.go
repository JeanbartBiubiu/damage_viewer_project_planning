package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func validateListenerRecoveryTargets(operations []model.OperationDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	if ownerProviderIndex < 0 {
		return
	}
	for i, op := range operations {
		if op.Operation != "heal" && op.Operation != "resource_change" {
			continue
		}
		if op.Target != model.SelectorSelf && op.Target != model.SelectorSource {
			// An established negative resource operation consumes rather than
			// restores. It does not enter this new ordinary-recovery branch.
			if op.Operation == "resource_change" && op.Amount != nil {
				instr := formula.CompileGenericFormula(*op.Amount, path+"["+itoa(i)+"].amount", ctx.namedFormulas, map[string]bool{}, ctx.collector.addError)
				if value, static := ctx.session.Formulas.FoldInstructions(instr); static && value < 0 {
					continue
				}
			}
			ctx.collector.addError(model.GenericErrUnknownRef, path+"["+itoa(i)+"].target", "ordinary mounted-listener recovery requires its own source", op.Target)
		}
	}
}
