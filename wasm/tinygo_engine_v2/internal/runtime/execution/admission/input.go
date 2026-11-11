// Package admission 校验已编译来源及实际初始视图，不安装效果或执行战斗。
package admission

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// Identity 保留准入错误的原会话及规则归属。
type Identity struct{ SchemaHash, RulesHash, SessionID string }

// Actor 借用一次准入检查所需的实际数值视图，不公开角色写入能力。
type Actor struct {
	Key        string
	Attributes attribute.Table
	Resources  model.ResourceView
	Present    bool
}

// Input 只借用规则、公式和实际双方的数值；调用结束后不得保留这些输入。
type Input struct {
	Compiled *planbundle.CompiledSession
	Formulas *formula.Library
	Identity Identity
	Actors   [2]Actor
}

// SourceSelection 借用原读取点实际选中的来源；技能绑定保持原手动或自动顺序，不合并两种计划。
// BasicAttack 为空表示该读取点没有选中普攻，不能用全部编译能力补足。
type SourceSelection struct {
	SkillBindings []planbundle.CompiledSkillActionBinding
	BasicAttack   *model.BasicAttackPlan
}

func actorView(input Input, key string) (Actor, bool) {
	for _, value := range input.Actors {
		if value.Key == key && value.Present {
			return value, true
		}
	}
	return Actor{}, false
}

func fail(input Input, message, path string) *model.EngineError {
	out := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message)
	out.Path, out.SchemaHash, out.RulesHash, out.SessionID = path, input.Identity.SchemaHash, input.Identity.RulesHash, input.Identity.SessionID
	return &out
}

func opponent(owner string) string {
	if owner == model.SelectorSource {
		return model.SelectorTarget
	}
	if owner == model.SelectorTarget {
		return model.SelectorSource
	}
	return ""
}

func definitionIndex(input Input, key string) (uint16, bool) {
	for i, provider := range input.Compiled.Providers {
		if provider.ProviderKey == key {
			return uint16(i), true
		}
	}
	return 0, false
}
