package execution

import (
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	scheduler "tinygo_engine_v2/internal/scheduler"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func discreteSourceField(defaultValue, maximum float64, duration int64) map[string]interface{} {
	field := map[string]interface{}{"valueType": model.ProviderStateValueInteger, "defaultValue": defaultValue,
		"maxValue": maximum, "durationMs": duration}
	if duration > 0 {
		field["refreshPolicy"] = model.ProviderStateRefreshOnWrite
	}
	return field
}

func addTriggeredSkillSource(input *model.CompileRequest, request *model.RunRequest, actor int, key, kind string, definition model.ProviderDefinition) string {
	owner := input.Combatants[actor].Key
	definition.ProviderKey = owner + "_" + key
	definition.StableID = definition.ProviderKey
	definition.Kind = kind
	input.SharedProviders = append(input.SharedProviders, definition)
	input.Combatants[actor].Providers = append(input.Combatants[actor].Providers,
		model.CombatantProviderMount{ProviderRef: definition.ProviderKey, DefinitionRef: definition.ProviderKey})
	request.InitialSnapshot.Combatants[actor].Providers = append(request.InitialSnapshot.Combatants[actor].Providers,
		model.CombatantProviderSnapshot{ProviderRef: definition.ProviderKey, DefinitionRef: definition.ProviderKey, Source: owner, Owner: owner, Stacks: 1})
	return definition.ProviderKey
}

func triggeredSourceInput(duration int64) (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(1, 10000, 10, 100, 0, duration)
	receivedEquipmentTypes(&input)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"})
	return input, request
}

func sourceCounterDefinition(event, relation, scope, key string, cap float64, duration int64) model.ProviderDefinition {
	return model.ProviderDefinition{InitialStateSchema: map[string]interface{}{key: discreteSourceField(0, cap, duration)},
		Listeners: []model.ListenerDefinition{{ListenerKey: "count_actual_event", MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{event, relation}}, Operations: []model.OperationDefinition{{Operation: "state_change",
				Target: "self", Ref: key, Types: []string{scope}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))}}}}}
}

func enableSourceSpeedDerivation(input *model.CompileRequest, request *model.RunRequest, speed float64) {
	for key, value := range map[string]float64{"attack_speed": speed, "attack_speed_ratio": speed, "bonus_attack_speed_percent": 0} {
		input.Combatants[0].Attributes[key] = authoringSlot(value)
		request.InitialSnapshot.Combatants[0].Attributes[key] = authoringSlot(value)
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
}

func targetCounterValue(test *testing.T, snapshot model.Snapshot, actor int, ref, key, target string) float64 {
	test.Helper()
	bag, exists := snapshot.Combatants[actor].ProviderState[ref].(map[string]interface{})
	if !exists {
		test.Fatal("missing counter", snapshot.Combatants[actor].ProviderState)
	}
	state, exists := bag["targetState"].(map[string]interface{})
	if !exists || state["target"] != target {
		test.Fatal("incorrect target ownership", bag)
	}
	return state["values"].(map[string]interface{})[key].(float64)
}

func TestTriggeredSkillSourceSameTimeStartAndHitKeepUniqueWait(test *testing.T) {
	input, request := triggeredSourceInput(1000)
	enableSourceSpeedDerivation(&input, &request, 1)
	for _, event := range []string{model.EventTypeBasicAttackStart, model.EventTypeBasicAttackHit} {
		definition := sourceCounterDefinition(event, eventSourceOwner, stateScopeProvider, "layers", 1, 0)
		definition.Modifiers = []model.ModifierDefinition{{ModifierKey: "speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent",
			ValuePolicy: "add", Value: authoringRead("provider.state.layers")}}
		addTriggeredSkillSource(&input, &request, 0, event, "build", definition)
	}
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	takeNextEventForTest(state.loop)
	if err := state.handleBasicAttack(); err != nil {
		test.Fatal(err)
	}
	if state.loop.QueuedEvents() != 1 || state.basicAttackReadyAt() != 333 || *state.actions.BasicAttack().Current().ReadyAtMs() != 1000 || state.actions.ProcessCount() != 1 {
		test.Fatal(state.actions.BasicAttack().Wait(), state.loop.QueuedEvents(), state.actions.ProcessViews())
	}
	first := input.Combatants[0].Providers[0]
	input.Combatants[0].Providers = append(input.Combatants[0].Providers[1:], first)
	state, err = newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	takeNextEventForTest(state.loop)
	if err := state.handleBasicAttack(); err != nil {
		test.Fatal(err)
	}
	if state.loop.QueuedEvents() != 1 || state.basicAttackReadyAt() != 333 || *state.actions.BasicAttack().Current().ReadyAtMs() != 500 || state.actions.ProcessCount() != 1 {
		test.Fatal("cooldown baseline did not capture the actual pre-process attribute value", state.actions.BasicAttack().Wait(), state.actions.BasicAttack().Current())
	}
}

func TestTriggeredSkillSourcesDoNotConsumeEquipmentSlotsOrDriveIdleBinding(test *testing.T) {
	input, request := triggeredSourceInput(1000)
	for index := 0; index < 7; index++ {
		addTriggeredSkillSource(&input, &request, 0, "constructed_"+itoa(uint32(index)), "build",
			sourceCounterDefinition(model.EventTypeBasicAttackHit, eventSourceOwner, stateScopeProvider, "count", 99, 0))
	}
	for index := 0; index < 6; index++ {
		addFixedEquipment(&input, &request, 0, "fixed_"+itoa(uint32(index)), "hp", 0)
	}
	idle := input.SharedProviders[0]
	idle.ProviderKey, idle.StableID = "idle_attack", "idle_attack"
	idle.Listeners = append([]model.ListenerDefinition(nil), idle.Listeners...)
	idle.Listeners[0].AbilityRef = "target.provider[idle_binding].ability[initial]"
	input.SharedProviders = append(input.SharedProviders, idle)
	input.Combatants[1].Providers = append(input.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "idle_binding", DefinitionRef: idle.ProviderKey})
	request.InitialSnapshot.Combatants[1].Providers = append(request.InitialSnapshot.Combatants[1].Providers,
		model.CombatantProviderSnapshot{ProviderRef: "idle_binding", DefinitionRef: idle.ProviderKey, Source: "target", Owner: "target", Stacks: 1})
	done := authoringRun(test, input, request)
	if done.Summary.BasicAttack.StartedCount != 2 || done.Summary.TargetDamageDealt != 0 || len(done.FinalSnapshot.ProcessInstances) != 2 {
		test.Fatal(done.Summary, done.FinalSnapshot.ProcessInstances)
	}
	for _, process := range done.FinalSnapshot.ProcessInstances {
		if process.Owner != "source" {
			test.Fatal("idle binding started an autonomous process", process)
		}
	}
}

