package actionflow

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessRestorePlan 只借用过程恢复需要的静态归属与绑定定义。
type ProcessRestorePlan struct {
	Combatants          []planbundle.CompiledCombatant
	Providers           []planbundle.CompiledProvider
	Abilities           []planbundle.CompiledAbility
	SkillActionBindings []planbundle.CompiledSkillActionBinding
}

// RestoredUse 是恢复时已登记的真实使用来源；存在性独立于所有字段的零值。
type RestoredUse struct{ Source, SkillKey string }

// ProcessRestoreFacts 只提供恢复阶段的真实来源核验和原位置施放编号分配。
type ProcessRestoreFacts interface {
	// ProcessActorExists 核对快照中是否实际存在该拥有者或目标。
	ProcessActorExists(key string) bool
	// ProcessActorHP 读取当前真实生命与其是否显式存在，不把缺失生命解释为0。
	ProcessActorHP(key string) (float64, bool)
	// ProcessMounted 核对原静态定义在当前时刻是否仍为真实有效挂载。
	ProcessMounted(owner, provider string, definition uint16) bool
	// ProcessKnownUse 返回已登记的真实使用归属；历史使用允许缺失。
	ProcessKnownUse(use string) (RestoredUse, bool)
	// NextProcessCast 在原恢复成功位置分配施放编号，不提前分配其他身份。
	NextProcessCast() uint64
}

