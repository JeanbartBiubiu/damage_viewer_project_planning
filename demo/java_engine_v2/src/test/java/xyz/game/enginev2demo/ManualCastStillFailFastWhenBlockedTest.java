package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.formula.FormulaDefinition;
import xyz.game.enginev2demo.formula.FormulaNode;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;

class ManualCastStillFailFastWhenBlockedTest {

    @Test
    void manualRepeatableActionStillThrowsWhenBlocked() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 200.0, "attack_speed", 1.0), "basic_attack"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("basic_attack", DemoFixtures.repeatingAction(
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula",
                        "repeat_delay_formula")),
                Map.of(),
                Map.of("hard_stun", DemoFixtures.status(
                        "hard_stun",
                        "Hard Stun",
                        StatusKind.STUN,
                        0L,
                        StatusRefreshPolicy.REPLACE,
                        null)),
                DemoFixtures.constantFormula("basic_attack_formula", 10.0),
                new FormulaDefinition("repeat_delay_formula", new FormulaNode.Constant(100.0)));

        EngineDemoFacade facade = new EngineDemoFacade();
        IllegalStateException exception = assertThrows(
                IllegalStateException.class,
                () -> facade.run(
                        facade.init(bundle),
                        DemoFixtures.runInput(
                                DemoFixtures.combatant("self", "self_template", List.of(), List.of("hard_stun")),
                                DemoFixtures.combatant("enemy", "enemy_template"),
                                List.of(new ActionRequest(0, "self", "enemy", "basic_attack")))));

        assertEquals("action_blocked:control:STUN", exception.getMessage());
    }
}
