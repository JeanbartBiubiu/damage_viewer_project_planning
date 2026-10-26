package execution

import (
	math "math"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	scheduler "tinygo_engine_v2/internal/scheduler"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func frameCommitInput(ops ...model.OperationDefinition) (model.CompileRequest, model.RunRequest) {
	c, r := authoringInput()
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "damage/physical", Formula: formuladefinition.ConstantDefense("1")}}
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "damage/physical", Domain: "damage"})
	c.SharedProviders[0].Processes = nil
	c.SharedProviders[0].Listeners = nil
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{{AbilityKey: "atomic", Kind: "active", Operations: ops}}
	c.Combatants[1].Attributes["armor"] = authoringSlot(0)
	r.InitialSnapshot.Combatants[1].Attributes["armor"] = authoringSlot(0)
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "atomic", AbilityRef: authoringRef("atomic"), Source: "source", Target: "target"}}
	r.SkillUses, r.SkillHitFacts, r.AttackStartFacts = nil, nil, nil
	return c, r
}

func frameCommitDamage(amount float64) model.OperationDefinition {
	return model.OperationDefinition{Operation: "damage", Target: "target", Ref: "damage", DamageType: "damage/physical", Amount: authoringAmount(authoringConst(amount))}
}

func frameCommitState(t *testing.T, c model.CompileRequest, r model.RunRequest) *Engine {
	t.Helper()
	compiled := compilebundle.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("compile: %+v", compiled.Result.Errors)
	}
	r.ExpectedRulesHash = compiled.Session.RulesHash
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatalf("init: %+v", err)
	}
	return s
}

func frameCommitFrame(s *Engine) (*Frame, planbundle.CompiledAbility, []planbundle.CompiledOperation) {
	entry := s.req.DriverPlan.Entries[0]
	ability, ref, _ := s.lookupDriverAbility(entry)
	f := s.newExecutionFrame("source", "target", ref)
	f.ownerCombatantKey = "source"
	f.ownerProviderRef = "attack"
	start := int(ability.OperationStart)
	return f, ability, s.compiled.Operations[start : start+int(ability.OperationCount)]
}

func TestFrameCommitBudgetDropsDamageHealingShieldHistoryAndEvidence(t *testing.T) {
	c, r := frameCommitInput(frameCommitDamage(100),
		model.OperationDefinition{Operation: "heal", Target: "source", Amount: authoringAmount(authoringConst(100))},
		model.OperationDefinition{Operation: "shield", Target: "source", Amount: authoringAmount(authoringConst(25)), ShieldRef: "staged"},
		frameCommitDamage(100))
	r.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 100, Current: 95, Resolved: 95, Max: 100}
	s := frameCommitState(t, c, r)
	s.actions.SetAttackActive(true)
	s.budget.MaxCommandsPerEvent = 3
	f, ability, ops := frameCommitFrame(s)
	err := f.executeOperations(ability, ops)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("expected command budget: %+v", err)
	}
	f.commit()
	if f.committed || s.combatantHp("target") != 1000 || s.combatantHp("source") != 95 || s.combatants["source"].instances.Shields().Len() != 0 {
		t.Fatalf("uncommitted combat state leaked: source=%+v target=%+v", s.combatants["source"], s.combatants["target"])
	}
	if len(reportedDamageHistory(s)) != 0 || len(s.report.Snapshot().Evidence.Items) != 0 || len(s.report.Snapshot().Evidence.CountsByKind) != 0 || s.report.Totals().SourceDamageDealt != 0 || s.report.Totals().SourceOverheal != 0 || s.nextDamageID != 0 || len(s.report.AbilityStats()) != 0 || s.recordingSummary().DamageRecordCount != 0 || len(s.report.Snapshot().DamageBreakdown) != 0 {
		t.Fatalf("uncommitted records leaked: history=%+v evidence=%+v damage=%v overheal=%v stats=%+v", reportedDamageHistory(s), s.report.Snapshot().Evidence.Items, s.report.Totals().SourceDamageDealt, s.report.Totals().SourceOverheal, s.report.AbilityStats())
	}
	if s.currentEventCommands <= s.budget.MaxCommandsPerEvent {
		t.Fatalf("failed frame refunded budget: %d", s.currentEventCommands)
	}
}

