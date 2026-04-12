package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.ActionRequest;
import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

class ThresholdProcResetTest {

    @Test
    void zeroResetAllowsThresholdProcToTriggerAgainAfterAnotherCycle() {
        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(CounterProcSampleFactory.bundle()),
                DemoFixtures.runInput(List.of(
                        new ActionRequest(0, "self", "enemy", "ember_hit"),
                        new ActionRequest(1, "self", "enemy", "ember_hit"),
                        new ActionRequest(2, "self", "enemy", "ember_hit"),
                        new ActionRequest(3, "self", "enemy", "ember_hit"),
                        new ActionRequest(4, "self", "enemy", "ember_hit"),
                        new ActionRequest(5, "self", "enemy", "ember_hit"))));

        long procCount = result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry damageLog && "counter_proc".equals(damageLog.actionId()))
                .count();

        assertEquals(110.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertEquals(2L, procCount);
    }
}
