package compile

import (
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func compileStatusContributions(items []model.StatusContributionDefinition, path string, ctx *genericCompileContext) []CompiledStatusContribution {
	if len(items) == 0 {
		return nil
	}
	out := make([]CompiledStatusContribution, 0, len(items))
	seen := map[string]int{}
	for i, item := range items {
		p := path + "[" + itoa(i) + "]"
		add := ctx.collector.addError
		if strings.TrimSpace(item.ResultRef) == "" {
			add(model.GenericErrMissingRequiredField, p+".resultRef", "status contribution resultRef is required", "")
		} else if prev, ok := seen[item.ResultRef]; ok {
			add(model.GenericErrUnknownRef, p+".resultRef", "duplicate status contribution resultRef", item.ResultRef)
			add(model.GenericErrUnknownRef, path+"["+itoa(prev)+"].resultRef", "duplicate status contribution resultRef", item.ResultRef)
		} else {
			seen[item.ResultRef] = i
		}
		if strings.TrimSpace(item.StatusKey) == "" {
			add(model.GenericErrMissingRequiredField, p+".statusKey", "status contribution statusKey is required", item.ResultRef)
		}
		if item.StatusKind != model.StatusKindMovementSlow {
			add(model.GenericErrUnknownRef, p+".statusKind", "status contribution statusKind must be movement_slow", item.StatusKind)
		}
		compiled := CompiledStatusContribution{
			ResultRef:  item.ResultRef,
			StatusKey:  item.StatusKey,
			StatusKind: item.StatusKind,
			Path:       p,
		}
		instr := formula.CompileGenericFormula(item.Strength, p+".strength", ctx.namedFormulas, map[string]bool{}, add)
		if len(instr) > 0 {
			compiled.StrengthProgram = ctx.registerFormula(p+".strength", instr)
			compiled.HasStrength = true
		} else {
			add(model.GenericErrMissingRequiredField, p+".strength", "status contribution strength is required; explicit zero is allowed", item.ResultRef)
		}
		out = append(out, compiled)
	}
	return out
}

func validateProviderStatusLifecycle(def model.ProviderDefinition, compiled CompiledProvider, path string, collector *genericCollector) {
	lc := def.Lifecycle
	scope := ""
	if lc != nil {
		scope = lc.InstanceScope
	}
	hasContrib := len(compiled.StatusContributions) > 0
	if scope == "" {
		if hasContrib {
			collector.addError(model.GenericErrUnknownRef, path+".statusContributions", "statusContributions require source_target lifecycle with explicit maxStacks=1, refreshPolicy=replace and a positive duration", def.ProviderKey)
		}
		return
	}
	if scope != model.InstanceScopeSourceTarget {
		return
	}
	if lc == nil || lc.MaxStacks != 1 {
		collector.addError(model.GenericErrUnknownRef, path+".lifecycle.maxStacks", "source_target requires explicit maxStacks=1", def.ProviderKey)
	}
	if lc == nil || lc.RefreshPolicy != model.RefreshPolicyReplace {
		collector.addError(model.GenericErrUnknownRef, path+".lifecycle.refreshPolicy", "source_target requires explicit refreshPolicy=replace", def.ProviderKey)
	}
	if compiled.Lifecycle == nil || !compiled.Lifecycle.HasDuration {
		collector.addError(model.GenericErrMissingRequiredField, path+".lifecycle.durationMs", "source_target requires a positive duration formula", def.ProviderKey)
	}
}

func normalizeHealGroupMode(mode string) string {
	return model.NormalizeHealGroupMode(mode)
}

func (ctx *genericCompileContext) noteHealGroupMode(groupKey, mode, path string) {
	if ctx == nil || strings.TrimSpace(groupKey) == "" {
		return
	}
	mode = normalizeHealGroupMode(mode)
	if ctx.healGroupModes == nil {
		ctx.healGroupModes = map[string]healGroupModeSeen{}
	}
	if prev, ok := ctx.healGroupModes[groupKey]; ok {
		if prev.mode != mode {
			ctx.collector.addError(model.GenericErrUnknownRef, prev.path+".healGroupCalculationMode", "healGroupKey calculationMode conflict", groupKey)
			ctx.collector.addError(model.GenericErrUnknownRef, path+".healGroupCalculationMode", "healGroupKey calculationMode conflict", groupKey)
		}
		return
	}
	ctx.healGroupModes[groupKey] = healGroupModeSeen{mode: mode, path: path}
}
