package runtime

import (
	"encoding/json"
	"reflect"
	"testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func singleSkillInput(healing bool) (model.CompileRequest, model.RunRequest) {
	occupies := false
	hp := model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000}
	zero := model.AttributeSlotDef{}
	actors := []model.CombatantDefinition{{Key: "source", Attributes: map[string]model.AttributeSlotDef{"hp": hp, "armor": zero}, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{{ProviderRef: "caster", DefinitionRef: "skill_source"}}}, {Key: "target", Attributes: map[string]model.AttributeSlotDef{"hp": hp, "armor": zero}, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{}}}
	initialRef := "source.provider[caster].ability[initial]"
	hitRef := "source.provider[caster].ability[hit]"
	process := model.ProcessDefinition{ProcessKey: "cast", SkillKey: "configured_spell", Steps: []model.ProcessStepDefinition{{StepKey: "delay", StepType: "DELAY", OccupiesAction: &occupies, DelayMs: timedShieldExpr(250)}}, Costs: []model.ProcessCostDefinition{}, Cooldown: &model.ProcessCooldownDefinition{DurationMs: *timedShieldExpr(1000), StartMoment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}}, MomentOperations: []model.ProcessMomentOperations{}}
	provider := model.ProviderDefinition{ProviderKey: "skill_source", Kind: "character", StableID: "configured_spell", Processes: []model.ProcessDefinition{process}, Abilities: []model.AbilityDefinition{{AbilityKey: "initial", Kind: "active", SkillKey: "configured_spell", Types: []string{"ability/spell"}, ProcessControl: &model.ProcessControlDefinition{Action: "INITIAL", ProcessKey: "cast"}}}}
	binding := model.SkillActionBinding{BindingKey: "bound_spell", Source: "source", ProviderRef: "caster", ProviderDefinitionRef: "skill_source", SkillKey: "configured_spell", Controls: []model.SkillActionControl{{Action: "INITIAL", ProcessKey: "cast", AbilityRef: initialRef}}, HitBindings: []model.SkillActionHitBinding{}}
	plan := model.SkillActionPlan{InstructionKey: "cast_once", FirstAtMs: 100, SortOrder: 0, Source: "source", Target: "target", SkillKey: "configured_spell", BindingKey: "bound_spell", Action: "INITIAL", AbilityRef: initialRef, HitBindings: []model.SkillActionHitPreset{}}
	if healing {
		plan.Target = "source"
		threshold := model.GenericFormulaExpr{Op: "lt", Args: []model.GenericFormulaExpr{{Op: "read", Path: "source.attr.hp.current"}, *timedShieldExpr(400)}}
		normal := model.GenericFormulaExpr{Op: "gte", Args: threshold.Args}
		provider.Listeners = []model.ListenerDefinition{{ListenerKey: "low_heal", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}, Condition: &threshold, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(150), Ref: "low"}}}, {ListenerKey: "normal_heal", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}, Condition: &normal, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(100), Ref: "normal"}}}}
	} else {
		candidate := model.SkillHitCandidate{CandidateKey: "primary", EffectOccurrenceKey: "primary", EffectKey: "primary", ResultKey: "damage", Semantic: model.SkillHitSemantic{ResultType: model.SkillHitResultDamage, Target: "TARGET", Moment: "INSTANT"}, SpellShieldBlockScope: nil, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: timedShieldExpr(100), DamageType: "damage/physical", Ref: "primary_damage"}}}
		hit := model.SkillHitDefinition{SkillKey: "configured_spell", Candidates: []model.SkillHitCandidate{candidate}}
		provider.Abilities = append(provider.Abilities, model.AbilityDefinition{AbilityKey: "hit", Kind: "active", SkillKey: "configured_spell", Types: []string{"ability/spell"}, Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &hit}}})
		binding.HitBindings = []model.SkillActionHitBinding{{HitBindingKey: "primary_hit", ProcessKey: "cast", Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, HitAbilityRef: hitRef}}
		plan.HitBindings = []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "TARGET_HIT"}}
	}
	request := model.CompileRequest{SchemaVersion: "generic-p0", SchemaHash: "single_skill_schema", RulesHash: "single_skill_rules", TypeCatalog: model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "ability/spell", Domain: "ability"}, {Key: "event/ability_started", Domain: "event"}, {Key: "event/skill_hit", Domain: "event"}, {Key: "damage/physical", Domain: "damage"}}, Relations: []model.TypeRelation{}}, Combatants: actors, SharedProviders: []model.ProviderDefinition{provider}, Rules: model.RulesContainer{SkillActionBindings: []model.SkillActionBinding{binding}}}
	snapshot := model.Snapshot{SchemaHash: request.SchemaHash, RulesHash: request.RulesHash, Combatants: []model.CombatantSnapshot{}}
	for _, actor := range actors {
		providers := []model.CombatantProviderSnapshot{}
		for _, mount := range actor.Providers {
			providers = append(providers, model.CombatantProviderSnapshot{ProviderRef: mount.ProviderRef, DefinitionRef: mount.DefinitionRef, Source: actor.Key, Owner: actor.Key, Stacks: 1})
		}
		snapshot.Combatants = append(snapshot.Combatants, model.CombatantSnapshot{Key: actor.Key, Attributes: actor.Attributes, Resources: actor.Resources, Providers: providers})
	}
	return request, model.RunRequest{InitialSnapshot: snapshot, DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{}, SkillActions: []model.SkillActionPlan{plan}}, StopPolicy: model.StopPolicy{DurationMs: 1000}}
}

