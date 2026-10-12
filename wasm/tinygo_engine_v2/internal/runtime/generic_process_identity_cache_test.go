package runtime

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func identityCacheOriginalMount(p *processRuntime) string {
	return p.Owner + "\x00" + p.ProviderRef + "\x00" + p.ProcessKey
}

func identityCacheOriginalStable(p *processRuntime) string {
	return identityCacheOriginalMount(p) + "\x00" + p.UseKey
}

func identityCacheFixtures() []*processRuntime {
	identities := []struct{ owner, provider, process, use string }{
		{"target", "a", "p", "u1"},
		{"source", "a", "p", "u10"},
		{"source", "a", "p", "u1"},
		{"source", "aa", "p", "u2"},
		{"source", "a-1", "p:1", "use/1"},
		{"source", "a.1", "p_1", "use:1"},
		{"source", "a:1", "p-1", "use_1"},
		{"source", "a/1", "p.1", "use-1"},
		{"source", "装备:甲", "阶段/一", "施放:一"},
		{"source", "a", "q", "a\x00b"},
		{"source", "a", "q\x00a", "b"},
		{"source", "a", "q", "z"},
		{"source", "a", "q\x00a", "a"},
		{"source", "a", "pa", "u3"},
		{"source", "z", "p", "u4"},
		{"source", "a_1", "p", "u5"},
	}
	rows := make([]*processRuntime, 0, len(identities))
	for index, identity := range identities {
		p := &processRuntime{ProcessInstanceSnapshot: model.ProcessInstanceSnapshot{
			Owner: identity.owner, ProviderRef: identity.provider, ProcessKey: identity.process, UseKey: identity.use,
			Status:            []string{"active", "complete", "failed"}[index%3],
			ActualCosts:       map[string]float64{"mana": float64(index + 1)},
			Repeat:            &model.ProcessRepeatSnapshot{ExecutionCount: 3, ExecutionIndex: 1},
			ActionOccupancies: []model.ProcessActionOccupancy{{StepKey: "occupancy", StepVersion: 1}},
		}}
		p.cacheIdentityKeys()
		rows = append(rows, p)
	}
	return rows
}

func TestProcessIdentityCacheKeepsDelimitedBytesAndEqualKeyOrder(t *testing.T) {
	processes := identityCacheFixtures()
	for _, p := range processes {
		if processInstanceMountKey(p) != identityCacheOriginalMount(p) || processStableKey(p) != identityCacheOriginalStable(p) {
			t.Fatalf("cached identity changed original bytes: %+v", p.ProcessInstanceSnapshot)
		}
		for _, other := range processes {
			want := identityCacheOriginalMount(p) < identityCacheOriginalMount(other)
			if identityCacheOriginalMount(p) == identityCacheOriginalMount(other) {
				want = p.UseKey < other.UseKey
			}
			if processSnapshotLess(p, other) != want {
				t.Fatal("snapshot comparator changed mountKey then useKey order")
			}
		}
	}
	// 这两个合法身份具有相同的旧完整键，但不同的 mountKey。
	a, b := processes[9], processes[10]
	if processStableKey(a) != processStableKey(b) || processInstanceMountKey(a) == processInstanceMountKey(b) || !processSnapshotLess(a, b) {
		t.Fatal("NUL-delimited equal stable keys lost their original snapshot distinction")
	}
	// 完整键排序与快照的 mountKey/useKey 排序不能互换。
	a, b = processes[11], processes[12]
	if !processSnapshotLess(a, b) || processStableKey(a) < processStableKey(b) {
		t.Fatal("prefix case did not preserve the two different ordering contracts")
	}
	want := append([]*processRuntime(nil), processes...)
	got := append([]*processRuntime(nil), processes...)
	sort.Slice(want, func(i, j int) bool {
		return identityCacheOriginalStable(want[i]) < identityCacheOriginalStable(want[j])
	})
	sort.Slice(got, func(i, j int) bool { return processStableKey(got[i]) < processStableKey(got[j]) })
	if !reflect.DeepEqual(got, want) {
		t.Fatal("full-instance stable sort changed the old relative order of equal keys")
	}
}

