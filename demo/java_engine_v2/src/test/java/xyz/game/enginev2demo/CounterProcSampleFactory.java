package xyz.game.enginev2demo;

import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.runtime.CounterResetMode;
import xyz.game.enginev2demo.runtime.CounterScope;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

final class CounterProcSampleFactory {

    private CounterProcSampleFactory() {
    }

    static EngineBundle bundle() {
        return DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actorWithTriggers(
                                "self_template",
                                Map.of("max_hp", 250.0),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_COUNTER_THRESHOLD,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.dealDamageEffect(
                                                "counter_proc",
                                                "Counter Proc",
                                                DemoFixtures.MAGICAL_PROFILE,
                                                "counter_proc_formula",
                                                EventActorRole.SOURCE,
                                                EventActorRole.TARGET))),
                                "ember_hit"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("ember_hit", DemoFixtures.actionWithConfig(
                        "ember_hit",
                        "Ember Hit",
                        DemoFixtures.MAGICAL_PROFILE,
                        "ember_hit_formula",
                        DemoFixtures.FORMULA_ZERO_COOLDOWN,
                        Map.of(),
                        List.of(),
                        List.of(DemoFixtures.trigger(
                                TriggerType.ON_DAMAGE_DEALT,
                                EventActorRole.SOURCE,
                                true,
                                DemoFixtures.modifyCounterEffect(
                                        "three_hit",
                                        CounterScope.PAIR,
                                        1,
                                        3,
                                        CounterResetMode.ZERO,
                                        EventActorRole.SOURCE,
                                        EventActorRole.TARGET))))),
                Map.of(),
                Map.of(),
                DemoFixtures.constantFormula("ember_hit_formula", 10.0),
                DemoFixtures.constantFormula("counter_proc_formula", 15.0));
    }

    static EngineRunInput runInput() {
        return DemoFixtures.runInput(List.of(
                new ActionRequest(0, "self", "enemy", "ember_hit"),
                new ActionRequest(1, "self", "enemy", "ember_hit"),
                new ActionRequest(2, "self", "enemy", "ember_hit")));
    }
}
