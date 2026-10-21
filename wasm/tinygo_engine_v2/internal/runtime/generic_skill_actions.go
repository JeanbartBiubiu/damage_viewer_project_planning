package runtime

import (
	"sort"
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

type skillActionRuntime struct {
	automaticRule        *automaticSkillRuleRuntime
	automaticFinished    bool
	plan                 model.SkillActionPlan
	binding              planbundle.CompiledSkillActionBinding
	summary              model.SkillActionSummary
	uses                 model.SkillUseSummary
	useRef               string
	accepted             bool
	rejection            string
	controlAbilityIndex  uint16
	parentIndex          int
	chargeDurationMs     *int64
	nextHitSequence      int
	committedHitContacts uint64
}

// 编译已确认依赖位于同一绑定的更早步骤；旧绑定无依赖时不增加查找。
func (action *skillActionRuntime) hasRequiredHitContact(hit model.SkillActionHitBinding) bool {
	if hit.RequiresPriorHitBindingKey == nil {
		return true
	}
	for index, prior := range action.binding.HitBindings {
		if prior.HitBindingKey == *hit.RequiresPriorHitBindingKey {
			return action.committedHitContacts&(uint64(1)<<uint(index)) != 0
		}
	}
	return false
}

func hasSimpleStepHits(definition *planbundle.CompiledProcess, binding planbundle.CompiledSkillActionBinding) bool {
	if len(binding.HitBindings) == 0 || binding.HitBindings[0].Moment.MomentType != "STEP_EXECUTION" {
		return false
	}
	for _, step := range definition.Steps {
		if step.StepType != "IMMEDIATE" && step.StepType != "DELAY" {
			return false
		}
	}
	return true
}

func (process *processRuntime) completeSkillHitStage(key string, contact, completed bool) {
	if process.SkillHitStages == nil {
		return
	}
	for index := len(*process.SkillHitStages) - 1; index >= 0; index-- {
		stage := &(*process.SkillHitStages)[index]
		if stage.HitBindingKey == key {
			stage.Contact, stage.Completed = contact, completed
			return
		}
	}
}

func (state *genericRunState) automatedRun() bool {
	return state.basicAttack != nil || state.hasSkillPlan()
}

func (state *genericRunState) hasSkillPlan() bool {
	return len(state.skillActions) > 0 || state.automaticSkills != nil
}

func (state *genericRunState) initSkillAction() *model.EngineError {
	state.skillActionRecords = []model.SkillActionRecord{}
	state.skillUseRecords = []model.SkillUseRecord{}
	state.healingRecords = []model.DirectHealingRecord{}
	state.maxSkillActionRecords, state.maxSkillUseRecords, state.maxHealingRecords = 1000, 2000, 2000
	if budget := state.req.RecordBudget; budget != nil {
		if budget.MaxSkillActionRecords != nil {
			state.maxSkillActionRecords = *budget.MaxSkillActionRecords
		}
		if budget.MaxSkillUseRecords != nil {
			state.maxSkillUseRecords = *budget.MaxSkillUseRecords
		}
		if budget.MaxHealingRecords != nil {
			state.maxHealingRecords = *budget.MaxHealingRecords
		}
	}
	if state.maxSkillActionRecords < 0 || state.maxSkillActionRecords > 4096 || state.maxSkillUseRecords < 0 || state.maxSkillUseRecords > 10000 || state.maxHealingRecords < 0 || state.maxHealingRecords > 10000 {
		return state.basicAttackErr("invalid skill or healing record budget", "recordBudget")
	}
	if len(state.req.DriverPlan.SkillActions) == 0 {
		return nil
	}
	if len(state.req.DriverPlan.SkillActions) > 64 || state.req.DriverPlan.Entries == nil || len(state.req.DriverPlan.Entries)+len(state.req.SkillUses)+len(state.req.SkillHitFacts)+len(state.req.AttackStartFacts)+len(state.req.ProcessCommandFacts) != 0 {
		return state.basicAttackErr("planned casts require 1 to 64 instructions and no external facts", "driverPlan")
	}
	if state.startMs != 0 || state.durationMs < 1 || state.durationMs > 600000 {
		return state.basicAttackErr("single cast requires time zero and duration in [1,600000]", "stopPolicy")
	}
	if len(state.req.InitialSnapshot.ProcessInstances)+len(state.req.InitialSnapshot.UseTriggerLedger) != 0 {
		return state.basicAttackErr("single cast requires a fresh initial snapshot", "initialSnapshot")
	}
	for _, actor := range state.req.InitialSnapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 {
			return state.basicAttackErr("single cast requires empty initial runtime state", "initialSnapshot.combatants")
		}
	}
	if err := state.validateBasicAttackInitialSnapshot(); err != nil {
		return err
	}
	seen := map[string]bool{}
	state.skillActions = make([]skillActionRuntime, 0, len(state.req.DriverPlan.SkillActions))
	for index, plan := range state.req.DriverPlan.SkillActions {
		path := "driverPlan.skillActions[" + strconv.Itoa(index) + "]"
		if strings.TrimSpace(plan.InstructionKey) == "" || seen[plan.InstructionKey] || plan.Source != model.SelectorSource || (plan.Target != model.SelectorSource && plan.Target != model.SelectorTarget) || !validSkillActionControl(plan.Action) || (plan.Action == "INITIAL" && plan.ParentInstructionKey != nil) || (plan.Action != "INITIAL" && (plan.ParentInstructionKey == nil || strings.TrimSpace(*plan.ParentInstructionKey) == "")) || plan.FirstAtMs < 0 || plan.FirstAtMs > state.durationMs || plan.SortOrder < 0 || plan.HitBindings == nil {
			return state.basicAttackErr("invalid unique instruction, parent, timing or target", path)
		}
		seen[plan.InstructionKey] = true
		found := false
		for _, binding := range state.compiled.SkillActionBindings {
			if binding.BindingKey != plan.BindingKey {
				continue
			}
			controlIndex, hasControl := binding.ControlAbilityIndices[plan.Action]
			expectedHits := len(binding.HitBindings)
			if binding.HasEmpoweredAttack {
				expectedHits = 0
			}
			if binding.SkillKey != plan.SkillKey || binding.Source != plan.Source || !hasControl || plan.AbilityRef != binding.Source+".provider["+binding.ProviderRef+"].ability["+state.compiled.Abilities[controlIndex].AbilityKey+"]" || (plan.Action == "INITIAL" && len(plan.HitBindings) != expectedHits) || (plan.Action != "INITIAL" && len(plan.HitBindings) != 0) || binding.HasEmpoweredAttack && (plan.Target != plan.Source || state.req.DriverPlan.BasicAttack == nil || state.req.DriverPlan.BasicAttack.Source != plan.Source) {
				return state.basicAttackErr("instruction does not match its immutable compiled skill binding", path)
			}
			presetKeys := map[string]bool{}
			for _, preset := range plan.HitBindings {
				bound := false
				for _, hit := range binding.HitBindings {
					bound = bound || hit.HitBindingKey == preset.HitBindingKey
				}
				if !bound || presetKeys[preset.HitBindingKey] || (preset.Preset != "TARGET_HIT" && preset.Preset != "MISS") || plan.Target != model.SelectorTarget {
					return state.basicAttackErr("invalid release binding, hit preset or unique target", path+".hitBindings")
				}
				presetKeys[preset.HitBindingKey] = true
			}
			state.skillActions = append(state.skillActions, skillActionRuntime{plan: plan, binding: binding, controlAbilityIndex: controlIndex, parentIndex: -1, useRef: "skill:" + plan.InstructionKey, summary: model.SkillActionSummary{PlannedCount: 1}})
			found = true
			break
		}
		if !found {
			return state.basicAttackErr("unknown compiled skill binding", path+".bindingKey")
		}
	}
	sort.Slice(state.skillActions, func(first, second int) bool {
		left, right := state.skillActions[first].plan, state.skillActions[second].plan
		if left.FirstAtMs != right.FirstAtMs {
			return left.FirstAtMs < right.FirstAtMs
		}
		if left.SortOrder != right.SortOrder {
			return left.SortOrder < right.SortOrder
		}
		return left.InstructionKey < right.InstructionKey
	})
	state.skillActionByUse = make(map[string]*skillActionRuntime, len(state.skillActions))
	prior := map[string]int{}
	for index := range state.skillActions {
		action := &state.skillActions[index]
		if action.plan.Action == "INITIAL" {
			state.skillActionByUse[action.useRef] = action
		} else {
			parentIndex, exists := prior[*action.plan.ParentInstructionKey]
			if !exists {
				return state.basicAttackErr("control requires a preceding initial instruction in full stable order", "driverPlan.skillActions.parentInstructionKey")
			}
			parent := &state.skillActions[parentIndex]
			if parent.plan.Action != "INITIAL" || parent.plan.BindingKey != action.plan.BindingKey || parent.plan.SkillKey != action.plan.SkillKey || parent.plan.Source != action.plan.Source || parent.plan.Target != action.plan.Target {
				return state.basicAttackErr("control parent must retain its initial source, binding, skill and target", "driverPlan.skillActions.parentInstructionKey")
			}
			action.parentIndex, action.useRef = parentIndex, parent.useRef
		}
		prior[action.plan.InstructionKey] = index
		providerIndex := state.compiled.Abilities[action.binding.InitialAbilityIndex].ProviderIndex
		if err := state.validatePlannedSkillProvider(action.plan.Source, action.binding.ProviderRef, providerIndex); err != nil {
			return err
		}
	}
	return nil
}

