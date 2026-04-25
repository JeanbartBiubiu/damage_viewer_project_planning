// 本文件验证历史窗口求和、快照和 pair mark 的基础行为。
package history

import "testing"

func TestHistorySumAndSnapshot(t *testing.T) {
	window := NewWindow(4)
	window.Add(1000, 10)
	window.Add(2000, 20)
	window.Add(3500, 35)
	window.Add(5000, 50)

	if got := window.Sum(5000, 3000); got != 105 {
		t.Fatalf("sum got %.2f, want 105", got)
	}
	entry, ok := window.AtOrBefore(3600)
	if !ok || entry.TimeMs != 3500 || entry.Value != 35 {
		t.Fatalf("snapshot got %+v ok=%v", entry, ok)
	}
}

func TestPairMarkConsume(t *testing.T) {
	var pair PairState
	pair.AddMark("akali_e")
	if !pair.HasMark("akali_e") {
		t.Fatal("mark not added")
	}
	if !pair.ConsumeMark("akali_e") || pair.HasMark("akali_e") {
		t.Fatal("mark not consumed")
	}
}
