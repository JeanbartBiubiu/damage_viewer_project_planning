package runtime

import (
	"math"
	"testing"
	"tinygo_engine_v2/internal/model"
)

func continuousAttackInput(as, hp, damage, armor, crit float64, duration int64) (model.CompileRequest, model.RunRequest) {
	c, r := authoringInput()
	c.SharedProviders[0].Processes[0].Cooldown.DurationMs = model.GenericFormulaExpr{Op: "ref", Ref: "test/attack_interval_ms"}
	c.SharedProviders[0].Processes[0].Cooldown.RoundPositiveMs = true
	values := map[string]float64{"attack_speed": as, "attack_damage": damage, "critical_strike_chance": crit, "critical_strike_damage_bonus_percent": 0, "armor_pen_percent": 0, "armor_pen_flat": 0}
	for k, v := range values {
		c.Combatants[0].Attributes[k] = authoringSlot(v)
		r.InitialSnapshot.Combatants[0].Attributes[k] = authoringSlot(v)
	}
	c.Combatants[1].Attributes["hp"] = authoringSlot(hp)
	c.Combatants[1].Attributes["armor"] = authoringSlot(armor)
	r.InitialSnapshot.Combatants[1].Attributes["hp"] = authoringSlot(hp)
	r.InitialSnapshot.Combatants[1].Attributes["armor"] = authoringSlot(armor)
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{}, BasicAttack: &model.BasicAttackPlan{PlanKey: "native-test", Source: "source", Target: "target", SkillKey: "test_attack", StartAbilityRef: authoringRef("native_start"), HitAbilityRef: authoringRef("native_hit"), InitialControlAbilityRef: authoringRef("initial"), AttackSpeedAttributeKey: "attack_speed", AttackSpeedInputMax: as}}
	r.SkillUses = nil
	r.AttackStartFacts = nil
	r.SkillHitFacts = nil
	r.ProcessCommandFacts = nil
	r.StopPolicy.DurationMs = duration
	r.Sampling = model.SamplingConfig{Disabled: true}
	return c, r
}
func TestContinuousAttackIndependentNumbers(t *testing.T) {
	c, r := continuousAttackInput(1, 250, 100, 0, 0, 30000)
	done := authoringRun(t, c, r)
	if !done.Summary.Execution.Complete || !done.Summary.Execution.TargetKilled || *done.Summary.Execution.TargetKilledAtMs != 2000 || done.Summary.BasicAttack.CompletedCount != 3 {
		t.Fatal(done.Summary)
	}
	if done.Summary.SourceDamageDealt != 300 || done.Summary.TargetHpLoss != 250 || done.Summary.DamageBreakdown[0].OverkillDamage != 50 {
		t.Fatal(done.Summary)
	}
	if len(done.Series) != 0 || done.SeriesSamplingEvidence.Method != "disabled" {
		t.Fatal(done.SeriesSamplingEvidence)
	}
	for i, row := range done.AttackRecords {
		if row.StartAtMs != int64(i)*1000 || row.HitAtMs == nil || *row.HitAtMs != row.StartAtMs || !row.Completed || row.UseRef == "" {
			t.Fatal(row)
		}
	}
	if len(done.FinalSnapshot.ProcessInstances) != 3 || len(done.DamageRecords) != 3 {
		t.Fatal(done.Recording)
	}
}
func TestContinuousAttackClosedWindow(t *testing.T) {
	for _, tc := range []struct {
		as       float64
		duration int64
		attacks  int
	}{{.8, 2499, 2}, {.8, 2500, 3}, {1, 1999, 2}, {1, 2000, 3}} {
		c, r := continuousAttackInput(tc.as, 10000, 100, 0, 0, tc.duration)
		done := authoringRun(t, c, r)
		if done.Summary.BasicAttack.CompletedCount != tc.attacks || done.FinalSnapshot.TimeMs != tc.duration || !done.Summary.Execution.Complete {
			t.Fatal(tc, done.Summary)
		}
	}
}
func TestContinuousAttackKnownWaitCompletesAtEventCap(t *testing.T) {
	c, r := continuousAttackInput(1, 1000, 100, 0, 0, 999)
	r.SafetyBudget = &model.RunSafetyBudget{MaxEvents: 1}
	done := authoringRun(t, c, r)
	if done.FinalSnapshot.TimeMs != 999 || !done.Summary.Execution.Complete || done.Summary.BasicAttack.CompletedCount != 1 || done.Summary.Execution.TargetKilled {
		t.Fatal(done.Summary)
	}
}
func TestContinuousAttackBudgetAndRecordingIsolation(t *testing.T) {
	c, r := continuousAttackInput(1, 1000, 100, 0, 0, 30000)
	r.SafetyBudget = &model.RunSafetyBudget{MaxBasicAttacks: 2}
	zero := 0
	r.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero}
	done := authoringRun(t, c, r)
	if done.Summary.Execution.Complete || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxBasicAttacks || done.Summary.BasicAttack.CompletedCount != 2 || done.Summary.TargetHpLoss != 200 || len(done.DamageRecords) != 0 || done.Recording.DroppedDamageRecords != 2 {
		t.Fatal(done.Summary, done.Recording)
	}
}
func TestContinuousAttackCritAndCooldown(t *testing.T) {
	c, r := continuousAttackInput(1, 300, 100, 100, .25, 30000)
	done := authoringRun(t, c, r)
	if done.Summary.BasicAttack.CompletedCount != 5 || *done.Summary.Execution.TargetKilledAtMs != 4000 || done.Summary.SourceDamageDealt != 312.5 || done.Summary.TargetHpLoss != 300 || done.Summary.DamageBreakdown[0].OverkillDamage != 12.5 {
		t.Fatal(done.Summary)
	}
	c, r = continuousAttackInput(.651, 10000, 0, 0, 0, 1600)
	done = authoringRun(t, c, r)
	if *done.AttackRecords[0].ReadyAtMs != 1536 || done.AttackRecords[1].StartAtMs != 1536 || !done.Summary.Execution.Complete || math.IsNaN(done.Summary.SourceDamageDealt) {
		t.Fatal(done.Summary, done.AttackRecords)
	}
}
func TestContinuousAttackSamplingIsReadOnly(t *testing.T) {
	c, r := continuousAttackInput(1, 250, 100, 0, 0, 30000)
	plain := authoringRun(t, c, r)
	r.Sampling = model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 1000, MaxSeriesPoints: 10}
	sampled := authoringRun(t, c, r)
	if sampled.Summary.SourceDamageDealt != plain.Summary.SourceDamageDealt || sampled.Summary.BasicAttack.CompletedCount != plain.Summary.BasicAttack.CompletedCount || *sampled.Summary.Execution.TargetKilledAtMs != *plain.Summary.Execution.TargetKilledAtMs || len(sampled.Series) > 10 {
		t.Fatal(sampled.Summary)
	}
	if sampled.Series[0].TimeMs != 0 || sampled.Series[0].TargetHp != 150 || sampled.Series[len(sampled.Series)-1].TimeMs != 2000 || sampled.Series[len(sampled.Series)-1].TargetHp != 0 {
		t.Fatal(sampled.Series)
	}
}
