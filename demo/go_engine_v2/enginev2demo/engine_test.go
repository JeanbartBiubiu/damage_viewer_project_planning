package enginev2demo

import "testing"

func TestBenchmarkBattleSummary(t *testing.T) {
	session, err := NewBenchmarkSession()
	if err != nil {
		t.Fatalf("NewBenchmarkSession() error = %v", err)
	}

	result, err := session.Run(BenchmarkInput())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	summary := Summarize(result)
	if summary.StopReason != "queue_empty" {
		t.Fatalf("unexpected stop reason: %s", summary.StopReason)
	}
	if summary.ProcessedEvents != 12 {
		t.Fatalf("unexpected processed events: %d", summary.ProcessedEvents)
	}
	if summary.FinalTimeMs != 2400 {
		t.Fatalf("unexpected final time: %d", summary.FinalTimeMs)
	}
	if summary.EnemyHP != 0 {
		t.Fatalf("enemy should be dead, hp=%f", summary.EnemyHP)
	}
	if summary.SelfHP <= 0 {
		t.Fatalf("self should survive, hp=%f", summary.SelfHP)
	}
	if summary.LogCount == 0 {
		t.Fatal("expected logs to be generated")
	}
}
