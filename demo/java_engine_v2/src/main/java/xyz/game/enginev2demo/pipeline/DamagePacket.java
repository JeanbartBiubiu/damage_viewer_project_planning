package xyz.game.enginev2demo.pipeline;

import java.util.Objects;

/**
 * 进入伤害管线前的原始伤害数据。
 */
public record DamagePacket(
        String sourceActorId,
        String targetActorId,
        String actionId,
        String label,
        String damageProfileId,
        double rawDamage) {

    public DamagePacket {
        Objects.requireNonNull(sourceActorId, "sourceActorId");
        Objects.requireNonNull(targetActorId, "targetActorId");
        Objects.requireNonNull(actionId, "actionId");
        Objects.requireNonNull(label, "label");
        Objects.requireNonNull(damageProfileId, "damageProfileId");
    }
}
