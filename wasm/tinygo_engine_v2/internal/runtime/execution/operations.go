// 同帧数值与专用操作接线，以及数值事实到原事件的交接。
package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	contractpkg "tinygo_engine_v2/internal/runtime/contract"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
	"tinygo_engine_v2/internal/runtime/execution/admission"
	"tinygo_engine_v2/internal/runtime/execution/operation"
)

type frozenCritEvidence = contractpkg.CritEvidence

type damageNumbers = operation.DamageNumbers

type operationReads Frame

type healingOutcome = operation.HealingOutcome

var _ operation.EventHost = (*operationReads)(nil)

var _ operation.ReceivedShieldReads = (*operationReads)(nil)

func (f *Frame) applyLink(ability planbundle.CompiledAbility, op planbundle.CompiledOperation, target string) *model.EngineError {
	executor := f.operationExecutor()
	return executor.ApplyLink(&f.numeric, f.operationInput(), (*operationReads)(f), (*operationReads)(f), op, ability, target)
}

func (f *Frame) emitAuthoredEvent(op planbundle.CompiledOperation, target string) *model.EngineError {
	executor := f.operationExecutor()
	return executor.Emit(f.operationInput(), (*operationReads)(f), op, target)
}

func (r *operationReads) AuthoredEventBudget() (int, int) {
	f := (*Frame)(r)
	return f.run.budget.MaxCommandsPerEvent - f.commandsSpent(), f.run.budget.MaxEvents
}

func (r *operationReads) ConsumeAuthoredEventCommands(count int) *model.EngineError {
	return (*Frame)(r).consumeCommands(count)
}

func (r *operationReads) AuthoredEventBudgetError(cause model.BudgetCause, message string) *model.EngineError {
	return (*Frame)(r).run.budgetError(cause, message)
}

func (r *operationReads) AppendAuthoredEvent(ability planbundle.CompiledAbility, event operation.AuthoredEvent) {
	f := (*Frame)(r)
	types := []string{}
	if event.EventType != "" {
		types = append(types, event.EventType)
	}
	if event.InheritAbilityTypes {
		types = append(types, f.abilityTypeKeys(ability)...)
	}
	snapshot := f.captureEmitSnapshot(event.EventType, event.Source, event.Target)
	if event.HasLink {
		snapshot.HasLink, snapshot.LinkIndex, snapshot.LinkCount = true, event.LinkIndex, event.LinkCount
	}
	emitted := emittedEvent{eventType: event.EventType, ref: event.Ref, sourceKey: event.Source, targetKey: event.Target,
		types: f.appendCastOriginEventType(types), snapshot: snapshot, castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
		hasUse: event.HasUse, useKey: event.UseKey, useSource: event.UseSource, useSkillKey: event.UseSkillKey}
	attachUseToSnapshot(&emitted)
	f.pendingEvents = append(f.pendingEvents, emitted)
}

func (r *operationReads) RecordAuthoredEventEvidence(kind model.EvidenceKind, item model.EvidenceItem) {
	f := (*Frame)(r)
	if !f.run.detailedOutput() {
		f.recordEvidenceKind(kind)
		return
	}
	f.recordEvidence(item)
}

// recordDamageContribution 不重新结算，复制与监听子帧保持原边界。
func (f *Frame) recordDamageContribution(cmd pipeline.Command, result pipeline.CommandResult, operationRef, operationPath string) *model.EngineError {
	if (f.chainDepth != 0 && !f.rootSkillHitDamage) || result.Amount <= 0 {
		return nil
	}
	if _, declared := f.run.compiled.RuntimeTypes.DamageDealt.Lookup(); !declared {
		return nil
	}
	return f.run.operations.DamageContribution(&f.numeric, cmd, result, operationRef, operationPath)
}

