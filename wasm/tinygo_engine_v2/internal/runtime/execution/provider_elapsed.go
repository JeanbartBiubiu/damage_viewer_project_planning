package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func withProviderElapsed(ctx pipeline.ProviderFormulaContext, providers effectpkg.ProviderList, providerRef string, nowMs int64, definitions []planbundle.CompiledProvider) pipeline.ProviderFormulaContext {
	inst, _, found := providers.Find(providerRef)
	if !found || int(inst.DefinitionIndex) >= len(definitions) {
		return ctx
	}
	if definitions[inst.DefinitionIndex].NeedsModifierExpiry && inst.Expired(nowMs) {
		ctx.SkipExpiredAttributeModifier = true
		return ctx
	}
	if !definitions[inst.DefinitionIndex].NeedsElapsedTime {
		return ctx
	}
	if !inst.HasAppliedAt || inst.AppliedAtMs < 0 || inst.AppliedAtMs > nowMs || inst.AppliedAtMs > maxJSONSafeInteger || inst.ExpireAt <= inst.AppliedAtMs {
		return ctx
	}
	// Another event at the same timestamp can resolve attributes before this
	// provider's own cleanup. Its finite effect is already inactive, so do not
	// evaluate its value formula without an active instance context. The original
	// queued cleanup retains ownership of removal, evidence and budget accounting.
	if inst.ExpireAt <= nowMs {
		ctx.SkipExpiredAttributeModifier = true
		return ctx
	}
	ctx.HasProviderElapsed, ctx.ProviderElapsedMs = true, nowMs-inst.AppliedAtMs
	return ctx
}

// The caller already owns the actual instance; no provider lookup or clock default
// can substitute for its recorded application and active finite deadline.
func actualProviderElapsed(inst effectpkg.Provider, nowMs int64) (int64, bool) {
	if !inst.HasAppliedAt || inst.AppliedAtMs < 0 || inst.AppliedAtMs > nowMs || inst.AppliedAtMs > maxJSONSafeInteger || nowMs > maxJSONSafeInteger || inst.ExpireAt <= nowMs || inst.ExpireAt <= inst.AppliedAtMs {
		return 0, false
	}
	return nowMs - inst.AppliedAtMs, true
}

func validateProviderElapsedSnapshot(snapshot model.Snapshot, compiled planbundle.CompiledSession, sessionID string) *model.EngineError {
	if !compiled.HasProviderElapsedReads {
		return nil
	}
	for _, combatant := range snapshot.Combatants {
		for _, provider := range combatant.Providers {
			index, found := effectpkg.FindProviderDefinitionIndex(compiled, provider.DefinitionRef)
			if !found || !compiled.Providers[index].NeedsElapsedTime {
				continue
			}
			bad := func(field, message string) *model.EngineError {
				return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message,
					"initialSnapshot.combatants."+combatant.Key+".providers["+provider.ProviderRef+"]."+field, provider.ProviderRef, compiled.SchemaHash, compiled.RulesHash, sessionID)
			}
			if provider.AppliedAtMs == nil || *provider.AppliedAtMs < 0 || *provider.AppliedAtMs > snapshot.TimeMs || *provider.AppliedAtMs > maxJSONSafeInteger {
				return bad("appliedAtMs", "elapsed-time provider requires a non-negative actual application time no later than snapshot time")
			}
			if provider.ExpireAt == nil || *provider.ExpireAt <= snapshot.TimeMs || *provider.ExpireAt <= *provider.AppliedAtMs {
				return bad("expireAt", "elapsed-time provider requires a finite active lifecycle after its application")
			}
		}
	}
	return nil
}
