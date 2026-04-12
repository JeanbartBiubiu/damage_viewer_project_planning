package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

class AkaliEEndToEndTest {

    @Test
    void akaliESampleAppliesMarkThenConsumesItForFollowupCast() {
        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(AkaliESampleFactory.bundle()),
                AkaliESampleFactory.runInput());

        DamageLogEntry e2Log = (DamageLogEntry) result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry damageLog && "akali_e2".equals(damageLog.actionId()))
                .findFirst()
                .orElseThrow();

        assertEquals(190.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertEquals(70.0, e2Log.dealtDamage(), 1e-9);
    }
}
