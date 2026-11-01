package execution

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type pendingShieldExpire struct {
	combatantKey string
	shieldRef    string
	expireAt     int64
}

func (f *Frame) stageLifecycleCostCooldown(ability planbundle.CompiledAbility, sourceKey string) *model.EngineError {
	if ability.Cost != nil && ability.Cost.HasAmount {
		amount, err := f.evalAmount(ability.Cost.AmountProgram, ability)
		if err != nil {
			return err
		}
		if err := f.applyResourceChange(sourceKey, ability.Cost.ResourceKey, -amount, ability); err != nil {
			return err
		}
	}
	if ability.Cooldown != nil && ability.Cooldown.HasDuration {
		duration, err := f.evalAmount(ability.Cooldown.DurationProgram, ability)
		if err != nil {
			return err
		}
		readyAt := f.run.loop.TimeMs() + int64(duration)
		return f.applyCooldownChange(sourceKey, f.abilityRef, readyAt)
	}
	return nil
}

func (f *Frame) evalShieldDuration(op planbundle.CompiledOperation, ability planbundle.CompiledAbility) (int64, *model.EngineError) {
	wasStrict := f.strictReads
	f.strictReads = true
	ctx := f.evalContext(ability)
	f.strictReads = wasStrict
	path := "shieldDurationMs"
	if int(op.ShieldDurationProgram) < len(f.run.formulas.Programs) {
		path = f.run.formulas.Programs[op.ShieldDurationProgram].Key
	}
	value, err := f.run.formulas.EvalContext(op.ShieldDurationProgram, &ctx)
	if err != nil {
		return 0, f.preserveFormulaIssue(err, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, err.Error(), path, op.ShieldRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID))
	}
	if !formula.ValidPositiveInt64DurationMs(value) {
		return 0, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "shieldDurationMs must be a positive integer within the timestamp range", path, op.ShieldRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	delta := int64(value)
	expireAt, ok := addDuration(f.run.loop.TimeMs(), delta)
	if !ok || expireAt <= f.run.loop.TimeMs() {
		return 0, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "shieldDurationMs expiry overflows the timestamp range", path, op.ShieldRef, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return expireAt, nil
}

func (f *Frame) enqueueCommittedTimedShields() {
	for _, pending := range f.pendingShieldExpires {
		if pending.expireAt <= 0 || pending.shieldRef == "" {
			continue
		}
		c, ok := f.run.combatants[pending.combatantKey]
		if !ok {
			continue
		}
		for instanceIndex, instanceValues := 0, c.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			sh := instanceValues.At(instanceIndex)
			if sh.ShieldRef != pending.shieldRef {
				continue
			}
			if sh.ExpireAt > 0 {
				f.run.enqueueExpireCleanup(pending.expireAt, effectpkg.ExpiryPayload{
					CombatantKey: pending.combatantKey,
					ShieldRef:    pending.shieldRef,
					Kind:         "shield",
				})
			}
			break
		}
	}
}
