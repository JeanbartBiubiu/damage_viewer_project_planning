package execution

import (
	json "encoding/json"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func addMixedSpell(input *model.CompileRequest, request *model.RunRequest, name string, at int64, delay int64, occupies bool) {
	spell, cast := singleSkillInput(false)
	encoded, _ := json.Marshal(spell.SharedProviders[0])
	encoded = []byte(strings.NewReplacer("skill_source", name+"_definition", "configured_spell", name, "damage/physical", "damage/physics").Replace(string(encoded)))
	provider := model.ProviderDefinition{}
	if err := json.Unmarshal(encoded, &provider); err != nil {
		panic(err)
	}
	provider.Processes[0].Steps[0].DelayMs = timedShieldExpr(float64(delay))
	provider.Processes[0].Steps[0].OccupiesAction = &occupies
	input.SharedProviders = append(input.SharedProviders, provider)
	input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: name, DefinitionRef: provider.ProviderKey})
	request.InitialSnapshot.Combatants[0].Providers = append(request.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: name, DefinitionRef: provider.ProviderKey, Owner: "source", Source: "source", Stacks: 1})
	for _, entry := range spell.TypeCatalog.Types {
		found := false
		for _, existing := range input.TypeCatalog.Types {
			found = found || existing.Key == entry.Key
		}
		if !found {
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, entry)
		}
	}
	binding := spell.Rules.SkillActionBindings[0]
	binding.BindingKey, binding.SkillKey, binding.ProviderRef, binding.ProviderDefinitionRef = name+"_binding", name, name, provider.ProviderKey
	binding.Controls[0].AbilityRef = "source.provider[" + name + "].ability[initial]"
	binding.HitBindings[0].HitAbilityRef = "source.provider[" + name + "].ability[hit]"
	input.Rules.SkillActionBindings = append(input.Rules.SkillActionBindings, binding)
	plan := cast.DriverPlan.SkillActions[0]
	plan.InstructionKey, plan.SkillKey, plan.BindingKey, plan.AbilityRef, plan.FirstAtMs = name+"_first", name, binding.BindingKey, binding.Controls[0].AbilityRef, at
	request.DriverPlan.SkillActions = append(request.DriverPlan.SkillActions, plan)
}

func TestMixedActionStepQueueFailureDoesNotUnlockOrSpawnExtraAttack(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	addMixedSpell(&input, &request, "first", 0, 250, true)
	compiled := authoringCompile(test, input)
	state, err := newGenericRunState(compiled, request)
	if err != nil {
		test.Fatal(err)
	}
	state.loop.Queue().Pop()
	state.loop.Queue().SetLimit(1)
	if err := state.handleSkillAction(0); err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents {
		test.Fatal(err)
	}
	if state.actionOccupied("source") || state.loop.Queue().Len() != 1 || state.actions.ManualAt(0).Uses().StartedCount != 1 || state.actions.ManualAt(0).Uses().HitCount != 0 {
		test.Fatal("failed step transaction changed action ownership or attack queue")
	}
}

func TestMixedActionPureSkillRejectsUnsafeStepAndCooldownDeadlines(test *testing.T) {
	for _, cooldown := range []bool{false, true} {
		input, request := singleSkillInput(false)
		if cooldown {
			input.SharedProviders[0].Processes[0].Cooldown.DurationMs = *timedShieldExpr(float64(maxJSONSafeInteger))
		} else {
			input.SharedProviders[0].Processes[0].Steps[0].DelayMs = timedShieldExpr(float64(maxJSONSafeInteger))
		}
		compiled := authoringCompile(test, input)
		if _, err := runForTest(compiled, request); err == nil || err.Code != model.GenericErrRuntimeInvariantFailed {
			test.Fatal(cooldown, err)
		}
	}
}
