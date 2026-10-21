package runtime

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *genericRunState) initProcessState() *model.EngineError {
	s.processFacts = map[string]model.ProcessCommandFact{}
	hasProcess := len(s.req.InitialSnapshot.ProcessInstances) > 0 || len(s.req.ProcessCommandFacts) > 0
	if !hasProcess {
		for _, ability := range s.compiled.Abilities {
			if ability.ProcessControl != nil && ability.ProcessControl.UseRefFromEvent {
				hasProcess = true
				break
			}
		}
	}
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
			key := processInstanceMountKey(p)
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
		if ability.ProcessControl.UseRefFromEvent {
			return s.processErr(path+".abilityRef", "event-bound INITIAL control cannot be borrowed by a driver", ref)
		}
		if strings.TrimSpace(entry.EntryKey) == "" || entry.Repeat != nil || entry.WhileReady != nil {
			return s.processErr(path, "process control requires a named single-shot driver", ref)
		}
		if entry.FirstAtMs < s.startMs {
			return s.processErr(path+".firstAtMs", "process driver cannot precede the initial snapshot", ref)
		}
		source, sourceOK := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
		target, targetOK := s.resolveDriverCombatantKey(entry.Target, source)
		parsed, parsedOK := planbundle.ParseAbilityRef(ref)
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
	if row.SkillHitStages != nil {
		return bad(".skillHitStages", "planned skill hit stages are output facts and cannot be restored")
	}
	if row.EmpoweredPredecessorUseRef != nil {
		return bad(".empoweredPredecessorUseRef", "empowered predecessor provenance cannot be restored in this stage")
	}
	if !s.combatantExists(row.Owner) || !s.combatantExists(row.Target) || strings.TrimSpace(row.UseKey) == "" || strings.TrimSpace(row.ProviderRef) == "" {
		return bad("", "process identity requires explicit real owner, target, provider and use")
	}
	var def *planbundle.CompiledProcess
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
	for _, binding := range s.compiled.SkillActionBindings {
		if binding.Source == row.Owner && binding.ProviderRef == row.ProviderRef && binding.Controls[0].ProcessKey == row.ProcessKey && hasSimpleStepHits(def, binding) {
			return bad(".skillHitStages", "explicit planned hit processes require a fresh runtime use")
		}
	}
	if isEmpoweredProcess(def) {
		return bad(".status", "empowered attack process snapshots cannot be restored in this stage")
	}
	if row.EmpoweredAttack != nil && !isEmpoweredProcess(def) {
		return bad(".empoweredAttack", "attack consumption belongs only to an empowered process")
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
		if (row.Status != "failed" && row.Status != "active") || row.StepKey != "" || row.StepVersion != 0 || row.ExpiresAtMs != nil || row.StepStartedAtMs != row.StartedAtMs || row.AdvanceAtMs != row.StartedAtMs || row.Status == "active" && row.StartedAtMs != s.nowMs {
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
		if row.FinishedAtMs != nil || row.FailureReason != nil || stepIndex >= 0 && def.Steps[stepIndex].StepType != "IMMEDIATE" && (row.ExpiresAtMs == nil || *row.ExpiresAtMs < s.nowMs) {
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
		if step.StepType == "MULTI_HIT" || step.StepType == "CHANNEL" {
			if err := s.validateRestoredProcessRepeat(row, step, path); err != nil {
				return nil, err
			}
		} else if row.Repeat != nil {
			return bad(".repeat", "repeat progress belongs only to a finite repeated step")
		} else if step.StepType == "IMMEDIATE" {
			if row.Status == "active" && row.StepStartedAtMs != s.nowMs || row.ExpiresAtMs != nil || row.AdvanceAtMs != row.StepStartedAtMs {
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
	if err := s.validateRestoredStepProgress(row, def, stepIndex, path); err != nil {
		return nil, err
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
	process := &processRuntime{ProcessInstanceSnapshot: row, definition: def, ability: ability, abilityRef: row.Owner + ".provider[" + row.ProviderRef + "].ability[" + ability.AbilityKey + "]", stepIndex: stepIndex, castID: s.mintCastInstanceID()}
	if row.Repeat != nil {
		repeat := *row.Repeat
		process.Repeat = &repeat
	}
	if err := s.validateRestoredActionOccupancies(process, path); err != nil {
		return nil, err
	}
	process.cacheIdentityKeys()
	return process, nil
}

func (state *genericRunState) validateRestoredStepProgress(row model.ProcessInstanceSnapshot, definition *planbundle.CompiledProcess, stepIndex int, path string) *model.EngineError {
	bad := func(message string) *model.EngineError {
		return state.processErr(path+".stepExecutionIndex", message, row.UseKey)
	}
	if stepIndex < 0 {
		if row.StepExecutionIndex != 0 || row.LastExecutionAtMs != nil || row.StepCompletedAtMs != nil || row.Repeat != nil {
			return bad("before-first-step process cannot invent committed progress")
		}
		return nil
	}
	step := definition.Steps[stepIndex]
	maximum := 1
	if row.Repeat != nil {
		maximum = row.Repeat.ExecutionCount
		if row.StepExecutionIndex != row.Repeat.ExecutionIndex {
			return bad("current execution index must equal frozen repeated progress")
		}
	}
	if row.StepExecutionIndex < 0 || row.StepExecutionIndex > maximum || (row.StepExecutionIndex == 0) != (row.LastExecutionAtMs == nil) {
		return bad("committed execution index and last execution time are inconsistent")
	}
	if row.LastExecutionAtMs != nil {
		last := *row.LastExecutionAtMs
		if last < row.StepStartedAtMs || last > state.nowMs || row.FinishedAtMs != nil && last > *row.FinishedAtMs || row.ExpiresAtMs != nil && last > *row.ExpiresAtMs {
			return bad("last committed execution lies outside its actual process interval")
		}
		switch step.StepType {
		case "IMMEDIATE":
			if last != row.StepStartedAtMs {
				return bad("immediate execution must commit at its step start")
			}
		case "DELAY":
			if row.ExpiresAtMs == nil || last != *row.ExpiresAtMs {
				return bad("delay execution must commit at its frozen deadline")
			}
		case "CHARGE", "RECAST":
			if last < row.AdvanceAtMs || row.ExpiresAtMs == nil || last == *row.ExpiresAtMs && (step.StepType == "RECAST" || !step.ReleaseAtMaximum) {
				return bad("controlled execution must commit inside its declared release window")
			}
		case "MULTI_HIT", "CHANNEL":
			previous := *row.Repeat
			previous.ExecutionIndex--
			probe := &processRuntime{ProcessInstanceSnapshot: row, definition: &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{step}}, stepIndex: 0}
			probe.Repeat = &previous
			if last != nextProcessRepeatAt(probe) {
				return bad("last repeated execution must match its frozen absolute segment time")
			}
		}
	}
	if row.StepCompletedAtMs != nil {
		completed := *row.StepCompletedAtMs
		if row.StepExecutionIndex != maximum || row.LastExecutionAtMs == nil || completed < *row.LastExecutionAtMs || completed > state.nowMs || row.FinishedAtMs != nil && completed > *row.FinishedAtMs {
			return bad("step completion requires all actual executions and a committed completion time")
		}
		if step.StepType == "CHANNEL" {
			if row.ExpiresAtMs == nil || completed != *row.ExpiresAtMs {
				return bad("channel completion must retain its full declared duration")
			}
		} else if completed != *row.LastExecutionAtMs {
			return bad("step completion must follow its actual synchronous execution")
		}
	}
	if row.Status == "complete" && (row.StepCompletedAtMs == nil || row.FinishedAtMs == nil || *row.StepCompletedAtMs != *row.FinishedAtMs) {
		return bad("completed process must retain its committed final step completion")
	}
	pending := row.StepCompletedAtMs
	if pending == nil && row.Repeat == nil && row.StepExecutionIndex > 0 {
		pending = row.LastExecutionAtMs
	}
	if row.Status == "active" && pending != nil && *pending != state.nowMs {
		return bad("pending committed step transition must resume at the same snapshot time")
	}
	return nil
}

func (state *genericRunState) validateRestoredProcessRepeat(row model.ProcessInstanceSnapshot, step planbundle.CompiledProcessStep, path string) *model.EngineError {
	repeat := row.Repeat
	bad := func(message string) *model.EngineError { return state.processErr(path+".repeat", message, row.UseKey) }
	if repeat == nil || repeat.ExecutionCount < 1 || repeat.ExecutionCount > 64 || repeat.ExecutionIndex < 0 || repeat.ExecutionIndex > repeat.ExecutionCount || row.ExpiresAtMs == nil || *row.ExpiresAtMs < row.StepStartedAtMs || row.AdvanceAtMs != *row.ExpiresAtMs {
		return bad("finite repeated step requires consistent frozen progress and end time")
	}
	duration := *row.ExpiresAtMs - row.StepStartedAtMs
	probe := &processRuntime{ProcessInstanceSnapshot: row, definition: &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{step}}, stepIndex: 0}
	if step.StepType == "MULTI_HIT" {
		if repeat.IntervalMs < 0 || repeat.ExecutionCount > 1 && (repeat.IntervalMs == 0 || repeat.IntervalMs > math.MaxInt64/int64(repeat.ExecutionCount-1)) || duration != int64(repeat.ExecutionCount-1)*repeat.IntervalMs || repeat.FirstExecutionOffsetMs != 0 || repeat.LastExecutionOffsetMs != duration {
			return bad("multi-hit progress contradicts its frozen interval or execution count")
		}
	} else {
		if repeat.IntervalMs != 0 {
			return bad("channel progress cannot mix a fixed multi-hit interval")
		}
		if step.FirstExecution == "CUSTOM_WINDOW" {
			if !validProcessChannelWindow(duration, repeat) {
				return bad("channel window contradicts its frozen safe duration, offsets or execution count")
			}
		} else if duration < int64(repeat.ExecutionCount) || repeat.FirstExecutionOffsetMs != processRepeatOffset(probe, 0) || repeat.LastExecutionOffsetMs != processRepeatOffset(probe, repeat.ExecutionCount-1) {
			return bad("channel progress requires its complete frozen duration and actual first and last execution offsets")
		}
	}
	if row.Status != "active" {
		if repeat.NextExecutionAtMs != nil {
			return bad("terminated repeated process cannot retain another execution")
		}
	} else if repeat.ExecutionIndex < repeat.ExecutionCount {
		if repeat.NextExecutionAtMs == nil {
			return bad("unfinished repeated step requires the next actual execution time")
		}
		if *repeat.NextExecutionAtMs != nextProcessRepeatAt(probe) || row.Status == "active" && *repeat.NextExecutionAtMs < state.nowMs {
			return bad("next repeated execution contradicts frozen progress or lies in the past")
		}
	} else if repeat.NextExecutionAtMs != nil {
		return bad("all committed segments cannot retain another execution")
	}
	if repeat.ExecutionIndex > 0 {
		previous := *repeat
		previous.ExecutionIndex--
		probe := &processRuntime{ProcessInstanceSnapshot: row, definition: &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{step}}, stepIndex: 0}
		probe.Repeat = &previous
		last := nextProcessRepeatAt(probe)
		if last > state.nowMs || row.FinishedAtMs != nil && last > *row.FinishedAtMs {
			return bad("committed repeated execution cannot lie after the snapshot or termination")
		}
	}
	if row.Status == "complete" && (repeat.ExecutionIndex != repeat.ExecutionCount || row.FinishedAtMs == nil || *row.FinishedAtMs != *row.ExpiresAtMs) {
		return bad("completed repeated step must commit all segments and its complete duration")
	}
	return nil
}

func (state *genericRunState) validateRestoredActionOccupancies(process *processRuntime, path string) *model.EngineError {
	if process.ActionOccupancies == nil || len(process.ActionOccupancies) > len(process.definition.Steps) {
		return state.processErr(path+".actionOccupancies", "process requires its complete bounded occupancy history", process.UseKey)
	}
	expected := 0
	for stepIndex := 0; stepIndex <= process.stepIndex; stepIndex++ {
		if process.definition.Steps[stepIndex].OccupiesAction {
			expected++
		}
	}
	if len(process.ActionOccupancies) != expected {
		return state.processErr(path+".actionOccupancies", "occupancy history must cover every actually entered occupied step", process.UseKey)
	}
	previousVersion, previousEnd := 0, process.StartedAtMs
	active := false
	for index, interval := range process.ActionOccupancies {
		stepIndex := interval.StepVersion - 1
		if active || interval.StepVersion <= previousVersion || stepIndex < 0 || stepIndex >= len(process.definition.Steps) || stepIndex > process.stepIndex || process.definition.Steps[stepIndex].StepKey != interval.StepKey || !process.definition.Steps[stepIndex].OccupiesAction || interval.StartedAtMs < previousEnd || interval.StartedAtMs > state.nowMs || interval.ExpectedEndAtMs < interval.StartedAtMs {
			return state.processErr(path+".actionOccupancies", "occupancy interval contradicts the actual ordered process steps", process.UseKey)
		}
		if interval.StepVersion == process.StepVersion && (interval.StartedAtMs != process.StepStartedAtMs || interval.ExpectedEndAtMs != processActionDeadline(process) || interval.FinishedAtMs != nil && (process.FinishedAtMs == nil || *interval.FinishedAtMs != *process.FinishedAtMs)) {
			return state.processErr(path+".actionOccupancies", "current occupancy must retain its complete frozen duration and actual terminal exit", process.UseKey)
		}
		if interval.FinishedAtMs != nil {
			if *interval.FinishedAtMs < interval.StartedAtMs || *interval.FinishedAtMs > interval.ExpectedEndAtMs || *interval.FinishedAtMs > state.nowMs {
				return state.processErr(path+".actionOccupancies", "occupancy interval has an invalid committed exit", process.UseKey)
			}
			previousEnd = *interval.FinishedAtMs
		} else {
			if process.Status != "active" || interval.StepVersion != process.StepVersion || index != len(process.ActionOccupancies)-1 || interval.StartedAtMs != process.StepStartedAtMs || interval.ExpectedEndAtMs != processActionDeadline(process) {
				return state.processErr(path+".actionOccupancies", "open occupancy requires the actual active step and frozen deadline", process.UseKey)
			}
			active = true
		}
		previousVersion = interval.StepVersion
	}
	if active != processOccupiesAction(process, process.Owner) {
		return state.processErr(path+".actionOccupancies", "occupancy history must retain the actual current permission", process.UseKey)
	}
	return nil
}

func cloneProcessCosts(costs map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(costs))
	for k, v := range costs {
		out[k] = v
	}
	return out
}

func validRestoredProcessCooldown(row model.ProcessInstanceSnapshot, def *planbundle.CompiledProcess, stepIndex int) bool {
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
	if m.MomentType == "STEP_EXECUTION" {
		return row.CooldownStarted == (row.StepExecutionIndex > 0)
	}
	if m.MomentType == "STEP_COMPLETE" {
		return row.CooldownStarted == (row.StepCompletedAtMs != nil)
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
