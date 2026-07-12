package compile

import (
	"encoding/json"
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
	)
	req.Rules.Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "bad_domain_listener",
			EventMatcher: model.TypeMatcher{Any: []string{"ability/basic_attack"}},
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
