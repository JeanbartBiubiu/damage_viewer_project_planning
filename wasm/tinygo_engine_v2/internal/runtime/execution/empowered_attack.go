package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"strconv"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

const empoweredAttackStep = "EMPOWERED_BASIC_ATTACK"

type empoweredWaitFreeze struct {
	instance *actionpkg.ProcessView
	useKey   string
	version  int
	expires  int64
}

type empoweredProcessMutation struct {
	original *actionpkg.ProcessView
	changes  *actionpkg.ProcessChangeSet
}
type empoweredMoment struct {
	process *actionpkg.ProcessView
	kind    string
}
type empoweredContact struct {
	process *actionpkg.ProcessView
	attack  model.ProcessEmpoweredAttack
}
type empoweredStat struct {
	ref             string
	damage, healing float64
}
type empoweredShieldClaim struct{ owner, provider string }

// Only the new attached-result group uses these bounded journals. Old frames
// retain their existing process, listener and commit boundaries.
type empoweredFrame struct {
	reservations              []empoweredReservation
	mutations                 []empoweredProcessMutation
	moments                   []empoweredMoment
	finished                  []*actionpkg.ProcessView
	contacts                  []empoweredContact
	stats                     []empoweredStat
	shields                   []empoweredShieldClaim
	primaryReplacement        *model.BasicAttackPrimaryReplacement
	primaryReplacementBinding uint16
	primaryBlocked            bool
}

func (s *Engine) empoweredBinding(owner, provider, process string) (planbundle.CompiledSkillActionBinding, bool) {
	for _, binding := range s.compiled.SkillActionBindings {
		if binding.HasEmpoweredAttack && binding.Source == owner && binding.ProviderRef == provider && binding.Controls[0].ProcessKey == process {
			return binding, true
		}
	}
	return planbundle.CompiledSkillActionBinding{}, false
}

func (s *Engine) startEmpoweredProcess(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, replaced *actionpkg.ProcessView) *model.EngineError {
	if target != owner || s.actions.BasicAttack() == nil || s.actions.BasicAttack().Plan().Source != owner {
		return s.rejectProcess(entry, "empowered_attack_requires_own_native_attack")
	}
	if _, found := s.empoweredBinding(owner, provider, definition.ProcessKey); !found {
		return s.processErr(definition.Path, "empowered attack requires its complete compiled own result binding", use)
	}
	for empoweredSlot := 0; empoweredSlot < s.actions.EmpoweredCount(); empoweredSlot++ {
		current := s.actions.EmpoweredAt(empoweredSlot)
		if current.Owner() == owner && current.Status() == "active" && (definition.Steps[0].MaximumAttackCount > 0 || current.HasEmpoweredWindow()) {
			return s.rejectProcess(entry, "empowered_window_already_active")
		}
	}
	return s.startProcessReplacing(entry, entryIndex, owner, target, provider, ref, ability, definition, use, 0, nil, replaced)
}

func (s *Engine) updateEmpoweredWait(p *actionpkg.ProcessView) {
	s.actions.UpdateEmpoweredWait(p)
}

func (s *Engine) freezeEmpoweredWaits(owner string) []empoweredWaitFreeze {
	var out []empoweredWaitFreeze
	for empoweredSlot := 0; empoweredSlot < s.actions.EmpoweredCount(); empoweredSlot++ {
		p := s.actions.EmpoweredAt(empoweredSlot)
		if !p.HasEmpoweredWindow() && p.Owner() == owner && p.Status() == "active" && p.StepExecutionIndex() == 0 && p.HasExpiry() && s.loop.TimeMs() < p.Expiry() && s.processMounted(owner, p.ProviderRef(), p.Ability().ProviderIndex) {
			out = append(out, empoweredWaitFreeze{p, p.UseKey(), p.StepVersion(), p.Expiry()})
		}
	}
	return out
}