func TestSingleSkillReleasedHitAndObservationBoundary(test *testing.T) {
	for _, window := range []int64{349, 350, 1000} {
		request, run := singleSkillInput(false)
		run.StopPolicy.DurationMs = window
		done := timedShieldMustRun(test, request, run)
		if done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillUses.StartedCount != 1 || done.Summary.BasicAttack != nil || !done.Summary.Execution.Complete || done.Summary.DurationMs != window {
			test.Fatalf("summary: %+v", done.Summary)
		}
		if window < 350 {
			if done.Summary.SourceDamageDealt != 0 || done.Summary.SkillUses.InFlightCount != 1 || done.Summary.SkillUses.HitCount != 0 {
				test.Fatal(done.Summary)
			}
		} else {
			if done.Summary.SourceDamageDealt != 100 || done.Summary.SkillUses.HitCount != 1 || done.Summary.SkillUses.ReleasedCount != 1 || done.Summary.SkillUses.CompletedCount != 1 || done.Summary.AbilityCastCount != 1 {
				test.Fatal(done.Summary)
			}
			if len(done.DamageRecords) != 1 || done.DamageRecords[0]["attackIndex"] != nil || done.DamageRecords[0]["hitRef"] != "hit:1" || done.DamageRecords[0]["useRef"] != "skill:cast_once" || done.DamageRecords[0]["instructionKey"] != "cast_once" || done.DamageRecords[0]["timeMs"] != int64(350) {
				test.Fatal(done.DamageRecords)
			}
		}
	}
}

func TestSingleSkillMissAndFrozenDirectHealing(test *testing.T) {
	request, run := singleSkillInput(false)
	run.DriverPlan.SkillActions[0].HitBindings[0].Preset = "MISS"
	done := timedShieldMustRun(test, request, run)
	if done.Summary.SkillUses.HitCount != 0 || done.Summary.SkillUses.ReleasedCount != 1 || done.Summary.SourceDamageDealt != 0 {
		test.Fatal(done.Summary)
	}
	for _, current := range []float64{399, 400, 500, 990} {
		request, run = singleSkillInput(true)
		hp := request.Combatants[0].Attributes["hp"]
		hp.Current = current
		request.Combatants[0].Attributes["hp"] = hp
		done = timedShieldMustRun(test, request, run)
		want := 100.0
		if current < 400 {
			want = 150
		}
		if current == 990 {
			want = 10
		}
		if *done.Summary.SourceDirectHealing != want || *done.Summary.SourceVampHealing != 0 || done.Summary.SourceFinalHp != current+want || len(done.HealingRecords) != 1 || done.HealingRecords[0].OperationRef == "" || done.HealingRecords[0].TimeMs != 100 || done.HealingRecords[0].UseRef == nil || *done.HealingRecords[0].UseRef != "skill:cast_once" || done.Summary.SkillUses.HitCount != 0 {
			test.Fatalf("hp=%v summary=%+v healing=%+v", current, done.Summary, done.HealingRecords)
		}
	}
}

func TestSingleSkillKnownRejectionAndUnreachedDeath(test *testing.T) {
	request, run := singleSkillInput(false)
	request.Combatants[0].Resources["charges"] = model.ResourceSlotDef{Current: 0, Max: 3}
	request.SharedProviders[0].Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "charges", Amount: *timedShieldExpr(1)}}
	done := timedShieldMustRun(test, request, run)
	if done.Summary.SkillActions.RejectedCount != 1 || done.Summary.SkillUses.StartedCount != 0 || done.SkillActionRecords[0].UseRef != nil || len(done.FinalSnapshot.ProcessInstances) != 0 || done.Summary.SourceDamageDealt != 0 {
		test.Fatal(done)
	}
	request, run = singleSkillInput(false)
	hp := request.Combatants[0].Attributes["hp"]
	hp.Current = 0
	request.Combatants[0].Attributes["hp"] = hp
	done = timedShieldMustRun(test, request, run)
	if done.Summary.SkillActions.UnreachedCount != 1 || done.Summary.SkillActions.ReachedCount != 0 || done.Summary.SkillUses.StartedCount != 0 || len(done.SkillActionRecords) != 0 {
		test.Fatal(done)
	}
}

