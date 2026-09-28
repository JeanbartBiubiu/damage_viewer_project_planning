package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerInternalStateEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    String stateSkillKey,
    String stateKey,
    SkillTriggerInternalStateChangeKind changeKind
) {
}
