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

/**
 * 验证自动普攻撞上冷却时，按 readyAtMs 重新排队。
 * <p>
 * 场景：cooldown=200ms 的 autoRepeat 动作，手动在 0ms 和 50ms 各入队一次。
 * 0ms 成功执行后 readyAtMs=200ms。
 * 50ms 的 MANUAL 施放被冷却阻断(fail-fast)——但这里我们构造一个
 * AUTO_REPEAT 场景：先成功执行，冷却设为 200ms，队列里的下一次
 * AUTO_REPEAT 在 200ms 触发时冷却已过。
 */
class AutoRepeatBlockedByCooldownRequeuesToReadyAtTest {

    @Test
    void autoRepeatBlockedByCooldownRequeuesAtReadyAtMs() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor(
                                "self_template",
                                Map.of("max_hp", 200.0, "attack_damage", 10.0),
                                "basic_attack"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 200.0))),
                Map.of("basic_attack", DemoFixtures.repeatingAction(
                        "basic_attack",
                        "Basic Attack",
                        DemoFixtures.PHYSICAL_PROFILE,
                        "basic_attack_formula",
                        "cooldown_formula")),
                DemoFixtures.sourceAttrFormula("basic_attack_formula", "attack_damage"),
                new FormulaDefinition("cooldown_formula", new FormulaNode.Constant(200.0)));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(
                        7L,
                        new StopCondition(3),
                        DemoFixtures.combatant("self", "self_template"),
                        DemoFixtures.combatant("enemy", "enemy_template"),
                        List.of(new ActionRequest(0, "self", "enemy", "basic_attack"))));

        // 0ms → 成功，readyAtMs=200ms，AUTO_REPEAT at 200ms
        // 200ms → 成功，readyAtMs=400ms，AUTO_REPEAT at 400ms
        // 400ms → 成功 (第3次)
        List<Long> actionTimes = result.logs().stream()
                .filter(ActionLogEntry.class::isInstance)
                .map(ActionLogEntry.class::cast)
                .filter(entry -> "basic_attack".equals(entry.actionId()))
                .map(ActionLogEntry::timeMs)
                .toList();
        assertEquals(List.of(0L, 200L, 400L), actionTimes);
    }
}