func TestFrameCommitBudgetDropsVampWithItsDamage(t *testing.T) {
	c, r := vampFixture(t)
	op := c.SharedProviders[0].Abilities[0].Operations[0]
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op, op}
	s := frameCommitState(t, c, r)
	s.actions.SetAttackActive(true)
	s.budget.MaxCommandsPerEvent = 1
	beforeSource, beforeTarget := s.combatantHp("source"), s.combatantHp("target")
	beforeShields := s.combatants["target"].instances.Shields().Len()
	f, ability, ops := frameCommitFrame(s)
	err := f.executeOperations(ability, ops)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("expected command budget: %+v", err)
	}
	f.commit()
	if s.combatantHp("source") != beforeSource || s.combatantHp("target") != beforeTarget || s.combatants["target"].instances.Shields().Len() != beforeShields || s.report.Totals().SourceDamageDealt != 0 || s.report.Totals().SourceOverheal != 0 || len(s.report.Snapshot().Evidence.Items) != 0 || len(reportedDamageHistory(s)) != 0 {
		t.Fatalf("damage/vamp leaked: source=%v target=%v damage=%v overheal=%v evidence=%+v", s.combatantHp("source"), s.combatantHp("target"), s.report.Totals().SourceDamageDealt, s.report.Totals().SourceOverheal, s.report.Snapshot().Evidence.Items)
	}
}

func TestFrameCommitSharedBudgetKeepsEarlierFrames(t *testing.T) {
	c, r := frameCommitInput(frameCommitDamage(1))
	s := frameCommitState(t, c, r)
	s.actions.SetAttackActive(true)
	s.budget.MaxCommandsPerEvent = 256
	for _, count := range []int{100, 100, 57} {
		f, ability, ops := frameCommitFrame(s)
		f.copyableCollector = &eventCopyableCollector{}
		batch := make([]planbundle.CompiledOperation, count)
		for i := range batch {
			batch[i] = ops[0]
		}
		err := f.executeOperations(ability, batch)
		if count == 57 {
			if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
				t.Fatalf("third frame obtained a fresh command allowance: %+v", err)
			}
		} else if err != nil {
			t.Fatalf("early frame: %+v", err)
		}
		f.commit()
	}
	if s.report.Totals().SourceDamageDealt != 200 || s.combatantHp("target") != 800 || len(reportedDamageHistory(s)) != 200 || s.nextDamageID != 200 || s.report.Snapshot().Evidence.CountsByKind[string(model.EvidenceKindDamage)] != 200 || s.recordingSummary().DamageRecordCount != 200 || s.report.Totals().TargetHpLoss != 200 {
		t.Fatalf("partial result disagrees with committed frames: damage=%v hp=%v history=%d evidence=%+v", s.report.Totals().SourceDamageDealt, s.combatantHp("target"), len(reportedDamageHistory(s)), s.report.Snapshot().Evidence.CountsByKind)
	}
	acc := reportedAbilityStat(s, authoringRef("atomic"))
	if acc.DamageDealt == nil || *acc.DamageDealt != 200 {
		t.Fatalf("ability totals must survive later failure: %+v", acc)
	}
}

func TestFrameCommitQueueOverflowDropsWholeFrame(t *testing.T) {
	for _, kind := range []string{"shield", "provider"} {
		t.Run(kind, func(t *testing.T) {
			op := model.OperationDefinition{Operation: "shield", Target: "target", Amount: authoringAmount(authoringConst(25)), ShieldRef: "queued", ShieldDurationMs: authoringAmount(authoringConst(100))}
			if kind == "provider" {
				op = model.OperationDefinition{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "queued"}
			}
			c, r := frameCommitInput(frameCommitDamage(100), op)
			if kind == "provider" {
				c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "queued", StableID: "queued", Kind: "status", Lifecycle: &model.ProviderLifecycle{DurationMs: authoringAmount(authoringConst(100))}})
			}
			s := frameCommitState(t, c, r)
			*s.loop.Queue() = scheduler.NewGenericHeap(1)
			s.loop.Queue().SetLimit(1)
			if s.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 1000}) != model.ErrOK {
				t.Fatal("queue setup")
			}
			f, ability, ops := frameCommitFrame(s)
			if err := f.executeOperations(ability, ops); err != nil {
				t.Fatalf("staging: %+v", err)
			}
			f.commit()
			if f.fatalErr == nil || f.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || f.committed {
				t.Fatalf("queue failure: %+v", f.fatalErr)
			}
			if s.combatantHp("target") != 1000 || s.report.Totals().SourceDamageDealt != 0 || len(s.report.Snapshot().Evidence.Items) != 0 || len(reportedDamageHistory(s)) != 0 || s.combatants["target"].instances.Providers().Len() != 0 || s.combatants["target"].instances.Shields().Len() != 0 || s.loop.Queue().Len() != 1 || s.effectTimers.ExpiryCount() != 0 {
				t.Fatalf("queue failure leaked state: target=%+v evidence=%+v queue=%d", s.combatants["target"], s.report.Snapshot().Evidence.Items, s.loop.Queue().Len())
			}
		})
	}
}

