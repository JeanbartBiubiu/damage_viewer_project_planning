package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

class EveryThirdHitCounterTest {

    @Test
    void pairScopedCounterTriggersBonusProcOnThirdHit() {
        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(CounterProcSampleFactory.bundle()),
                DemoFixtures.runInput(List.of(
                        new ActionRequest(0, "self", "enemy", "ember_hit"),
                        new ActionRequest(1, "self", "enemy", "ember_hit"),
                        new ActionRequest(2, "self", "enemy", "ember_hit"))));

        long procCount = result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry damageLog && "counter_proc".equals(damageLog.actionId()))
                .count();

        assertEquals(155.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertEquals(1L, procCount);
    }
}
