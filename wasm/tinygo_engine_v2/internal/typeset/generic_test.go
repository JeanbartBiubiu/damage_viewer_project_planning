package typeset

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestCompileTypeCatalogUsesExplicitDomainAndOriginalKey(t *testing.T) {
	var failures []model.EngineError
	result := CompileTypeCatalog(model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "ability/basic_attack", Domain: "status"}, {Key: "heat", Domain: "damage"}, {Key: "heat", Domain: "attribute"}}}, func(code model.GenericErrCode, path, message, ref string) {
		failures = append(failures, model.EngineError{Code: code, Path: path})
	})
	if len(failures) != 0 {
		t.Fatal(failures)
	}
	if id, ok := result.Registry.LookupDomain("status", "ability/basic_attack"); !ok || result.Domains[id] != "status" {
		t.Fatal("key prefix changed identity")
	}
	damage, damageOK := result.Registry.LookupDomain("damage", "heat")
	attribute, attributeOK := result.Registry.LookupDomain("attribute", "heat")
	if !damageOK || !attributeOK || damage == attribute {
		t.Fatal("scoped identities merged")
	}
	if _, ok := result.Registry.Lookup("heat"); ok {
		t.Fatal("ambiguous key selected a first entry")
	}
	failures = nil
	ValidateTypeKeys([]string{"heat"}, EntityOperationDamageType, result, "damageType", func(code model.GenericErrCode, path, message, ref string) {
		failures = append(failures, model.EngineError{Code: code, Path: path})
	})
	if len(failures) != 0 {
		t.Fatal(failures)
	}
	CompileGenericMatcher(model.TypeMatcher{All: []string{"heat"}}, result, EntityListener, "matcher", func(code model.GenericErrCode, path, message, ref string) {
		failures = append(failures, model.EngineError{Code: code, Path: path})
	})
	if len(failures) != 0 {
		t.Fatal("attribute domain interfered with damage matcher", failures)
	}
	result = CompileTypeCatalog(model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "heat", Domain: "damage"}, {Key: "heat", Domain: "tag"}, {Key: "heat", Domain: "attribute"}}}, func(model.GenericErrCode, string, string, string) {})
	CompileGenericMatcher(model.TypeMatcher{All: []string{"heat"}}, result, EntityListener, "matcher", func(code model.GenericErrCode, path, message, ref string) {
		failures = append(failures, model.EngineError{Code: code, Path: path})
	})
	if len(failures) == 0 {
		t.Fatal("two permitted domains accepted an ambiguous matcher")
	}
}

func TestCompileTypeCatalogRelationDepthAndCycle(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	CompileTypeCatalog(model.TypeCatalog{
		Types: []model.TypeCatalogEntry{
			{Key: "ability/a", Domain: "ability"},
			{Key: "ability/b", Domain: "ability"},
			{Key: "ability/c", Domain: "ability"},
			{Key: "ability/d", Domain: "ability"},
		},
		Relations: []model.TypeRelation{
			{Parent: "ability/a", Child: "ability/b"},
			{Parent: "ability/b", Child: "ability/c"},
			{Parent: "ability/c", Child: "ability/d"},
			{Parent: "ability/d", Child: "ability/a"},
		},
	}, addError)
	if len(errors) == 0 {
		t.Fatal("expected relation errors")
	}
	hasDepth := false
	hasCycle := false
	for _, err := range errors {
		if err.Code == model.GenericErrMatcherDomainError {
			hasDepth = true
			hasCycle = true
		}
	}
	if !hasDepth || !hasCycle {
		t.Fatalf("errors=%+v", errors)
	}
}

func TestCompileGenericMatcherDomainErrorForListenerEntity(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Path: path, Ref: ref})
	}
	catalog := CompileTypeCatalog(model.TypeCatalog{
		Types: []model.TypeCatalogEntry{
			{Key: "event/damage_dealt", Domain: "event"},
			{Key: "status/stun", Domain: "status"},
		},
		Relations: []model.TypeRelation{},
	}, func(model.GenericErrCode, string, string, string) {})
	CompileGenericMatcher(model.TypeMatcher{Any: []string{"status/stun"}}, catalog, EntityListener, "eventMatcher", addError)
	if len(errors) == 0 || errors[0].Code != model.GenericErrMatcherDomainError {
		t.Fatalf("errors=%+v", errors)
	}
}

