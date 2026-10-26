package execution

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

func (s *Engine) initResourceMaxState() *model.EngineError {
	if !s.report.InitResourceRecords(s.req.RecordBudget, s.compiled.HasResourceMax) {
		return s.processErr("recordBudget.maxResourceChangeRecords", "resource change record budget must be in [0,10000]", "")
	}
	if !s.compiled.HasResourceMax {
		return nil
	}
	for _, key := range []string{"source", "target"} {
		c := s.combatants[key]
		hp, exists := c.attributesView().Lookup("hp")
		if !exists || !hp.HasCurrent() || !hp.HasMax() || math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || hp.Max < 0 || math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) || hp.Current < 0 || hp.Current > hp.Max {
			return s.processErr("initialSnapshot.combatants."+key+".attributes.hp", "resource maximum requires explicit finite valid current/max hp", key)
		}
		for instanceIndex, instanceValues := 0, c.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			inst := instanceValues.At(instanceIndex)
			if s.compiled.Providers[inst.DefinitionIndex].HasResourceMax {
				return s.processErr("initialSnapshot.combatants."+key+".providers", "resource_max instances cannot be restored as a fresh scene", inst.ProviderRef)
			}
		}

		c.setHPMaxAnchor(hp.Max)
		s.combatants[key] = c
	}
	return s.initPermanentResourceMax()
}

func (s *Engine) reserveHealthOrder() uint64 { s.nextHealthOrder++; return s.nextHealthOrder }

func (f *Frame) settleResourceMax(owner string, contributors []model.ResourceChangeContributor) {
	if !f.run.compiled.HasResourceMax {
		return
	}
	sc := f.stageFor(owner)
	next := effectpkg.ResourceContributions{}
	maximum := f.run.combatants[owner].hpMaxAnchorValue()
	for instanceIndex, instanceValues := 0, sc.instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		inst := instanceValues.At(instanceIndex)
		if inst.Expired(f.run.loop.TimeMs()) {
			continue
		}
		p := f.run.compiled.Providers[inst.DefinitionIndex]
		if !p.HasResourceMax {
			continue
		}
		for mi, mod := range p.Modifiers {
			if mod.Kind == "resource_max" {
				maximum += mod.StaticValue
				next = next.Append(effectpkg.ResourceContribution{inst.ProviderRef, inst.Source, inst.ActivationUseRef, inst.DefinitionIndex, uint16(mi), mod.StaticValue})
			}
		}
	}
	for
	// Lazy expiry settles only the contribution. Its original cleanup still owns
	// physical unmounting, evidence and queue accounting.
	instanceIndex, instanceValues := 0, sc.instances.ResourceContributions(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		old := instanceValues.At(instanceIndex)
		if next.Contains(old.ProviderRef, old.ModifierIndex) {
			continue
		}
		found := false
		for _, item := range contributors {
			if item.ProviderRef == old.ProviderRef && item.ModifierKey == f.run.compiled.Providers[old.DefinitionIndex].Modifiers[old.ModifierIndex].ModifierKey {
				found = true
				break
			}
		}
		if !found {
			contributors = append(contributors, f.resourceContributor(old, "expire"))
		}
	}
	hp, exists := sc.attributesView().Lookup("hp")
	if !exists || math.IsNaN(maximum) || math.IsInf(maximum, 0) || maximum < 0 {
		f.fatal = true
		f.fatalErr = f.run.processErr("combatants."+owner+".attributes.hp.max", "resource maximum is not finite", owner)
		return
	}
	before, oldMax := hp.Current, hp.Max
	delta := maximum - oldMax
	if delta > 0 && hp.Current > 0 && !f.run.actions.Dead(owner) {
		hp.Current += delta
	}
	hp.Current = math.Min(hp.Current, maximum)
	hp.Max, hp.Resolved = maximum, hp.Current
	if math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) {
		f.fatal = true
		f.fatalErr = f.run.processErr("combatants."+owner+".attributes.hp", "resource current is not finite", owner)
		return
	}

	sc.setAttributes(sc.attributesView().With("hp", hp))
	sc.instances.SetResourceContributions(next)
	if before == hp.Current && oldMax == maximum {
		return
	}
	sc.dirty = true
	f.pendingResourceChanges = append(f.pendingResourceChanges, model.ResourceChangeRecord{HealthOrder: f.run.reserveHealthOrder(), TimeMs: f.run.loop.TimeMs(), Target: owner, ResourceKey: "hp", CurrentBefore: before, CurrentAfter: hp.Current, CurrentDelta: hp.Current - before, MaxBefore: oldMax, MaxAfter: maximum, MaxDelta: delta, Contributors: contributors})
}

func (f *Frame) resourceContributor(item effectpkg.ResourceContribution, reason string) model.ResourceChangeContributor {
	p := f.run.compiled.Providers[item.DefinitionIndex]
	return model.ResourceChangeContributor{Source: item.Source, ProviderRef: item.ProviderRef, DefinitionRef: p.ProviderKey, ModifierKey: p.Modifiers[item.ModifierIndex].ModifierKey, Reason: reason, UseRef: item.UseRef}
}

func (s *Engine) commitResourceChange(row model.ResourceChangeRecord) {
	s.report.RecordResourceChange(row, s.detailedOutput())
}

func (s *Engine) resourceSummaryOutput() *model.ResourceChangeSummary {
	if !s.compiled.HasResourceMax {
		return nil
	}
	return s.report.ResourceSummary(s.combatants["source"].attributesView().At("hp").Max, s.combatants["target"].attributesView().At("hp").Max)
}

func (s *Engine) settleLiveResourceExpiry() {
	if !s.compiled.HasResourceMax || s.processFailure != nil || s.budgetCause != "" {
		return
	}
	needed := false
	for _, c := range s.combatants {
		for instanceIndex, instanceValues := 0, c.instances.ResourceContributions(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			item := instanceValues.At(instanceIndex)
			inst, _, found := c.instances.Providers().Find(item.ProviderRef)
			if !found || inst.Expired(s.loop.TimeMs()) {
				needed = true
				break
			}
		}
	}
	if !needed {
		return
	}
	var frame Frame
	s.initExecutionFrame(&frame, "source", "target", "resource_expiry_read")
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
