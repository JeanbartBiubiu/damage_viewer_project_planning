// 强化窗口和主体替换的真实帧、身份及同步尾部。
package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/runtime/execution/hit"
	listenerpkg "tinygo_engine_v2/internal/runtime/execution/listener"
)

type empoweredWaitFreeze = hit.EmpoweredWait

type empoweredContextBinding struct {
	sourceKey, targetKey, ownerCombatantKey, ownerProviderRef       string
	abilityRef, processUseKey, processUseSource, processUseSkillKey string
	pendingProcess, processOriginal                                 *actionpkg.ProcessView
	processMomentKind                                               string
	processChanges                                                  *actionpkg.ProcessChangeSet
	processActualCosts                                              model.NumericView
	processCostReadable                                             bool
	castInstanceID                                                  uint64
	castOrigin                                                      string
	empoweredAttack                                                 *model.ProcessEmpoweredAttack
	eventCtx                                                        *eventFormulaSnapshot
	skillHitCandidateKey                                            string
	skillHitOccurrenceID                                            uint64
	skipBlockedWrites                                               bool
	operationOutputs                                                map[string]formula.OperationOutputValues
	entrySourceAttrs, entryTargetAttrs                              attribute.Table
	entrySourceResources, entryTargetResources                      model.ResourceView
	beforeDamage, beforeHealing                                     float64
}

type empoweredFrame = hit.Frame

const empoweredAttackStep = "EMPOWERED_BASIC_ATTACK"

func (s *Engine) empoweredBinding(owner, provider, process string) (planbundle.CompiledSkillActionBinding, bool) {
	return hit.EmpoweredBinding(s.compiled.SkillActionBindings, owner, provider, process)
}

func (s *Engine) startEmpoweredProcess(entry model.DriverEntry, entryIndex int, owner, target, provider, ref string, ability planbundle.CompiledAbility, definition *planbundle.CompiledProcess, use string, replaced *actionpkg.ProcessView) (actionflow.ActionResult, *model.EngineError) {
	nativeOwner := ""
	if attack := s.actions.BasicAttack(); attack != nil {
		nativeOwner = attack.Plan().Source
	}
	reject, err := hit.EmpoweredStartDecision(owner, target, nativeOwner, provider, use, definition, s.compiled.SkillActionBindings, s, s.hitIdentity())
	if err != nil {
		return actionflow.ActionResult{}, err
	}
	if reject != "" {
		return actionflow.ActionResult{Reason: reject}, s.rejectProcess(entry, reject)
	}
	return s.startProcessReplacing(entry, entryIndex, owner, target, provider, ref, ability, definition, use, 0, nil, replaced)
}

func (s *Engine) updateEmpoweredWait(p *actionpkg.ProcessView) {
	s.actions.UpdateEmpoweredWait(p)
}

func (s *Engine) freezeEmpoweredWaits(owner string) []empoweredWaitFreeze {
	return hit.FreezeEmpoweredWaits(owner, s.loop.TimeMs(), s)
}

func (s *Engine) empoweredWaitCurrent(wait empoweredWaitFreeze, owner string) bool {
	p := wait.Instance
	return p != nil && hit.WaitCurrent(wait, owner, s.loop.TimeMs(), !s.actions.Dead(owner) && s.combatantHp(owner) > 0 && s.processMounted(owner, p.ProviderRef(), p.Ability().ProviderIndex))
}

func (s *Engine) stageEmpoweredEntry(f *Frame) *model.EngineError {
	p := f.pendingProcess
	step := p.Definition().Steps[0]
	value, err := f.evalAmount(step.WindowProgram, p.Ability())
	if err != nil {
		return err
	}
	if err := hit.EnterEmpoweredWindow(f.processChanges, step, value, s.loop.TimeMs(), maxJSONSafeInteger, s.hitIdentity()); err != nil {
		return err
	}
	f.pendingProcessTimer = true
	return f.applyProcessMoment("STEP_START", "")
}

