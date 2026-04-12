package xyz.game.enginev2demo.runtime;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * actor 级运行时状态。
 */
public final class ActorRuntime {

    private final String actorId;
    private final String templateId;
    private final Map<String, Double> baseAttributes;
    private final Map<String, Double> resolvedAttributesCache;
    private boolean attributeDirty;
    private final Map<String, ActionRuntimeState> actions;
    private final List<String> equippedItemIds;
    private final Map<String, StatusInstance> activeStatuses;
    private final Map<String, ResourceState> resources;
    private final Map<String, CounterState> actorCounters;
    private final HistoryWindowState history;
    private double currentHp;

    private ActorRuntime(
            String actorId,
            String templateId,
            Map<String, Double> baseAttributes,
            Map<String, Double> resolvedAttributesCache,
            boolean attributeDirty,
            Map<String, ActionRuntimeState> actions,
            List<String> equippedItemIds,
            Map<String, StatusInstance> activeStatuses,
            Map<String, ResourceState> resources,
            Map<String, CounterState> actorCounters,
            HistoryWindowState history,
            double currentHp) {
        this.actorId = actorId;
        this.templateId = templateId;
        this.baseAttributes = baseAttributes;
        this.resolvedAttributesCache = resolvedAttributesCache;
        this.attributeDirty = attributeDirty;
        this.actions = actions;
        this.equippedItemIds = equippedItemIds;
        this.activeStatuses = activeStatuses;
        this.resources = resources;
        this.actorCounters = actorCounters;
        this.history = history;
        this.currentHp = currentHp;
    }

    public static ActorRuntime fromTemplate(
            String actorId,
            String templateId,
            Map<String, Double> attributes,
            Map<String, Double> initialResources,
            List<String> actionIds,
            Map<String, Integer> actionMaxCharges,
            List<String> equippedItemIds,
            List<StatusInstance> initialStatuses,
            double currentHp) {
        Map<String, ActionRuntimeState> actions = new LinkedHashMap<>();
        for (String actionId : actionIds) {
            int maxCharges = actionMaxCharges.getOrDefault(actionId, 1);
            actions.put(actionId, new ActionRuntimeState(actionId, 0, true, maxCharges, maxCharges));
        }
        Map<String, StatusInstance> activeStatuses = new LinkedHashMap<>();
        for (StatusInstance statusInstance : initialStatuses) {
            activeStatuses.put(statusInstance.statusId(), statusInstance);
        }
        Map<String, ResourceState> resources = new LinkedHashMap<>();
        for (Map.Entry<String, Double> entry : initialResources.entrySet()) {
            resources.put(entry.getKey(), new ResourceState(entry.getKey(), entry.getValue(), entry.getValue()));
        }
        Map<String, Double> baseAttributes = new LinkedHashMap<>(attributes);
        return new ActorRuntime(
                actorId,
                templateId,
                baseAttributes,
                new LinkedHashMap<>(baseAttributes),
                containsActiveAttrModifiers(activeStatuses),
                actions,
                List.copyOf(equippedItemIds),
                activeStatuses,
                resources,
                new LinkedHashMap<>(),
                new HistoryWindowState(),
                currentHp);
    }

    public String actorId() {
        return actorId;
    }

    public String templateId() {
        return templateId;
    }

    public Map<String, Double> baseAttributes() {
        return Map.copyOf(baseAttributes);
    }

    public Map<String, Double> attributes() {
        ensureResolvedAttributes();
        return Map.copyOf(resolvedAttributesCache);
    }

    public double attr(String key) {
        ensureResolvedAttributes();
        return resolvedAttributesCache.getOrDefault(key, 0.0);
    }

    public void setAttr(String key, double value) {
        baseAttributes.put(key, value);
        markAttributesDirty();
        clampCurrentHpToResolvedMax();
    }

    public void markAttributesDirty() {
        attributeDirty = true;
    }

    public double currentHp() {
        return currentHp;
    }

    public void setCurrentHp(double currentHp) {
        this.currentHp = currentHp;
    }

    public void clampCurrentHpToResolvedMax() {
        double maxHp = Math.max(1.0, attr("max_hp"));
        currentHp = Math.min(currentHp, maxHp);
    }

