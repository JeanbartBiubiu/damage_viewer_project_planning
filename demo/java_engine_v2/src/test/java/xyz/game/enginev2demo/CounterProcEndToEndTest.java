package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

class CounterProcEndToEndTest {

    @Test
    void counterProcSampleClosesThresholdLoopWithoutHardcodedThirdHitLogic() {
        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(CounterProcSampleFactory.bundle()),
                CounterProcSampleFactory.runInput());

        long procCount = result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry damageLog && "counter_proc".equals(damageLog.actionId()))
                .count();

        assertEquals(155.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertEquals(1L, procCount);
    }
}
