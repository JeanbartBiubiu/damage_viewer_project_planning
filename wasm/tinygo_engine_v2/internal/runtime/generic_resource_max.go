package runtime

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/status"
)

type resourceMaxContribution struct {
	providerRef, source, useRef    string
	definitionIndex, modifierIndex uint16
	value                          float64
}

func (s *genericRunState) initResourceMaxState() *model.EngineError {
	s.maxResourceChangeRecords = 1000
	if b := s.req.RecordBudget; b != nil && b.MaxResourceChangeRecords != nil {
		s.maxResourceChangeRecords = *b.MaxResourceChangeRecords
	}
	if s.maxResourceChangeRecords < 0 || s.maxResourceChangeRecords > 10000 {
		return s.processErr("recordBudget.maxResourceChangeRecords", "resource change record budget must be in [0,10000]", "")
	}
	if !s.compiled.HasResourceMax {
		return nil
	}
	s.resourceChangeSummary = &model.ResourceChangeSummary{}
	s.resourceChangeRecords = []model.ResourceChangeRecord{}
	for _, key := range []string{"source", "target"} {
		c := s.combatants[key]
		hp, exists := c.attributes.Lookup("hp")
		if !exists || !hp.HasCurrent() || !hp.HasMax() || math.IsNaN(hp.Max) || math.IsInf(hp.Max, 0) || hp.Max < 0 || math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) || hp.Current < 0 || hp.Current > hp.Max {
			return s.processErr("initialSnapshot.combatants."+key+".attributes.hp", "resource maximum requires explicit finite valid current/max hp", key)
		}
		for _, inst := range c.providers {
			if s.compiled.Providers[inst.DefinitionIndex].HasResourceMax {
				return s.processErr("initialSnapshot.combatants."+key+".providers", "resource_max instances cannot be restored as a fresh scene", inst.ProviderRef)
			}
		}
		c.hpMaxAnchor = hp.Max
		s.combatants[key] = c
	}
	return s.initPermanentResourceMax()
}

func (s *genericRunState) reserveHealthOrder() uint64 { s.nextHealthOrder++; return s.nextHealthOrder }

func contributionExists(items []resourceMaxContribution, ref string, modifier uint16) bool {
	for _, item := range items {
		if item.providerRef == ref && item.modifierIndex == modifier {
			return true
		}
	}
	return false
}

func (f *executionFrame) settleResourceMax(owner string, contributors []model.ResourceChangeContributor) {
	if !f.run.compiled.HasResourceMax {
		return
	}
	sc := f.stageFor(owner)
	next := []resourceMaxContribution(nil)
	maximum := f.run.combatants[owner].hpMaxAnchor
	for _, inst := range sc.providers {
		if inst.Expired(f.run.nowMs) {
			continue
		}
		p := f.run.compiled.Providers[inst.DefinitionIndex]
		if !p.HasResourceMax {
			continue
		}
		for mi, mod := range p.Modifiers {
			if mod.Kind == "resource_max" {
				maximum += mod.StaticValue
				next = append(next, resourceMaxContribution{inst.ProviderRef, inst.Source, inst.ActivationUseRef, inst.DefinitionIndex, uint16(mi), mod.StaticValue})
			}
		}
	}
	// Lazy expiry settles only the contribution. Its original cleanup still owns
	// physical unmounting, evidence and queue accounting.
	for _, old := range sc.resourceContributions {
		if contributionExists(next, old.providerRef, old.modifierIndex) {
			continue
		}
		found := false
		for _, item := range contributors {
			if item.ProviderRef == old.providerRef && item.ModifierKey == f.run.compiled.Providers[old.definitionIndex].Modifiers[old.modifierIndex].ModifierKey {
				found = true
				break
			}
		}
		if !found {
			contributors = append(contributors, f.resourceContributor(old, "expire"))
		}
	}
	hp, exists := sc.attributes.Lookup("hp")
	if !exists || math.IsNaN(maximum) || math.IsInf(maximum, 0) || maximum < 0 {
		f.fatal = true
		f.fatalErr = f.run.processErr("combatants."+owner+".attributes.hp.max", "resource maximum is not finite", owner)
		return
	}
	before, oldMax := hp.Current, hp.Max
	delta := maximum - oldMax
	if delta > 0 && hp.Current > 0 && !f.run.actionDeaths[owner] {
		hp.Current += delta
	}
	hp.Current = math.Min(hp.Current, maximum)
	hp.Max, hp.Resolved = maximum, hp.Current
	if math.IsNaN(hp.Current) || math.IsInf(hp.Current, 0) {
		f.fatal = true
		f.fatalErr = f.run.processErr("combatants."+owner+".attributes.hp", "resource current is not finite", owner)
		return
	}
	sc.attributes = sc.attributes.With("hp", hp)
	sc.resourceContributions = next
	if before == hp.Current && oldMax == maximum {
		return
	}
	sc.dirty = true
	f.pendingResourceChanges = append(f.pendingResourceChanges, model.ResourceChangeRecord{HealthOrder: f.run.reserveHealthOrder(), TimeMs: f.run.nowMs, Target: owner, ResourceKey: "hp", CurrentBefore: before, CurrentAfter: hp.Current, CurrentDelta: hp.Current - before, MaxBefore: oldMax, MaxAfter: maximum, MaxDelta: delta, Contributors: contributors})
}

