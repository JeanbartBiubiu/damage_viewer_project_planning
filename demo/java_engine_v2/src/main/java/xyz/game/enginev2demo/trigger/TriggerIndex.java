package xyz.game.enginev2demo.trigger;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.action.ActionTemplate;
import xyz.game.enginev2demo.api.ActorTemplate;
import xyz.game.enginev2demo.api.ItemTemplate;
import xyz.game.enginev2demo.api.StatusTemplate;

/**
 * 触发器索引——编译期按 {@link TriggerType} 建立的订阅索引表。
 * <p>
 * 运行期由 {@link TriggerDispatcher} 使用，避免每次分发时遍历所有模板。
 */
public final class TriggerIndex {

    private final Map<TriggerType, List<CompiledTriggerSubscription>> byType;

    private TriggerIndex(Map<TriggerType, List<CompiledTriggerSubscription>> byType) {
        this.byType = byType;
    }

    public static TriggerIndex compile(
            Map<String, ActorTemplate> actorTemplates,
            Map<String, ActionTemplate> actionTemplates,
            Map<String, ItemTemplate> itemTemplates,
            Map<String, StatusTemplate> statusTemplates) {
        Map<TriggerType, List<CompiledTriggerSubscription>> byType = new EnumMap<>(TriggerType.class);
        for (TriggerType triggerType : TriggerType.values()) {
            byType.put(triggerType, new ArrayList<>());
        }
        actorTemplates.values().forEach(actorTemplate -> register(byType, TriggerOwnerScope.ACTOR, actorTemplate.templateId(), actorTemplate.triggerSubscriptions()));
        actionTemplates.values().forEach(actionTemplate -> register(byType, TriggerOwnerScope.ACTION, actionTemplate.actionId(), actionTemplate.triggerSubscriptions()));
        itemTemplates.values().forEach(itemTemplate -> register(byType, TriggerOwnerScope.ITEM, itemTemplate.itemId(), itemTemplate.triggerSubscriptions()));
        statusTemplates.values().forEach(statusTemplate -> register(byType, TriggerOwnerScope.STATUS, statusTemplate.statusId(), statusTemplate.triggerSubscriptions()));
        Map<TriggerType, List<CompiledTriggerSubscription>> immutable = new LinkedHashMap<>();
        byType.forEach((key, value) -> immutable.put(key, List.copyOf(value)));
        return new TriggerIndex(Map.copyOf(immutable));
    }

    public List<CompiledTriggerSubscription> subscriptions(TriggerType triggerType) {
        return byType.getOrDefault(triggerType, List.of());
    }

    private static void register(
            Map<TriggerType, List<CompiledTriggerSubscription>> byType,
            TriggerOwnerScope ownerScope,
            String ownerId,
            List<TriggerSubscriptionDef> subscriptions) {
        for (TriggerSubscriptionDef subscription : subscriptions) {
            byType.computeIfAbsent(subscription.triggerType(), ignored -> new ArrayList<>())
                    .add(new CompiledTriggerSubscription(ownerScope, ownerId, subscription));
        }
    }
}
