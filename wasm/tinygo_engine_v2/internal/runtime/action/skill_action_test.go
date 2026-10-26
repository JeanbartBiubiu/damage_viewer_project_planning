package action

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func TestManualActionsKeepStableParentIdentityAndCommittedCounts(t *testing.T) {
	var state State
	parentKey := "first"
	control := NewSkillAction(SkillActionSeed{Plan: model.SkillActionPlan{InstructionKey: "second", FirstAtMs: 10, Action: "RECAST", ParentInstructionKey: &parentKey, Source: "source", Target: "target", SkillKey: "s", BindingKey: "binding"}, ParentIndex: -1})
	initial := NewSkillAction(SkillActionSeed{Plan: model.SkillActionPlan{InstructionKey: parentKey, Action: "INITIAL", Source: "source", Target: "target", SkillKey: "s", BindingKey: "binding"}, UseRef: "skill:first", ParentIndex: -1})
	state.AddManualAction(control)
	state.AddManualAction(initial)
	if message := state.BindManualParents(); message != "" {
		t.Fatal(message)
	}
	if state.ManualAt(0) != initial || control.ParentIndex() != 0 || control.UseRef() != initial.UseRef() || state.ActionForUse(initial.UseRef()) != initial || state.Action(initial.Reference()) != initial {
		t.Fatal("parent identity changed")
	}
	state.Reached(initial)
	state.Accept(initial, "", true)
	state.RecordUse(initial, "RELEASED")
	state.RecordUse(initial, "HIT")
	state.Reached(control)
	state.Accept(control, "recast:skill:first:1", false)
	record := state.FinishAttempt(control, 10, nil)
	if record.Outcome != "ACCEPTED" || record.UseRef == nil || *record.UseRef != "recast:skill:first:1" {
		t.Fatal(record)
	}
	actions, uses := state.SkillSummaries()
	if actions.AcceptedCount != 2 || actions.ReachedCount != 2 || uses.StartedCount != 1 || uses.ReleasedCount != 1 || uses.HitCount != 1 {
		t.Fatal(actions, uses)
	}
}

func TestAutomaticQualificationKeepsOneTokenAndFinishIsIdempotent(t *testing.T) {
	var state State
	state.InitAutomatic()
	parent := "parent"
	state.AddAutomaticRule(AutomaticRuleSeed{Plan: model.AutomaticSkillRule{RuleKey: parent, SortOrder: 0}, Binding: planbundle.CompiledSkillActionBinding{SkillActionBinding: model.SkillActionBinding{Source: "source"}}, AbilityRef: "initial"})
	state.AddAutomaticRule(AutomaticRuleSeed{Plan: model.AutomaticSkillRule{RuleKey: "child", SortOrder: 1, ReleaseAfterRuleKey: &parent}, Binding: planbundle.CompiledSkillActionBinding{SkillActionBinding: model.SkillActionBinding{Source: "source"}}, AbilityRef: "child"})
	if path, message := state.LinkAutomaticRules(); message != "" {
		t.Fatal(path, message)
	}
	a, b := state.AutomaticAt(0), state.AutomaticAt(1)
	complete := NewProcess(ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Status: "complete"}})
	grant := func(use string) {
		action := NewSkillAction(SkillActionSeed{AutomaticRule: a, UseRef: use})
		state.AutomaticFinished(action, complete)
		state.AutomaticFinished(action, complete)
	}
	grant("a1")
	grant("a2")
	if b.Qualification().GrantedCount != 1 || b.RemainingQualification() != 1 || *b.Qualification().LastGrantUseRef != "a1" {
		t.Fatal(b.Qualification())
	}
	consumer := NewSkillAction(SkillActionSeed{AutomaticRule: b, UseRef: "b1"})
	state.AutomaticStarted(consumer, NewProcess(ProcessSeed{}))
	state.AutomaticFinished(consumer, NewProcess(ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Status: "failed"}}))
	if b.RemainingQualification() != 0 || b.Qualification().ConsumedCount != 1 {
		t.Fatal(b.Qualification())
	}
	grant("a3")
	if b.RemainingQualification() != 1 || b.Qualification().GrantedCount != 2 || *b.Qualification().LastGrantUseRef != "a3" {
		t.Fatal(b.Qualification())
	}
	q := b.Qualification()
	*q.LastGrantUseRef = "changed"
	if *b.Qualification().LastGrantUseRef != "a3" {
		t.Fatal("qualification output exposed private storage")
	}
}

func TestProcessHotViewsDoNotAllocate(t *testing.T) {
	deadline := int64(100)
	p := NewProcess(ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Status: "active", ExpiresAtMs: &deadline, Repeat: &model.ProcessRepeatSnapshot{ExecutionCount: 2, ExecutionIndex: 1, NextExecutionAtMs: &deadline}, EmpoweredAttackWindow: &model.ProcessEmpoweredAttackWindow{MaximumAttackCount: 2, ConsumptionCount: 1}}})
	var value int64
	if allocations := testing.AllocsPerRun(20, func() {
		if p.HasExpiry() && p.HasNextExecution() && p.HasEmpoweredWindow() {
			value = p.Expiry() + p.NextExecutionAt() + int64(p.WindowMaximum()+p.WindowConsumed()+p.RepeatIndex())
		}
	}); allocations != 0 || value != 204 {
		t.Fatal("hot views allocated or changed values", allocations, value)
	}
}
