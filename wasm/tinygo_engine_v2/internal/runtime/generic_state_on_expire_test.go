package runtime

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

func ownExpiryInput(delay int64, speed, incoming float64, receives int) (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(speed, 10000, 0, 0, 0, 5500)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: model.EventTypeBasicAttackReceived, Domain: "event"}, model.TypeCatalogEntry{Key: "event/target_owner", Domain: "event"},
		model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"}, model.TypeCatalogEntry{Key: model.EventTypeDamageTaken, Domain: "event"},
		model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"})
	setCombatantAttr(&c, &r, "source", "armor", authoringSlot(100))
	shield := model.OperationDefinition{Operation: "shield", Target: "self", Ref: "own_shield", ShieldRef: "own_guard/value", ShieldLifecycleProviderDefinitionRef: "own_guard",
		Amount: authoringAmount(model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{gfConst(.1), authoringRead("source.attr.hp.max")}})}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "own_guard", StableID: "own_guard", Kind: "status", LinkedShieldDefinitionRef: "own_guard/value",
		Modifiers: []model.ModifierDefinition{{ModifierKey: "guard_armor", Kind: "attribute", Target: "self.attr.armor", Stage: "total", ValuePolicy: "multiply", Value: gfConst(1.3)}}})
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "own_recharge", StableID: "own_recharge", Kind: "character",
		InitialStateSchema: map[string]interface{}{"wait": map[string]interface{}{"valueType": "integer", "defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(delay), "refreshPolicy": "refresh_on_write", "onExpire": []model.OperationDefinition{shield}}},
		Listeners: []model.ListenerDefinition{
			{ListenerKey: "initialize", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}}, Operations: []model.OperationDefinition{shield}},
			{ListenerKey: "restart", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeDamageTaken, "event/target_owner"}}, Condition: authoringAmount(model.GenericFormulaExpr{Op: "gt", Args: []model.GenericFormulaExpr{authoringRead("event.damage.mitigatedAmount"), gfConst(0)}}),
				Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "wait", Types: []string{stateScopeProvider}, ValuePolicy: "override", Amount: timedShieldExpr(1)}}},
		}})
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "own_recharge", DefinitionRef: "own_recharge"})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "own_recharge", DefinitionRef: "own_recharge", Source: "source", Owner: "source", Stacks: 1})
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "receiver", StableID: "receiver", Kind: "character", InitialStateSchema: map[string]interface{}{"count": float64(0)},
		Listeners: []model.ListenerDefinition{{ListenerKey: "receive", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackReceived, "event/target_owner"}},
			Condition:  authoringAmount(model.GenericFormulaExpr{Op: "lt", Args: []model.GenericFormulaExpr{authoringRead("provider.state.count"), gfConst(float64(receives))}}),
			Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "incoming", DamageType: "damage/physics", Amount: timedShieldExpr(incoming)}, {Operation: "state_change", Target: "self", Ref: "count", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: timedShieldExpr(1)}}}}})
	periodicOpponentDefenseInputs(&c, &r)
	setCombatantAttr(&c, &r, "source", "armor", authoringSlot(100))
	c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "receiver", DefinitionRef: "receiver"})
	r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "receiver", DefinitionRef: "receiver", Source: "target", Owner: "target", Stacks: 1})
	return c, r
}

func ownShieldRemaining(done model.DoneResult) float64 {
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key == "source" {
			total := float64(0)
			for _, shield := range actor.Shields {
				total += shield.Remaining
			}
			return total
		}
	}
	return 0
}

func TestStateOnExpireRestartsAndReappliesShieldAttributes(t *testing.T) {
	c, r := ownExpiryInput(1500, 1, 230, 2)
	r.StopPolicy.DurationMs = 3000
	done := authoringRun(t, c, r)
	if !done.Summary.Execution.Complete || ownShieldRemaining(done) != 100 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	var expiries []int64
	for _, event := range done.Evidence.Items {
		if event.Kind == "provider_state_expired" {
			expiries = append(expiries, event.TimeMs)
		}
	}
	if !reflect.DeepEqual(expiries, []int64{2500}) {
		t.Fatal(expiries)
	}
	if got := done.FinalSnapshot.Combatants[0].Attributes["armor"].Resolved; got != 130 {
		t.Fatal(got)
	}
}

