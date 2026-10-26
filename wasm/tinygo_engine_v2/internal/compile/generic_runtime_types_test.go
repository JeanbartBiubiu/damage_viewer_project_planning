package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/base/typeset"
)

func TestRuntimeTypeBindingsPreserveZeroAbsenceAndScopedIdentity(t *testing.T) {
	registry := typeset.NewRegistry()
	zero, _ := registry.InternScoped("ability", "ability/basic_attack")
	other, _ := registry.InternScoped("event", "ability/basic_attack")
	event, _ := registry.InternScoped("event", model.EventTypeBasicAttackStart)
	bound := BindRuntimeTypes(registry)
	if id, ok := bound.BasicAttack.Lookup(); !ok || id != zero || id == other || id != 0 {
		t.Fatalf("zero or scoped identity changed: %d %v", id, ok)
	}
	if id, ok := bound.BasicAttackStart.Lookup(); !ok || id != event {
		t.Fatalf("event identity changed: %d %v", id, ok)
	}
	if id, ok := bound.SkillHit.Lookup(); ok || id != 0 {
		t.Fatalf("absent type became declared: %d %v", id, ok)
	}
	if _, ok := registry.Lookup("ability/basic_attack"); ok {
		t.Fatal("prebinding must not remove ambiguous-name checks")
	}
	if len(registry.Keys) != 3 {
		t.Fatal("prebinding added undeclared types")
	}
}

func TestRuntimeTypeBindingsKeepBasicDamageEventSlashKey(t *testing.T) {
	for _, key := range []string{"event/damage_dealt/basic_attack", "event/damage_dealt_basic_attack"} {
		registry := typeset.NewRegistry()
		id, _ := registry.InternScoped("event", key)
		binding := BindRuntimeTypes(registry).DamageDealtBasicAttack
		if binding.Declared != (key == "event/damage_dealt/basic_attack") || binding.ID != id {
			t.Fatalf("event classification identity changed for %q: %+v", key, binding)
		}
	}
}
