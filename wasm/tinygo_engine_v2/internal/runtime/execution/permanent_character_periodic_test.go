package execution

import (
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func permanentCharacterPeriodInput(ownerIndex int, background bool, hp float64, duration int64) (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(1, hp, 10, 0, 0, duration)
	periodicOpponentDefenseInputs(&input, &request)
	owner := input.Combatants[ownerIndex].Key
	definition := periodicEquipmentDefinition(5, 500, 500)
	definition.ProviderKey = owner + "_aura_definition"
	definition.StableID = owner + "_aura"
	definition.Kind = "character"
	definition.SkillKey = "test_periodic"
	input.SharedProviders = append(input.SharedProviders, definition)
	input.Combatants[ownerIndex].Providers = append(input.Combatants[ownerIndex].Providers,
		model.CombatantProviderMount{ProviderRef: owner + "_aura", DefinitionRef: definition.ProviderKey})
	request.InitialSnapshot.Combatants[ownerIndex].Providers = append(request.InitialSnapshot.Combatants[ownerIndex].Providers,
		model.CombatantProviderSnapshot{ProviderRef: owner + "_aura", DefinitionRef: definition.ProviderKey, Source: owner, Owner: owner, Stacks: 1})
	if !background {
		request.DriverPlan.BasicAttack = nil
		stopWhenNoEvents := false
		request.StopPolicy.StopWhenNoEvents = &stopWhenNoEvents
	}
	return input, request
}

func TestPermanentCharacterPeriodMixedAndWithoutBasicAttack(t *testing.T) {
	for _, background := range []bool{false, true} {
		for _, ownerIndex := range []int{0, 1} {
			name := []string{"source", "target"}[ownerIndex]
			if background {
				name += "/mixed"
			}
			t.Run(name, func(t *testing.T) {
				input, request := permanentCharacterPeriodInput(ownerIndex, background, 1000, 1100)
				done := authoringRun(t, input, request)
				owner := input.Combatants[ownerIndex].Key
				opponent := opponentCombatantKey(owner)
				var times []int64
				for _, row := range done.DamageRecords {
					if row["operationRef"] != "periodic_damage" {
						continue
					}
					if row["source"] != owner || row["target"] != opponent || row["postDefenseDamage"] != float64(5) || row["useRef"] != "" {
						t.Fatal(row)
					}
					times = append(times, row["timeMs"].(int64))
				}
				if !reflect.DeepEqual(times, []int64{500, 1000}) || done.FinalSnapshot.TimeMs != 1100 || done.Summary.StopReason != model.StopReasonDurationReached {
					t.Fatal(times, done.Summary)
				}
				if repeated := authoringRun(t, input, request); !reflect.DeepEqual(done, repeated) {
					t.Fatal("permanent character period changed across fresh runs")
				}
			})
		}
	}
}
