package xyz.game.enginev2demo.action;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;

import xyz.game.enginev2demo.cadence.CadenceSubsystem;
import xyz.game.enginev2demo.command.EngineCommand;
import xyz.game.enginev2demo.command.EngineCommandExecutor;
import xyz.game.enginev2demo.compile.CompiledSnapshot;
import xyz.game.enginev2demo.control.ControlSubsystem;
import xyz.game.enginev2demo.event.CastOrigin;
import xyz.game.enginev2demo.event.InternalEvent;
import xyz.game.enginev2demo.event.ScheduledEvent;
import xyz.game.enginev2demo.formula.FormulaEvalContext;
import xyz.game.enginev2demo.formula.FormulaService;
import xyz.game.enginev2demo.pipeline.DamagePacket;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;
import xyz.game.enginev2demo.trigger.TriggerDispatcher;
import xyz.game.enginev2demo.trigger.TriggerEvent;

/**
 * ActionCast 事件执行入口。
 * <p>
 * 所有动作统一通过 {@code cooldownFormulaId} 设置冷却，
 * {@code autoRepeat=true} 的动作成功后按 {@code readyAtMs} 入队下一次施放。
 */
public final class ActionExecutor {

    private static final int ACTION_CAST_PRIORITY = 100;

    private final CompiledSnapshot snapshot;
    private final FormulaService formulaService;
    private final ActionSelector actionSelector;
    private final EngineCommandExecutor engineCommandExecutor;
    private final TriggerDispatcher triggerDispatcher;
    private final CadenceSubsystem cadenceSubsystem;
    private final ControlSubsystem controlSubsystem;

    public ActionExecutor(
            CompiledSnapshot snapshot,
            FormulaService formulaService,
            ActionSelector actionSelector,
            EngineCommandExecutor engineCommandExecutor,
            TriggerDispatcher triggerDispatcher,
            CadenceSubsystem cadenceSubsystem,
            ControlSubsystem controlSubsystem) {
        this.snapshot = snapshot;
        this.formulaService = formulaService;
        this.actionSelector = actionSelector;
        this.engineCommandExecutor = engineCommandExecutor;
        this.triggerDispatcher = triggerDispatcher;
        this.cadenceSubsystem = cadenceSubsystem;
        this.controlSubsystem = controlSubsystem;
    }

    public void execute(RuntimeState state, InternalEvent.ActionCast event) {
        ActionTemplate actionTemplate = snapshot.actionTemplate(event.actionId());
        if (event.castOrigin() == CastOrigin.AUTO_REPEAT && !isRepeatableActorsAlive(state, event)) {
            return;
        }
        try {
            executeOnce(state, event, actionTemplate);
        } catch (IllegalStateException exception) {
            if (event.castOrigin() == CastOrigin.AUTO_REPEAT && isBlockedAction(exception)) {
                handleBlockedAutoRepeat(state, event, actionTemplate, exception);
                return;
            }
            throw exception;
        }
        enqueueAutoRepeatIfNeeded(state, event, actionTemplate);
    }

    private void executeOnce(RuntimeState state, InternalEvent.ActionCast event, ActionTemplate actionTemplate) {
        actionTemplate = actionSelector.select(state, event.sourceActorId(), event.targetActorId(), event.actionId());
        ActorRuntime source = state.actor(event.sourceActorId());
        ActorRuntime target = state.actor(event.targetActorId());
        double rawDamage = formulaService.evaluate(
                snapshot.formulaCatalog().require(actionTemplate.formulaId()),
                new FormulaEvalContext(state, source, target, Map.of()));

        state.log(new ActionLogEntry(
                state.nowMs(),
                event.sourceActorId(),
                event.targetActorId(),
                actionTemplate.actionId(),
                actionTemplate.label()));

        List<EngineCommand> setupCommands = new ArrayList<>();
        for (Map.Entry<String, Double> entry : actionTemplate.resourceCosts().entrySet()) {
            setupCommands.add(new EngineCommand.SpendResourceCommand(event.sourceActorId(), entry.getKey(), entry.getValue()));
        }
        // 统一节奏消耗：由 CadenceSubsystem 处理冷却/充能
        cadenceSubsystem.consumeOnCast(state, source, target, actionTemplate);
        engineCommandExecutor.executeAll(state, setupCommands);

        engineCommandExecutor.executeAll(
                state,
                triggerDispatcher.dispatch(state, TriggerEvent.actionCast(
                        event.sourceActorId(),
                        event.targetActorId(),
                        actionTemplate.actionId())));

        if (rawDamage > 0.0) {
            engineCommandExecutor.executeDamagePacket(state, new DamagePacket(
                    event.sourceActorId(),
                    event.targetActorId(),
                    actionTemplate.actionId(),
                    actionTemplate.label(),
                    actionTemplate.damageProfileId(),
                    rawDamage));
        }
    }

