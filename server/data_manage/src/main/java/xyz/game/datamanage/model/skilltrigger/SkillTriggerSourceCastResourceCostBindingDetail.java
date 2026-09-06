package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerSourceCastResourceCostBindingDetail(
    String attributeKey,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {
    public SkillTriggerSourceCastResourceCostBindingDetail {
        attributeKey = attributeKey == null || attributeKey.isBlank() ? null : attributeKey.trim();
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerSourceCastResourceCostBindingDetail(String attributeKey) {
        this(attributeKey, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator
    static SkillTriggerSourceCastResourceCostBindingDetail fromJson(
        @JsonProperty("attributeKey") String attributeKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerSourceCastResourceCostBindingDetail(attributeKey, SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }
}
