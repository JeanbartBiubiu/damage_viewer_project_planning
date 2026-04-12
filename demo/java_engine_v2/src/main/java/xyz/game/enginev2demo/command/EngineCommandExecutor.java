package xyz.game.enginev2demo.command;

import java.util.ArrayList;
import java.util.List;

import xyz.game.enginev2demo.cadence.CadenceSubsystem;
import xyz.game.enginev2demo.compile.CompiledSnapshot;
import xyz.game.enginev2demo.control.ControlSubsystem;
import xyz.game.enginev2demo.counter.CounterChangeResult;
import xyz.game.enginev2demo.counter.CounterSubsystem;
import xyz.game.enginev2demo.crit.CritSubsystem;
import xyz.game.enginev2demo.crit.ExecutionCritResult;
import xyz.game.enginev2demo.crit.ResolvedScalar;
import xyz.game.enginev2demo.crit.ScalarEffectLogEntry;
import xyz.game.enginev2demo.crit.ScalarResolutionService;
import xyz.game.enginev2demo.crit.ScalarSpec;
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
    private final CritSubsystem critSubsystem;
    private final ScalarResolutionService scalarResolutionService;

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
            CadenceSubsystem cadenceSubsystem,
            CritSubsystem critSubsystem,
            ScalarResolutionService scalarResolutionService) {
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
        this.critSubsystem = critSubsystem;
        this.scalarResolutionService = scalarResolutionService;
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

        ScalarSpec spec = new ScalarSpec(command.formulaId(), command.allowCrit(), command.critTypeOverride());
        ExecutionCritResult ecr = command.executionCritResult();
        ResolvedScalar resolved = scalarResolutionService.resolveScalar(
                spec, state, source, target, command.inputValues(), command.actionCritType(), ecr);
        double rawDamage = resolved.finalValue();
        if (rawDamage <= 0.0) {
            return;
        }
        executeDamagePacket(state, new DamagePacket(
                command.sourceActorId(),
                command.targetActorId(),
                command.actionId(),
                command.label(),
                command.damageProfileId(),
                rawDamage,
                resolved.isCritical(),
                resolved.critMultiplier(),
                resolved.critType()));
    }

    private void executeGrantShield(RuntimeState state, EngineCommand.GrantShieldCommand command) {
        ActorRuntime source = state.actor(command.sourceActorId());
        ActorRuntime target = state.actor(command.targetActorId());

        ScalarSpec spec = new ScalarSpec(command.formulaId(), command.allowCrit(), command.critTypeOverride());
        ExecutionCritResult ecr = command.executionCritResult();
        ResolvedScalar resolved = scalarResolutionService.resolveScalar(
                spec, state, source, target, command.inputValues(), command.actionCritType(), ecr);
        double shieldAmount = resolved.finalValue();

        ShieldGrantResult shieldGrantResult = shieldSubsystem.grantShield(target, state.nowMs(), command.label(), shieldAmount);
        state.log(new ShieldLogEntry(
                state.nowMs(),
                target.actorId(),
                command.label(),
                shieldGrantResult.requestedAmount(),
                shieldGrantResult.shieldBefore(),
                shieldGrantResult.shieldAfter()));
        if (resolved.isCritical() || resolved.baseValue() != resolved.finalValue()) {
            state.log(new ScalarEffectLogEntry(
                    state.nowMs(),
                    command.sourceActorId(),
                    target.actorId(),
                    null,
                    "shield",
                    resolved.baseValue(),
                    resolved.finalValue(),
                    resolved.isCritical(),
                    resolved.critMultiplier(),
                    resolved.critType()));
        }
    }

    private void executeApplyStatus(RuntimeState state, EngineCommand.ApplyStatusCommand command) {
        ActorRuntime source = state.actor(command.sourceActorId());
        ActorRuntime target = state.actor(command.targetActorId());
        var statusTemplate = snapshot.statusTemplate(command.statusId());
        if (!controlSubsystem.canApply(target, statusTemplate.statusKind())) {
            return;
        }

        boolean allowCrit = command.allowCrit();
        String critTypeOverride = command.critTypeOverride();
        String actionCritType = command.actionCritType();
        ExecutionCritResult ecr = command.executionCritResult();

        double magnitude = 0.0;
        if (statusTemplate.magnitudeFormulaId() != null) {
            ScalarSpec magSpec = new ScalarSpec(statusTemplate.magnitudeFormulaId(), allowCrit, critTypeOverride);
            ResolvedScalar resolvedMag = scalarResolutionService.resolveScalar(
                    magSpec, state, source, target, command.inputValues(), actionCritType, ecr);
            magnitude = resolvedMag.finalValue();
            if (resolvedMag.isCritical()) {
                state.log(new ScalarEffectLogEntry(
                        state.nowMs(), command.sourceActorId(), command.targetActorId(), null,
                        "status_magnitude", resolvedMag.baseValue(), resolvedMag.finalValue(),
                        true, resolvedMag.critMultiplier(), resolvedMag.critType()));
            }
        }

        long baseDuration = statusTemplate.durationMs();
        long expireAtMs = 0L;
        if (baseDuration > 0) {
            if (allowCrit && ecr != null && ecr.resolved() && ecr.isCritical()) {
                // 持续时间也受暴击放大
                long crittedDuration = Math.round(baseDuration * ecr.critMultiplier());
                expireAtMs = state.nowMs() + crittedDuration;
                state.log(new ScalarEffectLogEntry(
                        state.nowMs(), command.sourceActorId(), command.targetActorId(), null,
                        "status_duration", baseDuration, crittedDuration,
                        true, ecr.critMultiplier(), ecr.critType()));
            } else {
                expireAtMs = state.nowMs() + baseDuration;
            }
        }

        List<AppliedAttrModifier> appliedAttrModifiers = new ArrayList<>();
        for (var attrModifierDef : statusTemplate.attrModifiers()) {
            ScalarSpec attrSpec = new ScalarSpec(attrModifierDef.formulaId(), allowCrit, critTypeOverride);
            ResolvedScalar resolvedAttr = scalarResolutionService.resolveScalar(
                    attrSpec, state, source, target, command.inputValues(), actionCritType, ecr);
            appliedAttrModifiers.add(new AppliedAttrModifier(
                    attrModifierDef.attrKey(),
                    attrModifierDef.mode(),
                    resolvedAttr.finalValue()));
            if (resolvedAttr.isCritical()) {
                state.log(new ScalarEffectLogEntry(
                        state.nowMs(), command.sourceActorId(), command.targetActorId(), null,
                        "attr_modifier", resolvedAttr.baseValue(), resolvedAttr.finalValue(),
                        true, resolvedAttr.critMultiplier(), resolvedAttr.critType()));
            }
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
        double value = command.value();
        // 如果 cadence value 允许暴击且有 execution crit 上下文
        if (command.allowCrit() && command.executionCritResult() != null
                && command.executionCritResult().resolved() && command.executionCritResult().isCritical()) {
            double baseValue = value;
            value = value * command.executionCritResult().critMultiplier();
            state.log(new ScalarEffectLogEntry(
                    state.nowMs(), command.affectedActorId(), command.affectedActorId(), null,
                    "cadence_modify", baseValue, value,
                    true, command.executionCritResult().critMultiplier(),
                    command.executionCritResult().critType()));
        }
        cadenceSubsystem.modifyCadence(
                state,
                state.actor(command.affectedActorId()),
                command.targetActionTags(),
                command.op(),
                value);
    }
}
