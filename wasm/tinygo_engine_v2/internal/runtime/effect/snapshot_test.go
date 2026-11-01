package effect

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func snapshotFixture() (model.CombatantProviderSnapshot, planbundle.CompiledSession) {
	first, second := 0.2, 0.4
	expireAt, appliedAt := int64(100), int64(0)
	provider := planbundle.CompiledProvider{
		ProviderKey:          "finite",
		HasModifierSnapshots: true,
		Modifiers:            []planbundle.CompiledModifier{{ModifierKey: "amount", ValueReadMode: "APPLICATION_SNAPSHOT", ValuePolicy: "add"}},
		StatusContributions: []planbundle.CompiledStatusContribution{
			{ResultRef: "first", StatusKey: "slow", StatusKind: model.StatusKindMovementSlow},
			{ResultRef: "second", StatusKey: "slow", StatusKind: model.StatusKindMovementSlow},
		},
	}
	snapshot := model.CombatantProviderSnapshot{
		ProviderRef: "instance", DefinitionRef: "finite", Source: "source", Owner: "target", Stacks: 1,
		ExpireAt: &expireAt, AppliedAtMs: &appliedAt,
		State:             map[string]interface{}{"nested": map[string]interface{}{"value": 7.0}},
		ModifierSnapshots: map[string]float64{"amount": 12},
		StatusContributions: []model.ProviderStatusContributionSnapshot{
			{ResultRef: "second", StatusKey: "slow", StatusKind: model.StatusKindMovementSlow, Strength: &second},
			{ResultRef: "first", StatusKey: "slow", StatusKind: model.StatusKindMovementSlow, Strength: &first},
		},
	}
	return snapshot, planbundle.CompiledSession{Providers: []planbundle.CompiledProvider{provider}}
}

func TestProviderSnapshotRestoreAndExportOwnNestedValues(t *testing.T) {
	snapshot, compiled := snapshotFixture()
	providers, resolver, err := RestoreProviders([]model.CombatantProviderSnapshot{snapshot}, "target", compiled,
		map[string]bool{"source": true, "target": true}, "initial.combatants.target", "schema", "rules", "session")
	if err != nil || providers.Len() != 1 || resolver.MountedModifiers().Len() != 0 {
		t.Fatalf("restore or deferred remount changed: %v", err)
	}
	snapshot.State["nested"].(map[string]interface{})["value"] = 99.0
	snapshot.ModifierSnapshots["amount"] = 99
	*snapshot.StatusContributions[0].Strength = 0.9
	*snapshot.AppliedAtMs = 99

	assertSnapshot := func(row model.CombatantProviderSnapshot) {
		t.Helper()
		if row.Source != "source" || row.Owner != "target" || row.ProviderRef != "instance" || row.DefinitionRef != "finite" || row.Stacks != 1 || row.ExpireAt == nil || *row.ExpireAt != 100 || row.AppliedAtMs == nil || *row.AppliedAtMs != 0 {
			t.Fatalf("effect identity or timing changed: %+v", row)
		}
		if row.State["nested"].(map[string]interface{})["value"] != 7.0 || row.ModifierSnapshots["amount"] != 12 || len(row.StatusContributions) != 2 || row.StatusContributions[0].ResultRef != "second" || *row.StatusContributions[0].Strength != 0.4 || row.StatusContributions[1].ResultRef != "first" || *row.StatusContributions[1].Strength != 0.2 {
			t.Fatalf("snapshot aliases input or reordered contributions: %+v", row)
		}
	}
	output := ProvidersToSnapshot(providers)
	assertSnapshot(output[0])
	output[0].State["nested"].(map[string]interface{})["value"] = 88.0
	output[0].ModifierSnapshots["amount"] = 88
	*output[0].StatusContributions[0].Strength = 0.8
	*output[0].AppliedAtMs = 88
	*output[0].ExpireAt = 88
	assertSnapshot(ProvidersToSnapshot(providers)[0])
}

func TestProviderSnapshotRestoreKeepsErrorIdentityAndLocation(t *testing.T) {
	tests := []struct {
		name, field string
		code        model.GenericErrCode
		change      func(*model.CombatantProviderSnapshot)
	}{
		{"incomplete contributions", ".statusContributions", model.GenericErrMissingRequiredField, func(row *model.CombatantProviderSnapshot) { row.StatusContributions = row.StatusContributions[:1] }},
		{"wrong contribution identity", ".statusContributions[1].statusKey", model.GenericErrUnknownRef, func(row *model.CombatantProviderSnapshot) { row.StatusContributions[1].StatusKey = "other" }},
		{"missing frozen amount", ".modifierSnapshots", model.GenericErrRuntimeInvariantFailed, func(row *model.CombatantProviderSnapshot) { delete(row.ModifierSnapshots, "amount") }},
		{"unknown complete definition", ".definitionRef", model.GenericErrUnknownRef, func(row *model.CombatantProviderSnapshot) { row.DefinitionRef = "unknown" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			snapshot, compiled := snapshotFixture()
			tc.change(&snapshot)
			_, _, err := RestoreProviders([]model.CombatantProviderSnapshot{snapshot}, "target", compiled,
				map[string]bool{"source": true, "target": true}, "initial.target", "schema", "rules", "session")
			if err == nil || err.Phase != model.GenericPhaseRun || err.Code != tc.code || err.Path != "initial.target.providers[0]"+tc.field || err.SchemaHash != "schema" || err.RulesHash != "rules" || err.SessionID != "session" {
				t.Fatalf("error contract changed: %+v", err)
			}
		})
	}
}

func TestSnapshotEmptyShapesAndShieldRestoreRemainIndependent(t *testing.T) {
	if RestoreShields(nil, "target").Present() || RestoreShields([]model.CombatantShieldSnapshot{{Remaining: 0}}, "target").Present() {
		t.Fatal("absent or exhausted shield became a present collection")
	}
	if value := ShieldsToSnapshot(ShieldList{}); value == nil || len(value) != 0 {
		t.Fatal("shield snapshot must retain its explicit empty list")
	}
	if value := ProvidersToSnapshot(ProviderList{}); value == nil || len(value) != 0 {
		t.Fatal("provider snapshot must retain its explicit empty list")
	}
	expires := int64(100)
	raw := []model.CombatantShieldSnapshot{{Remaining: 0}, {DefinitionRef: "shield", LifecycleProviderRef: "parent", Remaining: 30, Priority: 2, ExpireAt: &expires, State: map[string]interface{}{"nested": map[string]interface{}{"value": 4.0}}}}
	shields := RestoreShields(raw, "target")
	raw[1].State["nested"].(map[string]interface{})["value"] = 99.0
	output := ShieldsToSnapshot(shields)
	if len(output) != 1 || output[0].ShieldRef != "shield#2" || output[0].Source != "target" || output[0].Owner != "target" || output[0].LifecycleProviderRef != "parent" || output[0].Remaining != 30 || output[0].Priority != 2 || output[0].ExpireAt == nil || *output[0].ExpireAt != 100 || output[0].State["nested"].(map[string]interface{})["value"] != 4.0 {
		t.Fatalf("shield restore lost source order, fallback or nested state: %+v", output)
	}
	output[0].State["nested"].(map[string]interface{})["value"] = 77.0
	*output[0].ExpireAt = 77
	if next := ShieldsToSnapshot(shields)[0]; next.State["nested"].(map[string]interface{})["value"] != 4.0 || *next.ExpireAt != 100 {
		t.Fatal("shield export reached effect-owned state")
	}
}