func (s *Engine) empoweredWaitCurrent(wait empoweredWaitFreeze, owner string) bool {
	p := wait.instance
	return p != nil && p.Owner() == owner && p.UseKey() == wait.useKey && p.StepVersion() == wait.version && p.Status() == "active" && p.StepExecutionIndex() == 0 && p.HasExpiry() && p.Expiry() == wait.expires && s.loop.TimeMs() < wait.expires && !s.actions.Dead(owner) && s.combatantHp(owner) > 0 && s.processMounted(owner, p.ProviderRef(), p.Ability().ProviderIndex)
}

func (s *Engine) stageEmpoweredEntry(f *Frame) *model.EngineError {
	p := f.pendingProcess
	step := p.Definition().Steps[0]
	value, err := f.evalAmount(step.WindowProgram, p.Ability())
	if err != nil {
		return err
	}
	deadline, valid := actionpkg.ProcessTimeAfter(s.loop.TimeMs(), value, false)
	if !valid || deadline > maxJSONSafeInteger {
		return s.processErr(step.Path+".windowMs", "empowered window requires a positive safe integer deadline", p.UseKey())
	}
	f.processChanges.EnterEmpowered(step, s.loop.TimeMs(), deadline)
	f.pendingProcessTimer = true
	return s.applyProcessMoment(p, f, "STEP_START", "")
}

// Context switching shares the combatant staging and all pending operations.
// It never invokes castAbilityAt or resolves a second physical hit.
func (f *Frame) withEmpoweredContext(changes *actionpkg.ProcessChangeSet, target string, ability planbundle.CompiledAbility, association *model.ProcessEmpoweredAttack, body func() *model.EngineError) *model.EngineError {
	p := changes.View()
	saved := *f
	f.pendingProcess, f.processChanges = p, changes
	f.sourceKey, f.targetKey = p.Owner(), target
	// Each payload keeps an entry snapshot from its actual execution boundary,
	// while all later writes remain in the one shared combatant staging.
	f.entrySourceAttrs, f.entryTargetAttrs = f.stageFor(p.Owner()).attributesView(), f.stageFor(target).attributesView()
	f.entrySourceResources, f.entryTargetResources = f.stageFor(p.Owner()).readonlyResources(), f.stageFor(target).readonlyResources()
	f.ownerCombatantKey, f.ownerProviderRef = p.Owner(), p.ProviderRef()
	f.abilityRef = p.Owner() + ".provider[" + p.ProviderRef() + "].ability[" + ability.AbilityKey + "]"
	f.processUseKey, f.processUseSource, f.processUseSkillKey = p.UseKey(), p.Owner(), p.SkillKey()
	f.processActualCosts = p.Costs()
	f.castInstanceID, f.castOrigin = p.CastID(), ability.CastOrigin
	f.empoweredAttack = association
	beforeDamage, beforeHealing := f.damageDealt, f.healingDone
	err := body()
	f.empowered.stats = append(f.empowered.stats, empoweredStat{f.abilityRef, f.damageDealt - beforeDamage, f.healingDone - beforeHealing})
	f.sourceKey, f.targetKey, f.ownerCombatantKey, f.ownerProviderRef = saved.sourceKey, saved.targetKey, saved.ownerCombatantKey, saved.ownerProviderRef
	f.abilityRef, f.processUseKey, f.processUseSource, f.processUseSkillKey = saved.abilityRef, saved.processUseKey, saved.processUseSource, saved.processUseSkillKey
	f.pendingProcess, f.processOriginal, f.processMomentKind, f.processChanges = saved.pendingProcess, saved.processOriginal, saved.processMomentKind, saved.processChanges
	f.processActualCosts, f.processCostReadable = saved.processActualCosts, saved.processCostReadable
	f.castInstanceID, f.castOrigin, f.empoweredAttack = saved.castInstanceID, saved.castOrigin, saved.empoweredAttack
	f.eventCtx, f.skillHitCandidateKey, f.skillHitOccurrenceID = saved.eventCtx, saved.skillHitCandidateKey, saved.skillHitOccurrenceID
	f.skipBlockedWrites, f.operationOutputs = saved.skipBlockedWrites, saved.operationOutputs
	f.entrySourceAttrs, f.entryTargetAttrs, f.entrySourceResources, f.entryTargetResources = saved.entrySourceAttrs, saved.entryTargetAttrs, saved.entrySourceResources, saved.entryTargetResources
	return err
}

