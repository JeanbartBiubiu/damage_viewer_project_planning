package execution

import (
	"math"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *Engine) targetMarkSummaryOutput() *model.TargetMarkSummary {
	if !s.compiled.HasTargetMarkConsumption {
		return nil
	}
	copy := s.report.TargetMarkSummary()
	return &copy
}

func (f *Frame) commitTargetMarkSummary() { f.run.report.AddTargetMark(f.pendingTargetMark) }

func (s *Engine) targetMarkListenerOwned(listener planbundle.CompiledListener, op planbundle.CompiledOperation) bool {
	m := op.TargetMark
	return s.compiled.HasTargetMarkConsumption && m != nil && listener.OperationCount == 1 && listener.SourceAbilityIndex >= 0 &&
		listener.OwnerCombatantKey == m.OwnerCombatantKey && listener.OwnerProviderRef == m.OwnerProviderRef && !listener.HasAbilityRef && !listener.HasOncePerUse && listener.PerCastThrottleMs == 0
}

func (s *Engine) targetMarkProviderPlanned(provider string) bool {
	for _, source := range s.plannedSkillSources() {
		if source.Binding().Source == model.SelectorSource && source.Binding().ProviderRef == provider {
			return true
		}
	}
	return false
}

func (s *Engine) initTargetMarkSources() *model.EngineError {
	if !s.compiled.HasTargetMarkConsumption {
		return nil
	}
	for _, op := range s.compiled.Operations {
		m := op.TargetMark
		if m == nil {
			continue
		}
		fail := func(message string) *model.EngineError { return s.basicAttackErr(message, op.Path) }
		if s.loop.StartMs() != 0 || m.OwnerCombatantKey != model.SelectorSource || !s.targetMarkProviderPlanned(m.OwnerProviderRef) {
			return fail("target mark requires a fresh zero-time scene and its actual planned parent")
		}
		if m.TriggerKind == model.EventTypeBasicAttackHit {
			if s.actions.BasicAttack() == nil || s.actions.BasicAttack().Plan().HitAbilityRef != m.TriggerAbilityRef || s.actions.BasicAttack().Plan().Source != m.OwnerCombatantKey {
				return fail("target mark attack trigger is not the actual selected native hit")
			}
		} else {
			parsed, valid := planbundle.ParseAbilityRef(m.TriggerAbilityRef)
			if !valid || !s.targetMarkProviderPlanned(parsed.ProviderRef) {
				return fail("target mark skill trigger is not driven by its real INITIAL source")
			}
		}
		owner, exists := s.combatants[m.OwnerCombatantKey]
		if !exists {
			return fail("target mark owner is missing")
		}
		if bag := owner.providerState.Lookup(m.OwnerProviderRef); bag.Present() {
			if bag.TargetValues().At(m.StateKey) != 0 || bag.TargetExpireAt().At(m.StateKey) != 0 {
				return fail("target mark cannot restore an external active target field")
			}
		}
		if m.Restore != nil {
			slot, exists := owner.resourceView().Lookup(m.Restore.ResourceKey)
			if !exists || math.IsNaN(slot.Current) || math.IsInf(slot.Current, 0) || math.IsNaN(slot.Max) || math.IsInf(slot.Max, 0) || slot.Max <= 0 || slot.Current < 0 || slot.Current > slot.Max {
				return fail("target mark restore requires an explicit finite current and positive resource capacity")
			}
		}
	}
	return nil
}

