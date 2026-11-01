package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"math"
	"strconv"
	"tinygo_engine_v2/internal/runtime/execution/hit"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type primaryReplacementSlot struct {
	binding uint16
	target  string
	index   int
}

func (s *Engine) bindBasicAttackPrimary(hit planbundle.CompiledAbility, provider string) *model.EngineError {
	b := s.actions.BasicAttack()
	hitPlan := s.compiled.Operations[hit.OperationStart].SkillHit
	if hitPlan == nil {
		return s.basicAttackErr("native hit requires its complete hit plan", "driverPlan.basicAttack")
	}
	if hitPlan.PrimaryCandidate < 0 {
		for _, binding := range s.compiled.SkillActionBindings {
			if binding.ReplacesPrimary && s.plannedSkillProvider(binding.Source, binding.ProviderRef) {
				return s.basicAttackErr("primary replacement requires one explicitly marked native primary", "driverPlan.basicAttack.hitAbilityRef")
			}
		}
		return nil
	}
	index := hitPlan.PrimaryCandidate
	if index >= len(hitPlan.Candidates) || hitPlan.Candidates[index].AttackDamageRole != planbundle.AttackDamageRolePrimary {
		return s.basicAttackErr("invalid compiled primary binding", "driverPlan.basicAttack.hitAbilityRef")
	}
	c := hitPlan.Candidates[index]

	s.actions.BindPrimary(index, hitPlan, model.BasicAttackPrimaryIdentity{Owner: b.Plan().Source, ProviderRef: provider,
		DefinitionRef: s.compiled.Providers[hit.ProviderIndex].ProviderKey, StartAbilityRef: b.Plan().StartAbilityRef,
		InitialControlAbilityRef: b.Plan().InitialControlAbilityRef, HitAbilityRef: b.Plan().HitAbilityRef,
		CandidateKey: c.CandidateKey, EffectOccurrenceKey: c.EffectOccurrenceKey, EffectKey: c.EffectKey, ResultKey: c.ResultKey})
	return nil
}

func (s *Engine) executePrimaryReplacement(ev emittedEvent, freeze *frozenSkillHitContext, candidate int, depth int) (bool, *model.EngineError) {
	var chosen *empoweredWaitFreeze
	for index := range freeze.empoweredWaits {
		wait := &freeze.empoweredWaits[index]
		if !wait.instance.ReplacesPrimary() || !s.empoweredWaitCurrent(*wait, ev.sourceKey) {
			continue
		}
		if chosen != nil {
			return false, s.basicAttackErr("multiple live primary replacements have no nominated priority", "skillActions")
		}
		chosen = wait
	}
	if chosen == nil {
		return false, nil
	}
	b := s.actions.BasicAttack()
	if b == nil || b.Primary() == nil || b.PrimaryHitPlan() != freeze.plan || b.PrimaryCandidate() != candidate || ev.eventType != model.EventTypeBasicAttackHit || !freeze.ability.IsBasicAttack || freeze.abilityRef != b.Plan().HitAbilityRef || freeze.sourceKey != b.Plan().Source || freeze.targetKey != b.Plan().Target || ev.sourceKey != b.Plan().Source || ev.targetKey != b.Plan().Target || freeze.skillKey != b.Plan().SkillKey || freeze.useRef == "" || !s.processMounted(ev.sourceKey, b.Primary().ProviderRef, freeze.ability.ProviderIndex) {
		return false, s.basicAttackErr("primary replacement requires the actual complete native attack binding", "driverPlan.basicAttack")
	}
	original := chosen.instance
	use := s.skillUses[original.UseKey()]
	if use == nil || use.identity.Source() != original.Owner() || use.identity.SkillKey() != original.SkillKey() || use.identity.HistoryState() != model.SkillHitHistoryComplete || use.history.TotalCount() >= hit.MaxHistoryContacts {
		return false, s.processErr("skillUses", "primary replacement requires its real complete activation history", original.UseKey())
	}
	changes := actionpkg.StageProcess(original)
	p := changes.View()
	payload := s.compiled.Abilities[p.EmpoweredAbilityIndex()]
	association := &model.ProcessEmpoweredAttack{UseRef: freeze.useRef, HitRef: "hit:" + strconv.FormatUint(freeze.occurrenceID, 10), Target: ev.targetKey, ReplacedPrimary: b.Primary()}
	changes.SetEmpoweredAttack(association)
	var storage Frame
	s.initExecutionFrame(&storage, ev.sourceKey, ev.targetKey, freeze.abilityRef)
	f := &storage
	f.empowered, f.chainDepth, f.strictReads = &empoweredFrame{}, depth, true
	err := f.withEmpoweredContext(changes, ev.targetKey, p.Ability(), association, func() *model.EngineError {
		if err := s.applyProcessMoment(p, f, "STEP_EXECUTION", ""); err != nil {
			return err
		}
		beforeDamage := len(f.pendingDamage)
		if err := f.executeEmpoweredPayload(ev, p, payload); err != nil {
			return err
		}
		if err := f.stagePrimaryReplacement(p, payload, association, beforeDamage); err != nil {
			return err
		}
		if err := s.applyProcessMoment(p, f, "STEP_COMPLETE", ""); err != nil {
			return err
		}
		changes.Finish("complete", "", s.loop.TimeMs())
		return s.applyProcessMoment(p, f, "PROCESS_COMPLETE", "")
	})
	if err != nil {
		return false, err
	}
	f.empowered.mutations = append(f.empowered.mutations, empoweredProcessMutation{original, changes})
	f.empowered.contacts = append(f.empowered.contacts, empoweredContact{p, *association})
	f.empowered.finished = append(f.empowered.finished, p)
	// Only the actual payload inherits this root candidate's event qualification.
	// Completion operations and shield listeners ran above without that flag.
	if err := f.withEmpoweredContext(changes, ev.targetKey, payload, association, func() *model.EngineError {
		f.eventCtx = cloneEventSnapshot(&ev.snapshot)
		f.eventCtx.hasUse, f.eventCtx.useKey, f.eventCtx.useSource, f.eventCtx.useSkillKey = true, p.UseKey(), p.Owner(), p.SkillKey()
		f.rootSkillHitDamage = freeze.rootDamageEvent
		f.maybeQueueDamageDealtEvent(freeze.ability)
		f.rootSkillHitDamage = false
		return nil
	}); err != nil {
		return false, err
	}
	f.pendingProcess = nil
	f.commit()
	if f.fatal {
		return false, f.fatalErr
	}
	if err := f.dispatchPendingEvents(); err != nil {
		return true, err
	}
	resolved := p.WithTarget(ev.targetKey)
	if err := s.publishProcessResolved(resolved); err != nil {
		return true, err
	}
	return true, s.processFailure
}

