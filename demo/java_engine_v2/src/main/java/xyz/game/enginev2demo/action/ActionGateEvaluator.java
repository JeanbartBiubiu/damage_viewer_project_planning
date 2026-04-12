package xyz.game.enginev2demo.action;

import xyz.game.enginev2demo.mark.MarkSubsystem;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 动作门控求值器。
 * 遍历动作模板上的所有 {@link ActionGateDef}，任一不满足则抛出异常阻断施放。
 */
public final class ActionGateEvaluator {

    private final MarkSubsystem markSubsystem;

    public ActionGateEvaluator(MarkSubsystem markSubsystem) {
        this.markSubsystem = markSubsystem;
    }

    public void assertGates(
            RuntimeState state,
            String sourceActorId,
            String targetActorId,
            ActionTemplate actionTemplate) {
        for (ActionGateDef actionGate : actionTemplate.actionGates()) {
            switch (actionGate) {
                case ActionGateDef.RequireMarkGate requireMarkGate -> {
                    if (!markSubsystem.hasConsumableMark(state, sourceActorId, targetActorId, requireMarkGate.markId())) {
                        throw new IllegalStateException("action_blocked:mark:" + requireMarkGate.markId());
                    }
                }
            }
        }
    }
}
