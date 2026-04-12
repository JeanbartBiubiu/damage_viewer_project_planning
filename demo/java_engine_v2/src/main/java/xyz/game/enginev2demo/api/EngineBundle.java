package xyz.game.enginev2demo.api;

import java.util.List;
import java.util.Map;
import java.util.Objects;

import xyz.game.enginev2demo.action.ActionTemplate;
import xyz.game.enginev2demo.crit.CritRuleTemplate;
import xyz.game.enginev2demo.formula.FormulaDefinition;
import xyz.game.enginev2demo.pipeline.DamageProfileTemplate;

/**
 * 引擎静态配置包，在 init 阶段编译成可执行快照。
 *
 * @param actorTemplates 角色模板
 * @param actionTemplates 动作模板
 * @param itemTemplates 装备模板
 * @param statusTemplates 状态模板
 * @param damageProfiles 伤害 profile 模板，key 为 damageProfileId
 * @param formulas 公式定义列表
 * @param critRules 暴击规则模板，key 为 critType
 */
public record EngineBundle(
        Map<String, ActorTemplate> actorTemplates,
        Map<String, ActionTemplate> actionTemplates,
        Map<String, ItemTemplate> itemTemplates,
        Map<String, StatusTemplate> statusTemplates,
        Map<String, DamageProfileTemplate> damageProfiles,
        List<FormulaDefinition> formulas,
        Map<String, CritRuleTemplate> critRules) {

    public EngineBundle {
        Objects.requireNonNull(actorTemplates, "actorTemplates");
        Objects.requireNonNull(actionTemplates, "actionTemplates");
        Objects.requireNonNull(itemTemplates, "itemTemplates");
        Objects.requireNonNull(statusTemplates, "statusTemplates");
        Objects.requireNonNull(damageProfiles, "damageProfiles");
        Objects.requireNonNull(formulas, "formulas");
        Objects.requireNonNull(critRules, "critRules");
        actorTemplates = Map.copyOf(actorTemplates);
        actionTemplates = Map.copyOf(actionTemplates);
        itemTemplates = Map.copyOf(itemTemplates);
        statusTemplates = Map.copyOf(statusTemplates);
        damageProfiles = Map.copyOf(damageProfiles);
        formulas = List.copyOf(formulas);
        critRules = Map.copyOf(critRules);
    }

    /** 向后兼容——不带 critRules。 */
    public EngineBundle(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            Map<String, ItemTemplate> itemTemplates,
            Map<String, StatusTemplate> statusTemplates,
            Map<String, DamageProfileTemplate> damageProfiles,
            List<FormulaDefinition> formulas) {
        this(actorTemplates, actionTemplates, itemTemplates, statusTemplates,
                damageProfiles, formulas, Map.of());
    }

    public EngineBundle(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            List<FormulaDefinition> formulas) {
        this(actorTemplates, actionTemplates, Map.of(), Map.of(), Map.of(), formulas, Map.of());
    }
}
