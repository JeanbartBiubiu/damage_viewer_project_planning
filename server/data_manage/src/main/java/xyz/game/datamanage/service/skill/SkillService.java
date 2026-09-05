package xyz.game.datamanage.service.skill;

import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper;
import xyz.game.datamanage.mapper.skillinternalstate.SkillInternalStateMapper;
import xyz.game.datamanage.mapper.skillparameter.SkillParameterMapper;
import xyz.game.datamanage.mapper.skillprocess.SkillProcessMapper;
import xyz.game.datamanage.model.skill.SkillCategoryLockRow;
import xyz.game.datamanage.model.skill.SkillCategoryRelationRow;
import xyz.game.datamanage.model.skill.SkillCreateRequest;
import xyz.game.datamanage.model.skill.SkillListQuery;
import xyz.game.datamanage.model.skill.SkillListResponse;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skill.SkillUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterRow;
import xyz.game.datamanage.service.skillparameter.SkillParameterLevelService;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillService {

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skills";
    private static final String DISABLED = "DISABLED";

    private final GamesMapper gamesMapper;
    private final SkillMapper mapper;
    private final SkillParameterMapper parameterMapper;
    private final SkillFormulaMapper formulaMapper;
    private final SkillEffectMapper effectMapper;
    private final SkillProcessMapper processMapper;
    private final SkillInternalStateMapper internalStateMapper;
    private final SkillParameterLevelService levelService;
    private final SkillTriggerRuleService triggerRuleService;

    public SkillService(
        GamesMapper gamesMapper,
        SkillMapper mapper,
        SkillParameterMapper parameterMapper,
        SkillFormulaMapper formulaMapper,
        SkillEffectMapper effectMapper,
        SkillProcessMapper processMapper,
        SkillInternalStateMapper internalStateMapper,
        SkillParameterLevelService levelService
    ) {
        this(
            gamesMapper,
            mapper,
            parameterMapper,
            formulaMapper,
            effectMapper,
            processMapper,
            internalStateMapper,
            levelService,
            null
        );
    }

    @Autowired
    public SkillService(
        GamesMapper gamesMapper,
        SkillMapper mapper,
        SkillParameterMapper parameterMapper,
        SkillFormulaMapper formulaMapper,
        SkillEffectMapper effectMapper,
        SkillProcessMapper processMapper,
        SkillInternalStateMapper internalStateMapper,
        SkillParameterLevelService levelService,
        SkillTriggerRuleService triggerRuleService
    ) {
        this.gamesMapper = gamesMapper;
        this.mapper = mapper;
        this.parameterMapper = parameterMapper;
        this.formulaMapper = formulaMapper;
        this.effectMapper = effectMapper;
        this.processMapper = processMapper;
        this.internalStateMapper = internalStateMapper;
        this.levelService = levelService;
        this.triggerRuleService = triggerRuleService;
    }

    @Transactional(readOnly = true)
    public SkillListResponse list(String gameId, @Valid SkillListQuery query) {
        requireGame(gameId);
        SkillListQuery normalized = query == null ? new SkillListQuery(null, null) : query;
        List<Map<String, String>> issues = new ArrayList<>();
        if (normalized.keyword() != null && normalized.keyword().length() > 100) {
            issues.add(fieldIssue("keyword", "LENGTH_INVALID", "关键词不能超过100个字符"));
        }
        String status = normalizeStatus(normalized.status(), issues);
        throwIfInvalid(issues);
        List<SkillRow> rows = mapper.list(gameId, normalized.keyword(), status);
        List<SkillRow> safeRows = rows == null ? List.of() : rows;
        if (safeRows.isEmpty()) {
            return new SkillListResponse(List.of(), 0);
        }
        List<String> skillKeys = safeRows.stream().map(SkillRow::skillKey).toList();
        Map<String, List<String>> categoriesBySkill = groupRelations(mapper.listRelations(gameId, skillKeys));
        List<SkillResponse> items = new ArrayList<>(safeRows.size());
        for (SkillRow row : safeRows) {
            items.add(toResponse(row, categoriesBySkill.getOrDefault(row.skillKey(), List.of())));
        }
        return new SkillListResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public SkillResponse get(String gameId, String skillKey) {
        requireGame(gameId);
        return requireSkill(gameId, skillKey);
    }

    @Transactional
    public SkillResponse create(String gameId, @Valid SkillCreateRequest request) {
        requireGame(gameId);
        List<String> categoryKeys = validateCreate(request);
        if (mapper.countByKey(gameId, request.skillKey()) > 0) {
            throw keyExists();
        }
        lockAndRequireCategories(gameId, categoryKeys, Set.of());
        try {
            mapper.insert(
                gameId,
                request.skillKey(),
                request.name(),
                request.description(),
                request.maxLevel(),
                request.status().name(),
                request.sortOrder()
            );
            insertRelations(gameId, request.skillKey(), categoryKeys);
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireSkill(gameId, request.skillKey());
    }

    @Transactional
    public SkillResponse update(String gameId, String skillKey, @Valid SkillUpdateRequest request) {
        requireGame(gameId);
        SkillRow locked = mapper.findByIdForUpdate(gameId, skillKey);
        if (locked == null) {
            throw notFound(skillKey);
        }
        List<String> currentKeys = mapper.listRelationKeys(gameId, skillKey);
        Set<String> current = new HashSet<>(currentKeys == null ? List.of() : currentKeys);
        List<String> requestedKeys = validateUpdate(request);
        rearrangeSkillLevelParametersIfNeeded(gameId, skillKey, locked.maxLevel(), request.maxLevel());
        lockAndRequireCategories(gameId, requestedKeys, current);
        try {
            if (mapper.update(
                gameId,
                skillKey,
                request.name(),
                request.description(),
                request.maxLevel(),
                request.status().name(),
                request.sortOrder()
            ) == 0) {
                throw notFound(skillKey);
            }
            applyRelationDiff(gameId, skillKey, current, requestedKeys);
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireSkill(gameId, skillKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey) {
        requireGame(gameId);
        if (mapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw notFound(skillKey);
        }
        if (triggerRuleService != null) {
            triggerRuleService.assertSourceSkillNotReferenced(gameId, skillKey);
        }
        if (effectMapper.countExternalSkillScopeReferences(gameId, skillKey) > 0) {
            throw inUse();
        }
        if (triggerRuleService != null) {
            triggerRuleService.deleteAllForSkill(gameId, skillKey);
        }
        effectMapper.deleteLifecycleOperationDetailsForSkill(gameId, skillKey);
        processMapper.deleteAllForSkill(gameId, skillKey);
        effectMapper.deleteAllForSkill(gameId, skillKey);
        internalStateMapper.deleteAllForSkill(gameId, skillKey);
        formulaMapper.deleteAllForSkill(gameId, skillKey);
        parameterMapper.deleteAllForSkill(gameId, skillKey);
        if (mapper.delete(gameId, skillKey) == 0) {
            throw notFound(skillKey);
        }
    }

    private void rearrangeSkillLevelParametersIfNeeded(
        String gameId,
        String skillKey,
        Integer oldMaxLevel,
        Integer newMaxLevel
    ) {
        if (Objects.equals(oldMaxLevel, newMaxLevel)) {
            return;
        }
        List<SkillParameterRow> rows = parameterMapper.lockSkillLevelParamsForSkill(gameId, skillKey);
        if (rows == null || rows.isEmpty()) {
            return;
        }
        for (SkillParameterRow row : rows) {
            Map<String, BigDecimal> previous = levelService.parseLevelValuesJson(row.levelValuesJson());
            Map<String, BigDecimal> remapped = levelService.remap(previous, 1, newMaxLevel);
            String json = levelService.toLevelValuesJson(remapped);
            if (parameterMapper.updateLevelValuesJson(
                gameId,
                skillKey,
                row.parameterKey(),
                json
            ) != 1) {
                throw new IllegalStateException(
                    "Failed to update SKILL_LEVEL parameter map for " + row.parameterKey()
                );
            }
        }
    }

    private SkillResponse requireSkill(String gameId, String skillKey) {
        SkillRow row = mapper.findById(gameId, skillKey);
        if (row == null) {
            throw notFound(skillKey);
        }
        List<SkillCategoryRelationRow> relations = mapper.listRelations(gameId, List.of(skillKey));
        return toResponse(row, categoryKeysOf(relations));
    }

    private void lockAndRequireCategories(
        String gameId,
        List<String> categoryKeys,
        Set<String> currentKeys
    ) {
        if (categoryKeys.isEmpty()) {
            return;
        }
        List<String> lockKeys = new ArrayList<>(categoryKeys);
        lockKeys.sort(String::compareTo);
        List<SkillCategoryLockRow> rows = mapper.lockCategories(gameId, lockKeys);
        Map<String, SkillCategoryLockRow> found = new HashMap<>();
        if (rows != null) {
            for (SkillCategoryLockRow row : rows) {
                found.put(row.skillCategoryKey(), row);
            }
        }
        Integer unknownIndex = null;
        Integer disabledIndex = null;
        for (int i = 0; i < categoryKeys.size(); i++) {
            String key = categoryKeys.get(i);
            SkillCategoryLockRow row = found.get(key);
            if (row == null) {
                unknownIndex = i;
                break;
            }
        }
        if (unknownIndex != null) {
            throw unknownCategory(unknownIndex);
        }
        for (int i = 0; i < categoryKeys.size(); i++) {
            String key = categoryKeys.get(i);
            SkillCategoryLockRow row = found.get(key);
            if (DISABLED.equals(row.status()) && !currentKeys.contains(key)) {
                disabledIndex = i;
                break;
            }
        }
        if (disabledIndex != null) {
            throw disabledCategory(disabledIndex);
        }
    }

    private void insertRelations(
        String gameId,
        String skillKey,
        List<String> categoryKeys
    ) {
        for (String categoryKey : categoryKeys) {
            mapper.insertRelation(gameId, skillKey, categoryKey);
        }
    }

    private void applyRelationDiff(
        String gameId,
        String skillKey,
        Set<String> current,
        List<String> requested
    ) {
        if (requested.isEmpty()) {
            mapper.deleteAllRelations(gameId, skillKey);
            return;
        }
        Set<String> requestedSet = new HashSet<>(requested);
        List<String> removed = new ArrayList<>();
        for (String key : current) {
            if (!requestedSet.contains(key)) {
                removed.add(key);
            }
        }
        if (!removed.isEmpty()) {
            removed.sort(String::compareTo);
            mapper.deleteRelations(gameId, skillKey, removed);
        }
        for (String key : requested) {
            if (!current.contains(key)) {
                mapper.insertRelation(gameId, skillKey, key);
            }
        }
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw new ApiException(
                HttpStatus.NOT_FOUND,
                "404.GAME_NOT_FOUND",
                "游戏不存在",
                Map.of("gameId", gameId == null ? "" : gameId)
            );
        }
    }

    private static List<String> validateCreate(SkillCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能信息不能为空"));
            throwIfInvalid(issues);
            return List.of();
        }
        validateKey(request.skillKey(), issues);
        validateEditable(
            request.name(),
            request.description(),
            request.maxLevel(),
            request.status(),
            request.sortOrder(),
            issues
        );
        List<String> categoryKeys = validateCategoryKeys(request.skillCategoryKeys(), issues);
        throwIfInvalid(issues);
        return categoryKeys;
    }

    private static List<String> validateUpdate(SkillUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能信息不能为空"));
            throwIfInvalid(issues);
            return List.of();
        }
        if (request.skillKey() != null) {
            issues.add(fieldIssue("skillKey", "IMMUTABLE", "技能标识不能修改"));
        }
        validateEditable(
            request.name(),
            request.description(),
            request.maxLevel(),
            request.status(),
            request.sortOrder(),
            issues
        );
        List<String> categoryKeys = validateCategoryKeys(request.skillCategoryKeys(), issues);
        throwIfInvalid(issues);
        return categoryKeys;
    }

    private static void validateKey(String key, List<Map<String, String>> issues) {
        if (key == null || key.isBlank()) {
            issues.add(fieldIssue("skillKey", "REQUIRED", "技能标识不能为空"));
        } else if (!KEY_PATTERN.matcher(key).matches()) {
            issues.add(fieldIssue("skillKey", "FORMAT_INVALID", "技能标识格式不合法"));
        }
    }

    private static void validateEditable(
        String name,
        String description,
        Integer maxLevel,
        SkillStatus status,
        Integer sortOrder,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "技能名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "技能名称不能超过100个字符"));
        }
        if (description != null && description.length() > 2000) {
            issues.add(fieldIssue("description", "LENGTH_INVALID", "说明不能超过2000个字符"));
        }
        if (maxLevel == null) {
            issues.add(fieldIssue("maxLevel", "REQUIRED", "最大等级不能为空"));
        } else if (maxLevel < 1) {
            issues.add(fieldIssue("maxLevel", "RANGE_INVALID", "最大等级不能小于1"));
        }
        if (status == null) {
            issues.add(fieldIssue("status", "REQUIRED", "状态不能为空"));
        }
        if (sortOrder == null) {
            issues.add(fieldIssue("sortOrder", "REQUIRED", "排序不能为空"));
        } else if (sortOrder < 0) {
            issues.add(fieldIssue("sortOrder", "RANGE_INVALID", "排序不能小于0"));
        }
    }

    private static List<String> validateCategoryKeys(List<String> keys, List<Map<String, String>> issues) {
        if (keys == null) {
            issues.add(fieldIssue("skillCategoryKeys", "REQUIRED", "技能分类列表不能缺失"));
            return List.of();
        }
        List<String> validated = new ArrayList<>(keys.size());
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < keys.size(); i++) {
            String key = keys.get(i);
            String field = "/skillCategoryKeys/" + i;
            if (key == null || key.isBlank()) {
                issues.add(fieldIssue(field, "REQUIRED", "技能分类标识不能为空"));
                continue;
            }
            if (!KEY_PATTERN.matcher(key).matches()) {
                issues.add(fieldIssue(field, "FORMAT_INVALID", "技能分类标识格式不合法"));
                continue;
            }
            if (!seen.add(key)) {
                issues.add(fieldIssue(field, "DUPLICATE", "技能分类标识不能重复"));
                continue;
            }
            validated.add(key);
        }
        return validated;
    }

    private static String normalizeStatus(String status, List<Map<String, String>> issues) {
        if (status == null) {
            return null;
        }
        try {
            return SkillStatus.valueOf(status).name();
        } catch (IllegalArgumentException ex) {
            issues.add(fieldIssue("status", "ENUM_INVALID", "状态只允许 ENABLED 或 DISABLED"));
            return null;
        }
    }

    private static Map<String, List<String>> groupRelations(List<SkillCategoryRelationRow> relations) {
        Map<String, List<String>> grouped = new LinkedHashMap<>();
        if (relations == null) {
            return grouped;
        }
        for (SkillCategoryRelationRow relation : relations) {
            grouped.computeIfAbsent(relation.skillKey(), ignored -> new ArrayList<>())
                .add(relation.skillCategoryKey());
        }
        return grouped;
    }

    private static List<String> categoryKeysOf(List<SkillCategoryRelationRow> relations) {
        if (relations == null || relations.isEmpty()) {
            return List.of();
        }
        List<String> keys = new ArrayList<>(relations.size());
        for (SkillCategoryRelationRow relation : relations) {
            keys.add(relation.skillCategoryKey());
        }
        return keys;
    }

    private static SkillResponse toResponse(SkillRow row, List<String> categoryKeys) {
        return new SkillResponse(
            row.gameId(),
            row.skillKey(),
            row.name(),
            row.description(),
            row.maxLevel(),
            row.status(),
            row.sortOrder(),
            categoryKeys == null ? List.of() : categoryKeys,
            row.createdAt(),
            row.updatedAt()
        );
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException notFound(String key) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_NOT_FOUND",
            "技能不存在",
            Map.of("skillKey", key == null ? "" : key)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.SKILL_KEY_EXISTS", "技能标识已存在", "skillKey");
    }

    private static ApiException inUse() {
        return conflict("409.SKILL_IN_USE", "技能已被其他技能的冷却变化或其他技能范围引用，不能删除", "skillKey");
    }

    private static ApiException unknownCategory(int index) {
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.UNKNOWN_SKILL_CATEGORY",
            "技能分类不存在",
            Map.of(
                "fieldIssues",
                List.of(fieldIssue("/skillCategoryKeys/" + index, "UNKNOWN", "技能分类不存在"))
            )
        );
    }

    private static ApiException disabledCategory(int index) {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.SKILL_CATEGORY_DISABLED",
            "技能分类已停用，不能新增关联",
            Map.of(
                "fieldIssues",
                List.of(fieldIssue("/skillCategoryKeys/" + index, "CONFLICT", "技能分类已停用，不能新增关联"))
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
}
