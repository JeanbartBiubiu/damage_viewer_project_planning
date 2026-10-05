package runtime

import (
	"strconv"
	"strings"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

type skillActionRuntime struct {
	plan           model.SkillActionPlan
	binding        compilebundle.CompiledSkillActionBinding
	summary        model.SkillActionSummary
	uses           model.SkillUseSummary
	useRef         string
	accepted       bool
	rejection      string
	targetKilledAt *int64
}

func (state *genericRunState) automatedRun() bool {
	return state.basicAttack != nil || state.skillAction != nil
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
	if len(state.req.DriverPlan.SkillActions) != 1 || state.req.DriverPlan.BasicAttack != nil || state.req.DriverPlan.Entries == nil || len(state.req.DriverPlan.Entries)+len(state.req.SkillUses)+len(state.req.SkillHitFacts)+len(state.req.AttackStartFacts)+len(state.req.ProcessCommandFacts) != 0 {
		return state.basicAttackErr("single cast requires exactly one skill instruction and no background attack or external facts", "driverPlan")
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
	plan := state.req.DriverPlan.SkillActions[0]
	if strings.TrimSpace(plan.InstructionKey) == "" || plan.Source != model.SelectorSource || (plan.Target != model.SelectorSource && plan.Target != model.SelectorTarget) || plan.Action != "INITIAL" || plan.ParentInstructionKey != nil || plan.FirstAtMs < 0 || plan.FirstAtMs > state.durationMs || plan.SortOrder < 0 || plan.HitBindings == nil {
		return state.basicAttackErr("invalid single INITIAL instruction, timing or target", "driverPlan.skillActions[0]")
	}
	for _, binding := range state.compiled.SkillActionBindings {
		if binding.BindingKey != plan.BindingKey {
			continue
		}
		if binding.SkillKey != plan.SkillKey || binding.Source != plan.Source || binding.Controls[0].AbilityRef != plan.AbilityRef || binding.Controls[0].Action != plan.Action || len(plan.HitBindings) != len(binding.HitBindings) {
			return state.basicAttackErr("instruction does not match its immutable compiled skill binding", "driverPlan.skillActions[0]")
		}
		if len(plan.HitBindings) > 0 && (plan.HitBindings[0].HitBindingKey != binding.HitBindings[0].HitBindingKey || (plan.HitBindings[0].Preset != "TARGET_HIT" && plan.HitBindings[0].Preset != "MISS") || plan.Target != model.SelectorTarget) {
			return state.basicAttackErr("invalid release binding, hit preset or unique target", "driverPlan.skillActions[0].hitBindings")
		}
		state.skillAction = &skillActionRuntime{plan: plan, binding: binding, summary: model.SkillActionSummary{PlannedCount: 1}}
		return nil
	}
	return state.basicAttackErr("unknown compiled skill binding", "driverPlan.skillActions[0].bindingKey")
}

func (state *genericRunState) handleSkillAction() *model.EngineError {
	action := state.skillAction
	action.summary.ReachedCount++
	state.currentEventCommands = 0
	state.abilityAttemptCount++
	state.statFor(action.plan.AbilityRef).attemptCount++
	action.useRef = "skill:" + action.plan.InstructionKey
	entry := model.DriverEntry{EntryKey: action.plan.InstructionKey, AbilityRef: action.plan.AbilityRef, Source: action.plan.Source, Target: action.plan.Target, FirstAtMs: state.nowMs}
	state.processFacts[entry.EntryKey] = model.ProcessCommandFact{DriverEntryKey: entry.EntryKey, UseRef: action.useRef}
	ability := state.compiled.Abilities[action.binding.InitialAbilityIndex]
	if state.combatantHp(action.plan.Target) <= 0 {
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
	record := model.SkillActionRecord{InstructionKey: action.plan.InstructionKey, RequestedAtMs: action.plan.FirstAtMs, ActualAtMs: state.nowMs, Action: action.plan.Action, Source: action.plan.Source, Target: action.plan.Target, SkillKey: action.plan.SkillKey, BindingKey: action.plan.BindingKey, ProviderRef: action.binding.ProviderRef, ProviderDefinitionRef: action.binding.ProviderDefinitionRef}
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
	if len(state.skillActionRecords) < state.maxSkillActionRecords {
		state.skillActionRecords = append(state.skillActionRecords, record)
	}
	delete(state.processFacts, action.plan.InstructionKey)
}

func (state *genericRunState) publishSkillActionStart(process *processRuntime) {
	action := state.skillAction
	if action == nil || action.accepted || process.UseKey != action.useRef || process.abilityRef != action.plan.AbilityRef {
		return
	}
	action.accepted = true
	action.summary.AcceptedCount++
	action.uses.StartedCount++
	state.skillUses[process.UseKey] = &skillUseRuntime{useKey: process.UseKey, source: process.Owner, skillKey: process.SkillKey, historyState: model.SkillHitHistoryComplete}
	state.recordSkillUse(process, "STARTED", nil, nil)
}

func (state *genericRunState) recordSkillUse(process *processRuntime, kind string, hit, reason *string) {
	action := state.skillAction
	if action == nil || !action.accepted || process.UseKey != action.useRef {
		return
	}
	state.skillUseRecordCount++
	if len(state.skillUseRecords) < state.maxSkillUseRecords {
		state.skillUseRecords = append(state.skillUseRecords, model.SkillUseRecord{InstructionKey: action.plan.InstructionKey, TimeMs: state.nowMs, Kind: kind, Source: process.Owner, Target: process.Target, SkillKey: process.SkillKey, ProviderRef: process.ProviderRef, ProcessKey: process.ProcessKey, UseRef: process.UseKey, HitRef: hit, Reason: reason})
	}
}

func (state *genericRunState) publishSkillActionFinish(process *processRuntime) {
	action := state.skillAction
	if action == nil || !action.accepted || process.UseKey != action.useRef {
		return
	}
	if process.Status == "complete" {
		action.uses.ReleasedCount++
		action.uses.CompletedCount++
		state.recordSkillUse(process, "RELEASED", nil, nil)
		state.recordSkillUse(process, "COMPLETED", nil, nil)
	} else {
		action.uses.FailedCount++
		state.recordSkillUse(process, "FAILED", nil, process.FailureReason)
	}
}

func (state *genericRunState) resolveSkillActionRelease(process *processRuntime) *model.EngineError {
	action := state.skillAction
	if action == nil || !action.accepted || process.UseKey != action.useRef || process.Status != "complete" || process.Owner != action.plan.Source || process.ProviderRef != action.binding.ProviderRef || process.ProcessKey != action.binding.Controls[0].ProcessKey || state.combatantHp(process.Owner) <= 0 || state.combatantHp(process.Target) <= 0 || len(action.plan.HitBindings) == 0 || action.plan.HitBindings[0].Preset == "MISS" {
		return nil
	}
	key := action.plan.InstructionKey + nativeHitFollowUpSuffix
	sequence := 1
	state.skillHitFacts[key] = model.SkillHitFact{DriverEntryKey: key, UseRef: &action.useRef, Sequence: &sequence}
	entry := model.DriverEntry{EntryKey: key, AbilityRef: action.binding.HitBindings[0].HitAbilityRef, Source: process.Owner, Target: process.Target, FirstAtMs: state.nowMs}
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

func (state *genericRunState) recordSkillActionHit(item model.EvidenceItem) {
	action := state.skillAction
	if action == nil || !action.accepted || item.Kind != model.EvidenceKindSkillHit || item.Data["useRef"] != action.useRef {
		return
	}
	action.uses.HitCount++
	for _, process := range state.processInstances {
		if process.UseKey == action.useRef {
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
	if len(state.healingRecords) < state.maxHealingRecords {
		state.healingRecords = append(state.healingRecords, record)
	}
}

func (state *genericRunState) seedSkillAction() {
	if state.skillAction != nil {
		state.pushCombatEvent(scheduler.GenericEvent{TimeMs: state.skillAction.plan.FirstAtMs, Category: scheduler.GenericCategoryAbilityAttempt, Kind: scheduler.GenericEventSkillAction, DriverEntryIndex: -1})
	}
}

func (state *genericRunState) skillRecordingSummary(summary model.RecordingSummary) model.RecordingSummary {
	summary.SkillActionRecordCount, summary.ReturnedSkillActionRecords = state.skillActionRecordCount, len(state.skillActionRecords)
	summary.DroppedSkillActionRecords = summary.SkillActionRecordCount - summary.ReturnedSkillActionRecords
	summary.SkillActionRecordsTruncated = summary.DroppedSkillActionRecords > 0
	summary.SkillUseRecordCount, summary.ReturnedSkillUseRecords = state.skillUseRecordCount, len(state.skillUseRecords)
	summary.DroppedSkillUseRecords = summary.SkillUseRecordCount - summary.ReturnedSkillUseRecords
	summary.SkillUseRecordsTruncated = summary.DroppedSkillUseRecords > 0
	summary.HealingRecordCount, summary.ReturnedHealingRecords = state.healingRecordCount, len(state.healingRecords)
	summary.DroppedHealingRecords = summary.HealingRecordCount - summary.ReturnedHealingRecords
	summary.HealingRecordsTruncated = summary.DroppedHealingRecords > 0
	return summary
}
