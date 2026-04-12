package xyz.game.enginev2demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.util.Map;

import org.junit.jupiter.api.Test;

import xyz.game.enginev2demo.api.EngineBundle;

class EngineSessionInitTest {

    @Test
    void initBuildsCompiledSnapshot() {
        EngineBundle bundle = DemoFixtures.bundle(
                Map.of(
                        "self_template", DemoFixtures.actor("self_template", Map.of("max_hp", 500.0)),
                        "enemy_template", DemoFixtures.actor("enemy_template", Map.of("max_hp", 500.0))),
                Map.of());

        EngineSession session = new EngineDemoFacade().init(bundle);

        assertNotNull(session);
        assertEquals(2, session.compiledSnapshot().actorTemplates().size());
        assertNotNull(session.eventDispatcher());
    }
}
