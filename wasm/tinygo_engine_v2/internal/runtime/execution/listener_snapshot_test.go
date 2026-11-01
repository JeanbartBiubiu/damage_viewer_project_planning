package execution

import (
	"fmt"
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

const listenerSnapshotEventType = "event/damage_instance"

func listenerSnapshotTrace(digit float64) model.OperationDefinition {
	return model.OperationDefinition{
		Operation: "attribute_change", Target: "source", AttributeKey: "listener_trace", ValuePolicy: "set",
		Amount: authoringAmount(authoringBinary("add",
			authoringBinary("mul", authoringRead("source.attr.listener_trace.base"), authoringConst(10)),
			authoringConst(digit))),
	}
}

func listenerSnapshotGate(amount float64) model.OperationDefinition {
	return model.OperationDefinition{
		Operation: "attribute_change", Target: "source", AttributeKey: "listener_gate", ValuePolicy: "add",
		Amount: authoringAmount(authoringConst(amount)),
	}
}

func listenerSnapshotState(t *testing.T, listenerCount int) *Engine {
	t.Helper()
	c, r := frameCommitInput()
	for _, key := range []string{"listener_trace", "listener_gate"} {
		c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
		slot := model.AttributeSlotDef{Max: 1000000000}
		c.Combatants[0].Attributes[key] = slot
		r.InitialSnapshot.Combatants[0].Attributes[key] = slot
	}
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: listenerSnapshotEventType, Domain: "event"})
	matcher := model.TypeMatcher{All: []string{listenerSnapshotEventType}}
	c.Rules.Listeners = []model.ListenerDefinition{{
		ListenerKey: "static", EventMatcher: matcher, PerCastThrottleMs: 100,
		Condition:  authoringAmount(authoringConst(1)),
		Operations: []model.OperationDefinition{listenerSnapshotTrace(1), listenerSnapshotGate(1)},
	}}
	first := model.ProviderDefinition{
		ProviderKey: "snapshot:first_def", Kind: "status", StableID: "snapshot_first",
		Listeners: []model.ListenerDefinition{{
			ListenerKey: "first", EventMatcher: matcher, PerCastThrottleMs: 100,
			Condition: authoringAmount(authoringConst(1)),
			Operations: []model.OperationDefinition{
				listenerSnapshotTrace(2),
				{Operation: "expire_provider", Target: "source", ProviderRef: "snapshot:first"},
				{Operation: "apply_provider", Target: "source", ProviderDefinitionRef: "snapshot:added_def"},
			},
		}},
	}
	followers := model.ProviderDefinition{
		ProviderKey: "snapshot:followers_def", Kind: "status", StableID: "snapshot_followers",
		Listeners: []model.ListenerDefinition{
			{ListenerKey: "second", EventMatcher: matcher, PerCastThrottleMs: 100,
				Condition: p6Eq("source.attr.listener_gate.base", 0), Operations: []model.OperationDefinition{listenerSnapshotTrace(3)}},
			{ListenerKey: "third", EventMatcher: matcher, PerCastThrottleMs: 100,
				Condition: p6Eq("source.attr.listener_gate.base", 0), Operations: []model.OperationDefinition{listenerSnapshotTrace(4)}},
		},
	}
	for index := 0; index < listenerCount-5; index++ {
		followers.Listeners = append(followers.Listeners, model.ListenerDefinition{
			ListenerKey: fmt.Sprintf("padding_%02d", index), EventMatcher: matcher, PerCastThrottleMs: 100,
			Condition: authoringAmount(authoringConst(1)), Operations: []model.OperationDefinition{listenerSnapshotGate(0)},
		})
	}
	// 拒绝条件放在第16/17槽，直接检查内联与分配数组两侧的最后一项。
	followers.Listeners = append(followers.Listeners, model.ListenerDefinition{
		ListenerKey: "rejected", EventMatcher: matcher, PerCastThrottleMs: 100,
		Condition: p6Eq("source.attr.listener_gate.base", 1), Operations: []model.OperationDefinition{listenerSnapshotTrace(9)},
	})
	added := model.ProviderDefinition{
		ProviderKey: "snapshot:added_def", Kind: "status", StableID: "snapshot_added",
		Listeners: []model.ListenerDefinition{{
			ListenerKey: "added", EventMatcher: matcher, PerCastThrottleMs: 100,
			Condition: authoringAmount(authoringConst(1)), Operations: []model.OperationDefinition{listenerSnapshotTrace(9)},
		}},
	}
	c.SharedProviders = append(c.SharedProviders, first, followers, added)
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers,
		model.CombatantProviderSnapshot{ProviderRef: "snapshot:first", DefinitionRef: first.ProviderKey, Source: "source", Owner: "source", Stacks: 1},
		model.CombatantProviderSnapshot{ProviderRef: "snapshot:followers", DefinitionRef: followers.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	return frameCommitState(t, c, r)
}

