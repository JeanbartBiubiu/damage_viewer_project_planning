package xyz.game.datamanage.service.damagetype;

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
import xyz.game.datamanage.mapper.damagetype.DamageTypeMapper;
import xyz.game.datamanage.model.damagetype.DamageTypeCreateRequest;
import xyz.game.datamanage.model.damagetype.DamageTypeListQuery;
import xyz.game.datamanage.model.damagetype.DamageTypeListResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeResponse;
import xyz.game.datamanage.model.damagetype.DamageTypeStatus;
import xyz.game.datamanage.model.damagetype.DamageTypeUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class DamageTypeService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_damage_types";
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_damage_types_name";

    private final GamesMapper gamesMapper;
    private final DamageTypeMapper mapper;

    public DamageTypeService(GamesMapper gamesMapper, DamageTypeMapper mapper,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.mapper = mapper;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public DamageTypeListResponse list(String gameId, @Valid DamageTypeListQuery query) {
        requireGame(gameId);
        DamageTypeListQuery normalized = query == null
            ? new DamageTypeListQuery(null, null)
            : query;
        List<Map<String, String>> issues = new ArrayList<>();
        if (normalized.keyword() != null && normalized.keyword().length() > 100) {
            issues.add(fieldIssue("keyword", "LENGTH_INVALID", "关键词不能超过100个字符"));
        }
        String status = normalizeStatus(normalized.status(), issues);
        throwIfInvalid(issues);
        List<DamageTypeResponse> items = mapper.list(gameId, normalized.keyword(), status);
        List<DamageTypeResponse> safeItems = items == null ? List.of() : items;
        return new DamageTypeListResponse(safeItems, safeItems.size());
    }

    @Transactional(readOnly = true)
    public DamageTypeResponse get(String gameId, String damageTypeKey) {
        requireGame(gameId);
        return requireDamageType(gameId, damageTypeKey);
    }

    @Transactional
    public DamageTypeResponse create(String gameId, @Valid DamageTypeCreateRequest request) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateCreate(request);
        if (mapper.countByKey(gameId, request.damageTypeKey()) > 0) {
            throw keyExists();
        }
        if (mapper.countByNormalizedName(gameId, request.name(), null) > 0) {
            throw nameExists();
        }
        try {
            mapper.insert(
                gameId,
                request.damageTypeKey(),
                request.name(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDamageType(gameId, request.damageTypeKey());
    }

    @Transactional
    public DamageTypeResponse update(
        String gameId,
        String damageTypeKey,
        @Valid DamageTypeUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateUpdate(request);
        if (mapper.findByIdForUpdate(gameId, damageTypeKey) == null) {
            throw notFound(damageTypeKey);
        }
        if (mapper.countByNormalizedName(gameId, request.name(), damageTypeKey) > 0) {
            throw nameExists();
        }
        try {
            if (mapper.update(
                gameId,
                damageTypeKey,
                request.name(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            ) == 0) {
                throw notFound(damageTypeKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDamageType(gameId, damageTypeKey);
    }

    @Transactional
    public void delete(String gameId, String damageTypeKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        if (mapper.findByIdForUpdate(gameId, damageTypeKey) == null) {
            throw notFound(damageTypeKey);
        }
        configurationWrites.assertNotReferenced(gameId, "DAMAGE_TYPE", "", damageTypeKey,
            "409.DAMAGE_TYPE_IN_USE", "伤害类型已被引用，不能删除");
        try {
            if (mapper.delete(gameId, damageTypeKey) == 0) {
                throw notFound(damageTypeKey);
            }
        } catch (DataIntegrityViolationException ex) {
            if (hasSqlState(ex, "23503")) {
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

    private DamageTypeResponse requireDamageType(String gameId, String damageTypeKey) {
        DamageTypeResponse response = mapper.findById(gameId, damageTypeKey);
        if (response == null) {
            throw notFound(damageTypeKey);
        }
        return response;
    }

    private static void validateCreate(DamageTypeCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "伤害类型信息不能为空"));
        } else {
            validateKey(request.damageTypeKey(), issues);
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

    private static void validateUpdate(DamageTypeUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "伤害类型信息不能为空"));
        } else {
            if (request.damageTypeKey() != null) {
                issues.add(fieldIssue("damageTypeKey", "IMMUTABLE", "伤害类型标识不能修改"));
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
            issues.add(fieldIssue("damageTypeKey", "REQUIRED", "伤害类型标识不能为空"));
        } else if (!KEY_PATTERN.matcher(key).matches()) {
            issues.add(fieldIssue("damageTypeKey", "FORMAT_INVALID", "伤害类型标识格式不合法"));
        }
    }

    private static void validateEditable(
        String name,
        String description,
        DamageTypeStatus status,
        Integer sortOrder,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "伤害类型名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "伤害类型名称不能超过100个字符"));
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
            return DamageTypeStatus.valueOf(status).name();
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
                "伤害类型信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException notFound(String key) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.DAMAGE_TYPE_NOT_FOUND",
            "伤害类型不存在",
            Map.of("damageTypeKey", key == null ? "" : key)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.DAMAGE_TYPE_KEY_EXISTS", "伤害类型标识已存在", "damageTypeKey");
    }

    private static ApiException nameExists() {
        return conflict("409.DAMAGE_TYPE_NAME_EXISTS", "伤害类型名称已存在", "name");
    }

    private static ApiException inUse() {
        return conflict("409.DAMAGE_TYPE_IN_USE", "伤害类型已被引用，不能删除", "damageTypeKey");
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
