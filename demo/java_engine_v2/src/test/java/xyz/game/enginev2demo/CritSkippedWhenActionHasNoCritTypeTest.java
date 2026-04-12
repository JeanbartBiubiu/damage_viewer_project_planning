package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

/**
 * 动作没有 critType（null）→ 即使 crit_chance=1.0 + 有对应 crit rule 也不会暴击。
 */
class CritSkippedWhenActionHasNoCritTypeTest {

    @Test
    void noCritTypeOnActionSkipsCritEvenWithHighCritChance() {
        // 使用普通 action(无 critType) + 高 crit_chance + 完整 crit rule
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "attack_damage", 100.0, "crit_chance", 1.0),
                                "basic_attack"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 1000.0, "armor", 0.0))),
                Map.of("basic_attack", DemoFixtures.action(  // 注意使用的是无 critType 的 action()
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula")),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"),
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "basic_attack"))));

        // No crit → damage = 100
        assertEquals(900.0, result.actors().get("enemy").currentHp(), 1e-9);
        DamageLogEntry damageLog = assertInstanceOf(DamageLogEntry.class, result.logs().get(1));
        assertFalse(damageLog.isCritical(), "should NOT crit - action has no critType");
        assertEquals(100.0, damageLog.dealtDamage(), 1e-9);
    }
}
