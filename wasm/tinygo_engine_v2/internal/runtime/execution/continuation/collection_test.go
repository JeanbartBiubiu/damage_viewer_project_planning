package continuation

import (
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

type collectionFixture struct {
	calls  int
	shared map[string]bool
	issue  *model.EngineError
}

func (f *collectionFixture) CopyFirstPerCast() map[string]bool             { f.calls++; return f.shared }
func (f *collectionFixture) CopyCollectionBudgetError() *model.EngineError { return f.issue }

func TestCollectionKeepsSkipAndBudgetBeforeLazyShareButCapacityAfterAppend(t *testing.T) {
	issue := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "budget")
	work := &collectionFixture{issue: &issue, shared: map[string]bool{"used": true}}
	pending := Pending{}
	collector := &Collector{}
	damage := FrozenDamage{Operation: planbundle.CompiledOperation{Operation: "damage", CopyableOnHit: true}}
	if err := pending.CollectDamage(nil, damage, 100, 1, work); err != nil || work.calls != 0 || pending.count() != 0 {
		t.Fatal(err, work, pending)
	}
	if err := pending.CollectDamage(collector, damage, 2, 1, work); err != &issue || work.calls != 0 || pending.count() != 0 {
		t.Fatal("first budget moved after lazy share", err, work, pending)
	}
	collector.damages = []FrozenDamage{{}}
	if err := pending.CollectDamage(collector, damage, 1, 1, work); err != &issue || work.calls != 1 || pending.count() != 1 || collector.Counts() != 1 {
		t.Fatal("capacity no longer checked after original append", err, work, pending, collector)
	}
	work.shared["later"] = true
	if !pending.damages[0].ConsumedFirstPerCast["later"] {
		t.Fatal("copied same-cast shared consumption")
	}
}

func TestCollectionFreezesOriginalEventEntryAndKeepsFrameFallback(t *testing.T) {
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"armor": {Resolved: 25}})
	event := &contract.EventSnapshot{EventSourceKey: "event-source", EventTargetKey: "event-target", EntryTargetAttrs: attrs}
	damage := FrozenDamage{SourceKey: "source", TargetKey: "target", EventSourceKey: "frame-source", EventTargetKey: "frame-target", EventCtx: event,
		Operation: planbundle.CompiledOperation{Operation: "damage", CopyableOnHit: true}}
	pending := Pending{}
	work := &collectionFixture{shared: map[string]bool{}}
	if err := pending.CollectDamage(&Collector{}, damage, 1, 10, work); err != nil {
		t.Fatal(err)
	}
	event.EventTargetKey = "mutated"
	got := pending.damages[0]
	if got.EventCtx == event || got.EventCtx.EventTargetKey != "event-target" || got.EventTargetKey != "event-target" || got.EntryTargetAttrs.At("armor").Resolved != 25 {
		t.Fatal("event entry defense freeze lost", got)
	}
	damage.EventCtx = nil
	if err := pending.CollectDamage(&Collector{}, damage, 1, 10, work); err != nil || pending.damages[1].EventTargetKey != "frame-target" {
		t.Fatal("frame fallback changed", err, pending.damages[1])
	}
}
