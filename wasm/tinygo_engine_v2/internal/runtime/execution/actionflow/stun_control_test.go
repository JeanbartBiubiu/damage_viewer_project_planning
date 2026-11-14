package actionflow

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type cascadingStunFixture struct {
	observedProcessPhases
	executor  ProcessExecutor
	deadlines map[string]int64
	settling  bool
	reentries int
}

func (f *cascadingStunFixture) ProcessStunUntil(owner string) (int64, *model.EngineError) {
	return f.deadlines[owner], nil
}
func (f *cascadingStunFixture) ProcessStunSettling() bool { return f.settling }
func (f *cascadingStunFixture) BeginProcessStun()         { f.settling = true }
func (f *cascadingStunFixture) EndProcessStun()           { f.settling = false }
func (f *cascadingStunFixture) CommitProcessMoment(process *actionpkg.ProcessView, moment ProcessMoment) (ActionResult, *model.EngineError) {
	result, err := f.observedProcessPhases.CommitProcessMoment(process, moment)
	if err != nil || moment.kind != "PROCESS_FAILURE" {
		return result, err
	}
	if process.Owner() == "target" {
		f.deadlines["source"] = 500
	}
	f.reentries++
	return result, f.executor.FailStunnedProcesses(f.now, f, f)
}

func TestStunDeadlineReadsActualFiniteInstancesAndOrderedChanges(t *testing.T) {
	providers := []planbundle.CompiledProvider{{ProviderKey: "stun", ActionStun: true}, {ProviderKey: "slow"}}
	instance := func(ref string, definition uint16, expiry int64) effectpkg.Provider {
		return effectpkg.Provider{ProviderRef: ref, DefinitionRef: providers[definition].ProviderKey, DefinitionIndex: definition, Source: "target", Owner: "source", ExpireAt: expiry}
	}
	for _, test := range []struct {
		name      string
		now, want int64
		instances []effectpkg.Provider
		changes   []ControlMutation
		rejected  bool
	}{
		{name: "overlap", now: 100, want: 700, instances: []effectpkg.Provider{instance("a", 0, 300), instance("b", 0, 700), instance("ordinary_slow", 1, 900)}},
		{name: "exact_expiry", now: 300, instances: []effectpkg.Provider{instance("a", 0, 300)}},
		{name: "refresh_at_exact_expiry", now: 300, want: 800, instances: []effectpkg.Provider{instance("a", 0, 300)}, changes: []ControlMutation{{Kind: "refresh", Owner: "source", Reference: "a", HasExpiry: true, Expires: 800}}},
		{name: "refresh_shortens", now: 100, want: 200, instances: []effectpkg.Provider{instance("a", 0, 700)}, changes: []ControlMutation{{Kind: "refresh", Owner: "source", Reference: "a", HasExpiry: true, Expires: 200}}},
		{name: "remove_longer", now: 100, want: 300, instances: []effectpkg.Provider{instance("a", 0, 300), instance("b", 0, 700)}, changes: []ControlMutation{{Kind: "expire", Owner: "source", Reference: "b"}}},
		{name: "staged_apply", now: 100, want: 500, changes: []ControlMutation{{Kind: "apply", Owner: "source", Definition: "stun", HasExpiry: true, Expires: 500}}},
		{name: "projected_not_repeated", now: 100, want: 300, instances: []effectpkg.Provider{instance("a", 0, 300)}, changes: []ControlMutation{{Kind: "apply", Owner: "source", Definition: "stun", Projected: true, HasExpiry: true, Expires: 900}}},
		{name: "permanent_rejected", now: 100, instances: []effectpkg.Provider{instance("a", 0, 0)}, rejected: true},
		{name: "unsafe_rejected", now: 100, instances: []effectpkg.Provider{instance("a", 0, maxJSONSafeInteger+1)}, rejected: true},
		{name: "wrong_definition_rejected", now: 100, instances: []effectpkg.Provider{{ProviderRef: "a", DefinitionRef: "foreign", Owner: "source", ExpireAt: 500}}, rejected: true},
		{name: "wrong_owner_rejected", now: 100, instances: []effectpkg.Provider{{ProviderRef: "a", DefinitionRef: "stun", Owner: "target", ExpireAt: 500}}, rejected: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			actual, err := StunDeadline("source", test.now, providers, effectpkg.Providers(test.instances), test.changes)
			if (err != nil) != test.rejected || err == nil && actual != test.want {
				t.Fatalf("deadline=%d want=%d err=%+v", actual, test.want, err)
			}
		})
	}
	providers[0].Lifecycle = &planbundle.CompiledProviderLifecycle{InstanceScope: model.InstanceScopeSourceTarget, RefreshPolicy: model.RefreshPolicyReplace}
	changes := []ControlMutation{{Kind: "apply", Owner: "source", Source: "target", Definition: "stun", HasExpiry: true, Expires: 900}, {Kind: "apply", Owner: "source", Source: "target", Definition: "stun", HasExpiry: true, Expires: 200}}
	if actual, err := StunDeadline("source", 100, providers, effectpkg.Providers([]effectpkg.Provider{instance("original", 0, 700)}), changes); err != nil || actual != 200 {
		t.Fatal("same-source replacement retained a previous control", actual, err)
	}
}

func TestStunFailureRechecksEarlierProcessesAndGuardsSynchronousReentry(t *testing.T) {
	state, first := processFixture(planbundle.CompiledProcessStep{StepKey: "charge", StepType: "CHARGE"})
	changes := actionpkg.StageProcess(first)
	changes.EnterStep(0, first.Definition().Steps[0], 100)
	changes.Publish(first)
	second := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: "target", ProviderRef: "item", ProcessKey: "cast", SkillKey: "author:q", UseKey: "later", Target: "source", Status: "active"}, Definition: first.Definition(), StepIndex: 0})
	state.AddProcess(second)
	executor := NewProcessExecutor(&state, Identity{})
	fixture := &cascadingStunFixture{observedProcessPhases: observedProcessPhases{now: 100}, executor: executor, deadlines: map[string]int64{"target": 500}}
	if err := executor.FailStunnedProcesses(100, fixture, fixture); err != nil {
		t.Fatal(err)
	}
	if first.Status() != "failed" || second.Status() != "failed" || fixture.settling || fixture.reentries != 2 {
		t.Fatal("synchronous control changes escaped or repeated failure", first.Status(), second.Status(), fixture.settling, fixture.reentries, fixture.moments)
	}
	failures := 0
	for _, moment := range fixture.moments {
		if moment == "PROCESS_FAILURE" {
			failures++
		}
	}
	if failures != 2 {
		t.Fatal("process failed more than once", fixture.moments)
	}
}
