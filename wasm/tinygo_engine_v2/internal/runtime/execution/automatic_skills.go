package execution

import (
	"math"
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/scheduler"
)

func (s *Engine) initAutomaticSkills() *model.EngineError {
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
	if s.loop.StartMs() != 0 || s.loop.DurationMs() < 1 || s.loop.DurationMs() > 600000 || len(s.req.InitialSnapshot.ProcessInstances)+len(s.req.InitialSnapshot.UseTriggerLedger) != 0 {
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
	s.actions.InitAutomatic()
	if !s.report.InitAutomaticRecords(s.req.RecordBudget) {
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
		expectedHits := len(binding.HitBindings)
		if binding.HasEmpoweredAttack {
			expectedHits = 0
		}
		if !exists || binding.Source != model.SelectorSource || len(rule.HitBindings) != expectedHits || binding.HasEmpoweredAttack && (rule.Target != binding.Source || s.req.DriverPlan.BasicAttack == nil || s.req.DriverPlan.BasicAttack.Source != binding.Source) {
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
		s.actions.AddAutomaticRule(actionpkg.AutomaticRuleSeed{InputIndex: index, Plan: rule, Binding: *binding, AbilityRef: ref, ControlIndex: control})
	}
	if path, message := s.actions.LinkAutomaticRules(); message != "" {
		return s.basicAttackErr(message, path)
	}
	for index := 0; index < s.actions.AutomaticCount(); index++ {
		rule := s.actions.AutomaticAt(index)
		if err := s.validatePlannedSkillProvider(rule.Binding().Source, rule.Binding().ProviderRef, s.compiled.Abilities[rule.Binding().InitialAbilityIndex].ProviderIndex); err != nil {
			return err
		}
	}
	return nil
}

func (s *Engine) queueAutomaticSkills(at int64) {
	if !s.actions.HasAutomatic() || at < s.loop.TimeMs() {
		return
	}
	generation := s.actions.NextAutomaticGeneration()
	if s.loop.Queue().RescheduleAutomaticSkill(at, generation) {
		return
	}
	s.pushCombatEvent(scheduler.GenericEvent{TimeMs: at, Category: scheduler.GenericCategorySkillAction, Kind: scheduler.GenericEventAutomaticSkill, AutomaticGeneration: generation, DriverEntryIndex: -1})
}
func (s *Engine) automaticWait(rule *actionpkg.AutomaticRuleView, reason string, related []string, at int64) {
	if record, changed := s.actions.AutomaticWaiting(rule, reason, related, at, s.loop.TimeMs()); changed {
		s.recordAutomatic(record)
	}
}
func (s *Engine) automaticCandidate(r *actionpkg.AutomaticRuleView) (string, []string, int64, *model.EngineError) {
	if p := r.RecastWindow(); p != nil && p.Status() == "active" {
		return s.automaticRecastCandidate(r, p)
	}
	ledger := s.combatants[model.SelectorSource].cooldowns
	if r.Predecessor() != nil && r.RemainingQualification() == 0 {
		return model.AutomaticWaitReleaseQualification, []string{r.Predecessor().Plan().RuleKey()}, 0, nil
	}
	ability := s.compiled.Abilities[r.ControlIndex()]
	ammoAt := int64(0)
	ammoReady := true
	if s.compiled.Providers[ability.ProviderIndex].AmmoBinding != nil {
		if !s.processMounted(model.SelectorSource, r.Binding().ProviderRef, ability.ProviderIndex) {
			return model.AutomaticWaitAuthorCondition, nil, 0, nil
		}
		var ammoFrame Frame
		s.initExecutionFrame(&ammoFrame, model.SelectorSource, r.Plan().Target(), r.AbilityRef())
		ammoFrame.ownerCombatantKey, ammoFrame.ownerProviderRef = model.SelectorSource, r.Binding().ProviderRef
		var err *model.EngineError
		ammoReady, ammoAt, err = ammoFrame.plannedAmmoReady(ability)
		if err != nil {
			return "", nil, 0, err
		}
	}
	maxAmmo := func(at int64) int64 {
		if !ammoReady && ammoAt > at {
			at = ammoAt
		}
		if s.compiled.Providers[ability.ProviderIndex].AmmoBinding != nil {
			for dependencyIndex := 0; dependencyIndex < r.DependencyCount(); dependencyIndex++ {
				id := r.DependencyAt(dependencyIndex)
				if ready := ledger.ReadyAt(id); ready > at {
					at = ready
				}
			}
			if ready := s.actionReadyAt(model.SelectorSource); ready > at {
				at = ready
			}
			for processIndex := 0; processIndex < s.actions.ProcessCount(); processIndex++ {
				current := s.actions.ProcessAt(processIndex)
				if current.Owner() == model.SelectorSource && current.ProviderRef() == r.Binding().ProviderRef && current.Status() == "active" {
					if ready := current.ActionDeadline(); ready > at {
						at = ready
					}
				}
			}
		}
		return at
	}
	if !ledger.IsReady(r.DependencyAt(0), s.loop.TimeMs()) {
		return model.AutomaticWaitOwnCooldown, nil, maxAmmo(ledger.ReadyAt(r.DependencyAt(0))), nil
	}
	deadline := int64(0)
	keys := []string{}
	for dependencyIndex := 0; dependencyIndex < s.actions.AutomaticCount(); dependencyIndex++ {
		dependency := s.actions.AutomaticAt(dependencyIndex)
		for waitIndex := 0; waitIndex < r.Plan().WaitCount(); waitIndex++ {
			key := r.Plan().WaitAt(waitIndex)
			if key == dependency.Plan().RuleKey() {
				id := actionpkg.AbilityCooldownIdentity(model.SelectorSource, dependency.AbilityRef())
				if !ledger.IsReady(id, s.loop.TimeMs()) {
					keys = append(keys, key)
					if at := ledger.ReadyAt(id); at > deadline {
						deadline = at
					}
				}
			}
		}
	}
	if len(keys) != 0 {
		return model.AutomaticWaitRelatedCooldown, keys, maxAmmo(deadline), nil
	}
	definition := &s.compiled.Providers[ability.ProviderIndex].Processes[ability.ProcessControl.ProcessIndex]
	if !s.processMounted(model.SelectorSource, r.Binding().ProviderRef, ability.ProviderIndex) {
		return model.AutomaticWaitAuthorCondition, nil, 0, nil
	}
	for processIndex := 0; processIndex < s.actions.ProcessCount(); processIndex++ {
		current := s.actions.ProcessAt(processIndex)
		if current.Owner() == model.SelectorSource && current.ProviderRef() == r.Binding().ProviderRef && current.ProcessKey() == definition.ProcessKey && current.Status() == "active" {
			return model.AutomaticWaitProcessActive, nil, maxAmmo(current.ActionDeadline()), nil
		}
	}
	if s.actionOccupied(model.SelectorSource) {
		return model.AutomaticWaitActionOccupied, nil, maxAmmo(s.actionReadyAt(model.SelectorSource)), nil
	}
	if !ammoReady {
		return model.AutomaticWaitMechanicResource, nil, maxAmmo(ammoAt), nil
	}
	// 候选求值只读同一真实入口快照；扣资源与开始仍由原过程帧原子提交。
	s.refreshProviderAwareAttributes(model.SelectorSource, r.Plan().Target())
	p := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: model.SelectorSource, ProviderRef: r.Binding().ProviderRef, ProcessKey: definition.ProcessKey, SkillKey: definition.SkillKey, Target: r.Plan().Target(), Status: "active"}, Definition: definition, Ability: ability, AbilityRef: r.AbilityRef(), StepIndex: -1})
	var frame Frame
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
		slot, exists := frame.stageFor(model.SelectorSource).resourceView().Lookup(key)
		if !exists || math.IsNaN(slot.Current) || math.IsInf(slot.Current, 0) || slot.Current < 0 {
			return "", nil, 0, s.processErr("combatants.source.resources."+key, "process cost requires an explicit finite resource", key)
		}
		if slot.Current < amount {
			return model.AutomaticWaitMechanicResource, nil, 0, nil
		}
	}
	return "", nil, 0, nil
}

