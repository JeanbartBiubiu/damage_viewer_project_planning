package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.formula.FormulaDefinition;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.formula.FormulaNode;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class ActionOwnedBonusDamageTriggerTest {

    @Test
    void actionOwnedTriggerMatchesOnlyItsOwnActionId() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 250.0),
                                "arcane_slash"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("arcane_slash", DemoFixtures.actionWithTriggers(
                        "arcane_slash",
                        "Arcane Slash",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "arcane_slash_formula",
                        List.of(DemoFixtures.trigger(
                                TriggerType.ON_DAMAGE_DEALT,
                                EventActorRole.SOURCE,
                                true,
                                DemoFixtures.dealDamageEffect(
                                        "arcane_bonus_proc",
                                        "Arcane Bonus Proc",
                                        DemoFixtures.MAGICAL_PROFILE,
                                        "arcane_bonus_formula",
                                        EventActorRole.SOURCE,
                                        EventActorRole.TARGET))))),
                Map.of(),
                Map.of(),
                DemoFixtures.constantFormula("arcane_slash_formula", 60.0),
                new FormulaDefinition(
                        "arcane_bonus_formula",
                        new FormulaNode.Multiply(List.of(
                                new FormulaNode.InputValue("dealt_damage"),
                                new FormulaNode.Constant(0.5)))));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "arcane_slash"))));

        assertEquals(110.0, result.actors().get("enemy").currentHp(), 1e-9);
        DamageLogEntry procDamage = assertInstanceOf(DamageLogEntry.class, result.logs().get(2));
        assertEquals("arcane_bonus_proc", procDamage.actionId());
        assertEquals(30.0, procDamage.dealtDamage(), 1e-9);
    }
}
