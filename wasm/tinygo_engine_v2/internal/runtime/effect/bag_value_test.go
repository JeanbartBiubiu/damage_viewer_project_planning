package effect

import (
	"fmt"
	"math"

	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestProviderStateBagLazyExpireAndRefreshExpireAt(t *testing.T) {
	bag := &bagData{
		state:    map[string]float64{"stacks": 0},
		expireAt: map[string]int64{},
		fieldDefs: map[string]FieldDefinition{
			"stacks": {
				DefaultValue:  0,
				MaxValue:      4,
				HasCap:        true,
				DurationMs:    3000,
				RefreshPolicy: model.ProviderStateRefreshOnWrite,
			},
		},
		targetValues: map[string]float64{},
	}
	bag.state["stacks"] = bag.clampProviderStateValue("stacks", 5)
	if bag.state["stacks"] != 4 {
		t.Fatalf("clamp=%v want 4", bag.state["stacks"])
	}
	bag.refreshExpireAtOnWrite("stacks", 1000)
	if bag.expireAt["stacks"] != 4000 {
		t.Fatalf("expireAt=%d want 4000", bag.expireAt["stacks"])
	}
	bag.refreshExpireAtOnWrite("stacks", 2500)
	if bag.expireAt["stacks"] != 5500 {
		t.Fatalf("expireAt after refresh=%d want 5500", bag.expireAt["stacks"])
	}
	bag.state["stacks"] = 3
	bag.lazyExpireProviderState(5499)
	if bag.state["stacks"] != 3 {
		t.Fatalf("before expire stacks=%v want 3", bag.state["stacks"])
	}
	bag.lazyExpireProviderState(5500)
	if bag.state["stacks"] != 0 {
		t.Fatalf("lazy expire stacks=%v want 0", bag.state["stacks"])
	}
	if bag.expireAt["stacks"] != 0 {
		t.Fatalf("expireAt cleared=%d want 0", bag.expireAt["stacks"])
	}
}

func TestProviderStateStartOnFirstWriteDoesNotRefresh(t *testing.T) {
	bag := &bagData{
		state:    map[string]float64{"hits": 1},
		expireAt: map[string]int64{},
		fieldDefs: map[string]FieldDefinition{
			"hits": {DefaultValue: 0, DurationMs: 2000, RefreshPolicy: model.ProviderStateRefreshStartOnFirstWrite},
		},
	}
	if !bag.refreshExpireAtOnWrite("hits", 1000) || bag.expireAt["hits"] != 3000 {
		t.Fatalf("first write expireAt=%d want 3000", bag.expireAt["hits"])
	}
	bag.state["hits"] = 4
	if !bag.refreshExpireAtOnWrite("hits", 1500) || bag.expireAt["hits"] != 3000 {
		t.Fatalf("later write must keep expireAt=3000, got %d", bag.expireAt["hits"])
	}
	bag.state["hits"] = 0
	if !bag.refreshExpireAtOnWrite("hits", 1600) || bag.expireAt["hits"] != 0 {
		t.Fatalf("default write must clear expireAt, got %d", bag.expireAt["hits"])
	}
	if _, ok := addDuration(math.MaxInt64-1, 10); ok {
		t.Fatal("overflow must fail")
	}
}

func TestRefreshOnWriteConsumedWindowCanRestore(t *testing.T) {
	for _, target := range []bool{false, true} {
		t.Run(fmt.Sprintf("target_%v", target), func(t *testing.T) {
			bag := &bagData{
				state: map[string]float64{}, expireAt: map[string]int64{},
				targetValues: map[string]float64{}, targetExpireAt: map[string]int64{},
				fieldDefs: map[string]FieldDefinition{"ready": {DefaultValue: 0, DurationMs: 10000, RefreshPolicy: model.ProviderStateRefreshOnWrite}},
			}
			values, expires := bag.state, bag.expireAt
			write := func(now int64) {
				if !bag.refreshExpireAtOnWrite("ready", now) {
					t.Fatal("refresh failed")
				}
			}
			if target {
				bag.targetKey = "target"
				values, expires = bag.targetValues, bag.targetExpireAt
				write = func(now int64) {
					if _, ok := bag.refreshTargetExpireAtOnWrite("ready", now); !ok {
						t.Fatal("target refresh failed")
					}
				}
			}
			values["ready"] = 1
			write(0)
			write(9000)
			if expires["ready"] != 19000 {
				t.Fatalf("refresh expiry=%d want 19000", expires["ready"])
			}
			values["ready"] = 0
			write(11000)
			if err := restoreBagTimers(bag, 11000, map[string]bool{"source": true, "target": true}, "state", "schema", "rules", "session"); err != nil {
				t.Fatalf("consumed window must yield restorable state: %+v", err)
			}
			if expires["ready"] != 0 {
				t.Fatalf("consumption must clear expiry, got %d", expires["ready"])
			}
		})
	}
}

func TestProviderTargetStateBagCapDurationRefreshAndClear(t *testing.T) {
	bag := &bagData{
		state:    map[string]float64{},
		expireAt: map[string]int64{},
		fieldDefs: map[string]FieldDefinition{
			"carve_stacks": {
				DefaultValue:  0,
				MaxValue:      5,
				HasCap:        true,
				DurationMs:    6000,
				RefreshPolicy: model.ProviderStateRefreshOnWrite,
			},
		},
		targetValues:   map[string]float64{},
		targetExpireAt: map[string]int64{},
	}
	bag.targetKey = "target"
	bag.targetValues["carve_stacks"] = bag.clampProviderStateValue("carve_stacks", 6)
	if bag.targetValues["carve_stacks"] != 5 {
		t.Fatalf("cap=%v want 5", bag.targetValues["carve_stacks"])
	}
	exp, ok := bag.refreshTargetExpireAtOnWrite("carve_stacks", 1000)
	if !ok || exp != 7000 || bag.targetExpireAt["carve_stacks"] != 7000 {
		t.Fatalf("expireAt=%d ok=%v want 7000", bag.targetExpireAt["carve_stacks"], ok)
	}

	bag.targetValues["carve_stacks"] = bag.clampProviderStateValue("carve_stacks", bag.targetValues["carve_stacks"]+1)
	exp2, ok := bag.refreshTargetExpireAtOnWrite("carve_stacks", 2500)
	if bag.targetValues["carve_stacks"] != 5 {
		t.Fatalf("at-cap value=%v want 5", bag.targetValues["carve_stacks"])
	}
	if !ok || exp2 != 8500 {
		t.Fatalf("refresh expireAt=%d ok=%v want 8500", exp2, ok)
	}
	bag.lazyExpireProviderTargetState(8499)
	if bag.targetValues["carve_stacks"] != 5 {
		t.Fatalf("before expire stacks=%v want 5", bag.targetValues["carve_stacks"])
	}
	bag.lazyExpireProviderTargetState(8500)
	if bag.targetValues["carve_stacks"] != 0 {
		t.Fatalf("lazy expire stacks=%v want 0", bag.targetValues["carve_stacks"])
	}
	bag.targetKey = "target"
	bag.targetValues["carve_stacks"] = 3
	bag.targetExpireAt["carve_stacks"] = 9000
	bag.clearProviderTargetState()
	if bag.targetKey != "" || len(bag.targetValues) != 0 || len(bag.targetExpireAt) != 0 {
		t.Fatalf("clearProviderTargetState incomplete: %+v", bag)
	}
}

// TestProviderTargetStateNonZeroDefaultFirstAddAndExpire: first add starts from defaultValue;
// expiry restores the same default (not hard-coded 0).
func TestProviderTargetStateNonZeroDefaultFirstAddAndExpire(t *testing.T) {
	const def = 2.0
	bag := &bagData{}
	bag.bindFieldDefs(NewFields(map[string]FieldDefinition{
		"hits": {
			DefaultValue:  def,
			MaxValue:      10,
			HasCap:        true,
			DurationMs:    1000,
			RefreshPolicy: model.ProviderStateRefreshOnWrite,
		},
	}))
	bag.activateProviderTarget("target")
	if got := bag.readTargetValue("hits"); got != def {
		t.Fatalf("after activate hits=%v want default %v", got, def)
	}
	bag.seedTargetValueIfAbsent("hits")
	next, ok := ApplyStatePolicy(bag.readTargetValue("hits"), 1, "add")
	if !ok {
		t.Fatal("applyStatePolicy failed")
	}
	bag.targetValues["hits"] = bag.clampProviderStateValue("hits", next)
	if bag.targetValues["hits"] != def+1 {
		t.Fatalf("first add hits=%v want %v", bag.targetValues["hits"], def+1)
	}
	bag.refreshTargetExpireAtOnWrite("hits", 0)
	bag.lazyExpireProviderTargetState(1000)
	if bag.targetValues["hits"] != def {
		t.Fatalf("after expire hits=%v want default %v", bag.targetValues["hits"], def)
	}

	bag.activateProviderTarget("source")
	if bag.targetKey != "source" {
		t.Fatalf("targetKey=%q want source", bag.targetKey)
	}
	if _, exists := bag.targetValues["hits"]; exists {
		t.Fatalf("switch must clear prior values, got %+v", bag.targetValues)
	}
	if bag.readTargetValue("hits") != def {
		t.Fatalf("after switch read hits=%v want default %v", bag.readTargetValue("hits"), def)
	}
	bag.seedTargetValueIfAbsent("hits")
	if bag.targetValues["hits"] != def {
		t.Fatalf("after switch seed hits=%v want default %v", bag.targetValues["hits"], def)
	}
}