// maybeQueueDamageDealtEvent 由根帧及本次根命中的候选提交调用，每帧最多合成一次。
// 聚合金额只写证据，不建立 event.damage 数值上下文。
func (f *Frame) maybeQueueDamageDealtEvent(ability planbundle.CompiledAbility) {
	aggregation := f.numeric.Aggregation()
	if (f.chainDepth != 0 && !f.rootSkillHitDamage) || aggregation.MitigatedAmount <= 0 {
		return
	}
	if _, declared := f.run.compiled.RuntimeTypes.DamageDealt.Lookup(); !declared {
		return
	}
	eventTypes := []string{eventTypeDamageDealt}
	for _, contribution := range aggregation.ByType {
		eventTypes = append(eventTypes, contribution.DamageType)
	}
	if id, declared := f.run.compiled.RuntimeTypes.BasicAttack.Lookup(); declared && ability.TypeSet.Contains(id) {
		if _, declared := f.run.compiled.RuntimeTypes.DamageDealtBasicAttack.Lookup(); declared {
			eventTypes = append(eventTypes, eventTypeDamageDealtBasicAttack)
		}
	}
	if f.run.detailedOutput() {
		damageTypes := make([]string, len(aggregation.ByType))
		breakdown := make([]map[string]interface{}, len(aggregation.ByType))
		for index, contribution := range aggregation.ByType {
			damageTypes[index] = contribution.DamageType
			breakdown[index] = map[string]interface{}{
				"damageType": contribution.DamageType, "rawAmount": contribution.RawAmount,
				"mitigatedAmount": contribution.MitigatedAmount,
				"operationRefs":   append([]string(nil), contribution.OperationRefs...),
			}
		}
		data := map[string]interface{}{
			"source": f.sourceKey, "target": f.targetKey, "eventType": eventTypeDamageDealt,
			"abilityRef": f.abilityRef, "rawAmount": aggregation.RawAmount,
			"mitigatedAmount": aggregation.MitigatedAmount, "phantom": false,
			"damageTypes": damageTypes, "damageBreakdown": breakdown,
		}
		if len(damageTypes) == 1 {
			data["damageType"] = damageTypes[0]
		}
		attachCastProvenance(data, f.castInstanceID, f.castOrigin)
		if f.rootSkillHitDamage && f.eventCtx != nil && f.eventCtx.HasUse {
			data["useRef"], data["skillKey"] = f.eventCtx.UseKey, f.eventCtx.UseSkillKey
		}
		if f.empoweredAttack != nil && f.empoweredAttack.ReplacedPrimary != nil {
			data["empoweredAttack"] = f.empoweredAttack
		}
		if len(aggregation.OperationRefs) == 1 {
			if aggregation.OperationRefs[0] != "" {
				data["operationRef"] = aggregation.OperationRefs[0]
			}
		} else if len(aggregation.OperationRefs) > 1 {
			data["operationRefs"] = append([]string(nil), aggregation.OperationRefs...)
		}
		f.recordEvidence(model.EvidenceItem{
			TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: eventTypeDamageDealt, Data: data,
		})
	} else {
		f.recordEvidenceKind(model.EvidenceKindEmittedEvent)
	}
	event := emittedEvent{
		eventType: eventTypeDamageDealt, ref: eventTypeDamageDealt,
		sourceKey: f.sourceKey, targetKey: f.targetKey,
		types:          f.appendCastOriginEventType(eventTypes),
		snapshot:       f.captureEmitSnapshot(eventTypeDamageDealt, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
	}
	if f.rootSkillHitDamage && f.eventCtx != nil && f.eventCtx.HasUse {
		event.hasUse = true
		event.useKey, event.useSource, event.useSkillKey = f.eventCtx.UseKey, f.eventCtx.UseSource, f.eventCtx.UseSkillKey
	}
	f.pendingEvents = append(f.pendingEvents, event)
}

func (f *Frame) executeOperations(ability planbundle.CompiledAbility, ops []planbundle.CompiledOperation) *model.EngineError {
	if f.chainDepth > f.run.budget.MaxChainDepth {
		f.fatal = true
		f.fatalErr = f.run.budgetError(model.BudgetCauseMaxChainDepth, "max chain depth exceeded")
		return f.fatalErr
	}
	executor := f.operationExecutor()
	err := executor.Execute(&f.numeric, f.operationInput(), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), ability, ops)
	if err != nil {
		f.fatal, f.fatalErr = true, err
	}
	return err
}

