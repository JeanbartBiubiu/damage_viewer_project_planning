package report

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestEvidenceBudgetKeepsOrderAndClassificationsWithoutDetails(t *testing.T) {
	kinds := []model.EvidenceKind{model.EvidenceKindDamage, model.EvidenceKindHeal, model.EvidenceKindDamage, model.EvidenceKindSkillHit}
	for _, detailed := range []bool{false, true} {
		for _, limit := range []int{0, 2, 4} {
			var report State
			for index, kind := range kinds {
				report.RecordEvidence(model.EvidenceItem{Kind: kind, TimeMs: int64(index)}, detailed, limit)
			}
			if report.evidenceRetainedCount != limit || report.truncatedEvidenceCount != 4-limit {
				t.Fatal("retention changed", detailed, limit)
			}
			if !reflect.DeepEqual(report.evidenceCountsByKind, map[string]int{"damage": 2, "heal": 1, "skill_hit": 1}) {
				t.Fatal(report.evidenceCountsByKind)
			}
			kept := map[string]int{}
			for _, kind := range kinds[:limit] {
				kept[string(kind)]++
			}
			if !detailed {
				if len(report.evidence) != 0 || !reflect.DeepEqual(report.evidenceRetainedByKind, kept) && limit > 0 {
					t.Fatal("summary retained display values or lost order", report.evidenceRetainedByKind)
				}
			} else {
				if len(report.evidence) != limit {
					t.Fatal(report.evidence)
				}
				for index, row := range report.evidence {
					if row.TimeMs != int64(index) || row.Kind != kinds[index] {
						t.Fatal("evidence reordered", report.evidence)
					}
				}
			}
		}
	}
}

func TestCommittedTotalsSurviveZeroRetentionAndSampling(t *testing.T) {
	zero := 0
	var report State
	report.InitBasicRecords(&model.RecordBudget{MaxDamageRecords: &zero, MaxAttackRecords: &zero, MaxMechanicRecords: &zero})
	report.InitSkillRecords(&model.RecordBudget{MaxHealingRecords: &zero})
	if !report.InitSampling(model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 500, MaxSeriesPoints: 4}, 0, 1000) {
		t.Fatal("sampling")
	}
	report.RecordDamage("source", "target", 100, 100)
	report.RecordDamage("source", "target", 50, 700)
	report.RecordOverheal("target", 20)
	report.RecordDirectHealing(model.DirectHealingRecord{Target: "source", ActualHealing: 30}, false)
	report.RecordCommittedDamage(DamageFact{Source: "source", Target: "target", MitigatedAmount: 150, ShieldAbsorbed: 20, HPLoss: 100, VampHealing: 10}, true)
	totals := report.Totals()
	if totals.SourceDamageDealt != 150 || totals.TargetDamageTaken != 150 || totals.TargetHpLoss != 100 || totals.SourceVampHealing != 10 || totals.SourceDirectHealing != 30 || totals.TargetOverheal != 20 {
		t.Fatal(totals)
	}
	point := report.SeriesPoint(1000, 900, 800)
	if point.SourceWindowDps != 100 || point.SourceCumulativeDps != 150 || point.SourceHp != 900 || point.TargetHp != 800 {
		t.Fatal(point)
	}
	if len(report.Snapshot().DamageRecords) != 0 || report.Recording(0, true).DamageRecordCount != 1 || report.EffectiveSampleEveryMs() != 334 {
		t.Fatal("display budget affected computation")
	}
}

func TestOutputDetachesEvidenceAndAbilityNumbers(t *testing.T) {
	var report State
	report.RecordEvidence(model.EvidenceItem{Kind: model.EvidenceKindDamage, Data: map[string]interface{}{"nested": map[string]interface{}{"amount": 10.0}}}, true, 10)
	report.AbilityOutput("ability", 10, 20)
	first := report.Snapshot()
	first.Evidence.Items[0].Data["nested"].(map[string]interface{})["amount"] = 999.0
	first.Evidence.CountsByKind["damage"] = 999
	stats := report.AbilityStats()
	*stats[0].DamageDealt = 999
	second := report.Snapshot()
	if second.Evidence.Items[0].Data["nested"].(map[string]interface{})["amount"] != 10.0 || second.Evidence.CountsByKind["damage"] != 1 || *report.AbilityStats()[0].DamageDealt != 10 {
		t.Fatal("report output aliases private containers")
	}
}

func TestSnapshotIsolatesTypedRecordsAndFinishTransfersOwnership(t *testing.T) {
	var report State
	report.InitBasicRecords(nil)
	report.InitSkillRecords(nil)
	report.InitResourceRecords(nil, true)
	ready := int64(100)
	ref := "use"
	index := report.AppendAttack(model.BasicAttackRecord{ReadyAtMs: &ready}, true)
	report.RecordResourceChange(model.ResourceChangeRecord{Contributors: []model.ResourceChangeContributor{{ProviderRef: "original"}}}, true)
	report.AppendSkillUse(model.SkillUseRecord{EmpoweredAttack: &model.ProcessEmpoweredAttack{ReplacedPrimary: &model.BasicAttackPrimaryIdentity{CandidateKey: "primary"}}, HitRef: &ref})
	report.RecordEvidence(model.EvidenceItem{Kind: model.EvidenceKindDamage, Data: map[string]interface{}{"modifiers": []map[string]interface{}{{"amount": 10.0}}, "shieldAbsorptions": []model.ShieldAbsorptionRecord{{ShieldRef: "original"}}}}, true, 10)
	row := report.Snapshot().AttackRecords[index]
	*row.ReadyAtMs = 999
	snapshot := report.Snapshot()
	*snapshot.AttackRecords[0].ReadyAtMs = 777
	snapshot.ResourceChangeRecords[0].Contributors[0].ProviderRef = "changed"
	snapshot.SkillUseRecords[0].EmpoweredAttack.ReplacedPrimary.CandidateKey = "changed"
	*snapshot.SkillUseRecords[0].HitRef = "changed"
	snapshot.Evidence.Items[0].Data["modifiers"].([]map[string]interface{})[0]["amount"] = 999.0
	snapshot.Evidence.Items[0].Data["shieldAbsorptions"].([]model.ShieldAbsorptionRecord)[0].ShieldRef = "changed"
	actual := report.Snapshot()
	if *actual.AttackRecords[0].ReadyAtMs != 100 || actual.ResourceChangeRecords[0].Contributors[0].ProviderRef != "original" || actual.SkillUseRecords[0].EmpoweredAttack.ReplacedPrimary.CandidateKey != "primary" || *actual.SkillUseRecords[0].HitRef != "use" || actual.Evidence.Items[0].Data["modifiers"].([]map[string]interface{})[0]["amount"] != 10.0 || actual.Evidence.Items[0].Data["shieldAbsorptions"].([]model.ShieldAbsorptionRecord)[0].ShieldRef != "original" {
		t.Fatal("snapshot reached live report state")
	}
	finished := report.Finish()
	if len(finished.AttackRecords) != 1 || len(finished.Evidence.Items) != 1 || len(report.attackRecords) != 0 || len(report.evidenceCountsByKind) != 0 || len(report.damageBreakdownIndex) != 0 {
		t.Fatal("finished containers retained a report owner")
	}
}
