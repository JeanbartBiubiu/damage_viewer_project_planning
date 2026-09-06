package xyz.game.datamanage.service.equipment;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.DecimalNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
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
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.equipment.EquipmentAttributeDefinition;
import xyz.game.datamanage.model.equipment.EquipmentAttributesRequest;
import xyz.game.datamanage.model.equipment.EquipmentAttributesResponse;
import xyz.game.datamanage.model.equipment.EquipmentCreateRequest;
import xyz.game.datamanage.model.equipment.EquipmentListQuery;
import xyz.game.datamanage.model.equipment.EquipmentListResponse;
import xyz.game.datamanage.model.equipment.EquipmentResponse;
import xyz.game.datamanage.model.equipment.EquipmentUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class EquipmentService {

    private static final Pattern EQUIPMENT_KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_equipment";
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_equipment_name";

    private final GamesMapper gamesMapper;
    private final EquipmentMapper equipmentMapper;
    private final ObjectMapper objectMapper;
    private final ImageRelationMapper imageRelationMapper;

    public EquipmentService(
        GamesMapper gamesMapper,
        EquipmentMapper equipmentMapper,
        ObjectMapper objectMapper,
        ImageRelationMapper imageRelationMapper
    ) {
        this.gamesMapper = gamesMapper;
        this.equipmentMapper = equipmentMapper;
        this.objectMapper = objectMapper;
        this.imageRelationMapper = imageRelationMapper;
    }

    @Transactional(readOnly = true)
    public EquipmentListResponse list(String gameId, @Valid EquipmentListQuery query) {
        requireGame(gameId);
        EquipmentListQuery normalized = query == null ? new EquipmentListQuery(null) : query;
        List<EquipmentResponse> items = equipmentMapper.list(gameId, normalized.keyword());
        List<EquipmentResponse> safeItems = items == null ? List.of() : items;
        return new EquipmentListResponse(safeItems, safeItems.size());
    }

    @Transactional(readOnly = true)
    public EquipmentResponse get(String gameId, String equipmentKey) {
        requireGame(gameId);
        return requireEquipment(gameId, equipmentKey);
    }

    @Transactional
    public EquipmentResponse create(String gameId, @Valid EquipmentCreateRequest request) {
        requireGame(gameId);
        validateCreateRequest(request);
        if (equipmentMapper.countByKey(gameId, request.equipmentKey()) > 0) {
            throw equipmentKeyExists();
        }
        if (equipmentMapper.countByNormalizedName(gameId, request.name(), null) > 0) {
            throw equipmentNameExists();
        }
        try {
            equipmentMapper.insertEquipment(
                gameId,
                request.equipmentKey(),
                request.name(),
                request.description()
            );
            equipmentMapper.insertAttributeValues(gameId, request.equipmentKey(), "{}");
        } catch (DataIntegrityViolationException ex) {
            throw mapUniqueConstraint(ex);
        }
        return requireEquipment(gameId, request.equipmentKey());
    }

    @Transactional
    public EquipmentResponse update(
        String gameId,
        String equipmentKey,
        @Valid EquipmentUpdateRequest request
    ) {
        requireGame(gameId);
        validateUpdateRequest(request);
        if (equipmentMapper.findByIdForUpdate(gameId, equipmentKey) == null) {
            throw equipmentNotFound(equipmentKey);
        }
        if (equipmentMapper.countByNormalizedName(gameId, request.name(), equipmentKey) > 0) {
            throw equipmentNameExists();
        }
        try {
            if (equipmentMapper.updateEquipment(
                gameId,
                equipmentKey,
                request.name(),
                request.description()
            ) == 0) {
                throw equipmentNotFound(equipmentKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapUniqueConstraint(ex);
        }
        return requireEquipment(gameId, equipmentKey);
    }

    @Transactional
    public void delete(String gameId, String equipmentKey) {
        requireGame(gameId);
        if (equipmentMapper.deleteEquipment(gameId, equipmentKey) == 0) {
            throw equipmentNotFound(equipmentKey);
        }
        imageRelationMapper.deleteForSource(gameId, "EQUIPMENT", "", equipmentKey);
    }

    @Transactional(readOnly = true)
    public EquipmentAttributesResponse getAttributes(String gameId, String equipmentKey) {
        requireGame(gameId);
        requireEquipment(gameId, equipmentKey);
        JsonNode stored = parseStored(equipmentMapper.findAttributeValuesJson(gameId, equipmentKey));
        ObjectNode materialized = materializeKnownValues(stored, attributeDefinitions(gameId));
        return new EquipmentAttributesResponse(equipmentKey, materialized);
    }

    @Transactional
    public EquipmentAttributesResponse updateAttributes(
        String gameId,
        String equipmentKey,
        @Valid EquipmentAttributesRequest request
    ) {
        requireGame(gameId);
        if (equipmentMapper.findByIdForUpdate(gameId, equipmentKey) == null) {
            throw equipmentNotFound(equipmentKey);
        }
        JsonNode raw = request == null ? null : request.attributeValues();
        ObjectNode normalized = normalizeForWrite(raw, attributeDefinitions(gameId));
        String json = toJson(normalized);
        if (equipmentMapper.updateAttributeValues(gameId, equipmentKey, json) == 0) {
            equipmentMapper.insertAttributeValues(gameId, equipmentKey, json);
        }
        return new EquipmentAttributesResponse(equipmentKey, normalized);
    }

    private ObjectNode normalizeForWrite(JsonNode raw, List<EquipmentAttributeDefinition> definitions) {
        if (raw == null || !raw.isObject()) {
            throw validationFailed("attributeValues", "OBJECT_REQUIRED", "装备属性必须是对象");
        }
        Map<String, EquipmentAttributeDefinition> byKey = new HashMap<>();
        definitions.forEach(definition -> byKey.put(definition.attributeKey(), definition));
        raw.fieldNames().forEachRemaining(attributeKey -> {
            if (!byKey.containsKey(attributeKey)) {
                throw unknownAttribute(attributeKey);
            }
        });

        ObjectNode result = objectMapper.createObjectNode();
        List<Map<String, String>> issues = new ArrayList<>();
        for (EquipmentAttributeDefinition definition : definitions) {
            JsonNode valueNode = raw.get(definition.attributeKey());
            if (valueNode == null) {
                continue;
            }
            String path = "/attributeValues/" + definition.attributeKey();
            if (!valueNode.isNumber()) {
                issues.add(fieldIssue(path, "NUMBER_REQUIRED", "属性值必须是数字"));
                continue;
            }
            BigDecimal value = valueNode.decimalValue();
            validateValue(definition, value, path, issues);
            result.set(definition.attributeKey(), DecimalNode.valueOf(value));
        }
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.ATTRIBUTE_VALUE_INVALID",
                "装备属性值不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
        return result;
    }

    private ObjectNode materializeKnownValues(
        JsonNode stored,
        List<EquipmentAttributeDefinition> definitions
    ) {
        ObjectNode result = objectMapper.createObjectNode();
        if (stored == null || !stored.isObject()) {
            return result;
        }
        for (EquipmentAttributeDefinition definition : definitions) {
            JsonNode value = stored.get(definition.attributeKey());
            if (value != null && value.isNumber()) {
                result.set(definition.attributeKey(), DecimalNode.valueOf(value.decimalValue()));
            }
        }
        return result;
    }

    private static void validateValue(
        EquipmentAttributeDefinition definition,
        BigDecimal value,
        String path,
        List<Map<String, String>> issues
    ) {
        if (definition.valueType() == AttributeValueType.INTEGER && value.stripTrailingZeros().scale() > 0) {
            issues.add(fieldIssue(path, "INTEGER_REQUIRED", "该属性只允许整数"));
        }
        if (definition.minValue() != null && value.compareTo(definition.minValue()) < 0) {
            issues.add(fieldIssue(path, "RANGE_INVALID", "属性值小于最小值"));
        }
        if (definition.maxValue() != null && value.compareTo(definition.maxValue()) > 0) {
            issues.add(fieldIssue(path, "RANGE_INVALID", "属性值大于最大值"));
        }
    }

    private List<EquipmentAttributeDefinition> attributeDefinitions(String gameId) {
        List<EquipmentAttributeDefinition> definitions = equipmentMapper.listAttributeDefinitions(gameId);
        return definitions == null ? List.of() : definitions;
    }

    private JsonNode parseStored(String raw) {
        if (raw == null || raw.isBlank()) {
            return objectMapper.createObjectNode();
        }
        try {
            JsonNode parsed = objectMapper.readTree(raw);
            return parsed != null && parsed.isObject() ? parsed : objectMapper.createObjectNode();
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Stored equipment attributes are not valid JSON", ex);
        }
    }

    private String toJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not serialize equipment attributes", ex);
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

    private EquipmentResponse requireEquipment(String gameId, String equipmentKey) {
        EquipmentResponse response = equipmentMapper.findById(gameId, equipmentKey);
        if (response == null) {
            throw equipmentNotFound(equipmentKey);
        }
        return response;
    }

    private static void validateCreateRequest(EquipmentCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "装备信息不能为空"));
        } else {
            if (request.equipmentKey() == null || request.equipmentKey().isBlank()) {
                issues.add(fieldIssue("equipmentKey", "REQUIRED", "装备标识不能为空"));
            } else if (!EQUIPMENT_KEY_PATTERN.matcher(request.equipmentKey()).matches()) {
                issues.add(fieldIssue("equipmentKey", "FORMAT_INVALID", "装备标识格式不合法"));
            }
            validateEditable(request.name(), request.description(), issues);
        }
        throwIfInvalid(issues);
    }

    private static void validateUpdateRequest(EquipmentUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "装备信息不能为空"));
        } else {
            if (request.equipmentKey() != null) {
                issues.add(fieldIssue("equipmentKey", "IMMUTABLE", "装备标识不能修改"));
            }
            validateEditable(request.name(), request.description(), issues);
        }
        throwIfInvalid(issues);
    }

    private static void validateEditable(
        String name,
        String description,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "装备名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "装备名称不能超过100个字符"));
        }
        if (description != null && description.length() > 2000) {
            issues.add(fieldIssue("description", "LENGTH_INVALID", "说明不能超过2000个字符"));
        }
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "装备信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException validationFailed(String field, String code, String message) {
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.VALIDATION_FAILED",
            "装备属性格式不合法",
            Map.of("fieldIssues", List.of(fieldIssue(field, code, message)))
        );
    }

    private static ApiException unknownAttribute(String attributeKey) {
        String field = "/attributeValues/" + attributeKey;
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.UNKNOWN_ATTRIBUTE",
            "存在未定义的属性",
            Map.of("fieldIssues", List.of(fieldIssue(field, "UNKNOWN_ATTRIBUTE", "属性未定义")))
        );
    }

    private static ApiException equipmentNotFound(String equipmentKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.EQUIPMENT_NOT_FOUND",
            "装备不存在",
            Map.of("equipmentKey", equipmentKey == null ? "" : equipmentKey)
        );
    }

    private static ApiException equipmentKeyExists() {
        return conflict("409.EQUIPMENT_KEY_EXISTS", "装备标识已存在", "equipmentKey");
    }

    private static ApiException equipmentNameExists() {
        return conflict("409.EQUIPMENT_NAME_EXISTS", "装备名称已存在", "name");
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
            return equipmentKeyExists();
        }
        if (constraintText.contains(NAME_UNIQUE_CONSTRAINT)) {
            return equipmentNameExists();
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
