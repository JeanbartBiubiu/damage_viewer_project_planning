package xyz.game.datamanage.service.skilltrigger.validation;

import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.ACTION_ORDER;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.actionPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.bindingPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.bindingPathFromPrefix;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.conditionPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.fieldIssue;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.groupPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.modifierPath;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.nullToEmptySet;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.rejectUnavailableEventSource;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.require;
import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.throwIfInvalid;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAction;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAdvanceProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCancelProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCastPhase;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatElapsedTimeBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCondition;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroup;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEmptyEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventCapabilities;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventUseKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExecuteEffectActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerExplicitTargetIsSourceConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerFailProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateOperation;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLinkEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerModifyInternalStateActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerOncePerUse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldown;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessResolvedEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRecentDamageSumBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifier;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleUpdateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputSourceType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSceneAttributeSnapshotBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSceneInitialParameterBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillHitTargetIsEnemyConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSourceCastResourceCostBindingDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSpellShieldBlockedEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStartProcessActionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusCheckKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetCategoryConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerTargetContext;
import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.service.skilltrigger.validation.ReferenceRequirements.CatalogRef;
import xyz.game.datamanage.service.skilltrigger.validation.ReferenceRequirements.OwnedRef;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.SkillExplicitTargetIsSourceConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillHitPhaseSemantics;
import xyz.game.datamanage.support.authoring.SkillHitTargetIsEnemyConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillLifecycleConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillSceneAttributeSnapshotSemantics;
import xyz.game.datamanage.support.authoring.SkillSceneInitialParameterSemantics;
import xyz.game.datamanage.support.authoring.SkillShieldAbsorptionConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillTargetCategoryConditionSemantics;
import xyz.game.datamanage.support.authoring.SkillTriggerOncePerUseSemantics;
import xyz.game.datamanage.support.error.ApiException;

/** 规则结构、不可变种类和引用需求的无数据库校验。 */
@org.springframework.stereotype.Component
public class SkillTriggerPayloadValidator {

    public ValidatedRule validateCreate(SkillTriggerRuleCreateRequest request) {
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

    public ValidatedRule validateUpdate(SkillTriggerRuleUpdateRequest request, String ruleKey) {
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
                validateRuntimeBindingShape(binding, bindingPath(i, b, null), issues);
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
            oncePerUse,
            collectReferences(eventSource, groups, safeActions, cooldown, processLimit)
        );
    }

