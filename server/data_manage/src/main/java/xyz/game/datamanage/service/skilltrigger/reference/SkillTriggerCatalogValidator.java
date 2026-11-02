package xyz.game.datamanage.service.skilltrigger.reference;

import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.conditionStateValueMatches;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.findResult;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.indexEffects;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.indexProcesses;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.internalStateChangeMatches;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.internalStateValueMatches;
import static xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceSupport.isEligibleSpellShieldEffect;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.ACTION_ORDER;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.actionPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.bindingPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.conditionPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.fieldIssue;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.modifierPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.nullToEmpty;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.rejectUnavailableEventSource;

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
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectTarget;
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
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCatalogLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatElapsedTimeBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageOriginKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueKey;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerFailProcessActionDetail;
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
import xyz.game.datamanage.model.skilltrigger.SkillTriggerParameterRefRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultOutputs;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRecentDamageSumBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifier;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSceneAttributeSnapshotBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSceneInitialParameterBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSourceCastResourceCostBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSpellShieldBlockedEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStartProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusCheckKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerValueDomain;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuntimeInputAnalyzer;
import xyz.game.datamanage.service.skilltrigger.validation.ReferenceRequirements.CatalogRef;
import xyz.game.datamanage.service.skilltrigger.validation.ReferenceRequirements.OwnedRef;
import xyz.game.datamanage.service.skilltrigger.validation.ReferenceRequirements;
import xyz.game.datamanage.service.skilltrigger.validation.ValidatedRule;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.SkillChargeDurationSemantics;
import xyz.game.datamanage.support.authoring.SkillExplicitTargetIsSourceConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillHitTargetIsEnemyConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillLifecycleConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillSceneAttributeSnapshotSemantics;
import xyz.game.datamanage.support.authoring.SkillSceneInitialParameterSemantics;
import xyz.game.datamanage.support.authoring.SkillTargetCategoryConditionSemantics;
import xyz.game.datamanage.support.error.ApiException;

/** 在调用者当前事务中锁定目录，并校验规则引用与动态输入。 */
@org.springframework.stereotype.Component
public class SkillTriggerCatalogValidator {

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

    private static final String DISABLED = "DISABLED";
    private final SkillTriggerRuleMapper mapper;
    private final SkillTriggerRuntimeInputAnalyzer analyzer;

    public SkillTriggerCatalogValidator(SkillTriggerRuleMapper mapper, SkillTriggerRuntimeInputAnalyzer analyzer) {
        this.mapper = mapper;
        this.analyzer = analyzer;
    }

