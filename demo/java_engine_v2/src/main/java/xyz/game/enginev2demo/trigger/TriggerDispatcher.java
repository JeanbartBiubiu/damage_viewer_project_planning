package xyz.game.enginev2demo.trigger;

import java.util.ArrayList;
import java.util.List;

import xyz.game.enginev2demo.command.EngineCommand;
import xyz.game.enginev2demo.compile.CompiledSnapshot;
import xyz.game.enginev2demo.formula.FormulaEvalContext;
import xyz.game.enginev2demo.formula.FormulaService;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 通用 trigger 分发器。
 */
public final class TriggerDispatcher {

    private final CompiledSnapshot snapshot;
    private final FormulaService formulaService;
    private final TriggerIndex triggerIndex;

    public TriggerDispatcher(
            CompiledSnapshot snapshot,
            FormulaService formulaService,
            TriggerIndex triggerIndex) {
        this.snapshot = snapshot;
        this.formulaService = formulaService;
        this.triggerIndex = triggerIndex;
    }

    public List<EngineCommand> dispatch(RuntimeState state, TriggerEvent event) {
        List<EngineCommand> commands = new ArrayList<>();
        for (CompiledTriggerSubscription compiledSubscription : triggerIndex.subscriptions(event.type())) {
            if (!matches(state, event, compiledSubscription)) {
                continue;
            }
            commands.addAll(toCommands(state, event, compiledSubscription.subscription()));
        }
        return List.copyOf(commands);
    }

    private boolean matches(RuntimeState state, TriggerEvent event, CompiledTriggerSubscription compiledSubscription) {
        TriggerSubscriptionDef subscription = compiledSubscription.subscription();
        if (subscription.requiresPositiveDamage()
                && event.inputValues().getOrDefault("dealt_damage", 0.0) <= 0.0) {
            return false;
        }
        String ownerActorId = actorIdForRole(event, subscription.ownerEventRole());
        ActorRuntime ownerActor = state.actor(ownerActorId);
        boolean ownerMatches = switch (compiledSubscription.ownerScope()) {
            case ACTOR -> ownerActor.templateId().equals(compiledSubscription.ownerId());
            case ITEM -> ownerActor.hasEquippedItem(compiledSubscription.ownerId());
            case ACTION -> ownerActor.hasAction(compiledSubscription.ownerId())
                    && compiledSubscription.ownerId().equals(event.actionId());
            case STATUS -> ownerActor.hasActiveStatus(compiledSubscription.ownerId());
        };
        if (!ownerMatches) {
            return false;
        }
        if (subscription.conditionFormulaId() == null) {
            return true;
        }
        ActorRuntime source = state.actor(event.sourceActorId());
        ActorRuntime target = state.actor(event.targetActorId());
        double condition = formulaService.evaluate(
                snapshot.formulaCatalog().require(subscription.conditionFormulaId()),
                new FormulaEvalContext(state, source, target, event.inputValues()));
        return condition > 0.0;
    }

    private List<EngineCommand> toCommands(RuntimeState state, TriggerEvent event, TriggerSubscriptionDef subscription) {
        List<EngineCommand> commands = new ArrayList<>();
        for (EffectDef effect : subscription.effects()) {
            switch (effect) {
                case EffectDef.DealDamageEffect dealDamageEffect -> commands.add(new EngineCommand.DealDamageCommand(
                        actorIdForRole(event, dealDamageEffect.sourceActorRole()),
                        actorIdForRole(event, dealDamageEffect.targetActorRole()),
                        dealDamageEffect.actionId(),
                        dealDamageEffect.label(),
                        dealDamageEffect.damageProfileId(),
                        dealDamageEffect.formulaId(),
                        event.inputValues(),
                        dealDamageEffect.allowCrit(),
                        dealDamageEffect.critTypeOverride(),
                        event.actionCritType(),
                        event.executionCritResult()));
                case EffectDef.GrantShieldEffect grantShieldEffect -> commands.add(new EngineCommand.GrantShieldCommand(
                        actorIdForRole(event, grantShieldEffect.sourceActorRole()),
                        actorIdForRole(event, grantShieldEffect.targetActorRole()),
                        grantShieldEffect.label(),
                        grantShieldEffect.formulaId(),
                        event.inputValues(),
                        grantShieldEffect.allowCrit(),
                        grantShieldEffect.critTypeOverride(),
                        event.actionCritType(),
                        event.executionCritResult()));
                case EffectDef.ApplyStatusEffect applyStatusEffect -> commands.add(new EngineCommand.ApplyStatusCommand(
                        actorIdForRole(event, applyStatusEffect.sourceActorRole()),
                        actorIdForRole(event, applyStatusEffect.targetActorRole()),
                        applyStatusEffect.statusId(),
                        event.inputValues(),
                        applyStatusEffect.allowCrit(),
                        applyStatusEffect.critTypeOverride(),
                        event.actionCritType(),
                        event.executionCritResult()));
                case EffectDef.ApplyMarkEffect applyMarkEffect -> commands.add(new EngineCommand.ApplyMarkCommand(
                        actorIdForRole(event, applyMarkEffect.sourceActorRole()),
                        actorIdForRole(event, applyMarkEffect.targetActorRole()),
                        applyMarkEffect.markId(),
                        state.nowMs() + applyMarkEffect.durationMs(),
                        applyMarkEffect.consumable(),
                        event.inputValues()));
                case EffectDef.ConsumeMarkEffect consumeMarkEffect -> commands.add(new EngineCommand.ConsumeMarkCommand(
                        actorIdForRole(event, consumeMarkEffect.sourceActorRole()),
                        actorIdForRole(event, consumeMarkEffect.targetActorRole()),
                        consumeMarkEffect.markId()));
                case EffectDef.ModifyCounterEffect modifyCounterEffect -> commands.add(new EngineCommand.ModifyCounterCommand(
                        actorIdForRole(event, modifyCounterEffect.sourceActorRole()),
                        actorIdForRole(event, modifyCounterEffect.targetActorRole()),
                        modifyCounterEffect.counterId(),
                        modifyCounterEffect.counterScope(),
                        modifyCounterEffect.delta(),
                        modifyCounterEffect.threshold(),
                        modifyCounterEffect.resetMode(),
                        event.inputValues()));
                case EffectDef.ModifyCadenceEffect modifyCadenceEffect -> {
                    String affectedActorId = actorIdForRole(event, modifyCadenceEffect.affectedActorRole());
                    double value = 0.0;
                    if (modifyCadenceEffect.valueFormulaId() != null) {
                        ActorRuntime source = state.actor(event.sourceActorId());
                        ActorRuntime target = state.actor(event.targetActorId());
                        value = formulaService.evaluate(
                                snapshot.formulaCatalog().require(modifyCadenceEffect.valueFormulaId()),
                                new FormulaEvalContext(state, source, target, event.inputValues()));
                    }
                    commands.add(new EngineCommand.ModifyCadenceCommand(
                            affectedActorId,
                            modifyCadenceEffect.targetActionTags(),
                            modifyCadenceEffect.op(),
                            value,
                            modifyCadenceEffect.allowCrit(),
                            modifyCadenceEffect.critTypeOverride(),
                            event.actionCritType(),
                            event.executionCritResult()));
                }
            }
        }
        return List.copyOf(commands);
    }

    private String actorIdForRole(TriggerEvent event, EventActorRole eventActorRole) {
        return eventActorRole == EventActorRole.SOURCE ? event.sourceActorId() : event.targetActorId();
    }
}
