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
 * 同一次伤害同时触发 source 和 target 的节奏效果。
 */
class SingleDamageEventTriggersSourceAndTargetCadenceEffectsTest {

    @Test
    void bothSidesTriggered() {
        var baseCd = constantFormula("cd_2000", 2000.0);
        var dmgFormula = constantFormula("dmg_10", 10.0);
        var reduceCd = constantFormula("reduce_500", 500.0);

        // self: on_damage_dealt → REDUCE source tagged skill CD
        var selfSkill = taggedAction("self_skill", "SS", PHYSICAL_PROFILE, "dmg_10", "cd_2000",
                List.of("self_skill_tag"));
        // enemy: on_damage_taken → REDUCE target tagged skill CD
        var enemySkill = taggedAction("enemy_skill", "ES", PHYSICAL_PROFILE, "dmg_10", "cd_2000",
                List.of("enemy_skill_tag"));

        var selfActor = actorWithTriggers("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_DEALT, EventActorRole.SOURCE, true,
                        modifyCadenceEffect(EventActorRole.SOURCE, List.of("self_skill_tag"),
                                CadenceOp.REDUCE_REMAINING_CD_FLAT_MS, "reduce_500"))),
                "self_skill");
        var enemyActor = actorWithTriggers("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_TAKEN, EventActorRole.TARGET, true,
                        modifyCadenceEffect(EventActorRole.TARGET, List.of("enemy_skill_tag"),
                                CadenceOp.REDUCE_REMAINING_CD_FLAT_MS, "reduce_500"))),
                "enemy_skill");

        var bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("self_skill", selfSkill, "enemy_skill", enemySkill),
                dmgFormula, baseCd, reduceCd);

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineSession session = facade.init(bundle);

        // t=0: self_skill → CD ends at 2000
        //       trigger: source reduces self_skill CD by 500 → readyAt 1500
        //       trigger: target reduces enemy_skill CD? No, enemy has no CD set yet.
        //       Actually enemy_skill has never been cast, readyAt=0, so reduce has no effect.
        //
        // Better approach: have both cast first, then a second attack triggers both.
        // t=0: self_skill (CD→2000), enemy_skill (CD→2000)
        // t=50: self_skill second cast with request_t=1500
        //       This needs self to be ready at 1500. Let's trigger ON_DAMAGE_DEALT from a basic attack.

        // Let's redesign: both actors have basic attacks and skills.
        // Basic attack triggers both sides.

        // Re-create test with basic attacks
        var basicCd = constantFormula("basic_cd", 200.0);
        var basicAttack = taggedRepeatingAction("basic_attack", "AA", PHYSICAL_PROFILE, "dmg_10",
                "basic_cd", List.of("action/basic"));

        // Re-define actors with basic_attack + skill + triggers
        selfActor = actorWithTriggers("self_template",
                Map.of("max_hp", 1000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_DEALT, EventActorRole.SOURCE, true,
                        modifyCadenceEffect(EventActorRole.SOURCE, List.of("self_skill_tag"),
                                CadenceOp.REDUCE_REMAINING_CD_FLAT_MS, "reduce_500"))),
                "basic_attack", "self_skill");
        enemyActor = actorWithTriggers("enemy_template",
                Map.of("max_hp", 5000.0, "armor", 0.0, "magic_resist", 0.0),
                List.of(trigger(TriggerType.ON_DAMAGE_TAKEN, EventActorRole.TARGET, true,
                        modifyCadenceEffect(EventActorRole.TARGET, List.of("enemy_skill_tag"),
                                CadenceOp.REDUCE_REMAINING_CD_FLAT_MS, "reduce_500"))),
                "basic_attack", "enemy_skill");

        bundle = bundle(
                Map.of("self_template", selfActor, "enemy_template", enemyActor),
                Map.of("basic_attack", basicAttack, "self_skill", selfSkill, "enemy_skill", enemySkill),
                dmgFormula, baseCd, reduceCd, basicCd);

        facade = new EngineDemoFacade();
        session = facade.init(bundle);

        // t=0: self_skill → CD until 2000, enemy_skill → cast at t=0 → CD until 2000
        // t=50: self basic_attack → deals damage →
        //       source trigger: REDUCE self_skill CD 500 → readyAt 1500
        //       target trigger: REDUCE enemy_skill CD 500 → readyAt 1500
        // t=1500: both skills available
        EngineRunResult result = facade.run(session, runInput(
                7L,
                new StopCondition(200),
                combatant("self", "self_template"),
                combatant("enemy", "enemy_template"),
                List.of(
                        new ActionRequest(0, "self", "enemy", "self_skill"),
                        new ActionRequest(0, "enemy", "self", "enemy_skill"),
                        new ActionRequest(50, "self", "enemy", "basic_attack"),
                        new ActionRequest(1500, "self", "enemy", "self_skill"),
                        new ActionRequest(1500, "enemy", "self", "enemy_skill"))));

        long selfSkillCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("self_skill") && log.sourceActorId().equals("self"))
                .count();
        long enemySkillCasts = result.logs().stream()
                .filter(log -> log.type().equals("action"))
                .map(log -> (xyz.game.enginev2demo.action.ActionLogEntry) log)
                .filter(log -> log.actionId().equals("enemy_skill") && log.sourceActorId().equals("enemy"))
                .count();
        assertEquals(2, selfSkillCasts, "self_skill should cast twice (source CD reduced by trigger)");
        assertEquals(2, enemySkillCasts, "enemy_skill should cast twice (target CD reduced by trigger)");
    }
}
