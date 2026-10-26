// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	bytes "bytes"
	json "encoding/json"
	reflect "reflect"
	testing "testing"
	abi "tinygo_engine_v2/internal/base/abi"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func assertSummaryEquivalent(t *testing.T, detailed, summary model.DoneResult) {
	t.Helper()
	if detailed.OutputMode != "" || summary.OutputMode != model.RunOutputSummary {
		t.Fatalf("output modes: detailed=%q summary=%q", detailed.OutputMode, summary.OutputMode)
	}
	if !reflect.DeepEqual(detailed.Summary, summary.Summary) {
		t.Fatalf("numeric summary changed: detailed=%+v summary=%+v", detailed.Summary, summary.Summary)
	}
	if !reflect.DeepEqual(detailed.FinalSnapshot, summary.FinalSnapshot) {
		t.Fatal("final snapshot changed with output mode")
	}
	if !reflect.DeepEqual(detailed.Warnings, summary.Warnings) || !reflect.DeepEqual(detailed.Series, summary.Series) || !reflect.DeepEqual(detailed.SeriesSamplingEvidence, summary.SeriesSamplingEvidence) {
		t.Fatal("warnings or independently requested sampling changed with output mode")
	}
	if len(summary.AttackRecords)+len(summary.DamageRecords)+len(summary.MechanicRecords)+len(summary.SkillActionRecords)+len(summary.SkillUseRecords)+len(summary.HealingRecords)+len(summary.Evidence.Items) != 0 {
		t.Fatal("summary mode retained detail records")
	}
	if summary.AttackRecords == nil || summary.DamageRecords == nil || summary.MechanicRecords == nil || summary.SkillActionRecords == nil || summary.SkillUseRecords == nil || summary.HealingRecords == nil || summary.Evidence.Items == nil {
		t.Fatal("summary detail arrays must remain explicit empty arrays")
	}
	wantRecording := detailed.Recording
	wantRecording.ReturnedAttackRecords, wantRecording.ReturnedDamageRecords, wantRecording.ReturnedMechanicRecords = 0, 0, 0
	wantRecording.ReturnedSkillActionRecords, wantRecording.ReturnedSkillUseRecords, wantRecording.ReturnedHealingRecords = 0, 0, 0
	if !reflect.DeepEqual(wantRecording, summary.Recording) {
		t.Fatalf("virtual record budget changed: want=%+v summary=%+v", wantRecording, summary.Recording)
	}
	wantEvidence := detailed.Evidence
	wantEvidence.Items = []model.EvidenceItem{}
	if !reflect.DeepEqual(wantEvidence, summary.Evidence) {
		t.Fatalf("virtual evidence budget changed: want=%+v summary=%+v", wantEvidence, summary.Evidence)
	}
}

func runOutputModes(t *testing.T, input model.CompileRequest, request model.RunRequest) (model.DoneResult, model.DoneResult) {
	t.Helper()
	compiled := compilebundle.CompileGeneric(input)
	if !compiled.OK {
		t.Fatalf("compile errors: %+v", compiled.Result.Errors)
	}
	request.OutputMode = ""
	detailed, err := runtimeengine.RunGeneric(compiled.Session, request)
	if err != nil {
		t.Fatalf("detailed run: %+v", err)
	}
	request.OutputMode = model.RunOutputSummary
	summary, err := runtimeengine.RunGeneric(compiled.Session, request)
	if err != nil {
		t.Fatalf("summary run: %+v", err)
	}
	assertSummaryEquivalent(t, detailed, summary)
	request.OutputMode = model.RunOutputDetailed
	repeat, err := runtimeengine.RunGeneric(compiled.Session, request)
	if err != nil || !bytes.Equal(mustJSON(detailed), mustJSON(repeat)) {
		t.Fatalf("explicit detailed changed full response: %+v", err)
	}
	return detailed, summary
}

func TestSummaryOutputMechanismEquivalence(t *testing.T) {
	for _, name := range []string{
		"formula_phase4_explicit_basic_damage.json",
		"generic_vamp_damage.json",
		"generic_heal_ratio_max.json",
		"generic_status_merge_slow.json",
		"generic_skill_hit.json",
		"generic_p6.json",
	} {
		t.Run(name, func(t *testing.T) {
			request := loadGenericFixtureRunRequest(t, name)
			request.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
			runOutputModes(t, loadGenericFixtureCompileRequest(t, name), request)
		})
	}
}

func TestSummaryOutputNumericalKillAndSampling(t *testing.T) {
	for _, sampling := range []model.SamplingConfig{{Disabled: true}, {SampleEveryMs: 100, DpsWindowMs: 300, MaxSeriesPoints: 10}} {
		input, request := continuousAttackInput(1, 250, 100, 0, 0, 30000)
		request.Sampling = sampling
		_, summary := runOutputModes(t, input, request)
		if summary.Summary.BasicAttack.CompletedCount != 3 || *summary.Summary.Execution.TargetKilledAtMs != 2000 || summary.Summary.TargetHpLoss != 250 || summary.Summary.DamageBreakdown[0].OverkillDamage != 50 {
			t.Fatalf("numeric kill changed: %+v", summary.Summary)
		}
		if !sampling.Disabled && len(summary.Series) == 0 {
			t.Fatal("summary mode implicitly disabled sampling")
		}
	}
}

