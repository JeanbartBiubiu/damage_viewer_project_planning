package runtime

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func finiteRecastShape(c *model.CompileRequest, r *model.RunRequest, providerIndex, bindingIndex, quota int, interval int64) {
	p := &c.SharedProviders[providerIndex]
	b := &c.Rules.SkillActionBindings[bindingIndex]
	p.Processes[0].Steps = []model.ProcessStepDefinition{
		{StepKey: "first", StepType: "IMMEDIATE", OccupiesAction: model.BoolPtr(false)},
		{StepKey: "again", StepType: "RECAST", OccupiesAction: model.BoolPtr(false), WindowMs: timedShieldExpr(15000), MaximumRecastCount: timedShieldExpr(float64(quota))},
	}
	if interval != 0 {
		p.Processes[0].Steps[1].IntervalMs = timedShieldExpr(float64(interval))
	}
	p.Processes[0].Cooldown.DurationMs = *timedShieldExpr(100000)
	p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "recast", Kind: "active", SkillKey: b.SkillKey, Types: []string{"ability/spell"}, ProcessControl: &model.ProcessControlDefinition{Action: "RECAST", ProcessKey: "cast", StepKey: "again"}})
	b.Controls = append(b.Controls, model.SkillActionControl{Action: "RECAST", ProcessKey: "cast", AbilityRef: "source.provider[" + b.ProviderRef + "].ability[recast]"})
	hitRef := b.HitBindings[0].HitAbilityRef
	b.HitBindings = []model.SkillActionHitBinding{
		{HitBindingKey: "first_hit", ProcessKey: "cast", Moment: processMoment("STEP_EXECUTION", "first", ""), HitAbilityRef: hitRef},
		{HitBindingKey: "again_hit", ProcessKey: "cast", Moment: processMoment("STEP_EXECUTION", "again", ""), HitAbilityRef: hitRef},
	}
	for i := range r.DriverPlan.SkillActions {
		if r.DriverPlan.SkillActions[i].BindingKey == b.BindingKey {
			r.DriverPlan.SkillActions[i].HitBindings = []model.SkillActionHitPreset{{HitBindingKey: "first_hit", Preset: "TARGET_HIT"}, {HitBindingKey: "again_hit", Preset: "TARGET_HIT"}}
		}
	}
}

func finiteRecastInput(quota int, interval int64, times ...int64) (model.CompileRequest, model.RunRequest) {
	c, r := singleSkillInput(false)
	r.DriverPlan.SkillActions[0].FirstAtMs = 0
	r.StopPolicy.DurationMs = 3000
	finiteRecastShape(&c, &r, 0, 0, quota, interval)
	for i, at := range times {
		appendRecast(&c, &r, 0, fmt.Sprintf("again_%d", i), at, i+1)
	}
	return c, r
}

func appendRecast(c *model.CompileRequest, r *model.RunRequest, bindingIndex int, key string, at int64, order int) {
	b := c.Rules.SkillActionBindings[bindingIndex]
	var parent string
	for _, a := range r.DriverPlan.SkillActions {
		if a.Action == "INITIAL" && a.BindingKey == b.BindingKey {
			parent = a.InstructionKey
			break
		}
	}
	r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, model.SkillActionPlan{InstructionKey: key, FirstAtMs: at, SortOrder: order, Source: "source", Target: "target", SkillKey: b.SkillKey, BindingKey: b.BindingKey, Action: "RECAST", AbilityRef: b.Controls[1].AbilityRef, ParentInstructionKey: &parent, HitBindings: []model.SkillActionHitPreset{}})
}

func finiteRecastAutomatic(r *model.RunRequest, b model.SkillActionBinding) {
	presets := r.DriverPlan.SkillActions[0].HitBindings
	r.DriverPlan.SkillActions = nil
	r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{{RuleKey: "repeat", BindingKey: b.BindingKey, Target: "target", HitBindings: presets, WaitForCooldowns: []string{}}}}
}

