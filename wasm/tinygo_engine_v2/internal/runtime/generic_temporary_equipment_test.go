package runtime

import (
	"reflect"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func temporaryEquipmentPeriod(input *model.CompileRequest, request *model.RunRequest, actor int, duration, damage float64) string {
	owner := input.Combatants[actor].Key
	key := owner + "_temporary_period"
	definition := periodicEquipmentDefinition(damage, 1000, 1000)
	definition.ProviderKey = key + "_effect"
	definition.Kind = "status"
	definition.StableID = key
	definition.Lifecycle = sourceTargetLifecycle(duration)
	input.SharedProviders = append(input.SharedProviders, definition)
	event, relation := model.EventTypeBasicAttackHit, eventSourceOwner
	if actor == 1 {
		event, relation = model.EventTypeBasicAttackReceived, eventTargetOwner
	}
	addCadenceEquipment(input, request, actor, "temporary_period", model.ProviderDefinition{Listeners: []model.ListenerDefinition{{
		ListenerKey: "activate", EventMatcher: model.TypeMatcher{All: []string{event, relation}}, MaxTriggersPerEvent: 1,
		Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: definition.ProviderKey}},
	}}})
	return definition.ProviderKey
}

func TestContinuousTemporaryEquipmentRefreshKeepsUniqueTickPhase(test *testing.T) {
	input, request := continuousAttackInput(1.0/4.2, 10000, 10, 0, 0, 9100)
	receivedEquipmentTypes(&input)
	definition := temporaryEquipmentPeriod(&input, &request, 0, 4500, 5)
	done := authoringRun(test, input, request)
	var times []int64
	for _, row := range done.DamageRecords {
		if row["providerDefinitionRef"] == definition {
			times = append(times, row["timeMs"].(int64))
			if row["attackIndex"] != 0 || row["useRef"] != "" || row["owner"] != "source" || !strings.Contains(row["abilityRef"].(string), "#1]") {
				test.Fatal(row)
			}
		}
	}
	if !reflect.DeepEqual(times, []int64{1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000}) || done.Summary.SourceDamageDealt != 75 || done.Summary.BasicAttack.CompletedCount != 3 || !done.Summary.Execution.Complete {
		test.Fatal(times, done.Summary)
	}
	zero := 0
	request.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero}
	truncated := authoringRun(test, input, request)
	if !reflect.DeepEqual(done.Summary, truncated.Summary) {
		test.Fatal("period changed when records were dropped", done.Summary, truncated.Summary)
	}
}

func TestContinuousTemporaryEquipmentOpposingPeriodKillsAttacker(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 4000)
	receivedEquipmentTypes(&input)
	periodicOpponentDefenseInputs(&input, &request)
	definition := temporaryEquipmentPeriod(&input, &request, 1, 3000, 1000)
	done := authoringRun(test, input, request)
	if done.Summary.StopReason != "source_dead" || done.Summary.SourceFinalHp != 0 || done.Summary.TargetDamageDealt != 1000 || done.FinalSnapshot.TimeMs != 1000 || !done.Summary.Execution.Complete {
		test.Fatal(done.Summary)
	}
	for _, row := range done.DamageRecords {
		if row["providerDefinitionRef"] == definition && (row["owner"] != "target" || row["source"] != "target" || row["target"] != "source" || row["attackIndex"] != 0) {
			test.Fatal(row)
		}
	}
}

func TestContinuousTemporaryEquipmentExpiryIsExclusive(test *testing.T) {
	input, request := continuousAttackInput(.2, 10000, 10, 0, 0, 4000)
	receivedEquipmentTypes(&input)
	temporaryEquipmentPeriod(&input, &request, 0, 3000, 5)
	done := authoringRun(test, input, request)
	if done.Summary.SourceDamageDealt != 20 || done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 2 {
		test.Fatal("expired period fired at its deadline", done.Summary, done.Evidence.CountsByKind)
	}
}

func TestContinuousTemporaryEquipmentRefreshBeforeDelayedFirstTick(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2500)
	receivedEquipmentTypes(&input)
	definition := temporaryEquipmentPeriod(&input, &request, 0, 1500, 5)
	for index := range input.SharedProviders {
		if input.SharedProviders[index].ProviderKey == definition {
			input.SharedProviders[index].Abilities[0].TickSpec.StartDelayMs = 2000
			input.SharedProviders[index].Abilities[0].TickSpec.IntervalMs = 2000
		}
	}
	done := authoringRun(test, input, request)
	if done.Summary.SourceDamageDealt != 35 || done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 1 {
		test.Fatal("refresh lost the delayed first tick", done.Summary, done.Evidence.CountsByKind)
	}
}
