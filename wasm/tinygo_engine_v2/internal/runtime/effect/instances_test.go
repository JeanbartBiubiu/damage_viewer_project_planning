package effect

import (
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func instanceTestState() InstanceState {
	return NewInstances(Providers([]Provider{{ProviderRef: "finite", DefinitionRef: "bonus", Source: "source", Owner: "target", ExpireAt: 1000, Stacks: 1, State: ObjectState(map[string]interface{}{"nested": map[string]interface{}{"value": 1.0}}), ModifierSnapshots: model.BorrowNumericView(map[string]float64{"amount": 10}), StatusContributions: StatusContributions([]StatusContribution{{ResultRef: "slow", Strength: 0.2}})}}), Shields([]Shield{{ShieldRef: "shield", Source: "source", Owner: "target", Remaining: 20, ExpireAt: 1000, State: ObjectState(map[string]interface{}{"key": "value"})}}), AttributeResolver{}, DamageResolver{}, ResourceContributions{})
}

func TestProviderExpired(t *testing.T) {
	inst := Provider{ExpireAt: 500}
	if !inst.Expired(500) || inst.Expired(499) {
		t.Fatal("expiry boundary changed")
	}
	if (Provider{}).Expired(1000) {
		t.Fatal("permanent provider expired")
	}
}

func TestFindAndRemoveByRef(t *testing.T) {
	list := Providers([]Provider{{ProviderRef: "a"}, {ProviderRef: "b"}})
	_, index, found := list.Find("b")
	if !found || index != 1 {
		t.Fatal(index, found)
	}
	removed := list.RemoveRef("a")
	if removed.Len() != 1 || removed.At(0).ProviderRef != "b" || list.Len() != 2 || list.At(0).ProviderRef != "a" {
		t.Fatal("remove changed an older provider view")
	}
}

func TestProviderListOwnershipAppendProtectsSharedCapacity(t *testing.T) {
	storage := ProviderList{values: make([]Provider, 1, 4)}
	storage.values[0] = Provider{ProviderRef: "existing", Stacks: 1}
	state := InstanceState{providers: storage}
	changes := StageInstances(state, 0)
	changes.AppendProvider(Provider{ProviderRef: "added", Stacks: 1})
	if changes.Providers().Len() != 2 || &changes.providers.values[0] == &storage.values[0] || storage.values[:cap(storage.values)][1].ProviderRef != "" {
		t.Fatal("append wrote through shared list capacity")
	}
	current := &changes.providers.values[0]
	value := changes.Providers().At(0)
	value.Stacks = 2
	changes.ReplaceProvider(0, value)
	if &changes.providers.values[0] != current {
		t.Fatal("consecutive writes did not reuse the exclusive provider buffer")
	}
}

func TestInstanceProjectionClonePublishAndFrozenViewAreIsolated(t *testing.T) {
	state := instanceTestState()
	changes := StageInstances(state, 0)
	changes.ProjectProviders()
	value := changes.Providers().At(0)
	value.Stacks = 2
	changes.ReplaceProvider(0, value)
	frozen := changes.FreezeProviders()
	value.Stacks = 3
	changes.ReplaceProvider(0, value)
	if state.Providers().At(0).Stacks != 1 || changes.BaseProviders().At(0).Stacks != 1 || frozen.At(0).Stacks != 2 {
		t.Fatal("provider projection overwrote an entry or frozen view")
	}
	preview := changes.Clone()
	value.Stacks = 4
	preview.ReplaceProvider(0, value)
	if changes.Providers().At(0).Stacks != 3 {
		t.Fatal("preview changed parent projection")
	}
	published := changes.Publish("target", "source")
	value.Stacks = 5
	changes.ReplaceProvider(0, value)
	if published.Providers().At(0).Stacks != 3 || state.Providers().At(0).Stacks != 1 {
		t.Fatal("continued frame changed a committed provider")
	}
}

func TestInstanceValueExportsHideNestedMutableStorage(t *testing.T) {
	if StatusContributions(nil).Present() || !StatusContributions([]StatusContribution{}).Present() {
		t.Fatal("absent contribution replacement became an explicit empty replacement")
	}
	state := instanceTestState()
	provider := state.Providers().At(0)
	provider.State.ToMap()["nested"].(map[string]interface{})["value"] = 99.0
	provider.ModifierSnapshots.ToMap()["amount"] = 99
	provider.StatusContributions.Snapshot()[0].Strength = 0.9
	state.Shields().At(0).State.ToMap()["key"] = "changed"
	if provider.State.ToMap()["nested"].(map[string]interface{})["value"] != 1.0 || provider.ModifierSnapshots.At("amount") != 10 || provider.StatusContributions.At(0).Strength != 0.2 || state.Shields().At(0).State.ToMap()["key"] != "value" {
		t.Fatal("a value export aliases effect-owned storage")
	}
}

func TestInstanceExactExpiryAndShieldSettlementKeepOldState(t *testing.T) {
	state := instanceTestState()
	if state.Providers().Active(999).Len() != 1 || state.Providers().Active(1000).Len() != 0 {
		t.Fatal("provider expiry lost its exact boundary")
	}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Base: 100, Current: 100, Max: 100, Resolved: 100}})
	for _, at := range []int64{999, 1000} {
		changes := StageInstances(state, at)
		outcome, nextAttrs, nextShields := changes.Shields().ApplyDamage(50, 50, attrs, at, true)
		wantShield, wantHP := 20.0, 70.0
		if at == 1000 {
			wantShield, wantHP = 0, 50
		}
		if outcome.ShieldAbsorbed != wantShield || nextAttrs.At("hp").Current != wantHP || state.Shields().At(0).Remaining != 20 || attrs.At("hp").Current != 100 {
			t.Fatal(at, outcome, nextAttrs.At("hp"))
		}
		changes.SetShields(nextShields)
		published := changes.Publish("target", "source")
		if published.Shields().Len() != 0 || state.Shields().At(0).Remaining != 20 {
			t.Fatal("shield settlement changed an older instance snapshot")
		}
	}
}

