package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.EngineBundle;
import xyz.game.enginev2demo.api.EngineRunResult;

class EmptyRunLoopTest {

    @Test
    void runStopsCleanlyWhenQueueIsEmpty() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 500.0)),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 400.0))),
                Map.of());

        EngineDemoFacade facade = new EngineDemoFacade();
        EngineRunResult result = facade.run(facade.init(bundle), DemoFixtures.runInput(List.of()));

        assertEquals("queue_empty", result.stopReason());
        assertEquals(0, result.processedEvents());
        assertTrue(result.logs().isEmpty());
        assertEquals(500.0, result.actors().get("self").currentHp(), 1e-9);
        assertEquals(400.0, result.actors().get("enemy").currentHp(), 1e-9);
    }
}
