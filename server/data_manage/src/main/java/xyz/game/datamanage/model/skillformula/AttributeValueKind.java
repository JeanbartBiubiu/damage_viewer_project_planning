package xyz.game.datamanage.model.skillformula;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum AttributeValueKind {
    BASE,
    BONUS,
    TOTAL,
    CURRENT,
    MISSING,
    CURRENT_RATIO,
    MISSING_RATIO;

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static AttributeValueKind fromJson(String value) {
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
