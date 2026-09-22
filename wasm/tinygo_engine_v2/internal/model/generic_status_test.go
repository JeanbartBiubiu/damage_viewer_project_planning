package model

import (
	"encoding/json"
	"testing"
)

func TestProviderStatusContributionStrengthZeroIsNotMissing(t *testing.T) {
	var zero ProviderStatusContributionSnapshot
	if err := json.Unmarshal([]byte(`{"resultRef":"r","statusKey":"k","statusKind":"movement_slow","strength":0}`), &zero); err != nil {
		t.Fatal(err)
	}
	if zero.Strength == nil || *zero.Strength != 0 {
		t.Fatalf("JSON 0 must be explicit: %+v", zero)
	}
	var missing ProviderStatusContributionSnapshot
	if err := json.Unmarshal([]byte(`{"resultRef":"r","statusKey":"k","statusKind":"movement_slow"}`), &missing); err != nil {
		t.Fatal(err)
	}
	if missing.Strength != nil {
		t.Fatalf("missing strength must stay nil: %+v", missing)
	}
}
