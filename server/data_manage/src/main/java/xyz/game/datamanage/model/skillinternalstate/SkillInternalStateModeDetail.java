package xyz.game.datamanage.model.skillinternalstate;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;
import java.util.Set;

public record SkillInternalStateModeDetail(
    @NotNull(message = "模式选项不能缺失")
    @Valid
    List<SkillInternalStateModeOption> options,
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillInternalStateDetail {

    public SkillInternalStateModeDetail {
        options = options == null ? null : List.copyOf(options);
        foreignFields = SkillInternalStateDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillInternalStateDetailFieldCapture.normalize(unknownFields);
    }

    public SkillInternalStateModeDetail(List<SkillInternalStateModeOption> options) {
        this(options, Set.of(), Set.of());
    }

    @JsonCreator
    static SkillInternalStateModeDetail fromJson(
        @JsonProperty("options") List<SkillInternalStateModeOption> options,
        @JsonProperty("initialValue") JsonNode initialValue,
        @JsonProperty("maxValue") JsonNode maxValue,
        @JsonProperty("recoveryIntervalValue") JsonNode recoveryIntervalValue,
        @JsonProperty("recoveryMode") JsonNode recoveryMode,
        @JsonProperty("initialEnabled") JsonNode initialEnabled,
        @JsonProperty("durationValue") JsonNode durationValue,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillInternalStateModeDetail(
            options,
            SkillInternalStateDetailFieldCapture.captureForeign(
                "initialValue", initialValue,
                "maxValue", maxValue,
                "recoveryIntervalValue", recoveryIntervalValue,
                "recoveryMode", recoveryMode,
                "initialEnabled", initialEnabled,
                "durationValue", durationValue
            ),
            SkillInternalStateDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
