package runtime

import (
	"errors"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/status"
)

type frozenDamageStateBefore struct {
	reader uint16
	value  float64
}

func (f *executionFrame) captureDamageStateBefore(source, target string) ([]frozenDamageStateBefore, *model.EngineError) {
	if !f.run.compiled.HasDamageStateBefore || f.copyableCollector != nil && f.copyableCollector.phantomDepth > 0 {
		return nil, nil
	}
	var rows []frozenDamageStateBefore
	for index, reader := range f.run.compiled.DamageStateReaders {
		if reader.Owner != source {
			continue
		}
		inst, _, mounted := status.FindByRef(f.stageFor(source).providers, reader.ProviderRef)
		if !mounted || inst.Owner != source || inst.Source != source || inst.DefinitionIndex != reader.ProviderIndex || inst.Expired(f.run.nowMs) {
			continue
		}
		value := float64(0)
		bag := f.providerStateBagForRead(source, reader.ProviderRef, false, providerStateReadOptions{})
		if bag != nil && bag.targetKey == target && target != "" {
			expires := bag.targetExpireAt[reader.StateKey]
			if expires <= 0 || expires > f.run.nowMs {
				value = bag.readTargetValue(reader.StateKey)
			}
		}
		if !validStateInteger(value) || value < 0 {
			return nil, f.run.basicAttackErr("damage state before requires a real nonnegative safe integer", reader.StateKey)
		}
		rows = append(rows, frozenDamageStateBefore{reader: uint16(index), value: value})
	}
	return rows, nil
}

func (f *executionFrame) recordDamageStateBefore(rows []frozenDamageStateBefore, damageID uint64, target string) {
	for _, row := range rows {
		reader := f.run.compiled.DamageStateReaders[row.reader]
		value := row.value
		definition := f.run.compiled.Providers[reader.ProviderIndex].ProviderKey
		f.recordEvidenceLazy("damage_state_before", func() model.EvidenceItem {
			return model.EvidenceItem{TimeMs: f.run.nowMs, Kind: "damage_state_before", Ref: reader.ProviderRef,
				Data: map[string]interface{}{"damageId": damageID, "owner": reader.Owner, "providerRef": reader.ProviderRef, "definitionRef": definition, "stateKey": reader.StateKey, "target": target, "beforeValue": value}}
		})
	}
}

func (f *executionFrame) DamageStateBefore(key string) (float64, error) {
	if f.eventCtx == nil || f.eventCtx.eventType != eventTypeDamageInstance || f.eventCtx.damageID == 0 || f.eventCtx.eventSourceKey != f.ownerCombatantKey || f.eventCtx.eventTargetKey == "" {
		return 0, errors.New("damage state before has no original owning damage instance")
	}
	for _, row := range f.eventCtx.damageStateBefore {
		if int(row.reader) >= len(f.run.compiled.DamageStateReaders) {
			return 0, errors.New("damage state before reader index is invalid")
		}
		reader := f.run.compiled.DamageStateReaders[row.reader]
		if reader.Owner == f.ownerCombatantKey && reader.ProviderRef == f.ownerProviderRef && reader.StateKey == key {
			return row.value, nil
		}
	}
	return 0, errors.New("damage state before is missing its declared frozen fact")
}
