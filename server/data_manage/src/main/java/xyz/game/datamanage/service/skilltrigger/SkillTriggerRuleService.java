package xyz.game.datamanage.service.skilltrigger;

import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicy;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampOverride;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAdvanceProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCancelProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCatalogLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageOriginKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExplicitTargetIsSourceConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerFailProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventMoment;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLinkEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerParameterRefRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputs;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerReferenceHit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifier;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleSummaryResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleUpdateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSourceCastResourceCostBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetCategoryConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputSourceType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStartProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusCheckKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSpellShieldBlockedEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubject;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerValueDomain;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.SkillExplicitTargetIsSourceConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillHitTargetIsEnemyConditionSemantics;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillHitTargetIsEnemyConditionDetail;
import xyz.game.datamanage.support.authoring.SkillLifecycleConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillTargetCategoryConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillTriggerOncePerUseSemantics;
import xyz.game.datamanage.model.value.SkillNumericValue;

@Service
@Validated
public class SkillTriggerRuleService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Logger log = LoggerFactory.getLogger(SkillTriggerRuleService.class);
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_trigger_rules";
    private static final String DISABLED = "DISABLED";
    private static final Comparator<SkillTriggerAction> ACTION_ORDER = Comparator
        .comparing(SkillTriggerAction::sortOrder)
        .thenComparing(SkillTriggerAction::actionKey);
    private static final Set<SkillProcessMomentType> PROCESS_MOMENTS = EnumSet.of(
        SkillProcessMomentType.PROCESS_START,
        SkillProcessMomentType.PROCESS_COMPLETE,
        SkillProcessMomentType.PROCESS_FAILURE
    );
    private static final Set<SkillProcessMomentType> STEP_MOMENTS = EnumSet.of(
        SkillProcessMomentType.STEP_START,
        SkillProcessMomentType.STEP_EXECUTION,
        SkillProcessMomentType.STEP_COMPLETE,
        SkillProcessMomentType.STEP_TIMEOUT
    );
    private static final Set<SkillProcessStepType> TIMEOUT_STEPS = EnumSet.of(
        SkillProcessStepType.CHARGE,
        SkillProcessStepType.RECAST,
        SkillProcessStepType.EMPOWERED_BASIC_ATTACK
    );

    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillTriggerRuleMapper mapper;
    private final SkillTriggerRuleAssembler assembler;
    private final SkillTriggerRuntimeInputAnalyzer analyzer;
    private final SkillTriggerCycleValidator cycleValidator;

    public SkillTriggerRuleService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillTriggerRuleMapper mapper,
        SkillTriggerRuleAssembler assembler,
        SkillTriggerRuntimeInputAnalyzer analyzer,
        SkillTriggerCycleValidator cycleValidator,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;
        this.assembler = assembler;
        this.analyzer = analyzer;
        this.cycleValidator = cycleValidator;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public List<SkillTriggerRuleSummaryResponse> list(String gameId, String skillKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        List<SkillTriggerRuleSummaryResponse> items = mapper.listSummaries(gameId, skillKey);
        return items == null ? List.of() : items;
    }

    @Transactional(readOnly = true)
    public SkillTriggerRuleDetailResponse get(String gameId, String skillKey, String ruleKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        return requireDetail(gameId, skillKey, ruleKey);
    }

    @Transactional
    public SkillTriggerRuleDetailResponse create(
        String gameId,
        String skillKey,
        @Valid SkillTriggerRuleCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedRule values = validateCreate(request);
        lockParentSkill(gameId, skillKey);
        List<SkillTriggerRuleRow> locked = mapper.listRulesForUpdate(gameId, skillKey);
        if (mapper.countByKey(gameId, skillKey, values.ruleKey()) > 0) {
            throw keyExists();
        }
        assertOncePerUseGroup(values, locked);
        Catalog catalog = lockAndValidateCatalogs(gameId, skillKey, values, null);
        try {
            insertAggregate(gameId, skillKey, values);
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        cycleValidator.validateCurrentSkill(gameId, skillKey);
        return requireDetail(gameId, skillKey, values.ruleKey());
    }

    @Transactional
    public SkillTriggerRuleDetailResponse update(
        String gameId,
        String skillKey,
        String ruleKey,
        @Valid SkillTriggerRuleUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedRule values = validateUpdate(request, ruleKey);
        lockParentSkill(gameId, skillKey);
        List<SkillTriggerRuleRow> locked = mapper.listRulesForUpdate(gameId, skillKey);
        SkillTriggerRuleRow existing = mapper.findRuleForUpdate(gameId, skillKey, ruleKey);
        if (existing == null) {
            throw ruleNotFound(ruleKey);
        }
        SkillTriggerRuleDetailResponse current = assembler.assemble(existing);
        rejectImmutableKinds(current, values);
        assertOncePerUseGroup(values, locked);
        Catalog catalog = lockAndValidateCatalogs(gameId, skillKey, values, current);
        try {
            if (mapper.updateRule(
                gameId,
                skillKey,
                ruleKey,
                values.name(),
                values.description(),
                values.sortOrder(),
                values.eventSource().eventType().name(),
                AggregateJson.write(values.eventSource()),
                AggregateJson.write(SkillTriggerRuleAssembler.orderedGroups(values.conditionGroups())),
                AggregateJson.write(SkillTriggerRuleAssembler.orderedActions(values.actions())),
                AggregateJson.write(new SkillTriggerRuleAssembler.Limits(
                    values.perTargetCooldown(), values.maxTriggersPerProcess(), values.oncePerUse()))
            ) == 0) {
                throw ruleNotFound(ruleKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        cycleValidator.validateCurrentSkill(gameId, skillKey);
        return requireDetail(gameId, skillKey, ruleKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey, String ruleKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        lockParentSkill(gameId, skillKey);
        mapper.listRulesForUpdate(gameId, skillKey);
        if (mapper.findRuleForUpdate(gameId, skillKey, ruleKey) == null) {
            throw ruleNotFound(ruleKey);
        }
        if (mapper.deleteRule(gameId, skillKey, ruleKey) == 0) {
            throw ruleNotFound(ruleKey);
        }
        cycleValidator.validateCurrentSkill(gameId, skillKey);
    }

    public void deleteAllForSkill(String gameId, String skillKey) {
        mapper.deleteAllForSkill(gameId, skillKey);
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

    private static boolean isEligibleSpellShieldEffect(
        SkillEffectLifecycleRequest lifecycle,
        List<SkillEffectResultRequest> results
    ) {
        if (lifecycle == null || results == null) {
            return false;
        }
        return results.stream().anyMatch(result -> result != null
            && result.resultType() == SkillEffectResultType.SPELL_SHIELD
            && result.lifecycleBehavior() != null
            && result.lifecycleBehavior().moment() == SkillEffectLifecycleMoment.PERSISTENT);
    }

    private static boolean isEligibleSpellShieldEffect(List<SkillTriggerEffectShapeRow> results) {
        return results.stream().anyMatch(result -> result.hasLifecycle()
            && result.resultType() == SkillEffectResultType.SPELL_SHIELD
            && result.resultMoment() == SkillEffectLifecycleMoment.PERSISTENT);
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
                case FAIL_PROCESS, ADVANCE_PROCESS -> null;
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
                new SkillTriggerDamageEventDetail(row.damageTypeKey(), row.deliveryKind(), row.originKind())
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
                case FAIL_PROCESS -> false;
            };
            if (!reachesCandidate) {
                continue;
            }
            SkillTriggerRuleRow rule = rules.get(action.ruleKey());
            SkillTriggerDamageEventDetail damageEvent = damageEvents.get(action.ruleKey());
            boolean guarded = rule != null
                && (rule.eventType() == SkillTriggerEventType.DAMAGE_PENDING
                    || rule.eventType() == SkillTriggerEventType.DAMAGE_TAKEN)
                && action.targetContext() == SkillTriggerTargetContext.EVENT_SOURCE
                && (damageEvent != null && damageEvent.originKind() == SkillTriggerDamageOriginKind.DIRECT
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

    public void assertCurrentSkillCycle(String gameId, String skillKey) {
        cycleValidator.validateCurrentSkill(gameId, skillKey);
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

    private SkillTriggerRuleDetailResponse requireDetail(String gameId, String skillKey, String ruleKey) {
        SkillTriggerRuleRow rule = mapper.findRule(gameId, skillKey, ruleKey);
        if (rule == null) {
            throw ruleNotFound(ruleKey);
        }
        return assembler.assemble(rule);
    }

    private ValidatedRule validateCreate(SkillTriggerRuleCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "触发规则不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        return validatePayload(
            request.ruleKey(),
            request.name(),
            request.description(),
            request.sortOrder(),
            request.eventSource(),
            request.conditionGroups(),
            request.actions(),
            request.perTargetCooldown(),
            request.maxTriggersPerProcess(),
            request.oncePerUse(),
            issues
        );
    }

    private ValidatedRule validateUpdate(SkillTriggerRuleUpdateRequest request, String ruleKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "触发规则不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.ruleKey() != null && !request.ruleKey().isBlank() && !request.ruleKey().equals(ruleKey)) {
            issues.add(fieldIssue("ruleKey", "IMMUTABLE", "规则标识不能修改"));
        }
        throwIfInvalid(issues);
        return validatePayload(
            ruleKey,
            request.name(),
            request.description(),
            request.sortOrder(),
            request.eventSource(),
            request.conditionGroups(),
            request.actions(),
            request.perTargetCooldown(),
            request.maxTriggersPerProcess(),
            request.oncePerUse(),
            issues
        );
    }

    private ValidatedRule validatePayload(
        String ruleKey,
        String name,
        String description,
        Integer sortOrder,
        SkillTriggerEventSource eventSource,
        List<SkillTriggerConditionGroup> conditionGroups,
        List<SkillTriggerAction> actions,
        SkillTriggerPerTargetCooldown cooldown,
        SkillTriggerProcessLimit processLimit,
        SkillTriggerOncePerUse oncePerUse,
        List<Map<String, String>> issues
    ) {
        List<Map<String, String>> bodyIssues = new ArrayList<>();
        if (eventSource == null || eventSource.eventType() == null || eventSource.detail() == null) {
            issues.add(fieldIssue("eventSource", "REQUIRED", "事件来源不能为空"));
        } else {
            collectDetailNoise(bodyIssues, "eventSource.detail", eventSource.detail().foreignFields(), eventSource.detail().unknownFields());
            validateEventShape(eventSource, issues);
        }
        Set<String> groupKeys = new HashSet<>();
        List<SkillTriggerConditionGroup> groups = conditionGroups == null ? List.of() : conditionGroups;
        for (int i = 0; i < groups.size(); i++) {
            SkillTriggerConditionGroup group = groups.get(i);
            if (group == null) {
                issues.add(fieldIssue(groupPath(i, null), "REQUIRED", "条件组不能为空"));
                continue;
            }
            if (!groupKeys.add(group.groupKey())) {
                issues.add(fieldIssue(groupPath(i, "groupKey"), "DUPLICATE", "同一规则内条件组标识不能重复"));
            }
            Set<String> conditionKeys = new HashSet<>();
            List<SkillTriggerCondition> conditions = group.conditions() == null ? List.of() : group.conditions();
            if (conditions.isEmpty()) {
                issues.add(fieldIssue(groupPath(i, "conditions"), "REQUIRED", "条件组至少包含一个条件"));
            }
            for (int j = 0; j < conditions.size(); j++) {
                SkillTriggerCondition condition = conditions.get(j);
                if (condition == null) {
                    issues.add(fieldIssue(conditionPath(i, j, null), "REQUIRED", "条件不能为空"));
                    continue;
                }
                if (!conditionKeys.add(condition.conditionKey())) {
                    issues.add(fieldIssue(conditionPath(i, j, "conditionKey"), "DUPLICATE", "同一条件组内条件标识不能重复"));
                }
                if (condition.detail() != null) {
                    collectDetailNoise(
                        bodyIssues,
                        conditionPath(i, j, "detail"),
                        condition.detail().foreignFields(),
                        condition.detail().unknownFields()
                    );
                }
                validateConditionShape(eventSource, condition, conditionPath(i, j, null), issues);
            }
        }
        List<SkillTriggerAction> safeActions = actions == null ? List.of() : actions;
        if (safeActions.isEmpty()) {
            issues.add(fieldIssue("actions", "REQUIRED", "规则至少包含一个动作"));
        }
        Set<String> actionKeys = new HashSet<>();
        List<SkillTriggerAction> ordered = new ArrayList<>(safeActions);
        ordered.sort(ACTION_ORDER);
        int failCount = 0;
        for (int i = 0; i < safeActions.size(); i++) {
            SkillTriggerAction action = safeActions.get(i);
            if (action == null) {
                issues.add(fieldIssue(actionPath(i, null), "REQUIRED", "动作不能为空"));
                continue;
            }
            if (!actionKeys.add(action.actionKey())) {
                issues.add(fieldIssue(actionPath(i, "actionKey"), "DUPLICATE", "同一规则内动作标识不能重复"));
            }
            if (action.detail() != null) {
                collectDetailNoise(
                    bodyIssues,
                    actionPath(i, "detail"),
                    action.detail().foreignFields(),
                    action.detail().unknownFields()
                );
            }
            validateActionShape(eventSource, action, actionPath(i, null), issues);
            if (action.actionType() == SkillTriggerActionType.FAIL_PROCESS) {
                failCount++;
            }
            Set<String> bindingKeys = new HashSet<>();
            Set<String> boundParameters = new HashSet<>();
            List<SkillTriggerRuntimeInputBinding> bindings =
                action.runtimeInputBindings() == null ? List.of() : action.runtimeInputBindings();
            for (int b = 0; b < bindings.size(); b++) {
                SkillTriggerRuntimeInputBinding binding = bindings.get(b);
                if (binding == null) {
                    issues.add(fieldIssue(bindingPath(i, b, null), "REQUIRED", "绑定不能为空"));
                    continue;
                }
                if (!bindingKeys.add(binding.bindingKey())) {
                    issues.add(fieldIssue(bindingPath(i, b, "bindingKey"), "DUPLICATE", "同一动作内绑定标识不能重复"));
                }
                if (!boundParameters.add(binding.parameterKey())) {
                    issues.add(fieldIssue(bindingPath(i, b, "parameterKey"), "DUPLICATE", "同一动作内一个参数只能有一个绑定"));
                }
                if (binding.detail() != null) {
                    collectDetailNoise(
                        bodyIssues,
                        bindingPath(i, b, "detail"),
                        binding.detail().foreignFields(),
                        binding.detail().unknownFields()
                    );
                }
            }
            Set<String> modifierResults = new HashSet<>();
            List<SkillTriggerResultModifier> modifiers =
                action.resultModifiers() == null ? List.of() : action.resultModifiers();
            for (int m = 0; m < modifiers.size(); m++) {
                SkillTriggerResultModifier modifier = modifiers.get(m);
                if (modifier == null) {
                    issues.add(fieldIssue(modifierPath(i, m, null), "REQUIRED", "结果修正不能为空"));
                    continue;
                }
                if (!modifierResults.add(modifier.resultKey())) {
                    issues.add(fieldIssue(modifierPath(i, m, "resultKey"), "DUPLICATE", "同一动作内结果修正不能重复"));
                }
                validateModifierRange(modifier, modifierPath(i, m, null), issues);
            }
        }
        if (failCount > 1) {
            issues.add(fieldIssue("actions", "FAIL_PROCESS_DUPLICATE", "同一规则只能有一个令过程失败动作"));
        }
        if (failCount == 1 && !ordered.isEmpty()
            && ordered.get(ordered.size() - 1).actionType() != SkillTriggerActionType.FAIL_PROCESS) {
            issues.add(fieldIssue("actions", "FAIL_PROCESS_NOT_LAST", "令过程失败动作必须排在最后"));
        }
        if (processLimit != null && (eventSource == null || eventSource.eventType() != SkillTriggerEventType.PROCESS_MOMENT)) {
            issues.add(fieldIssue(
                "maxTriggersPerProcess",
                "PROCESS_LIMIT_EVENT_INVALID",
                "单次过程最大触发次数只允许用于 PROCESS_MOMENT"
            ));
        }
        var oncePerUseParsed = SkillTriggerOncePerUseSemantics.fromDto(oncePerUse);
        for (Map<String, String> unknown : SkillTriggerOncePerUseSemantics.unknownFieldIssues(oncePerUseParsed, "oncePerUse")) {
            bodyIssues.add(unknown);
        }
        issues.addAll(SkillTriggerOncePerUseSemantics.shapeIssues(oncePerUseParsed, "oncePerUse"));
        issues.addAll(SkillTriggerOncePerUseSemantics.eventIssues(
            eventSource == null ? null : eventSource.eventType(),
            oncePerUseParsed,
            "oncePerUse"
        ));
        throwIfInvalidBody(bodyIssues);
        throwIfInvalid(issues);
        return new ValidatedRule(
            ruleKey,
            name,
            description,
            sortOrder,
            eventSource,
            groups,
            safeActions,
            cooldown,
            processLimit,
            oncePerUse
        );
    }

    private void validateEventShape(SkillTriggerEventSource eventSource, List<Map<String, String>> issues) {
        SkillTriggerEventType eventType = eventSource.eventType();
        Object detail = eventSource.detail();
        switch (eventType) {
            case PROCESS_MOMENT -> {
                if (!(detail instanceof SkillTriggerProcessEventDetail process)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "过程时点事件明细形状不合法"));
                    return;
                }
                if (process.processKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.processKey", "REQUIRED", "过程标识不能为空"));
                }
                if (process.moment() == null || process.moment().momentType() == null) {
                    issues.add(fieldIssue("eventSource.detail.moment.momentType", "REQUIRED", "过程时点种类不能为空"));
                } else {
                    collectMomentNoise(issues, "eventSource.detail.moment", process.moment());
                }
            }
            case PROCESS_CANCEL_REQUESTED -> {
                if (!(detail instanceof SkillTriggerCancelProcessEventDetail cancel)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "过程取消事件明细形状不合法"));
                    return;
                }
                if (cancel.processKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.processKey", "REQUIRED", "过程标识不能为空"));
                }
            }
            case SKILL_USED -> {
                if (!(detail instanceof SkillTriggerSkillEventDetail skill)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "技能使用事件明细形状不合法"));
                    return;
                }
                if (skill.useKind() == null) {
                    issues.add(fieldIssue("eventSource.detail.useKind", "REQUIRED", "技能使用种类不能为空"));
                }
                if (skill.castPhase() == null) {
                    issues.add(fieldIssue("eventSource.detail.castPhase", "REQUIRED", "技能使用阶段不能为空"));
                }
            }
            case SKILL_HIT -> {
                if (!(detail instanceof SkillTriggerSkillEventDetail skill)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "技能命中事件明细形状不合法"));
                    return;
                }
                if (skill.useKind() != null) {
                    issues.add(fieldIssue("eventSource.detail.useKind", "FORBIDDEN", "技能命中事件不能提供使用种类"));
                }
                if (skill.castPhase() != null) {
                    issues.add(fieldIssue("eventSource.detail.castPhase", "FORBIDDEN", "技能命中事件不能提供使用阶段"));
                }
            }
            case RESULT_AVAILABLE -> {
                if (!(detail instanceof SkillTriggerResultEventDetail result)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "结果可用事件明细形状不合法"));
                    return;
                }
                if (result.effectKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.effectKey", "REQUIRED", "效果标识不能为空"));
                }
                if (result.resultKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.resultKey", "REQUIRED", "结果标识不能为空"));
                }
            }
            case LIFECYCLE_MOMENT -> {
                if (!(detail instanceof SkillTriggerLifecycleEventDetail lifecycle)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "生命周期时点事件明细形状不合法"));
                    return;
                }
                if (lifecycle.effectKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.effectKey", "REQUIRED", "效果标识不能为空"));
                }
                if (lifecycle.moment() == null) {
                    issues.add(fieldIssue("eventSource.detail.moment", "REQUIRED", "生命周期时点不能为空"));
                }
            }
            case STATUS_CHANGED -> {
                if (!(detail instanceof SkillTriggerStatusEventDetail status)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "状态变化事件明细形状不合法"));
                    return;
                }
                if (status.subject() == null) {
                    issues.add(fieldIssue("eventSource.detail.subject", "REQUIRED", "状态变化对象不能为空"));
                }
                if (status.statusKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.statusKey", "REQUIRED", "状态标识不能为空"));
                }
                if (status.change() == null) {
                    issues.add(fieldIssue("eventSource.detail.change", "REQUIRED", "状态变化种类不能为空"));
                }
            }
            case HEALTH_THRESHOLD_CROSSED -> {
                if (!(detail instanceof SkillTriggerHealthThresholdEventDetail health)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "生命阈值事件明细形状不合法"));
                    return;
                }
                if (health.subject() == null) {
                    issues.add(fieldIssue("eventSource.detail.subject", "REQUIRED", "生命属性变化对象不能为空"));
                }
                if (health.attributeKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.attributeKey", "REQUIRED", "属性标识不能为空"));
                }
                if (health.thresholdValue() == null) {
                    issues.add(fieldIssue("eventSource.detail.thresholdValue", "REQUIRED", "阈值公式不能为空"));
                }
                if (health.direction() == null) {
                    issues.add(fieldIssue("eventSource.detail.direction", "REQUIRED", "穿越方向不能为空"));
                }
            }
            case INTERNAL_STATE_CHANGED -> {
                if (!(detail instanceof SkillTriggerInternalStateEventDetail internal)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "内部状态变化事件明细形状不合法"));
                    return;
                }
                if (internal.stateKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.stateKey", "REQUIRED", "内部状态标识不能为空"));
                }
                if (internal.changeKind() == null) {
                    issues.add(fieldIssue("eventSource.detail.changeKind", "REQUIRED", "内部状态变化种类不能为空"));
                }
            }
            case ENTITY_DIED, ENTITY_UNTARGETABLE -> {
                if (!(detail instanceof SkillTriggerSubjectEventDetail subject)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "主体事件明细形状不合法"));
                    return;
                }
                if (subject.subject() == null) {
                    issues.add(fieldIssue("eventSource.detail.subject", "REQUIRED", "事件主体不能为空"));
                }
            }
            case DAMAGE_PENDING, DAMAGE_DEALT, DAMAGE_TAKEN -> {
                if (!(detail instanceof SkillTriggerDamageEventDetail damage)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "伤害事件明细形状不合法"));
                    return;
                }
                if (damage.deliveryKind() == null) {
                    issues.add(fieldIssue("eventSource.detail.deliveryKind", "REQUIRED", "伤害产生方式筛选不能为空"));
                }
                if (damage.originKind() == null) {
                    issues.add(fieldIssue("eventSource.detail.originKind", "REQUIRED", "伤害来源性质筛选不能为空"));
                }
            }
            case SPELL_SHIELD_BLOCKED -> {
                if (!(detail instanceof SkillTriggerSpellShieldBlockedEventDetail shield)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "法术护盾已阻挡事件明细形状不合法"));
                    return;
                }
                if (shield.shieldEffectKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.shieldEffectKey", "REQUIRED", "法术护盾效果不能为空"));
                }
            }
            case HIT_LINK_APPLIED, ATTACK_LINK_APPLIED -> {
                if (!(detail instanceof SkillTriggerLinkEventDetail)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "联动事件明细形状不合法"));
                }
            }
            case SOURCE_INITIALIZED, BASIC_ATTACK_START, BASIC_ATTACK_HIT, CONTROL_RECEIVED, KILL, TAKEDOWN -> {
                if (!(detail instanceof SkillTriggerEmptyEventDetail)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "该事件明细必须为空对象"));
                }
            }
        }
    }

    private void validateConditionShape(
        SkillTriggerEventSource eventSource,
        SkillTriggerCondition condition,
        String prefix,
        List<Map<String, String>> issues
    ) {
        if (condition.conditionType() == null || condition.detail() == null) {
            issues.add(fieldIssue(prefix + ".detail", "REQUIRED", "条件明细不能为空"));
            return;
        }
        switch (condition.conditionType()) {
            case ATTRIBUTE_COMPARE -> {
                if (!(condition.detail() instanceof SkillTriggerAttributeConditionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "属性比较条件明细形状不合法"));
                    return;
                }
                require(detail.subject(), prefix + ".detail.subject", "比较对象不能为空", issues);
                require(detail.attributeKey(), prefix + ".detail.attributeKey", "属性标识不能为空", issues);
                if (detail.attributeValueKind() == null) {
                    issues.add(fieldIssue(prefix + ".detail.attributeValueKind", "REQUIRED", "属性取值方式不能为空"));
                }
                if (detail.comparator() == null) {
                    issues.add(fieldIssue(prefix + ".detail.comparator", "REQUIRED", "比较符不能为空"));
                }
                require(detail.comparisonValue(), prefix + ".detail.comparisonValue", "比较公式不能为空", issues);
            }
            case STATUS_CHECK -> {
                if (!(condition.detail() instanceof SkillTriggerStatusConditionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "状态检查条件明细形状不合法"));
                    return;
                }
                require(detail.subject(), prefix + ".detail.subject", "检查对象不能为空", issues);
                require(detail.statusKey(), prefix + ".detail.statusKey", "状态标识不能为空", issues);
                if (detail.checkKind() == null) {
                    issues.add(fieldIssue(prefix + ".detail.checkKind", "REQUIRED", "状态检查方式不能为空"));
                    return;
                }
                boolean compare = detail.checkKind() == SkillTriggerStatusCheckKind.STACKS_COMPARE
                    || detail.checkKind() == SkillTriggerStatusCheckKind.REMAINING_MS_COMPARE;
                if (compare) {
                    require(detail.sourceEffectKey(), prefix + ".detail.sourceEffectKey", "来源效果不能为空", issues);
                    require(detail.sourceResultKey(), prefix + ".detail.sourceResultKey", "来源结果不能为空", issues);
                    if (detail.comparator() == null) {
                        issues.add(fieldIssue(prefix + ".detail.comparator", "REQUIRED", "比较符不能为空"));
                    }
                    require(detail.comparisonValue(), prefix + ".detail.comparisonValue", "比较公式不能为空", issues);
                } else {
                    if (detail.sourceEffectKey() != null) {
                        issues.add(fieldIssue(prefix + ".detail.sourceEffectKey", "FORBIDDEN", "该检查方式不能指定来源效果"));
                    }
                    if (detail.sourceResultKey() != null) {
                        issues.add(fieldIssue(prefix + ".detail.sourceResultKey", "FORBIDDEN", "该检查方式不能指定来源结果"));
                    }
                    if (detail.comparator() != null) {
                        issues.add(fieldIssue(prefix + ".detail.comparator", "FORBIDDEN", "该检查方式不能指定比较符"));
                    }
                    if (detail.comparisonValue() != null) {
                        issues.add(fieldIssue(prefix + ".detail.comparisonValue", "FORBIDDEN", "该检查方式不能指定比较公式"));
                    }
                }
            }
            case LIFECYCLE_CHECK -> {
                if (!(condition.detail() instanceof SkillTriggerLifecycleConditionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "生命周期检查条件明细形状不合法"));
                    return;
                }
                issues.addAll(SkillLifecycleConditionSemantics.shapeIssues(detail, prefix + ".detail"));
            }
            case TARGET_CATEGORY_CHECK -> {
                if (!(condition.detail() instanceof SkillTriggerTargetCategoryConditionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "事件对方类别条件明细形状不合法"));
                    return;
                }
                issues.addAll(SkillTargetCategoryConditionSemantics.shapeIssues(detail, prefix + ".detail"));
            }
            case EXPLICIT_TARGET_IS_SOURCE -> {
                if (!(condition.detail() instanceof SkillTriggerExplicitTargetIsSourceConditionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "显式自施目标条件明细形状不合法"));
                    return;
                }
                issues.addAll(SkillExplicitTargetIsSourceConditionSemantics.shapeIssues(detail, prefix + ".detail"));
            }
            case SKILL_HIT_TARGET_IS_ENEMY -> {
                if (!(condition.detail() instanceof SkillTriggerSkillHitTargetIsEnemyConditionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "技能命中敌方对象条件明细形状不合法"));
                    return;
                }
                issues.addAll(SkillHitTargetIsEnemyConditionSemantics.shapeIssues(detail, prefix + ".detail"));
            }
            case INTERNAL_STATE_CHECK -> {
                if (!(condition.detail() instanceof SkillTriggerInternalStateConditionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "内部状态检查条件明细形状不合法"));
                    return;
                }
                require(detail.stateKey(), prefix + ".detail.stateKey", "内部状态标识不能为空", issues);
                if (detail.valueKind() == null) {
                    issues.add(fieldIssue(prefix + ".detail.valueKind", "REQUIRED", "内部状态取值方式不能为空"));
                    return;
                }
                validateInternalStateValueShape(
                    detail.valueKind(),
                    detail.optionKey(),
                    detail.expectedBoolean(),
                    detail.comparator(),
                    detail.comparisonValue(),
                    prefix + ".detail",
                    issues
                );
            }
            case EVENT_VALUE_COMPARE -> {
                if (!(condition.detail() instanceof SkillTriggerEventValueConditionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "事件值比较条件明细形状不合法"));
                    return;
                }
                if (detail.eventValueKey() == null) {
                    issues.add(fieldIssue(prefix + ".detail.eventValueKey", "REQUIRED", "事件值标识不能为空"));
                }
                if (detail.comparator() == null) {
                    issues.add(fieldIssue(prefix + ".detail.comparator", "REQUIRED", "比较符不能为空"));
                }
                require(detail.comparisonValue(), prefix + ".detail.comparisonValue", "比较公式不能为空", issues);
            }
        }
    }

    private void validateActionShape(
        SkillTriggerEventSource eventSource,
        SkillTriggerAction action,
        String prefix,
        List<Map<String, String>> issues
    ) {
        if (action.actionType() == null || action.detail() == null) {
            issues.add(fieldIssue(prefix + ".detail", "REQUIRED", "动作明细不能为空"));
            return;
        }
        switch (action.actionType()) {
            case EXECUTE_EFFECT -> {
                if (!(action.detail() instanceof SkillTriggerExecuteEffectActionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "执行效果动作明细形状不合法"));
                    return;
                }
                require(detail.effectKey(), prefix + ".detail.effectKey", "效果标识不能为空", issues);
                if (action.targetContext() == null) {
                    issues.add(fieldIssue(prefix + ".targetContext", "REQUIRED", "执行效果必须指定目标对象"));
                }
            }
            case START_PROCESS -> {
                if (!(action.detail() instanceof SkillTriggerStartProcessActionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "启动过程动作明细形状不合法"));
                    return;
                }
                require(detail.processKey(), prefix + ".detail.processKey", "过程标识不能为空", issues);
                if (action.targetContext() == null) {
                    issues.add(fieldIssue(prefix + ".targetContext", "REQUIRED", "启动过程必须指定目标对象"));
                }
                if (action.resultModifiers() != null && !action.resultModifiers().isEmpty()) {
                    issues.add(fieldIssue(prefix + ".resultModifiers", "FORBIDDEN", "启动过程不能保存结果修正"));
                }
                if (eventSource != null
                    && eventSource.eventType() == SkillTriggerEventType.SKILL_USED
                    && eventSource.detail() instanceof SkillTriggerSkillEventDetail skill
                    && skill.castPhase() != null
                    && skill.castPhase() != SkillTriggerCastPhase.INITIAL) {
                    issues.add(fieldIssue(prefix + ".actionType", "REFERENCE_TYPE_MISMATCH", "已核定使用阶段的技能使用事件只能在首次阶段启动过程"));
                }
            }
            case FAIL_PROCESS -> {
                if (!(action.detail() instanceof SkillTriggerFailProcessActionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "令过程失败动作明细形状不合法"));
                    return;
                }
                require(detail.processKey(), prefix + ".detail.processKey", "过程标识不能为空", issues);
                if (detail.failureReason() == null) {
                    issues.add(fieldIssue(prefix + ".detail.failureReason", "REQUIRED", "失败原因不能为空"));
                }
                rejectProcessControlShell(action, prefix, "令过程失败", issues);
            }
            case ADVANCE_PROCESS -> {
                if (!(action.detail() instanceof SkillTriggerAdvanceProcessActionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "推进过程动作明细形状不合法"));
                    return;
                }
                require(detail.processKey(), prefix + ".detail.processKey", "过程标识不能为空", issues);
                require(detail.stepKey(), prefix + ".detail.stepKey", "步骤标识不能为空", issues);
                rejectProcessControlShell(action, prefix, "推进过程", issues);
                if (eventSource == null || eventSource.eventType() != SkillTriggerEventType.SKILL_USED) {
                    issues.add(fieldIssue(prefix + ".actionType", "EVENT_VALUE_NOT_AVAILABLE", "推进过程只允许用于技能使用事件"));
                    return;
                }
                if (!(eventSource.detail() instanceof SkillTriggerSkillEventDetail skill)) {
                    return;
                }
                if (skill.sourceSkillKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.sourceSkillKey", "REQUIRED", "推进过程必须明确来源技能"));
                }
                if (skill.castPhase() == null) {
                    issues.add(fieldIssue("eventSource.detail.castPhase", "REQUIRED", "推进过程必须核定使用阶段"));
                } else if (skill.castPhase() == SkillTriggerCastPhase.INITIAL) {
                    issues.add(fieldIssue("eventSource.detail.castPhase", "REFERENCE_TYPE_MISMATCH", "首次阶段不能推进已有过程"));
                }
            }
        }
    }

    private static void validateInternalStateValueShape(
        SkillTriggerInternalStateValueKind valueKind,
        String optionKey,
        Boolean expectedBoolean,
        Object comparator,
        SkillNumericValue comparisonValue,
        String prefix,
        List<Map<String, String>> issues
    ) {
        switch (valueKind) {
            case VALUE, REMAINING_MS -> {
                if (comparator == null) {
                    issues.add(fieldIssue(prefix + ".comparator", "REQUIRED", "比较符不能为空"));
                }
                if (comparisonValue == null) {
                    issues.add(fieldIssue(prefix + ".comparisonValue", "REQUIRED", "比较公式不能为空"));
                }
                if (optionKey != null) {
                    issues.add(fieldIssue(prefix + ".optionKey", "FORBIDDEN", "该取值方式不能指定模式选项"));
                }
                if (expectedBoolean != null) {
                    issues.add(fieldIssue(prefix + ".expectedBoolean", "FORBIDDEN", "该取值方式不能指定布尔期望"));
                }
            }
            case OPTION_SELECTED -> {
                if (optionKey == null) {
                    issues.add(fieldIssue(prefix + ".optionKey", "REQUIRED", "模式选项不能为空"));
                }
                if (expectedBoolean != null) {
                    issues.add(fieldIssue(prefix + ".expectedBoolean", "FORBIDDEN", "模式选择不能指定布尔期望"));
                }
                if (comparator != null) {
                    issues.add(fieldIssue(prefix + ".comparator", "FORBIDDEN", "模式选择不能指定比较符"));
                }
                if (comparisonValue != null) {
                    issues.add(fieldIssue(prefix + ".comparisonValue", "FORBIDDEN", "模式选择不能指定比较公式"));
                }
            }
            case ENABLED -> {
                if (expectedBoolean == null) {
                    issues.add(fieldIssue(prefix + ".expectedBoolean", "REQUIRED", "准备标记期望值不能为空"));
                }
                if (optionKey != null) {
                    issues.add(fieldIssue(prefix + ".optionKey", "FORBIDDEN", "准备标记不能指定模式选项"));
                }
                if (comparator != null) {
                    issues.add(fieldIssue(prefix + ".comparator", "FORBIDDEN", "准备标记不能指定比较符"));
                }
                if (comparisonValue != null) {
                    issues.add(fieldIssue(prefix + ".comparisonValue", "FORBIDDEN", "准备标记不能指定比较公式"));
                }
            }
        }
    }

    private static void validateModifierRange(
        SkillTriggerResultModifier modifier,
        String prefix,
        List<Map<String, String>> issues
    ) {
        if (modifier.fixedMultiplier() == null && modifier.fixedMinValue() == null && modifier.fixedMaxValue() == null) {
            issues.add(fieldIssue(prefix, "REQUIRED", "结果修正至少需要一个非空字段"));
        }
        if (modifier.fixedMultiplier() != null && modifier.fixedMultiplier().compareTo(BigDecimal.ZERO) < 0) {
            issues.add(fieldIssue(prefix + ".fixedMultiplier", "RANGE_INVALID", "固定倍率不能小于0"));
        }
        if (modifier.fixedMinValue() != null
            && modifier.fixedMaxValue() != null
            && modifier.fixedMinValue().compareTo(modifier.fixedMaxValue()) > 0) {
            issues.add(fieldIssue(prefix + ".fixedMinValue", "RANGE_INVALID", "最小值不能大于最大值"));
        }
    }

    private void rejectImmutableKinds(SkillTriggerRuleDetailResponse current, ValidatedRule values) {
        List<Map<String, String>> issues = new ArrayList<>();
        Map<String, SkillTriggerCondition> existingConditions = indexExistingConditions(current);
        Map<String, SkillTriggerAction> existingActions = new LinkedHashMap<>();
        for (SkillTriggerAction action : current.actions()) {
            existingActions.put(action.actionKey(), action);
        }
        for (int i = 0; i < values.conditionGroups().size(); i++) {
            SkillTriggerConditionGroup group = values.conditionGroups().get(i);
            for (int j = 0; j < group.conditions().size(); j++) {
                SkillTriggerCondition condition = group.conditions().get(j);
                SkillTriggerCondition existing = existingConditions.get(group.groupKey() + '\u0000' + condition.conditionKey());
                if (existing != null && existing.conditionType() != condition.conditionType()) {
                    issues.add(fieldIssue(
                        conditionPath(i, j, "conditionType"),
                        "IMMUTABLE",
                        "条件种类不能修改"
                    ));
                }
            }
        }
        for (int i = 0; i < values.actions().size(); i++) {
            SkillTriggerAction action = values.actions().get(i);
            SkillTriggerAction existing = existingActions.get(action.actionKey());
            if (existing != null && existing.actionType() != action.actionType()) {
                issues.add(fieldIssue(actionPath(i, "actionType"), "IMMUTABLE", "动作种类不能修改"));
            }
            if (existing == null) {
                continue;
            }
            Map<String, SkillTriggerRuntimeInputBinding> existingBindings = new LinkedHashMap<>();
            for (SkillTriggerRuntimeInputBinding binding : existing.runtimeInputBindings()) {
                existingBindings.put(binding.bindingKey(), binding);
            }
            List<SkillTriggerRuntimeInputBinding> bindings =
                action.runtimeInputBindings() == null ? List.of() : action.runtimeInputBindings();
            for (int b = 0; b < bindings.size(); b++) {
                SkillTriggerRuntimeInputBinding binding = bindings.get(b);
                SkillTriggerRuntimeInputBinding previous = existingBindings.get(binding.bindingKey());
                if (previous != null && previous.sourceType() != binding.sourceType()) {
                    issues.add(fieldIssue(bindingPath(i, b, "sourceType"), "IMMUTABLE", "绑定来源种类不能修改"));
                }
            }
        }
        throwIfInvalid(issues);
    }

    private Catalog lockAndValidateCatalogs(
        String gameId,
        String skillKey,
        ValidatedRule values,
        SkillTriggerRuleDetailResponse current
    ) {
        CollectedRefs refs = new CollectedRefs();
        List<Map<String, String>> issues = new ArrayList<>();
        List<Map<String, String>> referenceIssues = new ArrayList<>();
        collectEventRefs(values.eventSource(), refs, issues, referenceIssues);
        for (int i = 0; i < values.conditionGroups().size(); i++) {
            SkillTriggerConditionGroup group = values.conditionGroups().get(i);
            for (int j = 0; j < group.conditions().size(); j++) {
                collectConditionRefs(
                    values.eventSource(),
                    group.conditions().get(j),
                    conditionPath(i, j, null),
                    refs,
                    issues,
                    referenceIssues
                );
            }
        }
        Map<String, Integer> actionIndexByKey = new LinkedHashMap<>();
        List<SkillTriggerAction> ordered = new ArrayList<>(values.actions());
        ordered.sort(ACTION_ORDER);
        for (int i = 0; i < values.actions().size(); i++) {
            actionIndexByKey.put(values.actions().get(i).actionKey(), i);
            collectActionRefs(
                values.eventSource(),
                values.actions().get(i),
                actionPath(i, null),
                refs,
                issues,
                referenceIssues
            );
        }
        if (values.perTargetCooldown() != null) {
            refs.addFormula(new CatalogRef("perTargetCooldown.durationValue", values.perTargetCooldown().durationValue()));
            rejectUnavailableTargetContext(
                values.eventSource().eventType(),
                values.perTargetCooldown().targetContext(),
                "perTargetCooldown.targetContext",
                referenceIssues
            );
        }
        if (values.maxTriggersPerProcess() != null) {
            refs.addProcess(new CatalogRef("maxTriggersPerProcess.processKey", values.maxTriggersPerProcess().processKey()));
            refs.addFormula(new CatalogRef("maxTriggersPerProcess.limitValue", values.maxTriggersPerProcess().limitValue()));
            if (values.eventSource().detail() instanceof SkillTriggerProcessEventDetail process
                && !Objects.equals(process.processKey(), values.maxTriggersPerProcess().processKey())) {
                referenceIssues.add(fieldIssue(
                    "maxTriggersPerProcess.processKey",
                    "REFERENCE_TYPE_MISMATCH",
                    "单次过程最大触发次数必须引用事件来源过程"
                ));
            }
        }
        throwIfInvalid(issues);

        Map<String, SkillTriggerCatalogLockRow> attributes = indexCatalog(
            mapper.lockAttributes(gameId, refs.attributeKeys)
        );
        Map<String, SkillTriggerCatalogLockRow> damageTypes = indexCatalog(
            mapper.lockDamageTypes(gameId, refs.damageTypeKeys)
        );
        Map<String, SkillTriggerCatalogLockRow> statuses = indexCatalog(mapper.lockStatuses(gameId, refs.statusKeys));
        Set<String> formulas = new LinkedHashSet<>(nullToEmpty(mapper.lockFormulas(gameId, skillKey, refs.formulaKeys)));
        Map<String, SkillTriggerParameterRefRow> parameters = indexParameters(
            mapper.lockParameters(gameId, skillKey, refs.parameterKeys)
        );
        Set<String> effects = new LinkedHashSet<>(nullToEmpty(mapper.lockEffects(gameId, skillKey, refs.effectKeys)));
        Set<String> processes = new LinkedHashSet<>(nullToEmpty(mapper.lockProcesses(gameId, skillKey, refs.processKeys)));
        Map<String, SkillTriggerInternalStateLockRow> states = indexInternalStates(
            mapper.lockInternalStates(gameId, skillKey, refs.stateKeys)
        );
        Map<String, SkillTriggerCatalogLockRow> skills = indexCatalog(mapper.lockSkills(gameId, refs.skillKeys));
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes = indexEffects(mapper.listEffectShapes(gameId, skillKey));
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes = indexProcesses(mapper.listProcessShapes(gameId, skillKey));

        for (CatalogRef ref : refs.attributes) {
            SkillTriggerCatalogLockRow row = attributes.get(ref.key());
            if (row == null) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_ATTRIBUTE", "属性不存在或不属于当前游戏"));
            } else if (isNewDisabled(current, ref.field(), ref.key()) && DISABLED.equals(row.status())) {
                referenceIssues.add(fieldIssue(ref.field(), "ATTRIBUTE_DISABLED", "不能新增停用属性引用"));
            } else if (ref.numeric() && !isNumeric(row.valueType())) {
                referenceIssues.add(fieldIssue(ref.field(), "REFERENCE_TYPE_MISMATCH", "生命阈值只能引用数值属性"));
            } else if (ref.numeric() && DISABLED.equals(row.status())) {
                referenceIssues.add(fieldIssue(ref.field(), "ATTRIBUTE_DISABLED", "生命阈值必须引用启用的数值属性"));
            }
        }
        for (CatalogRef ref : refs.damageTypes) {
            SkillTriggerCatalogLockRow row = damageTypes.get(ref.key());
            if (row == null) {
                referenceIssues.add(fieldIssue(
                    ref.field(),
                    "UNKNOWN_INTERACTION_DAMAGE_TYPE",
                    "伤害事件筛选引用的伤害类型不存在或不属于当前游戏"
                ));
            } else if (isNewDisabled(current, ref.field(), ref.key()) && DISABLED.equals(row.status())) {
                referenceIssues.add(fieldIssue(ref.field(), "DAMAGE_TYPE_DISABLED", "不能新增停用伤害类型引用"));
            }
        }
        for (CatalogRef ref : refs.statuses) {
            SkillTriggerCatalogLockRow row = statuses.get(ref.key());
            if (row == null) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_STATUS", "状态不存在或不属于当前游戏"));
            } else if (isNewDisabled(current, ref.field(), ref.key()) && DISABLED.equals(row.status())) {
                referenceIssues.add(fieldIssue(ref.field(), "STATUS_DISABLED", "不能新增停用状态引用"));
            }
        }
        for (CatalogRef ref : refs.formulas) {
            if (!formulas.contains(ref.key())) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_FORMULA", "技能公式不存在或不属于当前技能"));
            } else if (mapper.countRuntimeInputNodes(gameId, skillKey, ref.key()) > 0) {
                referenceIssues.add(fieldIssue(ref.field(), "REFERENCE_TYPE_MISMATCH", "该公式不能引用计算时传入参数"));
            }
        }
        for (CatalogRef ref : refs.effects) {
            if (!effects.contains(ref.key())) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_EFFECT", "技能效果不存在或不属于当前技能"));
            }
        }
        for (CatalogRef ref : refs.processes) {
            if (!processes.contains(ref.key())) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_PROCESS", "技能过程不存在或不属于当前技能"));
            }
        }
        for (CatalogRef ref : refs.states) {
            if (!states.containsKey(ref.key())) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_INTERNAL_STATE", "内部状态不存在或不属于当前技能"));
            }
        }
        for (CatalogRef ref : refs.skills) {
            SkillTriggerCatalogLockRow row = skills.get(ref.key());
            if (row == null) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_SKILL", "来源技能不存在或不属于当前游戏"));
            } else if (isNewDisabled(current, ref.field(), ref.key()) && DISABLED.equals(row.status())) {
                referenceIssues.add(fieldIssue(ref.field(), "SKILL_DISABLED", "不能新增停用来源技能引用"));
            }
        }
        validateEventCatalog(
            gameId, skillKey, values.eventSource(), effectShapes, processShapes, states, referenceIssues
        );
        for (int i = 0; i < values.conditionGroups().size(); i++) {
            SkillTriggerConditionGroup group = values.conditionGroups().get(i);
            for (int j = 0; j < group.conditions().size(); j++) {
                validateConditionCatalog(
                    gameId,
                    skillKey,
                    values.eventSource(),
                    group.conditions().get(j),
                    conditionPath(i, j, null),
                    effectShapes,
                    states,
                    referenceIssues
                );
            }
        }
        Map<String, SkillTriggerAction> actionByKey = new LinkedHashMap<>();
        for (SkillTriggerAction action : ordered) {
            actionByKey.put(action.actionKey(), action);
        }
        List<Map<String, String>> bindingIssues = new ArrayList<>();
        for (int i = 0; i < values.actions().size(); i++) {
            SkillTriggerAction action = values.actions().get(i);
            validateActionCatalog(
                gameId,
                skillKey,
                values.eventSource(),
                action,
                actionPath(i, null),
                effectShapes,
                processShapes,
                states,
                referenceIssues
            );
            validateBindingsAndModifiers(
                gameId,
                skillKey,
                values.eventSource(),
                action,
                i,
                ordered,
                actionByKey,
                effectShapes,
                processShapes,
                states,
                parameters,
                bindingIssues,
                referenceIssues
            );
        }
        throwIfReferenceInvalid(referenceIssues);
        throwIfBindingInvalid(bindingIssues);
        validateReflectedDamageRule(values, effectShapes, processShapes);
        return new Catalog(effectShapes, processShapes, states);
    }

    private void validateEventCatalog(
        String gameId,
        String skillKey,
        SkillTriggerEventSource eventSource,
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes,
        Map<String, SkillTriggerInternalStateLockRow> states,
        List<Map<String, String>> issues
    ) {
        switch (eventSource.eventType()) {
            case PROCESS_MOMENT -> {
                SkillTriggerProcessEventDetail detail = (SkillTriggerProcessEventDetail) eventSource.detail();
                validateProcessMoment(
                    gameId, skillKey, detail.processKey(), detail.moment(), "eventSource.detail", processShapes, issues
                );
            }
            case RESULT_AVAILABLE -> {
                SkillTriggerResultEventDetail detail = (SkillTriggerResultEventDetail) eventSource.detail();
                SkillTriggerEffectShapeRow shape = findResult(effectShapes, detail.effectKey(), detail.resultKey());
                if (shape == null) {
                    issues.add(fieldIssue("eventSource.detail.resultKey", "UNKNOWN_RESULT", "结果不存在或不属于当前效果"));
                } else if (shape.hasLifecycle()) {
                    issues.add(fieldIssue(
                        "eventSource.detail.effectKey",
                        "REFERENCE_TYPE_MISMATCH",
                        "RESULT_AVAILABLE 只能引用没有生命周期的效果"
                    ));
                }
            }
            case LIFECYCLE_MOMENT -> {
                SkillTriggerLifecycleEventDetail detail = (SkillTriggerLifecycleEventDetail) eventSource.detail();
                List<SkillTriggerEffectShapeRow> results = effectShapes.getOrDefault(detail.effectKey(), List.of());
                if (results.isEmpty()) {
                    return;
                }
                SkillTriggerEffectShapeRow any = results.get(0);
                if (!any.hasLifecycle()) {
                    issues.add(fieldIssue("eventSource.detail.effectKey", "UNKNOWN_LIFECYCLE", "目标效果没有生命周期"));
                    return;
                }
                if (detail.moment() == SkillTriggerLifecycleEventMoment.PERIODIC
                    && any.periodicIntervalValue() == null) {
                    issues.add(fieldIssue(
                        "eventSource.detail.moment",
                        "REFERENCE_TYPE_MISMATCH",
                        "PERIODIC 要求已配置周期间隔"
                    ));
                }
                if (detail.moment() == SkillTriggerLifecycleEventMoment.NATURAL_END
                    && (any.durationValue() == null
                        || any.expiryMode() == SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY)) {
                    issues.add(fieldIssue(
                        "eventSource.detail.moment",
                        "REFERENCE_TYPE_MISMATCH",
                        "NATURAL_END 要求存在自然持续时间且到期方式不是仅显式移除"
                    ));
                }
            }
            case SPELL_SHIELD_BLOCKED -> {
                SkillTriggerSpellShieldBlockedEventDetail detail =
                    (SkillTriggerSpellShieldBlockedEventDetail) eventSource.detail();
                if (!isEligibleSpellShieldEffect(effectShapes.getOrDefault(detail.shieldEffectKey(), List.of()))) {
                    issues.add(fieldIssue(
                        "eventSource.detail.shieldEffectKey",
                        "REFERENCE_TYPE_MISMATCH",
                        "目标效果必须包含持续生效的法术护盾结果"
                    ));
                }
            }
            case INTERNAL_STATE_CHANGED -> {
                SkillTriggerInternalStateEventDetail detail =
                    (SkillTriggerInternalStateEventDetail) eventSource.detail();
                SkillTriggerInternalStateLockRow state = states.get(detail.stateKey());
                if (state == null) {
                    return;
                }
                if (!internalStateChangeMatches(state.stateType(), detail.changeKind())) {
                    issues.add(fieldIssue(
                        "eventSource.detail.changeKind",
                        "REFERENCE_TYPE_MISMATCH",
                        "内部状态变化种类与状态种类不匹配"
                    ));
                }
            }
            default -> {
            }
        }
    }

    private void validateConditionCatalog(
        String gameId,
        String skillKey,
        SkillTriggerEventSource eventSource,
        SkillTriggerCondition condition,
        String prefix,
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        Map<String, SkillTriggerInternalStateLockRow> states,
        List<Map<String, String>> issues
    ) {
        if (condition.conditionType() == SkillTriggerConditionType.TARGET_CATEGORY_CHECK) {
            issues.addAll(SkillTargetCategoryConditionSemantics.eventIssues(eventSource.eventType(), prefix + ".detail"));
        }
        if (condition.conditionType() == SkillTriggerConditionType.EXPLICIT_TARGET_IS_SOURCE) {
            issues.addAll(SkillExplicitTargetIsSourceConditionSemantics.eventIssues(
                eventSource.eventType(), prefix + ".detail"
            ));
        }
        if (condition.conditionType() == SkillTriggerConditionType.SKILL_HIT_TARGET_IS_ENEMY) {
            issues.addAll(SkillHitTargetIsEnemyConditionSemantics.eventIssues(
                eventSource.eventType(), prefix + ".detail"
            ));
        }
        if (condition.conditionType() == SkillTriggerConditionType.LIFECYCLE_CHECK
            && condition.detail() instanceof SkillTriggerLifecycleConditionDetail detail) {
            issues.addAll(SkillLifecycleConditionSemantics.subjectIssues(detail,
                mapper.findLifecycleScope(gameId, skillKey, detail.effectKey()), eventSource.eventType(), prefix + ".detail"));
        }
        if (condition.conditionType() == SkillTriggerConditionType.STATUS_CHECK
            && condition.detail() instanceof SkillTriggerStatusConditionDetail detail
            && (detail.checkKind() == SkillTriggerStatusCheckKind.STACKS_COMPARE
                || detail.checkKind() == SkillTriggerStatusCheckKind.REMAINING_MS_COMPARE)) {
            if (mapper.countStatusApplyPersistent(
                gameId, skillKey, detail.sourceEffectKey(), detail.sourceResultKey(), detail.statusKey()
            ) <= 0) {
                issues.add(fieldIssue(
                    prefix + ".detail.sourceResultKey",
                    "REFERENCE_TYPE_MISMATCH",
                    "层数和剩余时间只能读取持续施加且状态一致的生命周期结果"
                ));
            }
        }
        if (condition.conditionType() == SkillTriggerConditionType.INTERNAL_STATE_CHECK
            && condition.detail() instanceof SkillTriggerInternalStateConditionDetail detail) {
            SkillTriggerInternalStateLockRow state = states.get(detail.stateKey());
            if (state != null && !internalStateValueMatches(state.stateType(), detail.valueKind())) {
                issues.add(fieldIssue(
                    prefix + ".detail.valueKind",
                    "REFERENCE_TYPE_MISMATCH",
                    "内部状态取值方式与状态种类不匹配"
                ));
            }
            if (detail.valueKind() == SkillTriggerInternalStateValueKind.OPTION_SELECTED && detail.optionKey() != null) {
                List<String> options = mapper.lockOptions(
                    gameId, skillKey, detail.stateKey(), List.of(detail.optionKey())
                );
                if (options == null || options.isEmpty()) {
                    issues.add(fieldIssue(prefix + ".detail.optionKey", "UNKNOWN_MODE_OPTION", "模式选项不存在或不属于当前内部状态"));
                }
            }
        }
        if (condition.conditionType() == SkillTriggerConditionType.EVENT_VALUE_COMPARE
            && condition.detail() instanceof SkillTriggerEventValueConditionDetail detail
            && !eventValueAllowed(eventSource, detail.eventValueKey(), gameId, skillKey)) {
            issues.add(fieldIssue(
                prefix + ".detail.eventValueKey",
                "EVENT_VALUE_NOT_AVAILABLE",
                "当前事件不提供该事件值"
            ));
        }
    }

    private void validateActionCatalog(
        String gameId,
        String skillKey,
        SkillTriggerEventSource eventSource,
        SkillTriggerAction action,
        String prefix,
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes,
        Map<String, SkillTriggerInternalStateLockRow> states,
        List<Map<String, String>> issues
    ) {
        if (action.actionType() != SkillTriggerActionType.ADVANCE_PROCESS
            || !(action.detail() instanceof SkillTriggerAdvanceProcessActionDetail detail)) {
            return;
        }
        if (eventSource != null
            && eventSource.detail() instanceof SkillTriggerSkillEventDetail skill
            && skill.sourceSkillKey() != null
            && !skill.sourceSkillKey().equals(skillKey)) {
            issues.add(fieldIssue("eventSource.detail.sourceSkillKey", "REFERENCE_TYPE_MISMATCH", "推进过程只能引用当前技能"));
        }
        if (detail.processKey() == null) {
            return;
        }
        List<SkillTriggerProcessShapeRow> shapes = processShapes.getOrDefault(detail.processKey(), List.of());
        if (shapes.isEmpty()) {
            return;
        }
        if (processActivation(shapes) == SkillProcessActivationType.PASSIVE) {
            issues.add(fieldIssue(prefix + ".detail.processKey", "REFERENCE_TYPE_MISMATCH", "推进过程不能指向被动过程"));
        }
        if (detail.stepKey() == null) {
            return;
        }
        List<String> locked = mapper.lockSteps(gameId, skillKey, detail.processKey(), List.of(detail.stepKey()));
        if (locked == null || locked.isEmpty()) {
            issues.add(fieldIssue(prefix + ".detail.stepKey", "UNKNOWN_STEP", "步骤不存在或不属于当前过程"));
            return;
        }
        SkillProcessStepType stepType = processStepType(shapes, detail.stepKey());
        SkillTriggerCastPhase phase = eventSource != null
            && eventSource.detail() instanceof SkillTriggerSkillEventDetail skill
            ? skill.castPhase() : null;
        if (phase == SkillTriggerCastPhase.RECAST && stepType != SkillProcessStepType.RECAST) {
            issues.add(fieldIssue(prefix + ".detail.stepKey", "REFERENCE_TYPE_MISMATCH", "再次施放只能推进再次施放步骤"));
        } else if (phase == SkillTriggerCastPhase.CHARGE_RELEASE && stepType != SkillProcessStepType.CHARGE) {
            issues.add(fieldIssue(prefix + ".detail.stepKey", "REFERENCE_TYPE_MISMATCH", "蓄力释放只能推进蓄力步骤"));
        }
    }

    private void validateBindingsAndModifiers(
        String gameId,
        String skillKey,
        SkillTriggerEventSource eventSource,
        SkillTriggerAction action,
        int actionIndex,
        List<SkillTriggerAction> ordered,
        Map<String, SkillTriggerAction> actionByKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes,
        Map<String, SkillTriggerInternalStateLockRow> states,
        Map<String, SkillTriggerParameterRefRow> lockedParameters,
        List<Map<String, String>> bindingIssues,
        List<Map<String, String>> referenceIssues
    ) {
        String targetKey = actionTargetKey(action);
        Map<String, SkillParameterValueType> reachable = analyzer.reachableRuntimeParameters(
            gameId, skillKey, action.actionType(), targetKey, effectShapes, processShapes
        );
        List<SkillTriggerRuntimeInputBinding> bindings =
            action.runtimeInputBindings() == null ? List.of() : action.runtimeInputBindings();
        Set<String> bound = new LinkedHashSet<>();
        for (int b = 0; b < bindings.size(); b++) {
            SkillTriggerRuntimeInputBinding binding = bindings.get(b);
            bound.add(binding.parameterKey());
            SkillTriggerParameterRefRow parameter = lockedParameters.get(binding.parameterKey());
            if (parameter == null || !SkillParameterValueMode.RUNTIME_INPUT.name().equals(parameter.valueMode())) {
                bindingIssues.add(fieldIssue(
                    bindingPath(actionIndex, b, "parameterKey"),
                    "UNKNOWN_PARAMETER",
                    "参数不是当前技能的计算时传入参数"
                ));
                continue;
            }
            if (!reachable.containsKey(binding.parameterKey())) {
                bindingIssues.add(fieldIssue(
                    bindingPath(actionIndex, b, "parameterKey"),
                    "BINDING_EXTRA",
                    "不能绑定未被可达取值引用的参数"
                ));
            }
            validateBindingSource(
                gameId,
                skillKey,
                eventSource,
                action,
                ordered,
                actionByKey,
                binding,
                actionIndex,
                b,
                parameter.valueType(),
                effectShapes,
                processShapes,
                states,
                bindingIssues,
                referenceIssues
            );
        }
        if (action.actionType() == SkillTriggerActionType.EXECUTE_EFFECT
            || action.actionType() == SkillTriggerActionType.START_PROCESS) {
            List<String> missing = new ArrayList<>();
            for (String parameterKey : reachable.keySet()) {
                if (!bound.contains(parameterKey)) {
                    missing.add(parameterKey);
                }
            }
            missing.sort(String::compareTo);
            for (String parameterKey : missing) {
                bindingIssues.add(fieldIssue(
                    actionPath(actionIndex, "runtimeInputBindings"),
                    "BINDING_MISSING",
                    "可达计算时传入参数缺少绑定",
                    parameterKey
                ));
            }
        }
        if (action.actionType() == SkillTriggerActionType.EXECUTE_EFFECT
            && action.detail() instanceof SkillTriggerExecuteEffectActionDetail detail) {
            List<SkillTriggerResultModifier> modifiers =
                action.resultModifiers() == null ? List.of() : action.resultModifiers();
            for (int m = 0; m < modifiers.size(); m++) {
                SkillTriggerResultModifier modifier = modifiers.get(m);
                SkillTriggerEffectShapeRow shape = findResult(effectShapes, detail.effectKey(), modifier.resultKey());
                if (shape == null) {
                    referenceIssues.add(fieldIssue(
                        modifierPath(actionIndex, m, "resultKey"),
                        "UNKNOWN_RESULT",
                        "修正结果不存在或不属于目标效果"
                    ));
                } else if (shape.resultType() == SkillEffectResultType.STATUS_OPERATION) {
                    referenceIssues.add(fieldIssue(
                        modifierPath(actionIndex, m, "resultKey"),
                        "REFERENCE_TYPE_MISMATCH",
                        "状态结果不能接受额外固定修正，减速强度须在效果数值规则中调整"
                    ));
                } else if (!shape.hasValueRule()) {
                    referenceIssues.add(fieldIssue(
                        modifierPath(actionIndex, m, "resultKey"),
                        "REFERENCE_TYPE_MISMATCH",
                        "只能修正具有数值规则的结果"
                    ));
                }
            }
        }
    }

    private void validateBindingSource(
        String gameId,
        String skillKey,
        SkillTriggerEventSource eventSource,
        SkillTriggerAction action,
        List<SkillTriggerAction> ordered,
        Map<String, SkillTriggerAction> actionByKey,
        SkillTriggerRuntimeInputBinding binding,
        int actionIndex,
        int bindingIndex,
        SkillParameterValueType parameterType,
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes,
        Map<String, SkillTriggerInternalStateLockRow> states,
        List<Map<String, String>> bindingIssues,
        List<Map<String, String>> referenceIssues
    ) {
        SkillTriggerValueDomain sourceDomain = null;
        switch (binding.sourceType()) {
            case INTERNAL_STATE -> {
                if (!(binding.detail() instanceof SkillTriggerInternalStateBindingDetail detail)) {
                    bindingIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail"),
                        "TYPE_MISMATCH",
                        "内部状态来源明细形状不合法"
                    ));
                    return;
                }
                SkillTriggerInternalStateLockRow state = states.get(detail.stateKey());
                if (state == null) {
                    referenceIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail.stateKey"),
                        "UNKNOWN_INTERNAL_STATE",
                        "内部状态不存在或不属于当前技能"
                    ));
                    return;
                }
                if (!internalStateValueMatches(state.stateType(), detail.valueKind())) {
                    referenceIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail.valueKind"),
                        "REFERENCE_TYPE_MISMATCH",
                        "内部状态取值方式与状态种类不匹配"
                    ));
                }
                if (detail.valueKind() == SkillTriggerInternalStateValueKind.OPTION_SELECTED) {
                    if (detail.optionKey() == null) {
                        bindingIssues.add(fieldIssue(
                            bindingPath(actionIndex, bindingIndex, "detail.optionKey"),
                            "REQUIRED",
                            "模式选项不能为空"
                        ));
                    } else {
                        List<String> options = mapper.lockOptions(
                            gameId, skillKey, detail.stateKey(), List.of(detail.optionKey())
                        );
                        if (options == null || options.isEmpty()) {
                            referenceIssues.add(fieldIssue(
                                bindingPath(actionIndex, bindingIndex, "detail.optionKey"),
                                "UNKNOWN_MODE_OPTION",
                                "模式选项不存在或不属于当前内部状态"
                            ));
                        }
                    }
                }
                sourceDomain = detail.valueKind() == SkillTriggerInternalStateValueKind.REMAINING_MS
                    ? SkillTriggerValueDomain.DECIMAL
                    : SkillTriggerValueDomain.INTEGER;
            }
            case COMBAT_STATUS -> {
                if (!(binding.detail() instanceof SkillTriggerCombatStatusBindingDetail detail)) {
                    bindingIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail"),
                        "TYPE_MISMATCH",
                        "战斗状态来源明细形状不合法"
                    ));
                    return;
                }
                rejectUnavailableEventSource(
                    eventSource.eventType(),
                    detail.subject(),
                    bindingPath(actionIndex, bindingIndex, "detail.subject"),
                    referenceIssues
                );
                if (detail.valueKind() == SkillTriggerCombatStatusValueKind.STACKS
                    || detail.valueKind() == SkillTriggerCombatStatusValueKind.REMAINING_MS) {
                    if (mapper.countStatusApplyPersistent(
                        gameId, skillKey, detail.sourceEffectKey(), detail.sourceResultKey(), detail.statusKey()
                    ) <= 0) {
                        referenceIssues.add(fieldIssue(
                            bindingPath(actionIndex, bindingIndex, "detail.sourceResultKey"),
                            "REFERENCE_TYPE_MISMATCH",
                            "层数和剩余时间只能读取持续施加且状态一致的生命周期结果"
                        ));
                    }
                    sourceDomain = detail.valueKind() == SkillTriggerCombatStatusValueKind.STACKS
                        ? SkillTriggerValueDomain.INTEGER
                        : SkillTriggerValueDomain.DECIMAL;
                } else {
                    sourceDomain = SkillTriggerValueDomain.INTEGER;
                }
            }
            case EVENT_VALUE -> {
                if (!(binding.detail() instanceof SkillTriggerEventValueBindingDetail detail)) {
                    bindingIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail"),
                        "TYPE_MISMATCH",
                        "事件值来源明细形状不合法"
                    ));
                    return;
                }
                if (!eventValueAllowed(eventSource, detail.eventValueKey(), gameId, skillKey)) {
                    referenceIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail.eventValueKey"),
                        "EVENT_VALUE_NOT_AVAILABLE",
                        "当前事件不提供该事件值"
                    ));
                }
                sourceDomain = SkillTriggerEventCapabilities.valueDomain(detail.eventValueKey());
            }
            case SOURCE_CAST_RESOURCE_COST -> {
                if (!(binding.detail() instanceof SkillTriggerSourceCastResourceCostBindingDetail detail)) {
                    bindingIssues.add(fieldIssue(bindingPath(actionIndex, bindingIndex, "detail"),
                        "TYPE_MISMATCH", "来源施放消耗明细形状不合法"));
                    return;
                }
                if (detail.attributeKey() == null) {
                    bindingIssues.add(fieldIssue(bindingPath(actionIndex, bindingIndex, "detail.attributeKey"),
                        "REQUIRED", "资源属性不能为空"));
                }
                if (!sourceCastResourceCostAllowed(eventSource, skillKey, processShapes)) {
                    referenceIssues.add(fieldIssue(bindingPath(actionIndex, bindingIndex, "sourceType"),
                        "EVENT_VALUE_NOT_AVAILABLE",
                        "来源施放消耗仅适用于明确来源技能的技能命中，或当前技能非被动过程的完成与失败时点"));
                }
                sourceDomain = SkillTriggerValueDomain.DECIMAL;
            }
            case PRIOR_ACTION_RESULT -> {
                if (!(binding.detail() instanceof SkillTriggerPriorResultBindingDetail detail)) {
                    bindingIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail"),
                        "TYPE_MISMATCH",
                        "前序结果来源明细形状不合法"
                    ));
                    return;
                }
                SkillTriggerAction sourceAction = actionByKey.get(detail.sourceActionKey());
                if (sourceAction == null
                    || sourceAction.actionType() != SkillTriggerActionType.EXECUTE_EFFECT
                    || !isEarlier(ordered, detail.sourceActionKey(), action.actionKey())) {
                    bindingIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail.sourceActionKey"),
                        "RESULT_NOT_IMMEDIATELY_AVAILABLE",
                        "前序结果只能引用同一规则中排序更早的执行效果动作"
                    ));
                    return;
                }
                String sourceEffectKey = ((SkillTriggerExecuteEffectActionDetail) sourceAction.detail()).effectKey();
                SkillTriggerEffectShapeRow shapeRow = findResult(effectShapes, sourceEffectKey, detail.sourceResultKey());
                if (shapeRow == null) {
                    referenceIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail.sourceResultKey"),
                        "UNKNOWN_RESULT",
                        "前序结果不存在或不属于来源动作目标效果"
                    ));
                    return;
                }
                SkillTriggerPriorResultOutputs.Shape shape = SkillTriggerPriorResultOutputs.Shape.from(shapeRow);
                if (!SkillTriggerPriorResultOutputs.immediatelyAvailable(shape)) {
                    bindingIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail.sourceResultKey"),
                        "SOURCE_RESULT_NOT_IMMEDIATE",
                        "前序结果必须是即时可用的结果"
                    ));
                    return;
                }
                if (!SkillTriggerPriorResultOutputs.available(shape, detail.outputKind())) {
                    bindingIssues.add(fieldIssue(
                        bindingPath(actionIndex, bindingIndex, "detail.outputKind"),
                        "OUTPUT_KIND_NOT_AVAILABLE",
                        "来源结果不提供该前序输出"
                    ));
                    return;
                }
                sourceDomain = SkillTriggerPriorResultOutputs.valueDomain(detail.outputKind());
            }
        }
        if (sourceDomain != null && !compatible(sourceDomain, parameterType)) {
            bindingIssues.add(fieldIssue(
                bindingPath(actionIndex, bindingIndex, "parameterKey"),
                "REFERENCE_TYPE_MISMATCH",
                "来源值类型与参数类型不兼容"
            ));
        }
    }

    private void validateProcessMoment(
        String gameId,
        String skillKey,
        String processKey,
        SkillProcessMoment moment,
        String prefix,
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes,
        List<Map<String, String>> issues
    ) {
        if (moment == null || moment.momentType() == null) {
            return;
        }
        if (moment.failureReason() != null && moment.momentType() != SkillProcessMomentType.PROCESS_FAILURE) {
            issues.add(fieldIssue(prefix + ".moment.failureReason", "FORBIDDEN", "失败原因筛选只能用于过程失败时点"));
        }
        if (PROCESS_MOMENTS.contains(moment.momentType())) {
            if (moment.stepKey() != null) {
                issues.add(fieldIssue(prefix + ".moment.stepKey", "STEP_FORBIDDEN", "该过程时点不能指定步骤"));
            }
            return;
        }
        if (!STEP_MOMENTS.contains(moment.momentType())) {
            issues.add(fieldIssue(prefix + ".moment.momentType", "REFERENCE_TYPE_MISMATCH", "过程时点种类不合法"));
            return;
        }
        if (moment.stepKey() == null) {
            issues.add(fieldIssue(prefix + ".moment.stepKey", "REQUIRED", "该过程时点必须指定步骤"));
            return;
        }
        List<String> locked = mapper.lockSteps(gameId, skillKey, processKey, List.of(moment.stepKey()));
        if (locked == null || locked.isEmpty()) {
            issues.add(fieldIssue(prefix + ".moment.stepKey", "UNKNOWN_STEP", "步骤不存在或不属于当前过程"));
            return;
        }
        if (moment.momentType() == SkillProcessMomentType.STEP_TIMEOUT) {
            String stepTypeName = mapper.findStepType(gameId, skillKey, processKey, moment.stepKey());
            SkillProcessStepType stepType = stepTypeName == null ? null : SkillProcessStepType.valueOf(stepTypeName);
            if (stepType == null || !TIMEOUT_STEPS.contains(stepType)) {
                issues.add(fieldIssue(
                    prefix + ".moment.stepKey",
                    "TIMEOUT_STEP_INVALID",
                    "超时时点只能引用蓄力、重施或强化普攻步骤"
                ));
            }
        }
    }

    private boolean eventValueAllowed(
        SkillTriggerEventSource eventSource,
        SkillTriggerEventValueKey valueKey,
        String gameId,
        String skillKey
    ) {
        if (eventSource == null || valueKey == null) {
            return false;
        }
        return switch (eventSource.eventType()) {
            case LIFECYCLE_MOMENT -> eventSource.detail() instanceof SkillTriggerLifecycleEventDetail detail
                && SkillTriggerEventCapabilities.lifecycleEventValueAllowed(valueKey, detail.moment());
            case INTERNAL_STATE_CHANGED -> eventSource.detail() instanceof SkillTriggerInternalStateEventDetail detail
                && SkillTriggerEventCapabilities.internalStateEventValueAllowed(valueKey, detail.changeKind());
            case PROCESS_MOMENT -> {
                if (!(eventSource.detail() instanceof SkillTriggerProcessEventDetail detail)
                    || detail.moment() == null) {
                    yield false;
                }
                SkillProcessStepType stepType = null;
                if (detail.moment().stepKey() != null) {
                    String raw = mapper.findStepType(gameId, skillKey, detail.processKey(), detail.moment().stepKey());
                    stepType = raw == null ? null : SkillProcessStepType.valueOf(raw);
                }
                yield SkillTriggerEventCapabilities.eventValueAllowed(
                    eventSource.eventType(),
                    valueKey,
                    detail.moment().momentType(),
                    stepType
                );
            }
            default -> SkillTriggerEventCapabilities.eventValueAllowed(
                eventSource.eventType(),
                valueKey,
                null,
                null
            );
        };
    }

    private void collectEventRefs(
        SkillTriggerEventSource eventSource,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        List<Map<String, String>> referenceIssues
    ) {
        switch (eventSource.eventType()) {
            case PROCESS_MOMENT -> {
                SkillTriggerProcessEventDetail detail = (SkillTriggerProcessEventDetail) eventSource.detail();
                refs.addProcess(new CatalogRef("eventSource.detail.processKey", detail.processKey()));
            }
            case PROCESS_CANCEL_REQUESTED -> {
                SkillTriggerCancelProcessEventDetail detail = (SkillTriggerCancelProcessEventDetail) eventSource.detail();
                refs.addProcess(new CatalogRef("eventSource.detail.processKey", detail.processKey()));
            }
            case SKILL_USED, SKILL_HIT -> {
                SkillTriggerSkillEventDetail detail = (SkillTriggerSkillEventDetail) eventSource.detail();
                if (detail.sourceSkillKey() != null) {
                    refs.addSkill(new CatalogRef("eventSource.detail.sourceSkillKey", detail.sourceSkillKey()));
                }
            }
            case HIT_LINK_APPLIED, ATTACK_LINK_APPLIED -> {
                SkillTriggerLinkEventDetail detail = (SkillTriggerLinkEventDetail) eventSource.detail();
                if (detail.sourceSkillKey() != null) {
                    refs.addSkill(new CatalogRef("eventSource.detail.sourceSkillKey", detail.sourceSkillKey()));
                }
            }
            case RESULT_AVAILABLE -> {
                SkillTriggerResultEventDetail detail = (SkillTriggerResultEventDetail) eventSource.detail();
                refs.addEffect(new CatalogRef("eventSource.detail.effectKey", detail.effectKey()));
            }
            case LIFECYCLE_MOMENT -> {
                SkillTriggerLifecycleEventDetail detail = (SkillTriggerLifecycleEventDetail) eventSource.detail();
                refs.addEffect(new CatalogRef("eventSource.detail.effectKey", detail.effectKey()));
            }
            case SPELL_SHIELD_BLOCKED -> {
                SkillTriggerSpellShieldBlockedEventDetail detail =
                    (SkillTriggerSpellShieldBlockedEventDetail) eventSource.detail();
                refs.addEffect(new CatalogRef(
                    "eventSource.detail.shieldEffectKey",
                    detail.shieldEffectKey()
                ));
            }
            case STATUS_CHANGED -> {
                SkillTriggerStatusEventDetail detail = (SkillTriggerStatusEventDetail) eventSource.detail();
                refs.addStatus(new CatalogRef("eventSource.detail.statusKey", detail.statusKey()));
                rejectUnavailableEventSource(
                    eventSource.eventType(),
                    detail.subject(),
                    "eventSource.detail.subject",
                    referenceIssues
                );
            }
            case HEALTH_THRESHOLD_CROSSED -> {
                SkillTriggerHealthThresholdEventDetail detail =
                    (SkillTriggerHealthThresholdEventDetail) eventSource.detail();
                refs.addAttribute(new CatalogRef("eventSource.detail.attributeKey", detail.attributeKey(), true));
                refs.addFormula(new CatalogRef("eventSource.detail.thresholdValue", detail.thresholdValue()));
                rejectUnavailableEventSource(
                    eventSource.eventType(),
                    detail.subject(),
                    "eventSource.detail.subject",
                    referenceIssues
                );
            }
            case INTERNAL_STATE_CHANGED -> {
                SkillTriggerInternalStateEventDetail detail =
                    (SkillTriggerInternalStateEventDetail) eventSource.detail();
                refs.addState(new CatalogRef("eventSource.detail.stateKey", detail.stateKey()));
            }
            case ENTITY_DIED, ENTITY_UNTARGETABLE -> {
                SkillTriggerSubjectEventDetail detail = (SkillTriggerSubjectEventDetail) eventSource.detail();
                rejectUnavailableEventSource(
                    eventSource.eventType(),
                    detail.subject(),
                    "eventSource.detail.subject",
                    referenceIssues
                );
            }
            case DAMAGE_PENDING, DAMAGE_DEALT, DAMAGE_TAKEN -> {
                SkillTriggerDamageEventDetail detail = (SkillTriggerDamageEventDetail) eventSource.detail();
                if (detail.damageTypeKey() != null) {
                    refs.addDamageType(new CatalogRef("eventSource.detail.damageTypeKey", detail.damageTypeKey()));
                }
            }
            default -> {
            }
        }
    }

    private void collectConditionRefs(
        SkillTriggerEventSource eventSource,
        SkillTriggerCondition condition,
        String prefix,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        List<Map<String, String>> referenceIssues
    ) {
        switch (condition.conditionType()) {
            case ATTRIBUTE_COMPARE -> {
                SkillTriggerAttributeConditionDetail detail = (SkillTriggerAttributeConditionDetail) condition.detail();
                refs.addAttribute(new CatalogRef(prefix + ".detail.attributeKey", detail.attributeKey()));
                refs.addFormula(new CatalogRef(prefix + ".detail.comparisonValue", detail.comparisonValue()));
                rejectUnavailableEventSource(
                    eventSource == null ? null : eventSource.eventType(),
                    detail.subject(),
                    prefix + ".detail.subject",
                    referenceIssues
                );
            }
            case STATUS_CHECK -> {
                SkillTriggerStatusConditionDetail detail = (SkillTriggerStatusConditionDetail) condition.detail();
                refs.addStatus(new CatalogRef(prefix + ".detail.statusKey", detail.statusKey()));
                rejectUnavailableEventSource(
                    eventSource == null ? null : eventSource.eventType(),
                    detail.subject(),
                    prefix + ".detail.subject",
                    referenceIssues
                );
                if (detail.sourceEffectKey() != null) {
                    refs.addEffect(new CatalogRef(prefix + ".detail.sourceEffectKey", detail.sourceEffectKey()));
                }
                if (detail.comparisonValue() != null) {
                    refs.addFormula(new CatalogRef(prefix + ".detail.comparisonValue", detail.comparisonValue()));
                }
            }
            case LIFECYCLE_CHECK -> {
                SkillTriggerLifecycleConditionDetail detail = (SkillTriggerLifecycleConditionDetail) condition.detail();
                refs.addEffect(new CatalogRef(prefix + ".detail.effectKey", detail.effectKey()));
                if (detail.comparisonValue() != null) {
                    refs.addFormula(new CatalogRef(prefix + ".detail.comparisonValue", detail.comparisonValue()));
                }
            }
            case TARGET_CATEGORY_CHECK -> { /* 固定类别不引用技能目录或执行对象。 */ }
            case EXPLICIT_TARGET_IS_SOURCE -> { /* 显式目标身份检查不引用技能目录或执行对象。 */ }
            case SKILL_HIT_TARGET_IS_ENEMY -> { /* 命中对象敌我关系检查不引用目录或执行对象。 */ }
            case INTERNAL_STATE_CHECK -> {
                SkillTriggerInternalStateConditionDetail detail =
                    (SkillTriggerInternalStateConditionDetail) condition.detail();
                refs.addState(new CatalogRef(prefix + ".detail.stateKey", detail.stateKey()));
                if (detail.comparisonValue() != null) {
                    refs.addFormula(new CatalogRef(prefix + ".detail.comparisonValue", detail.comparisonValue()));
                }
            }
            case EVENT_VALUE_COMPARE -> {
                SkillTriggerEventValueConditionDetail detail =
                    (SkillTriggerEventValueConditionDetail) condition.detail();
                refs.addFormula(new CatalogRef(prefix + ".detail.comparisonValue", detail.comparisonValue()));
            }
        }
    }

    private void collectActionRefs(
        SkillTriggerEventSource eventSource,
        SkillTriggerAction action,
        String prefix,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        List<Map<String, String>> referenceIssues
    ) {
        switch (action.actionType()) {
            case EXECUTE_EFFECT -> {
                SkillTriggerExecuteEffectActionDetail detail = (SkillTriggerExecuteEffectActionDetail) action.detail();
                refs.addEffect(new CatalogRef(prefix + ".detail.effectKey", detail.effectKey()));
            }
            case START_PROCESS -> {
                SkillTriggerStartProcessActionDetail detail = (SkillTriggerStartProcessActionDetail) action.detail();
                refs.addProcess(new CatalogRef(prefix + ".detail.processKey", detail.processKey()));
            }
            case FAIL_PROCESS -> {
                SkillTriggerFailProcessActionDetail detail = (SkillTriggerFailProcessActionDetail) action.detail();
                refs.addProcess(new CatalogRef(prefix + ".detail.processKey", detail.processKey()));
            }
            case ADVANCE_PROCESS -> {
                SkillTriggerAdvanceProcessActionDetail detail = (SkillTriggerAdvanceProcessActionDetail) action.detail();
                refs.addProcess(new CatalogRef(prefix + ".detail.processKey", detail.processKey()));
            }
        }
        rejectUnavailableTargetContext(
            eventSource == null ? null : eventSource.eventType(),
            action.targetContext(),
            prefix + ".targetContext",
            referenceIssues
        );
        List<SkillTriggerRuntimeInputBinding> bindings =
            action.runtimeInputBindings() == null ? List.of() : action.runtimeInputBindings();
        for (int b = 0; b < bindings.size(); b++) {
            SkillTriggerRuntimeInputBinding binding = bindings.get(b);
            refs.addParameter(new CatalogRef(bindingPathFromPrefix(prefix, b, "parameterKey"), binding.parameterKey()));
            if (binding.sourceType() == SkillTriggerRuntimeInputSourceType.INTERNAL_STATE
                && binding.detail() instanceof SkillTriggerInternalStateBindingDetail detail) {
                refs.addState(new CatalogRef(bindingPathFromPrefix(prefix, b, "detail.stateKey"), detail.stateKey()));
            } else if (binding.sourceType() == SkillTriggerRuntimeInputSourceType.SOURCE_CAST_RESOURCE_COST
                && binding.detail() instanceof SkillTriggerSourceCastResourceCostBindingDetail detail) {
                if (detail.attributeKey() != null) {
                    refs.addAttribute(new CatalogRef(bindingPathFromPrefix(prefix, b, "detail.attributeKey"), detail.attributeKey()));
                }
            } else if (binding.sourceType() == SkillTriggerRuntimeInputSourceType.COMBAT_STATUS
                && binding.detail() instanceof SkillTriggerCombatStatusBindingDetail detail) {
                refs.addStatus(new CatalogRef(bindingPathFromPrefix(prefix, b, "detail.statusKey"), detail.statusKey()));
                rejectUnavailableEventSource(
                    eventSource == null ? null : eventSource.eventType(),
                    detail.subject(),
                    bindingPathFromPrefix(prefix, b, "detail.subject"),
                    referenceIssues
                );
                if (detail.sourceEffectKey() != null) {
                    refs.addEffect(new CatalogRef(
                        bindingPathFromPrefix(prefix, b, "detail.sourceEffectKey"),
                        detail.sourceEffectKey()
                    ));
                }
            }
        }
    }

    private void insertAggregate(String gameId, String skillKey, ValidatedRule values) {
        mapper.insertRule(gameId, skillKey, values.ruleKey(), values.name(), values.description(), values.sortOrder(),
            values.eventSource().eventType().name(), AggregateJson.write(values.eventSource()),
            AggregateJson.write(SkillTriggerRuleAssembler.orderedGroups(values.conditionGroups())),
            AggregateJson.write(SkillTriggerRuleAssembler.orderedActions(values.actions())),
            AggregateJson.write(new SkillTriggerRuleAssembler.Limits(
                values.perTargetCooldown(), values.maxTriggersPerProcess(), values.oncePerUse())));
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
        for (SkillTriggerRuleRow rule : nullToEmpty(mapper.listRules(gameId, skillKey))) {
            for (SkillTriggerStatusConditionRow condition : nullToEmpty(
                mapper.listStatusConditions(gameId, skillKey, rule.ruleKey())
            )) {
                if (!effectKey.equals(condition.sourceEffectKey()) || condition.sourceResultKey() == null) {
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
                mapper.listCombatStatusBindings(gameId, skillKey, rule.ruleKey())
            )) {
                if (!effectKey.equals(binding.sourceEffectKey()) || binding.sourceResultKey() == null) {
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

    private static String actionTargetKey(SkillTriggerAction action) {
        return switch (action.actionType()) {
            case EXECUTE_EFFECT -> ((SkillTriggerExecuteEffectActionDetail) action.detail()).effectKey();
            case START_PROCESS -> ((SkillTriggerStartProcessActionDetail) action.detail()).processKey();
            case FAIL_PROCESS -> ((SkillTriggerFailProcessActionDetail) action.detail()).processKey();
            case ADVANCE_PROCESS -> ((SkillTriggerAdvanceProcessActionDetail) action.detail()).processKey();
        };
    }

    private static boolean isEarlier(List<SkillTriggerAction> ordered, String sourceActionKey, String currentActionKey) {
        int source = -1;
        int current = -1;
        for (int i = 0; i < ordered.size(); i++) {
            if (ordered.get(i).actionKey().equals(sourceActionKey)) {
                source = i;
            }
            if (ordered.get(i).actionKey().equals(currentActionKey)) {
                current = i;
            }
        }
        return source >= 0 && current >= 0 && source < current;
    }

    private static boolean compatible(SkillTriggerValueDomain source, SkillParameterValueType parameterType) {
        if (source == SkillTriggerValueDomain.INTEGER) {
            return parameterType == SkillParameterValueType.INTEGER || parameterType == SkillParameterValueType.DECIMAL;
        }
        return parameterType == SkillParameterValueType.DECIMAL;
    }

    private static boolean internalStateChangeMatches(
        SkillInternalStateType stateType,
        SkillTriggerInternalStateChangeKind changeKind
    ) {
        return switch (changeKind) {
            case VALUE_CHANGED -> stateType == SkillInternalStateType.COUNTER || stateType == SkillInternalStateType.AMMO;
            case OPTION_SELECTED -> stateType == SkillInternalStateType.MODE;
            case FLAG_CHANGED -> stateType == SkillInternalStateType.FLAG;
            case COOLDOWN_READY -> stateType == SkillInternalStateType.INTERNAL_COOLDOWN;
        };
    }

    private static boolean internalStateValueMatches(
        SkillInternalStateType stateType,
        SkillTriggerInternalStateValueKind valueKind
    ) {
        return switch (valueKind) {
            case VALUE -> stateType == SkillInternalStateType.COUNTER || stateType == SkillInternalStateType.AMMO;
            case OPTION_SELECTED -> stateType == SkillInternalStateType.MODE;
            case ENABLED -> stateType == SkillInternalStateType.FLAG;
            case REMAINING_MS -> stateType == SkillInternalStateType.INTERNAL_COOLDOWN;
        };
    }

    private static SkillTriggerEffectShapeRow findResult(
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        String effectKey,
        String resultKey
    ) {
        if (resultKey == null) {
            return null;
        }
        for (SkillTriggerEffectShapeRow row : effectShapes.getOrDefault(effectKey, List.of())) {
            if (row.resultKey() != null && row.resultKey().equals(resultKey)) {
                return row;
            }
        }
        return null;
    }

    private static void require(SkillNumericValue value, String path, String message, List<Map<String, String>> issues) {
        if (value == null) issues.add(fieldIssue(path, "REQUIRED", message));
    }

    private static boolean isNumeric(String valueType) {
        return AttributeValueType.DECIMAL.name().equals(valueType)
            || AttributeValueType.INTEGER.name().equals(valueType);
    }

    private void validateReflectedDamageRule(
        ValidatedRule values,
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        for (int i = 0; i < values.actions().size(); i++) {
            SkillTriggerAction action = values.actions().get(i);
            boolean reflected = switch (action.actionType()) {
                case EXECUTE_EFFECT -> action.detail() instanceof SkillTriggerExecuteEffectActionDetail detail
                    && effectContainsReflectedDamage(detail.effectKey(), effectShapes);
                case START_PROCESS -> action.detail() instanceof SkillTriggerStartProcessActionDetail detail
                    && processShapes.getOrDefault(detail.processKey(), List.of()).stream()
                        .map(SkillTriggerProcessShapeRow::bindingEffectKey)
                        .filter(Objects::nonNull)
                        .anyMatch(effectKey -> effectContainsReflectedDamage(effectKey, effectShapes));
                case ADVANCE_PROCESS -> action.detail() instanceof SkillTriggerAdvanceProcessActionDetail detail
                    && processShapes.getOrDefault(detail.processKey(), List.of()).stream()
                        .map(SkillTriggerProcessShapeRow::bindingEffectKey)
                        .filter(Objects::nonNull)
                        .anyMatch(effectKey -> effectContainsReflectedDamage(effectKey, effectShapes));
                case FAIL_PROCESS -> false;
            };
            if (!reflected) {
                continue;
            }
            if (values.eventSource().eventType() != SkillTriggerEventType.DAMAGE_PENDING
                && values.eventSource().eventType() != SkillTriggerEventType.DAMAGE_TAKEN) {
                issues.add(fieldIssue(
                    "eventSource.eventType",
                    "REFLECT_LOOP_UNGUARDED",
                    "反伤效果只能由即将受到伤害或受到伤害事件触发"
                ));
            }
            if (action.targetContext() != SkillTriggerTargetContext.EVENT_SOURCE) {
                issues.add(fieldIssue(
                    actionPath(i, "targetContext"),
                    "REFLECT_LOOP_UNGUARDED",
                    "反伤效果必须作用于事件来源对象"
                ));
            }
            boolean directOnly = values.eventSource().detail() instanceof SkillTriggerDamageEventDetail damage
                && damage.originKind() == SkillTriggerDamageOriginKind.DIRECT;
            if (!directOnly && values.perTargetCooldown() == null) {
                issues.add(fieldIssue(
                    "eventSource.detail.originKind",
                    "REFLECT_LOOP_UNGUARDED",
                    "反伤规则必须只接收直接伤害，或配置每目标冷却"
                ));
            }
        }
        if (!issues.isEmpty()) {
            issues.sort(Comparator.comparing(issue -> issue.get("field")));
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.TRIGGER_RULE_CYCLE_UNGUARDED",
                "技能触发规则存在无保护反伤循环",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static boolean effectContainsReflectedDamage(
        String effectKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes
    ) {
        return effectShapes.getOrDefault(effectKey, List.of()).stream()
            .anyMatch(row -> row.resultType() == SkillEffectResultType.DAMAGE
                && row.damageOriginKind() == SkillEffectDamageOriginKind.REFLECTED);
    }

    private static boolean isNewDisabled(SkillTriggerRuleDetailResponse current, String field, String key) {
        if (current == null) {
            return true;
        }
        String serialized = current.toString();
        return serialized == null || !serialized.contains(key);
    }

    private void lockParentSkill(String gameId, String skillKey) {
        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
    }

    private void requireSkillExists(String gameId, String skillKey) {
        if (skillMapper.findById(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw gameNotFound(gameId);
        }
    }

    private static void rejectUnavailableEventSource(
        SkillTriggerEventType eventType,
        SkillTriggerSubject subject,
        String field,
        List<Map<String, String>> issues
    ) {
        if (subject == SkillTriggerSubject.EVENT_SOURCE && !SkillTriggerEventCapabilities.hasEventSource(eventType)) {
            issues.add(fieldIssue(field, "EVENT_SOURCE_NOT_AVAILABLE", "当前事件不提供事件来源对象"));
        }
    }

    private static void rejectUnavailableTargetContext(
        SkillTriggerEventType eventType,
        SkillTriggerTargetContext targetContext,
        String field,
        List<Map<String, String>> issues
    ) {
        if (targetContext == SkillTriggerTargetContext.EVENT_SOURCE
            && !SkillTriggerEventCapabilities.hasEventSource(eventType)) {
            issues.add(fieldIssue(field, "EVENT_SOURCE_NOT_AVAILABLE", "当前事件不提供事件来源对象"));
        }
    }

    private static void require(Object value, String field, String message, List<Map<String, String>> issues) {
        if (value == null || (value instanceof String text && text.isBlank())) {
            issues.add(fieldIssue(field, "REQUIRED", message));
        }
    }

    private static void rejectProcessControlShell(
        SkillTriggerAction action,
        String prefix,
        String label,
        List<Map<String, String>> issues
    ) {
        if (action.targetContext() != null) {
            issues.add(fieldIssue(prefix + ".targetContext", "FORBIDDEN", label + "不能指定目标对象"));
        }
        if (action.runtimeInputBindings() != null && !action.runtimeInputBindings().isEmpty()) {
            issues.add(fieldIssue(prefix + ".runtimeInputBindings", "FORBIDDEN", label + "不能保存动态输入绑定"));
        }
        if (action.resultModifiers() != null && !action.resultModifiers().isEmpty()) {
            issues.add(fieldIssue(prefix + ".resultModifiers", "FORBIDDEN", label + "不能保存结果修正"));
        }
    }

    private static void collectMomentNoise(List<Map<String, String>> issues, String prefix, SkillProcessMoment moment) {
        if (moment == null) {
            return;
        }
        for (String field : nullToEmptySet(moment.unknownFields())) {
            issues.add(fieldIssue(prefix + "." + field, "UNKNOWN_FIELD", "过程时点包含未知字段"));
        }
        if (moment.failureReason() != null && moment.momentType() != SkillProcessMomentType.PROCESS_FAILURE) {
            issues.add(fieldIssue(prefix + ".failureReason", "FORBIDDEN", "失败原因筛选只能用于过程失败时点"));
        }
    }

    private static boolean sourceCastResourceCostAllowed(
        SkillTriggerEventSource eventSource,
        String skillKey,
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes
    ) {
        if (eventSource == null || eventSource.eventType() == null) {
            return false;
        }
        if (eventSource.detail() instanceof SkillTriggerSkillEventDetail skillEvent) {
            return SkillTriggerEventCapabilities.sourceCastResourceCostAvailable(
                eventSource.eventType(), skillEvent.sourceSkillKey());
        }
        if (!(eventSource.detail() instanceof SkillTriggerProcessEventDetail process)
            || process.moment() == null) {
            return false;
        }
        boolean currentSkillNonPassive = process.processKey() != null
            && processActivation(processShapes.getOrDefault(process.processKey(), List.of()))
                != SkillProcessActivationType.PASSIVE
            && processShapes.containsKey(process.processKey());
        return SkillTriggerEventCapabilities.sourceCastResourceCostAvailable(
            eventSource.eventType(),
            null,
            process.moment().momentType(),
            currentSkillNonPassive
        );
    }

    private static SkillProcessActivationType processActivation(List<SkillTriggerProcessShapeRow> rows) {
        for (SkillTriggerProcessShapeRow row : nullToEmpty(rows)) {
            if (row.activationType() != null) {
                return row.activationType();
            }
        }
        return null;
    }

    private static SkillProcessStepType processStepType(List<SkillTriggerProcessShapeRow> rows, String stepKey) {
        for (SkillTriggerProcessShapeRow row : nullToEmpty(rows)) {
            if (stepKey.equals(row.stepKey()) && row.stepType() != null) {
                return row.stepType();
            }
        }
        return null;
    }

    private static void collectDetailNoise(
        List<Map<String, String>> bodyIssues,
        String prefix,
        Set<String> foreignFields,
        Set<String> unknownFields
    ) {
        for (String field : nullToEmptySet(foreignFields)) {
            bodyIssues.add(fieldIssue(prefix + "." + field, "FIELD_MUTEX", "明细字段互斥"));
        }
        for (String field : nullToEmptySet(unknownFields)) {
            bodyIssues.add(fieldIssue(prefix + "." + field, "UNKNOWN_FIELD", "明细包含未知字段"));
        }
    }

    private static Map<String, SkillTriggerCondition> indexExistingConditions(SkillTriggerRuleDetailResponse current) {
        Map<String, SkillTriggerCondition> indexed = new LinkedHashMap<>();
        for (SkillTriggerConditionGroup group : current.conditionGroups()) {
            for (SkillTriggerCondition condition : group.conditions()) {
                indexed.put(group.groupKey() + '\u0000' + condition.conditionKey(), condition);
            }
        }
        return indexed;
    }

    private static Map<String, SkillTriggerCatalogLockRow> indexCatalog(List<SkillTriggerCatalogLockRow> rows) {
        Map<String, SkillTriggerCatalogLockRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerCatalogLockRow row : nullToEmpty(rows)) {
            indexed.put(row.key(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerParameterRefRow> indexParameters(List<SkillTriggerParameterRefRow> rows) {
        Map<String, SkillTriggerParameterRefRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerParameterRefRow row : nullToEmpty(rows)) {
            indexed.put(row.parameterKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillTriggerInternalStateLockRow> indexInternalStates(
        List<SkillTriggerInternalStateLockRow> rows
    ) {
        Map<String, SkillTriggerInternalStateLockRow> indexed = new LinkedHashMap<>();
        for (SkillTriggerInternalStateLockRow row : nullToEmpty(rows)) {
            indexed.put(row.stateKey(), row);
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

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能触发规则不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static void throwIfInvalidBody(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_BODY",
                "技能触发规则明细不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static void throwIfReferenceInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_TRIGGER_RULE_REFERENCE",
                "技能触发规则引用不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static void throwIfBindingInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_RUNTIME_INPUT_BINDING",
                "动态输入绑定不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException gameNotFound(String gameId) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.GAME_NOT_FOUND",
            "游戏不存在",
            Map.of("gameId", gameId == null ? "" : gameId)
        );
    }

    private static ApiException skillNotFound(String skillKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_NOT_FOUND",
            "技能不存在",
            Map.of("skillKey", skillKey == null ? "" : skillKey)
        );
    }

    private static ApiException ruleNotFound(String ruleKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_TRIGGER_RULE_NOT_FOUND",
            "技能触发规则不存在",
            Map.of("ruleKey", ruleKey == null ? "" : ruleKey)
        );
    }

    private static ApiException keyExists() {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_TRIGGER_RULE_KEY_EXISTS",
            "技能触发规则标识已存在",
            Map.of("fieldIssues", List.of(fieldIssue("ruleKey", "CONFLICT", "技能触发规则标识已存在")))
        );
    }

    static ApiException effectInUse(List<Map<String, String>> issues) {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_EFFECT_IN_USE",
            "技能效果仍被引用，不能删除或破坏其形状",
            Map.of("fieldIssues", List.copyOf(issues))
        );
    }

    private static RuntimeException mapWriteConstraint(DataIntegrityViolationException ex) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
        }
        return ex;
    }

    private static String collectCauseMessages(Throwable throwable) {
        StringBuilder result = new StringBuilder();
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (current.getMessage() != null) {
                result.append(' ').append(current.getMessage());
            }
        }
        return result.toString();
    }

    private static Map<String, String> fieldIssue(String field, String code, String message) {
        Map<String, String> issue = new LinkedHashMap<>();
        issue.put("field", field);
        issue.put("code", code);
        issue.put("message", message);
        return issue;
    }

    private static Map<String, String> fieldIssue(String field, String code, String message, String rejectedValue) {
        Map<String, String> issue = fieldIssue(field, code, message);
        if (rejectedValue != null) {
            issue.put("rejectedValue", rejectedValue);
        }
        return issue;
    }

    private static String groupPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty()
            ? "conditionGroups[" + index + "]"
            : "conditionGroups[" + index + "]." + suffix;
    }

    private static String conditionPath(int groupIndex, int conditionIndex, String suffix) {
        String base = "conditionGroups[" + groupIndex + "].conditions[" + conditionIndex + "]";
        return suffix == null || suffix.isEmpty() ? base : base + "." + suffix;
    }

    private static String actionPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty() ? "actions[" + index + "]" : "actions[" + index + "]." + suffix;
    }

    private static String bindingPath(int actionIndex, int bindingIndex, String suffix) {
        String base = "actions[" + actionIndex + "].runtimeInputBindings[" + bindingIndex + "]";
        return suffix == null || suffix.isEmpty() ? base : base + "." + suffix;
    }

    private static String bindingPathFromPrefix(String actionPrefix, int bindingIndex, String suffix) {
        String base = actionPrefix + ".runtimeInputBindings[" + bindingIndex + "]";
        return suffix == null || suffix.isEmpty() ? base : base + "." + suffix;
    }

    private static String modifierPath(int actionIndex, int modifierIndex, String suffix) {
        String base = "actions[" + actionIndex + "].resultModifiers[" + modifierIndex + "]";
        return suffix == null || suffix.isEmpty() ? base : base + "." + suffix;
    }

    private static String resultPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty() ? "results[" + index + "]" : "results[" + index + "]." + suffix;
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private static Set<String> nullToEmptySet(Set<String> values) {
        return values == null ? Set.of() : values;
    }

    private record ValidatedRule(
        String ruleKey,
        String name,
        String description,
        Integer sortOrder,
        SkillTriggerEventSource eventSource,
        List<SkillTriggerConditionGroup> conditionGroups,
        List<SkillTriggerAction> actions,
        SkillTriggerPerTargetCooldown perTargetCooldown,
        SkillTriggerProcessLimit maxTriggersPerProcess,
        SkillTriggerOncePerUse oncePerUse
    ) {
    }

    private void assertOncePerUseGroup(ValidatedRule values, List<SkillTriggerRuleRow> locked) {
        List<SkillTriggerOncePerUseSemantics.Member> others = new ArrayList<>();
        for (SkillTriggerRuleRow row : nullToEmpty(locked)) {
            if (row.ruleKey().equals(values.ruleKey())) {
                continue;
            }
            SkillTriggerRuleAssembler.Limits limits = AggregateJson.read(row.limitsJson(), SkillTriggerRuleAssembler.Limits.class);
            SkillTriggerOncePerUseSemantics.Member other = SkillTriggerOncePerUseSemantics.member(
                row.ruleKey(),
                SkillTriggerOncePerUseSemantics.fromDto(limits == null ? null : limits.oncePerUse())
            );
            if (other != null) {
                others.add(other);
            }
        }
        List<Map<String, String>> issues = SkillTriggerOncePerUseSemantics.groupIssues(
            values.ruleKey(),
            SkillTriggerOncePerUseSemantics.fromDto(values.oncePerUse()),
            others,
            "oncePerUse"
        );
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_TRIGGER_RULE_ONCE_PER_USE_INVALID",
                "同次使用限制组范围与现有规则冲突",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static final class CollectedRefs {
        private final List<CatalogRef> attributes = new ArrayList<>();
        private final List<CatalogRef> damageTypes = new ArrayList<>();
        private final List<CatalogRef> statuses = new ArrayList<>();
        private final List<CatalogRef> formulas = new ArrayList<>();
        private final List<CatalogRef> effects = new ArrayList<>();
        private final List<CatalogRef> processes = new ArrayList<>();
        private final List<CatalogRef> states = new ArrayList<>();
        private final List<CatalogRef> skills = new ArrayList<>();
        private final List<CatalogRef> parameters = new ArrayList<>();
        private final Set<String> attributeKeys = new LinkedHashSet<>();
        private final Set<String> damageTypeKeys = new LinkedHashSet<>();
        private final Set<String> statusKeys = new LinkedHashSet<>();
        private final Set<String> formulaKeys = new LinkedHashSet<>();
        private final Set<String> effectKeys = new LinkedHashSet<>();
        private final Set<String> processKeys = new LinkedHashSet<>();
        private final Set<String> stateKeys = new LinkedHashSet<>();
        private final Set<String> skillKeys = new LinkedHashSet<>();
        private final Set<String> parameterKeys = new LinkedHashSet<>();

        private void addAttribute(CatalogRef ref) {
            attributes.add(ref);
            if (ref.key() != null) {
                attributeKeys.add(ref.key());
            }
        }

        private void addDamageType(CatalogRef ref) {
            damageTypes.add(ref);
            if (ref.key() != null) {
                damageTypeKeys.add(ref.key());
            }
        }

        private void addStatus(CatalogRef ref) {
            statuses.add(ref);
            if (ref.key() != null) {
                statusKeys.add(ref.key());
            }
        }

        private void addFormula(CatalogRef ref) {
            if (ref.key() != null) {
                formulas.add(ref);
                formulaKeys.add(ref.key());
            }
        }

        private void addEffect(CatalogRef ref) {
            effects.add(ref);
            if (ref.key() != null) {
                effectKeys.add(ref.key());
            }
        }

        private void addProcess(CatalogRef ref) {
            processes.add(ref);
            if (ref.key() != null) {
                processKeys.add(ref.key());
            }
        }

        private void addState(CatalogRef ref) {
            states.add(ref);
            if (ref.key() != null) {
                stateKeys.add(ref.key());
            }
        }

        private void addSkill(CatalogRef ref) {
            skills.add(ref);
            if (ref.key() != null) {
                skillKeys.add(ref.key());
            }
        }

        private void addParameter(CatalogRef ref) {
            parameters.add(ref);
            if (ref.key() != null) {
                parameterKeys.add(ref.key());
            }
        }
    }

    private record CatalogRef(String field, String key, boolean numeric) {
        private CatalogRef(String field, SkillNumericValue value) { this(field, value == null ? null : value.formulaKey(), false); }
        private CatalogRef(String field, String key) {
            this(field, key, false);
        }
    }

    private record Catalog(
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes,
        Map<String, SkillTriggerInternalStateLockRow> states
    ) {
    }

    private record RuntimeInputDependencyHit(String ruleKey, String actionKey, String parameterKey) {
    }
}
