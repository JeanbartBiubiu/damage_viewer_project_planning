package report

import (
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/contract"
)

func TestDamageProjectionPreservesAbsentNullZeroAndNumericTypes(t *testing.T) {
	fact := contract.DamageFact{CastInstanceID: 7, Crit: contract.CritEvidence{Present: true}}
	evidence := DamageEvidenceItem(fact, 10).Data
	if evidence["castInstanceId"] != float64(7) || evidence["baseRawAmount"] != float64(0) || evidence["eligible"] != false {
		t.Fatalf("evidence types or zero changed: %+v", evidence)
	}
	for _, key := range []string{"chanceRaw", "policy", "providerRef", "traits", "sourceHpBefore", "hitRef"} {
		if _, present := evidence[key]; present {
			t.Fatalf("unexpected evidence field %s", key)
		}
	}
	detail := CommittedDamageDetails(fact, 10, DamageDetailOwnership{SkillPlan: true, HasInstructionKey: true})
	if detail["castInstanceId"] != uint64(7) || detail["attackIndex"] != nil || detail["hitRef"] != nil || detail["sourceHpBefore"] != nil || detail["useRef"] != "" {
		t.Fatalf("detailed nulls or types changed: %+v", detail)
	}
	if value, present := detail["instructionKey"]; !present || value != "" {
		t.Fatalf("explicit empty instruction lost: %+v", detail)
	}
	fact.HasSourceHp = true
	detail = CommittedDamageDetails(fact, 10, DamageDetailOwnership{})
	if detail["sourceHpBefore"] != float64(0) || detail["sourceHpAfter"] != float64(0) || detail["attackIndex"] != int(0) {
		t.Fatalf("valid zero lost: %+v", detail)
	}
	if _, present := detail["hitRef"]; present {
		t.Fatalf("attack-only detail gained hit field: %+v", detail)
	}
}

func TestDamageProjectionKeepsFrozenTraitsAndEmpoweredOwnership(t *testing.T) {
	fact := contract.DamageFact{Traits: []string{"first", "second"}, EmpoweredAttack: &model.ProcessEmpoweredAttack{HitRef: "empowered-hit"}, ActivationUseRef: "activation"}
	detail := CommittedDamageDetails(fact, 0, DamageDetailOwnership{SkillPlan: true, HitOccurrenceID: 9, UseRef: "activation", HasAttackIndex: true, AttackIndex: 3})
	if detail["hitRef"] != "empowered-hit" || detail["useRef"] != "activation" || detail["attackIndex"] != 3 || detail["empoweredAttack"] != fact.EmpoweredAttack {
		t.Fatalf("ownership changed: %+v", detail)
	}
	fact.Traits[0] = "later"
	if detail["traits"].([]string)[0] != "first" {
		t.Fatal("report retained mutable trait list")
	}
}

func TestExecuteAndSnapshotProjectionKeepReferenceAndOptionalZero(t *testing.T) {
	item := ExecuteEvidenceItem(contract.ExecuteFact{AbilityRef: "ability"}, 10)
	if item.Ref != "ability" || item.TimeMs != 10 || item.Data["threshold"] != float64(0) || item.Data["thresholdType"] != "current_hp_ratio" || item.Data["comparison"] != "strict_below" {
		t.Fatalf("execute=%+v", item)
	}
	item = ExecuteEvidenceItem(contract.ExecuteFact{AbilityRef: "ability", OperationRef: "operation"}, 10)
	if item.Ref != "operation" {
		t.Fatalf("execute reference priority changed: %+v", item)
	}
	without := DamageSnapshotEvidenceData(formula.EventDamageSnapshot{})
	if _, present := without["killed"]; present {
		t.Fatal("absent killed became a zero")
	}
	with := DamageSnapshotEvidenceData(formula.EventDamageSnapshot{HasKilled: true})
	if value, present := with["killed"]; !present || value != float64(0) {
		t.Fatalf("explicit killed zero lost: %+v", with)
	}
}