func recastCounters(c *model.CompileRequest, r *model.RunRequest, throttle bool) {
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"})
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	// Two actual damage packets per shot exercise one shared cast throttle.
	hit := c.SharedProviders[0].Abilities[1].Operations[0].SkillHit
	first := hit.Candidates[0]
	first.Operations[0].Amount = timedShieldExpr(50)
	second := first
	second.CandidateKey = "second"
	second.EffectOccurrenceKey = "second"
	second.EffectKey = "second"
	second.Operations = append([]model.OperationDefinition(nil), first.Operations...)
	second.Operations[0].Ref = "second_damage"
	hit.Candidates = []model.SkillHitCandidate{first, second}
	c.SharedProviders[0].InitialStateSchema = map[string]interface{}{"casts": p6SchemaField(0, 1000, 0, ""), "once": p6SchemaField(0, 1000, 0, ""), "throttle": p6SchemaField(0, 1000, 0, "")}
	op := func(key string) []model.OperationDefinition { return []model.OperationDefinition{p6StateAdd(key, 1)} }
	c.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{ListenerKey: "on_cast", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started", "event/source_owner"}}, MaxTriggersPerEvent: 1, Operations: op("casts")},
		{ListenerKey: "once_a", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, MaxTriggersPerEvent: 1, OncePerUse: &model.OncePerUseLimit{GroupKey: "same", Scope: model.OncePerUseScopeProvider}, Operations: op("once")},
		{ListenerKey: "once_b", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, MaxTriggersPerEvent: 1, OncePerUse: &model.OncePerUseLimit{GroupKey: "same", Scope: model.OncePerUseScopeProvider}, Operations: op("once")},
	}
	if throttle {
		c.SharedProviders[0].Listeners = append(c.SharedProviders[0].Listeners, model.ListenerDefinition{ListenerKey: "per_cast", EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "event/source_owner"}}, MaxTriggersPerEvent: 1, Operations: op("throttle")})
	}
}

func recastCounter(t *testing.T, d model.DoneResult, key string) float64 {
	t.Helper()
	bag := sourceProviderState(t, d.FinalSnapshot, "caster")
	state, _ := bag["state"].(map[string]interface{})
	v, _ := state[key].(float64)
	return v
}

func recastCastID(t *testing.T, v interface{}) uint64 {
	t.Helper()
	switch n := v.(type) {
	case uint64:
		return n
	case float64:
		return uint64(n)
	default:
		t.Fatalf("invalid actual cast ID %T", v)
		return 0
	}
}