func TestTriggeredSkillSourceExpiryBudgetFailureKeepsCommittedStateAndWait(test *testing.T) {
	input, request := triggeredSourceInput(3000)
	enableSourceSpeedDerivation(&input, &request, .2)
	definition := sourceCounterDefinition(model.EventTypeBasicAttackStart, eventSourceOwner, stateScopeProvider, "layers", 4, 2500)
	definition.Modifiers = []model.ModifierDefinition{{ModifierKey: "speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent",
		ValuePolicy: "add", Value: authoringBinary("mul", authoringRead("provider.state.layers"), authoringConst(.25))}}
	ref := addTriggeredSkillSource(&input, &request, 0, "budgeted_expiry", "build", definition)
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	takeNextEventForTest(state.loop)
	if err := state.handleBasicAttack(); err != nil {
		test.Fatal(err)
	}
	state.budget.MaxCommandsPerEvent = 1
	if err := state.runLoop(); err != nil {
		test.Fatal(err)
	}
	snapshot := state.buildFinalSnapshot()
	bag := snapshot.Combatants[0].ProviderState[ref].(map[string]interface{})
	if state.budgetCause != model.BudgetCauseMaxCommandsPerEvent || state.basicAttackReadyAt() != 4000 || snapshot.Combatants[0].Attributes["attack_speed"].Resolved != .25 || bag["state"].(map[string]interface{})["layers"] != float64(1) {
		test.Fatal("failed expiry partially published state or waiting attributes", state.budgetCause, state.actions.BasicAttack().Wait(), snapshot)
	}
}

