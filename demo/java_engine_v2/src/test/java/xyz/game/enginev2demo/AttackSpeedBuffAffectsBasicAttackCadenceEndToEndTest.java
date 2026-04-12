package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.action.ActionLogEntry;
import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.api.StopCondition;
import xyz.game.enginev2demo.formula.FormulaDefinition;
import xyz.game.enginev2demo.formula.FormulaNode;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class AttackSpeedBuffAffectsBasicAttackCadenceEndToEndTest {

    @Test
    void attackSpeedBuffChangesFutureBasicAttackCadenceButNotAlreadyQueuedOne() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 300.0, "attack_damage", 10.0, "attack_speed", 1.0),
                                "speed_up",
                                "basic_attack"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 300.0, "armor", 0.0))),
                Map.of(
                        "speed_up", DemoFixtures.actionWithTriggers(
                                "speed_up",
                                "Speed Up",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect("speed_buff", EventActorRole.SOURCE, EventActorRole.SOURCE)))),
                        "basic_attack", DemoFixtures.repeatingAction(
                                "basic_attack",
                                "Basic Attack",
                                DemoFixtures.PHYSICAL_PROFILE,
                                "basic_attack_formula",
                                "repeat_delay_formula")),
                Map.of(),
                Map.of("speed_buff", DemoFixtures.attributeModifierStatus(
                        "speed_buff",
                        "Speed Buff",
                        1_000L,
                        DemoFixtures.percentModifier("attack_speed", "speed_bonus_formula"))),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula("speed_bonus_formula", 1.0),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"),
                new FormulaDefinition(
                        "repeat_delay_formula",
                        new FormulaNode.Divide(
                                new FormulaNode.Constant(1000.0),
                                new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "attack_speed"))));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(6),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "self", "enemy", "speed_up"),
                                new ActionRequest(0, "self", "enemy", "basic_attack"))));

        List<Long> basicAttackTimes = result.logs().stream()
                .filter(ActionLogEntry.class::isInstance)
                .map(ActionLogEntry.class::cast)
                .filter(entry -> "basic_attack".equals(entry.actionId()))
                .map(ActionLogEntry::timeMs)
                .toList();
        assertEquals(List.of(0L, 500L, 1000L, 2000L), basicAttackTimes);
    }
}
