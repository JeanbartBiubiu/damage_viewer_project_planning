package pipeline

import "testing"

func TestEmptyShieldResultsKeepAbsentCollection(t *testing.T) {
	for _, input := range [][]ShieldInstance{nil, {}, {{Remaining: 10, ExpireAt: 100}}, {{Remaining: 0}}} {
		if ActiveShields(input, 100) != nil {
			t.Fatal("empty or expired shield projection became an explicit empty collection")
		}
		_, next := ApplyMitigatedDamage(10, 10, CombatantView{Shields: input}, 100, false)
		if next.Shields != nil {
			t.Fatal("absent shield settlement result became an explicit empty collection")
		}
	}
	_, next := ApplyMitigatedDamage(10, 10, CombatantView{Shields: []ShieldInstance{{Remaining: 10}}}, 100, true)
	if next.Shields != nil {
		t.Fatal("fully depleted shield collection must remain absent")
	}
}

func TestShieldAppendDoesNotOverwriteBorrowedSpareCapacity(t *testing.T) {
	storage := make([]ShieldInstance, 2, 4)
	storage[0] = ShieldInstance{ShieldRef: "existing", Remaining: 10}
	storage[1] = ShieldInstance{ShieldRef: "older-branch", Remaining: 20}
	borrowed := CombatantView{Shields: storage[:1]}
	next := ResolveShield(Command{Kind: KindShield, Ref: "new", Source: "source", Target: "target", Amount: 30}, borrowed, 0)
	if len(next.Shields) != 2 || next.Shields[1].ShieldRef != "new" || storage[1].ShieldRef != "older-branch" || len(borrowed.Shields) != 1 {
		t.Fatal("new shield overwrote another borrowed branch")
	}
}

func TestSortByPriorityAbsorbOrder(t *testing.T) {
	instances := []ShieldInstance{
		{ShieldRef: "high", Remaining: 10, Priority: 10},
		{ShieldRef: "low", Remaining: 10, Priority: 1},
	}
	SortShields(instances)
	if instances[0].ShieldRef != "low" {
		t.Fatalf("low priority first, got %s", instances[0].ShieldRef)
	}
}

func TestActiveInstancesSkipsExpired(t *testing.T) {
	instances := []ShieldInstance{
		{Remaining: 50, ExpireAt: 100},
		{Remaining: 50, ExpireAt: 0},
	}
	active := ActiveShields(instances, 100)
	if len(active) != 1 {
		t.Fatalf("active=%d want 1", len(active))
	}
}