func (f *Frame) bindEmpoweredContext(changes *actionpkg.ProcessChangeSet, target string, ability planbundle.CompiledAbility, association *model.ProcessEmpoweredAttack) empoweredContextBinding {
	p := changes.View()
	saved := empoweredContextBinding{
		sourceKey: f.sourceKey, targetKey: f.targetKey, ownerCombatantKey: f.ownerCombatantKey, ownerProviderRef: f.ownerProviderRef,
		abilityRef: f.abilityRef, processUseKey: f.processUseKey, processUseSource: f.processUseSource, processUseSkillKey: f.processUseSkillKey,
		pendingProcess: f.pendingProcess, processOriginal: f.processOriginal, processMomentKind: f.processMomentKind, processChanges: f.processChanges,
		processActualCosts: f.processActualCosts, processCostReadable: f.processCostReadable, castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
		empoweredAttack: f.empoweredAttack, eventCtx: f.eventCtx, skillHitCandidateKey: f.skillHitCandidateKey, skillHitOccurrenceID: f.skillHitOccurrenceID,
		skipBlockedWrites: f.skipBlockedWrites, operationOutputs: f.numeric.Outputs(),
		entrySourceAttrs: f.entrySourceAttrs, entryTargetAttrs: f.entryTargetAttrs,
		entrySourceResources: f.entrySourceResources, entryTargetResources: f.entryTargetResources,
		beforeDamage: f.numeric.Facts().Damage, beforeHealing: f.numeric.Facts().Healing,
	}
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
	return saved
}

func (f *Frame) EndEmpoweredProcess(saved empoweredContextBinding) {
	f.empowered.RecordOutput(f.abilityRef, f.numeric.Facts().Damage-saved.beforeDamage, f.numeric.Facts().Healing-saved.beforeHealing)
	f.sourceKey, f.targetKey, f.ownerCombatantKey, f.ownerProviderRef = saved.sourceKey, saved.targetKey, saved.ownerCombatantKey, saved.ownerProviderRef
	f.abilityRef, f.processUseKey, f.processUseSource, f.processUseSkillKey = saved.abilityRef, saved.processUseKey, saved.processUseSource, saved.processUseSkillKey
	f.pendingProcess, f.processOriginal, f.processMomentKind, f.processChanges = saved.pendingProcess, saved.processOriginal, saved.processMomentKind, saved.processChanges
	f.processActualCosts, f.processCostReadable = saved.processActualCosts, saved.processCostReadable
	f.castInstanceID, f.castOrigin, f.empoweredAttack = saved.castInstanceID, saved.castOrigin, saved.empoweredAttack
	f.eventCtx, f.skillHitCandidateKey, f.skillHitOccurrenceID = saved.eventCtx, saved.skillHitCandidateKey, saved.skillHitOccurrenceID
	f.skipBlockedWrites = saved.skipBlockedWrites
	f.numeric.SetOutputs(saved.operationOutputs)
	f.entrySourceAttrs, f.entryTargetAttrs, f.entrySourceResources, f.entryTargetResources = saved.entrySourceAttrs, saved.entryTargetAttrs, saved.entrySourceResources, saved.entryTargetResources
}

func (s *Engine) stageEmpoweredFailure(f *Frame, original *actionpkg.ProcessView) *model.EngineError {
	return hit.StageEmpoweredFailure(f.empowered, original, s.loop.TimeMs(), f)
}

func (f *Frame) commitEmpoweredProcesses() { f.empowered.PublishProcesses(f) }

func (f *Frame) commitEmpoweredFacts() {
	f.empowered.PublishFacts(f)
	f.numeric.SetTotals(0, 0)
}

// Selection uses the same staged view as earlier attached results; a shield
// already claimed by one result cannot be claimed again later in this group.
func (f *Frame) empoweredSpellShields(owner string) (effectpkg.ProviderList, *model.EngineError) {
	staged := f.stageFor(owner)
	executor := f.run.lifecycleExecutor()
	providers, err := executor.ProjectShieldCandidates(staged.instances.Providers(), staged.providerOps, f.run.loop.TimeMs())
	if err != nil {
		return effectpkg.ProviderList{}, err
	}
	id, declared := f.run.compiled.RuntimeTypes.SpellShield.Lookup()
	return f.empowered.AvailableShields(owner, providers, f.run.compiled.Providers, id, declared, f.run.loop.TimeMs()), nil
}

