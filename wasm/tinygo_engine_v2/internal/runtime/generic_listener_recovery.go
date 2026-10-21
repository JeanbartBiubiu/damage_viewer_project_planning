package runtime

import (
	"math"
	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// This gate belongs to ordinary mounted-listener recovery. Active heals and
// the global healing primitive retain their existing semantics.
func (f *executionFrame) checkListenerRecoveryRecipient(targetKey string, op planbundle.CompiledOperation) (bool, *model.EngineError) {
	if !f.mountedListener {
		return false, nil
	}
	if targetKey != f.ownerCombatantKey {
		return false, engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrUnknownRef, "ordinary listener recovery requires its actual provider owner", op.Path+".target", targetKey, f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
	}
	return attribute.ReadHP(f.stageFor(targetKey).attributes) <= 0, nil
}

func (f *executionFrame) attachRecoveryProvenance(data map[string]interface{}, op planbundle.CompiledOperation) {
	data["owner"], data["providerRef"] = f.providerOwnerKey(), f.ownerProviderRef
	definition := f.providerDefinitionRef
	if definition == "" && op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(f.run.compiled.Providers) {
		definition = f.run.compiled.Providers[op.OwnerProviderIndex].ProviderKey
	}
	data["providerDefinitionRef"], data["abilityRef"] = definition, f.abilityRef
	data["operationRef"], data["operationPath"] = op.Ref, op.Path
	data["useRef"] = nil
	if use := f.skillActionUseRef(); use != "" {
		data["useRef"] = use
	}
}

// Resource costs still call applyResourceChange directly. Only an authored
// positive/zero resource-change operation creates a committed restore fact.
func (f *executionFrame) applyResourceOperation(targetKey string, amount float64, op planbundle.CompiledOperation, ability planbundle.CompiledAbility) *model.EngineError {
	if amount < 0 {
		return f.applyResourceChange(targetKey, op.ResourceKey, amount, ability)
	}
	if skip, err := f.checkListenerRecoveryRecipient(targetKey, op); err != nil || skip {
		return err
	}
	before := f.stageFor(targetKey).resources[op.ResourceKey].Current
	if err := f.applyResourceChange(targetKey, op.ResourceKey, amount, ability); err != nil {
		return err
	}
	after := f.stageFor(targetKey).resources[op.ResourceKey].Current
	f.recordEvidenceLazy("resource_restore", func() model.EvidenceItem {
		data := map[string]interface{}{
			"source": f.sourceKey, "target": targetKey, "resourceKey": op.ResourceKey,
			"requestedAmount": amount, "currentBefore": before, "currentAfter": after,
			"actualDelta": after - before, "overflow": math.Max(0, amount-(after-before)),
		}
		f.attachRecoveryProvenance(data, op)
		ref := op.Ref
		if ref == "" {
			ref = f.abilityRef
		}
		return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "resource_restore", Ref: ref, Data: data}
	})
	return nil
}