func (s *Engine) stageEmpoweredFailure(f *Frame, original *actionpkg.ProcessView) *model.EngineError {
	changes := actionpkg.StageProcess(original)
	p := changes.View()
	reason := "EVENT_ABORTED"
	changes.Finish("failed", reason, s.loop.TimeMs())
	err := f.withEmpoweredContext(changes, p.Target(), p.Ability(), nil, func() *model.EngineError { return s.applyProcessMoment(p, f, "PROCESS_FAILURE", reason) })
	if err != nil {
		return err
	}
	f.empowered.mutations = append(f.empowered.mutations, empoweredProcessMutation{original, changes})
	f.empowered.finished = append(f.empowered.finished, p)
	return nil
}

func (f *Frame) commitEmpoweredProcesses() {
	for _, mutation := range f.empowered.mutations {
		mutation.changes.Publish(mutation.original)
		if mutation.original.HasEmpoweredWindow() {
			f.run.actions.ClearEmpoweredAttack(mutation.original)
		}
		f.run.updateEmpoweredWait(mutation.original)
	}
}

func (f *Frame) commitEmpoweredFacts() {
	s := f.run
	for _, reservation := range f.empowered.reservations {
		s.actions.ReserveUseEmpowerment(reservation.use.identity, reservation.process.Reference(), reservation.index)
	}
	if replacement := f.empowered.primaryReplacement; replacement != nil {
		s.commitPrimaryReplacement(*replacement, f.empowered.primaryReplacementBinding)
	}
	for _, moment := range f.empowered.moments {
		s.publishSkillActionMoment(moment.process, moment.kind)
	}
	for _, contact := range f.empowered.contacts {
		use := s.skillUses[contact.process.UseKey()]
		use.contacts = append(use.contacts, contact.attack.Target)
		if action := s.actions.ActionForUse(contact.process.UseKey()); action != nil {
			s.actions.RecordUse(action, "HIT")
			hit := contact.attack.HitRef
			s.recordSkillUse(contact.process, "HIT", &hit, nil)
		}
	}
	for _, p := range f.empowered.finished {
		s.publishSkillActionFinish(p)
	}
	for _, value := range f.empowered.stats {
		if value.damage == 0 && value.healing == 0 {
			continue
		}
		s.report.AbilityOutput(value.ref, value.damage, value.healing)
	}
	f.damageDealt, f.healingDone = 0, 0 // Per-ability amounts were published above.
}

func (f *Frame) empoweredShieldClaimed(owner, provider string) bool {
	for _, claim := range f.empowered.shields {
		if claim.owner == owner && claim.provider == provider {
			return true
		}
	}
	return false
}

// Selection uses the same staged view as earlier attached results; a shield
// already claimed by one result cannot be claimed again later in this group.
func (f *Frame) empoweredSpellShields(owner string) (effectpkg.ProviderList, *model.EngineError) {
	var out effectpkg.ProviderList
	staged := f.stageFor(owner)
	providers := staged.instances.Providers()
	if len(staged.providerOps) != 0 {
		providers = effectpkg.ProviderList{}.AppendList(providers)
	}
	for _, mutation := range staged.providerOps {
		// New mounts become live at this frame's commit, as for ordinary
		// multi-operation frames. Existing-instance expiry/refresh is visible
		// to later attached shield decisions; claimed instances are excluded.
		if mutation.kind != "expire" && mutation.kind != "refresh" {
			continue
		}
		_, next, err := f.preflightProviderMutation(providers, mutation)
		if err != nil {
			return effectpkg.ProviderList{}, err
		}
		providers = next
	}
	id, declared := f.run.compiled.RuntimeTypes.SpellShield.Lookup()
	if !declared {
		return effectpkg.ProviderList{}, nil
	}
	for instanceIndex, instanceValues := 0, providers.Active(f.run.loop.TimeMs()); instanceIndex < instanceValues.Len(); instanceIndex++ {
		shield := instanceValues.At(instanceIndex)
		if int(shield.DefinitionIndex) >= len(f.run.compiled.Providers) || !f.run.compiled.Providers[shield.DefinitionIndex].TypeSet.Contains(id) {
			continue
		}
		if !f.empoweredShieldClaimed(owner, shield.ProviderRef) {
			out = out.Append(shield)
		}
	}
	return out, nil
}