func (f *Frame) stagePrimaryReplacement(p *actionpkg.ProcessView, payload planbundle.CompiledAbility, association *model.ProcessEmpoweredAttack, start int) *model.EngineError {
	row := &model.BasicAttackPrimaryReplacement{Primary: *association.ReplacedPrimary,
		Replacement: model.BasicAttackReplacementIdentity{Owner: p.Owner(), ProviderRef: p.ProviderRef(),
			DefinitionRef: f.run.compiled.Providers[payload.ProviderIndex].ProviderKey, SkillKey: p.SkillKey(), ProcessKey: p.ProcessKey(),
			HitAbilityRef: p.Owner() + ".provider[" + p.ProviderRef() + "].ability[" + payload.AbilityKey + "]"}, Target: association.Target, Count: 1}
	if f.empowered.primaryBlocked {
		row.BlockedCount = 1
	}
	for _, damage := range f.pendingDamage[start:] {
		if damage.empoweredAttack != association || damage.abilityRef != row.Replacement.HitAbilityRef || damage.outcome == nil {
			continue
		}
		row.PostDefenseDamage += damage.outcome.MitigatedAmount
		row.ShieldAbsorbed += damage.outcome.ShieldAbsorbed
		row.ActualHpLoss += damage.outcome.HPDamage
	}
	if previous, exists := f.run.actions.BasicAttack().Replacement(p.PrimaryReplacementBinding(), row.Target); exists {
		for _, value := range []float64{previous.PostDefenseDamage + row.PostDefenseDamage, previous.ShieldAbsorbed + row.ShieldAbsorbed, previous.ActualHpLoss + row.ActualHpLoss} {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return f.run.basicAttackErr("primary replacement aggregate must remain finite", "basicAttack.primaryReplacements")
			}
		}
	}
	f.empowered.primaryReplacement, f.empowered.primaryReplacementBinding = row, p.PrimaryReplacementBinding()
	return nil
}

func (s *Engine) commitPrimaryReplacement(row model.BasicAttackPrimaryReplacement, binding uint16) {
	s.actions.CommitPrimaryReplacement(row, binding)
}