func TestFiniteRecastManualIdentityEventsAndUseLimits(t *testing.T) {
	c, r := finiteRecastInput(2, 1000, 999, 1000, 1999, 2000, 2500)
	recastCounters(&c, &r, false)
	d := timedShieldMustRun(t, c, r)
	if d.Summary.SourceDamageDealt != 300 || d.Summary.SkillActions.AcceptedCount != 3 || d.Summary.SkillActions.RejectedCount != 3 || d.Summary.SkillUses.StartedCount != 1 || d.Summary.SkillUses.CompletedCount != 1 || d.Summary.SkillUses.HitCount != 3 {
		t.Fatalf("summary %+v actions=%+v", d.Summary, d.SkillActionRecords)
	}
	for _, key := range []string{"casts", "once"} {
		if recastCounter(t, d, key) != 3 {
			t.Fatalf("%s=%v", key, recastCounter(t, d, key))
		}
	}
	p := d.FinalSnapshot.ProcessInstances[0]
	if p.StepExecutionIndex != 2 || p.SkillHitStages == nil || len(*p.SkillHitStages) != 3 || *p.ExpiresAtMs != 15000 || *p.FinishedAtMs != 2000 {
		t.Fatal(p)
	}
	refs := []string{"skill:cast_once", "recast:skill:cast_once:1", "recast:skill:cast_once:2"}
	indices := []int{0, 2, 4}
	for i, row := range d.DamageRecords {
		shot := i / 2
		if row["timeMs"] != int64(shot*1000) || row["useRef"] != refs[shot] || row["instructionKey"] != r.DriverPlan.SkillActions[indices[shot]].InstructionKey {
			t.Fatal(d.DamageRecords)
		}
	}
	for i, index := range indices {
		if d.SkillActionRecords[index].UseRef == nil || *d.SkillActionRecords[index].UseRef != refs[i] {
			t.Fatal(d.SkillActionRecords)
		}
	}
	for i, reason := range map[int]string{1: "advance_too_early", 3: "advance_too_early", 5: "process_already_finished"} {
		if d.SkillActionRecords[i].Reason == nil || *d.SkillActionRecords[i].Reason != reason {
			t.Fatal(d.SkillActionRecords)
		}
	}
	starts := 0
	ids := map[uint64]bool{}
	shotIDs := []uint64{}
	for _, e := range d.Evidence.Items {
		if e.Kind == model.EvidenceKindEmittedEvent && e.Ref == "event/ability_started" {
			phase := "RECAST"
			if starts == 0 {
				phase = "INITIAL"
			}
			id := recastCastID(t, e.Data["castInstanceId"])
			if starts >= 3 || e.Data["useRef"] != refs[starts] || e.Data["phaseKind"] != phase || ids[id] {
				t.Fatal(e)
			}
			ids[id] = true
			shotIDs = append(shotIDs, id)
			starts++
		}
	}
	if starts != 3 {
		t.Fatalf("starts %d", starts)
	}
	for i, row := range d.DamageRecords {
		if recastCastID(t, row["castInstanceId"]) != shotIDs[i/2] {
			t.Fatal("hit did not inherit cast", row, shotIDs)
		}
	}
	for _, row := range d.SkillUseRecords {
		if row.Kind == "STEP_EXECUTED" && row.UseRef != "skill:cast_once" {
			t.Fatal(row)
		}
	}
}

func TestFiniteRecastZeroIntervalAndQuotaBounds(t *testing.T) {
	for _, n := range []int{1, 2, 63} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			times := make([]int64, n)
			c, r := finiteRecastInput(n, 0, times...)
			for i := range c.Combatants {
				hp := c.Combatants[i].Attributes["hp"]
				hp.Current, hp.Max, hp.Resolved, hp.Base = 100000, 100000, 100000, 100000
				c.Combatants[i].Attributes["hp"] = hp
				r.InitialSnapshot.Combatants[i].Attributes["hp"] = hp
			}
			d := timedShieldMustRun(t, c, r)
			p := d.FinalSnapshot.ProcessInstances[0]
			if d.Summary.SourceDamageDealt != float64((n+1)*100) || len(*p.SkillHitStages) != n+1 || p.StepExecutionIndex != n || p.Status != "complete" {
				t.Fatal(d.Summary, p)
			}
			for _, f := range *p.SkillHitStages {
				if f.TimeMs != 0 || !f.Contact || !f.Completed {
					t.Fatal(f)
				}
			}
		})
	}
	for _, n := range []float64{0, 64, 1.5} {
		c, _ := finiteRecastInput(2, 0)
		c.SharedProviders[0].Processes[0].Steps[1].MaximumRecastCount = timedShieldExpr(n)
		if compilebundle.CompileGeneric(c).OK {
			t.Fatalf("quota %v accepted", n)
		}
	}
	c, _ := finiteRecastInput(2, 0)
	c.SharedProviders[0].Processes[0].Steps[1].IntervalMs = &model.GenericFormulaExpr{Op: "read", Path: "source.attr.hp.current"}
	if compilebundle.CompileGeneric(c).OK {
		t.Fatal("dynamic interval accepted")
	}
}