func validSkillActionControl(action string) bool {
	return action == "INITIAL" || action == "CHARGE_RELEASE" || action == "RECAST" || action == "CANCEL"
}

func (state *genericRunState) handleSkillAction(index int) *model.EngineError {
	if index < 0 || index >= len(state.skillActions) {
		return state.basicAttackErr("unknown skill instruction event", "driverPlan.skillActions")
	}
	action := &state.skillActions[index]
	state.skillAction = action
	defer func() { state.skillAction = nil }()
	action.summary.ReachedCount++
	state.currentEventCommands = 0
	state.abilityAttemptCount++
	state.statFor(action.plan.AbilityRef).attemptCount++
	entry := model.DriverEntry{EntryKey: action.plan.InstructionKey, AbilityRef: action.plan.AbilityRef, Source: action.plan.Source, Target: action.plan.Target, FirstAtMs: state.nowMs}
	state.processFacts[entry.EntryKey] = model.ProcessCommandFact{DriverEntryKey: entry.EntryKey, UseRef: action.useRef}
	ability := state.compiled.Abilities[action.controlAbilityIndex]
	if action.parentIndex >= 0 && !state.skillActions[action.parentIndex].accepted {
		action.rejection = "parent_not_accepted"
	} else if state.combatantHp(action.plan.Target) <= 0 {
		action.rejection = "target_unavailable"
	} else {
		if err := state.handleProcessCommand(entry, -1, ability, entry.AbilityRef); err != nil {
			state.finishSkillActionAttempt(err)
			return err
		}
	}
	state.finishSkillActionAttempt(nil)
	return nil
}

