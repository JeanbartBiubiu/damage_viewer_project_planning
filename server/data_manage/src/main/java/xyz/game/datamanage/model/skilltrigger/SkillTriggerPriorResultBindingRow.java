package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerPriorResultBindingRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    String bindingKey,
    String sourceActionKey,
    String sourceEffectKey,
    String sourceResultKey,
    SkillTriggerPriorResultOutputKind outputKind
) {
}
