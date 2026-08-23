package xyz.game.datamanage.model.attribute;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum AttributeValueType {
    DECIMAL,
    INTEGER;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static AttributeValueType fromJson(String value) {
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
