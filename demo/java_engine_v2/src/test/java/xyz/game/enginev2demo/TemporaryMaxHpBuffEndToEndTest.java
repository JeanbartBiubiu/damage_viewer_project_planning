package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class TemporaryMaxHpBuffEndToEndTest {

    @Test
    void temporaryMaxHpBuffRaisesCapThenClampsBackOnExpire() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 100.0, "current_hp", 140.0),
                                "fortify"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("fortify", DemoFixtures.actionWithTriggers(
                        "fortify",
                        "Fortify",
                        DemoFixtures.TRUE_PROFILE,
                        "zero_formula",
                        List.of(DemoFixtures.trigger(
                                TriggerType.ON_ACTION_CAST,
                                EventActorRole.SOURCE,
                                false,
                                DemoFixtures.applyStatusEffect("max_hp_buff", EventActorRole.SOURCE, EventActorRole.SOURCE))))),
                Map.of(),
                Map.of("max_hp_buff", DemoFixtures.attributeModifierStatus(
                        "max_hp_buff",
                        "Max HP Buff",
                        100L,
                        DemoFixtures.flatModifier("max_hp", "max_hp_bonus_formula"))),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula("max_hp_bonus_formula", 50.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(2),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(new ActionRequest(0, "self", "enemy", "fortify"))));

        assertEquals(100.0, result.actors().get("self").currentHp(), 1e-9);
        assertEquals(100.0, result.actors().get("self").attributes().get("max_hp"), 1e-9);
    }
}
