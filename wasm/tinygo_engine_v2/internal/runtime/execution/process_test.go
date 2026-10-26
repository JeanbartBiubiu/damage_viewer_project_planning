package execution

import (
	strings "strings"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

func processPtr(s string) *string { return &s }

func processMoment(kind, step, reason string) model.ProcessMomentDefinition {
	m := model.ProcessMomentDefinition{MomentType: kind}
	if step != "" {
		m.StepKey = processPtr(step)
	}
	if reason != "" {
		m.FailureReason = processPtr(reason)
	}
	return m
}

func processBase(t *testing.T, kind string) (model.CompileRequest, model.RunRequest) {
	c, r := timedShieldLoad(t)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"}, model.TypeCatalogEntry{Key: "event/ability_started", Domain: "event"})
	step := model.ProcessStepDefinition{StepKey: "s1", StepType: kind}
	action := "RECAST"
	switch kind {
	case "RECAST":
		step.WindowMs = timedShieldExpr(500)
		step.MaximumRecastCount = timedShieldExpr(1)
	case "CHARGE":
		step.MinimumChargeMs = timedShieldExpr(200)
		step.MaximumChargeMs = timedShieldExpr(500)
		step.ReleaseAtMaximum = model.BoolPtr(true)
		action = "CHARGE_RELEASE"
	case "DELAY":
		step.DelayMs = timedShieldExpr(500)
	}
	p := model.ProcessDefinition{ProcessKey: "p", SkillKey: "skill:q", Steps: []model.ProcessStepDefinition{step}, Costs: []model.ProcessCostDefinition{{ResourceKey: "mana", Amount: *timedShieldExpr(60)}}, MomentOperations: []model.ProcessMomentOperations{{Moment: processMoment("STEP_EXECUTION", "s1", ""), Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: timedShieldExpr(100), DamageType: "damage/physical"}}}}}
	ab := func(key, action, step, reason string) model.AbilityDefinition {
		return model.AbilityDefinition{AbilityKey: key, Kind: "active", SkillKey: "skill:q", Types: []string{"ability/spell"}, ProcessControl: &model.ProcessControlDefinition{ProcessKey: "p", Action: action, StepKey: step, FailureReason: reason}}
	}
	c.SharedProviders[0].Processes = []model.ProcessDefinition{p}
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{ab("start", "INITIAL", "", ""), ab("cancel", "CANCEL", "", "ACTIVE_CANCELLED"), ab("interrupt", "INTERRUPT", "", "CONTROLLED")}
	if kind == "CHARGE" || kind == "RECAST" {
		c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, ab("advance", action, "s1", ""))
	}
	for i := range c.Combatants {
		c.Combatants[i].Resources["mana"] = model.ResourceSlotDef{Current: 200, Max: 500}
	}
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Resources == nil {
			r.InitialSnapshot.Combatants[i].Resources = map[string]model.ResourceSlotDef{}
		}
		r.InitialSnapshot.Combatants[i].Resources["mana"] = model.ResourceSlotDef{Current: 200, Max: 500}
	}
	r.DriverPlan.Entries = nil
	r.SkillUses = []model.SkillUseFact{{UseKey: "u1", Source: "source", SkillKey: "skill:q", HistoryState: "complete"}}
	r.SkillHitFacts = nil
	r.ProcessCommandFacts = nil
	r.StopPolicy.DurationMs = 600
	processEntry(&r, "start", "start", "u1", 0)
	return c, r
}

func processEntry(r *model.RunRequest, key, ability, use string, at int64) {
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: key, AbilityRef: timedShieldRef(ability), Source: "source", Target: "target", FirstAtMs: at})
	r.ProcessCommandFacts = append(r.ProcessCommandFacts, model.ProcessCommandFact{DriverEntryKey: key, UseRef: use})
}

func processResource(done model.DoneResult, owner, key string) float64 {
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == owner {
			return c.Resources[key].Current
		}
	}
	return -1
}

func processCount(done model.DoneResult, kind, moment string) int {
	n := 0
	for _, e := range done.Evidence.Items {
		if string(e.Kind) == kind && (moment == "" || e.Data["moment"] == moment) {
			n++
		}
	}
	return n
}

func processRun(t *testing.T, c model.CompileRequest, r model.RunRequest) model.DoneResult {
	return timedShieldMustRun(t, c, r)
}