func listenerSnapshotEvent(state *Engine, castID uint64) emittedEvent {
	snapshot := state.newExecutionFrame("source", "target", "snapshot").captureEmitSnapshot(listenerSnapshotEventType, "source", "target")
	snapshot.CastInstanceID = castID
	return emittedEvent{eventType: listenerSnapshotEventType, sourceKey: "source", targetKey: "target",
		types: []string{listenerSnapshotEventType}, snapshot: snapshot, castInstanceID: castID}
}

func TestListenerSnapshotFreezesDynamicMembershipConditionsAndIndices(t *testing.T) {
	for _, listenerCount := range []int{16, 17} {
		t.Run(fmt.Sprintf("conditions_%d", listenerCount), func(t *testing.T) {
			state := listenerSnapshotState(t, listenerCount)
			original := append([]planbundle.CompiledListener(nil), state.compiled.Listeners...)
			original = append(original, state.listeners.FreezeDynamic()...)
			if len(state.compiled.Listeners) != 1 || len(original) != listenerCount || original[1].ListenerKey != "first" || original[listenerCount-1].ListenerKey != "rejected" {
				t.Fatalf("unexpected listener fixture: compiled=%d listeners=%+v", len(state.compiled.Listeners), original)
			}
			for _, listener := range original {
				if !listener.HasCondition {
					t.Fatalf("listener %q did not exercise condition freezing", listener.ListenerKey)
				}
			}

			// 静态项先改门值；动态首项再解绑自身并新增。原后继仍按冻结条件和顺序执行。
			const firstCastID = uint64(31)
			if err := state.dispatchListeners(listenerSnapshotEvent(state, firstCastID), 0); err != nil {
				t.Fatal(err)
			}
			attrs := state.combatants["source"].attributesView()
			if attrs.At("listener_trace").Base != 1234 || attrs.At("listener_gate").Base != 1 {
				t.Fatalf("frozen order or conditions changed: trace=%v gate=%v", attrs.At("listener_trace").Base, attrs.At("listener_gate").Base)
			}
			for index, listener := range original {
				triggered := !state.listeners.Allow(index, listener.OwnerCombatantKey, listener.OwnerProviderRef, firstCastID, 1, state.loop.TimeMs())
				if want := listener.ListenerKey != "rejected"; triggered != want {
					t.Fatalf("listener %q frozen index=%d trigger=%t", listener.ListenerKey, index, triggered)
				}
			}
			if state.listeners.DynamicLen() != listenerCount-1 || state.listeners.DynamicAt(0).ListenerKey != "second" ||
				state.listeners.DynamicAt(state.listeners.DynamicLen()-1).ListenerKey != "added" {
				t.Fatalf("provider operations did not replace the dynamic first item: %+v", state.listeners.FreezeDynamic())
			}

			// 新项从下一事件开始参与；门值反向条件也必须在静态项再次改值前冻结。
			if err := state.dispatchListeners(listenerSnapshotEvent(state, firstCastID+1), 0); err != nil {
				t.Fatal(err)
			}
			attrs = state.combatants["source"].attributesView()
			if attrs.At("listener_trace").Base != 1234199 || attrs.At("listener_gate").Base != 2 {
				t.Fatalf("next-event membership or condition freeze changed: trace=%v gate=%v", attrs.At("listener_trace").Base, attrs.At("listener_gate").Base)
			}
		})
	}
}
