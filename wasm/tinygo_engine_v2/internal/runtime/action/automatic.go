package action

import (
	"sort"
	"strconv"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

type AutomaticRuleView struct{ data *automaticRuleData }
type automaticRuleData struct {
	recastWindow               *ProcessView
	inputIndex                 int
	plan                       model.AutomaticSkillRule
	binding                    planbundle.CompiledSkillActionBinding
	abilityRef                 string
	controlIndex               uint16
	predecessor, successor     *AutomaticRuleView
	dependencies               []contract.CooldownIdentity
	summary                    model.AutomaticSkillRuleSummary
	qualification              model.AutomaticSkillQualification
	empoweredPredecessorUseRef *string
}
type automaticSkillData struct {
	rules           []*AutomaticRuleView
	byKey           map[string]*AutomaticRuleView
	attemptSequence int
	generation      uint64
}
type AutomaticRuleSeed struct {
	InputIndex   int
	Plan         model.AutomaticSkillRule
	Binding      planbundle.CompiledSkillActionBinding
	AbilityRef   string
	ControlIndex uint16
}

type AutomaticPlanView struct{ data *model.AutomaticSkillRule }

func (v AutomaticPlanView) RuleKey() string    { return v.data.RuleKey }
func (v AutomaticPlanView) BindingKey() string { return v.data.BindingKey }
func (v AutomaticPlanView) Target() string     { return v.data.Target }
func (v AutomaticPlanView) SortOrder() int     { return v.data.SortOrder }
func (v AutomaticPlanView) ReleaseAfterRuleKey() *string {
	return cloneOptional(v.data.ReleaseAfterRuleKey)
}
func (v AutomaticPlanView) WaitCount() int          { return len(v.data.WaitForCooldowns) }
func (v AutomaticPlanView) WaitAt(index int) string { return v.data.WaitForCooldowns[index] }
func (v AutomaticPlanView) HitCount() int           { return len(v.data.HitBindings) }
func (v AutomaticPlanView) HitAt(index int) model.SkillActionHitPreset {
	return v.data.HitBindings[index]
}
func (r *AutomaticRuleView) Plan() AutomaticPlanView                        { return AutomaticPlanView{data: &r.data.plan} }
func (r *AutomaticRuleView) Binding() planbundle.CompiledSkillActionBinding { return r.data.binding }
func (r *AutomaticRuleView) RecastWindow() *ProcessView                     { return r.data.recastWindow }
func (r *AutomaticRuleView) InputIndex() int                                { return r.data.inputIndex }
func (r *AutomaticRuleView) AbilityRef() string                             { return r.data.abilityRef }
func (r *AutomaticRuleView) ControlIndex() uint16                           { return r.data.controlIndex }
func (r *AutomaticRuleView) Predecessor() *AutomaticRuleView                { return r.data.predecessor }
func (r *AutomaticRuleView) Successor() *AutomaticRuleView                  { return r.data.successor }
func (r *AutomaticRuleView) DependencyCount() int                           { return len(r.data.dependencies) }
func (r *AutomaticRuleView) DependencyAt(index int) contract.CooldownIdentity {
	return r.data.dependencies[index]
}
func (r *AutomaticRuleView) RemainingQualification() int { return r.data.qualification.RemainingCount }
func (r *AutomaticRuleView) Qualification() model.AutomaticSkillQualification {
	value := r.data.qualification
	value.LastGrantUseRef = cloneOptional(value.LastGrantUseRef)
	value.LastConsumeUseRef = cloneOptional(value.LastConsumeUseRef)
	return value
}
func (r *AutomaticRuleView) HasEmpoweredPredecessor() bool {
	return r.data.empoweredPredecessorUseRef != nil
}
func (r *AutomaticRuleView) EmpoweredPredecessor() string { return *r.data.empoweredPredecessorUseRef }
func (r *AutomaticRuleView) Summary() model.AutomaticSkillRuleSummary {
	value := r.data.summary
	value.Waiting = cloneAutomaticWaiting(value.Waiting)
	return value
}

func cloneAutomaticWaiting(value *model.AutomaticSkillWaiting) *model.AutomaticSkillWaiting {
	if value == nil {
		return nil
	}
	copy := *value
	if value.RelatedRuleKeys != nil {
		copy.RelatedRuleKeys = append([]string{}, value.RelatedRuleKeys...)
	}
	copy.NextCheckAtMs = cloneOptional(copy.NextCheckAtMs)
	return &copy
}
func (s *State) InitAutomatic() {
	s.automatic = &automaticSkillData{byKey: make(map[string]*AutomaticRuleView)}
}
func (s *State) AddAutomaticRule(seed AutomaticRuleSeed) {
	p := seed.Plan
	p.WaitForCooldowns = append([]string(nil), p.WaitForCooldowns...)
	p.HitBindings = append([]model.SkillActionHitPreset(nil), p.HitBindings...)
	p.ReleaseAfterRuleKey = cloneOptional(p.ReleaseAfterRuleKey)
	r := &AutomaticRuleView{data: &automaticRuleData{inputIndex: seed.InputIndex, plan: p, binding: seed.Binding, abilityRef: seed.AbilityRef, controlIndex: seed.ControlIndex, summary: model.AutomaticSkillRuleSummary{RuleKey: p.RuleKey}, dependencies: []contract.CooldownIdentity{AbilityCooldownIdentity(seed.Binding.Source, seed.AbilityRef)}}}
	s.automatic.rules = append(s.automatic.rules, r)
	s.automatic.byKey[p.RuleKey] = r
}
func (s *State) HasAutomatic() bool { return s.automatic != nil }
func (s *State) AutomaticCount() int {
	if s.automatic == nil {
		return 0
	}
	return len(s.automatic.rules)
}
func (s *State) AutomaticAt(index int) *AutomaticRuleView     { return s.automatic.rules[index] }
func (s *State) AutomaticByKey(key string) *AutomaticRuleView { return s.automatic.byKey[key] }
func (s *State) SortAutomaticRules() {
	sort.Slice(s.automatic.rules, func(i, j int) bool {
		return s.automatic.rules[i].Plan().SortOrder() < s.automatic.rules[j].Plan().SortOrder()
	})
}
func (s *State) LinkAutomaticDependency(rule, dependency *AutomaticRuleView) {
	rule.data.dependencies = append(rule.data.dependencies, AbilityCooldownIdentity(model.SelectorSource, dependency.AbilityRef()))
}
func (s *State) LinkAutomaticQualification(rule, parent *AutomaticRuleView) {
	rule.data.predecessor = parent
	parent.data.successor = rule
	rule.data.qualification.GrantorRuleKey, rule.data.qualification.ConsumerRuleKey = parent.Plan().RuleKey(), rule.Plan().RuleKey()
}
func (s *State) LinkAutomaticRules() (string, string) {
	s.SortAutomaticRules()
	for _, r := range s.automatic.rules {
		path := "driverPlan.automaticSkills.rules[" + strconv.Itoa(r.InputIndex()) + "]"
		for index, key := range r.data.plan.WaitForCooldowns {
			dependency := s.automatic.byKey[key]
			if dependency == nil {
				return path + ".waitForCooldowns[" + strconv.Itoa(index) + "]", "cooldown reference must name a selected rule: " + key
			}
			s.LinkAutomaticDependency(r, dependency)
		}
		if key := r.data.plan.ReleaseAfterRuleKey; key != nil {
			parent := s.automatic.byKey[*key]
			if parent == nil || parent.data.successor != nil {
				return path + ".releaseAfterRuleKey", "qualification requires a selected unique predecessor without branching: " + *key
			}
			s.LinkAutomaticQualification(r, parent)
		}
	}
	for _, r := range s.automatic.rules {
		seen := make(map[string]bool)
		for current := r; current != nil; current = current.Predecessor() {
			key := current.Plan().RuleKey()
			if seen[key] {
				return "driverPlan.automaticSkills.rules[" + strconv.Itoa(r.InputIndex()) + "].releaseAfterRuleKey", "qualification chain cannot contain a cycle"
			}
			seen[key] = true
		}
	}
	return "", ""
}
func (s *State) AutomaticGeneration() uint64 {
	if s.automatic == nil {
		return 0
	}
	return s.automatic.generation
}
func (s *State) NextAutomaticGeneration() uint64 {
	s.automatic.generation++
	return s.automatic.generation
}
func (s *State) RegisterAutomaticWait(rule *AutomaticRuleView, ledger *CooldownLedger, notBefore, now int64, recast bool) CooldownWait {
	dependencies := rule.data.dependencies
	if recast {
		dependencies = nil
	}
	return ledger.RegisterWait(CooldownWaitKey{Kind: "automatic", Owner: model.SelectorSource, Key: rule.Plan().RuleKey()}, dependencies, notBefore, now)
}
func (s *State) NewAutomaticAction(rule *AutomaticRuleView, now int64) *SkillActionView {
	s.automatic.attemptSequence++
	key := "auto_" + rule.Plan().RuleKey() + "_" + strconv.Itoa(s.automatic.attemptSequence)
	p := model.SkillActionPlan{InstructionKey: key, BindingKey: rule.data.binding.BindingKey, SkillKey: rule.data.binding.SkillKey, Source: model.SelectorSource, Target: rule.data.plan.Target, AbilityRef: rule.data.abilityRef, Action: "INITIAL", FirstAtMs: now, SortOrder: rule.data.plan.SortOrder, HitBindings: rule.data.plan.HitBindings}
	a := NewSkillAction(SkillActionSeed{AutomaticRule: rule, Plan: p, Binding: rule.data.binding, ControlAbilityIndex: rule.data.controlIndex, ParentIndex: -1, UseRef: "skill:" + key})
	s.BindActionUse(a.UseRef(), a)
	rule.data.summary.AttemptCount++
	return a
}
func (s *State) RecordAutomaticReject(rule *AutomaticRuleView, aborted bool) {
	if aborted {
		rule.data.summary.AbortedBeforeStartCount++
	} else {
		rule.data.summary.RejectedCount++
	}
}
func (s *State) AutomaticStarted(a *SkillActionView, process *ProcessView) []model.AutomaticSkillRecord {
	r := a.data.automaticRule
	if r == nil {
		return nil
	}
	d := r.data
	d.summary.StartedCount++
	if d.binding.HasFiniteRecast {
		d.recastWindow = process
	}
	var records []model.AutomaticSkillRecord
	if d.predecessor != nil {
		q := &d.qualification
		s.SetEmpoweredPredecessor(process, d.empoweredPredecessorUseRef)
		d.empoweredPredecessorUseRef = nil
		q.RemainingCount--
		q.ConsumedCount++
		use := a.UseRef()
		q.LastConsumeUseRef = &use
		grantor := d.predecessor.Plan().RuleKey()
		records = append(records, model.AutomaticSkillRecord{Kind: model.AutomaticRecordQualificationConsumed, RuleKey: d.plan.RuleKey, UseRef: &use, RelatedRuleKey: &grantor, RelatedUseRef: cloneOptional(q.LastGrantUseRef)})
	}
	use := a.UseRef()
	records = append(records, model.AutomaticSkillRecord{Kind: model.AutomaticRecordStarted, RuleKey: d.plan.RuleKey, UseRef: &use})
	return records
}
func (s *State) AutomaticFinished(a *SkillActionView, process *ProcessView) []model.AutomaticSkillRecord {
	r := a.data.automaticRule
	if r == nil || a.data.automaticFinished {
		return nil
	}
	a.data.automaticFinished = true
	d := r.data
	use := a.UseRef()
	if process.Status() != "complete" {
		d.summary.FailedCount++
		return []model.AutomaticSkillRecord{{Kind: model.AutomaticRecordFailed, RuleKey: d.plan.RuleKey, UseRef: &use, Reason: process.FailureReason()}}
	}
	d.summary.CompletedCount++
	records := []model.AutomaticSkillRecord{{Kind: model.AutomaticRecordCompleted, RuleKey: d.plan.RuleKey, UseRef: &use}}
	if next := d.successor; next != nil && next.data.qualification.RemainingCount == 0 {
		q := &next.data.qualification
		q.GrantedCount++
		q.RemainingCount = 1
		q.LastGrantUseRef = &use
		next.data.empoweredPredecessorUseRef = nil
		if process.data.snapshot.EmpoweredAttack != nil || process.data.snapshot.EmpoweredPredecessorUseRef != nil {
			next.data.empoweredPredecessorUseRef = q.LastGrantUseRef
		}
		consumer := next.Plan().RuleKey()
		records = append(records, model.AutomaticSkillRecord{Kind: model.AutomaticRecordQualificationGranted, RuleKey: d.plan.RuleKey, UseRef: &use, RelatedRuleKey: &consumer})
	}
	return records
}
