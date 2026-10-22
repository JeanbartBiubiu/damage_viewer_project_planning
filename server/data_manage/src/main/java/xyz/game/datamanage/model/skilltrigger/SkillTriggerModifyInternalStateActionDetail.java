package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.value.SkillNumericValue;

/** 修改自身状态的计时：减少下一枚弹药回充，或确保活动目标计数的最低余时。 */
public record SkillTriggerModifyInternalStateActionDetail(
    String stateSkillKey,
    String stateKey,
    SkillTriggerInternalStateOperation operation,
    @Valid SkillNumericValue value,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerActionDetail {
    public SkillTriggerModifyInternalStateActionDetail {
        stateSkillKey = stateSkillKey == null ? null : stateSkillKey.trim();
        stateKey = stateKey == null ? null : stateKey.trim();
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerModifyInternalStateActionDetail(String stateSkillKey, String stateKey,
        SkillTriggerInternalStateOperation operation, SkillNumericValue value) {
        this(stateSkillKey, stateKey, operation, value, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator
    static SkillTriggerModifyInternalStateActionDetail fromJson(
        @JsonProperty("stateSkillKey") String stateSkillKey,
        @JsonProperty("stateKey") String stateKey,
        @JsonProperty("operation") SkillTriggerInternalStateOperation operation,
        @JsonProperty("value") SkillNumericValue value,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerModifyInternalStateActionDetail(stateSkillKey, stateKey, operation, value,
            SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }
}