func TestCompileGenericMatcherAllowsMixedListenerDomains(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Path: path, Ref: ref})
	}
	catalog := CompileTypeCatalog(model.TypeCatalog{
		Types: []model.TypeCatalogEntry{
			{Key: "event/damage_instance", Domain: "event"},
			{Key: "tag/on_hit", Domain: "tag"},
			{Key: "ability/ultimate", Domain: "ability"},
			{Key: "damage/physical", Domain: "damage"},
			{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		},
		Relations: []model.TypeRelation{},
	}, func(model.GenericErrCode, string, string, string) {})
	CompileGenericMatcher(model.TypeMatcher{
		All: []string{
			"event/damage_instance",
			"ability/ultimate",
			"damage/physical",
			"damage_trait/on_hit",
		},
		Any: []string{"tag/on_hit"},
	}, catalog, EntityListener, "eventMatcher", addError)
	if len(errors) != 0 {
		t.Fatalf("unexpected errors=%+v", errors)
	}
}

func TestValidateTypeKeysDamageTraitDomain(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code, Ref: ref})
	}
	catalog := CompileTypeCatalog(model.TypeCatalog{
		Types: []model.TypeCatalogEntry{
			{Key: "damage_trait/on_hit", Domain: "damage_trait"},
			{Key: "damage/physical", Domain: "damage"},
			{Key: "ability/basic_attack", Domain: "ability"},
		},
		Relations: []model.TypeRelation{},
	}, func(model.GenericErrCode, string, string, string) {})
	ValidateTypeKeys([]string{"damage_trait/on_hit"}, EntityOperationDamageTrait, catalog, "types", addError)
	if len(errors) != 0 {
		t.Fatalf("unexpected errors=%+v", errors)
	}
	errors = nil
	ValidateTypeKeys([]string{"damage/physical"}, EntityOperationDamageTrait, catalog, "types", addError)
	if len(errors) == 0 || errors[0].Code != model.GenericErrMatcherDomainError {
		t.Fatalf("expected domain error for damage/physical, got %+v", errors)
	}
	errors = nil
	ValidateTypeKeys([]string{"ability/basic_attack"}, EntityOperationDamageTrait, catalog, "types", addError)
	if len(errors) == 0 || errors[0].Code != model.GenericErrMatcherDomainError {
		t.Fatalf("expected domain error for ability key, got %+v", errors)
	}
}

func TestCompileGenericMatcherAllowsEventDomain(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	catalog := CompileTypeCatalog(model.TypeCatalog{
		Types: []model.TypeCatalogEntry{
			{Key: "event/damage_dealt", Domain: "event"},
		},
		Relations: []model.TypeRelation{},
	}, func(model.GenericErrCode, string, string, string) {})
	CompileGenericMatcher(model.TypeMatcher{Any: []string{"event/damage_dealt"}}, catalog, EntityListener, "eventMatcher", addError)
	if len(errors) != 0 {
		t.Fatalf("unexpected errors=%+v", errors)
	}
}

func TestValidateTypeKeysAbilityDomain(t *testing.T) {
	var errors []model.EngineError
	addError := func(code model.GenericErrCode, path, message, ref string) {
		errors = append(errors, model.EngineError{Code: code})
	}
	catalog := CompileTypeCatalog(model.TypeCatalog{
		Types: []model.TypeCatalogEntry{
			{Key: "status/stun", Domain: "status"},
			{Key: "ability/basic_attack", Domain: "ability"},
		},
		Relations: []model.TypeRelation{},
	}, func(model.GenericErrCode, string, string, string) {})
	ValidateTypeKeys([]string{"status/stun"}, EntityAbility, catalog, "types", addError)
	if len(errors) == 0 || errors[0].Code != model.GenericErrMatcherDomainError {
		t.Fatalf("errors=%+v", errors)
	}
}
