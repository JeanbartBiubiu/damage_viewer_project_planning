package xyz.game.datamanage.model.damagetype;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.JsonNode;

/** 公式替换请求只接受 formula。 */
public record DamageTypeFormulaReplaceRequest(JsonNode formula) {

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignored) {
        throw new IllegalArgumentException("未知字段：" + fieldName);
    }
}
