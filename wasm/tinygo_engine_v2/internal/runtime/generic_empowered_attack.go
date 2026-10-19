package runtime

import (
	"strconv"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/status"
)

const empoweredAttackStep = "EMPOWERED_BASIC_ATTACK"

type empoweredWaitFreeze struct {
	instance *processRuntime
	useKey   string
	version  int
	expires  int64
}

type empoweredProcessMutation struct{ original, pending *processRuntime }
type empoweredMoment struct {
	process processRuntime
	kind    string
}
type empoweredContact struct {
	process *processRuntime
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
	mutations                 []empoweredProcessMutation
	moments                   []empoweredMoment
	finished                  []*processRuntime
	contacts                  []empoweredContact
	stats                     []empoweredStat
	shields                   []empoweredShieldClaim
	primaryReplacement        *model.BasicAttackPrimaryReplacement
	primaryReplacementBinding uint16
	primaryBlocked            bool
}

func isEmpoweredProcess(definition *planbundle.CompiledProcess) bool {
	return definition != nil && len(definition.Steps) == 1 && definition.Steps[0].StepType == empoweredAttackStep
}

func (s *genericRunState) empoweredBinding(owner, provider, process string) (planbundle.CompiledSkillActionBinding, bool) {
	for _, binding := range s.compiled.SkillActionBindings {
		if binding.HasEmpoweredAttack && binding.Source == owner && binding.ProviderRef == provider && binding.Controls[0].ProcessKey == process {
			return binding, true
		}
	}
	return planbundle.CompiledSkillActionBinding{}, false
}

func (s *genericRunState) startEmpoweredProcess(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, replaced *processRuntime) *model.EngineError {
	if target != owner || s.basicAttack == nil || s.basicAttack.plan.Source != owner {
		return s.rejectProcess(entry, "empowered_attack_requires_own_native_attack")
	}
	if _, found := s.empoweredBinding(owner, provider, definition.ProcessKey); !found {
		return s.processErr(definition.Path, "empowered attack requires its complete compiled own result binding", use)
	}
	return s.startProcessReplacing(entry, entryIndex, owner, target, provider, ref, ability, definition, use, 0, nil, replaced)
}

func cloneEmpoweredProcess(p *processRuntime) *processRuntime {
	copy := *p
	copy.ActualCosts = cloneProcessCosts(p.ActualCosts)
	copy.ActionOccupancies = append([]model.ProcessActionOccupancy{}, p.ActionOccupancies...)
	return &copy
}

func (s *genericRunState) updateEmpoweredWait(p *processRuntime) {
	if !p.hasEmpoweredAbility {
		return
	}
	index := -1
	for i, existing := range s.empoweredWaits {
		if existing == p {
			index = i
			break
		}
	}
	active := p.Status == "active" && p.StepExecutionIndex == 0 && p.StepKey != "" && p.ExpiresAtMs != nil
	if active && index < 0 {
		s.empoweredWaits = append(s.empoweredWaits, p)
	}
	if !active && index >= 0 {
		s.empoweredWaits = append(s.empoweredWaits[:index], s.empoweredWaits[index+1:]...)
	}
}

func (s *genericRunState) freezeEmpoweredWaits(owner string) []empoweredWaitFreeze {
	var out []empoweredWaitFreeze
	for _, p := range s.empoweredWaits {
		if p.Owner == owner && p.Status == "active" && p.StepExecutionIndex == 0 && p.ExpiresAtMs != nil && s.nowMs < *p.ExpiresAtMs && s.processMounted(owner, p.ProviderRef, p.ability.ProviderIndex) {
			out = append(out, empoweredWaitFreeze{p, p.UseKey, p.StepVersion, *p.ExpiresAtMs})
		}
	}
	return out
}

func (s *genericRunState) empoweredWaitCurrent(wait empoweredWaitFreeze, owner string) bool {
	p := wait.instance
	return p != nil && p.Owner == owner && p.UseKey == wait.useKey && p.StepVersion == wait.version && p.Status == "active" && p.StepExecutionIndex == 0 && p.ExpiresAtMs != nil && *p.ExpiresAtMs == wait.expires && s.nowMs < wait.expires && !s.actionDeaths[owner] && s.combatantHp(owner) > 0 && s.processMounted(owner, p.ProviderRef, p.ability.ProviderIndex)
}

