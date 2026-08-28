package xyz.game.datamanage.model.skilleffect;

public record SkillEffectStatusOperationDetailRow(
    String gameId,
    String skillKey,
    String effectKey,
    String resultKey,
    String statusKey,
    SkillEffectStatusOperation operation
) {
}
