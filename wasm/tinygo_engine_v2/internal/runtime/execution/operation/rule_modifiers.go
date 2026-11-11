package operation

import (
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// MountRuleModifiers 按原规则顺序挂载数值修正；无明确属性落点的规则沿原政策跳过。
func MountRuleModifiers(resolver *effectpkg.AttributeResolver, damageResolver *effectpkg.DamageResolver, combatantKey string, modifiers []planbundle.CompiledModifier) {
	for _, mod := range modifiers {
		if mod.Kind == "pipeline" {
			mountRulePipelineModifier(damageResolver, combatantKey, mod)
			continue
		}
		if mod.Kind != "attribute" && mod.Kind != "" {
			continue
		}
		selector := pipeline.ModifierTargetCombatantSelector(mod.Target)
		switch selector {
		case "":
			// 规则要求显式属性落点；供值器挂载的裸属性键仍由效果职责处理。
			continue
		case model.SelectorSource:
			if combatantKey != model.SelectorSource {
				continue
			}
		case model.SelectorTarget:
			if combatantKey != model.SelectorTarget {
				continue
			}
		case model.SelectorSelf, model.SelectorOpponent:
			// 全场规则没有行动入口，上下文自身和对方沿原source/target别名处理。
			if selector == model.SelectorSelf && combatantKey != model.SelectorSource {
				continue
			}
			if selector == model.SelectorOpponent && combatantKey != model.SelectorTarget {
				continue
			}
		default:
			if combatantKey != selector {
				continue
			}
		}
		resolver.MountCompiledModifier("rules", mod)
	}
}

// 规则按数值阶段归发出或承受方；治疗保留现行双向路由。
func mountRulePipelineModifier(damageResolver *effectpkg.DamageResolver, combatantKey string, mod planbundle.CompiledModifier) {
	if damageResolver == nil {
		return
	}
	switch mod.Command {
	case "crit":
		switch mod.Stage {
		case "crit_chance_pre_settlement", "crit_multiplier_forced_branch", "crit_multiplier_natural_branch":
			if combatantKey != model.SelectorSource {
				return
			}
		default:
			return
		}
	case "damage":
		switch mod.Stage {
		case "outgoing_pre_mitigation":
			if combatantKey != model.SelectorSource {
				return
			}
		case "incoming_crit_part_post_mitigation", "incoming_post_mitigation":
			if combatantKey != model.SelectorTarget {
				return
			}
		default:
			return
		}
	case "heal":
	default:
		return
	}
	damageResolver.MountCompiledModifierOwned("", "rules", mod)
}
