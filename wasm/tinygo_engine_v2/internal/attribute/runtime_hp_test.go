package attribute

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

// DB-shaped hp：Base/Current/Max/Resolved 同为初值；damage 只改 Current。
func dbShapedHP(initial float64) map[string]model.AttributeSlotDef {
	return map[string]model.AttributeSlotDef{
		"hp": {Base: initial, Current: initial, Max: initial, Resolved: initial},
	}
}

func TestReadHPUsesCurrentNotResolvedFallback(t *testing.T) {
	attrs := dbShapedHP(5000)
	attrs = SetHP(attrs, 4200)
	if got := ReadHP(attrs); got != 4200 {
		t.Fatalf("ReadHP=%v want 4200 (must follow Current)", got)
	}
	// Generic ReadAttr("hp") 仍优先非零 Resolved，行为不变。
	if got := ReadAttr(attrs, "hp"); got != 5000 {
		t.Fatalf("ReadAttr(hp)=%v want 5000 (Resolved fallback preserved)", got)
	}
	if got := ReadAttr(attrs, "hp.resolved"); got != 5000 {
		t.Fatalf("ReadAttr(hp.resolved)=%v want 5000", got)
	}
	if got := ReadAttr(attrs, "hp.current"); got != 4200 {
		t.Fatalf("ReadAttr(hp.current)=%v want 4200", got)
	}
}

func TestReadHPTracksRepeatedSetHPAgainstStaleResolved(t *testing.T) {
	attrs := dbShapedHP(5000)
	perHit := 46.666666666666664 // ≈ 6720/144 mitigated sample from real bundle
	for i := 0; i < 144; i++ {
		before := ReadHP(attrs)
		attrs = SetHP(attrs, before-perHit)
	}
	got := ReadHP(attrs)
	want := 5000 - perHit*144
	if got > 0 {
		t.Fatalf("after 144 hits ReadHP=%v want <=0 (accumulated Current), Resolved still %v", got, attrs["hp"].Resolved)
	}
	if attrs["hp"].Resolved != 5000 {
		t.Fatalf("Resolved mutated=%v want 5000 (SetHP must not touch Resolved)", attrs["hp"].Resolved)
	}
	if want > 0 {
		t.Fatalf("fixture math: want overkill (5000-6720)<0, got want=%v", want)
	}
}

func TestApplyHealReadsCurrentNotStaleResolved(t *testing.T) {
	attrs := dbShapedHP(5000)
	attrs = SetHP(attrs, 1000)
	attrs, healed := ApplyHeal(attrs, 200)
	if healed != 200 {
		t.Fatalf("healed=%v want 200", healed)
	}
	if got := ReadHP(attrs); got != 1200 {
		t.Fatalf("ReadHP=%v want 1200", got)
	}
}
