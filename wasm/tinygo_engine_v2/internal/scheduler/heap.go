// 本文件实现按 time、priority、seq 排序的确定性事件堆和 generation handle 基础类型。
package scheduler

import "tinygo_engine_v2/internal/model"

const MaxEventHeap = 8192

type EventKind uint8

const (
	EventCastIntent EventKind = iota + 1
	EventStatusExpire
	EventShieldExpire
	EventIntentRecheck
	EventStatusTick
	EventActionComplete
)

type Handle struct {
	Index      uint16
	Generation uint16
}

type Event struct {
	TimeMs     int64
	Priority   int16
	Seq        uint64
	Kind       EventKind
	Source     uint8
	Target     uint8
	Action     uint16
	Status     Handle
	Shield     Handle
	Execution  Handle
	ChainDepth uint8
}

type Heap struct {
	items []Event
	seq   uint64
	Peak  int
}

func NewHeap(capacity int) Heap {
	if capacity <= 0 {
		capacity = 32
	}
	return Heap{items: make([]Event, 0, capacity)}
}

func (h *Heap) NextSeq() uint64 {
	h.seq++
	return h.seq
}

func (h *Heap) Push(ev Event) model.ErrCode {
	if len(h.items) >= MaxEventHeap {
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

func (h *Heap) Pop() (Event, bool) {
	if len(h.items) == 0 {
		return Event{}, false
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

func (h *Heap) Len() int {
	return len(h.items)
}

func (h *Heap) PeekTime() (int64, bool) {
	if len(h.items) == 0 {
		return 0, false
	}
	return h.items[0].TimeMs, true
}

func Less(a, b Event) bool {
	if a.TimeMs != b.TimeMs {
		return a.TimeMs < b.TimeMs
	}
	if a.Priority != b.Priority {
		return a.Priority < b.Priority
	}
	return a.Seq < b.Seq
}

func (h *Heap) up(i int) {
	for i > 0 {
		parent := (i - 1) / 2
		if !Less(h.items[i], h.items[parent]) {
			break
		}
		h.items[i], h.items[parent] = h.items[parent], h.items[i]
		i = parent
	}
}

func (h *Heap) down(i int) {
	for {
		left := i*2 + 1
		if left >= len(h.items) {
			return
		}
		best := left
		right := left + 1
		if right < len(h.items) && Less(h.items[right], h.items[left]) {
			best = right
		}
		if !Less(h.items[best], h.items[i]) {
			return
		}
		h.items[i], h.items[best] = h.items[best], h.items[i]
		i = best
	}
}
