package runtime

import (
	"encoding/json"
	"fmt"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func automaticChainInput(t *testing.T, n int, linked bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := singleSkillInput(false)
	base := c.SharedProviders[0]
	c.SharedProviders = nil
	c.Combatants[0].Providers = nil
	c.Rules.SkillActionBindings = nil
	r.InitialSnapshot.Combatants[0].Providers = nil
	r.DriverPlan.SkillActions = []model.SkillActionPlan{}
	r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{}}
	r.StopPolicy.DurationMs = 2200
	for i := 0; i < n; i++ {
		key := fmt.Sprintf("rule%d", i)
		providerKey, mount := "definition_"+key, "mount_"+key
		raw, _ := json.Marshal(base)
		var p model.ProviderDefinition
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatal(err)
		}
		p.ProviderKey, p.StableID = providerKey, key
		p.Processes[0].SkillKey = key
		p.Processes[0].Steps[0].DelayMs = timedShieldExpr(1)
		cd := float64(200)
		if i == 1 {
			cd = 1000
		}
		p.Processes[0].Cooldown.DurationMs = *timedShieldExpr(cd)
		for j := range p.Abilities {
			p.Abilities[j].SkillKey = key
			for k := range p.Abilities[j].Operations {
				if hit := p.Abilities[j].Operations[k].SkillHit; hit != nil {
					hit.SkillKey = key
				}
			}
		}
		ref := "source.provider[" + mount + "].ability[initial]"
		hit := "source.provider[" + mount + "].ability[hit]"
		binding := model.SkillActionBinding{BindingKey: "binding_" + key, Source: "source", ProviderRef: mount, ProviderDefinitionRef: providerKey, SkillKey: key, Controls: []model.SkillActionControl{{Action: "INITIAL", ProcessKey: "cast", AbilityRef: ref}}, HitBindings: []model.SkillActionHitBinding{{HitBindingKey: "primary_hit", ProcessKey: "cast", Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, HitAbilityRef: hit}}}
		c.SharedProviders = append(c.SharedProviders, p)
		c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: mount, DefinitionRef: providerKey})
		c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, binding)
		r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: mount, DefinitionRef: providerKey, Source: "source", Owner: "source", Stacks: 1})
		rule := model.AutomaticSkillRule{RuleKey: key, BindingKey: binding.BindingKey, SortOrder: i, Target: "target", HitBindings: []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "TARGET_HIT"}}, WaitForCooldowns: []string{}}
		if i > 0 {
			previous := fmt.Sprintf("rule%d", i-1)
			rule.ReleaseAfterRuleKey = &previous
		}
		if linked && i < n-1 {
			rule.WaitForCooldowns = []string{fmt.Sprintf("rule%d", i+1)}
		}
		r.DriverPlan.AutomaticSkills.Rules = append(r.DriverPlan.AutomaticSkills.Rules, rule)
	}
	for i := range c.Combatants {
		hp := c.Combatants[i].Attributes["hp"]
		hp.Base, hp.Resolved, hp.Max, hp.Current = 1000000, 1000000, 1000000, 1000000
		c.Combatants[i].Attributes["hp"] = hp
	}
	return c, r
}

func TestAutomaticSkillThreeWayChainLinkedCooldownAndRecords(t *testing.T) {
	c, r := automaticChainInput(t, 3, true)
	done := timedShieldMustRun(t, c, r)
	if done.AutomaticSkillSummary == nil || done.AutomaticSkillSummary.StartedCount != 9 || done.AutomaticSkillSummary.CompletedCount != 9 || done.Summary.SkillUses.HitCount != 9 || done.Summary.SkillActions != nil || len(done.SkillUseRecords)+len(done.SkillActionRecords) != 0 {
		t.Fatalf("summary: %+v uses=%+v", done.AutomaticSkillSummary, done.Summary.SkillUses)
	}
	started := map[string][]int64{}
	for _, record := range done.AutomaticSkillRecords {
		if record.Kind == model.AutomaticRecordStarted {
			started[record.RuleKey] = append(started[record.RuleKey], record.TimeMs)
		}
	}
	for key, want := range map[string][]int64{"rule0": {0, 1001, 2002}, "rule1": {1, 1002, 2003}, "rule2": {2, 1003, 2004}} {
		if fmt.Sprint(started[key]) != fmt.Sprint(want) {
			t.Fatalf("%s starts %v want %v", key, started[key], want)
		}
	}
	for _, q := range done.AutomaticSkillSummary.Qualifications {
		if q.GrantedCount != 3 || q.ConsumedCount != 3 || q.RemainingCount != 0 || q.LastGrantUseRef == nil || q.LastConsumeUseRef == nil {
			t.Fatal(q)
		}
	}
	for i, record := range done.AutomaticSkillRecords {
		if record.Sequence != int64(i+1) {
			t.Fatal(record)
		}
	}
	if done.AutomaticSkillRecording.DroppedCount != 0 || done.AutomaticSkillRecording.TotalCount != len(done.AutomaticSkillRecords) || !done.Summary.Execution.Complete {
		t.Fatal(done.AutomaticSkillRecording, done.Summary.Execution)
	}
}

