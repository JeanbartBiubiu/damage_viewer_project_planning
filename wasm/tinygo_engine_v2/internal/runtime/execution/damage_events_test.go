package execution

import (
	json "encoding/json"
	math "math"
	reflect "reflect"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

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
			beforeFormulas := state.formulas
			issue := state.runLoop()
			if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != "sharedProviders[0].abilities[0].operations[2]" {
				t.Fatal("aggregation overflow did not fail at the contributing operation", issue)
			}
			if state.combatants["target"].attributesView().At("hp").Current != 1000 || state.combatants["target"].instances.Shields().Len() != 0 || state.report.Totals().SourceDamageDealt != 0 || len(reportedDamageHistory(state)) != 0 {
				t.Fatal("aggregation overflow committed partial frame", sameType, evidenceLimit)
			}
			if !reflect.DeepEqual(state.formulas, beforeFormulas) {
				t.Fatal("failed aggregation mutated reusable formula programs")
			}
			for repeat := 0; repeat < 2; repeat++ {
				if _, nextIssue := runForTest(state.compiled, request); nextIssue == nil || nextIssue.Code != model.GenericErrRuntimeInvariantFailed {
					t.Fatal("same compiled plan failed to reject deterministically", nextIssue)
				}
			}
			// 同一会话计划的下一次无操作运行不能残留失败帧的护盾或伤害。
			freshRequest := request
			freshRequest.DriverPlan.Entries = nil
			if done, nextIssue := runForTest(state.compiled, freshRequest); nextIssue != nil || done.Summary.TargetFinalHp != 1000 || len(done.FinalSnapshot.Combatants[1].Shields) != 0 {
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
			done, nextIssue := runForTest(authoringCompile(t, input), request)
			if nextIssue != nil || math.Abs(done.Summary.SourceDamageDealt-2) > 1e-9 || len(damageDealtEmittedEvidence(done)) != 0 {
				t.Fatal("unused aggregate affected finite per-instance damage", done.Summary, nextIssue)
			}
			if _, jsonIssue := json.Marshal(done); jsonIssue != nil {
				t.Fatal("finite per-instance evidence failed serialization", jsonIssue)
			}
		}
	}
}
