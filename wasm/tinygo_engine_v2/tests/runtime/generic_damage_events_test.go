// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
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
					listener.EventMatcher.All = []string{"event/damage_dealt", "heat", "event/source_owner"}
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
