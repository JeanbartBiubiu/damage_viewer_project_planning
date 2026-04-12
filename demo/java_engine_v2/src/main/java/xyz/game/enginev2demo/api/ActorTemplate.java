package xyz.game.enginev2demo.api;

import java.util.List;
import java.util.Map;
import java.util.Objects;

import xyz.game.enginev2demo.trigger.TriggerSubscriptionDef;

/**
 * 角色模板——声明一个角色类型的静态配置。
 *
 * @param templateId            模板唯一 ID
 * @param attributes            基础属性（hp / armor / ad 等）
 * @param initialResources      初始资源（如 mana），key 为资源 ID，value 为初始/上限值
 * @param actionIds             该角色可使用的动作模板 ID 列表
 * @param triggerSubscriptions  角色级触发订阅（归属作用域为 ACTOR）
 */
public record ActorTemplate(
        String templateId,
        Map<String, Double> attributes,
        Map<String, Double> initialResources,
        List<String> actionIds,
        List<TriggerSubscriptionDef> triggerSubscriptions) {

    public ActorTemplate {
        Objects.requireNonNull(templateId, "templateId");
        Objects.requireNonNull(attributes, "attributes");
        Objects.requireNonNull(initialResources, "initialResources");
        Objects.requireNonNull(actionIds, "actionIds");
        Objects.requireNonNull(triggerSubscriptions, "triggerSubscriptions");
        attributes = Map.copyOf(attributes);
        initialResources = Map.copyOf(initialResources);
        actionIds = List.copyOf(actionIds);
        triggerSubscriptions = List.copyOf(triggerSubscriptions);
    }

    public ActorTemplate(
            String templateId,
            Map<String, Double> attributes,
            List<String> actionIds) {
        this(templateId, attributes, Map.of(), actionIds, List.of());
    }

    public ActorTemplate(
            String templateId,
            Map<String, Double> attributes,
            List<String> actionIds,
            List<TriggerSubscriptionDef> triggerSubscriptions) {
        this(templateId, attributes, Map.of(), actionIds, triggerSubscriptions);
    }
}
