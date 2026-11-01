package hit

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

type startOrder struct {
	timeMs   int64
	priority int16
	index    int
	entryKey string
}

func (s *State) ValidateAttackStartOrder(starts map[string]model.AttackStartFact, entries []model.DriverEntry, identity Identity) *model.EngineError {
	startsByUse := map[string]startOrder{}
	for entryKey, fact := range starts {
		startsByUse[fact.UseRef] = driverOrder(entries, entryKey)
	}
	for entryKey, fact := range s.facts {
		if fact.UseRef == nil || *fact.UseRef == "" {
			continue
		}
		start, known := startsByUse[*fact.UseRef]
		if !known {
			continue
		}
		hit := driverOrder(entries, entryKey)
		if !attackStartBeforeHit(start, hit) {
			return hitError(identity, model.GenericErrUnknownRef, "attack start must precede the corresponding hit in heap order", "attackStartFacts", start.entryKey+" vs "+hit.entryKey)
		}
	}
	return nil
}

func driverOrder(entries []model.DriverEntry, entryKey string) startOrder {
	for index, entry := range entries {
		if entry.EntryKey == entryKey {
			return startOrder{timeMs: entry.FirstAtMs, priority: int16(entry.Priority), index: index, entryKey: entryKey}
		}
	}
	// 原读取返回零值驱动，原序号查找返回MaxInt32；缺少入口不按0号槽解释。
	return startOrder{index: math.MaxInt32, entryKey: entryKey}
}

func attackStartBeforeHit(start, hit startOrder) bool {
	if start.timeMs != hit.timeMs {
		return start.timeMs < hit.timeMs
	}
	if start.priority != hit.priority {
		return start.priority < hit.priority
	}
	return start.index < hit.index
}