    public ActionRuntimeState actionState(String actionId) {
        ActionRuntimeState actionRuntimeState = actions.get(actionId);
        if (actionRuntimeState == null) {
            throw new IllegalArgumentException("actor '%s' does not own action '%s'".formatted(actorId, actionId));
        }
        return actionRuntimeState;
    }

    public boolean hasAction(String actionId) {
        return actions.containsKey(actionId);
    }

    public Map<String, ActionRuntimeState> actions() {
        return Map.copyOf(actions);
    }

    public List<String> equippedItemIds() {
        return List.copyOf(equippedItemIds);
    }

    public boolean hasEquippedItem(String itemId) {
        return equippedItemIds.contains(itemId);
    }

    public boolean hasActiveStatus(String statusId) {
        StatusInstance statusInstance = activeStatuses.get(statusId);
        return statusInstance != null && statusInstance.active();
    }

    public Map<String, StatusInstance> activeStatuses() {
        return Map.copyOf(activeStatuses);
    }

    public StatusInstance status(String statusId) {
        return activeStatuses.get(statusId);
    }

    public void putStatus(StatusInstance statusInstance) {
        StatusInstance previous = activeStatuses.put(statusInstance.statusId(), statusInstance);
        if (hasAttrModifiers(statusInstance) || hasAttrModifiers(previous)) {
            markAttributesDirty();
            clampCurrentHpToResolvedMax();
        }
    }

    public void removeStatus(String statusId) {
        StatusInstance removed = activeStatuses.remove(statusId);
        if (hasAttrModifiers(removed)) {
            markAttributesDirty();
            clampCurrentHpToResolvedMax();
        }
    }

    public boolean hasStatusKind(StatusKind statusKind) {
        return activeStatuses.values().stream().anyMatch(status -> status.active() && status.statusKind() == statusKind);
    }

    public Map<String, ResourceState> resources() {
        return Map.copyOf(resources);
    }

    public ResourceState resource(String resourceId) {
        return resources.get(resourceId);
    }

    public void putResource(ResourceState resourceState) {
        resources.put(resourceState.resourceId(), resourceState);
    }

    public Map<String, CounterState> actorCounters() {
        return Map.copyOf(actorCounters);
    }

    public CounterState actorCounter(String counterId) {
        return actorCounters.computeIfAbsent(counterId, CounterState::new);
    }

    public HistoryWindowState history() {
        return history;
    }

    public double shieldAmount() {
        return activeStatuses.values().stream()
                .filter(status -> status.active() && status.statusKind() == StatusKind.SHIELD)
                .mapToDouble(StatusInstance::magnitude)
                .max()
                .orElse(0.0);
    }

    private void ensureResolvedAttributes() {
        if (!attributeDirty) {
            return;
        }
        Map<String, Double> flat = new LinkedHashMap<>();
        Map<String, Double> percent = new LinkedHashMap<>();
        Set<String> attrKeys = new LinkedHashSet<>(baseAttributes.keySet());
        for (StatusInstance statusInstance : activeStatuses.values()) {
            if (!statusInstance.active()) {
                continue;
            }
            for (AppliedAttrModifier appliedAttrModifier : statusInstance.appliedAttrModifiers()) {
                attrKeys.add(appliedAttrModifier.attrKey());
                Map<String, Double> targetMap = appliedAttrModifier.mode() == AttrModifierMode.FLAT ? flat : percent;
                targetMap.merge(appliedAttrModifier.attrKey(), appliedAttrModifier.value(), Double::sum);
            }
        }
        resolvedAttributesCache.clear();
        for (String attrKey : attrKeys) {
            double base = baseAttributes.getOrDefault(attrKey, 0.0);
            double flatValue = flat.getOrDefault(attrKey, 0.0);
            double percentValue = percent.getOrDefault(attrKey, 0.0);
            double resolved = (base + flatValue) * (1.0 + percentValue);
            if ("max_hp".equals(attrKey)) {
                resolved = Math.max(1.0, resolved);
            }
            resolvedAttributesCache.put(attrKey, resolved);
        }
        attributeDirty = false;
    }

    private static boolean containsActiveAttrModifiers(Map<String, StatusInstance> statuses) {
        return statuses.values().stream().anyMatch(ActorRuntime::hasAttrModifiers);
    }

    private static boolean hasAttrModifiers(StatusInstance statusInstance) {
        return statusInstance != null && !statusInstance.appliedAttrModifiers().isEmpty();
    }
}
