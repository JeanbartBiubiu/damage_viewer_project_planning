package runtime

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func (f *executionFrame) captureProcessStartState() *model.EngineError {
	p := f.pendingProcess
	if p == nil || len(p.definition.StartStateKeys) == 0 {
		return nil
	}
	if !p.hasEmpoweredAbility || f.ownerProviderRef != p.ProviderRef || f.providerOwnerKey() != p.Owner {
		return f.run.processErr(p.definition.Path, "process start capture requires its actual empowered use", p.UseKey)
	}
	bag := f.providerStateBagForRead(p.Owner, p.ProviderRef, true, providerStateReadOptions{})
	if bag == nil {
		return f.run.processErr(p.definition.Path, "process start capture state is missing", p.UseKey)
	}
	values := make([]formula.ProcessStartStateValue, len(p.definition.StartStateKeys))
	for i, key := range p.definition.StartStateKeys {
		value, present := bag.state[key]
		field, declared := bag.fieldDefs[key]
		if !present || !declared || field.valueType != model.ProviderStateValueInteger || field.stateKind != "" || value < 0 || math.Trunc(value) != value || value > float64(maxJSONSafeInteger) || math.IsNaN(value) || math.IsInf(value, 0) {
			return f.run.processErr(p.definition.Path+".startState."+key, "process start capture requires its actual explicit safe integer SET value", key)
		}
		values[i] = formula.ProcessStartStateValue{StateKey: key, Value: value}
	}
	p.startStateValues = values
	return nil
}
