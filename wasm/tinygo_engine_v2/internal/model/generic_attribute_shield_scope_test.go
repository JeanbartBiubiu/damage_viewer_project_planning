package model

import "testing"

func TestPersistentTargetAttributeSpellShieldScopes(t *testing.T) {
	sem := SkillHitSemantic{ResultType: SkillHitResultAttributeChange, Target: SkillHitTargetTARGET, Moment: SkillHitMomentPersistent}
	for _, scope := range []string{SpellShieldScopeSkill, SpellShieldScopeEffect, SpellShieldScopeResult} {
		if message := ValidateSpellShieldScope(sem, &scope); message != "" {
			t.Fatal(scope, message)
		}
	}
	scope := SpellShieldScopeDamageInstance
	if ValidateSpellShieldScope(sem, &scope) == "" {
		t.Fatal("attribute result accepted a damage instance scope")
	}
	for _, target := range []string{SkillHitTargetSOURCE, SkillHitTargetSELF} {
		sem.Target = target
		scope = SpellShieldScopeSkill
		if ValidateSpellShieldScope(sem, &scope) == "" {
			t.Fatal("non-target attribute scope accepted", target)
		}
	}
	sem.Target, sem.ResultType = SkillHitTargetTARGET, SkillHitResultResourceChange
	if ValidateSpellShieldScope(sem, &scope) == "" {
		t.Fatal("unrelated persistent resource scope widened")
	}
}