func TestStateOnExpireSameTimeActualBasicDamageWins(t *testing.T) {
	c, r := ownExpiryInput(2500, .4, 115, 2)
	r.StopPolicy.DurationMs = 4999
	done := authoringRun(t, c, r)
	if ownShieldRemaining(done) != 0 {
		t.Fatalf("old expiry applied a shield before same-time damage: %+v", done.FinalSnapshot)
	}
	for _, event := range done.Evidence.Items {
		if event.Kind == "provider_state_expired" {
			t.Fatal(event)
		}
	}
	r.StopPolicy.DurationMs = 5000
	done = authoringRun(t, c, r)
	if ownShieldRemaining(done) != 100 {
		t.Fatal(done.FinalSnapshot)
	}
}

func TestStateOnExpireZeroDamageDoesNotArm(t *testing.T) {
	c, r := ownExpiryInput(1000, 1, 0, 5)
	done := authoringRun(t, c, r)
	if ownShieldRemaining(done) != 100 {
		t.Fatal(done.FinalSnapshot)
	}
	for _, event := range done.Evidence.Items {
		if event.Kind == "provider_state_expired" {
			t.Fatal(event)
		}
	}
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
}

func ownExpiryStartedState(t *testing.T) *genericRunState {
	t.Helper()
	c, r := ownExpiryInput(500, 1, 230, 1)
	r.StopPolicy.DurationMs = 600
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	s, err := newGenericRunState(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	for {
		at, ok := s.heap.PeekTime()
		if !ok || at > 0 {
			break
		}
		event, _ := s.heap.Pop()
		s.nowMs, s.currentEventCommands = 0, 0
		s.processedEvents++
		switch event.Kind {
		case scheduler.GenericEventSourceInitialized:
			err = s.handleSourceInitialized(event)
		case scheduler.GenericEventBasicAttack:
			err = s.handleBasicAttack()
		default:
			t.Fatalf("unexpected setup event: %+v", event)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func TestStateOnExpireLazyReadKeepsPendingFact(t *testing.T) {
	s := ownExpiryStartedState(t)
	actor := s.combatants["source"]
	bag := writableProviderStateBag(actor.writableProviderStates(), "own_recharge", false)
	bag.lazyExpireProviderState(500)
	s.combatants["source"] = actor
	if bag.state["wait"] != 1 || bag.expireAt["wait"] != 500 || bag.sourceExpiryFacts["wait"].deadline != 500 {
		t.Fatal(bag)
	}
	if bag.needsLazyExpiration(500) || bag.needsReadPreparation(nil, 500, providerStateReadOptions{}) {
		t.Fatal("pending callback disagrees between fast and lazy read paths")
	}
	if err := s.runLoop(); err != nil {
		t.Fatal(err)
	}
	if ownShieldRemaining(s.buildDoneResult()) != 100 {
		t.Fatal(s.buildDoneResult().FinalSnapshot)
	}
}

func TestStateOnExpireFailureRollsBackCallbackAndFact(t *testing.T) {
	for _, mode := range []string{"commands", "formula"} {
		t.Run(mode, func(t *testing.T) {
			s := ownExpiryStartedState(t)
			before := s.combatants["source"].providerState["own_recharge"].sourceExpiryFacts["wait"]
			if mode == "commands" {
				s.budget.MaxCommandsPerEvent = 1
			} else {
				for _, provider := range s.compiled.Providers {
					if field := provider.StateFields["wait"]; field.OnExpireCount > 0 {
						s.formulas.Programs = append(s.formulas.Programs, formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}, {Op: formula.GenericOpConst, Value: 0}, {Op: formula.GenericOpDiv}}})
						s.compiled.Operations[field.OnExpireStart].AmountProgram = formula.GenericProgramID(len(s.formulas.Programs) - 1)
					}
				}
			}
			err := s.runLoop()
			if mode == "formula" && err == nil || mode == "commands" && s.budgetCause != model.BudgetCauseMaxCommandsPerEvent {
				t.Fatal(err, s.budgetCause)
			}
			bag := s.combatants["source"].providerState["own_recharge"]
			if ownShieldRemaining(s.buildDoneResult()) != 0 || bag.sourceExpiryFacts["wait"] != before || bag.state["wait"] != 1 || bag.expireAt["wait"] != 500 {
				t.Fatal("failed expiry published shield or consumed fact")
			}
		})
	}
}

func TestStateOnExpireRearmQueueFailurePreservesPreviousGeneration(t *testing.T) {
	s := ownExpiryStartedState(t)
	before := s.combatants["source"].providerState["own_recharge"].sourceExpiryFacts["wait"]
	s.heap.SetLimit(s.heap.Len())
	s.nowMs = 200
	s.currentEventCommands = 0
	f := s.newExecutionFrame("source", "source", "reset")
	f.ownerCombatantKey, f.ownerProviderRef = "source", "own_recharge"
	var operation *plan.CompiledOperation
	for i := range s.compiled.Operations {
		if s.compiled.Operations[i].Operation == "state_change" && s.compiled.Operations[i].Ref == "wait" {
			operation = &s.compiled.Operations[i]
			break
		}
	}
	if operation == nil {
		t.Fatal("missing restart")
	}
	if err := f.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{*operation}); err != nil {
		t.Fatal(err)
	}
	f.commit()
	bag := s.combatants["source"].providerState["own_recharge"]
	if !f.fatal || bag.sourceExpiryFacts["wait"] != before || bag.state["wait"] != 1 || bag.expireAt["wait"] != 500 {
		t.Fatal("failed queue committed a new deadline")
	}
}

