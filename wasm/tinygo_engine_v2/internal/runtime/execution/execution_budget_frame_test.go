package execution

import (
	"fmt"
	"testing"
	"tinygo_engine_v2/internal/runtime/execution/usage"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

func TestExecutionBudgetLinkIllegalValueAndLegalExhaustionDiffer(t *testing.T) {
	for _, tc := range []struct {
		name     string
		value    float64
		commands int
		events   int
		cause    model.BudgetCause
	}{
		{"negative", -1, 256, 10000, ""},
		{"fractional", 1.5, 256, 10000, ""},
		{"outside safe integer", 1e20, 256, 10000, ""},
		{"legal command overflow", 256, 256, 10000, model.BudgetCauseMaxCommandsPerEvent},
		{"huge integer", 1e12, 256, 10000, model.BudgetCauseMaxCommandsPerEvent},
		{"legal event overflow", 10, 256, 5, model.BudgetCauseMaxEvents},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, r := authoringInput()
			c.SharedProviders[0].Abilities[1].Params = map[string]float64{"links": tc.value}
			c.SharedProviders[0].Processes[0].MomentOperations[0].Operations[0].Amount = authoringAmount(authoringRead("ability.param.links"))
			s := frameCommitState(t, c, r)
			s.actions.SetAttackActive(true)
			s.budget.MaxCommandsPerEvent, s.budget.MaxEvents = tc.commands, tc.events
			err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0})
			if err == nil || err.BudgetCause != tc.cause {
				t.Fatalf("wrong classification: %+v want %q", err, tc.cause)
			}
			if tc.cause == "" && err.Code != model.GenericErrFormulaTypeError {
				t.Fatalf("invalid link count is a formula error: %+v", err)
			}
			if s.actions.ProcessCount() != 0 || s.combatants["source"].cooldowns.EntryCount() != 0 {
				t.Fatalf("failed link application committed process state: %+v", s.actions.ProcessViews())
			}
			for _, item := range s.report.Snapshot().Evidence.Items {
				if item.Kind == "link_application" || item.Kind == "process_moment" {
					t.Fatalf("failed link application retained staged evidence: %+v", item)
				}
			}
		})
	}
}

func TestExecutionBudgetNativeProcessKeepsCallerDepth(t *testing.T) {
	c, r := authoringInput()
	s := frameCommitState(t, c, r)
	s.budget.MaxChainDepth = 1
	s.actions.SetAttackActive(true)
	err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0})
	if err == nil || err.BudgetCause != model.BudgetCauseMaxChainDepth {
		t.Fatalf("process reset synchronous listener depth: %+v", err)
	}
	// 过程开始帧先提交，再派发联动；联动尾部超限保留已提交的过程和冷却。
	if s.actions.ProcessCount() != 1 || !s.actions.ProcessAt(0).CooldownStarted() || s.combatants["source"].cooldowns.AbilityReadyAt("source", authoringRef("initial")) != 1429 {
		t.Fatalf("committed start lost on deeper tail failure: %+v", s.actions.ProcessViews())
	}
}

func TestExecutionBudgetProcessCountHasExplicitCause(t *testing.T) {
	c, r := processBase(t, "IMMEDIATE")
	c.SharedProviders[0].Processes[0].MomentOperations = nil
	s := frameCommitState(t, c, r)
	s.budget.MaxProcessInstances = 1
	if err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0}); err != nil {
		t.Fatal(err)
	}
	ability, ref, _ := s.lookupDriverAbility(r.DriverPlan.Entries[0])
	definition := &s.compiled.Providers[ability.ProviderIndex].Processes[ability.ProcessControl.ProcessIndex]
	result, err := s.startProcess(r.DriverPlan.Entries[0], -1, "source", "target", "champion:source_demo", ref, ability, definition, "u2", 0, nil)
	if result.Accepted || err == nil || err.BudgetCause != model.BudgetCauseMaxProcessInstances || s.actions.ProcessCount() != 1 {
		t.Fatalf("process budget: %+v instances=%+v", err, s.actions.ProcessViews())
	}
}

func TestExecutionBudgetUseLedgerExplicitCauseAndCommitBoundary(t *testing.T) {
	c, r := frameCommitInput(frameCommitDamage(10), frameCommitDamage(10))
	s := frameCommitState(t, c, r)
	listener := planbundle.CompiledListener{ListenerKey: "once", HasOncePerUse: true, OwnerCombatantKey: "source", OwnerProviderRef: "attack", OncePerUseGroup: "once", OncePerUseScope: model.OncePerUseScopeProvider}
	ev := emittedEvent{eventType: model.EventTypeBasicAttackHit, sourceKey: "source", targetKey: "target", hasUse: true, useSource: "source", useSkillKey: "attack", useKey: "u1"}
	s.useTriggerLedger = usage.New(usage.Identity{})
	for i := 0; i < maxUseTriggerLedger; i++ {
		token, _, issue := s.useTriggerLedger.Reserve(usage.Key{UseKey: fmt.Sprint(i)}, "")
		if issue != nil {
			t.Fatal(issue)
		}
		s.useTriggerLedger.Commit(token)
	}
	_, _, err := s.reserveOncePerUse(listener, ev)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxUseTriggerLedger {
		t.Fatalf("ledger budget: %+v", err)
	}
	s.useTriggerLedger = usage.New(usage.Identity{})
	reserved, _, err := s.reserveOncePerUse(listener, ev)
	if err != nil || reserved == (usage.Reservation{}) {
		t.Fatalf("reserve: %v %+v", reserved, err)
	}
	reservation := reserved
	f, ability, ops := frameCommitFrame(s)
	f.copyableCollector = newTestCopyableCollector(collectorTestSeed{reservation: reservation})
	s.budget.MaxCommandsPerEvent = 1
	if err := f.executeOperations(ability, ops); err == nil {
		t.Fatal("expected budget failure")
	}
	f.commit()
	s.FinishListenerUse(f.copyableCollector, listener, true, false)
	if s.useTriggerLedger.Len() != 0 || s.useTriggerLedger.Pending() != 0 {
		t.Fatalf("failed frame retained a use reservation: %+v", s.useTriggerLedger)
	}
	reserved, _, err = s.reserveOncePerUse(listener, ev)
	if err != nil || reserved == (usage.Reservation{}) {
		t.Fatalf("reserve committed example: %v %+v", reserved, err)
	}
	reservation = reserved
	f, ability, ops = frameCommitFrame(s)
	f.copyableCollector = newTestCopyableCollector(collectorTestSeed{reservation: reservation})
	if err := f.executeOperations(ability, ops[:1]); err != nil {
		t.Fatal(err)
	}
	f.commit()
	s.FinishListenerUse(f.copyableCollector, listener, true, false)
	if len(s.snapshotUseTriggerLedger()) != 1 || s.useTriggerLedger.Pending() != 0 {
		t.Fatalf("a committed listener loses its ledger on later failure: %+v", s.useTriggerLedger)
	}
}
