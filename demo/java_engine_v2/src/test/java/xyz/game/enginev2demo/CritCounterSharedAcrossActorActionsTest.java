package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

/**
 * 同一个 actor 的暴击计数器在所有可暴击动作间共享。
 * <p>
 * crit_chance=0.5 → threshold=2。
 * 先用 action_a 命中 1 次（counter 0→1，不暴击），
 * 再用 action_b 命中 1 次（counter 1→2 ≥ threshold → 暴击并重置）。
 */
class CritCounterSharedAcrossActorActionsTest {

    @Test
    void critCounterIsSharedAcrossActionsOfSameActor() {
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "attack_damage", 100.0, "crit_chance", 0.5),
                                "action_a", "action_b"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 5000.0, "armor", 0.0))),
                Map.of(
                        "action_a", DemoFixtures.critAction(
                                "action_a", "Action A",
                                DemoFixtures.PHYSICAL_PROFILE, "dmg_formula",
                                DemoFixtures.CRIT_TYPE_PHYSICAL),
                        "action_b", DemoFixtures.critAction(
                                "action_b", "Action B",
                                DemoFixtures.PHYSICAL_PROFILE, "dmg_formula",
                                DemoFixtures.CRIT_TYPE_PHYSICAL)),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.sourceAttrFormula("dmg_formula", "attack_damage"),
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(2),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "self", "enemy", "action_a"),
                                new ActionRequest(1, "self", "enemy", "action_b"))));

        List<DamageLogEntry> damageLogs = result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry)
                .map(log -> (DamageLogEntry) log)
                .toList();
        assertEquals(2, damageLogs.size());

        // action_a: counter 0→1 → no crit → 100 damage
        assertFalse(damageLogs.get(0).isCritical(), "action_a should not crit (counter=1)");
        assertEquals(100.0, damageLogs.get(0).dealtDamage(), 1e-9);
        assertEquals("action_a", damageLogs.get(0).actionId());

        // action_b: counter 1→2 ≥ 2 → CRIT → 200 damage
        assertTrue(damageLogs.get(1).isCritical(), "action_b should crit (shared counter hit threshold)");
        assertEquals(200.0, damageLogs.get(1).dealtDamage(), 1e-9);
        assertEquals("action_b", damageLogs.get(1).actionId());
    }
}