func (f *Frame) targetMarkContact(abilityRef, kind string) (*frozenSkillHitContext, *model.EngineError) {
	fail := func(message string) (*frozenSkillHitContext, *model.EngineError) {
		return nil, f.run.basicAttackErr(message, f.abilityRef)
	}
	if !f.run.compiled.HasTargetMarkConsumption || !f.mountedListener || f.castInstanceID == 0 || f.eventCtx == nil || f.eventCtx.eventType != kind || f.eventCtx.skillHit == nil || !f.eventCtx.hasUse {
		return fail("target mark requires its native mounted listener contact")
	}
	contact := f.eventCtx.skillHit
	use := f.run.skillUses[contact.useRef]
	if contact.plan == nil || !contact.rootDamageEvent || contact.occurrenceID == 0 || contact.abilityRef != abilityRef || contact.sourceKey != f.sourceKey || contact.sourceKey != f.ownerCombatantKey || contact.targetKey != f.targetKey || use == nil ||
		use.identity.Source() != contact.sourceKey || use.identity.SkillKey() != contact.skillKey || f.eventCtx.useKey != contact.useRef || f.eventCtx.useSource != use.identity.Source() || f.eventCtx.useSkillKey != use.identity.SkillKey() {
		return fail("target mark native contact/use/ability/target identity mismatch")
	}
	if kind == model.EventTypeBasicAttackHit {
		b := f.run.actions.BasicAttack()
		if b == nil || b.Current() == nil || b.Current().UseRef() != contact.useRef || b.Current().HitAtMs() == nil || *b.Current().HitAtMs() != f.run.loop.TimeMs() || b.Plan().HitAbilityRef != abilityRef || !contact.ability.IsBasicAttack {
			return fail("target mark requires the current selected attack's completed hit")
		}
	} else {
		action := f.run.skillActionForUse(contact.useRef)
		found := false
		if action != nil {
			for _, hit := range action.Binding().HitBindings {
				found = found || hit.HitAbilityRef == abilityRef
			}
		}
		if action == nil || !found || contact.ability.IsBasicAttack {
			return fail("target mark requires a real INITIAL process hit, not an external use fact")
		}
	}
	return contact, nil
}

func (f *Frame) validateTargetMarkWriter(op planbundle.CompiledOperation) *model.EngineError {
	contact, err := f.targetMarkContact(op.TargetMarkWriterRef, model.EventTypeSkillHit)
	if err != nil {
		return err
	}
	if contact.blocked != 0 || op.OwnerProviderIndex < 0 || op.OwnerProviderIndex >= len(f.run.compiled.Providers) || contact.skillKey != f.run.compiled.Providers[op.OwnerProviderIndex].SkillKey {
		return f.run.basicAttackErr("mark SET1 requires its own unblocked INITIAL contact", op.Path)
	}
	return nil
}

