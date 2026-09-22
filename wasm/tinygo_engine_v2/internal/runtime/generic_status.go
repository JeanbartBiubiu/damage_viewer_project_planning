package runtime

import (
	"math"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/status"
)

type preparedProviderLifecycle struct {
	expireAt      int64
	hasExpireAt   bool
	contributions []status.StatusContribution
}

func (f *executionFrame) evalContextForProviderApply(ability compilebundle.CompiledAbility, sourceKey, targetKey string) formula.GenericEvalContext {
	ctx := f.evalContext(ability)
	if sourceKey != "" && sourceKey != f.sourceKey {
		sc := f.stageFor(sourceKey)
		ctx.SourceAttrs = sc.attributes
		ctx.SourceResources = sc.resources
	}
	if targetKey != "" && targetKey != f.targetKey {
		sc := f.stageFor(targetKey)
		ctx.TargetAttrs = sc.attributes
		ctx.TargetResources = sc.resources
	}
	return ctx
}

func (f *executionFrame) prepareProviderMutation(definitionRef, providerRef, sourceKey, targetKey string, ability compilebundle.CompiledAbility) (*preparedProviderLifecycle, *model.EngineError) {
	var provider compilebundle.CompiledProvider
	if definitionRef != "" {
		defIdx, ok := f.run.findProviderDefinitionIndex(definitionRef)
		if !ok {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition: "+definitionRef, "providerDefinitionRef", definitionRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		provider = f.run.compiled.Providers[defIdx]
	} else {
		c, ok := f.run.combatants[targetKey]
		if !ok {
			return nil, engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown combatant: "+targetKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		inst, _, found := status.FindByRef(c.providers, providerRef)
		if !found {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown providerRef: "+providerRef, "providerRef", providerRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if int(inst.DefinitionIndex) >= len(f.run.compiled.Providers) {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "unknown provider definition for refresh", "providerRef", providerRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		provider = f.run.compiled.Providers[inst.DefinitionIndex]
		if sourceKey == "" {
			sourceKey = inst.Source
		}
	}
	evalCtx := f.evalContextForProviderApply(ability, sourceKey, targetKey)
	evalCtx.StrictReads = true
	return f.prepareProviderLifecycle(provider, evalCtx)
}

func (f *executionFrame) prepareProviderLifecycle(provider compilebundle.CompiledProvider, evalCtx formula.GenericEvalContext) (*preparedProviderLifecycle, *model.EngineError) {
	out := &preparedProviderLifecycle{}
	if provider.Lifecycle != nil && provider.Lifecycle.HasDuration {
		expireAt, err := f.evalPreparedDuration(provider, evalCtx)
		if err != nil {
			return nil, err
		}
		out.expireAt = expireAt
		out.hasExpireAt = true
	} else if provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse() {
		return nil, f.providerLifecycleError(model.GenericErrMissingRequiredField, provider.Lifecycle.DurationPath, "source_target duration is required", provider.ProviderKey)
	}
	if len(provider.StatusContributions) > 0 {
		if out.expireAt <= f.run.nowMs {
			path := "provider[" + provider.ProviderKey + "].lifecycle.durationMs"
			if provider.Lifecycle != nil && provider.Lifecycle.DurationPath != "" {
				path = provider.Lifecycle.DurationPath
			}
			return nil, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "status contribution duration must be positive", provider.ProviderKey)
		}
		contribs, err := f.evalPreparedStatusContributions(provider, evalCtx)
		if err != nil {
			return nil, err
		}
		out.contributions = contribs
	}
	return out, nil
}

func (f *executionFrame) evalPreparedDuration(provider compilebundle.CompiledProvider, evalCtx formula.GenericEvalContext) (int64, *model.EngineError) {
	lc := provider.Lifecycle
	path := lc.DurationPath
	if path == "" {
		path = "provider[" + provider.ProviderKey + "].lifecycle.durationMs"
	}
	value, err := f.run.compiled.Formulas.Eval(lc.DurationProgram, evalCtx)
	if err != nil {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, err.Error(), provider.ProviderKey)
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "non-finite duration", provider.ProviderKey)
	}
	if lc.AllowsSourceTargetReuse() && (value <= 0 || math.Trunc(value) != value || value >= 9223372036854775808.0) {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "source_target duration must be a positive integer within the timestamp range", provider.ProviderKey)
	}
	delta := int64(value)
	if lc.AllowsSourceTargetReuse() && delta <= 0 {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "source_target duration must be positive", provider.ProviderKey)
	}
	expireAt := f.run.nowMs + delta
	if lc.AllowsSourceTargetReuse() && (expireAt <= f.run.nowMs || expireAt <= 0) {
		return 0, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "source_target expiry overflows the timestamp range", provider.ProviderKey)
	}
	return expireAt, nil
}

