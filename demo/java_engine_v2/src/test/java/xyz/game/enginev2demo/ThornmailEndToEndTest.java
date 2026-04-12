package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

class ThornmailEndToEndTest {

    @Test
    void thornmailSampleClosesThroughItemTriggerAndUnifiedDamagePipeline() {
        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(ThornmailSampleFactory.bundle()),
                ThornmailSampleFactory.runInput());

        DamageLogEntry procLog = (DamageLogEntry) result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry damageLog && "thornmail_proc".equals(damageLog.actionId()))
                .findFirst()
                .orElseThrow();

        assertEquals(150.0, result.actors().get("self").currentHp(), 1e-9);
        assertEquals(170.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertEquals(30.0, procLog.dealtDamage(), 1e-9);
    }
}
