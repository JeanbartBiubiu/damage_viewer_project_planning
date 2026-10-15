package runtime

import (
	"math"
	"sort"
	"strconv"
	"strings"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

type automaticSkillRuleRuntime struct {
	inputIndex             int
	plan                   model.AutomaticSkillRule
	binding                planbundle.CompiledSkillActionBinding
	abilityRef             string
	controlIndex           uint16
	predecessor, successor *automaticSkillRuleRuntime
	dependencies           []genericCooldownIdentity
	summary                model.AutomaticSkillRuleSummary
	qualification          model.AutomaticSkillQualification
}

type automaticSkillRuntime struct {
	rules                                    []*automaticSkillRuleRuntime
	byKey                                    map[string]*automaticSkillRuleRuntime
	records                                  []model.AutomaticSkillRecord
	recordCount, maxRecords, attemptSequence int
	generation                               uint64
}

func (s *genericRunState) initAutomaticSkills() *model.EngineError {
	input := s.req.DriverPlan.AutomaticSkills
	if input == nil {
		return nil
	}
	if err := input.Validate(); err != nil {
		return s.basicAttackErr(err.Error(), strings.Fields(err.Error())[0])
	}
	if len(s.req.DriverPlan.SkillActions)+len(s.req.DriverPlan.Entries)+len(s.req.SkillUses)+len(s.req.SkillHitFacts)+len(s.req.AttackStartFacts)+len(s.req.ProcessCommandFacts) != 0 {
		return s.basicAttackErr("automatic skills require empty manual instructions and external fact arrays", "driverPlan")
	}
	if s.startMs != 0 || s.durationMs < 1 || s.durationMs > 600000 || len(s.req.InitialSnapshot.ProcessInstances)+len(s.req.InitialSnapshot.UseTriggerLedger) != 0 {
		return s.basicAttackErr("automatic skills require a fresh time-zero run and duration in [1,600000]", "initialSnapshot")
	}
	for _, actor := range s.req.InitialSnapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 {
			return s.basicAttackErr("automatic skills require empty initial runtime state", "initialSnapshot.combatants")
		}
	}
	if err := s.validateBasicAttackInitialSnapshot(); err != nil {
		return err
	}
	a := &automaticSkillRuntime{byKey: map[string]*automaticSkillRuleRuntime{}, records: []model.AutomaticSkillRecord{}, maxRecords: model.DefaultMaxAutomaticSkillRecords}
	if budget := s.req.RecordBudget; budget != nil && budget.MaxAutomaticSkillRecords != nil {
		a.maxRecords = *budget.MaxAutomaticSkillRecords
	}
	if a.maxRecords < 0 || a.maxRecords > model.MaxAutomaticSkillRecords {
		return s.basicAttackErr("invalid automatic record budget", "recordBudget.maxAutomaticSkillRecords")
	}
	for index, rule := range input.Rules {
		path := "driverPlan.automaticSkills.rules[" + strconv.Itoa(index) + "]"
		var binding *planbundle.CompiledSkillActionBinding
		for i := range s.compiled.SkillActionBindings {
			if s.compiled.SkillActionBindings[i].BindingKey == rule.BindingKey {
				binding = &s.compiled.SkillActionBindings[i]
				break
			}
		}
		if binding == nil {
			return s.basicAttackErr("unknown compiled skill binding", path+".bindingKey")
		}
		if !binding.AutomaticEligible {
			return s.basicAttackErr(binding.AutomaticIneligibleReason, binding.AutomaticIneligiblePath)
		}
		control, exists := binding.ControlAbilityIndices["INITIAL"]
		if !exists || binding.Source != model.SelectorSource || len(rule.HitBindings) != len(binding.HitBindings) {
			return s.basicAttackErr("automatic rule must match its actual initial binding and complete hit presets", path)
		}
		for _, preset := range rule.HitBindings {
			found := false
			for _, hit := range binding.HitBindings {
				if hit.HitBindingKey == preset.HitBindingKey {
					found = true
					break
				}
			}
			if !found || rule.Target != model.SelectorTarget {
				return s.basicAttackErr("hit preset must name a compiled hit binding on the actual target", path+".hitBindings")
			}
		}
		ref := binding.Source + ".provider[" + binding.ProviderRef + "].ability[" + s.compiled.Abilities[control].AbilityKey + "]"
		r := &automaticSkillRuleRuntime{inputIndex: index, plan: rule, binding: *binding, abilityRef: ref, controlIndex: control, summary: model.AutomaticSkillRuleSummary{RuleKey: rule.RuleKey}}
		r.dependencies = []genericCooldownIdentity{genericAbilityCooldownIdentity(binding.Source, ref)}
		a.rules, a.byKey[rule.RuleKey] = append(a.rules, r), r
	}
	sort.Slice(a.rules, func(i, j int) bool { return a.rules[i].plan.SortOrder < a.rules[j].plan.SortOrder })
	for _, r := range a.rules {
		path := "driverPlan.automaticSkills.rules[" + strconv.Itoa(r.inputIndex) + "]"
		for index, key := range r.plan.WaitForCooldowns {
			dependency := a.byKey[key]
			if dependency == nil {
				return s.basicAttackErr("cooldown reference must name a selected rule: "+key, path+".waitForCooldowns["+strconv.Itoa(index)+"]")
			}
			r.dependencies = append(r.dependencies, genericAbilityCooldownIdentity(model.SelectorSource, dependency.abilityRef))
		}
		if r.plan.ReleaseAfterRuleKey != nil {
			p := a.byKey[*r.plan.ReleaseAfterRuleKey]
			if p == nil || p.successor != nil {
				return s.basicAttackErr("qualification requires a selected unique predecessor without branching: "+*r.plan.ReleaseAfterRuleKey, path+".releaseAfterRuleKey")
			}
			r.predecessor, p.successor = p, r
			r.qualification.GrantorRuleKey, r.qualification.ConsumerRuleKey = p.plan.RuleKey, r.plan.RuleKey
		}
	}
	for _, r := range a.rules {
		seen := map[string]bool{}
		for current := r; current != nil; current = current.predecessor {
			if seen[current.plan.RuleKey] {
				return s.basicAttackErr("qualification chain cannot contain a cycle", "driverPlan.automaticSkills.rules["+strconv.Itoa(r.inputIndex)+"].releaseAfterRuleKey")
			}
			seen[current.plan.RuleKey] = true
		}
	}
	s.automaticSkills = a
	s.skillActionByUse = map[string]*skillActionRuntime{}
	for _, r := range a.rules {
		if err := s.validatePlannedSkillProvider(r.binding.Source, r.binding.ProviderRef, s.compiled.Abilities[r.binding.InitialAbilityIndex].ProviderIndex); err != nil {
			return err
		}
	}
	return nil
}