func (f *executionFrame) evalPreparedStatusContributions(provider compilebundle.CompiledProvider, evalCtx formula.GenericEvalContext) ([]status.StatusContribution, *model.EngineError) {
	out := make([]status.StatusContribution, 0, len(provider.StatusContributions))
	for _, item := range provider.StatusContributions {
		path := item.Path + ".strength"
		if !item.HasStrength {
			return nil, f.providerLifecycleError(model.GenericErrMissingRequiredField, path, "status contribution strength is required; explicit zero is allowed", item.ResultRef)
		}
		value, err := f.run.compiled.Formulas.Eval(item.StrengthProgram, evalCtx)
		if err != nil {
			return nil, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, err.Error(), item.ResultRef)
		}
		if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
			return nil, f.providerLifecycleError(model.GenericErrFormulaTypeError, path, "status contribution strength must be finite and within [0,1]", item.ResultRef)
		}
		out = append(out, status.StatusContribution{
			ResultRef:  item.ResultRef,
			StatusKey:  item.StatusKey,
			StatusKind: item.StatusKind,
			Strength:   value,
		})
	}
	return out, nil
}

func (f *executionFrame) providerLifecycleError(code model.GenericErrCode, path, message, ref string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, code, message, path, ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
}

func cloneStatusContributions(items []status.StatusContribution) []status.StatusContribution {
	if len(items) == 0 {
		return nil
	}
	out := make([]status.StatusContribution, len(items))
	copy(out, items)
	return out
}

func findSourceTargetProvider(instances []status.ProviderInstance, definitionRef, sourceKey, ownerKey string, nowMs int64) (status.ProviderInstance, int, bool) {
	for i, inst := range instances {
		if !inst.Expired(nowMs) && inst.DefinitionRef == definitionRef && inst.Source == sourceKey && inst.Owner == ownerKey {
			return inst, i, true
		}
	}
	return status.ProviderInstance{}, -1, false
}

func contributionsToSnapshot(items []status.StatusContribution) []model.ProviderStatusContributionSnapshot {
	if len(items) == 0 {
		return nil
	}
	out := make([]model.ProviderStatusContributionSnapshot, 0, len(items))
	for _, item := range items {
		strength := item.Strength
		out = append(out, model.ProviderStatusContributionSnapshot{
			ResultRef:  item.ResultRef,
			StatusKey:  item.StatusKey,
			StatusKind: item.StatusKind,
			Strength:   &strength,
		})
	}
	return out
}

func snapshotStatusContributionsData(items []status.StatusContribution) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]interface{}{
			"resultRef":  item.ResultRef,
			"statusKey":  item.StatusKey,
			"statusKind": item.StatusKind,
			"strength":   item.Strength,
		})
	}
	return out
}

func (s *genericRunState) recordProviderLifecycleEvidence(kind model.EvidenceKind, inst status.ProviderInstance) {
	source := inst.Source
	if source == "" {
		source = inst.Owner
	}
	s.recordEvidence(model.EvidenceItem{
		TimeMs: s.nowMs,
		Kind:   kind,
		Ref:    inst.ProviderRef,
		Path:   "providers[" + inst.ProviderRef + "]",
		Data: map[string]interface{}{
			"providerRef":         inst.ProviderRef,
			"definitionRef":       inst.DefinitionRef,
			"source":              source,
			"owner":               inst.Owner,
			"expireAt":            inst.ExpireAt,
			"statusContributions": snapshotStatusContributionsData(inst.StatusContributions),
		},
	})
}

