package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.shield.ShieldLogEntry;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class ActorOwnedCastShieldTriggerTest {

    @Test
    void actorOwnedCastTriggerCanGrantShieldWithoutHardcodedActionLogic() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actorWithTriggers(
                                "self_template",
                                Map.of("max_hp", 200.0, "ability_power", 60.0),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.grantShieldEffect(
                                                "Battle Cry Shield",
                                                "battle_cry_shield_formula",
                                                EventActorRole.SOURCE,
                                                EventActorRole.SOURCE))),
                                "battle_cry"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 200.0, "attack_damage", 50.0),
                                "basic_attack")),
                Map.of(
                        "battle_cry", DemoFixtures.action(
                                "battle_cry",
                                "Battle Cry",
                                DemoFixtures.TRUE_PROFILE,
                                "battle_cry_damage_formula"),
                        "basic_attack", DemoFixtures.action(
                                "basic_attack",
                                "Basic Attack",
                                DemoFixtures.PHYSICAL_PROFILE,
                                "basic_attack_formula")),
                Map.of(),
                Map.of(),
                DemoFixtures.constantFormula("battle_cry_damage_formula", 10.0),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"),
                DemoFixtures.sourceAttrFormula("battle_cry_shield_formula", "ability_power"));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(
                        new ActionRequest(0, "self", "enemy", "battle_cry"),
                        new ActionRequest(1, "enemy", "self", "basic_attack"))));

        assertEquals(200.0, result.actors().get("self").currentHp(), 1e-9);
        ShieldLogEntry shieldLog = assertInstanceOf(ShieldLogEntry.class, result.logs().get(1));
        assertEquals("self", shieldLog.actorId());
        assertEquals(60.0, shieldLog.shieldAfter(), 1e-9);
        DamageLogEntry incomingDamage = assertInstanceOf(DamageLogEntry.class, result.logs().get(4));
        assertEquals(50.0, incomingDamage.shieldAbsorbed(), 1e-9);
        assertEquals(0.0, incomingDamage.hpDamage(), 1e-9);
    }
}
