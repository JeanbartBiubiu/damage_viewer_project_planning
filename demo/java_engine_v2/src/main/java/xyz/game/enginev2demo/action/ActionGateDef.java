package xyz.game.enginev2demo.action;

import java.util.Objects;

/**
 * 动作施放门控定义——在动作执行前必须满足的额外前置条件。
 * <p>
 * 与冷却、资源、控制等通用检查不同，门控是与具体机制绑定的可扩展检查点。
 * 当前只有 {@link RequireMarkGate}（要求目标存在可消耗标记），后续可扩展更多类型。
 */
public sealed interface ActionGateDef permits ActionGateDef.RequireMarkGate {

    /**
     * 要求 source 对 target 存在指定 markId 的可消耗标记，否则阻断施放。
     * 典型场景：Akali E2 需要 E1 先挂上 mark。
     */
    record RequireMarkGate(String markId) implements ActionGateDef {
        public RequireMarkGate {
            Objects.requireNonNull(markId, "markId");
        }
    }
}