func (s *genericRunState) buildEffectiveStatuses(instances []status.ProviderInstance) []model.EffectiveStatusSnapshot {
	type acc struct {
		strength      float64
		contributions []model.EffectiveStatusContribution
	}
	byKind := map[string]*acc{}
	order := make([]string, 0)
	for _, inst := range instances {
		if inst.Expired(s.nowMs) {
			continue
		}
		source := inst.Source
		if source == "" {
			source = inst.Owner
		}
		for _, item := range inst.StatusContributions {
			if item.StatusKind != model.StatusKindMovementSlow {
				continue
			}
			bucket, ok := byKind[item.StatusKind]
			if !ok {
				bucket = &acc{}
				byKind[item.StatusKind] = bucket
				order = append(order, item.StatusKind)
			}
			bucket.contributions = append(bucket.contributions, model.EffectiveStatusContribution{
				ProviderRef: inst.ProviderRef,
				ResultRef:   item.ResultRef,
				StatusKey:   item.StatusKey,
				Source:      source,
				ExpireAt:    inst.ExpireAt,
				Strength:    item.Strength,
			})
			if len(bucket.contributions) == 1 || item.Strength > bucket.strength {
				bucket.strength = item.Strength
			}
		}
	}
	if len(order) == 0 {
		return []model.EffectiveStatusSnapshot{}
	}
	out := make([]model.EffectiveStatusSnapshot, 0, len(order))
	for _, kind := range order {
		bucket := byKind[kind]
		contribs := bucket.contributions
		if contribs == nil {
			contribs = []model.EffectiveStatusContribution{}
		}
		out = append(out, model.EffectiveStatusSnapshot{
			StatusKind:    kind,
			Strength:      bucket.strength,
			Contributions: contribs,
		})
	}
	return out
}

func restoreStatusContributions(snap model.CombatantProviderSnapshot, provider compilebundle.CompiledProvider, path string, schemaHash, rulesHash, sessionID string) ([]status.StatusContribution, *model.EngineError) {
	defs := provider.StatusContributions
	raw := snap.StatusContributions
	if len(defs) == 0 && len(raw) == 0 {
		return nil, nil
	}
	if len(defs) == 0 {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "provider snapshot has statusContributions but definition has none", path+".statusContributions", snap.ProviderRef, schemaHash, rulesHash, sessionID)
	}
	if len(raw) != len(defs) {
		return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "provider snapshot statusContributions must align with definition", path+".statusContributions", snap.ProviderRef, schemaHash, rulesHash, sessionID)
	}
	byRef := map[string]int{}
	out := make([]status.StatusContribution, 0, len(defs))
	for i, item := range raw {
		p := path + ".statusContributions[" + itoa(uint32(i)) + "]"
		if item.ResultRef == "" {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "status contribution resultRef is required", p+".resultRef", snap.ProviderRef, schemaHash, rulesHash, sessionID)
		}
		if prev, dup := byRef[item.ResultRef]; dup {
			_ = prev
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "duplicate status contribution resultRef", p+".resultRef", item.ResultRef, schemaHash, rulesHash, sessionID)
		}
		byRef[item.ResultRef] = i
		def, ok := findCompiledStatusContribution(defs, item.ResultRef)
		if !ok {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "status contribution resultRef is not in definition", p+".resultRef", item.ResultRef, schemaHash, rulesHash, sessionID)
		}
		if item.StatusKey != def.StatusKey {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "status contribution statusKey does not match definition", p+".statusKey", item.StatusKey, schemaHash, rulesHash, sessionID)
		}
		if item.StatusKind != def.StatusKind {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "status contribution statusKind does not match definition", p+".statusKind", item.StatusKind, schemaHash, rulesHash, sessionID)
		}
		if item.Strength == nil {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "status contribution strength is required; explicit zero is allowed", p+".strength", item.ResultRef, schemaHash, rulesHash, sessionID)
		}
		strength := *item.Strength
		if math.IsNaN(strength) || math.IsInf(strength, 0) || strength < 0 || strength > 1 {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "status contribution strength must be finite and within [0,1]", p+".strength", item.ResultRef, schemaHash, rulesHash, sessionID)
		}
		out = append(out, status.StatusContribution{
			ResultRef:  item.ResultRef,
			StatusKey:  item.StatusKey,
			StatusKind: item.StatusKind,
			Strength:   strength,
		})
	}
	for _, def := range defs {
		if _, ok := byRef[def.ResultRef]; !ok {
			return nil, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "provider snapshot missing status contribution", path+".statusContributions", def.ResultRef, schemaHash, rulesHash, sessionID)
		}
	}
	return out, nil
}

func findCompiledStatusContribution(defs []compilebundle.CompiledStatusContribution, resultRef string) (compilebundle.CompiledStatusContribution, bool) {
	for _, def := range defs {
		if def.ResultRef == resultRef {
			return def, true
		}
	}
	return compilebundle.CompiledStatusContribution{}, false
}