func TestProcessAtomicCostsAndPerRowValidation(t *testing.T) {
	t.Run("insufficient second resource", func(t *testing.T) {
		c, r := processBase(t, "RECAST")
		c.SharedProviders[0].Processes[0].Costs = append(c.SharedProviders[0].Processes[0].Costs, model.ProcessCostDefinition{ResourceKey: "energy", Amount: *timedShieldExpr(30)})
		r.InitialSnapshot.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 20, Max: 100}
		done := processRun(t, c, r)
		if processResource(done, "source", "mana") != 200 || processResource(done, "source", "energy") != 20 || len(done.FinalSnapshot.ProcessInstances) != 0 {
			t.Fatal(done.FinalSnapshot)
		}
	})
	t.Run("same resource costs aggregate", func(t *testing.T) {
		c, r := processBase(t, "RECAST")
		c.SharedProviders[0].Processes[0].Costs = append(c.SharedProviders[0].Processes[0].Costs, model.ProcessCostDefinition{ResourceKey: "mana", Amount: *timedShieldExpr(10)})
		done := processRun(t, c, r)
		if processResource(done, "source", "mana") != 130 || done.FinalSnapshot.ProcessInstances[0].ActualCosts["mana"] != 70 {
			t.Fatal(done.FinalSnapshot)
		}
	})
	t.Run("dynamic negative cannot offset", func(t *testing.T) {
		c, r := processBase(t, "RECAST")
		c.SharedProviders[0].Abilities[0].Params = map[string]float64{"bad": -10}
		c.SharedProviders[0].Processes[0].Costs = append(c.SharedProviders[0].Processes[0].Costs, model.ProcessCostDefinition{ResourceKey: "mana", Amount: model.GenericFormulaExpr{Op: "read", Path: "ability.param.bad"}})
		compiled := compile.CompileGeneric(c)
		if !compiled.OK {
			t.Fatal(compiled.Result.Errors)
		}
		state, err := newGenericRunState(compiled.Session, r)
		if err != nil {
			t.Fatal(err)
		}
		err = state.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0})
		if err == nil || state.combatants["source"].resourceView().At("mana").Current != 200 || state.actions.ProcessCount() != 0 {
			t.Fatalf("err=%v state=%+v", err, state.actions.ProcessViews())
		}
	})
}

func TestProcessRefundFrozenCostAndCancelCooldown(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	p := &c.SharedProviders[0].Processes[0]
	p.Costs[0].Amount = model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage"}
	r.InitialSnapshot.Combatants[0].Attributes["attack_damage"] = model.AttributeSlotDef{Base: 60, Current: 60, Max: 500, Resolved: 60}
	p.Cooldown = &model.ProcessCooldownDefinition{DurationMs: *timedShieldExpr(1000), StartMoment: processMoment("PROCESS_FAILURE", "", "")}
	p.MomentOperations = append(p.MomentOperations, model.ProcessMomentOperations{Moment: processMoment("PROCESS_START", "", ""), Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "self", AttributeKey: "attack_damage", ValuePolicy: "set", Amount: timedShieldExpr(160)}}}, model.ProcessMomentOperations{Moment: processMoment("PROCESS_FAILURE", "", "ACTIVE_CANCELLED"), Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: &model.GenericFormulaExpr{Op: "read", Path: "process.actual_cost.mana"}}, {Operation: "cooldown_change", Target: "self", AbilityRef: "self.provider[champion:source_demo].ability[start]", ValuePolicy: "set_remaining", Amount: timedShieldExpr(250)}}})
	processEntry(&r, "cancel", "cancel", "u1", 100)
	processEntry(&r, "duplicate", "cancel", "u1", 200)
	r.StopPolicy.DurationMs = 200
	done := processRun(t, c, r)
	row := done.FinalSnapshot.ProcessInstances[0]
	if done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Base != 160 {
		t.Fatal("attribute mutation did not reach 160")
	}
	if processResource(done, "source", "mana") != 200 || row.ActualCosts["mana"] != 60 || !row.CooldownStarted || row.Status != "failed" || *row.FailureReason != "ACTIVE_CANCELLED" || processCount(done, "process_moment", "PROCESS_FAILURE") != 1 {
		t.Fatal(done.FinalSnapshot, done.Evidence.Items)
	}
	if at := parseCooldownReadyAtMs(done.FinalSnapshot.Combatants[0].Cooldowns[timedShieldRef("start")]); at != 350 {
		t.Fatalf("cooldown=%v", done.FinalSnapshot.Combatants[0].Cooldowns)
	}
}

