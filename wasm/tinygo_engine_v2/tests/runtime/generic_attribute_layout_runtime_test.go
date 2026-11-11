// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	bytes "bytes"
	json "encoding/json"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func TestAttributeLayoutSnapshotExtrasAndRunDriverReads(t *testing.T) {
	damage := frameCommitDamage(0)
	damage.Amount = authoringAmount(authoringRead("source.attr.late_snapshot.resolved"))
	input, request := frameCommitInput(damage)
	compiled := authoringCompile(t, input)
	initialCount, programs := compiled.AttributeLayout.Len(), compiled.Formulas.Metadata.Count()
	request.InitialSnapshot.Combatants[0].Attributes["late_snapshot"] = authoringSlot(37)
	request.InitialSnapshot.Combatants[1].Attributes["aaa_snapshot"] = authoringSlot(9)
	request.DriverPlan.Entries[0].Condition = authoringAmount(authoringBinary("eq", authoringRead("target.attr.aaa_snapshot.current"), authoringConst(9)))
	request.Sampling.Disabled = true
	request.ExpectedRulesHash = compiled.RulesHash
	before, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	for round := 0; round < 3; round++ {
		request.OutputMode = model.RunOutputDetailed
		detailed, err := runtimeengine.RunGeneric(compiled, request)
		if err != nil || detailed.Summary.SourceDamageDealt != 37 || detailed.Summary.TargetFinalHp != 963 {
			t.Fatalf("round=%d extra snapshot/driver reads lost: %+v %v", round, detailed.Summary, err)
		}
		request.OutputMode = model.RunOutputSummary
		summary, err := runtimeengine.RunGeneric(compiled, request)
		if err != nil {
			t.Fatal(err)
		}
		assertSummaryEquivalent(t, detailed, summary)
	}
	request.OutputMode = ""
	after, err := json.Marshal(request)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("run modified frozen request", err)
	}
	if compiled.AttributeLayout.Len() != initialCount || compiled.Formulas.Metadata.Count() != programs {
		t.Fatal("run modified shared compiled layout or programs")
	}
	for _, key := range []string{"late_snapshot", "aaa_snapshot"} {
		if _, exists := compiled.AttributeLayout.Lookup(key); exists {
			t.Fatal("runtime extra entered shared layout", key)
		}
	}
}

func TestAttributeLayoutRuntimeInsertedSlotIsReadByNextOperation(t *testing.T) {
	change := model.OperationDefinition{Operation: "attribute_change", Target: "source", AttributeKey: "created_runtime", ValuePolicy: "set", Amount: authoringAmount(authoringConst(20))}
	damage := frameCommitDamage(0)
	damage.Amount = authoringAmount(authoringRead("source.attr.created_runtime.resolved"))
	input, request := frameCommitInput(change, damage)
	compiled := authoringCompile(t, input)
	request.ExpectedRulesHash = compiled.RulesHash
	done, err := runtimeengine.RunGeneric(compiled, request)
	if err != nil || done.Summary.SourceDamageDealt != 20 || done.Summary.TargetFinalHp != 980 {
		t.Fatalf("inserted runtime slot was hidden: %+v %v", done.Summary, err)
	}
	if done.FinalSnapshot.Combatants[0].Attributes["created_runtime"].Base != 20 {
		t.Fatal("new slot omitted from final DTO")
	}
	if _, exists := request.InitialSnapshot.Combatants[0].Attributes["created_runtime"]; exists {
		t.Fatal("new slot published into initial snapshot")
	}
}
