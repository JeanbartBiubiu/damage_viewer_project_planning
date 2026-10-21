package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;

/** 同次技能使用中的实际命中阶段；前置步骤必须显式给出空值或稳定键。 */
public record SkillTriggerSkillHitProcessMoment(
    String processKey,
    SkillProcessMoment moment,
    String requiresPriorStepKey,
    @JsonIgnore boolean requiresPriorStepKeyPresent,
    @JsonIgnore boolean requiresPriorStepKeyInvalid,
    @JsonIgnore Set<String> unknownFields
) {
    private static final ObjectMapper JSON = new ObjectMapper();
    public SkillTriggerSkillHitProcessMoment {
        processKey = trimToNull(processKey);
        requiresPriorStepKeyInvalid = requiresPriorStepKeyInvalid || requiresPriorStepKey != null && requiresPriorStepKey.isBlank();
        requiresPriorStepKey = trimToNull(requiresPriorStepKey);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerSkillHitProcessMoment(String processKey, SkillProcessMoment moment, String requiresPriorStepKey) {
        this(processKey, moment, requiresPriorStepKey, true, false, Set.of());
    }

    static SkillTriggerSkillHitProcessMoment fromNode(JsonNode node) {
        if (node == null) return null;
        if (!node.isObject()) throw new IllegalArgumentException("命中阶段必须为对象");
        requireText(node, "processKey", "processMoment.processKey");
        JsonNode rawMoment = node.get("moment");
        if (rawMoment != null && !rawMoment.isNull()) {
            if (!rawMoment.isObject()) throw new IllegalArgumentException("processMoment.moment必须为对象");
            requireText(rawMoment, "momentType", "processMoment.moment.momentType");
            requireText(rawMoment, "stepKey", "processMoment.moment.stepKey");
        }
        SkillTriggerSkillHitProcessMoment value = JSON.convertValue(node, SkillTriggerSkillHitProcessMoment.class);
        // 通用过程时点认识失败原因；命中阶段连显式空值也不接受，避免保存时静默丢弃。
        if (node.path("moment").has("failureReason") && value.moment() != null && value.moment().failureReason() == null) {
            Set<String> unknown = new LinkedHashSet<>(value.moment().unknownFields());
            unknown.add("failureReason");
            SkillProcessMoment moment = new SkillProcessMoment(value.moment().momentType(), value.moment().stepKey(), null, unknown);
            value = new SkillTriggerSkillHitProcessMoment(value.processKey(), moment, value.requiresPriorStepKey(),
                value.requiresPriorStepKeyPresent(), value.requiresPriorStepKeyInvalid(), value.unknownFields());
        }
        return value;
    }

    private static void requireText(JsonNode object, String field, String path) {
        JsonNode value = object.get(field);
        if (value != null && !value.isNull() && !value.isTextual())
            throw new IllegalArgumentException(path + "必须为字符串");
    }

    @JsonCreator
    static SkillTriggerSkillHitProcessMoment fromJson(
        @JsonProperty("processKey") String processKey,
        @JsonProperty("moment") SkillProcessMoment moment,
        @JsonProperty("requiresPriorStepKey") JsonNode requiresPriorStepKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        boolean invalid = requiresPriorStepKey != null && !requiresPriorStepKey.isNull()
            && (!requiresPriorStepKey.isTextual() || requiresPriorStepKey.asText().isBlank());
        return new SkillTriggerSkillHitProcessMoment(processKey, moment,
            requiresPriorStepKey != null && requiresPriorStepKey.isTextual() ? requiresPriorStepKey.asText() : null,
            requiresPriorStepKey != null, invalid, SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
