package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.enginev2demo.DemoFixtures.*;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.*;
import xyz.game.enginev2demo.cadence.CadenceOp;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

/**
 * 命中后缩短充能动作的回充进度 (REDUCE_RECHARGE_FLAT_MS)。
 */
class ReduceRechargeForTaggedActionsTest {

    @Test
    void reduceRechargeAcceleratesChargeRecovery() {
        var chargeCd = constantFormula("charge_cd", 1000.0);
        var dmgFormula = constantFormula("dmg_10", 10.0);
        var basicCd = constantFormula("basic_cd", 200.0);
        var reduceRechargeValue = constantFormula("reduce_recharge_800", 800.0);

        // 2-charge skill
        var chargedSkill = chargedAction("charged_e", "Dash", PHYSICAL_PROFILE, "dmg_10",
                "charge_cd", 2, List.of("skill_tag/dash"));
        var basicAttack = taggedRepeatingAction("basic_attack", "AA", PHYSICAL_PROFILE, "dmg_10",
                "basic_cd", List.of("action/basic_attack"));

        // on damage dealt → REDUCE_RECHARGE_FLAT_MS for "skill_tag/dash" by 800ms
        var selfActor = actorWithTriggers("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_DEALT, EventActorRole.SOURCE, true,
                        modifyCadenceEffect(EventActorRole.SOURCE, List.of("skill_tag/dash"),
                                CadenceOp.REDUCE_RECHARGE_FLAT_MS, "reduce_recharge_800"))),
                "basic_attack", "charged_e");
        var enemyActor = actor("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0), "basic_attack");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("basic_attack", basicAttack, "charged_e", chargedSkill),
                dmgFormula, chargeCd, basicCd, reduceRechargeValue);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // t=0: use both charges (recharge ends at t=1000 and t=1000)
        // t=50: basic_attack → reduces recharge by 800ms → recharge ends at max(50, 1000-800)=200
        // t=200: charge recovered, cast again
        EngineRunResult result = facade.run(session, runInput(
                7L,
                new StopCondition(200),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "enemy", "charged_e"),
                        new ActionRequest(0, "self", "enemy", "charged_e"),
                        new ActionRequest(50, "self", "enemy", "basic_attack"),
                        new ActionRequest(200, "self", "enemy", "charged_e"))));

        long dashCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("charged_e"))
                .count();
        assertEquals(3, dashCasts, "charged_e should cast 3 times (2 initial + 1 after accelerated recharge)");
    }
}