func (s *Engine) executeEmpoweredGroup(ev emittedEvent, waits []empoweredWaitFreeze, depth int) *model.EngineError {
	if len(waits) == 0 {
		return nil
	}
	var storage Frame
	s.initExecutionFrame(&storage, ev.sourceKey, ev.targetKey, ev.skillHit.AbilityRef())
	f := &storage
	f.empowered = &empoweredFrame{}
	f.chainDepth = depth
	f.strictReads = true
	return hit.ExecuteEmpoweredGroup(hit.EmpoweredGroupInput{Source: ev.sourceKey, Target: ev.targetKey,
		UseRef: ev.skillHit.View().UseRef, OccurrenceID: ev.skillHit.View().OccurrenceID, NowMs: s.loop.TimeMs(), Abilities: s.compiled.Abilities}, waits, ev, f)
}

func (f *Frame) executeEmpoweredPayload(parent emittedEvent, p *actionpkg.ProcessView, ability planbundle.CompiledAbility) *model.EngineError {
	savedRef, savedOrigin, savedContext := f.abilityRef, f.castOrigin, f.eventCtx
	f.abilityRef = p.Owner() + ".provider[" + p.ProviderRef() + "].ability[" + ability.AbilityKey + "]"
	f.castOrigin = ability.CastOrigin
	beforeDamage, beforeHealing := f.numeric.Facts().Damage, f.numeric.Facts().Healing
	operation := f.run.compiled.Operations[ability.OperationStart]
	plan := operation.SkillHit
	priorContacts := f.run.skillUses[p.UseKey()].history.TotalCount()
	f.eventCtx = cloneEventSnapshot(&parent.snapshot)
	err := hit.ExecuteAttachedPayload(hit.AttachedPayload{
		OccurrenceID: parent.skillHit.View().OccurrenceID, ParentRoot: parent.skillHit.View().RootDamageEvent,
		RootDamage: f.rootSkillHitDamage, UseKey: p.UseKey(), SkillKey: p.SkillKey(), Owner: p.Owner(), Target: parent.targetKey,
		PriorQualifiedContacts: priorContacts, Ability: ability, Plan: plan, AbilityRef: f.abilityRef, ReplacesPrimary: p.ReplacesPrimary(),
		Identity: hit.Identity{SchemaHash: f.run.compiled.SchemaHash, RulesHash: f.run.compiled.RulesHash, SessionID: f.run.req.SessionID},
	}, f)
	f.empowered.RecordOutput(f.abilityRef, f.numeric.Facts().Damage-beforeDamage, f.numeric.Facts().Healing-beforeHealing)
	f.numeric.SetTotals(beforeDamage, beforeHealing)
	f.abilityRef, f.castOrigin, f.eventCtx = savedRef, savedOrigin, savedContext
	return err

}

// The validated shield's own consumption listener is lowered into this group,
// rather than independently committed or dispatched a second time afterwards.
func (f *Frame) stageEmpoweredSpellShield(freeze *frozenSkillHitContext) *model.EngineError {
	f.empowered.ClaimShield(freeze.View().ShieldOwner, freeze.View().ShieldProviderRef)
	context := *f.eventCtx
	context.EventType, context.HasSkillHit, context.SkillHit = model.EventTypeSpellShieldBlocked, true, freeze.FrozenFacts()
	event := emittedEvent{eventType: model.EventTypeSpellShieldBlocked, sourceKey: freeze.View().SourceKey, targetKey: freeze.View().TargetKey, types: []string{model.EventTypeSpellShieldBlocked}, snapshot: context, skillHit: freeze}
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: model.EventTypeSpellShieldBlocked, Data: skillHitEvidenceData(freeze)}
	})
	facts := listenerpkg.EventMatchFacts{EventType: event.eventType, SourceKey: event.sourceKey, TargetKey: event.targetKey,
		Types: f.run.eventTypeSet(event.types), HasBlockedHit: true, ShieldOwner: freeze.View().ShieldOwner, ShieldProviderRef: freeze.View().ShieldProviderRef}
	if err := listenerpkg.ConsumeAttachedShield(&f.run.listeners, listenerpkg.AttachedShieldInput{Event: facts,
		Bindings: f.run.compiled.RuntimeTypes, Compiled: f.run.compiled.Listeners, Operations: f.run.compiled.Operations,
		Abilities: f.run.compiled.Abilities, ShieldOwner: freeze.View().ShieldOwner, ShieldProviderRef: freeze.View().ShieldProviderRef}, &context, f); err != nil {
		return err
	}
	// The removed shield listener is no longer live at dispatch; unrelated
	// blocked-event listeners still receive their ordinary post-commit event.
	f.pendingEvents = append(f.pendingEvents, event)
	return nil
}