func (f *Frame) bumpCommandBudget() *model.EngineError {
	if f.run.actions.AttackActive() || f.run.effectInitialization.Active() || f.run.hasSkillPlan() || f.run.compiled.HasTargetTiming {
		return f.run.consumeEventCommands(1)
	}
	if f.copyableCollector != nil {
		f.copyableCollector.SetCommands(f.copyableCollector.Commands() + 1)
		if f.copyableCollector.Commands() > f.run.budget.MaxCommandsPerEvent {
			return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
		}
		return nil
	}
	f.commandCount++
	if f.commandCount > f.run.budget.MaxCommandsPerEvent {
		return f.run.budgetError(model.BudgetCauseMaxCommandsPerEvent, "max commands per event exceeded")
	}
	return nil
}

func (f *Frame) executeOperation(ability planbundle.CompiledAbility, op *planbundle.CompiledOperation) *model.EngineError {
	executor := f.operationExecutor()
	return executor.ExecuteOne(&f.numeric, f.operationInput(), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), ability, op)
}

func (r *operationReads) PrepareNumericOperation(op *planbundle.CompiledOperation) (bool, *model.EngineError) {
	f := (*Frame)(r)
	if err := f.bumpCommandBudget(); err != nil {
		return false, err
	}
	if op.ColdResourceMax {
		return true, f.skipInstalledPermanentResourceMax(*op)
	}
	if (f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange || f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasModifierSnapshots) && op.Operation != "apply_provider" && op.Operation != "refresh_provider" && op.Operation != "expire_provider" {
		f.flushDynamicProviders()
		if f.fatal {
			return false, f.fatalErr
		}
	}

	if f.skipBlockedWrites && isSkillHitBlockedWrite(op.Operation) {
		f.recordEvidenceLazy(model.EvidenceKindSkillHitSkip, func() model.EvidenceItem {
			return model.EvidenceItem{
				TimeMs: f.run.loop.TimeMs(),
				Kind:   model.EvidenceKindSkillHitSkip,
				Ref:    f.skillHitCandidateKey,
				Path:   f.abilityRef,
				Data: map[string]interface{}{
					"occurrenceId": float64(f.skillHitOccurrenceID),
					"candidateKey": f.skillHitCandidateKey,
					"operation":    op.Operation,
				},
			}
		})
		return true, nil
	}

	return false, nil
}

func (r *operationReads) ResolveNumericTarget(selector string) (string, bool) {
	f := (*Frame)(r)
	return f.run.resolveOperationTarget(selector, f.sourceKey, f.targetKey)
}

func (r *operationReads) CollectNumericDamage(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64, target string, crit frozenCritEvidence) *model.EngineError {
	return (*Frame)(r).maybeCollectCopyableDamage(op, ability, amount, target, crit)
}

