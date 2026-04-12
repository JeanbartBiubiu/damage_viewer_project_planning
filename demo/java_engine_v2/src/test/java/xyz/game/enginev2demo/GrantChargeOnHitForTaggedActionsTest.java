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
 * 命中后为充能动作补充一层充能 (GRANT_CHARGE)。
 */
class GrantChargeOnHitForTaggedActionsTest {

    @Test
    void grantChargeOnHitRefillsOneCharge() {
        var chargeCd = constantFormula("charge_cd", 5000.0);
        var dmgFormula = constantFormula("dmg_10", 10.0);
        var basicCd = constantFormula("basic_cd", 200.0);

        // 2-charge skill
        var chargedSkill = chargedAction("charged_e", "Dash", PHYSICAL_PROFILE, "dmg_10",
                "charge_cd", 2, List.of("skill_tag/dash"));
        var basicAttack = taggedRepeatingAction("basic_attack", "AA", PHYSICAL_PROFILE, "dmg_10",
                "basic_cd", List.of("action/basic_attack"));

        // on damage dealt → GRANT_CHARGE for "skill_tag/dash"
        var selfActor = actorWithTriggers("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_DEALT, EventActorRole.SOURCE, true,
                        modifyCadenceEffect(EventActorRole.SOURCE, List.of("skill_tag/dash"),
                                CadenceOp.GRANT_CHARGE, null))),
                "basic_attack", "charged_e");
        var enemyActor = actor("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0), "basic_attack");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("basic_attack", basicAttack, "charged_e", chargedSkill),
                dmgFormula, chargeCd, basicCd);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // t=0: use both charges of charged_e (CD=5000 per charge)
        // t=50: basic_attack → trigger grants 1 charge → can use charged_e again
        EngineRunResult result = facade.run(session, runInput(
                7L,
                new StopCondition(200),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "enemy", "charged_e"),
                        new ActionRequest(0, "self", "enemy", "charged_e"),
                        new ActionRequest(50, "self", "enemy", "basic_attack"),
                        new ActionRequest(50, "self", "enemy", "charged_e"))));

        long dashCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("charged_e"))
                .count();
        assertEquals(3, dashCasts, "charged_e should cast 3 times (2 initial + 1 from grant_charge)");
    }
}