func TestStateOnExpireRejectsUnsupportedGraphs(t *testing.T) {
	for _, invalid := range []string{"null", "empty", "extra", "default", "cap", "untimed", "target_scope", "callback_damage", "callback_state", "callback_current_health", "callback_condition", "callback_foreign", "init_condition"} {
		t.Run(invalid, func(t *testing.T) {
			c, _ := ownExpiryInput(500, 1, 230, 1)
			p := &c.SharedProviders[2]
			field := p.InitialStateSchema["wait"].(map[string]interface{})
			ops := field["onExpire"].([]model.OperationDefinition)
			switch invalid {
			case "null":
				field["onExpire"] = nil
			case "empty":
				field["onExpire"] = []model.OperationDefinition{}
			case "extra":
				field["onExpire"] = append(ops, ops[0])
			case "default":
				field["defaultValue"] = float64(1)
			case "cap":
				field["maxValue"] = float64(2)
			case "untimed":
				field["durationMs"] = float64(0)
			case "target_scope":
				p.Listeners[1].Operations[0].Types = []string{stateScopeProviderTarget}
				c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"})
			case "callback_damage":
				ops[0].Operation = "damage"
			case "callback_state":
				ops[0] = p.Listeners[1].Operations[0]
			case "callback_current_health":
				ops[0].Amount = authoringAmount(authoringRead("source.attr.hp.current"))
			case "callback_condition":
				ops[0].Condition = timedShieldExpr(1)
			case "callback_foreign":
				ops[0].Target = "target"
			case "init_condition":
				p.Listeners[0].Condition = timedShieldExpr(1)
			}
			if compile.CompileGeneric(c).OK {
				t.Fatal("unsupported onExpire graph accepted", invalid)
			}
		})
	}
}

func TestSourceExpiryFactsCopyWithBagVersions(t *testing.T) {
	original := &providerStateBag{}
	original.rearmSourceExpiry("wait", 500)
	branch := shareProviderStateMap(map[string]*providerStateBag{"p": original})
	copy := writableProviderStateBag(branch, "p", false)
	copy.rearmSourceExpiry("wait", 900)
	if original.sourceExpiryFacts["wait"].deadline != 500 || copy.sourceExpiryFacts["wait"].deadline != 900 {
		t.Fatal("expiry fact changed another frame")
	}
}

