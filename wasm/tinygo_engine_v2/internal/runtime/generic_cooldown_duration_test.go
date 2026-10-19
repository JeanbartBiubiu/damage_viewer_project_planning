package runtime

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func cooldownDurationInput(t *testing.T, duration float64, refs []string) (model.CompileRequest, model.RunRequest) {
	input, run := singleSkillInput(false)
	input.SharedProviders[0].Processes[0].Cooldown.DurationMs = hitConst(duration)
	p := hitFlatProvider("duration_window", "armor", 0)
	p.Modifiers = []model.ModifierDefinition{{ModifierKey: "duration", Kind: "cooldown_duration", Target: "self", ValuePolicy: "multiply", Value: hitConst(.5), AffectedAbilityRefs: &refs}}
	input.SharedProviders = append(input.SharedProviders, p)
	return input, run
}

func applyDurationWindow(t *testing.T, state *genericRunState) {
	t.Helper()
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "duration_test")
	if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "duration_window"}}); err != nil {
		t.Fatal(err)
	}
	frame.commit()
	if frame.fatal {
		t.Fatal(frame.fatalErr)
	}
}

func TestCooldownDurationNewCommitOnlyAndFinalRounding(t *testing.T) {
	for _, duration := range []float64{7500, 5000, 3} {
		input, run := cooldownDurationInput(t, duration, []string{"source.provider[caster].ability[initial]"})
		state := frameCommitState(t, input, run)
		applyDurationWindow(t, state)
		if err := state.runLoop(); err != nil {
			t.Fatal(err)
		}
		want := map[float64]int64{7500: 3850, 5000: 2600, 3: 102}[duration]
		id := genericAbilityCooldownIdentity("source", "source.provider[caster].ability[initial]")
		if got := state.combatants["source"].cooldowns.readyAt(id); got != want {
			t.Fatal(duration, got, want)
		}
		state.nowMs = 2100
		state.refreshProviderAwareAttributes("source", "target")
		if got := state.combatants["source"].cooldowns.readyAt(id); got != want {
			t.Fatal("expiry rewrote a committed deadline", got)
		}
	}
	input, run := cooldownDurationInput(t, 7500, []string{"source.provider[caster].ability[initial]"})
	state := frameCommitState(t, input, run)
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	id := genericAbilityCooldownIdentity("source", "source.provider[caster].ability[initial]")
	before := state.combatants["source"].cooldowns.readyAt(id)
	applyDurationWindow(t, state)
	if state.combatants["source"].cooldowns.readyAt(id) != before {
		t.Fatal("new effect rewrote old cooldown")
	}
}

func TestCooldownDurationExactExpiryAndEmptyScope(t *testing.T) {
	for _, at := range []int64{1999, 2000, 2001} {
		for _, matched := range []bool{false, true} {
			refs := []string{}
			if matched {
				refs = append(refs, "source.provider[caster].ability[initial]")
			}
			input, run := cooldownDurationInput(t, 7500, refs)
			run.DriverPlan.SkillActions[0].FirstAtMs = at
			run.StopPolicy.DurationMs = at + 500
			state := frameCommitState(t, input, run)
			applyDurationWindow(t, state)
			if err := state.runLoop(); err != nil {
				t.Fatal(err)
			}
			want := at + 7500
			if matched && at < 2000 {
				want = at + 3750
			}
			if got := state.combatants["source"].cooldowns.readyAt(genericAbilityCooldownIdentity("source", "source.provider[caster].ability[initial]")); got != want {
				t.Fatal(at, matched, got, want)
			}
		}
	}
}
