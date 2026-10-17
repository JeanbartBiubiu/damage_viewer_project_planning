package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func validateProviderElapsedReads(ctx *genericCompileContext) {
	allowed := map[formula.GenericProgramID]bool{}
	for index := range ctx.session.Providers {
		provider := &ctx.session.Providers[index]
		for _, modifier := range provider.Modifiers {
			if (modifier.Kind != "attribute" && modifier.Kind != "") || !modifier.HasValue || modifier.HasCondition {
				continue
			}
			usesTime := false
			for _, read := range ctx.session.Formulas.ReadDependencies(modifier.ValueProgram) {
				usesTime = usesTime || read.ReadKind == formula.ReadProviderElapsedMs
			}
			if !usesTime {
				continue
			}
			path := ctx.session.Formulas.Programs[modifier.ValueProgram].Key
			lc := provider.Lifecycle
			if lc == nil || !lc.HasDuration || lc.MaxStacks != 1 || lc.RefreshPolicy != model.RefreshPolicyReplace || !lc.AllowsSourceTargetReuse() {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "provider.elapsed_ms requires a finite single-layer source_target replace lifecycle", provider.ProviderKey)
				continue
			}
			provider.NeedsElapsedTime, ctx.session.HasProviderElapsedReads = true, true
			allowed[modifier.ValueProgram] = true
		}
	}
	for i, program := range ctx.session.Formulas.Programs {
		if program.DeclaredNamed {
			continue
		} // declaration/preflight has no execution owner; every consuming wrapper is checked below.
		for _, read := range ctx.session.Formulas.ReadDependencies(formula.GenericProgramID(i)) {
			if read.ReadKind == formula.ReadProviderElapsedMs && !allowed[formula.GenericProgramID(i)] {
				ctx.collector.addError(model.GenericErrFormulaTypeError, program.Key, "provider.elapsed_ms is only available in a finite-lifecycle attribute modifier value", "provider.elapsed_ms")
			}
		}
	}
	for _, combatant := range ctx.session.Combatants {
		for _, mount := range combatant.ProviderMounts {
			if ctx.session.Providers[mount.DefinitionIndex].NeedsElapsedTime {
				ctx.collector.addError(model.GenericErrFormulaTypeError, "combatants.providers", "elapsed-time provider must be dynamically applied, not initially mounted", mount.ProviderRef)
			}
		}
	}
}
