package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class ActorSnapshotUsesResolvedAttributesTest {

    @Test
    void actorSnapshotExposesResolvedInsteadOfBaseAttributes() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 100.0, "attack_damage", 100.0),
                                "power_up"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("power_up", DemoFixtures.actionWithTriggers(
                        "power_up",
                        "Power Up",
                        DemoFixtures.TRUE_PROFILE,
                        "zero_formula",
                        List.of(DemoFixtures.trigger(
                                TriggerType.ON_ACTION_CAST,
                                EventActorRole.SOURCE,
                                false,
                                DemoFixtures.applyStatusEffect("attack_damage_buff", EventActorRole.SOURCE, EventActorRole.SOURCE))))),
                Map.of(),
                Map.of("attack_damage_buff", DemoFixtures.attributeModifierStatus(
                        "attack_damage_buff",
                        "Attack Damage Buff",
                        1_000L,
                        DemoFixtures.flatModifier("attack_damage", "attack_damage_bonus_formula"))),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula("attack_damage_bonus_formula", 25.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(1),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(new ActionRequest(0, "self", "enemy", "power_up"))));

        assertEquals(125.0, result.actors().get("self").attributes().get("attack_damage"), 1e-9);
    }
}
