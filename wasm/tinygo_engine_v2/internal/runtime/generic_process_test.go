package runtime

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
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

func TestProcessTimingAndUniqueTermination(t *testing.T) {
	for _, tc := range []struct {
		name, kind        string
		at                int64
		auto              bool
		damage            float64
		rejected, timeout int
	}{{"charge early", "CHARGE", 199, false, 0, 1, 1}, {"charge minimum", "CHARGE", 200, false, 100, 0, 0}, {"charge exact max", "CHARGE", 500, false, 0, 1, 1}, {"charge auto", "CHARGE", 500, true, 100, 1, 1}, {"recast active", "RECAST", 250, false, 100, 0, 0}, {"recast timeout", "RECAST", 500, false, 0, 1, 1}} {
		t.Run(tc.name, func(t *testing.T) {
			c, r := processBase(t, tc.kind)
			if tc.kind == "CHARGE" {
				c.SharedProviders[0].Processes[0].Steps[0].ReleaseAtMaximum = model.BoolPtr(tc.auto)
			}
			processEntry(&r, "advance", "advance", "u1", tc.at)
			done := processRun(t, c, r)
			if done.Summary.SourceDamageDealt != tc.damage || processResource(done, "source", "mana") != 140 || processCount(done, "process_rejected", "") != tc.rejected || processCount(done, "process_moment", "STEP_TIMEOUT") != tc.timeout || processCount(done, "process_moment", "PROCESS_COMPLETE") != 1 {
				t.Fatalf("unexpected result: %+v evidence=%+v", done.Summary, done.Evidence.Items)
			}
			if len(done.FinalSnapshot.ProcessInstances) != 1 || done.FinalSnapshot.ProcessInstances[0].Status != "complete" {
				t.Fatal(done.FinalSnapshot.ProcessInstances)
			}
		})
	}
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
		if err == nil || state.combatants["source"].resources["mana"].Current != 200 || len(state.processInstances) != 0 {
			t.Fatalf("err=%v state=%+v", err, state.processInstances)
		}
	})
}

func TestProcessRepeatedInitialAndTargetIdentity(t *testing.T) {
	c, r := processBase(t, "RECAST")
	r.SkillUses = append(r.SkillUses, model.SkillUseFact{UseKey: "u2", Source: "source", SkillKey: "skill:q", HistoryState: "complete"})
	processEntry(&r, "twice", "start", "u1", 50)
	processEntry(&r, "other-use", "start", "u2", 100)
	processEntry(&r, "wrong-target", "advance", "u1", 150)
	r.DriverPlan.Entries[3].Target = "source"
	processEntry(&r, "advance", "advance", "u1", 200)
	processEntry(&r, "finished", "advance", "u1", 300)
	processEntry(&r, "restart", "start", "u1", 350)
	done := processRun(t, c, r)
	if processResource(done, "source", "mana") != 140 || processCount(done, "process_rejected", "") != 5 || processCount(done, "process_moment", "PROCESS_COMPLETE") != 1 {
		t.Fatal(done.Evidence.Items)
	}
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

func TestProcessFailureOrderAndUnmatchedCancel(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	p := &c.SharedProviders[0].Processes[0]
	for i, reason := range []string{"", "ACTIVE_CANCELLED", ""} {
		policy := "add"
		if i == 1 {
			policy = "set"
		}
		p.MomentOperations = append(p.MomentOperations, model.ProcessMomentOperations{Moment: processMoment("PROCESS_FAILURE", "", reason), Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "self", AttributeKey: "attack_damage", ValuePolicy: policy, Amount: timedShieldExpr(float64((i + 1) * 10))}}})
	}
	processEntry(&r, "cancel", "cancel", "u1", 100)
	done := processRun(t, c, r)
	if got := done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Base; got != 50 {
		t.Fatalf("expected A then B then C = 50; got %v", got)
	}
	c, r = processBase(t, "CHARGE")
	processEntry(&r, "cancel", "cancel", "u1", 100)
	r.DriverPlan.Entries[1].Condition = timedShieldExpr(0)
	done = processRun(t, c, r)
	if processCount(done, "process_moment", "PROCESS_FAILURE") != 0 || processResource(done, "source", "mana") != 140 {
		t.Fatal(done.FinalSnapshot)
	}
}

