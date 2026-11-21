package lifecycle

import (
	"math"
	"strconv"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func ValidateShieldSnapshot(snapshot model.Snapshot, compiled plan.CompiledSession, sessionID string) *model.EngineError {
	executor := New(&compiled, nil, nil, sessionID)
	if !compiled.Features.Has(plan.FeatureShieldLifecycle) {
		for _, c := range snapshot.Combatants {
			for _, sh := range c.Shields {
				if sh.DefinitionRef != "" || sh.LifecycleProviderRef != "" {
					return executor.invariant("initialSnapshot.combatants."+c.Key+".shields", "shield lifecycle definition is not compiled", sh.ShieldRef)
				}
			}
		}
		return nil
	}
	bad := func(path, message, ref string) *model.EngineError {
		return executor.invariant(path, message, ref)
	}
	combatants := map[string]bool{}
	shieldRefCounts := map[string]int{}
	providerRefCounts := map[string]int{}
	for _, c := range snapshot.Combatants {
		combatants[c.Key] = true
		for _, sh := range c.Shields {
			shieldRefCounts[sh.ShieldRef]++
		}
		for _, provider := range c.Providers {
			providerRefCounts[provider.ProviderRef]++
		}
	}
	seenShields := map[string]bool{}
	seenProviders := map[string]bool{}
	for _, c := range snapshot.Combatants {
		bindings := map[string]bool{}
		for i, sh := range c.Shields {
			path := "initialSnapshot.combatants." + c.Key + ".shields[" + strconv.Itoa(i) + "]"
			linked := sh.DefinitionRef != "" || sh.LifecycleProviderRef != ""
			if !linked {
				continue
			}
			if sh.ShieldRef == "" || sh.DefinitionRef == "" || sh.LifecycleProviderRef == "" {
				return bad(path, "linked shield requires all explicit instance and definition references", sh.ShieldRef)
			}
			if seenShields[sh.ShieldRef] || shieldRefCounts[sh.ShieldRef] != 1 {
				return bad(path+".shieldRef", "duplicate linked shield instance", sh.ShieldRef)
			}
			seenShields[sh.ShieldRef] = true
			if sh.Owner != c.Key || !combatants[sh.Source] {
				return bad(path, "linked shield requires its actual source and recipient", sh.ShieldRef)
			}
			if math.IsNaN(sh.Remaining) || math.IsInf(sh.Remaining, 0) || sh.Remaining <= 0 {
				return bad(path+".remaining", "linked shield remaining must be finite and positive", sh.ShieldRef)
			}
			if sh.ExpireAt != nil && *sh.ExpireAt <= snapshot.TimeMs {
				return bad(path+".expireAt", "linked shield expiry must be in the future or null", sh.ShieldRef)
			}
			if bindings[sh.LifecycleProviderRef] || providerRefCounts[sh.LifecycleProviderRef] != 1 {
				return bad(path+".lifecycleProviderRef", "a provider cannot own multiple shields", sh.LifecycleProviderRef)
			}
			bindings[sh.LifecycleProviderRef] = true
			matches := 0
			for _, p := range c.Providers {
				if p.ProviderRef != sh.LifecycleProviderRef {
					continue
				}
				matches++
				index, exists := effectpkg.FindProviderDefinitionIndex(compiled, p.DefinitionRef)
				if !exists || compiled.Providers[index].ShieldDefinitionRef != sh.DefinitionRef {
					return bad(path+".definitionRef", "linked provider definition does not match shield", sh.ShieldRef)
				}
				if p.Source != sh.Source || p.Owner != sh.Owner || p.Stacks != 1 {
					return bad(path, "linked shield/provider source, owner and stack count must agree", sh.ShieldRef)
				}
				if (p.ExpireAt == nil) != (sh.ExpireAt == nil) || (p.ExpireAt != nil && *p.ExpireAt != *sh.ExpireAt) {
					return bad(path+".expireAt", "linked shield/provider expiry must agree", sh.ShieldRef)
				}
			}
			if matches != 1 {
				return bad(path+".lifecycleProviderRef", "linked shield requires exactly one actual provider", sh.LifecycleProviderRef)
			}
			for j, other := range c.Shields {
				if j != i && other.ShieldRef == sh.ShieldRef {
					return bad(path+".shieldRef", "duplicate actual shield reference", sh.ShieldRef)
				}
				if j != i && other.DefinitionRef == sh.DefinitionRef && other.Source == sh.Source && other.Owner == sh.Owner {
					return bad(path, "duplicate shield source/owner/definition", sh.ShieldRef)
				}
			}
		}
		for _, p := range c.Providers {
			index, known := effectpkg.FindProviderDefinitionIndex(compiled, p.DefinitionRef)
			if !known || compiled.Providers[index].ShieldDefinitionRef == "" {
				continue
			}
			if !bindings[p.ProviderRef] || seenProviders[p.ProviderRef] {
				return bad("initialSnapshot.combatants."+c.Key+".providers", "shield lifecycle provider requires one unique owning shield", p.ProviderRef)
			}
			seenProviders[p.ProviderRef] = true
		}
	}
	return nil
}