func (f *executionFrame) resourceContributor(item resourceMaxContribution, reason string) model.ResourceChangeContributor {
	p := f.run.compiled.Providers[item.definitionIndex]
	return model.ResourceChangeContributor{Source: item.source, ProviderRef: item.providerRef, DefinitionRef: p.ProviderKey, ModifierKey: p.Modifiers[item.modifierIndex].ModifierKey, Reason: reason, UseRef: item.useRef}
}

func (s *genericRunState) commitResourceChange(row model.ResourceChangeRecord) {
	s.resourceChangeSummary.ChangeCount++
	totals := &s.resourceChangeSummary.Source
	if row.Target == "target" {
		totals = &s.resourceChangeSummary.Target
	}
	totals.CurrentIncrease += math.Max(0, row.CurrentDelta)
	totals.CurrentDecrease += math.Max(0, -row.CurrentDelta)
	totals.MaxIncrease += math.Max(0, row.MaxDelta)
	totals.MaxDecrease += math.Max(0, -row.MaxDelta)
	if s.detailedOutput() && len(s.resourceChangeRecords) < s.maxResourceChangeRecords {
		s.resourceChangeRecords = append(s.resourceChangeRecords, row)
	}
}

func (s *genericRunState) resourceRecordsOutput() *[]model.ResourceChangeRecord {
	if !s.compiled.HasResourceMax {
		return nil
	}
	return &s.resourceChangeRecords
}
func (s *genericRunState) resourceSummaryOutput() *model.ResourceChangeSummary {
	if !s.compiled.HasResourceMax {
		return nil
	}
	s.resourceChangeSummary.Source.FinalMax = s.combatants["source"].attributes.At("hp").Max
	s.resourceChangeSummary.Target.FinalMax = s.combatants["target"].attributes.At("hp").Max
	return s.resourceChangeSummary
}

func (s *genericRunState) resourceRecordingSummary(summary model.RecordingSummary) model.RecordingSummary {
	if !s.compiled.HasResourceMax {
		return summary
	}
	count, returned := s.resourceChangeSummary.ChangeCount, len(s.resourceChangeRecords)
	kept := s.retainedRecordCount(count, returned, s.maxResourceChangeRecords)
	dropped, truncated := count-kept, count > kept
	summary.ResourceChangeRecordCount, summary.ReturnedResourceChangeRecords = &count, &returned
	summary.DroppedResourceChangeRecords, summary.ResourceChangeRecordsTruncated = &dropped, &truncated
	return summary
}

func (s *genericRunState) settleLiveResourceExpiry() {
	if !s.compiled.HasResourceMax || s.processFailure != nil || s.budgetCause != "" {
		return
	}
	needed := false
	for _, c := range s.combatants {
		for _, item := range c.resourceContributions {
			inst, _, found := status.FindByRef(c.providers, item.providerRef)
			if !found || inst.Expired(s.nowMs) {
				needed = true
				break
			}
		}
	}
	if !needed {
		return
	}
	var frame executionFrame
	s.initExecutionFrame(&frame, "source", "target", "resource_expiry_read")
	frame.commit()
	if frame.fatal {
		s.processFailure = frame.fatalErr
	}
}
