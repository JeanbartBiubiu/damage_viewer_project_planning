package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.*;
import static xyz.game.enginev2demo.DemoFixtures.*;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.*;

/**
 * 充能动作消耗一层后扣 currentCharges 并开启回充。
 */
class ChargedActionConsumesAndStartsRechargeTest {

    @Test
    void chargedActionConsumesChargeAndRecharges() {
        var chargeCd = constantFormula("charge_cd", 500.0);
        var dmgFormula = constantFormula("dmg_10", 10.0);

        // 3-charge skill
        var chargedSkill = chargedAction("charged_q", "Charge Q", PHYSICAL_PROFILE, "dmg_10",
                "charge_cd", 3, List.of("skill_tag/dash"));

        var selfActor = actor("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0), "charged_q");
        var enemyActor = actor("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0), "charged_q");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("charged_q", chargedSkill),
                dmgFormula, chargeCd);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // Cast 3 times instantly (all charges), then can't cast at t=100 (on CD),
        // then recharge completes at t=500, cast again
        EngineRunResult result = facade.run(session, runInput(
                7L,
                new StopCondition(200),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "enemy", "charged_q"),
                        new ActionRequest(0, "self", "enemy", "charged_q"),
                        new ActionRequest(0, "self", "enemy", "charged_q"),
                        // This should fail because no charges left; first recharge at t=500
                        new ActionRequest(500, "self", "enemy", "charged_q"))));

        long casts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("charged_q"))
                .count();
        assertEquals(4, casts, "charged_q should cast 3+1 times (3 initial + 1 after recharge)");
    }
}
