package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;

class DefensiveWindowForcesZeroDamageTest {

    @Test
    void forceDamageToZeroStatusNullifiesIncomingDamageBeforeShieldAndHp() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 200.0)),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 200.0, "attack_damage", 40.0),
                                "basic_attack")),
                Map.of("basic_attack", DemoFixtures.action(
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula")),
                Map.of(),
                Map.of("divine_guard", DemoFixtures.status(
                        "divine_guard",
                        "Divine Guard",
                        StatusKind.FORCE_DAMAGE_TO_ZERO,
                        0L,
                        StatusRefreshPolicy.REPLACE,
                        null)),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        DemoFixtures.combatant("self", "self_template", List.of(), List.of("divine_guard")),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(new ActionRequest(0, "enemy", "self", "basic_attack"))));

        assertEquals(200.0, result.actors().get("self").currentHp(), 1e-9);
        DamageLogEntry damageLog = (DamageLogEntry) result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry)
                .findFirst()
                .orElseThrow();
        assertEquals(0.0, damageLog.dealtDamage(), 1e-9);
        assertEquals(0.0, damageLog.hpDamage(), 1e-9);
    }
}
