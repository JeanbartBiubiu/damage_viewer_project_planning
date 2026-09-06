package xyz.game.datamanage.service.skilltrigger;

import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.model.skilltrigger.*;
import xyz.game.datamanage.support.authoring.AggregateJson;

@Component
public class SkillTriggerRuleAssembler {
    public record Limits(SkillTriggerPerTargetCooldown perTargetCooldown,
                         SkillTriggerProcessLimit maxTriggersPerProcess) {}

    public SkillTriggerRuleDetailResponse assemble(SkillTriggerRuleRow row) {
        Limits limits = AggregateJson.read(row.limitsJson(), Limits.class);
        return new SkillTriggerRuleDetailResponse(row.ruleKey(), row.name(), row.description(), row.sortOrder(),
            AggregateJson.read(row.eventSourceJson(), SkillTriggerEventSource.class),
            orderedGroups(AggregateJson.readList(row.conditionGroupsJson(), SkillTriggerConditionGroup.class)),
            orderedActions(AggregateJson.readList(row.actionsJson(), SkillTriggerAction.class)),
            limits == null ? null : limits.perTargetCooldown(),
            limits == null ? null : limits.maxTriggersPerProcess());
    }

    static List<SkillTriggerConditionGroup> orderedGroups(List<SkillTriggerConditionGroup> groups) {
        return groups.stream().sorted(Comparator.comparing(SkillTriggerConditionGroup::sortOrder)
                .thenComparing(SkillTriggerConditionGroup::groupKey))
            .map(group -> new SkillTriggerConditionGroup(group.groupKey(), group.name(), group.sortOrder(),
                group.conditions().stream().sorted(Comparator.comparing(SkillTriggerCondition::sortOrder)
                    .thenComparing(SkillTriggerCondition::conditionKey)).toList())).toList();
    }

    static List<SkillTriggerAction> orderedActions(List<SkillTriggerAction> actions) {
        return actions.stream().sorted(Comparator.comparing(SkillTriggerAction::sortOrder)
                .thenComparing(SkillTriggerAction::actionKey))
            .map(action -> new SkillTriggerAction(action.actionKey(), action.name(), action.actionType(),
                action.sortOrder(), action.targetContext(), action.detail(),
                action.runtimeInputBindings().stream().sorted(Comparator.comparing(SkillTriggerRuntimeInputBinding::bindingKey)).toList(),
                action.resultModifiers().stream().sorted(Comparator.comparing(SkillTriggerResultModifier::resultKey)).toList()))
            .toList();
    }
}