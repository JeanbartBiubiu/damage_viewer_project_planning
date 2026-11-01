package listener

import "tinygo_engine_v2/internal/model"

// perCastThrottleKey 保留既有监听序号、拥有者、挂载和施放的完整身份。
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

func (s *State) Allow(listenerIndex int, ownerCombatantKey, ownerProviderRef string, castInstanceID uint64, throttleMs int, nowMs int64) bool {
	if throttleMs <= 0 {
		return true
	}
	if castInstanceID == 0 {
		return false
	}
	key := perCastThrottleKey{
		listenerIndex:     listenerIndex,
		ownerCombatantKey: ownerCombatantKey,
		ownerProviderRef:  ownerProviderRef,
		castInstanceID:    castInstanceID,
	}
	last, ok := s.throttle[key]
	if !ok {
		return true
	}
	return nowMs-last >= int64(throttleMs)
}

func (s *State) Triggered(listenerIndex int, ownerCombatantKey, ownerProviderRef string, castInstanceID uint64, nowMs int64) {
	if castInstanceID == 0 {
		return
	}
	if s.throttle == nil {
		s.throttle = make(map[perCastThrottleKey]int64)
	}
	key := perCastThrottleKey{
		listenerIndex:     listenerIndex,
		ownerCombatantKey: ownerCombatantKey,
		ownerProviderRef:  ownerProviderRef,
		castInstanceID:    castInstanceID,
	}
	if _, exists := s.throttle[key]; !exists {
		s.evictPerCastThrottleIfNeeded()
	}
	s.throttle[key] = nowMs
}

func (s *State) evictPerCastThrottleIfNeeded() {
	capN := s.capacity
	if capN <= 0 {
		capN = perCastThrottleCapacity(0)
		s.capacity = capN
	}
	if len(s.throttle) < capN {
		return
	}
	var victim perCastThrottleKey
	found := false
	for k := range s.throttle {
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
		delete(s.throttle, victim)
		if !s.overflowWarned {
			s.overflowWarned = true
			s.overflowCount = 1
		} else {
			s.overflowCount++
		}
	}
}

// 淘汰顺序先比较施放身份，再比较监听序号、拥有者和挂载，不依赖映射遍历顺序。
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

func (s *State) OverflowWarning() *model.WarningItem {
	if !s.overflowWarned {
		return nil
	}
	return &model.WarningItem{
		Code:     string(model.WarningCodePerCastThrottleOverflow),
		Message:  "per-cast listener throttle table overflow; oldest cast entries evicted",
		Severity: model.WarningSeverityWarning,
		Count:    s.overflowCount,
	}
}
