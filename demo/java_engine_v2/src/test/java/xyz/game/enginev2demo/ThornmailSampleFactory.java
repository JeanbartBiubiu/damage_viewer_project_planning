package xyz.game.enginev2demo;

import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

final class ThornmailSampleFactory {

    private ThornmailSampleFactory() {
    }

    static EngineBundle bundle() {
        return DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 200.0, "armor", 0.0)),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 200.0, "attack_damage", 50.0),
                                "basic_attack")),
                Map.of("basic_attack", DemoFixtures.action(
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula")),
                Map.of("thornmail", DemoFixtures.item(
                        "thornmail",
                        "Thornmail",
                        DemoFixtures.trigger(
                                TriggerType.ON_DAMAGE_TAKEN,
                                EventActorRole.TARGET,
                                true,
                                DemoFixtures.dealDamageEffect(
                                        "thornmail_proc",
                                        "Thornmail Proc",
                                        DemoFixtures.MAGICAL_PROFILE,
                                        "thornmail_formula",
                                        EventActorRole.TARGET,
                                        EventActorRole.SOURCE)))),
                Map.of(),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"),
                DemoFixtures.constantFormula("thornmail_formula", 30.0));
    }

    static EngineRunInput runInput() {
        return DemoFixtures.runInput(
                DemoFixtures.combatant("self", "self_template", List.of("thornmail"), List.of()),
                DemoFixtures.combatant("enemy", "enemy_template"),
                List.of(new ActionRequest(0, "enemy", "self", "basic_attack")));
    }
}
