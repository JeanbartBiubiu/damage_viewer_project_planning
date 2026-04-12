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
 * 节奏效果仅影响 tag 匹配的动作，不影响其它动作。
 */
class CadenceEffectMatchesByActionTagsTest {

    @Test
    void onlyTaggedActionIsAffected() {
        var cd2000 = constantFormula("cd_2000", 2000.0);
        var basicCd = constantFormula("basic_cd", 200.0);
        var dmgFormula = constantFormula("dmg_10", 10.0);

        // skill_q tagged "offensive", skill_w tagged "defensive"
        var skillQ = taggedAction("skill_q", "Q", PHYSICAL_PROFILE, "dmg_10", "cd_2000",
                List.of("offensive"));
        var skillW = taggedAction("skill_w", "W", PHYSICAL_PROFILE, "dmg_10", "cd_2000",
                List.of("defensive"));
        var basicAttack = taggedRepeatingAction("basic_attack", "AA", PHYSICAL_PROFILE, "dmg_10",
                "basic_cd", List.of("action/basic"));

        // trigger targets ONLY "offensive" tag → only skill_q should be reduced
        var selfActor = actorWithTriggers("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_DEALT, EventActorRole.SOURCE, true,
                        modifyCadenceEffect(EventActorRole.SOURCE, List.of("offensive"),
                                CadenceOp.RESET_CD, null))),
                "basic_attack", "skill_q", "skill_w");
        var enemyActor = actor("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0), "basic_attack");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("basic_attack", basicAttack, "skill_q", skillQ, "skill_w", skillW),
                dmgFormula, cd2000, basicCd);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // t=0: cast skill_q (CD→2000), skill_w (CD→2000)
        // t=50: basic_attack → reset CD for "offensive" → only skill_q ready, skill_w still on CD
        // t=50: skill_q casts again | skill_w at t=50 should fail (still on CD until 2000)
        EngineRunResult result = facade.run(session, runInput(
                7L,
                new StopCondition(200),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "enemy", "skill_q"),
                        new ActionRequest(0, "self", "enemy", "skill_w"),
                        new ActionRequest(50, "self", "enemy", "basic_attack"),
                        new ActionRequest(50, "self", "enemy", "skill_q"))));

        long qCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("skill_q"))
                .count();
        long wCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("skill_w"))
                .count();
        assertEquals(2, qCasts, "skill_q should cast twice (tag matches, CD reset by trigger)");
        assertEquals(1, wCasts, "skill_w should cast only once (tag doesn't match, still on CD)");
    }
}
