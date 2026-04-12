package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.crit.ScalarEffectLogEntry;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

/**
 * ApplyStatus 的 magnitude 通过 ScalarResolutionService 求值。
 * allowCrit=true + crit_chance=1.0 → magnitude 被暴击倍率放大。
 * <p>
 * 验证方式：创建 SHIELD 类型 status（magnitudeFormula=50），
 * 暴击后 magnitude=100，作为护盾使用可以吸收 100 伤害。
 */
class CritStatusMagnitudeCanCritTest {

    @Test
    void statusMagnitudeIsCrittedWhenAllowCrit() {
        // ON_ACTION_CAST → apply status (SHIELD) with allowCrit=true
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actorWithTriggers(
                                "self_template",
                                Map.of("max_hp", 500.0, "crit_chance", 1.0),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.critApplyStatusEffect(
                                                "crit_shield_status",
                                                EventActorRole.SOURCE,
                                                EventActorRole.SOURCE))),
                                "buff_action"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 500.0, "attack_damage", 80.0),
                                "basic_attack")),
                Map.of(
                        "buff_action", DemoFixtures.critAction(
                                "buff_action", "Buff",
                                DemoFixtures.TRUE_PROFILE, "zero_formula",
                                DemoFixtures.CRIT_TYPE_PHYSICAL),
                        "basic_attack", DemoFixtures.action(
                                "basic_attack", "Basic Attack",
                                DemoFixtures.PHYSICAL_PROFILE, "ad_formula")),
                Map.of(),
                Map.of("crit_shield_status", DemoFixtures.status(
                        "crit_shield_status",
                        "Crit Shield Status",
                        StatusKind.SHIELD,
                        5000L,
                        StatusRefreshPolicy.TAKE_MAX,
                        "shield_magnitude_formula")),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula("shield_magnitude_formula", 50.0),
                DemoFixtures.sourceAttrFormula("ad_formula", "attack_damage"),
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
                                new ActionRequest(0, "self", "enemy", "buff_action"),
                                new ActionRequest(1, "enemy", "self", "basic_attack"))));

        // Verify scalar effect log shows critted magnitude
        ScalarEffectLogEntry magLog = result.logs().stream()
                .filter(log -> log instanceof ScalarEffectLogEntry)
                .map(log -> (ScalarEffectLogEntry) log)
                .filter(log -> "status_magnitude".equals(log.effectKind()))
                .findFirst()
                .orElseThrow();
        assertTrue(magLog.isCritical());
        assertEquals(50.0, magLog.baseValue(), 1e-9);
        assertEquals(100.0, magLog.finalValue(), 1e-9);

        // Shield = 100 (critted), incoming damage = 80
        // Shield absorbs 80, HP damage = 0
        DamageLogEntry dmg = result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry)
                .map(log -> (DamageLogEntry) log)
                .filter(log -> "self".equals(log.targetActorId()))
                .findFirst()
                .orElseThrow();
        assertEquals(80.0, dmg.shieldAbsorbed(), 1e-9);
        assertEquals(0.0, dmg.hpDamage(), 1e-9);
        assertEquals(500.0, result.actors().get("self").currentHp(), 1e-9);
    }
}
