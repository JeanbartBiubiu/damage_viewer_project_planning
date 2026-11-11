package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/plan"
)

// compileFormulaFactRequests 在读取授权与编号绑定完成后建立有限请求。
// 运行时按实际供值定义直接取请求，不扫描全程序，也不提前读取条件两支的值。
func compileFormulaFactRequests(session *plan.CompiledSession, formulas *formula.Builder) map[formula.GenericProgramID][]formula.FactRequest {
	if !session.HasLinkedShieldReads && !session.HasReceivedShieldReads && !session.HasDamageStateBefore {
		return nil
	}
	requests := make(map[formula.GenericProgramID][]formula.FactRequest)
	add := func(program formula.GenericProgramID) {
		if _, exists := requests[program]; exists {
			return
		}
		var own []formula.FactRequest
		for _, read := range formulas.ReadDependencies(program) {
			request, special := formula.FactRequestForRead(read)
			if !special {
				continue
			}
			found := false
			for _, prior := range own {
				if prior == request {
					found = true
					break
				}
			}
			if !found {
				own = append(own, request)
			}
		}
		if len(own) > 0 {
			requests[program] = own
		}
	}
	for index := 0; index < formulas.Count(); index++ {
		add(formula.GenericProgramID(index))
	}
	link := func(owner int, id formula.GenericProgramID) {
		if owner < 0 || owner >= len(session.Providers) {
			return
		}
		provider := &session.Providers[owner]
		for _, request := range requests[id] {
			if request.Kind != formula.ReadLinkedShieldPresent {
				continue
			}
			found := false
			for _, prior := range provider.FormulaLinkedReads {
				found = found || prior == request
			}
			if !found {
				provider.FormulaLinkedReads = append(provider.FormulaLinkedReads, request)
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
