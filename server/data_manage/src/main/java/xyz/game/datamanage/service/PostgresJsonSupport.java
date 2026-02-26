package xyz.game.datamanage.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class PostgresJsonSupport {

    private static final Set<String> FORBIDDEN_VERSION_FIELDS = Set.of(
        "startversionid",
        "endversionid",
        "versionid",
        "versioncode",
        "iscurrent",
        "datahash",
        "start_version_id",
        "end_version_id",
        "version_id",
        "version_code",
        "is_current",
        "data_hash"
    );

    private final ObjectMapper objectMapper;

    public PostgresJsonSupport(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void validateNoVersionFields(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String currentPath = path.isBlank() ? "/" + field.getKey() : path + "/" + field.getKey();
                if (FORBIDDEN_VERSION_FIELDS.contains(field.getKey().toLowerCase(Locale.ROOT))) {
                    throw badRequest(
                        "Version fields are forbidden in this request body",
                        Map.of("path", currentPath, "reason", "field not allowed: " + field.getKey())
                    );
                }
                validateNoVersionFields(field.getValue(), currentPath);
            }
            return;
        }
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                String currentPath = path.isBlank() ? "/" + i : path + "/" + i;
                validateNoVersionFields(node.get(i), currentPath);
            }
        }
    }

    public void validateAllowedTopLevelFields(ObjectNode node, Set<String> allowedFields) {
        if (node == null || node.isNull()) {
            return;
        }
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            if (!allowedFields.contains(field.getKey())) {
                throw badRequest(
                    "Request body contains unsupported field",
                    Map.of("path", "/" + field.getKey(), "reason", "field not allowed: " + field.getKey())
                );
            }
        }
    }

    public JsonNode parseJsonOrNull(String raw, String path) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(raw);
        } catch (JsonProcessingException ex) {
            throw new ApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "500.INTERNAL_ERROR",
                "Invalid JSON in database",
                Map.of("path", path)
            );
        }
    }

    public ObjectNode parseJsonObject(String raw, String path) {
        JsonNode node = parseJsonOrNull(raw, path);
        if (node == null || !node.isObject()) {
            throw new ApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "500.INTERNAL_ERROR",
                "Invalid JSON object in database",
                Map.of("path", path)
            );
        }
        return (ObjectNode) node;
    }

    public String toJsonString(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            throw badRequest("Required JSON field is missing", Map.of("path", path));
        }
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException ex) {
            throw badRequest("Invalid JSON value", Map.of("path", path));
        }
    }

    public String toJsonStringOrNull(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException ex) {
            throw badRequest("Invalid JSON value", Map.of());
        }
    }

    public String requireText(ObjectNode node, String fieldName, String objectName) {
        JsonNode value = node.get(fieldName);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw badRequest(
                objectName + "." + fieldName + " is required and must be non-empty string",
                Map.of("path", "/" + fieldName)
            );
        }
        return value.asText();
    }

    public String timestampToIso(Timestamp timestamp) {
        return timestamp == null ? Instant.now().toString() : timestamp.toInstant().toString();
    }

    private ApiException badRequest(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", message, details);
    }
}
