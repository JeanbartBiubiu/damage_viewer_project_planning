package execution

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func (f *Frame) captureProcessStartState() *model.EngineError {
	p := f.pendingProcess
	if p == nil || len(p.Definition().StartStateKeys) == 0 {
		return nil
	}
	if !p.HasEmpoweredAbility() || f.ownerProviderRef != p.ProviderRef() || f.providerOwnerKey() != p.Owner() {
		return f.run.processErr(p.Definition().Path, "process start capture requires its actual empowered use", p.UseKey())
	}
	bag := f.providerStateBagForRead(p.Owner(), p.ProviderRef(), true, effectpkg.ReadOptions{})
	if !bag.Present() {
		return f.run.processErr(p.Definition().Path, "process start capture state is missing", p.UseKey())
	}
	values := make([]formula.ProcessStartStateValue, len(p.Definition().StartStateKeys))
	for i, key := range p.Definition().StartStateKeys {
		value, present := bag.State().Lookup(key)
		field, declared := bag.Fields().Lookup(key)
		if !present || !declared || field.ValueType != model.ProviderStateValueInteger || field.StateKind != "" || value < 0 || math.Trunc(value) != value || value > float64(maxJSONSafeInteger) || math.IsNaN(value) || math.IsInf(value, 0) {
			return f.run.processErr(p.Definition().Path+".startState."+key, "process start capture requires its actual explicit safe integer SET value", key)
		}
		values[i] = formula.ProcessStartStateValue{StateKey: key, Value: value}
	}
	f.processChanges.SetStartStateValues(values)
	return nil
}
