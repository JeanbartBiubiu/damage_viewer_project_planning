package xyz.game.enginev2demo.action;

import xyz.game.enginev2demo.cadence.CadenceSubsystem;
import xyz.game.enginev2demo.compile.CompiledSnapshot;
import xyz.game.enginev2demo.control.ControlSubsystem;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;
import xyz.game.enginev2demo.runtime.StatusKind;

/**
 * 统一动作可执行性检查。
 * 所有阻断都在这里 fail-fast，后面的执行链默认只处理“已经允许施放”的动作。
 */
public final class ActionSelector {

    private final CompiledSnapshot snapshot;
    private final CadenceSubsystem cadenceSubsystem;
    private final ControlSubsystem controlSubsystem;
    private final ActionGateEvaluator actionGateEvaluator;

    public ActionSelector(
            CompiledSnapshot snapshot,
            CadenceSubsystem cadenceSubsystem,
            ControlSubsystem controlSubsystem,
            ActionGateEvaluator actionGateEvaluator) {
        this.snapshot = snapshot;
        this.cadenceSubsystem = cadenceSubsystem;
        this.controlSubsystem = controlSubsystem;
        this.actionGateEvaluator = actionGateEvaluator;
    }

    public ActionTemplate select(RuntimeState state, String sourceActorId, String targetActorId, String actionId) {
        ActorRuntime actorRuntime = state.actor(sourceActorId);
        ActionTemplate actionTemplate = snapshot.actionTemplate(actionId);
        if (!actorRuntime.actionState(actionId).enabled()) {
            throw new IllegalStateException("action is disabled: " + actionId);
        }
        cadenceSubsystem.assertActionAvailable(state, actorRuntime, actionId);
        if (controlSubsystem.blocksAction(actorRuntime)) {
            throw new IllegalStateException("action_blocked:control:" + StatusKind.STUN.name());
        }
        // 冷却、控制、资源、显式 gate 的顺序固定，便于后续 review 和补 rejected-cast 语义。
        cadenceSubsystem.assertResourcesAvailable(actorRuntime, actionTemplate);
        actionGateEvaluator.assertGates(state, sourceActorId, targetActorId, actionTemplate);
        return actionTemplate;
    }
}
