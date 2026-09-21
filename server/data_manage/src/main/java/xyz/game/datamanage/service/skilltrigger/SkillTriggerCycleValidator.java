package xyz.game.datamanage.service.skilltrigger;

import xyz.game.datamanage.model.value.SkillNumericValue;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDeliveryKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageDeliveryKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageOriginKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthDirection;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLinkEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldownRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimitRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventRow;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class SkillTriggerCycleValidator {

    private static final Set<SkillProcessMomentType> PROCESS_MOMENTS = EnumSet.of(
        SkillProcessMomentType.PROCESS_START,
        SkillProcessMomentType.PROCESS_COMPLETE,
        SkillProcessMomentType.PROCESS_FAILURE
    );
    private static final Set<SkillProcessStepType> TIMEOUT_STEPS = EnumSet.of(
        SkillProcessStepType.CHARGE,
        SkillProcessStepType.RECAST,
        SkillProcessStepType.EMPOWERED_BASIC_ATTACK
    );
    private static final Set<SkillProcessStateOperationKind> VALUE_OPS = EnumSet.of(
        SkillProcessStateOperationKind.INCREASE,
        SkillProcessStateOperationKind.DECREASE,
        SkillProcessStateOperationKind.CONSUME,
        SkillProcessStateOperationKind.SET,
        SkillProcessStateOperationKind.RESET
    );
    private static final Set<SkillProcessStateOperationKind> FLAG_OPS = EnumSet.of(
        SkillProcessStateOperationKind.ENABLE,
        SkillProcessStateOperationKind.DISABLE,
        SkillProcessStateOperationKind.TOGGLE
    );
    private static final Comparator<Edge> EDGE_ORDER = Comparator
        .comparing(Edge::sourceRuleKey)
        .thenComparing(Edge::actionKey)
        .thenComparing(edge -> edge.produced().eventType().name());

    private final SkillTriggerRuleMapper mapper;

    public SkillTriggerCycleValidator(SkillTriggerRuleMapper mapper) {
        this.mapper = mapper;
    }

    public void validateCurrentSkill(String gameId, String skillKey) {
        mapper.listRulesForUpdate(gameId, skillKey);
        Graph graph = loadGraph(gameId, skillKey);
        List<Edge> cycle = findStableCycle(graph);
        if (cycle != null && !cycle.isEmpty()) {
            throw unguardedCycle(cycle);
        }
    }

    private Graph loadGraph(String gameId, String skillKey) {
        List<SkillTriggerRuleRow> rules = nullToEmpty(mapper.listRules(gameId, skillKey));
        Map<String, RuleNode> nodes = new LinkedHashMap<>();
        Set<String> protectedRules = new LinkedHashSet<>();
        for (SkillTriggerPerTargetCooldownRow row : nullToEmpty(mapper.listCooldownsForSkill(gameId, skillKey))) {
            protectedRules.add(row.ruleKey());
        }
        Map<String, SkillTriggerProcessEventRow> processEvents = indexProcessEvents(
            mapper.listProcessEventsForSkill(gameId, skillKey)
        );
        for (SkillTriggerProcessLimitRow row : nullToEmpty(mapper.listProcessLimitsForSkill(gameId, skillKey))) {
            SkillTriggerProcessEventRow event = processEvents.get(row.ruleKey());
            if (event != null
                && event.momentType() != null
                && Objects.equals(event.processKey(), row.processKey())) {
                protectedRules.add(row.ruleKey());
            }
        }
        Map<String, SkillTriggerResultEventRow> resultEvents = indexResultEvents(
            mapper.listResultEventsForSkill(gameId, skillKey)
        );
        Map<String, SkillTriggerLifecycleEventRow> lifecycleEvents = indexLifecycleEvents(
            mapper.listLifecycleEventsForSkill(gameId, skillKey)
        );
        Map<String, SkillTriggerStatusEventRow> statusEvents = indexStatusEvents(
            mapper.listStatusEventsForSkill(gameId, skillKey)
        );
        Map<String, SkillTriggerHealthThresholdEventRow> healthEvents = indexHealthEvents(
            mapper.listHealthEventsForSkill(gameId, skillKey)
        );
        Map<String, SkillTriggerInternalStateEventRow> internalStateEvents = indexInternalStateEvents(
            mapper.listInternalStateEventsForSkill(gameId, skillKey)
        );
        Map<String, SkillTriggerSubjectEventRow> subjectEvents = indexSubjectEvents(
            mapper.listSubjectEventsForSkill(gameId, skillKey)
        );
        Map<String, SkillTriggerDamageEventRow> damageEvents = indexDamageEvents(
            mapper.listDamageEventsForSkill(gameId, skillKey)
        );
        Map<String, SkillTriggerLinkEventRow> linkEvents = indexLinkEvents(
            mapper.listLinkEventsForSkill(gameId, skillKey)
        );
        for (SkillTriggerRuleRow rule : rules) {
            nodes.put(rule.ruleKey(), new RuleNode(
                rule.ruleKey(),
                rule.eventType(),
                protectedRules.contains(rule.ruleKey()),
                eventFilter(
                    rule,
                    processEvents.get(rule.ruleKey()),
                    resultEvents.get(rule.ruleKey()),
                    lifecycleEvents.get(rule.ruleKey()),
                    statusEvents.get(rule.ruleKey()),
                    healthEvents.get(rule.ruleKey()),
                    internalStateEvents.get(rule.ruleKey()),
                    subjectEvents.get(rule.ruleKey()),
                    damageEvents.get(rule.ruleKey()),
                    linkEvents.get(rule.ruleKey())
                )
            ));
        }
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey = indexEffects(
            mapper.listEffectShapes(gameId, skillKey)
        );
        Map<String, List<SkillTriggerProcessShapeRow>> processesByKey = indexProcesses(
            mapper.listProcessShapes(gameId, skillKey)
        );
        Map<String, SkillTriggerEffectActionRow> effectActions = indexEffectActions(
            mapper.listEffectActionsForSkill(gameId, skillKey)
        );
        Map<String, SkillTriggerProcessActionRow> processActions = indexProcessActions(
            mapper.listProcessActionsForSkill(gameId, skillKey)
        );
        List<Edge> edges = new ArrayList<>();
        for (SkillTriggerActionRow action : nullToEmpty(mapper.listActionsForSkill(gameId, skillKey))) {
            List<ProducedEvent> produced = producedEvents(
                action, effectActions, processActions, effectsByKey, processesByKey, skillKey
            );
            for (ProducedEvent event : produced) {
                for (RuleNode target : nodes.values()) {
                    if (matches(event, target.filter())) {
                        edges.add(new Edge(action.ruleKey(), action.actionKey(), event, target.ruleKey()));
                    }
                }
            }
        }
        edges.sort(EDGE_ORDER);
        return new Graph(nodes, edges);
    }

    private static EventFilter eventFilter(
        SkillTriggerRuleRow rule,
        SkillTriggerProcessEventRow processEvent,
        SkillTriggerResultEventRow resultEvent,
        SkillTriggerLifecycleEventRow lifecycleEvent,
        SkillTriggerStatusEventRow statusEvent,
        SkillTriggerHealthThresholdEventRow healthEvent,
        SkillTriggerInternalStateEventRow internalStateEvent,
        SkillTriggerSubjectEventRow subjectEvent,
        SkillTriggerDamageEventRow damageEvent,
        SkillTriggerLinkEventRow linkEvent
    ) {
        return switch (rule.eventType()) {
            case PROCESS_MOMENT -> processEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.processMoment(
                    processEvent.processKey(),
                    parseMomentType(processEvent.momentType()),
                    processEvent.stepKey()
                );
            case RESULT_AVAILABLE -> resultEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.resultAvailable(resultEvent.effectKey(), resultEvent.resultKey());
            case LIFECYCLE_MOMENT -> lifecycleEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.lifecycle(lifecycleEvent.effectKey(), lifecycleEvent.lifecycleMoment());
            case STATUS_CHANGED -> statusEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.statusChanged(statusEvent.statusKey(), statusEvent.changeKind());
            case HEALTH_THRESHOLD_CROSSED -> healthEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.health(healthEvent.subject(), healthEvent.direction(), healthEvent.attributeKey());
            case INTERNAL_STATE_CHANGED -> internalStateEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.internalState(internalStateEvent.stateKey(), internalStateEvent.changeKind());
            case ENTITY_DIED -> subjectEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.entityDied(subjectEvent.subject());
            case DAMAGE_PENDING, DAMAGE_DEALT, DAMAGE_TAKEN -> damageEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.damage(
                    rule.eventType(),
                    damageEvent.damageTypeKey(),
                    damageEvent.deliveryKind(),
                    damageEvent.originKind()
                );
            case HIT_LINK_APPLIED, ATTACK_LINK_APPLIED -> linkEvent == null
                ? EventFilter.none(rule.eventType())
                : EventFilter.link(rule.eventType(), linkEvent.sourceSkillKey());
            default -> EventFilter.wide(rule.eventType());
        };
    }

    private List<ProducedEvent> producedEvents(
        SkillTriggerActionRow action,
        Map<String, SkillTriggerEffectActionRow> effectActions,
        Map<String, SkillTriggerProcessActionRow> processActions,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Map<String, List<SkillTriggerProcessShapeRow>> processesByKey,
        String skillKey
    ) {
        return switch (action.actionType()) {
            case EXECUTE_EFFECT -> {
                SkillTriggerEffectActionRow detail = effectActions.get(actionKey(action));
                if (detail == null) {
                    yield List.of();
                }
                yield produceExecuteEffect(detail.effectKey(), effectsByKey, new LinkedHashSet<>(), skillKey);
            }
            case START_PROCESS -> {
                SkillTriggerProcessActionRow detail = processActions.get(actionKey(action));
                if (detail == null || detail.failureReason() != null) {
                    yield List.of();
                }
                yield produceStartProcess(detail.processKey(), effectsByKey, processesByKey, skillKey);
            }
            case FAIL_PROCESS -> {
                SkillTriggerProcessActionRow detail = processActions.get(actionKey(action));
                if (detail == null || detail.failureReason() == null) {
                    yield List.of();
                }
                yield List.of(ProducedEvent.processMoment(
                    detail.processKey(),
                    SkillProcessMomentType.PROCESS_FAILURE,
                    null
                ));
            }
        };
    }

    private List<ProducedEvent> produceStartProcess(
        String processKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Map<String, List<SkillTriggerProcessShapeRow>> processesByKey,
        String skillKey
    ) {
        List<ProducedEvent> produced = new ArrayList<>();
        Set<String> visitedEffects = new LinkedHashSet<>();
        Set<String> seenSteps = new LinkedHashSet<>();
        for (SkillTriggerProcessShapeRow row : processesByKey.getOrDefault(processKey, List.of())) {
            if (seenSteps.add(processKey)) {
                produced.add(ProducedEvent.processMoment(processKey, SkillProcessMomentType.PROCESS_START, null));
                produced.add(ProducedEvent.processMoment(processKey, SkillProcessMomentType.PROCESS_COMPLETE, null));
                produced.add(ProducedEvent.processMoment(processKey, SkillProcessMomentType.PROCESS_FAILURE, null));
            }
            if (row.stepKey() != null && seenSteps.add(processKey + '\u0000' + row.stepKey())) {
                produced.add(ProducedEvent.processMoment(
                    processKey, SkillProcessMomentType.STEP_START, row.stepKey()
                ));
                produced.add(ProducedEvent.processMoment(
                    processKey, SkillProcessMomentType.STEP_EXECUTION, row.stepKey()
                ));
                produced.add(ProducedEvent.processMoment(
                    processKey, SkillProcessMomentType.STEP_COMPLETE, row.stepKey()
                ));
                if (row.stepType() != null && TIMEOUT_STEPS.contains(row.stepType())) {
                    produced.add(ProducedEvent.processMoment(
                        processKey, SkillProcessMomentType.STEP_TIMEOUT, row.stepKey()
                    ));
                }
            }
            if (row.bindingEffectKey() != null) {
                produced.addAll(produceExecuteEffect(row.bindingEffectKey(), effectsByKey, visitedEffects, skillKey));
            }
            produced.addAll(produceStateOperation(row));
        }
        return produced;
    }

    private static List<ProducedEvent> produceStateOperation(SkillTriggerProcessShapeRow row) {
        if (row.operation() == null || row.operationStateKey() == null) {
            return List.of();
        }
        if (VALUE_OPS.contains(row.operation())
            && (row.stateType() == SkillInternalStateType.COUNTER || row.stateType() == SkillInternalStateType.AMMO)) {
            return List.of(ProducedEvent.internalState(
                row.operationStateKey(),
                SkillTriggerInternalStateChangeKind.VALUE_CHANGED
            ));
        }
        if (row.operation() == SkillProcessStateOperationKind.SELECT
            && row.stateType() == SkillInternalStateType.MODE) {
            return List.of(ProducedEvent.internalState(
                row.operationStateKey(),
                SkillTriggerInternalStateChangeKind.OPTION_SELECTED
            ));
        }
        if (FLAG_OPS.contains(row.operation()) && row.stateType() == SkillInternalStateType.FLAG) {
            return List.of(ProducedEvent.internalState(
                row.operationStateKey(),
                SkillTriggerInternalStateChangeKind.FLAG_CHANGED
            ));
        }
        if (row.operation() == SkillProcessStateOperationKind.RESET
            && row.stateType() == SkillInternalStateType.INTERNAL_COOLDOWN) {
            return List.of(ProducedEvent.internalState(
                row.operationStateKey(),
                SkillTriggerInternalStateChangeKind.COOLDOWN_READY
            ));
        }
        return List.of();
    }

    private List<ProducedEvent> produceExecuteEffect(
        String effectKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Set<String> visitedEffects,
        String skillKey
    ) {
        if (!visitedEffects.add(effectKey)) {
            return List.of();
        }
        List<SkillTriggerEffectShapeRow> results = effectsByKey.getOrDefault(effectKey, List.of());
        List<ProducedEvent> produced = new ArrayList<>();
        boolean lifecycleAnnounced = false;
        for (SkillTriggerEffectShapeRow row : results) {
            if (row.hasLifecycle()) {
                if (!lifecycleAnnounced) {
                    produced.add(ProducedEvent.lifecycle(effectKey, SkillTriggerLifecycleEventMoment.APPLICATION));
                    produced.add(ProducedEvent.lifecycle(effectKey, SkillTriggerLifecycleEventMoment.FULL_STACKS));
                    if (row.periodicIntervalValue() != null) {
                        produced.add(ProducedEvent.lifecycle(effectKey, SkillTriggerLifecycleEventMoment.PERIODIC));
                    }
                    if (row.durationValue() != null
                        && row.expiryMode() != SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY) {
                        produced.add(ProducedEvent.lifecycle(effectKey, SkillTriggerLifecycleEventMoment.NATURAL_END));
                    }
                    lifecycleAnnounced = true;
                }
            } else if (row.resultKey() != null) {
                produced.add(ProducedEvent.resultAvailable(effectKey, row.resultKey()));
            }
            produced.addAll(produceResultSideEffects(row, skillKey));
        }
        return produced;
    }

    private static List<ProducedEvent> produceResultSideEffects(SkillTriggerEffectShapeRow row, String skillKey) {
        List<ProducedEvent> produced = new ArrayList<>();
        SkillTriggerSubject subject = subjectOf(row.target());
        if (row.resultType() != null) {
            switch (row.resultType()) {
            case DAMAGE -> {
                if (row.target() == SkillEffectTarget.TARGET) {
                    produced.add(ProducedEvent.damage(
                        SkillTriggerEventType.DAMAGE_DEALT,
                        row.damageTypeKey(),
                        row.damageDeliveryKind(),
                        row.damageOriginKind()
                    ));
                    produced.add(ProducedEvent.health(SkillTriggerSubject.CURRENT_TARGET, SkillTriggerHealthDirection.DOWNWARD, null));
                    produced.add(ProducedEvent.wide(SkillTriggerEventType.KILL));
                    produced.add(ProducedEvent.wide(SkillTriggerEventType.TAKEDOWN));
                    produced.add(ProducedEvent.entityDied(SkillTriggerSubject.CURRENT_TARGET));
                } else if (row.target() == SkillEffectTarget.SOURCE) {
                    produced.add(ProducedEvent.damage(
                        SkillTriggerEventType.DAMAGE_PENDING,
                        row.damageTypeKey(),
                        row.damageDeliveryKind(),
                        row.damageOriginKind()
                    ));
                    produced.add(ProducedEvent.damage(
                        SkillTriggerEventType.DAMAGE_TAKEN,
                        row.damageTypeKey(),
                        row.damageDeliveryKind(),
                        row.damageOriginKind()
                    ));
                    produced.add(ProducedEvent.health(SkillTriggerSubject.SOURCE, SkillTriggerHealthDirection.DOWNWARD, null));
                    produced.add(ProducedEvent.entityDied(SkillTriggerSubject.SOURCE));
                }
            }
            case DIRECT_HEAL -> {
                if (subject != null) {
                    produced.add(ProducedEvent.health(subject, SkillTriggerHealthDirection.UPWARD, null));
                }
            }
            case ATTRIBUTE_CHANGE -> {
                if (subject != null) {
                    if (row.attributeOperation() == SkillEffectAttributeChangeOperation.INCREASE
                        || row.attributeOperation() == SkillEffectAttributeChangeOperation.SET) {
                        produced.add(ProducedEvent.health(subject, SkillTriggerHealthDirection.UPWARD, row.resultAttributeKey()));
                    }
                    if (row.attributeOperation() == SkillEffectAttributeChangeOperation.DECREASE
                        || row.attributeOperation() == SkillEffectAttributeChangeOperation.SET) {
                        produced.add(ProducedEvent.health(subject, SkillTriggerHealthDirection.DOWNWARD, row.resultAttributeKey()));
                    }
                }
            }
            case STATUS_OPERATION -> {
                if (row.statusKey() != null) {
                    if (row.statusOperation() == SkillEffectStatusOperation.APPLY) {
                        produced.add(ProducedEvent.statusChanged(row.statusKey(), SkillTriggerStatusChangeKind.APPLY));
                    } else if (row.statusOperation() == SkillEffectStatusOperation.REMOVE) {
                        produced.add(ProducedEvent.statusChanged(row.statusKey(), SkillTriggerStatusChangeKind.REMOVE));
                    }
                    if (row.hasLifecycle() && row.statusOperation() == SkillEffectStatusOperation.APPLY) {
                        produced.add(ProducedEvent.statusChanged(row.statusKey(), SkillTriggerStatusChangeKind.REMOVE));
                    }
                }
            }
            case LIFECYCLE_OPERATION -> {
                if (row.lifecycleTargetEffectKey() != null && row.lifecycleOperation() != null) {
                    if (row.lifecycleOperation() == SkillEffectLifecycleOperation.EXTEND_DURATION) {
                        // 延长剩余时长只改变现有实例期限，不产生满层或提前移除事件。
                    } else if (row.lifecycleOperation() == SkillEffectLifecycleOperation.INCREASE
                        || row.lifecycleOperation() == SkillEffectLifecycleOperation.SET) {
                        produced.add(ProducedEvent.lifecycle(
                            row.lifecycleTargetEffectKey(),
                            SkillTriggerLifecycleEventMoment.FULL_STACKS
                        ));
                    }
                    if (row.lifecycleOperation() == SkillEffectLifecycleOperation.DECREASE
                        || row.lifecycleOperation() == SkillEffectLifecycleOperation.SET
                        || row.lifecycleOperation() == SkillEffectLifecycleOperation.CONSUME
                        || row.lifecycleOperation() == SkillEffectLifecycleOperation.REMOVE) {
                        produced.add(ProducedEvent.lifecycle(
                            row.lifecycleTargetEffectKey(),
                            SkillTriggerLifecycleEventMoment.EARLY_REMOVE
                        ));
                    }
                }
            }
            case EXECUTE -> {
                produced.add(ProducedEvent.wide(SkillTriggerEventType.KILL));
                if (row.target() == SkillEffectTarget.TARGET) {
                    produced.add(ProducedEvent.wide(SkillTriggerEventType.TAKEDOWN));
                }
                if (subject != null) {
                    produced.add(ProducedEvent.entityDied(subject));
                }
            }
            case HIT_LINK_APPLICATION -> produced.add(ProducedEvent.link(SkillTriggerEventType.HIT_LINK_APPLIED, skillKey));
            case ATTACK_LINK_APPLICATION -> produced.add(ProducedEvent.link(SkillTriggerEventType.ATTACK_LINK_APPLIED, skillKey));
            case NORMAL_SHIELD -> {
                if (row.hasLifecycle()) {
                    produced.add(ProducedEvent.lifecycle(row.effectKey(), SkillTriggerLifecycleEventMoment.EARLY_REMOVE));
                }
            }
            case RESOURCE_CHANGE, COOLDOWN_CHANGE, DAMAGE_MODIFIER, HEALING_MODIFIER, SHIELD_RECEIVED_MODIFIER,
                DAMAGE_IMMUNITY, HEALTH_FLOOR, SPELL_SHIELD, SKILL_HASTE_MODIFIER, ATTACK_TIMER_RESET -> {
            }
            }
        }
        if (row.spellShieldBlockScope() != null) {
            produced.add(ProducedEvent.wide(SkillTriggerEventType.SPELL_SHIELD_BLOCKED));
        }
        return produced;
    }

    private static boolean matches(ProducedEvent produced, EventFilter filter) {
        if (filter == null || produced == null || produced.eventType() != filter.eventType()) {
            return false;
        }
        return switch (produced.eventType()) {
            case RESULT_AVAILABLE -> Objects.equals(produced.effectKey(), filter.effectKey())
                && Objects.equals(produced.resultKey(), filter.resultKey());
            case LIFECYCLE_MOMENT -> Objects.equals(produced.effectKey(), filter.effectKey())
                && produced.lifecycleMoment() == filter.lifecycleMoment();
            case PROCESS_MOMENT -> Objects.equals(produced.processKey(), filter.processKey())
                && produced.momentType() == filter.momentType()
                && Objects.equals(produced.stepKey(), filter.stepKey());
            case INTERNAL_STATE_CHANGED -> Objects.equals(produced.stateKey(), filter.stateKey())
                && produced.changeKind() == filter.changeKind();
            case STATUS_CHANGED -> Objects.equals(produced.statusKey(), filter.statusKey())
                && produced.change() == filter.change();
            case HEALTH_THRESHOLD_CROSSED -> produced.subject() == filter.subject()
                && produced.direction() == filter.direction()
                && (produced.attributeKey() == null || Objects.equals(produced.attributeKey(), filter.attributeKey()));
            case ENTITY_DIED -> produced.subject() == filter.subject();
            case DAMAGE_PENDING, DAMAGE_DEALT, DAMAGE_TAKEN -> damageMatches(produced.damage(), filter.damage());
            case KILL -> true;
            case TAKEDOWN -> true;
            case SPELL_SHIELD_BLOCKED -> true;
            case HIT_LINK_APPLIED, ATTACK_LINK_APPLIED -> filter.hasSourceSkillFilter()
                && (filter.sourceSkillKey() == null
                    || Objects.equals(filter.sourceSkillKey(), produced.sourceSkillKey()));
            default -> false;
        };
    }

    private static boolean damageMatches(DamageProduced produced, DamageFilter filter) {
        if (produced == null || filter == null) {
            return false;
        }
        if (produced.deliveryKind() == null || produced.originKind() == null
            || filter.deliveryKind() == null || filter.originKind() == null) {
            return false;
        }
        return (filter.damageTypeKey() == null || Objects.equals(filter.damageTypeKey(), produced.damageTypeKey()))
            && (filter.deliveryKind() == SkillTriggerDamageDeliveryKind.ANY
                || filter.deliveryKind().name().equals(produced.deliveryKind().name()))
            && (filter.originKind() == SkillTriggerDamageOriginKind.ANY
                || filter.originKind().name().equals(produced.originKind().name()));
    }

    private List<Edge> findStableCycle(Graph graph) {
        Map<String, List<Edge>> outgoing = new LinkedHashMap<>();
        for (String ruleKey : graph.nodes().keySet()) {
            outgoing.put(ruleKey, new ArrayList<>());
        }
        for (Edge edge : graph.edges()) {
            RuleNode target = graph.nodes().get(edge.targetRuleKey());
            if (target == null || target.protectedRule()) {
                continue;
            }
            outgoing.computeIfAbsent(edge.sourceRuleKey(), ignored -> new ArrayList<>()).add(edge);
        }
        for (List<Edge> edges : outgoing.values()) {
            edges.sort(EDGE_ORDER);
        }
        Set<String> visiting = new LinkedHashSet<>();
        Set<String> visited = new LinkedHashSet<>();
        Map<String, Edge> parent = new LinkedHashMap<>();
        for (String ruleKey : graph.nodes().keySet()) {
            List<Edge> cycle = dfs(ruleKey, outgoing, visiting, visited, parent);
            if (cycle != null) {
                return cycle;
            }
        }
        return null;
    }

    private static List<Edge> dfs(
        String node,
        Map<String, List<Edge>> outgoing,
        Set<String> visiting,
        Set<String> visited,
        Map<String, Edge> parent
    ) {
        if (visited.contains(node)) {
            return null;
        }
        visiting.add(node);
        for (Edge edge : outgoing.getOrDefault(node, List.of())) {
            if (visiting.contains(edge.targetRuleKey())) {
                return reconstruct(edge, parent);
            }
            if (!visited.contains(edge.targetRuleKey())) {
                parent.put(edge.targetRuleKey(), edge);
                List<Edge> cycle = dfs(edge.targetRuleKey(), outgoing, visiting, visited, parent);
                if (cycle != null) {
                    return cycle;
                }
            }
        }
        visiting.remove(node);
        visited.add(node);
        return null;
    }

    private static List<Edge> reconstruct(Edge backEdge, Map<String, Edge> parent) {
        List<Edge> cycle = new ArrayList<>();
        cycle.add(backEdge);
        String cursor = backEdge.sourceRuleKey();
        while (!cursor.equals(backEdge.targetRuleKey())) {
            Edge previous = parent.get(cursor);
            if (previous == null) {
                break;
            }
            cycle.add(0, previous);
            cursor = previous.sourceRuleKey();
            if (cycle.size() > parent.size() + 1) {
                break;
            }
        }
        return cycle;
    }

    private static ApiException unguardedCycle(List<Edge> cycle) {
        Edge reported = cycle.get(0);
        for (Edge edge : cycle) {
            if (EDGE_ORDER.compare(edge, reported) < 0) {
                reported = edge;
            }
        }
        Map<String, Object> producedEvent = new LinkedHashMap<>();
        producedEvent.put("eventType", reported.produced().eventType().name());
        if (reported.produced().processKey() != null) {
            producedEvent.put("processKey", reported.produced().processKey());
        }
        if (reported.produced().momentType() != null) {
            producedEvent.put("momentType", reported.produced().momentType().name());
        }
        if (reported.produced().stepKey() != null) {
            producedEvent.put("stepKey", reported.produced().stepKey());
        }
        if (reported.produced().effectKey() != null) {
            producedEvent.put("effectKey", reported.produced().effectKey());
        }
        if (reported.produced().resultKey() != null) {
            producedEvent.put("resultKey", reported.produced().resultKey());
        }
        if (reported.produced().lifecycleMoment() != null) {
            producedEvent.put("moment", reported.produced().lifecycleMoment().name());
        }
        if (reported.produced().statusKey() != null) {
            producedEvent.put("statusKey", reported.produced().statusKey());
        }
        if (reported.produced().change() != null) {
            producedEvent.put("change", reported.produced().change().name());
        }
        if (reported.produced().subject() != null) {
            producedEvent.put("subject", reported.produced().subject().name());
        }
        if (reported.produced().direction() != null) {
            producedEvent.put("direction", reported.produced().direction().name());
        }
        if (reported.produced().attributeKey() != null) {
            producedEvent.put("attributeKey", reported.produced().attributeKey());
        }
        if (reported.produced().stateKey() != null) {
            producedEvent.put("stateKey", reported.produced().stateKey());
        }
        if (reported.produced().changeKind() != null) {
            producedEvent.put("changeKind", reported.produced().changeKind().name());
        }
        if (reported.produced().sourceSkillKey() != null) {
            producedEvent.put("sourceSkillKey", reported.produced().sourceSkillKey());
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("ruleKey", reported.sourceRuleKey());
        details.put("actionKey", reported.actionKey());
        details.put("producedEvent", producedEvent);
        List<String> path = new ArrayList<>();
        for (Edge edge : cycle) {
            path.add(edge.sourceRuleKey());
        }
        path.add(cycle.get(cycle.size() - 1).targetRuleKey());
        details.put("cyclePath", path);
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.TRIGGER_RULE_CYCLE_UNGUARDED",
            "当前技能规则图存在无保护循环",
            details
        );
    }

    private static SkillTriggerSubject subjectOf(SkillEffectTarget target) {
        if (target == SkillEffectTarget.SOURCE) {
            return SkillTriggerSubject.SOURCE;
        }
        if (target == SkillEffectTarget.TARGET) {
            return SkillTriggerSubject.CURRENT_TARGET;
        }
        return null;
    }

    private static SkillProcessMomentType parseMomentType(String momentType) {
        if (momentType == null || momentType.isBlank()) {
            return null;
        }
        return SkillProcessMomentType.valueOf(momentType);
    }

    private static String actionKey(SkillTriggerActionRow action) {
        return action.ruleKey() + '\u0000' + action.actionKey();
    }

    private static Map<String, SkillTriggerProcessEventRow> indexProcessEvents(
        List<SkillTriggerProcessEventRow> rows
    ) {
        Map<String, SkillTriggerProcessEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerProcessEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerResultEventRow> indexResultEvents(List<SkillTriggerResultEventRow> rows) {
        Map<String, SkillTriggerResultEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerResultEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerLifecycleEventRow> indexLifecycleEvents(
        List<SkillTriggerLifecycleEventRow> rows
    ) {
        Map<String, SkillTriggerLifecycleEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerLifecycleEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerStatusEventRow> indexStatusEvents(List<SkillTriggerStatusEventRow> rows) {
        Map<String, SkillTriggerStatusEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerStatusEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerHealthThresholdEventRow> indexHealthEvents(
        List<SkillTriggerHealthThresholdEventRow> rows
    ) {
        Map<String, SkillTriggerHealthThresholdEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerHealthThresholdEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerInternalStateEventRow> indexInternalStateEvents(
        List<SkillTriggerInternalStateEventRow> rows
    ) {
        Map<String, SkillTriggerInternalStateEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerInternalStateEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerSubjectEventRow> indexSubjectEvents(
        List<SkillTriggerSubjectEventRow> rows
    ) {
        Map<String, SkillTriggerSubjectEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerSubjectEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerDamageEventRow> indexDamageEvents(
        List<SkillTriggerDamageEventRow> rows
    ) {
        Map<String, SkillTriggerDamageEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerDamageEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerLinkEventRow> indexLinkEvents(
        List<SkillTriggerLinkEventRow> rows
    ) {
        Map<String, SkillTriggerLinkEventRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerLinkEventRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey(), row);
        }
        return indexed;
    }

    private static Map<String, List<SkillTriggerEffectShapeRow>> indexEffects(List<SkillTriggerEffectShapeRow> rows) {
        Map<String, List<SkillTriggerEffectShapeRow>> indexed = new LinkedHashMap<>();
        for (SkillTriggerEffectShapeRow row : nullToEmpty(rows)) {
            indexed.computeIfAbsent(row.effectKey(), ignored -> new ArrayList<>()).add(row);
        }
        return indexed;
    }

    private static Map<String, List<SkillTriggerProcessShapeRow>> indexProcesses(
        List<SkillTriggerProcessShapeRow> rows
    ) {
        Map<String, List<SkillTriggerProcessShapeRow>> indexed = new LinkedHashMap<>();
        for (SkillTriggerProcessShapeRow row : nullToEmpty(rows)) {
            indexed.computeIfAbsent(row.processKey(), ignored -> new ArrayList<>()).add(row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerEffectActionRow> indexEffectActions(List<SkillTriggerEffectActionRow> rows) {
        Map<String, SkillTriggerEffectActionRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerEffectActionRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey() + '\u0000' + row.actionKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerProcessActionRow> indexProcessActions(
        List<SkillTriggerProcessActionRow> rows
    ) {
        Map<String, SkillTriggerProcessActionRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerProcessActionRow row : nullToEmpty(rows)) {
            indexed.put(row.ruleKey() + '\u0000' + row.actionKey(), row);
        }
        return indexed;
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private record RuleNode(String ruleKey, SkillTriggerEventType eventType, boolean protectedRule, EventFilter filter) {
    }

    private record Graph(Map<String, RuleNode> nodes, List<Edge> edges) {
    }

    private record Edge(String sourceRuleKey, String actionKey, ProducedEvent produced, String targetRuleKey) {
    }

    private record ProducedEvent(
        SkillTriggerEventType eventType,
        String processKey,
        SkillProcessMomentType momentType,
        String stepKey,
        String effectKey,
        String resultKey,
        SkillTriggerLifecycleEventMoment lifecycleMoment,
        SkillTriggerSubject subject,
        String statusKey,
        SkillTriggerStatusChangeKind change,
        SkillTriggerHealthDirection direction,
        String attributeKey,
        String stateKey,
        SkillTriggerInternalStateChangeKind changeKind,
        DamageProduced damage,
        String sourceSkillKey
    ) {
        static ProducedEvent wide(SkillTriggerEventType eventType) {
            return new ProducedEvent(
                eventType, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null
            );
        }

        static ProducedEvent link(SkillTriggerEventType eventType, String sourceSkillKey) {
            return new ProducedEvent(
                eventType, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
                sourceSkillKey
            );
        }

        static ProducedEvent damage(
            SkillTriggerEventType eventType,
            String damageTypeKey,
            SkillEffectDamageDeliveryKind deliveryKind,
            SkillEffectDamageOriginKind originKind
        ) {
            return new ProducedEvent(
                eventType,
                null, null, null, null, null, null, null, null, null, null, null, null, null,
                new DamageProduced(damageTypeKey, deliveryKind, originKind),
                null
            );
        }

        static ProducedEvent processMoment(String processKey, SkillProcessMomentType momentType, String stepKey) {
            return new ProducedEvent(
                SkillTriggerEventType.PROCESS_MOMENT,
                processKey, momentType, stepKey, null, null, null, null, null, null, null, null, null, null, null, null
            );
        }

        static ProducedEvent resultAvailable(String effectKey, String resultKey) {
            return new ProducedEvent(
                SkillTriggerEventType.RESULT_AVAILABLE,
                null, null, null, effectKey, resultKey, null, null, null, null, null, null, null, null, null, null
            );
        }

        static ProducedEvent lifecycle(String effectKey, SkillTriggerLifecycleEventMoment moment) {
            return new ProducedEvent(
                SkillTriggerEventType.LIFECYCLE_MOMENT,
                null, null, null, effectKey, null, moment, null, null, null, null, null, null, null, null, null
            );
        }

        static ProducedEvent statusChanged(String statusKey, SkillTriggerStatusChangeKind change) {
            return new ProducedEvent(
                SkillTriggerEventType.STATUS_CHANGED,
                null, null, null, null, null, null, null, statusKey, change, null, null, null, null, null, null
            );
        }

        static ProducedEvent health(
            SkillTriggerSubject subject,
            SkillTriggerHealthDirection direction,
            String attributeKey
        ) {
            return new ProducedEvent(
                SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED,
                null, null, null, null, null, null, subject, null, null, direction, attributeKey, null, null, null, null
            );
        }

        static ProducedEvent entityDied(SkillTriggerSubject subject) {
            return new ProducedEvent(
                SkillTriggerEventType.ENTITY_DIED,
                null, null, null, null, null, null, subject, null, null, null, null, null, null, null, null
            );
        }

        static ProducedEvent internalState(String stateKey, SkillTriggerInternalStateChangeKind changeKind) {
            return new ProducedEvent(
                SkillTriggerEventType.INTERNAL_STATE_CHANGED,
                null, null, null, null, null, null, null, null, null, null, null, stateKey, changeKind, null, null
            );
        }
    }

    private record EventFilter(
        SkillTriggerEventType eventType,
        String processKey,
        SkillProcessMomentType momentType,
        String stepKey,
        String effectKey,
        String resultKey,
        SkillTriggerLifecycleEventMoment lifecycleMoment,
        SkillTriggerSubject subject,
        String statusKey,
        SkillTriggerStatusChangeKind change,
        SkillTriggerHealthDirection direction,
        String attributeKey,
        String stateKey,
        SkillTriggerInternalStateChangeKind changeKind,
        DamageFilter damage,
        String sourceSkillKey,
        boolean hasSourceSkillFilter
    ) {
        static EventFilter none(SkillTriggerEventType eventType) {
            return new EventFilter(
                eventType, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, false
            );
        }

        static EventFilter damage(
            SkillTriggerEventType eventType,
            String damageTypeKey,
            SkillTriggerDamageDeliveryKind deliveryKind,
            SkillTriggerDamageOriginKind originKind
        ) {
            return new EventFilter(
                eventType,
                null, null, null, null, null, null, null, null, null, null, null, null, null,
                new DamageFilter(damageTypeKey, deliveryKind, originKind),
                null,
                false
            );
        }

        static EventFilter wide(SkillTriggerEventType eventType) {
            return none(eventType);
        }

        static EventFilter link(SkillTriggerEventType eventType, String sourceSkillKey) {
            return new EventFilter(
                eventType, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
                sourceSkillKey, true
            );
        }

        static EventFilter processMoment(String processKey, SkillProcessMomentType momentType, String stepKey) {
            return new EventFilter(
                SkillTriggerEventType.PROCESS_MOMENT,
                processKey, momentType, stepKey, null, null, null, null, null, null, null, null, null, null, null, null, false
            );
        }

        static EventFilter resultAvailable(String effectKey, String resultKey) {
            return new EventFilter(
                SkillTriggerEventType.RESULT_AVAILABLE,
                null, null, null, effectKey, resultKey, null, null, null, null, null, null, null, null, null, null, false
            );
        }

        static EventFilter lifecycle(String effectKey, SkillTriggerLifecycleEventMoment moment) {
            return new EventFilter(
                SkillTriggerEventType.LIFECYCLE_MOMENT,
                null, null, null, effectKey, null, moment, null, null, null, null, null, null, null, null, null, false
            );
        }

        static EventFilter statusChanged(String statusKey, SkillTriggerStatusChangeKind change) {
            return new EventFilter(
                SkillTriggerEventType.STATUS_CHANGED,
                null, null, null, null, null, null, null, statusKey, change, null, null, null, null, null, null, false
            );
        }

        static EventFilter health(
            SkillTriggerSubject subject,
            SkillTriggerHealthDirection direction,
            String attributeKey
        ) {
            return new EventFilter(
                SkillTriggerEventType.HEALTH_THRESHOLD_CROSSED,
                null, null, null, null, null, null, subject, null, null, direction, attributeKey, null, null, null, null, false
            );
        }

        static EventFilter entityDied(SkillTriggerSubject subject) {
            return new EventFilter(
                SkillTriggerEventType.ENTITY_DIED,
                null, null, null, null, null, null, subject, null, null, null, null, null, null, null, null, false
            );
        }

        static EventFilter internalState(String stateKey, SkillTriggerInternalStateChangeKind changeKind) {
            return new EventFilter(
                SkillTriggerEventType.INTERNAL_STATE_CHANGED,
                null, null, null, null, null, null, null, null, null, null, null, stateKey, changeKind, null, null, false
            );
        }
    }

    private record DamageProduced(
        String damageTypeKey,
        SkillEffectDamageDeliveryKind deliveryKind,
        SkillEffectDamageOriginKind originKind
    ) {
    }

    private record DamageFilter(
        String damageTypeKey,
        SkillTriggerDamageDeliveryKind deliveryKind,
        SkillTriggerDamageOriginKind originKind
    ) {
    }
}