func (s *Engine) executeEmpoweredGroup(ev emittedEvent, waits []empoweredWaitFreeze, depth int) *model.EngineError {
	if len(waits) == 0 {
		return nil
	}
	var storage Frame
	s.initExecutionFrame(&storage, ev.sourceKey, ev.targetKey, ev.skillHit.abilityRef)
	f := &storage
	f.empowered = &empoweredFrame{}
	f.chainDepth = depth
	f.strictReads = true
	for _, wait := range waits {
		if wait.instance.ReplacesPrimary() {
			continue
		}
		if !s.empoweredWaitCurrent(wait, ev.sourceKey) {
			continue
		}
		original := wait.instance
		use := s.skillUses[original.UseKey()]
		if use == nil || use.identity.Source() != original.Owner() || use.identity.SkillKey() != original.SkillKey() || use.identity.HistoryState() != model.SkillHitHistoryComplete || len(use.contacts)+len(use.prior) >= maxSkillHistoryContacts {
			return s.processErr("skillUses", "empowered activation requires its real complete contact history", original.UseKey())
		}
		changes := actionpkg.StageProcess(original)
		p := changes.View()
		association := &model.ProcessEmpoweredAttack{UseRef: ev.skillHit.useRef, HitRef: "hit:" + strconv.FormatUint(ev.skillHit.occurrenceID, 10), Target: ev.targetKey}
		changes.SetEmpoweredAttack(association)
		ability := s.compiled.Abilities[p.EmpoweredAbilityIndex()]
		if err := f.withEmpoweredContext(changes, ev.targetKey, p.Ability(), association, func() *model.EngineError {
			if err := s.applyProcessMoment(p, f, "STEP_EXECUTION", ""); err != nil {
				return err
			}
			if err := f.executeEmpoweredPayload(ev, p, ability); err != nil {
				return err
			}
			if err := s.applyProcessMoment(p, f, "STEP_COMPLETE", ""); err != nil {
				return err
			}
			changes.Finish("complete", "", s.loop.TimeMs())
			return s.applyProcessMoment(p, f, "PROCESS_COMPLETE", "")
		}); err != nil {
			return err
		}
		f.empowered.mutations = append(f.empowered.mutations, empoweredProcessMutation{original, changes})
		f.empowered.contacts = append(f.empowered.contacts, empoweredContact{p, *association})
		f.empowered.finished = append(f.empowered.finished, p)
	}
	if len(f.empowered.mutations) == 0 {
		return nil
	}
	f.pendingProcess = nil
	f.commit()
	if f.fatal {
		return f.fatalErr
	}
	if err := f.dispatchPendingEvents(); err != nil {
		return err
	}
	for _, p := range f.empowered.finished {
		resolved := p.WithTarget(p.EmpoweredAttack().Target)
		if err := s.publishProcessResolved(resolved); err != nil {
			return err
		}
	}
	return s.processFailure
}

