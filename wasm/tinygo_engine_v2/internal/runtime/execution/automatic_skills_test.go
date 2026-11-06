package execution

import (
	json "encoding/json"
	fmt "fmt"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
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
	a, b := s.actions.AutomaticAt(0), s.actions.AutomaticAt(1)
	grant := func(use string) {
		action := actionpkg.NewSkillAction(actionpkg.SkillActionSeed{AutomaticRule: a, UseRef: use})
		p := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Status: "complete"}})
		s.publishAutomaticSkillFinish(action, p)
		s.publishAutomaticSkillFinish(action, p)
	}
	grant("a1")
	grant("a2")
	if b.Qualification().GrantedCount != 1 || b.Qualification().RemainingCount != 1 || *b.Qualification().LastGrantUseRef != "a1" {
		t.Fatal(b.Qualification())
	}
	use := actionpkg.NewSkillAction(actionpkg.SkillActionSeed{AutomaticRule: b, UseRef: "b1"})
	s.publishAutomaticSkillStart(use, actionpkg.NewProcess(actionpkg.ProcessSeed{}))
	s.publishAutomaticSkillFinish(use, actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Status: "failed"}}))
	if b.Qualification().RemainingCount != 0 || b.Qualification().ConsumedCount != 1 || b.Qualification().GrantedCount != 1 {
		t.Fatal(b.Qualification())
	}
	grant("a3")
	if b.Qualification().RemainingCount != 1 || b.Qualification().GrantedCount != 2 || *b.Qualification().LastGrantUseRef != "a3" {
		t.Fatal(b.Qualification())
	}
}

func TestAutomaticSkillZeroCooldownFormulaAndCommitBudget(t *testing.T) {
	c, r := automaticChainInput(t, 1, false)
	c.SharedProviders[0].Processes[0].Cooldown.DurationMs = model.GenericFormulaExpr{Op: "read", Path: "source.attr.armor.resolved"}
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	if _, err := runForTest(compiled.Session, r); err == nil {
		t.Fatal("zero dynamic cooldown admitted")
	}
	c, r = automaticChainInput(t, 2, false)
	s := frameCommitState(t, c, r)
	b := s.actions.AutomaticAt(1)
	parentAction := actionpkg.NewSkillAction(actionpkg.SkillActionSeed{AutomaticRule: s.actions.AutomaticAt(0), UseRef: "grant-before-failed-start"})
	s.actions.AutomaticFinished(parentAction, actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Status: "complete"}}))
	// 已经由A完成赋予的资格，在B入口提交的队列预检失败时保留。
	key := "probe_b"
	action := actionpkg.NewSkillAction(actionpkg.SkillActionSeed{AutomaticRule: b, Plan: model.SkillActionPlan{InstructionKey: key, AbilityRef: b.AbilityRef()}, UseRef: "skill:" + key})
	s.actions.BindActionUse(action.UseRef(), action)
	s.actions.SetCurrentAction(action)
	s.actions.SetProcessFact(key, model.ProcessCommandFact{DriverEntryKey: key, UseRef: action.UseRef()})
	clearQueuedEventsForTest(s.loop)
	s.loop.SetQueueLimit(1)
	s.loop.Enqueue(scheduler.GenericEvent{TimeMs: 200, Kind: scheduler.GenericEventSample})
	err := s.handleProcessCommand(model.DriverEntry{EntryKey: key, AbilityRef: b.AbilityRef(), Source: "source", Target: "target"}, -1, s.compiled.Abilities[b.ControlIndex()], b.AbilityRef())
	if err == nil || action.Accepted() || b.Qualification().RemainingCount != 1 || s.actions.ProcessCount() != 0 {
		t.Fatal(err, action.Accepted(), b.Qualification(), s.actions.ProcessCount())
	}
}