func TestSummaryOutputVirtualEvidenceTruncation(t *testing.T) {
	input, request := continuousAttackInput(2, 1000000, 100, 0, 0, 120000)
	detailed, summary := runOutputModes(t, input, request)
	if !summary.Evidence.Truncated || summary.Evidence.TruncatedEvidenceCount == 0 || len(detailed.Evidence.Items) != model.DefaultSafetyBudget().MaxEvidenceItems {
		t.Fatalf("real evidence truncation was not exercised: %+v", summary.Evidence)
	}
	if len(summary.Warnings) == 0 || summary.Warnings[0].Code != string(model.WarningCodeEvidenceTruncated) || len(summary.Warnings[0].EvidenceRefs) == 0 {
		t.Fatalf("missing virtual evidence truncation warning: %+v", summary.Warnings)
	}
}

func TestSummaryOutputAllRecordBudgetZero(t *testing.T) {
	for _, kind := range []string{"attack", "hit", "heal"} {
		t.Run(kind, func(t *testing.T) {
			var input model.CompileRequest
			var request model.RunRequest
			if kind == "attack" {
				input, request = continuousAttackInput(1, 250, 100, 0, 0, 30000)
			} else {
				input, request = singleSkillInput(kind == "heal")
			}
			zero := 0
			request.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero, MaxMechanicRecords: &zero, MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxHealingRecords: &zero}
			_, summary := runOutputModes(t, input, request)
			if summary.Recording.DroppedDamageRecords != summary.Recording.DamageRecordCount || summary.Recording.DroppedSkillUseRecords != summary.Recording.SkillUseRecordCount || summary.Recording.DroppedHealingRecords != summary.Recording.HealingRecordCount {
				t.Fatal(summary.Recording)
			}
			if kind == "hit" && summary.Summary.SkillUses.HitCount != 1 {
				t.Fatalf("detail omission lost committed hit count: %+v", summary.Summary.SkillUses)
			}
			if kind == "heal" && *summary.Summary.SourceDirectHealing != 100 {
				t.Fatalf("detail omission lost committed healing: %+v", summary.Summary)
			}
		})
	}
}

func TestSummaryOutputHitSurvivesFailedCandidateFrame(t *testing.T) {
	input, request := singleSkillInput(false)
	request.Sampling.Disabled = true
	request.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
	_, summary := runOutputModes(t, input, request)
	if summary.Summary.SkillUses.HitCount != 1 || summary.Summary.SourceDamageDealt != 0 || summary.Summary.TargetFinalHp != 500 || summary.Summary.Execution.BudgetCause == nil || *summary.Summary.Execution.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("committed parent hit or failed child damage changed: %+v", summary.Summary)
	}
}

func TestSummaryOutputSessionAlternatesAndRejectsInvalidMode(t *testing.T) {
	session, compiled := compileBasicDamageSession(t)
	request := loadBasicDamageRunRequest(t)
	request.SessionID, request.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
	request.Sampling.Disabled = true
	run := func(mode model.RunOutputMode) (model.DoneResult, []byte) {
		t.Helper()
		request.OutputMode = mode
		session.ClearOutbox()
		if code := session.RunJSON(mustJSON(request)); code != 0 {
			t.Fatalf("mode=%q code=%d error=%+v", mode, code, lastGenericError(session.OutboxBytes()))
		}
		frame, err := abi.DecodeFrame(session.OutboxBytes())
		if err != nil || frame.Kind != model.FrameKindGenericDone {
			t.Fatalf("done frame error=%v kind=%v", err, frame.Kind)
		}
		return lastGenericRunDone(session.OutboxBytes()), append([]byte(nil), frame.Payload...)
	}
	detailed, baseline := run("")
	for iteration := 0; iteration < 10; iteration++ {
		summary, _ := run(model.RunOutputSummary)
		assertSummaryEquivalent(t, detailed, summary)
		_, full := run(model.RunOutputDetailed)
		if !bytes.Equal(baseline, full) {
			t.Fatalf("full output drift after summary iteration %d", iteration)
		}
	}
	for _, invalid := range []string{`null`, `"unknown"`, `""`, `123`} {
		var payload map[string]json.RawMessage
		if err := json.Unmarshal(mustJSON(request), &payload); err != nil {
			t.Fatal(err)
		}
		payload["outputMode"] = json.RawMessage(invalid)
		session.ClearOutbox()
		if code := session.RunJSON(mustJSON(payload)); code != -1 || lastGenericError(session.OutboxBytes()).Code != model.GenericErrJSONParseError {
			t.Fatalf("invalid mode %s accepted: code=%d", invalid, code)
		}
		_, recovered := run("")
		if !bytes.Equal(baseline, recovered) {
			t.Fatalf("invalid mode %s contaminated session", invalid)
		}
	}
}