func (s ProcessExecutor) Restore(row model.ProcessInstanceSnapshot, path string, now int64, plan ProcessRestorePlan, facts ProcessRestoreFacts) (*actionpkg.ProcessView, *model.EngineError) {
	bad := func(field, message string) (*actionpkg.ProcessView, *model.EngineError) {
		return nil, s.error(path+field, message, row.UseKey)
	}
	if row.SkillHitStages != nil {
		return bad(".skillHitStages", "planned skill hit stages are output facts and cannot be restored")
	}
	if row.EmpoweredPredecessorUseRef != nil {
		return bad(".empoweredPredecessorUseRef", "empowered predecessor provenance cannot be restored in this stage")
	}
	if !facts.ProcessActorExists(row.Owner) || !facts.ProcessActorExists(row.Target) || strings.TrimSpace(row.UseKey) == "" || strings.TrimSpace(row.ProviderRef) == "" {
		return bad("", "process identity requires explicit real owner, target, provider and use")
	}
	var def *planbundle.CompiledProcess
	var providerIndex uint16
	for _, c := range plan.Combatants {
		if c.Key != row.Owner {
			continue
		}
		for _, mount := range c.ProviderMounts {
			if mount.ProviderRef != row.ProviderRef {
				continue
			}
			providerIndex = mount.DefinitionIndex
			for j := range plan.Providers[mount.DefinitionIndex].Processes {
				p := &plan.Providers[mount.DefinitionIndex].Processes[j]
				if p.ProcessKey == row.ProcessKey {
					def = p
					break
				}
			}
		}
	}
	if def == nil || def.SkillKey != row.SkillKey || !facts.ProcessMounted(row.Owner, row.ProviderRef, providerIndex) {
		return bad(".processKey", "process snapshot must match a real mounted definition and skill")
	}
	if planbundle.FiniteRecastProcess(def) {
		return bad("", "finite recast windows require a fresh runtime use")
	}
	for _, binding := range plan.SkillActionBindings {
		if binding.Source == row.Owner && binding.ProviderRef == row.ProviderRef && binding.Controls[0].ProcessKey == row.ProcessKey && HasSimpleStepHits(def, binding) {
			return bad(".skillHitStages", "explicit planned hit processes require a fresh runtime use")
		}
	}
	if actionpkg.IsEmpoweredProcess(def) {
		return bad(".status", "empowered attack process snapshots cannot be restored in this stage")
	}
	if row.EmpoweredAttackWindow != nil {
		return bad(".empoweredAttackWindow", "counted attack facts cannot be borrowed by another process")
	}
	if row.EmpoweredAttack != nil && !actionpkg.IsEmpoweredProcess(def) {
		return bad(".empoweredAttack", "attack consumption belongs only to an empowered process")
	}
	if use, ok := facts.ProcessKnownUse(row.UseKey); ok && (use.Source != row.Owner || use.SkillKey != row.SkillKey) {
		return bad(".useKey", "historical use identity contradicts skillUses")
	}
	if row.StartedAtMs < 0 || row.StepStartedAtMs < row.StartedAtMs || row.StepStartedAtMs > now || row.AdvanceAtMs < row.StepStartedAtMs {
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
		if (row.Status != "failed" && row.Status != "active") || row.StepKey != "" || row.StepVersion != 0 || row.ExpiresAtMs != nil || row.StepStartedAtMs != row.StartedAtMs || row.AdvanceAtMs != row.StartedAtMs || row.Status == "active" && row.StartedAtMs != now {
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
		if row.FinishedAtMs != nil || row.FailureReason != nil || stepIndex >= 0 && def.Steps[stepIndex].StepType != "IMMEDIATE" && (row.ExpiresAtMs == nil || *row.ExpiresAtMs < now) {
			return bad(".expiresAtMs", "active process requires a pending timer and no terminal markers")
		}
		if hp, present := facts.ProcessActorHP(row.Owner); present && hp <= 0 {
			return bad(".owner", "dead source cannot restore an active process")
		}
	} else {
		if row.FinishedAtMs == nil || *row.FinishedAtMs < row.StepStartedAtMs || *row.FinishedAtMs > now {
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
			if err := s.ValidateRestoredRepeat(row, step, path, now); err != nil {
				return nil, err
			}
		} else if row.Repeat != nil {
			return bad(".repeat", "repeat progress belongs only to a finite repeated step")
		} else if step.StepType == "IMMEDIATE" {
			if row.Status == "active" && row.StepStartedAtMs != now || row.ExpiresAtMs != nil || row.AdvanceAtMs != row.StepStartedAtMs {
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
	if err := s.ValidateRestoredProgress(row, def, stepIndex, path, now); err != nil {
		return nil, err
	}
	if !ValidRestoredCooldown(row, def, stepIndex) {
		return bad(".cooldownStarted", "cooldown marker contradicts the reached process moment")
	}
	ai := def.InitialAbilityIndex
	if ai < 0 || ai >= len(plan.Abilities) {
		return bad(".processKey", "process initial ability is missing")
	}
	row.ActualCosts = CloneProcessCosts(row.ActualCosts)
	ability := plan.Abilities[ai]
	process := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: row, Definition: def, Ability: ability, AbilityRef: row.Owner + ".provider[" + row.ProviderRef + "].ability[" + ability.AbilityKey + "]", StepIndex: stepIndex, CastID: facts.NextProcessCast()})
	if err := s.ValidateRestoredOccupancies(process, path, now); err != nil {
		return nil, err
	}
	return process, nil
}

func (state ProcessExecutor) ValidateRestoredProgress(row model.ProcessInstanceSnapshot, definition *planbundle.CompiledProcess, stepIndex int, path string, now int64) *model.EngineError {
	bad := func(message string) *model.EngineError {
		return state.error(path+".stepExecutionIndex", message, row.UseKey)
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
		if last < row.StepStartedAtMs || last > now || row.FinishedAtMs != nil && last > *row.FinishedAtMs || row.ExpiresAtMs != nil && last > *row.ExpiresAtMs {
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
			probe := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: row, Definition: &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{step}}, StepIndex: 0})
			probeChanges := actionpkg.StageProcess(probe)
			probeChanges.SetRepeat(&previous)
			probe = probeChanges.View()
			if last != probe.NextRepeatAt() {
				return bad("last repeated execution must match its frozen absolute segment time")
			}
		}
	}
	if row.StepCompletedAtMs != nil {
		completed := *row.StepCompletedAtMs
		if row.StepExecutionIndex != maximum || row.LastExecutionAtMs == nil || completed < *row.LastExecutionAtMs || completed > now || row.FinishedAtMs != nil && completed > *row.FinishedAtMs {
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
	if row.Status == "active" && pending != nil && *pending != now {
		return bad("pending committed step transition must resume at the same snapshot time")
	}
	return nil
}

func (state ProcessExecutor) ValidateRestoredRepeat(row model.ProcessInstanceSnapshot, step planbundle.CompiledProcessStep, path string, now int64) *model.EngineError {
	repeat := row.Repeat
	bad := func(message string) *model.EngineError { return state.error(path+".repeat", message, row.UseKey) }
	if repeat == nil || repeat.ExecutionCount < 1 || repeat.ExecutionCount > 64 || repeat.ExecutionIndex < 0 || repeat.ExecutionIndex > repeat.ExecutionCount || row.ExpiresAtMs == nil || *row.ExpiresAtMs < row.StepStartedAtMs || row.AdvanceAtMs != *row.ExpiresAtMs {
		return bad("finite repeated step requires consistent frozen progress and end time")
	}
	duration := *row.ExpiresAtMs - row.StepStartedAtMs
	probe := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: row, Definition: &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{step}}, StepIndex: 0})
	if step.StepType == "MULTI_HIT" {
		if repeat.IntervalMs < 0 || repeat.ExecutionCount > 1 && (repeat.IntervalMs == 0 || repeat.IntervalMs > math.MaxInt64/int64(repeat.ExecutionCount-1)) || duration != int64(repeat.ExecutionCount-1)*repeat.IntervalMs || repeat.FirstExecutionOffsetMs != 0 || repeat.LastExecutionOffsetMs != duration {
			return bad("multi-hit progress contradicts its frozen interval or execution count")
		}
	} else {
		if repeat.IntervalMs != 0 {
			return bad("channel progress cannot mix a fixed multi-hit interval")
		}
		if step.FirstExecution == "CUSTOM_WINDOW" {
			if !actionpkg.ValidProcessChannelWindow(duration, repeat) {
				return bad("channel window contradicts its frozen safe duration, offsets or execution count")
			}
		} else if duration < int64(repeat.ExecutionCount) || repeat.FirstExecutionOffsetMs != probe.RepeatOffset(0) || repeat.LastExecutionOffsetMs != probe.RepeatOffset(repeat.ExecutionCount-1) {
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
		if *repeat.NextExecutionAtMs != probe.NextRepeatAt() || row.Status == "active" && *repeat.NextExecutionAtMs < now {
			return bad("next repeated execution contradicts frozen progress or lies in the past")
		}
	} else if repeat.NextExecutionAtMs != nil {
		return bad("all committed segments cannot retain another execution")
	}
	if repeat.ExecutionIndex > 0 {
		previous := *repeat
		previous.ExecutionIndex--
		probe := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: row, Definition: &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{step}}, StepIndex: 0})
		probeChanges := actionpkg.StageProcess(probe)
		probeChanges.SetRepeat(&previous)
		probe = probeChanges.View()
		last := probe.NextRepeatAt()
		if last > now || row.FinishedAtMs != nil && last > *row.FinishedAtMs {
			return bad("committed repeated execution cannot lie after the snapshot or termination")
		}
	}
	if row.Status == "complete" && (repeat.ExecutionIndex != repeat.ExecutionCount || row.FinishedAtMs == nil || *row.FinishedAtMs != *row.ExpiresAtMs) {
		return bad("completed repeated step must commit all segments and its complete duration")
	}
	return nil
}