func TestFrameCommitProcessStartAndCooldownRollBackTogether(t *testing.T) {
	c, r := processBase(t, "IMMEDIATE")
	p := &c.SharedProviders[0].Processes[0]
	p.Cooldown = &model.ProcessCooldownDefinition{DurationMs: authoringConst(1536.098), RoundPositiveMs: true, StartMoment: processMoment("PROCESS_START", "", "")}
	p.MomentOperations = []model.ProcessMomentOperations{{Moment: processMoment("PROCESS_START", "", ""), Operations: []model.OperationDefinition{frameCommitDamage(100), {Operation: "heal", Target: "source", Amount: authoringAmount(authoringConst(100))}, frameCommitDamage(100)}}}
	s := frameCommitState(t, c, r)
	s.actions.SetAttackActive(true)
	s.budget.MaxCommandsPerEvent = 2
	err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0})
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("process budget error: %+v", err)
	}
	if s.actions.ProcessCount() != 0 || s.combatants["source"].cooldowns.EntryCount() != 0 || s.combatants["source"].resourceView().At("mana").Current != 200 || s.report.Totals().SourceDamageDealt != 0 || len(reportedDamageHistory(s)) != 0 || s.abilityCastCount != 0 {
		t.Fatalf("uncommitted process leaked: instances=%+v source=%+v damage=%v casts=%d", s.actions.ProcessViews(), s.combatants["source"], s.report.Totals().SourceDamageDealt, s.abilityCastCount)
	}
	for _, item := range s.report.Snapshot().Evidence.Items {
		if item.Kind == model.EvidenceKindDamage || item.Kind == model.EvidenceKindHeal || item.Kind == "process_moment" {
			t.Fatalf("uncommitted process evidence leaked: %+v", item)
		}
	}
}

func TestFrameCommitProcessFailureKeepsPreviousStepAndCooldown(t *testing.T) {
	c, r := processBase(t, "RECAST")
	p := &c.SharedProviders[0].Processes[0]
	p.Cooldown = &model.ProcessCooldownDefinition{DurationMs: authoringConst(1000), StartMoment: processMoment("PROCESS_FAILURE", "", "")}
	p.MomentOperations = []model.ProcessMomentOperations{{Moment: processMoment("PROCESS_FAILURE", "", ""), Operations: []model.OperationDefinition{frameCommitDamage(100), frameCommitDamage(100)}}}
	s := frameCommitState(t, c, r)
	if err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0}); err != nil {
		t.Fatalf("start: %+v", err)
	}
	instance := s.actions.ProcessAt(0)
	s.actions.SetAttackActive(true)
	s.budget.MaxCommandsPerEvent = 1
	err := s.finishProcess(instance, "failed", "ACTIVE_CANCELLED")
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || instance.Status() != "active" || instance.FailureReason() != nil || instance.FinishedAtMs() != nil || instance.CooldownStarted() || s.combatants["source"].cooldowns.EntryCount() != 0 || s.report.Totals().SourceDamageDealt != 0 {
		t.Fatalf("failed terminal frame changed its committed instance: err=%+v instance=%+v source=%+v", err, instance, s.combatants["source"])
	}
}

