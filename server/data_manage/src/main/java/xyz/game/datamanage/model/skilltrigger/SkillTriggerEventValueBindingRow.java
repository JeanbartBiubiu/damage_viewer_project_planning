package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerEventValueBindingRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    String bindingKey,
    SkillTriggerEventValueKey eventValueKey
) {
}
