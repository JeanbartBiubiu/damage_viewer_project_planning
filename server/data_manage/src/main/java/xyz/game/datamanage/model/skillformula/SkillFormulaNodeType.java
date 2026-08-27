package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum SkillFormulaNodeType {
    OPERATION,
    PARAMETER,
    ATTRIBUTE;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static SkillFormulaNodeType fromJson(String value) {
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
