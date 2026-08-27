package xyz.game.datamanage.model.skillparameter;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum SkillParameterValueMode {
    FIXED,
    SKILL_LEVEL,
    CHARACTER_LEVEL,
    RUNTIME_INPUT;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SkillParameterValueMode fromJson(String value) {
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
