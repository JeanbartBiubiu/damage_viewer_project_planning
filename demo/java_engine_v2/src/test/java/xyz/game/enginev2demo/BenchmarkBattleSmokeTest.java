package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.EngineRunResult;

class BenchmarkBattleSmokeTest {

    @Test
    void benchmarkStyleBattleRunsToCompletion() {
        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(BenchmarkBattleSampleFactory.bundle()),
                BenchmarkBattleSampleFactory.runInput());

        assertEquals("queue_empty", result.stopReason());
        assertEquals(0.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertTrue(result.actors().get("self").currentHp() > 0.0);
        assertTrue(result.processedEvents() >= 10);
        assertTrue(result.logs().size() >= 10);
    }
}
