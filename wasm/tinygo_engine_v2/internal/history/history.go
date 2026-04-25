// 本文件实现历史窗口和 pair mark 的轻量状态，用于 recent damage、标记等机制查询。
package history

type Entry struct {
	TimeMs int64
	Value  float64
}

type Window struct {
	items []Entry
	next  int
	full  bool
}

func NewWindow(capacity int) Window {
	if capacity <= 0 {
		capacity = 64
	}
	return Window{items: make([]Entry, capacity)}
}

func (w *Window) Add(timeMs int64, value float64) {
	if len(w.items) == 0 {
		return
	}
	w.items[w.next] = Entry{TimeMs: timeMs, Value: value}
	w.next++
	if w.next >= len(w.items) {
		w.next = 0
		w.full = true
	}
}

func (w Window) Sum(nowMs int64, windowMs int64) float64 {
	if windowMs < 0 {
		return 0
	}
	minTime := nowMs - windowMs
	total := 0.0
	w.each(func(entry Entry) {
		if entry.TimeMs >= minTime && entry.TimeMs <= nowMs {
			total += entry.Value
		}
	})
	return total
}

func (w Window) AtOrBefore(targetMs int64) (Entry, bool) {
	var best Entry
	found := false
	w.each(func(entry Entry) {
		if entry.TimeMs <= targetMs && (!found || entry.TimeMs > best.TimeMs) {
			best = entry
			found = true
		}
	})
	return best, found
}

func (w Window) each(fn func(Entry)) {
	limit := len(w.items)
	if !w.full {
		limit = w.next
	}
	for i := 0; i < limit; i++ {
		fn(w.items[i])
	}
}

type Counter struct {
	Key   string
	Value int
}

type PairState struct {
	Marks     [8]string
	MarkCount int
}

func (p *PairState) HasMark(mark string) bool {
	for i := 0; i < p.MarkCount; i++ {
		if p.Marks[i] == mark {
			return true
		}
	}
	return false
}

func (p *PairState) AddMark(mark string) {
	if mark == "" || p.HasMark(mark) || p.MarkCount >= len(p.Marks) {
		return
	}
	p.Marks[p.MarkCount] = mark
	p.MarkCount++
}

func (p *PairState) ConsumeMark(mark string) bool {
	for i := 0; i < p.MarkCount; i++ {
		if p.Marks[i] == mark {
			copy(p.Marks[i:], p.Marks[i+1:p.MarkCount])
			p.MarkCount--
			p.Marks[p.MarkCount] = ""
			return true
		}
	}
	return false
}
