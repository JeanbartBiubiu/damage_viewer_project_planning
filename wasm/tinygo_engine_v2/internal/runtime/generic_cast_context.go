package runtime

import (
	"tinygo_engine_v2/internal/model"
)

// perCastThrottleKey 标识同一 listener×owner×cast 的上次触发时刻。
type perCastThrottleKey struct {
	listenerIndex     int
	ownerCombatantKey string
	ownerProviderRef  string
	castInstanceID    uint64
}

const (
	perCastThrottleCapMin = 256
	perCastThrottleCapMax = 4096
)

func perCastThrottleCapacity(maxEvents int) int {
	if maxEvents < perCastThrottleCapMin {
		return perCastThrottleCapMin
	}
	if maxEvents > perCastThrottleCapMax {
		return perCastThrottleCapMax
	}
	return maxEvents
}

func (s *genericRunState) mintCastInstanceID() uint64 {
	s.nextCastInstanceID++
	return s.nextCastInstanceID
}

// attachCastProvenance writes frame cast identity onto an evidence/event data map.
// castInstanceId is stored as float64 for stable JSON/evidence map reads (IDs are small monotonic).
func attachCastProvenance(data map[string]interface{}, castInstanceID uint64, castOrigin string) {
	if castInstanceID > 0 {
		data["castInstanceId"] = float64(castInstanceID)
	}
	if castOrigin != "" {
		data["castOrigin"] = castOrigin
	}
}

// appendCastOriginEventType adds exactly one catalog-known cast_origin/* key when origin is set.
func (f *executionFrame) appendCastOriginEventType(types []string) []string {
	if f == nil || f.castOrigin == "" || f.run == nil {
		return types
	}
	key := "cast_origin/" + f.castOrigin
	if _, ok := f.run.compiled.Types.Registry.Lookup(key); !ok {
		return types
	}
	for _, existing := range types {
		if existing == key {
			return types
		}
	}
	return append(types, key)
}

// allowPerCastThrottle reports whether the listener may fire for this cast instance.
// Missing table entry or elapsed >= PerCastThrottleMs allows; does not mutate state.
func (s *genericRunState) allowPerCastThrottle(listenerIndex int, ownerCombatantKey, ownerProviderRef string, castInstanceID uint64, throttleMs int) bool {
	if throttleMs <= 0 {
		return true
	}
	if castInstanceID == 0 {
		// Fail closed: throttle without cast identity is unsupported at runtime.
		return false
	}
	key := perCastThrottleKey{
		listenerIndex:     listenerIndex,
		ownerCombatantKey: ownerCombatantKey,
		ownerProviderRef:  ownerProviderRef,
		castInstanceID:    castInstanceID,
	}
	last, ok := s.perCastThrottle[key]
	if !ok {
		return true
	}
	return s.nowMs-last >= int64(throttleMs)
}

// notePerCastThrottleTrigger records lastTriggerMs for a successful listener trigger.
func (s *genericRunState) notePerCastThrottleTrigger(listenerIndex int, ownerCombatantKey, ownerProviderRef string, castInstanceID uint64) {
	if castInstanceID == 0 {
		return
	}
	if s.perCastThrottle == nil {
		s.perCastThrottle = make(map[perCastThrottleKey]int64)
	}
	key := perCastThrottleKey{
		listenerIndex:     listenerIndex,
		ownerCombatantKey: ownerCombatantKey,
		ownerProviderRef:  ownerProviderRef,
		castInstanceID:    castInstanceID,
	}
	if _, exists := s.perCastThrottle[key]; !exists {
		s.evictPerCastThrottleIfNeeded()
	}
	s.perCastThrottle[key] = s.nowMs
}

func (s *genericRunState) evictPerCastThrottleIfNeeded() {
	capN := s.perCastThrottleCapacity
	if capN <= 0 {
		capN = perCastThrottleCapacity(s.budget.MaxEvents)
		s.perCastThrottleCapacity = capN
	}
	if len(s.perCastThrottle) < capN {
		return
	}
	var victim perCastThrottleKey
	found := false
	for k := range s.perCastThrottle {
		if !found {
			victim = k
			found = true
			continue
		}
		if perCastThrottleLess(k, victim) {
			victim = k
		}
	}
	if found {
		delete(s.perCastThrottle, victim)
		if !s.perCastThrottleOverflowWarned {
			s.perCastThrottleOverflowWarned = true
			s.perCastThrottleOverflowCount = 1
		} else {
			s.perCastThrottleOverflowCount++
		}
	}
}

// perCastThrottleLess is the deterministic eviction order:
// smallest castInstanceID; ties by listenerIndex, ownerCombatantKey, ownerProviderRef.
func perCastThrottleLess(a, b perCastThrottleKey) bool {
	if a.castInstanceID != b.castInstanceID {
		return a.castInstanceID < b.castInstanceID
	}
	if a.listenerIndex != b.listenerIndex {
		return a.listenerIndex < b.listenerIndex
	}
	if a.ownerCombatantKey != b.ownerCombatantKey {
		return a.ownerCombatantKey < b.ownerCombatantKey
	}
	return a.ownerProviderRef < b.ownerProviderRef
}

func (s *genericRunState) perCastThrottleOverflowWarning() *model.WarningItem {
	if !s.perCastThrottleOverflowWarned {
		return nil
	}
	return &model.WarningItem{
		Code:     string(model.WarningCodePerCastThrottleOverflow),
		Message:  "per-cast listener throttle table overflow; oldest cast entries evicted",
		Severity: model.WarningSeverityWarning,
		Count:    s.perCastThrottleOverflowCount,
	}
}
