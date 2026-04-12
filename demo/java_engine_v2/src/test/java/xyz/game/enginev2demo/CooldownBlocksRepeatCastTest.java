package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;

class CooldownBlocksRepeatCastTest {

    @Test
    void actionThrowsWhenCastAgainBeforeCooldownReady() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 200.0), "arcane_bolt"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("arcane_bolt", DemoFixtures.actionWithConfig(
                        "arcane_bolt",
                        "Arcane Bolt",
                        DemoFixtures.TRUE_PROFILE,
                        "arcane_bolt_formula",
                        "arcane_bolt_cd",
                        Map.of(),
                        List.of(),
                        List.of())),
                DemoFixtures.constantFormula("arcane_bolt_formula", 10.0),
                DemoFixtures.constantFormula("arcane_bolt_cd", 100.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        IllegalStateException exception = assertThrows(
                IllegalStateException.class,
                () -> facade.run(
                        facade.init(bundle),
                        DemoFixtures.runInput(List.of(
                                new ActionRequest(0, "self", "enemy", "arcane_bolt"),
                                new ActionRequest(1, "self", "enemy", "arcane_bolt")))));

        assertEquals("action_blocked:cooldown", exception.getMessage());
    }
}
