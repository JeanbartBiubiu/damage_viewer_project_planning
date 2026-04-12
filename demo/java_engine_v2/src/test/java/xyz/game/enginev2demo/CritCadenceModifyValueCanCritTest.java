package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.action.ActionLogEntry;
import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.cadence.CadenceOp;
import xyz.game.enginev2demo.crit.ScalarEffectLogEntry;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

/**
 * ModifyCadenceEffect 的 value 在 allowCrit=true + 暴击时被放大。
 * <p>
 * 场景：source 施放 attack → ON_DAMAGE_DEALT trigger → reduce cooldown of "skill" tagged actions。
 * reduce_cd_value_formula = constant 200ms，critMultiplier=2.0 → 实际减 400ms。
 * skill CD=1000ms，第一次释放后 remaining=1000ms → 减 400 → remaining=600ms。
 * 验证：在 t=600 可以再次释放 skill。
 */
class CritCadenceModifyValueCanCritTest {

    @Test
    void cadenceReduceCdValueIsCrittedWhenAllowCrit() {
        var skillCd = DemoFixtures.constantFormula("skill_cd", 1000.0);
        var atkCd = DemoFixtures.constantFormula("atk_cd", 200.0);
        var dmg = DemoFixtures.constantFormula("dmg_10", 10.0);
        var reduceCdValue = DemoFixtures.constantFormula("reduce_cd_200", 200.0);

        var skill = DemoFixtures.taggedAction("skill_q", "Skill Q",
                DemoFixtures.PHYSICAL_PROFILE, "dmg_10", "skill_cd", List.of("skill_tag"));
        var attack = DemoFixtures.critActionWithTriggers(
                "attack", "Attack",
                DemoFixtures.PHYSICAL_PROFILE, "dmg_10",
                DemoFixtures.CRIT_TYPE_PHYSICAL,
                List.of(DemoFixtures.trigger(
                        TriggerType.ON_DAMAGE_DEALT,
                        EventActorRole.SOURCE,
                        true,
                        DemoFixtures.critModifyCadenceEffect(
                                EventActorRole.SOURCE,
                                List.of("skill_tag"),
                                CadenceOp.REDUCE_REMAINING_CD_FLAT_MS,
                                "reduce_cd_200"))));

        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 1000.0, "armor", 0.0, "crit_chance", 1.0),
                                "attack", "skill_q"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 5000.0, "armor", 0.0))),
                Map.of("attack", attack, "skill_q", skill),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                dmg, skillCd, atkCd, reduceCdValue,
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        // t=0: cast skill_q (CD until 1000)
        // t=0: cast attack (deals dmg → trigger reduces skill_q CD by 200*2=400)
        // skill_q remaining = 1000 - 400 = 600 → ready at 400 (since we cast it at t=0, remaining at t=0 is 1000, reduces to 600)
        // Actually: skill_q readyAt was 1000, reduce by 400 → readyAt = 600
        // t=600: cast skill_q again
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(100),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "self", "enemy", "skill_q"),
                                new ActionRequest(50, "self", "enemy", "attack"),
                                // After attack at t=50 deals dmg → reduce skill_q CD by 400
                                // skill_q readyAt was 1000 (1001 after normalize) → 601
                                new ActionRequest(601, "self", "enemy", "skill_q"))));

        // Verify cadence_modify crit log
        ScalarEffectLogEntry cadenceLog = result.logs().stream()
                .filter(log -> log instanceof ScalarEffectLogEntry)
                .map(log -> (ScalarEffectLogEntry) log)
                .filter(log -> "cadence_modify".equals(log.effectKind()))
                .findFirst()
                .orElseThrow();
        assertTrue(cadenceLog.isCritical());
        assertEquals(200.0, cadenceLog.baseValue(), 1e-9);
        assertEquals(400.0, cadenceLog.finalValue(), 1e-9);

        // Verify skill_q was cast twice
        long skillQCasts = result.logs().stream()
                .filter(log -> log instanceof ActionLogEntry)
                .map(log -> (ActionLogEntry) log)
                .filter(log -> "skill_q".equals(log.actionId()))
                .count();
        assertEquals(2, skillQCasts, "skill_q should cast twice (CD was reduced by critted cadence effect)");
    }
}