func TestProcessIdentityCacheSnapshotOrderAndCopiesStayIndependent(t *testing.T) {
	processes := identityCacheFixtures()
	originalOrder := append([]*processRuntime(nil), processes...)
	want := make([]model.ProcessInstanceSnapshot, 0, len(processes))
	for _, p := range processes {
		want = append(want, p.ProcessInstanceSnapshot)
	}
	sort.Slice(want, func(i, j int) bool {
		a, b := want[i], want[j]
		ka, kb := a.Owner+"\x00"+a.ProviderRef+"\x00"+a.ProcessKey, b.Owner+"\x00"+b.ProviderRef+"\x00"+b.ProcessKey
		if ka != kb {
			return ka < kb
		}
		return a.UseKey < b.UseKey
	})
	state := genericRunState{processInstances: processes}
	got := state.snapshotProcesses()
	wantJSON, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	gotJSON, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotJSON) != string(wantJSON) || !reflect.DeepEqual(state.processInstances, originalOrder) {
		t.Fatal("snapshot bytes changed or snapshot sorting reordered live instances")
	}
	for index := range got {
		p := processes[0]
		for _, candidate := range processes {
			if candidate.Owner == got[index].Owner && candidate.ProviderRef == got[index].ProviderRef && candidate.ProcessKey == got[index].ProcessKey && candidate.UseKey == got[index].UseKey {
				p = candidate
				break
			}
		}
		cost := p.ActualCosts["mana"]
		got[index].ActualCosts["mana"] = -1
		got[index].Repeat.ExecutionIndex++
		got[index].ActionOccupancies[0].StepVersion++
		if p.ActualCosts["mana"] != cost || p.Repeat.ExecutionIndex != 1 || p.ActionOccupancies[0].StepVersion != 1 {
			t.Fatal("snapshot mutable data leaked into a runtime with cached identity")
		}
	}
	for _, input := range [][]*processRuntime{nil, {}, processes[:1]} {
		small := genericRunState{processInstances: input}
		rows := small.snapshotProcesses()
		if rows == nil || len(rows) != len(input) {
			t.Fatal("zero/one-process snapshot shape changed")
		}
	}
}