func (r *operationReads) DispatchSpecializedOperation(ability planbundle.CompiledAbility, op *planbundle.CompiledOperation, targetKey string, amount float64) *model.EngineError {
	f := (*Frame)(r)
	switch op.Operation {
	case model.OperationKindConsumeTargetMark:
		return f.consumeTargetMark(*op, ability)
	case model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		return f.applyLink(ability, *op, targetKey)
	case model.OperationKindRepeat:
		return f.registerDeferredRepeat(*op)
	case "heal":
		ref := op.Ref
		if ref == "" {
			ref = op.Path
		}
		return f.applyDirectHeal(pipeline.Command{Kind: pipeline.KindHeal, Source: f.sourceKey, Target: targetKey, Amount: amount, DamageType: op.DamageType, Ref: ref}, *op, ability)
	case "shield":
		return f.stageOperationShield(*op, ability, targetKey, amount)
	case "resource_change":
		return f.applyResourceOperation(targetKey, amount, *op, ability)
	case "cooldown_change":
		return f.applyActionCooldown(*op, ability)
	case "apply_provider", "refresh_provider", "expire_provider":
		return f.stageProviderOperation(*op, ability, targetKey)
	case "provider_duration_change":
		return f.applyProviderEnsureRemaining(*op)
	case "emit_event":
		return f.emitAuthoredEvent(*op, targetKey)
	case "state_change":
		return f.applyStateChange(*op, ability)
	case model.OperationKindStateDurationChange:
		return f.applyStateDurationChange(*op, ability)
	case model.OperationKindResolveSkillHit:
		return f.resolveSkillHit(*op, ability)

	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unknown operation: "+op.Operation, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
}

func (f *Frame) stageOperationShield(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, target string, amount float64) *model.EngineError {
	if op.HasShieldLifecycleProvider {
		return f.stageLifecycleShield(op, ability, target, amount)
	}
	staged := f.stageFor(target)
	executor := f.run.lifecycleExecutor()
	expiry, err := executor.StageUnlinkedShield(op, ability, f.sourceKey, target, amount, &staged.instances, (*lifecycleShieldPreparation)(f))
	if err != nil {
		return err
	}
	if expiry.ExpireAt > 0 {
		f.pendingShieldExpires = append(f.pendingShieldExpires, pendingShieldExpire{combatantKey: expiry.CombatantKey, shieldRef: expiry.ShieldRef, expireAt: expiry.ExpireAt})
	}
	staged.dirty = true
	return nil
}

func isSkillHitBlockedWrite(op string) bool {
	switch op {
	case "damage", "apply_provider", "refresh_provider", "provider_duration_change", "attribute_change", "resource_change", "cooldown_change", "heal", "shield", model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		return true
	default:
		return false
	}
}

func (s *Engine) isIncomingCappedFlatParent(provider planbundle.CompiledProvider, owner, providerRef string) bool {
	return admission.IncomingCappedFlatParent(s.compiled.IncomingCappedFlatSources, s.compiled.Providers, provider.ProviderKey, owner, providerRef)
}

func (s *Engine) isIncomingCappedFlatInitializer(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	return admission.IncomingCappedFlatInitializer(s.compiled.IncomingCappedFlatSources, s.compiled.Providers, listener, operation)
}

func (s *Engine) initIncomingCappedFlatSources() *model.EngineError {
	if len(s.compiled.IncomingCappedFlatSources) == 0 {
		return nil
	}
	input := s.admissionInput(model.SelectorSource)
	if err := admission.ValidateIncomingCappedFlatScene(input, admission.IncomingCappedFlatScene{
		Snapshot: s.req.InitialSnapshot, Start: s.loop.StartMs(), Duration: s.loop.DurationMs(), StopOnDeath: s.req.StopPolicy.StopOnTargetDeathOrDefault(),
		ExternalFacts: len(s.req.DriverPlan.Entries) + len(s.req.SkillUses) + len(s.req.AttackStartFacts) + len(s.req.SkillHitFacts) +
			len(s.req.ProcessCommandFacts) + len(s.req.InitialSnapshot.ProcessInstances) + len(s.req.InitialSnapshot.UseTriggerLedger),
	}); err != nil {
		return err
	}
	for _, binding := range s.compiled.IncomingCappedFlatSources {
		planAllowed := true
		if admission.IncomingCappedFlatRequiresPlan(s.compiled.Providers, binding) {
			planAllowed = s.incomingCappedFlatActivePlanned(binding)
		}
		if err := admission.ValidateIncomingCappedFlatSource(input, s.req.InitialSnapshot.Combatants, binding, planAllowed); err != nil {
			return err
		}
	}
	return nil
}

// Cold admission only: the compiled closure cannot authorize an unused active
// graph, an arbitrary driver entry, or a caller-supplied use/fact.
func (s *Engine) incomingCappedFlatActivePlanned(source planbundle.CompiledIncomingCappedFlatSource) bool {
	return actionflow.IncomingCappedFlatActivePlanned(source, s.compiled.Providers, s.compiled.Abilities, &s.actions)
}

func (r *operationReads) NumericOwner(key string) operation.Owner {
	sc := (*Frame)(r).stageFor(key)
	return operation.Owner{Numbers: &sc.numbers, Instances: &sc.instances, Dirty: &sc.dirty}
}

func (r *operationReads) NumericContext(ability planbundle.CompiledAbility) formula.GenericEvalContext {
	return (*Frame)(r).evalContext(ability)
}

func (r *operationReads) NumericEntryAttributes(key string) attribute.Table {
	f := (*Frame)(r)
	if key == f.sourceKey {
		return f.entrySourceAttrs
	}
	if key == f.targetKey {
		return f.entryTargetAttrs
	}
	attrs, _ := f.snapshotCombatantMaps(key)
	return attrs
}

func (r *operationReads) NumericProviderContext(host, target string, strict bool) pipeline.ProviderFormulaContextFunc {
	return (*Frame)(r).providerFormulaContextForTarget(host, target, strict)
}

func (r *operationReads) NumericAbilityTypes(ability planbundle.CompiledAbility) []string {
	return (*Frame)(r).abilityTypeKeys(ability)
}

func (f *Frame) operationExecutor() *operation.Executor { return &f.run.operations }

func (f *Frame) operationInput() operation.Input {
	return operation.Input{Source: f.sourceKey, Target: f.targetKey, AbilityRef: f.abilityRef, ProviderRef: f.ownerProviderRef, CastOrigin: f.castOrigin, CastInstanceID: f.castInstanceID, TimeMs: f.run.loop.TimeMs(), DefenseContext: f.damageDefenseContext, Event: f.eventCtx, StrictReads: f.strictReads, StrictProviders: f.strictReads || f.skillHitOccurrenceID != 0 || (f.eventCtx != nil && f.eventCtx.HasSkillHit), SkillHitOccurrenceID: f.skillHitOccurrenceID,
		ProcessUseKey: f.processUseKey, ProcessUseSource: f.processUseSource, ProcessUseSkill: f.processUseSkillKey}
}

func (f *Frame) settleExpectedCrit(op planbundle.CompiledOperation, ability planbundle.CompiledAbility, amount float64, target string) (frozenCritEvidence, float64, []map[string]interface{}, *model.EngineError) {
	executor := f.operationExecutor()

	crit, value, mods, err := executor.ExpectedCrit(&f.numeric, f.operationInput(), (*operationReads)(f), op, ability, amount, target)

	return crit, value, mods, err
}

func (f *Frame) resolveDamageNumbers(cmd pipeline.Command, op planbundle.CompiledOperation, crit frozenCritEvidence, ability planbundle.CompiledAbility, mods []map[string]interface{}) (damageNumbers, *model.EngineError) {
	executor := f.operationExecutor()

	value, err := executor.DamageNumbers(&f.numeric, f.operationInput(), (*operationReads)(f), cmd, op, crit, ability, mods)

	return value, err
}

func (f *Frame) applyPipelineDamageModifiers(host, source, target, command, stage string, amount float64, ability planbundle.CompiledAbility, damageType string, traits []string, evidence []map[string]interface{}) (float64, []map[string]interface{}, *model.EngineError) {
	executor := f.operationExecutor()

	value, mods, err := executor.PipelineModifiers(&f.numeric, f.operationInput(), (*operationReads)(f), host, source, target, command, stage, amount, ability, damageType, traits, evidence)

	return value, mods, err
}

func (r *operationReads) CaptureDamageBefore(source, target string) ([]frozenDamageStateBefore, *model.EngineError) {
	return (*Frame)(r).captureDamageStateBefore(source, target)
}

func (r *operationReads) BindDamageAbsorptions(snapshot *pipeline.ShieldAbsorptionSnapshot, target string, total float64) *model.EngineError {
	return (*Frame)(r).bindReceivedShieldAbsorptions(snapshot, target, total)
}

func (r *operationReads) SettleDamageDepletion() *model.EngineError {
	return (*Frame)(r).settleDepletedShieldAttributes()
}

func (r *operationReads) ResolveNumericAttributes(ability planbundle.CompiledAbility) {
	(*Frame)(r).reResolveStagedAttributesTwoPass(ability)
}

func (r *operationReads) RecordNumericEvidence(kind model.EvidenceKind, item model.EvidenceItem) {
	f := (*Frame)(r)
	if !f.run.detailedOutput() {
		f.recordEvidenceKind(kind)
		return
	}
	f.recordEvidence(item)
}

func (r *operationReads) RecordNumericDamage(value genericDamageEvidence) {
	(*Frame)(r).recordGenericDamageEvidence(value)
}

func (r *operationReads) NextNumericDamageID() uint64 { return (*Frame)(r).nextDamageID() }

func (r *operationReads) RecordNumericBefore(before []frozenDamageStateBefore, id uint64, target string) {
	(*Frame)(r).recordDamageStateBefore(before, id, target)
}

func (r *operationReads) FinishNumericDamage(value operation.DamageApplied) *model.EngineError {
	f := (*Frame)(r)
	f.queueDamageTaken(value.Command, value.Operation, value.Ability, value.Crit, value.BaseRaw, value.Raw, value.Outcome, value.Killed, value.DamageID)
	if err := f.recordDamageContribution(value.Command, value.Result, value.Operation.Ref, value.Operation.Path); err != nil {
		return err
	}
	f.maybeQueueDamageInstanceEvent(value.Command, value.Operation, value.Ability, value.Crit, value.BaseRaw, value.Raw, value.Result.Amount, value.Killed, value.Before, value.DamageID)
	return nil
}

func (f *Frame) applyDamageCommand(cmd pipeline.Command, op planbundle.CompiledOperation, crit frozenCritEvidence, ability planbundle.CompiledAbility, mods []map[string]interface{}) *model.EngineError {
	executor := f.operationExecutor()
	return executor.ApplyDamage(&f.numeric, f.operationInput(), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), cmd, op, crit, ability, mods)
}

