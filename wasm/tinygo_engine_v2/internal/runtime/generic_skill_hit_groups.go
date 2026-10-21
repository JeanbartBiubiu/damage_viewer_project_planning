package runtime

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// The shield consumption set also keeps blocked candidates whose predicate is
// false. Freeze the actual common predicate separately, before any rule writes.
func (f *executionFrame) freezeSkillHitRuleGroups(selected []int, freeze *frozenSkillHitContext) *model.EngineError {
	freeze.matchedRuleGroups = make([]bool, len(freeze.plan.RuleGroups))
	for _, index := range selected {
		candidate := freeze.plan.Candidates[index]
		gi := candidate.RuleGroupIndex
		if gi < 0 {
			continue
		}
		if gi >= len(freeze.plan.RuleGroups) {
			return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "candidate rule group index is invalid", candidate.Path, candidate.CandidateKey)
		}
		if freeze.plan.RuleGroups[gi].CandidateStart != index {
			continue
		}
		matches, err := f.matchEventValueConds(candidate, freeze.hasFirstContact, freeze.firstContact, true, freeze.blocked, true)
		if err != nil {
			return err
		}
		freeze.matchedRuleGroups[gi] = matches
	}
	return nil
}

func (s *genericRunState) skillHitRuleQuota(ev emittedEvent, freeze *frozenSkillHitContext, group planbundle.CompiledSkillHitRuleGroup) (planbundle.CompiledListener, *model.EngineError) {
	bad := func(message string) (planbundle.CompiledListener, *model.EngineError) {
		return planbundle.CompiledListener{}, s.skillHitErr(model.GenericErrUnknownRef, message, group.Path, group.RuleKey)
	}
	ref, found := s.compiled.AbilityRefIndex[freeze.abilityRef]
	parsed, parsedOK := planbundle.ParseAbilityRef(freeze.abilityRef)
	if ev.eventType != model.EventTypeSkillHit || freeze.ability.IsBasicAttack || !found || !parsedOK || int(ref.CombatantIndex) >= len(s.compiled.Combatants) || int(ref.AbilityIndex) >= len(s.compiled.Abilities) {
		return bad("rule group requires its actual engine-produced SKILL_HIT and parent ability")
	}
	actor := s.compiled.Combatants[ref.CombatantIndex]
	if actor.Key != freeze.sourceKey || parsed.Combatant != actor.Key {
		return bad("rule group parent must belong to the actual hit source")
	}
	ability := s.compiled.Abilities[ref.AbilityIndex]
	mounted := false
	for _, mount := range actor.ProviderMounts {
		if mount.ProviderRef == parsed.ProviderRef && mount.DefinitionIndex == ref.ProviderIndex {
			mounted = true
			break
		}
	}
	// ProviderIndex identifies the definition, not the mount slot. Two mounts of
	// one definition remain separate quota owners through their actual ref.
	if !mounted || int(ref.ProviderIndex) != freeze.plan.OwnerProviderIndex || ref.ProviderIndex != freeze.ability.ProviderIndex || ability.ProviderIndex != ref.ProviderIndex || parsed.AbilityKey != ability.AbilityKey || !ability.HasSkillHit || ability.OperationCount != 1 || int(ability.OperationStart) >= len(s.compiled.Operations) || s.compiled.Operations[ability.OperationStart].SkillHit != freeze.plan || !s.skillHitGroupMountLive(actor.Key, parsed.ProviderRef, ref.ProviderIndex) {
		return bad("rule group requires its complete original static parent mount")
	}
	parent := s.compiled.Providers[ref.ProviderIndex]
	if parent.Kind == "status" || parent.Lifecycle != nil {
		return bad("rule group parent must be static")
	}
	use, known := s.skillUses[freeze.useRef]
	if !ev.hasUse || freeze.useRef == "" || ev.useKey != freeze.useRef || ev.useSource != actor.Key || ev.useSkillKey != freeze.skillKey || !known || use.source != actor.Key || use.skillKey != freeze.skillKey {
		return bad("rule group requires its actual declared originating skill use")
	}
	return planbundle.CompiledListener{ListenerKey: group.RuleKey, OwnerCombatantKey: actor.Key, OwnerProviderRef: parsed.ProviderRef,
		HasOncePerUse: true, OncePerUseGroup: group.OncePerUseGroup, OncePerUseScope: group.OncePerUseScope}, nil
}