    private void validateEventShape(SkillTriggerEventSource eventSource, List<Map<String, String>> issues) {
        SkillTriggerEventType eventType = eventSource.eventType();
        Object detail = eventSource.detail();
        switch (eventType) {
            case PROCESS_RESOLVED -> {
                if (!(detail instanceof SkillTriggerProcessResolvedEventDetail process)) {
                    issues.add(fieldIssue("eventSource.detail", "TYPE_MISMATCH", "过程已结算事件明细形状不合法"));
                    return;
                }
                if (process.sourceSkillKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.sourceSkillKey", "REQUIRED", "来源技能标识不能为空"));
                }
                if (process.processKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.processKey", "REQUIRED", "过程标识不能为空"));
                }
            }
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
                if (skill.processMoment() != null) {
                    issues.add(fieldIssue("eventSource.detail.processMoment", "FORBIDDEN", "技能使用事件不能指定实际命中阶段"));
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
                issues.addAll(SkillHitPhaseSemantics.shapeIssues(skill.processMoment(), "eventSource.detail.processMoment"));
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
                if (internal.stateSkillKey() == null) {
                    issues.add(fieldIssue("eventSource.detail.stateSkillKey", "REQUIRED", "内部状态所属技能不能为空"));
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
            case SOURCE_INITIALIZED, BASIC_ATTACK_START, BASIC_ATTACK_HIT, BASIC_ATTACK_RECEIVED,
                CONTROL_RECEIVED, KILL, TAKEDOWN -> {
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
                    require(detail.effectSkillKey(), prefix + ".detail.effectSkillKey", "来源效果所属技能不能为空", issues);
                    require(detail.sourceEffectKey(), prefix + ".detail.sourceEffectKey", "来源效果不能为空", issues);
                    require(detail.sourceResultKey(), prefix + ".detail.sourceResultKey", "来源结果不能为空", issues);
                    if (detail.comparator() == null) {
                        issues.add(fieldIssue(prefix + ".detail.comparator", "REQUIRED", "比较符不能为空"));
                    }
                    require(detail.comparisonValue(), prefix + ".detail.comparisonValue", "比较公式不能为空", issues);
                } else {
                    if (detail.effectSkillKey() != null) {
                        issues.add(fieldIssue(prefix + ".detail.effectSkillKey", "FORBIDDEN", "该检查方式不能指定来源效果所属技能"));
                    }
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
                require(detail.effectSkillKey(), prefix + ".detail.effectSkillKey", "生命周期所属技能不能为空", issues);
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
                require(detail.stateSkillKey(), prefix + ".detail.stateSkillKey", "内部状态所属技能不能为空", issues);
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
                if (detail.valueKind() == SkillTriggerInternalStateValueKind.ATTACK_START_VALUE
                    && eventSource.eventType() != SkillTriggerEventType.SKILL_HIT
                    && eventSource.eventType() != SkillTriggerEventType.BASIC_ATTACK_START
                    && eventSource.eventType() != SkillTriggerEventType.BASIC_ATTACK_HIT) {
                    issues.add(fieldIssue(prefix + ".detail.valueKind", "EVENT_VALUE_NOT_AVAILABLE",
                        "本次攻击开始值只能由普通攻击开始、命中或原技能命中读取"));
                }
                if (detail.valueKind() == SkillTriggerInternalStateValueKind.DAMAGE_BEFORE_VALUE
                    && eventSource.eventType() != SkillTriggerEventType.DAMAGE_DEALT) {
                    issues.add(fieldIssue(prefix + ".detail.valueKind", "EVENT_VALUE_NOT_AVAILABLE", "伤害前值只能由真实造成伤害事件读取"));
                }
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
                issues.addAll(SkillShieldAbsorptionConditionSemantics.shapeIssues(
                    eventSource == null || eventSource.eventType() == null ? null : eventSource.eventType().name(),
                    detail.eventValueKey() == null ? null : detail.eventValueKey().name(), detail.shieldResult(),
                    prefix + ".detail.shieldResult"));
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
            case MODIFY_INTERNAL_STATE -> {
                if (!(action.detail() instanceof SkillTriggerModifyInternalStateActionDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "内部状态动作明细形状不合法"));
                    return;
                }
                require(detail.stateSkillKey(), prefix + ".detail.stateSkillKey", "状态所属技能不能为空", issues);
                require(detail.stateKey(), prefix + ".detail.stateKey", "状态标识不能为空", issues);
                require(detail.operation(), prefix + ".detail.operation", "状态操作不能为空", issues);
                require(detail.value(), prefix + ".detail.value", "状态计时数值不能为空", issues);
                boolean phaseEnsuring = detail.operation() == SkillTriggerInternalStateOperation.ENSURE_REMAINING_PRESERVE_PHASE;
                boolean ensuring = detail.operation() == SkillTriggerInternalStateOperation.ENSURE_REMAINING;
                if (phaseEnsuring) {
                    if (eventSource == null || eventSource.eventType() != SkillTriggerEventType.SKILL_HIT
                        || !(eventSource.detail() instanceof SkillTriggerSkillEventDetail hit)
                        || hit.sourceSkillKey() == null || hit.sourceSkillKey().isBlank()
                        || action.targetContext() != SkillTriggerTargetContext.CURRENT_TARGET) {
                        issues.add(fieldIssue(prefix + ".actionType", "EVENT_VALUE_NOT_AVAILABLE", "保相位续期只允许明确真实技能命中作用于当前目标"));
                    }
                } else if (ensuring) {
                    if (eventSource == null || eventSource.eventType() != SkillTriggerEventType.SKILL_USED
                        || !(eventSource.detail() instanceof SkillTriggerSkillEventDetail use)
                        || use.sourceSkillKey() == null || use.sourceSkillKey().isBlank()
                        || use.useKind() != SkillTriggerEventUseKind.ACTIVE || use.castPhase() != SkillTriggerCastPhase.INITIAL
                        || action.targetContext() != SkillTriggerTargetContext.CURRENT_TARGET) {
                        issues.add(fieldIssue(prefix + ".actionType", "EVENT_VALUE_NOT_AVAILABLE",
                            "确保目标计数余时只允许明确技能首次主动使用作用于当前目标"));
                    }
                } else if (eventSource == null || eventSource.eventType() != SkillTriggerEventType.BASIC_ATTACK_HIT
                    || action.targetContext() != SkillTriggerTargetContext.EVENT_SOURCE) {
                    issues.add(fieldIssue(prefix + ".actionType", "EVENT_VALUE_NOT_AVAILABLE", "回充减时只允许普攻命中作用于来源自身"));
                }
                if (!action.resultModifiers().isEmpty()) issues.add(fieldIssue(prefix + ".resultModifiers", "FORBIDDEN", "状态计时动作不接受结果修正"));
                if (!action.runtimeInputBindings().isEmpty()) issues.add(fieldIssue(prefix + ".runtimeInputBindings", "FORBIDDEN", "状态计时动作不能保存动态输入绑定"));
                if (detail.value() != null && detail.value().kind() == SkillNumericValue.Kind.FIXED && detail.value().value().signum() < 0) {
                    issues.add(fieldIssue(prefix + ".detail.value", "RANGE_INVALID", "回充减少毫秒数不能小于零"));
                }
                if ((ensuring || phaseEnsuring) && detail.value() != null && detail.value().kind() == SkillNumericValue.Kind.FIXED
                    && (detail.value().value().signum() <= 0 || detail.value().value().stripTrailingZeros().scale() > 0
                        || detail.value().value().compareTo(new BigDecimal("9007199254740991")) > 0)) {
                    issues.add(fieldIssue(prefix + ".detail.value", "RANGE_INVALID", "最低余时必须为严格正安全整数毫秒"));
                }
            }
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
            case VALUE, ATTACK_START_VALUE, DAMAGE_BEFORE_VALUE, REMAINING_MS -> {
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

    private static void validateRuntimeBindingShape(
        SkillTriggerRuntimeInputBinding binding,
        String prefix,
        List<Map<String, String>> issues
    ) {
        if (binding.sourceType() == null || binding.detail() == null) {
            return;
        }
        switch (binding.sourceType()) {
            case INTERNAL_STATE -> {
                if (binding.detail() instanceof SkillTriggerInternalStateBindingDetail detail) {
                    require(detail.stateSkillKey(), prefix + ".detail.stateSkillKey", "内部状态所属技能不能为空", issues);
                    require(detail.stateKey(), prefix + ".detail.stateKey", "内部状态标识不能为空", issues);
                    if (detail.valueKind() == SkillTriggerInternalStateValueKind.ATTACK_START_VALUE
                        || detail.valueKind() == SkillTriggerInternalStateValueKind.DAMAGE_BEFORE_VALUE) {
                        issues.add(fieldIssue(prefix + ".detail.valueKind", "FORBIDDEN",
                            "前值读取只用于对应真实事件条件，不开放计算时输入绑定"));
                    }
                }
            }
            case COMBAT_STATUS -> {
                if (binding.detail() instanceof SkillTriggerCombatStatusBindingDetail detail) {
                    require(detail.subject(), prefix + ".detail.subject", "读取对象不能为空", issues);
                    require(detail.statusKey(), prefix + ".detail.statusKey", "状态标识不能为空", issues);
                    require(detail.valueKind(), prefix + ".detail.valueKind", "取值种类不能为空", issues);
                    boolean sourceResult = detail.valueKind() == SkillTriggerCombatStatusValueKind.STACKS
                        || detail.valueKind() == SkillTriggerCombatStatusValueKind.REMAINING_MS;
                    if (sourceResult) {
                        require(detail.effectSkillKey(), prefix + ".detail.effectSkillKey", "来源效果所属技能不能为空", issues);
                        require(detail.sourceEffectKey(), prefix + ".detail.sourceEffectKey", "来源效果不能为空", issues);
                        require(detail.sourceResultKey(), prefix + ".detail.sourceResultKey", "来源结果不能为空", issues);
                    } else if (detail.valueKind() == SkillTriggerCombatStatusValueKind.PRESENT) {
                        if (detail.effectSkillKey() != null) issues.add(fieldIssue(prefix + ".detail.effectSkillKey", "FORBIDDEN", "存在性读取不能指定来源效果所属技能"));
                        if (detail.sourceEffectKey() != null) issues.add(fieldIssue(prefix + ".detail.sourceEffectKey", "FORBIDDEN", "存在性读取不能指定来源效果"));
                        if (detail.sourceResultKey() != null) issues.add(fieldIssue(prefix + ".detail.sourceResultKey", "FORBIDDEN", "存在性读取不能指定来源结果"));
                    }
                }
            }
            case COMBAT_ELAPSED_TIME -> {
                if (!(binding.detail() instanceof SkillTriggerCombatElapsedTimeBindingDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "战斗时长来源明细形状不合法"));
                } else {
                    require(detail.subject(), prefix + ".detail.subject", "读取对象不能为空", issues);
                }
            }
            case RECENT_DAMAGE_SUM -> {
                if (!(binding.detail() instanceof SkillTriggerRecentDamageSumBindingDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "近期受伤来源明细形状不合法"));
                } else {
                    require(detail.subject(), prefix + ".detail.subject", "读取对象不能为空", issues);
                    require(detail.windowValue(), prefix + ".detail.windowValue", "时间窗不能为空", issues);
                    require(detail.outputKind(), prefix + ".detail.outputKind", "累计数值口径不能为空", issues);
                    require(detail.deliveryKind(), prefix + ".detail.deliveryKind", "伤害产生方式筛选不能为空", issues);
                    require(detail.originKind(), prefix + ".detail.originKind", "伤害来源性质筛选不能为空", issues);
                    if (detail.windowValue() != null
                        && detail.windowValue().kind() == SkillNumericValue.Kind.FIXED
                        && detail.windowValue().value().compareTo(BigDecimal.ZERO) <= 0) {
                        issues.add(fieldIssue(prefix + ".detail.windowValue", "RANGE_INVALID", "时间窗必须为正时长"));
                    }
                }
            }
            case SCENE_ATTRIBUTE_SNAPSHOT -> {
                if (!(binding.detail() instanceof SkillTriggerSceneAttributeSnapshotBindingDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "场景属性快照明细形状不合法"));
                } else {
                    issues.addAll(SkillSceneAttributeSnapshotSemantics.detailIssues(
                        AggregateJson.tree(AggregateJson.write(detail)), prefix + ".detail"));
                }
            }
            case SCENE_INITIAL_PARAMETER -> {
                if (!(binding.detail() instanceof SkillTriggerSceneInitialParameterBindingDetail detail)) {
                    issues.add(fieldIssue(prefix + ".detail", "TYPE_MISMATCH", "场景显式初值明细形状不合法"));
                } else {
                    issues.addAll(SkillSceneInitialParameterSemantics.detailIssues(
                        AggregateJson.tree(AggregateJson.write(detail)), null, prefix + ".detail"));
                }
            }
            default -> { }
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

    public void rejectImmutableKinds(SkillTriggerRuleDetailResponse current, ValidatedRule values) {
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

    private void collectEventRefs(
        SkillTriggerEventSource eventSource,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        List<Map<String, String>> referenceIssues
    ) {
        switch (eventSource.eventType()) {
            case PROCESS_RESOLVED -> {
                SkillTriggerProcessResolvedEventDetail detail = (SkillTriggerProcessResolvedEventDetail) eventSource.detail();
                refs.addSkill(new CatalogRef("eventSource.detail.sourceSkillKey", detail.sourceSkillKey()));
                refs.readProcesses.add(new OwnedRef("eventSource.detail.processKey", detail.sourceSkillKey(), detail.processKey()));
            }
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
                if (detail.processMoment() != null) {
                    refs.addProcess(new CatalogRef("eventSource.detail.processMoment.processKey", detail.processMoment().processKey()));
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
                refs.addState(new OwnedRef("eventSource.detail.stateKey", detail.stateSkillKey(), detail.stateKey()));
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
                if (detail.sourceSkillKey() != null) {
                    refs.addSkill(new CatalogRef("eventSource.detail.sourceSkillKey", detail.sourceSkillKey()));
                }
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
                    refs.addReadEffect(new OwnedRef(prefix + ".detail.sourceEffectKey", detail.effectSkillKey(), detail.sourceEffectKey()));
                }
                if (detail.comparisonValue() != null) {
                    refs.addFormula(new CatalogRef(prefix + ".detail.comparisonValue", detail.comparisonValue()));
                }
            }
            case LIFECYCLE_CHECK -> {
                SkillTriggerLifecycleConditionDetail detail = (SkillTriggerLifecycleConditionDetail) condition.detail();
                refs.addReadEffect(new OwnedRef(prefix + ".detail.effectKey", detail.effectSkillKey(), detail.effectKey()));
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
                refs.addState(new OwnedRef(prefix + ".detail.stateKey", detail.stateSkillKey(), detail.stateKey()));
                if (detail.comparisonValue() != null) {
                    refs.addFormula(new CatalogRef(prefix + ".detail.comparisonValue", detail.comparisonValue()));
                }
            }
            case EVENT_VALUE_COMPARE -> {
                SkillTriggerEventValueConditionDetail detail =
                    (SkillTriggerEventValueConditionDetail) condition.detail();
                refs.addFormula(new CatalogRef(prefix + ".detail.comparisonValue", detail.comparisonValue()));
                if (detail.shieldResult() != null)
                    refs.addEffect(new CatalogRef(prefix + ".detail.shieldResult.effectKey",
                        detail.shieldResult().path("effectKey").textValue()));
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
            case MODIFY_INTERNAL_STATE -> {
                var detail = (SkillTriggerModifyInternalStateActionDetail) action.detail();
                refs.addState(new OwnedRef(prefix + ".detail.stateKey", detail.stateSkillKey(), detail.stateKey()));
                if (detail.value() != null && detail.value().kind() == SkillNumericValue.Kind.PARAMETER) {
                    refs.addParameter(new CatalogRef(prefix + ".detail.value", detail.value().parameterKey()));
                } else if (detail.value() != null && detail.value().kind() == SkillNumericValue.Kind.FORMULA) {
                    refs.addFormula(new CatalogRef(prefix + ".detail.value", detail.value()));
                }
            }
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
        // 此动作的来源自身由显式同技能状态身份核定，不扩大旧事件对象目录。
        if (action.actionType() != SkillTriggerActionType.MODIFY_INTERNAL_STATE) {
            rejectUnavailableTargetContext(eventSource == null ? null : eventSource.eventType(), action.targetContext(),
                prefix + ".targetContext", referenceIssues);
        }
        List<SkillTriggerRuntimeInputBinding> bindings =
            action.runtimeInputBindings() == null ? List.of() : action.runtimeInputBindings();
        for (int b = 0; b < bindings.size(); b++) {
            SkillTriggerRuntimeInputBinding binding = bindings.get(b);
            refs.addParameter(new CatalogRef(bindingPathFromPrefix(prefix, b, "parameterKey"), binding.parameterKey()));
            if (binding.sourceType() == SkillTriggerRuntimeInputSourceType.INTERNAL_STATE
                && binding.detail() instanceof SkillTriggerInternalStateBindingDetail detail) {
                refs.addState(new OwnedRef(bindingPathFromPrefix(prefix, b, "detail.stateKey"), detail.stateSkillKey(), detail.stateKey()));
            } else if (binding.sourceType() == SkillTriggerRuntimeInputSourceType.SOURCE_CAST_RESOURCE_COST
                && binding.detail() instanceof SkillTriggerSourceCastResourceCostBindingDetail detail) {
                if (detail.attributeKey() != null) {
                    refs.addAttribute(new CatalogRef(bindingPathFromPrefix(prefix, b, "detail.attributeKey"), detail.attributeKey()));
                }
            } else if (binding.sourceType() == SkillTriggerRuntimeInputSourceType.SCENE_ATTRIBUTE_SNAPSHOT
                && binding.detail() instanceof SkillTriggerSceneAttributeSnapshotBindingDetail detail) {
                refs.addAttribute(new CatalogRef(bindingPathFromPrefix(prefix, b, "detail.attributeKey"), detail.attributeKey()));
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
                    refs.addReadEffect(new OwnedRef(
                        bindingPathFromPrefix(prefix, b, "detail.sourceEffectKey"),
                        detail.effectSkillKey(),
                        detail.sourceEffectKey()
                    ));
                }
            } else if (binding.sourceType() == SkillTriggerRuntimeInputSourceType.RECENT_DAMAGE_SUM
                && binding.detail() instanceof SkillTriggerRecentDamageSumBindingDetail detail) {
                if (detail.sourceSkillKey() != null) {
                    refs.addSkill(new CatalogRef(bindingPathFromPrefix(prefix, b, "detail.sourceSkillKey"), detail.sourceSkillKey()));
                }
                if (detail.damageTypeKey() != null) {
                    refs.addDamageType(new CatalogRef(bindingPathFromPrefix(prefix, b, "detail.damageTypeKey"), detail.damageTypeKey()));
                }
                if (detail.windowValue() != null) {
                    refs.addFormula(new CatalogRef(bindingPathFromPrefix(prefix, b, "detail.windowValue"), detail.windowValue()));
                }
            }
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

    private ReferenceRequirements collectReferences(
        SkillTriggerEventSource eventSource, List<SkillTriggerConditionGroup> conditionGroups,
        List<SkillTriggerAction> actions, SkillTriggerPerTargetCooldown cooldown, SkillTriggerProcessLimit processLimit
    ) {
        CollectedRefs refs = new CollectedRefs();
        List<Map<String, String>> issues = new ArrayList<>();
        List<Map<String, String>> referenceIssues = new ArrayList<>();
        collectEventRefs(eventSource, refs, issues, referenceIssues);
        for (int i = 0; i < conditionGroups.size(); i++) {
            SkillTriggerConditionGroup group = conditionGroups.get(i);
            for (int j = 0; j < group.conditions().size(); j++) {
                collectConditionRefs(
                    eventSource,
                    group.conditions().get(j),
                    conditionPath(i, j, null),
                    refs,
                    issues,
                    referenceIssues
                );
            }
        }
        for (int i = 0; i < actions.size(); i++) {
            collectActionRefs(
                eventSource,
                actions.get(i),
                actionPath(i, null),
                refs,
                issues,
                referenceIssues
            );
        }
        if (cooldown != null) {
            refs.addFormula(new CatalogRef("perTargetCooldown.durationValue", cooldown.durationValue()));
            rejectUnavailableTargetContext(
                eventSource.eventType(),
                cooldown.targetContext(),
                "perTargetCooldown.targetContext",
                referenceIssues
            );
        }
        if (processLimit != null) {
            refs.addProcess(new CatalogRef("maxTriggersPerProcess.processKey", processLimit.processKey()));
            refs.addFormula(new CatalogRef("maxTriggersPerProcess.limitValue", processLimit.limitValue()));
            if (eventSource.detail() instanceof SkillTriggerProcessEventDetail process
                && !Objects.equals(process.processKey(), processLimit.processKey())) {
                referenceIssues.add(fieldIssue(
                    "maxTriggersPerProcess.processKey",
                    "REFERENCE_TYPE_MISMATCH",
                    "单次过程最大触发次数必须引用事件来源过程"
                ));
            }
        }
        throwIfInvalid(issues);

        return new ReferenceRequirements(
            refs.attributes,
            refs.damageTypes,
            refs.statuses,
            refs.formulas,
            refs.effects,
            refs.processes,
            refs.states,
            refs.readEffects,
            refs.readProcesses,
            refs.skills,
            refs.parameters,
            refs.attributeKeys,
            refs.damageTypeKeys,
            refs.statusKeys,
            refs.formulaKeys,
            refs.effectKeys,
            refs.processKeys,
            refs.skillKeys,
            refs.parameterKeys,
            referenceIssues
        );
    }

    private static final class CollectedRefs {
        private final List<CatalogRef> attributes = new ArrayList<>();
        private final List<CatalogRef> damageTypes = new ArrayList<>();
        private final List<CatalogRef> statuses = new ArrayList<>();
        private final List<CatalogRef> formulas = new ArrayList<>();
        private final List<CatalogRef> effects = new ArrayList<>();
        private final List<CatalogRef> processes = new ArrayList<>();
        private final List<OwnedRef> states = new ArrayList<>();
        private final List<OwnedRef> readEffects = new ArrayList<>();
        private final List<OwnedRef> readProcesses = new ArrayList<>();
        private final List<CatalogRef> skills = new ArrayList<>();
        private final List<CatalogRef> parameters = new ArrayList<>();
        private final Set<String> attributeKeys = new LinkedHashSet<>();
        private final Set<String> damageTypeKeys = new LinkedHashSet<>();
        private final Set<String> statusKeys = new LinkedHashSet<>();
        private final Set<String> formulaKeys = new LinkedHashSet<>();
        private final Set<String> effectKeys = new LinkedHashSet<>();
        private final Set<String> processKeys = new LinkedHashSet<>();
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

        private void addState(OwnedRef ref) {
            states.add(ref);
        }

        private void addReadEffect(OwnedRef ref) {
            readEffects.add(ref);
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
}
