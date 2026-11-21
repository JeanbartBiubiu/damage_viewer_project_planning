package compile

import (
	"slices"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/plan"
)

// compileFormulaFactRequests 在读取校验与参与度挂载都完成后登记请求及实际供值资格。
func compileFormulaFactRequests(session *plan.CompiledSession, formulas *formula.Builder) [][]formula.FactRequest {
	var requests [][]formula.FactRequest
	count := formulas.Count()
	for index := 0; index < count; index++ {
		var own []formula.FactRequest
		for _, read := range formulas.ReadDependencies(formula.GenericProgramID(index)) {
			request, special := formula.FactRequestForRead(read)
			if special && !slices.Contains(own, request) {
				own = append(own, request)
			}
		}
		if len(own) != 0 {
			if requests == nil {
				requests = make([][]formula.FactRequest, count)
			}
			requests[index] = own
		}
	}
	if requests == nil {
		return nil
	}
	session.Features |= plan.FeatureHasSpecialFormulaFacts
	link := func(owner int, id formula.GenericProgramID) {
		if owner < 0 || owner >= len(session.Providers) {
			return
		}
		provider := &session.Providers[owner]
		for _, request := range requests[id] {
			if request.Kind == formula.ReadLinkedShieldPresent && !slices.Contains(provider.AuthorizedLinkedShields, request.Index) {
				provider.AuthorizedLinkedShields = append(provider.AuthorizedLinkedShields, request.Index)
			}
		}
	}
	for _, operation := range session.Operations {
		if operation.HasAmount {
			link(operation.OwnerProviderIndex, operation.AmountProgram)
		}
		if operation.HasCondition {
			link(operation.OwnerProviderIndex, operation.ConditionProgram)
		}
		if operation.HasShieldDuration {
			link(operation.OwnerProviderIndex, operation.ShieldDurationProgram)
		}
		if operation.SkillHit != nil {
			for _, candidate := range operation.SkillHit.Candidates {
				if candidate.HasParticipation {
					if candidate.ParticipationProviderRef == "" {
						link(operation.OwnerProviderIndex, candidate.ParticipationProgram)
					} else {
						for slot, provider := range candidate.ParticipationProviderRefs {
							if provider != "" {
								link(int(candidate.ParticipationProviderDefinitions[slot]), candidate.ParticipationProgram)
							}
						}
					}
				}
			}
		}
	}
	for _, ability := range session.Abilities {
		if ability.HasCastCondition {
			link(int(ability.ProviderIndex), ability.CastConditionProgram)
		}
	}
	for index, provider := range session.Providers {
		for _, listener := range provider.Listeners {
			if listener.HasCondition {
				link(index, listener.ConditionProgram)
			}
		}
	}
	return requests
}