func (s *genericRunState) queueAutomaticSkills(at int64) {
	a := s.automaticSkills
	if a == nil || at < s.nowMs {
		return
	}
	a.generation++
	if s.heap.RescheduleAutomaticSkill(at, a.generation) {
		return
	}
	s.pushCombatEvent(scheduler.GenericEvent{TimeMs: at, Category: scheduler.GenericCategorySkillAction, Kind: scheduler.GenericEventAutomaticSkill, AutomaticGeneration: a.generation, DriverEntryIndex: -1})
}

func (s *genericRunState) automaticWait(r *automaticSkillRuleRuntime, reason string, related []string, at int64) {
	var next *int64
	if at > s.nowMs {
		value := at
		next = &value
	}
	var waiting *model.AutomaticSkillWaiting
	if reason != "" {
		if related == nil {
			related = []string{}
		}
		waiting = &model.AutomaticSkillWaiting{Reason: reason, RelatedRuleKeys: related, NextCheckAtMs: next}
	}
	if sameAutomaticWaiting(r.summary.Waiting, waiting) {
		return
	}
	r.summary.Waiting = waiting
	record := model.AutomaticSkillRecord{Kind: model.AutomaticRecordWaitChanged, RuleKey: r.plan.RuleKey, NextCheckAtMs: next}
	if reason != "" {
		record.Reason = &reason
	}
	if len(related) != 0 {
		key := related[0]
		record.RelatedRuleKey = &key
	}
	s.recordAutomatic(record)
}

