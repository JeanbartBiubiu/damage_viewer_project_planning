package xyz.game.datamanage.service.skilleffect;

import jakarta.validation.Valid;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCatalogLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCooldownChangeTargetRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicy;
import xyz.game.datamanage.model.skilleffect.SkillEffectCriticalPolicyRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageImmunityDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageImmunityDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageOriginKind;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectDirectHealDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealingModifierDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealthFloorDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectHealthFloorDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectExecuteDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectExecuteDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectHitLinkApplicationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttackLinkApplicationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectModifierZoneLockRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleExpiryMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleInstanceScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleOperationDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationDurationMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleReapplicationValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleStackValueMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleValueReadMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDecayMode;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldInteractionRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultLifecycleBehaviorRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultValueRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperation;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldBlockScope;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectSpellShieldPolicyRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampRule;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampRuleRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectVampType;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillEffectService {

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

    public SkillEffectService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillEffectMapper mapper
    ) {
        this(gamesMapper, skillMapper, mapper, null);
    }

    @Autowired
    public SkillEffectService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillEffectMapper mapper,
        SkillTriggerRuleService triggerRuleService
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;
        this.triggerRuleService = triggerRuleService;
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
                values.sortOrder()
            );
            insertLifecycleIfPresent(gameId, skillKey, values.effectKey(), values.lifecycle());
            insertResults(gameId, skillKey, values.effectKey(), values.results());
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
        requireGame(gameId);
        ValidatedEffect values = validateUpdate(request, effectKey);
        lockParentSkill(gameId, skillKey);
        if (mapper.findEffectForUpdate(gameId, skillKey, effectKey) == null) {
            throw effectNotFound(effectKey);
        }
        List<SkillEffectResultRow> existingRows = nullToEmpty(
            mapper.listResultsForUpdate(gameId, skillKey, effectKey)
        );
        SkillEffectLifecycleRow existingLifecycle = mapper.findLifecycleForUpdate(gameId, skillKey, effectKey);
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
        if (existingLifecycle != null && values.lifecycle() == null
            && mapper.countLifecycleOperationReferences(gameId, skillKey, effectKey) > 0) {
            throw lifecycleInUse();
        }
        boolean clearingDuration = existingLifecycle != null
            && existingLifecycle.durationFormulaKey() != null
            && (values.lifecycle() == null || values.lifecycle().durationFormulaKey() == null);
        if (clearingDuration
            && mapper.countRefreshOperationReferences(gameId, skillKey, effectKey) > 0) {
            throw refreshInUse();
        }

        ExistingCatalog existingCatalog = loadExistingCatalog(gameId, skillKey, effectKey, existingRows);
        CollectedRefs refs = collectAndValidateResults(
            values.lifecycle(),
            values.results(),
            existingCatalog.retained,
            skillKey,
            effectKey,
            existingLifecycle == null ? null : existingLifecycle.instanceScope()
        );
        lockAndValidateCatalogs(gameId, skillKey, effectKey, refs);

        try {
            persistLifecycle(gameId, skillKey, effectKey, existingLifecycle, values.lifecycle());
            if (!removedKeys.isEmpty()) {
                mapper.deleteLifecycleBehaviors(gameId, skillKey, effectKey, removedKeys);
                mapper.deleteLifecycleOperationDetails(gameId, skillKey, effectKey, removedKeys);
                mapper.deleteResults(gameId, skillKey, effectKey, removedKeys);
            }
            Set<String> existingBehaviorKeys = existingCatalog.behaviors.keySet();
            for (SkillEffectResultRequest result : values.results()) {
                if (existingByKey.containsKey(result.resultKey())) {
                    updateResultAggregate(
                        gameId,
                        skillKey,
                        effectKey,
                        result,
                        existingCatalog.values.containsKey(result.resultKey()),
                        existingBehaviorKeys.contains(result.resultKey()),
                        existingCatalog.spellShieldPolicies.containsKey(result.resultKey())
                    );
                } else {
                    insertResultAggregate(gameId, skillKey, effectKey, result);
                }
            }
            if (mapper.updateEffect(
                gameId,
                skillKey,
                effectKey,
                values.name(),
                values.description(),
                values.sortOrder()
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
    }

    private SkillEffectDetailResponse requireDetail(String gameId, String skillKey, String effectKey) {
        SkillEffectRow effect = mapper.findEffect(gameId, skillKey, effectKey);
        if (effect == null) {
            throw effectNotFound(effectKey);
        }
        return assembleDetail(effect);
    }

    private SkillEffectDetailResponse assembleDetail(SkillEffectRow effect) {
        String gameId = effect.gameId();
        String skillKey = effect.skillKey();
        String effectKey = effect.effectKey();
        List<SkillEffectResultRow> results = nullToEmpty(mapper.listResults(gameId, skillKey, effectKey));
        Map<String, SkillEffectResultValueRow> values = indexValues(
            gameId,
            skillKey,
            effectKey,
            mapper.listValues(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectDamageDetailRow> damage = indexDamage(
            gameId,
            skillKey,
            effectKey,
            mapper.listDamageDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectSpellShieldPolicyRow> spellShieldPolicies = indexSpellShieldPolicies(
            gameId,
            skillKey,
            effectKey,
            mapper.listSpellShieldPolicies(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectCriticalPolicyRow> criticalPolicies = indexCriticalPolicies(
            gameId,
            skillKey,
            effectKey,
            mapper.listCriticalPolicies(gameId, skillKey, effectKey)
        );
        Map<String, List<SkillEffectVampRuleRow>> vampRules = indexVampRules(
            gameId,
            skillKey,
            effectKey,
            mapper.listVampRules(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectNormalShieldInteractionRow> normalShields = indexNormalShieldInteractions(
            gameId,
            skillKey,
            effectKey,
            mapper.listNormalShieldInteractions(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectDamageModifierDetailRow> damageModifiers = indexDamageModifiers(
            gameId, skillKey, effectKey, mapper.listDamageModifierDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectHealingModifierDetailRow> healingModifiers = indexHealingModifiers(
            gameId, skillKey, effectKey, mapper.listHealingModifierDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectDamageImmunityDetailRow> damageImmunities = indexDamageImmunities(
            gameId, skillKey, effectKey, mapper.listDamageImmunityDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectHealthFloorDetailRow> healthFloors = indexHealthFloors(
            gameId, skillKey, effectKey, mapper.listHealthFloorDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectExecuteDetailRow> executes = indexExecuteDetails(
            gameId, skillKey, effectKey, mapper.listExecuteDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectAttributeChangeDetailRow> attributes = indexAttributeChange(
            gameId,
            skillKey,
            effectKey,
            mapper.listAttributeChangeDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectResourceChangeDetailRow> resources = indexResourceChange(
            gameId,
            skillKey,
            effectKey,
            mapper.listResourceChangeDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectCooldownChangeDetailRow> cooldowns = indexCooldownChange(
            gameId,
            skillKey,
            effectKey,
            mapper.listCooldownChangeDetails(gameId, skillKey, effectKey)
        );
        Map<String, List<String>> cooldownTargets = indexCooldownChangeTargets(
            mapper.listCooldownChangeTargets(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectStatusOperationDetailRow> statuses = indexStatusOperation(
            gameId,
            skillKey,
            effectKey,
            mapper.listStatusOperationDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectLifecycleOperationDetailRow> operations = indexLifecycleOperations(
            gameId,
            skillKey,
            effectKey,
            mapper.listLifecycleOperationDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectResultLifecycleBehaviorRow> behaviors = indexLifecycleBehaviors(
            gameId,
            skillKey,
            effectKey,
            mapper.listLifecycleBehaviors(gameId, skillKey, effectKey)
        );
        SkillEffectLifecycleRow lifecycleRow = mapper.findLifecycle(gameId, skillKey, effectKey);

        List<SkillEffectResultResponse> assembled = new ArrayList<>(results.size());
        for (SkillEffectResultRow result : results) {
            assembled.add(assembleResult(
                gameId,
                skillKey,
                effectKey,
                result,
                values,
                damage,
                spellShieldPolicies,
                criticalPolicies,
                vampRules,
                normalShields,
                damageModifiers,
                healingModifiers,
                damageImmunities,
                healthFloors,
                executes,
                attributes,
                resources,
                cooldowns,
                cooldownTargets,
                statuses,
                operations,
                behaviors
            ));
        }
        return new SkillEffectDetailResponse(
            effect.gameId(),
            effect.skillKey(),
            effect.effectKey(),
            effect.name(),
            effect.description(),
            effect.sortOrder(),
            toLifecycleResponse(lifecycleRow),
            List.copyOf(assembled),
            effect.createdAt(),
            effect.updatedAt()
        );
    }

    private SkillEffectResultResponse assembleResult(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRow result,
        Map<String, SkillEffectResultValueRow> values,
        Map<String, SkillEffectDamageDetailRow> damage,
        Map<String, SkillEffectSpellShieldPolicyRow> spellShieldPolicies,
        Map<String, SkillEffectCriticalPolicyRow> criticalPolicies,
        Map<String, List<SkillEffectVampRuleRow>> vampRules,
        Map<String, SkillEffectNormalShieldInteractionRow> normalShields,
        Map<String, SkillEffectDamageModifierDetailRow> damageModifiers,
        Map<String, SkillEffectHealingModifierDetailRow> healingModifiers,
        Map<String, SkillEffectDamageImmunityDetailRow> damageImmunities,
        Map<String, SkillEffectHealthFloorDetailRow> healthFloors,
        Map<String, SkillEffectExecuteDetailRow> executes,
        Map<String, SkillEffectAttributeChangeDetailRow> attributes,
        Map<String, SkillEffectResourceChangeDetailRow> resources,
        Map<String, SkillEffectCooldownChangeDetailRow> cooldowns,
        Map<String, List<String>> cooldownTargets,
        Map<String, SkillEffectStatusOperationDetailRow> statuses,
        Map<String, SkillEffectLifecycleOperationDetailRow> operations,
        Map<String, SkillEffectResultLifecycleBehaviorRow> behaviors
    ) {
        String resultKey = result.resultKey();
        SkillEffectResultValueRow value = values.get(resultKey);
        SkillEffectDamageDetailRow damageRow = damage.get(resultKey);
        SkillEffectSpellShieldPolicyRow spellShieldPolicy = spellShieldPolicies.get(resultKey);
        SkillEffectCriticalPolicyRow criticalRow = criticalPolicies.get(resultKey);
        List<SkillEffectVampRuleRow> vampRows = vampRules.getOrDefault(resultKey, List.of());
        SkillEffectNormalShieldInteractionRow normalShieldRow = normalShields.get(resultKey);
        SkillEffectDamageModifierDetailRow damageModifierRow = damageModifiers.get(resultKey);
        SkillEffectHealingModifierDetailRow healingModifierRow = healingModifiers.get(resultKey);
        SkillEffectDamageImmunityDetailRow damageImmunityRow = damageImmunities.get(resultKey);
        SkillEffectHealthFloorDetailRow healthFloorRow = healthFloors.get(resultKey);
        SkillEffectExecuteDetailRow executeRow = executes.get(resultKey);
        SkillEffectAttributeChangeDetailRow attributeRow = attributes.get(resultKey);
        SkillEffectResourceChangeDetailRow resourceRow = resources.get(resultKey);
        SkillEffectCooldownChangeDetailRow cooldownRow = cooldowns.get(resultKey);
        List<String> affectedSkillKeys = cooldownTargets.getOrDefault(resultKey, List.of());
        SkillEffectStatusOperationDetailRow statusRow = statuses.get(resultKey);
        SkillEffectLifecycleOperationDetailRow operationRow = operations.get(resultKey);
        int extraDetails = countPresent(
            damageRow,
            normalShieldRow,
            damageModifierRow,
            healingModifierRow,
            damageImmunityRow,
            healthFloorRow,
            executeRow,
            attributeRow,
            resourceRow,
            cooldownRow,
            statusRow,
            operationRow
        );
        SkillEffectResultType type = result.resultType();
        if (type == null) {
            throw corrupt(gameId, skillKey, effectKey, resultKey, "结果种类缺失");
        }
        if (type != SkillEffectResultType.DAMAGE && (criticalRow != null || !vampRows.isEmpty())) {
            throw corrupt(gameId, skillKey, effectKey, resultKey, "非伤害结果存在暴击或吸血明细");
        }
        AssembledResultPayload payload = switch (type) {
            case DAMAGE -> {
                if (value == null || damageRow == null || criticalRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "伤害结果形状损坏");
                }
                List<SkillEffectVampRule> assembledVampRules = vampRows.stream()
                    .map(row -> new SkillEffectVampRule(
                        row.vampType(),
                        row.basisOutputKind(),
                        row.efficiencyFormulaKey()
                    ))
                    .toList();
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectDamageDetail(
                        damageRow.damageTypeKey(),
                        damageRow.deliveryKind(),
                        damageRow.originKind(),
                        new SkillEffectCriticalPolicy(
                            criticalRow.criticalMode(),
                            criticalRow.multiplierFormulaKey()
                        ),
                        assembledVampRules
                    )
                );
            }
            case DIRECT_HEAL -> {
                if (value == null || extraDetails != 0) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "直接治疗结果形状损坏");
                }
                yield new AssembledResultPayload(toValueRule(value), new SkillEffectDirectHealDetail());
            }
            case NORMAL_SHIELD -> {
                if (value == null || normalShieldRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "普通护盾结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectNormalShieldDetail(
                        normalShieldRow.absorbedDamageTypeKey(),
                        normalShieldRow.decayMode()
                    )
                );
            }
            case ATTRIBUTE_CHANGE -> {
                if (value == null || attributeRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "属性变化结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectAttributeChangeDetail(
                        attributeRow.attributeKey(),
                        attributeRow.operation(),
                        attributeRow.modifierZoneKey()
                    )
                );
            }
            case RESOURCE_CHANGE -> {
                if (value == null || resourceRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "资源变化结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectResourceChangeDetail(
                        resourceRow.attributeKey(),
                        resourceRow.operation()
                    )
                );
            }
            case COOLDOWN_CHANGE -> {
                if (cooldownRow == null || affectedSkillKeys.isEmpty() || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "冷却变化结果形状损坏");
                }
                SkillEffectCooldownChangeOperation operation = cooldownRow.operation();
                if (operation == SkillEffectCooldownChangeOperation.RESET) {
                    if (value != null) {
                        throw corrupt(gameId, skillKey, effectKey, resultKey, "冷却重置不得有数值规则");
                    }
                    yield new AssembledResultPayload(
                        null,
                        new SkillEffectCooldownChangeDetail(affectedSkillKeys, operation)
                    );
                }
                if (operation == SkillEffectCooldownChangeOperation.REDUCE
                    || operation == SkillEffectCooldownChangeOperation.INCREASE) {
                    if (value == null) {
                        throw corrupt(gameId, skillKey, effectKey, resultKey, "冷却增减缺少数值规则");
                    }
                    yield new AssembledResultPayload(
                        toValueRule(value),
                        new SkillEffectCooldownChangeDetail(affectedSkillKeys, operation)
                    );
                }
                throw corrupt(gameId, skillKey, effectKey, resultKey, "冷却变化操作损坏");
            }
            case STATUS_OPERATION -> {
                if (value != null || statusRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "状态操作结果形状损坏");
                }
                yield new AssembledResultPayload(
                    null,
                    new SkillEffectStatusOperationDetail(statusRow.statusKey(), statusRow.operation())
                );
            }
            case LIFECYCLE_OPERATION -> {
                if (operationRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "生命周期操作结果形状损坏");
                }
                SkillEffectLifecycleOperation operation = operationRow.operation();
                if (operation == SkillEffectLifecycleOperation.REFRESH
                    || operation == SkillEffectLifecycleOperation.REMOVE) {
                    if (value != null) {
                        throw corrupt(gameId, skillKey, effectKey, resultKey, "刷新或移除不得有数值规则");
                    }
                    yield new AssembledResultPayload(
                        null,
                        new SkillEffectLifecycleOperationDetail(operationRow.targetEffectKey(), operation)
                    );
                }
                if (operation == SkillEffectLifecycleOperation.INCREASE
                    || operation == SkillEffectLifecycleOperation.DECREASE
                    || operation == SkillEffectLifecycleOperation.SET
                    || operation == SkillEffectLifecycleOperation.CONSUME) {
                    if (value == null) {
                        throw corrupt(gameId, skillKey, effectKey, resultKey, "生命周期层数操作缺少数值规则");
                    }
                    yield new AssembledResultPayload(
                        toValueRule(value),
                        new SkillEffectLifecycleOperationDetail(operationRow.targetEffectKey(), operation)
                    );
                }
                throw corrupt(gameId, skillKey, effectKey, resultKey, "生命周期操作损坏");
            }
            case DAMAGE_MODIFIER -> {
                if (value == null || damageModifierRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "伤害修正结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectDamageModifierDetail(
                        damageModifierRow.modifierZoneKey(),
                        damageModifierRow.direction(),
                        damageModifierRow.operation(),
                        damageModifierRow.damageTypeKey(),
                        damageModifierRow.deliveryKind(),
                        damageModifierRow.originKind(),
                        damageModifierRow.criticalFilter()
                    )
                );
            }
            case HEALING_MODIFIER -> {
                if (value == null || healingModifierRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "治疗修正结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectHealingModifierDetail(
                        healingModifierRow.modifierZoneKey(),
                        healingModifierRow.direction(),
                        healingModifierRow.operation(),
                        healingModifierRow.healingKind()
                    )
                );
            }
            case DAMAGE_IMMUNITY -> {
                if (value != null || damageImmunityRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "伤害免疫结果形状损坏");
                }
                yield new AssembledResultPayload(
                    null,
                    new SkillEffectDamageImmunityDetail(
                        damageImmunityRow.damageTypeKey(),
                        damageImmunityRow.deliveryKind(),
                        damageImmunityRow.originKind()
                    )
                );
            }
            case HEALTH_FLOOR -> {
                if (value == null || healthFloorRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "生命下限结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectHealthFloorDetail(healthFloorRow.attributeKey())
                );
            }
            case SPELL_SHIELD -> {
                if (value != null || extraDetails != 0) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "法术护盾结果形状损坏");
                }
                yield new AssembledResultPayload(null, new SkillEffectSpellShieldDetail());
            }
            case EXECUTE -> {
                if (value == null || executeRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "斩杀结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectExecuteDetail(executeRow.attributeKey())
                );
            }
            case HIT_LINK_APPLICATION -> {
                if (value == null || extraDetails != 0) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "命中联动应用结果形状损坏");
                }
                yield new AssembledResultPayload(toValueRule(value), new SkillEffectHitLinkApplicationDetail());
            }
            case ATTACK_LINK_APPLICATION -> {
                if (value == null || extraDetails != 0) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "攻击联动应用结果形状损坏");
                }
                yield new AssembledResultPayload(toValueRule(value), new SkillEffectAttackLinkApplicationDetail());
            }
        };
        SkillEffectResultLifecycleBehaviorRow behavior = behaviors.get(resultKey);
        SkillEffectSpellShieldBlockScope blockScope = spellShieldPolicy == null
            ? null
            : spellShieldPolicy.blockScope();
        if (!isSpellShieldBlockScopeAllowed(result.resultType(), result.target(), behavior, blockScope)) {
            throw corrupt(gameId, skillKey, effectKey, resultKey, "法术护盾阻挡粒度形状损坏");
        }
        return new SkillEffectResultResponse(
            result.resultKey(),
            result.name(),
            result.resultType(),
            result.target(),
            result.description(),
            result.sortOrder(),
            payload.valueRule(),
            payload.detail(),
            toBehaviorResponse(behavior),
            blockScope
        );
    }

    private ValidatedEffect validateCreate(SkillEffectCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能效果不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        return new ValidatedEffect(
            request.effectKey(),
            request.name(),
            request.description(),
            request.sortOrder(),
            request.lifecycle(),
            request.results() == null ? List.of() : List.copyOf(request.results())
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
        throwIfInvalid(issues);
        return new ValidatedEffect(
            pathKey,
            request.name(),
            request.description(),
            request.sortOrder(),
            request.lifecycle(),
            request.results() == null ? List.of() : List.copyOf(request.results())
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
        if (results == null || results.isEmpty()) {
            issues.add(fieldIssue("results", "REQUIRED", "效果至少包含一个结果"));
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
            case DAMAGE_IMMUNITY -> validateDamageImmunity(result, index, retained, refs, issues);
            case HEALTH_FLOOR -> validateHealthFloor(result, index, retained, refs, issues);
            case SPELL_SHIELD -> validateSpellShield(result, index, issues);
            case EXECUTE -> validateExecute(result, index, retained, refs, issues);
            case HIT_LINK_APPLICATION -> validateHitLinkApplication(result, index, refs, issues);
            case ATTACK_LINK_APPLICATION -> validateAttackLinkApplication(result, index, refs, issues);
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
        if (result.target() != xyz.game.datamanage.model.skilleffect.SkillEffectTarget.TARGET
            || persistent
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

    private static boolean isSpellShieldBlockScopeAllowed(
        SkillEffectResultType resultType,
        xyz.game.datamanage.model.skilleffect.SkillEffectTarget target,
        SkillEffectResultLifecycleBehaviorRow behavior,
        SkillEffectSpellShieldBlockScope scope
    ) {
        if (scope == null) {
            return true;
        }
        if (target != xyz.game.datamanage.model.skilleffect.SkillEffectTarget.TARGET
            || (behavior != null && behavior.moment() == SkillEffectLifecycleMoment.PERSISTENT)) {
            return false;
        }
        if (resultType == SkillEffectResultType.DAMAGE) {
            return true;
        }
        return scope != SkillEffectSpellShieldBlockScope.DAMAGE_INSTANCE
            && (resultType == SkillEffectResultType.ATTRIBUTE_CHANGE
                || resultType == SkillEffectResultType.RESOURCE_CHANGE
                || resultType == SkillEffectResultType.COOLDOWN_CHANGE
                || resultType == SkillEffectResultType.STATUS_OPERATION
                || resultType == SkillEffectResultType.LIFECYCLE_OPERATION
                || resultType == SkillEffectResultType.EXECUTE
                || resultType == SkillEffectResultType.HIT_LINK_APPLICATION
                || resultType == SkillEffectResultType.ATTACK_LINK_APPLICATION);
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
            true
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
            true
        );
        if (detail.healingKind() == null) {
            issues.add(fieldIssue(resultPath(index, "detail.healingKind"), "REQUIRED", "治疗种类不能为空"));
        }
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
            && critical.multiplierFormulaKey() != null) {
            issues.add(fieldIssue(
                resultPath(index, "detail.critical.multiplierFormulaKey"),
                "INVALID_CRITICAL_SHAPE",
                "不允许暴击时不能配置暴击倍率公式"
            ));
        }
        if (critical != null && critical.multiplierFormulaKey() != null) {
            addInteractionFormulaRef(
                refs,
                resultPath(index, "detail.critical.multiplierFormulaKey"),
                critical.multiplierFormulaKey()
            );
        }
        List<SkillEffectVampRule> vampRules = detail.vampRules();
        if (vampRules == null) {
            issues.add(fieldIssue(resultPath(index, "detail.vampRules"), "REQUIRED", "吸血规则不能为空"));
            return;
        }
        if (vampRules.size() > SkillEffectVampType.values().length) {
            issues.add(fieldIssue(resultPath(index, "detail.vampRules"), "SIZE_INVALID", "吸血规则不能超过4条"));
        }
        Set<SkillEffectVampType> seenVampTypes = new HashSet<>();
        for (int i = 0; i < vampRules.size(); i++) {
            SkillEffectVampRule rule = vampRules.get(i);
            String prefix = resultPath(index, "detail.vampRules[" + i + "]");
            if (rule == null) {
                issues.add(fieldIssue(prefix, "REQUIRED", "吸血规则不能为空"));
                continue;
            }
            if (rule.vampType() == null) {
                issues.add(fieldIssue(prefix + ".vampType", "REQUIRED", "吸血种类不能为空"));
            } else if (!seenVampTypes.add(rule.vampType())) {
                issues.add(fieldIssue(prefix + ".vampType", "DUPLICATE_VAMP_TYPE", "同一吸血种类不能重复"));
            }
            if (rule.basisOutputKind() == null) {
                issues.add(fieldIssue(prefix + ".basisOutputKind", "INVALID_VAMP_BASIS", "吸血计算基准不能为空"));
            }
            if (rule.efficiencyFormulaKey() == null || rule.efficiencyFormulaKey().isBlank()) {
                issues.add(fieldIssue(prefix + ".efficiencyFormulaKey", "REQUIRED", "吸血效率公式不能为空"));
            } else {
                addInteractionFormulaRef(refs, prefix + ".efficiencyFormulaKey", rule.efficiencyFormulaKey());
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
        if (lifecycle.durationFormulaKey() == null) {
            issues.add(fieldIssue(
                "lifecycle.durationFormulaKey",
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

    private static void addInteractionFormulaRef(CollectedRefs refs, String path, String formulaKey) {
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
            persistentAdjustment
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
        boolean required
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
            isRetained(retained, result.resultKey(), CatalogKind.MODIFIER_ZONE, modifierZoneKey)
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
        List<String> affectedSkillKeys = detail.affectedSkillKeys();
        if (affectedSkillKeys == null || affectedSkillKeys.isEmpty()) {
            issues.add(fieldIssue(
                resultPath(index, "detail.affectedSkillKeys"),
                "AFFECTED_SKILL_REQUIRED",
                "至少选择一个受影响技能"
            ));
            return;
        }
        Set<String> seenAffectedSkillKeys = new HashSet<>();
        for (int targetIndex = 0; targetIndex < affectedSkillKeys.size(); targetIndex++) {
            String affectedSkillKey = affectedSkillKeys.get(targetIndex);
            String path = resultPath(index, "detail.affectedSkillKeys[" + targetIndex + "]");
            if (affectedSkillKey == null || affectedSkillKey.isBlank()) {
                issues.add(fieldIssue(path, "AFFECTED_SKILL_REQUIRED", "受影响技能不能为空"));
                continue;
            }
            if (!STABLE_KEY_PATTERN.matcher(affectedSkillKey).matches()) {
                issues.add(fieldIssue(path, "FORMAT_INVALID", "受影响技能标识格式不合法"));
                continue;
            }
            if (!seenAffectedSkillKeys.add(affectedSkillKey)) {
                issues.add(fieldIssue(path, "DUPLICATE_AFFECTED_SKILL", "受影响技能不能重复"));
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
    }

    private void validateStatusOperation(
        SkillEffectResultRequest result,
        int index,
        Map<String, RetainedCatalog> retained,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        forbidValueRule(result, index, issues);
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
            currentEffectKey != null && currentEffectKey.equals(targetEffectKey)
        ));
        refs.targetEffectKeys.add(targetEffectKey);
    }

    private void validateLifecycle(SkillEffectLifecycleRequest lifecycle, List<Map<String, String>> issues) {
        if (lifecycle == null) {
            return;
        }
        if (lifecycle.maxStacksFormulaKey() == null || lifecycle.maxStacksFormulaKey().isBlank()) {
            issues.add(fieldIssue("lifecycle.maxStacksFormulaKey", "REQUIRED", "最大层数公式不能为空"));
        }
        if (lifecycle.applicationStacksFormulaKey() == null
            || lifecycle.applicationStacksFormulaKey().isBlank()) {
            issues.add(fieldIssue("lifecycle.applicationStacksFormulaKey", "REQUIRED", "每次施加层数公式不能为空"));
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
        boolean hasDuration = lifecycle.durationFormulaKey() != null;
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
        if ((lifecycle.periodicIntervalFormulaKey() == null)
            != (lifecycle.firstPeriodicExecution() == null)) {
            if (lifecycle.periodicIntervalFormulaKey() == null) {
                issues.add(fieldIssue("lifecycle.periodicIntervalFormulaKey", "REQUIRED", "周期间隔与首次周期必须同时设置"));
            } else {
                issues.add(fieldIssue("lifecycle.firstPeriodicExecution", "REQUIRED", "周期间隔与首次周期必须同时设置"));
            }
        }
    }

    private void collectLifecycleFormulaRefs(SkillEffectLifecycleRequest lifecycle, CollectedRefs refs) {
        if (lifecycle == null) {
            return;
        }
        addLifecycleFormula(refs, "lifecycle.durationFormulaKey", lifecycle.durationFormulaKey());
        addLifecycleFormula(refs, "lifecycle.maxStacksFormulaKey", lifecycle.maxStacksFormulaKey());
        addLifecycleFormula(refs, "lifecycle.applicationStacksFormulaKey", lifecycle.applicationStacksFormulaKey());
        addLifecycleFormula(refs, "lifecycle.periodicIntervalFormulaKey", lifecycle.periodicIntervalFormulaKey());
    }

    private static void addLifecycleFormula(CollectedRefs refs, String path, String formulaKey) {
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
                && result.valueRule().formulaKey() != null
                && !result.valueRule().formulaKey().isBlank()) {
                refs.dynamicFormulas.add(new CatalogRef(
                    resultPath(index, "valueRule.formulaKey"),
                    result.valueRule().formulaKey(),
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
            && lifecycle.durationFormulaKey() == null) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.moment"),
                "COMBINATION_INVALID",
                "没有自然到期时不能使用自然结束时点"
            ));
        }
    }

    private static boolean supportsMomentEvaluation(SkillEffectResultRequest result) {
        if (result.resultType() == SkillEffectResultType.DAMAGE_MODIFIER
            || result.resultType() == SkillEffectResultType.HEALING_MODIFIER) {
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
            || type == SkillEffectResultType.DAMAGE_IMMUNITY
            || type == SkillEffectResultType.HEALTH_FLOOR
            || type == SkillEffectResultType.SPELL_SHIELD
            || statusApply;
        if (!allowed) {
            issues.add(fieldIssue(
                resultPath(index, "lifecycleBehavior.moment"),
                "COMBINATION_INVALID",
                "该结果不支持持续生效"
            ));
            return;
        }
        if (statusApply
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
        boolean sharedOnly = attributeSet || type == SkillEffectResultType.HEALTH_FLOOR;
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
            || type == SkillEffectResultType.DAMAGE_IMMUNITY
            || type == SkillEffectResultType.HEALTH_FLOOR
            || type == SkillEffectResultType.SPELL_SHIELD;
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
            if (lifecycle.periodicIntervalFormulaKey() == null) {
                issues.add(fieldIssue(
                    "lifecycle.periodicIntervalFormulaKey",
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
            if (lifecycle.periodicIntervalFormulaKey() != null) {
                issues.add(fieldIssue(
                    "lifecycle.periodicIntervalFormulaKey",
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
        if (hasNaturalEnd && lifecycle.durationFormulaKey() == null) {
            issues.add(fieldIssue(
                "lifecycle.durationFormulaKey",
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
        if (result.resultType() == SkillEffectResultType.STATUS_OPERATION
            || result.resultType() == SkillEffectResultType.DAMAGE_IMMUNITY
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
        String formulaKey = valueRule.formulaKey();
        if (formulaKey == null || formulaKey.isBlank()) {
            issues.add(fieldIssue(resultPath(index, "valueRule.formulaKey"), "REQUIRED", "公式标识不能为空"));
        } else {
            refs.formulas.add(new CatalogRef(
                resultPath(index, "valueRule.formulaKey"),
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
        Map<String, String> statuses = lockCatalog(refs.statusKeys, keys -> mapper.lockStatuses(gameId, keys));
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

    private void insertResults(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectResultRequest> results
    ) {
        for (SkillEffectResultRequest result : results) {
            insertResultAggregate(gameId, skillKey, effectKey, result);
        }
    }

    private void insertResultAggregate(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result
    ) {
        mapper.insertResult(
            gameId,
            skillKey,
            effectKey,
            result.resultKey(),
            result.name(),
            result.resultType(),
            result.target(),
            result.description(),
            result.sortOrder()
        );
        insertValueIfPresent(gameId, skillKey, effectKey, result);
        insertDetail(gameId, skillKey, effectKey, result);
        persistSpellShieldPolicy(gameId, skillKey, effectKey, result, false);
        insertBehaviorIfPresent(gameId, skillKey, effectKey, result);
    }

    private void updateResultAggregate(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result,
        boolean hadValue,
        boolean hadBehavior,
        boolean hadSpellShieldPolicy
    ) {
        mapper.updateResult(
            gameId,
            skillKey,
            effectKey,
            result.resultKey(),
            result.name(),
            result.target(),
            result.description(),
            result.sortOrder()
        );
        boolean needsValue = result.valueRule() != null;
        if (needsValue && hadValue) {
            SkillEffectValueRuleRequest valueRule = result.valueRule();
            mapper.updateValue(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                valueRule.formulaKey(),
                valueRule.fixedMultiplier(),
                valueRule.fixedMinValue(),
                valueRule.fixedMaxValue()
            );
        } else if (needsValue) {
            insertValueIfPresent(gameId, skillKey, effectKey, result);
        } else if (hadValue) {
            mapper.deleteValue(gameId, skillKey, effectKey, result.resultKey());
        }
        updateDetail(gameId, skillKey, effectKey, result);
        persistSpellShieldPolicy(gameId, skillKey, effectKey, result, hadSpellShieldPolicy);
        persistBehavior(gameId, skillKey, effectKey, result, hadBehavior);
    }

    private void insertValueIfPresent(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result
    ) {
        SkillEffectValueRuleRequest valueRule = result.valueRule();
        if (valueRule == null) {
            return;
        }
        mapper.insertValue(
            gameId,
            skillKey,
            effectKey,
            result.resultKey(),
            valueRule.formulaKey(),
            valueRule.fixedMultiplier(),
            valueRule.fixedMinValue(),
            valueRule.fixedMaxValue()
        );
    }

    private void insertDetail(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result
    ) {
        switch (result.detail()) {
            case SkillEffectDamageDetail detail -> mapper.insertDamageDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.damageTypeKey(),
                detail.deliveryKind(),
                detail.originKind()
            );
            case SkillEffectAttributeChangeDetail detail -> mapper.insertAttributeChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.attributeKey(),
                detail.operation(),
                detail.modifierZoneKey()
            );
            case SkillEffectResourceChangeDetail detail -> mapper.insertResourceChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.attributeKey(),
                detail.operation()
            );
            case SkillEffectCooldownChangeDetail detail -> {
                mapper.insertCooldownChangeDetail(
                    gameId,
                    skillKey,
                    effectKey,
                    result.resultKey(),
                    detail.operation()
                );
                insertCooldownChangeTargets(gameId, skillKey, effectKey, result.resultKey(), detail.affectedSkillKeys());
            }
            case SkillEffectStatusOperationDetail detail -> mapper.insertStatusOperationDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.statusKey(),
                detail.operation()
            );
            case SkillEffectLifecycleOperationDetail detail -> mapper.insertLifecycleOperationDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.targetEffectKey(),
                detail.operation()
            );
            case SkillEffectDirectHealDetail ignored -> {
            }
            case SkillEffectNormalShieldDetail detail -> mapper.insertNormalShieldInteraction(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.absorbedDamageTypeKey(),
                detail.decayMode()
            );
            case SkillEffectDamageModifierDetail detail -> mapper.insertDamageModifierDetail(
                gameId, skillKey, effectKey, result.resultKey(), detail.modifierZoneKey(),
                detail.direction(), detail.operation(),
                detail.damageTypeKey(), detail.deliveryKind(), detail.originKind(), detail.criticalFilter()
            );
            case SkillEffectHealingModifierDetail detail -> mapper.insertHealingModifierDetail(
                gameId, skillKey, effectKey, result.resultKey(), detail.modifierZoneKey(),
                detail.direction(), detail.operation(), detail.healingKind()
            );
            case SkillEffectDamageImmunityDetail detail -> mapper.insertDamageImmunityDetail(
                gameId, skillKey, effectKey, result.resultKey(),
                detail.damageTypeKey(), detail.deliveryKind(), detail.originKind()
            );
            case SkillEffectHealthFloorDetail detail -> mapper.insertHealthFloorDetail(
                gameId, skillKey, effectKey, result.resultKey(), detail.attributeKey()
            );
            case SkillEffectExecuteDetail detail -> mapper.insertExecuteDetail(
                gameId, skillKey, effectKey, result.resultKey(), detail.attributeKey()
            );
            case SkillEffectHitLinkApplicationDetail ignored -> {
            }
            case SkillEffectAttackLinkApplicationDetail ignored -> {
            }
            case SkillEffectSpellShieldDetail ignored -> {
            }
        }
        if (result.detail() instanceof SkillEffectDamageDetail damage) {
            SkillEffectCriticalPolicy critical = damage.critical();
            mapper.insertCriticalPolicy(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                critical.mode(),
                critical.multiplierFormulaKey()
            );
            for (SkillEffectVampRule vampRule : damage.vampRules()) {
                mapper.insertVampRule(
                    gameId,
                    skillKey,
                    effectKey,
                    result.resultKey(),
                    vampRule.vampType(),
                    vampRule.basisOutputKind(),
                    vampRule.efficiencyFormulaKey()
                );
            }
        }
    }

    private void updateDetail(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result
    ) {
        switch (result.detail()) {
            case SkillEffectDamageDetail detail -> mapper.updateDamageDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.damageTypeKey(),
                detail.deliveryKind(),
                detail.originKind()
            );
            case SkillEffectAttributeChangeDetail detail -> mapper.updateAttributeChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.attributeKey(),
                detail.operation(),
                detail.modifierZoneKey()
            );
            case SkillEffectResourceChangeDetail detail -> mapper.updateResourceChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.attributeKey(),
                detail.operation()
            );
            case SkillEffectCooldownChangeDetail detail -> {
                mapper.updateCooldownChangeDetail(
                    gameId,
                    skillKey,
                    effectKey,
                    result.resultKey(),
                    detail.operation()
                );
                mapper.deleteCooldownChangeTargets(gameId, skillKey, effectKey, result.resultKey());
                insertCooldownChangeTargets(gameId, skillKey, effectKey, result.resultKey(), detail.affectedSkillKeys());
            }
            case SkillEffectStatusOperationDetail detail -> mapper.updateStatusOperationDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.statusKey(),
                detail.operation()
            );
            case SkillEffectLifecycleOperationDetail detail -> mapper.updateLifecycleOperationDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.targetEffectKey(),
                detail.operation()
            );
            case SkillEffectDirectHealDetail ignored -> {
            }
            case SkillEffectNormalShieldDetail detail -> mapper.updateNormalShieldInteraction(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.absorbedDamageTypeKey(),
                detail.decayMode()
            );
            case SkillEffectDamageModifierDetail detail -> mapper.updateDamageModifierDetail(
                gameId, skillKey, effectKey, result.resultKey(), detail.modifierZoneKey(),
                detail.direction(), detail.operation(),
                detail.damageTypeKey(), detail.deliveryKind(), detail.originKind(), detail.criticalFilter()
            );
            case SkillEffectHealingModifierDetail detail -> mapper.updateHealingModifierDetail(
                gameId, skillKey, effectKey, result.resultKey(), detail.modifierZoneKey(),
                detail.direction(), detail.operation(), detail.healingKind()
            );
            case SkillEffectDamageImmunityDetail detail -> mapper.updateDamageImmunityDetail(
                gameId, skillKey, effectKey, result.resultKey(),
                detail.damageTypeKey(), detail.deliveryKind(), detail.originKind()
            );
            case SkillEffectHealthFloorDetail detail -> mapper.updateHealthFloorDetail(
                gameId, skillKey, effectKey, result.resultKey(), detail.attributeKey()
            );
            case SkillEffectExecuteDetail detail -> mapper.updateExecuteDetail(
                gameId, skillKey, effectKey, result.resultKey(), detail.attributeKey()
            );
            case SkillEffectHitLinkApplicationDetail ignored -> {
            }
            case SkillEffectAttackLinkApplicationDetail ignored -> {
            }
            case SkillEffectSpellShieldDetail ignored -> {
            }
        }
        if (result.detail() instanceof SkillEffectDamageDetail damage) {
            SkillEffectCriticalPolicy critical = damage.critical();
            mapper.updateCriticalPolicy(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                critical.mode(),
                critical.multiplierFormulaKey()
            );
            mapper.deleteVampRules(gameId, skillKey, effectKey, result.resultKey());
            for (SkillEffectVampRule vampRule : damage.vampRules()) {
                mapper.insertVampRule(
                    gameId,
                    skillKey,
                    effectKey,
                    result.resultKey(),
                    vampRule.vampType(),
                    vampRule.basisOutputKind(),
                    vampRule.efficiencyFormulaKey()
                );
            }
        }
    }

    private void insertCooldownChangeTargets(
        String gameId,
        String skillKey,
        String effectKey,
        String resultKey,
        List<String> affectedSkillKeys
    ) {
        for (String affectedSkillKey : affectedSkillKeys) {
            mapper.insertCooldownChangeTarget(gameId, skillKey, effectKey, resultKey, affectedSkillKey);
        }
    }

    private ExistingCatalog loadExistingCatalog(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectResultRow> existingRows
    ) {
        Map<String, SkillEffectResultValueRow> values = indexValues(
            gameId,
            skillKey,
            effectKey,
            mapper.listValues(gameId, skillKey, effectKey)
        );
        Map<String, RetainedCatalog> retained = new HashMap<>();
        Map<String, SkillEffectDamageDetailRow> damage = indexDamage(
            gameId,
            skillKey,
            effectKey,
            mapper.listDamageDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectNormalShieldInteractionRow> normalShields = indexNormalShieldInteractions(
            gameId,
            skillKey,
            effectKey,
            mapper.listNormalShieldInteractions(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectDamageModifierDetailRow> damageModifiers = indexDamageModifiers(
            gameId,
            skillKey,
            effectKey,
            mapper.listDamageModifierDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectHealingModifierDetailRow> healingModifiers = indexHealingModifiers(
            gameId,
            skillKey,
            effectKey,
            mapper.listHealingModifierDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectDamageImmunityDetailRow> damageImmunities = indexDamageImmunities(
            gameId,
            skillKey,
            effectKey,
            mapper.listDamageImmunityDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectHealthFloorDetailRow> healthFloors = indexHealthFloors(
            gameId,
            skillKey,
            effectKey,
            mapper.listHealthFloorDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectExecuteDetailRow> executes = indexExecuteDetails(
            gameId,
            skillKey,
            effectKey,
            mapper.listExecuteDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectAttributeChangeDetailRow> attributes = indexAttributeChange(
            gameId,
            skillKey,
            effectKey,
            mapper.listAttributeChangeDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectResourceChangeDetailRow> resources = indexResourceChange(
            gameId,
            skillKey,
            effectKey,
            mapper.listResourceChangeDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectCooldownChangeDetailRow> cooldowns = indexCooldownChange(
            gameId,
            skillKey,
            effectKey,
            mapper.listCooldownChangeDetails(gameId, skillKey, effectKey)
        );
        Map<String, List<String>> cooldownTargets = indexCooldownChangeTargets(
            mapper.listCooldownChangeTargets(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectStatusOperationDetailRow> statuses = indexStatusOperation(
            gameId,
            skillKey,
            effectKey,
            mapper.listStatusOperationDetails(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectResultLifecycleBehaviorRow> behaviors = indexLifecycleBehaviors(
            gameId,
            skillKey,
            effectKey,
            mapper.listLifecycleBehaviors(gameId, skillKey, effectKey)
        );
        Map<String, SkillEffectSpellShieldPolicyRow> spellShieldPolicies = indexSpellShieldPolicies(
            gameId,
            skillKey,
            effectKey,
            mapper.listSpellShieldPolicies(gameId, skillKey, effectKey)
        );
        for (SkillEffectResultRow row : existingRows) {
            String resultKey = row.resultKey();
            SkillEffectDamageDetailRow damageRow = damage.get(resultKey);
            SkillEffectAttributeChangeDetailRow attributeRow = attributes.get(resultKey);
            SkillEffectResourceChangeDetailRow resourceRow = resources.get(resultKey);
            SkillEffectCooldownChangeDetailRow cooldownRow = cooldowns.get(resultKey);
            SkillEffectStatusOperationDetailRow statusRow = statuses.get(resultKey);
            SkillEffectNormalShieldInteractionRow normalShieldRow = normalShields.get(resultKey);
            SkillEffectDamageModifierDetailRow damageModifierRow = damageModifiers.get(resultKey);
            SkillEffectHealingModifierDetailRow healingModifierRow = healingModifiers.get(resultKey);
            SkillEffectDamageImmunityDetailRow damageImmunityRow = damageImmunities.get(resultKey);
            SkillEffectHealthFloorDetailRow healthFloorRow = healthFloors.get(resultKey);
            SkillEffectExecuteDetailRow executeRow = executes.get(resultKey);
            Set<String> retainedDamageTypes = new LinkedHashSet<>();
            if (damageRow != null && damageRow.damageTypeKey() != null) {
                retainedDamageTypes.add(damageRow.damageTypeKey());
            }
            if (normalShieldRow != null && normalShieldRow.absorbedDamageTypeKey() != null) {
                retainedDamageTypes.add(normalShieldRow.absorbedDamageTypeKey());
            }
            if (damageModifierRow != null && damageModifierRow.damageTypeKey() != null) {
                retainedDamageTypes.add(damageModifierRow.damageTypeKey());
            }
            if (damageImmunityRow != null && damageImmunityRow.damageTypeKey() != null) {
                retainedDamageTypes.add(damageImmunityRow.damageTypeKey());
            }
            retained.put(resultKey, new RetainedCatalog(
                Set.copyOf(retainedDamageTypes),
                attributeRow == null
                    ? (resourceRow == null
                        ? (healthFloorRow == null
                            ? (executeRow == null ? null : executeRow.attributeKey())
                            : healthFloorRow.attributeKey())
                        : resourceRow.attributeKey())
                    : attributeRow.attributeKey(),
                cooldownRow == null ? Set.of() : Set.copyOf(cooldownTargets.getOrDefault(resultKey, List.of())),
                statusRow == null ? null : statusRow.statusKey(),
                attributeRow != null && attributeRow.modifierZoneKey() != null
                    ? attributeRow.modifierZoneKey()
                    : (damageModifierRow != null
                        ? damageModifierRow.modifierZoneKey()
                        : (healingModifierRow == null ? null : healingModifierRow.modifierZoneKey()))
            ));
        }
        return new ExistingCatalog(values, retained, behaviors, spellShieldPolicies);
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

    private Map<String, SkillEffectResultValueRow> indexValues(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectResultValueRow> rows
    ) {
        Map<String, SkillEffectResultValueRow> indexed = new LinkedHashMap<>();
        for (SkillEffectResultValueRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "数值规则重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectDamageDetailRow> indexDamage(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectDamageDetailRow> rows
    ) {
        Map<String, SkillEffectDamageDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectDamageDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "伤害明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectSpellShieldPolicyRow> indexSpellShieldPolicies(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectSpellShieldPolicyRow> rows
    ) {
        Map<String, SkillEffectSpellShieldPolicyRow> indexed = new LinkedHashMap<>();
        for (SkillEffectSpellShieldPolicyRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "法术护盾阻挡策略重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectCriticalPolicyRow> indexCriticalPolicies(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectCriticalPolicyRow> rows
    ) {
        Map<String, SkillEffectCriticalPolicyRow> indexed = new LinkedHashMap<>();
        for (SkillEffectCriticalPolicyRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "暴击策略重复");
            }
        }
        return indexed;
    }

    private Map<String, List<SkillEffectVampRuleRow>> indexVampRules(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectVampRuleRow> rows
    ) {
        Map<String, List<SkillEffectVampRuleRow>> indexed = new LinkedHashMap<>();
        Map<String, Set<SkillEffectVampType>> seen = new LinkedHashMap<>();
        for (SkillEffectVampRuleRow row : nullToEmpty(rows)) {
            Set<SkillEffectVampType> seenTypes = seen.computeIfAbsent(row.resultKey(), ignored -> new HashSet<>());
            if (!seenTypes.add(row.vampType())) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "吸血种类重复");
            }
            indexed.computeIfAbsent(row.resultKey(), ignored -> new ArrayList<>()).add(row);
        }
        Map<String, List<SkillEffectVampRuleRow>> immutable = new LinkedHashMap<>();
        indexed.forEach((resultKey, values) -> immutable.put(resultKey, List.copyOf(values)));
        return immutable;
    }

    private Map<String, SkillEffectNormalShieldInteractionRow> indexNormalShieldInteractions(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectNormalShieldInteractionRow> rows
    ) {
        Map<String, SkillEffectNormalShieldInteractionRow> indexed = new LinkedHashMap<>();
        for (SkillEffectNormalShieldInteractionRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "普通护盾交互重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectDamageModifierDetailRow> indexDamageModifiers(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectDamageModifierDetailRow> rows
    ) {
        Map<String, SkillEffectDamageModifierDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectDamageModifierDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "伤害修正明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectHealingModifierDetailRow> indexHealingModifiers(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectHealingModifierDetailRow> rows
    ) {
        Map<String, SkillEffectHealingModifierDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectHealingModifierDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "治疗修正明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectDamageImmunityDetailRow> indexDamageImmunities(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectDamageImmunityDetailRow> rows
    ) {
        Map<String, SkillEffectDamageImmunityDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectDamageImmunityDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "伤害免疫明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectHealthFloorDetailRow> indexHealthFloors(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectHealthFloorDetailRow> rows
    ) {
        Map<String, SkillEffectHealthFloorDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectHealthFloorDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "生命下限明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectExecuteDetailRow> indexExecuteDetails(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectExecuteDetailRow> rows
    ) {
        Map<String, SkillEffectExecuteDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectExecuteDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "斩杀明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectAttributeChangeDetailRow> indexAttributeChange(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectAttributeChangeDetailRow> rows
    ) {
        Map<String, SkillEffectAttributeChangeDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectAttributeChangeDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "属性变化明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectResourceChangeDetailRow> indexResourceChange(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectResourceChangeDetailRow> rows
    ) {
        Map<String, SkillEffectResourceChangeDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectResourceChangeDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "资源变化明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectCooldownChangeDetailRow> indexCooldownChange(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectCooldownChangeDetailRow> rows
    ) {
        Map<String, SkillEffectCooldownChangeDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectCooldownChangeDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "冷却变化明细重复");
            }
        }
        return indexed;
    }

    private Map<String, List<String>> indexCooldownChangeTargets(
        List<SkillEffectCooldownChangeTargetRow> rows
    ) {
        Map<String, List<String>> indexed = new LinkedHashMap<>();
        for (SkillEffectCooldownChangeTargetRow row : nullToEmpty(rows)) {
            List<String> targets = indexed.computeIfAbsent(row.resultKey(), ignored -> new ArrayList<>());
            if (targets.contains(row.affectedSkillKey())) {
                throw corrupt(row.gameId(), row.skillKey(), row.effectKey(), row.resultKey(), "冷却变化目标重复");
            }
            targets.add(row.affectedSkillKey());
        }
        Map<String, List<String>> immutable = new LinkedHashMap<>();
        indexed.forEach((resultKey, targets) -> immutable.put(resultKey, List.copyOf(targets)));
        return immutable;
    }

    private Map<String, SkillEffectStatusOperationDetailRow> indexStatusOperation(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectStatusOperationDetailRow> rows
    ) {
        Map<String, SkillEffectStatusOperationDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectStatusOperationDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "状态操作明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectLifecycleOperationDetailRow> indexLifecycleOperations(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectLifecycleOperationDetailRow> rows
    ) {
        Map<String, SkillEffectLifecycleOperationDetailRow> indexed = new LinkedHashMap<>();
        for (SkillEffectLifecycleOperationDetailRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "生命周期操作明细重复");
            }
        }
        return indexed;
    }

    private Map<String, SkillEffectResultLifecycleBehaviorRow> indexLifecycleBehaviors(
        String gameId,
        String skillKey,
        String effectKey,
        List<SkillEffectResultLifecycleBehaviorRow> rows
    ) {
        Map<String, SkillEffectResultLifecycleBehaviorRow> indexed = new LinkedHashMap<>();
        for (SkillEffectResultLifecycleBehaviorRow row : nullToEmpty(rows)) {
            if (indexed.put(row.resultKey(), row) != null) {
                throw corrupt(gameId, skillKey, effectKey, row.resultKey(), "生命周期行为重复");
            }
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
            case ATTRIBUTE -> Objects.equals(catalog.attributeKey(), value);
            case SKILL -> catalog.affectedSkillKeys().contains(value);
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

    private static SkillEffectValueRuleResponse toValueRule(SkillEffectResultValueRow row) {
        return new SkillEffectValueRuleResponse(
            row.formulaKey(),
            row.fixedMultiplier(),
            row.fixedMinValue(),
            row.fixedMaxValue()
        );
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

    private static String resultPath(int index, String suffix) {
        if (suffix == null || suffix.isEmpty()) {
            return "results[" + index + "]";
        }
        return "results[" + index + "]." + suffix;
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
                    "lifecycle.durationFormulaKey",
                    "REFRESH_OPERATION_IN_USE",
                    "目标生命周期仍被刷新操作引用，不能清空持续时间"
                ))
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

    private void insertLifecycleIfPresent(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectLifecycleRequest lifecycle
    ) {
        if (lifecycle == null) {
            return;
        }
        mapper.insertLifecycle(
            gameId,
            skillKey,
            effectKey,
            lifecycle.durationFormulaKey(),
            lifecycle.maxStacksFormulaKey(),
            lifecycle.applicationStacksFormulaKey(),
            lifecycle.instanceScope(),
            lifecycle.reapplicationStackMode(),
            lifecycle.reapplicationDurationMode(),
            lifecycle.expiryMode(),
            lifecycle.periodicIntervalFormulaKey(),
            lifecycle.firstPeriodicExecution()
        );
    }

    private void persistLifecycle(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectLifecycleRow existing,
        SkillEffectLifecycleRequest requested
    ) {
        if (existing != null && requested != null) {
            mapper.updateLifecycle(
                gameId,
                skillKey,
                effectKey,
                requested.durationFormulaKey(),
                requested.maxStacksFormulaKey(),
                requested.applicationStacksFormulaKey(),
                requested.instanceScope(),
                requested.reapplicationStackMode(),
                requested.reapplicationDurationMode(),
                requested.expiryMode(),
                requested.periodicIntervalFormulaKey(),
                requested.firstPeriodicExecution()
            );
            return;
        }
        if (existing == null && requested != null) {
            insertLifecycleIfPresent(gameId, skillKey, effectKey, requested);
            return;
        }
        if (existing != null) {
            mapper.deleteAllLifecycleBehaviors(gameId, skillKey, effectKey);
            mapper.deleteLifecycle(gameId, skillKey, effectKey);
        }
    }

    private void insertBehaviorIfPresent(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result
    ) {
        persistBehavior(gameId, skillKey, effectKey, result, false);
    }

    private void persistSpellShieldPolicy(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result,
        boolean hadPolicy
    ) {
        SkillEffectSpellShieldBlockScope scope = result.spellShieldBlockScope();
        if (scope == null) {
            if (hadPolicy) {
                mapper.deleteSpellShieldPolicy(gameId, skillKey, effectKey, result.resultKey());
            }
            return;
        }
        if (hadPolicy) {
            mapper.updateSpellShieldPolicy(gameId, skillKey, effectKey, result.resultKey(), scope);
            return;
        }
        mapper.insertSpellShieldPolicy(gameId, skillKey, effectKey, result.resultKey(), scope);
    }

    private void persistBehavior(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result,
        boolean hadBehavior
    ) {
        SkillEffectResultLifecycleBehaviorRequest behavior = result.lifecycleBehavior();
        if (behavior == null) {
            if (hadBehavior) {
                mapper.deleteLifecycleBehaviors(gameId, skillKey, effectKey, List.of(result.resultKey()));
            }
            return;
        }
        if (hadBehavior) {
            mapper.updateLifecycleBehavior(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                behavior.moment(),
                behavior.valueReadMode(),
                behavior.stackValueMode(),
                behavior.reapplicationValueMode(),
                behavior.periodicExecutionMode()
            );
            return;
        }
        mapper.insertLifecycleBehavior(
            gameId,
            skillKey,
            effectKey,
            result.resultKey(),
            behavior.moment(),
            behavior.valueReadMode(),
            behavior.stackValueMode(),
            behavior.reapplicationValueMode(),
            behavior.periodicExecutionMode()
        );
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
            if (ref.refresh() && lifecycle.durationFormulaKey() == null) {
                issues.add(fieldIssue(ref.path(), "TARGET_EFFECT_HAS_NO_DURATION", "刷新目标没有自然到期"));
            }
        }
    }

    private static SkillEffectLifecycleResponse toLifecycleResponse(SkillEffectLifecycleRow row) {
        if (row == null) {
            return null;
        }
        return new SkillEffectLifecycleResponse(
            row.durationFormulaKey(),
            row.maxStacksFormulaKey(),
            row.applicationStacksFormulaKey(),
            row.instanceScope(),
            row.reapplicationStackMode(),
            row.reapplicationDurationMode(),
            row.expiryMode(),
            row.periodicIntervalFormulaKey(),
            row.firstPeriodicExecution()
        );
    }

    private static SkillEffectResultLifecycleBehaviorResponse toBehaviorResponse(
        SkillEffectResultLifecycleBehaviorRow row
    ) {
        if (row == null) {
            return null;
        }
        return new SkillEffectResultLifecycleBehaviorResponse(
            row.moment(),
            row.valueReadMode(),
            row.stackValueMode(),
            row.reapplicationValueMode(),
            row.periodicExecutionMode()
        );
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
        private final List<CatalogRef> formulas = new ArrayList<>();
        private final List<CatalogRef> dynamicFormulas = new ArrayList<>();
        private final List<CatalogRef> interactionFormulas = new ArrayList<>();
        private final List<CatalogRef> lifecycleFormulas = new ArrayList<>();
        private final List<CatalogRef> damageTypes = new ArrayList<>();
        private final List<CatalogRef> interactionDamageTypes = new ArrayList<>();
        private final List<CatalogRef> attributes = new ArrayList<>();
        private final List<CatalogRef> skills = new ArrayList<>();
        private final List<CatalogRef> statuses = new ArrayList<>();
        private final List<ModifierZoneRef> modifierZones = new ArrayList<>();
        private final List<TargetEffectRef> targetEffects = new ArrayList<>();
        private final LinkedHashSet<String> formulaKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> damageTypeKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> attributeKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> skillKeys = new LinkedHashSet<>();
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
        boolean retainedOrExempt
    ) {
    }

    private record TargetEffectRef(String path, String key, boolean refresh, boolean selfReference) {
    }

    private record RetainedCatalog(
        Set<String> damageTypeKeys,
        String attributeKey,
        Set<String> affectedSkillKeys,
        String statusKey,
        String modifierZoneKey
    ) {
    }

    private record ExistingCatalog(
        Map<String, SkillEffectResultValueRow> values,
        Map<String, RetainedCatalog> retained,
        Map<String, SkillEffectResultLifecycleBehaviorRow> behaviors,
        Map<String, SkillEffectSpellShieldPolicyRow> spellShieldPolicies
    ) {
    }

    private record AssembledResultPayload(
        SkillEffectValueRuleResponse valueRule,
        SkillEffectResultDetail detail
    ) {
    }

    private enum CatalogKind {
        DAMAGE_TYPE,
        ATTRIBUTE,
        SKILL,
        STATUS,
        MODIFIER_ZONE
    }

    @FunctionalInterface
    private interface CatalogLockFunction {
        List<SkillEffectCatalogLockRow> lock(List<String> keys);
    }
}
