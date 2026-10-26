// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	bytes "bytes"
	json "encoding/json"
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const ownReceivedShieldPath = "event.damage.linked_shield[own_guard/value].absorbed"

// Keep the existing attack/received/expiry plan. A constant defense formula makes
// each independently chosen incoming amount equal to its post-defense amount;
// the real shield's attached armor still has to disappear and return correctly.
func receivedShieldInput(delay int64, amounts ...float64) (model.CompileRequest, model.RunRequest) {
	c, r := ownExpiryInput(delay, 1, 0, len(amounts))
	c.Rules.DamageTypeFormulas = []model.DamageTypeFormulaDefinition{{DamageType: "damage/physics", Formula: formuladefinition.ConstantDefense("1")}}
	c.SharedProviders[1].SkillKey, c.SharedProviders[2].SkillKey = "native_guard", "native_guard"
	p := &c.SharedProviders[2]
	hpLoss := authoringBinary("gt", authoringRead("event.damage.actualHpLoss"), gfConst(0))
	firstShieldLoss := authoringBinary("min", authoringBinary("eq", authoringRead("provider.state.wait"), gfConst(0)), authoringBinary("gt", authoringRead(ownReceivedShieldPath), gfConst(0)))
	p.Listeners[1].Condition = authoringAmount(authoringBinary("max", hpLoss, firstShieldLoss))
	if len(amounts) > 0 {
		expr := gfConst(amounts[len(amounts)-1])
		for i := len(amounts) - 2; i >= 0; i-- {
			expr = model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringBinary("eq", authoringRead("provider.state.count"), gfConst(float64(i))), gfConst(amounts[i]), expr}}
		}
		c.SharedProviders[3].Listeners[0].Operations[0].Amount = &expr
	}
	r.StopPolicy.DurationMs = int64(len(amounts))*1000 + 100
	return c, r
}

func receivedShieldEvents(done model.DoneResult, target string) []model.EvidenceItem {
	var events []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == model.EventTypeDamageTaken && item.Data["target"] == target {
			events = append(events, item)
		}
	}
	return events
}

func TestReceivedShieldOutputModesAndSameSessionReplay(t *testing.T) {
	c, r := receivedShieldInput(4000, 60, 60)
	r.StopPolicy.DurationMs = 6000
	compiled := authoringCompile(t, c)
	want, err := runtimeengine.RunGeneric(compiled, r)
	if err != nil {
		t.Fatal(err)
	}
	wantJSON, _ := json.Marshal(want)
	for i := 0; i < 100; i++ {
		got, err := runtimeengine.RunGeneric(compiled, r)
		gotJSON, _ := json.Marshal(got)
		if err != nil || !bytes.Equal(wantJSON, gotJSON) {
			t.Fatal("same compiled session leaked shield receipts or wait generations", i, err)
		}
	}
	for _, mode := range []string{"summary", "zero_records"} {
		run := r
		if mode == "summary" {
			run.OutputMode = model.RunOutputSummary
		} else {
			zero := 0
			run.RecordBudget = &model.RecordBudget{MaxResourceChangeRecords: &zero, MaxAutomaticSkillRecords: &zero, MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxHealingRecords: &zero, MaxMechanicRecords: &zero, MaxAttackRecords: &zero, MaxDamageRecords: &zero}
		}
		got, err := runtimeengine.RunGeneric(compiled, run)
		if err != nil || !reflect.DeepEqual(got.FinalSnapshot, want.FinalSnapshot) || got.Summary.SourceFinalHp != 980 || ownShieldRemaining(got) != 100 || got.Summary.BasicAttack.CompletedCount != want.Summary.BasicAttack.CompletedCount || !reflect.DeepEqual(got.Evidence.CountsByKind, want.Evidence.CountsByKind) {
			t.Fatal("record retention changed shield/wait/health facts", mode, err, got.Summary)
		}
		if len(got.DamageRecords)+len(got.AttackRecords)+len(got.MechanicRecords) != 0 {
			t.Fatal("explicit nonretention returned records", mode)
		}
	}
}
