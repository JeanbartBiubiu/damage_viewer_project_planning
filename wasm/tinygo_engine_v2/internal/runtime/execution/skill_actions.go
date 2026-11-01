package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

type committedSkillActionHit struct {
	useRef        string
	occurrenceID  uint64
	evidenceIndex int
}

// 编译已确认依赖位于同一绑定的更早步骤；旧绑定无依赖时不增加查找。
func hasSimpleStepHits(definition *planbundle.CompiledProcess, binding planbundle.CompiledSkillActionBinding) bool {
	if len(binding.HitBindings) == 0 || binding.HitBindings[0].Moment.MomentType != "STEP_EXECUTION" {
		return false
	}
	for _, step := range definition.Steps {
		if step.StepType != "IMMEDIATE" && step.StepType != "DELAY" && step.StepType != "RECAST" {
			return false
		}
	}
	return true
}

func (state *Engine) automatedRun() bool {
	return state.actions.BasicAttack() != nil || state.hasSkillPlan()
}

func (state *Engine) hasSkillPlan() bool {
	return state.actions.ManualCount() > 0 || state.actions.HasAutomatic()
}

func (state *Engine) initSkillAction() *model.EngineError {
	if !state.report.InitSkillRecords(state.req.RecordBudget) {
		return state.basicAttackErr("invalid skill or healing record budget", "recordBudget")
	}
	if len(state.req.DriverPlan.SkillActions) == 0 {
		return nil
	}
	if len(state.req.DriverPlan.SkillActions) > 64 || state.req.DriverPlan.Entries == nil || len(state.req.DriverPlan.Entries)+len(state.req.SkillUses)+len(state.req.SkillHitFacts)+len(state.req.AttackStartFacts)+len(state.req.ProcessCommandFacts) != 0 {
		return state.basicAttackErr("planned casts require 1 to 64 instructions and no external facts", "driverPlan")
	}
	if state.loop.StartMs() != 0 || state.loop.DurationMs() < 1 || state.loop.DurationMs() > 600000 {
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
	for index, plan := range state.req.DriverPlan.SkillActions {
		path := "driverPlan.skillActions[" + strconv.Itoa(index) + "]"
		if strings.TrimSpace(plan.InstructionKey) == "" || seen[plan.InstructionKey] || plan.Source != model.SelectorSource || (plan.Target != model.SelectorSource && plan.Target != model.SelectorTarget) || !validSkillActionControl(plan.Action) || (plan.Action == "INITIAL" && plan.ParentInstructionKey != nil) || (plan.Action != "INITIAL" && (plan.ParentInstructionKey == nil || strings.TrimSpace(*plan.ParentInstructionKey) == "")) || plan.FirstAtMs < 0 || plan.FirstAtMs > state.loop.DurationMs() || plan.SortOrder < 0 || plan.HitBindings == nil {
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
			state.actions.AddManualAction(actionpkg.NewSkillAction(actionpkg.SkillActionSeed{Plan: plan, Binding: binding, ControlAbilityIndex: controlIndex, ParentIndex: -1, UseRef: "skill:" + plan.InstructionKey, Summary: model.SkillActionSummary{PlannedCount: 1}}))
			found = true
			break
		}
		if !found {
			return state.basicAttackErr("unknown compiled skill binding", path+".bindingKey")
		}
	}
	if message := state.actions.BindManualParents(); message != "" {
		return state.basicAttackErr(message, "driverPlan.skillActions.parentInstructionKey")
	}
	for index := 0; index < state.actions.ManualCount(); index++ {
		action := state.actions.ManualAt(index)
		providerIndex := state.compiled.Abilities[action.Binding().InitialAbilityIndex].ProviderIndex
		if err := state.validatePlannedSkillProvider(action.Plan().Source(), action.Binding().ProviderRef, providerIndex); err != nil {
			return err
		}
	}
	return nil
}

func validSkillActionControl(action string) bool {
	return action == "INITIAL" || action == "CHARGE_RELEASE" || action == "RECAST" || action == "CANCEL"
}

func (state *Engine) handleSkillAction(index int) *model.EngineError {
	if index < 0 || index >= state.actions.ManualCount() {
		return state.basicAttackErr("unknown skill instruction event", "driverPlan.skillActions")
	}
	action := state.actions.ManualAt(index)
	state.actions.SetCurrentAction(action)
	defer func() { state.actions.SetCurrentAction(nil) }()
	state.actions.Reached(action)
	state.currentEventCommands = 0
	state.report.Attempt(action.Plan().AbilityRef())
	entry := model.DriverEntry{EntryKey: action.Plan().InstructionKey(), AbilityRef: action.Plan().AbilityRef(), Source: action.Plan().Source(), Target: action.Plan().Target(), FirstAtMs: state.loop.TimeMs()}
	state.actions.SetProcessFact(entry.EntryKey, model.ProcessCommandFact{DriverEntryKey: entry.EntryKey, UseRef: action.UseRef()})
	ability := state.compiled.Abilities[action.ControlAbilityIndex()]
	if action.ParentIndex() >= 0 && !state.actions.ManualAt(action.ParentIndex()).Accepted() {
		state.actions.Reject(action, "parent_not_accepted")
	} else if state.combatantHp(action.Plan().Target()) <= 0 {
		state.actions.Reject(action, "target_unavailable")
	} else {
		if err := state.handleProcessCommand(entry, -1, ability, entry.AbilityRef); err != nil {
			state.finishSkillActionAttempt(err)
			return err
		}
	}
	state.finishSkillActionAttempt(nil)
	return nil
}

func (state *Engine) finishSkillActionAttempt(err *model.EngineError) {
	action := state.actions.CurrentAction()
	record := state.actions.FinishAttempt(action, state.loop.TimeMs(), err)
	state.report.RecordSkillAction(record, state.detailedOutput())
	state.actions.RemoveProcessFact(action.Plan().InstructionKey())
}

func (state *Engine) publishSkillActionStart(process *actionpkg.ProcessView) {
	action := state.actions.ActionForUse(process.UseKey())
	if action == nil || action.Accepted() || process.UseKey() != action.UseRef() || process.AbilityRef() != action.Plan().AbilityRef() {
		return
	}
	state.actions.Accept(action, "", true)
	if hasSimpleStepHits(process.Definition(), action.Binding()) {
		state.actions.InitSkillHitStages(process)
	}
	state.skillUses[process.UseKey()] = &skillUseRuntime{identity: state.actions.NewUse(actionpkg.UseSeed{UseKey: process.UseKey(), Source: process.Owner(), SkillKey: process.SkillKey(), HistoryState: model.SkillHitHistoryComplete, ProcessRef: process.Reference(), ActionRef: action.Reference(), CastID: process.CastID()})}
	state.recordSkillUse(process, "STARTED", nil, nil)
	state.publishAutomaticSkillStart(action, process)
}

func (state *Engine) recordSkillUse(process *actionpkg.ProcessView, kind string, hit, reason *string) {
	action := state.actions.ActionForUse(process.UseKey())
	if action == nil || !action.Accepted() || process.UseKey() != action.UseRef() {
		return
	}
	if action.AutomaticRule() != nil {
		return
	}
	if state.report.BeginSkillUse(state.detailedOutput()) {
		use, instruction := process.UseKey(), action.Plan().InstructionKey()
		if (kind == "RELEASED" || kind == "HIT") && process.CastUseKey() != "" {
			use = process.CastUseKey()
			if cast := state.skillActionForUse(use); cast != nil {
				instruction = cast.Plan().InstructionKey()
			}
		}
		target := process.Target()
		if process.EmpoweredAttack() != nil {
			target = process.EmpoweredAttack().Target
		}
		state.report.AppendSkillUse(model.SkillUseRecord{EmpoweredAttack: process.EmpoweredAttack(), StepKey: process.StepKey(), StepVersion: process.StepVersion(), ExecutionIndex: process.StepExecutionIndex(), InstructionKey: instruction, TimeMs: state.loop.TimeMs(), Kind: kind, Source: process.Owner(), Target: target, SkillKey: process.SkillKey(), ProviderRef: process.ProviderRef(), ProcessKey: process.ProcessKey(), UseRef: use, HitRef: hit, Reason: reason})
	}
}

func (state *Engine) publishSkillActionFinish(process *actionpkg.ProcessView) {
	action := state.actions.ActionForUse(process.UseKey())
	if action == nil || !action.Accepted() || process.UseKey() != action.UseRef() {
		return
	}
	if action.AutomaticRule() != nil && action.AutomaticFinished() {
		return
	}
	if process.Status() == "complete" {
		state.actions.RecordUse(action, "COMPLETED")
		state.recordSkillUse(process, "COMPLETED", nil, nil)
	} else {
		state.actions.RecordUse(action, "FAILED")
		state.recordSkillUse(process, "FAILED", nil, process.FailureReason())
	}
	state.publishAutomaticSkillFinish(action, process)
}

func (state *Engine) publishSkillActionControl(process *actionpkg.ProcessView, abilityRef string) {
	action := state.actions.CurrentAction()
	if action != nil && action.Plan().Action() != "INITIAL" && !action.Accepted() && process != nil && process.UseKey() == action.UseRef() && abilityRef == action.Plan().AbilityRef() {
		use := ""
		if action.Plan().Action() == "RECAST" {
			use = process.CastUseKey()
		}
		state.actions.Accept(action, use, false)
	}
	if process != nil && process.CastUseKey() != "" && process.CastUseKey() != process.UseKey() && state.skillUses[process.CastUseKey()] == nil {
		state.skillUses[process.CastUseKey()] = &skillUseRuntime{identity: state.actions.NewUse(actionpkg.UseSeed{UseKey: process.CastUseKey(), Source: process.Owner(), SkillKey: process.SkillKey(), HistoryState: model.SkillHitHistoryComplete, ProcessRef: process.Reference(), ActionRef: action.Reference(), CastID: process.CastID()})}
	}
}

func (state *Engine) publishSkillActionMoment(process *actionpkg.ProcessView, kind string) {
	action := state.actions.ActionForUse(process.UseKey())
	if action == nil || !action.Accepted() {
		return
	}
	switch kind {
	case "STEP_START":
		state.actions.RecordUse(action, "STEP_ENTERED")
		state.recordSkillUse(process, "STEP_ENTERED", nil, nil)
	case "STEP_EXECUTION":
		state.actions.RecordUse(action, "STEP_EXECUTED")
		state.recordSkillUse(process, "STEP_EXECUTED", nil, nil)
		if process.Definition().Steps[process.StepIndex()].StepType == "CHARGE" {
			elapsed := state.loop.TimeMs() - process.StepStartedAtMs()
			state.actions.SetChargeDuration(action, elapsed)
		}
	case "STEP_COMPLETE":
		state.actions.RecordUse(action, "STEP_COMPLETED")
		state.recordSkillUse(process, "STEP_COMPLETED", nil, nil)
	}
	for _, hit := range action.Binding().HitBindings {
		if !actionpkg.MomentMatches(hit.Moment, kind, process.StepKey(), "") {
			continue
		}
		released := action.HasRequiredHitContact(hit)
		if process.HasSkillHitStages() {
			state.actions.AppendSkillHitStage(process, model.ProcessSkillHitStage{HitBindingKey: hit.HitBindingKey, StepKey: process.StepKey(), TimeMs: state.loop.TimeMs(), Released: released})
		}
		if released {
			state.actions.RecordUse(action, "RELEASED")
			state.recordSkillUse(process, "RELEASED", nil, nil)
		}
	}
	if kind == "PROCESS_COMPLETE" && len(action.Binding().HitBindings) == 0 {
		state.actions.RecordUse(action, "RELEASED")
		state.recordSkillUse(process, "RELEASED", nil, nil)
	}
}

func (state *Engine) resolveSkillActionMoment(process *actionpkg.ProcessView, kind string) *model.EngineError {
	action := state.actions.ActionForUse(process.UseKey())
	if action != nil && action.Binding().HasEmpoweredAttack {
		return nil
	}
	if action == nil || !action.Accepted() || process.UseKey() != action.UseRef() || process.Status() == "failed" || process.Owner() != action.Plan().Source() || process.ProviderRef() != action.Binding().ProviderRef || process.ProcessKey() != action.Binding().Controls[0].ProcessKey || state.actions.Dead(process.Owner()) || state.actions.Dead(process.Target()) || state.combatantHp(process.Owner()) <= 0 || state.combatantHp(process.Target()) <= 0 {
		return nil
	}
	for index, hit := range action.Binding().HitBindings {
		if !actionpkg.MomentMatches(hit.Moment, kind, process.StepKey(), "") {
			continue
		}
		if !action.HasRequiredHitContact(hit) {
			state.actions.CompleteSkillHitStage(process, hit.HitBindingKey, false, true)
			continue
		}
		miss := false
		for presetIndex := 0; presetIndex < action.Plan().HitCount(); presetIndex++ {
			preset := action.Plan().HitAt(presetIndex)
			if preset.HitBindingKey == hit.HitBindingKey {
				miss = preset.Preset == "MISS"
			}
		}
		if miss {
			state.actions.CompleteSkillHitStage(process, hit.HitBindingKey, false, true)
			continue
		}
		state.actions.BeginHit(action)
		before := action.Uses().HitCount
		err := state.executeSkillActionHit(process, action, hit, action.NextHitSequence())
		contact := action.Uses().HitCount > before
		state.actions.CompleteSkillHitStage(process, hit.HitBindingKey, contact, err == nil)
		if err != nil {
			return err
		}
		if contact {
			state.actions.CommitHitContact(action, index)
		}
	}
	return nil
}

func (state *Engine) executeSkillActionHit(process *actionpkg.ProcessView, action *actionpkg.SkillActionView, hit model.SkillActionHitBinding, sequence int) *model.EngineError {
	use := process.UseKey()
	if process.CastUseKey() != "" {
		use = process.CastUseKey()
	}
	instruction := action.Plan().InstructionKey()
	if actual := state.skillActionForUse(use); actual != nil {
		instruction = actual.Plan().InstructionKey()
	}
	key := instruction + ":" + hit.HitBindingKey + ":" + strconv.Itoa(sequence) + nativeHitFollowUpSuffix
	state.hits.PutFact(key, model.SkillHitFact{DriverEntryKey: key, UseRef: &use, Sequence: &sequence})
	entry := model.DriverEntry{EntryKey: key, AbilityRef: hit.HitAbilityRef, Source: process.Owner(), Target: process.Target(), FirstAtMs: state.loop.TimeMs()}
	defer state.hits.RemoveFact(key)
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

func (frame *Frame) skillActionUseRef() string {
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
	if fact, exists := frame.run.hits.Fact(frame.driverEntryKey); exists && fact.UseRef != nil {
		return *fact.UseRef
	}
	return ""
}

// 与对应命中证据一起暂存，只有成功提交后发布使用记录与命中统计。
func (frame *Frame) recordSkillActionHit(useRef string, occurrenceID uint64) {
	fact := committedSkillActionHit{useRef: useRef, occurrenceID: occurrenceID, evidenceIndex: frame.pendingEvidenceIndex()}
	if frame.committed {
		frame.run.recordSkillActionHit(fact)
		return
	}
	frame.pendingSkillHits = append(frame.pendingSkillHits, fact)
}

func (state *Engine) recordSkillActionHit(fact committedSkillActionHit) {
	actual := state.skillUses[fact.useRef]
	var process *actionpkg.ProcessView
	if actual != nil {
		process = state.processForUse(actual)
	}
	action := state.actions.ActionForUse(fact.useRef)
	if process != nil {
		action = state.actions.ActionForUse(process.UseKey())
	}
	if action == nil || !action.Accepted() {
		return
	}
	state.actions.RecordUse(action, "HIT")
	for processSlot := 0; processSlot < state.actions.ProcessCount(); processSlot++ {
		process := state.actions.ProcessAt(processSlot)
		if process.UseKey() == action.UseRef() {
			// 保持原提交口径：HIT记录使用提交时的全局发生计数。
			hit := "hit:" + strconv.FormatUint(state.hits.OccurrenceCount(), 10)
			state.recordSkillUse(process, "HIT", &hit, nil)
			return
		}
	}
}

func (state *Engine) recordDirectHealing(record model.DirectHealingRecord) {
	state.report.RecordDirectHealing(record, state.detailedOutput())
}

func (state *Engine) seedSkillAction() {
	for index := 0; index < state.actions.ManualCount(); index++ {
		action := state.actions.ManualAt(index)
		state.pushCombatEvent(scheduler.GenericEvent{TimeMs: action.Plan().FirstAtMs(), Category: scheduler.GenericCategorySkillAction, Kind: scheduler.GenericEventSkillAction, SkillActionIndex: index, DriverEntryIndex: -1})
	}
}

func (state *Engine) skillSummaries() (model.SkillActionSummary, model.SkillUseSummary) {
	return state.actions.SkillSummaries()
}
