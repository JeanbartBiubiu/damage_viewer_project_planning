package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum AttributeOwner {
    SOURCE,
    TARGET;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static AttributeOwner fromJson(String value) {
        if (value == null) {
            return null;
        }
        try {
            return valueOf(value);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }
}
