package xyz.game.enginev2demo;

import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

final class SettWSampleFactory {

    private SettWSampleFactory() {
    }

    static EngineBundle bundle() {
        return DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actorWithTriggers(
                                "self_template",
                                Map.of("max_hp", 400.0),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.grantShieldEffect(
                                                "Haymaker Shield",
                                                "sett_w_shield_formula",
                                                EventActorRole.SOURCE,
                                                EventActorRole.SOURCE))),
                                "sett_w"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 400.0),
                                "jab")),
                Map.of(
                        "sett_w", DemoFixtures.action(
                                "sett_w",
                                "Haymaker",
                                DemoFixtures.TRUE_PROFILE,
                                "sett_w_damage_formula"),
                        "jab", DemoFixtures.action(
                                "jab",
                                "Jab",
                                DemoFixtures.PHYSICAL_PROFILE,
                                "jab_formula")),
                Map.of(),
                Map.of(),
                DemoFixtures.recentDamageFormula(
                        "sett_w_damage_formula",
                        xyz.game.enginev2demo.formula.FormulaNode.Scope.SOURCE,
                        5000L),
                DemoFixtures.recentDamageFormula(
                        "sett_w_shield_formula",
                        xyz.game.enginev2demo.formula.FormulaNode.Scope.SOURCE,
                        5000L),
                DemoFixtures.constantFormula("jab_formula", 30.0));
    }

    static EngineRunInput runInput() {
        return DemoFixtures.runInput(List.of(
                new ActionRequest(0, "enemy", "self", "jab"),
                new ActionRequest(1, "enemy", "self", "jab"),
                new ActionRequest(2, "self", "enemy", "sett_w")));
    }
}
