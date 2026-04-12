package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;

class StunBlocksActionTest {

    @Test
    void stunnedActorCannotCastActions() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 200.0), "panic"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("panic", DemoFixtures.action(
                        "panic",
                        "Panic",
                        DemoFixtures.TRUE_PROFILE,
                        "panic_formula")),
                Map.of(),
                Map.of("hard_stun", DemoFixtures.status(
                        "hard_stun",
                        "Hard Stun",
                        StatusKind.STUN,
                        0L,
                        StatusRefreshPolicy.REPLACE,
                        null)),
                DemoFixtures.constantFormula("panic_formula", 10.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        IllegalStateException exception = assertThrows(
                IllegalStateException.class,
                () -> facade.run(
                        facade.init(bundle),
                        DemoFixtures.runInput(
                                DemoFixtures.combatant("self", "self_template", List.of(), List.of("hard_stun")),
                                DemoFixtures.combatant("enemy", "enemy_template"),
                                List.of(new ActionRequest(0, "self", "enemy", "panic")))));

        assertEquals("action_blocked:control:STUN", exception.getMessage());
    }
}
