package xyz.game.enginev2demo.api;

import java.util.List;
import java.util.Objects;

/**
 * 单次 run 中一个参战角色的初始化参数。
 *
 * @param actorId          本次 run 中角色唯一 ID（如 "self" / "enemy"）
 * @param templateId       引用的 {@link ActorTemplate} ID
 * @param equippedItemIds  装备的物品模板 ID 列表
 * @param initialStatusIds 角色初始自带的状态模板 ID 列表
 */
public record CombatantRunInit(
        String actorId,
        String templateId,
        List<String> equippedItemIds,
        List<String> initialStatusIds) {

    public CombatantRunInit {
        Objects.requireNonNull(actorId, "actorId");
        Objects.requireNonNull(templateId, "templateId");
        Objects.requireNonNull(equippedItemIds, "equippedItemIds");
        Objects.requireNonNull(initialStatusIds, "initialStatusIds");
        equippedItemIds = List.copyOf(equippedItemIds);
        initialStatusIds = List.copyOf(initialStatusIds);
    }

    public CombatantRunInit(
            String actorId,
            String templateId) {
        this(actorId, templateId, List.of(), List.of());
    }
}