func TestFrameCommitProcessCooldownRuntimeBoundary(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value float64
		round bool
		now   int64
		want  int64
		fail  bool
	}{
		{"positive fraction", 1536.098, true, 0, 1536, false},
		{"positive tiny", .001, true, 0, 1, false},
		{"strict zero", 0, false, 0, 0, false},
		{"positive zero", 0, true, 0, 0, true},
		{"negative", -1, true, 0, 0, true},
		{"strict fraction", 1.5, false, 0, 0, true},
		{"not finite", math.Inf(1), true, 0, 0, true},
		{"integer overflow", math.Exp2(63), true, 0, 0, true},
		{"timestamp overflow", 10, true, math.MaxInt64 - 5, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, r := processBase(t, "IMMEDIATE")
			c.SharedProviders[0].Abilities[0].Params = map[string]float64{"duration": 1}
			p := &c.SharedProviders[0].Processes[0]
			p.MomentOperations = nil
			p.Cooldown = &model.ProcessCooldownDefinition{DurationMs: authoringRead("ability.param.duration"), RoundPositiveMs: tc.round, StartMoment: processMoment("PROCESS_START", "", "")}
			s := frameCommitState(t, c, r)
			s.loop.Advance(tc.now)
			for i := range s.compiled.Abilities {
				if s.compiled.Abilities[i].AbilityKey == "start" {
					s.compiled.Abilities[i].Params["duration"] = tc.value
				}
			}
			err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0})
			if tc.fail {
				if err == nil || err.BudgetCause != "" || s.actions.ProcessCount() != 0 || s.combatants["source"].cooldowns.EntryCount() != 0 {
					t.Fatalf("invalid cooldown not rejected atomically: err=%+v instances=%+v", err, s.actions.ProcessViews())
				}
			} else if err != nil || s.actions.ProcessCount() != 1 || !s.actions.ProcessAt(0).CooldownStarted() || s.combatants["source"].cooldowns.AbilityReadyAt("source", timedShieldRef("start")) != tc.want {
				t.Fatalf("valid cooldown: err=%+v source=%+v instances=%+v", err, s.combatants["source"], s.actions.ProcessViews())
			}
		})
	}
}

func TestFrameCommitAnchoredEventsDoNotEscapeFailedFrame(t *testing.T) {
	for _, queueFailure := range []bool{false, true} {
		t.Run(map[bool]string{false: "later command", true: "anchored capacity"}[queueFailure], func(t *testing.T) {
			c, r := loadAnchoredVenomFixture(t, anchoredFixtureOpts{intervalMs: 10, durationMs: 100})
			c.SharedProviders[0].Abilities[0].Operations = append(c.SharedProviders[0].Abilities[0].Operations, frameCommitDamage(100))
			s := frameCommitState(t, c, r)
			*s.loop.Queue() = scheduler.NewGenericHeap(1)
			s.actions.SetAttackActive(true)
			s.budget.MaxCommandsPerEvent = 1
			wantCause := model.BudgetCauseMaxCommandsPerEvent
			if queueFailure {
				s.budget.MaxCommandsPerEvent = 10
				s.loop.Queue().SetLimit(1)
				wantCause = model.BudgetCauseMaxQueueEvents
			}
			err := s.executeAbilityCast(r.DriverPlan.Entries[0])
			if err == nil || err.BudgetCause != wantCause {
				t.Fatalf("expected %s: %+v", wantCause, err)
			}
			if s.loop.Queue().Len() != 0 || s.effectTimers.AnchoredCount() != 0 || s.effectTimers.ExpiryCount() != 0 || s.report.Totals().SourceDamageDealt != 0 || len(s.report.Snapshot().Evidence.Items) != 0 {
				t.Fatalf("failed state write scheduled events: heap=%d anchored=%d expiry=%d", s.loop.Queue().Len(), s.effectTimers.AnchoredCount(), s.effectTimers.ExpiryCount())
			}
			bag := s.combatants["source"].providerState.Lookup("champion:source_demo")
			if bag.Present() && (bag.TargetKey() != "" || bag.TargetValues().At(anchoredVenomStateKey) != 0 || bag.CurrentAnchoredTickGeneration(anchoredVenomStateKey) != 0) {
				t.Fatalf("failed state write changed live bag: %+v", bag)
			}
		})
	}
}

