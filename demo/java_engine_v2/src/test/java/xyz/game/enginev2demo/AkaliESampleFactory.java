package xyz.game.enginev2demo;

import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

final class AkaliESampleFactory {

    private static final String MARK_ID = "akali_e_mark";

    private AkaliESampleFactory() {
    }

    static EngineBundle bundle() {
        return DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 250.0), "akali_e1", "akali_e2"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 300.0))),
                Map.of(
                        "akali_e1", DemoFixtures.actionWithConfig(
                                "akali_e1",
                                "Shuriken Flip",
                                DemoFixtures.MAGICAL_PROFILE,
                                "akali_e1_formula",
                                DemoFixtures.FORMULA_ZERO_COOLDOWN,
                                Map.of(),
                                List.of(),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_DAMAGE_DEALT,
                                        EventActorRole.SOURCE,
                                        true,
                                        DemoFixtures.applyMarkEffect(
                                                MARK_ID,
                                                5000L,
                                                true,
                                                EventActorRole.SOURCE,
                                                EventActorRole.TARGET)))),
                        "akali_e2", DemoFixtures.actionWithConfig(
                                "akali_e2",
                                "Flip Back",
                                DemoFixtures.MAGICAL_PROFILE,
                                "akali_e2_formula",
                                DemoFixtures.FORMULA_ZERO_COOLDOWN,
                                Map.of(),
                                List.of(DemoFixtures.requireMarkGate(MARK_ID)),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.consumeMarkEffect(
                                                MARK_ID,
                                                EventActorRole.SOURCE,
                                                EventActorRole.TARGET))))),
                Map.of(),
                Map.of(),
                DemoFixtures.constantFormula("akali_e1_formula", 40.0),
                DemoFixtures.constantFormula("akali_e2_formula", 70.0));
    }

    static EngineRunInput runInput() {
        return DemoFixtures.runInput(List.of(
                new ActionRequest(0, "self", "enemy", "akali_e1"),
                new ActionRequest(1, "self", "enemy", "akali_e2")));
    }
}