func TestAutomaticSkillPrioritySkipsNoResourceWithoutPolling(t *testing.T) {
	c, r := automaticChainInput(t, 2, false)
	r.DriverPlan.AutomaticSkills.Rules[1].ReleaseAfterRuleKey = nil
	c.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 0, Max: 1}
	c.SharedProviders[0].Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "energy", Amount: *timedShieldExpr(1)}}
	done := timedShieldMustRun(t, c, r)
	if done.AutomaticSkillSummary.Rules[0].AttemptCount != 0 || done.AutomaticSkillSummary.Rules[0].Waiting == nil || done.AutomaticSkillSummary.Rules[0].Waiting.Reason != model.AutomaticWaitMechanicResource || done.AutomaticSkillSummary.Rules[1].StartedCount != 3 {
		t.Fatal(done.AutomaticSkillSummary)
	}
	c, r = automaticChainInput(t, 1, false)
	c.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 0, Max: 1}
	c.SharedProviders[0].Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "energy", Amount: *timedShieldExpr(1)}}
	done = timedShieldMustRun(t, c, r)
	if done.Summary.StopReason != model.StopReasonNoEvents || done.Summary.DurationMs != 0 || done.AutomaticSkillSummary.AttemptCount != 0 {
		t.Fatal(done.Summary, done.AutomaticSkillSummary)
	}
}

func TestAutomaticSkillQualificationIsSingleAndNeverBackfilled(t *testing.T) {
	c, r := automaticChainInput(t, 2, false)
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	a, b := s.automaticSkills.rules[0], s.automaticSkills.rules[1]
	grant := func(use string) {
		action := &skillActionRuntime{automaticRule: a, useRef: use}
		p := &processRuntime{ProcessInstanceSnapshot: model.ProcessInstanceSnapshot{Status: "complete"}}
		s.publishAutomaticSkillFinish(action, p)
		s.publishAutomaticSkillFinish(action, p)
	}
	grant("a1")
	grant("a2")
	if b.qualification.GrantedCount != 1 || b.qualification.RemainingCount != 1 || *b.qualification.LastGrantUseRef != "a1" {
		t.Fatal(b.qualification)
	}
	use := &skillActionRuntime{automaticRule: b, useRef: "b1"}
	s.publishAutomaticSkillStart(use, &processRuntime{})
	s.publishAutomaticSkillFinish(use, &processRuntime{ProcessInstanceSnapshot: model.ProcessInstanceSnapshot{Status: "failed"}})
	if b.qualification.RemainingCount != 0 || b.qualification.ConsumedCount != 1 || b.qualification.GrantedCount != 1 {
		t.Fatal(b.qualification)
	}
	grant("a3")
	if b.qualification.RemainingCount != 1 || b.qualification.GrantedCount != 2 || *b.qualification.LastGrantUseRef != "a3" {
		t.Fatal(b.qualification)
	}
}

