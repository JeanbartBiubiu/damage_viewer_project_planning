package xyz.game.datamanage.model.skilltrigger;

public record SkillTriggerStatusEventRow(
    String gameId,
    String skillKey,
    String ruleKey,
    SkillTriggerSubject subject,
    String statusKey,
    SkillTriggerStatusChangeKind changeKind
) {
}
