package actor

import (
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
)

func TestStateAndChangeSetKeepPublishedAndFrozenViews(t *testing.T) {
	raw := map[string]model.ResourceSlotDef{"mana": {Current: 50, Max: 100}}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Current: 100, Max: 100}})
	state := New("source", attrs, raw).WithHPMaxAnchor(100)
	raw["mana"] = model.ResourceSlotDef{Current: 99}
	if state.Resources().At("mana").Current != 50 {
		t.Fatal("author map aliases committed state")
	}
	changes := Stage(state)
	changes.SetResource("mana", model.ResourceSlotDef{Current: 40, Max: 100})
	firstWritable := changes.resources
	changes.SetResource("mana", model.ResourceSlotDef{Current: 35, Max: 100})
	if firstWritable["mana"].Current != 35 {
		t.Fatal("consecutive writes did not reuse exclusive map")
	}
	frozen := changes.FreezeResources()
	changes.SetResource("mana", model.ResourceSlotDef{Current: 25, Max: 100})
	if frozen.At("mana").Current != 35 || state.Resources().At("mana").Current != 50 {
		t.Fatal("later write changed frozen resource view")
	}
	changes.SetAttributes(attrs.With("hp", model.AttributeSlotDef{Current: 80, Max: 100}))
	published := changes.Publish(state)
	changes.SetResource("mana", model.ResourceSlotDef{Current: 70, Max: 100})
	changes.SetAttributes(attrs.With("hp", model.AttributeSlotDef{Current: 60, Max: 100}))
	if published.Resources().At("mana").Current != 25 || published.Attributes().At("hp").Current != 80 || published.HPMaxAnchor() != 100 {
		t.Fatal("continued frame changed committed numeric state")
	}
	if state.Attributes().At("hp").Current != 100 {
		t.Fatal("staging changed entry attributes")
	}
}

func TestZeroResourcesAndFailedStageRemainDistinct(t *testing.T) {
	state := New("target", attribute.Table{}, nil)
	changes := Stage(state)
	changes.SetResource("zero", model.ResourceSlotDef{})
	if _, exists := changes.Resources().Lookup("zero"); !exists {
		t.Fatal("explicit zero disappeared")
	}
	if _, exists := changes.Resources().Lookup("absent"); exists {
		t.Fatal("missing slot became zero")
	}
	if state.Resources().Len() != 0 {
		t.Fatal("unpublished changes escaped")
	}
	copy := changes.Publish(state).Resources().ToMap()
	copy["zero"] = model.ResourceSlotDef{Current: 99}
	if changes.Resources().At("zero").Current != 0 {
		t.Fatal("protocol export aliases runtime state")
	}
}