func (s *Engine) reserveEmpoweredAttackStart(useRef, target string) *model.EngineError {
	attack, use := s.actions.BasicAttack(), s.skillUses[useRef]
	facts := hit.CountedStartFacts{}
	if attack != nil {
		facts.HasAttack, facts.Owner, facts.SkillKey = true, attack.Plan().Source, attack.Plan().SkillKey
		if current := attack.Current(); current != nil {
			facts.HasCurrent, facts.CurrentUse, facts.StartedAt, facts.Ready, facts.Target = true, current.UseRef(), current.StartAtMs(), current.ReadyAtMs() != nil, current.Target()
		}
	}
	if use != nil {
		facts.HasUse, facts.UseSource, facts.UseSkill, facts.AlreadyReserved = true, use.identity.Source(), use.identity.SkillKey(), use.identity.EmpoweredReference().Present
	}
	prepared, err := hit.PrepareCountedStart(facts, useRef, target, s.loop.TimeMs(), s, s.hitIdentity())
	if err != nil || prepared.Original == nil {
		return err
	}
	selected, changes := prepared.Original, prepared.Changes
	p := changes.View()
	var frame Frame
	s.initExecutionFrame(&frame, p.Owner(), p.Target(), p.AbilityRef())
	frame.empowered = &empoweredFrame{}
	if err := hit.StageCountedStart(frame.empowered, prepared, use.identity, s.loop.TimeMs(), &frame); err != nil {
		return err
	}
	frame.recordEvidenceLazy("empowered_attack_consumed", func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: "empowered_attack_consumed", Ref: p.AbilityRef(),
			Data: map[string]interface{}{"owner": p.Owner(), "providerRef": p.ProviderRef(), "processKey": p.ProcessKey(), "activationUseRef": p.UseKey(), "useRef": useRef, "target": target, "consumptionIndex": p.WindowConsumed(), "remaining": p.WindowMaximum() - p.WindowConsumed()}}
	})
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	return s.publishProcessResolved(selected)
}

func (s *Engine) finishCountedEmpoweredWindow(original *actionpkg.ProcessView) *model.EngineError {
	prepared := hit.PrepareCountedCompletion(original)
	if prepared.Changes == nil {
		return nil
	}
	p := prepared.Changes.View()
	var frame Frame
	s.initExecutionFrame(&frame, p.Owner(), p.Target(), p.AbilityRef())
	frame.empowered = &empoweredFrame{}
	if err := hit.StageCountedCompletion(frame.empowered, prepared, s.loop.TimeMs(), &frame); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	return s.publishProcessResolved(original)
}

func (s *Engine) executeReservedEmpoweredAttack(ev emittedEvent, depth int) *model.EngineError {
	if ev.skillHit == nil {
		return nil
	}
	use := s.skillUses[ev.skillHit.View().UseRef]
	if use == nil || !use.identity.EmpoweredReference().Present {
		return nil
	}
	original := s.actions.Process(use.identity.EmpoweredReference())
	input := hit.CountedHitInput{Original: original, Index: use.identity.EmpoweredConsumption(), UseKey: use.identity.UseKey(),
		UseSource: use.identity.Source(), EventSource: ev.sourceKey, Target: ev.targetKey, Facts: ev.skillHit.View(), NowMs: s.loop.TimeMs()}
	if original != nil {
		input.Mounted = s.processMounted(original.Owner(), original.ProviderRef(), original.Ability().ProviderIndex)
		input.History = s.empoweredActivationHistory(original.UseKey())
	}
	prepared, err := hit.PrepareCountedHit(input, s.hitIdentity())
	if err != nil || prepared.Changes == nil {
		return err
	}
	p := prepared.Changes.View()
	var frame Frame
	s.initExecutionFrame(&frame, ev.sourceKey, ev.targetKey, ev.skillHit.AbilityRef())
	frame.empowered = &empoweredFrame{}
	frame.chainDepth, frame.strictReads = depth, true
	if err := hit.ExecuteCountedPayload(frame.empowered, ev, prepared, s.compiled.Abilities[p.EmpoweredAbilityIndex()], &frame); err != nil {
		return err
	}
	frame.commit()
	if frame.fatal {
		return frame.fatalErr
	}
	if err := frame.dispatchPendingEvents(); err != nil {
		return err
	}
	return s.publishProcessResolved(original)
}

