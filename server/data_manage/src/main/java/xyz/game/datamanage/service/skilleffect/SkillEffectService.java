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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectDirectHealDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectNormalShieldDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResourceChangeDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultValueRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectStatusOperationDetailRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectSummaryResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectValueRuleResponse;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillEffectService {

    private static final Logger log = LoggerFactory.getLogger(SkillEffectService.class);

    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_effects";
    private static final String DISABLED = "DISABLED";

    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillEffectMapper mapper;

    public SkillEffectService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillEffectMapper mapper
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;
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
        CollectedRefs refs = collectAndValidateResults(values.results(), Map.of(), skillKey);
        lockAndValidateCatalogs(gameId, skillKey, refs);
        try {
            mapper.insertEffect(
                gameId,
                skillKey,
                values.effectKey(),
                values.name(),
                values.description(),
                values.sortOrder()
            );
            insertResults(gameId, skillKey, values.effectKey(), values.results());
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
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

        ExistingCatalog existingCatalog = loadExistingCatalog(gameId, skillKey, effectKey, existingRows);
        CollectedRefs refs = collectAndValidateResults(values.results(), existingCatalog.retained, skillKey);
        lockAndValidateCatalogs(gameId, skillKey, refs);

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
        try {
            if (!removedKeys.isEmpty()) {
                mapper.deleteResults(gameId, skillKey, effectKey, removedKeys);
            }
            for (SkillEffectResultRequest result : values.results()) {
                if (existingByKey.containsKey(result.resultKey())) {
                    updateResultAggregate(
                        gameId,
                        skillKey,
                        effectKey,
                        result,
                        existingCatalog.values.containsKey(result.resultKey())
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
            throw mapWriteConstraint(ex);
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
        if (mapper.deleteEffect(gameId, skillKey, effectKey) == 0) {
            throw effectNotFound(effectKey);
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
        Map<String, SkillEffectStatusOperationDetailRow> statuses = indexStatusOperation(
            gameId,
            skillKey,
            effectKey,
            mapper.listStatusOperationDetails(gameId, skillKey, effectKey)
        );

        List<SkillEffectResultResponse> assembled = new ArrayList<>(results.size());
        for (SkillEffectResultRow result : results) {
            assembled.add(assembleResult(
                gameId,
                skillKey,
                effectKey,
                result,
                values,
                damage,
                attributes,
                resources,
                cooldowns,
                statuses
            ));
        }
        return new SkillEffectDetailResponse(
            effect.gameId(),
            effect.skillKey(),
            effect.effectKey(),
            effect.name(),
            effect.description(),
            effect.sortOrder(),
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
        Map<String, SkillEffectAttributeChangeDetailRow> attributes,
        Map<String, SkillEffectResourceChangeDetailRow> resources,
        Map<String, SkillEffectCooldownChangeDetailRow> cooldowns,
        Map<String, SkillEffectStatusOperationDetailRow> statuses
    ) {
        String resultKey = result.resultKey();
        SkillEffectResultValueRow value = values.get(resultKey);
        SkillEffectDamageDetailRow damageRow = damage.get(resultKey);
        SkillEffectAttributeChangeDetailRow attributeRow = attributes.get(resultKey);
        SkillEffectResourceChangeDetailRow resourceRow = resources.get(resultKey);
        SkillEffectCooldownChangeDetailRow cooldownRow = cooldowns.get(resultKey);
        SkillEffectStatusOperationDetailRow statusRow = statuses.get(resultKey);
        int extraDetails = countPresent(damageRow, attributeRow, resourceRow, cooldownRow, statusRow);
        SkillEffectResultType type = result.resultType();
        if (type == null) {
            throw corrupt(gameId, skillKey, effectKey, resultKey, "结果种类缺失");
        }
        AssembledResultPayload payload = switch (type) {
            case DAMAGE -> {
                if (value == null || damageRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "伤害结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectDamageDetail(damageRow.damageTypeKey())
                );
            }
            case DIRECT_HEAL -> {
                if (value == null || extraDetails != 0) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "直接治疗结果形状损坏");
                }
                yield new AssembledResultPayload(toValueRule(value), new SkillEffectDirectHealDetail());
            }
            case NORMAL_SHIELD -> {
                if (value == null || extraDetails != 0) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "普通护盾结果形状损坏");
                }
                yield new AssembledResultPayload(toValueRule(value), new SkillEffectNormalShieldDetail());
            }
            case ATTRIBUTE_CHANGE -> {
                if (value == null || attributeRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "属性变化结果形状损坏");
                }
                yield new AssembledResultPayload(
                    toValueRule(value),
                    new SkillEffectAttributeChangeDetail(
                        attributeRow.attributeKey(),
                        attributeRow.operation()
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
                if (cooldownRow == null || extraDetails != 1) {
                    throw corrupt(gameId, skillKey, effectKey, resultKey, "冷却变化结果形状损坏");
                }
                SkillEffectCooldownChangeOperation operation = cooldownRow.operation();
                if (operation == SkillEffectCooldownChangeOperation.RESET) {
                    if (value != null) {
                        throw corrupt(gameId, skillKey, effectKey, resultKey, "冷却重置不得有数值规则");
                    }
                    yield new AssembledResultPayload(
                        null,
                        new SkillEffectCooldownChangeDetail(cooldownRow.affectedSkillKey(), operation)
                    );
                }
                if (operation == SkillEffectCooldownChangeOperation.REDUCE
                    || operation == SkillEffectCooldownChangeOperation.INCREASE) {
                    if (value == null) {
                        throw corrupt(gameId, skillKey, effectKey, resultKey, "冷却增减缺少数值规则");
                    }
                    yield new AssembledResultPayload(
                        toValueRule(value),
                        new SkillEffectCooldownChangeDetail(cooldownRow.affectedSkillKey(), operation)
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
        };
        return new SkillEffectResultResponse(
            result.resultKey(),
            result.name(),
            result.resultType(),
            result.target(),
            result.description(),
            result.sortOrder(),
            payload.valueRule(),
            payload.detail()
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
            request.results() == null ? List.of() : List.copyOf(request.results())
        );
    }

    private CollectedRefs collectAndValidateResults(
        List<SkillEffectResultRequest> results,
        Map<String, RetainedCatalog> retained,
        String pathSkillKey
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        List<Map<String, String>> bodyIssues = new ArrayList<>();
        if (results == null || results.isEmpty()) {
            issues.add(fieldIssue("results", "REQUIRED", "效果至少包含一个结果"));
            throwIfInvalid(issues);
        }
        Set<String> seenKeys = new HashSet<>();
        CollectedRefs refs = new CollectedRefs();
        for (int i = 0; i < results.size(); i++) {
            validateResult(results.get(i), i, seenKeys, retained, pathSkillKey, refs, issues, bodyIssues);
        }
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
            case DIRECT_HEAL, NORMAL_SHIELD -> validateEmptyDetailValue(result, index, refs, issues);
            case ATTRIBUTE_CHANGE -> validateAttributeChange(result, index, retained, refs, issues);
            case RESOURCE_CHANGE -> validateResourceChange(result, index, retained, refs, issues);
            case COOLDOWN_CHANGE -> validateCooldownChange(result, index, retained, pathSkillKey, refs, issues);
            case STATUS_OPERATION -> validateStatusOperation(result, index, retained, refs, issues);
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
            return;
        }
        refs.damageTypes.add(new CatalogRef(
            resultPath(index, "detail.damageTypeKey"),
            damageTypeKey,
            isRetained(retained, result.resultKey(), CatalogKind.DAMAGE_TYPE, damageTypeKey)
        ));
        refs.damageTypeKeys.add(damageTypeKey);
    }

    private void validateEmptyDetailValue(
        SkillEffectResultRequest result,
        int index,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        requireValueRule(result, index, refs, issues);
        if (!(result.detail() instanceof SkillEffectDirectHealDetail)
            && !(result.detail() instanceof SkillEffectNormalShieldDetail)) {
            issues.add(fieldIssue(resultPath(index, "detail"), "TYPE_MISMATCH", "结果明细形状不合法"));
        }
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
        String affectedSkillKey = detail.affectedSkillKey();
        if (affectedSkillKey == null || affectedSkillKey.isBlank()) {
            issues.add(fieldIssue(
                resultPath(index, "detail.affectedSkillKey"),
                "REQUIRED",
                "受影响技能不能为空"
            ));
            return;
        }
        boolean selfReference = affectedSkillKey.equals(pathSkillKey);
        refs.skills.add(new CatalogRef(
            resultPath(index, "detail.affectedSkillKey"),
            affectedSkillKey,
            selfReference
                || isRetained(retained, result.resultKey(), CatalogKind.SKILL, affectedSkillKey)
        ));
        refs.skillKeys.add(affectedSkillKey);
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

    private void validateValueRulePresence(
        SkillEffectResultRequest result,
        int index,
        List<Map<String, String>> issues
    ) {
        if (result.resultType() == SkillEffectResultType.STATUS_OPERATION) {
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

    private void lockAndValidateCatalogs(String gameId, String skillKey, CollectedRefs refs) {
        Set<String> formulas = lockFormulas(gameId, skillKey, refs.formulaKeys);
        Map<String, String> damageTypes = lockCatalog(refs.damageTypeKeys, keys -> mapper.lockDamageTypes(gameId, keys));
        Map<String, String> attributes = lockCatalog(refs.attributeKeys, keys -> mapper.lockAttributes(gameId, keys));
        Map<String, String> skills = lockCatalog(refs.skillKeys, keys -> mapper.lockSkills(gameId, keys));
        Map<String, String> statuses = lockCatalog(refs.statusKeys, keys -> mapper.lockStatuses(gameId, keys));

        List<Map<String, String>> unknown = new ArrayList<>();
        addUnknown(unknown, refs.formulas, formulas, "UNKNOWN_FORMULA", "技能公式不存在或不属于当前技能");
        addUnknown(unknown, refs.damageTypes, damageTypes.keySet(), "UNKNOWN_DAMAGE_TYPE", "伤害类型不存在或不属于当前游戏");
        addUnknown(unknown, refs.attributes, attributes.keySet(), "UNKNOWN_ATTRIBUTE", "属性不存在或不属于当前游戏");
        addUnknown(unknown, refs.skills, skills.keySet(), "UNKNOWN_SKILL", "技能不存在或不属于当前游戏");
        addUnknown(unknown, refs.statuses, statuses.keySet(), "UNKNOWN_STATUS", "状态不存在或不属于当前游戏");
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
        addDisabled(disabled, refs.attributes, attributes, "ATTRIBUTE_DISABLED", "不能新增停用属性引用");
        addDisabled(disabled, refs.skills, skills, "SKILL_DISABLED", "不能新增停用技能引用");
        addDisabled(disabled, refs.statuses, statuses, "STATUS_DISABLED", "不能新增停用状态引用");
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
    }

    private void updateResultAggregate(
        String gameId,
        String skillKey,
        String effectKey,
        SkillEffectResultRequest result,
        boolean hadValue
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
                detail.damageTypeKey()
            );
            case SkillEffectAttributeChangeDetail detail -> mapper.insertAttributeChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.attributeKey(),
                detail.operation()
            );
            case SkillEffectResourceChangeDetail detail -> mapper.insertResourceChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.attributeKey(),
                detail.operation()
            );
            case SkillEffectCooldownChangeDetail detail -> mapper.insertCooldownChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.affectedSkillKey(),
                detail.operation()
            );
            case SkillEffectStatusOperationDetail detail -> mapper.insertStatusOperationDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.statusKey(),
                detail.operation()
            );
            case SkillEffectDirectHealDetail ignored -> {
            }
            case SkillEffectNormalShieldDetail ignored -> {
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
                detail.damageTypeKey()
            );
            case SkillEffectAttributeChangeDetail detail -> mapper.updateAttributeChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.attributeKey(),
                detail.operation()
            );
            case SkillEffectResourceChangeDetail detail -> mapper.updateResourceChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.attributeKey(),
                detail.operation()
            );
            case SkillEffectCooldownChangeDetail detail -> mapper.updateCooldownChangeDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.affectedSkillKey(),
                detail.operation()
            );
            case SkillEffectStatusOperationDetail detail -> mapper.updateStatusOperationDetail(
                gameId,
                skillKey,
                effectKey,
                result.resultKey(),
                detail.statusKey(),
                detail.operation()
            );
            case SkillEffectDirectHealDetail ignored -> {
            }
            case SkillEffectNormalShieldDetail ignored -> {
            }
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
        Map<String, SkillEffectStatusOperationDetailRow> statuses = indexStatusOperation(
            gameId,
            skillKey,
            effectKey,
            mapper.listStatusOperationDetails(gameId, skillKey, effectKey)
        );
        for (SkillEffectResultRow row : existingRows) {
            String resultKey = row.resultKey();
            SkillEffectDamageDetailRow damageRow = damage.get(resultKey);
            SkillEffectAttributeChangeDetailRow attributeRow = attributes.get(resultKey);
            SkillEffectResourceChangeDetailRow resourceRow = resources.get(resultKey);
            SkillEffectCooldownChangeDetailRow cooldownRow = cooldowns.get(resultKey);
            SkillEffectStatusOperationDetailRow statusRow = statuses.get(resultKey);
            retained.put(resultKey, new RetainedCatalog(
                damageRow == null ? null : damageRow.damageTypeKey(),
                attributeRow == null
                    ? (resourceRow == null ? null : resourceRow.attributeKey())
                    : attributeRow.attributeKey(),
                cooldownRow == null ? null : cooldownRow.affectedSkillKey(),
                statusRow == null ? null : statusRow.statusKey()
            ));
        }
        return new ExistingCatalog(values, retained);
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
            case DAMAGE_TYPE -> Objects.equals(catalog.damageTypeKey(), value);
            case ATTRIBUTE -> Objects.equals(catalog.attributeKey(), value);
            case SKILL -> Objects.equals(catalog.affectedSkillKey(), value);
            case STATUS -> Objects.equals(catalog.statusKey(), value);
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
        return Map.of("field", field, "code", code, "message", message);
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private static Set<String> nullToEmptySet(Set<String> values) {
        return values == null ? Set.of() : values;
    }

    private record ValidatedEffect(
        String effectKey,
        String name,
        String description,
        Integer sortOrder,
        List<SkillEffectResultRequest> results
    ) {
    }

    private static final class CollectedRefs {
        private final List<CatalogRef> formulas = new ArrayList<>();
        private final List<CatalogRef> damageTypes = new ArrayList<>();
        private final List<CatalogRef> attributes = new ArrayList<>();
        private final List<CatalogRef> skills = new ArrayList<>();
        private final List<CatalogRef> statuses = new ArrayList<>();
        private final LinkedHashSet<String> formulaKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> damageTypeKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> attributeKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> skillKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> statusKeys = new LinkedHashSet<>();
    }

    private record CatalogRef(String path, String key, boolean retainedOrExempt) {
    }

    private record RetainedCatalog(
        String damageTypeKey,
        String attributeKey,
        String affectedSkillKey,
        String statusKey
    ) {
    }

    private record ExistingCatalog(
        Map<String, SkillEffectResultValueRow> values,
        Map<String, RetainedCatalog> retained
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
        STATUS
    }

    @FunctionalInterface
    private interface CatalogLockFunction {
        List<SkillEffectCatalogLockRow> lock(List<String> keys);
    }
}
