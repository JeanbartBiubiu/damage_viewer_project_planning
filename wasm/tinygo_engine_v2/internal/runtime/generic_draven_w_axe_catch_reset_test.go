package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_draven W Blood Rush axe-catch cooldown reset (generic ABI evidence).
//
// After Spinning Axe flight emits event/axe_caught, a source-owner listener on
// hero:draven applies cooldown_change to blood_rush with valuePolicy=override
// and amount=0 (readyAt=now in current runtime). Proves a second W cast before
// the normal 12000ms CD when the catch listener is present; control without the
// listener still records cooldown_not_ready.
//
// Non-goals: movement speed, decay, ghost, other ranks, publish, production wiring.

func loadDravenWAxeCatchResetFixture(t *testing.T, withAxeCatchCDReset bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Q graph: champion:source_demo abilities + hero:draven_spinning_axe + flight.
	compileReq, runReq := loadDravenSpinningAxeFixture(t)
	ensureDravenBloodRushTypes(&compileReq)
	// W graph: hero:draven appended beside Q (does not replace SharedProviders[0]).
	mountDravenBloodRushProviderAppend(&compileReq, &runReq, withAxeCatchCDReset)

	// Mana covers W20 + Q45 + W20; spinning-axe fixture already has level-1 mana.
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func dravenWAxeCatchResetScenarioPlan() (entries []model.DriverEntry, aaAt, catchAt, w2At int64) {
	aaAt = 100
	catchAt = aaAt + dravenSpinningAxeCatchMs // 1500: flight tick at apply+1400
	w2At = 2000                               // strictly before blood_rush CD 12000
	entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q", AbilityRef: dravenQRef(), Source: "source", Target: "target", FirstAtMs: 50},
		{EntryKey: "aa", AbilityRef: dravenAARef(), Source: "source", Target: "target", FirstAtMs: aaAt},
		{EntryKey: "w2", AbilityRef: dravenBloodRushWRef(), Source: "source", Target: "target", FirstAtMs: w2At},
	}
	return entries, aaAt, catchAt, w2At
}

// TestGenericDravenBloodRushAxeCatchResetsWCooldown: catch listener makes early
// second W succeed before the normal 12000ms cooldown.
func TestGenericDravenBloodRushAxeCatchResetsWCooldown(t *testing.T) {
	compileReq, runReq := loadDravenWAxeCatchResetFixture(t, true)
	entries, _, catchAt, w2At := dravenWAxeCatchResetScenarioPlan()
	if w2At >= int64(dravenBloodRushCDMs) {
		t.Fatalf("scenario w2At=%d must be < blood_rush CD %v", w2At, dravenBloodRushCDMs)
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = 2500

	startMana := dravenSpinningAxeSourceMana(t, runReq.InitialSnapshot)
	done := runDravenBloodRush(t, compileReq, runReq)

	if emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catchAt) != 1 {
		t.Fatalf("axe_caught at %d count=%d want 1", catchAt, emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catchAt))
	}
	if dravenBloodRushSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 0 {
		t.Fatal("expected no cooldown_not_ready skip after axe_caught reset")
	}
	// W1 + Q + W2 emit ability_started; AA is basic_attack.
	if countEmittedEvents(done, dravenBloodRushCastEvent) != 3 {
		t.Fatalf("ability_started=%d want 3 (2 W + 1 Q)", countEmittedEvents(done, dravenBloodRushCastEvent))
	}
	if done.Summary.AbilityCastCount != 4 {
		t.Fatalf("abilityCastCount=%d want 4 (2 W + Q + AA)", done.Summary.AbilityCastCount)
	}
	wantMana := startMana - dravenBloodRushManaCost - dravenSpinningAxeMana - dravenBloodRushManaCost
	if got := dravenBloodRushSourceMana(t, done.FinalSnapshot); math.Abs(got-wantMana) > 1e-9 {
		t.Fatalf("mana=%v want %v (W+Q+W)", got, wantMana)
	}
}

// TestGenericDravenBloodRushEarlyWSkippedWithoutAxeCatchListener: same timeline
// without the catch listener still records cooldown_not_ready for the early W2.
func TestGenericDravenBloodRushEarlyWSkippedWithoutAxeCatchListener(t *testing.T) {
	compileReq, runReq := loadDravenWAxeCatchResetFixture(t, false)
	entries, _, catchAt, _ := dravenWAxeCatchResetScenarioPlan()
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = 2500

	startMana := dravenSpinningAxeSourceMana(t, runReq.InitialSnapshot)
	done := runDravenBloodRush(t, compileReq, runReq)

	// Flight still emits axe_caught; only the W CD reset listener is absent.
	if emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catchAt) != 1 {
		t.Fatalf("axe_caught at %d count=%d want 1 (flight unchanged)", catchAt, emittedEventsAt(done, dravenSpinningAxeCaughtEvent, catchAt))
	}
	if dravenBloodRushSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for early second W without catch listener")
	}
	if countEmittedEvents(done, dravenBloodRushCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2 (W1 + Q only)", countEmittedEvents(done, dravenBloodRushCastEvent))
	}
	if done.Summary.AbilityCastCount != 3 {
		t.Fatalf("abilityCastCount=%d want 3 (W1 + Q + AA; W2 skipped)", done.Summary.AbilityCastCount)
	}
	wantMana := startMana - dravenBloodRushManaCost - dravenSpinningAxeMana
	if got := dravenBloodRushSourceMana(t, done.FinalSnapshot); math.Abs(got-wantMana) > 1e-9 {
		t.Fatalf("mana=%v want %v (no second W cost)", got, wantMana)
	}
}
