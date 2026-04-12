package xyz.game.enginev2demo.command;

import java.util.ArrayList;
import java.util.List;

import xyz.game.enginev2demo.cadence.CadenceSubsystem;
import xyz.game.enginev2demo.compile.CompiledSnapshot;
import xyz.game.enginev2demo.control.ControlSubsystem;
import xyz.game.enginev2demo.counter.CounterChangeResult;
import xyz.game.enginev2demo.counter.CounterSubsystem;
import xyz.game.enginev2demo.event.InternalEvent;
import xyz.game.enginev2demo.event.ScheduledEvent;
import xyz.game.enginev2demo.formula.FormulaEvalContext;
import xyz.game.enginev2demo.formula.FormulaService;
import xyz.game.enginev2demo.history.HistorySubsystem;
import xyz.game.enginev2demo.mark.MarkSubsystem;
import xyz.game.enginev2demo.pipeline.DamagePacket;
import xyz.game.enginev2demo.pipeline.DamagePipelineResult;
import xyz.game.enginev2demo.pipeline.PipelineRunner;
import xyz.game.enginev2demo.runtime.AppliedAttrModifier;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.ResourceState;
import xyz.game.enginev2demo.runtime.RuntimeState;
import xyz.game.enginev2demo.runtime.StatusInstance;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.shield.ShieldGrantResult;
import xyz.game.enginev2demo.shield.ShieldLogEntry;
import xyz.game.enginev2demo.shield.ShieldSubsystem;
import xyz.game.enginev2demo.trigger.TriggerDispatcher;
import xyz.game.enginev2demo.trigger.TriggerEvent;

/**
 * 统一命令执行层。
 */
public final class EngineCommandExecutor {

    private final CompiledSnapshot snapshot;
    private final FormulaService formulaService;
    private final PipelineRunner pipelineRunner;
    private final ShieldSubsystem shieldSubsystem;
    private final TriggerDispatcher triggerDispatcher;
    private final ControlSubsystem controlSubsystem;
    private final HistorySubsystem historySubsystem;
    private final CounterSubsystem counterSubsystem;
    private final MarkSubsystem markSubsystem;
    private final CadenceSubsystem cadenceSubsystem;

    public EngineCommandExecutor(
            CompiledSnapshot snapshot,
            FormulaService formulaService,
            PipelineRunner pipelineRunner,
            ShieldSubsystem shieldSubsystem,
            TriggerDispatcher triggerDispatcher,
            ControlSubsystem controlSubsystem,
            HistorySubsystem historySubsystem,
            CounterSubsystem counterSubsystem,
            MarkSubsystem markSubsystem,
            CadenceSubsystem cadenceSubsystem) {
        this.snapshot = snapshot;
        this.formulaService = formulaService;
        this.pipelineRunner = pipelineRunner;
        this.shieldSubsystem = shieldSubsystem;
        this.triggerDispatcher = triggerDispatcher;
        this.controlSubsystem = controlSubsystem;
        this.historySubsystem = historySubsystem;
        this.counterSubsystem = counterSubsystem;
        this.markSubsystem = markSubsystem;
        this.cadenceSubsystem = cadenceSubsystem;
    }

    public void executeAll(RuntimeState state, List<EngineCommand> commands) {
        for (EngineCommand command : commands) {
            execute(state, command);
        }
    }

    public void executeDamagePacket(RuntimeState state, DamagePacket packet) {
        DamagePipelineResult pipelineResult = pipelineRunner.applyDamage(state, packet);
        for (TriggerEvent triggerEvent : pipelineResult.derivedTriggerEvents()) {
            executeAll(state, triggerDispatcher.dispatch(state, triggerEvent));
        }
    }

    public void expireStatus(RuntimeState state, String actorId, String statusId, long appliedAtMs) {
        execute(state, new EngineCommand.RemoveStatusCommand(actorId, statusId, appliedAtMs));
    }

