package execution

import (
	fmt "fmt"
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
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
		s.loop.Advance(at)
		if err := s.handleSkillAction(i); err != nil {
			t.Fatal(err)
		}
	}
	if got := recastCounter(t, s.buildDoneResult(false), "throttle"); got != 3 {
		t.Fatalf("actual damage listener throttle=%v want3", got)
	}
	if ready := s.combatants["source"].cooldowns.ReadyAt(actionpkg.AbilityCooldownIdentity("source", "source.provider[caster].ability[initial]")); ready != 100000 {
		t.Fatalf("initial cooldown restarted: %v", ready)
	}
}

func TestFiniteRecastQueuePreflightRetainsOriginalControlState(t *testing.T) {
	c, r := finiteRecastInput(2, 1000, 1000, 2000)
	s := frameCommitState(t, c, r)
	s.loop.Advance(0)
	if err := s.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	p := s.actions.ProcessAt(0)
	before := p.Snapshot()
	clearQueuedEventsForTest(s.loop)
	s.loop.SetQueueLimit(1)
	s.loop.Enqueue(scheduler.GenericEvent{TimeMs: 15000})
	s.loop.Advance(1000)
	err := s.handleSkillAction(1)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || !reflect.DeepEqual(before, p.Snapshot()) || s.skillUses["recast:skill:cast_once:1"] != nil {
		t.Fatal(err, p)
	}
}