func TestSingleSkillBudgetBeforeAndAfterAccepted(test *testing.T) {
	for _, after := range []bool{false, true} {
		request, run := singleSkillInput(true)
		if !after {
			request.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(1)}, {Operation: "heal", Target: "self", Amount: timedShieldExpr(1)}}}}
		} else {
			request.SharedProviders[0].Listeners[1].Operations = append(request.SharedProviders[0].Listeners[1].Operations, model.OperationDefinition{Operation: "heal", Target: "self", Amount: timedShieldExpr(1)})
		}
		run.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
		done := timedShieldMustRun(test, request, run)
		if done.Summary.Execution.Complete || done.Summary.Execution.BudgetCause == nil || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || done.Summary.SourceFinalHp != 500 || len(done.HealingRecords) != 0 {
			test.Fatal(done)
		}
		if after {
			if done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillUses.StartedCount != 1 || len(done.FinalSnapshot.ProcessInstances) != 1 {
				test.Fatal(done)
			}
		} else {
			if done.Summary.SkillActions.AbortedBeforeAcceptCount != 1 || done.Summary.SkillUses.StartedCount != 0 || len(done.FinalSnapshot.ProcessInstances) != 0 || done.SkillActionRecords[0].UseRef != nil {
				test.Fatal(done)
			}
		}
	}
}

func TestSingleSkillIndependentRetentionAndStableRepeatedRun(test *testing.T) {
	request, run := singleSkillInput(true)
	expected := timedShieldMustRun(test, request, run)
	zero := 0
	run.RecordBudget = &model.RecordBudget{MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxHealingRecords: &zero, MaxDamageRecords: &zero}
	run.Sampling.Disabled = true
	done := timedShieldMustRun(test, request, run)
	if !reflect.DeepEqual(expected.Summary.SkillActions, done.Summary.SkillActions) || !reflect.DeepEqual(expected.Summary.SkillUses, done.Summary.SkillUses) || *done.Summary.SourceDirectHealing != 100 || len(done.SkillActionRecords)+len(done.SkillUseRecords)+len(done.HealingRecords) != 0 || !done.Recording.HealingRecordsTruncated || !done.Recording.SkillUseRecordsTruncated {
		test.Fatal(done)
	}
	compiled := compilebundle.CompileGeneric(request)
	for iteration := 0; iteration < 100; iteration++ {
		repeat, err := RunGeneric(compiled.Session, run)
		if err != nil || !reflect.DeepEqual(done, repeat) {
			test.Fatalf("iteration %d error=%+v", iteration, err)
		}
	}
}

func TestSingleSkillImmutableReferenceAndPhaseAdmission(test *testing.T) {
	for _, mutate := range []func(*model.RunRequest){func(run *model.RunRequest) { run.DriverPlan.SkillActions[0].Action = "RECAST" }, func(run *model.RunRequest) { run.DriverPlan.SkillActions[0].HitBindings[0].HitBindingKey = "forged" }, func(run *model.RunRequest) {
		run.DriverPlan.SkillActions[0].AbilityRef = "target.provider[caster].ability[initial]"
	}, func(run *model.RunRequest) {
		run.DriverPlan.SkillActions = append(run.DriverPlan.SkillActions, run.DriverPlan.SkillActions[0])
	}} {
		request, run := singleSkillInput(false)
		mutate(&run)
		_, err := RunGeneric(compilebundle.CompileGeneric(request).Session, run)
		if err == nil {
			test.Fatal("invalid plan was admitted")
		}
	}
	var preset model.SkillActionHitPreset
	if json.Unmarshal([]byte(`{"hitBindingKey":"primary_hit","preset":"TARGET_HIT","hitAbilityRef":"forged"}`), &preset) == nil {
		test.Fatal("run hit binding may not override compiled reference")
	}
	request, _ := singleSkillInput(false)
	request.Rules.SkillActionBindings[0].HitBindings[0].Moment.MomentType = "PROCESS_START"
	if compilebundle.CompileGeneric(request).OK {
		test.Fatal("unapproved early release compiled")
	}
}

func TestSingleSkillCooldownGateDoesNotPublishRejectedUse(test *testing.T) {
	for _, now := range []int64{999, 1000} {
		request, run := singleSkillInput(false)
		compiled := compilebundle.CompileGeneric(request)
		state, err := newGenericRunState(compiled.Session, run)
		if err != nil {
			test.Fatal(err)
		}
		state.nowMs = now
		state.combatants["source"].cooldowns[run.DriverPlan.SkillActions[0].AbilityRef] = 1000
		if err := state.handleSkillAction(0); err != nil {
			test.Fatal(err)
		}
		if now < 1000 {
			if state.skillActions[0].summary.RejectedCount != 1 || state.skillActions[0].uses.StartedCount != 0 || len(state.skillUses) != 0 || len(state.processInstances) != 0 || state.skillActionRecords[0].UseRef != nil || *state.skillActionRecords[0].Reason != "cooldown_not_ready" {
				test.Fatal(state.skillActionRecords)
			}
		} else if state.skillActions[0].summary.AcceptedCount != 1 || state.skillActions[0].uses.StartedCount != 1 {
			test.Fatal(state.skillActions[0].summary)
		}
	}
}

