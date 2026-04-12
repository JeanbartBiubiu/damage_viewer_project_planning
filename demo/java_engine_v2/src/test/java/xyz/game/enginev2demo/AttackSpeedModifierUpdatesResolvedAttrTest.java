package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class AttackSpeedModifierUpdatesResolvedAttrTest {

    @Test
    void formulaReadsResolvedAttackSpeedAfterBuff() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 200.0, "attack_speed", 1.0),
                                "speed_up",
                                "probe"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of(
                        "speed_up", DemoFixtures.actionWithTriggers(
                                "speed_up",
                                "Speed Up",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect("speed_buff", EventActorRole.SOURCE, EventActorRole.SOURCE)))),
                        "probe", DemoFixtures.action(
                                "probe",
                                "Probe",
                                DemoFixtures.TRUE_PROFILE,
                                "probe_formula")),
                Map.of(),
                Map.of("speed_buff", DemoFixtures.attributeModifierStatus(
                        "speed_buff",
                        "Speed Buff",
                        1_000L,
                        DemoFixtures.percentModifier("attack_speed", "speed_bonus_formula"))),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula("speed_bonus_formula", 0.5),
                DemoFixtures.sourceAttrFormula("probe_formula", "attack_speed"));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(2),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "self", "enemy", "speed_up"),
                                new ActionRequest(1, "self", "enemy", "probe"))));

        DamageLogEntry damageLog = assertInstanceOf(DamageLogEntry.class, result.logs().get(2));
        assertEquals(1.5, damageLog.dealtDamage(), 1e-9);
        assertEquals(1.5, result.actors().get("self").attributes().get("attack_speed"), 1e-9);
    }
}
