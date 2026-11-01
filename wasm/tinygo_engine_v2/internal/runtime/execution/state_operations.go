package execution

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (f *Frame) applyStateChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	if op.TargetMarkWriterRef != "" {
		if err := f.validateTargetMarkWriter(op); err != nil {
			return err
		}
	}
	if f.ownerProviderRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "state_change requires provider context", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.Ref == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "state_change requires ref state key", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if !op.HasAmount {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "state_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	scope := op.StateScope
	if scope == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "state_change requires supported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !effectpkg.FiniteState(amount) {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "non-finite state result", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	ownerKey := f.providerOwnerKey()
	bag := f.providerStateBag(ownerKey, f.ownerProviderRef, true)
	bag.Ensure()
	if field, exists := bag.Fields().Lookup(op.Ref); exists && field.StateKind == model.ProviderStateKindCooldown {
		return f.applyInternalCooldownStateChange(op, ability, amount)
	}
	switch scope {
	case stateScopeProvider:
		bag.LazyExpireProviderState(f.run.loop.TimeMs())
		before := bag.State().At(op.Ref)
		next, message := bag.NextStateValue(op.Ref, bag.State().At(op.Ref), amount, op.ValuePolicy)
		if message != "" {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		bag.SetStateValue(op.Ref, next)
		ammoField := op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(f.run.compiled.Providers) && f.run.compiled.Providers[op.OwnerProviderIndex].StateFields[op.Ref].StateKind == model.ProviderStateKindAmmo
		if ammoField {
			if err := f.stageAmmoConsumption(op, ability, before, next); err != nil {
				return err
			}
		}
		if !bag.RefreshExpireAtOnWrite(op.Ref, f.run.loop.TimeMs()) {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "provider state duration overflow", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		generation := uint64(0)
		if bag.Fields().At(op.Ref).HasOnExpire {
			generation = bag.RearmSourceExpiry(op.Ref, bag.ExpireAt().At(op.Ref))
		}
		if expires := bag.ExpireAt().At(op.Ref); expires > 0 && (f.run.automatedRun() || generation > 0) {
			f.pendingStateExpiry = append(f.pendingStateExpiry, pendingFrameStateExpiry{at: expires, payload: effectpkg.ExpiryPayload{
				Kind: "provider_source_state", CombatantKey: ownerKey, ProviderRef: f.ownerProviderRef, StateKey: op.Ref, ExpectedExpireAt: expires, StateGeneration: generation,
			}})
		}
		// Provider-scope write must immediately re-resolve owner attributes with provider-aware context.
		sc := f.stageFor(ownerKey)
		sc.setAttributes(f.resolveAttributesFor(ownerKey, sc.attributesView(), f.evalContext(ability)))
		f.reResolveStagedAttributesTwoPass(ability)
		if ammoField {
			if f.fatal {
				return f.fatalErr
			}
			ammo := f.run.findAmmo(ownerKey, f.ownerProviderRef, op.Ref)
			if ammo != nil && (next == 0 || ammo.Definition().StateFields[op.Ref].AmmoRecovery.OneByOne) {
				if err := f.stageAmmoRecoveryFor(ammo, ability, -1); err != nil {
					return err
				}
			}
		}
	case stateScopeProviderTarget:
		// Order: lazy-expire -> activate -> seed this key's default -> policy -> cap -> refresh.
		bag.LazyExpireProviderTargetState(f.run.loop.TimeMs())
		f.activateProviderTarget(bag, ownerKey, f.ownerProviderRef, f.targetKey)
		bag.SeedTargetValueIfAbsent(op.Ref)
		current := bag.ReadTargetValue(op.Ref)
		next, message := bag.NextStateValue(op.Ref, current, amount, op.ValuePolicy)
		if message != "" {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, op.Path+".amount", op.Ref, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		bag.SetTargetValue(op.Ref, next)
		exp, ok := bag.RefreshTargetExpireAtOnWrite(op.Ref, f.run.loop.TimeMs())
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "provider target state duration overflow", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		handled, timingErr := f.stageTargetTimingWrite(ownerKey, f.ownerProviderRef, f.targetKey, op.Ref, next, exp, bag)
		if timingErr != nil {
			return timingErr
		}
		if exp > 0 && !handled {
			f.stageProviderTargetStateExpiry(ownerKey, f.ownerProviderRef, f.targetKey, op.Ref, exp)
			if err := f.stageAnchoredTicksOnTargetWrite(ownerKey, f.ownerProviderRef, f.sourceKey, f.targetKey, op.Ref, exp, bag); err != nil {
				return err
			}
		}
		// Re-resolve host of opponent-mounted modifiers (carve target) and owner if needed.
		evalCtx := f.evalContext(ability)
		if f.targetKey != "" {
			tsc := f.stageFor(f.targetKey)

			tsc.setAttributes(f.resolveAttributesFor(f.targetKey, tsc.attributesView(), evalCtx))
			tsc.dirty = true
		}
		if ownerKey != f.targetKey {
			osc := f.stageFor(ownerKey)

			osc.setAttributes(f.resolveAttributesFor(ownerKey, osc.attributesView(), evalCtx))
		}
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "unsupported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	f.stageFor(ownerKey).dirty = true
	return nil
}

func (f *Frame) applyStateDurationChange(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	if f.ownerProviderRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "state_duration_change requires provider context", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.Ref == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "state_duration_change requires ref state key", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if !op.HasAmount {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "state_duration_change requires amount", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.ValuePolicy == "ensure_remaining_preserve_phase" {
		return f.ensurePhasedTargetRemaining(op, ability)
	}
	if op.ValuePolicy == "ensure_remaining" {
		return f.ensureTargetStateRemaining(op, ability)
	}
	if op.ValuePolicy != "subtract" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "state_duration_change requires valuePolicy=subtract", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if op.Target != model.SelectorSource && op.Target != model.SelectorSelf {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrOperationTargetMissing, "state_duration_change target must be source or self", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	scope := op.StateScope
	if scope == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "state_duration_change requires supported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	// Frozen order: lazy-expire -> inactive timer no-op -> evaluate amount -> validate -> round/subtract.
	// Inactive / exactly-expired timers must not evaluate a failing amount formula.
	ownerKey := f.providerOwnerKey()
	bag := f.providerStateBag(ownerKey, f.ownerProviderRef, true)
	bag.Ensure()
	nowMs := f.run.loop.TimeMs()
	if op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(f.run.compiled.Providers) && f.run.compiled.Providers[op.OwnerProviderIndex].StateFields[op.Ref].StateKind == model.ProviderStateKindAmmo {
		return f.applyAmmoDurationChange(op, ability)
	}
	if field, exists := bag.Fields().Lookup(op.Ref); exists && field.StateKind == model.ProviderStateKindCooldown {
		return f.applyInternalCooldownDurationChange(op, ability)
	}
	switch scope {
	case stateScopeProvider:
		bag.LazyExpireProviderState(nowMs)
		exp, ok := bag.ExpireAt().Lookup(op.Ref)
		if !ok || exp <= 0 {
			return nil
		}
	case stateScopeProviderTarget:
		bag.LazyExpireProviderTargetState(nowMs)
		if bag.TargetKey() == "" {
			return nil
		}
		exp, ok := bag.TargetExpireAt().Lookup(op.Ref)
		if !ok || exp <= 0 {
			return nil
		}
	default:
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrUnknownTypeKey, "unsupported state scope", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	amount, err := f.evalAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !effectpkg.FiniteState(amount) || amount < 0 {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "state_duration_change amount must be finite and non-negative", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	deltaMs := int64(math.Round(amount))
	switch scope {
	case stateScopeProvider:
		applied, expired, newExp := bag.SubtractProviderExpireAt(op.Ref, nowMs, deltaMs)
		if !applied {
			return nil
		}
		if expired {
			def, hasDef := bag.Fields().Lookup(op.Ref)
			defaultValue := 0.0
			if hasDef {
				defaultValue = def.DefaultValue
			}
			bag.SetStateValue(op.Ref, defaultValue)
			sc := f.stageFor(ownerKey)

			sc.setAttributes(f.resolveAttributesFor(ownerKey, sc.attributesView(), f.evalContext(ability)))
		}
		_ = newExp
	case stateScopeProviderTarget:
		applied, expired, newExp := bag.SubtractTargetExpireAt(op.Ref, nowMs, deltaMs)
		if !applied {
			return nil
		}
		evalCtx := f.evalContext(ability)
		if expired {
			def, hasDef := bag.Fields().Lookup(op.Ref)
			defaultValue := 0.0
			if hasDef {
				defaultValue = def.DefaultValue
			}
			bag.SetTargetValue(op.Ref, defaultValue)
			if f.targetKey != "" {
				tsc := f.stageFor(f.targetKey)

				tsc.setAttributes(f.resolveAttributesFor(f.targetKey, tsc.attributesView(), evalCtx))
				tsc.dirty = true
			}
			if ownerKey != f.targetKey {
				osc := f.stageFor(ownerKey)

				osc.setAttributes(f.resolveAttributesFor(ownerKey, osc.attributesView(), evalCtx))
			}
		} else if newExp > 0 {
			f.stageProviderTargetStateExpiry(ownerKey, f.ownerProviderRef, bag.TargetKey(), op.Ref, newExp)
		}
	}
	f.stageFor(ownerKey).dirty = true
	return nil
}

func (f *Frame) applyResourceChange(targetKey, resourceKey string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	if resourceKey == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires resourceKey", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	sc := f.stageFor(targetKey)
	if _, ok := sc.resourceView().Lookup(resourceKey); !ok && f.strictReads {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires an explicit resource slot", "combatants."+targetKey+".resources."+resourceKey, resourceKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if amount >= 0 {
		if slot, valid := pipeline.RefundSlot(sc.resourceView().At(resourceKey), amount); valid {
			sc.numbers.SetResource(resourceKey, slot)
		}
	} else {
		slot, exists := sc.resourceView().Lookup(resourceKey)
		next, ok := pipeline.SpendSlot(slot, exists, -amount)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "resource spend failed", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		sc.numbers.SetResource(resourceKey, next)
	}
	f.reResolveStagedAttributesTwoPass(ability)
	return nil
}

func (f *Frame) applyCooldownChange(targetKey, abilityRef string, readyAt int64) *model.EngineError {
	if abilityRef == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "cooldown_change requires abilityRef", f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	if ref, valid := planbundle.ParseAbilityRef(abilityRef); valid && f.run.combatantExists(ref.Combatant) {
		targetKey = ref.Combatant
	}
	sc := f.stageFor(targetKey)
	sc.writableCooldowns().Set(actionpkg.AbilityCooldownIdentity(targetKey, abilityRef), readyAt, f.run.loop.TimeMs())
	return nil
}

func (f *Frame) applyAttributeChange(targetKey, attributeKey, valuePolicy string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	sc := f.stageFor(targetKey)
	slot, ok := sc.attributesView().Lookup(attributeKey)
	if !ok {
		if f.strictReads {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "attribute_change requires an explicit attribute slot", "combatants."+targetKey+".attributes."+attributeKey, attributeKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
		slot = model.AttributeSlotDef{}
	}
	base0 := slot.Base
	nextBase := applyAttributeBasePolicy(slot.Base, base0, valuePolicy, amount)
	if math.IsNaN(nextBase) || math.IsInf(nextBase, 0) {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"attribute change result must remain finite", "combatants."+targetKey+".attributes."+attributeKey+".base", attributeKey,
			f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	slot.Base = nextBase
	if slot.Max > 0 {
		if slot.Base < 0 {
			slot.Base = 0
		}
		if slot.Base > slot.Max {
			slot.Base = slot.Max
		}
	}

	sc.setAttributes(sc.attributesView().With(attributeKey, slot))
	f.reResolveStagedAttributesTwoPass(ability)
	sc.dirty = true
	return nil
}

func applyAttributeBasePolicy(current, base0 float64, policy string, amount float64) float64 {
	switch policy {
	case "set", "override_base":
		return amount
	case "multiply":
		return current * amount
	case "percent_add":
		return current + base0*amount
	case "min":
		return math.Min(current, amount)
	case "max":
		return math.Max(current, amount)
	case "add", "":
		return current + amount
	default:
		return current + amount
	}
}
