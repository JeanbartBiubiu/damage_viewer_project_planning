package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func validateProviderElapsedReads(ctx *genericCompileContext) {
	allowed := map[formula.GenericProgramID]bool{}
	for index := range ctx.session.Providers {
		provider := &ctx.session.Providers[index]
		for _, contribution := range provider.StatusContributions {
			if !contribution.MomentEvaluation || !contribution.HasStrength {
				continue
			}
			path := contribution.Path + ".strength"
			lc := provider.Lifecycle
			if provider.Kind != "status" || len(provider.StatusContributions) != 1 || len(provider.Modifiers)+int(provider.AbilityCount)+len(provider.Processes)+len(provider.Listeners)+len(provider.StateFields) != 0 || provider.AmmoBinding != nil || provider.ShieldDefinitionRef != "" || !provider.TypeSet.Empty() {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "MOMENT_EVALUATION requires a pure status provider with one ordinary movement_slow contribution", provider.ProviderKey)
				continue
			}
			if lc == nil || !lc.HasDuration || lc.MaxStacks != 1 || lc.RefreshPolicy != model.RefreshPolicyReplace || !lc.AllowsSourceTargetReuse() || lc.TickIntervalMs != 0 {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "MOMENT_EVALUATION requires a finite single-layer source_target replace lifecycle without ticks", provider.ProviderKey)
				continue
			}
			for _, read := range ctx.formulas.ReadDependencies(contribution.StrengthProgram) {
				if read.ReadKind != formula.ReadProviderElapsedMs {
					ctx.collector.addError(model.GenericErrFormulaTypeError, path, "MOMENT_EVALUATION strength may read only its own provider.elapsed_ms and frozen static values", contribution.ResultRef)
				}
			}
			provider.HasMomentStatus, provider.NeedsElapsedTime, ctx.session.HasProviderElapsedReads = true, true, true
			allowed[contribution.StrengthProgram] = true
		}
		for _, modifier := range provider.Modifiers {
			if (modifier.Kind != "attribute" && modifier.Kind != "") || !modifier.HasValue || modifier.HasCondition {
				continue
			}
			usesTime := false
			for _, read := range ctx.formulas.ReadDependencies(modifier.ValueProgram) {
				usesTime = usesTime || read.ReadKind == formula.ReadProviderElapsedMs
			}
			if !usesTime {
				continue
			}
			path := ctx.formulas.Info(formula.GenericProgramID(modifier.ValueProgram)).Key
			lc := provider.Lifecycle
			if lc == nil || !lc.HasDuration || lc.MaxStacks != 1 || lc.RefreshPolicy != model.RefreshPolicyReplace || !lc.AllowsSourceTargetReuse() {
				ctx.collector.addError(model.GenericErrFormulaTypeError, path, "provider.elapsed_ms requires a finite single-layer source_target replace lifecycle", provider.ProviderKey)
				continue
			}
			provider.NeedsElapsedTime, ctx.session.HasProviderElapsedReads = true, true
			allowed[modifier.ValueProgram] = true
		}
	}
	for i := 0; i < ctx.formulas.Count(); i++ {
		program := ctx.formulas.Info(formula.GenericProgramID(i))
		if program.DeclaredNamed {
			continue
		} // declaration/preflight has no execution owner; every consuming wrapper is checked below.
		for _, read := range ctx.formulas.ReadDependencies(formula.GenericProgramID(i)) {
			if read.ReadKind == formula.ReadProviderElapsedMs && !allowed[formula.GenericProgramID(i)] {
				ctx.collector.addError(model.GenericErrFormulaTypeError, program.Key, "provider.elapsed_ms requires a finite-lifecycle attribute modifier or explicit MOMENT_EVALUATION ordinary slow strength", "provider.elapsed_ms")
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