func (s *genericRunState) executeSkillHitRuleGroup(ev emittedEvent, freeze *frozenSkillHitContext, group planbundle.CompiledSkillHitRuleGroup, chainDepth int) *model.EngineError {
	if group.CandidateStart < 0 || group.CandidateCount <= 0 || group.CandidateStart > len(freeze.plan.Candidates)-group.CandidateCount {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "rule group candidate range is invalid", group.Path, group.RuleKey)
	}
	quota, err := s.skillHitRuleQuota(ev, freeze, group)
	if err != nil {
		return err
	}
	reserved, skip, err := s.reserveOncePerUse(quota, ev)
	if err != nil || skip {
		return err
	}
	if !reserved {
		return s.skillHitErr(model.GenericErrRuntimeInvariantFailed, "matched rule group did not reserve its quota", group.Path, group.RuleKey)
	}
	reservation := pendingUseReservation{listener: quota, event: ev}
	defer s.releaseUncommittedUseReservation(&reservation)
	collector := eventCopyableCollector{reservation: &reservation}
	var frameStorage executionFrame
	s.initSkillHitCandidateFrame(&frameStorage, ev, freeze, chainDepth)
	frame := &frameStorage
	frame.ownerCombatantKey, frame.ownerProviderRef = quota.OwnerCombatantKey, quota.OwnerProviderRef
	frame.strictReads = true
	frame.copyableCollector = &collector
	for _, candidate := range freeze.plan.Candidates[group.CandidateStart : group.CandidateStart+group.CandidateCount] {
		skipWrites := freeze.blocked == 1 && candidate.HasBlockScope && model.ScopeCovers(freeze.unitScope, freeze.occurrenceID, freeze.effectOccurrenceKey, freeze.resultKey, freeze.candidateKey, freeze.useRef, candidate.BlockScope, freeze.occurrenceID, candidate.EffectOccurrenceKey, candidate.ResultKey, candidate.CandidateKey, freeze.useRef)
		ops, err := s.skillHitCandidateOperations(freeze, candidate, skipWrites)
		if err != nil {
			return err
		}
		// Compilation isolates each output unit. Do not let a previous candidate's
		// exported damage output become readable merely because commits are shared.
		frame.operationOutputs = nil
		frame.skipBlockedWrites, frame.skillHitCandidateKey = skipWrites, candidate.CandidateKey
		if err := frame.executeOperations(freeze.ability, ops); err != nil {
			return err
		}
		// Stage each original candidate's damage event in the shared outbox. It is
		// dispatched only after the whole rule and its reservation have committed.
		frame.maybeQueueDamageDealtEvent(freeze.ability)
		frame.damageAggregation = frameDamageAggregation{}
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	return frame.dispatchPendingEvents()
}

// A static definition alone is insufficient: the actual original mount must
// still be owned and sourced by this actor. Reuse the existing small list.
func (s *genericRunState) skillHitGroupMountLive(owner, provider string, definition uint16) bool {
	if int(definition) >= len(s.compiled.Providers) {
		return false
	}
	actor, found := s.combatants[owner]
	if !found {
		return false
	}
	found = false
	for _, instance := range actor.providers {
		if instance.ProviderRef == provider {
			if found || instance.Owner != owner || instance.Source != owner || instance.DefinitionIndex != definition || instance.DefinitionRef != s.compiled.Providers[definition].ProviderKey || instance.ExpireAt != 0 {
				return false
			}
			found = true
		}
	}
	return found
}
