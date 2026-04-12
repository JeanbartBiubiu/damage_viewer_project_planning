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
 * RESET_CD 对充能动作补满全部层数并清空回充队列。
 */
class ResetCooldownRefillsAllChargesTest {

    @Test
    void resetCdRefillsAllChargesForChargedAction() {
        var chargeCd = constantFormula("charge_cd", 5000.0);
        var dmgFormula = constantFormula("dmg_10", 10.0);
        var basicCd = constantFormula("basic_cd", 200.0);

        // 3-charge skill
        var chargedSkill = chargedAction("charged_q", "Q", PHYSICAL_PROFILE, "dmg_10",
                "charge_cd", 3, List.of("skill_tag/dash"));
        var basicAttack = taggedRepeatingAction("basic_attack", "AA", PHYSICAL_PROFILE, "dmg_10",
                "basic_cd", List.of("action/basic_attack"));

        // on damage dealt → RESET_CD for "skill_tag/dash"
        var selfActor = actorWithTriggers("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_DEALT, EventActorRole.SOURCE, true,
                        modifyCadenceEffect(EventActorRole.SOURCE, List.of("skill_tag/dash"),
                                CadenceOp.RESET_CD, null))),
                "basic_attack", "charged_q");
        var enemyActor = actor("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0), "basic_attack");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("basic_attack", basicAttack, "charged_q", chargedSkill),
                dmgFormula, chargeCd, basicCd);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // t=0: use all 3 charges
        // t=50: basic_attack → reset CD → all 3 charges refilled
        // t=50: use all 3 charges again → total 6 casts
        EngineRunResult result = facade.run(session, runInput(
                7L,
                new StopCondition(200),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "enemy", "charged_q"),
                        new ActionRequest(0, "self", "enemy", "charged_q"),
                        new ActionRequest(0, "self", "enemy", "charged_q"),
                        new ActionRequest(50, "self", "enemy", "basic_attack"),
                        new ActionRequest(50, "self", "enemy", "charged_q"),
                        new ActionRequest(50, "self", "enemy", "charged_q"),
                        new ActionRequest(50, "self", "enemy", "charged_q"))));

        long qCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("charged_q"))
                .count();
        assertEquals(6, qCasts, "charged_q should cast 6 times (3 initial + 3 after reset)");
    }
}
