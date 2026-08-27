package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum SkillFormulaOperation {
    ADD,
    SUBTRACT,
    MULTIPLY,
    DIVIDE,
    MIN,
    MAX;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SkillFormulaOperation fromJson(String value) {
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
