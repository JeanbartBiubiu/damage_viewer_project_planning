package xyz.game.datamanage.model.skillconfiguration;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.JsonNode;

public record SkillConfigurationChange(
    String objectType,
    String operation,
    String key,
    JsonNode value
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
