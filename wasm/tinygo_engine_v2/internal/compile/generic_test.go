package compile

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCompileGenericBasicDamage(t *testing.T) {
	req := loadGenericFixtureCompileRequest(t, "generic_p0_basic_damage.json")
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("expected compile ok, errors=%v", result.Result.Errors)
	}
	if result.Session.Abilities[0].AbilityKey != "basic_attack" {
		t.Fatalf("ability key %q", result.Session.Abilities[0].AbilityKey)
	}
	if result.Session.Abilities[0].ProviderIndex != 0 {
		t.Fatalf("provider index %d, want 0", result.Session.Abilities[0].ProviderIndex)
	}
	ref := "source.provider[champion:source_demo].ability[basic_attack]"
	compiledRef, ok := result.Session.AbilityRefIndex[ref]
	if !ok {
		t.Fatalf("missing ability ref index for %s", ref)
	}
	if compiledRef.CombatantIndex != 0 || compiledRef.AbilityIndex != 0 {
		t.Fatalf("unexpected ability ref %+v", compiledRef)
	}
	if result.Result.Metadata == nil || result.Result.Metadata.AbilityCount != 1 {
		t.Fatalf("metadata %+v", result.Result.Metadata)
	}
}

func TestCompileGenericMultiErrorCollectAll(t *testing.T) {
	req := loadGenericFixtureCompileRequest(t, "generic_p0_compile_multi_error.json")
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if len(result.Result.Errors) < 2 {
		t.Fatalf("expected at least 2 errors, got %d: %+v", len(result.Result.Errors), result.Result.Errors)
	}
	codes := errorCodes(result.Result.Errors)
	for _, want := range []model.GenericErrCode{
		model.GenericErrUnknownTypeKey,
		model.GenericErrFormulaTypeError,
		model.GenericErrHPRawSetForbidden,
		model.GenericErrUnknownRef,
		model.GenericErrMatcherDomainError,
	} {
		if !slices.Contains(codes, want) {
			t.Fatalf("missing error code %q in %+v", want, codes)
		}
	}
}

func TestCompileGenericSchemaVersionUnsupported(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SchemaVersion = "generic-p99"
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrSchemaVersionUnsupported) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericUnknownAbilityRefFormats(t *testing.T) {
	req := minimalValidCompileRequest()
	req.Rules.Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "bad_listener",
			EventMatcher: model.TypeMatcher{Any: []string{"event/damage_dealt"}},
			AbilityRef:   "basic_attack",
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for bare abilityKey")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericMatcherDomainErrorForListener(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/damage_dealt", Domain: "event"},
		model.TypeCatalogEntry{Key: "status/stun", Domain: "status"},
	)
	req.Rules.Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "bad_domain_listener",
			EventMatcher: model.TypeMatcher{Any: []string{"status/stun"}},
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for matcher domain error")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMatcherDomainError) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericSettingCappedWarning(t *testing.T) {
	req := minimalValidCompileRequest()
	req.Settings.MaxEvents = 200000
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("expected compile ok, errors=%+v", result.Result.Errors)
	}
	if len(result.Result.Errors) != 0 {
		t.Fatalf("expected no errors, got %+v", result.Result.Errors)
	}
	if len(result.Result.Warnings) == 0 {
		t.Fatal("expected compile_setting_capped warning")
	}
	found := false
	for _, w := range result.Result.Warnings {
		if w.Code == string(model.WarningCodeCompileSettingCapped) {
			found = true
			if w.Severity != model.WarningSeverityWarning {
				t.Fatalf("severity=%q", w.Severity)
			}
		}
	}
	if !found {
		t.Fatalf("warnings=%+v", result.Result.Warnings)
	}
	if result.Session.Settings.MaxEvents != defaultGenericMaxEvents {
		t.Fatalf("maxEvents=%d, want %d", result.Session.Settings.MaxEvents, defaultGenericMaxEvents)
	}
}

