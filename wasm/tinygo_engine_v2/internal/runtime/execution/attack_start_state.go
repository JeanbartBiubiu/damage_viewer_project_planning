package execution

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type attackProviderStateCapture struct {
	providerRef string
	values      []formula.ProviderStateBeforeValue
}

// Called after successful native attack admission but before any START listener.
// Runs with no allocation for sessions that have no capture readers.
func (f *Frame) captureAttackStartState(use *skillUseRuntime) *model.EngineError {
	if !f.run.compiled.HasAttackStartStateReads {
		return nil
	}
	if use == nil || use.identity.Source() != f.sourceKey || len(use.providerStateBefore) != 0 {
		return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "attack-start counter capture requires its fresh original use", "attackStartFacts", "")
	}
	var captures []attackProviderStateCapture
	for _, actor := range f.run.compiled.Combatants {
		if actor.Key != use.identity.Source() {
			continue
		}
		for _, mount := range actor.ProviderMounts {
			provider := f.run.compiled.Providers[mount.DefinitionIndex]
			if len(provider.AttackStartStateKeys) == 0 {
				continue
			}
			bag := f.providerStateBagForRead(use.identity.Source(), mount.ProviderRef, false, effectpkg.ReadOptions{})
			capture := attackProviderStateCapture{providerRef: mount.ProviderRef, values: make([]formula.ProviderStateBeforeValue, 0, len(provider.AttackStartStateKeys))}
			for _, key := range provider.AttackStartStateKeys {
				field := provider.StateFields[key]
				value := field.DefaultValue
				if bag.Present() {
					if current, exists := bag.State().Lookup(key); exists {
						value = current
					}
				}
				if !effectpkg.ValidStateInteger(value) || value < 0 || field.HasCap && value > field.MaxValue {
					return f.run.skillHitErr(model.GenericErrRuntimeInvariantFailed, "attack-start counter value must be a finite owned integer", "attackStartFacts", key)
				}
				capture.values = append(capture.values, formula.ProviderStateBeforeValue{StateKey: key, Value: value})
			}
			captures = append(captures, capture)
		}
	}
	use.providerStateBefore = captures
	return nil
}

func (f *Frame) populateAttackStartStateContext(ctx *formula.GenericEvalContext) {
	if !f.run.compiled.HasAttackStartStateReads || f.eventCtx == nil || !f.eventCtx.hasUse || (f.eventCtx.eventType != model.EventTypeBasicAttackStart && f.eventCtx.eventType != model.EventTypeBasicAttackHit) {
		return
	}
	owner := f.providerOwnerKey()
	use := f.run.skillUses[f.eventCtx.useKey]
	if use == nil || owner != use.identity.Source() || owner != f.eventCtx.eventSourceKey || owner != f.eventCtx.useSource || f.ownerProviderRef == "" {
		return
	}
	for _, capture := range use.providerStateBefore {
		if capture.providerRef == f.ownerProviderRef {
			ctx.UseProviderStateBefore = capture.values
			return
		}
	}
}
