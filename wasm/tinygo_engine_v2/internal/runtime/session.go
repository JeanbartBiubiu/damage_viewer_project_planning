// 本文件实现 generic EngineSession：compile / run / release_session 与 session registry。
package runtime

import (
	"encoding/json"

	"tinygo_engine_v2/internal/abi"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

type Session struct {
	outbox abi.Outbox

	genericSessions      map[string]genericSessionEntry
	nextGenericSessionID uint32
}

type genericSessionEntry struct {
	sessionID     string
	schemaVersion string
	schemaHash    string
	rulesHash     string
	compiled      compilebundle.CompiledSession
}

func NewSession() *Session {
	return &Session{
		outbox:          abi.NewOutbox(abi.DefaultOutboxCapacity),
		genericSessions: make(map[string]genericSessionEntry),
	}
}

func (s *Session) OutboxBytes() []byte {
	return s.outbox.Bytes()
}

func (s *Session) ClearOutbox() {
	s.outbox.Clear()
}

func (s *Session) CompileFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if frame.Kind != model.FrameKindGenericCompile {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrMissingRequiredField, "expected generic compile frame", "", "", "")
		return -1
	}
	return s.CompileJSON(frame.Payload)
}

func (s *Session) CompileJSON(payload []byte) int32 {
	var req model.CompileRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		s.writeGenericError(model.GenericPhaseParse, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	compiled := compilebundle.CompileGeneric(req)
	if !compiled.OK {
		s.writeGenericCompileResult(compiled.Result)
		return -1
	}
	sessionID := s.registerGenericSession(compiled.Session)
	result := compiled.Result
	result.SessionID = sessionID
	if code := s.outbox.WriteJSON(model.FrameKindGenericCompileResult, result); code != model.ErrOK {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrRuntimeInvariantFailed, "compile result frame write failed", result.SchemaHash, result.RulesHash, sessionID)
		return -1
	}
	return 0
}

func (s *Session) RunFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if frame.Kind != model.FrameKindGenericRun {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrMissingRequiredField, "expected generic run frame", "", "", "")
		return -1
	}
	return s.RunJSON(frame.Payload)
}

func (s *Session) RunJSON(payload []byte) int32 {
	var req model.RunRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		s.writeGenericError(model.GenericPhaseParse, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if req.SessionID == "" {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "sessionId is required", req.SchemaHash, req.RulesHash, "")
		return -1
	}
	entry, ok := s.genericSessions[req.SessionID]
	if !ok {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrSessionNotFound, "session not found", "", "", req.SessionID)
		return -1
	}
	if req.ExpectedRulesHash == "" {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrMissingRequiredField, "expectedRulesHash is required", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	if req.ExpectedRulesHash != entry.rulesHash {
		s.writeGenericError(model.GenericPhaseRun, model.GenericErrHashMismatch, "expectedRulesHash mismatch", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	if errPayload := validateGenericRunRequest(entry.compiled, req); errPayload != nil {
		s.writeGenericError(errPayload.Phase, errPayload.Code, errPayload.Message, entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	done, runErr := RunGeneric(entry.compiled, req)
	if runErr != nil {
		// 保留运行层的具体字段路径与引用，避免宿主只收到无法定位的错误消息。
		runErr.SchemaHash, runErr.RulesHash, runErr.SessionID = entry.schemaHash, entry.rulesHash, req.SessionID
		s.outbox.WriteJSON(model.FrameKindGenericError, *runErr)
		return -1
	}
	if code := s.outbox.WriteJSON(model.FrameKindGenericDone, done); code != model.ErrOK {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrRuntimeInvariantFailed, "done frame write failed", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	return 0
}

func (s *Session) ReleaseSessionFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if frame.Kind != model.FrameKindGenericReleaseSession {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrMissingRequiredField, "expected generic release session frame", "", "", "")
		return -1
	}
	return s.ReleaseSessionJSON(frame.Payload)
}

func (s *Session) ReleaseSessionJSON(payload []byte) int32 {
	var req model.ReleaseSessionRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		s.writeGenericError(model.GenericPhaseParse, model.GenericErrJSONParseError, err.Error(), "", "", "")
		return -1
	}
	if req.SessionID == "" {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrMissingRequiredField, "sessionId is required", "", "", "")
		return -1
	}
	entry, ok := s.genericSessions[req.SessionID]
	if !ok {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrSessionNotFound, "session not found", "", "", req.SessionID)
		return -1
	}
	if req.ExpectedRulesHash != "" && req.ExpectedRulesHash != entry.rulesHash {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrHashMismatch, "expectedRulesHash mismatch", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	delete(s.genericSessions, req.SessionID)
	if code := s.outbox.WriteJSON(model.FrameKindGenericReleaseResult, model.GenericReleaseDonePayload{
		OK:        true,
		SessionID: req.SessionID,
		Released:  true,
	}); code != model.ErrOK {
		s.writeGenericError(model.GenericPhaseABI, model.GenericErrRuntimeInvariantFailed, "release result frame write failed", entry.schemaHash, entry.rulesHash, req.SessionID)
		return -1
	}
	return 0
}

func (s *Session) registerGenericSession(session compilebundle.CompiledSession) string {
	s.nextGenericSessionID++
	sessionID := "generic-session-" + itoa(s.nextGenericSessionID)
	s.genericSessions[sessionID] = genericSessionEntry{
		sessionID:     sessionID,
		schemaVersion: session.SchemaVersion,
		schemaHash:    session.SchemaHash,
		rulesHash:     session.RulesHash,
		compiled:      session,
	}
	return sessionID
}

func (s *Session) writeGenericCompileResult(result model.CompileResult) {
	s.outbox.WriteJSON(model.FrameKindGenericCompileResult, result)
}

func (s *Session) writeGenericError(phase model.GenericErrorPhase, code model.GenericErrCode, message, schemaHash, rulesHash, sessionID string) {
	payload := engineError(phase, code, message, schemaHash, rulesHash, sessionID)
	s.outbox.WriteJSON(model.FrameKindGenericError, payload)
}

func engineError(phase model.GenericErrorPhase, code model.GenericErrCode, message, schemaHash, rulesHash, sessionID string) model.EngineError {
	err := model.NewEngineError(phase, code, message)
	err.SchemaHash = schemaHash
	err.RulesHash = rulesHash
	err.SessionID = sessionID
	return err
}

func itoa(value uint32) string {
	if value == 0 {
		return "0"
	}
	buf := [10]byte{}
	pos := len(buf)
	for value > 0 {
		pos--
		buf[pos] = byte('0' + value%10)
		value /= 10
	}
	return string(buf[pos:])
}
