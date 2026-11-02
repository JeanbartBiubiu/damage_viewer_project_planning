package xyz.game.datamanage.service.skilltrigger.reference;

import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.conditionStateValueMatches;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.findResult;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.indexEffects;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.indexProcesses;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.internalStateChangeMatches;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.internalStateValueMatches;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.isEligibleSpellShieldEffect;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.fieldIssue;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.nullToEmpty;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.resultPath;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicy;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampOverride;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAdvanceProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageOriginKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateOperation;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerModifyInternalStateActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputs;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerReferenceHit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifier;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusCheckKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleAssembler;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuntimeInputAnalyzer;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.SkillLifecycleConditionSemantics;
import xyz.game.datamanage.support.error.ApiException;

/** 保护仍被触发规则使用的业务对象，并复核统一保存的最终组合。 */
@org.springframework.stereotype.Component
public class SkillTriggerReferenceGuard {

    private final SkillTriggerRuleMapper mapper;
    private final SkillTriggerRuntimeInputAnalyzer analyzer;
    private final SkillTriggerRuleAssembler assembler;
    private final SkillTriggerCatalogValidator catalogs;

    public SkillTriggerReferenceGuard(SkillTriggerRuleMapper mapper, SkillTriggerRuntimeInputAnalyzer analyzer,
        SkillTriggerRuleAssembler assembler, SkillTriggerCatalogValidator catalogs) {
        this.mapper = mapper;
        this.analyzer = analyzer;
        this.assembler = assembler;
        this.catalogs = catalogs;
    }

