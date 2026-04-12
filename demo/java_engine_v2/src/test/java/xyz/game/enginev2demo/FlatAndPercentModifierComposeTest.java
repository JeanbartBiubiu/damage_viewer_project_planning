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

class FlatAndPercentModifierComposeTest {

    @Test
    void flatAndPercentModifiersComposeAsBasePlusFlatTimesOnePlusPercent() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 200.0, "attack_damage", 100.0),
                                "flat_buff",
                                "percent_buff",
                                "probe"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 500.0))),
                Map.of(
                        "flat_buff", DemoFixtures.actionWithTriggers(
                                "flat_buff",
                                "Flat Buff",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect("flat_buff_status", EventActorRole.SOURCE, EventActorRole.SOURCE)))),
                        "percent_buff", DemoFixtures.actionWithTriggers(
                                "percent_buff",
                                "Percent Buff",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect("percent_buff_status", EventActorRole.SOURCE, EventActorRole.SOURCE)))),
                        "probe", DemoFixtures.action(
                                "probe",
                                "Probe",
                                DemoFixtures.TRUE_PROFILE,
                                "probe_formula")),
                Map.of(),
                Map.of(
                        "flat_buff_status", DemoFixtures.attributeModifierStatus(
                                "flat_buff_status",
                                "Flat Buff Status",
                                1_000L,
                                DemoFixtures.flatModifier("attack_damage", "flat_bonus_formula")),
                        "percent_buff_status", DemoFixtures.attributeModifierStatus(
                                "percent_buff_status",
                                "Percent Buff Status",
                                1_000L,
                                DemoFixtures.percentModifier("attack_damage", "percent_bonus_formula"))),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula("flat_bonus_formula", 20.0),
                DemoFixtures.constantFormula("percent_bonus_formula", 0.5),
                DemoFixtures.sourceAttrFormula("probe_formula", "attack_damage"));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(3),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "self", "enemy", "flat_buff"),
                                new ActionRequest(1, "self", "enemy", "percent_buff"),
                                new ActionRequest(2, "self", "enemy", "probe"))));

        DamageLogEntry damageLog = assertInstanceOf(DamageLogEntry.class, result.logs().get(3));
        assertEquals(180.0, damageLog.dealtDamage(), 1e-9);
        assertEquals(180.0, result.actors().get("self").attributes().get("attack_damage"), 1e-9);
    }
}
