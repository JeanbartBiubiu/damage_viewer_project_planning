package runtime

import (
	"math"
	"strings"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func (s *genericRunState) initProcessState() *model.EngineError {
	s.processFacts = map[string]model.ProcessCommandFact{}
	hasProcess := len(s.req.InitialSnapshot.ProcessInstances) > 0 || len(s.req.ProcessCommandFacts) > 0
	if !hasProcess {
		for _, entry := range s.req.DriverPlan.Entries {
			ability, _, ok := s.lookupDriverAbility(entry)
			if ok && ability.ProcessControl != nil {
				hasProcess = true
				break
			}
		}
	}
	if hasProcess {
		for _, entry := range s.req.DriverPlan.Entries {
			if entry.FirstAtMs < s.startMs {
				return s.processErr("driverPlan.entries["+entry.EntryKey+"].firstAtMs", "driver in a process run cannot precede the initial snapshot", entry.AbilityRef)
			}
		}
	}
	if len(s.req.InitialSnapshot.ProcessInstances) > s.budget.MaxProcessInstances {
		return s.processErr("initialSnapshot.processInstances", "process instance budget exceeded", "")
	}
	seenUses := map[string]bool{}
	active := map[string]bool{}
	for i, row := range s.req.InitialSnapshot.ProcessInstances {
		path := "initialSnapshot.processInstances[" + itoa(uint32(i)) + "]"
		p, err := s.restoreProcess(row, path)
		if err != nil {
			return err
		}
		if seenUses[row.UseKey] {
			return s.processErr(path+".useKey", "duplicate successful process use", row.UseKey)
		}
		seenUses[row.UseKey] = true
		if row.Status == "active" {
			key := processMountKey(row.Owner, row.ProviderRef, row.ProcessKey)
			if active[key] {
				return s.processErr(path, "multiple active instances on one mounted process", row.ProcessKey)
			}
			active[key] = true
		}
		s.processInstances = append(s.processInstances, p)
	}
	entries := map[string]int{}
	controls := map[string]int{}
	for i, entry := range s.req.DriverPlan.Entries {
		if _, exists := entries[entry.EntryKey]; exists && (len(s.req.ProcessCommandFacts) > 0 || len(s.processInstances) > 0) {
			return s.processErr("driverPlan.entries", "duplicate driver entryKey", entry.EntryKey)
		}
		entries[entry.EntryKey] = i
		ability, ref, ok := s.lookupDriverAbility(entry)
		if !ok || ability.ProcessControl == nil {
			continue
		}
		path := "driverPlan.entries[" + entry.EntryKey + "]"
		if strings.TrimSpace(entry.EntryKey) == "" || entry.Repeat != nil || entry.WhileReady != nil {
			return s.processErr(path, "process control requires a named single-shot driver", ref)
		}
		if entry.FirstAtMs < s.startMs {
			return s.processErr(path+".firstAtMs", "process driver cannot precede the initial snapshot", ref)
		}
		source, sourceOK := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
		target, targetOK := s.resolveDriverCombatantKey(entry.Target, source)
		parsed, parsedOK := compilebundle.ParseAbilityRef(ref)
		if !sourceOK || !targetOK || entry.Source == "" || entry.Target == "" || !parsedOK || parsed.Combatant != source || !s.combatantExists(target) {
			return s.processErr(path, "process driver must identify its real owner and target", ref)
		}
		controls[entry.EntryKey] = i
	}
	for i, fact := range s.req.ProcessCommandFacts {
		path := "processCommandFacts[" + itoa(uint32(i)) + "]"
		if _, exists := s.processFacts[fact.DriverEntryKey]; exists {
			return s.processErr(path+".driverEntryKey", "duplicate process command fact", fact.DriverEntryKey)
		}
		idx, ok := controls[fact.DriverEntryKey]
		if !ok {
			return s.processErr(path+".driverEntryKey", "fact must reference a process control driver", fact.DriverEntryKey)
		}
		entry := s.req.DriverPlan.Entries[idx]
		ability, _, _ := s.lookupDriverAbility(entry)
		use, ok := s.skillUses[fact.UseRef]
		if !ok || fact.UseRef == "" {
			return s.processErr(path+".useRef", "process command requires an existing skill use", fact.UseRef)
		}
		source, _ := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
		if use.source != source || use.skillKey != ability.SkillKey {
			return s.processErr(path+".useRef", "process use source and skill must match the control ability", fact.UseRef)
		}
		s.processFacts[fact.DriverEntryKey] = fact
	}
	for _, entry := range s.req.DriverPlan.Entries {
		if _, ok := controls[entry.EntryKey]; ok {
			if _, ok := s.processFacts[entry.EntryKey]; !ok {
				return s.processErr("processCommandFacts", "process driver requires an explicit command fact", entry.EntryKey)
			}
		}
	}
	for _, p := range s.processInstances {
		if p.Status == "active" {
			if err := s.enqueueProcessTimer(p); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *genericRunState) restoreProcess(row model.ProcessInstanceSnapshot, path string) (*processRuntime, *model.EngineError) {
	bad := func(field, message string) (*processRuntime, *model.EngineError) {
		return nil, s.processErr(path+field, message, row.UseKey)
	}
	if !s.combatantExists(row.Owner) || !s.combatantExists(row.Target) || strings.TrimSpace(row.UseKey) == "" || strings.TrimSpace(row.ProviderRef) == "" {
		return bad("", "process identity requires explicit real owner, target, provider and use")
	}
	var def *compilebundle.CompiledProcess
	var providerIndex uint16
	for _, c := range s.compiled.Combatants {
		if c.Key != row.Owner {
			continue
		}
		for _, mount := range c.ProviderMounts {
			if mount.ProviderRef != row.ProviderRef {
				continue
			}
			providerIndex = mount.DefinitionIndex
			for j := range s.compiled.Providers[mount.DefinitionIndex].Processes {
				p := &s.compiled.Providers[mount.DefinitionIndex].Processes[j]
				if p.ProcessKey == row.ProcessKey {
					def = p
					break
				}
			}
		}
	}
	if def == nil || def.SkillKey != row.SkillKey || !s.processMounted(row.Owner, row.ProviderRef, providerIndex) {
		return bad(".processKey", "process snapshot must match a real mounted definition and skill")
	}
	if use, ok := s.skillUses[row.UseKey]; ok && (use.source != row.Owner || use.skillKey != row.SkillKey) {
		return bad(".useKey", "historical use identity contradicts skillUses")
	}
	if row.StartedAtMs < 0 || row.StepStartedAtMs < row.StartedAtMs || row.StepStartedAtMs > s.nowMs || row.AdvanceAtMs < row.StepStartedAtMs {
		return bad(".startedAtMs", "invalid process time relationship")
	}
	stepIndex := -1
	for i, step := range def.Steps {
		if step.StepKey == row.StepKey {
			stepIndex = i
			break
		}
	}
	if stepIndex < 0 {
		if row.Status != "failed" || row.StepKey != "" || row.StepVersion != 0 || row.ExpiresAtMs != nil || row.StepStartedAtMs != row.StartedAtMs || row.AdvanceAtMs != row.StartedAtMs {
			return bad(".stepKey", "unknown process step")
		}
	} else if row.StepVersion != stepIndex+1 {
		return bad(".stepVersion", "process step version must match the ordered step")
	}
	if row.ActualCosts == nil {
		return bad(".actualCosts", "actual process costs must be explicit")
	}
	costKeys := map[string]bool{}
	for _, cost := range def.Costs {
		costKeys[cost.ResourceKey] = true
	}
	if len(row.ActualCosts) != len(costKeys) {
		return bad(".actualCosts", "actual cost keys must match all declared resources")
	}
	for key, value := range row.ActualCosts {
		if !costKeys[key] || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			return bad(".actualCosts."+key, "actual cost must be a declared finite non-negative resource amount")
		}
	}
	if row.Status != "active" && row.Status != "complete" && row.Status != "failed" {
		return bad(".status", "unknown process status")
	}
	if row.Status == "active" {
		if row.FinishedAtMs != nil || row.FailureReason != nil || stepIndex < 0 || row.ExpiresAtMs == nil || *row.ExpiresAtMs < s.nowMs {
			return bad(".expiresAtMs", "active process requires a pending timer and no terminal markers")
		}
		if s.combatantHasHp(row.Owner) && s.combatantHp(row.Owner) <= 0 {
			return bad(".owner", "dead source cannot restore an active process")
		}
	} else {
		if row.FinishedAtMs == nil || *row.FinishedAtMs < row.StepStartedAtMs || *row.FinishedAtMs > s.nowMs {
			return bad(".finishedAtMs", "terminal process requires a valid finish time")
		}
		if row.Status == "complete" && (row.FailureReason != nil || stepIndex != len(def.Steps)-1) {
			return bad(".status", "completed process must finish its final step without failure")
		}
		if row.Status == "failed" && (row.FailureReason == nil || !model.ValidProcessFailureReason(*row.FailureReason)) {
			return bad(".failureReason", "failed process requires a valid failure reason")
		}
		if stepIndex < 0 && *row.FinishedAtMs != row.StartedAtMs {
			return bad(".finishedAtMs", "failure before the first step must finish at process start")
		}
	}
	if stepIndex >= 0 {
		step := def.Steps[stepIndex]
		if step.StepType == "IMMEDIATE" {
			if row.Status == "active" || row.ExpiresAtMs != nil || row.AdvanceAtMs != row.StepStartedAtMs {
				return bad(".expiresAtMs", "immediate step cannot restore an active timer")
			}
			if row.FinishedAtMs != nil && *row.FinishedAtMs != row.StepStartedAtMs {
				return bad(".finishedAtMs", "immediate step finishes at its start time")
			}
		} else {
			if row.ExpiresAtMs == nil || *row.ExpiresAtMs <= row.StepStartedAtMs || row.AdvanceAtMs > *row.ExpiresAtMs {
				return bad(".expiresAtMs", "timed step has inconsistent frozen times")
			}
			if step.StepType == "DELAY" && row.AdvanceAtMs != *row.ExpiresAtMs {
				return bad(".advanceAtMs", "delay must advance at expiration")
			}
			if step.StepType == "RECAST" && row.AdvanceAtMs != row.StepStartedAtMs {
				return bad(".advanceAtMs", "recast opens when its step starts")
			}
			if row.Status != "active" && *row.FinishedAtMs > *row.ExpiresAtMs {
				return bad(".finishedAtMs", "terminal step cannot finish after its expiration")
			}
			if row.Status == "complete" && *row.FinishedAtMs < row.AdvanceAtMs {
				return bad(".finishedAtMs", "completed step cannot finish before allowed advancement")
			}
		}
	}
	if !validRestoredProcessCooldown(row, def, stepIndex) {
		return bad(".cooldownStarted", "cooldown marker contradicts the reached process moment")
	}
	ai := def.InitialAbilityIndex
	if ai < 0 || ai >= len(s.compiled.Abilities) {
		return bad(".processKey", "process initial ability is missing")
	}
	row.ActualCosts = cloneProcessCosts(row.ActualCosts)
	ability := s.compiled.Abilities[ai]
	return &processRuntime{ProcessInstanceSnapshot: row, definition: def, ability: ability, abilityRef: row.Owner + ".provider[" + row.ProviderRef + "].ability[" + ability.AbilityKey + "]", stepIndex: stepIndex, castID: s.mintCastInstanceID()}, nil
}

func cloneProcessCosts(costs map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(costs))
	for k, v := range costs {
		out[k] = v
	}
	return out
}

func validRestoredProcessCooldown(row model.ProcessInstanceSnapshot, def *compilebundle.CompiledProcess, stepIndex int) bool {
	if def.Cooldown == nil {
		return !row.CooldownStarted
	}
	m := def.Cooldown.StartMoment
	switch m.MomentType {
	case "PROCESS_START":
		return row.CooldownStarted
	case "PROCESS_COMPLETE":
		return row.CooldownStarted == (row.Status == "complete")
	case "PROCESS_FAILURE":
		return row.CooldownStarted == (row.Status == "failed" && (m.FailureReason == nil || *m.FailureReason == *row.FailureReason))
	}
	idx := -1
	for i, step := range def.Steps {
		if m.StepKey != nil && step.StepKey == *m.StepKey {
			idx = i
			break
		}
	}
	if idx > stepIndex {
		return !row.CooldownStarted
	}
	if m.MomentType == "STEP_START" || idx < stepIndex {
		return row.CooldownStarted
	}
	if row.Status == "active" {
		return !row.CooldownStarted
	}
	step := def.Steps[stepIndex]
	if m.MomentType == "STEP_TIMEOUT" {
		if step.StepType == "IMMEDIATE" || step.StepType == "DELAY" || row.ExpiresAtMs == nil || *row.FinishedAtMs < *row.ExpiresAtMs {
			return !row.CooldownStarted
		}
		if row.Status == "complete" {
			return row.CooldownStarted
		}
	}
	if row.Status == "complete" {
		if m.MomentType == "STEP_COMPLETE" {
			return row.CooldownStarted
		}
		if m.MomentType == "STEP_EXECUTION" {
			executed := step.StepType != "RECAST" || (row.ExpiresAtMs != nil && *row.FinishedAtMs < *row.ExpiresAtMs)
			if step.StepType == "CHARGE" && row.ExpiresAtMs != nil && *row.FinishedAtMs == *row.ExpiresAtMs && !step.ReleaseAtMaximum {
				executed = false
			}
			return row.CooldownStarted == executed
		}
	}
	// Failure may originate inside execution or completion effects; either reached flag is valid.
	return true
}
