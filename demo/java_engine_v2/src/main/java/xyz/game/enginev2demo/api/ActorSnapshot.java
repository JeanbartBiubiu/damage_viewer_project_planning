package xyz.game.enginev2demo.api;

import java.util.Map;
import java.util.Objects;

/**
 * 角色终态快照，在 run 结束时从 {@link xyz.game.enginev2demo.runtime.ActorRuntime} 提取。
 *
 * @param actorId      角色唯一标识
 * @param currentHp    当前生命值
 * @param shieldAmount 当前护盾量（取最大活跃护盾值）
 * @param attributes   角色属性快照（不可变副本）
 */
public record ActorSnapshot(
        String actorId,
        double currentHp,
        double shieldAmount,
        Map<String, Double> attributes) {

    public ActorSnapshot {
        Objects.requireNonNull(actorId, "actorId");
        attributes = Map.copyOf(attributes);
    }

    public ActorSnapshot(
            String actorId,
            double currentHp,
            Map<String, Double> attributes) {
        this(actorId, currentHp, 0.0, attributes);
    }
}
