package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;

class ManaBlocksCastTest {

    @Test
    void actionThrowsWhenResourceCostCannotBePaid() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actorWithResources(
                                "self_template",
                                Map.of("max_hp", 200.0),
                                Map.of("mana", 20.0),
                                "mana_burst"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("mana_burst", DemoFixtures.actionWithConfig(
                        "mana_burst",
                        "Mana Burst",
                        DemoFixtures.TRUE_PROFILE,
                        "mana_burst_formula",
                        DemoFixtures.FORMULA_ZERO_COOLDOWN,
                        Map.of("mana", 30.0),
                        List.of(),
                        List.of())),
                DemoFixtures.constantFormula("mana_burst_formula", 10.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        IllegalStateException exception = assertThrows(
                IllegalStateException.class,
                () -> facade.run(
                        facade.init(bundle),
                        DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "mana_burst")))));

        assertEquals("action_blocked:resource:mana", exception.getMessage());
    }
}