func (s *Engine) handleAutomaticSkills(ev scheduler.GenericEvent) *model.EngineError {
	if !s.actions.HasAutomatic() || ev.AutomaticGeneration != s.actions.AutomaticGeneration() {
		return nil
	}
	if s.combatantHp(model.SelectorSource) <= 0 || s.combatantHp(model.SelectorTarget) <= 0 {
		return nil
	}
	var selected *actionpkg.AutomaticRuleView
	next := int64(0)
	owner := s.combatants[model.SelectorSource]
	owner.cooldowns = owner.cooldowns.Clone()
	s.combatants[model.SelectorSource] = owner
	for index := 0; index < s.actions.AutomaticCount(); index++ {
		rule := s.actions.AutomaticAt(index)
		reason, related, at, err := s.automaticCandidate(rule)
		if err != nil {
			return err
		}
		if reason == "" && selected == nil {
			selected = rule
		}
		key := actionpkg.CooldownWaitKey{Kind: "automatic", Owner: model.SelectorSource, Key: rule.Plan().RuleKey()}
		if at > s.loop.TimeMs() {
			notBefore := int64(0)
			if reason == model.AutomaticWaitActionOccupied || reason == model.AutomaticWaitProcessActive {
				notBefore = at
			}
			if s.compiled.Providers[s.compiled.Abilities[rule.ControlIndex()].ProviderIndex].AmmoBinding != nil {
				notBefore = at
			}
			recast := rule.RecastWindow() != nil && rule.RecastWindow().Status() == "active"
			if recast {
				notBefore = at
			}
			wait := s.actions.RegisterAutomaticWait(rule, owner.cooldowns, notBefore, s.loop.TimeMs(), recast)
			at = wait.ReadyAt
			if next == 0 || wait.ReadyAt < next {
				next = wait.ReadyAt
			}
		} else {
			owner.cooldowns.CancelWait(key)
		}
		s.automaticWait(rule, reason, related, at)
	}
	if selected == nil {
		if next > s.loop.TimeMs() {
			s.queueAutomaticSkills(next)
		}
		return nil
	}
	if process := selected.RecastWindow(); process != nil && process.Status() == "active" {
		return s.runAutomaticRecast(selected, process)
	}
	action := s.actions.NewAutomaticAction(selected, s.loop.TimeMs())
	s.actions.SetCurrentAction(action)
	key := action.Plan().InstructionKey()
	defer func() { s.actions.SetCurrentAction(nil); s.actions.RemoveProcessFact(key) }()
	s.report.Attempt(action.Plan().AbilityRef())
	entry := model.DriverEntry{EntryKey: key, AbilityRef: action.Plan().AbilityRef(), Source: action.Plan().Source(), Target: action.Plan().Target(), FirstAtMs: s.loop.TimeMs()}
	s.actions.SetProcessFact(key, model.ProcessCommandFact{DriverEntryKey: key, UseRef: action.UseRef()})
	err := s.handleProcessCommand(entry, -1, s.compiled.Abilities[selected.ControlIndex()], selected.AbilityRef())
	if !action.Accepted() {
		record := model.AutomaticSkillRecord{RuleKey: selected.Plan().RuleKey()}
		s.actions.RecordAutomaticReject(selected, err != nil)
		if err == nil {
			reason := action.Rejection()
			record.Kind, record.Reason = model.AutomaticRecordAttemptRejected, &reason
		} else {
			reason := err.Message
			if err.BudgetCause != "" {
				reason = string(err.BudgetCause)
			}
			record.Kind, record.Reason = model.AutomaticRecordAbortedBeforeStart, &reason
		}
		s.recordAutomatic(record)
		s.actions.ForgetActionUse(action.UseRef())
		if next > s.loop.TimeMs() && !s.loop.Queue().HasAutomaticSkill() {
			s.queueAutomaticSkills(next)
		}
	}
	return err
}
func (s *Engine) recordAutomatic(record model.AutomaticSkillRecord) {
	if !s.actions.HasAutomatic() {
		return
	}
	s.report.RecordAutomatic(record, s.loop.TimeMs(), s.detailedOutput())
}
func (s *Engine) publishAutomaticSkillStart(action *actionpkg.SkillActionView, process *actionpkg.ProcessView) {
	records := s.actions.AutomaticStarted(action, process)
	if rule := action.AutomaticRule(); rule != nil {
		s.automaticWait(rule, "", nil, 0)
	}
	for _, record := range records {
		s.recordAutomatic(record)
	}
}
func (s *Engine) publishAutomaticSkillFinish(action *actionpkg.SkillActionView, process *actionpkg.ProcessView) {
	for _, record := range s.actions.AutomaticFinished(action, process) {
		s.recordAutomatic(record)
	}
}
func (s *Engine) automaticSkillResults() (*model.AutomaticSkillSummary, []model.AutomaticSkillRecord, *model.AutomaticSkillRecording, *model.SkillUseSummary) {
	summary, uses := s.actions.AutomaticSummary()
	if summary == nil {
		return nil, nil, nil, nil
	}
	return summary, nil, s.report.AutomaticRecording(s.detailedOutput()), uses
}
