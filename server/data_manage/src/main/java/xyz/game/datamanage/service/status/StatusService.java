package xyz.game.datamanage.service.status;

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
import xyz.game.datamanage.mapper.status.StatusMapper;
import xyz.game.datamanage.model.status.StatusCreateRequest;
import xyz.game.datamanage.model.status.StatusListQuery;
import xyz.game.datamanage.model.status.StatusListResponse;
import xyz.game.datamanage.model.status.StatusRecordStatus;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.model.status.StatusUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class StatusService {

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_statuses";
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_statuses_name";

    private final GamesMapper gamesMapper;
    private final StatusMapper mapper;

    public StatusService(GamesMapper gamesMapper, StatusMapper mapper) {
        this.gamesMapper = gamesMapper;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public StatusListResponse list(String gameId, @Valid StatusListQuery query) {
        requireGame(gameId);
        StatusListQuery normalized = query == null
            ? new StatusListQuery(null, null)
            : query;
        List<Map<String, String>> issues = new ArrayList<>();
        if (normalized.keyword() != null && normalized.keyword().length() > 100) {
            issues.add(fieldIssue("keyword", "LENGTH_INVALID", "关键词不能超过100个字符"));
        }
        String status = normalizeStatus(normalized.status(), issues);
        throwIfInvalid(issues);
        List<StatusResponse> items = mapper.list(gameId, normalized.keyword(), status);
        List<StatusResponse> safeItems = items == null ? List.of() : items;
        return new StatusListResponse(safeItems, safeItems.size());
    }

    @Transactional(readOnly = true)
    public StatusResponse get(String gameId, String statusKey) {
        requireGame(gameId);
        return requireStatus(gameId, statusKey);
    }

    @Transactional
    public StatusResponse create(String gameId, @Valid StatusCreateRequest request) {
        requireGame(gameId);
        validateCreate(request);
        if (mapper.countByKey(gameId, request.statusKey()) > 0) {
            throw keyExists();
        }
        if (mapper.countByNormalizedName(gameId, request.name(), null) > 0) {
            throw nameExists();
        }
        try {
            mapper.insert(
                gameId,
                request.statusKey(),
                request.name(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireStatus(gameId, request.statusKey());
    }

    @Transactional
    public StatusResponse update(
        String gameId,
        String statusKey,
        @Valid StatusUpdateRequest request
    ) {
        requireGame(gameId);
        validateUpdate(request);
        if (mapper.findByIdForUpdate(gameId, statusKey) == null) {
            throw notFound(statusKey);
        }
        if (mapper.countByNormalizedName(gameId, request.name(), statusKey) > 0) {
            throw nameExists();
        }
        try {
            if (mapper.update(
                gameId,
                statusKey,
                request.name(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            ) == 0) {
                throw notFound(statusKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireStatus(gameId, statusKey);
    }

    @Transactional
    public void delete(String gameId, String statusKey) {
        requireGame(gameId);
        if (mapper.findByIdForUpdate(gameId, statusKey) == null) {
            throw notFound(statusKey);
        }
        try {
            if (mapper.delete(gameId, statusKey) == 0) {
                throw notFound(statusKey);
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

    private StatusResponse requireStatus(String gameId, String statusKey) {
        StatusResponse response = mapper.findById(gameId, statusKey);
        if (response == null) {
            throw notFound(statusKey);
        }
        return response;
    }

    private static void validateCreate(StatusCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "状态信息不能为空"));
        } else {
            validateKey(request.statusKey(), issues);
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

    private static void validateUpdate(StatusUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "状态信息不能为空"));
        } else {
            if (request.statusKey() != null) {
                issues.add(fieldIssue("statusKey", "IMMUTABLE", "状态标识不能修改"));
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
            issues.add(fieldIssue("statusKey", "REQUIRED", "状态标识不能为空"));
        } else if (!KEY_PATTERN.matcher(key).matches()) {
            issues.add(fieldIssue("statusKey", "FORMAT_INVALID", "状态标识格式不合法"));
        }
    }

    private static void validateEditable(
        String name,
        String description,
        StatusRecordStatus status,
        Integer sortOrder,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "状态名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "状态名称不能超过100个字符"));
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
            return StatusRecordStatus.valueOf(status).name();
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
                "状态信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException notFound(String key) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.STATUS_NOT_FOUND",
            "状态不存在",
            Map.of("statusKey", key == null ? "" : key)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.STATUS_KEY_EXISTS", "状态标识已存在", "statusKey");
    }

    private static ApiException nameExists() {
        return conflict("409.STATUS_NAME_EXISTS", "状态名称已存在", "name");
    }

    private static ApiException inUse() {
        return conflict("409.STATUS_IN_USE", "状态已被引用，不能删除", "statusKey");
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