func TestCompileGenericAbilityRefUnknownProvider(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/damage_dealt", Domain: "event"},
	)
	req.Rules.Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "bad_provider_listener",
			EventMatcher: model.TypeMatcher{Any: []string{"event/damage_dealt"}},
			AbilityRef:   "source.provider[champion:missing].ability[basic_attack]",
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericAbilityRefUnknownAbilityKey(t *testing.T) {
	req := minimalValidCompileRequest()
	req.Rules.Operations = []model.OperationDefinition{
		{
			Operation:  "cooldown_change",
			Target:     "source",
			AbilityRef: "source.provider[champion:source_demo].ability[no_such_ability]",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: floatPtr(0)},
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func floatPtr(v float64) *float64 {
	return &v
}

func TestCompileGenericMatcherNoClosureExpansion(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "ability/melee", Domain: "ability"},
	)
	req.TypeCatalog.Relations = []model.TypeRelation{
		{Parent: "ability/basic_attack", Child: "ability/melee"},
	}
	req.SharedProviders[0].Abilities[0].Types = []string{"ability/melee"}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	set := result.Session.Abilities[0].TypeSet
	parentID, _ := result.Session.Types.Registry.Lookup("ability/basic_attack")
	childID, _ := result.Session.Types.Registry.Lookup("ability/melee")
	if set.Contains(parentID) {
		t.Fatal("parent type should not be implicitly added")
	}
	if !set.Contains(childID) {
		t.Fatal("explicit child type should be present")
	}
}

func TestParseAbilityRefCanonical(t *testing.T) {
	ref, ok := ParseAbilityRef("source.provider[champion:ashe].ability[basic_attack]")
	if !ok {
		t.Fatal("expected parse ok")
	}
	if ref.Combatant != "source" || ref.ProviderRef != "champion:ashe" || ref.AbilityKey != "basic_attack" {
		t.Fatalf("parsed %+v", ref)
	}
	if _, ok := ParseAbilityRef("champion:ashe::basic_attack"); ok {
		t.Fatal("expected reject :: form")
	}
}

func minimalValidCompileRequest() model.CompileRequest {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		panic("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "testkit", "fixtures", "generic_p0_basic_damage.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		panic(err)
	}
	return fixture.CompileRequest
}

