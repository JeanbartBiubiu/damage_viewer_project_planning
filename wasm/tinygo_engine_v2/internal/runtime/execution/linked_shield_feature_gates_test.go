package execution

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func TestMixedLinkedShieldsKeepSeparateProjectionGates(t *testing.T) {
	c, r := durationLinkedShieldMixInput(t, false)
	mixed := &c.SharedProviders[0].Abilities[len(c.SharedProviders[0].Abilities)-1]
	ordinary := mixed.Operations[0]
	atomic := ordinary
	atomic.ShieldRef = "atomic_linked_shield/value"
	atomic.ShieldLifecycleProviderDefinitionRef = "atomic_linked_shield"
	mixed.Operations = []model.OperationDefinition{ordinary, atomic}

	definition := c.SharedProviders[3]
	definition.ProviderKey = atomic.ShieldLifecycleProviderDefinitionRef
	definition.StableID = definition.ProviderKey
	definition.LinkedShieldDefinitionRef = atomic.ShieldRef
	definition.Modifiers = []model.ModifierDefinition{{
		ModifierKey: "attack_bonus", Kind: "attribute", Target: "self.attr.attack_damage",
		ValuePolicy: "add", Value: authoringConst(30),
	}}
	c.SharedProviders = append(c.SharedProviders, definition)
	c.SharedProviders[2].Modifiers = append(c.SharedProviders[2].Modifiers, model.ModifierDefinition{
		ModifierKey: "hp", Kind: "resource_max", Target: "self.attr.hp", ValuePolicy: "add",
		Value: authoringConst(100), CurrentValuePolicy: "grant_positive_delta_clamp",
	})

	s := frameCommitState(t, c, r)
	features := s.compiled.Features
	if !features.Has(plan.FeatureStagedLinkedShield | plan.FeatureProviderDurationChange | plan.FeatureResourceMax) {
		t.Fatalf("测试要求原子关联盾、续时和资源上限同时启用，实际为 %b", features)
	}
	apply, ability, operations := frameCommitFrame(s)
	if err := apply.executeOperations(ability, operations); err != nil {
		t.Fatal(err)
	}
	apply.flushDynamicProviders()
	pending := apply.staged.Get("source").providerOps
	if apply.fatal || len(pending) != 2 || pending[0].Projected || !pending[1].Projected {
		t.Fatalf("普通盾应保留到发布阶段，原子盾应提前投影，暂存操作 %+v，错误 %v", pending, apply.fatalErr)
	}
	apply.commit()
	if !apply.fatal || apply.committed || apply.fatalErr.Code != model.GenericErrRuntimeInvariantFailed ||
		s.combatants["source"].instances.Shields().Len() != 0 {
		t.Fatalf("混合投影批次应在发布前拒绝 %v", apply.fatalErr)
	}
	for _, operation := range operations {
		frame, _, _ := frameCommitFrame(s)
		if err := frame.executeOperation(ability, &operation); err != nil {
			t.Fatal(err)
		}
		frame.commit()
		if frame.fatal || !frame.committed {
			t.Fatalf("独立关联盾提交失败 %v", frame.fatalErr)
		}
	}

	source := s.combatants["source"]
	shields := source.instances.Shields()
	if shields.Len() != 2 || shields.At(0).DefinitionRef != ordinary.ShieldRef || shields.At(1).DefinitionRef != atomic.ShieldRef ||
		source.attributesView().At("attack_damage").Resolved != 130 {
		t.Fatal("两个盾及原子盾属性未正确发布", shields, source.attributesView())
	}
	atomicProvider := shields.At(1).LifecycleProviderRef

	deplete := s.newExecutionFrame("target", "source", "deplete_atomic_shield")
	staged := deplete.stageFor("source")
	// 模拟数值结算耗尽原子盾，由提交预检发现耗尽并追加移除。
	staged.instances.SetShields(staged.instances.Shields().Remove(1))
	deplete.commit()
	if deplete.fatal || !deplete.committed {
		t.Fatalf("耗尽提交失败 %v", deplete.fatalErr)
	}
	source = s.combatants["source"]
	removals := staged.providerOps
	_, _, atomicPresent := source.instances.Providers().Find(atomicProvider)
	if len(removals) != 1 || removals[0].ProviderRef != atomicProvider || !removals[0].Projected ||
		atomicPresent || source.instances.Shields().Len() != 1 ||
		!reflect.DeepEqual(source.instances.Shields().At(0), shields.At(0)) || source.attributesView().At("attack_damage").Resolved != 100 {
		t.Fatalf("耗尽应走第二次投影，只移除原子盾及其属性，暂存操作 %+v，供值器仍存在 %t", removals, atomicPresent)
	}
}
