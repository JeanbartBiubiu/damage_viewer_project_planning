package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerInternalStateBindingRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String actionKey,
    String bindingKey,
    String stateKey,
    SkillTriggerInternalStateValueKind valueKind,
    String optionKey
) {
}
