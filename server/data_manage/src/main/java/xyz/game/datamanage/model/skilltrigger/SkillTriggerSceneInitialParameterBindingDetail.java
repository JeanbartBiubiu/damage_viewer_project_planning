package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;

/** 本场必须显式提供的初值范围，不携带默认值或实际战斗输入。 */
public record SkillTriggerSceneInitialParameterBindingDetail(
    BigDecimal minValue, BigDecimal maxValue, @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {
    public SkillTriggerSceneInitialParameterBindingDetail {
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerSceneInitialParameterBindingDetail(BigDecimal minValue, BigDecimal maxValue) {
        this(minValue, maxValue, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator
    static SkillTriggerSceneInitialParameterBindingDetail fromJson(
        @JsonProperty("minValue") JsonNode minimum,
        @JsonProperty("maxValue") JsonNode maximum,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerSceneInitialParameterBindingDetail(number(minimum, "minValue"),
            number(maximum, "maxValue"), SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }

    private static BigDecimal number(JsonNode value, String field) {
        if (value == null || value.isNull()) return null;
        if (!value.isNumber()) throw new IllegalArgumentException("场景显式初值 " + field + " 必须是数值");
        return value.decimalValue();
    }
}
