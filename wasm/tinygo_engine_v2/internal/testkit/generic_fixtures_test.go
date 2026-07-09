package testkit

import (
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func TestGenericFixtureResourceCooldownGateCompiles(t *testing.T) {
	fixture, err := LoadGenericFixture("generic_p0_resource_cooldown_gate.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	ability := result.Session.Abilities[0]
	if ability.Cost == nil || !ability.Cost.HasAmount {
		t.Fatal("expected compiled ability cost")
	}
	if ability.Cooldown == nil || !ability.Cooldown.HasDuration {
		t.Fatal("expected compiled ability cooldown")
	}
}

func TestGenericFixtureBasicDamageCompiles(t *testing.T) {
	fixture, err := LoadGenericFixture("generic_p0_basic_damage.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	if fixture.Phase != "run" {
		t.Fatalf("phase=%q, want run", fixture.Phase)
	}
	if fixture.ExpectedResultKind != "done" {
		t.Fatalf("expectedResultKind=%q, want done", fixture.ExpectedResultKind)
	}
	if fixture.RunRequest.DriverPlan.Entries[0].AbilityRef == "" {
		t.Fatal("runRequest.driverPlan missing abilityRef")
	}
	if fixture.RunRequest.StopPolicy.DurationMs != 100 {
		t.Fatalf("stopPolicy.durationMs=%d", fixture.RunRequest.StopPolicy.DurationMs)
	}
	wantHp := fixture.ExpectedSummarySubset["targetFinalHp"]
	if wantHp == nil {
		t.Fatal("expectedSummarySubset missing targetFinalHp")
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
}

func TestGenericFixtureTempProviderAttrShieldCompiles(t *testing.T) {
	fixture, err := LoadGenericFixture("generic_p0_temp_provider_attr_shield.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	buffProvider := result.Session.Providers[1]
	if buffProvider.ProviderKey != "status:attack_buff" {
		t.Fatalf("providerKey=%q", buffProvider.ProviderKey)
	}
	if len(buffProvider.Modifiers) != 1 {
		t.Fatalf("modifiers=%d want 1", len(buffProvider.Modifiers))
	}
	if buffProvider.Lifecycle == nil || !buffProvider.Lifecycle.HasDuration {
		t.Fatal("expected lifecycle duration")
	}
}

func TestGenericFixtureFixedTickProviderCompiles(t *testing.T) {
	fixture, err := LoadGenericFixture("generic_p0_fixed_tick_provider.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	dotProvider := result.Session.Providers[1]
	if dotProvider.Lifecycle == nil || dotProvider.Lifecycle.TickIntervalMs != 200 {
		t.Fatalf("tickIntervalMs=%v want 200", dotProvider.Lifecycle)
	}
	tickAbility := result.Session.Abilities[1]
	if tickAbility.Kind != "tick" || tickAbility.TickSpec == nil {
		t.Fatalf("expected compiled tickSpec, got kind=%q tickSpec=%+v", tickAbility.Kind, tickAbility.TickSpec)
	}
	if tickAbility.TickSpec.IntervalMs != 200 || tickAbility.TickSpec.OnTickCount != 1 {
		t.Fatalf("tickSpec=%+v", tickAbility.TickSpec)
	}
	wantHp := fixture.ExpectedSummarySubset["targetFinalHp"]
	if wantHp != float64(950) && wantHp != 950 {
		t.Fatalf("expectedSummarySubset.targetFinalHp=%v want 950", wantHp)
	}
}

func TestGenericFixtureBothDeadStopPriorityCompiles(t *testing.T) {
	fixture, err := LoadGenericFixture("generic_p0_both_dead_stop_priority.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if len(fixture.RunRequest.DriverPlan.Entries) != 2 {
		t.Fatalf("driver entries=%d want 2", len(fixture.RunRequest.DriverPlan.Entries))
	}
	if fixture.ExpectedSummarySubset["stopReason"] != "both_dead" {
		t.Fatalf("expected stopReason both_dead, got %v", fixture.ExpectedSummarySubset["stopReason"])
	}
}

func TestGenericFixtureSeriesDownsampleCompiles(t *testing.T) {
	fixture, err := LoadGenericFixture("generic_p0_series_downsample.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if fixture.RunRequest.Sampling.MaxSeriesPoints != 50 {
		t.Fatalf("maxSeriesPoints=%d want 50", fixture.RunRequest.Sampling.MaxSeriesPoints)
	}
	foundDownsampled := false
	for _, kind := range fixture.ExpectedEvidenceKinds {
		if kind == "downsampled" {
			foundDownsampled = true
		}
	}
	if !foundDownsampled {
		t.Fatal("fixture missing downsampled in expectedEvidenceKinds")
	}
}

func TestGenericFixtureMultiErrorCollectAll(t *testing.T) {
	fixture, err := LoadGenericFixture("generic_p0_compile_multi_error.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	result := compile.CompileGeneric(fixture.CompileRequest)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if len(result.Result.Errors) < 2 {
		t.Fatalf("expected >=2 errors, got %d", len(result.Result.Errors))
	}
	got := map[model.GenericErrCode]bool{}
	for _, errItem := range result.Result.Errors {
		got[errItem.Code] = true
	}
	for _, want := range fixture.ExpectedErrorCodes {
		if !got[want] {
			t.Fatalf("missing expected code %q in %+v", want, result.Result.Errors)
		}
	}
}
