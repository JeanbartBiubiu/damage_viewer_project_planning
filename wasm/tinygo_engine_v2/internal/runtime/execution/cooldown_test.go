package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCommonCooldownListenerChildUsesActualAbilityOwner(t *testing.T) {
	input, request := loadBasicFixture(t)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/on_hit", Domain: "event"})
	actualRef := "source.provider[champion:source_demo].ability[basic_attack]"
	ability := &input.SharedProviders[0].Abilities[0]
	ability.Cooldown = &model.AbilityCooldown{DurationMs: authoringConst(1000)}
	ability.Operations = []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "counter", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(7))}}
	input.SharedProviders[0].InitialStateSchema = map[string]interface{}{"counter": float64(0)}
	input.SharedProviders = append(input.SharedProviders, model.ProviderDefinition{
		ProviderKey: "utility:child_cast", Kind: "utility", StableID: "child_cast",
		Listeners: []model.ListenerDefinition{{ListenerKey: "cast_source_ability", EventMatcher: model.TypeMatcher{Any: []string{"event/on_hit"}}, AbilityRef: actualRef}},
		Abilities: []model.AbilityDefinition{{AbilityKey: "emit", Kind: "active", Operations: []model.OperationDefinition{{Operation: "emit_event", Target: "target", EventType: "event/on_hit", Ref: "event/on_hit"}}}},
	})
	input.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "utility:child_cast", DefinitionRef: "utility:child_cast"}}
	request.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "utility:child_cast", DefinitionRef: "utility:child_cast", Stacks: 1, State: map[string]interface{}{}}}
	request.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "first", AbilityRef: "target.provider[utility:child_cast].ability[emit]", Source: "target", Target: "target", FirstAtMs: 0},
		{EntryKey: "cd-blocked", AbilityRef: "target.provider[utility:child_cast].ability[emit]", Source: "target", Target: "target", FirstAtMs: 100},
		{EntryKey: "ready-boundary", AbilityRef: "target.provider[utility:child_cast].ability[emit]", Source: "target", Target: "target", FirstAtMs: 1000},
	}
	request.StopPolicy.DurationMs = 1100
	state := internalCooldownRunState(t, input, request)
	owner, executor := state.combatants["source"], state.combatants["target"]
	if actual := owner.providerState.Lookup("champion:source_demo").State().At("counter"); actual != 14 {
		t.Fatal("child ability bypassed CD or was rejected at exact readiness", actual)
	}
	if owner.cooldowns.AbilityReadyAt("source", actualRef) != 2000 || executor.cooldowns.EntryCount() != 0 {
		t.Fatal("CD belonged to the execution source instead of the actual ability owner", owner.cooldowns.AbilityDeadlines(), executor.cooldowns.AbilityDeadlines())
	}
}
