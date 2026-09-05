package xyz.game.datamanage.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.EditLogMapper;

@Component
public class PostgresWriteStore {

    private final EditLogMapper editLogMapper;
    private final ObjectMapper objectMapper;

    public PostgresWriteStore(
        EditLogMapper editLogMapper,
        ObjectMapper objectMapper
    ) {
        this.editLogMapper = editLogMapper;
        this.objectMapper = objectMapper;
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
}
