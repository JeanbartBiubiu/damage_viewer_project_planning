package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func validateResolvedContactReads(dependencies []formula.GenericInstr, path string, ctx *genericCompileContext) {
	if !formulaReadsKind(dependencies, formula.ReadEventSkillUseContactCount) {
		return
	}
	if ctx.currentListener != nil {
		for _, event := range ctx.currentListener.EventMatcher.All {
			if event == model.EventTypeProcessResolved {
				return
			}
		}
	}
	ctx.collector.addError(model.GenericErrFormulaTypeError, path, "skill-use contact count requires a native process_resolved listener", "event.skill_use.contactCount")
}

func finalizeParticipationProviderBindings(ctx *genericCompileContext) {
	for opIndex := range ctx.session.Operations {
		op := &ctx.session.Operations[opIndex]
		if op.SkillHit == nil {
			continue
		}
		for i := range op.SkillHit.Candidates {
			candidate := &op.SkillHit.Candidates[i]
			if candidate.ParticipationProviderRef == "" {
				continue
			}
			matchedOwner := false
			for _, actor := range ctx.session.Combatants {
				ownsPlan := false
				for _, mount := range actor.ProviderMounts {
					if int(mount.DefinitionIndex) == op.OwnerProviderIndex {
						ownsPlan = true
					}
				}
				if !ownsPlan {
					continue
				}
				matchedOwner = true
				found := false
				for _, mount := range actor.ProviderMounts {
					if mount.ProviderRef != candidate.ParticipationProviderRef {
						continue
					}
					slot := 0
					if actor.Key == model.SelectorTarget {
						slot = 1
					}
					candidate.ParticipationProviderRefs[slot] = mount.ProviderRef
					candidate.ParticipationProviderDefinitions[slot] = mount.DefinitionIndex
					found = true
				}
				if !found {
					ctx.collector.addError(model.GenericErrUnknownRef, candidate.Path+".participationProviderRef", "candidate participation provider must be an original mount of the same source", candidate.ParticipationProviderRef)
				}
			}
			if !matchedOwner {
				ctx.collector.addError(model.GenericErrUnknownRef, candidate.Path+".participationProviderRef", "candidate participation owner must be originally mounted", candidate.ParticipationProviderRef)
			}
		}
	}
}