// Only the native attack continuation may close a reserved use without a hit.
// Expiring/completing the empowerment window itself never guesses a miss.
func (s *Engine) finishReservedEmpoweredMiss(useRef string) *model.EngineError {
	use := s.skillUses[useRef]
	if use == nil || !use.identity.EmpoweredReference().Present {
		return nil
	}
	attack := s.actions.BasicAttack()
	facts := hit.CountedMissFacts{UseSource: use.identity.Source(), UseSkill: use.identity.SkillKey()}
	if attack != nil {
		facts.HasAttack, facts.Owner, facts.SkillKey = true, attack.Plan().Source, attack.Plan().SkillKey
		if current := attack.Current(); current != nil {
			facts.HasCurrent, facts.CurrentUse, facts.Completed, facts.HasHit = true, current.UseRef(), current.Completed(), current.HitAtMs() != nil
		}
	}
	p := s.actions.Process(use.identity.EmpoweredReference())
	if err := hit.ValidateCountedMiss(useRef, facts, p, s.hitIdentity()); err != nil {
		return err
	}
	if !s.actions.ResolveEmpoweredMiss(p, use.identity.EmpoweredConsumption(), s.loop.TimeMs()) {
		return nil
	}
	return s.publishProcessResolved(p)
}

func (s *Engine) bindBasicAttackPrimary(ability planbundle.CompiledAbility, provider string) *model.EngineError {
	b := s.actions.BasicAttack()
	native := b.Plan()
	binding, found, err := hit.PrepareNativePrimary(hit.NativePrimaryInput{
		Plan: s.compiled.Operations[ability.OperationStart].SkillHit, Bindings: s.compiled.SkillActionBindings,
		Owner: native.Source, Provider: provider, Definition: s.compiled.Providers[ability.ProviderIndex].ProviderKey,
		StartAbilityRef: native.StartAbilityRef, InitialControlAbilityRef: native.InitialControlAbilityRef, HitAbilityRef: native.HitAbilityRef,
	}, s, s.hitIdentity())
	if err != nil || !found {
		return err
	}
	s.actions.BindPrimary(binding.Candidate, binding.Plan, binding.Identity)
	return nil
}

func (s *Engine) executePrimaryReplacement(ev emittedEvent, freeze *frozenSkillHitContext, candidate int, depth int) (bool, *model.EngineError) {
	prepared, err := hit.PreparePrimaryReplacement(hit.PrimaryReplacementInput{Context: freeze, Candidate: candidate,
		EventType: ev.eventType, Source: ev.sourceKey, Target: ev.targetKey, NowMs: s.loop.TimeMs()}, s, s.hitIdentity())
	if err != nil || prepared.Changes == nil {
		return false, err
	}
	p := prepared.Changes.View()
	payload := s.compiled.Abilities[p.EmpoweredAbilityIndex()]
	var storage Frame
	s.initExecutionFrame(&storage, ev.sourceKey, ev.targetKey, freeze.AbilityRef())
	f := &storage
	f.empowered, f.chainDepth, f.strictReads = &empoweredFrame{}, depth, true
	if err := hit.ExecutePrimaryReplacement(f.empowered, ev, freeze, prepared, payload, s.loop.TimeMs(), f); err != nil {
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
	previous, exists := f.run.actions.BasicAttack().Replacement(p.PrimaryReplacementBinding(), association.Target)
	return hit.StagePrimaryReplacement(f.empowered, p, payload, f.run.compiled.Providers[payload.ProviderIndex].ProviderKey,
		association, f.numeric.Facts().Damages[start:], previous, exists, f.run.hitIdentity())
}

func (s *Engine) commitPrimaryReplacement(row model.BasicAttackPrimaryReplacement, binding uint16) {
	s.actions.CommitPrimaryReplacement(row, binding)
}
