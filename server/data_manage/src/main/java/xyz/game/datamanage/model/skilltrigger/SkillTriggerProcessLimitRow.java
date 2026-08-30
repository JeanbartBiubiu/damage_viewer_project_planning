package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerProcessLimitRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String processKey,
    String limitFormulaKey
) {
}
