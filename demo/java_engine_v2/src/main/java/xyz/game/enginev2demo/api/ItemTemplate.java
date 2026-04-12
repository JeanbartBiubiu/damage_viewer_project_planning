package xyz.game.enginev2demo.api;

import java.util.List;
import java.util.Objects;

import xyz.game.enginev2demo.trigger.TriggerSubscriptionDef;

/**
 * 装备模板——声明一件装备的静态配置。
 * 当前 demo 装备的核心能力通过触发订阅实现（如荆棘甲反伤）。
 *
 * @param itemId              装备唯一 ID
 * @param label               显示名称
 * @param triggerSubscriptions 装备级触发订阅（归属作用域为 ITEM）
 */
public record ItemTemplate(
        String itemId,
        String label,
        List<TriggerSubscriptionDef> triggerSubscriptions) {

    public ItemTemplate {
        Objects.requireNonNull(itemId, "itemId");
        Objects.requireNonNull(label, "label");
        Objects.requireNonNull(triggerSubscriptions, "triggerSubscriptions");
        triggerSubscriptions = List.copyOf(triggerSubscriptions);
    }

    public ItemTemplate(
            String itemId,
            String label) {
        this(itemId, label, List.of());
    }
}
