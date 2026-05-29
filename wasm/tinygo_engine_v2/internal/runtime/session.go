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
}

func NewSession() *Session {
	return &Session{phase: PhaseEmpty, outbox: abi.NewOutbox(abi.DefaultOutboxCapacity)}
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
	s.outbox.WriteJSON(model.FrameKindSnapshot, model.SnapshotV2{
		TimeMs: 0,
		Actors: ctx.snapshots(),
	})
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
	s.outbox.WriteJSON(model.FrameKindActionSnapshot, model.ActionSnapshotV2{
		TimeMs: 0,
		Actors: ctx.actionSnapshots(),
	})
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
		s.phase = PhaseDone
		s.outbox.WriteJSON(model.FrameKindDone, runSingleAttackerDPS(s.bundle, input))
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
		s.run.EmitDone("cancelled")
		s.phase = PhaseDone
		return 0
	}
	return 0
}

func (s *Session) writeError(code model.ErrCode, message string, details []string) {
	s.outbox.WriteJSON(model.FrameKindError, model.ErrorPayload{Code: code, Message: message, Details: details})
}
