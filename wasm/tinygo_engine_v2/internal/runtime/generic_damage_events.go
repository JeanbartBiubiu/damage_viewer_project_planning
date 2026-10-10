package runtime

import (
	"math"
	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type damageTypeContribution struct {
	damageType      string
	rawAmount       float64
	mitigatedAmount float64
	operationRefs   []string
}

type frameDamageAggregation struct {
	rawAmount       float64
	mitigatedAmount float64
	operationRefs   []string
	// byType 保持原键排序，只去重分类，不去重实际贡献。
	byType []damageTypeContribution
}

// recordDamageContribution 不重新结算，复制与监听子帧保持原边界。
func (f *executionFrame) recordDamageContribution(cmd command.Command, result command.Result, operationRef, operationPath string) *model.EngineError {
	if f.chainDepth != 0 || result.Amount <= 0 {
		return nil
	}
	if _, declared := f.run.compiled.Types.Registry.LookupDomain("event", eventTypeDamageDealt); !declared {
		return nil
	}
	aggregation := &f.damageAggregation
	index := 0
	for index < len(aggregation.byType) && aggregation.byType[index].damageType < cmd.DamageType {
		index++
	}
	existing := index < len(aggregation.byType) && aggregation.byType[index].damageType == cmd.DamageType
	typeRaw, typeMitigated := cmd.Amount, result.Amount
	if existing {
		typeRaw += aggregation.byType[index].rawAmount
		typeMitigated += aggregation.byType[index].mitigatedAmount
	}
	totalRaw, totalMitigated := aggregation.rawAmount+cmd.Amount, aggregation.mitigatedAmount+result.Amount
	for _, amount := range [4]float64{totalRaw, totalMitigated, typeRaw, typeMitigated} {
		if math.IsNaN(amount) || math.IsInf(amount, 0) {
			return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed,
				"damage event aggregation must remain finite", operationPath, cmd.DamageType,
				f.run.compiled.SchemaHash, f.run.compiled.RulesHash, f.run.req.SessionID)
		}
	}
	aggregation.rawAmount, aggregation.mitigatedAmount = totalRaw, totalMitigated
	aggregation.operationRefs = append(aggregation.operationRefs, operationRef)
	if !existing {
		aggregation.byType = append(aggregation.byType, damageTypeContribution{})
		copy(aggregation.byType[index+1:], aggregation.byType[index:len(aggregation.byType)-1])
		aggregation.byType[index] = damageTypeContribution{damageType: cmd.DamageType}
	}
	contribution := &aggregation.byType[index]
	contribution.rawAmount, contribution.mitigatedAmount = typeRaw, typeMitigated
	contribution.operationRefs = append(contribution.operationRefs, operationRef)
	return nil
}

// maybeQueueDamageDealtEvent 仅由原有两处根帧提交调用，每帧最多合成一次。
// 聚合金额只写证据，不建立 event.damage 数值上下文。
func (f *executionFrame) maybeQueueDamageDealtEvent(ability planbundle.CompiledAbility) {
	aggregation := &f.damageAggregation
	if f.chainDepth != 0 || aggregation.mitigatedAmount <= 0 {
		return
	}
	if _, declared := f.run.compiled.Types.Registry.LookupDomain("event", eventTypeDamageDealt); !declared {
		return
	}
	damageTypes := make([]string, len(aggregation.byType))
	breakdown := make([]map[string]interface{}, len(aggregation.byType))
	eventTypes := []string{eventTypeDamageDealt}
	for index, contribution := range aggregation.byType {
		damageTypes[index] = contribution.damageType
		eventTypes = append(eventTypes, contribution.damageType)
		breakdown[index] = map[string]interface{}{
			"damageType": contribution.damageType, "rawAmount": contribution.rawAmount,
			"mitigatedAmount": contribution.mitigatedAmount,
			"operationRefs":   append([]string(nil), contribution.operationRefs...),
		}
	}
	if id, declared := f.run.compiled.Types.Registry.LookupDomain("ability", abilityTypeBasicAttack); declared && ability.TypeSet.Contains(id) {
		if _, declared := f.run.compiled.Types.Registry.LookupDomain("event", eventTypeDamageDealtBasicAttack); declared {
			eventTypes = append(eventTypes, eventTypeDamageDealtBasicAttack)
		}
	}
	data := map[string]interface{}{
		"source": f.sourceKey, "target": f.targetKey, "eventType": eventTypeDamageDealt,
		"abilityRef": f.abilityRef, "rawAmount": aggregation.rawAmount,
		"mitigatedAmount": aggregation.mitigatedAmount, "phantom": false,
		"damageTypes": damageTypes, "damageBreakdown": breakdown,
	}
	if len(damageTypes) == 1 {
		data["damageType"] = damageTypes[0]
	}
	attachCastProvenance(data, f.castInstanceID, f.castOrigin)
	if len(aggregation.operationRefs) == 1 {
		if aggregation.operationRefs[0] != "" {
			data["operationRef"] = aggregation.operationRefs[0]
		}
	} else if len(aggregation.operationRefs) > 1 {
		data["operationRefs"] = append([]string(nil), aggregation.operationRefs...)
	}
	f.recordEvidence(model.EvidenceItem{
		TimeMs: f.run.nowMs, Kind: model.EvidenceKindEmittedEvent, Ref: eventTypeDamageDealt, Data: data,
	})
	f.pendingEvents = append(f.pendingEvents, emittedEvent{
		eventType: eventTypeDamageDealt, ref: eventTypeDamageDealt,
		sourceKey: f.sourceKey, targetKey: f.targetKey,
		types:          f.appendCastOriginEventType(eventTypes),
		snapshot:       f.captureEmitSnapshot(eventTypeDamageDealt, f.sourceKey, f.targetKey),
		castInstanceID: f.castInstanceID, castOrigin: f.castOrigin,
	})
}
