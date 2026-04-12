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
 * 验证 RESET_CD 直接把匹配动作设为可用。
 */
class ResetCooldownForTaggedActionsTest {

    @Test
    void resetCdMakesSkillImmediatelyAvailable() {
        var skillCd = constantFormula("skill_cd", 5000.0);
        var dmgFormula = constantFormula("dmg_10", 10.0);
        var basicCd = constantFormula("basic_cd", 200.0);

        var skill = taggedAction("skill_q", "Skill Q", PHYSICAL_PROFILE, "dmg_10",
                "skill_cd", List.of("skill_tag/dash"));
        var basicAttack = taggedRepeatingAction("basic_attack", "AA", PHYSICAL_PROFILE, "dmg_10",
                "basic_cd", List.of("action/basic_attack"));

        // on damage dealt → RESET_CD for "skill_tag/dash" (no formula needed)
        var selfActor = actorWithTriggers("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_DEALT, EventActorRole.SOURCE, true,
                        modifyCadenceEffect(EventActorRole.SOURCE, List.of("skill_tag/dash"),
                                CadenceOp.RESET_CD, null))),
                "basic_attack", "skill_q");
        var enemyActor = actor("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0), "basic_attack");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("basic_attack", basicAttack, "skill_q", skill),
                dmgFormula, skillCd, basicCd);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // t=0: cast skill_q (CD→5000). t=100: cast basic_attack → trigger resets skill_q CD.
        // t=100: skill_q immediately available. t=100: cast skill_q again.
        EngineRunResult result = facade.run(session, runInput(
                7L,
                new StopCondition(100),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "enemy", "skill_q"),
                        new ActionRequest(100, "self", "enemy", "basic_attack"),
                        new ActionRequest(100, "self", "enemy", "skill_q"))));

        long skillCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("skill_q"))
                .count();
        assertEquals(2, skillCasts, "skill_q should cast twice after CD reset");
    }
}
