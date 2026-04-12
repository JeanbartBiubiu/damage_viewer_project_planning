package xyz.game.enginev2demo;

import java.util.List;
import java.util.Map;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunInput;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

final class ArenaCcThresholdSampleFactory {

    private ArenaCcThresholdSampleFactory() {
    }

    static EngineBundle bundle() {
        return DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actorWithTriggers(
                                "self_template",
                                Map.of("max_hp", 250.0),
                                List.of(DemoFixtures.conditionalTrigger(
                                        TriggerType.ON_STATUS_EXPIRED,
                                        EventActorRole.TARGET,
                                        "cc_threshold_condition",
                                        false,
                                        DemoFixtures.applyStatusEffect(
                                                "cc_immunity",
                                                EventActorRole.TARGET,
                                                EventActorRole.TARGET))),
                                "counter_attack"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 200.0),
                                "stun_bolt")),
                Map.of(
                        "counter_attack", DemoFixtures.action(
                                "counter_attack",
                                "Counter Attack",
                                DemoFixtures.TRUE_PROFILE,
                                "counter_attack_formula"),
                        "stun_bolt", DemoFixtures.actionWithConfig(
                                "stun_bolt",
                                "Stun Bolt",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                DemoFixtures.FORMULA_ZERO_COOLDOWN,
                                Map.of(),
                                List.of(),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect(
                                                "short_stun",
                                                EventActorRole.SOURCE,
                                                EventActorRole.TARGET))))),
                Map.of(),
                Map.of(
                        "short_stun", DemoFixtures.status(
                                "short_stun",
                                "Short Stun",
                                StatusKind.STUN,
                                1000L,
                                StatusRefreshPolicy.REPLACE,
                                null),
                        "cc_immunity", DemoFixtures.status(
                                "cc_immunity",
                                "CC Immunity",
                                StatusKind.CONTROL_IMMUNE,
                                5000L,
                                StatusRefreshPolicy.REPLACE,
                                null)),
                DemoFixtures.constantFormula("counter_attack_formula", 25.0),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.addFormula(
                        "cc_threshold_condition",
                        new xyz.game.enginev2demo.formula.FormulaNode.RecentControlDuration(
                                xyz.game.enginev2demo.formula.FormulaNode.Scope.TARGET,
                                5000L),
                        new xyz.game.enginev2demo.formula.FormulaNode.Constant(-1500.0)));
    }

    static EngineRunInput runInput() {
        return DemoFixtures.runInput(List.of(
                new ActionRequest(0, "enemy", "self", "stun_bolt"),
                new ActionRequest(1001, "enemy", "self", "stun_bolt"),
                new ActionRequest(2002, "enemy", "self", "stun_bolt"),
                new ActionRequest(2003, "self", "enemy", "counter_attack")));
    }
}