    public void lockAndValidateCatalogs(
        String gameId,
        String skillKey,
        ValidatedRule values,
        SkillTriggerRuleDetailResponse current
    ) {
        ReferenceRequirements refs = values.references();
        List<Map<String, String>> referenceIssues = new ArrayList<>(refs.referenceIssues());
        List<SkillTriggerAction> ordered = new ArrayList<>(values.actions());
        ordered.sort(ACTION_ORDER);
        Map<String, SkillTriggerCatalogLockRow> attributes = indexCatalog(
            mapper.lockAttributes(gameId, refs.attributeKeys())
        );
        Map<String, SkillTriggerCatalogLockRow> damageTypes = indexCatalog(
            mapper.lockDamageTypes(gameId, refs.damageTypeKeys())
        );
        Map<String, SkillTriggerCatalogLockRow> statuses = indexCatalog(mapper.lockStatuses(gameId, refs.statusKeys()));
        Set<String> formulas = new LinkedHashSet<>(nullToEmpty(mapper.lockFormulas(gameId, skillKey, refs.formulaKeys())));
        Map<String, SkillTriggerParameterRefRow> parameters = indexParameters(
            mapper.lockParameters(gameId, skillKey, refs.parameterKeys())
        );
        Set<String> effects = new LinkedHashSet<>(nullToEmpty(mapper.lockEffects(gameId, skillKey, refs.effectKeys())));
        Set<String> processes = new LinkedHashSet<>(nullToEmpty(mapper.lockProcesses(gameId, skillKey, refs.processKeys())));
        Map<String, SkillTriggerInternalStateLockRow> states = new LinkedHashMap<>();
        for (OwnedRef ref : refs.states().stream().filter(ref -> ref.skillKey() != null && ref.key() != null)
            .distinct().sorted(Comparator.comparing(OwnedRef::skillKey).thenComparing(OwnedRef::key)).toList()) {
            for (SkillTriggerInternalStateLockRow row : nullToEmpty(
                mapper.lockInternalStates(gameId, ref.skillKey(), List.of(ref.key()))
            )) {
                states.put(ref.skillKey() + "\0" + row.stateKey(), row);
            }
        }
        Map<String, SkillTriggerCatalogLockRow> skills = indexCatalog(mapper.lockSkills(gameId, refs.skillKeys()));
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes = indexEffects(mapper.listEffectShapes(gameId, skillKey));
        Map<String, List<SkillTriggerProcessShapeRow>> processShapes = indexProcesses(mapper.listProcessShapes(gameId, skillKey));

        for (CatalogRef ref : refs.attributes()) {
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
        for (CatalogRef ref : refs.damageTypes()) {
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
        for (CatalogRef ref : refs.statuses()) {
            SkillTriggerCatalogLockRow row = statuses.get(ref.key());
            if (row == null) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_STATUS", "状态不存在或不属于当前游戏"));
            } else if (isNewDisabled(current, ref.field(), ref.key()) && DISABLED.equals(row.status())) {
                referenceIssues.add(fieldIssue(ref.field(), "STATUS_DISABLED", "不能新增停用状态引用"));
            }
        }
        for (CatalogRef ref : refs.formulas()) {
            if (!formulas.contains(ref.key())) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_FORMULA", "技能公式不存在或不属于当前技能"));
            } else if (mapper.countRuntimeInputNodes(gameId, skillKey, ref.key()) > 0) {
                referenceIssues.add(fieldIssue(ref.field(), "REFERENCE_TYPE_MISMATCH", "该公式不能引用计算时传入参数"));
            }
        }
        for (CatalogRef ref : refs.effects()) {
            if (!effects.contains(ref.key())) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_EFFECT", "技能效果不存在或不属于当前技能"));
            }
        }
        for (OwnedRef ref : refs.readEffects()) {
            if (ref.skillKey() == null || ref.key() == null
                || nullToEmpty(mapper.lockEffects(gameId, ref.skillKey(), List.of(ref.key()))).isEmpty()) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_EFFECT", "读取目标效果不存在或不属于指定技能"));
            }
        }
        for (CatalogRef ref : refs.processes()) {
            if (!processes.contains(ref.key())) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_PROCESS", "技能过程不存在或不属于当前技能"));
            }
        }
        for (OwnedRef ref : refs.readProcesses().stream().distinct()
            .sorted(Comparator.comparing(OwnedRef::skillKey).thenComparing(OwnedRef::key)).toList()) {
            if (nullToEmpty(mapper.lockProcesses(gameId, ref.skillKey(), List.of(ref.key()))).isEmpty()) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_PROCESS", "过程不存在或不属于指定的同游戏技能"));
            }
        }
        for (OwnedRef ref : refs.states()) {
            if (!states.containsKey(ref.skillKey() + "\0" + ref.key())) {
                referenceIssues.add(fieldIssue(ref.field(), "UNKNOWN_INTERNAL_STATE", "内部状态不存在或不属于指定技能"));
            }
        }
        for (CatalogRef ref : refs.skills()) {
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
                attributes,
                parameters,
                bindingIssues,
                referenceIssues
            );
        }
        throwIfReferenceInvalid(referenceIssues);
        throwIfBindingInvalid(bindingIssues);
        validateReflectedDamageRule(values, effectShapes, processShapes);
    }

    void validateEventCatalog(
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
            case SKILL_HIT -> {
                SkillTriggerSkillEventDetail detail = (SkillTriggerSkillEventDetail) eventSource.detail();
                if (detail.processMoment() == null) break;
                var phase = detail.processMoment();
                if (!skillKey.equals(detail.sourceSkillKey())) {
                    issues.add(fieldIssue("eventSource.detail.sourceSkillKey", "REFERENCE_TYPE_MISMATCH", "显式命中阶段必须明确属于当前技能"));
                }
                List<SkillTriggerProcessShapeRow> shapes = processShapes.getOrDefault(phase.processKey(), List.of());
                if (processActivation(shapes) != SkillProcessActivationType.ACTIVE) {
                    issues.add(fieldIssue("eventSource.detail.processMoment.processKey", "REFERENCE_TYPE_MISMATCH", "命中阶段只能引用本技能主动过程"));
                }
                validateProcessMoment(gameId, skillKey, phase.processKey(), phase.moment(), "eventSource.detail.processMoment", processShapes, issues);
                if (phase.requiresPriorStepKey() != null) {
                    List<String> prior = mapper.lockSteps(gameId, skillKey, phase.processKey(), List.of(phase.requiresPriorStepKey()));
                    if (prior == null || prior.isEmpty()) issues.add(fieldIssue("eventSource.detail.processMoment.requiresPriorStepKey", "UNKNOWN_STEP", "前置命中步骤不存在或不属于当前过程"));
                }
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
                SkillTriggerInternalStateLockRow state = states.get(detail.stateSkillKey() + "\0" + detail.stateKey());
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
                mapper.findLifecycleScope(gameId, detail.effectSkillKey(), detail.effectKey()), eventSource.eventType(), prefix + ".detail"));
        }
        if (condition.conditionType() == SkillTriggerConditionType.STATUS_CHECK
            && condition.detail() instanceof SkillTriggerStatusConditionDetail detail
            && (detail.checkKind() == SkillTriggerStatusCheckKind.STACKS_COMPARE
                || detail.checkKind() == SkillTriggerStatusCheckKind.REMAINING_MS_COMPARE)) {
            if (mapper.countStatusApplyPersistent(
                gameId, detail.effectSkillKey(), detail.sourceEffectKey(), detail.sourceResultKey(), detail.statusKey()
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
            if (detail.valueKind() == SkillTriggerInternalStateValueKind.ATTACK_START_VALUE
                && !skillKey.equals(detail.stateSkillKey())) {
                issues.add(fieldIssue(prefix + ".detail.stateSkillKey", "REFERENCE_TYPE_MISMATCH",
                    "本次攻击开始值必须读取当前技能自己的状态"));
            }
            if (detail.valueKind() == SkillTriggerInternalStateValueKind.ATTACK_START_VALUE
                && eventSource.detail() instanceof SkillTriggerSkillEventDetail skillEvent
                && skillEvent.sourceSkillKey() != null && !skillKey.equals(skillEvent.sourceSkillKey())) {
                issues.add(fieldIssue(prefix + ".detail.valueKind", "EVENT_VALUE_NOT_AVAILABLE",
                    "其它技能的命中不能读取当前技能的攻击开始弹药"));
            }
            SkillTriggerInternalStateLockRow state = states.get(detail.stateSkillKey() + "\0" + detail.stateKey());
            if (state != null && !conditionStateValueMatches(skillKey, eventSource, detail, state)) {
                issues.add(fieldIssue(
                    prefix + ".detail.valueKind",
                    "REFERENCE_TYPE_MISMATCH",
                    "内部状态取值方式与状态种类不匹配"
                ));
            }
            if (detail.valueKind() == SkillTriggerInternalStateValueKind.OPTION_SELECTED && detail.optionKey() != null) {
                List<String> options = mapper.lockOptions(
                    gameId, detail.stateSkillKey(), detail.stateKey(), List.of(detail.optionKey())
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
        if (condition.conditionType() == SkillTriggerConditionType.EVENT_VALUE_COMPARE
            && condition.detail() instanceof SkillTriggerEventValueConditionDetail detail
            && detail.shieldResult() != null) {
            validateShieldResultCatalog(gameId, skillKey, detail, prefix + ".detail", effectShapes, issues);
        }
    }

    void validateShieldResultCatalog(
        String gameId, String skillKey, SkillTriggerEventValueConditionDetail detail, String detailPath,
        Map<String, List<SkillTriggerEffectShapeRow>> effects, List<Map<String, String>> issues
    ) {
        var selector = detail.shieldResult();
        if (!skillKey.equals(selector.path("skillKey").textValue())) {
            issues.add(fieldIssue(detailPath + ".shieldResult.skillKey", "REFERENCE_TYPE_MISMATCH",
                "只能读取当前技能自身的普通盾"));
            return;
        }
        String effectKey = selector.path("effectKey").textValue();
        SkillTriggerEffectShapeRow shield = findResult(effects, effectKey, selector.path("resultKey").textValue());
        long shields = effects.getOrDefault(effectKey, List.of()).stream()
            .filter(result -> result.resultType() == SkillEffectResultType.NORMAL_SHIELD).count();
        if (shield == null || shields != 1 || shield.resultType() != SkillEffectResultType.NORMAL_SHIELD
            || shield.target() != SkillEffectTarget.SOURCE || !shield.hasLifecycle()
            || shield.resultMoment() != SkillEffectLifecycleMoment.PERSISTENT
            || mapper.findLifecycleScope(gameId, skillKey, effectKey) != SkillEffectLifecycleInstanceScope.SOURCE) {
            issues.add(fieldIssue(detailPath + ".shieldResult.resultKey", "REFERENCE_TYPE_MISMATCH",
                "指定结果须为本技能自身唯一的持续普通盾"));
        }
        // 完整终止生命周期与全等级单层证明由游戏写事务的最终图守卫核对。
    }

    void validateActionCatalog(
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
        if (action.actionType() == SkillTriggerActionType.MODIFY_INTERNAL_STATE
            && action.detail() instanceof SkillTriggerModifyInternalStateActionDetail modify) {
            SkillTriggerInternalStateLockRow state = states.get(modify.stateSkillKey() + "\0" + modify.stateKey());
            if (modify.operation() == SkillTriggerInternalStateOperation.ENSURE_REMAINING
                || modify.operation() == SkillTriggerInternalStateOperation.ENSURE_REMAINING_PRESERVE_PHASE) {
                if (!skillKey.equals(modify.stateSkillKey()) || state == null
                    || state.stateType() != SkillInternalStateType.COUNTER || !"TARGET".equals(state.scope())
                    || modify.operation() == SkillTriggerInternalStateOperation.ENSURE_REMAINING && state.targetTiming()) {
                    issues.add(fieldIssue(prefix + ".detail.stateKey", "REFERENCE_TYPE_MISMATCH", "最低余时只能修改本技能自身目标范围的有限计数"));
                }
            } else if (!skillKey.equals(modify.stateSkillKey()) || state == null || state.stateType() != SkillInternalStateType.AMMO
                || !"SKILL".equals(state.scope()) || modify.operation() != SkillTriggerInternalStateOperation.REDUCE_RECOVERY) {
                issues.add(fieldIssue(prefix + ".detail.stateKey", "REFERENCE_TYPE_MISMATCH", "回充减时只能修改本技能自身范围的弹药"));
            }
            return;
        }
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
        Map<String, SkillTriggerCatalogLockRow> attributes,
        Map<String, SkillTriggerParameterRefRow> lockedParameters,
        List<Map<String, String>> bindingIssues,
        List<Map<String, String>> referenceIssues
    ) {
        String targetKey = actionTargetKey(action);
        Map<String, SkillParameterValueType> reachable = action.actionType() == SkillTriggerActionType.MODIFY_INTERNAL_STATE
            && action.detail() instanceof SkillTriggerModifyInternalStateActionDetail modify
            ? analyzer.reachableRuntimeParametersForValues(gameId, skillKey, List.of(modify.value()))
            : analyzer.reachableRuntimeParameters(gameId, skillKey, action.actionType(), targetKey, effectShapes, processShapes);
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
                attributes,
                bindingIssues,
                referenceIssues
            );
        }
        if (action.actionType() == SkillTriggerActionType.EXECUTE_EFFECT
            || action.actionType() == SkillTriggerActionType.START_PROCESS
            || action.actionType() == SkillTriggerActionType.MODIFY_INTERNAL_STATE) {
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
        Map<String, SkillTriggerCatalogLockRow> attributes,
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
                SkillTriggerInternalStateLockRow state = states.get(detail.stateSkillKey() + "\0" + detail.stateKey());
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
                            gameId, detail.stateSkillKey(), detail.stateKey(), List.of(detail.optionKey())
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
                        gameId, detail.effectSkillKey(), detail.sourceEffectKey(), detail.sourceResultKey(), detail.statusKey()
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
            case COMBAT_ELAPSED_TIME -> {
                SkillTriggerCombatElapsedTimeBindingDetail detail = (SkillTriggerCombatElapsedTimeBindingDetail) binding.detail();
                rejectUnavailableEventSource(eventSource.eventType(), detail.subject(),
                    bindingPath(actionIndex, bindingIndex, "detail.subject"), referenceIssues);
                sourceDomain = SkillTriggerValueDomain.DECIMAL;
            }
            case RECENT_DAMAGE_SUM -> {
                SkillTriggerRecentDamageSumBindingDetail detail = (SkillTriggerRecentDamageSumBindingDetail) binding.detail();
                rejectUnavailableEventSource(eventSource.eventType(), detail.subject(),
                    bindingPath(actionIndex, bindingIndex, "detail.subject"), referenceIssues);
                if (detail.windowValue() != null && detail.windowValue().kind() == SkillNumericValue.Kind.FORMULA
                    && mapper.countRuntimeInputNodes(gameId, skillKey, detail.windowValue().formulaKey()) > 0) {
                    referenceIssues.add(fieldIssue(bindingPath(actionIndex, bindingIndex, "detail.windowValue"),
                        "REFERENCE_TYPE_MISMATCH", "时间窗不能依赖计算时传入参数"));
                }
                sourceDomain = SkillTriggerValueDomain.DECIMAL;
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
            case SCENE_ATTRIBUTE_SNAPSHOT -> {
                if (!(binding.detail() instanceof SkillTriggerSceneAttributeSnapshotBindingDetail detail)) {
                    bindingIssues.add(fieldIssue(bindingPath(actionIndex, bindingIndex, "detail"),
                        "TYPE_MISMATCH", "场景属性快照明细形状不合法"));
                    return;
                }
                SkillTriggerSkillEventDetail event = eventSource.detail() instanceof SkillTriggerSkillEventDetail skill ? skill : null;
                String processKey = action.detail() instanceof SkillTriggerStartProcessActionDetail process ? process.processKey() : null;
                SkillProcessActivationType activation = processActivation(processShapes.getOrDefault(processKey, List.of()));
                if (!SkillSceneAttributeSnapshotSemantics.entryAllowed(skillKey, eventSource.eventType().name(),
                        event == null ? null : event.sourceSkillKey(), event == null || event.useKind() == null ? null : event.useKind().name(),
                        event == null || event.castPhase() == null ? null : event.castPhase().name(), action.actionType().name(),
                        activation == null ? null : activation.name())) {
                    referenceIssues.add(fieldIssue(bindingPath(actionIndex, bindingIndex, "sourceType"),
                        "EVENT_VALUE_NOT_AVAILABLE", "场景属性快照只允许本技能明确首次主动使用启动真实主动过程"));
                }
                SkillTriggerCatalogLockRow attribute = attributes.get(detail.attributeKey());
                // 引用存在性由统一目录检查报告；这里额外要求旧引用仍启用且为数字。
                if (attribute != null) {
                    referenceIssues.addAll(SkillSceneAttributeSnapshotSemantics.attributeIssues(
                        new SkillSceneAttributeSnapshotSemantics.Attribute(attribute.status(), attribute.valueType()),
                        bindingPath(actionIndex, bindingIndex, "detail.attributeKey")));
                }
                // 实际场景尚未选择；整数兼容性由宿主和原生对最终快照值严格核验。
                return;
            }
            case SCENE_INITIAL_PARAMETER -> {
                if (!(binding.detail() instanceof SkillTriggerSceneInitialParameterBindingDetail detail)) {
                    bindingIssues.add(fieldIssue(bindingPath(actionIndex, bindingIndex, "detail"),
                        "TYPE_MISMATCH", "场景显式初值明细形状不合法"));
                    return;
                }
                bindingIssues.addAll(SkillSceneInitialParameterSemantics.detailIssues(
                    AggregateJson.tree(AggregateJson.write(detail)), parameterType.name(),
                    bindingPath(actionIndex, bindingIndex, "detail")));
                SkillTriggerSkillEventDetail sceneEvent = eventSource.detail() instanceof SkillTriggerSkillEventDetail skill ? skill : null;
                String sceneProcessKey = action.detail() instanceof SkillTriggerStartProcessActionDetail process ? process.processKey() : null;
                SkillProcessActivationType sceneActivation = processActivation(processShapes.getOrDefault(sceneProcessKey, List.of()));
                if (!SkillSceneInitialParameterSemantics.entryAllowed(eventSource.eventType().name(), action.actionType().name(),
                        action.targetContext() == null ? null : action.targetContext().name())
                    && !SkillSceneInitialParameterSemantics.startEntryAllowed(skillKey, eventSource.eventType().name(),
                        sceneEvent == null ? null : sceneEvent.sourceSkillKey(), sceneEvent == null || sceneEvent.useKind() == null ? null : sceneEvent.useKind().name(),
                        sceneEvent == null || sceneEvent.castPhase() == null ? null : sceneEvent.castPhase().name(), action.actionType().name(),
                        sceneActivation == null ? null : sceneActivation.name())) {
                    referenceIssues.add(fieldIssue(bindingPath(actionIndex, bindingIndex, "sourceType"),
                        "EVENT_VALUE_NOT_AVAILABLE", "场景显式初值只授权自身初始化或本技能明确首次主动过程负载"));
                }
                return;
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

    void validateProcessMoment(
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
            case SKILL_HIT -> {
                boolean charge = valueKey == SkillTriggerEventValueKey.CHARGE_DURATION_MS
                    && eventSource.detail() instanceof SkillTriggerSkillEventDetail detail
                    && chargeHitAvailable(gameId, skillKey, detail.sourceSkillKey());
                yield SkillTriggerEventCapabilities.eventValueAllowed(eventSource.eventType(), valueKey, null,
                    charge ? SkillProcessStepType.CHARGE : null);
            }
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

    private boolean chargeHitAvailable(String gameId, String skillKey, String sourceSkillKey) {
        List<Aggregate> context = new ArrayList<>();
        for (var process : indexProcesses(nullToEmpty(mapper.listProcessShapes(gameId, skillKey))).entrySet()) {
            var activationTypes = process.getValue().stream().map(SkillTriggerProcessShapeRow::activationType)
                .filter(Objects::nonNull).distinct().toList();
            if (activationTypes.size() != 1) return false;
            List<Map<String, Object>> steps = new ArrayList<>();
            for (SkillTriggerProcessShapeRow shape : process.getValue()) {
                if (shape.stepKey() == null || shape.stepType() == null) continue;
                Boolean automaticRelease = shape.stepType() == SkillProcessStepType.CHARGE
                    ? mapper.findChargeReleaseAtMaximum(gameId, skillKey, shape.processKey(), shape.stepKey()) : null;
                steps.add(Map.of("stepKey", shape.stepKey(), "stepType", shape.stepType().name(), "detail",
                    automaticRelease == null ? Map.of() : Map.of("releaseAtMaximum", automaticRelease)));
            }
            var data = AggregateJson.tree(AggregateJson.write(Map.of("activationType", activationTypes.getFirst().name(), "steps", steps)));
            context.add(new Aggregate(SourceType.PROCESS, skillKey, process.getKey(), data));
        }
        for (SkillTriggerRuleRow row : nullToEmpty(mapper.listRules(gameId, skillKey))) {
            if (row.eventSourceJson() == null || row.actionsJson() == null) continue;
            var data = AggregateJson.tree(AggregateJson.write(Map.of("eventSource", AggregateJson.tree(row.eventSourceJson()),
                "actions", AggregateJson.tree(row.actionsJson()))));
            context.add(new Aggregate(SourceType.TRIGGER, skillKey, row.ruleKey(), data));
        }
        return SkillChargeDurationSemantics.hitAvailable(skillKey, sourceSkillKey, context);
    }

    private static String actionTargetKey(SkillTriggerAction action) {
        return switch (action.actionType()) {
            case MODIFY_INTERNAL_STATE -> ((SkillTriggerModifyInternalStateActionDetail) action.detail()).stateKey();
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
                case FAIL_PROCESS, MODIFY_INTERNAL_STATE -> false;
            };
            if (!reflected) {
                continue;
            }
            if (values.eventSource().eventType() != SkillTriggerEventType.DAMAGE_PENDING
                && values.eventSource().eventType() != SkillTriggerEventType.DAMAGE_TAKEN
                && values.eventSource().eventType() != SkillTriggerEventType.BASIC_ATTACK_RECEIVED) {
                issues.add(fieldIssue(
                    "eventSource.eventType",
                    "REFLECT_LOOP_UNGUARDED",
                    "反伤效果只能由普通攻击命中接收、即将受到伤害或受到伤害事件触发"
                ));
            }
            if (action.targetContext() != SkillTriggerTargetContext.EVENT_SOURCE) {
                issues.add(fieldIssue(
                    actionPath(i, "targetContext"),
                    "REFLECT_LOOP_UNGUARDED",
                    "反伤效果必须作用于事件来源对象"
                ));
            }
            boolean directOnly = values.eventSource().eventType() == SkillTriggerEventType.BASIC_ATTACK_RECEIVED
                || values.eventSource().detail() instanceof SkillTriggerDamageEventDetail damage
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
}
