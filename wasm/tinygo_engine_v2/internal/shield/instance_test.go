package shield

import "testing"

func TestSortByPriorityAbsorbOrder(t *testing.T) {
	instances := []Instance{
		{ShieldRef: "high", Remaining: 10, Priority: 10},
		{ShieldRef: "low", Remaining: 10, Priority: 1},
	}
	SortByPriority(instances)
	if instances[0].ShieldRef != "low" {
		t.Fatalf("low priority first, got %s", instances[0].ShieldRef)
	}
}

func TestActiveInstancesSkipsExpired(t *testing.T) {
	instances := []Instance{
		{Remaining: 50, ExpireAt: 100},
		{Remaining: 50, ExpireAt: 0},
	}
	active := ActiveInstances(instances, 100)
	if len(active) != 1 {
		t.Fatalf("active=%d want 1", len(active))
	}
}
