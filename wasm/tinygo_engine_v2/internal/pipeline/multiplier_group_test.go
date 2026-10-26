package pipeline

import (
	"math"
	"testing"
)

func TestAmplificationGroupsZeroIdentityAndIndependentScopes(t *testing.T) {
	groups := NewAmplificationGroups(4)
	for _, item := range []struct {
		id    uint16
		value float64
	}{{0, 1.2}, {0, 1.3}, {2, 1.1}, {0, 1}} {
		if err := groups.Add(item.id, item.value); err != nil {
			t.Fatal(err)
		}
	}
	factor, err := groups.Product()
	if err != nil || math.Abs(factor-1.65) > 1e-12 {
		t.Fatal(factor, err)
	}
	other := NewAmplificationGroups(1)
	if err := other.Add(0, 1.1); err != nil {
		t.Fatal(err)
	}
	if groups.Factor(0) != 1.5 || other.Factor(0) != 1.1 {
		t.Fatal("scopes shared writable factors")
	}
}

func TestAmplificationGroupsRejectInvalidMembersAndOverflow(t *testing.T) {
	for _, value := range []float64{0.8, -1, math.NaN(), math.Inf(1)} {
		g := NewAmplificationGroups(1)
		if err := g.Add(0, value); err == nil {
			t.Fatal("invalid amplification accepted", value)
		}
	}
	g := NewAmplificationGroups(2)
	if err := g.Add(0, math.MaxFloat64); err != nil {
		t.Fatal(err)
	}
	if err := g.Add(0, math.MaxFloat64); err == nil {
		t.Fatal("group sum overflow accepted")
	}
	if err := g.Add(1, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Product(); err == nil {
		t.Fatal("group product overflow accepted")
	}
}