func TestAutomaticSkillStrictRelationshipsAndRetention(t *testing.T) {
	for _, scenario := range []string{"unknown-cd", "unknown-parent", "cycle", "branch"} {
		t.Run(scenario, func(t *testing.T) {
			c, r := automaticChainInput(t, 3, false)
			x := "missing"
			switch scenario {
			case "unknown-cd":
				r.DriverPlan.AutomaticSkills.Rules[0].WaitForCooldowns = []string{x}
			case "unknown-parent":
				r.DriverPlan.AutomaticSkills.Rules[1].ReleaseAfterRuleKey = &x
			case "cycle":
				x = "rule2"
				r.DriverPlan.AutomaticSkills.Rules[0].ReleaseAfterRuleKey = &x
			case "branch":
				x = "rule0"
				r.DriverPlan.AutomaticSkills.Rules[2].ReleaseAfterRuleKey = &x
			}
			compiled := compilebundle.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			if _, err := RunGeneric(compiled.Session, r); err == nil {
				t.Fatal("invalid graph admitted")
			}
		})
	}
	for _, budget := range []int{0, 2} {
		c, r := automaticChainInput(t, 3, true)
		r.RecordBudget = &model.RecordBudget{MaxAutomaticSkillRecords: &budget}
		done := timedShieldMustRun(t, c, r)
		if len(done.AutomaticSkillRecords) != budget || done.AutomaticSkillSummary.StartedCount != 9 || done.AutomaticSkillRecording.DroppedCount != done.AutomaticSkillRecording.TotalCount-budget {
			t.Fatal(done.AutomaticSkillRecording)
		}
	}
	c, r := automaticChainInput(t, 3, true)
	r.OutputMode = model.RunOutputSummary
	done := timedShieldMustRun(t, c, r)
	if len(done.AutomaticSkillRecords) != 0 || done.AutomaticSkillRecording.OmittedCount != done.AutomaticSkillRecording.TotalCount || done.AutomaticSkillRecording.DroppedCount != 0 || done.AutomaticSkillSummary.StartedCount != 9 {
		t.Fatal(done.AutomaticSkillRecording)
	}
}

func TestAutomaticSkillZeroCooldownFormulaAndCommitBudget(t *testing.T) {
	c, r := automaticChainInput(t, 1, false)
	c.SharedProviders[0].Processes[0].Cooldown.DurationMs = model.GenericFormulaExpr{Op: "read", Path: "source.attr.armor.resolved"}
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	if _, err := RunGeneric(compiled.Session, r); err == nil {
		t.Fatal("zero dynamic cooldown admitted")
	}
	c, r = automaticChainInput(t, 2, false)
	s := frameCommitState(t, c, r)
	b := s.automaticSkills.rules[1]
	b.qualification.RemainingCount = 1
	// 已经由A完成赋予的资格，在B入口提交的队列预检失败时保留。
	key := "probe_b"
	action := &skillActionRuntime{automaticRule: b, plan: model.SkillActionPlan{InstructionKey: key, AbilityRef: b.abilityRef}, useRef: "skill:" + key}
	s.skillActionByUse[action.useRef], s.skillAction = action, action
	s.processFacts[key] = model.ProcessCommandFact{DriverEntryKey: key, UseRef: action.useRef}
	s.heap = scheduler.NewGenericHeap(1)
	s.heap.SetLimit(1)
	s.heap.Push(scheduler.GenericEvent{TimeMs: 200, Kind: scheduler.GenericEventSample})
	err := s.handleProcessCommand(model.DriverEntry{EntryKey: key, AbilityRef: b.abilityRef, Source: "source", Target: "target"}, -1, s.compiled.Abilities[b.controlIndex], b.abilityRef)
	if err == nil || action.accepted || b.qualification.RemainingCount != 1 || len(s.processInstances) != 0 {
		t.Fatal(err, action.accepted, b.qualification, len(s.processInstances))
	}
}

func TestAutomaticSkillOrdinaryStateExpiryWakesWithoutBasicAttack(t *testing.T) {
	c, r := automaticChainInput(t, 1, false)
	r.StopPolicy.DurationMs = 1100
	c.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 0, Max: 1}
	p := &c.SharedProviders[0]
	p.InitialStateSchema = map[string]any{"blocked": map[string]any{"defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(500), "refreshPolicy": "refresh_on_write"}}
	p.Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "energy", Amount: model.GenericFormulaExpr{Op: "read", Path: "provider.state.blocked"}}}
	p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{stateScopeProvider}, Ref: "blocked", ValuePolicy: "override", Amount: timedShieldExpr(1)}}}}
	done := timedShieldMustRun(t, c, r)
	starts := []int64{}
	for _, row := range done.AutomaticSkillRecords {
		if row.Kind == model.AutomaticRecordStarted {
			starts = append(starts, row.TimeMs)
		}
	}
	if fmt.Sprint(starts) != "[0 500 1000]" || done.AutomaticSkillSummary.StartedCount != 3 {
		t.Fatal(starts, done.AutomaticSkillSummary)
	}
}