func TestIntegerSourceAndTargetOperandsCannotHideBehindCaps(test *testing.T) {
	for _, scope := range []string{stateScopeProvider, stateScopeProviderTarget} {
		for _, scenario := range []struct {
			initial, amount, cap, expected float64
			policy                         string
			valid                          bool
		}{{0, 0, 0, 0, "override", true}, {4, 1, 4, 4, "add", true}, {4, -1, 4, 3, "add", true},
			{0, -1, 4, 0, "add", false}, {4, .5, 4, 0, "add", false}, {4, -1, 4, 0, "override", false},
			{4, 9007199254740991, 4, 0, "add", false}, {4, 9007199254740992, 4, 0, "override", false}} {
			input, request := triggeredSourceInput(100)
			input.Combatants[0].Attributes["operand"] = authoringSlot(scenario.amount)
			request.InitialSnapshot.Combatants[0].Attributes["operand"] = authoringSlot(scenario.amount)
			definition := sourceCounterDefinition(model.EventTypeBasicAttackHit, eventSourceOwner, scope, "discrete", scenario.cap, 0)
			definition.InitialStateSchema["discrete"] = discreteSourceField(scenario.initial, scenario.cap, 0)
			definition.Listeners[0].Operations[0].ValuePolicy = scenario.policy
			definition.Listeners[0].Operations[0].Amount = authoringAmount(authoringRead("source.attr.operand.resolved"))
			ref := addTriggeredSkillSource(&input, &request, 0, "integer_operand", "character", definition)
			state, err := newGenericRunState(authoringCompile(test, input), request)
			if err != nil {
				test.Fatal(err)
			}
			takeNextEventForTest(state.loop)
			err = state.handleBasicAttack()
			if (err == nil) != scenario.valid {
				test.Fatal(scope, scenario, err)
			}
			if scenario.valid {
				bag := state.combatants["source"].providerState.Lookup(ref)
				value := bag.State().At("discrete")
				if scope == stateScopeProviderTarget {
					value = bag.TargetValues().At("discrete")
				}
				if value != scenario.expected {
					test.Fatal(scope, scenario, value)
				}
			} else if state.combatants["source"].providerState.Lookup(ref).Present() {
				test.Fatal("failed state operand partially committed", scope, scenario)
			}
		}
	}
}

func TestIntegerRestoredStateRejectsMalformedAndExpiredValues(test *testing.T) {
	for _, scope := range []string{stateScopeProvider, stateScopeProviderTarget} {
		for _, value := range []interface{}{-1.0, .5, 9007199254740992.0, 5.0, "1"} {
			input, request := triggeredSourceInput(100)
			ref := addTriggeredSkillSource(&input, &request, 0, "restored_discrete", "build",
				sourceCounterDefinition(model.EventTypeBasicAttackHit, eventSourceOwner, scope, "count", 4, 500))
			request.DriverPlan.BasicAttack = nil
			request.InitialSnapshot.TimeMs = 100
			bag := map[string]interface{}{"state": map[string]interface{}{"count": value}, "expireAt": map[string]interface{}{"count": float64(50)}}
			if scope == stateScopeProviderTarget {
				bag = map[string]interface{}{"targetState": map[string]interface{}{"target": "target", "values": map[string]interface{}{"count": value}, "expireAt": map[string]interface{}{"count": float64(50)}}}
			}
			request.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{ref: bag}
			if _, err := newGenericRunState(authoringCompile(test, input), request); err == nil {
				test.Fatal("invalid restored integer was hidden by expiry", scope, value)
			}
		}
	}
}

func TestTriggeredSkillSourceInitialWaitQueueFailureIsAtomic(test *testing.T) {
	input, request := triggeredSourceInput(100)
	input.Settings.MaxQueueEvents = 1
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	takeNextEventForTest(state.loop)
	state.loop.Enqueue(scheduler.GenericEvent{TimeMs: 10, Kind: scheduler.GenericEventExpireCleanup})
	err = state.handleBasicAttack()
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || state.actions.BasicAttack().Wait() != nil || state.actions.ProcessCount() != 0 || state.combatants["source"].cooldowns.EntryCount() != 0 || state.loop.QueuedEvents() != 1 {
		test.Fatal(err, state.actions.BasicAttack().Wait(), state.actions.ProcessViews(), state.combatants["source"].cooldowns)
	}
}

