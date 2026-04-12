package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;

class RecentDamageWindowAggregateTest {

    @Test
    void recentDamageFormulaAggregatesDamageTakenInsideWindow() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 200.0), "revenge_punch"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0), "jab_20", "jab_30")),
                Map.of(
                        "revenge_punch", DemoFixtures.action(
                                "revenge_punch",
                                "Revenge Punch",
                                DemoFixtures.TRUE_PROFILE,
                                "revenge_formula"),
                        "jab_20", DemoFixtures.action(
                                "jab_20",
                                "Jab 20",
                                DemoFixtures.TRUE_PROFILE,
                                "jab_20_formula"),
                        "jab_30", DemoFixtures.action(
                                "jab_30",
                                "Jab 30",
                                DemoFixtures.TRUE_PROFILE,
                                "jab_30_formula")),
                DemoFixtures.recentDamageFormula(
                        "revenge_formula",
                        xyz.game.enginev2demo.formula.FormulaNode.Scope.SOURCE,
                        5000L),
                DemoFixtures.constantFormula("jab_20_formula", 20.0),
                DemoFixtures.constantFormula("jab_30_formula", 30.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(
                        new ActionRequest(0, "enemy", "self", "jab_20"),
                        new ActionRequest(1, "enemy", "self", "jab_30"),
                        new ActionRequest(2, "self", "enemy", "revenge_punch"))));

        assertEquals(150.0, result.actors().get("self").currentHp(), 1e-9);
        assertEquals(150.0, result.actors().get("enemy").currentHp(), 1e-9);
    }
}