func (state *genericRunState) finishSkillActionAttempt(err *model.EngineError) {
	action := state.skillAction
	record := model.SkillActionRecord{ParentInstructionKey: action.plan.ParentInstructionKey, InstructionKey: action.plan.InstructionKey, RequestedAtMs: action.plan.FirstAtMs, ActualAtMs: state.nowMs, Action: action.plan.Action, Source: action.plan.Source, Target: action.plan.Target, SkillKey: action.plan.SkillKey, BindingKey: action.plan.BindingKey, ProviderRef: action.binding.ProviderRef, ProviderDefinitionRef: action.binding.ProviderDefinitionRef}
	if action.accepted {
		record.Outcome, record.UseRef = "ACCEPTED", &action.useRef
	} else if err != nil {
		record.Outcome = "ABORTED_BEFORE_ACCEPT"
		reason := string(err.BudgetCause)
		if reason == "" {
			reason = err.Message
		}
		record.Reason = &reason
		action.summary.AbortedBeforeAcceptCount++
	} else {
		record.Outcome, record.Reason = "REJECTED", &action.rejection
		action.summary.RejectedCount++
	}
	state.skillActionRecordCount++
	if state.detailedOutput() && len(state.skillActionRecords) < state.maxSkillActionRecords {
		state.skillActionRecords = append(state.skillActionRecords, record)
	}
	delete(state.processFacts, action.plan.InstructionKey)
}

