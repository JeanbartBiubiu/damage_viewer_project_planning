package xyz.game.enginev2demo.pipeline;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.compile.CompiledSnapshot;
import xyz.game.enginev2demo.control.ControlSubsystem;
import xyz.game.enginev2demo.formula.FormulaEvalContext;
import xyz.game.enginev2demo.formula.FormulaService;
import xyz.game.enginev2demo.history.HistorySubsystem;
import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;
import xyz.game.enginev2demo.shield.ShieldSubsystem;
import xyz.game.enginev2demo.trigger.TriggerEvent;

/**
 * 统一伤害管线。
 */
public final class PipelineRunner {

    private final CompiledSnapshot snapshot;
    private final FormulaService formulaService;
    private final ShieldSubsystem shieldSubsystem;
    private final ControlSubsystem controlSubsystem;
    private final HistorySubsystem historySubsystem;

    public PipelineRunner(
            CompiledSnapshot snapshot,
            FormulaService formulaService,
            ShieldSubsystem shieldSubsystem,
            ControlSubsystem controlSubsystem,
            HistorySubsystem historySubsystem) {
        this.snapshot = snapshot;
        this.formulaService = formulaService;
        this.shieldSubsystem = shieldSubsystem;
        this.controlSubsystem = controlSubsystem;
        this.historySubsystem = historySubsystem;
    }

    public DamagePipelineResult applyDamage(RuntimeState state, DamagePacket packet) {
        ActorRuntime source = state.actor(packet.sourceActorId());
        ActorRuntime target = state.actor(packet.targetActorId());
        DamageProfileTemplate damageProfile = snapshot.damageProfile(packet.damageProfileId());

        Map<String, Double> profileInputs = new LinkedHashMap<>();
        profileInputs.put("raw_damage", packet.rawDamage());

        double effectiveResistance = formulaService.evaluate(
                snapshot.formulaCatalog(),
                damageProfile.effectiveResistanceFormulaId(),
                new FormulaEvalContext(state, source, target, profileInputs));

        Map<String, Double> mitigationInputs = new LinkedHashMap<>(profileInputs);
        mitigationInputs.put("effective_resistance", effectiveResistance);
        double mitigationMultiplier = formulaService.evaluate(
                snapshot.formulaCatalog(),
                damageProfile.mitigationMultiplierFormulaId(),
                new FormulaEvalContext(state, source, target, mitigationInputs));

        double dealtDamage = packet.rawDamage() * mitigationMultiplier;
        if (controlSubsystem.forcesZeroDamage(target)) {
            dealtDamage = 0.0;
        }
        double shieldAbsorbed = shieldSubsystem.absorbBeforeHp(target, dealtDamage);
        double hpDamage = dealtDamage - shieldAbsorbed;
        double targetHpBefore = target.currentHp();
        double targetHpAfter = Math.max(0.0, targetHpBefore - hpDamage);
        target.setCurrentHp(targetHpAfter);
        historySubsystem.recordDamageTaken(target, state.nowMs(), dealtDamage);

        DamageResolvedEvent resolvedEvent = new DamageResolvedEvent(
                state.nowMs(),
                packet.sourceActorId(),
                packet.targetActorId(),
                packet.actionId(),
                packet.label(),
                packet.damageProfileId(),
                packet.rawDamage(),
                dealtDamage,
                shieldAbsorbed,
                hpDamage,
                targetHpBefore,
                targetHpAfter,
                effectiveResistance,
                mitigationMultiplier,
                packet.isCritical(),
                packet.critMultiplier(),
                packet.critType());
        state.log(new DamageLogEntry(
                resolvedEvent.timeMs(),
                resolvedEvent.sourceActorId(),
                resolvedEvent.targetActorId(),
                resolvedEvent.actionId(),
                resolvedEvent.label(),
                resolvedEvent.damageProfileId(),
                resolvedEvent.rawDamage(),
                resolvedEvent.dealtDamage(),
                resolvedEvent.shieldAbsorbed(),
                resolvedEvent.hpDamage(),
                resolvedEvent.targetHpBefore(),
                resolvedEvent.targetHpAfter(),
                resolvedEvent.effectiveResistance(),
                resolvedEvent.mitigationMultiplier(),
                resolvedEvent.isCritical(),
                resolvedEvent.critMultiplier(),
                resolvedEvent.critType()));
        return new DamagePipelineResult(
                resolvedEvent,
                List.of(TriggerEvent.damageDealt(resolvedEvent), TriggerEvent.damageTaken(resolvedEvent)));
    }
}
