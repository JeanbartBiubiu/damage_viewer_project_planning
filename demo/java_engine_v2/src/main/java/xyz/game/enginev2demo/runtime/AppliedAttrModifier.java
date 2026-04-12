package xyz.game.enginev2demo.runtime;

import java.util.Objects;

/**
 * 运行时固化后的属性修正。
 */
public record AppliedAttrModifier(
        String attrKey,
        AttrModifierMode mode,
        double value) {

    public AppliedAttrModifier {
        Objects.requireNonNull(attrKey, "attrKey");
        Objects.requireNonNull(mode, "mode");
    }
}
