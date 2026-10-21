package runtime

import (
	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *genericRunState) dispatchBasicAttackReceived(original emittedEvent, depth int) *model.EngineError {
	if _, declared := s.compiled.RuntimeTypes.BasicAttackReceived.Lookup(); !declared {
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
	s.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: s.nowMs, Kind: model.EvidenceKindEmittedEvent, Ref: received.eventType,
			Data: map[string]interface{}{"source": received.sourceKey, "target": received.targetKey, "useRef": received.useKey, "skillKey": received.useSkillKey}}
	})
	return s.dispatchListeners(received, depth)
}

func (f *executionFrame) queueDamageTaken(cmd command.Command, operation planbundle.CompiledOperation,
	ability planbundle.CompiledAbility, critical frozenCritEvidence, base, raw float64, outcome pipeline.DamageOutcome, killed float64, damageID uint64) {
	if _, declared := f.run.compiled.RuntimeTypes.DamageTaken.Lookup(); !declared {
		return
	}
	event := emittedEvent{eventType: model.EventTypeDamageTaken, ref: operation.Ref, sourceKey: cmd.Source, targetKey: cmd.Target,
		castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
		snapshot: f.captureEmitSnapshot(model.EventTypeDamageTaken, cmd.Source, cmd.Target)}
	event.types = append([]string{event.eventType, cmd.DamageType}, operation.Types...)
	event.types = append(event.types, f.abilityTypeKeys(ability)...)
	event.types = f.appendCastOriginEventType(event.types)
	event.snapshot.hasDamageSnapshot = true
	event.snapshot.shieldAbsorptions = outcome.ShieldAbsorptions
	event.snapshot.damageSnapshot = buildDamageInstanceSnapshot(critical, base, raw, outcome.MitigatedAmount)
	event.snapshot.damageSnapshot.HasActualHPLoss = true
	event.snapshot.damageSnapshot.ActualHPLoss = outcome.HPDamage
	event.snapshot.damageSnapshot.HasKilled, event.snapshot.damageSnapshot.Killed = true, killed
	event.snapshot.damageTypeKey = cmd.DamageType
	event.snapshot.damageTraits = append([]string(nil), operation.Types...)
	event.useKey, event.useSource, event.useSkillKey = f.processUseKey, f.processUseSource, f.processUseSkillKey
	if event.useKey == "" && f.eventCtx != nil && f.eventCtx.hasUse {
		event.useKey, event.useSource, event.useSkillKey = f.eventCtx.useKey, f.eventCtx.useSource, f.eventCtx.useSkillKey
	}
	event.hasUse = event.useKey != ""
	attachUseToSnapshot(&event)
	f.pendingEvents = append(f.pendingEvents, event)
	if f.run.compiled.HasReceivedShieldReads {
		f.recordReceivedShieldDamageTaken(cmd, operation, outcome, killed, damageID, event)
		return
	}
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: model.EvidenceKindEmittedEvent, Ref: event.eventType,
			Data: map[string]interface{}{"source": cmd.Source, "target": cmd.Target, "useRef": event.useKey,
				"skillKey": event.useSkillKey, "operationRef": operation.Ref, "postDefenseDamage": outcome.MitigatedAmount,
				"shieldAbsorbed": outcome.ShieldAbsorbed, "actualHpLoss": outcome.HPDamage, "killed": killed}}
	})
}

// 独立调用使新增身份只在有读取时被闭包捕获，避免旧事件入口参数装箱。
func (f *executionFrame) recordReceivedShieldDamageTaken(cmd command.Command, operation planbundle.CompiledOperation,
	outcome pipeline.DamageOutcome, killed float64, damageID uint64, event emittedEvent) {
	f.recordEvidenceLazy(model.EvidenceKindEmittedEvent, func() model.EvidenceItem {
		data := map[string]interface{}{"source": cmd.Source, "target": cmd.Target, "useRef": event.useKey,
			"skillKey": event.useSkillKey, "operationRef": operation.Ref, "postDefenseDamage": outcome.MitigatedAmount,
			"shieldAbsorbed": outcome.ShieldAbsorbed, "actualHpLoss": outcome.HPDamage, "killed": killed}
		if outcome.ShieldAbsorptions != nil {
			data["damageId"], data["shieldAbsorptions"] = damageID, outcome.ShieldAbsorptions.Rows
		}
		return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: model.EvidenceKindEmittedEvent, Ref: event.eventType,
			Data: data}
	})
}
