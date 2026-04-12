package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

class ArenaCcThresholdEndToEndTest {

    @Test
    void ccThresholdSampleGrantsControlImmunityAfterEnoughRecentControl() {
        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(ArenaCcThresholdSampleFactory.bundle()),
                ArenaCcThresholdSampleFactory.runInput());

        DamageLogEntry counterAttackLog = (DamageLogEntry) result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry damageLog && "counter_attack".equals(damageLog.actionId()))
                .findFirst()
                .orElseThrow();

        assertEquals(175.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertEquals(25.0, counterAttackLog.dealtDamage(), 1e-9);
        assertEquals("queue_empty", result.stopReason());
    }
}