func (f *Frame) applyResourceChange(target, resource string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	executor := f.operationExecutor()
	return executor.ResourceChange(&f.numeric, f.operationInput(), (*operationReads)(f), (*operationReads)(f), target, resource, amount, ability)
}

func (f *Frame) applyAttributeChange(target, key, policy string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	executor := f.operationExecutor()
	return executor.AttributeChange(&f.numeric, f.operationInput(), (*operationReads)(f), (*operationReads)(f), target, key, policy, amount, ability)
}

func (r *operationReads) NumericFailure() (bool, *model.EngineError) {
	f := (*Frame)(r)
	return f.fatal, f.fatalErr
}

func (r *operationReads) RecordNumericExecute(value genericExecuteEvidence) {
	(*Frame)(r).recordGenericExecuteEvidence(value)
}

func (s *Engine) dispatchBasicAttackReceived(original emittedEvent, depth int) *model.EngineError {
	if _, declared := s.compiled.RuntimeTypes.BasicAttackReceived.Lookup(); !declared {
		return nil
	}
	received := original
	received.eventType = model.EventTypeBasicAttackReceived
	received.ref = received.eventType
	received.types = []string{received.eventType}
	received.skillHit = nil
	received.snapshot = *cloneEventSnapshot(&original.snapshot)
	received.snapshot.EventType = received.eventType
	s.refreshEmittedEventLiveSnapshot(&received)
	attachUseToSnapshot(&received)
	s.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: received.eventType,
			Data: map[string]interface{}{"source": received.sourceKey, "target": received.targetKey, "useRef": received.useKey, "skillKey": received.useSkillKey}}
	})
	return s.dispatchListeners(received, depth)
}

