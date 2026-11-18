package compile

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// 跟随关系只在完整同次命中计划内解析，不增加第二份阻挡单位或运行时引用查找。
func compileSpellShieldFollows(candidates []model.SkillHitCandidate, plan *planbundle.CompiledSkillHit, indexes map[string]int, ctx *genericCompileContext) {
	for index, candidate := range candidates {
		key := string(candidate.SpellShieldFollowCandidateKey)
		if key == "" {
			continue
		}
		compiled := &plan.Candidates[index]
		path := compiled.Path + ".spellShieldFollowCandidateKey"
		fail := func(message string) { ctx.collector.addError(model.GenericErrUnknownRef, path, message, key) }
		if candidate.AttackDamageRole != "" || candidate.SpellShieldBlockScope != nil || !directTargetDamageCandidate(candidate) || !candidateCanHoldOnUnblocked(candidate) {
			fail("spell-shield follower requires a non-primary direct instantaneous target damage with null own scope and unblocked eligibility")
			continue
		}
		producerIndex, exists := indexes[key]
		if !exists || producerIndex == index {
			fail("spell-shield follower requires a different existing candidate in the same hit plan")
			continue
		}
		producer := candidates[producerIndex]
		producerPlan := plan.Candidates[producerIndex]
		if producer.SpellShieldFollowCandidateKey != "" || producer.AttackDamageRole != "" || !directTargetDamageCandidate(producer) || !producerPlan.HasBlockScope || !producerPlan.InboundBlockEligible {
			fail("spell-shield producer must be a direct eligible damage candidate with its own scope and no follow relationship")
			continue
		}
		compiled.HasSpellShieldFollow = true
		compiled.SpellShieldFollowCandidateIndex = uint16(producerIndex)
	}
}

func directTargetDamageCandidate(candidate model.SkillHitCandidate) bool {
	return candidate.Semantic.ResultType == model.SkillHitResultDamage && candidate.Semantic.Target == model.SkillHitTargetTARGET &&
		candidate.Semantic.Moment == model.SkillHitMomentInstant && len(candidate.Operations) == 1 &&
		candidate.Operations[0].Operation == "damage" && candidate.Operations[0].Target == model.SelectorTarget &&
		candidate.Operations[0].Condition == nil && candidate.Operations[0].RepeatCount == 0 &&
		candidate.Operations[0].RepeatScope == "" && candidate.Operations[0].RepeatDelayMs == 0 && candidate.Operations[0].RepeatTag == ""
}
