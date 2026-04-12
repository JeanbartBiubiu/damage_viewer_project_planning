package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.crit.ScalarEffectLogEntry;
import xyz.game.enginev2demo.runtime.StatusKind;
import xyz.game.enginev2demo.runtime.StatusRefreshPolicy;
import xyz.game.enginev2demo.trigger.EventActorRole;
import xyz.game.enginev2demo.trigger.TriggerType;

/**
 * ApplyStatus 的 durationMs 在 allowCrit=true + 暴击时被放大。
 * <p>
 * baseDuration=1000ms, critMultiplier=2.0 → crittedDuration=2000ms。
 * 验证方式：应用 STUN 状态，其持续时间从 1000ms → 2000ms，
 * 通过 ScalarEffectLogEntry 检查 status_duration 类型。
 */
class CritStatusDurationCanCritTest {

    @Test
    void statusDurationIsCrittedWhenAllowCrit() {
        EngineBundle bundle = DemoFixtures.bundleWithCrit(
                Map.of(
                        "self_template", DemoFixtures.actorWithTriggers(
                                "self_template",
                                Map.of("max_hp", 500.0, "crit_chance", 1.0),
                                List.of(DemoFixtures.trigger(
                                        TriggerType.ON_ACTION_CAST,
                                        EventActorRole.SOURCE,
                                        false,
                                        DemoFixtures.critApplyStatusEffect(
                                                "crit_stun",
                                                EventActorRole.SOURCE,
                                                EventActorRole.TARGET))),
                                "stun_action"),
                        "enemy_template", DemoFixtures.actor(
                                "enemy_template",
                                Map.of("max_hp", 500.0))),
                Map.of("stun_action", DemoFixtures.critAction(
                        "stun_action", "Stun",
                        DemoFixtures.TRUE_PROFILE, "zero_formula",
                        DemoFixtures.CRIT_TYPE_PHYSICAL)),
                Map.of(),
                Map.of("crit_stun", DemoFixtures.status(
                        "crit_stun",
                        "Crit Stun",
                        StatusKind.STUN,
                        1000L,
                        StatusRefreshPolicy.REPLACE,
                        null)),
                Map.of(DemoFixtures.CRIT_TYPE_PHYSICAL,
                        DemoFixtures.critRule(DemoFixtures.CRIT_TYPE_PHYSICAL, DemoFixtures.FORMULA_CRIT_MULTIPLIER)),
                DemoFixtures.constantFormula("zero_formula", 0.0),
                DemoFixtures.constantFormula(DemoFixtures.FORMULA_CRIT_MULTIPLIER, 2.0));

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(bundle),
                DemoFixtures.runInput(List.of(new ActionRequest(0, "self", "enemy", "stun_action"))));

        // Verify scalar effect log for duration crit
        ScalarEffectLogEntry durLog = result.logs().stream()
                .filter(log -> log instanceof ScalarEffectLogEntry)
                .map(log -> (ScalarEffectLogEntry) log)
                .filter(log -> "status_duration".equals(log.effectKind()))
                .findFirst()
                .orElseThrow();
        assertTrue(durLog.isCritical());
        assertEquals(1000.0, durLog.baseValue(), 1e-9);
        assertEquals(2000.0, durLog.finalValue(), 1e-9);
        assertEquals(2.0, durLog.critMultiplier(), 1e-9);
    }
}
