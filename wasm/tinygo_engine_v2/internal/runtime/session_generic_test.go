package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	gort "runtime"
	"slices"
	"testing"

	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/model"
)

func encodeGenericFrame(kind model.FrameKind, payload any) []byte {
	encoded, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return abi.EncodeFrame(kind, 0, encoded)
}

func lastGenericCompileResult(outbox []byte) model.CompileResult {
	var result model.CompileResult
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericCompileResult {
			_ = json.Unmarshal(frame.Payload, &result)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return result
}

func lastGenericError(outbox []byte) model.EngineError {
	var payload model.EngineError
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericError {
			_ = json.Unmarshal(frame.Payload, &payload)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return payload
}

func lastGenericReleaseDone(outbox []byte) model.GenericReleaseDonePayload {
	var payload model.GenericReleaseDonePayload
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericReleaseResult {
			_ = json.Unmarshal(frame.Payload, &payload)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return payload
}

func lastGenericRunDone(outbox []byte) model.DoneResult {
	var payload model.DoneResult
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericDone {
			var probe map[string]json.RawMessage
			if json.Unmarshal(frame.Payload, &probe) == nil {
				if _, hasSummary := probe["summary"]; hasSummary {
					_ = json.Unmarshal(frame.Payload, &payload)
				}
			}
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return payload
}

func loadGenericFixtureRunRequest(t *testing.T, name string) model.RunRequest {
	t.Helper()
	_, file, _, ok := gort.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "testkit", "fixtures", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	var fixture struct {
		RunRequest model.RunRequest `json:"runRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("unmarshal fixture %s: %v", name, err)
	}
	return fixture.RunRequest
}

func loadGenericFixtureCompileRequest(t *testing.T, name string) model.CompileRequest {
	t.Helper()
	_, file, _, ok := gort.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "testkit", "fixtures", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("unmarshal fixture %s: %v", name, err)
	}
	return fixture.CompileRequest
}

func compileGenericSession(t *testing.T, session *Session) model.CompileResult {
	t.Helper()
	session.ClearOutbox()
	req := loadGenericFixtureCompileRequest(t, "generic_p0_basic_damage.json")
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, req)); code != 0 {
		t.Fatalf("compile failed with code %d", code)
	}
	return lastGenericCompileResult(session.OutboxBytes())
}

func TestGenericCompileCanonicalSuccess(t *testing.T) {
	session := NewSession()
	compiled := compileGenericSession(t, session)
	if !compiled.OK {
		t.Fatalf("compile ok = false: %+v", compiled)
	}
	if compiled.SessionID == "" {
		t.Fatal("expected non-empty sessionId")
	}
	if compiled.SchemaVersion != model.GenericSchemaVersion {
		t.Fatalf("schemaVersion = %q, want %q", compiled.SchemaVersion, model.GenericSchemaVersion)
	}
	if compiled.SchemaHash != "schema.generic-p0.example" || compiled.RulesHash != "rules.generic_p0_basic_damage" {
		t.Fatalf("unexpected hashes: %+v", compiled)
	}
	if compiled.Metadata == nil {
		t.Fatal("expected metadata")
	}
	if compiled.Metadata.AbilityCount == 0 || compiled.Metadata.ProviderCount == 0 || compiled.Metadata.TypeCount == 0 {
		t.Fatalf("expected non-zero metadata counts: %+v", compiled.Metadata)
	}
}

func TestGenericCompileMultiErrorCollectAll(t *testing.T) {
	session := NewSession()
	session.ClearOutbox()
	req := loadGenericFixtureCompileRequest(t, "generic_p0_compile_multi_error.json")
	if code := session.CompileJSON(mustJSON(req)); code != -1 {
		t.Fatalf("CompileJSON code = %d, want -1", code)
	}
	result := lastGenericCompileResult(session.OutboxBytes())
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if result.SessionID != "" {
		t.Fatalf("sessionId = %q, want empty on compile failure", result.SessionID)
	}
	if len(result.Errors) < 2 {
		t.Fatalf("expected at least 2 errors, got %d: %+v", len(result.Errors), result.Errors)
	}

	session.ClearOutbox()
	runEncoded, _ := json.Marshal(model.GenericRunRequest{
		SessionID:         "generic-session-1",
		ExpectedRulesHash: req.RulesHash,
	})
	if code := session.RunJSON(runEncoded); code != -1 {
		t.Fatalf("RunJSON after failed compile code = %d, want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrSessionNotFound {
		t.Fatalf("code = %q, want %q", errPayload.Code, model.GenericErrSessionNotFound)
	}
}

func TestGenericCompileFrameMultiErrorCollectAll(t *testing.T) {
	session := NewSession()
	session.ClearOutbox()
	req := loadGenericFixtureCompileRequest(t, "generic_p0_compile_multi_error.json")
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, req)); code != -1 {
		t.Fatalf("CompileFrame code = %d, want -1", code)
	}
	result := lastGenericCompileResult(session.OutboxBytes())
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if len(result.Errors) < 2 {
		t.Fatalf("expected at least 2 errors, got %d", len(result.Errors))
	}
	codes := make([]model.GenericErrCode, 0, len(result.Errors))
	for _, err := range result.Errors {
		codes = append(codes, err.Code)
	}
	for _, want := range []model.GenericErrCode{
		model.GenericErrUnknownTypeKey,
		model.GenericErrFormulaTypeError,
		model.GenericErrHPRawSetForbidden,
	} {
		if !slices.Contains(codes, want) {
			t.Fatalf("missing error code %q in %+v", want, codes)
		}
	}
}

func TestGenericRunMissingSession(t *testing.T) {
	session := NewSession()
	session.ClearOutbox()
	runReq := model.GenericRunRequest{SessionID: "missing-session"}
	encoded, _ := json.Marshal(runReq)
	if code := session.RunJSON(encoded); code != -1 {
		t.Fatalf("RunJSON code = %d, want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrSessionNotFound {
		t.Fatalf("code = %q, want %q", errPayload.Code, model.GenericErrSessionNotFound)
	}
}

func TestGenericRunHashMismatch(t *testing.T) {
	session := NewSession()
	compiled := compileGenericSession(t, session)
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatalf("compile failed: %+v", compiled)
	}

	session.ClearOutbox()
	runReq := model.GenericRunRequest{
		SessionID:         compiled.SessionID,
		ExpectedRulesHash: "rules.wrong-hash",
	}
	encoded, _ := json.Marshal(runReq)
	if code := session.RunJSON(encoded); code != -1 {
		t.Fatalf("RunJSON code = %d, want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrHashMismatch {
		t.Fatalf("code = %q, want %q", errPayload.Code, model.GenericErrHashMismatch)
	}
}

func TestGenericRunMatchingReturnsDone(t *testing.T) {
	session := NewSession()
	compiled := compileGenericSession(t, session)
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatalf("compile failed: %+v", compiled)
	}

	fixture := loadGenericFixtureRunRequest(t, "generic_p0_basic_damage.json")
	runReq := fixture
	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash

	session.ClearOutbox()
	if code := session.RunJSON(mustJSON(runReq)); code != 0 {
		t.Fatalf("RunJSON code = %d, want 0", code)
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if !done.OK {
		t.Fatalf("done.ok=false")
	}
	if done.Summary.TargetFinalHp != 900 {
		t.Fatalf("targetFinalHp=%v want 900", done.Summary.TargetFinalHp)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("abilityAttemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
}

func TestGenericReleaseSessionThenRunMissing(t *testing.T) {
	session := NewSession()
	compiled := compileGenericSession(t, session)
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatalf("compile failed: %+v", compiled)
	}

	session.ClearOutbox()
	releaseReq := model.ReleaseSessionRequest{
		SessionID:         compiled.SessionID,
		ExpectedRulesHash: compiled.RulesHash,
	}
	encoded, _ := json.Marshal(releaseReq)
	if code := session.ReleaseSessionJSON(encoded); code != 0 {
		t.Fatalf("ReleaseSessionJSON code = %d, want 0", code)
	}
	done := lastGenericReleaseDone(session.OutboxBytes())
	if !done.OK || !done.Released || done.SessionID != compiled.SessionID {
		t.Fatalf("release done = %+v, want ok released session", done)
	}
	// release must not reuse FrameKindGenericDone
	offset := 0
	for offset+abi.HeaderLen <= len(session.OutboxBytes()) {
		frame, err := abi.DecodeFrame(session.OutboxBytes()[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindGenericDone {
			t.Fatal("release success must not write FrameKindGenericDone")
		}
		if frame.Kind == model.FrameKindGenericReleaseResult {
			break
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}

	session.ClearOutbox()
	runEncoded, _ := json.Marshal(model.GenericRunRequest{
		SessionID:         compiled.SessionID,
		ExpectedRulesHash: compiled.RulesHash,
	})
	if code := session.RunJSON(runEncoded); code != -1 {
		t.Fatalf("RunJSON after release code = %d, want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrSessionNotFound {
		t.Fatalf("code = %q, want %q", errPayload.Code, model.GenericErrSessionNotFound)
	}
}

func mustJSON(value any) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return encoded
}
