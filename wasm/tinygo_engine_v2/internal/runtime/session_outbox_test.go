package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/base/abi"
	"tinygo_engine_v2/internal/model"
)

func sessionOutboxFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testkit", "fixtures", "formula_phase4_explicit_basic_damage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
		RunRequest     model.RunRequest     `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.RunRequest.DriverPlan.Entries) == 0 {
		t.Fatal("fixture has no actual driver")
	}
	return fixture.CompileRequest, fixture.RunRequest
}

func outboxTestJSON(t *testing.T, value any) []byte {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return bytes
}

func assertOutboxWriteFailure(t *testing.T, session *Session, kind model.FrameKind, writeCode model.ErrCode) {
	t.Helper()
	frame, err := abi.DecodeFrame(session.OutboxBytes())
	if err != nil {
		t.Fatalf("missing bounded error frame: %v (bytes=%d)", err, len(session.OutboxBytes()))
	}
	if frame.Kind != model.FrameKindGenericError || abi.HeaderLen+len(frame.Payload) != len(session.OutboxBytes()) {
		t.Fatal("write failure returned stale or partial output", frame.Kind)
	}
	var failure model.EngineError
	if err := json.Unmarshal(frame.Payload, &failure); err != nil {
		t.Fatal(err)
	}
	if failure.Code != model.GenericErrRuntimeInvariantFailed || failure.Phase != model.GenericPhaseABI || failure.Path != "outbox" ||
		failure.SchemaHash != "" || failure.RulesHash != "" || failure.SessionID != "" || len(frame.Payload) > 512 {
		t.Fatalf("write failure is not bounded and identifiable: %+v", failure)
	}
	if len(failure.Details) != 2 || failure.Details["frameKind"] != float64(kind) || failure.Details["writeCode"] != string(writeCode) {
		t.Fatal("write failure lost frame or cause", failure.Details)
	}
}

func TestSessionOversizedCompileRejectionKeepsBoundedError(t *testing.T) {
	session := NewMathSession()
	request := model.CompileRequest{SchemaVersion: model.GenericSchemaVersion, SchemaHash: strings.Repeat("s", abi.DefaultOutboxCapacity+1), RulesHash: "r"}
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if code := session.CompileJSON(payload); code != -1 {
		t.Fatalf("compile code=%d", code)
	}
	assertOutboxWriteFailure(t, session, model.FrameKindGenericCompileResult, model.ErrQueueOverflow)
	if len(session.genericSessions) != 0 || session.nextGenericSessionID != 0 {
		t.Fatal("rejection registered a session")
	}
	session.ClearOutbox()
	request.SchemaHash = "short"
	payload, err = json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if session.CompileJSON(payload) != -1 {
		t.Fatal("invalid request unexpectedly compiled")
	}
	frame, err := abi.DecodeFrame(session.OutboxBytes())
	if err != nil || frame.Kind != model.FrameKindGenericCompileResult {
		t.Fatal("normal compile rejection changed", frame.Kind, err)
	}
	var result model.CompileResult
	if err := json.Unmarshal(frame.Payload, &result); err != nil {
		t.Fatal(err)
	}
	if result.OK || len(result.Errors) == 0 || result.SchemaHash != "short" {
		t.Fatal("normal rejection lost problems or identity")
	}
}

func TestSessionFailedOutputDoesNotExposePreviousResponse(t *testing.T) {
	session := NewMathSession()
	if session.outbox.WriteJSON(model.FrameKindGenericReleaseResult, model.GenericReleaseDonePayload{OK: true, SessionID: "previous", Released: true}) != model.ErrOK {
		t.Fatal("seed output failed")
	}
	result := model.CompileResult{Errors: []model.EngineError{{Details: map[string]interface{}{"invalid": make(chan int)}}}}
	session.writeGenericCompileResult(result)
	assertOutboxWriteFailure(t, session, model.FrameKindGenericCompileResult, model.ErrInvalidInput)
	session.writeGenericError(model.GenericPhaseRun, model.GenericErrUnknownRef, strings.Repeat("x", abi.DefaultOutboxCapacity+1), "s", "r", "session")
	assertOutboxWriteFailure(t, session, model.FrameKindGenericError, model.ErrQueueOverflow)
}

func TestSessionOversizedRunOutputKeepsReusableSession(t *testing.T) {
	session := NewMathSession()
	compile, run := sessionOutboxFixture(t)
	if session.CompileJSON(outboxTestJSON(t, compile)) != 0 {
		t.Fatal("fixture compile failed")
	}
	frame, err := abi.DecodeFrame(session.OutboxBytes())
	if err != nil {
		t.Fatal(err)
	}
	var compiled model.CompileResult
	if err := json.Unmarshal(frame.Payload, &compiled); err != nil {
		t.Fatal(err)
	}
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatal("fixture has no compiled identity")
	}
	run.SessionID, run.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
	original := run.DriverPlan.Entries[0].AbilityRef
	run.DriverPlan.Entries[0].AbilityRef = strings.Repeat("unknown", abi.DefaultOutboxCapacity/7+1)
	session.ClearOutbox()
	if session.RunJSON(outboxTestJSON(t, run)) != -1 {
		t.Fatal("unknown ability accepted")
	}
	assertOutboxWriteFailure(t, session, model.FrameKindGenericDone, model.ErrQueueOverflow)
	if len(session.genericSessions) != 1 {
		t.Fatal("runtime output failure released the compiled session")
	}
	run.DriverPlan.Entries[0].AbilityRef = original
	run.SessionID = strings.Repeat("missing", abi.DefaultOutboxCapacity/7+1)
	session.ClearOutbox()
	if session.RunJSON(outboxTestJSON(t, run)) != -1 {
		t.Fatal("unknown session accepted")
	}
	assertOutboxWriteFailure(t, session, model.FrameKindGenericError, model.ErrQueueOverflow)
	run.SessionID = compiled.SessionID
	session.ClearOutbox()
	if session.RunJSON(outboxTestJSON(t, run)) != 0 {
		t.Fatal("valid retry failed")
	}
	frame, err = abi.DecodeFrame(session.OutboxBytes())
	if err != nil || frame.Kind != model.FrameKindGenericDone {
		t.Fatal("valid retry has no done", err)
	}
}

func TestSessionOutputFailureKeepsRegistrationBoundaries(t *testing.T) {
	compile, _ := sessionOutboxFixture(t)
	session := NewMathSession()
	// 容量连固定短错误也无法容纳时，仍不能保留旧帧或伪造登记成功。
	session.outbox = abi.NewOutbox(abi.HeaderLen + 1)
	if session.CompileJSON(outboxTestJSON(t, compile)) != -1 || len(session.genericSessions) != 0 || len(session.OutboxBytes()) != 0 {
		t.Fatal("compile output failure leaked a session or stale output")
	}
	session.outbox = abi.NewOutbox(abi.DefaultOutboxCapacity)
	if session.CompileJSON(outboxTestJSON(t, compile)) != 0 || len(session.genericSessions) != 1 {
		t.Fatal("fixture retry failed")
	}
	var identity model.CompileResult
	frame, err := abi.DecodeFrame(session.OutboxBytes())
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(frame.Payload, &identity); err != nil {
		t.Fatal(err)
	}
	if identity.SessionID == "" {
		t.Fatal("missing identity")
	}
	session.outbox = abi.NewOutbox(abi.HeaderLen + 1)
	request := model.ReleaseSessionRequest{SessionID: identity.SessionID, ExpectedRulesHash: identity.RulesHash}
	if session.ReleaseSessionJSON(outboxTestJSON(t, request)) != -1 || len(session.genericSessions) != 0 || len(session.OutboxBytes()) != 0 {
		t.Fatal("release output failure restored a deleted session or old output")
	}
	session.outbox = abi.NewOutbox(abi.DefaultOutboxCapacity)
	if session.ReleaseSessionJSON(outboxTestJSON(t, request)) != -1 {
		t.Fatal("deleted session released twice")
	}
	frame, err = abi.DecodeFrame(session.OutboxBytes())
	if err != nil {
		t.Fatal(err)
	}
	var issue model.EngineError
	if err := json.Unmarshal(frame.Payload, &issue); err != nil {
		t.Fatal(err)
	}
	if issue.Code != model.GenericErrSessionNotFound {
		t.Fatal("duplicate release changed", issue.Code)
	}
}
