package runtime

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestDamageDealtArbitraryTypeAndMixedContributions(t *testing.T) {
	for _, mixed := range []bool{false, true} {
		t.Run(itoaRuntime(boolCount(mixed)), func(t *testing.T) {
			input, request := loadLinkedEffectsFixture(t, 1, func(input *model.CompileRequest, _ *model.RunRequest) {
				for _, key := range []string{"heat", "quiet"} {
					input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "damage"})
				}
				formuladefinition.SetDamageFormula(input, "heat", formuladefinition.ConstantDefense("1"))
				formuladefinition.SetDamageFormula(input, "quiet", formuladefinition.ConstantDefense("0"))
				operations := []model.OperationDefinition{
					{Operation: "damage", Target: "target", DamageType: "heat", Ref: "heat_first", Amount: authoringAmount(authoringConst(20))},
					{Operation: "damage", Target: "target", DamageType: "heat", Ref: "heat_second", Amount: authoringAmount(authoringConst(30))},
					{Operation: "damage", Target: "target", DamageType: "quiet", Ref: "fully_defended", Amount: authoringAmount(authoringConst(5))},
				}
				if mixed {
					operations = append(operations, linkedEffectsAAOps(100)...)
				}
				configureLinkedEffectsChampionAA(input, operations, []string{"ability/basic_attack"})
				for index := range input.SharedProviders {
					provider := &input.SharedProviders[index]
					if provider.ProviderKey != blackCleaverProviderRef {
						continue
					}
					provider.InitialStateSchema["heat_events"] = map[string]interface{}{
						"defaultValue": float64(0), "maxValue": float64(10), "durationMs": float64(blackCleaverDurationMs),
						"refreshPolicy": model.ProviderStateRefreshOnWrite,
					}
					listener := blackCleaverCarveListener()
					listener.ListenerKey = "observe_heat_frame"
					listener.EventMatcher.All = []string{eventTypeDamageDealt, "heat", "event/source_owner"}
					listener.Operations[0].Ref = "heat_events"
					provider.Listeners = append(provider.Listeners, listener)
				}
			})
			done := runLinkedEffects(t, input, request)
			events := damageDealtEmittedEvidence(done)
			if len(events) != 1 {
				t.Fatalf("aggregate events=%d, want one original frame", len(events))
			}
			data := events[0].Data
			wantRaw, wantMitigated := float64(50), float64(50)
			wantTypes := []string{"heat"}
			if mixed {
				wantRaw, wantMitigated = 150, 100
				wantTypes = []string{"damage/physical", "heat"}
				if _, exists := data["damageType"]; exists {
					t.Fatal("mixed frame must not invent a single damage type")
				}
			} else if data["damageType"] != "heat" {
				t.Fatal(data)
			}
			if !reflect.DeepEqual(data["damageTypes"], wantTypes) || data["rawAmount"] != wantRaw || data["mitigatedAmount"] != wantMitigated {
				t.Fatal(data)
			}
			if done.Summary.SourceDamageDealt != wantMitigated || carveStacksFromSnapshot(t, done.FinalSnapshot, "source", blackCleaverProviderRef) != float64(boolCount(mixed)) {
				t.Fatal(done.Summary, done.FinalSnapshot)
			}
			bag := done.FinalSnapshot.Combatants[0].ProviderState[blackCleaverProviderRef].(map[string]interface{})
			values := bag["targetState"].(map[string]interface{})["values"].(map[string]interface{})
			if values["heat_events"] != float64(1) {
				t.Fatalf("heat observer must trigger once for two contributions: %v", values)
			}
			breakdown := data["damageBreakdown"].([]map[string]interface{})
			if len(breakdown) != len(wantTypes) {
				t.Fatal(breakdown)
			}
			heat := breakdown[len(breakdown)-1]
			if heat["damageType"] != "heat" || heat["rawAmount"] != float64(50) || heat["mitigatedAmount"] != float64(50) || !reflect.DeepEqual(heat["operationRefs"], []string{"heat_first", "heat_second"}) {
				t.Fatal(heat)
			}
		})
	}
}

func boolCount(value bool) int {
	if value {
		return 1
	}
	return 0
}

func TestDamageDealtOverflowRejectsBeforeCommitRegardlessOfRecording(t *testing.T) {
	for _, sameType := range []bool{false, true} {
		for _, evidenceLimit := range []int{0, 1000} {
			input, request := frameCommitInput(
				model.OperationDefinition{Operation: "shield", Target: "target", Amount: authoringAmount(authoringConst(50))},
				frameCommitDamage(1e308), frameCommitDamage(1e308),
			)
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: eventTypeDamageDealt, Domain: "event"})
			for index, key := range []string{"heat", "cold"} {
				input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "damage"})
				formuladefinition.SetDamageFormula(&input, key, formuladefinition.ConstantDefense("0."+strings.Repeat("0", 307)+"1"))
				input.SharedProviders[0].Abilities[0].Operations[index+1].DamageType = key
			}
			if sameType {
				input.SharedProviders[0].Abilities[0].Operations[2].DamageType = "heat"
			}
			state := frameCommitState(t, input, request)
			state.budget.MaxEvidenceItems = evidenceLimit
			beforeFormulas := *state.formulas.CloneForRun()
			issue := state.runLoop()
			if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != "sharedProviders[0].abilities[0].operations[2]" {
				t.Fatal("aggregation overflow did not fail at the contributing operation", issue)
			}
			if state.combatants["target"].attributes["hp"].Current != 1000 || len(state.combatants["target"].shields) != 0 || state.sourceDamageDealt != 0 || len(state.damageHistory) != 0 {
				t.Fatal("aggregation overflow committed partial frame", sameType, evidenceLimit)
			}
			if !reflect.DeepEqual(state.formulas, beforeFormulas) {
				t.Fatal("failed aggregation mutated reusable formula programs")
			}
			for repeat := 0; repeat < 2; repeat++ {
				if _, nextIssue := RunGeneric(state.compiled, request); nextIssue == nil || nextIssue.Code != model.GenericErrRuntimeInvariantFailed {
					t.Fatal("same compiled plan failed to reject deterministically", nextIssue)
				}
			}
			// 同一会话计划的下一次无操作运行不能残留失败帧的护盾或伤害。
			freshRequest := request
			freshRequest.DriverPlan.Entries = nil
			if done, nextIssue := RunGeneric(state.compiled, freshRequest); nextIssue != nil || done.Summary.TargetFinalHp != 1000 || len(done.FinalSnapshot.Combatants[1].Shields) != 0 {
				t.Fatal("failed frame contaminated following run", done.Summary, nextIssue)
			}
			// 作者不声明聚合时，未使用的功能不能阻断逐笔有限伤害。
			declared := make([]model.TypeCatalogEntry, 0, len(input.TypeCatalog.Types))
			for _, row := range input.TypeCatalog.Types {
				if row.Key != eventTypeDamageDealt || row.Domain != "event" {
					declared = append(declared, row)
				}
			}
			input.TypeCatalog.Types = declared
			done, nextIssue := RunGeneric(authoringCompile(t, input), request)
			if nextIssue != nil || math.Abs(done.Summary.SourceDamageDealt-2) > 1e-9 || len(damageDealtEmittedEvidence(done)) != 0 {
				t.Fatal("unused aggregate affected finite per-instance damage", done.Summary, nextIssue)
			}
			if _, jsonIssue := json.Marshal(done); jsonIssue != nil {
				t.Fatal("finite per-instance evidence failed serialization", jsonIssue)
			}
		}
	}
}
