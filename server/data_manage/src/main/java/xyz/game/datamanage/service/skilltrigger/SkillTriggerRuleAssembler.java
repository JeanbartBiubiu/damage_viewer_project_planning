package xyz.game.datamanage.service.skilltrigger;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCancelProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroupRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerFailProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldownRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimitRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifier;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifierRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputSourceType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStartProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventRow;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class SkillTriggerRuleAssembler {

    private static final Logger log = LoggerFactory.getLogger(SkillTriggerRuleAssembler.class);
    private static final Comparator<SkillTriggerConditionGroup> GROUP_ORDER = Comparator
        .comparing(SkillTriggerConditionGroup::sortOrder)
        .thenComparing(SkillTriggerConditionGroup::groupKey);
    private static final Comparator<SkillTriggerCondition> CONDITION_ORDER = Comparator
        .comparing(SkillTriggerCondition::sortOrder)
        .thenComparing(SkillTriggerCondition::conditionKey);
    private static final Comparator<SkillTriggerAction> ACTION_ORDER = Comparator
        .comparing(SkillTriggerAction::sortOrder)
        .thenComparing(SkillTriggerAction::actionKey);
    private static final Comparator<SkillTriggerRuntimeInputBinding> BINDING_ORDER = Comparator
        .comparing(SkillTriggerRuntimeInputBinding::bindingKey);
    private static final Comparator<SkillTriggerResultModifier> MODIFIER_ORDER = Comparator
        .comparing(SkillTriggerResultModifier::resultKey);

    private final SkillTriggerRuleMapper mapper;

    public SkillTriggerRuleAssembler(SkillTriggerRuleMapper mapper) {
        this.mapper = mapper;
    }

    public SkillTriggerRuleDetailResponse assemble(SkillTriggerRuleRow rule) {
        String gameId = rule.gameId();
        String skillKey = rule.skillKey();
        String ruleKey = rule.ruleKey();
        SkillTriggerEventSource eventSource = assembleEventSource(rule);
        List<SkillTriggerConditionGroup> groups = assembleConditionGroups(gameId, skillKey, ruleKey);
        List<SkillTriggerAction> actions = assembleActions(gameId, skillKey, ruleKey);
        if (actions.isEmpty()) {
            throw corrupt(gameId, skillKey, ruleKey, "规则缺少动作");
        }
        SkillTriggerPerTargetCooldownRow cooldownRow = mapper.findCooldown(gameId, skillKey, ruleKey);
        SkillTriggerProcessLimitRow limitRow = mapper.findProcessLimit(gameId, skillKey, ruleKey);
        SkillTriggerPerTargetCooldown cooldown = cooldownRow == null
            ? null
            : new SkillTriggerPerTargetCooldown(cooldownRow.durationFormulaKey(), cooldownRow.targetContext());
        SkillTriggerProcessLimit limit = limitRow == null
            ? null
            : new SkillTriggerProcessLimit(limitRow.processKey(), limitRow.limitFormulaKey());
        return new SkillTriggerRuleDetailResponse(
            rule.ruleKey(),
            rule.name(),
            rule.description(),
            rule.sortOrder(),
            eventSource,
            groups,
            actions,
            cooldown,
            limit
        );
    }

    private SkillTriggerEventSource assembleEventSource(SkillTriggerRuleRow rule) {
        String gameId = rule.gameId();
        String skillKey = rule.skillKey();
        String ruleKey = rule.ruleKey();
        SkillTriggerEventType eventType = rule.eventType();
        SkillTriggerProcessEventRow processEvent = mapper.findProcessEvent(gameId, skillKey, ruleKey);
        SkillTriggerSkillEventRow skillEvent = mapper.findSkillEvent(gameId, skillKey, ruleKey);
        SkillTriggerResultEventRow resultEvent = mapper.findResultEvent(gameId, skillKey, ruleKey);
        SkillTriggerLifecycleEventRow lifecycleEvent = mapper.findLifecycleEvent(gameId, skillKey, ruleKey);
        SkillTriggerStatusEventRow statusEvent = mapper.findStatusEvent(gameId, skillKey, ruleKey);
        SkillTriggerHealthThresholdEventRow healthEvent = mapper.findHealthEvent(gameId, skillKey, ruleKey);
        SkillTriggerInternalStateEventRow internalStateEvent = mapper.findInternalStateEvent(gameId, skillKey, ruleKey);
        SkillTriggerSubjectEventRow subjectEvent = mapper.findSubjectEvent(gameId, skillKey, ruleKey);
        int present = countPresent(
            processEvent, skillEvent, resultEvent, lifecycleEvent, statusEvent, healthEvent,
            internalStateEvent, subjectEvent
        );
        return switch (eventType) {
            case PROCESS_MOMENT -> {
                if (processEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "PROCESS_MOMENT 事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerProcessEventDetail(
                        processEvent.processKey(),
                        new SkillProcessMoment(parseMomentType(processEvent.momentType()), processEvent.stepKey())
                    )
                );
            }
            case PROCESS_CANCEL_REQUESTED -> {
                if (processEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "PROCESS_CANCEL_REQUESTED 事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerCancelProcessEventDetail(processEvent.processKey())
                );
            }
            case SKILL_USED, SKILL_HIT -> {
                if (skillEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "技能筛选事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerSkillEventDetail(skillEvent.sourceSkillKey(), skillEvent.useKind())
                );
            }
            case RESULT_AVAILABLE -> {
                if (resultEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "RESULT_AVAILABLE 事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerResultEventDetail(resultEvent.effectKey(), resultEvent.resultKey())
                );
            }
            case LIFECYCLE_MOMENT -> {
                if (lifecycleEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "LIFECYCLE_MOMENT 事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerLifecycleEventDetail(lifecycleEvent.effectKey(), lifecycleEvent.lifecycleMoment())
                );
            }
            case STATUS_CHANGED -> {
                if (statusEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "STATUS_CHANGED 事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerStatusEventDetail(
                        statusEvent.subject(),
                        statusEvent.statusKey(),
                        statusEvent.changeKind()
                    )
                );
            }
            case HEALTH_THRESHOLD_CROSSED -> {
                if (healthEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "HEALTH_THRESHOLD_CROSSED 事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerHealthThresholdEventDetail(
                        healthEvent.subject(),
                        healthEvent.attributeKey(),
                        healthEvent.thresholdFormulaKey(),
                        healthEvent.direction()
                    )
                );
            }
            case INTERNAL_STATE_CHANGED -> {
                if (internalStateEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "INTERNAL_STATE_CHANGED 事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerInternalStateEventDetail(
                        internalStateEvent.stateKey(),
                        internalStateEvent.changeKind()
                    )
                );
            }
            case ENTITY_DIED, ENTITY_UNTARGETABLE -> {
                if (subjectEvent == null || present != 1) {
                    throw corrupt(gameId, skillKey, ruleKey, "主体事件明细形状损坏");
                }
                yield new SkillTriggerEventSource(
                    eventType,
                    new SkillTriggerSubjectEventDetail(subjectEvent.subject())
                );
            }
            case BASIC_ATTACK_START, BASIC_ATTACK_HIT, DAMAGE_DEALT, DAMAGE_TAKEN, CONTROL_RECEIVED, KILL -> {
                if (present != 0) {
                    throw corrupt(gameId, skillKey, ruleKey, "无明细事件存在多余明细");
                }
                yield new SkillTriggerEventSource(eventType, new SkillTriggerEmptyEventDetail());
            }
        };
    }

    private List<SkillTriggerConditionGroup> assembleConditionGroups(
        String gameId,
        String skillKey,
        String ruleKey
    ) {
        List<SkillTriggerConditionGroupRow> groupRows = nullToEmpty(
            mapper.listConditionGroups(gameId, skillKey, ruleKey)
        );
        Map<String, List<SkillTriggerCondition>> conditionsByGroup = new LinkedHashMap<>();
        for (SkillTriggerConditionGroupRow group : groupRows) {
            conditionsByGroup.put(group.groupKey(), new ArrayList<>());
        }
        Map<String, SkillTriggerAttributeConditionRow> attributeByKey = indexAttributeConditions(
            gameId, skillKey, ruleKey, mapper.listAttributeConditions(gameId, skillKey, ruleKey)
        );
        Map<String, SkillTriggerStatusConditionRow> statusByKey = indexStatusConditions(
            gameId, skillKey, ruleKey, mapper.listStatusConditions(gameId, skillKey, ruleKey)
        );
        Map<String, SkillTriggerInternalStateConditionRow> internalByKey = indexInternalStateConditions(
            gameId, skillKey, ruleKey, mapper.listInternalStateConditions(gameId, skillKey, ruleKey)
        );
        Map<String, SkillTriggerEventValueConditionRow> eventValueByKey = indexEventValueConditions(
            gameId, skillKey, ruleKey, mapper.listEventValueConditions(gameId, skillKey, ruleKey)
        );
        for (SkillTriggerConditionRow row : nullToEmpty(mapper.listConditions(gameId, skillKey, ruleKey))) {
            List<SkillTriggerCondition> bucket = conditionsByGroup.get(row.groupKey());
            if (bucket == null) {
                throw corrupt(gameId, skillKey, ruleKey, "条件不属于任何条件组");
            }
            bucket.add(assembleCondition(gameId, skillKey, ruleKey, row, attributeByKey, statusByKey, internalByKey, eventValueByKey));
        }
        if (!attributeByKey.isEmpty() || !statusByKey.isEmpty() || !internalByKey.isEmpty() || !eventValueByKey.isEmpty()) {
            throw corrupt(gameId, skillKey, ruleKey, "存在未归属条件明细");
        }
        List<SkillTriggerConditionGroup> groups = new ArrayList<>();
        for (SkillTriggerConditionGroupRow group : groupRows) {
            List<SkillTriggerCondition> conditions = conditionsByGroup.get(group.groupKey());
            if (conditions == null || conditions.isEmpty()) {
                throw corrupt(gameId, skillKey, ruleKey, "条件组缺少条件");
            }
            conditions.sort(CONDITION_ORDER);
            groups.add(new SkillTriggerConditionGroup(
                group.groupKey(),
                group.name(),
                group.sortOrder(),
                List.copyOf(conditions)
            ));
        }
        groups.sort(GROUP_ORDER);
        return List.copyOf(groups);
    }

    private SkillTriggerCondition assembleCondition(
        String gameId,
        String skillKey,
        String ruleKey,
        SkillTriggerConditionRow row,
        Map<String, SkillTriggerAttributeConditionRow> attributeByKey,
        Map<String, SkillTriggerStatusConditionRow> statusByKey,
        Map<String, SkillTriggerInternalStateConditionRow> internalByKey,
        Map<String, SkillTriggerEventValueConditionRow> eventValueByKey
    ) {
        String key = conditionIndexKey(row.groupKey(), row.conditionKey());
        return switch (row.conditionType()) {
            case ATTRIBUTE_COMPARE -> {
                SkillTriggerAttributeConditionRow detail = attributeByKey.remove(key);
                if (detail == null
                    || statusByKey.containsKey(key)
                    || internalByKey.containsKey(key)
                    || eventValueByKey.containsKey(key)) {
                    throw corrupt(gameId, skillKey, ruleKey, "属性条件明细形状损坏");
                }
                yield new SkillTriggerCondition(
                    row.conditionKey(),
                    SkillTriggerConditionType.ATTRIBUTE_COMPARE,
                    row.sortOrder(),
                    new SkillTriggerAttributeConditionDetail(
                        detail.subject(),
                        detail.attributeKey(),
                        detail.attributeValueKind(),
                        detail.comparator(),
                        detail.comparisonFormulaKey()
                    )
                );
            }
            case STATUS_CHECK -> {
                SkillTriggerStatusConditionRow detail = statusByKey.remove(key);
                if (detail == null
                    || attributeByKey.containsKey(key)
                    || internalByKey.containsKey(key)
                    || eventValueByKey.containsKey(key)) {
                    throw corrupt(gameId, skillKey, ruleKey, "状态条件明细形状损坏");
                }
                yield new SkillTriggerCondition(
                    row.conditionKey(),
                    SkillTriggerConditionType.STATUS_CHECK,
                    row.sortOrder(),
                    new SkillTriggerStatusConditionDetail(
                        detail.subject(),
                        detail.statusKey(),
                        detail.checkKind(),
                        detail.sourceEffectKey(),
                        detail.sourceResultKey(),
                        detail.comparator(),
                        detail.comparisonFormulaKey()
                    )
                );
            }
            case INTERNAL_STATE_CHECK -> {
                SkillTriggerInternalStateConditionRow detail = internalByKey.remove(key);
                if (detail == null
                    || attributeByKey.containsKey(key)
                    || statusByKey.containsKey(key)
                    || eventValueByKey.containsKey(key)) {
                    throw corrupt(gameId, skillKey, ruleKey, "内部状态条件明细形状损坏");
                }
                yield new SkillTriggerCondition(
                    row.conditionKey(),
                    SkillTriggerConditionType.INTERNAL_STATE_CHECK,
                    row.sortOrder(),
                    new SkillTriggerInternalStateConditionDetail(
                        detail.stateKey(),
                        detail.valueKind(),
                        detail.optionKey(),
                        detail.expectedBoolean(),
                        detail.comparator(),
                        detail.comparisonFormulaKey()
                    )
                );
            }
            case EVENT_VALUE_COMPARE -> {
                SkillTriggerEventValueConditionRow detail = eventValueByKey.remove(key);
                if (detail == null
                    || attributeByKey.containsKey(key)
                    || statusByKey.containsKey(key)
                    || internalByKey.containsKey(key)) {
                    throw corrupt(gameId, skillKey, ruleKey, "事件值条件明细形状损坏");
                }
                yield new SkillTriggerCondition(
                    row.conditionKey(),
                    SkillTriggerConditionType.EVENT_VALUE_COMPARE,
                    row.sortOrder(),
                    new SkillTriggerEventValueConditionDetail(
                        detail.eventValueKey(),
                        detail.comparator(),
                        detail.comparisonFormulaKey()
                    )
                );
            }
        };
    }

    private List<SkillTriggerAction> assembleActions(String gameId, String skillKey, String ruleKey) {
        List<SkillTriggerActionRow> actionRows = nullToEmpty(mapper.listActions(gameId, skillKey, ruleKey));
        Map<String, SkillTriggerEffectActionRow> effectByKey = indexEffectActions(
            gameId, skillKey, ruleKey, mapper.listEffectActions(gameId, skillKey, ruleKey)
        );
        Map<String, SkillTriggerProcessActionRow> processByKey = indexProcessActions(
            gameId, skillKey, ruleKey, mapper.listProcessActions(gameId, skillKey, ruleKey)
        );
        Map<String, List<SkillTriggerRuntimeInputBinding>> bindingsByAction = assembleBindings(
            gameId, skillKey, ruleKey
        );
        Map<String, List<SkillTriggerResultModifier>> modifiersByAction = assembleModifiers(
            gameId, skillKey, ruleKey, effectByKey
        );
        List<SkillTriggerAction> actions = new ArrayList<>();
        for (SkillTriggerActionRow row : actionRows) {
            List<SkillTriggerRuntimeInputBinding> bindings =
                bindingsByAction.remove(row.actionKey());
            List<SkillTriggerResultModifier> modifiers =
                modifiersByAction.remove(row.actionKey());
            actions.add(assembleAction(
                gameId,
                skillKey,
                ruleKey,
                row,
                effectByKey,
                processByKey,
                bindings == null ? List.of() : bindings,
                modifiers == null ? List.of() : modifiers
            ));
        }
        if (!effectByKey.isEmpty() || !processByKey.isEmpty()) {
            throw corrupt(gameId, skillKey, ruleKey, "存在未归属动作明细");
        }
        if (!bindingsByAction.isEmpty() || !modifiersByAction.isEmpty()) {
            throw corrupt(gameId, skillKey, ruleKey, "存在未归属绑定或修正");
        }
        actions.sort(ACTION_ORDER);
        return List.copyOf(actions);
    }

    private SkillTriggerAction assembleAction(
        String gameId,
        String skillKey,
        String ruleKey,
        SkillTriggerActionRow row,
        Map<String, SkillTriggerEffectActionRow> effectByKey,
        Map<String, SkillTriggerProcessActionRow> processByKey,
        List<SkillTriggerRuntimeInputBinding> bindings,
        List<SkillTriggerResultModifier> modifiers
    ) {
        return switch (row.actionType()) {
            case EXECUTE_EFFECT -> {
                SkillTriggerEffectActionRow detail = effectByKey.remove(row.actionKey());
                if (detail == null || processByKey.containsKey(row.actionKey())) {
                    throw corrupt(gameId, skillKey, ruleKey, "执行效果动作明细形状损坏");
                }
                yield new SkillTriggerAction(
                    row.actionKey(),
                    row.name(),
                    SkillTriggerActionType.EXECUTE_EFFECT,
                    row.sortOrder(),
                    row.targetContext(),
                    new SkillTriggerExecuteEffectActionDetail(detail.effectKey()),
                    bindings,
                    modifiers
                );
            }
            case START_PROCESS -> {
                SkillTriggerProcessActionRow detail = processByKey.remove(row.actionKey());
                if (detail == null || effectByKey.containsKey(row.actionKey()) || detail.failureReason() != null) {
                    throw corrupt(gameId, skillKey, ruleKey, "启动过程动作明细形状损坏");
                }
                if (!modifiers.isEmpty()) {
                    throw corrupt(gameId, skillKey, ruleKey, "启动过程动作不能保存结果修正");
                }
                yield new SkillTriggerAction(
                    row.actionKey(),
                    row.name(),
                    SkillTriggerActionType.START_PROCESS,
                    row.sortOrder(),
                    row.targetContext(),
                    new SkillTriggerStartProcessActionDetail(detail.processKey()),
                    bindings,
                    List.of()
                );
            }
            case FAIL_PROCESS -> {
                SkillTriggerProcessActionRow detail = processByKey.remove(row.actionKey());
                if (detail == null
                    || effectByKey.containsKey(row.actionKey())
                    || detail.failureReason() == null
                    || row.targetContext() != null) {
                    throw corrupt(gameId, skillKey, ruleKey, "令过程失败动作明细形状损坏");
                }
                if (!bindings.isEmpty() || !modifiers.isEmpty()) {
                    throw corrupt(gameId, skillKey, ruleKey, "令过程失败动作不能保存绑定或修正");
                }
                yield new SkillTriggerAction(
                    row.actionKey(),
                    row.name(),
                    SkillTriggerActionType.FAIL_PROCESS,
                    row.sortOrder(),
                    null,
                    new SkillTriggerFailProcessActionDetail(detail.processKey(), detail.failureReason()),
                    List.of(),
                    List.of()
                );
            }
        };
    }

    private Map<String, List<SkillTriggerRuntimeInputBinding>> assembleBindings(
        String gameId,
        String skillKey,
        String ruleKey
    ) {
        Map<String, SkillTriggerInternalStateBindingRow> internalByKey = indexInternalStateBindings(
            mapper.listInternalStateBindings(gameId, skillKey, ruleKey)
        );
        Map<String, SkillTriggerCombatStatusBindingRow> combatByKey = indexCombatStatusBindings(
            mapper.listCombatStatusBindings(gameId, skillKey, ruleKey)
        );
        Map<String, SkillTriggerEventValueBindingRow> eventValueByKey = indexEventValueBindings(
            mapper.listEventValueBindings(gameId, skillKey, ruleKey)
        );
        Map<String, SkillTriggerPriorResultBindingRow> priorByKey = indexPriorResultBindings(
            mapper.listPriorResultBindings(gameId, skillKey, ruleKey)
        );
        Map<String, List<SkillTriggerRuntimeInputBinding>> byAction = new LinkedHashMap<>();
        for (SkillTriggerRuntimeInputBindingRow row : nullToEmpty(mapper.listBindings(gameId, skillKey, ruleKey))) {
            String key = bindingIndexKey(row.actionKey(), row.bindingKey());
            SkillTriggerRuntimeInputBinding binding = switch (row.sourceType()) {
                case INTERNAL_STATE -> {
                    SkillTriggerInternalStateBindingRow detail = internalByKey.remove(key);
                    if (detail == null
                        || combatByKey.containsKey(key)
                        || eventValueByKey.containsKey(key)
                        || priorByKey.containsKey(key)) {
                        throw corrupt(gameId, skillKey, ruleKey, "内部状态绑定明细形状损坏");
                    }
                    yield new SkillTriggerRuntimeInputBinding(
                        row.bindingKey(),
                        row.parameterKey(),
                        SkillTriggerRuntimeInputSourceType.INTERNAL_STATE,
                        new SkillTriggerInternalStateBindingDetail(
                            detail.stateKey(),
                            detail.valueKind(),
                            detail.optionKey()
                        )
                    );
                }
                case COMBAT_STATUS -> {
                    SkillTriggerCombatStatusBindingRow detail = combatByKey.remove(key);
                    if (detail == null
                        || internalByKey.containsKey(key)
                        || eventValueByKey.containsKey(key)
                        || priorByKey.containsKey(key)) {
                        throw corrupt(gameId, skillKey, ruleKey, "战斗状态绑定明细形状损坏");
                    }
                    yield new SkillTriggerRuntimeInputBinding(
                        row.bindingKey(),
                        row.parameterKey(),
                        SkillTriggerRuntimeInputSourceType.COMBAT_STATUS,
                        new SkillTriggerCombatStatusBindingDetail(
                            detail.subject(),
                            detail.statusKey(),
                            detail.valueKind(),
                            detail.sourceEffectKey(),
                            detail.sourceResultKey()
                        )
                    );
                }
                case EVENT_VALUE -> {
                    SkillTriggerEventValueBindingRow detail = eventValueByKey.remove(key);
                    if (detail == null
                        || internalByKey.containsKey(key)
                        || combatByKey.containsKey(key)
                        || priorByKey.containsKey(key)) {
                        throw corrupt(gameId, skillKey, ruleKey, "事件值绑定明细形状损坏");
                    }
                    yield new SkillTriggerRuntimeInputBinding(
                        row.bindingKey(),
                        row.parameterKey(),
                        SkillTriggerRuntimeInputSourceType.EVENT_VALUE,
                        new SkillTriggerEventValueBindingDetail(detail.eventValueKey())
                    );
                }
                case PRIOR_ACTION_RESULT -> {
                    SkillTriggerPriorResultBindingRow detail = priorByKey.remove(key);
                    if (detail == null
                        || internalByKey.containsKey(key)
                        || combatByKey.containsKey(key)
                        || eventValueByKey.containsKey(key)) {
                        throw corrupt(gameId, skillKey, ruleKey, "前序结果绑定明细形状损坏");
                    }
                    yield new SkillTriggerRuntimeInputBinding(
                        row.bindingKey(),
                        row.parameterKey(),
                        SkillTriggerRuntimeInputSourceType.PRIOR_ACTION_RESULT,
                        new SkillTriggerPriorResultBindingDetail(
                            detail.sourceActionKey(),
                            detail.sourceResultKey(),
                            detail.outputKind()
                        )
                    );
                }
            };
            byAction.computeIfAbsent(row.actionKey(), ignored -> new ArrayList<>()).add(binding);
        }
        if (!internalByKey.isEmpty() || !combatByKey.isEmpty() || !eventValueByKey.isEmpty() || !priorByKey.isEmpty()) {
            throw corrupt(gameId, skillKey, ruleKey, "存在未归属绑定明细");
        }
        for (List<SkillTriggerRuntimeInputBinding> bindings : byAction.values()) {
            bindings.sort(BINDING_ORDER);
        }
        return byAction;
    }

    private Map<String, List<SkillTriggerResultModifier>> assembleModifiers(
        String gameId,
        String skillKey,
        String ruleKey,
        Map<String, SkillTriggerEffectActionRow> effectByKey
    ) {
        Map<String, List<SkillTriggerResultModifier>> byAction = new LinkedHashMap<>();
        for (SkillTriggerResultModifierRow row : nullToEmpty(mapper.listModifiers(gameId, skillKey, ruleKey))) {
            SkillTriggerEffectActionRow effect = effectByKey.get(row.actionKey());
            if (effect == null || !effect.effectKey().equals(row.effectKey())) {
                throw corrupt(gameId, skillKey, ruleKey, "结果修正不属于执行效果动作");
            }
            byAction.computeIfAbsent(row.actionKey(), ignored -> new ArrayList<>()).add(
                new SkillTriggerResultModifier(
                    row.resultKey(),
                    row.fixedMultiplier(),
                    row.fixedMinValue(),
                    row.fixedMaxValue()
                )
            );
        }
        for (List<SkillTriggerResultModifier> modifiers : byAction.values()) {
            modifiers.sort(MODIFIER_ORDER);
        }
        return byAction;
    }

    private Map<String, SkillTriggerAttributeConditionRow> indexAttributeConditions(
        String gameId,
        String skillKey,
        String ruleKey,
        List<SkillTriggerAttributeConditionRow> rows
    ) {
        Map<String, SkillTriggerAttributeConditionRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerAttributeConditionRow row : nullToEmpty(rows)) {
            if (indexed.put(conditionIndexKey(row.groupKey(), row.conditionKey()), row) != null) {
                throw corrupt(gameId, skillKey, ruleKey, "属性条件明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillTriggerStatusConditionRow> indexStatusConditions(
        String gameId,
        String skillKey,
        String ruleKey,
        List<SkillTriggerStatusConditionRow> rows
    ) {
        Map<String, SkillTriggerStatusConditionRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerStatusConditionRow row : nullToEmpty(rows)) {
            if (indexed.put(conditionIndexKey(row.groupKey(), row.conditionKey()), row) != null) {
                throw corrupt(gameId, skillKey, ruleKey, "状态条件明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillTriggerInternalStateConditionRow> indexInternalStateConditions(
        String gameId,
        String skillKey,
        String ruleKey,
        List<SkillTriggerInternalStateConditionRow> rows
    ) {
        Map<String, SkillTriggerInternalStateConditionRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerInternalStateConditionRow row : nullToEmpty(rows)) {
            if (indexed.put(conditionIndexKey(row.groupKey(), row.conditionKey()), row) != null) {
                throw corrupt(gameId, skillKey, ruleKey, "内部状态条件明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillTriggerEventValueConditionRow> indexEventValueConditions(
        String gameId,
        String skillKey,
        String ruleKey,
        List<SkillTriggerEventValueConditionRow> rows
    ) {
        Map<String, SkillTriggerEventValueConditionRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerEventValueConditionRow row : nullToEmpty(rows)) {
            if (indexed.put(conditionIndexKey(row.groupKey(), row.conditionKey()), row) != null) {
                throw corrupt(gameId, skillKey, ruleKey, "事件值条件明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillTriggerEffectActionRow> indexEffectActions(
        String gameId,
        String skillKey,
        String ruleKey,
        List<SkillTriggerEffectActionRow> rows
    ) {
        Map<String, SkillTriggerEffectActionRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerEffectActionRow row : nullToEmpty(rows)) {
            if (indexed.put(row.actionKey(), row) != null) {
                throw corrupt(gameId, skillKey, ruleKey, "执行效果动作明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillTriggerProcessActionRow> indexProcessActions(
        String gameId,
        String skillKey,
        String ruleKey,
        List<SkillTriggerProcessActionRow> rows
    ) {
        Map<String, SkillTriggerProcessActionRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerProcessActionRow row : nullToEmpty(rows)) {
            if (indexed.put(row.actionKey(), row) != null) {
                throw corrupt(gameId, skillKey, ruleKey, "过程动作明细重复");
            }
        }
        return indexed;
    }

    private static Map<String, SkillTriggerInternalStateBindingRow> indexInternalStateBindings(
        List<SkillTriggerInternalStateBindingRow> rows
    ) {
        Map<String, SkillTriggerInternalStateBindingRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerInternalStateBindingRow row : nullToEmpty(rows)) {
            indexed.put(bindingIndexKey(row.actionKey(), row.bindingKey()), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerCombatStatusBindingRow> indexCombatStatusBindings(
        List<SkillTriggerCombatStatusBindingRow> rows
    ) {
        Map<String, SkillTriggerCombatStatusBindingRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerCombatStatusBindingRow row : nullToEmpty(rows)) {
            indexed.put(bindingIndexKey(row.actionKey(), row.bindingKey()), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerEventValueBindingRow> indexEventValueBindings(
        List<SkillTriggerEventValueBindingRow> rows
    ) {
        Map<String, SkillTriggerEventValueBindingRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerEventValueBindingRow row : nullToEmpty(rows)) {
            indexed.put(bindingIndexKey(row.actionKey(), row.bindingKey()), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerPriorResultBindingRow> indexPriorResultBindings(
        List<SkillTriggerPriorResultBindingRow> rows
    ) {
        Map<String, SkillTriggerPriorResultBindingRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerPriorResultBindingRow row : nullToEmpty(rows)) {
            indexed.put(bindingIndexKey(row.actionKey(), row.bindingKey()), row);
        }
        return indexed;
    }

    private static SkillProcessMomentType parseMomentType(String momentType) {
        if (momentType == null || momentType.isBlank()) {
            return null;
        }
        return SkillProcessMomentType.valueOf(momentType);
    }

    private static String conditionIndexKey(String groupKey, String conditionKey) {
        return groupKey + '\u0000' + conditionKey;
    }

    private static String bindingIndexKey(String actionKey, String bindingKey) {
        return actionKey + '\u0000' + bindingKey;
    }

    private static int countPresent(Object... values) {
        int count = 0;
        for (Object value : values) {
            if (value != null) {
                count++;
            }
        }
        return count;
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private ApiException corrupt(String gameId, String skillKey, String ruleKey, String reason) {
        log.error(
            "Skill trigger rule data corruption detected. gameId={}, skillKey={}, ruleKey={}, reason={}",
            gameId,
            skillKey,
            ruleKey,
            reason
        );
        return new ApiException(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "500.INTERNAL_ERROR",
            "技能触发规则数据损坏",
            Map.of(
                "gameId", gameId,
                "skillKey", skillKey,
                "ruleKey", ruleKey,
                "reason", reason
            )
        );
    }
}
