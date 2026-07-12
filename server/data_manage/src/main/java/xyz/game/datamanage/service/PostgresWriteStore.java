package xyz.game.datamanage.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.EditLogMapper;
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class PostgresWriteStore {

    private final ImagesMapper imagesMapper;
    private final EditLogMapper editLogMapper;
    private final PostgresReadStore readStore;
    private final ObjectMapper objectMapper;
    private final PostgresJsonSupport jsonSupport;

    public PostgresWriteStore(
        ImagesMapper imagesMapper,
        EditLogMapper editLogMapper,
        PostgresReadStore readStore,
        ObjectMapper objectMapper,
        PostgresJsonSupport jsonSupport
    ) {
        this.imagesMapper = imagesMapper;
        this.editLogMapper = editLogMapper;
        this.readStore = readStore;
        this.objectMapper = objectMapper;
        this.jsonSupport = jsonSupport;
    }

    @Transactional
    public ObjectNode upsertImage(String gameId, String uri, ObjectNode body) {
        if (body == null || body.isEmpty()) {
            throw badRequest("Request body cannot be empty", Map.of("path", "/", "reason", "empty body"));
        }

        ObjectNode merged = objectMapper.createObjectNode();
        body.fields().forEachRemaining(entry -> merged.set(entry.getKey(), entry.getValue().deepCopy()));
        merged.put("uri", uri);
        String imageBase64 = jsonSupport.requireText(merged, "imageBase64", "image");
        if (!imageBase64.startsWith("data:image/") || !imageBase64.contains("base64,")) {
            throw badRequest("imageBase64 must be data URI base64", Map.of("path", "/imageBase64"));
        }

        imagesMapper.upsertImage(gameId, uri, imageBase64);
        ObjectNode stored = readStore.loadImage(gameId, uri);
        return stored == null ? merged : stored;
    }

    @Transactional
    public void recordEditLog(String email, String method, String path, JsonNode requestBody, int responseCode) {
        ObjectNode editBody = objectMapper.createObjectNode();
        editBody.put("method", method);
        editBody.put("path", path);
        editBody.put("responseCode", responseCode);
        if (requestBody != null && !requestBody.isNull()) {
            editBody.set("requestBody", requestBody.deepCopy());
        }
        String serialized;
        try {
            serialized = objectMapper.writeValueAsString(editBody);
        } catch (JsonProcessingException ex) {
            serialized = "{\"method\":\"" + method + "\",\"path\":\"" + path + "\"}";
        }

        editLogMapper.insertEditLog(email, serialized);
        editLogMapper.deleteExpiredEditLogs();
    }

    private static ApiException badRequest(String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", message, details);
    }
}
