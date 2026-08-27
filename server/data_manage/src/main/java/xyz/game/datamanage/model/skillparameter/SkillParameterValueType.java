package xyz.game.datamanage.model.skillparameter;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum SkillParameterValueType {
    INTEGER,
    DECIMAL;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SkillParameterValueType fromJson(String value) {
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
