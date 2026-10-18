// Generic 事件堆：按 timeMs + categoryOrder + priority + seq 稳定排序（§11）。
package scheduler

import "tinygo_engine_v2/internal/model"

const MaxGenericEventHeap = 100000

// GenericEventCategory 是 P0 固定 category 顺序（值越小越先执行）。
type GenericEventCategory uint8

const (
	GenericCategorySourceInitialization GenericEventCategory = iota
	GenericCategoryProcessTimer
	GenericCategoryAnchoredTick
	GenericCategoryExpireCleanup
	GenericCategoryProviderTick
	GenericCategoryAmmoRecovery
	GenericCategorySkillAction
	GenericCategoryAbilityAttempt
	GenericCategoryTriggeredContinuation
	GenericCategorySample
)

// GenericEventKind 区分同类事件 payload 形态。
type GenericEventKind uint8

const (
	GenericEventExpireCleanup GenericEventKind = iota + 1
	GenericEventProviderTick
	GenericEventAbilityAttempt
	GenericEventTriggeredContinuation
	GenericEventSample
	GenericEventAnchoredTick
	GenericEventProcessTimer
	GenericEventBasicAttack
	GenericEventSourceInitialized
	GenericEventAmmoRecovery
	GenericEventSkillAction
	GenericEventAmmoAdmission
	GenericEventAutomaticSkill
)

// ProviderInstanceRef 定位 combatant 上的 provider instance。
type ProviderInstanceRef struct {
	CombatantKey string
	ProviderRef  string
}

// GenericEvent 是 generic runtime 调度事件。
type GenericEvent struct {
	AutomaticGeneration   uint64
	CooldownWaitVersion   uint64
	SkillActionIndex      int
	AmmoGeneration        uint64
	AmmoStateKey          string
	BasicAttackGeneration uint64
	ProcessIndex          int
	ProcessStepVersion    int
	ProcessExecutionIndex int
	ProcessSortKey        string
	TimeMs                int64
	Category              GenericEventCategory
	Priority              int16
	Seq                   uint64
	Kind                  GenericEventKind
	// DriverEntryIndex 指向 driver plan entry；-1 表示非 driver 事件。
	DriverEntryIndex int
	AttemptIndex     int
	// ContinuationID 定位 run-local triggered continuation payload；0 表示无。
	ContinuationID uint64
	// ProviderInstanceRef 用于 provider_tick / expire_cleanup 定位 provider。
	ProviderInstanceRef       ProviderInstanceRef
	ProviderTickActivatedAtMs int64
}

// GenericHeap 是 generic 专用最小堆。
type GenericHeap struct {
	items []GenericEvent
	seq   uint64
	Peak  int
	limit int
}

func NewGenericHeap(capacity int) GenericHeap {
	if capacity <= 0 {
		capacity = 32
	}
	return GenericHeap{items: make([]GenericEvent, 0, capacity)}
}

func (h *GenericHeap) NextSeq() uint64 {
	h.seq++
	return h.seq
}

func (h *GenericHeap) Push(ev GenericEvent) model.ErrCode {
	if !h.CanPush(1) {
		return model.ErrQueueOverflow
	}
	if ev.Seq == 0 {
		ev.Seq = h.NextSeq()
	}
	h.items = append(h.items, ev)
	h.up(len(h.items) - 1)
	if len(h.items) > h.Peak {
		h.Peak = len(h.items)
	}
	return model.ErrOK
}

func (h *GenericHeap) Pop() (GenericEvent, bool) {
	if len(h.items) == 0 {
		return GenericEvent{}, false
	}
	root := h.items[0]
	last := h.items[len(h.items)-1]
	h.items = h.items[:len(h.items)-1]
	if len(h.items) > 0 {
		h.items[0] = last
		h.down(0)
	}
	return root, true
}

func (h *GenericHeap) Len() int {
	return len(h.items)
}

func (h *GenericHeap) PeekTime() (int64, bool) {
	if len(h.items) == 0 {
		return 0, false
	}
	return h.items[0].TimeMs, true
}

func (h *GenericHeap) HasBasicAttack() bool {
	for _, event := range h.items {
		if event.Kind == GenericEventBasicAttack {
			return true
		}
	}
	return false
}

func (h *GenericHeap) RescheduleBasicAttack(at int64, generation uint64) bool {
	for index := range h.items {
		if h.items[index].Kind != GenericEventBasicAttack {
			continue
		}
		previous := h.items[index].TimeMs
		h.items[index].TimeMs = at
		h.items[index].BasicAttackGeneration = generation
		if at < previous {
			h.up(index)
		} else {
			h.down(index)
		}
		return true
	}
	return false
}

func (h *GenericHeap) HasAutomaticSkill() bool {
	for _, ev := range h.items {
		if ev.Kind == GenericEventAutomaticSkill {
			return true
		}
	}
	return false
}

func (h *GenericHeap) RescheduleAutomaticSkill(at int64, generation uint64) bool {
	for i := range h.items {
		if h.items[i].Kind != GenericEventAutomaticSkill {
			continue
		}
		previous := h.items[i].TimeMs
		h.items[i].TimeMs, h.items[i].AutomaticGeneration = at, generation
		if at < previous {
			h.up(i)
		} else {
			h.down(i)
		}
		return true
	}
	return false
}

func (h *GenericHeap) HasCooldownAttempt(entry int) bool {
	for _, ev := range h.items {
		if ev.Kind == GenericEventAbilityAttempt && ev.DriverEntryIndex == entry && ev.CooldownWaitVersion != 0 {
			return true
		}
	}
	return false
}

func (h *GenericHeap) RescheduleCooldownAttempt(entry int, at int64, version uint64) bool {
	for i := range h.items {
		if h.items[i].Kind != GenericEventAbilityAttempt || h.items[i].DriverEntryIndex != entry || h.items[i].CooldownWaitVersion == 0 {
			continue
		}
		previous := h.items[i].TimeMs
		h.items[i].TimeMs, h.items[i].CooldownWaitVersion = at, version
		if at < previous {
			h.up(i)
		} else {
			h.down(i)
		}
		return true
	}
	return false
}

// GenericLess 定义 generic 堆序：timeMs → category → priority → seq。
func GenericLess(a, b GenericEvent) bool {
	if a.TimeMs != b.TimeMs {
		return a.TimeMs < b.TimeMs
	}
	if a.Category != b.Category {
		return a.Category < b.Category
	}
	if a.Kind == GenericEventProcessTimer && b.Kind == GenericEventProcessTimer && a.ProcessSortKey != b.ProcessSortKey {
		return a.ProcessSortKey < b.ProcessSortKey
	}
	if a.Priority != b.Priority {
		return a.Priority < b.Priority
	}
	return a.Seq < b.Seq
}

func (h *GenericHeap) up(i int) {
	for i > 0 {
		parent := (i - 1) / 2
		if !GenericLess(h.items[i], h.items[parent]) {
			break
		}
		h.items[i], h.items[parent] = h.items[parent], h.items[i]
		i = parent
	}
}

func (h *GenericHeap) down(i int) {
	for {
		left := i*2 + 1
		if left >= len(h.items) {
			return
		}
		best := left
		right := left + 1
		if right < len(h.items) && GenericLess(h.items[right], h.items[left]) {
			best = right
		}
		if !GenericLess(h.items[best], h.items[i]) {
			return
		}
		h.items[i], h.items[best] = h.items[best], h.items[i]
		i = best
	}
}
