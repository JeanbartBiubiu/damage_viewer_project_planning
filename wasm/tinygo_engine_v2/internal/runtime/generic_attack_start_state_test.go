package runtime

import (
	"testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func addAttackCounter(input *model.CompileRequest, request *model.RunRequest, initial float64, ref string) {
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"})
	read := authoringRead("use.provider_state_before.hits")
	condition := func(op string) *model.GenericFormulaExpr {
		return authoringAmount(authoringBinary(op, read, authoringConst(2)))
	}
	listener := func(key, event string, test *model.GenericFormulaExpr, operations ...model.OperationDefinition) model.AbilityDefinition {
		return model.AbilityDefinition{AbilityKey: key, Kind: "passive_listener", SkillKey: "counter", ListenerSpec: &model.ListenerDefinition{
			ListenerKey: key, EventMatcher: model.TypeMatcher{All: []string{event, "event/source_owner"}}, Condition: test, Operations: operations}}
	}
	change := func(policy string, amount float64) model.OperationDefinition {
		return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "hits", ValuePolicy: policy, Types: []string{stateScopeProvider}, Amount: authoringAmount(authoringConst(amount))}
	}
	provider := model.ProviderDefinition{ProviderKey: ref, SkillKey: "counter", Kind: "character", StableID: ref,
		InitialStateSchema: map[string]interface{}{"hits": map[string]interface{}{"valueType": "integer", "defaultValue": initial, "maxValue": 2, "durationMs": 0}},
		Abilities: []model.AbilityDefinition{
			listener("consume", model.EventTypeBasicAttackStart, condition("eq"), change("set", 0)),
			listener("stack", model.EventTypeBasicAttackHit, condition("lt"), change("add", 1)),
			listener("bonus", model.EventTypeBasicAttackHit, condition("eq"), model.OperationDefinition{Operation: "damage", Target: "target", Ref: ref + "_bonus", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(5))}),
		}}
	input.SharedProviders = append(input.SharedProviders, provider)
	input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: ref, DefinitionRef: ref})
	request.InitialSnapshot.Combatants[0].Providers = append(request.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: ref, DefinitionRef: ref, Source: "source", Owner: "source", Stacks: 1})
}

func TestAttackStartCounterFrozenAcrossConsumptionAndUses(t *testing.T) {
	for _, initial := range []float64{0, 1, 2} {
		input, request := continuousAttackInput(1, 10000, 100, 0, 0, 3000)
		addAttackCounter(&input, &request, initial, "counter_a")
		compiled := authoringCompile(t, input)
		state, err := newGenericRunState(compiled, request)
		if err != nil {
			t.Fatal(err)
		}
		if err := state.runLoop(); err != nil {
			t.Fatal(err)
		}
		done := state.buildDoneResult()
		bonus := []int{1, 1, 2}[int(initial)]
		if !done.Summary.Execution.Complete || done.Summary.BasicAttack.HitCount != 4 || done.Summary.SourceDamageDealt != 400+float64(bonus)*5 {
			t.Fatal(initial, done.Summary)
		}
		for index := 0; index < 4; index++ {
			use := state.skillUses[done.AttackRecords[index].UseRef]
			want := float64((int(initial) + index) % 3)
			if len(use.providerStateBefore) != 1 || use.providerStateBefore[0].providerRef != "counter_a" || len(use.providerStateBefore[0].values) != 1 || use.providerStateBefore[0].values[0].Value != want {
				t.Fatal(initial, index, use.providerStateBefore, want)
			}
		}
	}
}

func TestAttackStartCounterNoHitKeepsStartConsumption(t *testing.T) {
	input, request := authoringInput()
	addAttackCounter(&input, &request, 2, "counter_a")
	request.DriverPlan.Entries = request.DriverPlan.Entries[:1]
	request.SkillHitFacts = nil
	state, err := newGenericRunState(authoringCompile(t, input), request)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult()
	if done.Summary.SourceDamageDealt != 0 {
		t.Fatal(done.Summary)
	}
	frame := state.newExecutionFrame("source", "target", "")
	bag := frame.providerStateBagForRead("source", "counter_a", false, providerStateReadOptions{})
	if bag == nil || bag.state["hits"] != 0 || state.skillUses["attack/1"].providerStateBefore[0].values[0].Value != 2 {
		t.Fatal(bag)
	}
}

func TestAttackStartCounterCaptureIsolatedByMountAndMissingContext(t *testing.T) {
	input, request := continuousAttackInput(1, 10000, 100, 0, 0, 1)
	addAttackCounter(&input, &request, 2, "counter_a")
	addAttackCounter(&input, &request, 0, "counter_b")
	// The shared type is declared only once.
	input.TypeCatalog.Types = input.TypeCatalog.Types[:len(input.TypeCatalog.Types)-1]
	state, err := newGenericRunState(authoringCompile(t, input), request)
	if err != nil {
		t.Fatal(err)
	}
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if got := state.buildDoneResult().Summary.SourceDamageDealt; got != 105 {
		t.Fatal(got)
	}
	frame := state.newExecutionFrame("source", "target", "")
	frame.ownerCombatantKey, frame.ownerProviderRef = "source", "counter_a"
	frame.eventCtx = &eventFormulaSnapshot{eventType: model.EventTypeBasicAttackHit, hasUse: true, useKey: "basic:native-test:1", useSource: "source", eventSourceKey: "source"}
	var ctx formula.GenericEvalContext
	frame.populateAttackStartStateContext(&ctx)
	if len(ctx.UseProviderStateBefore) != 1 || ctx.UseProviderStateBefore[0].Value != 2 {
		t.Fatal(ctx)
	}
	frame.ownerProviderRef = "unknown"
	ctx = formula.GenericEvalContext{}
	frame.populateAttackStartStateContext(&ctx)
	if len(ctx.UseProviderStateBefore) != 0 {
		t.Fatal("capture crossed mount")
	}
	frame.ownerProviderRef, frame.ownerCombatantKey = "counter_a", "target"
	frame.populateAttackStartStateContext(&ctx)
	if len(ctx.UseProviderStateBefore) != 0 {
		t.Fatal("capture crossed owner")
	}
}

func TestAttackStartCounterRejectsForeignAndNonIntegerReads(t *testing.T) {
	for _, scenario := range []string{"unknown", "decimal", "target", "no_owner", "skill_event", "amount"} {
		t.Run(scenario, func(t *testing.T) {
			input, request := continuousAttackInput(1, 10000, 100, 0, 0, 1)
			addAttackCounter(&input, &request, 2, "counter_a")
			provider := &input.SharedProviders[1]
			switch scenario {
			case "unknown":
				provider.Abilities[0].ListenerSpec.Condition = authoringAmount(authoringRead("use.provider_state_before.other"))
			case "decimal":
				provider.InitialStateSchema["hits"].(map[string]interface{})["valueType"] = "number"
			case "target":
				input.Combatants[1].Providers = input.Combatants[0].Providers[1:]
				input.Combatants[0].Providers = input.Combatants[0].Providers[:1]
			case "no_owner":
				provider.Abilities[0].ListenerSpec.EventMatcher.All = []string{model.EventTypeBasicAttackStart}
			case "skill_event":
				provider.Abilities[0].ListenerSpec.EventMatcher.All = []string{model.EventTypeHitLinkApplied, "event/source_owner"}
			case "amount":
				provider.Abilities[0].ListenerSpec.Operations[0].Amount = authoringAmount(authoringRead("use.provider_state_before.hits"))
			}
			if result := compilebundle.CompileGeneric(input); result.OK {
				t.Fatal("invalid capability compiled", scenario)
			}
		})
	}
}
