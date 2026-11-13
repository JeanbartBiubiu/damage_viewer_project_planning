package actionflow

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

type passiveProcessReadsFixture struct {
	use             *actionpkg.UseView
	unmounted, dead bool
}

func (r passiveProcessReadsFixture) NativeProcessUse(string) *actionpkg.UseView { return r.use }
func (r passiveProcessReadsFixture) NativeProcessMounted(owner, provider string, definition uint16) bool {
	return !r.unmounted && owner == "source" && ((provider == "caster" && definition == 0) || (provider == "delayed" && definition == 1))
}
func (r passiveProcessReadsFixture) NativeProcessDead(string) bool             { return r.dead }
func (r passiveProcessReadsFixture) NativeProcessCooldown(string, string) bool { return false }

func passiveProcessStartFixture() (*actionpkg.State, PassiveProcessStart, planbundle.CompiledAbility, planbundle.CompiledOperation, []planbundle.CompiledProvider, passiveProcessReadsFixture) {
	state := &actionpkg.State{}
	use := state.NewUse(actionpkg.UseSeed{UseKey: "original", Source: "source", SkillKey: "q", CastID: 5})
	seq := 1
	input := PassiveProcessStart{Owner: "source", Target: "target", Provider: "delayed", AbilityRef: "source.provider[delayed].ability[listen]", Now: 500, MountedListener: true,
		Event: &contract.EventSnapshot{EventType: model.EventTypeSkillHit, EventSourceKey: "source", EventTargetKey: "target", HasUse: true, UseKey: "original", UseSource: "source", UseSkillKey: "q", HasSkillHit: true,
			SkillHit: &contract.SkillHitFacts{HasPlan: true, AbilityRef: "source.provider[caster].ability[hit]", HitSequence: &seq, OccurrenceID: 4, UseRef: "original", SkillKey: "q", SourceKey: "source", TargetKey: "target"}},
		OriginAbility: planbundle.CompiledAbility{ProviderIndex: 0, SkillKey: "q", HasSkillHit: true}}
	ability := planbundle.CompiledAbility{ProviderIndex: 1, SkillKey: "w", Kind: "passive_listener"}
	op := planbundle.CompiledOperation{Operation: model.OperationKindStartPassiveProcess, Target: "self", OwnerProviderIndex: 1, PassiveProcessIndex: 0, Path: "onHit.operations[0]"}
	providers := []planbundle.CompiledProvider{{}, {Processes: []planbundle.CompiledProcess{{EntryKind: model.ProcessEntrySkillHitPassive, SkillKey: "w", ProcessKey: "tail", InitialAbilityIndex: -1}}}}
	return state, input, ability, op, providers, passiveProcessReadsFixture{use: use}
}

func TestPassiveProcessStartRequiresActualCompleteProvenance(t *testing.T) {
	mutations := []struct {
		name   string
		change func(*PassiveProcessStart, *passiveProcessReadsFixture)
	}{
		{"not-mounted-listener", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.MountedListener = false }},
		{"no-event", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event = nil }},
		{"emitted-event", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.EventType = "event/custom" }},
		{"no-use", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.HasUse = false }},
		{"no-hit", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.HasSkillHit = false }},
		{"missing-hit", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit = nil }},
		{"no-plan", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit.HasPlan = false }},
		{"basic-attack", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit.IsBasicAttack = true }},
		{"no-occurrence", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit.OccurrenceID = 0 }},
		{"no-sequence", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit.HitSequence = nil }},
		{"zero-sequence", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { *v.Event.SkillHit.HitSequence = 0 }},
		{"wrong-owner", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Owner = "target" }},
		{"wrong-target", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Target = "source" }},
		{"wrong-provider", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Provider = "other" }},
		{"wrong-ability-owner", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) {
			v.AbilityRef = "target.provider[delayed].ability[listen]"
		}},
		{"wrong-hit-owner", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit.SourceKey = "target" }},
		{"wrong-hit-target", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit.TargetKey = "source" }},
		{"wrong-hit-use", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit.UseRef = "other" }},
		{"wrong-hit-skill", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.Event.SkillHit.SkillKey = "other" }},
		{"missing-real-use", func(_ *PassiveProcessStart, r *passiveProcessReadsFixture) { r.use = nil }},
		{"missing-real-mount", func(_ *PassiveProcessStart, r *passiveProcessReadsFixture) { r.unmounted = true }},
		{"wrong-original-definition", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.OriginAbility.ProviderIndex = 2 }},
		{"wrong-original-skill", func(v *PassiveProcessStart, _ *passiveProcessReadsFixture) { v.OriginAbility.SkillKey = "other" }},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			state, input, ability, operation, providers, reads := passiveProcessStartFixture()
			mutation.change(&input, &reads)
			process, err := NewProcessExecutor(state, Identity{}).PreparePassiveProcess(input, ability, operation, providers, reads)
			if err == nil || process != nil || state.ProcessCount() != 0 {
				t.Fatal("invalid provenance allocated or accepted an instance", process, err)
			}
		})
	}
}

func TestPassiveProcessPreparationDoesNotPublishAndRejectsCommittedIdentityCollision(t *testing.T) {
	state, input, ability, operation, providers, reads := passiveProcessStartFixture()
	executor := NewProcessExecutor(state, Identity{})
	process, err := executor.PreparePassiveProcess(input, ability, operation, providers, reads)
	if err != nil || process == nil || state.ProcessCount() != 0 || state.Use(process.UseKey()) != nil {
		t.Fatal(process, err)
	}
	state.AddProcess(process)
	if _, err := executor.PreparePassiveProcess(input, ability, operation, providers, reads); err == nil {
		t.Fatal("committed passive identity collision was accepted")
	}
	for _, blocked := range []bool{false, true} {
		state, input, ability, operation, providers, reads = passiveProcessStartFixture()
		if blocked {
			input.Event.SkillHit.Blocked = 1
		} else {
			reads.dead = true
		}
		process, err = NewProcessExecutor(state, Identity{}).PreparePassiveProcess(input, ability, operation, providers, reads)
		if err != nil || process != nil || state.ProcessCount() != 0 {
			t.Fatal(process, err)
		}
	}
}
