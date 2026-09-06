package xyz.game.datamanage.model.imagerelation;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;

public record RepresentativeImageRequest(String imageKey, @JsonIgnore Set<String> unknownFields) {
    public RepresentativeImageRequest {
        imageKey = imageKey == null ? null : imageKey.trim();
        unknownFields = unknownFields == null ? Set.of() : Set.copyOf(unknownFields);
    }

    @JsonCreator
    static RepresentativeImageRequest fromJson(
        @JsonProperty("imageKey") String imageKey,
        @JsonAnySetter Map<String, JsonNode> unknown
    ) {
        return new RepresentativeImageRequest(imageKey, unknown == null ? Set.of() : unknown.keySet());
    }
}
