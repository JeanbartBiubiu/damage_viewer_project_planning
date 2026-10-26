// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func configuredMovementEquipment(duration int64) (model.CompileRequest, model.RunRequest) {
	input, request := continuousAttackInput(.5, 10000, 100, 0, 0, duration)
	definition := slowProvider("configured_slow", "movement", "ordinary_slow", .3, 1000)
	definition.StableID = "source_movement_equipment"
	input.SharedProviders = append(input.SharedProviders, definition)
	addCadenceEquipment(&input, &request, 0, "movement_equipment", model.ProviderDefinition{
		Listeners: []model.ListenerDefinition{{ListenerKey: "apply_movement", MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
			Operations:   []model.OperationDefinition{applyOp(definition.ProviderKey)},
		}},
	})
	return input, request
}

func TestContinuousMovementEquipmentDeclarationExpiryAndRefresh(test *testing.T) {
	for _, duration := range []int64{999, 1000, 2000} {
		input, request := configuredMovementEquipment(duration)
		done := authoringRun(test, input, request)
		if !done.Summary.Execution.Complete {
			test.Fatal(done.Summary)
		}
		status := effectiveSlow(test, done)
		if duration == 1000 {
			if len(status.Contributions) != 0 {
				test.Fatal("expired movement status remained effective", status)
			}
		} else {
			if status.Strength != .3 || len(status.Contributions) != 1 || status.Contributions[0].Source != "source" {
				test.Fatal("movement status lost its actual equipment source", status)
			}
		}
		for _, attack := range done.AttackRecords {
			if attack.AttackSpeed != .5 {
				test.Fatal("ordinary movement slow incorrectly changed attack speed", attack)
			}
		}
		if repeated := authoringRun(test, input, request); !reflect.DeepEqual(done, repeated) {
			test.Fatal("movement equipment fresh runs diverged")
		}
		zero := 0
		request.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero}
		truncated := authoringRun(test, input, request)
		if !reflect.DeepEqual(done.Summary, truncated.Summary) || !reflect.DeepEqual(done.FinalSnapshot, truncated.FinalSnapshot) {
			test.Fatal("record budget changed movement equipment execution")
		}
	}
}

func TestContinuousMovementEquipmentRejectsWrongTargetOrMixedDefinition(test *testing.T) {
	for _, scenario := range []string{"self", "unselected_source", "mixed_healing", "multiple_contributions", "periodic_lifecycle"} {
		test.Run(scenario, func(test *testing.T) {
			input, request := configuredMovementEquipment(500)
			var definition *model.ProviderDefinition
			for index := range input.SharedProviders {
				if input.SharedProviders[index].ProviderKey == "configured_slow" {
					definition = &input.SharedProviders[index]
				}
			}
			if definition == nil {
				test.Fatal("missing configured movement definition")
			}
			switch scenario {
			case "self":
				input.SharedProviders[len(input.SharedProviders)-1].Listeners[0].Operations[0].Target = "self"
			case "unselected_source":
				definition.StableID = "another_source"
			case "mixed_healing":
				definition.Modifiers = woundProvider("mixed_wound", -.4, 1000, model.HealAny, "mixed_group").Modifiers
			case "multiple_contributions":
				duplicate := definition.StatusContributions[0]
				duplicate.ResultRef = "second_movement"
				definition.StatusContributions = append(definition.StatusContributions, duplicate)
			case "periodic_lifecycle":
				definition.Lifecycle.TickIntervalMs = 100
			}
			compiled := compile.CompileGeneric(input)
			if !compiled.OK {
				test.Fatalf("scenario was rejected before continuous admission: %+v", compiled.Result.Errors)
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, request); err == nil {
				test.Fatal("unsupported equipment movement result was admitted")
			}
		})
	}
}