func TestInstanceModifierPlansPreserveSourceAndOldViews(t *testing.T) {
	var state InstanceState
	mod := planbundle.CompiledModifier{Kind: "attribute", ModifierKey: "attack_bonus", Target: "attack", ValuePolicy: "add", HasValue: true}
	state.MountAttributeCompiled("source", "same", mod)
	state.MountAttributeCompiled("target", "same", mod)
	state.MountDamageCompiled("source", "same", planbundle.CompiledModifier{Kind: "pipeline", ModifierKey: "damage_bonus", Command: "damage", Channel: "all_damage", Stage: "incoming_post_mitigation", ValuePolicy: "multiply", HasValue: true})
	state.MountDamageCompiled("target", "same", planbundle.CompiledModifier{Kind: "pipeline", ModifierKey: "damage_bonus", Command: "damage", Channel: "all_damage", Stage: "incoming_post_mitigation", ValuePolicy: "multiply", HasValue: true})
	oldAttributes, oldDamage := state.Attributes(), state.Damage()
	state.UnmountAttribute("source", "same")
	state.UnmountDamage("source", "same")
	if oldAttributes.MountedModifiers().Len() != 2 || state.Attributes().MountedModifiers().Len() != 1 || state.Attributes().MountedModifiers().At(0).OwnerCombatantKey != "target" {
		t.Fatal("source unmount removed another owner or changed the old attribute plan")
	}
	oldRows := oldDamage.CollectForCommandChannelsWithMatches("damage", []string{"all_damage"}, "incoming_post_mitigation")
	newRows := state.Damage().CollectForCommandChannelsWithMatches("damage", []string{"all_damage"}, "incoming_post_mitigation")
	if len(oldRows) != 2 || len(newRows) != 1 || newRows[0].Modifier.OwnerCombatantKey != "target" {
		t.Fatal("damage provenance or plan isolation changed")
	}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"attack": {Base: 100}})
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}}}}
	resolved, err := state.Attributes().ResolveAttributes(attrs, formula.GenericEvalContext{SourceAttrs: attrs}, registry)
	if err != nil || resolved.At("attack").Resolved != 110 || attrs.At("attack").Base != 100 {
		t.Fatal(resolved, err)
	}
}
