package xyz.game.datamanage.service.combatdata.support;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.support.error.ApiException;

/**
 * Shared combat-data helpers: game guard, revision envelope, body validation, row mapping.
 */
@Component
public class CombatDataSupport {

    private static final Set<String> FORBIDDEN_SERVER_FIELDS = Set.of(
        "changerevision",
        "currentrevision",
        "publishedrevision",
        "versionid",
        "versioncode",
        "startversionid",
        "endversionid",
        "iscurrent",
        "datahash",
        "change_revision",
        "current_revision",
        "published_revision",
        "version_id",
        "version_code",
        "start_version_id",
        "end_version_id",
        "is_current",
        "data_hash",
        "updatedat",
        "updated_at"
    );

    private final ObjectMapper objectMapper;
    private final GamesMapper gamesMapper;
    private final GameDataRevisionService revisionService;

    public CombatDataSupport(
        ObjectMapper objectMapper,
        GamesMapper gamesMapper,
        GameDataRevisionService revisionService
    ) {
        this.objectMapper = objectMapper;
        this.gamesMapper = gamesMapper;
        this.revisionService = revisionService;
    }

    public void requireGame(String gameId) {
        if (gameId == null || gameId.isBlank()) {
            throw badRequest("gameId is required", Map.of("path", "/gameId"));
        }
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw notFound("Game not found", Map.of("gameId", gameId));
        }
    }

    public long currentRevision(String gameId) {
        return revisionService.getCurrentRevision(gameId);
    }

    public ObjectNode publicEnvelope(String gameId, JsonNode data) {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", gameId);
        response.put("currentRevision", currentRevision(gameId));
        response.set("data", data == null || data.isNull() ? JsonNodeFactory.instance.nullNode() : data);
        return response;
    }

    public ObjectNode publicList(String gameId, List<Map<String, Object>> rows) {
        ArrayNode data = JsonNodeFactory.instance.arrayNode();
        if (rows != null) {
            for (Map<String, Object> row : rows) {
                data.add(toObjectNode(row));
            }
        }
        return publicEnvelope(gameId, data);
    }

    public ObjectNode publicObject(String gameId, Map<String, Object> row, String notFoundMessage, Map<String, Object> details) {
        if (row == null || row.isEmpty()) {
            throw notFound(notFoundMessage, details);
        }
        return publicEnvelope(gameId, toObjectNode(row));
    }

    public ObjectNode adminWriteResponse(Map<String, Object> row, long currentRevision) {
        ObjectNode response = toObjectNode(row);
        response.put("currentRevision", currentRevision);
        return response;
    }

    public void rejectServerFields(JsonNode node) {
        rejectServerFields(node, "");
    }

    public void rejectServerFields(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String currentPath = path.isBlank() ? "/" + field.getKey() : path + "/" + field.getKey();
                if (FORBIDDEN_SERVER_FIELDS.contains(field.getKey().toLowerCase(Locale.ROOT))) {
                    throw badRequest(
                        "Server-managed fields are forbidden in this request body",
                        Map.of("path", currentPath, "reason", "field not allowed: " + field.getKey())
                    );
                }
                rejectServerFields(field.getValue(), currentPath);
            }
            return;
        }
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                String currentPath = path.isBlank() ? "/" + i : path + "/" + i;
                rejectServerFields(node.get(i), currentPath);
            }
        }
    }

    public ObjectNode requireBody(ObjectNode body) {
        if (body == null || body.isNull()) {
            throw badRequest("Request body is required", Map.of("path", "/"));
        }
        rejectServerFields(body);
        return body;
    }

    public String requireText(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull() || !value.isTextual() || value.asText().isBlank()) {
            throw badRequest(field + " is required and must be a non-empty string", Map.of("path", "/" + field));
        }
        return value.asText();
    }

    public String optionalText(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            throw badRequest(field + " must be a string", Map.of("path", "/" + field));
        }
        String text = value.asText();
        return text.isBlank() ? null : text;
    }

    public int requireInt(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull() || !value.isNumber() || !value.canConvertToInt()) {
            throw badRequest(field + " is required and must be an integer", Map.of("path", "/" + field));
        }
        return value.intValue();
    }

    public Integer optionalInt(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isNumber() || !value.canConvertToInt()) {
            throw badRequest(field + " must be an integer", Map.of("path", "/" + field));
        }
        return value.intValue();
    }

    public long requireLong(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull() || !value.isNumber() || !value.canConvertToLong()) {
            throw badRequest(field + " is required and must be a number", Map.of("path", "/" + field));
        }
        return value.longValue();
    }

    public BigDecimal requireDecimal(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull() || !value.isNumber()) {
            throw badRequest(field + " is required and must be a number", Map.of("path", "/" + field));
        }
        return value.decimalValue();
    }

    public BigDecimal optionalDecimal(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isNumber()) {
            throw badRequest(field + " must be a number", Map.of("path", "/" + field));
        }
        return value.decimalValue();
    }

    public boolean requireBoolean(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull() || !value.isBoolean()) {
            throw badRequest(field + " is required and must be a boolean", Map.of("path", "/" + field));
        }
        return value.booleanValue();
    }

    public Boolean optionalBoolean(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isBoolean()) {
            throw badRequest(field + " must be a boolean", Map.of("path", "/" + field));
        }
        return value.booleanValue();
    }

    public ObjectNode requireObject(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull() || !value.isObject()) {
            throw badRequest(field + " is required and must be a JSON object", Map.of("path", "/" + field));
        }
        return (ObjectNode) value;
    }

    public String requireJsonObjectString(ObjectNode body, String field) {
        ObjectNode object = requireObject(body, field);
        try {
            return objectMapper.writeValueAsString(object);
        } catch (JsonProcessingException ex) {
            throw badRequest(field + " must be a valid JSON object", Map.of("path", "/" + field));
        }
    }

    public String optionalJsonObjectString(ObjectNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isObject()) {
            throw badRequest(field + " must be a JSON object", Map.of("path", "/" + field));
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw badRequest(field + " must be a valid JSON object", Map.of("path", "/" + field));
        }
    }

    public ObjectNode toObjectNode(Map<String, Object> row) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        if (row == null) {
            return node;
        }
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            putValue(node, entry.getKey(), entry.getValue());
        }
        return node;
    }

    public void putValue(ObjectNode node, String key, Object value) {
        if (value == null) {
            node.putNull(key);
            return;
        }
        if (value instanceof Boolean bool) {
            node.put(key, bool);
            return;
        }
        if (value instanceof Integer number) {
            node.put(key, number);
            return;
        }
        if (value instanceof Long number) {
            node.put(key, number);
            return;
        }
        if (value instanceof Short number) {
            node.put(key, number.intValue());
            return;
        }
        if (value instanceof BigDecimal number) {
            node.put(key, number);
            return;
        }
        if (value instanceof Float number) {
            node.put(key, number);
            return;
        }
        if (value instanceof Double number) {
            node.put(key, number);
            return;
        }
        if (value instanceof Number number) {
            node.put(key, number.doubleValue());
            return;
        }
        if (value instanceof Timestamp timestamp) {
            node.put(key, timestamp.toInstant().toString());
            return;
        }
        if (value instanceof Instant instant) {
            node.put(key, instant.toString());
            return;
        }
        if (value instanceof String text) {
            if (("expression".equals(key) || "extend".equals(key) || "payload".equals(key)) && looksLikeJson(text)) {
                try {
                    node.set(key, objectMapper.readTree(text));
                    return;
                } catch (JsonProcessingException ignored) {
                    // fall through to plain text
                }
            }
            node.put(key, text);
            return;
        }
        node.put(key, String.valueOf(value));
    }

    public <T> T withConstraintMapping(Supplier<T> action) {
        try {
            return action.get();
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex);
        }
    }

    public void withConstraintMapping(Runnable action) {
        withConstraintMapping(() -> {
            action.run();
            return null;
        });
    }

    public ApiException mapConstraint(DataIntegrityViolationException ex) {
        String message = ex.getMostSpecificCause() == null ? ex.getMessage() : ex.getMostSpecificCause().getMessage();
        String lower = message == null ? "" : message.toLowerCase(Locale.ROOT);
        if (lower.contains("foreign key") || lower.contains("violates foreign key")) {
            return new ApiException(
                HttpStatus.CONFLICT,
                "409.CONFLICT",
                "Database foreign key constraint violated",
                Map.of("reason", message == null ? "foreign key" : message)
            );
        }
        if (lower.contains("unique") || lower.contains("duplicate")) {
            return new ApiException(
                HttpStatus.CONFLICT,
                "409.CONFLICT",
                "Database unique constraint violated",
                Map.of("reason", message == null ? "unique" : message)
            );
        }
        if (lower.contains("check") || lower.contains("exactly one") || lower.contains("effect_step")) {
            return new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_BODY",
                "Database check constraint violated",
                Map.of("reason", message == null ? "check" : message)
            );
        }
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.INVALID_BODY",
            "Database constraint violated",
            Map.of("reason", message == null ? "constraint" : message)
        );
    }

    public ApiException badRequest(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", message, details);
    }

    public ApiException notFound(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.NOT_FOUND, "404.NOT_FOUND", message, details);
    }

    private static boolean looksLikeJson(String text) {
        String trimmed = text.trim();
        return (trimmed.startsWith("{") && trimmed.endsWith("}"))
            || (trimmed.startsWith("[") && trimmed.endsWith("]"));
    }
}