func TestFiniteRecastOriginalDeadlineAndTerminalDeath(t *testing.T) {
	c, r := finiteRecastInput(2, 1000, 1000, 15000)
	r.StopPolicy.DurationMs = 16000
	d := timedShieldMustRun(t, c, r)
	p := d.FinalSnapshot.ProcessInstances[0]
	if p.Status != "failed" || *p.FailureReason != "EVENT_ABORTED" || *p.FinishedAtMs != 15000 || p.StepExecutionIndex != 1 || d.Summary.SourceDamageDealt != 200 || *d.SkillActionRecords[2].Reason != "process_already_finished" || d.Summary.SkillUses.CompletedCount != 0 {
		t.Fatal(d.Summary, p, d.SkillActionRecords)
	}
	for _, hp := range []float64{50, 150} {
		c, r = finiteRecastInput(2, 1000, 1000, 2000)
		slot := c.Combatants[1].Attributes["hp"]
		slot.Current = hp
		c.Combatants[1].Attributes["hp"] = slot
		r.InitialSnapshot.Combatants[1].Attributes["hp"] = slot
		d = timedShieldMustRun(t, c, r)
		p = d.FinalSnapshot.ProcessInstances[0]
		if p.Status != "active" || p.FinishedAtMs != nil || p.FailureReason != nil || d.Summary.SkillUses.CompletedCount != 0 || d.Summary.SkillUses.FailedCount != 0 || d.Summary.SkillUses.InFlightCount != 1 || len(d.DamageRecords) != int(hp/100)+1 {
			t.Fatal(hp, d.Summary, p)
		}
	}
}

func TestFiniteRecastAutomaticWindowSummaryAndRepeatedSession(t *testing.T) {
	c, r := finiteRecastInput(2, 1000)
	recastCounters(&c, &r, false)
	finiteRecastAutomatic(&r, c.Rules.SkillActionBindings[0])
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result)
	}
	r.ExpectedRulesHash = compiled.Session.RulesHash
	d, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if d.AutomaticSkillSummary.AttemptCount != 1 || d.AutomaticSkillSummary.StartedCount != 1 || d.AutomaticSkillSummary.CompletedCount != 1 || d.Summary.SkillUses.HitCount != 3 || d.Summary.SourceDamageDealt != 300 {
		t.Fatal(d.AutomaticSkillSummary, d.Summary)
	}
	for _, key := range []string{"casts", "once"} {
		if recastCounter(t, d, key) != 3 {
			t.Fatal(key, d.FinalSnapshot)
		}
	}
	for i, row := range d.DamageRecords {
		shot := i / 2
		want := "auto_repeat_1"
		if shot > 0 {
			want += fmt.Sprintf(":recast:%d", shot)
		}
		if row["timeMs"] != int64(shot*1000) || row["instructionKey"] != want {
			t.Fatal(d.DamageRecords)
		}
	}
	replayed, err := RunGeneric(compiled.Session, r)
	if err != nil || !reflect.DeepEqual(d, replayed) {
		t.Fatal("replay", err)
	}
	zero := 0
	r.RecordBudget = &model.RecordBudget{MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxDamageRecords: &zero, MaxAutomaticSkillRecords: &zero}
	r.Sampling = model.SamplingConfig{Disabled: true}
	limited, err := RunGeneric(compiled.Session, r)
	if err != nil || !reflect.DeepEqual(d.FinalSnapshot, limited.FinalSnapshot) || !reflect.DeepEqual(d.Summary.SkillUses, limited.Summary.SkillUses) || limited.Summary.SourceDamageDealt != 300 {
		t.Fatal("zero budget", err)
	}
}

