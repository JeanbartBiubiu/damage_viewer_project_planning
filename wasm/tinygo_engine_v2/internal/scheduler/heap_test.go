// 本文件验证事件堆同刻 priority/seq 稳定排序和队列基础行为。
package scheduler

import "testing"

func TestHeapOrder(t *testing.T) {
	heap := NewHeap(8)
	events := []Event{
		{TimeMs: 10, Priority: 2, Seq: 3},
		{TimeMs: 5, Priority: 4, Seq: 1},
		{TimeMs: 10, Priority: 1, Seq: 4},
		{TimeMs: 10, Priority: 1, Seq: 2},
	}
	for _, ev := range events {
		if code := heap.Push(ev); code != "OK" {
			t.Fatalf("push failed: %s", code)
		}
	}
	var got []Event
	for heap.Len() > 0 {
		ev, _ := heap.Pop()
		got = append(got, ev)
	}
	wantSeq := []uint64{1, 2, 4, 3}
	for i, seq := range wantSeq {
		if got[i].Seq != seq {
			t.Fatalf("at %d got seq %d, want %d", i, got[i].Seq, seq)
		}
	}
}
