package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestActionResultFollowsThisFrameCommit(t *testing.T) {
	for _, tc := range []struct {
		name     string
		commands int
		tail     bool
		native   bool
		accepted bool
		damage   float64
		casts    int
	}{
		{name: "empty accepted", accepted: true, casts: 1},
		{name: "before commit failure", commands: 1},
		{name: "after commit failure", commands: 1, tail: true, accepted: true, damage: 10, casts: 1},
		{name: "native followup executes without recounting", native: true, accepted: true, damage: 10},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, r := frameCommitInput()
			if tc.commands > 0 || tc.native {
				c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{frameCommitDamage(10)}
			}
			if tc.commands > 0 && !tc.tail {
				c.SharedProviders[0].Abilities[0].Operations = append(c.SharedProviders[0].Abilities[0].Operations, frameCommitDamage(10))
			}
			if tc.tail {
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: eventTypeAbilityStarted, Domain: "event"})
				c.Rules.Listeners = []model.ListenerDefinition{{ListenerKey: "tail", EventMatcher: model.TypeMatcher{All: []string{eventTypeAbilityStarted}}, Operations: []model.OperationDefinition{frameCommitDamage(1)}}}
			}
			s := frameCommitState(t, c, r)
			if tc.commands > 0 {
				s.budget.MaxCommandsPerEvent = tc.commands
				s.actions.SetAttackActive(true)
			}
			entry := ""
			if tc.native {
				entry = "attack__native_hit"
			}
			result, err := s.castAbilityAt("source", "target", authoringRef("atomic"), 0, nil, nil, entry)
			if result.Accepted != tc.accepted || (err != nil) != (tc.commands > 0) {
				t.Fatal("wrong local acceptance or failure", result, err)
			}
			if err != nil && err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
				t.Fatal("original error classification changed", err)
			}
			if s.report.Totals().SourceDamageDealt != tc.damage || s.combatantHp("target") != 1000-tc.damage || s.abilityCastCount != tc.casts {
				t.Fatal("result changed committed numerical or cast facts", s.report.Totals(), s.abilityCastCount)
			}
		})
	}
}

func TestOrdinaryAbilityCooldownReadsAfterPayment(t *testing.T) {
	c, r := frameCommitInput()
	c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 100, Max: 100}
	r.InitialSnapshot.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 100, Max: 100}
	c.SharedProviders[0].Abilities[0].Cost = &model.AbilityCost{ResourceKey: "mana", Amount: *timedShieldExpr(9.25)}
	c.SharedProviders[0].Abilities[0].Cooldown = &model.AbilityCooldown{DurationMs: authoringRead("source.resource.mana.current")}
	s := frameCommitState(t, c, r)
	s.loop.Advance(7)
	result, err := s.castAbilityAt("source", "target", authoringRef("atomic"), 0, nil, nil, "")
	if err != nil || !result.Accepted || s.combatants["source"].resourceView().At("mana").Current != 90.75 || s.combatants["source"].cooldowns.AbilityReadyAt("source", authoringRef("atomic")) != 97 {
		t.Fatal("ordinary cooldown must read paid balance and truncate duration", result, err)
	}
	result, err = s.castAbilityAt("source", "target", authoringRef("atomic"), 0, nil, nil, "")
	if err != nil || result.Accepted || result.Reason != "cooldown_not_ready" || s.combatants["source"].resourceView().At("mana").Current != 90.75 || s.abilityCastCount != 1 {
		t.Fatal("normal cooldown skip changed its reason or spent another cost", result, err)
	}
}

func TestProcessActionResultRetainsAcceptedStartAfterSynchronousDeath(t *testing.T) {
	c, r := processBase(t, "DELAY")
	c.Rules.Listeners = []model.ListenerDefinition{{ListenerKey: "death_after_start", EventMatcher: model.TypeMatcher{All: []string{eventTypeAbilityStarted}}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "source", DamageType: "damage/physical", Amount: timedShieldExpr(10000)}}}}
	s := frameCommitState(t, c, r)
	ability, ref, _ := s.lookupDriverAbility(r.DriverPlan.Entries[0])
	result, err := s.processFlowExecutor().Control(r.DriverPlan.Entries[0], 0, ability, ref, s.loop.TimeMs(), s.compiled.Providers, processControlBridge{engine: s}, processFlowBridge{engine: s})
	if err != nil || !result.Accepted || s.actions.ProcessCount() != 1 || s.actions.ProcessAt(0).Status() != "failed" || s.combatantHp("source") != 0 {
		t.Fatal("synchronous death erased the already accepted start", result, err, s.actions.ProcessViews())
	}
}

