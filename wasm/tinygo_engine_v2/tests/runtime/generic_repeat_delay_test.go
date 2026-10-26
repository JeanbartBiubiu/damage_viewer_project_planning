// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func guinsooCadenceBoilingStrikeOpsWithDelay(delayMs int) []model.OperationDefinition {
	ops := guinsooCadenceBoilingStrikeOps()
	for i := range ops {
		if ops[i].Operation == model.OperationKindRepeat {
			ops[i].RepeatDelayMs = delayMs
		}
	}
	return ops
}

func guinsooCadenceListenersWithDelay(copyableAmt float64, delayMs int) []model.ListenerDefinition {
	return []model.ListenerDefinition{
		guinsooKCopyableListener("guinsoo_wrath", copyableAmt, true),
		{
			ListenerKey:  "guinsoo_boiling_strike",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations:   guinsooCadenceBoilingStrikeOpsWithDelay(delayMs),
		},
	}
}

func phantomEvidenceTimes(done model.DoneResult) []int64 {
	var times []int64
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataBool(item.Data, "phantom") {
			times = append(times, item.TimeMs)
		}
	}
	return times
}

// TestGenericRunRepeatDelayOmittedMatchesImmediate proves omitted delay keeps Guinsoo cadence
// timestamps/order/totals/evidence identical to the immediate path.
func TestGenericRunRepeatDelayOmittedMatchesImmediate(t *testing.T) {
	baseListeners := guinsooCadenceListeners(guinsooKCopyableAmt)
	zeroListeners := guinsooCadenceListenersWithDelay(guinsooKCopyableAmt, 0)

	cOmit, rOmit := loadGuinsooCadenceFixture(t, baseListeners, nil, 7)
	cZero, rZero := loadGuinsooCadenceFixture(t, zeroListeners, nil, 7)
	doneOmit := runGuinsooK(t, cOmit, rOmit)
	doneZero := runGuinsooK(t, cZero, rZero)

	if math.Abs(doneOmit.Summary.SourceDamageDealt-doneZero.Summary.SourceDamageDealt) > 1e-6 {
		t.Fatalf("dealt omit=%v zero=%v", doneOmit.Summary.SourceDamageDealt, doneZero.Summary.SourceDamageDealt)
	}
	omitTimes := phantomEvidenceTimes(doneOmit)
	zeroTimes := phantomEvidenceTimes(doneZero)
	if len(omitTimes) != 1 || len(zeroTimes) != 1 {
		t.Fatalf("phantom counts omit=%d zero=%d", len(omitTimes), len(zeroTimes))
	}
	if omitTimes[0] != zeroTimes[0] || omitTimes[0] != 600 {
		t.Fatalf("phantom times omit=%v zero=%v want [600]", omitTimes, zeroTimes)
	}
	var phantomTag string
	for _, item := range damageEvidenceItems(doneOmit) {
		if evidenceDataBool(item.Data, "phantom") {
			phantomTag = evidenceDataString(item.Data, "repeatTag")
			break
		}
	}
	if phantomTag != "phantom_hit" {
		t.Fatalf("repeatTag=%q want phantom_hit", phantomTag)
	}
}

func TestGenericRunRepeatDelay200ExactTiming(t *testing.T) {
	listeners := guinsooCadenceListenersWithDelay(guinsooKCopyableAmt, 200)
	c, r := loadGuinsooCadenceFixture(t, listeners, nil, 7)
	// Hit 7 at 600ms; continuation at 800. Duration must cover 800.
	r.StopPolicy.DurationMs = 900
	done := runGuinsooK(t, c, r)

	times := phantomEvidenceTimes(done)
	if len(times) != 1 {
		t.Fatalf("phantom count=%d want 1", len(times))
	}
	if times[0] != 800 {
		t.Fatalf("phantom TimeMs=%d want 800", times[0])
	}
	wantDealt := guinsooKAAAmt*7 + guinsooKCopyableAmt*7 + guinsooKCopyableAmt
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

func TestGenericRunRepeatDelayNoDamageBeforeDelayOrPastDuration(t *testing.T) {
	listeners := guinsooCadenceListenersWithDelay(guinsooKCopyableAmt, 200)

	t.Run("duration_ends_before_continuation", func(t *testing.T) {
		c, r := loadGuinsooCadenceFixture(t, listeners, nil, 7)
		// Hit 7 at 600; continuation would be 800; end before that.
		r.StopPolicy.DurationMs = 700
		done := runGuinsooK(t, c, r)
		if got := phantomDamageEvidenceCount(done); got != 0 {
			t.Fatalf("phantom count=%d want 0 when duration ends before +200ms", got)
		}
	})

	t.Run("no_phantom_at_plus_199", func(t *testing.T) {
		c, r := loadGuinsooCadenceFixture(t, listeners, nil, 7)
		r.StopPolicy.DurationMs = 600 + 199
		done := runGuinsooK(t, c, r)
		if got := phantomDamageEvidenceCount(done); got != 0 {
			t.Fatalf("phantom count=%d want 0 at +199ms", got)
		}
		for _, tm := range phantomEvidenceTimes(done) {
			if tm == 600+199 {
				t.Fatalf("unexpected phantom at +199ms")
			}
		}
	})
}