func (state *genericRunState) publishSkillActionStart(process *processRuntime) {
	action := state.skillActionByUse[process.UseKey]
	if action == nil || action.accepted || process.UseKey != action.useRef || process.abilityRef != action.plan.AbilityRef {
		return
	}
	action.accepted = true
	if hasSimpleStepHits(process.definition, action.binding) {
		stages := make([]model.ProcessSkillHitStage, 0, len(action.binding.HitBindings))
		process.SkillHitStages = &stages
	}
	action.summary.AcceptedCount++
	action.uses.StartedCount++
	state.skillUses[process.UseKey] = &skillUseRuntime{useKey: process.UseKey, source: process.Owner, skillKey: process.SkillKey, historyState: model.SkillHitHistoryComplete}
	state.recordSkillUse(process, "STARTED", nil, nil)
	state.publishAutomaticSkillStart(action, process)
}

func (state *genericRunState) recordSkillUse(process *processRuntime, kind string, hit, reason *string) {
	action := state.skillActionByUse[process.UseKey]
	if action == nil || !action.accepted || process.UseKey != action.useRef {
		return
	}
	if action.automaticRule != nil {
		return
	}
	state.skillUseRecordCount++
	if state.detailedOutput() && len(state.skillUseRecords) < state.maxSkillUseRecords {
		target := process.Target
		if process.EmpoweredAttack != nil {
			target = process.EmpoweredAttack.Target
		}
		state.skillUseRecords = append(state.skillUseRecords, model.SkillUseRecord{EmpoweredAttack: process.EmpoweredAttack, StepKey: process.StepKey, StepVersion: process.StepVersion, ExecutionIndex: process.StepExecutionIndex, InstructionKey: action.plan.InstructionKey, TimeMs: state.nowMs, Kind: kind, Source: process.Owner, Target: target, SkillKey: process.SkillKey, ProviderRef: process.ProviderRef, ProcessKey: process.ProcessKey, UseRef: process.UseKey, HitRef: hit, Reason: reason})
	}
}

func (state *genericRunState) publishSkillActionFinish(process *processRuntime) {
	action := state.skillActionByUse[process.UseKey]
	if action == nil || !action.accepted || process.UseKey != action.useRef {
		return
	}
	if action.automaticRule != nil && action.automaticFinished {
		return
	}
	if process.Status == "complete" {
		action.uses.CompletedCount++
		state.recordSkillUse(process, "COMPLETED", nil, nil)
	} else {
		action.uses.FailedCount++
		state.recordSkillUse(process, "FAILED", nil, process.FailureReason)
	}
	state.publishAutomaticSkillFinish(action, process)
}

func (state *genericRunState) publishSkillActionControl(process *processRuntime, abilityRef string) {
	action := state.skillAction
	if action != nil && action.plan.Action != "INITIAL" && !action.accepted && process != nil && process.UseKey == action.useRef && abilityRef == action.plan.AbilityRef {
		action.accepted = true
		action.summary.AcceptedCount++
	}
}

func (state *genericRunState) publishSkillActionMoment(process *processRuntime, kind string) {
	action := state.skillActionByUse[process.UseKey]
	if action == nil || !action.accepted {
		return
	}
	switch kind {
	case "STEP_START":
		action.uses.StepEnteredCount++
		state.recordSkillUse(process, "STEP_ENTERED", nil, nil)
	case "STEP_EXECUTION":
		action.uses.StepExecutedCount++
		state.recordSkillUse(process, "STEP_EXECUTED", nil, nil)
		if process.definition.Steps[process.stepIndex].StepType == "CHARGE" {
			elapsed := state.nowMs - process.StepStartedAtMs
			action.chargeDurationMs = &elapsed
		}
	case "STEP_COMPLETE":
		action.uses.StepCompletedCount++
		state.recordSkillUse(process, "STEP_COMPLETED", nil, nil)
	}
	for _, hit := range action.binding.HitBindings {
		if !processMomentMatches(hit.Moment, kind, process.StepKey, "") {
			continue
		}
		released := action.hasRequiredHitContact(hit)
		if process.SkillHitStages != nil {
			*process.SkillHitStages = append(*process.SkillHitStages, model.ProcessSkillHitStage{HitBindingKey: hit.HitBindingKey, StepKey: process.StepKey, TimeMs: state.nowMs, Released: released})
		}
		if released {
			action.uses.ReleasedCount++
			state.recordSkillUse(process, "RELEASED", nil, nil)
		}
	}
	if kind == "PROCESS_COMPLETE" && len(action.binding.HitBindings) == 0 {
		action.uses.ReleasedCount++
		state.recordSkillUse(process, "RELEASED", nil, nil)
	}
}

