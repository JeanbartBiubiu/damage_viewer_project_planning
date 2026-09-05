package xyz.game.datamanage.model.image;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

public record ImageUpdateRequest(
    String name,
    String description,
    Boolean enabled,
    JsonNode imageBase64,
    @JsonIgnore Set<String> unknownFields
) {

    public ImageUpdateRequest {
        name = name == null ? null : name.trim();
        description = normalizeOptional(description);
        unknownFields = normalizeUnknownFields(unknownFields);
    }

    @JsonCreator
    static ImageUpdateRequest fromJson(
        @JsonProperty("name") String name,
        @JsonProperty("description") String description,
        @JsonProperty("enabled") Boolean enabled,
        @JsonProperty("imageBase64") JsonNode imageBase64,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new ImageUpdateRequest(
            name,
            description,
            enabled,
            imageBase64,
            unknown == null ? Set.of() : unknown.keySet()
        );
    }

    public boolean replacesContent() {
        return imageBase64 != null;
    }

    private static String normalizeOptional(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private static Set<String> normalizeUnknownFields(Set<String> fields) {
        return fields == null || fields.isEmpty()
            ? Set.of()
            : Set.copyOf(new TreeSet<>(fields));
    }
}
