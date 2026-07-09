// 本文件实现 EngineSession 生命周期，负责 init、begin_run、step、abort 和错误输出状态机。
package runtime

import (
	"encoding/json"

	"tinygo_engine_v2/internal/abi"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

type Phase uint8

const (
	PhaseEmpty Phase = iota
	PhaseReady
	PhaseRunning
	PhaseDone
	PhaseFailed
)

type Session struct {
	phase  Phase
	bundle compilebundle.CompiledBundle
	run    *RunContext
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
		phase:           PhaseEmpty,
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

func (s *Session) InitFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeError(model.ErrBadMagic, err.Error(), nil)
		return -1
	}
	if frame.Kind != model.FrameKindInit {
		s.writeError(model.ErrInvalidInput, "expected init frame", nil)
		return -1
	}
	return s.InitJSON(frame.Payload)
}

func (s *Session) InitJSON(payload []byte) int32 {
	var bundle model.EngineBundle
	if err := json.Unmarshal(payload, &bundle); err != nil {
		s.writeError(model.ErrInvalidInput, err.Error(), nil)
		return -1
	}
	if bundle.SchemaVersion != 0 && bundle.SchemaVersion != model.SchemaVersion {
		s.phase = PhaseFailed
		s.writeError(model.ErrSchemaMismatch, "schemaVersion mismatch", nil)
		return -1
	}
	result := compilebundle.Bundle(bundle)
	if len(result.Problems) > 0 {
		s.phase = PhaseFailed
		s.writeError(model.ErrRuleConflict, "bundle validation failed", result.Problems)
		return -1
	}
	s.bundle = result.Bundle
	s.phase = PhaseReady
	s.run = nil
	s.outbox.WriteJSON(model.FrameKindReady, model.ReadyPayload{
		SchemaVersion: model.SchemaVersion,
		ActorCount:    len(s.bundle.Actors),
		ActionCount:   len(s.bundle.Actions),
		StatusCount:   len(s.bundle.Statuses),
		FormulaCount:  len(s.bundle.Formulas.Programs),
		TriggerCount:  len(s.bundle.Triggers),
	})
	return 0
}

func (s *Session) BeginRunFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeError(model.ErrBadMagic, err.Error(), nil)
		return -1
	}
	if frame.Kind != model.FrameKindRun && frame.Kind != model.FrameKindBinaryRun {
		s.writeError(model.ErrInvalidInput, "expected run frame", nil)
		return -1
	}
	return s.BeginRunJSON(frame.Payload)
}

func (s *Session) SnapshotInitialFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeError(model.ErrBadMagic, err.Error(), nil)
		return -1
	}
	if frame.Kind != model.FrameKindRun && frame.Kind != model.FrameKindBinaryRun {
		s.writeError(model.ErrInvalidInput, "expected run frame", nil)
		return -1
	}
	return s.SnapshotInitialJSON(frame.Payload)
}

func (s *Session) SnapshotActionsInitialFrame(input []byte) int32 {
	frame, err := abi.DecodeFrame(input)
	if err != nil {
		s.writeError(model.ErrBadMagic, err.Error(), nil)
		return -1
	}
	if frame.Kind != model.FrameKindRun && frame.Kind != model.FrameKindBinaryRun {
		s.writeError(model.ErrInvalidInput, "expected run frame", nil)
		return -1
	}
	return s.SnapshotActionsInitialJSON(frame.Payload)
}

func (s *Session) SnapshotInitialJSON(payload []byte) int32 {
	if s.phase != PhaseReady && s.phase != PhaseDone {
		s.writeError(model.ErrNotReady, "session is not ready", nil)
		return -1
	}
	var input model.EngineRunInput
	if err := json.Unmarshal(payload, &input); err != nil {
		s.writeError(model.ErrInvalidInput, err.Error(), nil)
		return -1
	}
	input.InitialActions = nil
	input.Trace = model.TraceOptions{}
	ctx, errPayload := NewRunContext(s.bundle, input, &s.outbox)
	if errPayload != nil {
		s.writeError(errPayload.Code, errPayload.Message, errPayload.Details)
		return -1
	}
	if code := s.outbox.WriteJSON(model.FrameKindSnapshot, model.SnapshotV2{
		TimeMs: 0,
		Actors: ctx.snapshots(),
	}); code != model.ErrOK {
		s.writeError(code, "snapshot frame write failed", nil)
		return -1
	}
	return 0
}

