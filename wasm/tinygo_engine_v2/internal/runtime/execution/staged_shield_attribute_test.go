package execution

import (
	"math"
	"testing"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

func initializedOwnShield(t *testing.T) *Engine {
	t.Helper()
	c, r := ownExpiryInput(500, 1, 460, 0)
	r.DriverPlan.BasicAttack = nil
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	for {
		at, present := s.loop.NextEventAt()
		if !present || at > 0 {
			break
		}
		event, _ := takeNextEventForTest(s.loop)
		if event.Kind != scheduler.GenericEventSourceInitialized {
			t.Fatal(event)
		}
		s.currentEventCommands = 0
		if err = s.handleSourceInitialized(event); err != nil {
			t.Fatal(err)
		}
	}
	s.currentEventCommands = 0
	return s
}

func shieldBreakingOperations(t *testing.T, s *Engine) []plan.CompiledOperation {
	t.Helper()
	for _, operation := range s.compiled.Operations {
		if operation.Operation == "damage" && operation.Ref == "incoming" {
			return []plan.CompiledOperation{operation, operation}
		}
	}
	t.Fatal("missing authored physical damage")
	return nil
}

func TestStagedShieldAttributesDisappearBeforePostDamageReads(t *testing.T) {
	s := initializedOwnShield(t)
	f := s.newExecutionFrame("target", "source", "two_hits")
	ops := shieldBreakingOperations(t, s)
	if err := f.executeOperations(plan.CompiledAbility{}, ops[:1]); err != nil {
		t.Fatal(err)
	}
	if got := f.evalContext(plan.CompiledAbility{}).TargetAttrs.At("armor").Resolved; got != 100 {
		t.Fatal("live post-damage read kept depleted shield armor", got)
	}
	if err := f.executeOperations(plan.CompiledAbility{}, ops[1:]); err != nil {
		t.Fatal(err)
	}
	f.commit()
	if f.fatal {
		t.Fatal(f.fatalErr)
	}
	// This atomic frame freezes common defense at entry: both 460/2.3=200.
	// Shield absorption totals 100 and HP damage totals 300. The removal still
	// affects ordinary reads and emitted views immediately, before frame commit.
	if got := s.combatants["source"].attributesView().At("hp").Current; math.Abs(got-700) > 1e-9 {
		t.Fatalf("frame defense snapshot changed: HP=%v", got)
	}
	if got := s.combatants["source"].attributesView().At("armor").Resolved; got != 100 {
		t.Fatal(got)
	}
	for _, event := range f.pendingEvents {
		if event.eventType == model.EventTypeDamageTaken && event.snapshot.TargetAttrs.At("armor").Resolved != 100 {
			t.Fatal("post-damage event retained depleted shield armor", event.snapshot.TargetAttrs)
		}
	}
	next := s.newExecutionFrame("target", "source", "next_hit")
	if err := next.executeOperations(plan.CompiledAbility{}, ops[:1]); err != nil {
		t.Fatal(err)
	}
	next.commit()
	if next.fatal {
		t.Fatal(next.fatalErr)
	}
	// The next independent frame starts with base armor100: 460/2=230.
	if got := s.combatants["source"].attributesView().At("hp").Current; math.Abs(got-470) > 1e-9 {
		t.Fatal(got)
	}
}

func TestStagedShieldDepletionFailureRollsBackShieldAndAttributes(t *testing.T) {
	s := initializedOwnShield(t)
	f := s.newExecutionFrame("target", "source", "two_hits_fail")
	s.budget.MaxCommandsPerEvent = 1
	if err := f.executeOperations(plan.CompiledAbility{}, shieldBreakingOperations(t, s)); err == nil {
		t.Fatal("expected second command to fail")
	}
	if got := s.combatants["source"].attributesView().At("hp").Current; got != 1000 {
		t.Fatal(got)
	}
	if got := s.combatants["source"].attributesView().At("armor").Resolved; got != 130 {
		t.Fatal(got)
	}
	if got := ownShieldRemaining(s.buildDoneResult(false)); got != 100 {
		t.Fatal(got)
	}
}

func TestStagedShieldMissingActualModifierSlotRejectsAtomically(t *testing.T) {
	c, r := ownExpiryInput(500, 1, 230, 0)
	r.DriverPlan.BasicAttack = nil
	delete(r.InitialSnapshot.Combatants[0].Attributes, "armor")
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.runLoop(); err == nil {
		t.Fatal("missing shield armor slot accepted")
	}
	if ownShieldRemaining(s.buildDoneResult(false)) != 0 {
		t.Fatal("failed initialization left a shield")
	}
}
