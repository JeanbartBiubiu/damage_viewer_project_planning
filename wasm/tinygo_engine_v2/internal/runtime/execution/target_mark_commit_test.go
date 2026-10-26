package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	plan "tinygo_engine_v2/internal/plan"
)

func TestTargetMarkQueuePreflightCannotPublishStagedGroupFacts(t *testing.T) {
	c, r := targetMarkInput(true, false)
	// Let the public real Q commit while retaining the mark. Then exercise the
	// existing frame preflight directly with the actual compiled private leaves;
	// this is a transaction test, not a new external contact/resume protocol.
	c.SharedProviders[1].Abilities[3].ListenerSpec.Condition = timedShieldExpr(0)
	s := targetMarkState(t, c, r)
	if err := s.runLoop(); err != nil {
		t.Fatal(err)
	}
	var op plan.CompiledOperation
	var ability plan.CompiledAbility
	for _, candidate := range s.compiled.Operations {
		if candidate.TargetMark != nil {
			op = candidate
		}
	}
	for _, candidate := range s.compiled.Abilities {
		if candidate.AbilityKey == "consume_q" {
			ability = candidate
		}
	}
	var frame Frame
	s.initExecutionFrame(&frame, "source", "target", "source.provider[w].ability[consume_q]")
	frame.ownerCombatantKey, frame.ownerProviderRef, frame.mountedListener = "source", "w", true
	for _, leaf := range []*plan.CompiledOperation{op.TargetMark.Clear, op.TargetMark.Damage, op.TargetMark.Restore} {
		if err := frame.executeOperation(ability, leaf); err != nil {
			t.Fatal(err)
		}
	}
	frame.pendingTargetMark.ConsumedCount, frame.pendingTargetMark.SkillCount = 1, 1
	frame.stageProviderTargetStateExpiry("source", "w", "target", "mark", 4250)
	s.loop.Queue().SetLimit(s.loop.Queue().Len())
	frame.commit()
	if !frame.fatal || frame.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || frame.committed || s.report.TargetMarkSummary().ConsumedCount != 0 || s.combatantHp("target") != 900 || s.combatantHp("source") != 520 || s.combatants["source"].resourceView().At("mana").Current != 80 || s.combatants["source"].providerState.Lookup("w").TargetValues().At("mark") != 1 {
		t.Fatal("failed preflight published part of the group", frame.fatalErr, s.report.TargetMarkSummary())
	}
	for _, row := range s.report.Snapshot().DamageRecords {
		if row["operationRef"] == "w.detonate" {
			t.Fatal("uncommitted damage escaped", row)
		}
	}
}