func TestProcessTwoOwnersAndTwoMountsStayIsolated(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	p := &c.SharedProviders[0].Processes[0]
	p.Cooldown = &model.ProcessCooldownDefinition{DurationMs: *timedShieldExpr(1000), StartMoment: processMoment("PROCESS_FAILURE", "", "")}
	p.MomentOperations = append(p.MomentOperations, model.ProcessMomentOperations{Moment: processMoment("PROCESS_FAILURE", "", "ACTIVE_CANCELLED"), Operations: []model.OperationDefinition{{Operation: "cooldown_change", Target: "self", AbilityRef: "self.provider[champion:source_demo].ability[start]", ValuePolicy: "set_remaining", Amount: timedShieldExpr(250)}}})
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "second", DefinitionRef: "champion:source_demo"})
	c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo"})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "second", DefinitionRef: "champion:source_demo", Owner: "source", Source: "source", Stacks: 1})
	r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo", Owner: "target", Source: "target", Stacks: 1})
	r.SkillUses = append(r.SkillUses, model.SkillUseFact{UseKey: "u2", Source: "source", SkillKey: "skill:q", HistoryState: "complete"}, model.SkillUseFact{UseKey: "u3", Source: "target", SkillKey: "skill:q", HistoryState: "complete"})
	processEntry(&r, "second-start", "start", "u2", 10)
	r.DriverPlan.Entries[1].AbilityRef = "source.provider[second].ability[start]"
	processEntry(&r, "reverse-start", "start", "u3", 20)
	r.DriverPlan.Entries[2].Source = "target"
	r.DriverPlan.Entries[2].Target = "source"
	r.DriverPlan.Entries[2].AbilityRef = "target.provider[champion:source_demo].ability[start]"
	processEntry(&r, "wrong-mount", "advance", "u1", 250)
	r.DriverPlan.Entries[3].AbilityRef = "source.provider[second].ability[advance]"
	processEntry(&r, "reverse-cancel", "cancel", "u3", 100)
	r.DriverPlan.Entries[4].Source = "target"
	r.DriverPlan.Entries[4].Target = "source"
	r.DriverPlan.Entries[4].AbilityRef = "target.provider[champion:source_demo].ability[cancel]"
	r.StopPolicy.DurationMs = 300
	done := processRun(t, c, r)
	if len(done.FinalSnapshot.ProcessInstances) != 3 || processResource(done, "source", "mana") != 80 || processResource(done, "target", "mana") != 140 || processCount(done, "process_rejected", "") != 1 {
		t.Fatal(done.FinalSnapshot, done.Evidence.Items)
	}
	if len(done.FinalSnapshot.Combatants[0].Cooldowns) != 0 {
		t.Fatal("reverse cooldown affected source", done.FinalSnapshot.Combatants[0].Cooldowns)
	}
	if got := parseCooldownReadyAtMs(done.FinalSnapshot.Combatants[1].Cooldowns["target.provider[champion:source_demo].ability[start]"]); got != 350 {
		t.Fatal(done.FinalSnapshot.Combatants[1].Cooldowns)
	}
}

func TestProcessCooldownEachMomentOnce(t *testing.T) {
	for _, kind := range []string{"PROCESS_START", "STEP_START", "STEP_EXECUTION", "STEP_COMPLETE", "PROCESS_COMPLETE", "PROCESS_FAILURE"} {
		t.Run(kind, func(t *testing.T) {
			c, r := processBase(t, "CHARGE")
			step := ""
			if strings.HasPrefix(kind, "STEP_") {
				step = "s1"
			}
			c.SharedProviders[0].Processes[0].Cooldown = &model.ProcessCooldownDefinition{DurationMs: *timedShieldExpr(1000), StartMoment: processMoment(kind, step, "")}
			action := "advance"
			if kind == "PROCESS_FAILURE" {
				action = "cancel"
			}
			processEntry(&r, "command", action, "u1", 200)
			r.StopPolicy.DurationMs = 300
			done := processRun(t, c, r)
			expected := int64(1200)
			if kind == "PROCESS_START" || kind == "STEP_START" {
				expected = 1000
			}
			if got := parseCooldownReadyAtMs(done.FinalSnapshot.Combatants[0].Cooldowns[timedShieldRef("start")]); got != expected {
				t.Fatalf("got %v want %v", got, expected)
			}
			if !done.FinalSnapshot.ProcessInstances[0].CooldownStarted {
				t.Fatal("missing marker")
			}
		})
	}
}
