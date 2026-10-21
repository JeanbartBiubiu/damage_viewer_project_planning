package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;

/** 本场必须显式提供的初值范围，不携带默认值或实际战斗输入。 */
public record SkillTriggerSceneInitialParameterBindingDetail(
    BigDecimal minValue, BigDecimal maxValue,
    @JsonInclude(JsonInclude.Include.NON_NULL) String sharedInputKey,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {
    public SkillTriggerSceneInitialParameterBindingDetail {
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerSceneInitialParameterBindingDetail(BigDecimal minValue, BigDecimal maxValue) {
        this(minValue, maxValue, null, Set.of());
    }

    public SkillTriggerSceneInitialParameterBindingDetail(BigDecimal minValue, BigDecimal maxValue, String sharedInputKey) {
        this(minValue, maxValue, sharedInputKey, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator
    static SkillTriggerSceneInitialParameterBindingDetail fromJson(
        @JsonProperty("minValue") JsonNode minimum,
        @JsonProperty("maxValue") JsonNode maximum,
        @JsonProperty("sharedInputKey") JsonNode sharedInputKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerSceneInitialParameterBindingDetail(number(minimum, "minValue"),
            number(maximum, "maxValue"), sharedKey(sharedInputKey), SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }

    private static String sharedKey(JsonNode value) {
        if (value == null) return null;
        if (!value.isTextual() || !value.textValue().matches("^[a-z][a-z0-9_]{0,63}$")) {
            throw new IllegalArgumentException("共享输入标识必须是明确的合法标识，不能为null或空字符串");
        }
        return value.textValue();
    }

    private static BigDecimal number(JsonNode value, String field) {
        if (value == null || value.isNull()) return null;
        if (!value.isNumber()) throw new IllegalArgumentException("场景显式初值 " + field + " 必须是数值");
        return value.decimalValue();
    }
}
