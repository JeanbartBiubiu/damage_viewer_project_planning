package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.EngineRunResult;
import xyz.game.enginev2demo.pipeline.DamageLogEntry;

class SettWEndToEndTest {

    @Test
    void settWSampleLinksHistoryShieldAndDamageInOneFlow() {
        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(
                facade.init(SettWSampleFactory.bundle()),
                SettWSampleFactory.runInput());

        DamageLogEntry haymakerLog = (DamageLogEntry) result.logs().stream()
                .filter(log -> log instanceof DamageLogEntry damageLog && "sett_w".equals(damageLog.actionId()))
                .findFirst()
                .orElseThrow();

        assertEquals(340.0, result.actors().get("self").currentHp(), 1e-9);
        assertEquals(60.0, result.actors().get("self").shieldAmount(), 1e-9);
        assertEquals(340.0, result.actors().get("enemy").currentHp(), 1e-9);
        assertEquals(60.0, haymakerLog.dealtDamage(), 1e-9);
    }
}