func sameAutomaticWaiting(a, b *model.AutomaticSkillWaiting) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Reason != b.Reason || len(a.RelatedRuleKeys) != len(b.RelatedRuleKeys) || (a.NextCheckAtMs == nil) != (b.NextCheckAtMs == nil) {
		return false
	}
	if a.NextCheckAtMs != nil && *a.NextCheckAtMs != *b.NextCheckAtMs {
		return false
	}
	for i, key := range a.RelatedRuleKeys {
		if key != b.RelatedRuleKeys[i] {
			return false
		}
	}
	return true
}

func (s *genericRunState) automaticCandidate(r *automaticSkillRuleRuntime) (string, []string, int64, *model.EngineError) {
	ledger := s.combatants[model.SelectorSource].cooldowns
	if r.predecessor != nil && r.qualification.RemainingCount == 0 {
		return model.AutomaticWaitReleaseQualification, []string{r.predecessor.plan.RuleKey}, 0, nil
	}
	if !ledger.isReady(r.dependencies[0], s.nowMs) {
		return model.AutomaticWaitOwnCooldown, nil, ledger.readyAt(r.dependencies[0]), nil
	}
	deadline := int64(0)
	keys := []string{}
	for _, dependency := range s.automaticSkills.rules {
		for _, key := range r.plan.WaitForCooldowns {
			if key == dependency.plan.RuleKey {
				id := genericAbilityCooldownIdentity(model.SelectorSource, dependency.abilityRef)
				if !ledger.isReady(id, s.nowMs) {
					keys = append(keys, key)
					if at := ledger.readyAt(id); at > deadline {
						deadline = at
					}
				}
			}
		}
	}
	if len(keys) != 0 {
		return model.AutomaticWaitRelatedCooldown, keys, deadline, nil
	}
	ability := s.compiled.Abilities[r.controlIndex]
	definition := &s.compiled.Providers[ability.ProviderIndex].Processes[ability.ProcessControl.ProcessIndex]
	if !s.processMounted(model.SelectorSource, r.binding.ProviderRef, ability.ProviderIndex) {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	for _, current := range s.processInstances {
		if current.Owner == model.SelectorSource && current.ProviderRef == r.binding.ProviderRef && current.ProcessKey == definition.ProcessKey && current.Status == "active" {
			return model.AutomaticWaitProcessActive, nil, processActionDeadline(current), nil
		}
	}
	if s.actionOccupied(model.SelectorSource) {
		return model.AutomaticWaitActionOccupied, nil, s.actionReadyAt(model.SelectorSource), nil
	}
	// 候选求值只读同一真实入口快照；扣资源与开始仍由原过程帧原子提交。
	s.refreshProviderAwareAttributes(model.SelectorSource, r.plan.Target)
	p := &processRuntime{ProcessInstanceSnapshot: model.ProcessInstanceSnapshot{Owner: model.SelectorSource, ProviderRef: r.binding.ProviderRef, ProcessKey: definition.ProcessKey, SkillKey: definition.SkillKey, Target: r.plan.Target, Status: "active"}, definition: definition, ability: ability, abilityRef: r.abilityRef, stepIndex: -1}
	var frame executionFrame
	s.initProcessFrame(&frame, p)
	allowed, err := s.evalProcessCondition(-1, &frame, ability)
	if err != nil {
		return "", nil, 0, err
	}
	if !allowed {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	totals := map[string]float64{}
	for _, cost := range definition.Costs {
		amount, err := frame.evalAmount(cost.AmountProgram, ability)
		if err != nil {
			return "", nil, 0, err
		}
		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
			return "", nil, 0, s.processErr(cost.Path, "process cost must be finite and non-negative", cost.ResourceKey)
		}
		totals[cost.ResourceKey] += amount
		if math.IsInf(totals[cost.ResourceKey], 0) {
			return "", nil, 0, s.processErr(cost.Path, "process cost sum is not finite", cost.ResourceKey)
		}
	}
	for key, amount := range totals {
		slot, exists := frame.stageFor(model.SelectorSource).resources[key]
		if !exists || math.IsNaN(slot.Current) || math.IsInf(slot.Current, 0) || slot.Current < 0 {
			return "", nil, 0, s.processErr("combatants.source.resources."+key, "process cost requires an explicit finite resource", key)
		}
		if slot.Current < amount {
			return model.AutomaticWaitMechanicResource, nil, 0, nil
		}
	}
	return "", nil, 0, nil
}

func (s *genericRunState) handleAutomaticSkills(ev scheduler.GenericEvent) *model.EngineError {
	a := s.automaticSkills
	if a == nil || ev.AutomaticGeneration != a.generation {
		return nil
	}
	if s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0 {
		return nil
	}
	var selected *automaticSkillRuleRuntime
	next := int64(0)
	owner := s.combatants[model.SelectorSource]
	owner.cooldowns = owner.cooldowns.clone()
	s.combatants[model.SelectorSource] = owner
	for _, r := range a.rules {
		reason, related, at, err := s.automaticCandidate(r)
		if err != nil {
			return err
		}
		if reason == "" && selected == nil {
			selected = r
		}
		key := genericCooldownWaitKey{kind: "automatic", owner: model.SelectorSource, key: r.plan.RuleKey}
		if at > s.nowMs {
			notBefore := int64(0)
			if reason == model.AutomaticWaitActionOccupied || reason == model.AutomaticWaitProcessActive {
				notBefore = at
			}
			wait := owner.cooldowns.registerWait(key, r.dependencies, notBefore, s.nowMs)
			at = wait.readyAt
			if next == 0 || wait.readyAt < next {
				next = wait.readyAt
			}
		} else {
			owner.cooldowns.cancelWait(key)
		}
		s.automaticWait(r, reason, related, at)
	}
	if selected == nil {
		if next > s.nowMs {
			s.queueAutomaticSkills(next)
		}
		return nil
	}
	a.attemptSequence++
	key := "auto_" + selected.plan.RuleKey + "_" + strconv.Itoa(a.attemptSequence)
	plan := model.SkillActionPlan{InstructionKey: key, BindingKey: selected.binding.BindingKey, SkillKey: selected.binding.SkillKey, Source: model.SelectorSource, Target: selected.plan.Target, AbilityRef: selected.abilityRef, Action: "INITIAL", FirstAtMs: s.nowMs, SortOrder: selected.plan.SortOrder, HitBindings: selected.plan.HitBindings}
	action := &skillActionRuntime{automaticRule: selected, plan: plan, binding: selected.binding, controlAbilityIndex: selected.controlIndex, parentIndex: -1, useRef: "skill:" + key}
	s.skillActionByUse[action.useRef], s.skillAction = action, action
	defer func() { s.skillAction = nil; delete(s.processFacts, key) }()
	selected.summary.AttemptCount++
	s.abilityAttemptCount++
	s.statFor(action.plan.AbilityRef).attemptCount++
	entry := model.DriverEntry{EntryKey: key, AbilityRef: plan.AbilityRef, Source: plan.Source, Target: plan.Target, FirstAtMs: s.nowMs}
	s.processFacts[key] = model.ProcessCommandFact{DriverEntryKey: key, UseRef: action.useRef}
	err := s.handleProcessCommand(entry, -1, s.compiled.Abilities[selected.controlIndex], selected.abilityRef)
	if !action.accepted {
		record := model.AutomaticSkillRecord{RuleKey: selected.plan.RuleKey}
		if err == nil {
			selected.summary.RejectedCount++
			record.Kind, record.Reason = model.AutomaticRecordAttemptRejected, &action.rejection
		} else {
			selected.summary.AbortedBeforeStartCount++
			reason := err.Message
			if err.BudgetCause != "" {
				reason = string(err.BudgetCause)
			}
			record.Kind, record.Reason = model.AutomaticRecordAbortedBeforeStart, &reason
		}
		s.recordAutomatic(record)
		delete(s.skillActionByUse, action.useRef)
		// 被拒绝的候选不建立轮询；后续真实状态提交才再次唤醒。
		if next > s.nowMs && !s.heap.HasAutomaticSkill() {
			s.queueAutomaticSkills(next)
		}
	}
	return err
}

func (s *genericRunState) recordAutomatic(record model.AutomaticSkillRecord) {
	a := s.automaticSkills
	if a == nil {
		return
	}
	a.recordCount++
	record.Sequence, record.TimeMs = int64(a.recordCount), s.nowMs
	if s.detailedOutput() && len(a.records) < a.maxRecords {
		a.records = append(a.records, record)
	}
}

func (s *genericRunState) publishAutomaticSkillStart(action *skillActionRuntime) {
	r := action.automaticRule
	if r == nil {
		return
	}
	r.summary.StartedCount++
	s.automaticWait(r, "", nil, 0)
	if r.predecessor != nil {
		q := &r.qualification
		q.RemainingCount--
		q.ConsumedCount++
		use := action.useRef
		q.LastConsumeUseRef = &use
		grantor := r.predecessor.plan.RuleKey
		s.recordAutomatic(model.AutomaticSkillRecord{Kind: model.AutomaticRecordQualificationConsumed, RuleKey: r.plan.RuleKey, UseRef: &use, RelatedRuleKey: &grantor, RelatedUseRef: q.LastGrantUseRef})
	}
	use := action.useRef
	s.recordAutomatic(model.AutomaticSkillRecord{Kind: model.AutomaticRecordStarted, RuleKey: r.plan.RuleKey, UseRef: &use})
}

func (s *genericRunState) publishAutomaticSkillFinish(action *skillActionRuntime, process *processRuntime) {
	r := action.automaticRule
	if r == nil || action.automaticFinished {
		return
	}
	action.automaticFinished = true
	use := action.useRef
	if process.Status != "complete" {
		r.summary.FailedCount++
		s.recordAutomatic(model.AutomaticSkillRecord{Kind: model.AutomaticRecordFailed, RuleKey: r.plan.RuleKey, UseRef: &use, Reason: process.FailureReason})
		return
	}
	r.summary.CompletedCount++
	s.recordAutomatic(model.AutomaticSkillRecord{Kind: model.AutomaticRecordCompleted, RuleKey: r.plan.RuleKey, UseRef: &use})
	if next := r.successor; next != nil && next.qualification.RemainingCount == 0 {
		q := &next.qualification
		q.GrantedCount++
		q.RemainingCount = 1
		q.LastGrantUseRef = &use
		consumer := next.plan.RuleKey
		s.recordAutomatic(model.AutomaticSkillRecord{Kind: model.AutomaticRecordQualificationGranted, RuleKey: r.plan.RuleKey, UseRef: &use, RelatedRuleKey: &consumer})
	}
}

func (s *genericRunState) automaticSkillResults() (*model.AutomaticSkillSummary, []model.AutomaticSkillRecord, *model.AutomaticSkillRecording, *model.SkillUseSummary) {
	a := s.automaticSkills
	if a == nil {
		return nil, nil, nil, nil
	}
	summary := &model.AutomaticSkillSummary{RuleCount: len(a.rules), Rules: []model.AutomaticSkillRuleSummary{}, Qualifications: []model.AutomaticSkillQualification{}}
	for _, r := range a.rules {
		r.summary.InFlightCount = r.summary.StartedCount - r.summary.CompletedCount - r.summary.FailedCount
		summary.Rules = append(summary.Rules, r.summary)
		summary.AttemptCount += r.summary.AttemptCount
		summary.StartedCount += r.summary.StartedCount
		summary.RejectedCount += r.summary.RejectedCount
		summary.AbortedBeforeStartCount += r.summary.AbortedBeforeStartCount
		summary.CompletedCount += r.summary.CompletedCount
		summary.FailedCount += r.summary.FailedCount
		summary.InFlightCount += r.summary.InFlightCount
		if r.predecessor != nil {
			summary.Qualifications = append(summary.Qualifications, r.qualification)
		}
	}
	uses := &model.SkillUseSummary{}
	for _, action := range s.skillActionByUse {
		uses.StartedCount += action.uses.StartedCount
		uses.ReleasedCount += action.uses.ReleasedCount
		uses.HitCount += action.uses.HitCount
		uses.CompletedCount += action.uses.CompletedCount
		uses.FailedCount += action.uses.FailedCount
		uses.StepEnteredCount += action.uses.StepEnteredCount
		uses.StepExecutedCount += action.uses.StepExecutedCount
		uses.StepCompletedCount += action.uses.StepCompletedCount
	}
	uses.InFlightCount = uses.StartedCount - uses.CompletedCount - uses.FailedCount
	recording := &model.AutomaticSkillRecording{TotalCount: a.recordCount, ReturnedCount: len(a.records)}
	if !s.detailedOutput() {
		recording.OmittedCount = a.recordCount
	} else {
		recording.DroppedCount = a.recordCount - len(a.records)
		recording.Truncated = recording.DroppedCount > 0
	}
	return summary, a.records, recording, uses
}
