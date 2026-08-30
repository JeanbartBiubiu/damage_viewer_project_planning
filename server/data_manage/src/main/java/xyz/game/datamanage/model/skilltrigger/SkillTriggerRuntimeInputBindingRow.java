package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerRuntimeInputBindingRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    String bindingKey,
    String parameterKey,
    SkillTriggerRuntimeInputSourceType sourceType
) {
}
