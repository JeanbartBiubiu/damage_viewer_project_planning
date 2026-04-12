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

class BasicAttackDamageTest {

    @Test
    void basicAttackUsesUnifiedDamagePipeline() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "attack_damage", 80.0),
                                "basic_attack"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 300.0, "armor", 0.0))),
                Map.of("basic_attack", DemoFixtures.action(
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula")),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "basic_attack"))));

        assertEquals(220.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertEquals(1, result.processedEvents());
        assertEquals(2, result.logs().size());
        DamageLogEntry damageLog = assertInstanceOf(DamageLogEntry.class, result.logs().get(1));
        assertEquals(80.0, damageLog.dealtDamage(), 1e-9);
    }
}