func TestProcessSnapshotResumeAndBoundary(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	r.StopPolicy.DurationMs = 100
	partial := processRun(t, c, r)
	resume := r
	resume.InitialSnapshot = partial.FinalSnapshot
	resume.DriverPlan.Entries = nil
	resume.ProcessCommandFacts = nil
	resume.StopPolicy.DurationMs = 600
	processEntry(&resume, "advance", "advance", "u1", 200)
	done := processRun(t, c, resume)
	if processResource(done, "source", "mana") != 140 || processCount(done, "process_moment", "PROCESS_START") != 0 || processCount(done, "process_moment", "PROCESS_COMPLETE") != 1 || done.Summary.SourceDamageDealt != 100 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	resume.InitialSnapshot = done.FinalSnapshot
	resume.DriverPlan.Entries = nil
	resume.ProcessCommandFacts = nil
	resume.SkillUses = nil
	done = processRun(t, c, resume)
	if processCount(done, "process_moment", "") != 0 {
		t.Fatal(done.Evidence.Items)
	}
	resume.InitialSnapshot = partial.FinalSnapshot
	resume.InitialSnapshot.TimeMs = 500
	resume.DriverPlan.Entries = nil
	resume.ProcessCommandFacts = nil
	resume.SkillUses = r.SkillUses
	processEntry(&resume, "at-expiry", "advance", "u1", 500)
	done = processRun(t, c, resume)
	if processCount(done, "process_moment", "STEP_TIMEOUT") != 1 || processCount(done, "process_rejected", "") != 1 {
		t.Fatal(done.Evidence.Items)
	}
}

func TestProcessInvalidSnapshotAndFacts(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	r.StopPolicy.DurationMs = 100
	partial := processRun(t, c, r)
	for _, tc := range []struct {
		name   string
		change func(*model.RunRequest)
	}{
		{"past active timer", func(r *model.RunRequest) { r.InitialSnapshot.TimeMs = 501 }},
		{"missing costs", func(r *model.RunRequest) { r.InitialSnapshot.ProcessInstances[0].ActualCosts = map[string]float64{} }},
		{"negative cost", func(r *model.RunRequest) { r.InitialSnapshot.ProcessInstances[0].ActualCosts["mana"] = -1 }},
		{"bad version", func(r *model.RunRequest) { r.InitialSnapshot.ProcessInstances[0].StepVersion = 99 }},
		{"bad cooldown", func(r *model.RunRequest) { r.InitialSnapshot.ProcessInstances[0].CooldownStarted = true }},
		{"bad finished", func(r *model.RunRequest) { v := int64(100); r.InitialSnapshot.ProcessInstances[0].FinishedAtMs = &v }},
		{"bad target", func(r *model.RunRequest) { r.InitialSnapshot.ProcessInstances[0].Target = "else" }},
		{"duplicate", func(r *model.RunRequest) {
			r.InitialSnapshot.ProcessInstances = append(r.InitialSnapshot.ProcessInstances, r.InitialSnapshot.ProcessInstances[0])
		}},
		{"past driver", func(r *model.RunRequest) { processEntry(r, "past", "advance", "u1", 99) }},
		{"missing fact", func(r *model.RunRequest) {
			processEntry(r, "advance", "advance", "u1", 200)
			r.ProcessCommandFacts = nil
		}},
		{"wrong use", func(r *model.RunRequest) { processEntry(r, "advance", "advance", "absent", 200) }},
		{"duplicate fact", func(r *model.RunRequest) {
			processEntry(r, "advance", "advance", "u1", 200)
			r.ProcessCommandFacts = append(r.ProcessCommandFacts, r.ProcessCommandFacts[0])
		}},
		{"periodic", func(r *model.RunRequest) {
			processEntry(r, "advance", "advance", "u1", 200)
			r.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalMs: 10, MaxAttempts: 2}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, _ := json.Marshal(partial.FinalSnapshot)
			var snap model.Snapshot
			if err := json.Unmarshal(raw, &snap); err != nil {
				t.Fatal(err)
			}
			resume := r
			resume.InitialSnapshot = snap
			resume.DriverPlan.Entries = nil
			resume.ProcessCommandFacts = nil
			tc.change(&resume)
			err, _ := timedShieldMustFail(t, c, resume)
			if err.Path == "" {
				t.Fatalf("missing path %+v", err)
			}
		})
	}
}

