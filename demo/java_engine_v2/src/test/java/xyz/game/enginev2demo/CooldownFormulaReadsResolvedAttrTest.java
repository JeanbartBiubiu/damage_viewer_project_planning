package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

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

/**
 * 验证冷却公式读取 resolved attr：
 * 给 self 施加一个降低 haste 的 debuff，使冷却时长变化。
 * 冷却公式为 1000 / haste，buff 使 haste 从 1.0 变为 2.0，
 * 冷却从 1000ms 缩短到 500ms。
 */
class CooldownFormulaReadsResolvedAttrTest {

    @Test
    void cooldownFormulaReflectsBuffedAttribute() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 200.0, "attack_damage", 10.0, "haste", 1.0),
                                "haste_up", "probe"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of(
                        "haste_up", DemoFixtures.actionWithTriggers(
                                "haste_up",
                                "Haste Up",
                                DemoFixtures.TRUE_PROFILE,
                                "zero_formula",
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.applyStatusEffect("haste_buff", EventActorRole.SOURCE, EventActorRole.SOURCE)))),
                        "probe", DemoFixtures.actionWithConfig(
                                "probe",
                                "Probe",
                                DemoFixtures.TRUE_PROFILE,
                                "probe_damage_formula",
                                "probe_cd_formula",
                                Map.of(),
                                List.of(),
                                List.of())),
                Map.of(),
                Map.of("haste_buff", DemoFixtures.attributeModifierStatus(
                        "haste_buff", "Haste Buff", 5_000L,
                        DemoFixtures.flatModifier("haste", "haste_bonus_formula"))),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula("haste_bonus_formula", 1.0),
                DemoFixtures.constantFormula("probe_damage_formula", 10.0),
                new FormulaDefinition("probe_cd_formula",
                        new FormulaNode.Divide(
                                new FormulaNode.Constant(1000.0),
                                new FormulaNode.Attr(FormulaNode.Scope.SOURCE, "haste"))));

        EngineDemoFacade facade = new EngineDemoFacade();

        // 没有 buff 时，冷却 = 1000/1.0 = 1000ms → 在 500ms 施放第二次应被阻断
        assertThrows(
                IllegalStateException.class,
                () -> facade.run(
                        facade.init(bundle),
                        DemoFixtures.runInput(List.of(
                                new ActionRequest(0, "self", "enemy", "probe"),
                                new ActionRequest(500, "self", "enemy", "probe")))));

        // 有 haste buff (haste=2.0) 时，冷却 = 1000/2.0 = 500ms
        // 先施放 haste_up，再 probe at 0，再 probe at 500 → 第二次应成功
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(3),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(
                                new ActionRequest(0, "self", "enemy", "haste_up"),
                                new ActionRequest(0, "self", "enemy", "probe"),
                                new ActionRequest(500, "self", "enemy", "probe"))));

        List<Long> probeTimes = result.logs().stream()
                .filter(ActionLogEntry.class::isInstance)
                .map(ActionLogEntry.class::cast)
                .filter(entry -> "probe".equals(entry.actionId()))
                .map(ActionLogEntry::timeMs)
                .toList();
        assertEquals(List.of(0L, 500L), probeTimes);
    }
}