func (state ProcessExecutor) ValidateRestoredOccupancies(process *actionpkg.ProcessView, path string, now int64) *model.EngineError {
	if process.ActionOccupancies() == nil || len(process.ActionOccupancies()) > len(process.Definition().Steps) {
		return state.error(path+".actionOccupancies", "process requires its complete bounded occupancy history", process.UseKey())
	}
	expected := 0
	for stepIndex := 0; stepIndex <= process.StepIndex(); stepIndex++ {
		if process.Definition().Steps[stepIndex].OccupiesAction {
			expected++
		}
	}
	if len(process.ActionOccupancies()) != expected {
		return state.error(path+".actionOccupancies", "occupancy history must cover every actually entered occupied step", process.UseKey())
	}
	previousVersion, previousEnd := 0, process.StartedAtMs()
	active := false
	for index, interval := range process.ActionOccupancies() {
		stepIndex := interval.StepVersion - 1
		if active || interval.StepVersion <= previousVersion || stepIndex < 0 || stepIndex >= len(process.Definition().Steps) || stepIndex > process.StepIndex() || process.Definition().Steps[stepIndex].StepKey != interval.StepKey || !process.Definition().Steps[stepIndex].OccupiesAction || interval.StartedAtMs < previousEnd || interval.StartedAtMs > now || interval.ExpectedEndAtMs < interval.StartedAtMs {
			return state.error(path+".actionOccupancies", "occupancy interval contradicts the actual ordered process steps", process.UseKey())
		}
		if interval.StepVersion == process.StepVersion() && (interval.StartedAtMs != process.StepStartedAtMs() || interval.ExpectedEndAtMs != process.ActionDeadline() || interval.FinishedAtMs != nil && (!process.HasFinished() || *interval.FinishedAtMs != process.FinishedAt())) {
			return state.error(path+".actionOccupancies", "current occupancy must retain its complete frozen duration and actual terminal exit", process.UseKey())
		}
		if interval.FinishedAtMs != nil {
			if *interval.FinishedAtMs < interval.StartedAtMs || *interval.FinishedAtMs > interval.ExpectedEndAtMs || *interval.FinishedAtMs > now {
				return state.error(path+".actionOccupancies", "occupancy interval has an invalid committed exit", process.UseKey())
			}
			previousEnd = *interval.FinishedAtMs
		} else {
			if process.Status() != "active" || interval.StepVersion != process.StepVersion() || index != len(process.ActionOccupancies())-1 || interval.StartedAtMs != process.StepStartedAtMs() || interval.ExpectedEndAtMs != process.ActionDeadline() {
				return state.error(path+".actionOccupancies", "open occupancy requires the actual active step and frozen deadline", process.UseKey())
			}
			active = true
		}
		previousVersion = interval.StepVersion
	}
	if active != process.OccupiesAction(process.Owner()) {
		return state.error(path+".actionOccupancies", "occupancy history must retain the actual current permission", process.UseKey())
	}
	return nil
}

func CloneProcessCosts(costs map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(costs))
	for k, v := range costs {
		out[k] = v
	}
	return out
}

func ValidRestoredCooldown(row model.ProcessInstanceSnapshot, def *planbundle.CompiledProcess, stepIndex int) bool {
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