func TestProcessSourceDeathBeforeStop(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	c.SharedProviders[0].Processes[0].MomentOperations = append(c.SharedProviders[0].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: processMoment("PROCESS_FAILURE", "", "SOURCE_DIED"), Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: &model.GenericFormulaExpr{Op: "read", Path: "process.actual_cost.mana"}}}})
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, timedShieldAbility("kill", []model.OperationDefinition{{Operation: "damage", Target: "source", DamageType: "damage/physical", Amount: timedShieldExpr(10000)}}))
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "kill", AbilityRef: timedShieldRef("kill"), Source: "source", Target: "target", FirstAtMs: 100})
	done := processRun(t, c, r)
	if done.Summary.StopReason != model.StopReasonSourceDead || processResource(done, "source", "mana") != 200 || processCount(done, "process_moment", "PROCESS_FAILURE") != 1 || *done.FinalSnapshot.ProcessInstances[0].FailureReason != "SOURCE_DIED" {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
}

func TestProcessInvalidDurationAndFrozenTiming(t *testing.T) {
	for _, value := range []float64{-1, 0.5, math.Inf(1)} {
		c, r := processBase(t, "CHARGE")
		c.SharedProviders[0].Processes[0].Steps[0].MaximumChargeMs = &model.GenericFormulaExpr{Op: "read", Path: "ability.param.maximum"}
		c.SharedProviders[0].Abilities[0].Params = map[string]float64{"maximum": value}
		timedShieldMustFail(t, c, r)
	}
	c, r := processBase(t, "CHARGE")
	c.SharedProviders[0].Processes[0].Steps[0].MaximumChargeMs = &model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage"}
	r.InitialSnapshot.Combatants[0].Attributes["attack_damage"] = model.AttributeSlotDef{Base: 500, Current: 500, Max: 1000, Resolved: 500}
	c.SharedProviders[0].Processes[0].MomentOperations = append(c.SharedProviders[0].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: processMoment("STEP_START", "s1", ""), Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "self", AttributeKey: "attack_damage", ValuePolicy: "set", Amount: timedShieldExpr(900)}}})
	done := processRun(t, c, r)
	if *done.FinalSnapshot.ProcessInstances[0].ExpiresAtMs != 500 {
		t.Fatal(done.FinalSnapshot.ProcessInstances)
	}
}

func TestProcessNoRepeatedAbilityStarted(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	processEntry(&r, "advance", "advance", "u1", 200)
	done := processRun(t, c, r)
	n := 0
	for _, e := range done.Evidence.Items {
		if e.Kind == model.EvidenceKindEmittedEvent && e.Ref == "event/ability_started" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("started %d times: %+v", n, done.Evidence.Items)
	}
}

func TestProcessJSONUnknownFieldRejected(t *testing.T) {
	c, _ := processBase(t, "CHARGE")
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	bad := strings.Replace(string(raw), `"processKey":"p"`, `"foo":true,"processKey":"p"`, 1)
	var decoded model.CompileRequest
	if err := json.Unmarshal([]byte(bad), &decoded); err == nil || !strings.Contains(err.Error(), "foo") {
		t.Fatalf("expected precise unknown-field error, got %v", err)
	}
}