// The public planned-source admission currently excludes perCastThrottleMs.
// This is an internal execution-frame test, not evidence of public admission.
func TestFiniteRecastFrameDamageThrottleUsesEachActualCastIdentity(t *testing.T) {
	c, r := finiteRecastInput(2, 1000, 1000, 2000)
	recastCounters(&c, &r, true)
	s := frameCommitState(t, c, r)
	// Isolate the already-existing throttle dispatcher after public source
	// admission; no request with this nonzero metadata is claimed supported.
	for i := range s.compiled.Listeners {
		if s.compiled.Listeners[i].ListenerKey == "per_cast" {
			s.compiled.Listeners[i].PerCastThrottleMs = 60000
		}
	}
	for i, at := range []int64{0, 1000, 2000} {
		s.nowMs = at
		if err := s.handleSkillAction(i); err != nil {
			t.Fatal(err)
		}
	}
	if got := recastCounter(t, s.buildDoneResult(), "throttle"); got != 3 {
		t.Fatalf("actual damage listener throttle=%v want3", got)
	}
	if ready := s.combatants["source"].cooldowns.readyAt(genericAbilityCooldownIdentity("source", "source.provider[caster].ability[initial]")); ready != 100000 {
		t.Fatalf("initial cooldown restarted: %v", ready)
	}
}

func TestFiniteRecastManualOccupiedMissAndZeroDamage(t *testing.T) {
	c, r := continuousAttackInput(1, 100000, 10, 0, 0, 3000)
	addMixedSpell(&c, &r, "repeat", 0, 1, false)
	finiteRecastShape(&c, &r, 1, 0, 2, 1000)
	addMixedSpell(&c, &r, "busy", 900, 400, true)
	appendRecast(&c, &r, 0, "blocked", 1000, 1)
	appendRecast(&c, &r, 0, "accepted_one", 1300, 1)
	appendRecast(&c, &r, 0, "accepted_two", 2300, 1)
	d := timedShieldMustRun(t, c, r)
	rejected := false
	for _, row := range d.SkillActionRecords {
		if row.InstructionKey == "blocked" {
			rejected = row.Reason != nil && *row.Reason == "action_occupied"
		}
	}
	if !rejected || d.Summary.BasicAttack.HitCount == 0 {
		t.Fatal(d.SkillActionRecords, d.Summary)
	}
	for _, miss := range []bool{false, true} {
		c, r = finiteRecastInput(2, 1000, 1000, 2000)
		if miss {
			r.DriverPlan.SkillActions[0].HitBindings[0].Preset = "MISS"
		} else {
			c.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(0)
		}
		d = timedShieldMustRun(t, c, r)
		want := 0.0
		if miss {
			want = 200
		}
		if d.Summary.SourceDamageDealt != want || d.Summary.SkillActions.AcceptedCount != 3 || d.FinalSnapshot.ProcessInstances[0].StepExecutionIndex != 2 || d.FinalSnapshot.ProcessInstances[0].Status != "complete" {
			t.Fatal(miss, d.Summary)
		}
	}
}

