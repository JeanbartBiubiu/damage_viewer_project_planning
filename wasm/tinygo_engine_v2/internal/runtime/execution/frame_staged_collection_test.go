package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"reflect"
	"testing"
)

func TestFrameStagedCollectionNilEmptyAndReplacement(t *testing.T) {
	for _, staged := range []*frameStagedCollection{nil, {}} {
		if staged.Len() != 0 || staged.Get("missing") != nil {
			t.Fatal("nil or empty collection returned a combatant")
		}
		if _, exists := staged.Lookup("missing"); exists {
			t.Fatal("nil or empty collection reported a present key")
		}
		staged.Range(func(string, *stagedCombatant) { t.Fatal("empty collection visited an entry") })
		var buffer [2]string
		if keys := sortedFrameCombatantKeys(staged, buffer[:0]); len(keys) != 0 {
			t.Fatal("empty collection produced commit keys")
		}
	}
	staged := &frameStagedCollection{}
	first := &stagedCombatant{cooldowns: actionpkg.CooldownLedgerFromDeadlines("", map[string]int64{"zero": 0})}
	replacement := &stagedCombatant{}
	staged.Set("", first)
	staged.Set("source", nil)
	if value, exists := staged.Lookup("source"); !exists || value != nil || staged.Len() != 2 || staged.extra != nil {
		t.Fatal("explicit nil entry or inline capacity was lost")
	}
	staged.Set("source", replacement)
	if staged.Get("source") != replacement || staged.Get("") != first || staged.Len() != 2 || staged.extra != nil {
		t.Fatal("replacing an inline entry changed its identity or count")
	}
	if value, exists := staged.Get("").cooldowns.Entry(actionpkg.AbilityCooldownIdentity("", "zero")); !exists || value.ReadyAt != 0 {
		t.Fatal("explicit zero cooldown was lost")
	}
	staged.Set("extra", first)
	if staged.Len() != 3 || staged.extra == nil || staged.Get("extra") != first {
		t.Fatal("third entry did not enter the additional map")
	}
	staged.Set("extra", replacement)
	staged.Set("fourth", nil)
	if staged.Len() != 4 || staged.Get("extra") != replacement {
		t.Fatal("replacing an extra entry changed the count")
	}
	if value, exists := staged.Lookup("fourth"); !exists || value != nil {
		t.Fatal("explicit nil extra entry was lost")
	}
	visited := map[string]*stagedCombatant{}
	staged.Range(func(key string, value *stagedCombatant) { visited[key] = value })
	if !reflect.DeepEqual(visited, map[string]*stagedCombatant{"": first, "source": replacement, "extra": replacement, "fourth": nil}) {
		t.Fatal("range lost or duplicated entries")
	}
}

func TestFrameStagedCollectionRangeReadsReplacementAtVisit(t *testing.T) {
	staged := &frameStagedCollection{}
	first, second, extra := &stagedCombatant{}, &stagedCombatant{}, &stagedCombatant{}
	nextFirst, nextSecond, nextExtra := &stagedCombatant{}, &stagedCombatant{}, &stagedCombatant{}
	staged.Set("source", first)
	staged.Set("target", second)
	staged.Set("extra", extra)
	visited := map[string]*stagedCombatant{}
	staged.Range(func(key string, value *stagedCombatant) {
		visited[key] = value
		if key == "source" {
			staged.Set("source", nextFirst)
			staged.Set("target", nextSecond)
			staged.Set("extra", nextExtra)
		}
	})
	if visited["source"] != first || visited["target"] != nextSecond || visited["extra"] != nextExtra || staged.Get("source") != nextFirst || staged.Len() != 3 {
		t.Fatal("range froze later values before replacements or revisited an entry")
	}
}

func TestFrameStagedCollectionKeysKeepLexicalOrderAcrossExtraBoundary(t *testing.T) {
	staged := &frameStagedCollection{}
	for _, key := range []string{"aa", "aA", "a", ""} {
		staged.Set(key, nil)
		staged.Set(key, nil)
	}
	buffer := [2]string{"untouched0", "untouched1"}
	keys := sortedFrameCombatantKeys(staged, buffer[:0])
	if !reflect.DeepEqual(keys, []string{"", "a", "aA", "aa"}) || buffer != [2]string{"untouched0", "untouched1"} {
		t.Fatal("extra keys lost lexical order or changed the small caller buffer")
	}
}

func TestFrameStagedCollectionWaitingShareAndReinitializedFrameStayIndependent(t *testing.T) {
	state := waitingTestState(t)
	var frame, context Frame
	state.initExecutionFrame(&frame, "target", "target", "parent")
	frame.stageFor("source")
	if err := frame.basicAttackWaitContext(&context); err != nil {
		t.Fatal(err)
	}
	if context.staged != frame.staged {
		t.Fatal("ordinary waiting context did not share the parent collection")
	}
	target := context.stageFor("target")
	context.stageFor("extra")
	if frame.staged.Get("target") != target || frame.staged.Len() != 3 || frame.staged.extra == nil {
		t.Fatal("waiting context did not publish new staging entries to parent")
	}
	if err := context.applyCooldownChange("target", "zero", 0); err != nil {
		t.Fatal(err)
	}
	oldCollection := frame.staged
	state.initExecutionFrame(&frame, "target", "target", "fresh")
	if frame.staged == oldCollection || frame.staged.Len() != 0 || frame.staged.extra != nil {
		t.Fatal("reinitialization retained an earlier shared collection")
	}
	if frame.stageFor("target") == target {
		t.Fatal("fresh frame reused an earlier uncommitted combatant")
	}
	if err := frame.applyCooldownChange("target", "zero", 100); err != nil {
		t.Fatal(err)
	}
	if value, exists := target.cooldowns.Entry(actionpkg.AbilityCooldownIdentity("target", "zero")); !exists || value.ReadyAt != 0 || oldCollection.Len() != 3 || context.staged != oldCollection {
		t.Fatal("fresh frame changed an earlier waiting collection or explicit zero")
	}
	if _, exists := state.combatants["target"].cooldowns.Entry(actionpkg.AbilityCooldownIdentity("target", "zero")); exists {
		t.Fatal("collection writes published before commit")
	}
}

func TestFrameStagedCollectionTwoEntriesNeedNoExtraAllocation(t *testing.T) {
	first, second := &stagedCombatant{}, &stagedCombatant{}
	allocations := testing.AllocsPerRun(100, func() {
		var staged frameStagedCollection
		staged.Set("source", first)
		staged.Set("target", second)
		staged.Set("source", first)
		var keyBuffer [2]string
		keys := sortedFrameCombatantKeys(&staged, keyBuffer[:0])
		if staged.Get("source") != first || staged.Get("target") != second || staged.Len() != 2 || staged.extra != nil || len(keys) != 2 || keys[0] != "source" || keys[1] != "target" {
			t.Fatal("two-entry collection changed its values or ordering")
		}
	})
	if allocations != 0 {
		t.Fatalf("two-entry collection or commit key buffer allocated: %g", allocations)
	}
	t.Logf("frameStagedCollectionBytes=%d", reflect.TypeOf(frameStagedCollection{}).Size())
}
