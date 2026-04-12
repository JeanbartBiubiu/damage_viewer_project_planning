package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class RecentControlDurationAggregateTest {

    @Test
    void recentControlDurationFormulaAggregatesExpiredControlWindows() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 2000.0), "purge_strike"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 2000.0), "stun_bolt")),
                Map.of(
                        "purge_strike", DemoFixtures.action(
                                "purge_strike",
                                "Purge Strike",
                                DemoFixtures.TRUE_PROFILE,
                                "purge_formula"),
                        "stun_bolt", DemoFixtures.actionWithConfig(
                                "stun_bolt",
                                "Stun Bolt",
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
                                                "short_stun",
                                                EventActorRole.SOURCE,
                                                EventActorRole.TARGET))))),
                Map.of(),
                Map.of("short_stun", DemoFixtures.status(
                        "short_stun",
                        "Short Stun",
                        StatusKind.STUN,
                        400L,
                        StatusRefreshPolicy.REPLACE,
                        null)),
                DemoFixtures.recentControlFormula(
                        "purge_formula",
                        xyz.game.enginev2demo.formula.FormulaNode.Scope.SOURCE,
                        5000L),
                DemoFixtures.constantFormula("zero_formula", 0.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(
                        new ActionRequest(0, "enemy", "self", "stun_bolt"),
                        new ActionRequest(500, "enemy", "self", "stun_bolt"),
                        new ActionRequest(1000, "self", "enemy", "purge_strike"))));

        assertEquals(1200.0, result.actors().get("enemy").currentHp(), 1e-9);
    }
}