func (f *Frame) queueDamageTaken(cmd pipeline.Command, operation planbundle.CompiledOperation,
	ability planbundle.CompiledAbility, critical frozenCritEvidence, base, raw float64, outcome pipeline.DamageOutcome, killed float64, damageID uint64) {
	if _, declared := f.run.compiled.RuntimeTypes.DamageTaken.Lookup(); !declared {
		return
	}
	event := emittedEvent{eventType: model.EventTypeDamageTaken, ref: operation.Ref, sourceKey: cmd.Source, targetKey: cmd.Target,
		castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
		snapshot: f.captureEmitSnapshot(model.EventTypeDamageTaken, cmd.Source, cmd.Target)}
	event.types = append([]string{event.eventType, cmd.DamageType}, operation.Types...)
	event.types = append(event.types, f.abilityTypeKeys(ability)...)
	event.types = f.appendCastOriginEventType(event.types)
	event.snapshot.HasDamageSnapshot = true
	event.snapshot.ShieldAbsorptions = outcome.ShieldAbsorptions
	event.snapshot.DamageSnapshot = buildDamageInstanceSnapshot(critical, base, raw, outcome.MitigatedAmount)
	event.snapshot.DamageSnapshot.HasActualHPLoss = true
	event.snapshot.DamageSnapshot.ActualHPLoss = outcome.HPDamage
	event.snapshot.DamageSnapshot.HasKilled, event.snapshot.DamageSnapshot.Killed = true, killed
	event.snapshot.DamageTypeKey = cmd.DamageType
	event.snapshot.DamageTraits = append([]string(nil), operation.Types...)
	event.useKey, event.useSource, event.useSkillKey = f.processUseKey, f.processUseSource, f.processUseSkillKey
	if event.useKey == "" && f.eventCtx != nil && f.eventCtx.HasUse {
		event.useKey, event.useSource, event.useSkillKey = f.eventCtx.UseKey, f.eventCtx.UseSource, f.eventCtx.UseSkillKey
	}
	event.hasUse = event.useKey != ""
	attachUseToSnapshot(&event)
	f.pendingEvents = append(f.pendingEvents, event)
	if f.run.compiled.HasReceivedShieldReads {
		f.recordReceivedShieldDamageTaken(cmd, operation, outcome, killed, damageID, event)
		return
	}
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: event.eventType,
			Data: map[string]interface{}{"source": cmd.Source, "target": cmd.Target, "useRef": event.useKey,
				"skillKey": event.useSkillKey, "operationRef": operation.Ref, "postDefenseDamage": outcome.MitigatedAmount,
				"shieldAbsorbed": outcome.ShieldAbsorbed, "actualHpLoss": outcome.HPDamage, "killed": killed}}
	})
}

