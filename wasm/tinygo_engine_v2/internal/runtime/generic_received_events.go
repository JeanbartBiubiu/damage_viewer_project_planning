package runtime

import (
	"tinygo_engine_v2/internal/command"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
)

func (s *genericRunState) dispatchBasicAttackReceived(original emittedEvent, depth int) *model.EngineError {
	if _, declared := s.compiled.Types.Registry.Lookup(model.EventTypeBasicAttackReceived); !declared {
		return nil
	}
	received := original
	received.eventType = model.EventTypeBasicAttackReceived
	received.ref = received.eventType
	received.types = []string{received.eventType}
	received.skillHit = nil
	received.snapshot = *cloneEventSnapshot(&original.snapshot)
	received.snapshot.eventType = received.eventType
	s.refreshEmittedEventLiveSnapshot(&received)
	attachUseToSnapshot(&received)
	s.recordEvidence(model.EvidenceItem{TimeMs: s.nowMs, Kind: model.EvidenceKindEmittedEvent, Ref: received.eventType,
		Data: map[string]interface{}{"source": received.sourceKey, "target": received.targetKey, "useRef": received.useKey, "skillKey": received.useSkillKey}})
	return s.dispatchListeners(received, depth)
}

func (f *executionFrame) queueDamageTaken(cmd command.Command, operation compilebundle.CompiledOperation,
	ability compilebundle.CompiledAbility, critical frozenCritEvidence, base, raw float64, outcome pipeline.DamageOutcome) {
	if _, declared := f.run.compiled.Types.Registry.Lookup(model.EventTypeDamageTaken); !declared {
		return
	}
	event := emittedEvent{eventType: model.EventTypeDamageTaken, ref: operation.Ref, sourceKey: cmd.Source, targetKey: cmd.Target,
		castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
		snapshot: f.captureEmitSnapshot(model.EventTypeDamageTaken, cmd.Source, cmd.Target)}
	event.types = append([]string{event.eventType, cmd.DamageType}, operation.Types...)
	event.types = append(event.types, f.abilityTypeKeys(ability)...)
	event.types = f.appendCastOriginEventType(event.types)
	event.snapshot.hasDamageSnapshot = true
	event.snapshot.damageSnapshot = buildDamageInstanceSnapshot(critical, base, raw, outcome.MitigatedAmount)
	event.snapshot.damageTypeKey = cmd.DamageType
	event.snapshot.damageTraits = append([]string(nil), operation.Types...)
	event.useKey, event.useSource, event.useSkillKey = f.processUseKey, f.processUseSource, f.processUseSkillKey
	if event.useKey == "" && f.eventCtx != nil && f.eventCtx.hasUse {
		event.useKey, event.useSource, event.useSkillKey = f.eventCtx.useKey, f.eventCtx.useSource, f.eventCtx.useSkillKey
	}
	event.hasUse = event.useKey != ""
	attachUseToSnapshot(&event)
	f.pendingEvents = append(f.pendingEvents, event)
	f.recordEvidence(model.EvidenceItem{TimeMs: f.run.nowMs, Kind: model.EvidenceKindEmittedEvent, Ref: event.eventType,
		Data: map[string]interface{}{"source": cmd.Source, "target": cmd.Target, "useRef": event.useKey,
			"skillKey": event.useSkillKey, "operationRef": operation.Ref, "postDefenseDamage": outcome.MitigatedAmount,
			"shieldAbsorbed": outcome.ShieldAbsorbed, "actualHpLoss": outcome.HPDamage}})
}
