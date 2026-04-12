package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;

/**
 * 验证非普攻技能也走统一的 cooldownFormulaId 路径。
 * 8 秒 CD 技能通过 constant(8000) 公式设置冷却，
 * 第二次施放在 CD 期间被阻断。
 */
class FixedCooldownSkillUsesCooldownFormulaTest {

    @Test
    void fixedCooldownSkillBlocksSecondCastWithinCooldownWindow() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 200.0), "fireball"),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 500.0))),
                Map.of("fireball", DemoFixtures.actionWithConfig(
                        "fireball",
                        "Fireball",
                        DemoFixtures.TRUE_PROFILE,
                        "fireball_formula",
                        "fireball_cd",
                        Map.of(),
                        List.of(),
                        List.of())),
                DemoFixtures.constantFormula("fireball_formula", 50.0),
                DemoFixtures.constantFormula("fireball_cd", 8000.0));

        EngineDemoFacade facade = new EngineDemoFacade();

        // 第一次施放成功
        EngineRunResult firstResult = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "fireball"))));
        assertEquals(450.0, firstResult.actors().get("enemy").currentHp(), 1e-9);

        // 第二次在 CD 内施放被阻断
        IllegalStateException exception = assertThrows(
                IllegalStateException.class,
                () -> facade.run(
                        facade.init(bundle),
                        DemoFixtures.runInput(List.of(
                                new ActionRequest(0, "self", "enemy", "fireball"),
                                new ActionRequest(100, "self", "enemy", "fireball")))));
        assertEquals("action_blocked:cooldown", exception.getMessage());

        // CD 到期后可以再次施放
        EngineRunResult secondResult = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(
                        new ActionRequest(0, "self", "enemy", "fireball"),
                        new ActionRequest(8000, "self", "enemy", "fireball"))));
        assertEquals(400.0, secondResult.actors().get("enemy").currentHp(), 1e-9);
    }
}
