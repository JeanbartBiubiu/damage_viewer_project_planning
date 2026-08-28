package xyz.game.datamanage.model.skillinternalstate;

public record SkillInternalStateModeOptionRow(
    String gameId,
    String skillKey,
    String stateKey,
    String optionKey,
    String name,
    Integer sortOrder,
    Boolean initial
) {
}