func (state *genericRunState) resolveSkillActionMoment(process *processRuntime, kind string) *model.EngineError {
	action := state.skillActionByUse[process.UseKey]
	if action != nil && action.binding.HasEmpoweredAttack {
		return nil
	}
	if action == nil || !action.accepted || process.UseKey != action.useRef || process.Status == "failed" || process.Owner != action.plan.Source || process.ProviderRef != action.binding.ProviderRef || process.ProcessKey != action.binding.Controls[0].ProcessKey || state.actionDeaths[process.Owner] || state.actionDeaths[process.Target] || state.combatantHp(process.Owner) <= 0 || state.combatantHp(process.Target) <= 0 {
		return nil
	}
	for index, hit := range action.binding.HitBindings {
		if !processMomentMatches(hit.Moment, kind, process.StepKey, "") {
			continue
		}
		if !action.hasRequiredHitContact(hit) {
			process.completeSkillHitStage(hit.HitBindingKey, false, true)
			continue
		}
		miss := false
		for _, preset := range action.plan.HitBindings {
			if preset.HitBindingKey == hit.HitBindingKey {
				miss = preset.Preset == "MISS"
			}
		}
		if miss {
			process.completeSkillHitStage(hit.HitBindingKey, false, true)
			continue
		}
		action.nextHitSequence++
		before := action.uses.HitCount
		err := state.executeSkillActionHit(process, action, hit, action.nextHitSequence)
		contact := action.uses.HitCount > before
		process.completeSkillHitStage(hit.HitBindingKey, contact, err == nil)
		if err != nil {
			return err
		}
		if contact {
			action.committedHitContacts |= uint64(1) << uint(index)
		}
	}
	return nil
}

func (state *genericRunState) executeSkillActionHit(process *processRuntime, action *skillActionRuntime, hit model.SkillActionHitBinding, sequence int) *model.EngineError {
	key := action.plan.InstructionKey + ":" + hit.HitBindingKey + ":" + strconv.Itoa(sequence) + nativeHitFollowUpSuffix
	state.skillHitFacts[key] = model.SkillHitFact{DriverEntryKey: key, UseRef: &action.useRef, Sequence: &sequence}
	entry := model.DriverEntry{EntryKey: key, AbilityRef: hit.HitAbilityRef, Source: process.Owner, Target: process.Target, FirstAtMs: state.nowMs}
	defer delete(state.skillHitFacts, key)
	gate := state.checkAttemptGate(entry, -1)
	if gate.err != nil {
		return gate.err
	}
	if gate.skipped {
		state.recordAttemptSkipped(entry, gate.reason, gate.readyAtMs)
		return nil
	}
	return state.executeAbilityCast(entry)
}

func (frame *executionFrame) skillActionUseRef() string {
	if frame.processUseKey != "" {
		return frame.processUseKey
	}
	if frame.eventCtx != nil {
		if frame.eventCtx.hasUse {
			return frame.eventCtx.useKey
		}
		if frame.eventCtx.skillHit != nil {
			return frame.eventCtx.skillHit.useRef
		}
	}
	if fact, exists := frame.run.skillHitFacts[frame.driverEntryKey]; exists && fact.UseRef != nil {
		return *fact.UseRef
	}
	return ""
}

type committedSkillActionHit struct {
	useRef        string
	occurrenceID  uint64
	evidenceIndex int
}

// 与对应命中证据一起暂存，只有成功提交后发布使用记录与命中统计。
func (frame *executionFrame) recordSkillActionHit(useRef string, occurrenceID uint64) {
	fact := committedSkillActionHit{useRef: useRef, occurrenceID: occurrenceID, evidenceIndex: frame.pendingEvidenceIndex()}
	if frame.committed {
		frame.run.recordSkillActionHit(fact)
		return
	}
	frame.pendingSkillHits = append(frame.pendingSkillHits, fact)
}

