package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerCombatStatusBindingRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    String bindingKey,
    SkillTriggerSubject subject,
    String statusKey,
    SkillTriggerCombatStatusValueKind valueKind,
    String sourceEffectKey,
    String sourceResultKey
) {
}