func TestFrameCommitProcessTimerCapacityKeepsOnlyCommittedStart(t *testing.T) {
	c, r := processBase(t, "RECAST")
	s := frameCommitState(t, c, r)
	*s.loop.Queue() = scheduler.NewGenericHeap(1)
	s.loop.Queue().SetLimit(1)
	if s.loop.Queue().Push(scheduler.GenericEvent{TimeMs: 1000}) != model.ErrOK {
		t.Fatal("queue setup")
	}
	err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0})
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || s.actions.ProcessCount() != 1 {
		t.Fatalf("expected capacity stop after process start: err=%+v instances=%+v", err, s.actions.ProcessViews())
	}
	p := s.actions.ProcessAt(0)
	if p.StepVersion() != 0 || p.StepKey() != "" || p.ExpiresAtMs() != nil || p.StepIndex() != -1 || s.combatants["source"].resourceView().At("mana").Current != 140 || s.loop.Queue().Len() != 1 {
		t.Fatalf("failed step or missing committed cost: %+v", p)
	}
	for _, item := range s.report.Snapshot().Evidence.Items {
		if item.Kind == "process_moment" && item.Data["moment"] == "STEP_START" {
			t.Fatalf("failed step evidence leaked: %+v", item)
		}
	}
}

func TestFrameCommitLethalDamageSurvivesBudgetFailureInDeathTail(t *testing.T) {
	c, r := processBase(t, "RECAST")
	c.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: processMoment("PROCESS_FAILURE", "", "SOURCE_DIED"), Operations: []model.OperationDefinition{frameCommitDamage(100)}}}
	r.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 20, Resolved: 20, Max: 1000}
	s := frameCommitState(t, c, r)
	if err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0}); err != nil {
		t.Fatal(err)
	}
	s.actions.SetAttackActive(true)
	s.budget.MaxCommandsPerEvent = 1
	p := s.actions.ProcessAt(0)
	f := s.newExecutionFrame("target", "source", p.AbilityRef())
	f.ownerCombatantKey = "source"
	f.countCastOnCommit = true
	start := p.Definition().MomentOperations[0].OperationStart
	if err := f.executeOperations(p.Ability(), s.compiled.Operations[start:start+1]); err != nil {
		t.Fatal(err)
	}
	f.commit()
	if !f.committed || f.fatalErr == nil || f.fatalErr.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || s.combatantHp("source") != 0 || s.report.Totals().TargetDamageDealt != 100 || s.report.Totals().SourceHpLoss != 20 || s.recordingSummary().DamageRecordCount != 1 || len(reportedDamageHistory(s)) != 1 {
		t.Fatalf("committed lethal damage not retained: committed=%v err=%+v hp=%v damage=%v hpLoss=%v records=%d", f.committed, f.fatalErr, s.combatantHp("source"), s.report.Totals().TargetDamageDealt, s.report.Totals().SourceHpLoss, s.recordingSummary().DamageRecordCount)
	}
	if p.Status() != "active" || p.FinishedAtMs() != nil || p.FailureReason() != nil {
		t.Fatalf("failed death tail changed process instance: %+v", p)
	}
	acc := reportedAbilityStat(s, p.AbilityRef())
	if acc.CastCount != 2 || acc.DamageDealt == nil || *acc.DamageDealt != 100 {
		t.Fatalf("committed stats omitted on death tail error: %+v", acc)
	}
}

func TestFrameCommitProcessCooldownEvaluatesOriginalOnce(t *testing.T) {
	c, r := processBase(t, "IMMEDIATE")
	r.InitialSnapshot.Combatants[0].Attributes["attack_speed"] = authoringSlot(1)
	c.Combatants[0].Attributes["attack_speed"] = authoringSlot(1)
	p := &c.SharedProviders[0].Processes[0]
	p.Cooldown = &model.ProcessCooldownDefinition{DurationMs: authoringBinary("div", authoringConst(1000), authoringRead("source.attr.attack_speed.resolved")), RoundPositiveMs: true, StartMoment: processMoment("PROCESS_START", "", "")}
	p.MomentOperations = []model.ProcessMomentOperations{{Moment: processMoment("PROCESS_START", "", ""), Operations: []model.OperationDefinition{{Operation: "attribute_change", Target: "source", AttributeKey: "attack_speed", ValuePolicy: "set", Amount: authoringAmount(authoringConst(0.5))}}}}
	s := frameCommitState(t, c, r)
	if err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0}); err != nil {
		t.Fatalf("cooldown re-evaluated after source attribute changed: %+v", err)
	}
	if s.actions.ProcessCount() != 1 || s.actions.ProcessAt(0).Status() != "complete" || s.combatants["source"].cooldowns.AbilityReadyAt("source", timedShieldRef("start")) != 1000 || s.combatants["source"].attributesView().At("attack_speed").Resolved != 0.5 {
		t.Fatalf("frozen cooldown: source=%+v process=%+v", s.combatants["source"], s.actions.ProcessViews())
	}
}
