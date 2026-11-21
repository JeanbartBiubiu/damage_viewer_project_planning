package lifecycle

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func ValidateElapsedSnapshot(snapshot model.Snapshot, compiled plan.CompiledSession, sessionID string) *model.EngineError {
	executor := New(&compiled, nil, nil, sessionID)
	if !compiled.Features.Has(plan.FeatureProviderElapsedReads) {
		return nil
	}
	for _, combatant := range snapshot.Combatants {
		for _, provider := range combatant.Providers {
			index, found := effectpkg.FindProviderDefinitionIndex(compiled, provider.DefinitionRef)
			if !found || !compiled.Providers[index].NeedsElapsedTime {
				continue
			}
			bad := func(field, message string) *model.EngineError {
				return executor.invariant("initialSnapshot.combatants."+combatant.Key+".providers["+provider.ProviderRef+"]."+field, message, provider.ProviderRef)
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
