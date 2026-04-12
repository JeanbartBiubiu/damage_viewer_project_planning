package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.crit.ScalarEffectLogEntry;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.shield.ShieldLogEntry;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

/**
 * 同次 execution 中，主伤害和 ON_ACTION_CAST 触发的护盾复用同一个 ExecutionCritResult。
 * <p>
 * crit_chance=1.0, critMultiplier=2.0
 * - 主伤害 = 100 * 2.0 = 200
 * - ON_ACTION_CAST 触发 shield (allowCrit=true) = 50 * 2.0 = 100
 * 两者使用同一个 ExecutionCritResult（都暴击，同倍率）。
 */
class CritExecutionResultReusedForDamageAndShieldTest {

    @Test
    void sameExecutionCritResultForMainDamageAndTriggeredShield() {
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "attack_damage", 100.0, "ability_power", 50.0, "crit_chance", 1.0),
                                "crit_attack"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 1000.0, "armor", 0.0))),
                Map.of("crit_attack", DemoFixtures.critActionWithTriggers(
                        "crit_attack", "Crit Attack",
                        DemoFixtures.PHYSICAL_PROFILE, "ad_formula",
                        DemoFixtures.CRIT_TYPE_PHYSICAL,
                        List.of(DemoFixtures.trigger(
                                TriggerType.ON_ACTION_CAST,
                                EventActorRole.SOURCE,
                                false,
                                DemoFixtures.critGrantShieldEffect(
                                        "Crit Shield",
                                        "ap_formula",
                                        EventActorRole.SOURCE,
                                        EventActorRole.SOURCE))))),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.sourceAttrFormula("ad_formula", "attack_damage"),
                DemoFixtures.sourceAttrFormula("ap_formula", "ability_power"),
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "crit_attack"))));

        // Main damage: 100 * 2.0 = 200 (crit)
        DamageLogEntry dmg = result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry)
                .map(log -> (DamageLogEntry) log)
                .findFirst()
                .orElseThrow();
        assertTrue(dmg.isCritical(), "main damage should be critical");
        assertEquals(200.0, dmg.rawDamage(), 1e-9);
        assertEquals(2.0, dmg.critMultiplier(), 1e-9);

        // Shield: 50 * 2.0 = 100 (same crit result)
        ShieldLogEntry shield = result.logs().stream()
                .filter(log -> log instanceof ShieldLogEntry)
                .map(log -> (ShieldLogEntry) log)
                .findFirst()
                .orElseThrow();
        assertEquals(100.0, shield.requestedAmount(), 1e-9);

        // Shield scalar effect log confirms crit
        ScalarEffectLogEntry scalarLog = result.logs().stream()
                .filter(log -> log instanceof ScalarEffectLogEntry)
                .map(log -> (ScalarEffectLogEntry) log)
                .filter(log -> "shield".equals(log.effectKind()))
                .findFirst()
                .orElseThrow();
        assertTrue(scalarLog.isCritical());
        assertEquals(50.0, scalarLog.baseValue(), 1e-9);
        assertEquals(100.0, scalarLog.finalValue(), 1e-9);
        assertEquals(2.0, scalarLog.critMultiplier(), 1e-9);
        assertEquals(DemoFixtures.CRIT_TYPE_PHYSICAL, scalarLog.critType());
    }
}
