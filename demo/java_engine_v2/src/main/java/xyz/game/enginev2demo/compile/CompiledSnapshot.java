package xyz.game.enginev2demo.compile;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import xyz.game.enginev2demo.action.ActionTemplate;
import xyz.game.enginev2demo.api.ActorTemplate;
import xyz.game.enginev2demo.api.CombatantRunInit;
import xyz.game.enginev2demo.api.ItemTemplate;
import xyz.game.enginev2demo.api.StatusTemplate;
import xyz.game.enginev2demo.formula.FormulaCatalog;
import xyz.game.enginev2demo.pipeline.DamageProfileCatalog;
import xyz.game.enginev2demo.pipeline.DamageProfileTemplate;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.StatusInstance;
import xyz.game.enginev2demo.trigger.TriggerIndex;

/**
 * 编译后的不可变快照。
 */
public record CompiledSnapshot(
        Map<String, ActorTemplate> actorTemplates,
        Map<String, ActionTemplate> actionTemplates,
        Map<String, ItemTemplate> itemTemplates,
        Map<String, StatusTemplate> statusTemplates,
        DamageProfileCatalog damageProfileCatalog,
        FormulaCatalog formulaCatalog,
        TriggerIndex triggerIndex) {

    public CompiledSnapshot {
        actorTemplates = Map.copyOf(actorTemplates);
        actionTemplates = Map.copyOf(actionTemplates);
        itemTemplates = Map.copyOf(itemTemplates);
        statusTemplates = Map.copyOf(statusTemplates);
    }

    public ActorTemplate actorTemplate(String templateId) {
        ActorTemplate actorTemplate = actorTemplates.get(templateId);
        if (actorTemplate == null) {
            throw new IllegalArgumentException("missing actor template: " + templateId);
        }
        return actorTemplate;
    }

    public ActionTemplate actionTemplate(String actionId) {
        ActionTemplate actionTemplate = actionTemplates.get(actionId);
        if (actionTemplate == null) {
            throw new IllegalArgumentException("missing action template: " + actionId);
        }
        return actionTemplate;
    }

    public ItemTemplate itemTemplate(String itemId) {
        ItemTemplate itemTemplate = itemTemplates.get(itemId);
        if (itemTemplate == null) {
            throw new IllegalArgumentException("missing item template: " + itemId);
        }
        return itemTemplate;
    }

    public StatusTemplate statusTemplate(String statusId) {
        StatusTemplate statusTemplate = statusTemplates.get(statusId);
        if (statusTemplate == null) {
            throw new IllegalArgumentException("missing status template: " + statusId);
        }
        return statusTemplate;
    }

    public DamageProfileTemplate damageProfile(String damageProfileId) {
        return damageProfileCatalog.require(damageProfileId);
    }

    public ActorRuntime instantiateActor(CombatantRunInit init) {
        ActorTemplate template = actorTemplate(init.templateId());
        Map<String, Double> attrs = new LinkedHashMap<>(template.attributes());
        double currentHp = attrs.containsKey("current_hp")
                ? attrs.get("current_hp")
                : attrs.getOrDefault("max_hp", attrs.getOrDefault("hp", 0.0));
        for (String itemId : init.equippedItemIds()) {
            itemTemplate(itemId);
        }
        for (String statusId : init.initialStatusIds()) {
            statusTemplate(statusId);
        }
        List<StatusInstance> initialStatuses = init.initialStatusIds().stream()
                .map(statusId -> {
                    StatusTemplate statusTemplate = statusTemplate(statusId);
                    return new StatusInstance(
                            statusTemplate.statusId(),
                            init.actorId(),
                            init.actorId(),
                            statusTemplate.statusKind(),
                            0L,
                            statusTemplate.durationMs() > 0 ? statusTemplate.durationMs() : 0L,
                            0.0,
                            true,
                            List.of());
                })
                .collect(Collectors.toList());
        Map<String, Integer> actionMaxCharges = new LinkedHashMap<>();
        for (String actionId : template.actionIds()) {
            ActionTemplate at = actionTemplate(actionId);
            actionMaxCharges.put(actionId, at.maxCharges());
        }
        return ActorRuntime.fromTemplate(
                init.actorId(),
                template.templateId(),
                attrs,
                template.initialResources(),
                template.actionIds(),
                actionMaxCharges,
                init.equippedItemIds(),
                initialStatuses,
                currentHp);
    }
}
