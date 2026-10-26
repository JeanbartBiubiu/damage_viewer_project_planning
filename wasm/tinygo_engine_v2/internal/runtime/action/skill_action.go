package action

import (
	"sort"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

type SkillActionView struct{ data *skillActionData }
type skillActionData struct {
	slot                              int
	automaticRule                     *AutomaticRuleView
	automaticFinished                 bool
	plan                              model.SkillActionPlan
	binding                           planbundle.CompiledSkillActionBinding
	summary                           model.SkillActionSummary
	uses                              model.SkillUseSummary
	useRef, acceptedUseRef, rejection string
	accepted                          bool
	controlAbilityIndex               uint16
	parentIndex                       int
	chargeDurationMs                  *int64
	nextHitSequence                   int
	committedHitContacts              uint64
}

type SkillActionSeed struct {
	AutomaticRule       *AutomaticRuleView
	Plan                model.SkillActionPlan
	Binding             planbundle.CompiledSkillActionBinding
	ControlAbilityIndex uint16
	ParentIndex         int
	UseRef              string
	Summary             model.SkillActionSummary
}

func NewSkillAction(seed SkillActionSeed) *SkillActionView {
	plan := seed.Plan
	plan.ParentInstructionKey = cloneOptional(plan.ParentInstructionKey)
	plan.HitBindings = append([]model.SkillActionHitPreset(nil), plan.HitBindings...)
	return &SkillActionView{data: &skillActionData{slot: -1, automaticRule: seed.AutomaticRule, plan: plan, binding: seed.Binding, controlAbilityIndex: seed.ControlAbilityIndex, parentIndex: seed.ParentIndex, useRef: seed.UseRef, summary: seed.Summary}}
}

type SkillActionPlanView struct{ data *model.SkillActionPlan }

func (p SkillActionPlanView) InstructionKey() string { return p.data.InstructionKey }
func (p SkillActionPlanView) FirstAtMs() int64       { return p.data.FirstAtMs }
func (p SkillActionPlanView) SortOrder() int         { return p.data.SortOrder }
func (p SkillActionPlanView) Source() string         { return p.data.Source }
func (p SkillActionPlanView) Target() string         { return p.data.Target }
func (p SkillActionPlanView) SkillKey() string       { return p.data.SkillKey }
func (p SkillActionPlanView) BindingKey() string     { return p.data.BindingKey }
func (p SkillActionPlanView) Action() string         { return p.data.Action }
func (p SkillActionPlanView) AbilityRef() string     { return p.data.AbilityRef }
func (p SkillActionPlanView) ParentInstructionKey() *string {
	return cloneOptional(p.data.ParentInstructionKey)
}
func (p SkillActionPlanView) HitCount() int { return len(p.data.HitBindings) }
func (p SkillActionPlanView) HitAt(index int) model.SkillActionHitPreset {
	return p.data.HitBindings[index]
}

func (a *SkillActionView) Plan() SkillActionPlanView                      { return SkillActionPlanView{data: &a.data.plan} }
func (a *SkillActionView) Binding() planbundle.CompiledSkillActionBinding { return a.data.binding }
func (a *SkillActionView) Summary() model.SkillActionSummary              { return a.data.summary }
func (a *SkillActionView) Uses() model.SkillUseSummary                    { return a.data.uses }
func (a *SkillActionView) AutomaticRule() *AutomaticRuleView              { return a.data.automaticRule }
func (a *SkillActionView) AutomaticFinished() bool                        { return a.data.automaticFinished }
func (a *SkillActionView) UseRef() string                                 { return a.data.useRef }
func (a *SkillActionView) AcceptedUseRef() string                         { return a.data.acceptedUseRef }
func (a *SkillActionView) Accepted() bool                                 { return a.data.accepted }
func (a *SkillActionView) Rejection() string                              { return a.data.rejection }
func (a *SkillActionView) ControlAbilityIndex() uint16                    { return a.data.controlAbilityIndex }
func (a *SkillActionView) ParentIndex() int                               { return a.data.parentIndex }
func (a *SkillActionView) HasChargeDuration() bool                        { return a.data.chargeDurationMs != nil }
func (a *SkillActionView) ChargeDuration() int64                          { return *a.data.chargeDurationMs }
func (a *SkillActionView) ChargeDurationMs() *int64                       { return cloneOptional(a.data.chargeDurationMs) }
func (a *SkillActionView) NextHitSequence() int                           { return a.data.nextHitSequence }
func (a *SkillActionView) Reference() contract.ActionRef {
	if a == nil {
		return contract.ActionRef{}
	}
	return contract.ActionRef{Slot: a.data.slot, Present: true}
}
func (a *SkillActionView) HasRequiredHitContact(hit model.SkillActionHitBinding) bool {
	if hit.RequiresPriorHitBindingKey == nil {
		return true
	}
	for index, prior := range a.data.binding.HitBindings {
		if prior.HitBindingKey == *hit.RequiresPriorHitBindingKey {
			return a.data.committedHitContacts&(uint64(1)<<uint(index)) != 0
		}
	}
	return false
}

func (s *State) RegisterAction(a *SkillActionView) {
	if a.data.slot >= 0 {
		return
	}
	a.data.slot = len(s.actionRegistry)
	s.actionRegistry = append(s.actionRegistry, a)
}
func (s *State) AddManualAction(a *SkillActionView) {
	s.RegisterAction(a)
	s.manualActions = append(s.manualActions, a)
}
func (s *State) ManualCount() int                    { return len(s.manualActions) }
func (s *State) ManualAt(index int) *SkillActionView { return s.manualActions[index] }
func (s *State) SortManualActions() {
	sort.Slice(s.manualActions, func(i, j int) bool {
		a, b := s.manualActions[i].Plan(), s.manualActions[j].Plan()
		if a.FirstAtMs() != b.FirstAtMs() {
			return a.FirstAtMs() < b.FirstAtMs()
		}
		if a.SortOrder() != b.SortOrder() {
			return a.SortOrder() < b.SortOrder()
		}
		return a.InstructionKey() < b.InstructionKey()
	})
}
func (s *State) BindManualParents() string {
	s.SortManualActions()
	prior := make(map[string]int)
	for index, a := range s.manualActions {
		if a.Plan().Action() == "INITIAL" {
			s.BindActionUse(a.UseRef(), a)
		} else {
			parentIndex, exists := prior[*a.Plan().ParentInstructionKey()]
			if !exists {
				return "control requires a preceding initial instruction in full stable order"
			}
			parent := s.manualActions[parentIndex]
			if parent.Plan().Action() != "INITIAL" || parent.Plan().BindingKey() != a.Plan().BindingKey() || parent.Plan().SkillKey() != a.Plan().SkillKey() || parent.Plan().Source() != a.Plan().Source() || parent.Plan().Target() != a.Plan().Target() {
				return "control parent must retain its initial source, binding, skill and target"
			}
			s.SetParent(a, parentIndex, parent.UseRef())
		}
		prior[a.Plan().InstructionKey()] = index
	}
	return ""
}
func (s *State) SetParent(a *SkillActionView, index int, use string) {
	a.data.parentIndex, a.data.useRef = index, use
}
func (s *State) CurrentAction() *SkillActionView { return s.currentAction }
func (s *State) SetCurrentAction(a *SkillActionView) {
	if a != nil {
		s.RegisterAction(a)
	}
	s.currentAction = a
}
func (s *State) BindActionUse(use string, a *SkillActionView) {
	s.RegisterAction(a)
	if s.actionsByUse == nil {
		s.actionsByUse = make(map[string]*SkillActionView)
	}
	s.actionsByUse[use] = a
}
func (s *State) ForgetActionUse(use string)               { delete(s.actionsByUse, use) }
func (s *State) ActionForUse(use string) *SkillActionView { return s.actionsByUse[use] }
func (s *State) Action(ref contract.ActionRef) *SkillActionView {
	if !ref.Present || ref.Slot < 0 || ref.Slot >= len(s.actionRegistry) {
		return nil
	}
	return s.actionRegistry[ref.Slot]
}
func (s *State) ActionUses() []*SkillActionView {
	out := make([]*SkillActionView, 0, len(s.actionsByUse))
	for _, a := range s.actionsByUse {
		out = append(out, a)
	}
	return out
}

func (s *State) Reached(a *SkillActionView)               { a.data.summary.ReachedCount++ }
func (s *State) Reject(a *SkillActionView, reason string) { a.data.rejection = reason }
func (s *State) Accept(a *SkillActionView, use string, initial bool) {
	a.data.accepted = true
	a.data.summary.AcceptedCount++
	a.data.acceptedUseRef = use
	if initial {
		a.data.uses.StartedCount++
	}
}
func (s *State) FinishAttempt(a *SkillActionView, now int64, err *model.EngineError) model.SkillActionRecord {
	d := a.data
	p := d.plan
	record := model.SkillActionRecord{ParentInstructionKey: cloneOptional(p.ParentInstructionKey), InstructionKey: p.InstructionKey, RequestedAtMs: p.FirstAtMs, ActualAtMs: now, Action: p.Action, Source: p.Source, Target: p.Target, SkillKey: p.SkillKey, BindingKey: p.BindingKey, ProviderRef: d.binding.ProviderRef, ProviderDefinitionRef: d.binding.ProviderDefinitionRef}
	if d.accepted {
		use := d.useRef
		if d.acceptedUseRef != "" {
			use = d.acceptedUseRef
		}
		record.Outcome, record.UseRef = "ACCEPTED", &use
	} else if err != nil {
		record.Outcome = "ABORTED_BEFORE_ACCEPT"
		reason := string(err.BudgetCause)
		if reason == "" {
			reason = err.Message
		}
		record.Reason = &reason
		d.summary.AbortedBeforeAcceptCount++
	} else {
		record.Outcome, record.Reason = "REJECTED", cloneOptional(&d.rejection)
		d.summary.RejectedCount++
	}
	return record
}
func (s *State) RecordUse(a *SkillActionView, kind string) {
	u := &a.data.uses
	switch kind {
	case "COMPLETED":
		u.CompletedCount++
	case "FAILED":
		u.FailedCount++
	case "STEP_ENTERED":
		u.StepEnteredCount++
	case "STEP_EXECUTED":
		u.StepExecutedCount++
	case "STEP_COMPLETED":
		u.StepCompletedCount++
	case "RELEASED":
		u.ReleasedCount++
	case "HIT":
		u.HitCount++
	}
}
func (s *State) SetChargeDuration(a *SkillActionView, value int64) {
	a.data.chargeDurationMs = cloneOptional(&value)
}
func (s *State) BeginHit(a *SkillActionView) int {
	a.data.nextHitSequence++
	return a.data.nextHitSequence
}
func (s *State) CommitHitContact(a *SkillActionView, index int) {
	a.data.committedHitContacts |= uint64(1) << uint(index)
}
func (s *State) SkillSummaries() (model.SkillActionSummary, model.SkillUseSummary) {
	actions := model.SkillActionSummary{PlannedCount: len(s.manualActions)}
	uses := model.SkillUseSummary{}
	for _, a := range s.manualActions {
		d := a.data
		actions.ReachedCount += d.summary.ReachedCount
		actions.AcceptedCount += d.summary.AcceptedCount
		actions.RejectedCount += d.summary.RejectedCount
		actions.AbortedBeforeAcceptCount += d.summary.AbortedBeforeAcceptCount
		uses.StartedCount += d.uses.StartedCount
		uses.ReleasedCount += d.uses.ReleasedCount
		uses.HitCount += d.uses.HitCount
		uses.CompletedCount += d.uses.CompletedCount
		uses.FailedCount += d.uses.FailedCount
		uses.StepEnteredCount += d.uses.StepEnteredCount
		uses.StepExecutedCount += d.uses.StepExecutedCount
		uses.StepCompletedCount += d.uses.StepCompletedCount
	}
	actions.UnreachedCount = actions.PlannedCount - actions.ReachedCount
	uses.InFlightCount = uses.StartedCount - uses.CompletedCount - uses.FailedCount
	return actions, uses
}
