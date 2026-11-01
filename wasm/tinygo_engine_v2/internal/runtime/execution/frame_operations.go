package execution

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (f *Frame) executeOperations(ability planbundle.CompiledAbility, ops []planbundle.CompiledOperation) *model.EngineError {
	if f.chainDepth > f.run.budget.MaxChainDepth {
		f.fatal = true
		f.fatalErr = f.run.budgetError(model.BudgetCauseMaxChainDepth, "max chain depth exceeded")
		return f.fatalErr
	}
	for index := range ops {
		op := &ops[index]
		if f.fatal {
			return f.fatalErr
		}
		if op.HasCondition {
			cond, err := f.evalAmount(op.ConditionProgram, ability)
			if err != nil {
				f.fatal = true
				f.fatalErr = err
				return err
			}
			if cond == 0 {
				continue
			}
		}
		if err := f.executeOperation(ability, op); err != nil {
			f.fatal = true
			f.fatalErr = err
			return err
		}
	}
	return nil
}

func (f *Frame) bumpCommandBudget() *model.EngineError {
	if f.run.actions.AttackActive() || f.run.initializationEventActive || f.run.hasSkillPlan() || f.run.compiled.HasTargetTiming {
		return f.run.consumeEventCommands(1)
	}
	if f.copyableCollector != nil {
		f.copyableCollector.commandCount++
		if f.copyableCollector.commandCount > f.run.budget.MaxCommandsPerEvent {
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
	if err := f.bumpCommandBudget(); err != nil {
		return err
	}
	if op.ColdResourceMax {
		return f.skipInstalledPermanentResourceMax(*op)
	}
	if (f.run.compiled.HasResourceMax || f.run.compiled.HasCooldownDuration || f.run.compiled.HasProviderDurationChange || f.run.compiled.HasStagedLinkedShield || f.run.compiled.HasModifierSnapshots) && op.Operation != "apply_provider" && op.Operation != "refresh_provider" && op.Operation != "expire_provider" {
		f.flushDynamicProviders()
		if f.fatal {
			return f.fatalErr
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
		return nil
	}

	// repeat：允许空 target；仅登记 deferred request，不解析 combatant target。
	if op.Operation == model.OperationKindRepeat {
		return f.registerDeferredRepeat(*op)
	}

	targetKey, ok := f.run.resolveOperationTarget(op.Target, f.sourceKey, f.targetKey)
	if !ok {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}

	switch op.Operation {
	case model.OperationKindConsumeTargetMark:
		return f.consumeTargetMark(*op, ability)
	case model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		return f.applyLink(ability, *op, targetKey)
	case "damage", "heal", "shield":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, op.Operation+" requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		if op.Operation == "shield" {
			amount, err = f.applyReceivedShieldModifiers(targetKey, amount, ability)
			if err != nil {
				return err
			}
			if op.HasShieldLifecycleProvider {
				return f.stageLifecycleShield(*op, ability, targetKey, amount)
			}
			sc := f.stageFor(targetKey)
			ref := op.ShieldRef
			if ref == "" {
				ref = "shield:auto"
			}
			expireAt := int64(0)
			if op.HasShieldDuration {
				var err *model.EngineError
				expireAt, err = f.evalShieldDuration(*op, ability)
				if err != nil {
					return err
				}
				ref = f.run.nextShieldRef(ref)
			}
			f.run.reserveShieldRef(ref)
			sc.instances.SetShields(sc.instances.Shields().Append(effectpkg.Shield{
				ShieldRef: ref,
				Source:    f.sourceKey,
				Owner:     targetKey,
				Remaining: amount,
				Priority:  0,
				ExpireAt:  expireAt,
				State:     effectpkg.ObjectState(map[string]interface{}{}),
			}))
			if expireAt > 0 {
				f.pendingShieldExpires = append(f.pendingShieldExpires, pendingShieldExpire{
					combatantKey: targetKey,
					shieldRef:    ref,
					expireAt:     expireAt,
				})
			}
			sc.dirty = true
			return nil
		}
		if op.Operation == "damage" {
			// Ordering: expected crit (branch pipeline) → outgoing_pre_mitigation →
			// resistance → incoming_crit_part_post_mitigation → incoming_post_mitigation →
			// shields/HP. CopyableOnHit freezes the post-crit / pre-outgoing amount.
			critEv, amount, critMods, err := f.settleExpectedCrit(*op, ability, amount, targetKey)
			if err != nil {
				return err
			}
			if err := f.maybeCollectCopyableDamage(*op, ability, amount, targetKey, critEv); err != nil {
				return err
			}
			cmd := pipeline.Command{
				Kind:       pipeline.KindDamage,
				Source:     f.sourceKey,
				Target:     targetKey,
				Amount:     amount,
				DamageType: op.DamageType,
				Ref:        op.AttributeKey,
			}
			return f.applyDamageCommand(cmd, *op, critEv, ability, critMods)
		}
		operationRef := op.Ref
		if operationRef == "" {
			operationRef = op.Path
		}
		cmd := pipeline.Command{
			Kind:       pipeline.CommandKind(op.Operation),
			Source:     f.sourceKey,
			Target:     targetKey,
			Amount:     amount,
			DamageType: op.DamageType,
			Ref:        operationRef,
		}
		return f.applyCommand(cmd, *op, ability)
	case "resource_change":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		return f.applyResourceOperation(targetKey, amount, *op, ability)
	case "attribute_change":
		if !op.HasAmount {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "attribute_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if op.AttributeKey == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "attribute_change requires attributeKey", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		amount, err := f.evalAmount(op.AmountProgram, ability)
		if err != nil {
			return err
		}
		return f.applyAttributeChange(targetKey, op.AttributeKey, op.ValuePolicy, amount, ability)
	case "cooldown_change":
		if op.ValuePolicy == "reduce_total_ratio" {
			return f.applyTotalCooldownRatioRefund(*op, ability)
		}
		cooldownKey := f.abilityRef
		if op.HasAbilityRef && op.AbilityRefStr != "" {
			cooldownKey = normalizeAbilityRef(op.AbilityRefStr, f.sourceKey, f.targetKey)
		}
		ownerPrefix := combatantPrefixFromAbilityRef(cooldownKey)
		ownerKey, ok := ownerPrefix, f.run.combatantExists(ownerPrefix)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "operation target unavailable", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		existing := f.run.loop.TimeMs()
		sc := f.stageFor(ownerKey)
		if readyAt := sc.cooldowns.AbilityReadyAt(ownerKey, cooldownKey); readyAt > 0 {
			existing = readyAt
		}
		readyAt := f.run.loop.TimeMs()
		switch op.ValuePolicy {
		case "set_remaining":
			if !op.HasAmount {
				return f.run.processErr("operation.cooldown_change.amount", "set_remaining requires amount", cooldownKey)
			}
			duration, err := f.evalAmount(op.AmountProgram, ability)
			if err != nil {
				return err
			}
			var valid bool
			readyAt, valid = actionpkg.ProcessTimeAfter(f.run.loop.TimeMs(), duration, true)
			if !valid {
				return f.run.processErr("operation.cooldown_change.amount", "set_remaining requires finite non-negative integer milliseconds and safe timestamp addition", cooldownKey)
			}
		case "reset":
			readyAt = f.run.loop.TimeMs()
		case "reduce", "refund":
			if !op.HasAmount {
				return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "cooldown_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
			}
			duration, err := f.evalAmount(op.AmountProgram, ability)
			if err != nil {
				return err
			}
			readyAt = existing - int64(duration)
			if readyAt < f.run.loop.TimeMs() {
				readyAt = f.run.loop.TimeMs()
			}
		case "extend":
			if !op.HasAmount {
				return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "cooldown_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
			}
			duration, err := f.evalAmount(op.AmountProgram, ability)
			if err != nil {
				return err
			}
			base := existing
			if base < f.run.loop.TimeMs() {
				base = f.run.loop.TimeMs()
			}
			readyAt = base + int64(duration)
		default:
			if op.HasAmount {
				duration, err := f.evalAmount(op.AmountProgram, ability)
				if err != nil {
					return err
				}
				readyAt = f.run.loop.TimeMs() + int64(duration)
			} else {
				readyAt = f.run.loop.TimeMs()
			}
		}
		if readyAt < f.run.loop.TimeMs() {
			readyAt = f.run.loop.TimeMs()
		}
		return f.applyCooldownChange(ownerKey, cooldownKey, readyAt)
	case "apply_provider":
		if op.ProviderDefinitionRef == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "apply_provider requires providerDefinitionRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		if err := f.validateImmediatePeriodicApplication(*op); err != nil {
			return err
		}
		prepared, err := f.prepareProviderMutation(op.ProviderDefinitionRef, "", f.sourceKey, targetKey, ability)
		if err != nil {
			return err
		}
		sc := f.stageFor(targetKey)
		sc.providerOps = append(sc.providerOps, stagedProviderMutation{
			kind:          "apply",
			useRef:        f.skillActionUseRef(),
			definitionRef: op.ProviderDefinitionRef,
			targetKey:     targetKey,
			sourceKey:     f.sourceKey,
			expireAt:      prepared.expireAt,
			hasExpireAt:   prepared.hasExpireAt,
			contributions: prepared.contributions,
		})
		f.dynamicProviderDirty = true
		sc.dirty = true
		return nil
	case "provider_duration_change":
		return f.applyProviderEnsureRemaining(*op)
	case "refresh_provider":
		if op.ProviderRef == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "refresh_provider requires providerRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		prepared, err := f.prepareProviderMutation("", op.ProviderRef, f.sourceKey, targetKey, ability)
		if err != nil {
			return err
		}
		sc := f.stageFor(targetKey)
		sc.providerOps = append(sc.providerOps, stagedProviderMutation{
			kind:          "refresh",
			useRef:        f.skillActionUseRef(),
			providerRef:   op.ProviderRef,
			targetKey:     targetKey,
			sourceKey:     f.sourceKey,
			expireAt:      prepared.expireAt,
			hasExpireAt:   prepared.hasExpireAt,
			contributions: prepared.contributions,
		})
		f.dynamicProviderDirty = true
		sc.dirty = true
		return nil
	case "expire_provider":
		if op.ProviderRefFromEvent {
			return f.expireProviderFromEvent(*op)
		}
		if op.ProviderRef == "" {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "expire_provider requires providerRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		sc := f.stageFor(targetKey)
		sc.providerOps = append(sc.providerOps, stagedProviderMutation{
			kind:        "expire",
			providerRef: op.ProviderRef,
			targetKey:   targetKey,
			sourceKey:   f.sourceKey,
		})
		f.dynamicProviderDirty = true
		sc.dirty = true
		return nil
	case "emit_event":
		eventType := op.EventType
		if eventType == "" {
			eventType = op.Ref
		}
		if model.IsEngineProducedEvent(eventType) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "emit_event cannot forge engine-produced skill hit events", "eventType", eventType, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		ref := op.Ref
		if ref == "" {
			ref = eventType
		}
		if ref == "" {
			ref = "event:auto"
		}
		f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
			emitData := map[string]interface{}{
				"source": f.sourceKey, "target": targetKey, "eventType": eventType,
			}
			attachCastProvenance(emitData, f.castInstanceID, f.castOrigin)
			return model.EvidenceItem{
				TimeMs: f.run.loop.TimeMs(),
				Kind:   model.EvidenceKindEmittedEvent,
				Ref:    ref,
				Data:   emitData,
			}
		})
		types := []string{}
		if eventType != "" {
			types = append(types, eventType)
		}
		types = f.appendCastOriginEventType(types)
		f.pendingEvents = append(f.pendingEvents, emittedEvent{
			eventType:      eventType,
			ref:            ref,
			sourceKey:      f.sourceKey,
			targetKey:      targetKey,
			types:          types,
			snapshot:       f.captureEmitSnapshot(eventType, f.sourceKey, targetKey),
			castInstanceID: f.castInstanceID,
			castOrigin:     f.castOrigin,
		})
		return nil
	case "state_change":
		return f.applyStateChange(*op, ability)
	case model.OperationKindStateDurationChange:
		return f.applyStateDurationChange(*op, ability)
	case model.OperationKindExecuteThreshold:
		return f.applyExecuteThreshold(*op, targetKey, ability)
	case model.OperationKindResolveSkillHit:
		return f.resolveSkillHit(*op, ability)
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "unknown operation: "+op.Operation, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
}

func isSkillHitBlockedWrite(op string) bool {
	switch op {
	case "damage", "apply_provider", "refresh_provider", "provider_duration_change", "attribute_change", "resource_change", "cooldown_change", "heal", "shield", model.OperationKindApplyAttackLink, model.OperationKindApplyHitLink:
		return true
	default:
		return false
	}
}

// applyExecuteThreshold 仅在真实 event/basic_attack_hit 的 emit snapshot 上判定；
// 命中后经 command/pipeline 置零 live HP，不写 damage summary/evidence，不 emit。
func (f *Frame) applyExecuteThreshold(op planbundle.CompiledOperation, targetKey string, ability planbundle.CompiledAbility) *model.EngineError {
	// Fail closed：无 event context 或非 basic_attack_hit 不触发。
	if f.eventCtx == nil || f.eventCtx.eventType != eventTypeBasicAttackHit {
		return nil
	}
	snapCurrent := attribute.ReadAttr(f.eventCtx.targetAttrs, "hp.current")
	snapMax := attribute.ReadAttr(f.eventCtx.targetAttrs, "hp.max")
	if snapMax <= 0 {
		snapMax = attribute.ReadHPMax(f.eventCtx.targetAttrs)
	}
	if snapMax <= 0 || math.IsNaN(snapMax) || math.IsInf(snapMax, 0) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "execute_threshold requires positive snapshot max HP", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	ratio := snapCurrent / snapMax
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || !(ratio < op.Threshold) {
		return nil
	}

	sc := f.stageFor(targetKey)
	liveHP := attribute.ReadAttr(sc.attributesView(), "hp.current")
	if liveHP <= 0 || math.IsNaN(liveHP) || math.IsInf(liveHP, 0) {
		return nil
	}

	cmd := pipeline.Command{
		Kind:          pipeline.KindExecuteThreshold,
		Source:        f.sourceKey,
		Target:        targetKey,
		Ref:           op.Ref,
		Threshold:     op.Threshold,
		SnapshotHP:    snapCurrent,
		SnapshotMaxHP: snapMax,
	}
	if !pipeline.ValidateCommand(cmd) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "execute_threshold target unavailable", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}

	viewAttributes, viewShields := sc.attributesView(), sc.instances.Shields()
	outcome, nextAttributes, nextShields := viewShields.ExecuteThreshold(cmd, viewAttributes)

	sc.setAttributes(nextAttributes)
	sc.instances.SetShields(nextShields)
	if !outcome.Applied {
		return nil
	}
	f.reResolveStagedAttributesTwoPass(ability)
	sc.dirty = true

	f.recordGenericExecuteEvidence(genericExecuteEvidence{
		source:       cmd.Source,
		target:       cmd.Target,
		providerRef:  f.ownerProviderRef,
		abilityRef:   f.abilityRef,
		operationRef: op.Ref,
		hpBefore:     outcome.HPBefore,
		maxHp:        snapMax,
		hpRatio:      ratio,
		threshold:    op.Threshold,
		killed:       outcome.Killed,
		shieldBypass: outcome.ShieldBypassed,
	})
	return nil
}

func (f *Frame) recordOperationOutput(op planbundle.CompiledOperation, outcome pipeline.DamageOutcome) {
	if op.OutputRef == "" {
		return
	}
	if f.operationOutputs == nil {
		f.operationOutputs = map[string]formula.OperationOutputValues{}
	}
	f.operationOutputs[op.OutputRef] = formula.OperationOutputValues{
		PostDefenseDamage: outcome.MitigatedAmount,
		ShieldAbsorbed:    outcome.ShieldAbsorbed,
		ActualHPLoss:      outcome.HPDamage,
	}
}

func (f *Frame) applyCommand(cmd pipeline.Command, op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	if cmd.Kind == pipeline.KindDamage {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "damage command bypassed authored defense settlement", op.Path+".damageType", cmd.DamageType, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if cmd.Kind == pipeline.KindHeal {
		return f.applyDirectHeal(cmd, op, ability)
	}
	sc := f.stageFor(cmd.Target)
	viewAttributes, viewShields := sc.attributesView(), sc.instances.Shields()
	result, nextAttributes, nextShields := viewShields.ResolveCommand(cmd, viewAttributes, f.run.loop.TimeMs())

	sc.setAttributes(nextAttributes)
	sc.instances.SetShields(nextShields)

	switch cmd.Kind {
	case pipeline.KindHeal:
		f.healingDone += result.Amount
		overheal := cmd.Amount - result.Amount
		if overheal < 0 {
			overheal = 0
		}
		if overheal > 0 {
			f.recordOverheal(cmd.Source, overheal)
		}
		f.reResolveStagedAttributesTwoPass(ability)
	}
	return nil
}