func pairedCounterSourceInput(duration int64) (model.CompileRequest, model.RunRequest, string, string, string) {
	input, request := triggeredSourceInput(duration)
	input.Combatants[0].Attributes["attack_damage"] = authoringSlot(100)
	request.InitialSnapshot.Combatants[0].Attributes["attack_damage"] = authoringSlot(100)
	enableSourceSpeedDerivation(&input, &request, 1)
	root := "source_paired_counter"
	armor, speed := root+"_armor", root+"_speed"
	input.SharedProviders = append(input.SharedProviders,
		model.ProviderDefinition{ProviderKey: armor, Kind: "status", StableID: root, Lifecycle: sourceTargetLifecycle(1200),
			Modifiers: []model.ModifierDefinition{{ModifierKey: "recipient_armor", Kind: "attribute", Target: "self.attr.armor", ValuePolicy: "add_percent", Value: authoringConst(-.2)}}},
		model.ProviderDefinition{ProviderKey: speed, Kind: "status", StableID: root, Lifecycle: sourceTargetLifecycle(700),
			Modifiers: []model.ModifierDefinition{{ModifierKey: "owned_speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: authoringConst(.5)}}})
	definition := sourceCounterDefinition(model.EventTypeBasicAttackHit, eventSourceOwner, stateScopeProviderTarget, "count", 3, 1500)
	qualified := p6Gte("provider.target_state.count", 3)
	definition.Listeners[0].Operations = append(definition.Listeners[0].Operations,
		model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(30)), Condition: qualified},
		model.OperationDefinition{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: armor, Condition: qualified},
		model.OperationDefinition{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: speed, Condition: qualified},
		model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "count", Types: []string{stateScopeProviderTarget},
			ValuePolicy: "override", Amount: authoringAmount(authoringConst(0)), Condition: qualified})
	ref := addTriggeredSkillSource(&input, &request, 0, "paired_counter", "character", definition)
	return input, request, ref, armor, speed
}

func TestTriggeredSkillSourceRecipientTotalArmorMultiplyPreservesBaseAndExactExpiry(test *testing.T) {
	input, request, _, armor, _ := pairedCounterSourceInput(2600)
	addFixedEquipment(&input, &request, 1, "armor_contribution", "armor", 25)
	input.Combatants[0].Attributes["armor"] = authoringSlot(73)
	request.InitialSnapshot.Combatants[0].Attributes["armor"] = authoringSlot(73)
	for index := range input.SharedProviders {
		if input.SharedProviders[index].ProviderKey == armor {
			modifier := &input.SharedProviders[index].Modifiers[0]
			modifier.Bucket = "RATIO_MULTIPLY"
			modifier.ValuePolicy = "multiply"
			modifier.Value = authoringConst(.8)
		}
	}
	session := authoringCompile(test, input)
	beforeRequest := request
	beforeRequest.StopPolicy.DurationMs = 1999
	before, err := runForTest(session, beforeRequest)
	if err != nil {
		test.Fatal(err)
	}
	if before.FinalSnapshot.Combatants[1].Attributes["armor"].Base != 100 || before.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != 125 {
		test.Fatal("selected equipment did not establish the full armor before the trigger", before.FinalSnapshot)
	}
	active, err := runForTest(session, request)
	if err != nil {
		test.Fatal(err)
	}
	if !active.Summary.Execution.Complete || active.FinalSnapshot.Combatants[1].Attributes["armor"].Base != 100 || active.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != 100 || active.FinalSnapshot.Combatants[0].Attributes["armor"] != authoringSlot(73) {
		test.Fatal("recipient multiplier must apply after equipment without modifying either original base or source armor", active.FinalSnapshot)
	}
	for _, end := range []int64{3199, 3200} {
		restored := request
		restored.InitialSnapshot = cloneSnapshot(active.FinalSnapshot)
		restored.DriverPlan.BasicAttack = nil
		restored.StopPolicy.DurationMs = end - restored.InitialSnapshot.TimeMs
		restored.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
		resumed, err := runForTest(session, restored)
		if err != nil {
			test.Fatal(err)
		}
		expected := float64(100)
		if end == 3200 {
			expected = 125
		}
		if resumed.FinalSnapshot.TimeMs != end || resumed.FinalSnapshot.Combatants[1].Attributes["armor"].Base != 100 || resumed.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != expected || resumed.FinalSnapshot.Combatants[0].Attributes["armor"] != authoringSlot(73) {
			test.Fatal("restored total-armor multiplier failed its precise deadline or changed source/base ownership", end, resumed.FinalSnapshot)
		}
		instances := 0
		for _, instance := range resumed.FinalSnapshot.Combatants[1].Providers {
			if instance.DefinitionRef == armor {
				instances++
				if instance.Source != "source" || instance.Owner != "target" || instance.Stacks != 1 || instance.ExpireAt == nil || *instance.ExpireAt != 3200 {
					test.Fatal("total-armor multiplier lost its source/target identity or expiry", instance)
				}
			}
		}
		if (end == 3199 && instances != 1) || (end == 3200 && instances != 0) {
			test.Fatal("recipient multiplier did not disappear at its exact deadline", end, instances)
		}
	}
}

func TestTriggeredSkillSourceRecipientAttributeRestoresAndExpiresPrecisely(test *testing.T) {
	input, request, _, armor, speed := pairedCounterSourceInput(2600)
	input.Combatants[0].Attributes["armor_duration"] = authoringSlot(1200)
	request.InitialSnapshot.Combatants[0].Attributes["armor_duration"] = authoringSlot(1200)
	input.Formulas = append(input.Formulas,
		formuladefinition.FromExpr("constructed/armor_duration", "paired_counter", authoringRead("source.attr.armor_duration.resolved"), nil))
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "armor_duration", Domain: "attribute"})
	for index := range input.SharedProviders {
		if input.SharedProviders[index].ProviderKey == armor {
			input.SharedProviders[index].SkillKey = "paired_counter"
			input.SharedProviders[index].Lifecycle.DurationMs = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "constructed/armor_duration"})
		}
	}
	session := authoringCompile(test, input)
	done, err := runForTest(session, request)
	if err != nil {
		test.Fatal(err)
	}
	if done.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != 80 || done.FinalSnapshot.Combatants[0].Attributes["attack_speed"].Resolved != 1.5 {
		test.Fatal(done.FinalSnapshot)
	}
	for _, actor := range done.FinalSnapshot.Combatants {
		for _, instance := range actor.Providers {
			if instance.DefinitionRef == armor && (instance.Source != "source" || instance.Owner != "target" || *instance.ExpireAt != 3200) {
				test.Fatal(instance)
			}
		}
	}
	for _, end := range []int64{3199, 3200} {
		restored := request
		restored.InitialSnapshot = cloneSnapshot(done.FinalSnapshot)
		restored.DriverPlan.BasicAttack = nil
		restored.StopPolicy.DurationMs = end - restored.InitialSnapshot.TimeMs
		restored.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
		resumed, err := runForTest(session, restored)
		if err != nil {
			test.Fatal(err)
		}
		expected := float64(80)
		if end == 3200 {
			expected = 100
		}
		if resumed.FinalSnapshot.TimeMs != end || resumed.FinalSnapshot.Combatants[1].Attributes["armor"].Resolved != expected || resumed.FinalSnapshot.Combatants[0].Attributes["attack_speed"].Resolved != 1 {
			test.Fatal(end, resumed.FinalSnapshot)
		}
		for _, instance := range resumed.FinalSnapshot.Combatants[0].Providers {
			if instance.DefinitionRef == speed {
				test.Fatal("expired owned attribute survived restore", instance)
			}
		}
	}
	input.Formulas[len(input.Formulas)-1] = formuladefinition.Constant("constructed/armor_duration", "paired_counter", 1200)
	constantNamedDuration := authoringRun(test, input, request)
	if !reflect.DeepEqual(done, constantNamedDuration) {
		test.Fatal("constant and actual attribute-read nested duration formulas diverged")
	}
}

