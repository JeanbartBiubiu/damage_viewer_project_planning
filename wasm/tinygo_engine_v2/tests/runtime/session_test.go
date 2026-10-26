// 会话与运行组合用例从原测试迁出，断言保持。
package runtime_test

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	testkit "tinygo_engine_v2/internal/testkit"
)

func TestGenericRunBasicDamageReturnsDone(t *testing.T) {
	done, _ := compileAndRunBasicDamage(t)
	if !done.OK {
		t.Fatalf("done.ok=false")
	}
	if done.Summary.StopReason != model.StopReasonDurationReached {
		t.Fatalf("stopReason=%q want duration_reached", done.Summary.StopReason)
	}
	if done.Summary.TargetFinalHp != 900 {
		t.Fatalf("targetFinalHp=%v want 900", done.Summary.TargetFinalHp)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("abilityAttemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 0 {
		t.Fatalf("attemptSkippedCount=%d want 0", done.Summary.AttemptSkippedCount)
	}
	if done.Summary.SourceDamageDealt != 100 {
		t.Fatalf("sourceDamageDealt=%v want 100", done.Summary.SourceDamageDealt)
	}
	if done.Summary.TargetDamageTaken != 100 {
		t.Fatalf("targetDamageTaken=%v want 100", done.Summary.TargetDamageTaken)
	}
	if len(done.Series) < 2 {
		t.Fatalf("series points=%d want >=2", len(done.Series))
	}
	lastSeries := done.Series[len(done.Series)-1]
	if lastSeries.TimeMs != 100 {
		t.Fatalf("last series timeMs=%d want 100", lastSeries.TimeMs)
	}
	if lastSeries.TargetHp != 900 {
		t.Fatalf("last series targetHp=%v want 900", lastSeries.TargetHp)
	}
}

func TestGenericRunInitialSnapshotHashMismatch(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.InitialSnapshot.SchemaHash = "schema.wrong"

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON code=%d want -1", code)
	}
	errPayload := testkit.LastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrHashMismatch {
		t.Fatalf("code=%q want hash_mismatch", errPayload.Code)
	}

	runReq.InitialSnapshot.SchemaHash = compiled.SchemaHash
	runReq.InitialSnapshot.RulesHash = "rules.wrong"
	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != -1 {
		t.Fatalf("RunJSON rules hash code=%d want -1", code)
	}
	errPayload = testkit.LastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrHashMismatch {
		t.Fatalf("code=%q want hash_mismatch for rulesHash", errPayload.Code)
	}
}

func TestGenericRunInvalidAbilityRefEvidence(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.DriverPlan.Entries[0].AbilityRef = "source.provider[champion:missing].ability[none]"
	runReq.StopPolicy.DurationMs = 500
	runReq.StopPolicy.StopWhenNoEvents = model.BoolPtr(true)

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != 0 {
		t.Fatalf("RunJSON code=%d", code)
	}
	done := testkit.LastGenericRunDone(session.OutboxBytes())
	if done.Summary.AttemptSkippedCount < 1 {
		t.Fatalf("attemptSkippedCount=%d want >=1", done.Summary.AttemptSkippedCount)
	}
	found := false
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindAttemptSkipped {
			found = true
			if item.Data["skipReason"] != string(model.AttemptSkipUnknownAbilityRef) {
				t.Fatalf("skipReason=%v", item.Data["skipReason"])
			}
		}
	}
	if !found {
		t.Fatal("missing attempt_skipped evidence")
	}
}

func TestGenericRunInvalidSelectorNoBusyLoop(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.DriverPlan.Entries[0].Target = "hero"
	runReq.DriverPlan.Entries[0].WhileReady = true
	runReq.DriverPlan.ConditionRecheckIntervalMs = 50
	runReq.StopPolicy.DurationMs = 200

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != 0 {
		t.Fatalf("RunJSON code=%d", code)
	}
	done := testkit.LastGenericRunDone(session.OutboxBytes())
	if done.Summary.AbilityAttemptCount > 10 {
		t.Fatalf("too many attempts=%d (busy loop?)", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityAttemptCount < 2 {
		t.Fatalf("attempts=%d want >=2 with recheck", done.Summary.AbilityAttemptCount)
	}
}

func TestGenericRunRepeatMaxAttempts(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	runReq := loadBasicDamageRunRequest(t)
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	runReq.DriverPlan.Entries[0].Repeat = &model.DriverRepeat{IntervalMs: 100, MaxAttempts: 3}
	runReq.StopPolicy.DurationMs = 1000

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != 0 {
		t.Fatalf("RunJSON code=%d", code)
	}
	done := testkit.LastGenericRunDone(session.OutboxBytes())
	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
}
