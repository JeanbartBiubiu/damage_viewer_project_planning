package xyz.game.datamanage.model.skilleffect;

public record SkillEffectLifecycleOperationDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String targetEffectKey,
    SkillEffectLifecycleOperation operation
) {
}