func TestProcessActionResultDistinguishesResourceRejectionAndTailFailure(t *testing.T) {
	t.Run("resource rejection", func(t *testing.T) {
		c, r := processBase(t, "DELAY")
		r.InitialSnapshot.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 1, Max: 500}
		s := frameCommitState(t, c, r)
		ability, ref, _ := s.lookupDriverAbility(r.DriverPlan.Entries[0])
		result, err := s.processFlowExecutor().Control(r.DriverPlan.Entries[0], 0, ability, ref, s.loop.TimeMs(), s.compiled.Providers, processControlBridge{engine: s}, processFlowBridge{engine: s})
		if err != nil || result.Accepted || result.Reason != "resource_insufficient" || s.actions.ProcessCount() != 0 || s.abilityCastCount != 0 || s.combatants["source"].resourceView().At("mana").Current != 1 {
			t.Fatal("normal rejection accepted or spent resources", result, err)
		}
	})
	t.Run("committed start tail failure", func(t *testing.T) {
		c, r := authoringInput()
		s := frameCommitState(t, c, r)
		s.budget.MaxChainDepth = 1
		s.actions.SetAttackActive(true)
		bound := s.compiled.AbilityRefIndex[authoringRef("initial")]
		ability := s.compiled.Abilities[bound.AbilityIndex]
		definition := &s.compiled.Providers[ability.ProviderIndex].Processes[ability.ProcessControl.ProcessIndex]
		result, err := s.startProcess(r.DriverPlan.Entries[0], -1, "source", "target", "attack", authoringRef("initial"), ability, definition, "attack/1", 1, nil)
		if err == nil || err.BudgetCause != model.BudgetCauseMaxChainDepth || !result.Accepted || s.actions.ProcessCount() != 1 || !s.actions.ProcessAt(0).CooldownStarted() {
			t.Fatal("tail failure erased committed start or cooldown", result, err, s.actions.ProcessViews())
		}
	})
}

func TestListenerCooldownPriorityRemainsDifferentFromOrdinaryCast(t *testing.T) {
	c, r := ownExpiryInput(500, 1, 230, 1)
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{}}
	ref := "source.provider[own_recharge].ability[internal]"
	for i := range c.SharedProviders {
		if c.SharedProviders[i].ProviderKey == "own_recharge" {
			restart := c.SharedProviders[i].Listeners[1]
			c.SharedProviders[i].Listeners = c.SharedProviders[i].Listeners[:1]
			c.SharedProviders[i].Abilities = []model.AbilityDefinition{{AbilityKey: "internal", Kind: "passive_listener", Operations: restart.Operations, ListenerSpec: &model.ListenerDefinition{ListenerKey: restart.ListenerKey, EventMatcher: restart.EventMatcher, Condition: restart.Condition, MaxTriggersPerEvent: 1}}}
		}
	}
	c.Rules.Listeners = append(c.Rules.Listeners, model.ListenerDefinition{ListenerKey: "priority_guard", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{eventTypeAbilityStarted}}, AbilityRef: ref})
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: eventTypeAbilityStarted, Domain: "event"})
	mountP6Item(&c, &r, model.ProviderDefinition{ProviderKey: "cooldown_driver", Kind: "item", StableID: "cooldown_driver", Abilities: []model.AbilityDefinition{{AbilityKey: "set", Kind: "active", Operations: []model.OperationDefinition{{Operation: "cooldown_change", Target: "self", AbilityRef: ref, ValuePolicy: "set", Amount: timedShieldExpr(1000)}}}}})
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "set_then_listen", Source: "source", Target: "target", AbilityRef: "source.provider[cooldown_driver].ability[set]", FirstAtMs: 100}}
	r.StopPolicy.DurationMs = 200
	s := frameCommitState(t, c, r)
	if err := s.runLoop(); err != nil {
		t.Fatal("reachable input must skip the restricted source while cooling", err)
	}
	for _, listener := range s.compiled.Listeners {
		if listener.ListenerKey != "priority_guard" {
			continue
		}
		if accepted, err := (*listenerEngineHost)(s).ListenerAbility(emittedEvent{}, nil, listener, "source", "target", 0); accepted || err != nil {
			t.Fatal("listener changed cooldown skip priority", accepted, err)
		}
		if result, err := s.castAbilityAt("source", "target", ref, 0, nil, nil, ""); result.Accepted || err == nil {
			t.Fatal("ordinary entry changed its original source validation priority", result, err)
		}
		s.loop.Advance(1100)
		if accepted, err := (*listenerEngineHost)(s).ListenerAbility(emittedEvent{}, nil, listener, "source", "target", 0); accepted || err == nil {
			t.Fatal("ready restricted listener must retain its original error", accepted, err)
		}
		return
	}
	t.Fatal("compiled listener missing")
}