func TestStateOnExpireInvalidProviderKeysCollectErrors(t *testing.T) {
	for _, mode := range []string{"empty_callback_key", "duplicate_callback_key", "prior_invalid_key"} {
		t.Run(mode, func(t *testing.T) {
			c, _ := ownExpiryInput(500, 1, 230, 1)
			switch mode {
			case "empty_callback_key":
				c.SharedProviders[2].ProviderKey = ""
			case "duplicate_callback_key":
				c.SharedProviders = append(c.SharedProviders, c.SharedProviders[2])
			case "prior_invalid_key":
				c.SharedProviders = append([]model.ProviderDefinition{{Kind: "status"}}, c.SharedProviders...)
			}
			if result := compile.CompileGeneric(c); result.OK || len(result.Result.Errors) == 0 {
				t.Fatal("invalid provider was not collected", result.Result)
			}
		})
	}
}

func TestStateOnExpireRejectsUninitializedDynamicSource(t *testing.T) {
	c, _ := ownExpiryInput(500, 1, 230, 1)
	c.Combatants[0].Providers = c.Combatants[0].Providers[:1]
	c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "foreign_apply", Kind: "active", Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "own_recharge"}}})
	if compile.CompileGeneric(c).OK {
		t.Fatal("onExpire source accepted dynamic creation without its real initial mount")
	}
}

func TestStateOnExpireEachCallbackMatchesTheInitializer(t *testing.T) {
	c, _ := ownExpiryInput(500, 1, 230, 1)
	other := c.SharedProviders[1]
	other.ProviderKey, other.StableID, other.LinkedShieldDefinitionRef = "other_guard", "other_guard", "other_guard/value"
	c.SharedProviders = append(c.SharedProviders, other)
	first := c.SharedProviders[2].InitialStateSchema["wait"].(map[string]interface{})
	second := map[string]interface{}{}
	for key, value := range first {
		second[key] = value
	}
	shield := first["onExpire"].([]model.OperationDefinition)[0]
	shield.ShieldRef, shield.ShieldLifecycleProviderDefinitionRef = "other_guard/value", "other_guard"
	second["onExpire"] = []model.OperationDefinition{shield}
	c.SharedProviders[2].InitialStateSchema["another_wait"] = second
	if compile.CompileGeneric(c).OK {
		t.Fatal("second callback applied a shield never initialized by this source")
	}
}

func TestStateOnExpireAllDriversValidateTheCompleteSource(t *testing.T) {
	for _, mode := range []string{"active", "hidden_tick", "hidden_passive_body", "inline_driver"} {
		t.Run(mode, func(t *testing.T) {
			c, r := ownExpiryInput(500, 1, 230, 1)
			r.DriverPlan.BasicAttack = nil
			p := &c.SharedProviders[2]
			restart := p.Listeners[1]
			switch mode {
			case "active":
				p.Abilities = []model.AbilityDefinition{{AbilityKey: "ordinary_restart", Kind: "active", Operations: restart.Operations}}
			case "hidden_tick":
				p.Abilities = []model.AbilityDefinition{{AbilityKey: "hidden_tick", Kind: "tick", TickSpec: &model.TickSpec{IntervalMs: 500, OnTick: restart.Operations}}}
			case "hidden_passive_body":
				p.Abilities = []model.AbilityDefinition{{AbilityKey: "hidden", Kind: "passive_listener", Operations: restart.Operations, ListenerSpec: &restart}}
			case "inline_driver":
				p.Listeners = p.Listeners[:1]
				p.Abilities = []model.AbilityDefinition{{AbilityKey: "restart", Kind: "passive_listener", Operations: restart.Operations, ListenerSpec: &model.ListenerDefinition{ListenerKey: restart.ListenerKey, EventMatcher: restart.EventMatcher, Condition: restart.Condition, MaxTriggersPerEvent: 1}}}
				r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "forge_restart", Source: "source", Target: "target", AbilityRef: "source.provider[own_recharge].ability[restart]"}}
			}
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			if _, err := newGenericRunState(compiled.Session, r); err == nil {
				t.Fatal("unsupported complete expiry source accepted without background basic attack", mode)
			}
		})
	}
}
