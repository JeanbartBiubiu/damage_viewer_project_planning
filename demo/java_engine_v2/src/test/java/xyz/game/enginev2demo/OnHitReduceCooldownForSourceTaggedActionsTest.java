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
 * source 命中后，通过 ON_DAMAGE_DEALT trigger 让 source 自己所有带某 tag 的技能减 CD。
 */
class OnHitReduceCooldownForSourceTaggedActionsTest {

    @Test
    void sourceSkillCooldownReducedOnHit() {
        // skill_q: CD=1000ms, tagged "skill_tag/dash"
        // basic_attack: CD=200ms, autoRepeat, tagged "action/basic_attack"
        // actor trigger ON_DAMAGE_DEALT → reduce source's "skill_tag/dash" CD by 300ms flat

        var skillQCd = constantFormula("skill_q_cd", 1000.0);
        var basicCd = constantFormula("basic_cd", 200.0);
        var dmgFormula = constantFormula("dmg_10", 10.0);
        var reduceCdValue = constantFormula("reduce_cd_300", 300.0);

        var skillQ = taggedAction("skill_q", "Skill Q", PHYSICAL_PROFILE, "dmg_10",
                "skill_q_cd", List.of("skill_tag/dash"));
        var basicAttack = taggedRepeatingAction("basic_attack", "AA", PHYSICAL_PROFILE, "dmg_10",
                "basic_cd", List.of("action/basic_attack"));

        // Actor has a trigger: on damage dealt → reduce source's "skill_tag/dash" CD
        var selfActor = actorWithTriggers("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0, "attack_speed", 1.0),
                List.of(trigger(TriggerType.ON_DAMAGE_DEALT, EventActorRole.SOURCE, true,
                        modifyCadenceEffect(EventActorRole.SOURCE, List.of("skill_tag/dash"),
                                CadenceOp.REDUCE_REMAINING_CD_FLAT_MS, "reduce_cd_300"))),
                "basic_attack", "skill_q");
        var enemyActor = actor("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0), "basic_attack");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("basic_attack", basicAttack, "skill_q", skillQ),
                dmgFormula, skillQCd, basicCd, reduceCdValue);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // At t=0: cast skill_q (puts it on CD until t=1000)
        // At t=0: also cast basic_attack (deals damage → trigger reduces skill_q CD by 300)
        EngineRunResult result = facade.run(session, runInput(
                List.of(
                        new ActionRequest(0, "self", "enemy", "skill_q"),
                        new ActionRequest(0, "self", "enemy", "basic_attack"))));

        // After basic_attack at t=0 deals damage: skill_q remaining = 1000 - 300 = 700
        // skill_q readyAtMs should be 0 + 700 = 700
        var selfSnapshot = result.actors().get("self");
        assertTrue(selfSnapshot.currentHp() > 0, "self should be alive");
        // The exact readyAtMs cannot be checked from EngineRunResult, but we verify
        // that a second skill_q cast at t=700 works (which means CD was reduced)
        // Let's run a more specific scenario:
        EngineRunResult result2 = facade.run(session, runInput(
                7L,
                new StopCondition(100),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "enemy", "skill_q"),
                        new ActionRequest(50, "self", "enemy", "basic_attack"),
                        // After basic_attack at t=50, skill_q remaining = (1000-50) - 300 = 650
                        // skill_q readyAtMs = 50 + 650 = 700
                        new ActionRequest(700, "self", "enemy", "skill_q"))));

        // Count skill_q casts
        long skillQCasts = result2.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("skill_q"))
                .count();
        assertEquals(2, skillQCasts, "skill_q should cast twice (CD was reduced by on-hit trigger)");
    }
}
