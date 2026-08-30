package xyz.game.datamanage.model.skilltrigger;

import java.util.List;

public record SkillTriggerRuleDetailResponse(
    String ruleKey,
    String name,
    String description,
    Integer sortOrder,
    SkillTriggerEventSource eventSource,
    List<SkillTriggerConditionGroup> conditionGroups,
    List<SkillTriggerAction> actions,
    SkillTriggerPerTargetCooldown perTargetCooldown,
    SkillTriggerProcessLimit maxTriggersPerProcess
) {
}
