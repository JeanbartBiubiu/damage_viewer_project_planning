package execution

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime/execution/actionflow"
)

func (s *Engine) stunUntil(owner string) (int64, *model.EngineError) {
	if !s.compiled.HasActionStun {
		return 0, nil
	}
	actor, exists := s.combatants[owner]
	if !exists {
		return 0, s.processErr("providers", "stun query has no actual owner", owner)
	}
	until, err := actionflow.StunDeadline(owner, s.loop.TimeMs(), s.compiled.Providers, actor.instances.Providers(), nil)
	return until, s.controlQueryError(err)
}

func (s *Engine) controlQueryError(err *model.EngineError) *model.EngineError {
	if err != nil {
		err.SchemaHash, err.RulesHash, err.SessionID = s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID
	}
	return err
}

func (f *Frame) stunUntil(owner string) (int64, *model.EngineError) {
	if !f.run.compiled.HasActionStun {
		return 0, nil
	}
	staged := f.stageFor(owner)
	var inline [8]actionflow.ControlMutation
	mutations := inline[:0]
	for _, mutation := range staged.providerOps {
		mutations = append(mutations, actionflow.ControlMutation{Kind: mutation.Kind, Definition: mutation.DefinitionRef,
			Reference: mutation.ProviderRef, Source: mutation.SourceKey, Owner: owner, Projected: mutation.Projected,
			HasExpiry: mutation.HasExpireAt, Expires: mutation.ExpireAt})
	}
	until, err := actionflow.StunDeadline(owner, f.run.loop.TimeMs(), f.run.compiled.Providers, staged.instances.Providers(), mutations)
	return until, f.run.controlQueryError(err)
}

func (f *Frame) prepareStunAttackPermission() *model.EngineError {
	if !f.run.compiled.HasActionStun || f.run.actions.BasicAttack() == nil {
		return nil
	}
	owner := f.run.actions.BasicAttack().Plan().Source
	before, err := f.run.stunUntil(owner)
	if err != nil {
		return err
	}
	after, err := f.stunUntil(owner)
	if err != nil {
		return err
	}
	if before != after || after > f.run.loop.TimeMs() {
		f.pendingActionWait = true
	}
	return nil
}

func (s *Engine) failStunnedProcesses() *model.EngineError {
	if !s.compiled.HasActionStun || s.settlingProcessDeaths {
		return nil
	}
	return s.processFlowExecutor().FailStunnedProcesses(s.loop.TimeMs(), processControlBridge{engine: s}, processFlowBridge{engine: s})
}

func (bridge processControlBridge) ControlStunUntil(owner string) (int64, *model.EngineError) {
	return bridge.engine.stunUntil(owner)
}

func (bridge processControlBridge) ProcessStunUntil(owner string) (int64, *model.EngineError) {
	return bridge.engine.stunUntil(owner)
}

func (bridge processControlBridge) ProcessStunSettling() bool {
	return bridge.engine.settlingProcessStun
}
func (bridge processControlBridge) BeginProcessStun() { bridge.engine.settlingProcessStun = true }
func (bridge processControlBridge) EndProcessStun()   { bridge.engine.settlingProcessStun = false }

func (bridge automaticChoiceBridge) CandidateStunUntil(owner string) (int64, *model.EngineError) {
	return bridge.engine.stunUntil(owner)
}

func (bridge attackWaitBridge) AttackStunUntil(owner string) (int64, *model.EngineError) {
	return bridge.frame.stunUntil(owner)
}
