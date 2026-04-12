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
import xyz.game.enginev2demo.pipeline.DamageLogEntry;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

class BlockedAutoRepeatSkipsAndRequeuesTest {

    @Test
    void blockedAutoRepeatDoesNotAbortSimulationAndRequeuesNextAttack() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 200.0, "attack_damage", 10.0, "attack_speed", 1.0),
                                "basic_attack"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 200.0),
                                "stun_bolt")),
                Map.of(
                        "basic_attack", DemoFixtures.repeatingAction(
                                "basic_attack",
                                "Basic Attack",
                                DemoFixtures.PHYSICAL_PROFILE,
                                "basic_attack_formula",
                                "repeat_delay_formula"),
                        "stun_bolt", DemoFixtures.actionWithTriggers(
                                "stun_bolt",
                                "Stun Bolt",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect("hard_stun", EventActorRole.SOURCE, EventActorRole.TARGET))))),
                Map.of(),
                Map.of("hard_stun", DemoFixtures.status(
                        "hard_stun",
                        "Hard Stun",
                        StatusKind.STUN,
                        100L,
                        StatusRefreshPolicy.REPLACE,
                        null)),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                new FormulaDefinition("repeat_delay_formula", new FormulaNode.Constant(100.0)));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(5),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "self", "enemy", "basic_attack"),
                                new ActionRequest(50, "enemy", "self", "stun_bolt"))));

        List<Long> damageTimes = result.logs().stream()
                .filter(DamageLogEntry.class::isInstance)
                .map(DamageLogEntry.class::cast)
                .map(DamageLogEntry::timeMs)
                .toList();
        List<Long> basicActionTimes = result.logs().stream()
                .filter(ActionLogEntry.class::isInstance)
                .map(ActionLogEntry.class::cast)
                .filter(entry -> "basic_attack".equals(entry.actionId()))
                .map(ActionLogEntry::timeMs)
                .toList();
        assertEquals(List.of(0L, 150L), damageTimes);
        assertEquals(List.of(0L, 150L), basicActionTimes);
    }
}
