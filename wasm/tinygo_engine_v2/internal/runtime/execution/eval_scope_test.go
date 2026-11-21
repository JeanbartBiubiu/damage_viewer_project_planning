package execution

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

func empoweredRefreshFixture(t *testing.T, fail bool) *Engine {
	t.Helper()
	input, run := empoweredInput(t, "refresh", 100, 1500, 1300)
	input.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 20, Max: 20}
	run.InitialSnapshot.Combatants[0].Resources["energy"] = model.ResourceSlotDef{Current: 20, Max: 20}
	second := run.DriverPlan.SkillActions[0]
	second.InstructionKey, second.FirstAtMs = "refresh_again", 500
	run.DriverPlan.SkillActions = append(run.DriverPlan.SkillActions, second)

	process := &input.SharedProviders[1].Processes[0]
	process.Costs = []model.ProcessCostDefinition{{ResourceKey: "energy", Amount: authoringConst(3)}}
	cost := model.GenericFormulaExpr{Op: "read", Path: "process.actual_cost.energy"}
	operations := []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "energy", Amount: &cost}}
	if fail {
		run.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 500, Resolved: 1000, Max: 1000}
		zero := model.GenericFormulaExpr{Op: "sub", Args: []model.GenericFormulaExpr{cost, authoringConst(3)}}
		operations = append(operations, model.OperationDefinition{Operation: "heal", Target: "self", Amount: timedShieldExpr(5)}, model.OperationDefinition{Operation: "resource_change", Target: "self", ResourceKey: "energy",
			Amount: authoringAmount(model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{authoringConst(1), zero}})})
	}
	process.MomentOperations = []model.ProcessMomentOperations{{Moment: processMoment("PROCESS_FAILURE", "", "EVENT_ABORTED"), Operations: operations}}

	s, err := newGenericRunState(authoringCompile(t, input), run)
	if err != nil {
		t.Fatal(err)
	}
	runPrefixThroughForTest(t, s, 499)
	s.loop.Advance(500)
	return s
}

func TestEmpoweredRefreshPublishesOldFailureAndNewStart(t *testing.T) {
	s := empoweredRefreshFixture(t, false)
	old := s.actions.EmpoweredAt(0)
	if err := s.handleSkillAction(1); err != nil {
		t.Fatal(err)
	}
	if reason := old.FailureReason(); old.Status() != "failed" || reason == nil || *reason != "EVENT_ABORTED" {
		t.Fatalf("old process did not publish its failure: %+v", old.Snapshot())
	}
	if s.actions.EmpoweredCount() != 1 || s.actions.ProcessCount() != 3 {
		t.Fatalf("replacement did not publish exactly one new process: %+v", s.snapshotProcesses())
	}
	next := s.actions.EmpoweredAt(0)
	if next == old || next.UseKey() != "skill:refresh_again" || next.Status() != "active" || next.Expiry() != 2000 {
		t.Fatalf("new process lost its published identity or window: %+v", next.Snapshot())
	}
	if energy := s.combatants["source"].resourceView().At("energy").Current; energy != 17 {
		t.Fatalf("old failure must refund its own 3 energy after both payments, got %g", energy)
	}
}

func TestEmpoweredFailureBorrowRestoresOuterProcessScope(t *testing.T) {
	s := empoweredRefreshFixture(t, true)
	old := s.actions.EmpoweredAt(0)
	seed := old.Snapshot()
	seed.UseKey = "skill:refresh_again"
	next := actionpkg.NewProcess(actionpkg.ProcessSeed{
		Snapshot: seed, Definition: old.Definition(), Ability: old.Ability(), AbilityRef: old.AbilityRef(),
		StepIndex: old.StepIndex(), CastID: old.CastID() + 1,
	})
	var f Frame
	s.initProcessFrame(&f, next)
	f.empowered = &empoweredFrame{}
	f.actionFrame.MarkProcessStart()
	f.actionFrame.StageProcessTimer(f.activeProcessChanges, true)
	wait := actionpkg.NewAttackWait(actionpkg.AttackWaitSeed{Anchor: 900})
	f.actionFrame.StageAttackWait(wait)
	f.activeProcessChanges.SetActualCost("energy", 7)
	f.processCostReadable = true
	f.processMomentKind = "PROCESS_START"
	f.eventCtx = &eventFormulaSnapshot{EventType: model.EventTypeSkillHit}
	f.rootSkillHitDamage = true

	f.numeric.SetOutputs(map[string]formula.OperationOutputValues{"outer": {ActualHPLoss: 11}})
	f.numeric.SetTotals(11, 2)
	outer := f.evalScope

	err := s.stageEmpoweredFailure(&f, old)
	if err == nil || err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("expected old process amount failure, got %+v", err)
	}
	if f.fatalErr != err || !reflect.DeepEqual(f.evalScope, outer) || !f.strictReads {
		t.Fatalf("nested error did not restore the outer evaluation binding: %+v", f.evalScope)
	}
	if cost, ok := f.processActualCosts.Lookup("energy"); !ok || cost != 7 {
		t.Fatalf("nested failure did not restore actual costs: %g (%v)", cost, ok)
	}
	if facts, outputs := f.numeric.Facts(), f.numeric.Outputs(); facts.Damage != 11 || facts.Healing != 2 || len(outputs) != 1 || outputs["outer"].ActualHPLoss != 11 {
		t.Fatalf("nested failure did not restore the outer outputs and totals: %+v %+v", facts, outputs)
	}
	if f.actionFrame.Process() != outer.activeProcess || f.actionFrame.ProcessOriginal() != next ||
		f.actionFrame.ProcessTimer() != next || f.actionFrame.AttackWait() != wait || !f.actionFrame.StartsProcess() {
		t.Fatal("nested failure replaced the pending main process or its wait")
	}
	if staged := f.stageFor("source").resourceView().At("energy").Current; staged != 20 {
		t.Fatalf("the first failure operation must read the old process cost, staged energy = %g", staged)
	}
	if old.Status() != "active" || f.empowered.FinishedCount() != 0 || s.combatants["source"].resourceView().At("energy").Current != 17 {
		t.Fatal("failed borrow published old process or shared frame resource changes")
	}
}

func TestEmpoweredSuccessfulBorrowKeepsNumericTotals(t *testing.T) {
	f := Frame{empowered: &empoweredFrame{}, evalScope: evalScope{abilityRef: "outer"}}
	f.numeric.SetTotals(11, 2)
	next := f.evalScope
	next.abilityRef = "empowered"
	saved := f.pushEvalScope(next)
	f.numeric.AddTotals(5, 3)
	(*hitFrameHost)(&f).EndEmpoweredProcess(saved, nil)
	if facts := f.numeric.Facts(); f.abilityRef != "outer" || facts.Damage != 16 || facts.Healing != 5 {
		t.Fatalf("successful borrow changed the outer binding or dropped report totals: %+v", facts)
	}
}
