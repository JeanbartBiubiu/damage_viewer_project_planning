package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class ShieldRefreshPolicyTest {

    @Test
    void shieldStatusRefreshKeepsMaximumMagnitude() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 200.0, "ability_power", 20.0),
                                "self_barrier"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 200.0, "ability_power", 50.0),
                                "ally_barrier")),
                Map.of(
                        "self_barrier", DemoFixtures.actionWithConfig(
                                "self_barrier",
                                "Self Barrier",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                DemoFixtures.FORMULA_ZERO_COOLDOWN,
                                Map.of(),
                                List.of(),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect(
                                                "barrier",
                                                EventActorRole.SOURCE,
                                                EventActorRole.SOURCE)))),
                        "ally_barrier", DemoFixtures.actionWithConfig(
                                "ally_barrier",
                                "Ally Barrier",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                DemoFixtures.FORMULA_ZERO_COOLDOWN,
                                Map.of(),
                                List.of(),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect(
                                                "barrier",
                                                EventActorRole.SOURCE,
                                                EventActorRole.TARGET))))),
                Map.of(),
                Map.of("barrier", DemoFixtures.status(
                        "barrier",
                        "Barrier",
                        StatusKind.SHIELD,
                        5000L,
                        StatusRefreshPolicy.TAKE_MAX,
                        "barrier_formula")),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.sourceAttrFormula("barrier_formula", "ability_power"));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunInput runInput = new EngineRunInput(
                7L,
                new StopCondition(2L),
                DemoFixtures.combatant("self", "self_template"),
                DemoFixtures.combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "self", "self_barrier"),
                        new ActionRequest(1, "enemy", "self", "ally_barrier")));
        EngineRunResult result = facade.run(
                facade.init(bundle),
                runInput);

        assertEquals(50.0, result.actors().get("self").shieldAmount(), 1e-9);
    }
}
