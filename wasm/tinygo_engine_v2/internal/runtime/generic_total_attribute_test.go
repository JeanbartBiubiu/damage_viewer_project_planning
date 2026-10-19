package runtime

import (
	"math"
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func TestTotalAttributeRatioRefreshAndLazyExpiryCache(t *testing.T) {
	for _, end := range []int64{1999, 2000, 2999, 3000} {
		input, run := hitFlatFixture(t, "ratio", end, true)
		p := &input.SharedProviders[1]
		p.Modifiers[0].Stage, p.Modifiers[0].ValuePolicy, p.Modifiers[0].Value = "total", "multiply", hitConst(.7)
		done := runSkillHit(t, input, run)
		want := 70.0
		if end == 3000 {
			want = 100
		}
		if math.Abs(snapshotAttribute(t, done, "target", "armor")-want) > 1e-9 {
			t.Fatal(end, done.FinalSnapshot)
		}
	}
	input, run := hitFlatFixture(t, "lazy_ratio", 100, false)
	p := &input.SharedProviders[1]
	p.Modifiers[0].Stage, p.Modifiers[0].ValuePolicy, p.Modifiers[0].Value = "total", "multiply", hitConst(.7)
	state := frameCommitState(t, input, run)
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	state.nowMs = 1999
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "probe")
	frame.reResolveStagedAttributesTwoPass(plan.CompiledAbility{})
	if got := frame.stageFor("target").attributes.At("armor").Resolved; got != 70 {
		t.Fatal(got)
	}
	// Deliberately leave the real provider mounted and its cleanup event unhandled.
	state.nowMs = 2000
	frame.reResolveStagedAttributesTwoPass(plan.CompiledAbility{})
	if got := frame.stageFor("target").attributes.At("armor").Resolved; got != 100 {
		t.Fatal("expired total ratio reused by memo", got)
	}
}

func TestTotalAttributeExpiryFailedResolutionCannotAuthorizeMemoHit(t *testing.T) {
	input, run := hitFlatFixture(t, "retry_ratio", 100, false)
	for _, attrs := range []map[string]model.AttributeSlotDef{input.Combatants[1].Attributes, run.InitialSnapshot.Combatants[1].Attributes} {
		attrs["armor"] = model.AttributeSlotDef{Base: 1.5, Current: 1.5, Max: 1.5, Resolved: 1.5}
	}
	p := &input.SharedProviders[1]
	p.Modifiers[0].ValuePolicy, p.Modifiers[0].Stage, p.Modifiers[0].Value = "multiply", "total", hitConst(.5)
	input.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "remaining", Kind: "attribute", Target: "target.attr.armor", ValuePolicy: "complement_multiply", Stage: "total", Value: hitConst(.1)}}
	input.Combatants[1].Providers = append(input.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "actual_ratio", DefinitionRef: p.ProviderKey})
	expires := int64(2000)
	run.InitialSnapshot.Combatants[1].Providers = append(run.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "actual_ratio", DefinitionRef: p.ProviderKey, Source: "source", Owner: "target", Stacks: 1, ExpireAt: &expires})
	state := frameCommitState(t, input, run)
	state.nowMs = 1999
	var first executionFrame
	state.initExecutionFrame(&first, "source", "target", "success")
	first.reResolveStagedAttributesTwoPass(plan.CompiledAbility{})
	if first.fatal {
		t.Fatal(first.fatalErr)
	}
	if value := first.stageFor("target").attributes.At("armor").Resolved; math.Abs(value-.775) > 1e-9 {
		t.Fatal(value)
	}
	state.nowMs = 2000
	for i := 0; i < 2; i++ {
		var failed executionFrame
		state.initExecutionFrame(&failed, "source", "target", "failed_retry")
		failed.reResolveStagedAttributesTwoPass(plan.CompiledAbility{})
		if !failed.fatal {
			t.Fatal("failed expired resolution incorrectly became a successful memo hit", i)
		}
	}
}
