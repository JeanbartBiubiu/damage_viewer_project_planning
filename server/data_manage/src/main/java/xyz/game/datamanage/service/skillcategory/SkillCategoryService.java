package xyz.game.datamanage.service.skillcategory;

import jakarta.validation.Valid;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skillcategory.SkillCategoryMapper;
import xyz.game.datamanage.model.skillcategory.SkillCategoryCreateRequest;
import xyz.game.datamanage.model.skillcategory.SkillCategoryListQuery;
import xyz.game.datamanage.model.skillcategory.SkillCategoryListResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryStatus;
import xyz.game.datamanage.model.skillcategory.SkillCategoryUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillCategoryService {

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_categories";
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_skill_categories_name";

    private final GamesMapper gamesMapper;
    private final SkillCategoryMapper mapper;

    public SkillCategoryService(GamesMapper gamesMapper, SkillCategoryMapper mapper) {
        this.gamesMapper = gamesMapper;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public SkillCategoryListResponse list(String gameId, @Valid SkillCategoryListQuery query) {
        requireGame(gameId);
        SkillCategoryListQuery normalized = query == null
            ? new SkillCategoryListQuery(null, null)
            : query;
        List<Map<String, String>> issues = new ArrayList<>();
        if (normalized.keyword() != null && normalized.keyword().length() > 100) {
            issues.add(fieldIssue("keyword", "LENGTH_INVALID", "关键词不能超过100个字符"));
        }
        String status = normalizeStatus(normalized.status(), issues);
        throwIfInvalid(issues);
        List<SkillCategoryResponse> items = mapper.list(gameId, normalized.keyword(), status);
        List<SkillCategoryResponse> safeItems = items == null ? List.of() : items;
        return new SkillCategoryListResponse(safeItems, safeItems.size());
    }

    @Transactional(readOnly = true)
    public SkillCategoryResponse get(String gameId, String skillCategoryKey) {
        requireGame(gameId);
        return requireCategory(gameId, skillCategoryKey);
    }

    @Transactional
    public SkillCategoryResponse create(String gameId, @Valid SkillCategoryCreateRequest request) {
        requireGame(gameId);
        validateCreate(request);
        if (mapper.countByKey(gameId, request.skillCategoryKey()) > 0) {
            throw keyExists();
        }
        if (mapper.countByNormalizedName(gameId, request.name(), null) > 0) {
            throw nameExists();
        }
        try {
            mapper.insert(
                gameId,
                request.skillCategoryKey(),
                request.name(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireCategory(gameId, request.skillCategoryKey());
    }

    @Transactional
    public SkillCategoryResponse update(
        String gameId,
        String skillCategoryKey,
        @Valid SkillCategoryUpdateRequest request
    ) {
        requireGame(gameId);
        validateUpdate(request);
        if (mapper.findByIdForUpdate(gameId, skillCategoryKey) == null) {
            throw notFound(skillCategoryKey);
        }
        if (mapper.countByNormalizedName(gameId, request.name(), skillCategoryKey) > 0) {
            throw nameExists();
        }
        try {
            if (mapper.update(
                gameId,
                skillCategoryKey,
                request.name(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            ) == 0) {
                throw notFound(skillCategoryKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireCategory(gameId, skillCategoryKey);
    }

    @Transactional
    public void delete(String gameId, String skillCategoryKey) {
        requireGame(gameId);
        if (mapper.findByIdForUpdate(gameId, skillCategoryKey) == null) {
            throw notFound(skillCategoryKey);
        }
        try {
            if (mapper.delete(gameId, skillCategoryKey) == 0) {
                throw notFound(skillCategoryKey);
            }
        } catch (DataIntegrityViolationException ex) {
            if (hasSqlState(ex, "23503") || hasSqlState(ex, "23001")) {
                throw inUse();
            }
            throw ex;
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

    private SkillCategoryResponse requireCategory(String gameId, String skillCategoryKey) {
        SkillCategoryResponse response = mapper.findById(gameId, skillCategoryKey);
        if (response == null) {
            throw notFound(skillCategoryKey);
        }
        return response;
    }

    private static void validateCreate(SkillCategoryCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能分类信息不能为空"));
        } else {
            validateKey(request.skillCategoryKey(), issues);
            validateEditable(
                request.name(),
                request.description(),
                request.status(),
                request.sortOrder(),
                issues
            );
        }
        throwIfInvalid(issues);
    }

    private static void validateUpdate(SkillCategoryUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能分类信息不能为空"));
        } else {
            if (request.skillCategoryKey() != null) {
                issues.add(fieldIssue("skillCategoryKey", "IMMUTABLE", "技能分类标识不能修改"));
            }
            validateEditable(
                request.name(),
                request.description(),
                request.status(),
                request.sortOrder(),
                issues
            );
        }
        throwIfInvalid(issues);
    }

    private static void validateKey(String key, List<Map<String, String>> issues) {
        if (key == null || key.isBlank()) {
            issues.add(fieldIssue("skillCategoryKey", "REQUIRED", "技能分类标识不能为空"));
        } else if (!KEY_PATTERN.matcher(key).matches()) {
            issues.add(fieldIssue("skillCategoryKey", "FORMAT_INVALID", "技能分类标识格式不合法"));
        }
    }

    private static void validateEditable(
        String name,
        String description,
        SkillCategoryStatus status,
        Integer sortOrder,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "技能分类名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "技能分类名称不能超过100个字符"));
        }
        if (description != null && description.length() > 2000) {
            issues.add(fieldIssue("description", "LENGTH_INVALID", "说明不能超过2000个字符"));
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

    private static String normalizeStatus(String status, List<Map<String, String>> issues) {
        if (status == null) {
            return null;
        }
        try {
            return SkillCategoryStatus.valueOf(status).name();
        } catch (IllegalArgumentException ex) {
            issues.add(fieldIssue("status", "ENUM_INVALID", "状态只允许 ENABLED 或 DISABLED"));
            return null;
        }
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能分类信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException notFound(String key) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_CATEGORY_NOT_FOUND",
            "技能分类不存在",
            Map.of("skillCategoryKey", key == null ? "" : key)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.SKILL_CATEGORY_KEY_EXISTS", "技能分类标识已存在", "skillCategoryKey");
    }

    private static ApiException nameExists() {
        return conflict("409.SKILL_CATEGORY_NAME_EXISTS", "技能分类名称已存在", "name");
    }

    private static ApiException inUse() {
        return conflict("409.SKILL_CATEGORY_IN_USE", "技能分类已被引用，不能删除", "skillCategoryKey");
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
        if (text.contains(NAME_UNIQUE_CONSTRAINT)) {
            return nameExists();
        }
        return ex;
    }

    private static boolean hasSqlState(Throwable throwable, String state) {
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (current instanceof SQLException sqlException && state.equals(sqlException.getSQLState())) {
                return true;
            }
        }
        return false;
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