    private void execute(RuntimeState state, EngineCommand command) {
        switch (command) {
            case EngineCommand.DealDamageCommand dealDamageCommand -> executeDealDamage(state, dealDamageCommand);
            case EngineCommand.GrantShieldCommand grantShieldCommand -> executeGrantShield(state, grantShieldCommand);
            case EngineCommand.ApplyStatusCommand applyStatusCommand -> executeApplyStatus(state, applyStatusCommand);
            case EngineCommand.RemoveStatusCommand removeStatusCommand -> executeRemoveStatus(state, removeStatusCommand);
            case EngineCommand.ApplyMarkCommand applyMarkCommand -> executeApplyMark(state, applyMarkCommand);
            case EngineCommand.ConsumeMarkCommand consumeMarkCommand -> executeConsumeMark(state, consumeMarkCommand);
            case EngineCommand.ModifyCounterCommand modifyCounterCommand -> executeModifyCounter(state, modifyCounterCommand);
            case EngineCommand.SpendResourceCommand spendResourceCommand -> executeSpendResource(state, spendResourceCommand);
            case EngineCommand.SetCooldownCommand setCooldownCommand -> executeSetCooldown(state, setCooldownCommand);
            case EngineCommand.ScheduleEventCommand scheduleEventCommand -> state.enqueue(new ScheduledEvent(
                    scheduleEventCommand.triggerAtMs(),
                    scheduleEventCommand.priority(),
                    state.nextSequence(),
                    scheduleEventCommand.payload()));
            case EngineCommand.ModifyCadenceCommand modifyCadenceCommand -> executeModifyCadence(state, modifyCadenceCommand);
        }
    }

    private void executeDealDamage(RuntimeState state, EngineCommand.DealDamageCommand command) {
        ActorRuntime source = state.actor(command.sourceActorId());
        ActorRuntime target = state.actor(command.targetActorId());
        double rawDamage = formulaService.evaluate(
                snapshot.formulaCatalog().require(command.formulaId()),
                new FormulaEvalContext(state, source, target, command.inputValues()));
        if (rawDamage <= 0.0) {
            return;
        }
        executeDamagePacket(state, new DamagePacket(
                command.sourceActorId(),
                command.targetActorId(),
                command.actionId(),
                command.label(),
                command.damageProfileId(),
                rawDamage));
    }

    private void executeGrantShield(RuntimeState state, EngineCommand.GrantShieldCommand command) {
        ActorRuntime source = state.actor(command.sourceActorId());
        ActorRuntime target = state.actor(command.targetActorId());
        double shieldAmount = formulaService.evaluate(
                snapshot.formulaCatalog().require(command.formulaId()),
                new FormulaEvalContext(state, source, target, command.inputValues()));
        ShieldGrantResult shieldGrantResult = shieldSubsystem.grantShield(target, state.nowMs(), command.label(), shieldAmount);
        state.log(new ShieldLogEntry(
                state.nowMs(),
                target.actorId(),
                command.label(),
                shieldGrantResult.requestedAmount(),
                shieldGrantResult.shieldBefore(),
                shieldGrantResult.shieldAfter()));
    }

