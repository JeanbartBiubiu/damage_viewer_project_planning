package compile

import (
	"sort"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// This capability is inferred from actual own-attack listener conditions. A
// declared formula alone cannot grant a capture or choose another mount.
func finalizeAttackStartStateReads(ctx *genericCompileContext) {
	allowed := map[formula.GenericProgramID]bool{}
	start, hasStart := ctx.session.Types.Registry.LookupDomain("event", model.EventTypeBasicAttackStart)
	hit, hasHit := ctx.session.Types.Registry.LookupDomain("event", model.EventTypeBasicAttackHit)
	owner, hasOwner := ctx.session.Types.Registry.LookupDomain("event", "event/source_owner")
	for _, listener := range ctx.session.Listeners {
		if !listener.HasCondition {
			continue
		}
		deps := ctx.session.Formulas.ReadDependencies(listener.ConditionProgram)
		var keys []string
		for _, dep := range deps {
			if dep.ReadKind == formula.ReadUseProviderStateBefore {
				keys = append(keys, dep.ReadKey)
			}
		}
		if len(keys) == 0 {
			continue
		}
		ownStart := hasStart && listener.EventMatcher.RequiresAllType(start)
		ownHit := hasHit && listener.EventMatcher.RequiresAllType(hit)
		valid := listener.OwnerCombatantKey == model.SelectorSource && listener.OwnerProviderRef != "" && hasOwner && listener.EventMatcher.RequiresAllType(owner) && ownStart != ownHit && listener.SourceAbilityIndex >= 0
		if !valid || listener.SourceAbilityIndex >= len(ctx.session.Abilities) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, "listeners."+listener.ListenerKey+".condition", "attack-start counter capture requires an original own basic-attack START/HIT listener", "use.provider_state_before")
			continue
		}
		ability := ctx.session.Abilities[listener.SourceAbilityIndex]
		provider := &ctx.session.Providers[ability.ProviderIndex]
		for _, key := range keys {
			field, exists := provider.StateFields[key]
			if !exists || field.ValueType != model.ProviderStateValueInteger || field.StateKind != "" || ability.SkillKey == "" || ability.SkillKey != provider.SkillKey {
				ctx.collector.addError(model.GenericErrFormulaTypeError, "listeners."+listener.ListenerKey+".condition", "attack-start capture requires the listener's own integer counter", key)
				continue
			}
			found := false
			for _, prior := range provider.AttackStartStateKeys {
				found = found || prior == key
			}
			if !found {
				provider.AttackStartStateKeys = append(provider.AttackStartStateKeys, key)
			}
			ctx.session.HasAttackStartStateReads = true
		}
		allowed[listener.ConditionProgram] = true
	}
	for i := range ctx.session.Providers {
		sort.Strings(ctx.session.Providers[i].AttackStartStateKeys)
	}
	for index, program := range ctx.session.Formulas.Programs {
		for _, dep := range ctx.session.Formulas.ReadDependencies(formula.GenericProgramID(index)) {
			if dep.ReadKind == formula.ReadUseProviderStateBefore && !allowed[formula.GenericProgramID(index)] && !program.DeclaredNamed {
				ctx.collector.addError(model.GenericErrFormulaTypeError, program.Key, "attack-start counter reads are restricted to original own basic-attack listener conditions", dep.ReadKey)
			}
		}
	}
}
