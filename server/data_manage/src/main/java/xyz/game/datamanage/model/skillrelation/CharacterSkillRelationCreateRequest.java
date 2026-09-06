package xyz.game.datamanage.model.skillrelation;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;
import java.util.TreeSet;

public record CharacterSkillRelationCreateRequest(
    String characterKey,
    String skillKey,
    JsonNode sortOrder,
    @JsonIgnore Set<String> unknownFields
) {
    public CharacterSkillRelationCreateRequest {
        characterKey = characterKey == null ? null : characterKey.trim();
        skillKey = skillKey == null ? null : skillKey.trim();
        unknownFields = unknownFields == null ? Set.of() : Set.copyOf(unknownFields);
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    static CharacterSkillRelationCreateRequest fromJson(JsonNode body) {
        if (!body.isObject()) {
            throw new IllegalArgumentException("技能挂载请求必须是对象");
        }
        Set<String> unknown = new TreeSet<>();
        body.fieldNames().forEachRemaining(unknown::add);
        unknown.removeAll(Set.of("characterKey", "skillKey", "sortOrder"));
        return new CharacterSkillRelationCreateRequest(
            readKey(body, "characterKey"), readKey(body, "skillKey"), body.get("sortOrder"), unknown
        );
    }

    private static String readKey(JsonNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            throw new IllegalArgumentException(field + " 必须是字符串");
        }
        return value.textValue();
    }
}