    private void executeApplyStatus(RuntimeState state, EngineCommand.ApplyStatusCommand command) {
        ActorRuntime source = state.actor(command.sourceActorId());
        ActorRuntime target = state.actor(command.targetActorId());
        var statusTemplate = snapshot.statusTemplate(command.statusId());
        if (!controlSubsystem.canApply(target, statusTemplate.statusKind())) {
            return;
        }
        double magnitude = statusTemplate.magnitudeFormulaId() == null
                ? 0.0
                : formulaService.evaluate(
                        snapshot.formulaCatalog().require(statusTemplate.magnitudeFormulaId()),
                        new FormulaEvalContext(state, source, target, command.inputValues()));
        long expireAtMs = statusTemplate.durationMs() > 0 ? state.nowMs() + statusTemplate.durationMs() : 0L;
        List<AppliedAttrModifier> appliedAttrModifiers = new ArrayList<>();
        for (var attrModifierDef : statusTemplate.attrModifiers()) {
            double modifierValue = formulaService.evaluate(
                    snapshot.formulaCatalog().require(attrModifierDef.formulaId()),
                    new FormulaEvalContext(state, source, target, command.inputValues()));
            appliedAttrModifiers.add(new AppliedAttrModifier(
                    attrModifierDef.attrKey(),
                    attrModifierDef.mode(),
                    modifierValue));
        }
        StatusInstance statusInstance = new StatusInstance(
                statusTemplate.statusId(),
                source.actorId(),
                target.actorId(),
                statusTemplate.statusKind(),
                state.nowMs(),
                expireAtMs,
                magnitude,
                true,
                appliedAttrModifiers);
        if (statusTemplate.statusKind() == StatusKind.SHIELD) {
            shieldSubsystem.applyShieldStatus(target, statusInstance, statusTemplate.refreshPolicy());
        } else {
            controlSubsystem.putStatus(target, statusInstance);
        }
        if (statusTemplate.statusKind() == StatusKind.STUN && expireAtMs > state.nowMs()) {
            historySubsystem.recordControlWindow(target, state.nowMs(), expireAtMs);
        }
        executeAll(state, triggerDispatcher.dispatch(state, TriggerEvent.statusApplied(statusInstance)));
        if (expireAtMs > 0) {
            execute(state, new EngineCommand.ScheduleEventCommand(
                    expireAtMs,
                    50,
                    new InternalEvent.StatusExpire(target.actorId(), statusTemplate.statusId(), statusInstance.appliedAtMs())));
        }
    }

    private void executeRemoveStatus(RuntimeState state, EngineCommand.RemoveStatusCommand command) {
        ActorRuntime target = state.actor(command.targetActorId());
        StatusInstance statusInstance = target.status(command.statusId());
        if (statusInstance == null || !statusInstance.active() || statusInstance.appliedAtMs() != command.appliedAtMs()) {
            return;
        }
        target.removeStatus(command.statusId());
        executeAll(state, triggerDispatcher.dispatch(state, TriggerEvent.statusExpired(statusInstance)));
    }

    private void executeApplyMark(RuntimeState state, EngineCommand.ApplyMarkCommand command) {
        markSubsystem.applyMark(
                state,
                command.sourceActorId(),
                command.targetActorId(),
                command.markId(),
                command.expireAtMs(),
                command.consumable());
        executeAll(state, triggerDispatcher.dispatch(state, TriggerEvent.markApplied(
                command.sourceActorId(),
                command.targetActorId(),
                command.markId())));
    }

    private void executeConsumeMark(RuntimeState state, EngineCommand.ConsumeMarkCommand command) {
        markSubsystem.consumeMark(state, command.sourceActorId(), command.targetActorId(), command.markId());
        executeAll(state, triggerDispatcher.dispatch(state, TriggerEvent.markConsumed(
                command.sourceActorId(),
                command.targetActorId(),
                command.markId())));
    }

    private void executeModifyCounter(RuntimeState state, EngineCommand.ModifyCounterCommand command) {
        CounterChangeResult counterChangeResult = counterSubsystem.modify(
                state,
                command.sourceActorId(),
                command.targetActorId(),
                command.counterId(),
                command.counterScope(),
                command.delta(),
                command.threshold(),
                command.resetMode());
        if (counterChangeResult.thresholdTriggered()) {
            executeAll(state, triggerDispatcher.dispatch(state, TriggerEvent.counterThreshold(
                    command.sourceActorId(),
                    command.targetActorId(),
                    command.counterId(),
                    command.counterScope(),
                    counterChangeResult.value())));
        }
    }

    private void executeSpendResource(RuntimeState state, EngineCommand.SpendResourceCommand command) {
        ResourceState resourceState = state.actor(command.actorId()).resource(command.resourceId());
        if (resourceState != null) {
            resourceState.spend(command.amount());
        }
    }

    private void executeSetCooldown(RuntimeState state, EngineCommand.SetCooldownCommand command) {
        state.actor(command.actorId()).actionState(command.actionId()).setReadyAtMs(command.readyAtMs());
    }

    private void executeModifyCadence(RuntimeState state, EngineCommand.ModifyCadenceCommand command) {
        cadenceSubsystem.modifyCadence(
                state,
                state.actor(command.affectedActorId()),
                command.targetActionTags(),
                command.op(),
                command.value());
    }
}
