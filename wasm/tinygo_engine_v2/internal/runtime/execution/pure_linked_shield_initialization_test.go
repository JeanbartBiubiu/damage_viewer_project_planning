package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func addPureInitializedShield(c *model.CompileRequest, r *model.RunRequest, actor, mode string, amount float64) (int, int) {
	op := model.OperationDefinition{Operation: "shield", Target: "self", Ref: "external_shield", ShieldRef: "a_external/value", ShieldLifecycleProviderDefinitionRef: "a_external/lifecycle", Amount: timedShieldExpr(amount)}
	listener := model.ListenerDefinition{ListenerKey: "external_initialize", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}}, Operations: []model.OperationDefinition{op}}
	parent := model.ProviderDefinition{ProviderKey: "external_initializer", Kind: "character", StableID: "external_initializer", SkillKey: "lab_external"}
	if mode == "direct" {
		parent.Listeners = []model.ListenerDefinition{listener}
	} else {
		ability := model.AbilityDefinition{AbilityKey: "external_initialize", Kind: "passive_listener", SkillKey: "lab_external", ListenerSpec: &listener}
		if mode == "ability_operations" {
			ability.Operations, listener.Operations = listener.Operations, nil
		}
		parent.Abilities = []model.AbilityDefinition{ability}
	}
	parentIndex := len(c.SharedProviders)
	c.SharedProviders = append(c.SharedProviders, parent, model.ProviderDefinition{ProviderKey: "a_external/lifecycle", StableID: "external_initializer", SkillKey: "lab_external", Kind: "status", LinkedShieldDefinitionRef: "a_external/value", Lifecycle: &model.ProviderLifecycle{MaxStacks: float64(1), RefreshPolicy: "replace"}})
	for i := range c.Combatants {
		if c.Combatants[i].Key == actor {
			c.Combatants[i].Providers = append(c.Combatants[i].Providers, model.CombatantProviderMount{ProviderRef: "external_initializer", DefinitionRef: "external_initializer"})
		}
	}
	for i := range r.InitialSnapshot.Combatants {
		if r.InitialSnapshot.Combatants[i].Key == actor {
			r.InitialSnapshot.Combatants[i].Providers = append(r.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{ProviderRef: "external_initializer", DefinitionRef: "external_initializer", Source: actor, Owner: actor, Stacks: 1})
		}
	}
	return parentIndex, parentIndex + 1
}

func TestPureLinkedShieldOtherSourceDoesNotBorrowOwnWait(t *testing.T) {
	for _, amount := range []float64{50, 30} {
		incoming := []float64{20, 20}
		if amount == 30 {
			incoming = append(incoming, 20)
		}
		c, r := receivedShieldInput(4000, incoming...)
		addPureInitializedShield(&c, &r, "source", "ability_operations", amount)
		s, done := runReceivedShieldState(t, c, r)
		events := receivedShieldEvents(done, "source")
		if len(events) != len(incoming) || s.combatantHp("source") != 1000 {
			t.Fatal("other natural source changed health or damage count", done.Summary)
		}
		if receivedRows(t, events[0])[0].DefinitionRef != "a_external/value" {
			t.Fatal("other shield was not settled first", events)
		}
		bag := s.combatants["source"].providerState.Lookup("own_recharge")
		fact := effectpkg.SourceExpiryFact{}
		if bag.Present() {
			fact = bag.SourceExpiry("wait")
		}
		if amount == 50 {
			if fact != (effectpkg.SourceExpiryFact{}) || ownShieldRemaining(done) != 110 {
				t.Fatal("different definition's two pure shield hits armed own P", fact, done.FinalSnapshot)
			}
		} else {
			if fact != (effectpkg.SourceExpiryFact{Generation: 1, Deadline: 5000}) || ownShieldRemaining(done) != 70 {
				t.Fatal("crossing into own P did not start once at 1000ms", fact, done.FinalSnapshot)
			}
			rows := receivedRows(t, events[1])
			if len(rows) != 2 || rows[0].DefinitionRef != "a_external/value" || rows[0].Absorbed != 10 || rows[1].DefinitionRef != "own_guard/value" || rows[1].Absorbed != 10 {
				t.Fatal("cross-shield facts lost actual attribution", rows)
			}
		}
	}
}
