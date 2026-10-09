package runtime

import (
	"sort"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func (s *genericRunState) seedSourceInitialization() *model.EngineError {
	if _, declared := s.compiled.Types.Registry.LookupDomain("event", model.EventTypeSourceInitialized); !declared {
		return nil
	}
	if s.startMs != 0 {
		return s.basicAttackErr("source initialization requires a fresh time-zero snapshot", "initialSnapshot.timeMs")
	}
	if len(s.req.InitialSnapshot.ProcessInstances)+len(s.req.InitialSnapshot.UseTriggerLedger) != 0 {
		return s.basicAttackErr("source initialization requires unused process and trigger state", "initialSnapshot")
	}
	if err := s.validateBasicAttackInitialSnapshot(); err != nil {
		return err
	}
	for _, actor := range s.req.InitialSnapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 {
			return s.basicAttackErr("source initialization cannot restore previous runtime state", "initialSnapshot.combatants")
		}
	}
	keys := make([]string, 0, len(s.combatants))
	for key := range s.combatants {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	s.initializationPending = len(keys)
	for _, key := range keys {
		if !s.pushCombatEvent(scheduler.GenericEvent{
			TimeMs: 0, Category: scheduler.GenericCategorySourceInitialization,
			Kind: scheduler.GenericEventSourceInitialized, DriverEntryIndex: -1,
			ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: key},
		}) {
			break
		}
	}
	return nil
}

func (s *genericRunState) handleSourceInitialized(event scheduler.GenericEvent) *model.EngineError {
	key := event.ProviderInstanceRef.CombatantKey
	if s.initializationPending <= 0 || !s.combatantExists(key) || s.nowMs != 0 {
		return s.basicAttackErr("invalid native source initialization event", "initialSnapshot")
	}
	s.initializationEventActive = true
	s.currentEventCommands = 0
	defer func() { s.initializationEventActive = false }()
	frame := s.newExecutionFrame(key, key, "")
	initialization := emittedEvent{
		eventType: model.EventTypeSourceInitialized, sourceKey: key, targetKey: key,
		types:    []string{model.EventTypeSourceInitialized},
		snapshot: frame.captureEmitSnapshot(model.EventTypeSourceInitialized, key, key),
	}
	if err := s.dispatchListeners(initialization, 0); err != nil {
		return err
	}
	if s.processFailure != nil {
		return s.processFailure
	}
	s.initializationPending--
	s.recordEvidence(model.EvidenceItem{TimeMs: 0, Kind: "source_initialized", Ref: key,
		Data: map[string]interface{}{"eventSource": key, "currentTarget": key, "completed": true}})
	return nil
}
