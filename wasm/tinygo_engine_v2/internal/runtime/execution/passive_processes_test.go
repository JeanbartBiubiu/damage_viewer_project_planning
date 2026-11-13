package execution

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

func passiveFrameFixture(t *testing.T) (*Engine, *Frame, planbundle.CompiledAbility, planbundle.CompiledOperation) {
	t.Helper()
	c, r := singleSkillInput(false)
	stepKey := "wait"
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	p := model.ProviderDefinition{ProviderKey: "delayed_def", SkillKey: "w", Kind: "character", StableID: "delayed",
		Processes: []model.ProcessDefinition{{ProcessKey: "tail", SkillKey: "w", EntryKind: model.ProcessEntrySkillHitPassive,
			Steps: []model.ProcessStepDefinition{{StepKey: "wait", StepType: "DELAY", OccupiesAction: model.BoolPtr(false), DelayMs: timedShieldExpr(300)}}, Costs: []model.ProcessCostDefinition{},
			MomentOperations: []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: &stepKey}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: timedShieldExpr(10)}}}}}},
		Abilities: []model.AbilityDefinition{{AbilityKey: "listen", SkillKey: "w", Kind: "passive_listener", ListenerSpec: &model.ListenerDefinition{EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, MaxTriggersPerEvent: 1}, Operations: []model.OperationDefinition{{Operation: model.OperationKindStartPassiveProcess, Target: "self", ProcessKey: "tail"}}}}}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "delayed", DefinitionRef: p.ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "delayed", DefinitionRef: p.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	s := frameCommitState(t, c, r)
	clearQueuedEventsForTest(s.loop)
	use := s.actions.NewUse(actionpkg.UseSeed{UseKey: "original", Source: "source", SkillKey: "configured_spell", CastID: 1})
	s.skillUses["original"] = &skillUseRuntime{identity: use}
	ref := "source.provider[delayed].ability[listen]"
	f := s.newExecutionFrame("source", "target", ref)
	f.ownerCombatantKey, f.ownerProviderRef, f.mountedListener = "source", "delayed", true
	seq := 1
	f.eventCtx = &contract.EventSnapshot{EventType: model.EventTypeSkillHit, EventSourceKey: "source", EventTargetKey: "target", HasUse: true, UseKey: "original", UseSource: "source", UseSkillKey: "configured_spell", HasSkillHit: true,
		SkillHit: &contract.SkillHitFacts{HasPlan: true, AbilityRef: "source.provider[caster].ability[hit]", HitSequence: &seq, OccurrenceID: 1, UseRef: "original", SkillKey: "configured_spell", SourceKey: "source", TargetKey: "target"}}
	bound := s.compiled.AbilityRefIndex[ref]
	ability := s.compiled.Abilities[bound.AbilityIndex]
	return s, f, ability, s.compiled.Operations[ability.OperationStart]
}

func TestPassiveProcessFrameQueueFailurePublishesNoInstanceOrTimer(t *testing.T) {
	s, f, ability, operation := passiveFrameFixture(t)
	for index := 0; index < 2; index++ {
		if err := f.stagePassiveProcess(ability, operation); err != nil {
			t.Fatal(err)
		}
	}
	if f.pendingPassiveProcesses.At(0).UseKey() == f.pendingPassiveProcesses.At(1).UseKey() {
		t.Fatal("same original use overwritten")
	}
	s.loop.SetQueueLimit(1)
	f.commit()
	if !f.fatal || f.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || f.committed || s.actions.ProcessCount() != 0 || s.loop.QueuedEvents() != 0 {
		t.Fatal("queue preflight published a partial passive start", f.fatalErr, s.actions.ProcessCount(), s.loop.QueuedEvents())
	}
}

