package typeset

import (
	"strconv"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestRegistryInternLookupAndLimit(t *testing.T) {
	registry := NewRegistry()
	first, ok := registry.Intern("type_0")
	if !ok {
		t.Fatal("first intern failed")
	}
	again, ok := registry.Intern("type_0")
	if !ok || again != first {
		t.Fatalf("duplicate intern = (%d,%v), want (%d,true)", again, ok, first)
	}

	for i := 1; i < MaxTypes; i++ {
		if _, ok := registry.Intern("type_" + strconv.Itoa(i)); !ok {
			t.Fatalf("intern %d failed before limit", i)
		}
	}
	if _, ok := registry.Intern("overflow"); ok {
		t.Fatal("overflow intern succeeded")
	}
	if got, ok := registry.Lookup("type_0"); !ok || got != first {
		t.Fatalf("lookup = (%d,%v), want (%d,true)", got, ok, first)
	}
	if len(registry.Keys) != MaxTypes || registry.Keys[first] != "type_0" {
		t.Fatalf("registry keys not kept in id order")
	}
}

func TestTypeSetContainsAllIntersectsAndBounds(t *testing.T) {
	registry := NewRegistry()
	fire, _ := registry.Intern("fire")
	ice, _ := registry.Intern("ice")
	arcane, _ := registry.Intern("arcane")

	var full TypeSet
	if !full.Empty() {
		t.Fatal("zero set should be empty")
	}
	full.Add(fire)
	full.Add(ice)
	full.Add(TypeID(MaxTypes))

	var fireOnly TypeSet
	fireOnly.Add(fire)
	var arcaneOnly TypeSet
	arcaneOnly.Add(arcane)

	if !full.Contains(fire) || !full.Contains(ice) {
		t.Fatal("set should contain added ids")
	}
	if full.Contains(TypeID(MaxTypes)) {
		t.Fatal("out-of-range id should not be contained")
	}
	if !full.ContainsAll(fireOnly) {
		t.Fatal("full should contain fireOnly")
	}
	if fireOnly.ContainsAll(full) {
		t.Fatal("fireOnly should not contain full")
	}
	if !full.Intersects(fireOnly) {
		t.Fatal("full should intersect fireOnly")
	}
	if full.Intersects(arcaneOnly) {
		t.Fatal("full should not intersect arcaneOnly")
	}
}

func TestMatcherAnyAllNone(t *testing.T) {
	registry := NewRegistry()
	fire, _ := registry.Intern("fire")
	spell, _ := registry.Intern("spell")
	blocked, _ := registry.Intern("blocked")

	matcher, problems := CompileMatcher(model.TypeMatcherV2{
		Any:  []string{"fire"},
		All:  []string{"spell"},
		None: []string{"blocked"},
	}, registry)
	if len(problems) != 0 {
		t.Fatalf("compile problems: %v", problems)
	}

	var candidate TypeSet
	candidate.Add(fire)
	candidate.Add(spell)
	if !matcher.Match(candidate) {
		t.Fatal("fire+spell should match")
	}

	var missingAny TypeSet
	missingAny.Add(spell)
	if matcher.Match(missingAny) {
		t.Fatal("missing any type should not match")
	}

	var missingAll TypeSet
	missingAll.Add(fire)
	if matcher.Match(missingAll) {
		t.Fatal("missing all type should not match")
	}

	candidate.Add(blocked)
	if matcher.Match(candidate) {
		t.Fatal("blocked type should not match")
	}
}

func TestMatcherEmptyMatchesAnySet(t *testing.T) {
	registry := NewRegistry()
	fire, _ := registry.Intern("fire")

	matcher, problems := CompileMatcher(model.TypeMatcherV2{}, registry)
	if len(problems) != 0 {
		t.Fatalf("compile problems: %v", problems)
	}

	if !matcher.Match(TypeSet{}) {
		t.Fatal("empty matcher should match empty set")
	}
	var candidate TypeSet
	candidate.Add(fire)
	if !matcher.Match(candidate) {
		t.Fatal("empty matcher should match non-empty set")
	}
}

func TestCompileMatcherCollectsUnknownTypesAndContinues(t *testing.T) {
	registry := NewRegistry()
	fire, _ := registry.Intern("fire")
	blocked, _ := registry.Intern("blocked")

	matcher, problems := CompileMatcher(model.TypeMatcherV2{
		Any:  []string{"missing_any", "fire"},
		None: []string{"missing_none", "blocked"},
	}, registry)
	if len(problems) != 2 {
		t.Fatalf("problem count = %d, want 2: %v", len(problems), problems)
	}

	var candidate TypeSet
	candidate.Add(fire)
	if !matcher.Match(candidate) {
		t.Fatal("known any key should still be compiled")
	}
	candidate.Add(blocked)
	if matcher.Match(candidate) {
		t.Fatal("known none key should still be compiled")
	}
}

func TestCompileMatcherUnknownAllIsImpossible(t *testing.T) {
	registry := NewRegistry()
	fire, _ := registry.Intern("fire")

	matcher, problems := CompileMatcher(model.TypeMatcherV2{All: []string{"missing_all"}}, registry)
	if len(problems) != 1 {
		t.Fatalf("problem count = %d, want 1: %v", len(problems), problems)
	}

	var candidate TypeSet
	candidate.Add(fire)
	if matcher.Match(candidate) {
		t.Fatal("unknown required all key should be impossible to match")
	}
}
