package xyz.game.datamanage.service.skilltrigger.validation;

import java.util.List;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimit;

/** 规则的内部准备结果，不作为接口模型。 */
public record ValidatedRule(
        String ruleKey,
        String name,
        String description,
        Integer sortOrder,
        SkillTriggerEventSource eventSource,
        List<SkillTriggerConditionGroup> conditionGroups,
        List<SkillTriggerAction> actions,
        SkillTriggerPerTargetCooldown perTargetCooldown,
        SkillTriggerProcessLimit maxTriggersPerProcess,
        SkillTriggerOncePerUse oncePerUse,
        ReferenceRequirements references
    ) {
    }