func TestPassiveProcessFrameInstanceBudgetIncludesUnpublishedOrdinaryStart(t *testing.T) {
	s, f, ability, operation := passiveFrameFixture(t)
	ordinary := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: "source", ProviderRef: "caster", ProcessKey: "cast", SkillKey: "configured_spell", UseKey: "ordinary", Target: "target", Status: "active"}, Definition: &s.compiled.Providers[0].Processes[0], StepIndex: -1})
	f.processOriginal, f.processIsNew = ordinary, true
	f.processChanges = actionpkg.StageProcess(ordinary)
	f.pendingProcess = f.processChanges.View()
	s.budget.MaxProcessInstances = 1
	if err := f.stagePassiveProcess(ability, operation); err == nil || err.BudgetCause != model.BudgetCauseMaxProcessInstances || f.pendingPassiveProcesses.Len() != 0 || s.actions.ProcessCount() != 0 {
		t.Fatal("same-frame ordinary start was omitted from budget", err)
	}
	s.budget.MaxProcessInstances = 2
	if err := f.stagePassiveProcess(ability, operation); err != nil {
		t.Fatal(err)
	}
	s.budget.MaxProcessInstances = 1
	f.commit()
	if !f.fatal || f.fatalErr.BudgetCause != model.BudgetCauseMaxProcessInstances || s.actions.ProcessCount() != 0 || s.loop.QueuedEvents() != 0 {
		t.Fatal("instance preflight published a partial process", f.fatalErr)
	}
}

func TestPassiveProcessFrameSameOriginalUseRetainsIndependentInstances(t *testing.T) {
	s, f, ability, operation := passiveFrameFixture(t)
	for index := 0; index < 2; index++ {
		if err := f.stagePassiveProcess(ability, operation); err != nil {
			t.Fatal(err)
		}
	}
	f.commit()
	if f.fatal || !f.committed || s.actions.ProcessCount() != 2 || s.loop.QueuedEvents() != 2 {
		t.Fatal(f.fatalErr)
	}
	first, _ := s.actions.ProcessAt(0).PassiveOrigin()
	second, _ := s.actions.ProcessAt(1).PassiveOrigin()
	if first != second || s.actions.ProcessAt(0).UseKey() == s.actions.ProcessAt(1).UseKey() || s.actions.Use(s.actions.ProcessAt(0).UseKey()) != nil {
		t.Fatal(first, second)
	}
}

func TestPassiveProcessTailFailureRetainsCommittedPrefixAndCannotComplete(t *testing.T) {
	s, f, ability, operation := passiveFrameFixture(t)
	process := &s.compiled.Providers[1].Processes[0]
	moment := &process.MomentOperations[0]
	leaf := s.compiled.Operations[moment.OperationStart]
	// 当前测试编译结果尾部只有一项；在同一纯计划中重复该已编译叶操作，制造真实命令预算失败。
	moment.OperationStart = uint16(len(s.compiled.Operations))
	moment.OperationCount = 2
	s.compiled.Operations = append(s.compiled.Operations, leaf, leaf)
	prefix := s.newExecutionFrame("source", "target", "source.provider[delayed].ability[listen]")
	if err := prefix.executeOperations(ability, []planbundle.CompiledOperation{leaf}); err != nil {
		t.Fatal(err)
	}
	prefix.commit()
	if prefix.fatal {
		t.Fatal(prefix.fatalErr)
	}
	if err := f.stagePassiveProcess(ability, operation); err != nil {
		t.Fatal(err)
	}
	f.commit()
	if f.fatal {
		t.Fatal(f.fatalErr)
	}
	s.budget.MaxCommandsPerEvent = 1
	err := s.runLoop()
	if err != nil || s.budgetCause != model.BudgetCauseMaxCommandsPerEvent || s.report.Totals().SourceDamageDealt != 10 || s.actions.ProcessAt(0).Status() != "active" || s.loop.TimeMs() != 300 || s.buildDoneResult(false).Summary.Execution.Complete {
		t.Fatal("failed tail changed committed prefix or completed", err, s.report.Totals(), s.actions.ProcessAt(0).Snapshot())
	}
}
