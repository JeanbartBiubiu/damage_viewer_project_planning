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
 * target 受击后，通过 ON_DAMAGE_TAKEN trigger 让 target 自己所有带某 tag 的技能减 CD。
 */
class OnDamageTakenReduceCooldownForTargetTaggedActionsTest {

    @Test
    void targetSkillCooldownReducedOnDamageTaken() {
        var skillCd = constantFormula("skill_cd", 2000.0);
        var dmgFormula = constantFormula("dmg_50", 50.0);
        var reduceCdValue = constantFormula("reduce_cd_500", 500.0);
        var basicCd = constantFormula("basic_cd", 200.0);

        var basicAttack = taggedRepeatingAction("basic_attack", "AA", PHYSICAL_PROFILE, "dmg_50",
                "basic_cd", List.of("action/basic_attack"));
        var shield = taggedAction("shield_skill", "Shield", PHYSICAL_PROFILE, "dmg_50",
                "skill_cd", List.of("skill_tag/defensive"));

        // Enemy has trigger: on damage taken → reduce own "skill_tag/defensive" CD
        var enemyActor = actorWithTriggers("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_TAKEN, EventActorRole.TARGET, true,
                        modifyCadenceEffect(EventActorRole.TARGET, List.of("skill_tag/defensive"),
                                CadenceOp.REDUCE_REMAINING_CD_FLAT_MS, "reduce_cd_500"))),
                "basic_attack", "shield_skill");
        var selfActor = actor("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0), "basic_attack");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("basic_attack", basicAttack, "shield_skill", shield),
                dmgFormula, skillCd, basicCd, reduceCdValue);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // enemy casts shield_skill at t=0 (CD→t=2000), self hits enemy at t=100 (reduces CD by 500)
        // enemy's shield_skill readyAt = 100 + (2000-100-500) = 100+1400 = 1500
        // enemy casts shield_skill again at t=1500
        EngineRunResult result = facade.run(session, runInput(
                7L,
                new StopCondition(100),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "enemy", "self", "shield_skill"),
                        new ActionRequest(100, "self", "enemy", "basic_attack"),
                        new ActionRequest(1500, "enemy", "self", "shield_skill"))));

        long shieldCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("shield_skill"))
                .count();
        assertEquals(2, shieldCasts, "shield_skill should cast twice (CD reduced by on-taken trigger)");
    }
}
