package hit

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// BlockUnit 是一次法盾阻挡的独立范围与盾身份，不包含执行帧、行动或可写效果实例。
type BlockUnit struct {
	Scope                                        string
	OccurrenceID                                 uint64
	UseRef                                       string
	EffectOccurrenceKey, ResultKey, CandidateKey string
	ShieldOwner, ShieldProviderRef               string
	ShieldDefinitionRef, ShieldSource            string
}

// HasBlockable 核对原顺序候选中是否存在可触发入站判盾的结果。
func HasBlockable(plan *planbundle.CompiledSkillHit, selected []int) bool {
	for _, index := range selected {
		if plan.Candidates[index].InboundBlockEligible {
			return true
		}
	}
	return false
}

// FormBlockUnit 从第一个非空入站结果冻结范围，后续候选只能被该范围覆盖，不能扩大它。
func FormBlockUnit(plan *planbundle.CompiledSkillHit, selected []int, occurrenceID uint64, useRef string, identity Identity) (BlockUnit, bool, *model.EngineError) {
	var first planbundle.CompiledSkillHitCandidate
	found := false
	for _, index := range selected {
		candidate := plan.Candidates[index]
		if candidate.InboundBlockEligible && candidate.HasBlockScope {
			first, found = candidate, true
			break
		}
	}
	if !found {
		return BlockUnit{}, false, nil
	}
	unit := BlockUnit{OccurrenceID: occurrenceID, UseRef: useRef, Scope: first.BlockScope, EffectOccurrenceKey: first.EffectOccurrenceKey, ResultKey: first.ResultKey, CandidateKey: first.CandidateKey}
	for _, index := range selected {
		candidate := plan.Candidates[index]
		if !candidate.HasBlockScope || !candidate.InboundBlockEligible {
			continue
		}
		if model.ScopeCovers(unit.Scope, occurrenceID, unit.EffectOccurrenceKey, unit.ResultKey, unit.CandidateKey, useRef, candidate.BlockScope, occurrenceID, candidate.EffectOccurrenceKey, candidate.ResultKey, candidate.CandidateKey, useRef) {
			continue
		}
		return BlockUnit{}, false, hitError(identity, model.GenericErrRuntimeInvariantFailed, "incompatible spell shield units; the first non-null result cannot be expanded by a later candidate", candidate.Path+".spellShieldBlockScope", candidate.CandidateKey)
	}
	return unit, true, nil
}

// CoversCandidates 核对既有技能范围判盾能否覆盖本次候选，沿原口径也检查声明范围的非入站结果。
func CoversCandidates(unit BlockUnit, plan *planbundle.CompiledSkillHit, selected []int, occurrenceID uint64, useRef string) bool {
	for _, index := range selected {
		candidate := plan.Candidates[index]
		if !candidate.HasBlockScope {
			continue
		}
		if !model.ScopeCovers(unit.Scope, unit.OccurrenceID, unit.EffectOccurrenceKey, unit.ResultKey, unit.CandidateKey, unit.UseRef, candidate.BlockScope, occurrenceID, candidate.EffectOccurrenceKey, candidate.ResultKey, candidate.CandidateKey, useRef) {
			return false
		}
	}
	return true
}
