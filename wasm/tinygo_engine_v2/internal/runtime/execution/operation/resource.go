package operation

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (f *calculation) applyResourceChange(targetKey, resourceKey string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	if resourceKey == "" {
		return engineErrorPtr(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires resourceKey", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}
	sc := f.stageFor(targetKey)
	if _, ok := sc.resourceView().Lookup(resourceKey); !ok && f.input.StrictReads {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "resource_change requires an explicit resource slot", "combatants."+targetKey+".resources."+resourceKey, resourceKey, f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
	}
	if amount >= 0 {
		if slot, valid := pipeline.RefundSlot(sc.resourceView().At(resourceKey), amount); valid {
			sc.Numbers.SetResource(resourceKey, slot)
		}
	} else {
		slot, exists := sc.resourceView().Lookup(resourceKey)
		next, ok := pipeline.SpendSlot(slot, exists, -amount)
		if !ok {
			return engineErrorPtr(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "resource spend failed", f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
		}
		sc.Numbers.SetResource(resourceKey, next)
	}
	f.reResolveStagedAttributesTwoPass(ability)
	return nil
}

func (f *calculation) applyAttributeChange(targetKey, attributeKey, valuePolicy string, amount float64, ability planbundle.CompiledAbility) *model.EngineError {
	sc := f.stageFor(targetKey)
	slot, ok := sc.attributesView().Lookup(attributeKey)
	if !ok {
		if f.input.StrictReads {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "attribute_change requires an explicit attribute slot", "combatants."+targetKey+".attributes."+attributeKey, attributeKey, f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
		}
		slot = model.AttributeSlotDef{}
	}
	base0 := slot.Base
	nextBase := applyAttributeBasePolicy(slot.Base, base0, valuePolicy, amount)
	if math.IsNaN(nextBase) || math.IsInf(nextBase, 0) {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
			"attribute change result must remain finite", "combatants."+targetKey+".attributes."+attributeKey+".base", attributeKey,
			f.executor.plan.SchemaHash, f.executor.plan.RulesHash, f.executor.sessionID)
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
	*sc.Dirty = true
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