// 独立调用使新增身份只在有读取时被闭包捕获，避免旧事件入口参数装箱。
func (f *Frame) recordReceivedShieldDamageTaken(cmd pipeline.Command, operation planbundle.CompiledOperation,
	outcome pipeline.DamageOutcome, killed float64, damageID uint64, event emittedEvent) {
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		data := map[string]interface{}{"source": cmd.Source, "target": cmd.Target, "useRef": event.useKey,
			"skillKey": event.useSkillKey, "operationRef": operation.Ref, "postDefenseDamage": outcome.MitigatedAmount,
			"shieldAbsorbed": outcome.ShieldAbsorbed, "actualHpLoss": outcome.HPDamage, "killed": killed}
		if outcome.ShieldAbsorptions != nil {
			rows := make([]model.ShieldAbsorptionRecord, len(outcome.ShieldAbsorptions.Rows))
			for index, row := range outcome.ShieldAbsorptions.Rows {
				rows[index] = model.ShieldAbsorptionRecord{ShieldRef: row.ShieldRef, DefinitionRef: row.DefinitionRef, LifecycleProviderRef: row.LifecycleProviderRef, Source: row.Source, Owner: row.Owner, RemainingBefore: row.RemainingBefore, RemainingAfter: row.RemainingAfter, Absorbed: row.Absorbed}
			}
			data["damageId"], data["shieldAbsorptions"] = damageID, rows
		}
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindEmittedEvent, Ref: event.eventType,
			Data: data}
	})
}

func validateReceivedShieldInitialSnapshot(compiled planbundle.CompiledSession, req model.RunRequest) *model.EngineError {
	return admission.ValidateReceivedShieldInitialSnapshot(&compiled, req.InitialSnapshot, req.SessionID)
}

