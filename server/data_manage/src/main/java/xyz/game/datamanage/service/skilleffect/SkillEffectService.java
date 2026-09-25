package xyz.game.datamanage.service.skilleffect;

import xyz.game.datamanage.model.value.SkillNumericValue;

import jakarta.validation.Valid;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.DamageModifierConditionSemantics;
import xyz.game.datamanage.support.authoring.HealingRatioMaxSemantics;
import xyz.game.datamanage.support.authoring.ShieldEndLifecycleSemantics;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.model.skilleffect.SkillEffectAffectedSkillScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectCatalogLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusLockRow;
import xyz.game.datamanage.model.status.StatusKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicy;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageImmunityDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectDirectHealDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectShieldReceivedModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealthFloorDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectExecuteDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHasteModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHitLinkApplicationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttackLinkApplicationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierZoneLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationDurationMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleStackValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleValueReadMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDecayMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldBlockScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectSkillScopeMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampOverride;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampType;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneApplicationStage;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillEffectService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Logger log = LoggerFactory.getLogger(SkillEffectService.class);
    private static final Pattern STABLE_KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");

    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_effects";
    private static final String PROCESS_BINDING_CONSTRAINT = "fk_skill_process_effect_bindings_effect";
    private static final String LIFECYCLE_TARGET_CONSTRAINT = "fk_skill_effect_lifecycle_operations_target";
    private static final String REFRESH_DURATION_CONSTRAINT = "ck_skill_effect_lifecycle_refresh_target_duration";
    private static final Set<String> TRIGGER_EFFECT_IN_USE_CONSTRAINTS = Set.of(
        "fk_skill_trigger_effect_actions_effect",
        "fk_skill_trigger_lifecycle_events_effect",
        "fk_skill_trigger_lifecycle_events_lifecycle",
        "fk_skill_trigger_result_events_result",
        "fk_skill_trigger_result_modifiers_result",
        "fk_skill_trigger_status_cond_source_result",
        "fk_skill_trigger_combat_status_bind_result",
        "fk_skill_trigger_prior_result_bind_result",
        "fk_skill_trigger_spell_shield_blocked_effect"
    );
    private static final String DISABLED = "DISABLED";

    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillEffectMapper mapper;
    private final SkillTriggerRuleService triggerRuleService;
    private final ImageRelationMapper imageRelationMapper;

    public SkillEffectService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillEffectMapper mapper,
        SkillTriggerRuleService triggerRuleService,
        ImageRelationMapper imageRelationMapper,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;
        this.triggerRuleService = triggerRuleService;
        this.imageRelationMapper = imageRelationMapper;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public List<SkillEffectSummaryResponse> list(String gameId, String skillKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        List<SkillEffectSummaryResponse> items = mapper.listSummaries(gameId, skillKey);
        return items == null ? List.of() : items;
    }

    @Transactional(readOnly = true)
    public SkillEffectDetailResponse get(String gameId, String skillKey, String effectKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        return requireDetail(gameId, skillKey, effectKey);
    }

    @Transactional
    public SkillEffectDetailResponse create(
        String gameId,
        String skillKey,
        @Valid SkillEffectCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedEffect values = validateCreate(request);
        lockParentSkill(gameId, skillKey);
        if (mapper.countByKey(gameId, skillKey, values.effectKey()) > 0) {
            throw keyExists();
        }
        CollectedRefs refs = collectAndValidateResults(
            values.lifecycle(),
            values.results(),
            Map.of(),
            skillKey,
            values.effectKey(),
            null
        );
        lockAndValidateCatalogs(gameId, skillKey, values.effectKey(), refs);
        try {
            mapper.insertEffect(
                gameId,
                skillKey,
                values.effectKey(),
                values.name(),
                values.description(),
                values.sortOrder(),
                SkillEffectAggregate.writeResults(values.results()),
                values.lifecycle() == null ? null : AggregateJson.write(values.lifecycle())
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex, false, false);
        }
        return requireDetail(gameId, skillKey, values.effectKey());
    }

    @Transactional
    public SkillEffectDetailResponse update(
        String gameId,
        String skillKey,
        String effectKey,
        @Valid SkillEffectUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedEffect values = validateUpdate(request, effectKey);
        lockParentSkill(gameId, skillKey);
        SkillEffectRow existingEffect = mapper.findEffectForUpdate(gameId, skillKey, effectKey);
        if (existingEffect == null) {
            throw effectNotFound(effectKey);
        }
        List<SkillEffectResultRequest> existingResults = SkillEffectAggregate.readResults(existingEffect.results());
        List<SkillEffectResultRow> existingRows = existingResults.stream().map(result -> new SkillEffectResultRow(
            gameId, skillKey, effectKey, result.resultKey(), result.name(), result.resultType(),
            result.target(), result.description(), result.sortOrder()
        )).toList();
        SkillEffectLifecycleRow existingLifecycle = SkillEffectAggregate.lifecycleRow(existingEffect);
        Map<String, SkillEffectResultRow> existingByKey = indexExistingResults(existingRows);
        List<Map<String, String>> typeIssues = new ArrayList<>();
        for (int i = 0; i < values.results().size(); i++) {
            SkillEffectResultRequest result = values.results().get(i);
            SkillEffectResultRow existing = existingByKey.get(result.resultKey());
            if (existing != null && existing.resultType() != result.resultType()) {
                typeIssues.add(fieldIssue(
                    resultPath(i, "resultType"),
                    "IMMUTABLE",
                    "结果种类不能修改"
                ));
            }
        }
        throwIfInvalid(typeIssues);

        Set<String> requestedKeys = new LinkedHashSet<>();
        for (SkillEffectResultRequest result : values.results()) {
            requestedKeys.add(result.resultKey());
        }
        List<String> removedKeys = new ArrayList<>();
        for (SkillEffectResultRow existing : existingRows) {
            if (!requestedKeys.contains(existing.resultKey())) {
                removedKeys.add(existing.resultKey());
            }
        }
        if (triggerRuleService != null) {
            triggerRuleService.assertEffectUpdate(
                gameId,
                skillKey,
                effectKey,
                existingLifecycle,
                values.lifecycle(),
                values.results(),
                removedKeys
            );
        }
        long extendDurationReferences = existingLifecycle == null
            ? 0
            : mapper.countExtendDurationOperationReferences(gameId, skillKey, effectKey);
        if (existingLifecycle != null && values.lifecycle() == null) {
            if (extendDurationReferences > 0) {
                throw extendDurationInUse(
                    "lifecycle",
                    "目标生命周期仍被延长剩余时长操作引用，不能移除生命周期"
                );
            }
            if (mapper.countLifecycleOperationReferences(gameId, skillKey, effectKey) > 0) {
                throw lifecycleInUse();
            }
        }
        boolean clearingDuration = existingLifecycle != null
            && existingLifecycle.durationValue() != null
            && (values.lifecycle() == null || values.lifecycle().durationValue() == null);
        boolean changingExpiryMode = existingLifecycle != null
            && values.lifecycle() != null
            && existingLifecycle.expiryMode() == SkillEffectLifecycleExpiryMode.ALL_AT_ONCE
            && values.lifecycle().expiryMode() != SkillEffectLifecycleExpiryMode.ALL_AT_ONCE;
        if (extendDurationReferences > 0 && clearingDuration) {
            throw extendDurationInUse(
                "lifecycle.durationValue",
                "目标生命周期仍被延长剩余时长操作引用，不能清空持续时间"
            );
        }
        if (extendDurationReferences > 0 && changingExpiryMode) {
            throw extendDurationInUse(
                "lifecycle.expiryMode",
                "目标生命周期仍被延长剩余时长操作引用，不能改为其他到期方式"
            );
        }
        if (clearingDuration
            && mapper.countRefreshOperationReferences(gameId, skillKey, effectKey) > 0) {
            throw refreshInUse();
        }

        Map<String, RetainedCatalog> retained = loadRetainedCatalog(existingResults);
        CollectedRefs refs = collectAndValidateResults(
            values.lifecycle(),
            values.results(),
            retained,
            skillKey,
            effectKey,
            existingLifecycle == null ? null : existingLifecycle.instanceScope()
        );
        lockAndValidateCatalogs(gameId, skillKey, effectKey, refs);

        try {
            if (mapper.updateEffect(
                gameId,
                skillKey,
                effectKey,
                values.name(),
                values.description(),
                values.sortOrder(),
                SkillEffectAggregate.writeResults(values.results()),
                values.lifecycle() == null ? null : AggregateJson.write(values.lifecycle())
            ) == 0) {
                throw effectNotFound(effectKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex, existingLifecycle != null && values.lifecycle() == null, clearingDuration);
        }
        if (triggerRuleService != null) {
            triggerRuleService.assertCurrentSkillCycle(gameId, skillKey);
        }
        return requireDetail(gameId, skillKey, effectKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey, String effectKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        lockParentSkill(gameId, skillKey);
        if (mapper.findEffectForUpdate(gameId, skillKey, effectKey) == null) {
            throw effectNotFound(effectKey);
        }
        List<Map<String, String>> inUse = new ArrayList<>();
        if (mapper.countProcessBindings(gameId, skillKey, effectKey) > 0) {
            inUse.add(fieldIssue("effectKey", "CONFLICT", "技能效果已被过程挂接引用，不能删除"));
        }
        if (triggerRuleService != null) {
            inUse.addAll(triggerRuleService.effectDeleteIssues(gameId, skillKey, effectKey));
        }
        if (!inUse.isEmpty()) {
            inUse.sort(Comparator.comparing(issue -> issue.get("field")));
            throw effectInUse(inUse);
        }
        if (mapper.countLifecycleOperationReferences(gameId, skillKey, effectKey) > 0) {
            throw lifecycleInUse();
        }
        try {
            if (mapper.deleteEffect(gameId, skillKey, effectKey) == 0) {
                throw effectNotFound(effectKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex, true, false);
        }
        imageRelationMapper.deleteForSource(gameId, "SKILL_EFFECT", skillKey, effectKey);
    }

    private SkillEffectDetailResponse requireDetail(String gameId, String skillKey, String effectKey) {
        SkillEffectRow effect = mapper.findEffect(gameId, skillKey, effectKey);
        if (effect == null) {
            throw effectNotFound(effectKey);
        }
        return assembleDetail(effect);
    }

    private SkillEffectDetailResponse assembleDetail(SkillEffectRow effect) {
        List<SkillEffectResultRequest> results = List.of();
        try {
            results = SkillEffectAggregate.readResults(effect.results());
            SkillEffectLifecycleRequest lifecycle = effect.lifecycle() == null ? null
                : AggregateJson.read(effect.lifecycle(), SkillEffectLifecycleRequest.class);
            collectAndValidateResults(lifecycle, results, Map.of(), effect.skillKey(), effect.effectKey(), null);
            return new SkillEffectDetailResponse(
                effect.gameId(), effect.skillKey(), effect.effectKey(), effect.name(), effect.description(),
                effect.sortOrder(), SkillEffectAggregate.lifecycleResponse(lifecycle),
                results.stream().map(SkillEffectAggregate::resultResponse).toList(), effect.createdAt(), effect.updatedAt()
            );
        } catch (RuntimeException ex) {
            String resultKey = null;
            if (ex instanceof ApiException invalid && invalid.getDetails().get("fieldIssues") instanceof List<?> issues) {
                for (Object issue : issues) {
                    if (!(issue instanceof Map<?, ?> fields) || !(fields.get("field") instanceof String field)) continue;
                    var resultPath = Pattern.compile("^results\\[(\\d+)](?:\\.|$)").matcher(field);
                    if (resultPath.find()) {
                        int index = Integer.parseInt(resultPath.group(1));
                        if (index < results.size() && results.get(index) != null) {
                            resultKey = results.get(index).resultKey();
                            break;
                        }
                    }
                }
            }
            throw corrupt(effect.gameId(), effect.skillKey(), effect.effectKey(), resultKey, "效果结构化内容不合法");
        }
    }

    private ValidatedEffect validateCreate(SkillEffectCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能效果不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.results() == null) {
            issues.add(fieldIssue("results", "REQUIRED", "结果列表不能缺失"));
        }
        throwIfInvalid(issues);
        return new ValidatedEffect(
            request.effectKey(),
            request.name(),
            request.description(),
            request.sortOrder(),
            request.lifecycle(),
            List.copyOf(request.results())
        );
    }

    private ValidatedEffect validateUpdate(SkillEffectUpdateRequest request, String pathKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能效果不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.effectKey() != null) {
            issues.add(fieldIssue("effectKey", "IMMUTABLE", "效果标识不能修改"));
        }
        if (request.results() == null) {
            issues.add(fieldIssue("results", "REQUIRED", "结果列表不能缺失"));
        }
        throwIfInvalid(issues);
        return new ValidatedEffect(
            pathKey,
            request.name(),
            request.description(),
            request.sortOrder(),
            request.lifecycle(),
            List.copyOf(request.results())
        );
    }

    private CollectedRefs collectAndValidateResults(
        SkillEffectLifecycleRequest lifecycle,
        List<SkillEffectResultRequest> results,
        Map<String, RetainedCatalog> retained,
        String pathSkillKey,
        String currentEffectKey,
        SkillEffectLifecycleInstanceScope existingScope
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        List<Map<String, String>> bodyIssues = new ArrayList<>();
        if (results == null) {
            issues.add(fieldIssue("results", "REQUIRED", "结果列表不能缺失"));
            throwIfInvalid(issues);
        }
        if (results.isEmpty() && lifecycle == null) {
            issues.add(fieldIssue("results", "REQUIRED", "效果至少配置生命周期或一个结果"));
            throwIfInvalid(issues);
        }
        if (existingScope != null
            && lifecycle != null
            && lifecycle.instanceScope() != null
            && existingScope != lifecycle.instanceScope()) {
            issues.add(fieldIssue("lifecycle.instanceScope", "IMMUTABLE", "实例范围不能修改"));
        }
        validateLifecycle(lifecycle, issues);
        Set<String> seenKeys = new HashSet<>();
        CollectedRefs refs = new CollectedRefs();
        refs.lifecycle = lifecycle;
        collectLifecycleFormulaRefs(lifecycle, refs);
        boolean hasPeriodic = false;
        boolean hasNaturalEnd = false;
        for (int i = 0; i < results.size(); i++) {
            SkillEffectResultRequest result = results.get(i);
            validateResult(
                result,
                i,
                seenKeys,
                retained,
                pathSkillKey,
                currentEffectKey,
                refs,
                issues,
                bodyIssues
            );
            validateLifecycleBehavior(lifecycle, result, i, refs, issues);
            validateNormalShieldLifecycle(lifecycle, result, i, issues);
            validatePersistentSpecialResultLifecycle(lifecycle, result, i, issues);
            if (result != null && result.lifecycleBehavior() != null) {
                if (result.lifecycleBehavior().moment() == SkillEffectLifecycleMoment.PERIODIC) {
                    hasPeriodic = true;
                }
                if (result.lifecycleBehavior().moment() == SkillEffectLifecycleMoment.NATURAL_END) {
                    hasNaturalEnd = true;
                }
            }
        }
        issues.addAll(ShieldEndLifecycleSemantics.issues(lifecycle, results));
        validateLifecyclePeriodicPair(lifecycle, hasPeriodic, hasNaturalEnd, issues);
        throwIfInvalidBody(bodyIssues);
        throwIfInvalid(issues);
        return refs;
    }

    private void validateResult(
        SkillEffectResultRequest result,
        int index,
        Set<String> seenKeys,
        Map<String, RetainedCatalog> retained,
        String pathSkillKey,
        String currentEffectKey,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        List<Map<String, String>> bodyIssues
    ) {
        if (result == null) {
            issues.add(fieldIssue(resultPath(index, null), "REQUIRED", "结果不能为空"));
            return;
        }
        String resultKey = result.resultKey();
        if (resultKey != null && !seenKeys.add(resultKey)) {
            issues.add(fieldIssue(resultPath(index, "resultKey"), "DUPLICATE", "同一效果内结果标识不能重复"));
        }
        if (result.resultType() == null) {
            issues.add(fieldIssue(resultPath(index, "resultType"), "REQUIRED", "结果种类不能为空"));
        }
        if (result.target() == null) {
            issues.add(fieldIssue(resultPath(index, "target"), "REQUIRED", "作用对象不能为空"));
        }
        SkillEffectResultDetail detail = result.detail();
        if (detail == null) {
            issues.add(fieldIssue(resultPath(index, "detail"), "REQUIRED", "结果明细不能为空"));
            validateValueRulePresence(result, index, issues);
            return;
        }
        collectMutexFields(detail, index, bodyIssues);
        if (result.resultType() == null) {
            validateValueRulePresence(result, index, issues);
            return;
        }
        switch (result.resultType()) {
            case DAMAGE -> validateDamage(result, index, retained, refs, issues);
            case DIRECT_HEAL -> validateEmptyDetailValue(result, index, refs, issues);
            case NORMAL_SHIELD -> validateNormalShield(result, index, retained, refs, issues);
            case ATTRIBUTE_CHANGE -> validateAttributeChange(result, index, retained, refs, issues);
            case RESOURCE_CHANGE -> validateResourceChange(result, index, retained, refs, issues);
            case COOLDOWN_CHANGE -> validateCooldownChange(result, index, retained, pathSkillKey, refs, issues);
            case STATUS_OPERATION -> validateStatusOperation(result, index, retained, refs, issues);
            case LIFECYCLE_OPERATION -> validateLifecycleOperation(
                result,
                index,
                currentEffectKey,
                refs,
                issues
            );
            case DAMAGE_MODIFIER -> validateDamageModifier(result, index, retained, refs, issues);
            case HEALING_MODIFIER -> validateHealingModifier(result, index, retained, refs, issues);
            case SHIELD_RECEIVED_MODIFIER -> validateShieldReceivedModifier(result, index, retained, refs, issues);
            case ATTACK_TIMER_RESET -> validateAttackTimerReset(result, index, issues);
            case DAMAGE_IMMUNITY -> validateDamageImmunity(result, index, retained, refs, issues);
            case HEALTH_FLOOR -> validateHealthFloor(result, index, retained, refs, issues);
            case SPELL_SHIELD -> validateSpellShield(result, index, issues);
            case EXECUTE -> validateExecute(result, index, retained, refs, issues);
            case HIT_LINK_APPLICATION -> validateHitLinkApplication(result, index, refs, issues);
            case ATTACK_LINK_APPLICATION -> validateAttackLinkApplication(result, index, refs, issues);
            case SKILL_HASTE_MODIFIER -> validateHasteModifier(result, index, retained, pathSkillKey, refs, issues);
        }
        validateSpellShieldBlockScope(result, index, issues);
    }

    private void validateSpellShield(
        SkillEffectResultRequest result,
        int index,
        List<Map<String, String>> issues
    ) {
        forbidValueRule(result, index, issues);
        if (!(result.detail() instanceof SkillEffectSpellShieldDetail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "法术护盾结果明细形状不合法"));
        }
    }

    private void validateAttackTimerReset(
        SkillEffectResultRequest result,
        int index,
        List<Map<String, String>> issues
    ) {
        forbidValueRule(result, index, issues);
        if (!(result.detail() instanceof xyz.game.datamanage.model.skilleffect.SkillEffectAttackTimerResetDetail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "普攻计时重置明细必须为空对象"));
        }
    }

    private void validateSpellShieldBlockScope(
        SkillEffectResultRequest result,
        int index,
        List<Map<String, String>> issues
    ) {
        SkillEffectSpellShieldBlockScope scope = result.spellShieldBlockScope();
        if (scope == null) {
            return;
        }
        SkillEffectResultLifecycleBehaviorRequest behavior = result.lifecycleBehavior();
        boolean persistent = behavior != null && behavior.moment() == SkillEffectLifecycleMoment.PERSISTENT;
        boolean allowedType = result.resultType() == SkillEffectResultType.DAMAGE
            || result.resultType() == SkillEffectResultType.ATTRIBUTE_CHANGE
            || result.resultType() == SkillEffectResultType.RESOURCE_CHANGE
            || result.resultType() == SkillEffectResultType.COOLDOWN_CHANGE
            || result.resultType() == SkillEffectResultType.STATUS_OPERATION
            || result.resultType() == SkillEffectResultType.LIFECYCLE_OPERATION
            || result.resultType() == SkillEffectResultType.EXECUTE
            || result.resultType() == SkillEffectResultType.HIT_LINK_APPLICATION
            || result.resultType() == SkillEffectResultType.ATTACK_LINK_APPLICATION;
        boolean persistentStatusApplyResult = persistent
            && result.target() == xyz.game.datamanage.model.skilleffect.SkillEffectTarget.TARGET
            && result.resultType() == SkillEffectResultType.STATUS_OPERATION
            && result.detail() instanceof SkillEffectStatusOperationDetail statusDetail
            && statusDetail.operation() == SkillEffectStatusOperation.APPLY
            && scope == SkillEffectSpellShieldBlockScope.RESULT;
        if (result.target() != xyz.game.datamanage.model.skilleffect.SkillEffectTarget.TARGET
            || (persistent && !persistentStatusApplyResult)
            || !allowedType
            || (scope == SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE
                && result.resultType() != SkillEffectResultType.DAMAGE)) {
            issues.add(fieldIssue(
                resultPath(index, "spellShieldBlockScope"),
                "INVALID_SPELL_SHIELD_SCOPE",
                "当前结果不能使用该法术护盾阻挡粒度"
            ));
        }
    }

    private void validateDamageModifier(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectDamageModifierDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "伤害修正明细形状不合法"));
            return;
        }
        if (detail.direction() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.direction"), "REQUIRED", "作用方向不能为空"));
        }
        if (detail.operation() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "修正方式不能为空"));
        }
        collectModifierZoneRef(
            result,
            index,
            detail.modifierZoneKey(),
            ModifierZoneDomain.DAMAGE,
            retained,
            refs,
            issues,
            true,
            enumName(result.resultType()),
            enumName(detail.direction()),
            enumName(detail.operation())
        );
        validateOptionalInteractionDamageType(result, index, detail.damageTypeKey(), retained, refs, issues);
        if (detail.deliveryKind() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.deliveryKind"), "REQUIRED", "伤害产生方式不能为空"));
        }
        if (detail.originKind() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.originKind"), "REQUIRED", "伤害来源性质不能为空"));
        }
        if (detail.criticalFilter() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.criticalFilter"), "REQUIRED", "暴击过滤不能为空"));
        }
        if (detail.condition() != null && !detail.condition().isNull()) {
            String path = resultPath(index, "detail.condition");
            var parsed = DamageModifierConditionSemantics.parse(detail.condition(), path);
            issues.addAll(parsed.issues());
            if (result.target() != xyz.game.datamanage.model.skilleffect.SkillEffectTarget.SOURCE) {
                issues.add(fieldIssue(resultPath(index, "target"), "CONDITION_TARGET_UNSUPPORTED", "逐笔生命门槛只支持作用于来源对象"));
            }
            if (detail.direction() != xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDirection.DEALT) {
                issues.add(fieldIssue(resultPath(index, "detail.direction"), "CONDITION_DIRECTION_UNSUPPORTED", "逐笔生命门槛只支持造成伤害方向"));
            }
            if (parsed.condition() != null) {
                String attributeKey = parsed.condition().attributeKey();
                refs.attributes.add(new CatalogRef(path + ".attributeKey", attributeKey,
                    isRetained(retained, result.resultKey(), CatalogKind.ATTRIBUTE, attributeKey)));
                refs.attributeKeys.add(attributeKey);
                SkillNumericValue threshold = parsed.condition().comparisonValue();
                if (threshold.kind() == SkillNumericValue.Kind.FORMULA) {
                    refs.formulas.add(new CatalogRef(path + ".comparisonValue.formulaKey", threshold.formulaKey(), true));
                    refs.formulaKeys.add(threshold.formulaKey());
                }
            }
        }
    }

    private void validateHealingModifier(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectHealingModifierDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "治疗修正明细形状不合法"));
            return;
        }
        if (detail.direction() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.direction"), "REQUIRED", "作用方向不能为空"));
        }
        if (detail.operation() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "修正方式不能为空"));
        }
        collectModifierZoneRef(
            result,
            index,
            detail.modifierZoneKey(),
            ModifierZoneDomain.HEALING,
            retained,
            refs,
            issues,
            true,
            enumName(result.resultType()),
            enumName(detail.direction()),
            enumName(detail.operation())
        );
        if (detail.healingKind() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.healingKind"), "REQUIRED", "治疗种类不能为空"));
        }
    }

    private void validateShieldReceivedModifier(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectShieldReceivedModifierDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "收到护盾修正明细形状不合法"));
            return;
        }
        if (detail.operation() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "修正方式不能为空"));
        }
        collectModifierZoneRef(result, index, detail.modifierZoneKey(), ModifierZoneDomain.SHIELD,
            retained, refs, issues, true, enumName(result.resultType()), null, enumName(detail.operation()));
    }

    private void validateDamageImmunity(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        forbidValueRule(result, index, issues);
        if (!(result.detail() instanceof SkillEffectDamageImmunityDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "伤害免疫明细形状不合法"));
            return;
        }
        validateOptionalInteractionDamageType(result, index, detail.damageTypeKey(), retained, refs, issues);
        if (detail.deliveryKind() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.deliveryKind"), "REQUIRED", "伤害产生方式不能为空"));
        }
        if (detail.originKind() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.originKind"), "REQUIRED", "伤害来源性质不能为空"));
        }
    }

    private void validateOptionalInteractionDamageType(
        SkillEffectResultRequest result,
        int index,
        String damageTypeKey,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (damageTypeKey == null || damageTypeKey.isBlank()) {
            return;
        }
        refs.interactionDamageTypes.add(new CatalogRef(
            resultPath(index, "detail.damageTypeKey"),
            damageTypeKey,
            isRetained(retained, result.resultKey(), CatalogKind.DAMAGE_TYPE, damageTypeKey)
        ));
        refs.damageTypeKeys.add(damageTypeKey);
    }

    private void validateHealthFloor(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectHealthFloorDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "生命下限明细形状不合法"));
            return;
        }
        String attributeKey = detail.attributeKey();
        if (attributeKey == null || attributeKey.isBlank()) {
            issues.add(fieldIssue(resultPath(index, "detail.attributeKey"), "REQUIRED", "生命属性不能为空"));
            return;
        }
        refs.attributes.add(new CatalogRef(
            resultPath(index, "detail.attributeKey"),
            attributeKey,
            isRetained(retained, result.resultKey(), CatalogKind.ATTRIBUTE, attributeKey)
        ));
        refs.attributeKeys.add(attributeKey);
    }

    private void validateExecute(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectExecuteDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "斩杀结果明细形状不合法"));
            return;
        }
        String attributeKey = detail.attributeKey();
        if (attributeKey == null || attributeKey.isBlank()) {
            issues.add(fieldIssue(resultPath(index, "detail.attributeKey"), "REQUIRED", "斩杀属性不能为空"));
            return;
        }
        refs.attributes.add(new CatalogRef(
            resultPath(index, "detail.attributeKey"),
            attributeKey,
            isRetained(retained, result.resultKey(), CatalogKind.ATTRIBUTE, attributeKey)
        ));
        refs.attributeKeys.add(attributeKey);
    }

    private void validateHitLinkApplication(
        SkillEffectResultRequest result,
        int index,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectHitLinkApplicationDetail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "命中联动应用结果明细形状不合法"));
        }
    }

    private void validateAttackLinkApplication(
        SkillEffectResultRequest result,
        int index,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectAttackLinkApplicationDetail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "攻击联动应用结果明细形状不合法"));
        }
    }

    private void collectMutexFields(
        SkillEffectResultDetail detail,
        int index,
        List<Map<String, String>> bodyIssues
    ) {
        for (String field : nullToEmptySet(detail.foreignFields())) {
            bodyIssues.add(fieldIssue(
                resultPath(index, "detail." + field),
                "FIELD_MUTEX",
                "结果明细字段互斥"
            ));
        }
        for (String field : nullToEmptySet(detail.unknownFields())) {
            bodyIssues.add(fieldIssue(
                resultPath(index, "detail." + field),
                "UNKNOWN_FIELD",
                "结果明细包含未知字段"
            ));
        }
    }

    private void validateDamage(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectDamageDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "伤害结果明细形状不合法"));
            return;
        }
        String damageTypeKey = detail.damageTypeKey();
        if (damageTypeKey == null || damageTypeKey.isBlank()) {
            issues.add(fieldIssue(resultPath(index, "detail.damageTypeKey"), "REQUIRED", "伤害类型不能为空"));
        } else {
            refs.damageTypes.add(new CatalogRef(
                resultPath(index, "detail.damageTypeKey"),
                damageTypeKey,
                isRetained(retained, result.resultKey(), CatalogKind.DAMAGE_TYPE, damageTypeKey)
            ));
            refs.damageTypeKeys.add(damageTypeKey);
        }
        if (detail.deliveryKind() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.deliveryKind"), "REQUIRED", "伤害产生方式不能为空"));
        }
        if (detail.originKind() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.originKind"), "REQUIRED", "伤害来源性质不能为空"));
        }
        SkillEffectCriticalPolicy critical = detail.critical();
        if (critical == null || critical.mode() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.critical.mode"), "REQUIRED", "暴击方式不能为空"));
        } else if (critical.mode() == SkillEffectCriticalMode.DISALLOWED
            && critical.multiplierValue() != null) {
            issues.add(fieldIssue(
                resultPath(index, "detail.critical.multiplierValue"),
                "INVALID_CRITICAL_SHAPE",
                "不允许暴击时不能配置暴击倍率公式"
            ));
        }
        if (critical != null && critical.multiplierValue() != null) {
            addInteractionFormulaRef(
                refs,
                resultPath(index, "detail.critical.multiplierValue"),
                critical.multiplierValue()
            );
        }
        xyz.game.datamanage.support.authoring.GameVampRuleSemantics.validateDamageShape(
            detail, resultPath(index, "detail"), issues);
        if (detail.vampOverrides() != null) {
            for (int i = 0; i < detail.vampOverrides().size(); i++) {
                SkillEffectVampOverride override = detail.vampOverrides().get(i);
                if (override != null && override.mode() == xyz.game.datamanage.model.skilleffect.SkillEffectVampOverrideMode.OVERRIDE
                    && override.efficiencyValue() != null) {
                    addInteractionFormulaRef(refs, resultPath(index, "detail.vampOverrides[" + i + "].efficiencyValue"), override.efficiencyValue());
                }
            }
        }
    }

    private void validateEmptyDetailValue(
        SkillEffectResultRequest result,
        int index,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectDirectHealDetail)
        ) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "结果明细形状不合法"));
        }
    }

    private void validateNormalShield(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectNormalShieldDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "普通护盾结果明细形状不合法"));
            return;
        }
        if (detail.decayMode() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.decayMode"), "REQUIRED", "护盾衰减方式不能为空"));
        }
        String damageTypeKey = detail.absorbedDamageTypeKey();
        if (damageTypeKey != null && !damageTypeKey.isBlank()) {
            refs.interactionDamageTypes.add(new CatalogRef(
                resultPath(index, "detail.absorbedDamageTypeKey"),
                damageTypeKey,
                isRetained(retained, result.resultKey(), CatalogKind.DAMAGE_TYPE, damageTypeKey)
            ));
            refs.damageTypeKeys.add(damageTypeKey);
        }
    }

    private void validateNormalShieldLifecycle(
        SkillEffectLifecycleRequest lifecycle,
        SkillEffectResultRequest result,
        int index,
        List<Map<String, String>> issues
    ) {
        if (result == null || result.resultType() != SkillEffectResultType.NORMAL_SHIELD) {
            return;
        }
        if (lifecycle == null) {
            issues.add(fieldIssue(resultPath(index, "lifecycleBehavior"), "REQUIRED", "普通护盾必须配置生命周期"));
            return;
        }
        SkillEffectResultLifecycleBehaviorRequest behavior = result.lifecycleBehavior();
        if (behavior == null || behavior.moment() != SkillEffectLifecycleMoment.PERSISTENT) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.moment"),
                "COMBINATION_INVALID",
                "普通护盾必须持续生效"
            ));
            return;
        }
        if (!(result.detail() instanceof SkillEffectNormalShieldDetail detail)
            || detail.decayMode() != SkillEffectNormalShieldDecayMode.LINEAR_TO_ZERO) {
            return;
        }
        if (lifecycle.durationValue() == null) {
            issues.add(fieldIssue(
                "lifecycle.durationValue",
                "REQUIRED",
                "线性衰减护盾必须配置持续时间"
            ));
        }
        if (lifecycle.expiryMode() != SkillEffectLifecycleExpiryMode.ALL_AT_ONCE) {
            issues.add(fieldIssue(
                "lifecycle.expiryMode",
                "COMBINATION_INVALID",
                "线性衰减护盾只允许整体到期"
            ));
        }
        if (behavior.stackValueMode() != SkillEffectLifecycleStackValueMode.SHARED) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.stackValueMode"),
                "COMBINATION_INVALID",
                "线性衰减护盾只允许共享护盾值"
            ));
        }
    }

    private static void addInteractionFormulaRef(CollectedRefs refs, String path, SkillNumericValue value) {
        if (value == null || value.formulaKey() == null) return;
        String formulaKey = value.formulaKey();
        refs.interactionFormulas.add(new CatalogRef(path, formulaKey, true));
        refs.formulaKeys.add(formulaKey);
    }

    private void validateAttributeChange(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectAttributeChangeDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "属性变化结果明细形状不合法"));
            return;
        }
        if (detail.operation() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "属性变化操作不能为空"));
        }
        boolean persistentAdjustment = detail.operation() != SkillEffectAttributeChangeOperation.SET
            && result.lifecycleBehavior() != null
            && result.lifecycleBehavior().moment() == SkillEffectLifecycleMoment.PERSISTENT;
        collectModifierZoneRef(
            result,
            index,
            detail.modifierZoneKey(),
            ModifierZoneDomain.ATTRIBUTE,
            retained,
            refs,
            issues,
            persistentAdjustment,
            enumName(result.resultType()),
            null,
            enumName(detail.operation())
        );
        String attributeKey = detail.attributeKey();
        if (attributeKey == null || attributeKey.isBlank()) {
            issues.add(fieldIssue(resultPath(index, "detail.attributeKey"), "REQUIRED", "属性不能为空"));
            return;
        }
        refs.attributes.add(new CatalogRef(
            resultPath(index, "detail.attributeKey"),
            attributeKey,
            isRetained(retained, result.resultKey(), CatalogKind.ATTRIBUTE, attributeKey)
        ));
        refs.attributeKeys.add(attributeKey);
    }

    private static void collectModifierZoneRef(
        SkillEffectResultRequest result,
        int index,
        String modifierZoneKey,
        ModifierZoneDomain expectedDomain,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        boolean required,
        String resultType,
        String direction,
        String operation
    ) {
        String path = resultPath(index, "detail.modifierZoneKey");
        if (modifierZoneKey == null || modifierZoneKey.isBlank()) {
            if (required) {
                issues.add(fieldIssue(path, "REQUIRED", "乘区不能为空"));
            }
            return;
        }
        if (!required) {
            issues.add(fieldIssue(path, "FORBIDDEN", "该结果不能选择乘区"));
            return;
        }
        refs.modifierZones.add(new ModifierZoneRef(
            path,
            modifierZoneKey,
            expectedDomain,
            isRetained(retained, result.resultKey(), CatalogKind.MODIFIER_ZONE, modifierZoneKey),
            resultPath(index, ""),
            resultType,
            direction,
            operation,
            result.detail() instanceof SkillEffectDamageModifierDetail damage
                && damage.condition() != null && !damage.condition().isNull()
        ));
        refs.modifierZoneKeys.add(modifierZoneKey);
    }

    private void validateResourceChange(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectResourceChangeDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "资源变化结果明细形状不合法"));
            return;
        }
        if (detail.operation() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "资源变化操作不能为空"));
        }
        String attributeKey = detail.attributeKey();
        if (attributeKey == null || attributeKey.isBlank()) {
            issues.add(fieldIssue(resultPath(index, "detail.attributeKey"), "REQUIRED", "属性不能为空"));
            return;
        }
        refs.attributes.add(new CatalogRef(
            resultPath(index, "detail.attributeKey"),
            attributeKey,
            isRetained(retained, result.resultKey(), CatalogKind.ATTRIBUTE, attributeKey)
        ));
        refs.attributeKeys.add(attributeKey);
    }

    private void validateCooldownChange(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        String pathSkillKey,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (!(result.detail() instanceof SkillEffectCooldownChangeDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "冷却变化结果明细形状不合法"));
            validateValueRulePresence(result, index, issues);
            return;
        }
        SkillEffectCooldownChangeOperation operation = detail.operation();
        if (operation == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "冷却变化操作不能为空"));
            validateValueRulePresence(result, index, issues);
        } else if (operation == SkillEffectCooldownChangeOperation.RESET) {
            forbidValueRule(result, index, issues);
        } else {
            requireValueRule(result, index, refs, issues);
        }
        collectAffectedSkillScope(
            result,
            index,
            detail.affectedSkillScope(),
            retained,
            pathSkillKey,
            refs,
            issues
        );
    }

    private void validateHasteModifier(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        String pathSkillKey,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectHasteModifierDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "技能急速修正明细形状不合法"));
            return;
        }
        if (detail.operation() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "技能急速操作不能为空"));
        } else if (detail.operation() != SkillEffectModifierOperation.INCREASE
            && detail.operation() != SkillEffectModifierOperation.DECREASE) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "INVALID", "技能急速操作只能是增加或减少"));
        }
        collectAffectedSkillScope(
            result,
            index,
            detail.affectedSkillScope(),
            retained,
            pathSkillKey,
            refs,
            issues
        );
    }

    private void collectAffectedSkillScope(
        SkillEffectResultRequest result,
        int index,
        SkillEffectAffectedSkillScope scope,
        Map<String, RetainedCatalog> retained,
        String pathSkillKey,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (scope == null) {
            issues.add(fieldIssue(
                resultPath(index, "detail.affectedSkillScope"),
                "REQUIRED",
                "技能作用范围不能为空"
            ));
            return;
        }
        if (scope.mode() == null) {
            issues.add(fieldIssue(
                resultPath(index, "detail.affectedSkillScope.mode"),
                "REQUIRED",
                "技能作用范围模式不能为空"
            ));
            return;
        }
        List<String> skillKeys = scope.skillKeys();
        List<String> skillCategoryKeys = scope.skillCategoryKeys();
        if (skillKeys == null) {
            issues.add(fieldIssue(
                resultPath(index, "detail.affectedSkillScope.skillKeys"),
                "REQUIRED",
                "技能标识列表不能缺失"
            ));
            skillKeys = List.of();
        }
        if (skillCategoryKeys == null) {
            issues.add(fieldIssue(
                resultPath(index, "detail.affectedSkillScope.skillCategoryKeys"),
                "REQUIRED",
                "技能分类标识列表不能缺失"
            ));
            skillCategoryKeys = List.of();
        }
        switch (scope.mode()) {
            case ALL -> {
                if (!skillKeys.isEmpty()) {
                    issues.add(fieldIssue(
                        resultPath(index, "detail.affectedSkillScope.skillKeys"),
                        "COMBINATION_INVALID",
                        "全部技能范围不能选择明确技能"
                    ));
                }
                if (!skillCategoryKeys.isEmpty()) {
                    issues.add(fieldIssue(
                        resultPath(index, "detail.affectedSkillScope.skillCategoryKeys"),
                        "COMBINATION_INVALID",
                        "全部技能范围不能选择技能分类"
                    ));
                }
            }
            case SKILLS -> {
                if (skillKeys.isEmpty()) {
                    issues.add(fieldIssue(
                        resultPath(index, "detail.affectedSkillScope.skillKeys"),
                        "AFFECTED_SKILL_REQUIRED",
                        "指定技能范围至少选择一个技能"
                    ));
                }
                if (!skillCategoryKeys.isEmpty()) {
                    issues.add(fieldIssue(
                        resultPath(index, "detail.affectedSkillScope.skillCategoryKeys"),
                        "COMBINATION_INVALID",
                        "指定技能范围不能选择技能分类"
                    ));
                }
            }
            case CATEGORIES -> {
                if (!skillKeys.isEmpty()) {
                    issues.add(fieldIssue(
                        resultPath(index, "detail.affectedSkillScope.skillKeys"),
                        "COMBINATION_INVALID",
                        "指定分类范围不能选择明确技能"
                    ));
                }
                if (skillCategoryKeys.isEmpty()) {
                    issues.add(fieldIssue(
                        resultPath(index, "detail.affectedSkillScope.skillCategoryKeys"),
                        "AFFECTED_CATEGORY_REQUIRED",
                        "指定分类范围至少选择一个技能分类"
                    ));
                }
            }
        }
        Set<String> seenSkills = new HashSet<>();
        for (int targetIndex = 0; targetIndex < skillKeys.size(); targetIndex++) {
            String affectedSkillKey = skillKeys.get(targetIndex);
            String path = resultPath(index, "detail.affectedSkillScope.skillKeys[" + targetIndex + "]");
            if (affectedSkillKey == null || affectedSkillKey.isBlank()) {
                issues.add(fieldIssue(path, "AFFECTED_SKILL_REQUIRED", "受影响技能不能为空"));
                continue;
            }
            if (!STABLE_KEY_PATTERN.matcher(affectedSkillKey).matches()) {
                issues.add(fieldIssue(path, "FORMAT_INVALID", "受影响技能标识格式不合法"));
                continue;
            }
            if (!seenSkills.add(affectedSkillKey)) {
                issues.add(fieldIssue(path, "DUPLICATE_AFFECTED_SKILL", "受影响技能不能重复"));
                continue;
            }
            if (scope.mode() != SkillEffectSkillScopeMode.SKILLS) {
                continue;
            }
            boolean selfReference = affectedSkillKey.equals(pathSkillKey);
            refs.skills.add(new CatalogRef(
                path,
                affectedSkillKey,
                selfReference
                    || isRetained(retained, result.resultKey(), CatalogKind.SKILL, affectedSkillKey)
            ));
            refs.skillKeys.add(affectedSkillKey);
        }
        Set<String> seenCategories = new HashSet<>();
        for (int targetIndex = 0; targetIndex < skillCategoryKeys.size(); targetIndex++) {
            String skillCategoryKey = skillCategoryKeys.get(targetIndex);
            String path = resultPath(index, "detail.affectedSkillScope.skillCategoryKeys[" + targetIndex + "]");
            if (skillCategoryKey == null || skillCategoryKey.isBlank()) {
                issues.add(fieldIssue(path, "AFFECTED_CATEGORY_REQUIRED", "技能分类不能为空"));
                continue;
            }
            if (!STABLE_KEY_PATTERN.matcher(skillCategoryKey).matches()) {
                issues.add(fieldIssue(path, "FORMAT_INVALID", "技能分类标识格式不合法"));
                continue;
            }
            if (!seenCategories.add(skillCategoryKey)) {
                issues.add(fieldIssue(path, "DUPLICATE_AFFECTED_CATEGORY", "技能分类不能重复"));
                continue;
            }
            if (scope.mode() != SkillEffectSkillScopeMode.CATEGORIES) {
                continue;
            }
            refs.skillCategories.add(new CatalogRef(
                path,
                skillCategoryKey,
                isRetained(retained, result.resultKey(), CatalogKind.SKILL_CATEGORY, skillCategoryKey)
            ));
            refs.skillCategoryKeys.add(skillCategoryKey);
        }
    }

    private void validateStatusOperation(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (result.valueRule() != null) {
            requireValueRule(result, index, refs, issues);
        }
        if (!(result.detail() instanceof SkillEffectStatusOperationDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "状态操作结果明细形状不合法"));
            return;
        }
        if (detail.operation() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "状态操作不能为空"));
        }
        String statusKey = detail.statusKey();
        if (statusKey == null || statusKey.isBlank()) {
            issues.add(fieldIssue(resultPath(index, "detail.statusKey"), "REQUIRED", "状态不能为空"));
            return;
        }
        refs.statuses.add(new CatalogRef(
            resultPath(index, "detail.statusKey"),
            statusKey,
            isRetained(retained, result.resultKey(), CatalogKind.STATUS, statusKey)
        ));
        refs.statusKeys.add(statusKey);
        refs.statusResults.put(index, result);
    }

    private void validateStatusKinds(CollectedRefs refs, Map<String, StatusKind> statusKinds) {
        List<Map<String, String>> issues = new ArrayList<>();
        refs.statusResults.forEach((index, result) -> {
            SkillEffectStatusOperationDetail detail = (SkillEffectStatusOperationDetail) result.detail();
            if (statusKinds.get(detail.statusKey()) != StatusKind.MOVEMENT_SLOW
                || detail.operation() != SkillEffectStatusOperation.APPLY) {
                forbidValueRule(result, index, issues);
                return;
            }
            SkillEffectValueRuleRequest value = result.valueRule();
            if (value == null) {
                issues.add(fieldIssue(resultPath(index, "valueRule"), "REQUIRED", "普通减速施加必须提供强度数值规则"));
            } else {
                if (value.fixedMinValue() == null || value.fixedMinValue().compareTo(BigDecimal.ZERO) != 0) {
                    issues.add(fieldIssue(resultPath(index, "valueRule.fixedMinValue"), "RANGE_INVALID", "减速比例下界必须为0"));
                }
                if (value.fixedMaxValue() == null || value.fixedMaxValue().compareTo(BigDecimal.ONE) != 0) {
                    issues.add(fieldIssue(resultPath(index, "valueRule.fixedMaxValue"), "RANGE_INVALID", "减速比例上界必须为1"));
                }
            }
            if (refs.lifecycle == null || refs.lifecycle.durationValue() == null) {
                issues.add(fieldIssue("lifecycle.durationValue", "REQUIRED", "普通减速必须有期限生命周期"));
            }
            SkillEffectResultLifecycleBehaviorRequest behavior = result.lifecycleBehavior();
            if (behavior == null) {
                issues.add(fieldIssue(resultPath(index, "lifecycleBehavior"), "REQUIRED", "普通减速必须声明持续生效行为"));
                return;
            }
            if (behavior.moment() != SkillEffectLifecycleMoment.PERSISTENT) {
                issues.add(fieldIssue(resultPath(index, "lifecycleBehavior.moment"), "COMBINATION_INVALID", "普通减速必须持续生效"));
            }
            if (behavior.valueReadMode() != SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT) {
                issues.add(fieldIssue(resultPath(index, "lifecycleBehavior.valueReadMode"), "COMBINATION_INVALID", "普通减速必须在施加时读取强度快照"));
            }
            if (behavior.stackValueMode() != SkillEffectLifecycleStackValueMode.SHARED) {
                issues.add(fieldIssue(resultPath(index, "lifecycleBehavior.stackValueMode"), "COMBINATION_INVALID", "普通减速必须共享强度"));
            }
            if (behavior.reapplicationValueMode() != SkillEffectLifecycleReapplicationValueMode.REPLACE) {
                issues.add(fieldIssue(resultPath(index, "lifecycleBehavior.reapplicationValueMode"), "COMBINATION_INVALID", "普通减速重施必须覆盖强度"));
            }
        });
        throwIfInvalid(issues);
    }

    private void validateLifecycleOperation(
        SkillEffectResultRequest result,
        int index,
        String currentEffectKey,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (!(result.detail() instanceof SkillEffectLifecycleOperationDetail detail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "生命周期操作结果明细形状不合法"));
            validateValueRulePresence(result, index, issues);
            return;
        }
        SkillEffectLifecycleOperation operation = detail.operation();
        if (operation == null) {
            issues.add(fieldIssue(resultPath(index, "detail.operation"), "REQUIRED", "生命周期操作不能为空"));
            validateValueRulePresence(result, index, issues);
        } else if (operation == SkillEffectLifecycleOperation.REFRESH
            || operation == SkillEffectLifecycleOperation.REMOVE) {
            forbidValueRule(result, index, issues);
        } else {
            requireValueRule(result, index, refs, issues);
        }
        String targetEffectKey = detail.targetEffectKey();
        if (targetEffectKey == null || targetEffectKey.isBlank()) {
            issues.add(fieldIssue(
                resultPath(index, "detail.targetEffectKey"),
                "REQUIRED",
                "目标效果不能为空"
            ));
            return;
        }
        refs.targetEffects.add(new TargetEffectRef(
            resultPath(index, "detail.targetEffectKey"),
            targetEffectKey,
            operation == SkillEffectLifecycleOperation.REFRESH,
            operation == SkillEffectLifecycleOperation.EXTEND_DURATION,
            currentEffectKey != null && currentEffectKey.equals(targetEffectKey)
        ));
        refs.targetEffectKeys.add(targetEffectKey);
    }

    private void validateLifecycle(SkillEffectLifecycleRequest lifecycle, List<Map<String, String>> issues) {
        if (lifecycle == null) {
            return;
        }
        if (lifecycle.maxStacksValue() == null) {
            issues.add(fieldIssue("lifecycle.maxStacksValue", "REQUIRED", "最大层数公式不能为空"));
        }
        if (lifecycle.applicationStacksValue() == null
           ) {
            issues.add(fieldIssue("lifecycle.applicationStacksValue", "REQUIRED", "每次施加层数公式不能为空"));
        }
        if (lifecycle.instanceScope() == null) {
            issues.add(fieldIssue("lifecycle.instanceScope", "REQUIRED", "实例范围不能为空"));
        }
        if (lifecycle.reapplicationStackMode() == null) {
            issues.add(fieldIssue("lifecycle.reapplicationStackMode", "REQUIRED", "重复施加层数处理不能为空"));
        }
        if (lifecycle.expiryMode() == null) {
            issues.add(fieldIssue("lifecycle.expiryMode", "REQUIRED", "到期方式不能为空"));
        }
        boolean hasDuration = lifecycle.durationValue() != null;
        if (!hasDuration) {
            if (lifecycle.expiryMode() != null
                && lifecycle.expiryMode() != SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY) {
                issues.add(fieldIssue(
                    "lifecycle.expiryMode",
                    "COMBINATION_INVALID",
                    "没有自然到期时到期方式必须为EXPLICIT_ONLY"
                ));
            }
            if (lifecycle.reapplicationDurationMode() != null) {
                issues.add(fieldIssue(
                    "lifecycle.reapplicationDurationMode",
                    "FORBIDDEN",
                    "没有自然到期时不能设置重复施加持续时间处理"
                ));
            }
        } else {
            if (lifecycle.expiryMode() == SkillEffectLifecycleExpiryMode.EXPLICIT_ONLY) {
                issues.add(fieldIssue(
                    "lifecycle.expiryMode",
                    "COMBINATION_INVALID",
                    "有自然到期时不能只显式移除"
                ));
            }
            if (lifecycle.reapplicationDurationMode() == null) {
                issues.add(fieldIssue(
                    "lifecycle.reapplicationDurationMode",
                    "REQUIRED",
                    "有自然到期时必须设置重复施加持续时间处理"
                ));
            }
        }
        if (lifecycle.reapplicationDurationMode() == SkillEffectLifecycleReapplicationDurationMode.INDEPENDENT
            && lifecycle.expiryMode() != SkillEffectLifecycleExpiryMode.INDEPENDENT) {
            issues.add(fieldIssue(
                "lifecycle.expiryMode",
                "COMBINATION_INVALID",
                "独立计时必须与独立到期同时出现"
            ));
        }
        if (lifecycle.expiryMode() == SkillEffectLifecycleExpiryMode.INDEPENDENT
            && lifecycle.reapplicationDurationMode() != SkillEffectLifecycleReapplicationDurationMode.INDEPENDENT) {
            issues.add(fieldIssue(
                "lifecycle.reapplicationDurationMode",
                "COMBINATION_INVALID",
                "独立到期必须与独立计时同时出现"
            ));
        }
        if (lifecycle.expiryMode() == SkillEffectLifecycleExpiryMode.ONE_BY_ONE
            && lifecycle.reapplicationDurationMode() != null
            && lifecycle.reapplicationDurationMode() != SkillEffectLifecycleReapplicationDurationMode.REFRESH_ALL
            && lifecycle.reapplicationDurationMode() != SkillEffectLifecycleReapplicationDurationMode.KEEP_REMAINING) {
            issues.add(fieldIssue(
                "lifecycle.reapplicationDurationMode",
                "COMBINATION_INVALID",
                "逐层到期只能搭配整体刷新或保留剩余时间"
            ));
        }
        if ((lifecycle.periodicIntervalValue() == null)
            != (lifecycle.firstPeriodicExecution() == null)) {
            if (lifecycle.periodicIntervalValue() == null) {
                issues.add(fieldIssue("lifecycle.periodicIntervalValue", "REQUIRED", "周期间隔与首次周期必须同时设置"));
            } else {
                issues.add(fieldIssue("lifecycle.firstPeriodicExecution", "REQUIRED", "周期间隔与首次周期必须同时设置"));
            }
        }
    }

    private void collectLifecycleFormulaRefs(SkillEffectLifecycleRequest lifecycle, CollectedRefs refs) {
        if (lifecycle == null) {
            return;
        }
        addLifecycleFormula(refs, "lifecycle.durationValue", lifecycle.durationValue());
        addLifecycleFormula(refs, "lifecycle.maxStacksValue", lifecycle.maxStacksValue());
        addLifecycleFormula(refs, "lifecycle.applicationStacksValue", lifecycle.applicationStacksValue());
        addLifecycleFormula(refs, "lifecycle.periodicIntervalValue", lifecycle.periodicIntervalValue());
    }

    private static void addLifecycleFormula(CollectedRefs refs, String path, SkillNumericValue value) {
        String formulaKey = value == null ? null : value.formulaKey();
        if (formulaKey == null || formulaKey.isBlank()) {
            return;
        }
        refs.lifecycleFormulas.add(new CatalogRef(path, formulaKey, true));
        refs.formulaKeys.add(formulaKey);
    }

    private void validateLifecycleBehavior(
        SkillEffectLifecycleRequest lifecycle,
        SkillEffectResultRequest result,
        int index,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (result == null) {
            return;
        }
        SkillEffectResultLifecycleBehaviorRequest behavior = result.lifecycleBehavior();
        if (lifecycle == null) {
            if (behavior != null) {
                issues.add(fieldIssue(
                    resultPath(index, "lifecycleBehavior"),
                    "FORBIDDEN",
                    "没有生命周期时结果不能有生命周期行为"
                ));
            }
            return;
        }
        if (behavior == null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior"),
                "REQUIRED",
                "有生命周期时每个结果必须声明生命周期行为"
            ));
            return;
        }
        if (behavior.moment() == null) {
            issues.add(fieldIssue(resultPath(index, "lifecycleBehavior.moment"), "REQUIRED", "生命周期时点不能为空"));
            return;
        }
        boolean hasValueRule = result.valueRule() != null;
        if (hasValueRule) {
            if (behavior.valueReadMode() == null) {
                issues.add(fieldIssue(
                    resultPath(index, "lifecycleBehavior.valueReadMode"),
                    "REQUIRED",
                    "有数值规则时必须选择读取方式"
                ));
            } else if (behavior.moment() == SkillEffectLifecycleMoment.APPLICATION
                && behavior.valueReadMode() != SkillEffectLifecycleValueReadMode.APPLICATION_SNAPSHOT) {
                issues.add(fieldIssue(
                    resultPath(index, "lifecycleBehavior.valueReadMode"),
                    "COMBINATION_INVALID",
                    "施加时数值只允许施加快照"
                ));
            } else if (behavior.moment() == SkillEffectLifecycleMoment.PERSISTENT
                && behavior.valueReadMode() == SkillEffectLifecycleValueReadMode.MOMENT_EVALUATION
                && !supportsMomentEvaluation(result)) {
                issues.add(fieldIssue(
                    resultPath(index, "lifecycleBehavior.valueReadMode"),
                    "COMBINATION_INVALID",
                    "该持续结果不支持按当前时点读取数值"
                ));
            }
            if (behavior.moment() == SkillEffectLifecycleMoment.PERSISTENT
                && behavior.valueReadMode() == SkillEffectLifecycleValueReadMode.MOMENT_EVALUATION
                && result.valueRule().value() != null
                && result.valueRule().value().formulaKey() != null) {
                refs.dynamicFormulas.add(new CatalogRef(
                    resultPath(index, "valueRule.value"),
                    result.valueRule().value().formulaKey(),
                    true
                ));
            }
        } else if (behavior.valueReadMode() != null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.valueReadMode"),
                "FORBIDDEN",
                "没有数值规则时不能设置读取方式"
            ));
        }
        if (behavior.moment() == SkillEffectLifecycleMoment.PERIODIC) {
            if (behavior.periodicExecutionMode() == null) {
                issues.add(fieldIssue(
                    resultPath(index, "lifecycleBehavior.periodicExecutionMode"),
                    "REQUIRED",
                    "周期时点必须选择执行次数"
                ));
            }
        } else if (behavior.periodicExecutionMode() != null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.periodicExecutionMode"),
                "FORBIDDEN",
                "非周期时点不能设置周期执行次数"
            ));
        }
        if (behavior.moment() == SkillEffectLifecycleMoment.PERSISTENT) {
            validatePersistentBehavior(result, index, behavior, issues);
        } else if (behavior.stackValueMode() != null || behavior.reapplicationValueMode() != null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.stackValueMode"),
                "FORBIDDEN",
                "非持续生效结果不能设置层数和值合并"
            ));
        }
        if (behavior.moment() == SkillEffectLifecycleMoment.NATURAL_END
            && lifecycle.durationValue() == null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.moment"),
                "COMBINATION_INVALID",
                "没有自然到期时不能使用自然结束时点"
            ));
        }
    }

    private static boolean supportsMomentEvaluation(SkillEffectResultRequest result) {
        if (result.resultType() == SkillEffectResultType.DAMAGE_MODIFIER
            || result.resultType() == SkillEffectResultType.HEALING_MODIFIER
            || result.resultType() == SkillEffectResultType.SHIELD_RECEIVED_MODIFIER) {
            return true;
        }
        return result.resultType() == SkillEffectResultType.ATTRIBUTE_CHANGE
            && result.detail() instanceof SkillEffectAttributeChangeDetail detail
            && detail.operation() != null
            && detail.operation() != SkillEffectAttributeChangeOperation.SET;
    }

    private void validatePersistentBehavior(
        SkillEffectResultRequest result,
        int index,
        SkillEffectResultLifecycleBehaviorRequest behavior,
        List<Map<String, String>> issues
    ) {
        SkillEffectResultType type = result.resultType();
        if (type == SkillEffectResultType.EXECUTE
            || type == SkillEffectResultType.HIT_LINK_APPLICATION
            || type == SkillEffectResultType.ATTACK_LINK_APPLICATION) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.moment"),
                "SPECIAL_RESULT_FORBIDS_PERSISTENT",
                "斩杀与联动结果不能持续生效"
            ));
            return;
        }
        boolean statusApply = type == SkillEffectResultType.STATUS_OPERATION
            && result.detail() instanceof SkillEffectStatusOperationDetail statusDetail
            && statusDetail.operation() == SkillEffectStatusOperation.APPLY;
        boolean allowed = type == SkillEffectResultType.NORMAL_SHIELD
            || type == SkillEffectResultType.ATTRIBUTE_CHANGE
            || type == SkillEffectResultType.DAMAGE_MODIFIER
            || type == SkillEffectResultType.HEALING_MODIFIER
            || type == SkillEffectResultType.SHIELD_RECEIVED_MODIFIER
            || type == SkillEffectResultType.DAMAGE_IMMUNITY
            || type == SkillEffectResultType.HEALTH_FLOOR
            || type == SkillEffectResultType.SPELL_SHIELD
            || type == SkillEffectResultType.SKILL_HASTE_MODIFIER
            || statusApply;
        if (!allowed) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.moment"),
                "COMBINATION_INVALID",
                "该结果不支持持续生效"
            ));
            return;
        }
        if ((statusApply && result.valueRule() == null)
            || type == SkillEffectResultType.DAMAGE_IMMUNITY
            || type == SkillEffectResultType.SPELL_SHIELD) {
            if (behavior.stackValueMode() != null || behavior.reapplicationValueMode() != null) {
                issues.add(fieldIssue(
                    resultPath(index, "lifecycleBehavior.stackValueMode"),
                    "FORBIDDEN",
                    "该持续结果不能设置层数和值合并"
                ));
            }
            return;
        }
        if (behavior.stackValueMode() == null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.stackValueMode"),
                "REQUIRED",
                "持续数值结果必须选择层数贡献方式"
            ));
            return;
        }
        boolean momentEvaluation = behavior.valueReadMode()
            == SkillEffectLifecycleValueReadMode.MOMENT_EVALUATION;
        if (momentEvaluation) {
            if (behavior.reapplicationValueMode() != null) {
                issues.add(fieldIssue(
                    resultPath(index, "lifecycleBehavior.reapplicationValueMode"),
                    "FORBIDDEN",
                    "按当前时点读取数值时不能设置重复施加值合并"
                ));
            }
            return;
        }
        boolean attributeSet = type == SkillEffectResultType.ATTRIBUTE_CHANGE
            && result.detail() instanceof SkillEffectAttributeChangeDetail attributeDetail
            && attributeDetail.operation() == SkillEffectAttributeChangeOperation.SET;
        boolean sharedOnly = attributeSet
            || type == SkillEffectResultType.HEALTH_FLOOR
            || type == SkillEffectResultType.SKILL_HASTE_MODIFIER;
        if (sharedOnly && behavior.stackValueMode() != SkillEffectLifecycleStackValueMode.SHARED) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.stackValueMode"),
                "COMBINATION_INVALID",
                "该结果只允许整个实例共享数值"
            ));
        }
        if (behavior.stackValueMode() == SkillEffectLifecycleStackValueMode.PER_STACK) {
            if (behavior.reapplicationValueMode() != null) {
                issues.add(fieldIssue(
                    resultPath(index, "lifecycleBehavior.reapplicationValueMode"),
                    "FORBIDDEN",
                    "每层贡献时不能设置重复施加值合并"
                ));
            }
            return;
        }
        if (behavior.reapplicationValueMode() == null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.reapplicationValueMode"),
                "REQUIRED",
                "共享数值时必须选择重复施加值合并"
            ));
            return;
        }
        if (sharedOnly
            && behavior.reapplicationValueMode() == SkillEffectLifecycleReapplicationValueMode.ADD) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.reapplicationValueMode"),
                "COMBINATION_INVALID",
                "该结果不能使用重复相加"
            ));
        }
        if (type == SkillEffectResultType.SKILL_HASTE_MODIFIER
            && behavior.reapplicationValueMode() != null
            && behavior.reapplicationValueMode() != SkillEffectLifecycleReapplicationValueMode.KEEP) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.reapplicationValueMode"),
                "COMBINATION_INVALID",
                "技能急速修正必须保留已有数值"
            ));
        }
    }

    private void validatePersistentSpecialResultLifecycle(
        SkillEffectLifecycleRequest lifecycle,
        SkillEffectResultRequest result,
        int index,
        List<Map<String, String>> issues
    ) {
        if (result == null || result.resultType() == null) {
            return;
        }
        SkillEffectResultType type = result.resultType();
        boolean special = type == SkillEffectResultType.DAMAGE_MODIFIER
            || type == SkillEffectResultType.HEALING_MODIFIER
            || type == SkillEffectResultType.SHIELD_RECEIVED_MODIFIER
            || type == SkillEffectResultType.DAMAGE_IMMUNITY
            || type == SkillEffectResultType.HEALTH_FLOOR
            || type == SkillEffectResultType.SPELL_SHIELD
            || type == SkillEffectResultType.SKILL_HASTE_MODIFIER;
        if (!special) {
            return;
        }
        if (lifecycle == null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior"),
                "SPECIAL_RESULT_REQUIRES_PERSISTENT",
                "持续修正与保护结果必须配置生命周期"
            ));
            return;
        }
        SkillEffectResultLifecycleBehaviorRequest behavior = result.lifecycleBehavior();
        if (behavior == null || behavior.moment() != SkillEffectLifecycleMoment.PERSISTENT) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.moment"),
                "SPECIAL_RESULT_REQUIRES_PERSISTENT",
                "持续修正与保护结果必须持续生效"
            ));
        }
    }

    private void validateLifecyclePeriodicPair(
        SkillEffectLifecycleRequest lifecycle,
        boolean hasPeriodic,
        boolean hasNaturalEnd,
        List<Map<String, String>> issues
    ) {
        if (lifecycle == null) {
            return;
        }
        if (hasPeriodic) {
            if (lifecycle.periodicIntervalValue() == null) {
                issues.add(fieldIssue(
                    "lifecycle.periodicIntervalValue",
                    "REQUIRED",
                    "存在周期结果时必须设置周期间隔"
                ));
            }
            if (lifecycle.firstPeriodicExecution() == null) {
                issues.add(fieldIssue(
                    "lifecycle.firstPeriodicExecution",
                    "REQUIRED",
                    "存在周期结果时必须设置首次周期"
                ));
            }
        } else {
            if (lifecycle.periodicIntervalValue() != null) {
                issues.add(fieldIssue(
                    "lifecycle.periodicIntervalValue",
                    "FORBIDDEN",
                    "没有周期结果时不能设置周期间隔"
                ));
            }
            if (lifecycle.firstPeriodicExecution() != null) {
                issues.add(fieldIssue(
                    "lifecycle.firstPeriodicExecution",
                    "FORBIDDEN",
                    "没有周期结果时不能设置首次周期"
                ));
            }
        }
        if (hasNaturalEnd && lifecycle.durationValue() == null) {
            issues.add(fieldIssue(
                "lifecycle.durationValue",
                "COMBINATION_INVALID",
                "没有自然到期时不能使用自然结束结果"
            ));
        }
    }

    private void validateValueRulePresence(
        SkillEffectResultRequest result,
        int index,
        List<Map<String, String>> issues
    ) {
        if (result.resultType() == SkillEffectResultType.STATUS_OPERATION) {
            return; // 状态数值规则在锁定目录种类后校验。
        }
        if (result.resultType() == SkillEffectResultType.DAMAGE_IMMUNITY
            || result.resultType() == SkillEffectResultType.SPELL_SHIELD) {
            forbidValueRule(result, index, issues);
            return;
        }
        if (result.resultType() == SkillEffectResultType.LIFECYCLE_OPERATION
            && result.detail() instanceof SkillEffectLifecycleOperationDetail detail
            && (detail.operation() == SkillEffectLifecycleOperation.REFRESH
                || detail.operation() == SkillEffectLifecycleOperation.REMOVE)) {
            forbidValueRule(result, index, issues);
            return;
        }
        if (result.resultType() == SkillEffectResultType.COOLDOWN_CHANGE
            && result.detail() instanceof SkillEffectCooldownChangeDetail detail
            && detail.operation() == SkillEffectCooldownChangeOperation.RESET) {
            forbidValueRule(result, index, issues);
            return;
        }
        if (result.valueRule() == null) {
            issues.add(fieldIssue(resultPath(index, "valueRule"), "REQUIRED", "数值规则不能为空"));
        }
    }

    private void requireValueRule(
        SkillEffectResultRequest result,
        int index,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        SkillEffectValueRuleRequest valueRule = result.valueRule();
        if (valueRule == null) {
            issues.add(fieldIssue(resultPath(index, "valueRule"), "REQUIRED", "数值规则不能为空"));
            return;
        }
        SkillNumericValue value = valueRule.value();
        String formulaKey = value == null ? null : value.formulaKey();
        if (value == null) {
            issues.add(fieldIssue(resultPath(index, "valueRule.value"), "REQUIRED", "公式标识不能为空"));
        } else if (formulaKey != null) {
            refs.formulas.add(new CatalogRef(
                resultPath(index, "valueRule.value"),
                formulaKey,
                true
            ));
            refs.formulaKeys.add(formulaKey);
        }
        if (valueRule.fixedMultiplier() == null) {
            issues.add(fieldIssue(resultPath(index, "valueRule.fixedMultiplier"), "REQUIRED", "固定倍率不能为空"));
        } else if (valueRule.fixedMultiplier().compareTo(BigDecimal.ZERO) < 0) {
            issues.add(fieldIssue(
                resultPath(index, "valueRule.fixedMultiplier"),
                "RANGE_INVALID",
                "固定倍率不能小于0"
            ));
        }
        if (valueRule.fixedMinValue() != null
            && valueRule.fixedMaxValue() != null
            && valueRule.fixedMinValue().compareTo(valueRule.fixedMaxValue()) > 0) {
            issues.add(fieldIssue(
                resultPath(index, "valueRule.fixedMinValue"),
                "RANGE_INVALID",
                "固定最小值不能大于固定最大值"
            ));
        }
    }

    private void forbidValueRule(
        SkillEffectResultRequest result,
        int index,
        List<Map<String, String>> issues
    ) {
        if (result.valueRule() != null) {
            issues.add(fieldIssue(resultPath(index, "valueRule"), "FORBIDDEN", "该结果不能有数值规则"));
        }
    }

    private void lockAndValidateCatalogs(
        String gameId,
        String skillKey,
        String currentEffectKey,
        CollectedRefs refs
    ) {
        Set<String> formulas = lockFormulas(gameId, skillKey, refs.formulaKeys);
        Map<String, String> damageTypes = lockCatalog(refs.damageTypeKeys, keys -> mapper.lockDamageTypes(gameId, keys));
        Map<String, String> attributes = lockCatalog(refs.attributeKeys, keys -> mapper.lockAttributes(gameId, keys));
        Map<String, String> skills = lockCatalog(refs.skillKeys, keys -> mapper.lockSkills(gameId, keys));
        Map<String, String> skillCategories = lockCatalog(
            refs.skillCategoryKeys,
            keys -> mapper.lockSkillCategories(gameId, keys)
        );
        Map<String, String> statuses = new HashMap<>();
        Map<String, StatusKind> statusKinds = new HashMap<>();
        if (!refs.statusKeys.isEmpty()) {
            for (SkillEffectStatusLockRow row : mapper.lockStatuses(gameId, refs.statusKeys)) {
                statuses.put(row.refKey(), row.status());
                statusKinds.put(row.refKey(), row.statusKind());
            }
        }
        Map<String, SkillEffectModifierZoneLockRow> modifierZones = lockModifierZones(
            gameId,
            refs.modifierZoneKeys
        );
        Set<String> runtimeInputFormulaKeys = listRuntimeInputFormulaKeys(
            gameId,
            skillKey,
            refs.dynamicFormulas
        );
        Set<String> targetEffects = lockEffectKeys(gameId, skillKey, targetLockKeys(refs.targetEffectKeys, currentEffectKey));
        Map<String, SkillEffectLifecycleRow> targetLifecycles = lockTargetLifecycles(
            gameId,
            skillKey,
            targetLockKeys(refs.targetEffectKeys, currentEffectKey)
        );

        List<Map<String, String>> unknown = new ArrayList<>();
        addUnknown(unknown, refs.formulas, formulas, "UNKNOWN_FORMULA", "技能公式不存在或不属于当前技能");
        addUnknown(
            unknown,
            refs.interactionFormulas,
            formulas,
            "UNKNOWN_INTERACTION_FORMULA",
            "暴击或吸血公式不存在或不属于当前技能"
        );
        addUnknown(
            unknown,
            refs.lifecycleFormulas,
            formulas,
            "UNKNOWN_LIFECYCLE_FORMULA",
            "生命周期公式不存在或不属于当前技能"
        );
        addUnknown(unknown, refs.damageTypes, damageTypes.keySet(), "UNKNOWN_DAMAGE_TYPE", "伤害类型不存在或不属于当前游戏");
        addUnknown(
            unknown,
            refs.interactionDamageTypes,
            damageTypes.keySet(),
            "UNKNOWN_INTERACTION_DAMAGE_TYPE",
            "护盾吸收伤害类型不存在或不属于当前游戏"
        );
        addUnknown(unknown, refs.attributes, attributes.keySet(), "UNKNOWN_ATTRIBUTE", "属性不存在或不属于当前游戏");
        addUnknown(unknown, refs.skills, skills.keySet(), "UNKNOWN_SKILL", "技能不存在或不属于当前游戏");
        addUnknown(
            unknown,
            refs.skillCategories,
            skillCategories.keySet(),
            "UNKNOWN_SKILL_CATEGORY",
            "技能分类不存在或不属于当前游戏"
        );
        addUnknown(unknown, refs.statuses, statuses.keySet(), "UNKNOWN_STATUS", "状态不存在或不属于当前游戏");
        addModifierZoneReferenceIssues(unknown, refs.modifierZones, modifierZones);
        for (CatalogRef ref : refs.dynamicFormulas) {
            if (runtimeInputFormulaKeys.contains(ref.key())) {
                unknown.add(fieldIssue(
                    ref.path(),
                    "RUNTIME_INPUT_FORBIDDEN",
                    "按当前时点读取的修正公式不能使用动态输入参数"
                ));
            }
        }
        addTargetEffectIssues(unknown, refs.targetEffects, currentEffectKey, targetEffects, targetLifecycles);
        if (!unknown.isEmpty()) {
            unknown.sort(Comparator.comparing(issue -> issue.get("field")));
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_EFFECT_REFERENCE",
                "技能效果引用不合法",
                Map.of("fieldIssues", List.copyOf(unknown))
            );
        }

        validateStatusKinds(refs, statusKinds);
        List<Map<String, String>> disabled = new ArrayList<>();
        addDisabled(disabled, refs.damageTypes, damageTypes, "DAMAGE_TYPE_DISABLED", "不能新增停用伤害类型引用");
        addDisabled(
            disabled,
            refs.interactionDamageTypes,
            damageTypes,
            "DAMAGE_TYPE_DISABLED",
            "不能新增停用伤害类型引用"
        );
        addDisabled(disabled, refs.attributes, attributes, "ATTRIBUTE_DISABLED", "不能新增停用属性引用");
        addDisabled(disabled, refs.skills, skills, "SKILL_DISABLED", "不能新增停用技能引用");
        addDisabled(
            disabled,
            refs.skillCategories,
            skillCategories,
            "SKILL_CATEGORY_DISABLED",
            "不能新增停用技能分类引用"
        );
        addDisabled(disabled, refs.statuses, statuses, "STATUS_DISABLED", "不能新增停用状态引用");
        addDisabledModifierZones(disabled, refs.modifierZones, modifierZones);
        if (!disabled.isEmpty()) {
            disabled.sort(Comparator.comparing(issue -> issue.get("field")));
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.SKILL_EFFECT_REFERENCE_DISABLED",
                "不能新增停用目录引用",
                Map.of("fieldIssues", List.copyOf(disabled), "gameId", gameId)
            );
        }
    }

    private Set<String> lockFormulas(String gameId, String skillKey, Set<String> keys) {
        if (keys.isEmpty()) {
            return Set.of();
        }
        List<String> lockKeys = new ArrayList<>(keys);
        lockKeys.sort(String::compareTo);
        return new HashSet<>(nullToEmpty(mapper.lockFormulas(gameId, skillKey, lockKeys)));
    }

    private Map<String, String> lockCatalog(
        Set<String> keys,
        CatalogLockFunction locker
    ) {
        if (keys.isEmpty()) {
            return Map.of();
        }
        List<String> lockKeys = new ArrayList<>(keys);
        lockKeys.sort(String::compareTo);
        Map<String, String> found = new LinkedHashMap<>();
        for (SkillEffectCatalogLockRow row : nullToEmpty(locker.lock(lockKeys))) {
            found.put(row.refKey(), row.status());
        }
        return found;
    }

    private Map<String, SkillEffectModifierZoneLockRow> lockModifierZones(
        String gameId,
        Set<String> keys
    ) {
        if (keys.isEmpty()) {
            return Map.of();
        }
        List<String> lockKeys = new ArrayList<>(keys);
        lockKeys.sort(String::compareTo);
        Map<String, SkillEffectModifierZoneLockRow> found = new LinkedHashMap<>();
        for (SkillEffectModifierZoneLockRow row : nullToEmpty(mapper.lockModifierZones(gameId, lockKeys))) {
            found.put(row.modifierZoneKey(), row);
        }
        return found;
    }

    private Set<String> listRuntimeInputFormulaKeys(
        String gameId,
        String skillKey,
        List<CatalogRef> refs
    ) {
        if (refs.isEmpty()) {
            return Set.of();
        }
        List<String> keys = refs.stream()
            .map(CatalogRef::key)
            .distinct()
            .sorted()
            .toList();
        return new HashSet<>(nullToEmpty(mapper.listRuntimeInputFormulaKeys(gameId, skillKey, keys)));
    }

    private Map<String, RetainedCatalog> loadRetainedCatalog(List<SkillEffectResultRequest> results) {
        Map<String, RetainedCatalog> retained = new HashMap<>();
        for (SkillEffectResultRequest result : results) {
            var detail = AggregateJson.tree(AggregateJson.write(result.detail()));
            Set<String> damageTypes = new LinkedHashSet<>();
            Set<String> attributes = new LinkedHashSet<>();
            for (String field : List.of("damageTypeKey", "absorbedDamageTypeKey")) {
                if (detail.hasNonNull(field)) damageTypes.add(detail.get(field).asText());
            }
            if (detail.hasNonNull("attributeKey")) attributes.add(detail.get("attributeKey").asText());
            if (detail.path("condition").hasNonNull("attributeKey")) {
                attributes.add(detail.path("condition").get("attributeKey").asText());
            }
            var scope = detail.path("affectedSkillScope");
            Set<String> skills = new LinkedHashSet<>();
            Set<String> categories = new LinkedHashSet<>();
            scope.path("skillKeys").forEach(value -> skills.add(value.asText()));
            scope.path("skillCategoryKeys").forEach(value -> categories.add(value.asText()));
            retained.put(result.resultKey(), new RetainedCatalog(
                Set.copyOf(damageTypes), Set.copyOf(attributes),
                Set.copyOf(skills), Set.copyOf(categories),
                detail.hasNonNull("statusKey") ? detail.get("statusKey").asText() : null,
                detail.hasNonNull("modifierZoneKey") ? detail.get("modifierZoneKey").asText() : null
            ));
        }
        return retained;
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

    private static Map<String, SkillEffectResultRow> indexExistingResults(List<SkillEffectResultRow> rows) {
        Map<String, SkillEffectResultRow> indexed = new LinkedHashMap<>();
        for (SkillEffectResultRow row : rows) {
            indexed.put(row.resultKey(), row);
        }
        return indexed;
    }

    private static boolean isRetained(
        Map<String, RetainedCatalog> retained,
        String resultKey,
        CatalogKind kind,
        String value
    ) {
        if (resultKey == null || retained == null) {
            return false;
        }
        RetainedCatalog catalog = retained.get(resultKey);
        if (catalog == null) {
            return false;
        }
        return switch (kind) {
            case DAMAGE_TYPE -> catalog.damageTypeKeys().contains(value);
            case ATTRIBUTE -> catalog.attributeKeys().contains(value);
            case SKILL -> catalog.affectedSkillKeys().contains(value);
            case SKILL_CATEGORY -> catalog.skillCategoryKeys().contains(value);
            case STATUS -> Objects.equals(catalog.statusKey(), value);
            case MODIFIER_ZONE -> Objects.equals(catalog.modifierZoneKey(), value);
        };
    }

    private static void addUnknown(
        List<Map<String, String>> issues,
        List<CatalogRef> refs,
        Set<String> found,
        String code,
        String message
    ) {
        for (CatalogRef ref : refs) {
            if (!found.contains(ref.key())) {
                issues.add(fieldIssue(ref.path(), code, message));
            }
        }
    }

    private static void addDisabled(
        List<Map<String, String>> issues,
        List<CatalogRef> refs,
        Map<String, String> statusByKey,
        String code,
        String message
    ) {
        Set<String> reported = new HashSet<>();
        for (CatalogRef ref : refs) {
            if (ref.retainedOrExempt() || !reported.add(ref.path())) {
                continue;
            }
            if (DISABLED.equals(statusByKey.get(ref.key()))) {
                issues.add(fieldIssue(ref.path(), code, message));
            }
        }
    }

    private static void addModifierZoneReferenceIssues(
        List<Map<String, String>> issues,
        List<ModifierZoneRef> refs,
        Map<String, SkillEffectModifierZoneLockRow> zones
    ) {
        for (ModifierZoneRef ref : refs) {
            SkillEffectModifierZoneLockRow zone = zones.get(ref.key());
            if (zone == null) {
                issues.add(fieldIssue(ref.path(), "UNKNOWN_MODIFIER_ZONE", "乘区不存在或不属于当前游戏"));
            } else if (zone.domain() != ref.expectedDomain()) {
                issues.add(fieldIssue(ref.path(), "MODIFIER_ZONE_DOMAIN_MISMATCH", "乘区作用域与结果种类不一致"));
            } else {
                if (ref.conditioned() && zone.applicationStage() != ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE) {
                    issues.add(fieldIssue(ref.path(), "MODIFIER_ZONE_STAGE_INVALID", "逐笔生命门槛只支持防御前伤害乘区"));
                }
                HealingRatioMaxSemantics.addReferenceIssues(
                    zone.calculationMode(),
                    ref.resultType(),
                    ref.direction(),
                    ref.operation(),
                    ref.path(),
                    ref.resultPrefix() + ".detail.direction",
                    ref.resultPrefix() + ".detail.operation",
                    issues
                );
            }
        }
    }

    private static void addDisabledModifierZones(
        List<Map<String, String>> issues,
        List<ModifierZoneRef> refs,
        Map<String, SkillEffectModifierZoneLockRow> zones
    ) {
        Set<String> reported = new HashSet<>();
        for (ModifierZoneRef ref : refs) {
            if (ref.retainedOrExempt() || !reported.add(ref.path())) {
                continue;
            }
            SkillEffectModifierZoneLockRow zone = zones.get(ref.key());
            if (zone != null && zone.status() == ModifierZoneStatus.DISABLED) {
                issues.add(fieldIssue(ref.path(), "MODIFIER_ZONE_DISABLED", "不能新增停用乘区引用"));
            }
        }
    }

    private static String resultPath(int index, String suffix) {
        if (suffix == null || suffix.isEmpty()) {
            return "results[" + index + "]";
        }
        return "results[" + index + "]." + suffix;
    }

    private static String enumName(Enum<?> value) {
        return value == null ? null : value.name();
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能效果不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static void throwIfInvalidBody(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_BODY",
                "技能效果结果明细不合法",
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

    private static ApiException effectNotFound(String effectKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_EFFECT_NOT_FOUND",
            "技能效果不存在",
            Map.of("effectKey", effectKey == null ? "" : effectKey)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.SKILL_EFFECT_KEY_EXISTS", "技能效果标识已存在", "effectKey");
    }

    private static ApiException effectInUse() {
        return effectInUse(List.of(fieldIssue(
            "effectKey",
            "CONFLICT",
            "技能效果已被过程挂接引用，不能删除"
        )));
    }

    private static ApiException effectInUse(List<Map<String, String>> fieldIssues) {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_EFFECT_IN_USE",
            "技能效果已被引用，不能删除或修改",
            Map.of("fieldIssues", List.copyOf(fieldIssues))
        );
    }

    private static ApiException lifecycleInUse() {
        return conflict(
            "409.SKILL_EFFECT_LIFECYCLE_IN_USE",
            "技能效果生命周期仍被生命周期操作引用，不能删除或移除",
            "effectKey"
        );
    }

    private static ApiException refreshInUse() {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_EFFECT_LIFECYCLE_IN_USE",
            "目标生命周期仍被刷新操作引用，不能清空持续时间",
            Map.of(
                "fieldIssues",
                List.of(fieldIssue(
                    "lifecycle.durationValue",
                    "REFRESH_OPERATION_IN_USE",
                    "目标生命周期仍被刷新操作引用，不能清空持续时间"
                ))
            )
        );
    }

    private static ApiException extendDurationInUse(String field, String message) {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_EFFECT_LIFECYCLE_IN_USE",
            message,
            Map.of(
                "fieldIssues",
                List.of(fieldIssue(field, "EXTEND_DURATION_OPERATION_IN_USE", message))
            )
        );
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of("fieldIssues", List.of(fieldIssue(field, "CONFLICT", message)))
        );
    }

    private ApiException corrupt(
        String gameId,
        String skillKey,
        String effectKey,
        String resultKey,
        String reason
    ) {
        log.error(
            "Skill effect data corruption detected. gameId={}, skillKey={}, effectKey={}, resultKey={}, reason={}",
            gameId,
            skillKey,
            effectKey,
            resultKey,
            reason
        );
        return new ApiException(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "500.INTERNAL_ERROR",
            "技能效果数据损坏",
            Map.of(
                "gameId", gameId,
                "skillKey", skillKey,
                "effectKey", effectKey,
                "resultKey", resultKey == null ? "" : resultKey,
                "reason", reason
            )
        );
    }

    private static RuntimeException mapWriteConstraint(
        DataIntegrityViolationException ex,
        boolean deletingOrRemovingLifecycle,
        boolean clearingDuration
    ) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
        }
        if (text.contains(PROCESS_BINDING_CONSTRAINT)) {
            return effectInUse();
        }
        for (String constraint : TRIGGER_EFFECT_IN_USE_CONSTRAINTS) {
            if (text.contains(constraint)) {
                return effectInUse();
            }
        }
        if (text.contains(LIFECYCLE_TARGET_CONSTRAINT)) {
            if (deletingOrRemovingLifecycle) {
                return lifecycleInUse();
            }
            return new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_EFFECT_REFERENCE",
                "技能效果引用不合法",
                Map.of(
                    "fieldIssues",
                    List.of(fieldIssue(
                        "results.detail.targetEffectKey",
                        "UNKNOWN_LIFECYCLE_EFFECT",
                        "目标效果不存在或没有生命周期"
                    ))
                )
            );
        }
        if (text.contains(REFRESH_DURATION_CONSTRAINT)) {
            if (clearingDuration) {
                return refreshInUse();
            }
            return new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_EFFECT_REFERENCE",
                "技能效果引用不合法",
                Map.of(
                    "fieldIssues",
                    List.of(fieldIssue(
                        "results.detail.targetEffectKey",
                        "TARGET_EFFECT_HAS_NO_DURATION",
                        "刷新目标没有自然到期"
                    ))
                )
            );
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
        return Map.of("field", field, "code", code, "message", message);
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private static Set<String> nullToEmptySet(Set<String> values) {
        return values == null ? Set.of() : values;
    }

    private static Set<String> targetLockKeys(Set<String> keys, String currentEffectKey) {
        if (keys.isEmpty()) {
            return keys;
        }
        LinkedHashSet<String> filtered = new LinkedHashSet<>(keys);
        if (currentEffectKey != null) {
            filtered.remove(currentEffectKey);
        }
        return filtered;
    }

    private Set<String> lockEffectKeys(String gameId, String skillKey, Set<String> keys) {
        if (keys.isEmpty()) {
            return Set.of();
        }
        List<String> lockKeys = new ArrayList<>(keys);
        lockKeys.sort(String::compareTo);
        return new HashSet<>(nullToEmpty(mapper.lockEffects(gameId, skillKey, lockKeys)));
    }

    private Map<String, SkillEffectLifecycleRow> lockTargetLifecycles(
        String gameId,
        String skillKey,
        Set<String> keys
    ) {
        if (keys.isEmpty()) {
            return Map.of();
        }
        List<String> lockKeys = new ArrayList<>(keys);
        lockKeys.sort(String::compareTo);
        Map<String, SkillEffectLifecycleRow> found = new LinkedHashMap<>();
        for (SkillEffectLifecycleRow row : nullToEmpty(mapper.lockLifecycles(gameId, skillKey, lockKeys))) {
            found.put(row.effectKey(), row);
        }
        return found;
    }

    private static void addTargetEffectIssues(
        List<Map<String, String>> issues,
        List<TargetEffectRef> refs,
        String currentEffectKey,
        Set<String> existingEffects,
        Map<String, SkillEffectLifecycleRow> lifecycles
    ) {
        for (TargetEffectRef ref : refs) {
            if (ref.selfReference() || (currentEffectKey != null && currentEffectKey.equals(ref.key()))) {
                issues.add(fieldIssue(ref.path(), "SELF_LIFECYCLE_REFERENCE", "不能引用所属效果自身"));
                continue;
            }
            if (!existingEffects.contains(ref.key())) {
                issues.add(fieldIssue(ref.path(), "UNKNOWN_LIFECYCLE_EFFECT", "目标效果不存在或不属于当前技能"));
                continue;
            }
            SkillEffectLifecycleRow lifecycle = lifecycles.get(ref.key());
            if (lifecycle == null) {
                issues.add(fieldIssue(ref.path(), "TARGET_EFFECT_HAS_NO_LIFECYCLE", "目标效果没有生命周期"));
                continue;
            }
            if (ref.refresh() && lifecycle.durationValue() == null) {
                issues.add(fieldIssue(ref.path(), "TARGET_EFFECT_HAS_NO_DURATION", "刷新目标没有自然到期"));
            }
            if (ref.extendDuration()) {
                if (lifecycle.durationValue() == null) {
                    issues.add(fieldIssue(
                        ref.path(),
                        "TARGET_EFFECT_HAS_NO_DURATION",
                        "延长剩余时长目标没有自然到期"
                    ));
                }
                if (lifecycle.expiryMode() != SkillEffectLifecycleExpiryMode.ALL_AT_ONCE) {
                    issues.add(fieldIssue(
                        ref.path(),
                        "TARGET_EFFECT_EXPIRY_MODE_UNSUPPORTED",
                        "延长剩余时长只允许全部层统一到期"
                    ));
                }
            }
        }
    }

    private record ValidatedEffect(
        String effectKey,
        String name,
        String description,
        Integer sortOrder,
        SkillEffectLifecycleRequest lifecycle,
        List<SkillEffectResultRequest> results
    ) {
    }

    private static final class CollectedRefs {
        private SkillEffectLifecycleRequest lifecycle;
        private final Map<Integer, SkillEffectResultRequest> statusResults = new LinkedHashMap<>();
        private final List<CatalogRef> formulas = new ArrayList<>();
        private final List<CatalogRef> dynamicFormulas = new ArrayList<>();
        private final List<CatalogRef> interactionFormulas = new ArrayList<>();
        private final List<CatalogRef> lifecycleFormulas = new ArrayList<>();
        private final List<CatalogRef> damageTypes = new ArrayList<>();
        private final List<CatalogRef> interactionDamageTypes = new ArrayList<>();
        private final List<CatalogRef> attributes = new ArrayList<>();
        private final List<CatalogRef> skills = new ArrayList<>();
        private final List<CatalogRef> skillCategories = new ArrayList<>();
        private final List<CatalogRef> statuses = new ArrayList<>();
        private final List<ModifierZoneRef> modifierZones = new ArrayList<>();
        private final List<TargetEffectRef> targetEffects = new ArrayList<>();
        private final LinkedHashSet<String> formulaKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> damageTypeKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> attributeKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> skillKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> skillCategoryKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> statusKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> modifierZoneKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> targetEffectKeys = new LinkedHashSet<>();
    }

    private record CatalogRef(String path, String key, boolean retainedOrExempt) {
    }

    private record ModifierZoneRef(
        String path,
        String key,
        ModifierZoneDomain expectedDomain,
        boolean retainedOrExempt,
        String resultPrefix,
        String resultType,
        String direction,
        String operation,
        boolean conditioned
    ) {
    }

    private record TargetEffectRef(
        String path,
        String key,
        boolean refresh,
        boolean extendDuration,
        boolean selfReference
    ) {
    }

    private record RetainedCatalog(
        Set<String> damageTypeKeys,
        Set<String> attributeKeys,
        Set<String> affectedSkillKeys,
        Set<String> skillCategoryKeys,
        String statusKey,
        String modifierZoneKey
    ) {
    }

    private enum CatalogKind {
        DAMAGE_TYPE,
        ATTRIBUTE,
        SKILL,
        SKILL_CATEGORY,
        STATUS,
        MODIFIER_ZONE
    }

    @FunctionalInterface
    private interface CatalogLockFunction {
        List<SkillEffectCatalogLockRow> lock(List<String> keys);
    }
}