func (f *Frame) consumeTargetMark(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	m := op.TargetMark
	fail := func(message string) *model.EngineError { return f.run.basicAttackErr(message, op.Path) }
	if m == nil || m.Clear == nil || m.Damage == nil || op.Target != "target" || f.ownerProviderRef != m.OwnerProviderRef || f.providerOwnerKey() != m.OwnerCombatantKey || int(ability.ProviderIndex) != op.OwnerProviderIndex || ability.Kind != "passive_listener" {
		return fail("target mark requires its actual complete owner listener payload")
	}
	contact, err := f.targetMarkContact(m.TriggerAbilityRef, m.TriggerKind)
	if err != nil {
		return err
	}
	if m.TriggerKind == model.EventTypeSkillHit && contact.blocked == 1 {
		return nil
	}
	bag := f.providerStateBagForRead(m.OwnerCombatantKey, m.OwnerProviderRef, false, effectpkg.ReadOptions{})
	if !bag.Present() || bag.TargetKey() != f.targetKey || bag.TargetValues().At(m.StateKey) == 0 {
		return nil
	}
	value, deadline := bag.TargetValues().At(m.StateKey), bag.TargetExpireAt().At(m.StateKey)
	if value != 1 || deadline <= 0 {
		return fail("active target mark requires the exact value 1 and a real deadline")
	}
	if deadline <= f.run.loop.TimeMs() {
		return nil
	}
	amount, err := f.evalAmount(m.Damage.AmountProgram, ability)
	if err != nil {
		return err
	}
	if amount < 0 {
		return fail("target mark damage amount must be nonnegative")
	}
	shields := f.activeSpellShields(f.targetKey)
	if shields.Len() > 1 {
		return fail("multiple active spell_shield instances have no nominated priority")
	}
	if err := f.bumpCommandBudget(); err != nil {
		return err
	}
	if err := f.applyStateChange(*m.Clear, ability); err != nil {
		return err
	}
	var damageID interface{}
	blocked := shields.Len() == 1
	if blocked {
		shield := shields.At(0)
		local := *contact
		local.unitScope, local.skillKey, local.abilityRef, local.ability = model.SpellShieldScopeDamageInstance, ability.SkillKey, f.abilityRef, ability
		local.candidateKey, local.effectOccurrenceKey, local.resultKey = op.Ref, op.Ref, m.Damage.Ref
		local.blocked, local.reusedSkillUnit = 1, false
		local.shieldOwner, local.shieldProviderRef, local.shieldDefinitionRef, local.shieldSource = shield.Owner, shield.ProviderRef, shield.DefinitionRef, shield.Source
		snapshot := f.captureEmitSnapshot(model.EventTypeSpellShieldBlocked, f.sourceKey, f.targetKey)
		snapshot.hasSkillHit, snapshot.skillHit = true, &local
		f.pendingEvents = append(f.pendingEvents, emittedEvent{eventType: model.EventTypeSpellShieldBlocked, ref: model.EventTypeSpellShieldBlocked, sourceKey: f.sourceKey, targetKey: f.targetKey, types: []string{model.EventTypeSpellShieldBlocked}, snapshot: snapshot,
			castInstanceID: f.castInstanceID, castOrigin: f.castOrigin, skillHit: &local, hasUse: true, useKey: contact.useRef, useSource: contact.sourceKey, useSkillKey: contact.skillKey})
		f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
			return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: model.EventTypeSpellShieldBlocked, Data: skillHitEvidenceData(&local)}
		})
	} else {
		if err := f.bumpCommandBudget(); err != nil {
			return err
		}
		before := len(f.pendingDamage)
		cmd := command.Command{Kind: command.KindDamage, Source: f.sourceKey, Target: f.targetKey, Amount: amount, DamageType: m.Damage.DamageType}
		if err := f.applyDamageCommand(cmd, *m.Damage, frozenCritEvidence{}, ability, nil); err != nil {
			return err
		}
		if len(f.pendingDamage) != before+1 {
			return fail("target mark damage did not create one real settlement")
		}
		if id := f.pendingDamage[before].damageID; id != 0 {
			damageID = id
		}
	}
	if m.Restore != nil {
		if err := f.bumpCommandBudget(); err != nil {
			return err
		}
		restore, err := f.evalAmount(m.Restore.AmountProgram, ability)
		if err != nil {
			return err
		}
		if restore < 0 {
			return fail("target mark restore amount must be nonnegative")
		}
		if err := f.applyResourceOperation(f.ownerCombatantKey, restore, *m.Restore, ability); err != nil {
			return err
		}
	}
	f.pendingTargetMark.ConsumedCount++
	if m.TriggerKind == model.EventTypeBasicAttackHit {
		f.pendingTargetMark.AttackCount++
	} else {
		f.pendingTargetMark.SkillCount++
	}
	if blocked {
		f.pendingTargetMark.DamageBlockedCount++
	}
	f.recordEvidenceLazy("target_mark_consumed", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: "target_mark_consumed", Ref: op.Ref, Path: op.Path, Data: map[string]interface{}{
			"owner": m.OwnerCombatantKey, "providerRef": m.OwnerProviderRef, "definitionRef": f.run.compiled.Providers[op.OwnerProviderIndex].ProviderKey, "stateKey": m.StateKey, "target": f.targetKey,
			"triggerKind": m.TriggerKind, "triggerAbilityRef": m.TriggerAbilityRef, "useRef": contact.useRef, "useSource": contact.sourceKey, "useSkillKey": contact.skillKey, "castInstanceId": f.castInstanceID,
			"stateBefore": float64(1), "stateAfter": float64(0), "deadlineBefore": deadline, "damageBlocked": blocked, "damageId": damageID}}
	})
	return nil
}
