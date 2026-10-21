package compile

import (
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func compileSkillHitRuleGroups(groups []model.SkillHitRuleGroup, candidates []model.SkillHitCandidate, hit *plan.CompiledSkillHit, path string, owner int, ctx *genericCompileContext) {
	if len(groups) == 0 {
		return
	}
	if ctx.compilingBasicAttack || owner < 0 || owner >= len(ctx.session.Providers) {
		ctx.collector.addError(model.GenericErrUnknownRef, path, "ruleGroups require a real mounted skill-hit parent", hit.SkillKey)
	} else if provider := ctx.session.Providers[owner]; provider.Kind == "status" || provider.Lifecycle != nil {
		ctx.collector.addError(model.GenericErrUnknownRef, path, "ruleGroups require a static parent without a dynamic lifecycle", hit.SkillKey)
	}
	seenRules := map[string]bool{}
	for i, group := range groups {
		p := path + "[" + itoa(i) + "]"
		if strings.TrimSpace(group.RuleKey) == "" || seenRules[group.RuleKey] {
			ctx.collector.addError(model.GenericErrUnknownRef, p+".ruleKey", "ruleKey must be nonempty and unique in this hit plan", group.RuleKey)
		}
		seenRules[group.RuleKey] = true
		if group.OncePerUse == nil {
			ctx.collector.addError(model.GenericErrMissingRequiredField, p+".oncePerUse", "rule group requires oncePerUse", group.RuleKey)
			continue
		}
		if !validOncePerUseGroupKey(group.OncePerUse.GroupKey) {
			ctx.collector.addError(model.GenericErrUnknownRef, p+".oncePerUse.groupKey", "oncePerUse.groupKey must match [a-z][a-z0-9_]{0,63}", group.OncePerUse.GroupKey)
		}
		if _, valid := model.ValidOncePerUseScope[group.OncePerUse.Scope]; !valid {
			ctx.collector.addError(model.GenericErrUnknownRef, p+".oncePerUse.scope", "oncePerUse.scope must be provider or provider_target", group.OncePerUse.Scope)
		}
		if len(group.CandidateKeys) == 0 {
			ctx.collector.addError(model.GenericErrMissingRequiredField, p+".candidateKeys", "rule group requires its complete nonempty ordered candidate list", group.RuleKey)
			continue
		}
		compiled := plan.CompiledSkillHitRuleGroup{RuleKey: group.RuleKey, OncePerUseGroup: group.OncePerUse.GroupKey, OncePerUseScope: group.OncePerUse.Scope, Path: p, CandidateStart: -1, CandidateCount: len(group.CandidateKeys)}
		for j, key := range group.CandidateKeys {
			index := -1
			for ci := range hit.Candidates {
				if hit.Candidates[ci].CandidateKey == key {
					index = ci
					break
				}
			}
			if index < 0 || strings.TrimSpace(key) == "" {
				ctx.collector.addError(model.GenericErrUnknownRef, p+".candidateKeys["+itoa(j)+"]", "rule group candidate must exist in this hit plan", key)
				continue
			}
			if j == 0 {
				compiled.CandidateStart = index
			}
			if index != compiled.CandidateStart+j || hit.Candidates[index].RuleGroupIndex >= 0 {
				ctx.collector.addError(model.GenericErrUnknownRef, p+".candidateKeys["+itoa(j)+"]", "rule group candidates must be consecutive, ordered, unique and disjoint", key)
			}
			hit.Candidates[index].RuleGroupIndex = len(hit.RuleGroups)
			candidate := hit.Candidates[index]
			for _, condition := range candidate.EventValueConds {
				if condition.Key == model.SkillHitValueFirstContact {
					ctx.collector.addError(model.GenericErrUnknownRef, condition.Path, "ruleGroups cannot compare firstContact", key)
				}
			}
			validateOncePerUseOperations(candidates[index].Operations, candidate.Path+".operations", ctx)
			if compiled.CandidateStart >= 0 && !sameRuleGroupPredicate(hit.Candidates[compiled.CandidateStart], candidate, ctx) {
				ctx.collector.addError(model.GenericErrUnknownRef, p+".candidateKeys["+itoa(j)+"]", "rule group candidates must share the complete participation and event predicates and actual provider bindings", key)
			}
		}
		hit.RuleGroups = append(hit.RuleGroups, compiled)
	}
}

func sameRuleGroupProgram(a, b formula.GenericProgramID, ctx *genericCompileContext) bool {
	programs := ctx.session.Formulas.Programs
	if int(a) >= len(programs) || int(b) >= len(programs) {
		return false
	}
	x, y := programs[a].Instr, programs[b].Instr
	if len(x) != len(y) {
		return false
	}
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}

func sameRuleGroupPredicate(a, b plan.CompiledSkillHitCandidate, ctx *genericCompileContext) bool {
	if a.HasParticipation != b.HasParticipation || a.ParticipationProviderRef != b.ParticipationProviderRef || a.ParticipationProviderRefs != b.ParticipationProviderRefs || a.ParticipationProviderDefinitions != b.ParticipationProviderDefinitions || len(a.EventValueConds) != len(b.EventValueConds) {
		return false
	}
	if a.HasParticipation && !sameRuleGroupProgram(a.ParticipationProgram, b.ParticipationProgram, ctx) {
		return false
	}
	for i, x := range a.EventValueConds {
		y := b.EventValueConds[i]
		if x.Key != y.Key || x.Comparator != y.Comparator || x.HasValue != y.HasValue || !sameRuleGroupProgram(x.ValueProg, y.ValueProg, ctx) {
			return false
		}
	}
	return true
}

func finalizeSkillHitRuleGroups(ctx *genericCompileContext) {
	for index, ability := range ctx.session.Abilities {
		if !ability.HasSkillHit || ability.OperationCount != 1 {
			continue
		}
		hit := ctx.session.Operations[ability.OperationStart].SkillHit
		if hit == nil || len(hit.RuleGroups) == 0 {
			continue
		}
		mounted := false
		for _, actor := range ctx.session.Combatants {
			for _, mount := range actor.ProviderMounts {
				if int(mount.DefinitionIndex) == hit.OwnerProviderIndex {
					mounted = true
				}
			}
		}
		if !mounted {
			ctx.collector.addError(model.GenericErrUnknownRef, hit.RuleGroups[0].Path, "ruleGroups require their actual original parent mount", ability.AbilityKey)
		}
		for _, binding := range ctx.session.SkillActionBindings {
			if binding.HasEmpoweredAttack && int(binding.EmpoweredAbilityIndex) == index {
				ctx.collector.addError(model.GenericErrUnknownRef, hit.RuleGroups[0].Path, "ruleGroups only support SKILL_HIT, not empowered basic-attack payloads", ability.AbilityKey)
			}
		}
		for _, group := range hit.RuleGroups {
			if group.CandidateStart < 0 || group.CandidateStart+group.CandidateCount > len(hit.Candidates) {
				continue
			}
			first := hit.Candidates[group.CandidateStart]
			for _, other := range hit.Candidates[group.CandidateStart : group.CandidateStart+group.CandidateCount] {
				if !sameRuleGroupPredicate(first, other, ctx) {
					ctx.collector.addError(model.GenericErrUnknownRef, group.Path, "rule group actual condition provider bindings must agree", group.RuleKey)
				}
			}
		}
	}
}