func (f *Frame) executeEmpoweredPayload(parent emittedEvent, p *actionpkg.ProcessView, ability planbundle.CompiledAbility) *model.EngineError {
	savedRef, savedOrigin, savedContext := f.abilityRef, f.castOrigin, f.eventCtx
	f.abilityRef = p.Owner() + ".provider[" + p.ProviderRef() + "].ability[" + ability.AbilityKey + "]"
	f.castOrigin = ability.CastOrigin
	beforeDamage, beforeHealing := f.damageDealt, f.healingDone
	defer func() {
		f.empowered.stats = append(f.empowered.stats, empoweredStat{f.abilityRef, f.damageDealt - beforeDamage, f.healingDone - beforeHealing})
		f.damageDealt, f.healingDone = beforeDamage, beforeHealing
		f.abilityRef, f.castOrigin, f.eventCtx = savedRef, savedOrigin, savedContext
	}()
	operation := f.run.compiled.Operations[ability.OperationStart]
	plan := operation.SkillHit
	first := float64(1)
	if use := f.run.skillUses[p.UseKey()]; len(use.prior)+len(use.contacts) > 0 {
		first = 0
	}
	f.eventCtx = cloneEventSnapshot(&parent.snapshot)
	set, err := f.selectSkillHitCandidates(plan, ability, true, first)
	if err != nil {
		return err
	}
	unit, err := f.formSkillHitUnit(plan, set, parent.skillHit.occurrenceID, p.UseKey())
	if err != nil {
		return err
	}
	freeze := &frozenSkillHitContext{occurrenceID: parent.skillHit.occurrenceID, useRef: p.UseKey(), skillKey: p.SkillKey(), sourceKey: p.Owner(), targetKey: parent.targetKey, hasFirstContact: true, firstContact: first, ability: ability, plan: plan, abilityRef: f.abilityRef}
	if unit != nil {
		freeze.unitScope, freeze.effectOccurrenceKey, freeze.resultKey, freeze.candidateKey = unit.unitScope, unit.effectOccurrenceKey, unit.resultKey, unit.candidateKey
	}
	if unit != nil {
		shields, shieldErr := f.empoweredSpellShields(parent.targetKey)
		if shieldErr != nil {
			return shieldErr
		}
		if shields.Len() > 1 {
			return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "multiple active spell shields have no nominated priority", "providers", parent.targetKey)
		}
		if shields.Len() == 1 {
			shield := shields.At(0)
			freeze.blocked = 1
			freeze.shieldOwner, freeze.shieldProviderRef, freeze.shieldDefinitionRef, freeze.shieldSource = shield.Owner, shield.ProviderRef, shield.DefinitionRef, shield.Source
		}
	}
	matched, err := f.consumptionMatchedCandidates(plan, ability, set, freeze)
	if err != nil {
		return err
	}
	f.eventCtx.hasSkillHit, f.eventCtx.skillHit = true, freeze
	f.eventCtx.hasUse, f.eventCtx.useKey, f.eventCtx.useSource, f.eventCtx.useSkillKey = true, p.UseKey(), p.Owner(), p.SkillKey()
	f.skillHitOccurrenceID = freeze.occurrenceID
	for _, index := range matched {
		candidate := plan.Candidates[index]
		f.skillHitCandidateKey = candidate.CandidateKey
		f.skipBlockedWrites = freeze.blocked == 1 && candidate.HasBlockScope && model.ScopeCovers(freeze.unitScope, freeze.occurrenceID, freeze.effectOccurrenceKey, freeze.resultKey, freeze.candidateKey, freeze.useRef, candidate.BlockScope, freeze.occurrenceID, candidate.EffectOccurrenceKey, candidate.ResultKey, candidate.CandidateKey, freeze.useRef)
		savedRoot := f.rootSkillHitDamage
		if p.ReplacesPrimary() {
			f.rootSkillHitDamage = parent.skillHit.rootDamageEvent
		}
		err := f.executeOperations(ability, f.run.compiled.Operations[int(candidate.OperationStart):int(candidate.OperationStart)+int(candidate.OperationCount)])
		f.rootSkillHitDamage = savedRoot
		if err != nil {
			return err
		}
	}
	f.skipBlockedWrites = false
	if freeze.blocked == 1 {
		if p.ReplacesPrimary() {
			f.empowered.primaryBlocked = true
		}
		return f.stageEmpoweredSpellShield(parent, freeze)
	}
	return nil
}