func TestProcessDelayedSequenceAndStaleTimer(t *testing.T) {
	c, r := processBase(t, "RECAST")
	p := &c.SharedProviders[0].Processes[0]
	p.Steps = append([]model.ProcessStepDefinition{{StepKey: "instant", StepType: "IMMEDIATE"}, {StepKey: "wait", StepType: "DELAY", DelayMs: timedShieldExpr(100)}}, p.Steps...)
	processEntry(&r, "too-early", "advance", "u1", 50)
	processEntry(&r, "first-advance", "advance", "u1", 150)
	r.SkillUses = append(r.SkillUses, model.SkillUseFact{UseKey: "u2", Source: "source", SkillKey: "skill:q", HistoryState: "complete"})
	processEntry(&r, "second-start", "start", "u2", 200)
	r.StopPolicy.DurationMs = 650
	done := processRun(t, c, r)
	if processCount(done, "process_rejected", "") != 1 || processCount(done, "process_moment", "PROCESS_COMPLETE") != 1 || processResource(done, "source", "mana") != 80 || done.FinalSnapshot.ProcessInstances[1].Status != "active" || *done.FinalSnapshot.ProcessInstances[1].ExpiresAtMs != 800 {
		t.Fatal(done.FinalSnapshot.ProcessInstances, done.Evidence.Items)
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

func TestProcessBudgetRetainsTerminalUse(t *testing.T) {
	c, r := processBase(t, "RECAST")
	r.SafetyBudget = &model.RunSafetyBudget{MaxProcessInstances: 1}
	processEntry(&r, "advance", "advance", "u1", 100)
	r.SkillUses = append(r.SkillUses, model.SkillUseFact{UseKey: "u2", Source: "source", SkillKey: "skill:q", HistoryState: "complete"})
	processEntry(&r, "second", "start", "u2", 200)
	err, _ := timedShieldMustFail(t, c, r)
	if !strings.Contains(err.Path, "maxProcessInstances") {
		t.Fatal(err)
	}
	for _, raw := range []string{`{"maxProcessInstances":0}`, `{"maxProcessInstances":-1}`, `{"maxProcessInstances":100001}`, `{"maxProcessInstances":1.5}`} {
		var budget model.RunSafetyBudget
		if json.Unmarshal([]byte(raw), &budget) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestProcessP5SameUseKeepsOnlyInitialStart(t *testing.T) {
	c, r := processBase(t, "RECAST")
	skillHitCatalog(&c)
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "skill_hit", Kind: "active", SkillKey: "skill:q", Types: []string{"ability/spell"}, Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: "skill:q", Candidates: []model.SkillHitCandidate{damageCand("damage", "effect-occ", "result", "RESULT", 0)}}}}})
	processEntry(&r, "advance", "advance", "u1", 100)
	for i, at := range []int64{50, 150} {
		key := []string{"hit1", "hit2"}[i]
		r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: key, AbilityRef: skillHitAbilityRef(), Source: "source", Target: "target", FirstAtMs: at})
		r.SkillHitFacts = append(r.SkillHitFacts, model.SkillHitFact{DriverEntryKey: key, UseRef: hitUse("u1")})
	}
	done := processRun(t, c, r)
	if done.Summary.SourceDamageDealt != 300 || processResource(done, "source", "mana") != 140 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	started, hits := 0, 0
	for _, e := range done.Evidence.Items {
		if e.Kind == model.EvidenceKindEmittedEvent && e.Ref == "event/ability_started" {
			started++
		}
		if e.Kind == model.EvidenceKindEmittedEvent && e.Ref == model.EventTypeSkillHit {
			hits++
		}
	}
	if started != 1 || hits != 2 {
		t.Fatalf("started=%d hits=%d evidence=%+v", started, hits, done.Evidence.Items)
	}
}

