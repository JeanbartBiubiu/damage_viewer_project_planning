package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

// This admission is confined to one actual skill hit. Null scope does not
// establish a block unit, so its first non-null candidate must be a stable
// whole-skill damage witness before the healing modifier can be accepted.
func validateSkillHitHealingCandidates(ability model.AbilityDefinition, entry model.OperationDefinition, hit *plan.CompiledSkillHit, ctx *genericCompileContext) {
	firstScope := -1
	for i, candidate := range entry.SkillHit.Candidates {
		if candidate.SpellShieldBlockScope != nil && *candidate.SpellShieldBlockScope != "" {
			firstScope = i
			break
		}
	}
	for i, candidate := range entry.SkillHit.Candidates {
		if candidate.Semantic.ResultType != model.SkillHitResultHealingModifier {
			continue
		}
		fail := func(message string) {
			ctx.collector.addError(model.GenericErrUnknownRef, hit.Candidates[i].Path, message, candidate.CandidateKey)
		}
		plainEntry := entry
		plainEntry.Operation, plainEntry.Target, plainEntry.SkillHit = "", "", nil
		if ctx.compilingBasicAttack || abilityIsBasicAttack(ability, ctx) || !emptyHealingHitOperation(plainEntry) {
			fail("finite healing hit requires a plain non-basic resolve_skill_hit entry")
		}
		if candidate.Semantic != (model.SkillHitSemantic{ResultType: model.SkillHitResultHealingModifier, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentPersistent}) || candidate.SpellShieldBlockScope != nil || !stableHealingHitParticipation(hit.Candidates[i], ctx) || !healingHitBlockedZero(hit.Candidates[i], true, ctx) || hit.Candidates[i].RuleGroupIndex >= 0 || len(candidate.Operations) != 1 || !pureHealingHitApplication(candidate.Operations[0]) {
			fail("finite healing hit requires only blocked=0, no quota or mutable participation, and one plain TARGET provider application")
		}
		if firstScope < 0 || firstScope >= i || !healingHitDamageWitness(entry.SkillHit.Candidates[firstScope], hit.Candidates[firstScope], ctx) {
			fail("finite healing hit requires its first stable non-null candidate to be an earlier unconditional SKILL target damage witness")
		}
	}
}

func stableHealingHitParticipation(candidate plan.CompiledSkillHitCandidate, ctx *genericCompileContext) bool {
	if candidate.ParticipationProviderRef != "" || candidate.ParticipationProviderRefs != ([2]string{}) {
		return false
	}
	if !candidate.HasParticipation {
		return true
	}
	value, fixed := ctx.session.Formulas.FoldStatic(candidate.ParticipationProgram)
	return fixed && value == 1
}

func healingHitBlockedZero(candidate plan.CompiledSkillHitCandidate, required bool, ctx *genericCompileContext) bool {
	if len(candidate.EventValueConds) == 0 {
		return !required
	}
	if len(candidate.EventValueConds) != 1 {
		return false
	}
	condition := candidate.EventValueConds[0]
	value, fixed := ctx.session.Formulas.FoldStatic(condition.ValueProg)
	return condition.Key == model.SkillHitValueBlocked && condition.Comparator == "eq" && condition.HasValue && fixed && value == 0
}

func healingHitDamageWitness(raw model.SkillHitCandidate, compiled plan.CompiledSkillHitCandidate, ctx *genericCompileContext) bool {
	if raw.Semantic != (model.SkillHitSemantic{ResultType: model.SkillHitResultDamage, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentInstant}) || raw.SpellShieldBlockScope == nil || *raw.SpellShieldBlockScope != model.SpellShieldScopeSkill || raw.AttackDamageRole != "" || compiled.RuleGroupIndex >= 0 || !stableHealingHitParticipation(compiled, ctx) || !healingHitBlockedZero(compiled, false, ctx) || len(raw.Operations) != 1 {
		return false
	}
	op := raw.Operations[0]
	if op.Operation != "damage" || op.Target != model.SelectorTarget || op.Amount == nil || strings.TrimSpace(op.DamageType) == "" {
		return false
	}
	// Actual damage amount, crit/vamp and record metadata keep their existing
	// validators. No condition, repeated action, nested payload or other command
	// is permitted to hide behind the witness.
	op.Operation, op.Target, op.Amount, op.DamageType = "", "", nil, ""
	op.Types, op.Tags, op.Ref, op.OutputRef = nil, nil, "", ""
	op.CritEligible, op.CritChance, op.CritMultiplier, op.CritMultiplierMin = false, nil, nil, nil
	op.VampQualification, op.VampOverrides = "", nil
	return emptyHealingHitOperation(op)
}

