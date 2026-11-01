package report

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestEffectiveStatusProjectionRespectsExactExpiryAndContributionOrder(t *testing.T) {
	expiredAt, activeUntil := int64(10), int64(20)
	weak, strong, expired := 0.2, 0.5, 0.9
	instances := []model.CombatantProviderSnapshot{
		{ProviderRef: "expired", Owner: "target", ExpireAt: &expiredAt, StatusContributions: []model.ProviderStatusContributionSnapshot{{ResultRef: "old", StatusKind: model.StatusKindMovementSlow, Strength: &expired}}},
		{ProviderRef: "first", Owner: "target", ExpireAt: &activeUntil, StatusContributions: []model.ProviderStatusContributionSnapshot{{ResultRef: "weak", StatusKey: "slow", StatusKind: model.StatusKindMovementSlow, Strength: &weak}}},
		{ProviderRef: "second", Source: "source", Owner: "target", ExpireAt: &activeUntil, StatusContributions: []model.ProviderStatusContributionSnapshot{{ResultRef: "strong", StatusKey: "slow", StatusKind: model.StatusKindMovementSlow, Strength: &strong}}},
	}
	output := BuildEffectiveStatuses(instances, 10)
	if len(output) != 1 || output[0].StatusKind != model.StatusKindMovementSlow || output[0].Strength != 0.5 || len(output[0].Contributions) != 2 {
		t.Fatalf("expired effect remained active or strongest contribution changed: %+v", output)
	}
	first, second := output[0].Contributions[0], output[0].Contributions[1]
	if first.ProviderRef != "first" || first.Source != "target" || first.ResultRef != "weak" || first.Strength != 0.2 || first.ExpireAt != 20 || second.ProviderRef != "second" || second.Source != "source" || second.ResultRef != "strong" {
		t.Fatalf("contribution order or source fallback changed: %+v", output[0].Contributions)
	}
	weak, strong = 0.7, 0.8
	if output[0].Strength != 0.5 || output[0].Contributions[0].Strength != 0.2 {
		t.Fatal("effective status output retained mutable snapshot pointers")
	}
	if final := BuildEffectiveStatuses(instances, 20); final == nil || len(final) != 0 {
		t.Fatalf("exact expiry must retain an explicit empty result: %+v", final)
	}
}