// The validated shield's own consumption listener is lowered into this group,
// rather than independently committed or dispatched a second time afterwards.
func (f *Frame) stageEmpoweredSpellShield(parent emittedEvent, freeze *frozenSkillHitContext) *model.EngineError {
	f.empowered.shields = append(f.empowered.shields, empoweredShieldClaim{freeze.shieldOwner, freeze.shieldProviderRef})
	context := *f.eventCtx
	context.eventType, context.hasSkillHit, context.skillHit = model.EventTypeSpellShieldBlocked, true, freeze
	event := emittedEvent{eventType: model.EventTypeSpellShieldBlocked, sourceKey: freeze.sourceKey, targetKey: freeze.targetKey, types: []string{model.EventTypeSpellShieldBlocked}, snapshot: context, skillHit: freeze}
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: model.EventTypeSpellShieldBlocked, Data: skillHitEvidenceData(freeze)}
	})
	matched := false
	compiledCount := len(f.run.compiled.Listeners)
	for index := 0; index < compiledCount+len(f.run.runtimeListeners); index++ {
		var listener planbundle.CompiledListener
		if index < compiledCount {
			listener = f.run.compiled.Listeners[index]
		} else {
			listener = f.run.runtimeListeners[index-compiledCount]
		}
		if listener.OwnerCombatantKey != freeze.shieldOwner || listener.OwnerProviderRef != freeze.shieldProviderRef {
			continue
		}
		if !f.run.listenerMatchesEvent(listener, event, f.run.eventTypeSet(event.types)) {
			continue
		}
		if listener.HasAbilityRef || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 || listener.OperationCount == 0 {
			return f.run.processErr("listeners."+listener.ListenerKey, "attached spell shield requires its complete single consumption listener", freeze.shieldProviderRef)
		}
		operations := f.run.compiled.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)]
		consumes := 0
		for _, operation := range operations {
			if operation.Operation == "expire_provider" && operation.ProviderRefFromEvent {
				consumes++
			}
		}
		if consumes != 1 {
			return f.run.processErr("listeners."+listener.ListenerKey, "attached spell shield listener must consume its frozen instance once", freeze.shieldProviderRef)
		}
		savedOwner, savedProvider, savedContext, savedAbility := f.ownerCombatantKey, f.ownerProviderRef, f.eventCtx, f.abilityRef
		savedSource, savedTarget := f.sourceKey, f.targetKey
		f.sourceKey, f.targetKey = f.run.listenerFrameCombatants(event, listener)
		f.ownerCombatantKey, f.ownerProviderRef, f.eventCtx, f.abilityRef = listener.OwnerCombatantKey, listener.OwnerProviderRef, &context, "listener:"+listener.ListenerKey
		ability := planbundle.CompiledAbility{}
		if listener.SourceAbilityIndex >= 0 {
			ability = f.run.compiled.Abilities[listener.SourceAbilityIndex]
		}
		if listener.HasCondition {
			ctx := f.evalContext(ability)
			value, err := f.run.formulas.EvalContext(listener.ConditionProgram, &ctx)
			if err != nil {
				return f.formulaError(listener.ConditionProgram, err.Error())
			}
			if !effectpkg.FiniteState(value) {
				return f.formulaError(listener.ConditionProgram, "spell shield condition must be finite")
			}
			if value == 0 {
				f.ownerCombatantKey, f.ownerProviderRef, f.eventCtx, f.abilityRef = savedOwner, savedProvider, savedContext, savedAbility
				f.sourceKey, f.targetKey = savedSource, savedTarget
				continue
			}
		}
		beforeDamage, beforeHealing := f.damageDealt, f.healingDone
		err := f.executeOperations(ability, operations)
		f.empowered.stats = append(f.empowered.stats, empoweredStat{f.abilityRef, f.damageDealt - beforeDamage, f.healingDone - beforeHealing})
		// Remove the listener contribution from the enclosing payload unit's stat delta.
		f.damageDealt, f.healingDone = beforeDamage, beforeHealing
		f.ownerCombatantKey, f.ownerProviderRef, f.eventCtx, f.abilityRef = savedOwner, savedProvider, savedContext, savedAbility
		f.sourceKey, f.targetKey = savedSource, savedTarget
		if err != nil {
			return err
		}
		matched = true
	}
	if !matched {
		return f.run.processErr("listeners", "spell shield has no complete own consumption listener", freeze.shieldProviderRef)
	}
	// The removed shield listener is no longer live at dispatch; unrelated
	// blocked-event listeners still receive their ordinary post-commit event.
	f.pendingEvents = append(f.pendingEvents, event)
	_ = parent
	return nil
}
