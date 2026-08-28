package xyz.game.datamanage.model.skillinternalstate;

public record SkillInternalStateFlagDetailRow(
    String gameId,
    String skillKey,
    String stateKey,
    Boolean initialEnabled
) {
}