    /**
     * 成功施放后，如果 autoRepeat=true，按 readyAtMs 入队下一次 AUTO_REPEAT。
     */
    private void enqueueAutoRepeatIfNeeded(RuntimeState state, InternalEvent.ActionCast event, ActionTemplate actionTemplate) {
        if (!actionTemplate.autoRepeat() || !isRepeatableActorsAlive(state, event)) {
            return;
        }
        ActorRuntime source = state.actor(event.sourceActorId());
        long readyAtMs = source.actionState(event.actionId()).readyAtMs();
        state.enqueue(new ScheduledEvent(
                readyAtMs,
                ACTION_CAST_PRIORITY,
                state.nextSequence(),
                new InternalEvent.ActionCast(
                        event.sourceActorId(),
                        event.targetActorId(),
                        event.actionId(),
                        CastOrigin.AUTO_REPEAT)));
    }

    /**
     * AUTO_REPEAT 被阻断时，根据阻断原因决定下一次可重试时刻并重入队列。
     */
    private void handleBlockedAutoRepeat(
            RuntimeState state,
            InternalEvent.ActionCast event,
            ActionTemplate actionTemplate,
            IllegalStateException exception) {
        if (!isRepeatableActorsAlive(state, event)) {
            return;
        }
        ActorRuntime source = state.actor(event.sourceActorId());
        ActorRuntime target = state.actor(event.targetActorId());
        String message = exception.getMessage();
        long retryAtMs;

        if ("action_blocked:cooldown".equals(message)) {
            long readyAtMs = source.actionState(event.actionId()).readyAtMs();
            retryAtMs = Math.max(state.nowMs() + 1, readyAtMs);
        } else if (message != null && message.startsWith("action_blocked:control:")) {
            OptionalLong unblockAt = controlSubsystem.nextActionUnblockAt(source, state.nowMs());
            if (unblockAt.isPresent()) {
                retryAtMs = unblockAt.getAsLong();
            } else {
                long cooldownMs = cadenceSubsystem.evaluateCooldownMs(state, source, target, actionTemplate);
                retryAtMs = state.nowMs() + Math.max(1, cooldownMs);
            }
        } else {
            // resource 或 mark 阻断：没有确切的解除时刻真源，按冷却间隔重试
            long cooldownMs = cadenceSubsystem.evaluateCooldownMs(state, source, target, actionTemplate);
            retryAtMs = state.nowMs() + Math.max(1, cooldownMs);
        }

        state.enqueue(new ScheduledEvent(
                retryAtMs,
                ACTION_CAST_PRIORITY,
                state.nextSequence(),
                new InternalEvent.ActionCast(
                        event.sourceActorId(),
                        event.targetActorId(),
                        event.actionId(),
                        CastOrigin.AUTO_REPEAT)));
    }

    private boolean isRepeatableActorsAlive(RuntimeState state, InternalEvent.ActionCast event) {
        return state.actor(event.sourceActorId()).currentHp() > 0.0
                && state.actor(event.targetActorId()).currentHp() > 0.0;
    }

    private boolean isBlockedAction(IllegalStateException exception) {
        return exception.getMessage() != null && exception.getMessage().startsWith("action_blocked:");
    }
}
