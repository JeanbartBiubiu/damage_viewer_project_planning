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

class AutoRepeatBasicAttackSchedulesNextByResolvedAttackSpeedTest {

    @Test
    void repeatableBasicAttackUsesResolvedAttackSpeedForNextSchedule() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 200.0, "attack_damage", 10.0, "attack_speed", 2.0),
                                "basic_attack"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0, "armor", 0.0))),
                Map.of("basic_attack", DemoFixtures.repeatingAction(
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula",
                        "repeat_delay_formula")),
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
                        new StopCondition(2),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(new ActionRequest(0, "self", "enemy", "basic_attack"))));

        List<Long> actionTimes = result.logs().stream()
                .filter(ActionLogEntry.class::isInstance)
                .map(ActionLogEntry.class::cast)
                .map(ActionLogEntry::timeMs)
                .toList();
        assertEquals(List.of(0L, 500L), actionTimes);
        assertEquals(180.0, result.actors().get("enemy").currentHp(), 1e-9);
    }
}
