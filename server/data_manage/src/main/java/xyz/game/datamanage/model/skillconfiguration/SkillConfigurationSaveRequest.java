package xyz.game.datamanage.model.skillconfiguration;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

public record SkillConfigurationSaveRequest(
    String baseDigest,
    JsonNode skill,
    List<SkillConfigurationChange> changes
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