func (f *Frame) bindReceivedShieldAbsorptions(snapshot *pipeline.ShieldAbsorptionSnapshot, target string, total float64) *model.EngineError {
	return operation.BindReceivedShieldAbsorptions(operation.ShieldAbsorptionBindingInput{
		Enabled: f.run.compiled.HasReceivedShieldReads, Providers: f.run.compiled.Providers,
		SchemaHash: f.run.compiled.SchemaHash, RulesHash: f.run.compiled.RulesHash, SessionID: f.run.req.SessionID,
	}, (*operationReads)(f), snapshot, target, total)
}

func (f *Frame) ReceivedLinkedShieldAbsorbed(index uint16) (float64, error) {
	return operation.ReceivedLinkedShieldAbsorbed(operation.ReceivedLinkedShieldInput{
		Enabled: f.run.compiled.HasReceivedShieldReads, Providers: f.run.compiled.Providers, Combatants: f.run.compiled.Combatants,
		Event: f.eventCtx, Owner: f.providerOwnerKey(), ProviderRef: f.ownerProviderRef,
	}, (*operationReads)(f), index)
}

func (r *operationReads) ProjectedShieldProvider(owner, provider string) (operation.ShieldProviderIdentity, bool) {
	staged := (*Frame)(r).stageFor(owner)
	instance, _, found := staged.instances.Providers().Find(provider)
	identity := operation.ShieldProviderIdentity{
		DefinitionIndex: instance.DefinitionIndex, Source: instance.Source, Owner: instance.Owner,
		Stacks: instance.Stacks, ExpireAt: instance.ExpireAt,
	}
	if !found {
		for _, mutation := range staged.providerOps {
			if mutation.Kind == "shield_apply" && mutation.ProviderRef == provider {
				identity.DefinitionIndex, identity.Source, identity.Owner, identity.ExpireAt, found = mutation.DefinitionIndex, mutation.SourceKey, mutation.TargetKey, mutation.ExpireAt, true
			}
		}
	}
	return identity, found
}

func (r *operationReads) ActualShieldProvider(owner, provider string) (operation.ShieldProviderIdentity, bool) {
	instance, _, found := (*Frame)(r).run.combatants[owner].instances.Providers().Find(provider)
	return operation.ShieldProviderIdentity{
		DefinitionIndex: instance.DefinitionIndex, Source: instance.Source, Owner: instance.Owner,
		Stacks: instance.Stacks, ExpireAt: instance.ExpireAt,
	}, found
}

func (f *Frame) applyDirectHeal(cmd pipeline.Command, op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	executor := f.operationExecutor()
	return executor.DirectHeal(&f.numeric, f.operationInput(), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), (*operationReads)(f), cmd, op, ability)
}

func (r *operationReads) NumericRecoveryRecipient(target string, op planbundle.CompiledOperation) (bool, *model.EngineError) {
	return (*Frame)(r).checkListenerRecoveryRecipient(target, op)
}

func (r *operationReads) RecordNumericHealing(record model.DirectHealingRecord, op planbundle.CompiledOperation, heal operation.HealingOutcome) {
	f := (*Frame)(r)
	if f.run.compiled.HasResourceMax {
		order := f.run.reserveHealthOrder()
		record.HealthOrder = &order
	}
	if use := f.skillActionUseRef(); use != "" {
		record.UseRef = &use
		if action := f.run.skillActionForUse(use); action != nil {
			instruction := action.Plan().InstructionKey()
			record.InstructionKey = &instruction
		}
	}
	f.numeric.AddHealing(record)
	f.recordEvidenceLazy(model.EvidenceKindHeal, func() model.EvidenceItem {
		data := map[string]interface{}{
			"source": record.Source, "target": record.Target, "category": model.HealDirect,
			"healingBeforeModifiers": heal.Before, "healingAfterDone": heal.AfterDone, "healingAfterModifiers": heal.After,
			"actualHealing": heal.Actual, "overheal": heal.Overheal, "modifiers": heal.Modifiers,
			"hpBefore": record.HpBefore, "hpAfter": record.HpAfter,
		}
		f.attachRecoveryProvenance(data, op)
		return model.EvidenceItem{TimeMs: f.run.loop.TimeMs(), Kind: model.EvidenceKindHeal, Ref: f.abilityRef, Data: data}
	})
}
