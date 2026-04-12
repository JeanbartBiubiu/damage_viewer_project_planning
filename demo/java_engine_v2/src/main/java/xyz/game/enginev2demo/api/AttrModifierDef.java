package xyz.game.enginev2demo.api;

import java.util.Objects;

import xyz.game.enginev2demo.runtime.AttrModifierMode;

/**
 * 状态模板上的属性修正定义。
 */
public record AttrModifierDef(
        String attrKey,
        AttrModifierMode mode,
        String formulaId) {

    public AttrModifierDef {
        Objects.requireNonNull(attrKey, "attrKey");
        Objects.requireNonNull(mode, "mode");
        Objects.requireNonNull(formulaId, "formulaId");
    }
}
