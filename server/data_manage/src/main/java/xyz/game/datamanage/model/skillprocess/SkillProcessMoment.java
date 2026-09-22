package xyz.game.datamanage.model.skillprocess;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessFailureReason;

public record SkillProcessMoment(
    @NotNull(message = "过程时点种类不能为空")
    SkillProcessMomentType momentType,
    String stepKey,
    @JsonInclude(JsonInclude.Include.NON_NULL)
    SkillTriggerProcessFailureReason failureReason,
    @JsonIgnore Set<String> unknownFields
) {
    public SkillProcessMoment {
        stepKey = stepKey == null || stepKey.isBlank() ? null : stepKey.trim();
        unknownFields = SkillProcessDetailFieldCapture.normalize(unknownFields);
    }

    public SkillProcessMoment(SkillProcessMomentType momentType, String stepKey) {
        this(momentType, stepKey, null, Set.of());
    }

    public SkillProcessMoment(
        SkillProcessMomentType momentType,
        String stepKey,
        SkillTriggerProcessFailureReason failureReason
    ) {
        this(momentType, stepKey, failureReason, Set.of());
    }

    @JsonCreator
    static SkillProcessMoment fromJson(
        @JsonProperty("momentType") SkillProcessMomentType momentType,
        @JsonProperty("stepKey") String stepKey,
        @JsonProperty("failureReason") SkillTriggerProcessFailureReason failureReason,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillProcessMoment(
            momentType,
            stepKey,
            failureReason,
            SkillProcessDetailFieldCapture.captureUnknown(unknown)
        );
    }
}