func TestProcessIdentityCacheStartRestoreAndFailedFrameIsolation(t *testing.T) {
	for _, identity := range []struct{ name, provider, process, use string }{
		{"special characters", "gear:甲/a-1", "phase:乙/a-1", "use:甲/a-1"},
		{"NUL identity", "gear:甲/a-1", "q\x00a", "a\x00b"},
	} {
		t.Run(identity.name, func(t *testing.T) {
			input, request := processBase(t, "CHARGE")
			input.Combatants[0].Providers[0].ProviderRef = identity.provider
			request.InitialSnapshot.Combatants[0].Providers[0].ProviderRef = identity.provider
			input.SharedProviders[0].Processes[0].ProcessKey = identity.process
			for index := range input.SharedProviders[0].Abilities {
				input.SharedProviders[0].Abilities[index].ProcessControl.ProcessKey = identity.process
			}
			request.DriverPlan.Entries[0].AbilityRef = "source.provider[" + identity.provider + "].ability[start]"
			request.SkillUses[0].UseKey = identity.use
			request.ProcessCommandFacts[0].UseRef = identity.use
			request.StopPolicy.DurationMs = 100
			compiled := authoringCompile(t, input)
			request.ExpectedRulesHash = compiled.RulesHash
			state, err := newGenericRunState(compiled, request)
			if err != nil {
				t.Fatal(err)
			}
			if err := state.runLoop(); err != nil {
				t.Fatal(err)
			}
			if len(state.processInstances) != 1 {
				t.Fatal("missing production-started process")
			}
			started := state.processInstances[0]
			if started.mountKey == "" || started.stableKey == "" || processStableKey(started) != identityCacheOriginalStable(started) {
				t.Fatal("startProcess did not initialize its identity cache")
			}
			before := state.buildDoneResult()
			resume := request
			resume.InitialSnapshot = before.FinalSnapshot
			resume.DriverPlan.Entries = nil
			resume.ProcessCommandFacts = nil
			resume.StopPolicy.DurationMs = 600
			restoredState, err := newGenericRunState(compiled, resume)
			if err != nil {
				t.Fatal(err)
			}
			restored := restoredState.processInstances[0]
			if restored == started || restored.mountKey != started.mountKey || restored.stableKey != started.stableKey {
				t.Fatal("restoreProcess lost cached identity or reused the old runtime")
			}
			var timer scheduler.GenericEvent
			for {
				event, present := restoredState.heap.Pop()
				if !present {
					break
				}
				if event.Kind == scheduler.GenericEventProcessTimer {
					timer = event
				}
			}
			if timer.ProcessSortKey != started.stableKey {
				t.Fatal("restored scheduler timer did not use the original stable key bytes")
			}
			var frame executionFrame
			restoredState.initProcessFrame(&frame, restored)
			pending := frame.pendingProcess
			if pending.mountKey != restored.mountKey || pending.stableKey != restored.stableKey {
				t.Fatal("process frame copy discarded identity cache")
			}
			pending.Status = "failed"
			pending.ActualCosts["audit"] = 1
			frame.fatal = true
			frame.commit()
			if restored.Status != "active" || restored.ActualCosts["audit"] != 0 || restored.stableKey != started.stableKey {
				t.Fatal("failed frame changed the live process or its identity")
			}
			if err := restoredState.finishProcess(restored, "failed", "ACTIVE_CANCELLED"); err != nil {
				t.Fatal(err)
			}
			if restored.Status != "failed" || restored.mountKey != started.mountKey || restored.stableKey != started.stableKey || timer.ProcessSortKey != restored.stableKey {
				t.Fatal("successful lifecycle publication or stale timer changed cached identity")
			}
			if started.Status != "active" || before.FinalSnapshot.ProcessInstances[0].Status != "active" || pending.ActualCosts["audit"] != 1 {
				t.Fatal("published failure changed an earlier runtime, snapshot, or pending copy")
			}
		})
	}
}

func TestProcessIdentityCacheManualAndZeroValueKeepInternalCompleteness(t *testing.T) {
	for _, p := range []*processRuntime{{}, {ProcessInstanceSnapshot: model.ProcessInstanceSnapshot{Owner: "source", ProviderRef: "a", ProcessKey: "p", UseKey: "u"}}} {
		if processInstanceMountKey(p) != identityCacheOriginalMount(p) || processStableKey(p) != identityCacheOriginalStable(p) || p.mountKey != "" || p.stableKey != "" {
			t.Fatal("uncached internal process no longer preserves its field identity")
		}
		p.cacheIdentityKeys()
		if p.mountKey == "" || p.stableKey == "" || processStableKey(p) != identityCacheOriginalStable(p) {
			t.Fatal("even zero field identities must have nonempty delimited cached keys")
		}
	}
}

func TestProcessIdentityCacheComparisonsDoNotAllocate(t *testing.T) {
	processes := identityCacheFixtures()
	a, b := processes[2], processes[1]
	var ordered bool
	allocations := testing.AllocsPerRun(100, func() {
		ordered = processStableKey(a) < processStableKey(b) && processSnapshotLess(a, b) && processInstanceMountKey(a) == processInstanceMountKey(b)
	})
	if !ordered || allocations != 0 {
		t.Fatalf("cached common comparisons: ordered=%v allocations=%v", ordered, allocations)
	}
}
