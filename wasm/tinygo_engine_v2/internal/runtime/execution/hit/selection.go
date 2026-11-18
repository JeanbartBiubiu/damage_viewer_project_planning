package hit

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// SelectionHost 只提供候选冻结时原有的求值准备和实际挂载查询。
type SelectionHost interface {
	// HitParticipation 在给定实际挂载上求值；live=false表示挂载已经失效。
	HitParticipation(program formula.GenericProgramID, ability planbundle.CompiledAbility, provider string, definition uint16) (value float64, live bool, err *model.EngineError)
	// HitConditionValue 在本帧原有参数及事件上下文中读取右值，保留公式错误归属。
	HitConditionValue(condition planbundle.CompiledSkillHitValueCond, candidateKey string) (float64, *model.EngineError)
	// HitExecutionError 生成归属本场的命中错误，不发布状态。
	HitExecutionError(code model.GenericErrCode, message, path, ref string) *model.EngineError
}

// SelectCandidates 按编译原序完成参与条件和非阻挡事件值选择，不执行候选。
func SelectCandidates(plan *planbundle.CompiledSkillHit, ability planbundle.CompiledAbility, source string, firstHas bool, firstValue float64, host SelectionHost) ([]int, *model.EngineError) {
	var selected []int
	for index, candidate := range plan.Candidates {
		if candidate.HasParticipation {
			provider := ""
			var definition uint16
			if candidate.ParticipationProviderRef != "" {
				slot := 0
				if source == model.SelectorTarget {
					slot = 1
				}
				provider, definition = candidate.ParticipationProviderRefs[slot], candidate.ParticipationProviderDefinitions[slot]
				if provider == "" {
					return nil, host.HitExecutionError(model.GenericErrUnknownRef, "participation provider is not mounted on the actual source", candidate.Path+".participationProviderRef", candidate.ParticipationProviderRef)
				}
			}
			value, live, err := host.HitParticipation(candidate.ParticipationProgram, ability, provider, definition)
			if err != nil {
				if err.Path == "" {
					err.Path = candidate.Path + ".participationCondition"
				}
				return nil, err
			}
			if !live || value == 0 {
				continue
			}
		}
		accepted, err := matchEventValues(candidate, firstHas, firstValue, false, 0, false, host)
		if err != nil {
			return nil, err
		}
		if !accepted {
			continue
		}
		if candidate.HasBlockScope || candidate.HasSpellShieldFollow {
			unblocked, err := matchEventValues(candidate, firstHas, firstValue, true, 0, true, host)
			if err != nil {
				return nil, err
			}
			if !unblocked {
				return nil, host.HitExecutionError(model.GenericErrUnknownRef, "non-null incoming candidate cannot require its own blocked result", candidate.Path+".eventValueConditions", candidate.CandidateKey)
			}
		}
		selected = append(selected, index)
	}
	return selected, nil
}

func matchEventValues(candidate planbundle.CompiledSkillHitCandidate, firstHas bool, firstValue float64, blockedHas bool, blockedValue float64, includeBlocked bool, host SelectionHost) (bool, *model.EngineError) {
	for _, condition := range candidate.EventValueConds {
		if condition.Key == model.SkillHitValueBlocked && !includeBlocked {
			continue
		}
		value, err := host.HitConditionValue(condition, candidate.CandidateKey)
		if err != nil {
			return false, err
		}
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false, host.HitExecutionError(model.GenericErrFormulaTypeError, "non-finite eventValueConditions value", condition.Path+".value", candidate.CandidateKey)
		}
		var left float64
		switch condition.Key {
		case model.SkillHitValueFirstContact:
			if !firstHas {
				return false, nil
			}
			left = firstValue
		case model.SkillHitValueBlocked:
			if !blockedHas {
				return false, nil
			}
			left = blockedValue
		default:
			return false, host.HitExecutionError(model.GenericErrUnknownRef, "unknown event value key", condition.Path+".key", condition.Key)
		}
		matches, valid := model.CompareSkillHitValue(condition.Comparator, left, value)
		if !valid {
			return false, host.HitExecutionError(model.GenericErrUnknownRef, "unsupported comparator", condition.Path+".comparator", condition.Comparator)
		}
		if !matches {
			return false, nil
		}
	}
	return true, nil
}