func pureHealingHitApplication(op model.OperationDefinition) bool {
	if op.Operation != "apply_provider" || op.Target != model.SelectorTarget || strings.TrimSpace(op.ProviderDefinitionRef) == "" {
		return false
	}
	// Ref is the real author path installed by production assembly. It is record
	// provenance only; OutputRef and every executable auxiliary field stay closed.
	op.Operation, op.Target, op.ProviderDefinitionRef, op.Ref = "", "", "", ""
	return emptyHealingHitOperation(op)
}

// Check the complete public operation shape rather than only fields retained
// by CompiledOperation; ignored payload/metadata cannot turn into admission.
func emptyHealingHitOperation(op model.OperationDefinition) bool {
	return op.TargetMark == nil && op.Operation == "" && op.Target == "" && op.Amount == nil && op.ValuePolicy == "" && op.DamageType == "" && op.ResourceKey == "" && op.AttributeKey == "" && op.AbilityRef == "" && op.ShieldRef == "" && op.ShieldLifecycleProviderDefinitionRef == "" && op.ProviderDefinitionRef == "" && op.ProviderRef == "" && op.EventType == "" && len(op.Payload) == 0 && len(op.Types) == 0 && len(op.Tags) == 0 && op.Ref == "" && op.Condition == nil && !op.CopyableOnHit && !op.CritEligible && op.CritChance == nil && op.CritMultiplier == nil && op.CritMultiplierMin == nil && op.VampQualification == "" && len(op.VampOverrides) == 0 && op.RepeatScope == "" && op.RepeatCount == 0 && op.RepeatTag == "" && op.RepeatDelayMs == 0 && op.TriggerStateKey == "" && op.Threshold == 0 && op.SkillHit == nil && !op.ProviderRefFromEvent && op.OutputRef == "" && op.ShieldDurationMs == nil
}

// Final definitions, mounts and INITIAL bindings exist only after all provider
// abilities/processes and the selected bindings have been compiled.
func finalizeSkillHitHealingModifiers(req model.CompileRequest, ctx *genericCompileContext) {
	for _, parent := range req.SharedProviders {
		owner, found := ctx.providerKeyIndex[parent.ProviderKey]
		if !found {
			continue
		}
		for _, authored := range parent.Abilities {
			entry, only := uniqueResolveSkillHit(authored.Operations)
			if !only || entry.SkillHit == nil {
				continue
			}
			abilityIndex, found := ctx.providerAbilityIndex[owner][authored.AbilityKey]
			if !found || int(abilityIndex) >= len(ctx.session.Abilities) {
				continue
			}
			ability := ctx.session.Abilities[abilityIndex]
			if !ability.HasSkillHit || int(ability.OperationStart) >= len(ctx.session.Operations) {
				continue
			}
			hit := ctx.session.Operations[ability.OperationStart].SkillHit
			if hit == nil {
				continue
			}
			for i, candidate := range entry.SkillHit.Candidates {
				if candidate.Semantic.ResultType != model.SkillHitResultHealingModifier {
					continue
				}
				path := hit.Candidates[i].Path
				if !healingHitHasOriginalBinding(abilityIndex, parent, hit, ctx) {
					ctx.collector.addError(model.GenericErrUnknownRef, path, "finite healing hit requires its original mounted same-skill non-empowered INITIAL target binding", authored.AbilityKey)
				}
				if len(candidate.Operations) != 1 || !pureFiniteHealingHitProvider(candidate.Operations[0].ProviderDefinitionRef, hit.SkillKey, req, ctx) {
					ctx.collector.addError(model.GenericErrUnknownRef, path+".operations", "finite healing hit requires one complete same-skill finite source_target status containing only a static RECEIVED/ANY ratio_max heal decrease", candidate.CandidateKey)
				}
			}
		}
	}
}

