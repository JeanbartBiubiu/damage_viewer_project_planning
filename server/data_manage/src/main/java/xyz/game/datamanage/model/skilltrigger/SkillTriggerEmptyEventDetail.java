package xyz.game.datamanage.model.skilltrigger;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record SkillTriggerEmptyEventDetail(
    @JsonIgnore Set<String> foreignFields,
    @JsonIgnore Set<String> unknownFields
) implements SkillTriggerEventDetail {

    public SkillTriggerEmptyEventDetail {
        foreignFields = SkillTriggerDetailFieldCapture.normalize(foreignFields);
        unknownFields = SkillTriggerDetailFieldCapture.normalize(unknownFields);
    }

    public SkillTriggerEmptyEventDetail() {
        this(Set.of(), Set.of());
    }

    @JsonCreator
    static SkillTriggerEmptyEventDetail fromJson(@JsonAnySetter Map<String, JsonNode> unknown) {
        return new SkillTriggerEmptyEventDetail(Set.of(), SkillTriggerDetailFieldCapture.captureUnknown(unknown));
    }
}
