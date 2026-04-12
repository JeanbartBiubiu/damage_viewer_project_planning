package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

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
 * target 侧反应型效果（ON_DAMAGE_TAKEN）不继承 source 的 ExecutionCritResult。
 * <p>
 * 场景：
 * - source 施放 crit attack（crit_chance=1.0），造成暴击伤害
 * - target 有 ON_DAMAGE_TAKEN trigger → grant shield (allowCrit=true) to self
 * - 由于 ON_DAMAGE_TAKEN 的 TriggerEvent 不携带 executionCritResult，
 *   target 的护盾不会被暴击放大
 */
class CritTargetReactiveDoesNotInheritCritTest {

    @Test
    void onDamageTakenTriggeredShieldDoesNotUseCritFromSource() {
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 500.0, "attack_damage", 100.0, "crit_chance", 1.0),
                                "basic_attack"),
                        "enemy_template", DemoFixtures.actorWithTriggers(
                                "enemy_template",
                                Map.of("max_hp", 1000.0, "armor", 0.0, "ability_power", 60.0),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_DAMAGE_TAKEN,
                                        EventActorRole.TARGET,
                                        true,
                                        DemoFixtures.critGrantShieldEffect(
                                                "Reactive Shield",
                                                "shield_formula",
                                                EventActorRole.TARGET,
                                                EventActorRole.TARGET))))),
                Map.of("basic_attack", DemoFixtures.critAction(
                        "basic_attack", "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE, "ad_formula",
                        DemoFixtures.CRIT_TYPE_PHYSICAL)),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.sourceAttrFormula("ad_formula", "attack_damage"),
                DemoFixtures.sourceAttrFormula("shield_formula", "ability_power"),
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "basic_attack"))));

        // Shield triggered by ON_DAMAGE_TAKEN should NOT be critted
        // Shield formula = enemy's ability_power = 60, no crit → shield = 60
        ShieldLogEntry shield = result.logs().stream()
                .filter(log -> log instanceof ShieldLogEntry)
                .map(log -> (ShieldLogEntry) log)
                .findFirst()
                .orElseThrow();
        assertEquals(60.0, shield.requestedAmount(), 1e-9);
        assertEquals(60.0, shield.shieldAfter(), 1e-9);

        // There should be NO scalar_effect log for shield (since no crit applied)
        long shieldScalarLogs = result.logs().stream()
                .filter(log -> log instanceof ScalarEffectLogEntry)
                .map(log -> (ScalarEffectLogEntry) log)
                .filter(log -> "shield".equals(log.effectKind()))
                .count();
        assertEquals(0, shieldScalarLogs, "no scalar_effect log for shield - target reactive did not crit");
    }
}
