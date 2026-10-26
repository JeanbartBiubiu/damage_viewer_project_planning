// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func TestP6BasicAttackCannotInventMissingUseFacts(t *testing.T) {
	c, r := loadBasicFixture(t)
	ensureNativeBasicAttackCatalog(&c)
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{nativeHitAbility("aa_hit", "actual_attack", nil)}
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "unproven_hit", AbilityRef: "source.provider[champion:source_demo].ability[aa_hit]", Source: "source", Target: "target"}}
	r.SkillUses = nil
	r.SkillHitFacts = nil
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatalf("compile: %+v", compiled.Result.Errors)
	}
	if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil {
		t.Fatal("missing attack use facts must fail, not mint a complete use from an entry key")
	}
}
