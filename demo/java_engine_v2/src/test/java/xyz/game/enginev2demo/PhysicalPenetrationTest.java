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

class PhysicalPenetrationTest {

    @Test
    void physicalPenetrationChangesEffectiveResistance() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "armor_pen_flat", 40.0),
                                "piercing_strike"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 300.0, "armor", 100.0))),
                Map.of("piercing_strike", DemoFixtures.action(
                        "piercing_strike",
                        "Piercing Strike",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "piercing_strike_formula")),
                DemoFixtures.constantFormula("piercing_strike_formula", 100.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "piercing_strike"))));

        assertEquals(237.5, result.actors().get("enemy").currentHp(), 1e-9);
        DamageLogEntry damageLog = assertInstanceOf(DamageLogEntry.class, result.logs().get(1));
        assertEquals(60.0, damageLog.effectiveResistance(), 1e-9);
        assertEquals(62.5, damageLog.dealtDamage(), 1e-9);
    }
}