func TestTriggeredSkillSourceRejectsUnsafeInitialWaitWithoutPartialCommit(test *testing.T) {
	input, request := triggeredSourceInput(100)
	input.SharedProviders[0].Processes[0].Cooldown.DurationMs = authoringConst(9007199254740992)
	state, err := newGenericRunState(authoringCompile(test, input), request)
	if err != nil {
		test.Fatal(err)
	}
	takeNextEventForTest(state.loop)
	err = state.handleBasicAttack()
	if err == nil || state.actions.BasicAttack().Wait() != nil || state.combatants["source"].cooldowns.EntryCount() != 0 || state.actions.ProcessCount() != 0 || state.loop.QueuedEvents() != 0 {
		test.Fatal(err, state.actions.BasicAttack().Wait(), state.actions.ProcessViews(), state.loop.QueuedEvents())
	}
}

func TestTriggeredSkillSourceTargetCounterRefreshAndRestoredExpiry(test *testing.T) {
	input, request := triggeredSourceInput(2400)
	ref := addTriggeredSkillSource(&input, &request, 0, "target_refresh", "build",
		sourceCounterDefinition(model.EventTypeBasicAttackHit, eventSourceOwner, stateScopeProviderTarget, "count", 99, 1500))
	done := authoringRun(test, input, request)
	if targetCounterValue(test, done.FinalSnapshot, 0, ref, "count", "target") != 3 {
		test.Fatal("old expiry cleared a refreshed target counter", done.FinalSnapshot)
	}
	for _, end := range []int64{3499, 3500} {
		restored := request
		restored.DriverPlan.BasicAttack = nil
		restored.InitialSnapshot = cloneSnapshot(done.FinalSnapshot)
		restored.StopPolicy.DurationMs = end - restored.InitialSnapshot.TimeMs
		restored.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
		resumed := authoringRun(test, input, restored)
		expected := float64(3)
		if end == 3500 {
			expected = 0
		}
		if targetCounterValue(test, resumed.FinalSnapshot, 0, ref, "count", "target") != expected || resumed.FinalSnapshot.TimeMs != end {
			test.Fatal(end, resumed.FinalSnapshot)
		}
	}
}