func (s *genericRunState) stageEmpoweredEntry(f *executionFrame) *model.EngineError {
	p := f.pendingProcess
	step := p.definition.Steps[0]
	value, err := f.evalAmount(step.WindowProgram, p.ability)
	if err != nil {
		return err
	}
	deadline, valid := processTimeAfter(s.nowMs, value, false)
	if !valid || deadline > maxJSONSafeInteger {
		return s.processErr(step.Path+".windowMs", "empowered window requires a positive safe integer deadline", p.UseKey)
	}
	p.stepIndex, p.StepVersion, p.StepKey = 0, 1, step.StepKey
	p.StepStartedAtMs, p.AdvanceAtMs, p.ExpiresAtMs = s.nowMs, s.nowMs, &deadline
	f.pendingProcessTimer = true
	return s.applyProcessMoment(p, f, "STEP_START", "")
}

// Context switching shares the combatant staging and all pending operations.
// It never invokes castAbilityAt or resolves a second physical hit.
func (f *executionFrame) withEmpoweredContext(p *processRuntime, target string, ability planbundle.CompiledAbility, association *model.ProcessEmpoweredAttack, body func() *model.EngineError) *model.EngineError {
	saved := *f
	f.pendingProcess = p
	f.sourceKey, f.targetKey = p.Owner, target
	// Each payload keeps an entry snapshot from its actual execution boundary,
	// while all later writes remain in the one shared combatant staging.
	f.entrySourceAttrs, f.entryTargetAttrs = f.stageFor(p.Owner).attributes, f.stageFor(target).attributes
	f.entrySourceResources, f.entryTargetResources = f.stageFor(p.Owner).readonlyResources(), f.stageFor(target).readonlyResources()
	f.ownerCombatantKey, f.ownerProviderRef = p.Owner, p.ProviderRef
	f.abilityRef = p.Owner + ".provider[" + p.ProviderRef + "].ability[" + ability.AbilityKey + "]"
	f.processUseKey, f.processUseSource, f.processUseSkillKey = p.UseKey, p.Owner, p.SkillKey
	f.processActualCosts = p.ActualCosts
	f.castInstanceID, f.castOrigin = p.castID, ability.CastOrigin
	f.empoweredAttack = association
	beforeDamage, beforeHealing := f.damageDealt, f.healingDone
	err := body()
	f.empowered.stats = append(f.empowered.stats, empoweredStat{f.abilityRef, f.damageDealt - beforeDamage, f.healingDone - beforeHealing})
	f.sourceKey, f.targetKey, f.ownerCombatantKey, f.ownerProviderRef = saved.sourceKey, saved.targetKey, saved.ownerCombatantKey, saved.ownerProviderRef
	f.abilityRef, f.processUseKey, f.processUseSource, f.processUseSkillKey = saved.abilityRef, saved.processUseKey, saved.processUseSource, saved.processUseSkillKey
	f.pendingProcess, f.processOriginal, f.processMomentKind = saved.pendingProcess, saved.processOriginal, saved.processMomentKind
	f.processActualCosts, f.processCostReadable = saved.processActualCosts, saved.processCostReadable
	f.castInstanceID, f.castOrigin, f.empoweredAttack = saved.castInstanceID, saved.castOrigin, saved.empoweredAttack
	f.eventCtx, f.skillHitCandidateKey, f.skillHitOccurrenceID = saved.eventCtx, saved.skillHitCandidateKey, saved.skillHitOccurrenceID
	f.skipBlockedWrites, f.operationOutputs = saved.skipBlockedWrites, saved.operationOutputs
	f.entrySourceAttrs, f.entryTargetAttrs, f.entrySourceResources, f.entryTargetResources = saved.entrySourceAttrs, saved.entryTargetAttrs, saved.entrySourceResources, saved.entryTargetResources
	return err
}

func (s *genericRunState) stageEmpoweredFailure(f *executionFrame, original *processRuntime) *model.EngineError {
	p := cloneEmpoweredProcess(original)
	at, reason := s.nowMs, "EVENT_ABORTED"
	p.Status, p.FinishedAtMs, p.FailureReason = "failed", &at, &reason
	err := f.withEmpoweredContext(p, p.Target, p.ability, nil, func() *model.EngineError { return s.applyProcessMoment(p, f, "PROCESS_FAILURE", reason) })
	if err != nil {
		return err
	}
	f.empowered.mutations = append(f.empowered.mutations, empoweredProcessMutation{original, p})
	f.empowered.finished = append(f.empowered.finished, p)
	return nil
}

func (f *executionFrame) commitEmpoweredProcesses() {
	for _, mutation := range f.empowered.mutations {
		*mutation.original = *mutation.pending
		f.run.updateEmpoweredWait(mutation.original)
	}
}

