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
import xyz.game.enginev2demo.shield.ShieldLogEntry;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

/**
 * ON_ACTION_CAST 触发的护盾效果在 allowCrit=true 时，使用本次 execution 的暴击结果。
 * crit_chance=1.0 + multiplier=2.0 → 护盾值 = 50 * 2.0 = 100。
 */
class CritGrantShieldCanCritFromTriggerTest {

    @Test
    void triggeredShieldUsesExecutionCritResult() {
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actorWithTriggers(
                                "self_template",
                                Map.of("max_hp", 500.0, "ability_power", 50.0, "crit_chance", 1.0),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.critGrantShieldEffect(
                                                "Crit Shield",
                                                "shield_formula",
                                                EventActorRole.SOURCE,
                                                EventActorRole.SOURCE))),
                                "cast_spell"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 500.0))),
                Map.of("cast_spell", DemoFixtures.critAction(
                        "cast_spell",
                        "Cast Spell",
                        DemoFixtures.TRUE_PROFILE,
                        "zero_formula",
                        DemoFixtures.CRIT_TYPE_PHYSICAL)),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.sourceAttrFormula("shield_formula", "ability_power"),
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "cast_spell"))));

        // Shield base = 50 (ability_power), crit multiplier = 2.0 → final shield = 100
        ShieldLogEntry shieldLog = result.logs().stream()
                .filter(log -> log instanceof ShieldLogEntry)
                .map(log -> (ShieldLogEntry) log)
                .findFirst()
                .orElseThrow();
        assertEquals(100.0, shieldLog.shieldAfter(), 1e-9);
        assertEquals(100.0, shieldLog.requestedAmount(), 1e-9);

        // Verify scallar effect log for the crit
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
    }
}