func (s *Session) SnapshotActionsInitialJSON(payload []byte) int32 {
	if s.phase != PhaseReady && s.phase != PhaseDone {
		s.writeError(model.ErrNotReady, "session is not ready", nil)
		return -1
	}
	var input model.EngineRunInput
	if err := json.Unmarshal(payload, &input); err != nil {
		s.writeError(model.ErrInvalidInput, err.Error(), nil)
		return -1
	}
	input.InitialActions = nil
	input.Trace = model.TraceOptions{}
	ctx, errPayload := NewRunContext(s.bundle, input, &s.outbox)
	if errPayload != nil {
		s.writeError(errPayload.Code, errPayload.Message, errPayload.Details)
		return -1
	}
	if code := s.outbox.WriteJSON(model.FrameKindActionSnapshot, model.ActionSnapshotV2{
		TimeMs: 0,
		Actors: ctx.actionSnapshots(),
	}); code != model.ErrOK {
		s.writeError(code, "action snapshot frame write failed", nil)
		return -1
	}
	return 0
}

func (s *Session) BeginRunJSON(payload []byte) int32 {
	if s.phase != PhaseReady && s.phase != PhaseDone {
		s.writeError(model.ErrNotReady, "session is not ready", nil)
		return -1
	}
	if isSingleAttackerDPSPayload(payload) {
		var input model.SingleAttackerDPSInputV2
		if err := json.Unmarshal(payload, &input); err != nil {
			s.writeError(model.ErrInvalidInput, err.Error(), nil)
			return -1
		}
		s.run = nil
		if code := s.outbox.WriteJSON(model.FrameKindDone, runSingleAttackerDPS(s.bundle, input)); code != model.ErrOK {
			s.phase = PhaseFailed
			s.writeError(code, "DPS done frame write failed", nil)
			return -1
		}
		s.phase = PhaseDone
		return 0
	}
	var input model.EngineRunInput
	if err := json.Unmarshal(payload, &input); err != nil {
		s.writeError(model.ErrInvalidInput, err.Error(), nil)
		return -1
	}
	ctx, errPayload := NewRunContext(s.bundle, input, &s.outbox)
	if errPayload != nil {
		s.phase = PhaseFailed
		s.writeError(errPayload.Code, errPayload.Message, errPayload.Details)
		return -1
	}
	s.run = ctx
	s.phase = PhaseRunning
	return 0
}

func isSingleAttackerDPSPayload(payload []byte) bool {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payload, &raw); err != nil {
		return false
	}
	if _, hasSelf := raw["self"]; hasSelf {
		return false
	}
	if _, hasEnemy := raw["enemy"]; hasEnemy {
		return false
	}
	_, hasCurves := raw["curves"]
	_, hasSimulationRules := raw["simulationRules"]
	return hasCurves || hasSimulationRules
}

func (s *Session) Step(maxEvents uint32) int32 {
	if s.phase != PhaseRunning || s.run == nil {
		s.writeError(model.ErrNotReady, "run is not active", nil)
		return -1
	}
	status := s.run.Step(int(maxEvents))
	if status.Code != model.ErrOK {
		s.phase = PhaseFailed
		s.writeError(status.Code, status.Message, status.Details)
		return -1
	}
	if s.run.Done {
		s.phase = PhaseDone
	}
	if s.run.More() {
		return 1
	}
	return 0
}

func (s *Session) AbortRun() int32 {
	if s.run != nil && s.phase == PhaseRunning {
		s.run.Abort()
		if code := s.run.EmitDone("cancelled"); code != model.ErrOK {
			s.phase = PhaseFailed
			s.writeError(code, "done frame write failed", nil)
			return -1
		}
		s.phase = PhaseDone
		return 0
	}
	return 0
}

func (s *Session) writeError(code model.ErrCode, message string, details []string) {
	s.outbox.WriteJSON(model.FrameKindError, model.ErrorPayload{Code: code, Message: message, Details: details})
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
		s.writeGenericError(runErr.Phase, runErr.Code, runErr.Message, entry.schemaHash, entry.rulesHash, req.SessionID)
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
