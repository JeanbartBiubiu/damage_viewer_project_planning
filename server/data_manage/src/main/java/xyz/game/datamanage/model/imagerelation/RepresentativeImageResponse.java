package xyz.game.datamanage.model.imagerelation;

import com.fasterxml.jackson.annotation.JsonInclude;

public record RepresentativeImageResponse(@JsonInclude(JsonInclude.Include.ALWAYS) Image image) {
    public record Image(String imageKey, String name, Boolean enabled) {}
}
