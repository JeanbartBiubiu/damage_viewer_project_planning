// 本文件验证 bundle 编译阶段的短 ID 生成、默认值填充和 fail-fast 引用校验。
package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestBundleCompilesV2AttributeAndResourceIndexes(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage", DefaultBase: 10},
		},
		Resources: []model.ResourceDefinitionV2{
			{ID: "mana", DefaultCurrent: 40, DefaultMax: 100},
		},
		Actors: []model.ActorTemplateV2{
			{
				ID: "mage",
				Attributes: map[string]model.AttributeValueV2{
					"attack_damage": {Base: 25},
				},
				Resources: map[string]model.ResourceValueV2{
					"mana": {Current: 80, Max: 100},
				},
			},
		},
	})
	if len(result.Problems) != 0 {
		t.Fatalf("compile problems: %v", result.Problems)
	}
	if got := result.Bundle.Actors[0].Attributes[0].Base; got != 25 {
		t.Fatalf("actor attr base %.2f, want 25", got)
	}
	if got := result.Bundle.Actors[0].Resources[0].Current; got != 80 {
		t.Fatalf("actor mana %.2f, want 80", got)
	}
}

func TestBundleFailsFastOnUnknownAttribute(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage"},
		},
		Actors: []model.ActorTemplateV2{
			{ID: "fighter", Attributes: map[string]model.AttributeValueV2{"missing": {Base: 1}}},
		},
	})
	if len(result.Problems) == 0 {
		t.Fatal("expected unknown attribute problem")
	}
}

func TestBundleFailsFastOnUnknownResourceFormula(t *testing.T) {
	result := Bundle(model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage"},
		},
		Formulas: []model.FormulaDefinitionV2{
			{ID: "mana_now", Op: "resource", Resource: "mana"},
		},
	})
	if len(result.Problems) == 0 {
		t.Fatal("expected unknown resource problem")
	}
}
