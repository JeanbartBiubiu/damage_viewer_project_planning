package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerSkillEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String sourceSkillKey,
    SkillTriggerEventUseKind useKind
) {
}
