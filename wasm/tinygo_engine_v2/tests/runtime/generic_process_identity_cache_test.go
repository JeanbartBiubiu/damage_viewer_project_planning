// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	sort "sort"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

func identityCacheOriginalMount(p *actionpkg.ProcessView) string {
	return p.Owner() + "\x00" + p.ProviderRef() + "\x00" + p.ProcessKey()
}

func identityCacheOriginalStable(p *actionpkg.ProcessView) string {
	return identityCacheOriginalMount(p) + "\x00" + p.UseKey()
}

func identityCacheFixtures() []*actionpkg.ProcessView {
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
	rows := make([]*actionpkg.ProcessView, 0, len(identities))
	for index, identity := range identities {
		p := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{
			Owner: identity.owner, ProviderRef: identity.provider, ProcessKey: identity.process, UseKey: identity.use,
			Status:            []string{"active", "complete", "failed"}[index%3],
			ActualCosts:       map[string]float64{"mana": float64(index + 1)},
			Repeat:            &model.ProcessRepeatSnapshot{ExecutionCount: 3, ExecutionIndex: 1},
			ActionOccupancies: []model.ProcessActionOccupancy{{StepKey: "occupancy", StepVersion: 1}},
		}})
		rows = append(rows, p)
	}
	return rows
}

func TestProcessIdentityCacheKeepsDelimitedBytesAndEqualKeyOrder(t *testing.T) {
	processes := identityCacheFixtures()
	for _, p := range processes {
		if p.MountKey() != identityCacheOriginalMount(p) || p.StableKey() != identityCacheOriginalStable(p) {
			t.Fatalf("cached identity changed original bytes: %+v", p.Snapshot())
		}
		for _, other := range processes {
			want := identityCacheOriginalMount(p) < identityCacheOriginalMount(other)
			if identityCacheOriginalMount(p) == identityCacheOriginalMount(other) {
				want = p.UseKey() < other.UseKey()
			}
			if actionpkg.ProcessLess(p, other) != want {
				t.Fatal("snapshot comparator changed mountKey then useKey order")
			}
		}
	}
	// 这两个合法身份具有相同的旧完整键，但不同的 mountKey。
	a, b := processes[9], processes[10]
	if a.StableKey() != b.StableKey() || a.MountKey() == b.MountKey() || !actionpkg.ProcessLess(a, b) {
		t.Fatal("NUL-delimited equal stable keys lost their original snapshot distinction")
	}
	// 完整键排序与快照的 mountKey/useKey 排序不能互换。
	a, b = processes[11], processes[12]
	if !actionpkg.ProcessLess(a, b) || a.StableKey() < b.StableKey() {
		t.Fatal("prefix case did not preserve the two different ordering contracts")
	}
	want := append([]*actionpkg.ProcessView(nil), processes...)
	got := append([]*actionpkg.ProcessView(nil), processes...)
	sort.Slice(want, func(i, j int) bool {
		return identityCacheOriginalStable(want[i]) < identityCacheOriginalStable(want[j])
	})
	sort.Slice(got, func(i, j int) bool { return got[i].StableKey() < got[j].StableKey() })
	if !reflect.DeepEqual(got, want) {
		t.Fatal("full-instance stable sort changed the old relative order of equal keys")
	}
}

func TestProcessIdentityCacheComparisonsDoNotAllocate(t *testing.T) {
	processes := identityCacheFixtures()
	a, b := processes[2], processes[1]
	var ordered bool
	allocations := testing.AllocsPerRun(100, func() {
		ordered = a.StableKey() < b.StableKey() && actionpkg.ProcessLess(a, b) && a.MountKey() == b.MountKey()
	})
	if !ordered || allocations != 0 {
		t.Fatalf("cached common comparisons: ordered=%v allocations=%v", ordered, allocations)
	}
}