func TestIntegerRestoredTimersUseStableOwnerAndSourceOrder(test *testing.T) {
	input, request := triggeredSourceInput(100)
	refs := []string{}
	for _, actor := range []int{0, 1} {
		for _, key := range []string{"second", "first"} {
			ref := addTriggeredSkillSource(&input, &request, actor, key, "build",
				sourceCounterDefinition(model.EventTypeBasicAttackHit, eventSourceOwner, stateScopeProviderTarget, "count", 4, 500))
			refs = append(refs, ref)
			if request.InitialSnapshot.Combatants[actor].ProviderState == nil {
				request.InitialSnapshot.Combatants[actor].ProviderState = map[string]interface{}{}
			}
			request.InitialSnapshot.Combatants[actor].ProviderState[ref] = map[string]interface{}{"targetState": map[string]interface{}{
				"target": opponentCombatantKey(input.Combatants[actor].Key), "values": map[string]interface{}{"count": float64(1)}, "expireAt": map[string]interface{}{"count": float64(250)},
			}}
		}
	}
	request.DriverPlan.BasicAttack = nil
	request.InitialSnapshot.TimeMs = 100
	session := authoringCompile(test, input)
	for attempt := 0; attempt < 8; attempt++ {
		state, err := newGenericRunState(session, request)
		if err != nil {
			test.Fatal(err)
		}
		order := []string{}
		for payloadIndex := 0; payloadIndex < state.effectTimers.ExpiryCount(); payloadIndex++ {
			payload := state.effectTimers.ExpiryAt(payloadIndex)
			order = append(order, payload.ProviderRef)
		}
		if !reflect.DeepEqual(order, []string{refs[1], refs[0], refs[3], refs[2]}) {
			test.Fatal("restored expiry order depends on map iteration", order)
		}
	}
}

func TestTriggeredSkillSourceDynamicAttributeBudgetFailureIsAtomic(test *testing.T) {
	for _, cause := range []model.BudgetCause{model.BudgetCauseMaxCommandsPerEvent, model.BudgetCauseMaxQueueEvents} {
		input, request, root, _, speed := pairedCounterSourceInput(100)
		state, err := newGenericRunState(authoringCompile(test, input), request)
		if err != nil {
			test.Fatal(err)
		}
		takeNextEventForTest(state.loop)
		if err := state.handleBasicAttack(); err != nil {
			test.Fatal(err)
		}
		queued := state.loop.QueuedEvents()
		if cause == model.BudgetCauseMaxCommandsPerEvent {
			state.budget.MaxCommandsPerEvent = 1
		} else {
			state.loop.SetQueueLimit(queued)
		}
		frame := state.newExecutionFrame("source", "target", "budgeted_attribute")
		frame.ownerCombatantKey, frame.ownerProviderRef = "source", root
		for _, operation := range state.compiled.Operations {
			if operation.ProviderDefinitionRef == speed {
				operation.HasCondition = false
				if err := frame.executeOperations(state.actions.BasicAttack().InitialAbility(), []planbundle.CompiledOperation{operation}); err != nil {
					test.Fatal(err)
				}
				break
			}
		}
		frame.commit()
		if !frame.fatal || frame.fatalErr.BudgetCause != cause || state.basicAttackReadyAt() != 1000 || state.combatants["source"].attributesView().At("attack_speed").Resolved != 1 || state.loop.QueuedEvents() != queued {
			test.Fatal(cause, frame.fatalErr, state.actions.BasicAttack().Wait(), state.loop.QueuedEvents())
		}
		for instanceIndex, instanceValues := 0, state.combatants["source"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
			provider := instanceValues.At(instanceIndex)
			if provider.DefinitionRef == speed {
				test.Fatal("failed dynamic attribute partially mounted", provider)
			}
		}
	}
}
