package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

class MagicDamageMitigationTest {

    @Test
    void magicalDamageUsesMagicResistancePath() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 500.0), "magic_bolt"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 300.0, "magic_resist", 100.0))),
                Map.of("magic_bolt", DemoFixtures.action(
                        "magic_bolt",
                        "Magic Bolt",
                        DemoFixtures.MAGICAL_PROFILE,
                        "magic_bolt_formula")),
                DemoFixtures.constantFormula("magic_bolt_formula", 100.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "magic_bolt"))));

        assertEquals(250.0, result.actors().get("enemy").currentHp(), 1e-9);
        DamageLogEntry damageLog = assertInstanceOf(DamageLogEntry.class, result.logs().get(1));
        assertEquals(100.0, damageLog.effectiveResistance(), 1e-9);
        assertEquals(0.5, damageLog.mitigationMultiplier(), 1e-9);
    }
}
