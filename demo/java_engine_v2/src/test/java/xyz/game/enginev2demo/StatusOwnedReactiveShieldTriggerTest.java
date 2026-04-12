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

class StatusOwnedReactiveShieldTriggerTest {

    @Test
    void statusOwnedTriggerCanReactToDamageTakenAndGrantShield() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 200.0, "tenacity", 40.0)),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 200.0, "attack_damage", 30.0),
                                "basic_attack")),
                Map.of("basic_attack", DemoFixtures.action(
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula")),
                Map.of(),
                Map.of("reactive_barrier", DemoFixtures.status(
                        "reactive_barrier",
                        "Reactive Barrier",
                        DemoFixtures.trigger(
                                TriggerType.ON_DAMAGE_TAKEN,
                                EventActorRole.TARGET,
                                true,
                                DemoFixtures.grantShieldEffect(
                                        "Reactive Barrier Shield",
                                        "reactive_barrier_formula",
                                        EventActorRole.TARGET,
                                        EventActorRole.TARGET)))),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"),
                DemoFixtures.sourceAttrFormula("reactive_barrier_formula", "tenacity"));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        DemoFixtures.combatant("self", "self_template", List.of(), List.of("reactive_barrier")),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "enemy", "self", "basic_attack"),
                                new ActionRequest(1, "enemy", "self", "basic_attack"))));

        assertEquals(170.0, result.actors().get("self").currentHp(), 1e-9);
        ShieldLogEntry shieldLog = assertInstanceOf(ShieldLogEntry.class, result.logs().get(2));
        assertEquals(40.0, shieldLog.shieldAfter(), 1e-9);
        DamageLogEntry secondHit = assertInstanceOf(DamageLogEntry.class, result.logs().get(4));
        assertEquals(30.0, secondHit.shieldAbsorbed(), 1e-9);
        assertEquals(0.0, secondHit.hpDamage(), 1e-9);
    }
}
