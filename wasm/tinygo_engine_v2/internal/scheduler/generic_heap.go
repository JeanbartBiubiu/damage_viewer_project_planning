// Generic 事件堆：按 timeMs + categoryOrder + priority + seq 稳定排序（§11）。
package scheduler

import "tinygo_engine_v2/internal/model"

const MaxGenericEventHeap = 100000

// GenericEventCategory 是 P0 固定 category 顺序（值越小越先执行）。
type GenericEventCategory uint8

const (
	GenericCategoryExpireCleanup GenericEventCategory = iota
	GenericCategoryProviderTick
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
	GenericEventSample
)

// ProviderInstanceRef 定位 combatant 上的 provider instance。
type ProviderInstanceRef struct {
	CombatantKey string
	ProviderRef  string
}

// GenericEvent 是 generic runtime 调度事件。
type GenericEvent struct {
	TimeMs   int64
	Category GenericEventCategory
	Priority int16
	Seq      uint64
	Kind     GenericEventKind
	// DriverEntryIndex 指向 driver plan entry；-1 表示非 driver 事件。
	DriverEntryIndex int
	AttemptIndex     int
	// ProviderInstanceRef 用于 provider_tick / expire_cleanup 定位 provider。
	ProviderInstanceRef ProviderInstanceRef
}

// GenericHeap 是 generic 专用最小堆。
type GenericHeap struct {
	items []GenericEvent
	seq   uint64
	Peak  int
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
	if len(h.items) >= MaxGenericEventHeap {
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

// GenericLess 定义 generic 堆序：timeMs → category → priority → seq。
func GenericLess(a, b GenericEvent) bool {
	if a.TimeMs != b.TimeMs {
		return a.TimeMs < b.TimeMs
	}
	if a.Category != b.Category {
		return a.Category < b.Category
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
