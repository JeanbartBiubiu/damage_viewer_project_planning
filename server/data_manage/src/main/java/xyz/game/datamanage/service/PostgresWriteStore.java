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

    /** 保存完整编辑记录；序列化或持久化失败向调用方抛出，不补造简化记录。 */
    @Transactional
    public void recordEditLog(java.util.UUID accountId, String username, String method, String path, JsonNode requestBody, int responseCode) {
        if (accountId == null || username == null || username.isBlank()) throw new IllegalArgumentException("编辑身份不能为空");
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
            throw new IllegalStateException("编辑记录无法保存为结构化数据", ex);
        }

        editLogMapper.insertEditLog(accountId, username, serialized);
        editLogMapper.deleteExpiredEditLogs();
    }
}
