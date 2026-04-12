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
 * crit_chance=0.5 → threshold=ceil(1/0.5)=2，确定性计数器每 2 次暴击一次。
 */
class CritCounterCritsEverySecondHitAt50PercentTest {

    @Test
    void counterCritsOnSecondHitAndResetsAt50Percent() {
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "attack_damage", 100.0, "crit_chance", 0.5),
                                "basic_attack"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 5000.0, "armor", 0.0))),
                Map.of("basic_attack", DemoFixtures.critRepeatingAction(
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula",
                        "cd_200",
                        DemoFixtures.CRIT_TYPE_PHYSICAL)),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"),
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0),
                DemoFixtures.constantFormula("cd_200", 200.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(4),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(new ActionRequest(0, "self", "enemy", "basic_attack"))));

        // 4 events = 4 auto attacks: t=0, t=200, t=400, t=600
        // Hit 1: counter 0→1, threshold=2 → no crit → 100 dmg
        // Hit 2: counter 1→2 ≥ 2 → CRIT + reset → 200 dmg
        // Hit 3: counter 0→1 → no crit → 100 dmg
        // Hit 4: counter 1→2 ≥ 2 → CRIT + reset → 200 dmg
        List<DamageLogEntry> damageLogs = result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry)
                .map(log -> (DamageLogEntry) log)
                .toList();
        assertEquals(4, damageLogs.size());

        assertFalse(damageLogs.get(0).isCritical(), "Hit 1 should not crit");
        assertEquals(100.0, damageLogs.get(0).dealtDamage(), 1e-9);

        assertTrue(damageLogs.get(1).isCritical(), "Hit 2 should crit");
        assertEquals(200.0, damageLogs.get(1).dealtDamage(), 1e-9);

        assertFalse(damageLogs.get(2).isCritical(), "Hit 3 should not crit");
        assertEquals(100.0, damageLogs.get(2).dealtDamage(), 1e-9);

        assertTrue(damageLogs.get(3).isCritical(), "Hit 4 should crit");
        assertEquals(200.0, damageLogs.get(3).dealtDamage(), 1e-9);

        // Total damage: 100 + 200 + 100 + 200 = 600
        assertEquals(4400.0, result.actors().get("enemy").currentHp(), 1e-9);
    }
}