func loadGenericFixtureCompileRequest(t *testing.T, name string) model.CompileRequest {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "testkit", "fixtures", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		CompileRequest model.CompileRequest `json:"compileRequest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	return fixture.CompileRequest
}

func errorCodes(errors []model.EngineError) []model.GenericErrCode {
	out := make([]model.GenericErrCode, 0, len(errors))
	for _, err := range errors {
		out = append(out, err.Code)
	}
	return out
}

func hasErrorCode(errors []model.EngineError, code model.GenericErrCode) bool {
	return slices.Contains(errorCodes(errors), code)
}

func TestCompileGenericFixedTickProvider(t *testing.T) {
	req := loadGenericFixtureCompileRequest(t, "generic_p0_fixed_tick_provider.json")
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("expected compile ok, errors=%v", result.Result.Errors)
	}
	tickAbility := result.Session.Abilities[1]
	if tickAbility.Kind != "tick" {
		t.Fatalf("kind=%q want tick", tickAbility.Kind)
	}
	if tickAbility.TickSpec == nil || tickAbility.TickSpec.IntervalMs != 200 {
		t.Fatalf("tickSpec=%+v", tickAbility.TickSpec)
	}
	if tickAbility.TickSpec.StartDelayMs != 200 {
		t.Fatalf("startDelayMs=%d want 200 (default=intervalMs)", tickAbility.TickSpec.StartDelayMs)
	}
}

func TestCompileGenericTickAbilityRequiresTickSpec(t *testing.T) {
	req := loadGenericFixtureCompileRequest(t, "generic_p0_fixed_tick_provider.json")
	req.SharedProviders[1].Abilities[0].TickSpec = nil
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for tick ability without tickSpec")
	}
}

func TestCompileGenericOperationConditionAndStateChange(t *testing.T) {
	req := minimalValidCompileRequest()
	one := 1.0
	three := 3.0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "hits",
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			Condition: &model.GenericFormulaExpr{
				Op: "gte",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "provider.target_state.hits"},
					{Op: "const", Value: &three},
				},
			},
		},
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	ops := result.Session.Operations
	if len(ops) < 2 {
		t.Fatalf("ops=%d", len(ops))
	}
	if ops[0].Operation != "state_change" || ops[0].StateScope != "state_scope/provider_target" {
		t.Fatalf("op0=%+v", ops[0])
	}
	if !ops[1].HasCondition {
		t.Fatal("expected HasCondition on damage op")
	}
}

func TestCompileGenericStateChangeRejectsUnsupportedScope(t *testing.T) {
	req := minimalValidCompileRequest()
	one := 1.0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         "hits",
			Types:       []string{"state_scope/unknown"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownTypeKey) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericStateChangeRejectsNonOwnerTarget(t *testing.T) {
	one := 1.0
	for _, target := range []string{"target", "opponent"} {
		req := minimalValidCompileRequest()
		req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      target,
				Ref:         "hits",
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		}
		result := CompileGeneric(req)
		if result.OK {
			t.Fatalf("target=%s: expected compile failure", target)
		}
		if !hasErrorCode(result.Result.Errors, model.GenericErrOperationTargetMissing) {
			t.Fatalf("target=%s errors=%+v", target, result.Result.Errors)
		}
	}
}

func TestCompileGenericStateChangeAcceptsSourceAndSelf(t *testing.T) {
	one := 1.0
	for _, target := range []string{"source", "self"} {
		req := minimalValidCompileRequest()
		req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      target,
				Ref:         "hits",
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		}
		result := CompileGeneric(req)
		if !result.OK {
			t.Fatalf("target=%s compile failed: %+v", target, result.Result.Errors)
		}
	}
}

func TestCompileGenericRejectsUnknownDamageSettlementType(t *testing.T) {
	req := minimalValidCompileRequest()
	req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: "damage/chaos", Domain: "damage"})
	one := 1.0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/chaos",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for unknown damage settlement type")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownTypeKey) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
	found := false
	for _, err := range result.Result.Errors {
		if err.Code == model.GenericErrUnknownTypeKey && err.Ref == "damage/chaos" &&
			(err.Message == "unknown damage settlement type" || err.Path != "") {
			if err.Message == "unknown damage settlement type" {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("expected settlement-type reject, errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericInitialStateSchemaLegacyNumeric(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": float64(0),
		"marker": float64(2),
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	fields := result.Session.Providers[0].StateFields
	if fields["stacks"].DefaultValue != 0 || fields["stacks"].HasCap || fields["stacks"].DurationMs != 0 {
		t.Fatalf("stacks field=%+v", fields["stacks"])
	}
	if fields["marker"].DefaultValue != 2 || fields["marker"].HasCap {
		t.Fatalf("marker field=%+v", fields["marker"])
	}
}

func TestCompileGenericInitialStateSchemaStructuredSuccess(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(3000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	field := result.Session.Providers[0].StateFields["stacks"]
	if field.DefaultValue != 0 || field.MaxValue != 4 || !field.HasCap || field.DurationMs != 3000 {
		t.Fatalf("field=%+v", field)
	}
	if field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%q", field.RefreshPolicy)
	}
}

func TestCompileGenericInitialStateSchemaUntimedCappedSuccess(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"charge": map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(100),
			"durationMs":   float64(0),
		},
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	field := result.Session.Providers[0].StateFields["charge"]
	if field.DefaultValue != 0 || field.MaxValue != 100 || !field.HasCap || field.DurationMs != 0 {
		t.Fatalf("field=%+v", field)
	}
	if field.RefreshPolicy != "" {
		t.Fatalf("refreshPolicy=%q want empty for untimed", field.RefreshPolicy)
	}
}

func TestCompileGenericInitialStateSchemaCollectAllErrors(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"bad_max": map[string]interface{}{
			"defaultValue":  float64(3),
			"maxValue":      float64(1),
			"durationMs":    float64(1000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
		"bad_duration": map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(4),
			"durationMs":   float64(-1),
		},
		"bad_duration0_refresh": map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(0),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
		"bad_policy": map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(1000),
			"refreshPolicy": "extend",
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure")
	}
	if len(result.Result.Errors) < 4 {
		t.Fatalf("expected collect-all >=4 errors, got %d: %+v", len(result.Result.Errors), result.Result.Errors)
	}
	var sawMax, sawDuration, sawDuration0Refresh, sawPolicy bool
	for _, err := range result.Result.Errors {
		switch {
		case err.Path != "" && containsPath(err.Path, "bad_max") && containsPath(err.Message, "maxValue"):
			sawMax = true
		case err.Path != "" && containsPath(err.Path, "bad_duration") && !containsPath(err.Path, "bad_duration0_refresh") && containsPath(err.Message, "durationMs"):
			sawDuration = true
		case err.Path != "" && containsPath(err.Path, "bad_duration0_refresh") && containsPath(err.Message, "refresh_on_write"):
			sawDuration0Refresh = true
		case err.Path != "" && containsPath(err.Path, "bad_policy"):
			sawPolicy = true
		}
	}
	if !sawMax || !sawDuration || !sawDuration0Refresh || !sawPolicy {
		t.Fatalf("missing expected errors max=%v duration=%v duration0_refresh=%v policy=%v errors=%+v",
			sawMax, sawDuration, sawDuration0Refresh, sawPolicy, result.Result.Errors)
	}
}

func validRepeatOperation() model.OperationDefinition {
	return model.OperationDefinition{
		Operation:       model.OperationKindRepeat,
		RepeatScope:     model.RepeatScopeCopyableOnHit,
		RepeatCount:     1,
		RepeatTag:       "phantom_hit",
		TriggerStateKey: "stacks",
		Threshold:       4,
	}
}

func withProviderStacksSchema(req *model.CompileRequest) {
	req.SharedProviders[0].InitialStateSchema = map[string]interface{}{
		"stacks": float64(0),
	}
}

func TestCompileGenericDamageCopyableProjects(t *testing.T) {
	req := minimalValidCompileRequest()
	one := 1.0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/physical",
			Amount:        &model.GenericFormulaExpr{Op: "const", Value: &one},
			CopyableOnHit: true,
		},
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	op := result.Session.Operations[0]
	if op.Operation != "damage" || !op.CopyableOnHit {
		t.Fatalf("op=%+v", op)
	}
}

func TestCompileGenericDamageCritEligibleProjects(t *testing.T) {
	req := minimalValidCompileRequest()
	one := 1.0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &one},
			CritEligible: true,
		},
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	op := result.Session.Operations[0]
	if op.Operation != "damage" || !op.CritEligible {
		t.Fatalf("op=%+v", op)
	}
}

func TestCompileGenericCopyableRejectsNonDamage(t *testing.T) {
	req := minimalValidCompileRequest()
	one := 1.0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:     "heal",
			Target:        "source",
			Amount:        &model.GenericFormulaExpr{Op: "const", Value: &one},
			CopyableOnHit: true,
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for copyableOnHit on non-damage")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMissingRequiredField) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
	found := false
	for _, err := range result.Result.Errors {
		if containsPath(err.Path, "copyableOnHit") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected copyableOnHit path error, errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericCritEligibleRejectsNonDamage(t *testing.T) {
	req := minimalValidCompileRequest()
	one := 1.0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:    "heal",
			Target:       "source",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &one},
			CritEligible: true,
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected compile failure for critEligible on non-damage")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrMissingRequiredField) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
	found := false
	for _, err := range result.Result.Errors {
		if containsPath(err.Path, "critEligible") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected critEligible path error, errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatProjects(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{validRepeatOperation()}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	op := result.Session.Operations[0]
	if op.Operation != model.OperationKindRepeat {
		t.Fatalf("operation=%q", op.Operation)
	}
	if op.RepeatScope != model.RepeatScopeCopyableOnHit || op.RepeatCount != 1 || op.RepeatTag != "phantom_hit" {
		t.Fatalf("repeat fields scope/count/tag=%q/%d/%q", op.RepeatScope, op.RepeatCount, op.RepeatTag)
	}
	if op.TriggerStateKey != "stacks" || op.Threshold != 4 {
		t.Fatalf("trigger/threshold=%q/%v", op.TriggerStateKey, op.Threshold)
	}
	if op.RepeatDelayMs != 0 {
		t.Fatalf("expected omitted repeatDelayMs to project as 0, got %d", op.RepeatDelayMs)
	}
	if op.Target != "" {
		t.Fatalf("expected empty target, got %q", op.Target)
	}
}

func TestCompileGenericRepeatProjectsPositiveDelay(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.RepeatDelayMs = 200
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	if result.Session.Operations[0].RepeatDelayMs != 200 {
		t.Fatalf("RepeatDelayMs=%d want 200", result.Session.Operations[0].RepeatDelayMs)
	}
}

func TestCompileGenericRepeatRejectsNegativeDelay(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.RepeatDelayMs = -1
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorPath(result.Result.Errors, "repeatDelayMs") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatDelayRejectsNonRepeat(t *testing.T) {
	req := minimalValidCompileRequest()
	one := 1.0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/physical",
			Amount:        &model.GenericFormulaExpr{Op: "const", Value: &one},
			RepeatDelayMs: 200,
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorPath(result.Result.Errors, "repeatDelayMs") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatRejectsInvalidScope(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.RepeatScope = "all_damage"
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorPath(result.Result.Errors, "repeatScope") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatRejectsInvalidCount(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.RepeatCount = 2
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorPath(result.Result.Errors, "repeatCount") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatRejectsEmptyTag(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.RepeatTag = ""
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorPath(result.Result.Errors, "repeatTag") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatRejectsEmptyStateKey(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.TriggerStateKey = ""
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorPath(result.Result.Errors, "triggerStateKey") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatRejectsNonPositiveThreshold(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.Threshold = 0
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorPath(result.Result.Errors, "threshold") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatRejectsUnknownStateKey(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.TriggerStateKey = "missing_stacks"
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	if !hasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
	if !hasErrorPath(result.Result.Errors, "triggerStateKey") {
		t.Fatalf("errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatRejectsRulesWithoutProviderContext(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	req.Rules.Operations = []model.OperationDefinition{validRepeatOperation()}
	req.SharedProviders[0].Abilities[0].Operations = nil
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure for rules repeat without provider context")
	}
	found := false
	for _, err := range result.Result.Errors {
		if containsPath(err.Message, "owning provider context") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected provider context error, errors=%+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatAllowsEmptyTarget(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	op := validRepeatOperation()
	op.Target = ""
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
}

func TestCompileGenericRepeatCollectAllFieldErrors(t *testing.T) {
	req := minimalValidCompileRequest()
	withProviderStacksSchema(&req)
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:       model.OperationKindRepeat,
			RepeatScope:     "other",
			RepeatCount:     0,
			RepeatTag:       "",
			TriggerStateKey: "",
			Threshold:       -1,
		},
	}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	for _, needle := range []string{"repeatScope", "repeatCount", "repeatTag", "triggerStateKey", "threshold"} {
		if !hasErrorPath(result.Result.Errors, needle) {
			t.Fatalf("missing %s error in %+v", needle, result.Result.Errors)
		}
	}
}

func validExecuteThresholdOperation() model.OperationDefinition {
	return model.OperationDefinition{
		Operation: model.OperationKindExecuteThreshold,
		Target:    model.SelectorOpponent,
		Threshold: 0.05,
		Ref:       "op:collector_execute",
	}
}

func TestCompileGenericExecuteThresholdProjects(t *testing.T) {
	req := minimalValidCompileRequest()
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{validExecuteThresholdOperation()}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	op := result.Session.Operations[0]
	if op.Operation != model.OperationKindExecuteThreshold {
		t.Fatalf("operation=%q", op.Operation)
	}
	if op.Target != model.SelectorOpponent || op.Threshold != 0.05 || op.Ref != "op:collector_execute" {
		t.Fatalf("op=%+v", op)
	}
	if op.HasAmount || op.CopyableOnHit || op.RepeatScope != "" {
		t.Fatalf("unexpected forbidden projections: %+v", op)
	}
}

func TestCompileGenericExecuteThresholdRejectsInvalidThreshold(t *testing.T) {
	cases := []struct {
		name      string
		threshold float64
	}{
		{"zero", 0},
		{"negative", -0.1},
		{"above_one", 1.01},
		{"nan", math.NaN()},
		{"pos_inf", math.Inf(1)},
		{"neg_inf", math.Inf(-1)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := minimalValidCompileRequest()
			op := validExecuteThresholdOperation()
			op.Threshold = tc.threshold
			req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
			result := CompileGeneric(req)
			if result.OK {
				t.Fatal("expected failure")
			}
			if !hasErrorPath(result.Result.Errors, "threshold") {
				t.Fatalf("missing threshold error: %+v", result.Result.Errors)
			}
		})
	}
}

func TestCompileGenericExecuteThresholdCollectAllForbiddenFields(t *testing.T) {
	req := minimalValidCompileRequest()
	one := 1.0
	op := model.OperationDefinition{
		Operation:             model.OperationKindExecuteThreshold,
		Target:                model.SelectorTarget,
		Threshold:             0.05,
		Ref:                   "op:execute",
		Amount:                &model.GenericFormulaExpr{Op: "const", Value: &one},
		DamageType:            "damage/physical",
		ValuePolicy:           "add",
		ResourceKey:           "mana",
		AttributeKey:          "ad",
		AbilityRef:            "source.provider[x].ability[y]",
		ShieldRef:             "shield:x",
		ProviderDefinitionRef: "provider:x",
		ProviderRef:           "provider:y",
		EventType:             "event/basic_attack_hit",
		Payload:               map[string]interface{}{"k": "v"},
		Types:                 []string{"tag/x"},
		Tags:                  []string{"t"},
		Condition:             &model.GenericFormulaExpr{Op: "const", Value: &one},
		CopyableOnHit:         true,
		CritEligible:          true,
		RepeatScope:           model.RepeatScopeCopyableOnHit,
		RepeatCount:           1,
		RepeatTag:             "phantom",
		TriggerStateKey:       "stacks",
	}
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{op}
	result := CompileGeneric(req)
	if result.OK {
		t.Fatal("expected failure")
	}
	needles := []string{
		"amount", "damageType", "valuePolicy", "resourceKey", "attributeKey",
		"abilityRef", "shieldRef", "providerDefinitionRef", "providerRef", "eventType",
		"payload", "types", "tags", "condition", "copyableOnHit", "critEligible",
		"repeatScope", "repeatCount", "repeatTag", "triggerStateKey",
	}
	for _, needle := range needles {
		if !hasErrorPath(result.Result.Errors, needle) {
			t.Fatalf("missing %s error in %+v", needle, result.Result.Errors)
		}
	}
}

func hasErrorPath(errors []model.EngineError, needle string) bool {
	for _, err := range errors {
		if containsPath(err.Path, needle) {
			return true
		}
	}
	return false
}

func containsPath(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexString(s, sub) >= 0)
}