func TestProcessTimerOrderMatchesRestoredRun(t *testing.T) {
	for _, later := range []bool{false, true} {
		t.Run(map[bool]string{false: "first timer", true: "later timer"}[later], func(t *testing.T) {
			c, r := processBase(t, "DELAY")
			original := c.SharedProviders[0]
			raw, _ := json.Marshal(original)
			var shield model.ProviderDefinition
			if err := json.Unmarshal(raw, &shield); err != nil {
				t.Fatal(err)
			}
			shield.ProviderKey = "shield-process"
			shield.Processes[0].MomentOperations[0].Operations = []model.OperationDefinition{{Operation: "shield", Target: "target", ShieldRef: "order-shield", Amount: timedShieldExpr(100)}}
			if later {
				for _, def := range []*model.ProviderDefinition{&original, &shield} {
					def.Processes[0].Steps = append([]model.ProcessStepDefinition{{StepKey: "prior", StepType: "DELAY", DelayMs: timedShieldExpr(100)}}, def.Processes[0].Steps...)
				}
			}
			c.SharedProviders = []model.ProviderDefinition{original, shield}
			c.Combatants[0].Providers = []model.CombatantProviderMount{{ProviderRef: "z", DefinitionRef: original.ProviderKey}, {ProviderRef: "a", DefinitionRef: shield.ProviderKey}}
			r.InitialSnapshot.Combatants[0].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "z", DefinitionRef: original.ProviderKey, Stacks: 1}, {ProviderRef: "a", DefinitionRef: shield.ProviderKey, Stacks: 1}}
			r.DriverPlan.Entries[0].AbilityRef = "source.provider[z].ability[start]"
			r.SkillUses = append(r.SkillUses, model.SkillUseFact{UseKey: "u2", Source: "source", SkillKey: "skill:q", HistoryState: "complete"})
			processEntry(&r, "shield-start", "start", "u2", 0)
			r.DriverPlan.Entries[1].AbilityRef = "source.provider[a].ability[start]"
			r.StopPolicy.DurationMs = 700
			continuous := processRun(t, c, r)
			partialRequest := r
			partialRequest.StopPolicy.DurationMs = 50
			partial := processRun(t, c, partialRequest)
			resume := r
			resume.InitialSnapshot = partial.FinalSnapshot
			resume.DriverPlan.Entries = nil
			resume.ProcessCommandFacts = nil
			resumed := processRun(t, c, resume)
			if continuous.Summary.TargetFinalHp != resumed.Summary.TargetFinalHp || continuous.Summary.TargetFinalHp != 1000 {
				t.Fatalf("continuous HP %v != restored %v", continuous.Summary.TargetFinalHp, resumed.Summary.TargetFinalHp)
			}
			a, _ := json.Marshal(continuous.FinalSnapshot.Combatants[1].Shields)
			b, _ := json.Marshal(resumed.FinalSnapshot.Combatants[1].Shields)
			if string(a) != string(b) {
				t.Fatalf("shield mismatch %s %s", a, b)
			}
		})
	}
}

func TestProcessDelayedAndRestoredStatsUseInitialAbility(t *testing.T) {
	c, r := processBase(t, "DELAY")
	r.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 900, Max: 1000, Resolved: 900}
	c.SharedProviders[0].Processes[0].MomentOperations[0].Operations = append(c.SharedProviders[0].Processes[0].MomentOperations[0].Operations, model.OperationDefinition{Operation: "heal", Target: "self", Amount: timedShieldExpr(50)})
	for _, restore := range []bool{false, true} {
		testRun := r
		if restore {
			testRun.StopPolicy.DurationMs = 100
			part := processRun(t, c, testRun)
			testRun.InitialSnapshot = part.FinalSnapshot
			testRun.DriverPlan.Entries = nil
			testRun.ProcessCommandFacts = nil
			testRun.StopPolicy.DurationMs = 600
		}
		done := processRun(t, c, testRun)
		found := false
		for _, stat := range done.Summary.AbilityStats {
			if stat.AbilityRef == timedShieldRef("start") {
				found = true
				if stat.DamageDealt == nil || *stat.DamageDealt != 100 || stat.HealingDone == nil || *stat.HealingDone != 50 {
					t.Fatalf("restore=%v bad stats %+v", restore, stat)
				}
			}
		}
		if !found {
			t.Fatal("missing initial ability stats")
		}
	}
}

