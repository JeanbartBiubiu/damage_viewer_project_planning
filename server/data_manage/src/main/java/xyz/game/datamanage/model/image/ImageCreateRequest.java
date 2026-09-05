package xyz.game.datamanage.model.image;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

public record ImageCreateRequest(
    String imageKey,
    String name,
    String description,
    JsonNode imageBase64,
    @JsonIgnore Set<String> unknownFields
) {

    public ImageCreateRequest {
        imageKey = normalizeRequired(imageKey);
        name = normalizeRequired(name);
        description = normalizeOptional(description);
        unknownFields = normalizeUnknownFields(unknownFields);
    }

    @JsonCreator
    static ImageCreateRequest fromJson(
        @JsonProperty("imageKey") String imageKey,
        @JsonProperty("name") String name,
        @JsonProperty("description") String description,
        @JsonProperty("imageBase64") JsonNode imageBase64,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new ImageCreateRequest(
            imageKey,
            name,
            description,
            imageBase64,
            unknown == null ? Set.of() : unknown.keySet()
        );
    }

    private static String normalizeRequired(String value) {
        return value == null ? null : value.trim();
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