    public void validateAffectedConfigurationFinal(
        String gameId, String skillKey, Collection<String> changedEffectKeys,
        Collection<String> changedProcessKeys, Collection<String> changedStateKeys
    ) {
        Set<String> effects = changedEffectKeys == null ? Set.of() : Set.copyOf(changedEffectKeys);
        Set<String> processes = changedProcessKeys == null ? Set.of() : Set.copyOf(changedProcessKeys);
        Set<String> states = changedStateKeys == null ? Set.of() : Set.copyOf(changedStateKeys);
        if (effects.isEmpty() && processes.isEmpty() && states.isEmpty()) return;
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes = indexEffects(mapper.listEffectShapes(gameId, skillKey));
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes = indexProcesses(mapper.listProcessShapes(gameId, skillKey));
        List<Map<String, String>> issues = new ArrayList<>();
        for (SkillTriggerRuleRow row : nullToEmpty(mapper.listRulesForGame(gameId))) {
            SkillTriggerRuleDetailResponse rule = assembler.assemble(row);
            String sourceSkillKey = row.skillKey();
            SkillTriggerEventSource event = rule.eventSource();
            if (event != null) {
                if (skillKey.equals(sourceSkillKey) && event.detail() instanceof SkillTriggerResultEventDetail result
                    && effects.contains(result.effectKey())) {
                    SkillTriggerEffectShapeRow shape = findResult(effectShapes, result.effectKey(), result.resultKey());
                    if (shape == null || shape.hasLifecycle())
                        issues.add(fieldIssue("eventSource.detail.resultKey", "TRIGGER_RULE_SHAPE_IN_USE", "结果事件对应结果不存在或已改为生命周期结果"));
                }
                if (skillKey.equals(sourceSkillKey) && event.detail() instanceof SkillTriggerLifecycleEventDetail lifecycle
                    && effects.contains(lifecycle.effectKey())) {
                    catalogs.validateEventCatalog(gameId, skillKey, event, effectShapes, processShapes, Map.of(), issues);
                }
                if (skillKey.equals(sourceSkillKey) && event.detail() instanceof SkillTriggerProcessEventDetail process
                    && processes.contains(process.processKey())) {
                    catalogs.validateProcessMoment(gameId, skillKey, process.processKey(), process.moment(),
                        "eventSource.detail", processShapes, issues);
                }
                if (event.detail() instanceof SkillTriggerInternalStateEventDetail state
                    && states.contains(state.stateKey()) && skillKey.equals(readOwner(state.stateSkillKey(), sourceSkillKey))) {
                    SkillTriggerInternalStateLockRow target = findState(gameId, skillKey, state.stateKey());
                    if (target == null || !internalStateChangeMatches(target.stateType(), state.changeKind()))
                        issues.add(fieldIssue("eventSource.detail.changeKind", "TRIGGER_RULE_SHAPE_IN_USE", "状态变化事件与最终状态种类不匹配"));
                }
            }
            for (SkillTriggerConditionGroup group : nullToEmpty(rule.conditionGroups())) {
                for (SkillTriggerCondition condition : nullToEmpty(group.conditions())) {
                    String prefix = "conditionGroups[" + group.groupKey() + "].conditions[" + condition.conditionKey() + "].detail";
                    if (condition.detail() instanceof SkillTriggerStatusConditionDetail status
                        && (status.checkKind() == SkillTriggerStatusCheckKind.STACKS_COMPARE
                            || status.checkKind() == SkillTriggerStatusCheckKind.REMAINING_MS_COMPARE)
                        && effects.contains(status.sourceEffectKey())
                        && skillKey.equals(readOwner(status.effectSkillKey(), sourceSkillKey))
                        && mapper.countStatusApplyPersistent(gameId, skillKey, status.sourceEffectKey(),
                            status.sourceResultKey(), status.statusKey()) <= 0) {
                        issues.add(fieldIssue(prefix + ".sourceResultKey", "TRIGGER_RULE_SHAPE_IN_USE", "持续状态结果已不符合来源与身份要求"));
                    }
                    if (condition.detail() instanceof SkillTriggerLifecycleConditionDetail lifecycle
                        && effects.contains(lifecycle.effectKey())
                        && skillKey.equals(readOwner(lifecycle.effectSkillKey(), sourceSkillKey))) {
                        issues.addAll(SkillLifecycleConditionSemantics.subjectIssues(lifecycle,
                            mapper.findLifecycleScope(gameId, skillKey, lifecycle.effectKey()),
                            event == null ? null : event.eventType(), prefix));
                    }
                    if (condition.detail() instanceof SkillTriggerInternalStateConditionDetail state
                        && states.contains(state.stateKey())
                        && skillKey.equals(readOwner(state.stateSkillKey(), sourceSkillKey))) {
                        SkillTriggerInternalStateLockRow target = findState(gameId, skillKey, state.stateKey());
                        if (!conditionStateValueMatches(sourceSkillKey, event, state, target))
                            issues.add(fieldIssue(prefix + ".valueKind", "TRIGGER_RULE_SHAPE_IN_USE", "状态取值方式与最终状态种类不匹配"));
                        if (state.valueKind() == SkillTriggerInternalStateValueKind.OPTION_SELECTED
                            && state.optionKey() != null && nullToEmpty(mapper.lockOptions(gameId, skillKey,
                                state.stateKey(), List.of(state.optionKey()))).isEmpty())
                            issues.add(fieldIssue(prefix + ".optionKey", "TRIGGER_RULE_SHAPE_IN_USE", "模式选项已不存在"));
                    }
                    if (condition.detail() instanceof SkillTriggerEventValueConditionDetail value
                        && value.shieldResult() != null && skillKey.equals(sourceSkillKey)
                        && effects.contains(value.shieldResult().path("effectKey").asText())) {
                        catalogs.validateShieldResultCatalog(gameId, sourceSkillKey, value, prefix, effectShapes, issues);
                    }
                }
            }
            for (SkillTriggerAction action : nullToEmpty(rule.actions())) {
                if (action.detail() instanceof SkillTriggerModifyInternalStateActionDetail modify
                    && states.contains(modify.stateKey()) && skillKey.equals(modify.stateSkillKey())
                    && (modify.operation() == SkillTriggerInternalStateOperation.ENSURE_REMAINING
                        || modify.operation() == SkillTriggerInternalStateOperation.ENSURE_REMAINING_PRESERVE_PHASE)) {
                    var target = findState(gameId, skillKey, modify.stateKey());
                    Map<String, SkillTriggerInternalStateLockRow> finalStates = target == null ? Map.of()
                        : Map.of(modify.stateSkillKey() + "\0" + modify.stateKey(), target);
                    catalogs.validateActionCatalog(gameId, sourceSkillKey, event, action, "actions[" + action.actionKey() + "]",
                        effectShapes, processShapes, finalStates, issues);
                }
                if (skillKey.equals(sourceSkillKey)
                    && action.detail() instanceof SkillTriggerAdvanceProcessActionDetail advance
                    && processes.contains(advance.processKey())) {
                    catalogs.validateActionCatalog(gameId, skillKey, event, action, "actions[" + action.actionKey() + "]",
                        effectShapes, processShapes, Map.of(), issues);
                }
                for (SkillTriggerRuntimeInputBinding binding : nullToEmpty(action.runtimeInputBindings())) {
                    String prefix = "actions[" + action.actionKey() + "].runtimeInputBindings[" + binding.bindingKey() + "].detail";
                    if (binding.detail() instanceof SkillTriggerCombatStatusBindingDetail status
                        && effects.contains(status.sourceEffectKey())
                        && skillKey.equals(readOwner(status.effectSkillKey(), sourceSkillKey))
                        && (status.valueKind() == SkillTriggerCombatStatusValueKind.STACKS
                            || status.valueKind() == SkillTriggerCombatStatusValueKind.REMAINING_MS)
                        && mapper.countStatusApplyPersistent(gameId, skillKey, status.sourceEffectKey(),
                            status.sourceResultKey(), status.statusKey()) <= 0)
                        issues.add(fieldIssue(prefix + ".sourceResultKey", "TRIGGER_RULE_SHAPE_IN_USE", "持续状态输入已不符合来源与身份要求"));
                    if (binding.detail() instanceof SkillTriggerInternalStateBindingDetail state
                        && states.contains(state.stateKey())
                        && skillKey.equals(readOwner(state.stateSkillKey(), sourceSkillKey))) {
                        SkillTriggerInternalStateLockRow target = findState(gameId, skillKey, state.stateKey());
                        if (target == null || !internalStateValueMatches(target.stateType(), state.valueKind()))
                            issues.add(fieldIssue(prefix + ".valueKind", "TRIGGER_RULE_SHAPE_IN_USE", "状态供值方式与最终状态种类不匹配"));
                        if (state.valueKind() == SkillTriggerInternalStateValueKind.OPTION_SELECTED
                            && state.optionKey() != null && nullToEmpty(mapper.lockOptions(gameId, skillKey,
                                state.stateKey(), List.of(state.optionKey()))).isEmpty())
                            issues.add(fieldIssue(prefix + ".optionKey", "TRIGGER_RULE_SHAPE_IN_USE", "模式选项已不存在"));
                    }
                    if (skillKey.equals(sourceSkillKey) && binding.detail() instanceof SkillTriggerPriorResultBindingDetail prior) {
                        SkillTriggerAction source = nullToEmpty(rule.actions()).stream()
                            .filter(other -> Objects.equals(other.actionKey(), prior.sourceActionKey())).findFirst().orElse(null);
                        if (source != null && source.detail() instanceof SkillTriggerExecuteEffectActionDetail execute
                            && effects.contains(execute.effectKey())) {
                            SkillTriggerEffectShapeRow shape = findResult(effectShapes, execute.effectKey(), prior.sourceResultKey());
                            if (shape == null || !SkillTriggerPriorResultOutputs.immediatelyAvailable(
                                SkillTriggerPriorResultOutputs.Shape.from(shape))
                                || !SkillTriggerPriorResultOutputs.available(
                                    SkillTriggerPriorResultOutputs.Shape.from(shape), prior.outputKind()))
                                issues.add(fieldIssue(prefix + ".sourceResultKey", "TRIGGER_RULE_SHAPE_IN_USE", "前序结果输出已不可用"));
                        }
                    }
                }
                if (skillKey.equals(sourceSkillKey) && action.detail() instanceof SkillTriggerExecuteEffectActionDetail execute
                    && effects.contains(execute.effectKey())) {
                    for (SkillTriggerResultModifier modifier : nullToEmpty(action.resultModifiers())) {
                        SkillTriggerEffectShapeRow shape = findResult(effectShapes, execute.effectKey(), modifier.resultKey());
                        if (shape == null || !shape.hasValueRule() || shape.resultType() == SkillEffectResultType.STATUS_OPERATION)
                            issues.add(fieldIssue("actions[" + action.actionKey() + "].resultModifiers[" + modifier.resultKey() + "]",
                                "TRIGGER_RULE_SHAPE_IN_USE", "最终结果已不支持固定修正"));
                    }
                }
            }
        }
        if (!issues.isEmpty()) {
            issues.sort(Comparator.comparing(issue -> issue.get("field")));
            throw new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID",
                "变更后的对象使既有触发规则失效", Map.of("fieldIssues", List.copyOf(issues)));
        }
    }

    private SkillTriggerInternalStateLockRow findState(String gameId, String skillKey, String stateKey) {
        return nullToEmpty(mapper.lockInternalStates(gameId, skillKey, List.of(stateKey))).stream().findFirst().orElse(null);
    }

    private static String readOwner(String explicit, String sourceSkillKey) {
        return explicit == null ? sourceSkillKey : explicit;
    }

    public void assertSourceSkillNotReferenced(String gameId, String skillKey) {
        if (mapper.countSourceSkillReferences(gameId, skillKey) > 0) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_IN_USE",
                "技能仍被其他技能的触发规则引用，不能删除",
                Map.of("fieldIssues", List.of(fieldIssue("skillKey", "CONFLICT", "技能仍被其他技能的触发规则引用，不能删除")))
            );
        }
    }

    public boolean hasEffectReferences(String gameId, String skillKey, String effectKey) {
        return mapper.countEffectReferences(gameId, skillKey, effectKey) > 0;
    }

    public void assertEffectDeletable(String gameId, String skillKey, String effectKey) {
        if (mapper.countEffectReferences(gameId, skillKey, effectKey) > 0) {
            throw effectInUse(List.of(fieldIssue(
                "effectKey",
                "TRIGGER_RULE_EFFECT_IN_USE",
                "技能效果仍被触发规则引用，不能删除"
            )));
        }
    }

    public List<Map<String, String>> effectDeleteIssues(String gameId, String skillKey, String effectKey) {
        if (mapper.countEffectReferences(gameId, skillKey, effectKey) > 0) {
            return List.of(fieldIssue(
                "effectKey",
                "TRIGGER_RULE_EFFECT_IN_USE",
                "技能效果仍被触发规则引用，不能删除"
            ));
        }
        return List.of();
    }

    public void assertEffectUpdate(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectLifecycleRow existingLifecycle,
        SkillEffectLifecycleRequest candidateLifecycle,
        List<SkillEffectResultRequest> candidateResults,
        List<String> removedResultKeys
    ) {
        mapper.listRulesForUpdate(gameId, skillKey);
        List<Map<String, String>> inUse = new ArrayList<>();
        if (!removedResultKeys.isEmpty()) {
            for (SkillTriggerReferenceHit hit : nullToEmpty(
                mapper.listResultReferences(gameId, skillKey, effectKey, removedResultKeys)
            )) {
                inUse.add(fieldIssue(
                    "results",
                    "TRIGGER_RULE_RESULT_IN_USE",
                    "结果仍被触发规则引用，不能移除",
                    hit.rejectedValue()
                ));
            }
        }
        if (existingLifecycle != null && candidateLifecycle == null
            && mapper.countLifecycleReferences(gameId, skillKey, effectKey) > 0) {
            inUse.add(fieldIssue(
                "lifecycle",
                "TRIGGER_RULE_LIFECYCLE_IN_USE",
                "生命周期仍被触发规则引用，不能移除"
            ));
        }
        if (mapper.countSpellShieldBlockedEventReferences(gameId, skillKey, effectKey) > 0
            && !isEligibleSpellShieldEffect(candidateLifecycle, candidateResults)) {
            inUse.add(fieldIssue(
                "results",
                "TRIGGER_RULE_SPELL_SHIELD_EVENT_IN_USE",
                "效果仍被法术护盾已阻挡事件引用，必须保留持续生效的法术护盾结果"
            ));
        }
        if (!inUse.isEmpty()) {
            inUse.sort(Comparator.comparing(issue -> issue.get("field")));
            throw effectInUse(inUse);
        }
        assertReflectedEffectUpdate(gameId, skillKey, effectKey, candidateResults);
        assertValueCompatibility(gameId, skillKey, effectKey, candidateResults);
        List<Map<String, String>> shapeIssues = collectEffectShapeIssues(
            gameId, skillKey, effectKey, candidateLifecycle, candidateResults
        );
        if (!shapeIssues.isEmpty()) {
            shapeIssues.sort(Comparator
                .comparing((Map<String, String> issue) -> issue.getOrDefault("ruleKey", ""))
                .thenComparing(issue -> issue.getOrDefault("actionKey", ""))
                .thenComparing(issue -> issue.getOrDefault("bindingKey", ""))
                .thenComparing(issue -> issue.getOrDefault("outputKind", ""))
                .thenComparing(issue -> issue.getOrDefault("field", "")));
            throw effectInUse(shapeIssues);
        }
    }

    private void assertValueCompatibility(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectResultRequest> candidateResults
    ) {
        Set<SkillNumericValue> candidateInteractionValues = collectInteractionValues(candidateResults);
        Set<SkillNumericValue> existingInteractionValues = new LinkedHashSet<>(
            nullToEmpty(mapper.listEffectInteractionValues(gameId, skillKey, effectKey)).stream().map(json -> AggregateJson.read(json, SkillNumericValue.class)).toList()
        );
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes = indexEffects(
            mapper.listEffectShapes(gameId, skillKey)
        );
        Set<SkillNumericValue> existingValues = effectShapes.getOrDefault(effectKey, List.of()).stream()
            .map(SkillTriggerEffectShapeRow::value)
            .filter(Objects::nonNull)
            .collect(Collectors.toCollection(LinkedHashSet::new));
        Set<SkillNumericValue> candidateValues = collectResultValues(candidateResults);
        if (candidateInteractionValues.equals(existingInteractionValues)
            && candidateValues.equals(existingValues)) {
            return;
        }
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes = indexProcesses(
            mapper.listProcessShapes(gameId, skillKey)
        );
        Map<String, SkillTriggerEffectActionRow> effectActions = new LinkedHashMap<>();
        for (SkillTriggerEffectActionRow row : nullToEmpty(mapper.listEffectActionsForSkill(gameId, skillKey))) {
            effectActions.put(row.ruleKey() + '\u0000' + row.actionKey(), row);
        }
        Map<String, SkillTriggerProcessActionRow> processActions = new LinkedHashMap<>();
        for (SkillTriggerProcessActionRow row : nullToEmpty(mapper.listProcessActionsForSkill(gameId, skillKey))) {
            processActions.put(row.ruleKey() + '\u0000' + row.actionKey(), row);
        }
        List<RuntimeInputDependencyHit> hits = new ArrayList<>();
        Map<String, Collection<SkillNumericValue>> interactionOverrides = Map.of(
            effectKey,
            candidateInteractionValues
        );
        Map<String, Collection<SkillNumericValue>> valueOverrides = Map.of(effectKey, candidateValues);
        for (SkillTriggerActionRow action : nullToEmpty(mapper.listActionsForSkill(gameId, skillKey))) {
            String compositeKey = action.ruleKey() + '\u0000' + action.actionKey();
            String targetKey = switch (action.actionType()) {
                case EXECUTE_EFFECT -> {
                    SkillTriggerEffectActionRow row = effectActions.get(compositeKey);
                    yield row == null ? null : row.effectKey();
                }
                case START_PROCESS -> {
                    SkillTriggerProcessActionRow row = processActions.get(compositeKey);
                    yield row == null ? null : row.processKey();
                }
                case FAIL_PROCESS, ADVANCE_PROCESS, MODIFY_INTERNAL_STATE -> null;
            };
            if (targetKey == null) {
                continue;
            }
            Map<String, SkillParameterValueType> existingReachable = analyzer.reachableRuntimeParameters(
                gameId,
                skillKey,
                action.actionType(),
                targetKey,
                effectShapes,
                processShapes
            );
            Map<String, SkillParameterValueType> candidateReachable = analyzer.reachableRuntimeParameters(
                gameId,
                skillKey,
                action.actionType(),
                targetKey,
                effectShapes,
                processShapes,
                interactionOverrides,
                valueOverrides
            );
            Set<String> parameters = new LinkedHashSet<>(existingReachable.keySet());
            parameters.addAll(candidateReachable.keySet());
            for (String parameterKey : parameters) {
                if (!Objects.equals(existingReachable.get(parameterKey), candidateReachable.get(parameterKey))) {
                    hits.add(new RuntimeInputDependencyHit(action.ruleKey(), action.actionKey(), parameterKey));
                }
            }
        }
        if (hits.isEmpty()) {
            return;
        }
        hits.sort(Comparator
            .comparing(RuntimeInputDependencyHit::ruleKey)
            .thenComparing(RuntimeInputDependencyHit::actionKey)
            .thenComparing(RuntimeInputDependencyHit::parameterKey));
        List<String> paths = collectResultValuePaths(candidateResults);
        paths.addAll(collectInteractionValuePaths(candidateResults));
        String field = paths.isEmpty() ? "results" : paths.get(0);
        List<Map<String, String>> issues = new ArrayList<>();
        for (RuntimeInputDependencyHit hit : hits) {
            Map<String, String> issue = fieldIssue(
                field,
                "TRIGGER_RULE_RUNTIME_INPUT_IN_USE",
                "效果取值变化会改变既有触发规则的计算时参数",
                hit.ruleKey() + "/" + hit.actionKey() + "/" + hit.parameterKey()
            );
            issue.put("ruleKey", hit.ruleKey());
            issue.put("actionKey", hit.actionKey());
            issue.put("parameterKey", hit.parameterKey());
            issues.add(issue);
        }
        throw effectInUse(issues);
    }

    private void assertReflectedEffectUpdate(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectResultRequest> candidateResults
    ) {
        int reflectedResultIndex = -1;
        for (int i = 0; i < candidateResults.size(); i++) {
            SkillEffectResultRequest result = candidateResults.get(i);
            if (result != null
                && result.resultType() == SkillEffectResultType.DAMAGE
                && result.detail() instanceof SkillEffectDamageDetail damage
                && damage.originKind() == SkillEffectDamageOriginKind.REFLECTED) {
                reflectedResultIndex = i;
                break;
            }
        }
        if (reflectedResultIndex < 0) {
            return;
        }
        Map<String, SkillTriggerRuleRow> rules = new LinkedHashMap<>();
        for (SkillTriggerRuleRow row : nullToEmpty(mapper.listRules(gameId, skillKey))) {
            rules.put(row.ruleKey(), row);
        }
        Map<String, SkillTriggerActionRow> actions = new LinkedHashMap<>();
        for (SkillTriggerActionRow row : nullToEmpty(mapper.listActionsForSkill(gameId, skillKey))) {
            actions.put(row.ruleKey() + '\u0000' + row.actionKey(), row);
        }
        Map<String, SkillTriggerEffectActionRow> effectActions = new LinkedHashMap<>();
        for (SkillTriggerEffectActionRow row : nullToEmpty(mapper.listEffectActionsForSkill(gameId, skillKey))) {
            effectActions.put(row.ruleKey() + '\u0000' + row.actionKey(), row);
        }
        Map<String, SkillTriggerProcessActionRow> processActions = new LinkedHashMap<>();
        for (SkillTriggerProcessActionRow row : nullToEmpty(mapper.listProcessActionsForSkill(gameId, skillKey))) {
            processActions.put(row.ruleKey() + '\u0000' + row.actionKey(), row);
        }
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes = indexProcesses(
            mapper.listProcessShapes(gameId, skillKey)
        );
        Map<String, SkillTriggerDamageEventDetail> damageEvents = new LinkedHashMap<>();
        for (var row : nullToEmpty(mapper.listDamageEventsForSkill(gameId, skillKey))) {
            damageEvents.put(
                row.ruleKey(),
                new SkillTriggerDamageEventDetail(row.sourceSkillKey(), row.damageTypeKey(), row.deliveryKind(), row.originKind())
            );
        }
        Set<String> protectedRules = new LinkedHashSet<>();
        for (var row : nullToEmpty(mapper.listCooldownsForSkill(gameId, skillKey))) {
            protectedRules.add(row.ruleKey());
        }
        List<Map<String, String>> issues = new ArrayList<>();
        for (SkillTriggerActionRow action : actions.values()) {
            String compositeKey = action.ruleKey() + '\u0000' + action.actionKey();
            boolean reachesCandidate = switch (action.actionType()) {
                case EXECUTE_EFFECT -> {
                    SkillTriggerEffectActionRow detail = effectActions.get(compositeKey);
                    yield detail != null && Objects.equals(detail.effectKey(), effectKey);
                }
                case START_PROCESS, ADVANCE_PROCESS -> {
                    SkillTriggerProcessActionRow detail = processActions.get(compositeKey);
                    yield detail != null && processShapes.getOrDefault(detail.processKey(), List.of()).stream()
                        .anyMatch(row -> Objects.equals(row.bindingEffectKey(), effectKey));
                }
                case FAIL_PROCESS, MODIFY_INTERNAL_STATE -> false;
            };
            if (!reachesCandidate) {
                continue;
            }
            SkillTriggerRuleRow rule = rules.get(action.ruleKey());
            SkillTriggerDamageEventDetail damageEvent = damageEvents.get(action.ruleKey());
            boolean guarded = rule != null
                && (rule.eventType() == SkillTriggerEventType.DAMAGE_PENDING
                    || rule.eventType() == SkillTriggerEventType.DAMAGE_TAKEN
                    || rule.eventType() == SkillTriggerEventType.BASIC_ATTACK_RECEIVED)
                && action.targetContext() == SkillTriggerTargetContext.EVENT_SOURCE
                && (rule.eventType() == SkillTriggerEventType.BASIC_ATTACK_RECEIVED
                    || damageEvent != null && damageEvent.originKind() == SkillTriggerDamageOriginKind.DIRECT
                    || protectedRules.contains(action.ruleKey()));
            if (!guarded) {
                issues.add(fieldIssue(
                    resultPath(reflectedResultIndex, "detail.originKind"),
                    "REFLECT_LOOP_UNGUARDED",
                    "既有触发规则无法安全执行反伤效果",
                    action.ruleKey() + "/" + action.actionKey()
                ));
            }
        }
        if (!issues.isEmpty()) {
            issues.sort(Comparator.comparing(issue -> issue.get("rejectedValue")));
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.TRIGGER_RULE_CYCLE_UNGUARDED",
                "技能触发规则存在无保护反伤循环",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static Set<SkillNumericValue> collectInteractionValues(List<SkillEffectResultRequest> results) {
        Set<SkillNumericValue> formulaKeys = new LinkedHashSet<>();
        for (SkillEffectResultRequest result : results) {
            if (result == null || !(result.detail() instanceof SkillEffectDamageDetail damage)) {
                continue;
            }
            SkillEffectCriticalPolicy critical = damage.critical();
            if (critical != null && critical.multiplierValue() != null) {
                formulaKeys.add(critical.multiplierValue());
            }
            for (SkillEffectVampOverride vampRule : damage.vampOverrides() == null ? List.<SkillEffectVampOverride>of() : damage.vampOverrides()) {
                if (vampRule != null && vampRule.mode() == xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE
                    && vampRule.efficiencyValue() != null) {
                    formulaKeys.add(vampRule.efficiencyValue());
                }
            }
        }
        return Set.copyOf(formulaKeys);
    }

    private static Set<SkillNumericValue> collectResultValues(List<SkillEffectResultRequest> results) {
        Set<SkillNumericValue> formulaKeys = new LinkedHashSet<>();
        for (SkillEffectResultRequest result : results) {
            if (result != null && result.valueRule() != null && result.valueRule().value() != null) {
                formulaKeys.add(result.valueRule().value());
            }
        }
        return Set.copyOf(formulaKeys);
    }

    private static List<String> collectResultValuePaths(List<SkillEffectResultRequest> results) {
        List<String> paths = new ArrayList<>();
        for (int i = 0; i < results.size(); i++) {
            SkillEffectResultRequest result = results.get(i);
            if (result != null && result.valueRule() != null) {
                paths.add(resultPath(i, "valueRule.value"));
            }
        }
        return paths;
    }

    private static List<String> collectInteractionValuePaths(List<SkillEffectResultRequest> results) {
        List<String> paths = new ArrayList<>();
        for (int i = 0; i < results.size(); i++) {
            SkillEffectResultRequest result = results.get(i);
            if (result == null || !(result.detail() instanceof SkillEffectDamageDetail damage)) {
                continue;
            }
            paths.add(resultPath(i, "detail.critical.multiplierValue"));
            if (damage.vampOverrides() != null) {
                for (int j = 0; j < damage.vampOverrides().size(); j++) {
                    SkillEffectVampOverride override = damage.vampOverrides().get(j);
                    if (override != null && override.mode() == xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE) {
                        paths.add(resultPath(i, "detail.vampOverrides[" + j + "].efficiencyValue"));
                    }
                }
            }
        }
        return paths;
    }

    public void assertProcessDeletable(String gameId, String skillKey, String processKey) {
        if (mapper.countProcessReferences(gameId, skillKey, processKey) > 0) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_PROCESS_IN_USE",
                "技能过程仍被触发规则引用，不能删除",
                Map.of("fieldIssues", List.of(fieldIssue(
                    "processKey",
                    "TRIGGER_RULE_PROCESS_IN_USE",
                    "技能过程仍被触发规则引用，不能删除"
                )))
            );
        }
    }

    public void assertStepsNotReferenced(
        String gameId,
        String skillKey,
        String processKey,
        Collection<String> stepKeys
    ) {
        if (stepKeys == null) {
            return;
        }
        List<Map<String, String>> issues = new ArrayList<>();
        for (String stepKey : stepKeys) {
            if (mapper.countStepReferences(gameId, skillKey, processKey, stepKey) > 0) {
                issues.add(fieldIssue(
                    "steps",
                    "TRIGGER_RULE_STEP_IN_USE",
                    "步骤仍被触发规则引用，不能移除",
                    stepKey
                ));
            }
        }
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_PROCESS_IN_USE",
                "技能过程或步骤仍被触发规则引用",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    public void assertInternalStateDeletable(String gameId, String skillKey, String stateKey) {
        if (mapper.countInternalStateReferences(gameId, skillKey, stateKey) > 0) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_INTERNAL_STATE_IN_USE",
                "内部状态仍被触发规则引用，不能删除",
                Map.of("fieldIssues", List.of(fieldIssue(
                    "stateKey",
                    "TRIGGER_RULE_INTERNAL_STATE_IN_USE",
                    "内部状态仍被触发规则引用，不能删除"
                )))
            );
        }
    }

    public void assertOptionsNotReferenced(
        String gameId,
        String skillKey,
        String stateKey,
        Collection<String> optionKeys
    ) {
        if (optionKeys == null || optionKeys.isEmpty()) {
            return;
        }
        if (mapper.countOptionReferences(gameId, skillKey, stateKey, optionKeys) > 0) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_INTERNAL_STATE_OPTION_IN_USE",
                "模式选项仍被触发规则引用，不能移除",
                Map.of("fieldIssues", List.of(fieldIssue(
                    "detail.options",
                    "TRIGGER_RULE_OPTION_IN_USE",
                    "模式选项仍被触发规则引用，不能移除"
                )))
            );
        }
    }

    public void assertFormulaDeletable(String gameId, String skillKey, String formulaKey) {
        if (mapper.countFormulaReferences(gameId, skillKey, formulaKey) > 0) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_FORMULA_IN_USE",
                "技能公式仍被触发规则引用，不能删除",
                Map.of("fieldIssues", List.of(fieldIssue(
                    "formulaKey",
                    "TRIGGER_RULE_FORMULA_IN_USE",
                    "技能公式仍被触发规则引用，不能删除"
                )))
            );
        }
    }

    public void assertParameterDeletable(String gameId, String skillKey, String parameterKey) {
        if (mapper.countParameterReferences(gameId, skillKey, parameterKey) > 0) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_PARAMETER_IN_USE",
                "技能参数仍被触发规则引用，不能删除",
                Map.of("fieldIssues", List.of(fieldIssue(
                    "parameterKey",
                    "TRIGGER_RULE_PARAMETER_IN_USE",
                    "技能参数仍被触发规则引用，不能删除"
                )))
            );
        }
    }

    public void assertStatusDeletable(String gameId, String statusKey) {
        if (mapper.countStatusReferences(gameId, statusKey) > 0) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.STATUS_IN_USE",
                "状态仍被触发规则引用，不能删除",
                Map.of("fieldIssues", List.of(fieldIssue(
                    "statusKey",
                    "TRIGGER_RULE_STATUS_IN_USE",
                    "状态仍被触发规则引用，不能删除"
                )))
            );
        }
    }

    private List<Map<String, String>> collectEffectShapeIssues(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectLifecycleRequest candidateLifecycle,
        List<SkillEffectResultRequest> candidateResults
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        Map<String, SkillEffectResultRequest> resultsByKey = new LinkedHashMap<>();
        Map<String, Integer> indexByKey = new LinkedHashMap<>();
        for (int i = 0; i < candidateResults.size(); i++) {
            resultsByKey.put(candidateResults.get(i).resultKey(), candidateResults.get(i));
            indexByKey.put(candidateResults.get(i).resultKey(), i);
        }
        boolean hasLifecycle = candidateLifecycle != null;
        for (var event : nullToEmpty(mapper.listResultEventsForSkill(gameId, skillKey))) {
            if (!effectKey.equals(event.effectKey())) {
                continue;
            }
            if (hasLifecycle) {
                issues.add(fieldIssue("lifecycle", "TRIGGER_RULE_SHAPE_IN_USE", "效果生命周期变化会使结果事件失效"));
            }
            if (!resultsByKey.containsKey(event.resultKey())) {
                issues.add(fieldIssue("results", "TRIGGER_RULE_RESULT_IN_USE", "结果仍被触发规则引用，不能移除", event.resultKey()));
            }
        }
        for (var event : nullToEmpty(mapper.listLifecycleEventsForSkill(gameId, skillKey))) {
            if (!effectKey.equals(event.effectKey())) {
                continue;
            }
            if (!hasLifecycle) {
                continue;
            }
            if (event.lifecycleMoment() == SkillTriggerLifecycleEventMoment.PERIODIC
                && candidateLifecycle.periodicIntervalValue() == null) {
                issues.add(fieldIssue(
                    "lifecycle.periodicIntervalValue",
                    "TRIGGER_RULE_SHAPE_IN_USE",
                    "周期间隔变化会使生命周期时点事件失效"
                ));
            }
            if (event.lifecycleMoment() == SkillTriggerLifecycleEventMoment.NATURAL_END
                && (candidateLifecycle.durationValue() == null
                    || candidateLifecycle.expiryMode() == SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY)) {
                String field = candidateLifecycle.durationValue() == null
                    ? "lifecycle.durationValue"
                    : "lifecycle.expiryMode";
                issues.add(fieldIssue(field, "TRIGGER_RULE_SHAPE_IN_USE", "自然结束条件变化会使生命周期时点事件失效"));
            }
        }
        for (SkillTriggerRuleRow rule : nullToEmpty(mapper.listRulesForGame(gameId))) {
            for (SkillTriggerStatusConditionRow condition : nullToEmpty(
                mapper.listStatusConditions(gameId, rule.skillKey(), rule.ruleKey())
            )) {
                if (!effectKey.equals(condition.sourceEffectKey()) || condition.sourceResultKey() == null
                    || !skillKey.equals(readOwner(condition.effectSkillKey(), rule.skillKey()))) {
                    continue;
                }
                Integer index = indexByKey.get(condition.sourceResultKey());
                SkillEffectResultRequest result = resultsByKey.get(condition.sourceResultKey());
                if (result == null) {
                    continue;
                }
                if (!isPersistentApply(result, candidateLifecycle, condition.statusKey())) {
                    issues.add(fieldIssue(
                        resultPath(index, "lifecycleBehavior.moment"),
                        "TRIGGER_RULE_SHAPE_IN_USE",
                        "结果时点或状态操作变化会使触发规则失效"
                    ));
                }
            }
            for (SkillTriggerCombatStatusBindingRow binding : nullToEmpty(
                mapper.listCombatStatusBindings(gameId, rule.skillKey(), rule.ruleKey())
            )) {
                if (!effectKey.equals(binding.sourceEffectKey()) || binding.sourceResultKey() == null
                    || !skillKey.equals(readOwner(binding.effectSkillKey(), rule.skillKey()))) {
                    continue;
                }
                Integer index = indexByKey.get(binding.sourceResultKey());
                SkillEffectResultRequest result = resultsByKey.get(binding.sourceResultKey());
                if (result == null || index == null) {
                    continue;
                }
                if (!isPersistentApply(result, candidateLifecycle, binding.statusKey())) {
                    issues.add(fieldIssue(
                        resultPath(index, "lifecycleBehavior.moment"),
                        "TRIGGER_RULE_SHAPE_IN_USE",
                        "结果时点或状态操作变化会使触发规则失效"
                    ));
                }
            }
            if (!skillKey.equals(rule.skillKey())) continue;
            for (SkillTriggerPriorResultBindingRow binding : nullToEmpty(
                mapper.listPriorResultBindings(gameId, skillKey, rule.ruleKey())
            )) {
                if (!effectKey.equals(binding.sourceEffectKey())) {
                    continue;
                }
                Integer index = indexByKey.get(binding.sourceResultKey());
                SkillEffectResultRequest result = resultsByKey.get(binding.sourceResultKey());
                if (result == null || index == null) {
                    continue;
                }
                SkillTriggerPriorResultOutputs.Shape shape = SkillTriggerPriorResultOutputs.Shape.from(
                    result,
                    hasLifecycle
                );
                boolean immediate = SkillTriggerPriorResultOutputs.immediatelyAvailable(shape);
                boolean outputAvailable = SkillTriggerPriorResultOutputs.available(shape, binding.outputKind());
                if (immediate && outputAvailable) {
                    continue;
                }
                String changedField = SkillTriggerPriorResultOutputs.unavailableField(shape, binding.outputKind());
                if (changedField == null) {
                    changedField = immediate ? "resultType" : "lifecycleBehavior.moment";
                }
                Map<String, String> issue = fieldIssue(
                    resultPath(index, changedField),
                    "TRIGGER_RULE_SHAPE_IN_USE",
                    "结果形状变化会使既有前序输出失效"
                );
                issue.put("ruleKey", binding.ruleKey());
                issue.put("actionKey", binding.actionKey());
                issue.put("bindingKey", binding.bindingKey());
                issue.put("outputKind", binding.outputKind() == null ? "" : binding.outputKind().name());
                issues.add(issue);
            }
            for (var modifier : nullToEmpty(mapper.listModifiers(gameId, skillKey, rule.ruleKey()))) {
                if (!effectKey.equals(modifier.effectKey())) {
                    continue;
                }
                Integer index = indexByKey.get(modifier.resultKey());
                SkillEffectResultRequest result = resultsByKey.get(modifier.resultKey());
                if (result == null || index == null) {
                    continue;
                }
                if (result.valueRule() == null || result.resultType() == SkillEffectResultType.STATUS_OPERATION) {
                    issues.add(fieldIssue(
                        resultPath(index, "valueRule"),
                        "TRIGGER_RULE_SHAPE_IN_USE",
                        "结果不支持已有触发动作的额外固定修正"
                    ));
                }
            }
        }
        return issues;
    }

    private static boolean isPersistentApply(
        SkillEffectResultRequest result,
        SkillEffectLifecycleRequest lifecycle,
        String statusKey
    ) {
        if (lifecycle == null || result.resultType() != SkillEffectResultType.STATUS_OPERATION) {
            return false;
        }
        if (!(result.detail() instanceof SkillEffectStatusOperationDetail detail)
            || detail.operation() != SkillEffectStatusOperation.APPLY
            || !Objects.equals(detail.statusKey(), statusKey)) {
            return false;
        }
        return result.lifecycleBehavior() != null
            && result.lifecycleBehavior().moment() == SkillEffectLifecycleMoment.PERSISTENT;
    }

    static ApiException effectInUse(List<Map<String, String>> issues) {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_EFFECT_IN_USE",
            "技能效果仍被引用，不能删除或破坏其形状",
            Map.of("fieldIssues", List.copyOf(issues))
        );
    }

    private record RuntimeInputDependencyHit(String ruleKey, String actionKey, String parameterKey) {
    }
}