func (state *genericRunState) recordSkillActionHit(fact committedSkillActionHit) {
	action := state.skillActionByUse[fact.useRef]
	if action == nil || !action.accepted {
		return
	}
	action.uses.HitCount++
	for _, process := range state.processInstances {
		if process.UseKey == action.useRef {
			// 保持原提交口径：HIT记录使用提交时的全局发生计数。
			hit := "hit:" + strconv.FormatUint(state.skillHitOccurrenceCount, 10)
			state.recordSkillUse(process, "HIT", &hit, nil)
			return
		}
	}
}

func (state *genericRunState) recordDirectHealing(record model.DirectHealingRecord) {
	if record.Target == model.SelectorSource {
		state.sourceDirectHealing += record.ActualHealing
	}
	if record.Target == model.SelectorTarget {
		state.targetDirectHealing += record.ActualHealing
	}
	state.healingRecordCount++
	if state.detailedOutput() && len(state.healingRecords) < state.maxHealingRecords {
		state.healingRecords = append(state.healingRecords, record)
	}
}

func (state *genericRunState) seedSkillAction() {
	for index, action := range state.skillActions {
		state.pushCombatEvent(scheduler.GenericEvent{TimeMs: action.plan.FirstAtMs, Category: scheduler.GenericCategorySkillAction, Kind: scheduler.GenericEventSkillAction, SkillActionIndex: index, DriverEntryIndex: -1})
	}
}

func (state *genericRunState) skillSummaries() (model.SkillActionSummary, model.SkillUseSummary) {
	actions := model.SkillActionSummary{PlannedCount: len(state.skillActions)}
	uses := model.SkillUseSummary{}
	for _, action := range state.skillActions {
		actions.ReachedCount += action.summary.ReachedCount
		actions.AcceptedCount += action.summary.AcceptedCount
		actions.RejectedCount += action.summary.RejectedCount
		actions.AbortedBeforeAcceptCount += action.summary.AbortedBeforeAcceptCount
		uses.StartedCount += action.uses.StartedCount
		uses.ReleasedCount += action.uses.ReleasedCount
		uses.HitCount += action.uses.HitCount
		uses.CompletedCount += action.uses.CompletedCount
		uses.FailedCount += action.uses.FailedCount
		uses.StepEnteredCount += action.uses.StepEnteredCount
		uses.StepExecutedCount += action.uses.StepExecutedCount
		uses.StepCompletedCount += action.uses.StepCompletedCount
	}
	actions.UnreachedCount = actions.PlannedCount - actions.ReachedCount
	uses.InFlightCount = uses.StartedCount - uses.CompletedCount - uses.FailedCount
	return actions, uses
}

func (state *genericRunState) skillRecordingSummary(summary model.RecordingSummary) model.RecordingSummary {
	summary.SkillActionRecordCount, summary.ReturnedSkillActionRecords = state.skillActionRecordCount, len(state.skillActionRecords)
	summary.DroppedSkillActionRecords = summary.SkillActionRecordCount - state.retainedRecordCount(summary.SkillActionRecordCount, summary.ReturnedSkillActionRecords, state.maxSkillActionRecords)
	summary.SkillActionRecordsTruncated = summary.DroppedSkillActionRecords > 0
	summary.SkillUseRecordCount, summary.ReturnedSkillUseRecords = state.skillUseRecordCount, len(state.skillUseRecords)
	summary.DroppedSkillUseRecords = summary.SkillUseRecordCount - state.retainedRecordCount(summary.SkillUseRecordCount, summary.ReturnedSkillUseRecords, state.maxSkillUseRecords)
	summary.SkillUseRecordsTruncated = summary.DroppedSkillUseRecords > 0
	summary.HealingRecordCount, summary.ReturnedHealingRecords = state.healingRecordCount, len(state.healingRecords)
	summary.DroppedHealingRecords = summary.HealingRecordCount - state.retainedRecordCount(summary.HealingRecordCount, summary.ReturnedHealingRecords, state.maxHealingRecords)
	summary.HealingRecordsTruncated = summary.DroppedHealingRecords > 0
	return summary
}
