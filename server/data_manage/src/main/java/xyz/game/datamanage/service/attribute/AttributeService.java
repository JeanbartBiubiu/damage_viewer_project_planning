package xyz.game.datamanage.service.attribute;

import jakarta.validation.Valid;
import java.math.BigDecimal;
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
import xyz.game.datamanage.mapper.attribute.AttributeMapper;
import xyz.game.datamanage.model.attribute.AttributeCreateRequest;
import xyz.game.datamanage.model.attribute.AttributeListQuery;
import xyz.game.datamanage.model.attribute.AttributeListResponse;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.attribute.AttributeUpdateRequest;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class AttributeService {

    private static final Pattern ATTRIBUTE_KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_attributes";
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_attributes_name";

    private final GamesMapper gamesMapper;
    private final AttributeMapper attributeMapper;

    public AttributeService(GamesMapper gamesMapper, AttributeMapper attributeMapper) {
        this.gamesMapper = gamesMapper;
        this.attributeMapper = attributeMapper;
    }

    @Transactional(readOnly = true)
    public AttributeListResponse list(String gameId, @Valid AttributeListQuery query) {
        requireGame(gameId);
        AttributeListQuery normalizedQuery = query == null ? new AttributeListQuery(null, null) : query;
        List<Map<String, String>> issues = new ArrayList<>();
        if (normalizedQuery.keyword() != null && normalizedQuery.keyword().length() > 100) {
            issues.add(fieldIssue("keyword", "LENGTH_INVALID", "关键词不能超过100个字符"));
        }
        String normalizedStatus = normalizeStatus(normalizedQuery.status(), issues);
        throwIfInvalid(issues);

        List<AttributeResponse> items = attributeMapper.list(
            gameId,
            normalizedQuery.keyword(),
            normalizedStatus
        );
        List<AttributeResponse> safeItems = items == null ? List.of() : items;
        return new AttributeListResponse(safeItems, safeItems.size());
    }

    @Transactional(readOnly = true)
    public AttributeResponse get(String gameId, String attributeKey) {
        requireGame(gameId);
        AttributeResponse response = attributeMapper.findById(gameId, attributeKey);
        if (response == null) {
            throw attributeNotFound(attributeKey);
        }
        return response;
    }

    @Transactional
    public AttributeResponse create(String gameId, @Valid AttributeCreateRequest request) {
        requireGame(gameId);
        validateCreateRequest(request);

        if (attributeMapper.countByKey(gameId, request.attributeKey()) > 0) {
            throw attributeKeyExists();
        }
        if (attributeMapper.countByNormalizedName(gameId, request.name(), null) > 0) {
            throw attributeNameExists();
        }

        try {
            attributeMapper.insert(
                gameId,
                request.attributeKey(),
                request.name(),
                request.valueType().name(),
                request.minValue(),
                request.maxValue(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapUniqueConstraint(ex);
        }

        AttributeResponse response = attributeMapper.findById(gameId, request.attributeKey());
        if (response == null) {
            throw new IllegalStateException("Created attribute could not be read back");
        }
        return response;
    }

    @Transactional
    public AttributeResponse update(String gameId, String attributeKey, @Valid AttributeUpdateRequest request) {
        requireGame(gameId);
        validateUpdateRequest(request);

        AttributeResponse existing = attributeMapper.findByIdForUpdate(gameId, attributeKey);
        if (existing == null) {
            throw attributeNotFound(attributeKey);
        }
        if (attributeMapper.countByNormalizedName(gameId, request.name(), attributeKey) > 0) {
            throw attributeNameExists();
        }

        try {
            int updated = attributeMapper.update(
                gameId,
                attributeKey,
                request.name(),
                request.valueType().name(),
                request.minValue(),
                request.maxValue(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            );
            if (updated == 0) {
                throw attributeNotFound(attributeKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapUniqueConstraint(ex);
        }

        AttributeResponse response = attributeMapper.findById(gameId, attributeKey);
        if (response == null) {
            throw attributeNotFound(attributeKey);
        }
        return response;
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

    private static void validateCreateRequest(AttributeCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "属性信息不能为空"));
            throwIfInvalid(issues);
            return;
        }
        validateAttributeKey(request.attributeKey(), issues);
        validateEditableFields(
            request.name(),
            request.valueType(),
            request.minValue(),
            request.maxValue(),
            request.description(),
            request.status(),
            request.sortOrder(),
            issues
        );
        throwIfInvalid(issues);
    }

    private static void validateUpdateRequest(AttributeUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "属性信息不能为空"));
            throwIfInvalid(issues);
            return;
        }
        if (request.attributeKey() != null) {
            issues.add(fieldIssue("attributeKey", "IMMUTABLE", "稳定标识不能在修改时传入"));
        }
        validateEditableFields(
            request.name(),
            request.valueType(),
            request.minValue(),
            request.maxValue(),
            request.description(),
            request.status(),
            request.sortOrder(),
            issues
        );
        throwIfInvalid(issues);
    }

    private static void validateAttributeKey(String attributeKey, List<Map<String, String>> issues) {
        if (attributeKey == null || attributeKey.isBlank()) {
            issues.add(fieldIssue("attributeKey", "REQUIRED", "稳定标识不能为空"));
        } else if (!ATTRIBUTE_KEY_PATTERN.matcher(attributeKey).matches()) {
            issues.add(fieldIssue("attributeKey", "FORMAT_INVALID", "稳定标识格式不合法"));
        }
    }

    private static void validateEditableFields(
        String name,
        AttributeValueType valueType,
        BigDecimal minValue,
        BigDecimal maxValue,
        String description,
        AttributeStatus status,
        Integer sortOrder,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "名称不能超过100个字符"));
        }
        if (valueType == null) {
            issues.add(fieldIssue("valueType", "REQUIRED", "数值类型不能为空或不受支持"));
        }
        if (description != null && description.length() > 2000) {
            issues.add(fieldIssue("description", "LENGTH_INVALID", "描述不能超过2000个字符"));
        }
        if (status == null) {
            issues.add(fieldIssue("status", "REQUIRED", "状态不能为空或不受支持"));
        }
        if (sortOrder == null) {
            issues.add(fieldIssue("sortOrder", "REQUIRED", "排序不能为空"));
        } else if (sortOrder < 0) {
            issues.add(fieldIssue("sortOrder", "RANGE_INVALID", "排序不能小于0"));
        }
        if (minValue != null && maxValue != null && minValue.compareTo(maxValue) > 0) {
            issues.add(fieldIssue("maxValue", "RANGE_INVALID", "最大值不能小于最小值"));
        }
    }

    private static String normalizeStatus(String status, List<Map<String, String>> issues) {
        if (status == null) {
            return null;
        }
        try {
            return AttributeStatus.valueOf(status).name();
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
                "属性信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static Map<String, String> fieldIssue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static ApiException attributeNotFound(String attributeKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.ATTRIBUTE_NOT_FOUND",
            "属性不存在",
            Map.of("attributeKey", attributeKey == null ? "" : attributeKey)
        );
    }

    private static ApiException attributeKeyExists() {
        return conflict(
            "409.ATTRIBUTE_KEY_EXISTS",
            "稳定标识已存在",
            "attributeKey"
        );
    }

    private static ApiException attributeNameExists() {
        return conflict(
            "409.ATTRIBUTE_NAME_EXISTS",
            "属性名称已存在",
            "name"
        );
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of("fieldIssues", List.of(fieldIssue(field, "ALREADY_EXISTS", message)))
        );
    }

    private static RuntimeException mapUniqueConstraint(DataIntegrityViolationException ex) {
        String constraintText = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (constraintText.contains(PRIMARY_KEY_CONSTRAINT)) {
            return attributeKeyExists();
        }
        if (constraintText.contains(NAME_UNIQUE_CONSTRAINT)) {
            return attributeNameExists();
        }
        return ex;
    }

    private static String collectCauseMessages(Throwable throwable) {
        StringBuilder result = new StringBuilder();
        Throwable current = throwable;
        while (current != null) {
            if (current.getMessage() != null) {
                result.append(' ').append(current.getMessage());
            }
            current = current.getCause();
        }
        return result.toString();
    }
}