func TestFiniteRecastAutomaticQualificationsOnlyFollowWindowCompletion(t *testing.T) {
	c, r := finiteRecastInput(2, 1000)
	addMixedSpell(&c, &r, "before", 0, 1, false)
	addMixedSpell(&c, &r, "after", 0, 1, false)
	for i := 1; i < 3; i++ {
		c.SharedProviders[i].Processes[0].Cooldown.DurationMs = *timedShieldExpr(100000)
		c.SharedProviders[i].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].DamageType = "damage/physical"
	}
	for i := range c.Combatants {
		hp := c.Combatants[i].Attributes["hp"]
		hp.Current = 10000
		hp.Max = 10000
		hp.Resolved = 10000
		hp.Base = 10000
		c.Combatants[i].Attributes["hp"] = hp
		r.InitialSnapshot.Combatants[i].Attributes["hp"] = hp
	}
	pre, main := "before", "repeat"
	r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{
		{RuleKey: "before", BindingKey: c.Rules.SkillActionBindings[1].BindingKey, Target: "target", SortOrder: 0, WaitForCooldowns: []string{}, HitBindings: r.DriverPlan.SkillActions[1].HitBindings},
		{RuleKey: "repeat", BindingKey: c.Rules.SkillActionBindings[0].BindingKey, Target: "target", SortOrder: 1, WaitForCooldowns: []string{}, HitBindings: r.DriverPlan.SkillActions[0].HitBindings, ReleaseAfterRuleKey: &pre},
		{RuleKey: "after", BindingKey: c.Rules.SkillActionBindings[2].BindingKey, Target: "target", SortOrder: 2, WaitForCooldowns: []string{}, HitBindings: r.DriverPlan.SkillActions[2].HitBindings, ReleaseAfterRuleKey: &main},
	}}
	r.DriverPlan.SkillActions = nil
	d := timedShieldMustRun(t, c, r)
	if d.AutomaticSkillSummary.StartedCount != 3 || d.AutomaticSkillSummary.CompletedCount != 3 {
		t.Fatal(d.AutomaticSkillSummary)
	}
	for _, q := range d.AutomaticSkillSummary.Qualifications {
		if q.GrantedCount != 1 || q.ConsumedCount != 1 || q.RemainingCount != 0 || q.LastGrantUseRef == nil || strings.HasPrefix(*q.LastGrantUseRef, "recast:") || q.LastConsumeUseRef == nil || strings.HasPrefix(*q.LastConsumeUseRef, "recast:") {
			t.Fatal(q)
		}
	}
	// A real independently started process occupies the actor past the R
	// deadline, so an unfinished R window cannot grant a successor token.
	r.DriverPlan.SkillActions = []model.SkillActionPlan{}
	addMixedSpell(&c, &r, "blocker", 0, 10, false)
	c.SharedProviders[3].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].DamageType = "damage/physical"
	blocker := &c.SharedProviders[3].Processes[0]
	blocker.Cooldown.DurationMs = *timedShieldExpr(100000)
	blocker.Steps = append(blocker.Steps, model.ProcessStepDefinition{StepKey: "blocked_until_end", StepType: "DELAY", DelayMs: timedShieldExpr(20000), OccupiesAction: model.BoolPtr(true)})
	r.DriverPlan.AutomaticSkills.Rules = append(r.DriverPlan.AutomaticSkills.Rules, model.AutomaticSkillRule{RuleKey: "blocker", BindingKey: c.Rules.SkillActionBindings[3].BindingKey, Target: "target", SortOrder: 3, WaitForCooldowns: []string{}, HitBindings: r.DriverPlan.SkillActions[0].HitBindings})
	r.DriverPlan.SkillActions = nil
	r.StopPolicy.DurationMs = 16000
	d = timedShieldMustRun(t, c, r)
	if d.AutomaticSkillSummary.CompletedCount != 1 || d.AutomaticSkillSummary.FailedCount != 1 {
		t.Fatal(d.AutomaticSkillSummary)
	}
	for _, q := range d.AutomaticSkillSummary.Qualifications {
		if q.GrantorRuleKey == "repeat" && q.GrantedCount != 0 {
			t.Fatal(q)
		}
	}
}