func healingHitHasOriginalBinding(index uint16, parent model.ProviderDefinition, hit *plan.CompiledSkillHit, ctx *genericCompileContext) bool {
	ability := ctx.session.Abilities[index]
	if parent.Kind == "status" || parent.Lifecycle != nil || parent.SkillKey == "" || parent.SkillKey != hit.SkillKey || ability.SkillKey != hit.SkillKey || ability.IsBasicAttack || hit.ReplacesPrimary || hit.PrimaryCandidate >= 0 {
		return false
	}
	mounts := 0
	for _, actor := range ctx.session.Combatants {
		for _, mount := range actor.ProviderMounts {
			if int(mount.DefinitionIndex) == hit.OwnerProviderIndex {
				if actor.Key != model.SelectorSource {
					return false
				}
				mounts++
			}
		}
	}
	if mounts != 1 {
		return false
	}
	for _, binding := range ctx.session.SkillActionBindings {
		if binding.HasEmpoweredAttack {
			if binding.EmpoweredAbilityIndex == index {
				return false
			}
			continue
		}
		if binding.Source != model.SelectorSource || binding.ProviderDefinitionRef != parent.ProviderKey || binding.SkillKey != hit.SkillKey {
			continue
		}
		for _, selected := range binding.HitBindings {
			actual, found := ctx.session.AbilityRefIndex[selected.HitAbilityRef]
			if found && actual.AbilityIndex == index && int(actual.ProviderIndex) == hit.OwnerProviderIndex {
				initial := ctx.session.Abilities[binding.InitialAbilityIndex]
				return initial.ProcessControl != nil && initial.ProcessControl.Action == "INITIAL" && (initial.ProcessControl.RequireExplicitSelfTarget == nil || !*initial.ProcessControl.RequireExplicitSelfTarget)
			}
		}
	}
	return false
}

func pureFiniteHealingHitProvider(reference, skill string, req model.CompileRequest, ctx *genericCompileContext) bool {
	index, found := ctx.providerKeyIndex[reference]
	if !found || int(index) >= len(ctx.session.Providers) {
		return false
	}
	var raw *model.ProviderDefinition
	for i := range req.SharedProviders {
		if req.SharedProviders[i].ProviderKey == reference {
			if raw != nil {
				return false
			}
			raw = &req.SharedProviders[i]
		}
	}
	if raw == nil || raw.Kind != "status" || raw.SkillKey != skill || len(raw.Types)+len(raw.Tags)+len(raw.Abilities)+len(raw.Listeners)+len(raw.Processes)+len(raw.StatusContributions)+len(raw.InitialStateSchema) != 0 || raw.LinkedShieldDefinitionRef != "" || len(raw.Modifiers) != 1 || raw.Lifecycle == nil || raw.Lifecycle.RefreshPolicy != model.RefreshPolicyReplace || raw.Lifecycle.InstanceScope != model.InstanceScopeSourceTarget {
		return false
	}
	provider := ctx.session.Providers[index]
	lc := provider.Lifecycle
	if !provider.TypeSet.Empty() || provider.AbilityCount != 0 || len(provider.Listeners)+len(provider.Processes)+len(provider.StateFields)+len(provider.StatusContributions) != 0 || provider.AmmoBinding != nil || provider.NeedsElapsedTime || provider.ShieldDefinitionRef != "" || lc == nil || !lc.HasDuration || lc.MaxStacks != 1 || lc.RefreshPolicy != model.RefreshPolicyReplace || lc.InstanceScope != model.InstanceScopeSourceTarget || lc.TickIntervalMs != 0 || len(provider.Modifiers) != 1 {
		return false
	}
	duration, fixed := ctx.session.Formulas.FoldStatic(lc.DurationProgram)
	if !fixed || !formula.ValidPositiveInt64DurationMs(duration) {
		return false
	}
	m := raw.Modifiers[0]
	if m.Kind != "pipeline" || m.Command != "heal" || m.Target != "" || m.HealDirection != model.HealReceived || m.HealCategory != model.HealAny || strings.TrimSpace(m.HealGroupKey) == "" || m.HealGroupCalculationMode != model.HealGroupRatioMax || m.ValuePolicy != "add_percent" || m.Condition != nil || m.Channel != "" || m.Stage != "" || m.Bucket != "" || m.Priority != 0 || m.CurrentValuePolicy != "" || m.AffectedAbilityRefs != nil || (m.ValueReadMode != "" && m.ValueReadMode != model.StatusValueReadApplicationSnapshot) {
		return false
	}
	modifier := provider.Modifiers[0]
	value, fixed := ctx.session.Formulas.FoldStatic(modifier.ValueProgram)
	return modifier.HasValue && !modifier.HasCondition && fixed && !math.IsNaN(value) && !math.IsInf(value, 0) && value >= -1 && value <= 0
}