func (f *executionFrame) commitEmpoweredFacts() {
	s := f.run
	if replacement := f.empowered.primaryReplacement; replacement != nil {
		s.commitPrimaryReplacement(*replacement, f.empowered.primaryReplacementBinding)
	}
	for _, moment := range f.empowered.moments {
		p := moment.process
		s.publishSkillActionMoment(&p, moment.kind)
	}
	for _, contact := range f.empowered.contacts {
		use := s.skillUses[contact.process.UseKey]
		use.contacts = append(use.contacts, contact.attack.Target)
		if action := s.skillActionByUse[contact.process.UseKey]; action != nil {
			action.uses.HitCount++
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
		stat := s.statFor(value.ref)
		if value.damage != 0 {
			if stat.damageDealt == nil {
				stat.damageDealt = new(float64)
			}
			*stat.damageDealt += value.damage
		}
		if value.healing != 0 {
			if stat.healingDone == nil {
				stat.healingDone = new(float64)
			}
			*stat.healingDone += value.healing
		}
	}
	f.damageDealt, f.healingDone = 0, 0 // Per-ability amounts were published above.
}

func (f *executionFrame) empoweredShieldClaimed(owner, provider string) bool {
	for _, claim := range f.empowered.shields {
		if claim.owner == owner && claim.provider == provider {
			return true
		}
	}
	return false
}

// Selection uses the same staged view as earlier attached results; a shield
// already claimed by one result cannot be claimed again later in this group.
func (f *executionFrame) empoweredSpellShields(owner string) ([]status.ProviderInstance, *model.EngineError) {
	var out []status.ProviderInstance
	staged := f.stageFor(owner)
	providers := staged.providers
	if len(staged.providerOps) != 0 {
		providers = append([]status.ProviderInstance(nil), providers...)
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
			return nil, err
		}
		providers = next
	}
	id, declared := f.run.compiled.RuntimeTypes.SpellShield.Lookup()
	if !declared {
		return nil, nil
	}
	for _, shield := range status.ActiveInstances(providers, f.run.nowMs) {
		if int(shield.DefinitionIndex) >= len(f.run.compiled.Providers) || !f.run.compiled.Providers[shield.DefinitionIndex].TypeSet.Contains(id) {
			continue
		}
		if !f.empoweredShieldClaimed(owner, shield.ProviderRef) {
			out = append(out, shield)
		}
	}
	return out, nil
}

func (s *genericRunState) executeEmpoweredGroup(ev emittedEvent, waits []empoweredWaitFreeze, depth int) *model.EngineError {
	if len(waits) == 0 {
		return nil
	}
	var storage executionFrame
	s.initExecutionFrame(&storage, ev.sourceKey, ev.targetKey, ev.skillHit.abilityRef)
	f := &storage
	f.empowered = &empoweredFrame{}
	f.chainDepth = depth
	f.strictReads = true
	for _, wait := range waits {
		if wait.instance.replacesPrimary {
			continue
		}
		if !s.empoweredWaitCurrent(wait, ev.sourceKey) {
			continue
		}
		original := wait.instance
		use := s.skillUses[original.UseKey]
		if use == nil || use.source != original.Owner || use.skillKey != original.SkillKey || use.historyState != model.SkillHitHistoryComplete || len(use.contacts)+len(use.prior) >= maxSkillHistoryContacts {
			return s.processErr("skillUses", "empowered activation requires its real complete contact history", original.UseKey)
		}
		p := cloneEmpoweredProcess(original)
		association := &model.ProcessEmpoweredAttack{UseRef: ev.skillHit.useRef, HitRef: "hit:" + strconv.FormatUint(ev.skillHit.occurrenceID, 10), Target: ev.targetKey}
		p.EmpoweredAttack = association
		ability := s.compiled.Abilities[p.empoweredAbilityIndex]
		if err := f.withEmpoweredContext(p, ev.targetKey, p.ability, association, func() *model.EngineError {
			if err := s.applyProcessMoment(p, f, "STEP_EXECUTION", ""); err != nil {
				return err
			}
			if err := f.executeEmpoweredPayload(ev, p, ability); err != nil {
				return err
			}
			if err := s.applyProcessMoment(p, f, "STEP_COMPLETE", ""); err != nil {
				return err
			}
			at := s.nowMs
			p.Status, p.FinishedAtMs, p.FailureReason = "complete", &at, nil
			return s.applyProcessMoment(p, f, "PROCESS_COMPLETE", "")
		}); err != nil {
			return err
		}
		f.empowered.mutations = append(f.empowered.mutations, empoweredProcessMutation{original, p})
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
		resolved := *p
		resolved.Target = p.EmpoweredAttack.Target
		if err := s.publishProcessResolved(&resolved); err != nil {
			return err
		}
	}
	return s.processFailure
}

