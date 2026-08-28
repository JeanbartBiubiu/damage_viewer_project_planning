package xyz.game.datamanage.model.skillinternalstate;

public record SkillInternalStateCooldownDetailRow(
    String gameId,
    String skillKey,
    String stateKey,
    String durationFormulaKey
) {
}