func TestProcessP5RestoredReverseOwnerKeepsIdentity(t *testing.T) {
	c, r := processBase(t, "RECAST")
	skillHitCatalog(&c)
	c.Combatants[1].Providers = c.Combatants[0].Providers
	c.Combatants[0].Providers = nil
	r.InitialSnapshot.Combatants[1].Providers = r.InitialSnapshot.Combatants[0].Providers
	r.InitialSnapshot.Combatants[0].Providers = nil
	r.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 1000, Max: 1000, Resolved: 1000}
	r.SkillUses[0].Source = "target"
	r.DriverPlan.Entries[0].Source = "target"
	r.DriverPlan.Entries[0].Target = "source"
	r.DriverPlan.Entries[0].AbilityRef = "target.provider[champion:source_demo].ability[start]"
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "skill_hit", Kind: "active", SkillKey: "skill:q", Types: []string{"ability/spell"}, Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: "skill:q", Candidates: []model.SkillHitCandidate{damageCand("d", "occ", "r", "RESULT", 0)}}}}})
	r.StopPolicy.DurationMs = 100
	part := processRun(t, c, r)
	r.InitialSnapshot = part.FinalSnapshot
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "hit", AbilityRef: "target.provider[champion:source_demo].ability[skill_hit]", Source: "target", Target: "source", FirstAtMs: 200}}
	r.ProcessCommandFacts = nil
	r.SkillHitFacts = []model.SkillHitFact{{DriverEntryKey: "hit", UseRef: hitUse("u1")}}
	r.StopPolicy.DurationMs = 200
	done := processRun(t, c, r)
	if done.Summary.TargetDamageDealt != 100 || processResource(done, "target", "mana") != 140 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	for _, ev := range done.Evidence.Items {
		if ev.Ref == "event/ability_started" {
			t.Fatal("restored hit repeated start", ev)
		}
	}
}

func TestProcessDeathClaimsAllInstancesBeforeFailureHealing(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	r.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 1000, Max: 1000, Resolved: 1000}
	c.SharedProviders[0].Processes[0].MomentOperations = append(c.SharedProviders[0].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: processMoment("PROCESS_FAILURE", "", "SOURCE_DIED"), Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(1)}}})
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "second", DefinitionRef: "champion:source_demo"})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "second", DefinitionRef: "champion:source_demo", Stacks: 1})
	r.SkillUses = append(r.SkillUses, model.SkillUseFact{UseKey: "u2", Source: "source", SkillKey: "skill:q", HistoryState: "complete"})
	processEntry(&r, "second", "start", "u2", 0)
	r.DriverPlan.Entries[1].AbilityRef = "source.provider[second].ability[start]"
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, timedShieldAbility("kill", []model.OperationDefinition{{Operation: "damage", Target: "source", DamageType: "damage/physical", Amount: timedShieldExpr(10000)}}))
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "kill", AbilityRef: timedShieldRef("kill"), Source: "source", Target: "target", FirstAtMs: 100})
	done := processRun(t, c, r)
	if processCount(done, "process_moment", "PROCESS_FAILURE") != 2 {
		t.Fatal(done.Evidence.Items)
	}
	for _, p := range done.FinalSnapshot.ProcessInstances {
		if p.Status != "failed" || *p.FailureReason != "SOURCE_DIED" {
			t.Fatal(done.FinalSnapshot.ProcessInstances)
		}
	}
}

func TestProcessResumeRejectsPastOrdinaryDriver(t *testing.T) {
	c, r := processBase(t, "CHARGE")
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, timedShieldAbility("ordinary", []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: timedShieldExpr(1)}}))
	r.StopPolicy.DurationMs = 100
	partial := processRun(t, c, r)
	r.InitialSnapshot = partial.FinalSnapshot
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "past", AbilityRef: timedShieldRef("ordinary"), Source: "source", Target: "target", FirstAtMs: 50}}
	r.ProcessCommandFacts = nil
	err, _ := timedShieldMustFail(t, c, r)
	if !strings.Contains(err.Path, "firstAtMs") {
		t.Fatal(err)
	}
}