func TestSingleSkillReleasedHitUsesRealSpellShield(test *testing.T) {
	request, run := singleSkillInput(false)
	request.TypeCatalog.Types = append(request.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.ProviderTypeSpellShield, Domain: "provider"}, model.TypeCatalogEntry{Key: model.EventTypeSpellShieldBlocked, Domain: "event"})
	scope := model.SpellShieldScopeSkill
	candidate := &request.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0]
	candidate.SpellShieldBlockScope = &scope
	candidate.EventValueConditions = []model.SkillHitEventValueCondition{{Key: "blocked", Comparator: "eq", Value: *timedShieldExpr(0)}}
	request.SharedProviders = append(request.SharedProviders, model.ProviderDefinition{ProviderKey: "spell_shield", Kind: "status", StableID: "shield", Types: []string{model.ProviderTypeSpellShield}, Listeners: []model.ListenerDefinition{{ListenerKey: "blocked_heal", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSpellShieldBlocked}}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(40)}, {Operation: "expire_provider", Target: "self", ProviderRefFromEvent: true}}}}})
	request.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "blocking", DefinitionRef: "spell_shield"}}
	run.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "blocking", DefinitionRef: "spell_shield", Source: "target", Owner: "target", Stacks: 1}}
	done := timedShieldMustRun(test, request, run)
	if done.Summary.SkillUses.HitCount != 1 || done.Summary.SourceDamageDealt != 0 || done.Summary.TargetFinalHp != 540 || *done.Summary.TargetDirectHealing != 40 || len(done.HealingRecords) != 1 || done.HealingRecords[0].Target != "target" {
		test.Fatal(done.Summary)
	}
}

func TestSingleSkillCommittedTargetKillKeepsRealTime(test *testing.T) {
	request, run := singleSkillInput(false)
	hp := request.Combatants[1].Attributes["hp"]
	hp.Current = 90
	request.Combatants[1].Attributes["hp"] = hp
	done := timedShieldMustRun(test, request, run)
	if !done.Summary.Execution.Complete || !done.Summary.Execution.TargetKilled || done.Summary.Execution.TargetKilledAtMs == nil || *done.Summary.Execution.TargetKilledAtMs != 350 || done.Summary.DurationMs != 350 || done.Summary.TargetHpLoss != 90 || done.Summary.SkillUses.HitCount != 1 || done.Summary.SkillUses.CompletedCount != 1 {
		test.Fatal(done.Summary)
	}
}

func TestSingleSkillStartDeathCannotTriggerPostDeathHealing(test *testing.T) {
	request, run := singleSkillInput(true)
	request.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Amount: timedShieldExpr(500), DamageType: "damage/physical"}}}}
	done := timedShieldMustRun(test, request, run)
	if done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillUses.StartedCount != 1 || done.Summary.SkillUses.FailedCount != 1 || done.Summary.SkillUses.ReleasedCount != 0 || done.Summary.SourceFinalHp != 0 || *done.Summary.SourceDirectHealing != 0 || len(done.HealingRecords) != 0 {
		test.Fatal(done.Summary)
	}
}

func TestSingleSkillReleaseFormulaFailureIsNotMiss(test *testing.T) {
	request, run := singleSkillInput(false)
	request.SharedProviders[0].Abilities[1].CastCondition = &model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{{Op: "read", Path: "source.attr.hp.current"}, *timedShieldExpr(0)}}
	compiled := compilebundle.CompileGeneric(request)
	if !compiled.OK {
		test.Fatal(compiled.Result.Errors)
	}
	_, err := RunGeneric(compiled.Session, run)
	if err == nil || err.Code != model.GenericErrFormulaTypeError {
		test.Fatalf("failure was hidden: %+v", err)
	}
}

func TestSingleSkillUnconditionalListenerMissingNumericFailsClosed(test *testing.T) {
	request, run := singleSkillInput(true)
	request.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "required_heal", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: &model.GenericFormulaExpr{Op: "read", Path: "source.attr.not_supplied.resolved"}}}}}
	compiled := compilebundle.CompileGeneric(request)
	if !compiled.OK {
		test.Fatal(compiled.Result.Errors)
	}
	_, err := RunGeneric(compiled.Session, run)
	if err == nil {
		test.Fatal("missing numeric was silently replaced with zero")
	}
}