func (f *executionFrame) executeEmpoweredPayload(parent emittedEvent, p *processRuntime, ability planbundle.CompiledAbility) *model.EngineError {
	savedRef, savedOrigin, savedContext := f.abilityRef, f.castOrigin, f.eventCtx
	f.abilityRef = p.Owner + ".provider[" + p.ProviderRef + "].ability[" + ability.AbilityKey + "]"
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
	if use := f.run.skillUses[p.UseKey]; len(use.prior)+len(use.contacts) > 0 {
		first = 0
	}
	f.eventCtx = cloneEventSnapshot(&parent.snapshot)
	set, err := f.selectSkillHitCandidates(plan, ability, true, first)
	if err != nil {
		return err
	}
	unit, err := f.formSkillHitUnit(plan, set, parent.skillHit.occurrenceID, p.UseKey)
	if err != nil {
		return err
	}
	freeze := &frozenSkillHitContext{occurrenceID: parent.skillHit.occurrenceID, useRef: p.UseKey, skillKey: p.SkillKey, sourceKey: p.Owner, targetKey: parent.targetKey, hasFirstContact: true, firstContact: first, ability: ability, plan: plan, abilityRef: f.abilityRef}
	if unit != nil {
		freeze.unitScope, freeze.effectOccurrenceKey, freeze.resultKey, freeze.candidateKey = unit.unitScope, unit.effectOccurrenceKey, unit.resultKey, unit.candidateKey
	}
	if unit != nil {
		shields, shieldErr := f.empoweredSpellShields(parent.targetKey)
		if shieldErr != nil {
			return shieldErr
		}
		if len(shields) > 1 {
			return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "multiple active spell shields have no nominated priority", "providers", parent.targetKey)
		}
		if len(shields) == 1 {
			shield := shields[0]
			freeze.blocked = 1
			freeze.shieldOwner, freeze.shieldProviderRef, freeze.shieldDefinitionRef, freeze.shieldSource = shield.Owner, shield.ProviderRef, shield.DefinitionRef, shield.Source
		}
	}
	matched, err := f.consumptionMatchedCandidates(plan, ability, set, freeze)
	if err != nil {
		return err
	}
	f.eventCtx.hasSkillHit, f.eventCtx.skillHit = true, freeze
	f.eventCtx.hasUse, f.eventCtx.useKey, f.eventCtx.useSource, f.eventCtx.useSkillKey = true, p.UseKey, p.Owner, p.SkillKey
	f.skillHitOccurrenceID = freeze.occurrenceID
	for _, index := range matched {
		candidate := plan.Candidates[index]
		f.skillHitCandidateKey = candidate.CandidateKey
		f.skipBlockedWrites = freeze.blocked == 1 && candidate.HasBlockScope && model.ScopeCovers(freeze.unitScope, freeze.occurrenceID, freeze.effectOccurrenceKey, freeze.resultKey, freeze.candidateKey, freeze.useRef, candidate.BlockScope, freeze.occurrenceID, candidate.EffectOccurrenceKey, candidate.ResultKey, candidate.CandidateKey, freeze.useRef)
		savedRoot := f.rootSkillHitDamage
		if p.replacesPrimary {
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
		if p.replacesPrimary {
			f.empowered.primaryBlocked = true
		}
		return f.stageEmpoweredSpellShield(parent, freeze)
	}
	return nil
}

// The validated shield's own consumption listener is lowered into this group,
// rather than independently committed or dispatched a second time afterwards.
func (f *executionFrame) stageEmpoweredSpellShield(parent emittedEvent, freeze *frozenSkillHitContext) *model.EngineError {
	f.empowered.shields = append(f.empowered.shields, empoweredShieldClaim{freeze.shieldOwner, freeze.shieldProviderRef})
	context := *f.eventCtx
	context.eventType, context.hasSkillHit, context.skillHit = model.EventTypeSpellShieldBlocked, true, freeze
	event := emittedEvent{eventType: model.EventTypeSpellShieldBlocked, sourceKey: freeze.sourceKey, targetKey: freeze.targetKey, types: []string{model.EventTypeSpellShieldBlocked}, snapshot: context, skillHit: freeze}
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: model.EvidenceKindEmittedEvent, Ref: model.EventTypeSpellShieldBlocked, Data: skillHitEvidenceData(freeze)}
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
			if !finiteState(value) {
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
