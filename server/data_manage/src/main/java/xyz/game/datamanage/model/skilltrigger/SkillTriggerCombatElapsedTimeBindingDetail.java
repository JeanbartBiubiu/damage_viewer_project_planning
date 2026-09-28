package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

/** 按选定对象本次入战起点计算的毫秒数。 */
public record SkillTriggerCombatElapsedTimeBindingDetail(
    SkillTriggerSubject subject,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerRuntimeInputBindingDetail {
    public SkillTriggerCombatElapsedTimeBindingDetail {
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerCombatElapsedTimeBindingDetail(SkillTriggerSubject subject) {
        this(subject, Set.of());
    }

    @Override @JsonIgnore public Set<String> foreignFields() { return Set.of(); }

    @JsonCreator
    static SkillTriggerCombatElapsedTimeBindingDetail fromJson(
        @JsonProperty("subject") SkillTriggerSubject subject,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new SkillTriggerCombatElapsedTimeBindingDetail(subject, SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }
}
