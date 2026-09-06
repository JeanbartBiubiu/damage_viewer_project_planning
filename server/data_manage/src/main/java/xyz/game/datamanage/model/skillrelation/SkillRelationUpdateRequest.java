package xyz.game.datamanage.model.skillrelation;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;
import java.util.TreeSet;

public record SkillRelationUpdateRequest(JsonNode sortOrder, @JsonIgnore Set<String> unknownFields) {
    public SkillRelationUpdateRequest {
        unknownFields = unknownFields == null ? Set.of() : Set.copyOf(unknownFields);
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static SkillRelationUpdateRequest fromJson(JsonNode body) {
        if (!body.isObject()) {
            throw new IllegalArgumentException("技能挂载请求必须是对象");
        }
        Set<String> unknown = new TreeSet<>();
        body.fieldNames().forEachRemaining(unknown::add);
        unknown.remove("sortOrder");
        return new SkillRelationUpdateRequest(body.get("sortOrder"), unknown);
    }
}