func TestFiniteRecastAutomaticBusyWithRealBackgroundAttack(t *testing.T) {
	c, r := continuousAttackInput(1, 100000, 10, 0, 0, 3000)
	addMixedSpell(&c, &r, "repeat", 0, 1, false)
	finiteRecastShape(&c, &r, 1, 0, 2, 1000)
	addMixedSpell(&c, &r, "busy", 0, 900, false)
	busy := &c.SharedProviders[2].Processes[0]
	busy.Cooldown.DurationMs = *timedShieldExpr(100000)
	busy.Steps = append(busy.Steps, model.ProcessStepDefinition{StepKey: "busy_tail", StepType: "DELAY", DelayMs: timedShieldExpr(400), OccupiesAction: model.BoolPtr(true)})
	rules := []model.AutomaticSkillRule{}
	for i, b := range c.Rules.SkillActionBindings {
		rules = append(rules, model.AutomaticSkillRule{RuleKey: b.SkillKey, BindingKey: b.BindingKey, SortOrder: i, Target: "target", HitBindings: r.DriverPlan.SkillActions[i].HitBindings, WaitForCooldowns: []string{}})
	}
	r.DriverPlan.SkillActions = nil
	r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: rules}
	d := timedShieldMustRun(t, c, r)
	times := []int64{}
	for _, row := range d.DamageRecords {
		if strings.Contains(row["abilityRef"].(string), "provider[repeat]") {
			times = append(times, row["timeMs"].(int64))
		}
	}
	if !reflect.DeepEqual(times, []int64{0, 1300, 2300}) || d.Summary.BasicAttack == nil || d.Summary.BasicAttack.HitCount == 0 || d.AutomaticSkillSummary.Rules[0].AttemptCount != 1 {
		t.Fatal(times, d.Summary, d.AutomaticSkillSummary)
	}
}

func TestFiniteRecastQueuePreflightRetainsOriginalControlState(t *testing.T) {
	c, r := finiteRecastInput(2, 1000, 1000, 2000)
	s := frameCommitState(t, c, r)
	s.nowMs = 0
	if err := s.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	p := s.processInstances[0]
	before := p.ProcessInstanceSnapshot
	s.heap = scheduler.NewGenericHeap(1)
	s.heap.SetLimit(1)
	s.heap.Push(scheduler.GenericEvent{TimeMs: 15000})
	s.nowMs = 1000
	err := s.handleSkillAction(1)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || !reflect.DeepEqual(before, p.ProcessInstanceSnapshot) || s.skillUses["recast:skill:cast_once:1"] != nil {
		t.Fatal(err, p)
	}
}

// External facts may still drive the older process contract, but cannot create
// the new finite graph's authoritative planned window or per-cast identities.
func TestFiniteRecastRejectsExternalDriverAuthority(t *testing.T) {
	for _, quota := range []int{1, 2} {
		for _, keepBinding := range []bool{false, true} {
			for _, use := range []string{"external", "skill:external"} {
				t.Run(fmt.Sprintf("quota%d/binding%t/%s", quota, keepBinding, use), func(t *testing.T) {
					c, r := finiteRecastInput(quota, 1000)
					binding := c.Rules.SkillActionBindings[0]
					r.DriverPlan.SkillActions = nil
					r.SkillUses = []model.SkillUseFact{{UseKey: use, Source: "source", SkillKey: binding.SkillKey, HistoryState: "complete"}}
					for i := 0; i <= quota; i++ {
						control := binding.Controls[0]
						if i > 0 {
							control = binding.Controls[1]
						}
						key := fmt.Sprintf("external_%d", i)
						r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: key, AbilityRef: control.AbilityRef, Source: "source", Target: "target", FirstAtMs: int64(i * 1000)})
						r.ProcessCommandFacts = append(r.ProcessCommandFacts, model.ProcessCommandFact{DriverEntryKey: key, UseRef: use})
					}
					if !keepBinding {
						c.Rules.SkillActionBindings = nil
					}
					compiled := compilebundle.CompileGeneric(c)
					if !compiled.OK {
						t.Fatalf("the independently valid finite definition must compile: %+v", compiled.Result)
					}
					r.ExpectedRulesHash = compiled.Session.RulesHash
					done, err := RunGeneric(compiled.Session, r)
					if err == nil {
						t.Fatalf("external facts created finite recast authority: casts=%d processes=%+v", done.Summary.AbilityCastCount, done.FinalSnapshot.ProcessInstances)
					}
					if !strings.Contains(err.Message, "current bound INITIAL skill plan") {
						t.Fatalf("unrelated rejection hid the entry gate: %+v", err)
					}
				})
			}
		}
	}
}
