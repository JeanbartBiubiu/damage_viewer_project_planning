package operation

import (
	"math"
	"tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// ResourceMaximum 按已准备的效果贡献调整当前生命及最大值，身份仍由父层在原位置分配。
func (s *Executor) ResourceMaximum(input Input, reads NumericReads, owner string, maximum float64, next effectpkg.ResourceContributions, contributors []model.ResourceChangeContributor, dead bool) (model.ResourceChangeRecord, bool, *model.EngineError) {
	f := calculation{executor: s, input: input, reads: reads}
	sc := f.stageFor(owner)
	hp, exists := sc.attributesView().Lookup("hp")
	if !exists || math.IsNaN(maximum) || math.IsInf(maximum, 0) || maximum < 0 {
		return model.ResourceChangeRecord{}, false, f.processError("combatants."+owner+".attributes.hp.max", "resource maximum is not finite", owner)
	}
	before, oldMax := hp.Current, hp.Max
	delta := maximum - oldMax
	if delta > 0 && hp.Current > 0 && !dead {
		hp.Current += delta
	}
	hp.Current = math.Min(hp.Current, maximum)
	hp.Max, hp.Resolved = maximum, hp.Current
	if math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) {
		return model.ResourceChangeRecord{}, false, f.processError("combatants."+owner+".attributes.hp", "resource current is not finite", owner)
	}

	sc.setAttributes(sc.attributesView().With("hp", hp))
	sc.Instances.SetResourceContributions(next)
	if before == hp.Current && oldMax == maximum {
		return model.ResourceChangeRecord{}, false, nil
	}
	*sc.Dirty = true
	return model.ResourceChangeRecord{TimeMs: f.input.TimeMs, Target: owner, ResourceKey: "hp", CurrentBefore: before, CurrentAfter: hp.Current, CurrentDelta: hp.Current - before, MaxBefore: oldMax, MaxAfter: maximum, MaxDelta: delta, Contributors: contributors}, true, nil
}
